use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use fs4::FileExt;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use sha2::{Digest, Sha256};
use tempfile::{Builder, NamedTempFile, TempPath};
use uuid::Uuid;

use crate::application::{
    ImportError, ImportProgress, ImportRequest, ReadableResource, RecoveryReport, ResourceDocument,
    ResourceReaderDescriptor, ResourceRepository, current_utc_millis,
};

use super::sqlite_workspace::{SqliteWorkspaceRepository, migrate, open_database};

const FREE_SPACE_RESERVE_BYTES: u64 = 64 * 1024 * 1024;
const PROGRESS_PERSIST_INTERVAL_BYTES: u64 = 16 * 1024 * 1024;
const STREAM_BUFFER_BYTES: usize = 1024 * 1024;

#[derive(Debug)]
struct AuthorizedSource {
    path: PathBuf,
    original_name: String,
    size_bytes: u64,
}

#[derive(Debug)]
struct ActiveJob {
    id: String,
    workspace_id: String,
    document_id: String,
    original_name: String,
    title: String,
    kind: String,
    mime_type: String,
    expected_size: u64,
    staging_key: String,
    sha256: Option<String>,
    storage_key: Option<String>,
    state: String,
    created_at: i64,
}

/// Content-addressed file adapter backed by the workspace `SQLite` database.
#[derive(Debug, Clone)]
pub(crate) struct SqliteBlobStore {
    workspace_directory: PathBuf,
    database_path: PathBuf,
}

