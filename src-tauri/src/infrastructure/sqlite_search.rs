use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::application::{BeginResourceIndexInput, SearchError, SearchRepository};
use crate::domain::{
    IndexedResourcePage, ResourceIndexSession, ResourceIndexState, ResourceIndexStatus,
    ResourceSearchMatchKind, ResourceSearchResult,
};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

/// `SQLite` adapter for derived PDF text, resumable index state, and FTS5 search.
#[derive(Debug, Clone)]
pub(crate) struct SqliteSearchRepository {
    database_path: PathBuf,
}

impl SqliteSearchRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, SearchError> {
        if !self.database_path.exists() {
            return Err(SearchError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl SearchRepository for SqliteSearchRepository {
    fn recover_interrupted(&self, updated_at: i64) -> Result<u64, SearchError> {
        if !self.database_path.exists() {
            return Ok(0);
        }
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE resource_index_job
                 SET state = 'interrupted', error_code = 'RESOURCE_INDEX_INTERRUPTED',
                     updated_at = ?1
                 WHERE state = 'running'",
                params![updated_at],
            )
            .map_err(database_error)?;
        u64::try_from(changed).map_err(|_| invalid_stored())
    }

    fn list_statuses(&self) -> Result<Vec<ResourceIndexStatus>, SearchError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT d.id, d.page_count, j.state, j.total_pages, j.indexed_pages,
                        j.text_pages, j.chunk_count, j.updated_at
                 FROM resource_document d
                 LEFT JOIN resource_index_job j ON j.document_id = d.id
                 WHERE d.kind = 'pdf' AND d.deleted_at IS NULL
                 ORDER BY d.created_at DESC, d.id DESC",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([], status_from_row)
            .map_err(database_error)?;
        rows.map(|row| row.map_err(database_error).map_err(SearchError::from))
            .collect()
    }

    fn begin_index(
        &self,
        input: &BeginResourceIndexInput,
        started_at: i64,
    ) -> Result<ResourceIndexSession, SearchError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        let source_sha256 = load_pdf_sha256(&transaction, &input.document_id)?;
        let existing = transaction
            .query_row(
                "SELECT source_sha256, state, total_pages
                 FROM resource_index_job WHERE document_id = ?1",
                params![input.document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(database_error)?;
        let source_changed = existing.as_ref().is_some_and(|(sha256, _, total_pages)| {
            sha256 != &source_sha256 || *total_pages != i64::from(input.total_pages)
        });
        if input.force || source_changed {
            purge_index(&transaction, &input.document_id)?;
        } else if existing
            .as_ref()
            .is_some_and(|(_, state, _)| matches!(state.as_str(), "ready" | "empty"))
        {
            let status = load_status(&transaction, &input.document_id)?;
            transaction.commit().map_err(database_error)?;
            return Ok(ResourceIndexSession {
                next_page: input.total_pages.saturating_add(1),
                status,
                needs_indexing: false,
            });
        }
        transaction
            .execute(
                "INSERT INTO resource_index_job(
                    document_id, source_sha256, state, total_pages, indexed_pages,
                    text_pages, chunk_count, error_code, started_at, updated_at, completed_at
                 ) VALUES (?1, ?2, 'running', ?3, 0, 0, 0, NULL, ?4, ?4, NULL)
                 ON CONFLICT(document_id) DO UPDATE SET
                    source_sha256 = excluded.source_sha256,
                    state = 'running', total_pages = excluded.total_pages,
                    error_code = NULL, started_at = excluded.started_at,
                    updated_at = excluded.updated_at, completed_at = NULL",
                params![
                    input.document_id,
                    source_sha256,
                    i64::from(input.total_pages),
                    started_at
                ],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "UPDATE resource_document
                 SET page_count = ?2, updated_at = MAX(updated_at, ?3)
                 WHERE id = ?1",
                params![input.document_id, i64::from(input.total_pages), started_at],
            )
            .map_err(database_error)?;
        refresh_counts(&transaction, &input.document_id, started_at)?;
        let next_page = first_missing_page(&transaction, &input.document_id, input.total_pages)?;
        let status = load_status(&transaction, &input.document_id)?;
        transaction.commit().map_err(database_error)?;
        Ok(ResourceIndexSession {
            status,
            next_page,
            needs_indexing: true,
        })
    }

    fn store_page(
        &self,
        page: &IndexedResourcePage,
        indexed_at: i64,
    ) -> Result<ResourceIndexStatus, SearchError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        ensure_running_job(&transaction, page)?;
        let title = load_document_title(&transaction, &page.document_id)?;
        remove_page_chunks(&transaction, &page.document_id, page.page_number)?;
        let text_state = if page.text.is_empty() {
            "empty"
        } else {
            "text"
        };
        transaction
            .execute(
                "INSERT INTO resource_page_text(
                    document_id, page_number, width_points, height_points, text_state,
                    text_content, content_hash, indexed_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(document_id, page_number) DO UPDATE SET
                    width_points = excluded.width_points,
                    height_points = excluded.height_points,
                    text_state = excluded.text_state,
                    text_content = excluded.text_content,
                    content_hash = excluded.content_hash,
                    indexed_at = excluded.indexed_at",
                params![
                    page.document_id,
                    i64::from(page.page_number),
                    page.width_points,
                    page.height_points,
                    text_state,
                    page.text,
                    hash_text(&page.text),
                    indexed_at
                ],
            )
            .map_err(database_error)?;
        for (sequence, text) in page.chunks.iter().enumerate() {
            insert_chunk(
                &transaction,
                &page.document_id,
                page.page_number,
                sequence,
                &title,
                text,
                indexed_at,
            )?;
        }
        refresh_counts(&transaction, &page.document_id, indexed_at)?;
        let status = load_status(&transaction, &page.document_id)?;
        transaction.commit().map_err(database_error)?;
        Ok(status)
    }