impl SqliteBlobStore {
    /// Creates a Blob adapter rooted in the same default workspace as `SQLite`.
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            workspace_directory: workspace.workspace_directory(),
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, ImportError> {
        if !self.database_path.exists() {
            return Err(ImportError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        fs::create_dir_all(self.workspace_directory.join("blobs"))?;
        fs::create_dir_all(self.workspace_directory.join("staging"))?;
        Ok(connection)
    }

    fn authorize_source(&self, source: &Path) -> Result<AuthorizedSource, ImportError> {
        let canonical = fs::canonicalize(source)?;
        let workspace = fs::canonicalize(&self.workspace_directory)?;
        if canonical.starts_with(workspace) {
            return Err(ImportError::SourceInsideWorkspace);
        }
        let metadata = fs::metadata(&canonical)?;
        if !metadata.is_file() {
            return Err(ImportError::SourceNotFile);
        }
        let original_name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or(ImportError::InvalidFileName)?
            .chars()
            .take(240)
            .collect();
        Ok(AuthorizedSource {
            path: canonical,
            original_name,
            size_bytes: metadata.len(),
        })
    }
}

impl ResourceRepository for SqliteBlobStore {
    fn import_file(
        &self,
        source: &Path,
        request: &ImportRequest,
        canceled: &AtomicBool,
        observe: &mut (dyn FnMut(ImportProgress) + Send),
    ) -> Result<ResourceDocument, ImportError> {
        let mut connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let source = self.authorize_source(source)?;
        let available = fs4::available_space(&self.workspace_directory)?;
        if source
            .size_bytes
            .checked_add(FREE_SPACE_RESERVE_BYTES)
            .is_none_or(|required| required > available)
        {
            return Err(ImportError::InsufficientSpace);
        }

        let mut source_file = File::open(&source.path)?;
        let mut staging = Builder::new()
            .prefix("import-")
            .suffix(".part")
            .tempfile_in(self.workspace_directory.join("staging"))?;
        staging.as_file().allocate(source.size_bytes)?;
        let staging_name = staging
            .path()
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(ImportError::InvalidManagedPath)?;
        let staging_key = staging_key(staging_name)?;

        insert_running_job(&connection, &workspace_id, &source, request, &staging_key)?;
        let (sha256, copied) = stream_source_to_staging(
            &connection,
            &mut source_file,
            &mut staging,
            &source,
            request,
            canceled,
            observe,
        )?;
        staging.as_file_mut().set_len(copied)?;
        staging.as_file_mut().sync_all()?;
        let storage_key = storage_key(&sha256)?;
        connection
            .execute(
                "UPDATE processing_job
                 SET state = 'committing', progress_current = ?2, sha256 = ?3,
                     storage_key = ?4, updated_at = ?5
                 WHERE id = ?1 AND state = 'running'",
                params![
                    request.job_id,
                    to_i64(copied)?,
                    sha256,
                    storage_key,
                    request.created_at
                ],
            )
            .map_err(super::sqlite_workspace::database_error)?;

        let job = ActiveJob {
            id: request.job_id.clone(),
            workspace_id,
            document_id: request.document_id.clone(),
            original_name: source.original_name,
            title: request.title.clone(),
            kind: request.kind.clone(),
            mime_type: request.mime_type.clone(),
            expected_size: copied,
            staging_key,
            sha256: Some(sha256),
            storage_key: Some(storage_key),
            state: "committing".to_owned(),
            created_at: request.created_at,
        };
        let result = complete_live_import(
            &mut connection,
            &self.workspace_directory,
            &job,
            staging.into_temp_path(),
        );
        if let Err(error) = &result
            && !matches!(error, ImportError::Persistence(_))
        {
            mark_job_terminal(&connection, &request.job_id, "failed", error.code())?;
        }
        result
    }

    fn recover_interrupted_imports(&self) -> Result<RecoveryReport, ImportError> {
        if !self.database_path.exists() {
            return Ok(RecoveryReport::default());
        }
        let mut connection = self.open()?;
        let jobs = active_jobs(&connection)?;
        let mut report = RecoveryReport::default();

        for job in jobs {
            if job.state == "running" {
                remove_file_if_present(&staging_path(
                    &self.workspace_directory,
                    &job.staging_key,
                )?)?;
                mark_job_terminal(&connection, &job.id, "interrupted", "IMPORT_INTERRUPTED")?;
                report.interrupted += 1;
                continue;
            }

            match complete_recovered_import(&mut connection, &self.workspace_directory, &job) {
                Ok(_) => report.completed += 1,
                Err(ImportError::IntegrityMismatch | ImportError::InvalidManagedPath) => {
                    remove_file_if_present(&staging_path(
                        &self.workspace_directory,
                        &job.staging_key,
                    )?)?;
                    mark_job_terminal(&connection, &job.id, "failed", "IMPORT_RECOVERY_FAILED")?;
                    report.failed += 1;
                }
                Err(error) => return Err(error),
            }
        }
        Ok(report)
    }

    fn list_resources(&self) -> Result<Vec<ResourceDocument>, ImportError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT d.id, d.title, d.kind, d.mime_type, b.size_bytes,
                        b.sha256, d.role, d.page_count, s.last_page,
                        s.last_opened_at, d.created_at
                 FROM resource_document d
                 JOIN blob b ON b.id = d.blob_id
                 LEFT JOIN resource_reading_state s ON s.document_id = d.id
                 ORDER BY d.created_at DESC, d.id DESC",
            )
            .map_err(super::sqlite_workspace::database_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                    row.get::<_, Option<i64>>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            })
            .map_err(super::sqlite_workspace::database_error)?;
        rows.map(|row| {
            let (
                id,
                title,
                kind,
                mime_type,
                size,
                sha256,
                role,
                page_count,
                last_page,
                last_opened_at,
                created_at,
            ) = row.map_err(super::sqlite_workspace::database_error)?;
            Ok(ResourceDocument {
                id,
                title,
                kind,
                mime_type,
                size_bytes: u64::try_from(size).map_err(|_| ImportError::IntegrityMismatch)?,
                sha256,
                reused_existing_blob: false,
                role,
                page_count: optional_u32(page_count)?,
                last_page: optional_u32(last_page)?,
                last_opened_at,
                created_at,
            })
        })
        .collect()
    }

    fn reader_descriptor(
        &self,
        document_id: &str,
    ) -> Result<ResourceReaderDescriptor, ImportError> {
        let connection = self.open()?;
        load_reader_descriptor(&connection, document_id)
    }

    fn open_readable(&self, document_id: &str) -> Result<ReadableResource, ImportError> {
        let connection = self.open()?;
        let registered = connection
            .query_row(
                "SELECT d.kind, d.mime_type, b.size_bytes, b.sha256, b.storage_key
                 FROM resource_document d
                 JOIN blob b ON b.id = d.blob_id
                 WHERE d.id = ?1 AND b.integrity_state = 'ok'",
                params![document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(super::sqlite_workspace::database_error)?
            .ok_or(ImportError::DocumentNotFound)?;
        if registered.0 != "pdf" && registered.0 != "image" {
            return Err(ImportError::UnsupportedReaderKind);
        }
        validate_storage_key(&registered.3, &registered.4)?;
        let path = blob_path(&self.workspace_directory, &registered.3)?;
        let file = File::open(path)?;
        let size_bytes = u64::try_from(registered.2).map_err(|_| ImportError::IntegrityMismatch)?;
        if file.metadata()?.len() != size_bytes {
            return Err(ImportError::IntegrityMismatch);
        }
        Ok(ReadableResource {
            file,
            mime_type: registered.1,
            size_bytes,
        })
    }

    fn update_role(&self, document_id: &str, role: &str) -> Result<ResourceDocument, ImportError> {
        if !matches!(role, "planning" | "reference" | "workbook" | "other") {
            return Err(ImportError::InvalidMetadata);
        }
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE resource_document
                 SET role = ?2, updated_at = ?3, revision = revision + 1
                 WHERE id = ?1",
                params![document_id, role, current_utc_millis()?],
            )
            .map_err(super::sqlite_workspace::database_error)?;
        if changed == 0 {
            return Err(ImportError::DocumentNotFound);
        }
        load_resource_document(&connection, document_id)
    }

    fn save_reading_progress(
        &self,
        document_id: &str,
        page_count: u32,
        last_page: u32,
    ) -> Result<ResourceReaderDescriptor, ImportError> {
        if page_count == 0 || last_page == 0 || last_page > page_count {
            return Err(ImportError::InvalidMetadata);
        }
        let mut connection = self.open()?;
        let descriptor = load_reader_descriptor(&connection, document_id)?;
        if descriptor.kind != "pdf" {
            return Err(ImportError::UnsupportedReaderKind);
        }
        let workspace_id = load_workspace_id(&connection)?;
        let now = current_utc_millis()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(super::sqlite_workspace::database_error)?;
        transaction
            .execute(
                "UPDATE resource_document
                 SET page_count = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![document_id, i64::from(page_count), now],
            )
            .map_err(super::sqlite_workspace::database_error)?;
        transaction
            .execute(
                "INSERT INTO resource_reading_state(
                    document_id, workspace_id, last_page, last_opened_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?4)
                 ON CONFLICT(document_id) DO UPDATE SET
                    last_page = excluded.last_page,
                    last_opened_at = excluded.last_opened_at,
                    updated_at = excluded.updated_at",
                params![document_id, workspace_id, i64::from(last_page), now],
            )
            .map_err(super::sqlite_workspace::database_error)?;
        transaction
            .commit()
            .map_err(super::sqlite_workspace::database_error)?;
        load_reader_descriptor(&connection, document_id)
    }
}