    fn complete_index(
        &self,
        document_id: &str,
        completed_at: i64,
    ) -> Result<ResourceIndexStatus, SearchError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        let (state, total_pages, indexed_pages, chunk_count) = transaction
            .query_row(
                "SELECT state, total_pages, indexed_pages, chunk_count
                 FROM resource_index_job WHERE document_id = ?1",
                params![document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(database_error)?
            .ok_or(SearchError::IndexNotRunning)?;
        if state != "running" {
            return Err(SearchError::IndexNotRunning);
        }
        if total_pages != indexed_pages {
            return Err(SearchError::IndexIncomplete);
        }
        let terminal_state = if chunk_count == 0 { "empty" } else { "ready" };
        transaction
            .execute(
                "UPDATE resource_index_job
                 SET state = ?2, error_code = NULL, updated_at = ?3, completed_at = ?3
                 WHERE document_id = ?1 AND state = 'running'",
                params![document_id, terminal_state, completed_at],
            )
            .map_err(database_error)?;
        let status = load_status(&transaction, document_id)?;
        transaction.commit().map_err(database_error)?;
        Ok(status)
    }

    fn interrupt_index(
        &self,
        document_id: &str,
        updated_at: i64,
    ) -> Result<ResourceIndexStatus, SearchError> {
        let connection = self.open()?;
        ensure_pdf_exists(&connection, document_id)?;
        connection
            .execute(
                "UPDATE resource_index_job
                 SET state = 'interrupted', error_code = 'RESOURCE_INDEX_INTERRUPTED',
                     updated_at = ?2, completed_at = NULL
                 WHERE document_id = ?1 AND state = 'running'",
                params![document_id, updated_at],
            )
            .map_err(database_error)?;
        load_status(&connection, document_id)
    }

    fn fail_index(
        &self,
        document_id: &str,
        updated_at: i64,
    ) -> Result<ResourceIndexStatus, SearchError> {
        let connection = self.open()?;
        ensure_pdf_exists(&connection, document_id)?;
        connection
            .execute(
                "UPDATE resource_index_job
                 SET state = 'failed', error_code = 'RESOURCE_INDEX_EXTRACTION_FAILED',
                     updated_at = ?2, completed_at = NULL
                 WHERE document_id = ?1 AND state = 'running'",
                params![document_id, updated_at],
            )
            .map_err(database_error)?;
        load_status(&connection, document_id)
    }

    fn clear_index(&self, document_id: &str) -> Result<ResourceIndexStatus, SearchError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        ensure_pdf_exists(&transaction, document_id)?;
        purge_index(&transaction, document_id)?;
        let status = load_status(&transaction, document_id)?;
        transaction.commit().map_err(database_error)?;
        Ok(status)
    }

    fn search(&self, query: &str, limit: u32) -> Result<Vec<ResourceSearchResult>, SearchError> {
        let connection = self.open()?;
        let maximum = usize::try_from(limit).map_err(|_| SearchError::InvalidInput)?;
        let mut results = if query.chars().count() < 3 {
            search_short_page_text(&connection, query, maximum)?
        } else {
            search_fts(&connection, query, maximum)?
        };
        let remaining = maximum.saturating_sub(results.len());
        if remaining > 0 {
            results.extend(search_titles(
                &connection,
                query,
                u32::try_from(remaining).map_err(|_| SearchError::InvalidInput)?,
            )?);
        }
        Ok(results)
    }
}

fn immediate(connection: &mut Connection) -> Result<Transaction<'_>, SearchError> {
    connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)
        .map_err(SearchError::from)
}

fn load_pdf_sha256(connection: &Connection, document_id: &str) -> Result<String, SearchError> {
    connection
        .query_row(
            "SELECT d.kind, b.sha256 FROM resource_document d
             JOIN blob b ON b.id = d.blob_id
             WHERE d.id = ?1 AND d.deleted_at IS NULL",
            params![document_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(SearchError::DocumentNotFound)
        .and_then(|(kind, sha256)| {
            if kind == "pdf" {
                Ok(sha256)
            } else {
                Err(SearchError::UnsupportedDocument)
            }
        })
}

fn ensure_pdf_exists(connection: &Connection, document_id: &str) -> Result<(), SearchError> {
    load_pdf_sha256(connection, document_id).map(|_| ())
}

fn load_document_title(connection: &Connection, document_id: &str) -> Result<String, SearchError> {
    connection
        .query_row(
            "SELECT title FROM resource_document
             WHERE id = ?1 AND kind = 'pdf' AND deleted_at IS NULL",
            params![document_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(SearchError::DocumentNotFound)
}

fn status_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ResourceIndexStatus> {
    let state = row.get::<_, Option<String>>(2)?;
    Ok(ResourceIndexStatus {
        document_id: row.get(0)?,
        state: state
            .as_deref()
            .and_then(ResourceIndexState::parse)
            .unwrap_or(ResourceIndexState::NotIndexed),
        total_pages: optional_u32(row.get::<_, Option<i64>>(3)?.or(row.get(1)?), 3)?,
        indexed_pages: to_u32(row.get::<_, Option<i64>>(4)?.unwrap_or(0), 4)?,
        text_pages: to_u32(row.get::<_, Option<i64>>(5)?.unwrap_or(0), 5)?,
        chunk_count: to_u32(row.get::<_, Option<i64>>(6)?.unwrap_or(0), 6)?,
        updated_at: row.get(7)?,
    })
}

fn load_status(
    connection: &Connection,
    document_id: &str,
) -> Result<ResourceIndexStatus, SearchError> {
    connection
        .query_row(
            "SELECT d.id, d.page_count, j.state, j.total_pages, j.indexed_pages,
                    j.text_pages, j.chunk_count, j.updated_at
             FROM resource_document d
             LEFT JOIN resource_index_job j ON j.document_id = d.id
             WHERE d.id = ?1 AND d.kind = 'pdf' AND d.deleted_at IS NULL",
            params![document_id],
            status_from_row,
        )
        .optional()
        .map_err(database_error)?
        .ok_or(SearchError::DocumentNotFound)
}

fn purge_index(transaction: &Transaction<'_>, document_id: &str) -> Result<(), SearchError> {
    transaction
        .execute(
            "DELETE FROM resource_text_fts WHERE document_id = ?1",
            params![document_id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM resource_text_chunk WHERE document_id = ?1",
            params![document_id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM resource_page_text WHERE document_id = ?1",
            params![document_id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM resource_index_job WHERE document_id = ?1",
            params![document_id],
        )
        .map_err(database_error)?;
    Ok(())
}

fn first_missing_page(
    transaction: &Transaction<'_>,
    document_id: &str,
    total_pages: u32,
) -> Result<u32, SearchError> {
    let mut statement = transaction
        .prepare(
            "SELECT page_number FROM resource_page_text
             WHERE document_id = ?1 ORDER BY page_number",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map(params![document_id], |row| row.get::<_, i64>(0))
        .map_err(database_error)?;
    let mut expected = 1_u32;
    for row in rows {
        let page = to_u32(row.map_err(database_error)?, 0).map_err(database_error)?;
        if page != expected {
            return Ok(expected);
        }
        expected = expected.saturating_add(1);
    }
    Ok(expected.min(total_pages.saturating_add(1)))
}

fn ensure_running_job(
    transaction: &Transaction<'_>,
    page: &IndexedResourcePage,
) -> Result<(), SearchError> {
    let job = transaction
        .query_row(
            "SELECT j.state, j.total_pages, j.source_sha256, b.sha256
             FROM resource_index_job j
             JOIN resource_document d ON d.id = j.document_id
             JOIN blob b ON b.id = d.blob_id
             WHERE j.document_id = ?1 AND d.kind = 'pdf' AND d.deleted_at IS NULL",
            params![page.document_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(SearchError::IndexNotRunning)?;
    if job.0 != "running"
        || job.1 != i64::from(page.total_pages)
        || job.2 != job.3
        || page.page_number > page.total_pages
    {
        return Err(SearchError::IndexNotRunning);
    }
    Ok(())
}

fn remove_page_chunks(
    transaction: &Transaction<'_>,
    document_id: &str,
    page_number: u32,
) -> Result<(), SearchError> {
    transaction
        .execute(
            "DELETE FROM resource_text_fts
             WHERE document_id = ?1 AND page_number = ?2",
            params![document_id, i64::from(page_number)],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM resource_text_chunk
             WHERE document_id = ?1 AND page_number = ?2",
            params![document_id, i64::from(page_number)],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_chunk(
    transaction: &Transaction<'_>,
    document_id: &str,
    page_number: u32,
    sequence: usize,
    title: &str,
    text: &str,
    created_at: i64,
) -> Result<(), SearchError> {
    let id = Uuid::now_v7().to_string();
    transaction
        .execute(
            "INSERT INTO resource_text_chunk(
                id, document_id, page_number, sequence, text, chunk_hash, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                document_id,
                i64::from(page_number),
                i64::try_from(sequence).map_err(|_| SearchError::InvalidInput)?,
                text,
                hash_text(text),
                created_at
            ],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "INSERT INTO resource_text_fts(chunk_id, document_id, page_number, title, text)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, document_id, i64::from(page_number), title, text],
        )
        .map_err(database_error)?;
    Ok(())
}

fn refresh_counts(
    transaction: &Transaction<'_>,
    document_id: &str,
    updated_at: i64,
) -> Result<(), SearchError> {
    transaction
        .execute(
            "UPDATE resource_index_job
             SET indexed_pages = (
                    SELECT COUNT(*) FROM resource_page_text WHERE document_id = ?1
                 ),
                 text_pages = (
                    SELECT COUNT(*) FROM resource_page_text
                    WHERE document_id = ?1 AND text_state = 'text'
                 ),
                 chunk_count = (
                    SELECT COUNT(*) FROM resource_text_chunk WHERE document_id = ?1
                 ),
                 updated_at = ?2
             WHERE document_id = ?1",
            params![document_id, updated_at],
        )
        .map_err(database_error)?;
    Ok(())
}

fn search_titles(
    connection: &Connection,
    query: &str,
    limit: u32,
) -> Result<Vec<ResourceSearchResult>, SearchError> {
    let mut statement = connection
        .prepare(
            "SELECT id, title, kind FROM resource_document
             WHERE deleted_at IS NULL AND instr(lower(title), lower(?1)) > 0
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map(params![query, i64::from(limit)], |row| {
            let title = row.get::<_, String>(1)?;
            Ok(ResourceSearchResult {
                document_id: row.get(0)?,
                document_title: title.clone(),
                document_kind: row.get(2)?,
                page_number: None,
                excerpt: title,
                match_kind: ResourceSearchMatchKind::Title,
            })
        })
        .map_err(database_error)?;
    rows.map(|row| row.map_err(database_error).map_err(SearchError::from))
        .collect()
}

fn search_short_page_text(
    connection: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<ResourceSearchResult>, SearchError> {
    let mut statement = connection
        .prepare(
            "SELECT p.document_id, d.title, d.kind, p.page_number, p.text_content
             FROM resource_page_text p
             JOIN resource_document d ON d.id = p.document_id
             WHERE d.deleted_at IS NULL AND p.text_state = 'text'
               AND instr(p.text_content, ?1) > 0
             ORDER BY d.created_at DESC, p.page_number
             LIMIT ?2",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map(
            params![
                query,
                i64::try_from(limit).map_err(|_| SearchError::InvalidInput)?
            ],
            |row| search_result_from_row(row, query),
        )
        .map_err(database_error)?;
    rows.map(|row| row.map_err(database_error).map_err(SearchError::from))
        .collect()
}

fn search_fts(
    connection: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<ResourceSearchResult>, SearchError> {
    let expression = format!("\"{}\"", query.replace('"', "\"\""));
    let candidate_limit = limit.saturating_mul(4).max(limit);
    let mut statement = connection
        .prepare(
            "SELECT f.document_id, d.title, d.kind, CAST(f.page_number AS INTEGER), f.text
             FROM resource_text_fts f
             JOIN resource_document d ON d.id = f.document_id
             WHERE resource_text_fts MATCH ?1 AND d.deleted_at IS NULL
             ORDER BY bm25(resource_text_fts), d.created_at DESC
             LIMIT ?2",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map(
            params![
                expression,
                i64::try_from(candidate_limit).map_err(|_| SearchError::InvalidInput)?
            ],
            |row| search_result_from_row(row, query),
        )
        .map_err(database_error)?;
    let mut seen = HashSet::new();
    let mut results = Vec::new();
    for row in rows {
        let result = row.map_err(database_error)?;
        let page = result.page_number.unwrap_or_default();
        if seen.insert((result.document_id.clone(), page)) {
            results.push(result);
            if results.len() == limit {
                break;
            }
        }
    }
    Ok(results)
}

fn search_result_from_row(
    row: &rusqlite::Row<'_>,
    query: &str,
) -> rusqlite::Result<ResourceSearchResult> {
    let page_number = to_u32(row.get(3)?, 3)?;
    let text = row.get::<_, String>(4)?;
    Ok(ResourceSearchResult {
        document_id: row.get(0)?,
        document_title: row.get(1)?,
        document_kind: row.get(2)?,
        page_number: Some(page_number),
        excerpt: build_excerpt(&text, query),
        match_kind: ResourceSearchMatchKind::PageText,
    })
}

fn build_excerpt(text: &str, query: &str) -> String {
    const MAXIMUM_EXCERPT_CHARS: usize = 180;
    const LEADING_CONTEXT_CHARS: usize = 60;
    let characters = text.chars().collect::<Vec<_>>();
    if characters.len() <= MAXIMUM_EXCERPT_CHARS {
        return text.to_owned();
    }
    let needle = query.chars().collect::<Vec<_>>();
    let match_start = characters
        .windows(needle.len())
        .position(|window| window == needle)
        .unwrap_or(0);
    let start = match_start.saturating_sub(LEADING_CONTEXT_CHARS);
    let end = (start + MAXIMUM_EXCERPT_CHARS).min(characters.len());
    let mut excerpt = characters[start..end].iter().collect::<String>();
    if start > 0 {
        excerpt.insert_str(0, "...");
    }
    if end < characters.len() {
        excerpt.push_str("...");
    }
    excerpt
}

fn hash_text(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:X}", hasher.finalize())
}

fn to_u32(value: i64, column: usize) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|_| conversion_error(column, "integer is outside u32"))
}

fn optional_u32(value: Option<i64>, column: usize) -> rusqlite::Result<Option<u32>> {
    value.map(|number| to_u32(number, column)).transpose()
}

fn conversion_error(column: usize, message: &'static str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        column,
        rusqlite::types::Type::Integer,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

fn invalid_stored() -> SearchError {
    SearchError::Persistence(crate::application::PersistenceError::UnsupportedConfiguration)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::AtomicBool;

    use tempfile::{TempDir, tempdir};

    use super::SqliteSearchRepository;
    use crate::application::{
        BeginResourceIndexInput, ResourceUseCases, SearchResourcesInput, SearchUseCases,
        StoreResourcePageTextInput, WorkspaceUseCases,
    };
    use crate::domain::{ResourceIndexState, ResourceSearchMatchKind};
    use crate::infrastructure::{SqliteBlobStore, SqliteWorkspaceRepository};

    struct Fixture {
        _directory: TempDir,
        document_id: String,
        search: SearchUseCases<SqliteSearchRepository>,
    }

    fn fixture() -> Fixture {
        let directory = tempdir().expect("temporary directory should exist");
        let workspace = WorkspaceUseCases::new(SqliteWorkspaceRepository::new(directory.path()));
        workspace
            .initialize_default()
            .expect("workspace should initialize");
        let source = directory.path().join("规划资料.pdf");
        fs::write(&source, b"local pdf placeholder").expect("fixture source should write");
        let resources = ResourceUseCases::new(SqliteBlobStore::new(directory.path()));
        let document = resources
            .import_file(&source, &AtomicBool::new(false), &mut |_| {})
            .expect("fixture PDF should import");
        Fixture {
            search: SearchUseCases::new(SqliteSearchRepository::new(directory.path())),
            document_id: document.id,
            _directory: directory,
        }
    }

    fn page_input(document_id: &str, page_number: u32, text: &str) -> StoreResourcePageTextInput {
        StoreResourcePageTextInput {
            document_id: document_id.to_owned(),
            page_number,
            total_pages: 2,
            width_points: 595.0,
            height_points: 842.0,
            text: text.to_owned(),
        }
    }

    #[test]
    fn completed_index_searches_chinese_text_and_returns_its_page() {
        let fixture = fixture();
        fixture
            .search
            .begin_index(&BeginResourceIndexInput {
                document_id: fixture.document_id.clone(),
                total_pages: 2,
                force: false,
            })
            .expect("index should begin");
        fixture
            .search
            .store_page(page_input(&fixture.document_id, 1, "第一阶段复习数据结构"))
            .expect("first page should index");
        fixture
            .search
            .store_page(page_input(&fixture.document_id, 2, "第二阶段复习操作系统"))
            .expect("second page should index");
        fixture
            .search
            .complete_index(&fixture.document_id)
            .expect("complete index should succeed");

        let results = fixture
            .search
            .search(&SearchResourcesInput {
                query: "操作系统".to_owned(),
                limit: Some(10),
            })
            .expect("search should succeed");

        assert_eq!(results[0].page_number, Some(2));
        assert_eq!(results[0].match_kind, ResourceSearchMatchKind::PageText);
    }

    #[test]
    fn interrupted_index_resumes_from_the_first_missing_page() {
        let fixture = fixture();
        fixture
            .search
            .begin_index(&BeginResourceIndexInput {
                document_id: fixture.document_id.clone(),
                total_pages: 2,
                force: false,
            })
            .expect("index should begin");
        fixture
            .search
            .store_page(page_input(&fixture.document_id, 1, "已经完成的第一页"))
            .expect("first page should index");
        fixture
            .search
            .interrupt_index(&fixture.document_id)
            .expect("index should interrupt");

        let resumed = fixture
            .search
            .begin_index(&BeginResourceIndexInput {
                document_id: fixture.document_id,
                total_pages: 2,
                force: false,
            })
            .expect("index should resume");

        assert_eq!(resumed.next_page, 2);
        assert_eq!(resumed.status.indexed_pages, 1);
    }

    #[test]
    fn empty_document_finishes_with_an_explicit_empty_state() {
        let fixture = fixture();
        fixture
            .search
            .begin_index(&BeginResourceIndexInput {
                document_id: fixture.document_id.clone(),
                total_pages: 2,
                force: false,
            })
            .expect("index should begin");
        fixture
            .search
            .store_page(page_input(&fixture.document_id, 1, ""))
            .expect("empty page should index");
        fixture
            .search
            .store_page(page_input(&fixture.document_id, 2, ""))
            .expect("empty page should index");

        let completed = fixture
            .search
            .complete_index(&fixture.document_id)
            .expect("empty index should complete");

        assert_eq!(completed.state, ResourceIndexState::Empty);
    }

    #[test]
    fn force_rebuild_removes_old_page_matches_before_extraction_restarts() {
        let fixture = fixture();
        fixture
            .search
            .begin_index(&BeginResourceIndexInput {
                document_id: fixture.document_id.clone(),
                total_pages: 2,
                force: false,
            })
            .expect("index should begin");
        fixture
            .search
            .store_page(page_input(&fixture.document_id, 1, "旧的操作系统内容"))
            .expect("first page should index");
        fixture
            .search
            .store_page(page_input(&fixture.document_id, 2, "旧的组成原理内容"))
            .expect("second page should index");
        fixture
            .search
            .complete_index(&fixture.document_id)
            .expect("index should complete");

        let rebuilt = fixture
            .search
            .begin_index(&BeginResourceIndexInput {
                document_id: fixture.document_id,
                total_pages: 2,
                force: true,
            })
            .expect("force rebuild should begin");

        assert_eq!(rebuilt.next_page, 1);
        assert_eq!(rebuilt.status.indexed_pages, 0);
    }

    #[test]
    fn startup_recovery_marks_a_running_index_interrupted() {
        let fixture = fixture();
        fixture
            .search
            .begin_index(&BeginResourceIndexInput {
                document_id: fixture.document_id,
                total_pages: 2,
                force: false,
            })
            .expect("index should begin");

        fixture
            .search
            .recover_interrupted()
            .expect("recovery should succeed");
        let statuses = fixture
            .search
            .list_statuses()
            .expect("statuses should load");

        assert_eq!(statuses[0].state, ResourceIndexState::Interrupted);
    }
}