fn load_reader_descriptor(
    connection: &Connection,
    document_id: &str,
) -> Result<ResourceReaderDescriptor, ImportError> {
    let row = connection
        .query_row(
            "SELECT d.id, d.title, d.kind, d.mime_type, b.size_bytes,
                    d.page_count, s.last_page
             FROM resource_document d
             JOIN blob b ON b.id = d.blob_id
             LEFT JOIN resource_reading_state s ON s.document_id = d.id
             WHERE d.id = ?1 AND b.integrity_state = 'ok'",
            params![document_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                ))
            },
        )
        .optional()
        .map_err(super::sqlite_workspace::database_error)?
        .ok_or(ImportError::DocumentNotFound)?;
    if row.2 != "pdf" && row.2 != "image" {
        return Err(ImportError::UnsupportedReaderKind);
    }
    Ok(ResourceReaderDescriptor {
        document_id: row.0,
        title: row.1,
        kind: row.2,
        mime_type: row.3,
        size_bytes: u64::try_from(row.4).map_err(|_| ImportError::IntegrityMismatch)?,
        page_count: optional_u32(row.5)?,
        last_page: optional_u32(row.6)?,
    })
}

fn load_resource_document(
    connection: &Connection,
    document_id: &str,
) -> Result<ResourceDocument, ImportError> {
    connection
        .query_row(
            "SELECT d.id, d.title, d.kind, d.mime_type, b.size_bytes, b.sha256,
                    d.role, d.page_count, s.last_page, s.last_opened_at, d.created_at
             FROM resource_document d
             JOIN blob b ON b.id = d.blob_id
             LEFT JOIN resource_reading_state s ON s.document_id = d.id
             WHERE d.id = ?1",
            params![document_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                    row.get::<_, Option<i64>>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            },
        )
        .optional()
        .map_err(super::sqlite_workspace::database_error)?
        .ok_or(ImportError::DocumentNotFound)
        .and_then(|row| {
            Ok(ResourceDocument {
                id: row.0,
                title: row.1,
                kind: row.2,
                mime_type: row.3,
                size_bytes: u64::try_from(row.4).map_err(|_| ImportError::IntegrityMismatch)?,
                sha256: row.5,
                reused_existing_blob: false,
                role: row.6,
                page_count: optional_u32(row.7)?,
                last_page: optional_u32(row.8)?,
                last_opened_at: row.9,
                created_at: row.10,
            })
        })
}

fn optional_u32(value: Option<i64>) -> Result<Option<u32>, ImportError> {
    value
        .map(|number| u32::try_from(number).map_err(|_| ImportError::IntegrityMismatch))
        .transpose()
}

fn insert_running_job(
    connection: &Connection,
    workspace_id: &str,
    source: &AuthorizedSource,
    request: &ImportRequest,
    staging_key: &str,
) -> Result<(), ImportError> {
    connection
        .execute(
            "INSERT INTO processing_job(
                id, workspace_id, document_id, job_type, state, original_name,
                title, kind, mime_type, expected_size, progress_current,
                staging_key, created_at, updated_at
             ) VALUES (?1, ?2, ?3, 'import', 'running', ?4, ?5, ?6, ?7, ?8, 0, ?9, ?10, ?10)",
            params![
                request.job_id,
                workspace_id,
                request.document_id,
                source.original_name,
                request.title,
                request.kind,
                request.mime_type,
                to_i64(source.size_bytes)?,
                staging_key,
                request.created_at
            ],
        )
        .map_err(super::sqlite_workspace::database_error)?;
    Ok(())
}

fn stream_source_to_staging(
    connection: &Connection,
    source_file: &mut File,
    staging: &mut NamedTempFile,
    source: &AuthorizedSource,
    request: &ImportRequest,
    canceled: &AtomicBool,
    observe: &mut (dyn FnMut(ImportProgress) + Send),
) -> Result<(String, u64), ImportError> {
    let mut next_persisted_progress = PROGRESS_PERSIST_INTERVAL_BYTES;
    let result = stream_copy_and_hash(
        source_file,
        staging.as_file_mut(),
        source.size_bytes,
        canceled,
        |copied| {
            if copied >= next_persisted_progress || copied == source.size_bytes {
                connection
                    .execute(
                        "UPDATE processing_job
                         SET progress_current = ?2, updated_at = ?3
                         WHERE id = ?1 AND state = 'running'",
                        params![request.job_id, to_i64(copied)?, current_utc_millis()?],
                    )
                    .map_err(super::sqlite_workspace::database_error)?;
                next_persisted_progress = copied.saturating_add(PROGRESS_PERSIST_INTERVAL_BYTES);
            }
            observe(ImportProgress {
                copied_bytes: copied,
                total_bytes: source.size_bytes,
            });
            Ok(())
        },
    );
    match result {
        Ok(result) => Ok(result),
        Err(error) => {
            let (state, code) = if matches!(error, ImportError::Canceled) {
                ("canceled", "IMPORT_CANCELED")
            } else {
                ("failed", error.code())
            };
            mark_job_terminal(connection, &request.job_id, state, code)?;
            Err(error)
        }
    }
}

fn stream_copy_and_hash(
    reader: &mut impl Read,
    writer: &mut impl Write,
    expected_size: u64,
    canceled: &AtomicBool,
    mut on_progress: impl FnMut(u64) -> Result<(), ImportError>,
) -> Result<(String, u64), ImportError> {
    let mut buffer = vec![0_u8; STREAM_BUFFER_BYTES].into_boxed_slice();
    let mut hasher = Sha256::new();
    let mut copied = 0_u64;

    loop {
        if canceled.load(Ordering::Relaxed) {
            return Err(ImportError::Canceled);
        }
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
        hasher.update(&buffer[..read]);
        copied = copied
            .checked_add(u64::try_from(read).map_err(|_| ImportError::IntegrityMismatch)?)
            .ok_or(ImportError::IntegrityMismatch)?;
        on_progress(copied)?;
    }

    if copied != expected_size {
        return Err(ImportError::SourceChanged);
    }
    Ok((format!("{:X}", hasher.finalize()), copied))
}

fn complete_live_import(
    connection: &mut Connection,
    workspace_directory: &Path,
    job: &ActiveJob,
    staging: TempPath,
) -> Result<ResourceDocument, ImportError> {
    let sha256 = job
        .sha256
        .as_deref()
        .ok_or(ImportError::InvalidManagedPath)?;
    let final_path = blob_path(workspace_directory, sha256)?;
    let reused = blob_exists(connection, &job.workspace_id, sha256)?;
    persist_staging(staging, &final_path, sha256, job.expected_size)?;
    commit_job(connection, job, reused)
}

fn complete_recovered_import(
    connection: &mut Connection,
    workspace_directory: &Path,
    job: &ActiveJob,
) -> Result<ResourceDocument, ImportError> {
    let sha256 = job
        .sha256
        .as_deref()
        .ok_or(ImportError::InvalidManagedPath)?;
    let final_path = blob_path(workspace_directory, sha256)?;
    let staging_path = staging_path(workspace_directory, &job.staging_key)?;
    let reused = blob_exists(connection, &job.workspace_id, sha256)?;

    if file_matches(&final_path, sha256, job.expected_size)? {
        remove_file_if_present(&staging_path)?;
    } else if file_matches(&staging_path, sha256, job.expected_size)? {
        if let Some(parent) = final_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&staging_path, &final_path)?;
    } else {
        return Err(ImportError::IntegrityMismatch);
    }
    commit_job(connection, job, reused)
}

fn persist_staging(
    staging: TempPath,
    final_path: &Path,
    sha256: &str,
    size_bytes: u64,
) -> Result<(), ImportError> {
    if file_matches(final_path, sha256, size_bytes)? {
        drop(staging);
        return Ok(());
    }
    if let Some(parent) = final_path.parent() {
        fs::create_dir_all(parent)?;
    }
    match staging.persist_noclobber(final_path) {
        Ok(()) => Ok(()),
        Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
            let staged = error.path;
            if file_matches(final_path, sha256, size_bytes)? {
                drop(staged);
                Ok(())
            } else {
                Err(ImportError::IntegrityMismatch)
            }
        }
        Err(error) => Err(ImportError::File {
            source: error.error,
        }),
    }
}

fn commit_job(
    connection: &mut Connection,
    job: &ActiveJob,
    reused: bool,
) -> Result<ResourceDocument, ImportError> {
    let sha256 = job
        .sha256
        .as_deref()
        .ok_or(ImportError::InvalidManagedPath)?;
    let storage_key = job
        .storage_key
        .as_deref()
        .ok_or(ImportError::InvalidManagedPath)?;
    validate_storage_key(sha256, storage_key)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(super::sqlite_workspace::database_error)?;
    let blob_id = transaction
        .query_row(
            "SELECT id FROM blob WHERE workspace_id = ?1 AND sha256 = ?2",
            params![job.workspace_id, sha256],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(super::sqlite_workspace::database_error)?
        .unwrap_or_else(|| Uuid::now_v7().to_string());
    transaction
        .execute(
            "INSERT INTO blob(id, workspace_id, sha256, size_bytes, storage_key, integrity_state, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'ok', ?6)
             ON CONFLICT(workspace_id, sha256) DO NOTHING",
            params![
                blob_id,
                job.workspace_id,
                sha256,
                to_i64(job.expected_size)?,
                storage_key,
                job.created_at
            ],
        )
        .map_err(super::sqlite_workspace::database_error)?;
    let stored = transaction
        .query_row(
            "SELECT id, size_bytes, storage_key FROM blob
             WHERE workspace_id = ?1 AND sha256 = ?2",
            params![job.workspace_id, sha256],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(super::sqlite_workspace::database_error)?;
    if u64::try_from(stored.1).map_err(|_| ImportError::IntegrityMismatch)? != job.expected_size
        || stored.2 != storage_key
    {
        return Err(ImportError::IntegrityMismatch);
    }
    transaction
        .execute(
            "INSERT INTO resource_document(
                id, workspace_id, blob_id, title, original_name, kind,
                mime_type, created_at, updated_at, revision
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 1)",
            params![
                job.document_id,
                job.workspace_id,
                stored.0,
                job.title,
                job.original_name,
                job.kind,
                job.mime_type,
                job.created_at
            ],
        )
        .map_err(super::sqlite_workspace::database_error)?;
    transaction
        .execute(
            "UPDATE processing_job
             SET state = 'succeeded', error_code = NULL, updated_at = ?2
             WHERE id = ?1 AND state = 'committing'",
            params![job.id, job.created_at],
        )
        .map_err(super::sqlite_workspace::database_error)?;
    transaction
        .commit()
        .map_err(super::sqlite_workspace::database_error)?;
    Ok(ResourceDocument {
        id: job.document_id.clone(),
        title: job.title.clone(),
        kind: job.kind.clone(),
        mime_type: job.mime_type.clone(),
        size_bytes: job.expected_size,
        sha256: sha256.to_owned(),
        reused_existing_blob: reused,
        role: "other".to_owned(),
        page_count: None,
        last_page: None,
        last_opened_at: None,
        created_at: job.created_at,
    })
}

fn active_jobs(connection: &Connection) -> Result<Vec<ActiveJob>, ImportError> {
    let mut statement = connection
        .prepare(
            "SELECT id, workspace_id, document_id, original_name, title, kind,
                    mime_type, expected_size, staging_key, sha256, storage_key,
                    state, created_at
             FROM processing_job
             WHERE state IN ('running', 'committing')
             ORDER BY created_at, id",
        )
        .map_err(super::sqlite_workspace::database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(ActiveJob {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                document_id: row.get(2)?,
                original_name: row.get(3)?,
                title: row.get(4)?,
                kind: row.get(5)?,
                mime_type: row.get(6)?,
                expected_size: u64::try_from(row.get::<_, i64>(7)?).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        7,
                        rusqlite::types::Type::Integer,
                        Box::new(error),
                    )
                })?,
                staging_key: row.get(8)?,
                sha256: row.get(9)?,
                storage_key: row.get(10)?,
                state: row.get(11)?,
                created_at: row.get(12)?,
            })
        })
        .map_err(super::sqlite_workspace::database_error)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(super::sqlite_workspace::database_error)
        .map_err(ImportError::from)
}

fn load_workspace_id(connection: &Connection) -> Result<String, ImportError> {
    connection
        .query_row(
            "SELECT id FROM workspace WHERE singleton_key = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(super::sqlite_workspace::database_error)?
        .ok_or(ImportError::WorkspaceNotInitialized)
}

fn blob_exists(
    connection: &Connection,
    workspace_id: &str,
    sha256: &str,
) -> Result<bool, ImportError> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM blob WHERE workspace_id = ?1 AND sha256 = ?2)",
            params![workspace_id, sha256],
            |row| row.get(0),
        )
        .map_err(super::sqlite_workspace::database_error)
        .map_err(ImportError::from)
}

fn mark_job_terminal(
    connection: &Connection,
    job_id: &str,
    state: &str,
    error_code: &str,
) -> Result<(), ImportError> {
    connection
        .execute(
            "UPDATE processing_job SET state = ?2, error_code = ?3 WHERE id = ?1",
            params![job_id, state, error_code],
        )
        .map_err(super::sqlite_workspace::database_error)?;
    Ok(())
}

fn storage_key(sha256: &str) -> Result<String, ImportError> {
    validate_sha256(sha256)?;
    Ok(format!(
        "blobs/{}/{}/{}.blob",
        &sha256[0..2],
        &sha256[2..4],
        sha256
    ))
}

pub(crate) fn blob_path(workspace_directory: &Path, sha256: &str) -> Result<PathBuf, ImportError> {
    validate_sha256(sha256)?;
    Ok(workspace_directory
        .join("blobs")
        .join(&sha256[0..2])
        .join(&sha256[2..4])
        .join(format!("{sha256}.blob")))
}

fn staging_key(file_name: &str) -> Result<String, ImportError> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || matches!(file_name, "." | "..")
    {
        return Err(ImportError::InvalidManagedPath);
    }
    Ok(format!("staging/{file_name}"))
}

fn staging_path(workspace_directory: &Path, key: &str) -> Result<PathBuf, ImportError> {
    let file_name = key
        .strip_prefix("staging/")
        .ok_or(ImportError::InvalidManagedPath)?;
    if staging_key(file_name)? != key {
        return Err(ImportError::InvalidManagedPath);
    }
    Ok(workspace_directory.join("staging").join(file_name))
}

pub(crate) fn validate_storage_key(sha256: &str, key: &str) -> Result<(), ImportError> {
    if storage_key(sha256)? == key {
        Ok(())
    } else {
        Err(ImportError::InvalidManagedPath)
    }
}

fn validate_sha256(sha256: &str) -> Result<(), ImportError> {
    let valid = sha256.len() == 64
        && sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte));
    if valid {
        Ok(())
    } else {
        Err(ImportError::InvalidManagedPath)
    }
}

fn file_matches(path: &Path, sha256: &str, size_bytes: u64) -> Result<bool, ImportError> {
    if !path.is_file() {
        return Ok(false);
    }
    let mut file = File::open(path)?;
    let actual_size = file.metadata()?.len();
    if actual_size != size_bytes {
        return Ok(false);
    }
    let mut sink = std::io::sink();
    let cancel = AtomicBool::new(false);
    let (actual_hash, _) =
        stream_copy_and_hash(&mut file, &mut sink, size_bytes, &cancel, |_| Ok(()))?;
    Ok(actual_hash == sha256)
}

fn remove_file_if_present(path: &Path) -> Result<(), ImportError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn to_i64(value: u64) -> Result<i64, ImportError> {
    i64::try_from(value).map_err(|_| ImportError::IntegrityMismatch)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Cursor;
    use std::sync::atomic::{AtomicBool, Ordering};

    use rusqlite::{Connection, params};
    use sha2::{Digest, Sha256};
    use tempfile::{TempDir, tempdir};
    use uuid::Uuid;

    use super::{
        SqliteBlobStore, blob_path, staging_key, storage_key, stream_copy_and_hash,
        validate_storage_key,
    };
    use crate::application::{ImportRequest, ResourceRepository, WorkspaceRepository};
    use crate::domain::NewWorkspace;
    use crate::infrastructure::SqliteWorkspaceRepository;

    fn initialized_store() -> (TempDir, SqliteBlobStore, SqliteWorkspaceRepository) {
        let directory = tempdir().expect("temporary application data should exist");
        let workspace = SqliteWorkspaceRepository::new(directory.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let store = SqliteBlobStore::new(directory.path());
        (directory, store, workspace)
    }

    fn request(title: &str) -> ImportRequest {
        ImportRequest {
            job_id: Uuid::now_v7().to_string(),
            document_id: Uuid::now_v7().to_string(),
            title: title.to_owned(),
            kind: "pdf".to_owned(),
            mime_type: "application/pdf".to_owned(),
            created_at: 1_700_000_000_001,
        }
    }

    fn write_source(directory: &TempDir, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = directory.path().join(name);
        fs::write(&path, bytes).expect("source fixture should be written");
        path
    }

    #[test]
    fn storage_key_is_deterministic_and_relative() {
        let sha256 = "ABCD".repeat(16);

        let key = storage_key(&sha256).expect("valid hash should produce a key");

        assert_eq!(key, format!("blobs/AB/CD/{sha256}.blob"));
    }

    #[test]
    fn validate_storage_key_rejects_path_traversal() {
        let sha256 = "A".repeat(64);

        let error = validate_storage_key(&sha256, "../outside.blob")
            .expect_err("path traversal must be rejected");

        assert_eq!(error.code(), "MANAGED_PATH_INVALID");
    }

    #[test]
    fn stream_copy_and_hash_rejects_changed_source_length() {
        let mut source = Cursor::new(b"short".to_vec());
        let mut destination = Vec::new();
        let canceled = AtomicBool::new(false);

        let error = stream_copy_and_hash(&mut source, &mut destination, 10, &canceled, |_| Ok(()))
            .expect_err("changed source must be rejected");

        assert_eq!(error.code(), "SOURCE_CHANGED");
    }

    #[test]
    fn import_file_creates_a_document_and_content_addressed_blob() {
        let (_application_data, store, workspace) = initialized_store();
        let sources = tempdir().expect("source directory should exist");
        let source = write_source(&sources, "chapter.pdf", b"stable-pdf-bytes");
        let request = request("chapter");

        let document = store
            .import_file(&source, &request, &AtomicBool::new(false), &mut |_| {})
            .expect("source should import");

        assert!(
            blob_path(&workspace.workspace_directory(), &document.sha256)
                .expect("blob path should derive")
                .is_file()
        );
    }

    #[test]
    fn importing_equal_content_reuses_one_blob_for_two_documents() {
        let (_application_data, store, workspace) = initialized_store();
        let sources = tempdir().expect("source directory should exist");
        let first = write_source(&sources, "first.pdf", b"same-content");
        let second = write_source(&sources, "second.pdf", b"same-content");

        let first_document = store
            .import_file(
                &first,
                &request("first"),
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .expect("first source should import");
        let second_document = store
            .import_file(
                &second,
                &request("second"),
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .expect("second source should import");
        let connection =
            Connection::open(workspace.database_path()).expect("workspace database should reopen");
        let counts = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM blob),
                        (SELECT COUNT(*) FROM resource_document)",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("resource counts should load");

        assert_eq!(first_document.sha256, second_document.sha256);
        assert_eq!(counts, (1, 2));
        assert!(second_document.reused_existing_blob);
    }

    #[test]
    fn canceled_import_removes_staging_and_does_not_create_a_resource() {
        let (_application_data, store, workspace) = initialized_store();
        let sources = tempdir().expect("source directory should exist");
        let source = write_source(
            &sources,
            "large.pdf",
            &vec![7_u8; super::STREAM_BUFFER_BYTES * 2],
        );
        let request = request("large");
        let canceled = AtomicBool::new(false);

        let error = store
            .import_file(&source, &request, &canceled, &mut |_| {
                canceled.store(true, Ordering::Relaxed);
            })
            .expect_err("import should observe cancellation");
        let connection =
            Connection::open(workspace.database_path()).expect("workspace database should reopen");
        let state: String = connection
            .query_row(
                "SELECT state FROM processing_job WHERE id = ?1",
                [&request.job_id],
                |row| row.get(0),
            )
            .expect("job state should load");
        let resource_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM resource_document", [], |row| {
                row.get(0)
            })
            .expect("resource count should load");
        let staging_count = fs::read_dir(workspace.workspace_directory().join("staging"))
            .expect("staging directory should exist")
            .count();

        assert_eq!(error.code(), "IMPORT_CANCELED");
        assert_eq!(state, "canceled");
        assert_eq!(resource_count, 0);
        assert_eq!(staging_count, 0);
    }

    #[test]
    fn recovery_marks_running_job_interrupted_and_removes_staging() {
        let (_application_data, store, workspace) = initialized_store();
        fs::create_dir_all(workspace.workspace_directory().join("staging"))
            .expect("staging directory should exist");
        let staging_name = "running.part";
        let staging_path = workspace
            .workspace_directory()
            .join("staging")
            .join(staging_name);
        fs::write(&staging_path, b"partial").expect("staging fixture should be written");
        let request = request("running");
        let connection =
            Connection::open(workspace.database_path()).expect("workspace database should reopen");
        let workspace_id: String = connection
            .query_row(
                "SELECT id FROM workspace WHERE singleton_key = 1",
                [],
                |row| row.get(0),
            )
            .expect("workspace id should load");
        connection
            .execute(
                "INSERT INTO processing_job(
                    id, workspace_id, document_id, job_type, state, original_name,
                    title, kind, mime_type, expected_size, progress_current,
                    staging_key, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'import', 'running', 'running.pdf',
                           ?4, 'pdf', 'application/pdf', 7, 7, ?5, ?6, ?6)",
                params![
                    request.job_id,
                    workspace_id,
                    request.document_id,
                    request.title,
                    staging_key(staging_name).expect("staging key should derive"),
                    request.created_at
                ],
            )
            .expect("running job fixture should insert");

        let report = store
            .recover_interrupted_imports()
            .expect("running job should recover");
        let state: String = connection
            .query_row(
                "SELECT state FROM processing_job WHERE id = ?1",
                [&request.job_id],
                |row| row.get(0),
            )
            .expect("job state should load");

        assert_eq!(report.interrupted, 1);
        assert_eq!(state, "interrupted");
        assert!(!staging_path.exists());
    }

    #[test]
    fn recovery_commits_verified_staging_bytes() {
        let (_application_data, store, workspace) = initialized_store();
        fs::create_dir_all(workspace.workspace_directory().join("staging"))
            .expect("staging directory should exist");
        let bytes = b"recoverable-content";
        let sha256 = format!("{:X}", Sha256::digest(bytes));
        let staging_name = "committing.part";
        let staging_path = workspace
            .workspace_directory()
            .join("staging")
            .join(staging_name);
        fs::write(&staging_path, bytes).expect("staging fixture should be written");
        let request = request("committing");
        let connection =
            Connection::open(workspace.database_path()).expect("workspace database should reopen");
        let workspace_id: String = connection
            .query_row(
                "SELECT id FROM workspace WHERE singleton_key = 1",
                [],
                |row| row.get(0),
            )
            .expect("workspace id should load");
        connection
            .execute(
                "INSERT INTO processing_job(
                    id, workspace_id, document_id, job_type, state, original_name,
                    title, kind, mime_type, expected_size, progress_current,
                    staging_key, sha256, storage_key, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, 'import', 'committing', 'committing.pdf',
                           ?4, 'pdf', 'application/pdf', ?5, ?5, ?6, ?7, ?8, ?9, ?9)",
                params![
                    request.job_id,
                    workspace_id,
                    request.document_id,
                    request.title,
                    i64::try_from(bytes.len()).expect("fixture length should fit"),
                    staging_key(staging_name).expect("staging key should derive"),
                    sha256,
                    storage_key(&sha256).expect("storage key should derive"),
                    request.created_at
                ],
            )
            .expect("committing job fixture should insert");

        let report = store
            .recover_interrupted_imports()
            .expect("committing job should recover");
        let state: String = connection
            .query_row(
                "SELECT state FROM processing_job WHERE id = ?1",
                [&request.job_id],
                |row| row.get(0),
            )
            .expect("job state should load");

        assert_eq!(report.completed, 1);
        assert_eq!(state, "succeeded");
        assert_eq!(
            store.list_resources().expect("resources should load").len(),
            1
        );
        assert!(!staging_path.exists());
    }

    #[test]
    fn import_rejects_sources_inside_the_managed_workspace() {
        let (_application_data, store, workspace) = initialized_store();
        let source = workspace.workspace_directory().join("inside.pdf");
        fs::write(&source, b"inside").expect("inside source fixture should be written");

        let error = store
            .import_file(
                &source,
                &request("inside"),
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .expect_err("managed source must be rejected");

        assert_eq!(error.code(), "SOURCE_INSIDE_WORKSPACE");
    }

    #[test]
    fn import_does_not_overwrite_a_corrupted_existing_blob() {
        let (_application_data, store, workspace) = initialized_store();
        let sources = tempdir().expect("source directory should exist");
        let first = write_source(&sources, "first.pdf", b"trusted-content");
        let second = write_source(&sources, "second.pdf", b"trusted-content");
        let first_document = store
            .import_file(
                &first,
                &request("first"),
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .expect("first source should import");
        let final_path = blob_path(&workspace.workspace_directory(), &first_document.sha256)
            .expect("blob path should derive");
        fs::write(&final_path, b"corrupted").expect("blob fixture should be corrupted");
        let second_request = request("second");

        let error = store
            .import_file(
                &second,
                &second_request,
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .expect_err("corrupted managed blob must block replacement");
        let connection =
            Connection::open(workspace.database_path()).expect("workspace database should reopen");
        let state: String = connection
            .query_row(
                "SELECT state FROM processing_job WHERE id = ?1",
                [&second_request.job_id],
                |row| row.get(0),
            )
            .expect("job state should load");

        assert_eq!(error.code(), "FILE_INTEGRITY_MISMATCH");
        assert_eq!(state, "failed");
        assert_eq!(
            fs::read(final_path).expect("corrupted blob should remain"),
            b"corrupted"
        );
    }
}
