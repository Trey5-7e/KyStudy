use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};

use crate::application::{QuestionError, QuestionRepository, ValidatedQuestionUpdate};
use crate::domain::{
    AttemptResult, Question, QuestionAttempt, QuestionBundle, QuestionKnowledgeLink, QuestionRegion,
};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

/// `SQLite` adapter for workbook questions, regions, and immutable attempts.
#[derive(Debug, Clone)]
pub(crate) struct SqliteQuestionRepository {
    database_path: PathBuf,
}

impl SqliteQuestionRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, QuestionError> {
        if !self.database_path.exists() {
            return Err(QuestionError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl QuestionRepository for SqliteQuestionRepository {
    fn list_for_document(&self, document_id: &str) -> Result<Vec<QuestionBundle>, QuestionError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        ensure_workbook(&connection, document_id)?;
        let ids = list_question_ids(
            &connection,
            "document_id = ?1 AND deleted_at IS NULL",
            document_id,
        )?;
        ids.iter().map(|id| load_bundle(&connection, id)).collect()
    }

    fn list_trashed(&self) -> Result<Vec<QuestionBundle>, QuestionError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id FROM question WHERE deleted_at IS NOT NULL
                 ORDER BY deleted_at DESC, id DESC",
            )
            .map_err(database_error)?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(database_error)?
            .map(|row| row.map_err(database_error))
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter().map(|id| load_bundle(&connection, id)).collect()
    }

    fn create_question(
        &self,
        mut question: Question,
        region: QuestionRegion,
        knowledge_node_ids: &[String],
    ) -> Result<QuestionBundle, QuestionError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let workspace_id = load_workspace_id(&transaction)?;
        let (document_title, page_count) = ensure_workbook(&transaction, &question.document_id)?;
        validate_region_document(&region, &question.document_id, page_count)?;
        validate_knowledge_nodes(&transaction, knowledge_node_ids)?;
        question.document_title = document_title;
        insert_question(&transaction, &workspace_id, &question)?;
        insert_region(&transaction, &region)?;
        replace_knowledge_links(
            &transaction,
            &question.id,
            knowledge_node_ids,
            question.created_at,
        )?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &question.id)
    }

    fn update_question(
        &self,
        update: &ValidatedQuestionUpdate,
    ) -> Result<QuestionBundle, QuestionError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        ensure_active_question(&transaction, &update.question_id)?;
        validate_knowledge_nodes(&transaction, &update.knowledge_node_ids)?;
        transaction
            .execute(
                "UPDATE question
                 SET title = ?2, chapter = ?3, question_number = ?4,
                     difficulty = ?5, analysis_markdown = ?6, updated_at = ?7
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![
                    update.question_id,
                    update.title,
                    update.chapter,
                    update.question_number,
                    i64::from(update.difficulty),
                    update.analysis_markdown,
                    update.updated_at
                ],
            )
            .map_err(database_error)?;
        replace_knowledge_links(
            &transaction,
            &update.question_id,
            &update.knowledge_node_ids,
            update.updated_at,
        )?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &update.question_id)
    }

    fn add_region(&self, mut region: QuestionRegion) -> Result<QuestionBundle, QuestionError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let (document_id, page_count) =
            load_active_question_document(&transaction, &region.question_id)?;
        region.document_id.clone_from(&document_id);
        validate_region_document(&region, &document_id, page_count)?;
        let count: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM question_region WHERE question_id = ?1",
                params![region.question_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        region.sort_order = u32::try_from(count).map_err(|_| QuestionError::InvalidRegion)?;
        insert_region(&transaction, &region)?;
        touch_question(&transaction, &region.question_id, region.created_at)?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &region.question_id)
    }

    fn delete_region(
        &self,
        region_id: &str,
        updated_at: i64,
    ) -> Result<QuestionBundle, QuestionError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let question_id = transaction
            .query_row(
                "SELECT question_id FROM question_region WHERE id = ?1",
                params![region_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(QuestionError::RegionNotFound)?;
        ensure_active_question(&transaction, &question_id)?;
        let count: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM question_region WHERE question_id = ?1",
                params![question_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if count <= 1 {
            return Err(QuestionError::LastRegionProtected);
        }
        transaction
            .execute(
                "DELETE FROM question_region WHERE id = ?1",
                params![region_id],
            )
            .map_err(database_error)?;
        normalize_regions(&transaction, &question_id)?;
        touch_question(&transaction, &question_id, updated_at)?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &question_id)
    }

    fn add_attempt(
        &self,
        attempt: QuestionAttempt,
        attempted_on: &crate::domain::LocalDate,
    ) -> Result<QuestionBundle, QuestionError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        ensure_active_question(&transaction, &attempt.question_id)?;
        transaction
            .execute(
                "INSERT INTO question_attempt(
                    id, question_id, result, attempted_at,
                    duration_seconds, answer_note, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    attempt.id,
                    attempt.question_id,
                    attempt.result.as_str(),
                    attempt.attempted_at,
                    attempt.duration_seconds.map(i64::from),
                    attempt.answer_note,
                    attempt.created_at
                ],
            )
            .map_err(database_error)?;
        if attempt.result == AttemptResult::Incorrect {
            activate_incorrect_attempt(
                &transaction,
                &attempt.question_id,
                attempted_on,
                attempt.attempted_at,
            )?;
        }
        touch_question(&transaction, &attempt.question_id, attempt.created_at)?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &attempt.question_id)
    }

    fn trash_question(&self, question_id: &str, deleted_at: i64) -> Result<(), QuestionError> {
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE question SET deleted_at = ?2, updated_at = ?2
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![question_id, deleted_at],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(QuestionError::QuestionNotFound);
        }
        Ok(())
    }

    fn restore_question(
        &self,
        question_id: &str,
        updated_at: i64,
    ) -> Result<QuestionBundle, QuestionError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let document_id = transaction
            .query_row(
                "SELECT document_id FROM question
                 WHERE id = ?1 AND deleted_at IS NOT NULL",
                params![question_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(QuestionError::QuestionNotFound)?;
        ensure_workbook(&transaction, &document_id)?;
        let changed = transaction
            .execute(
                "UPDATE question SET deleted_at = NULL, updated_at = ?2
                  WHERE id = ?1 AND deleted_at IS NOT NULL",
                params![question_id, updated_at],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(QuestionError::QuestionNotFound);
        }
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, question_id)
    }
}

fn activate_incorrect_attempt(
    transaction: &Transaction<'_>,
    question_id: &str,
    attempted_on: &crate::domain::LocalDate,
    attempted_at: i64,
) -> Result<(), QuestionError> {
    transaction
        .execute(
            "INSERT INTO mistake_profile(
                question_id, first_mistake_at, last_mistake_at, mistake_count,
                consecutive_failure_count, active, user_priority, created_at, updated_at
             ) VALUES (?1, ?2, ?2, 1, 0, 1, 3, ?2, ?2)
             ON CONFLICT(question_id) DO UPDATE SET
                first_mistake_at = COALESCE(mistake_profile.first_mistake_at, excluded.first_mistake_at),
                last_mistake_at = excluded.last_mistake_at,
                mistake_count = mistake_profile.mistake_count + 1,
                active = 1,
                updated_at = excluded.updated_at",
            params![question_id, attempted_at],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "INSERT INTO review_state(
                question_id, policy_version, mastery_level, due_date,
                last_reviewed_at, successful_streak, manual_pin_date, suspended_at,
                created_at, updated_at
             ) VALUES (?1, 1, 'learning', ?2, NULL, 0, NULL, NULL, ?3, ?3)
             ON CONFLICT(question_id) DO UPDATE SET
                mastery_level = 'learning',
                due_date = MIN(review_state.due_date, excluded.due_date),
                successful_streak = 0,
                suspended_at = NULL,
                updated_at = excluded.updated_at",
            params![question_id, attempted_on.as_str(), attempted_at],
        )
        .map_err(database_error)?;
    Ok(())
}

fn list_question_ids(
    connection: &Connection,
    predicate: &str,
    document_id: &str,
) -> Result<Vec<String>, QuestionError> {
    let sql =
        format!("SELECT id FROM question WHERE {predicate} ORDER BY updated_at DESC, id DESC");
    let mut statement = connection.prepare(&sql).map_err(database_error)?;
    statement
        .query_map(params![document_id], |row| row.get::<_, String>(0))
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(QuestionError::from))
        .collect()
}

fn insert_question(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    question: &Question,
) -> Result<(), QuestionError> {
    transaction
        .execute(
            "INSERT INTO question(
                id, workspace_id, document_id, title, chapter, question_number,
                difficulty, analysis_markdown, deleted_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?9)",
            params![
                question.id,
                workspace_id,
                question.document_id,
                question.title,
                question.chapter,
                question.number_label,
                i64::from(question.difficulty),
                question.analysis_markdown,
                question.created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_region(
    transaction: &Transaction<'_>,
    region: &QuestionRegion,
) -> Result<(), QuestionError> {
    transaction
        .execute(
            "INSERT INTO question_region(
                id, question_id, document_id, page_number, x, y, width, height,
                coordinate_version, sort_order, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10)",
            params![
                region.id,
                region.question_id,
                region.document_id,
                i64::from(region.page_number),
                region.x,
                region.y,
                region.width,
                region.height,
                i64::from(region.sort_order),
                region.created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn replace_knowledge_links(
    transaction: &Transaction<'_>,
    question_id: &str,
    node_ids: &[String],
    created_at: i64,
) -> Result<(), QuestionError> {
    transaction
        .execute(
            "DELETE FROM question_knowledge_node WHERE question_id = ?1",
            params![question_id],
        )
        .map_err(database_error)?;
    for node_id in node_ids {
        transaction
            .execute(
                "INSERT INTO question_knowledge_node(question_id, node_id, created_at)
                 VALUES (?1, ?2, ?3)",
                params![question_id, node_id, created_at],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn validate_knowledge_nodes(
    connection: &Connection,
    node_ids: &[String],
) -> Result<(), QuestionError> {
    for node_id in node_ids {
        let exists: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM knowledge_node n
                    JOIN knowledge_map m ON m.id = n.map_id
                    WHERE n.id = ?1 AND m.deleted_at IS NULL
                 )",
                params![node_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if !exists {
            return Err(QuestionError::InvalidKnowledgeLink);
        }
    }
    Ok(())
}

fn validate_region_document(
    region: &QuestionRegion,
    document_id: &str,
    page_count: Option<i64>,
) -> Result<(), QuestionError> {
    let in_bounds = region.coordinate_version == 1
        && region.document_id == document_id
        && region.page_number > 0
        && [region.x, region.y, region.width, region.height]
            .iter()
            .all(|value| value.is_finite())
        && region.x >= 0.0
        && region.y >= 0.0
        && region.width > 0.0
        && region.height > 0.0
        && region.x + region.width <= 1.000_001
        && region.y + region.height <= 1.000_001
        && page_count.is_none_or(|count| i64::from(region.page_number) <= count);
    if in_bounds {
        Ok(())
    } else {
        Err(QuestionError::InvalidRegion)
    }
}

fn ensure_workbook(
    connection: &Connection,
    document_id: &str,
) -> Result<(String, Option<i64>), QuestionError> {
    connection
        .query_row(
            "SELECT title, page_count FROM resource_document
             WHERE id = ?1 AND kind = 'pdf' AND role = 'workbook'",
            params![document_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionError::WorkbookNotFound)
}

fn load_active_question_document(
    connection: &Connection,
    question_id: &str,
) -> Result<(String, Option<i64>), QuestionError> {
    connection
        .query_row(
            "SELECT q.document_id, d.page_count FROM question q
             JOIN resource_document d ON d.id = q.document_id
             WHERE q.id = ?1 AND q.deleted_at IS NULL
               AND d.kind = 'pdf' AND d.role = 'workbook'",
            params![question_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionError::QuestionNotFound)
}

fn ensure_active_question(connection: &Connection, question_id: &str) -> Result<(), QuestionError> {
    let document_id = connection
        .query_row(
            "SELECT document_id FROM question WHERE id = ?1 AND deleted_at IS NULL",
            params![question_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionError::QuestionNotFound)?;
    ensure_workbook(connection, &document_id).map(|_| ())
}

fn load_workspace_id(connection: &Connection) -> Result<String, QuestionError> {
    connection
        .query_row(
            "SELECT id FROM workspace ORDER BY created_at LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionError::WorkspaceNotInitialized)
}

fn touch_question(
    transaction: &Transaction<'_>,
    question_id: &str,
    updated_at: i64,
) -> Result<(), QuestionError> {
    transaction
        .execute(
            "UPDATE question SET updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
            params![question_id, updated_at],
        )
        .map_err(database_error)?;
    Ok(())
}

fn normalize_regions(
    transaction: &Transaction<'_>,
    question_id: &str,
) -> Result<(), QuestionError> {
    let mut statement = transaction
        .prepare("SELECT id FROM question_region WHERE question_id = ?1 ORDER BY sort_order, id")
        .map_err(database_error)?;
    let ids = statement
        .query_map(params![question_id], |row| row.get::<_, String>(0))
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    for (index, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE question_region SET sort_order = ?2 WHERE id = ?1",
                params![
                    id,
                    i64::try_from(index).map_err(|_| QuestionError::InvalidRegion)?
                ],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

pub(super) fn load_bundle(
    connection: &Connection,
    question_id: &str,
) -> Result<QuestionBundle, QuestionError> {
    Ok(QuestionBundle {
        question: load_question(connection, question_id)?,
        regions: load_regions(connection, question_id)?,
        attempts: load_attempts(connection, question_id)?,
        knowledge_links: load_knowledge_links(connection, question_id)?,
    })
}

fn load_question(connection: &Connection, question_id: &str) -> Result<Question, QuestionError> {
    connection
        .query_row(
            "SELECT q.id, q.document_id, d.title, q.title, q.chapter,
                    q.question_number, q.difficulty, q.analysis_markdown,
                    q.deleted_at, q.created_at, q.updated_at
             FROM question q JOIN resource_document d ON d.id = q.document_id
             WHERE q.id = ?1",
            params![question_id],
            |row| {
                Ok(Question {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    document_title: row.get(2)?,
                    title: row.get(3)?,
                    chapter: row.get(4)?,
                    number_label: row.get(5)?,
                    difficulty: to_u8(row.get::<_, i64>(6)?, 6)?,
                    analysis_markdown: row.get(7)?,
                    deleted_at: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionError::QuestionNotFound)
}

fn load_regions(
    connection: &Connection,
    question_id: &str,
) -> Result<Vec<QuestionRegion>, QuestionError> {
    let mut statement = connection
        .prepare(
            "SELECT id, question_id, document_id, page_number, x, y, width, height,
                    coordinate_version, sort_order, created_at
             FROM question_region WHERE question_id = ?1 ORDER BY sort_order, id",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![question_id], |row| {
            Ok(QuestionRegion {
                id: row.get(0)?,
                question_id: row.get(1)?,
                document_id: row.get(2)?,
                page_number: to_u32(row.get::<_, i64>(3)?, 3)?,
                x: row.get(4)?,
                y: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                coordinate_version: to_u8(row.get::<_, i64>(8)?, 8)?,
                sort_order: to_u32(row.get::<_, i64>(9)?, 9)?,
                created_at: row.get(10)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(QuestionError::from))
        .collect()
}

fn load_attempts(
    connection: &Connection,
    question_id: &str,
) -> Result<Vec<QuestionAttempt>, QuestionError> {
    let mut statement = connection
        .prepare(
            "SELECT id, question_id, result, attempted_at,
                    duration_seconds, answer_note, created_at
             FROM question_attempt WHERE question_id = ?1
             ORDER BY attempted_at DESC, id DESC",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![question_id], |row| {
            let result = row.get::<_, String>(2)?;
            Ok(QuestionAttempt {
                id: row.get(0)?,
                question_id: row.get(1)?,
                result: AttemptResult::parse(&result)
                    .ok_or_else(|| conversion_error(2, "invalid attempt result"))?,
                attempted_at: row.get(3)?,
                duration_seconds: optional_u32(row.get::<_, Option<i64>>(4)?, 4)?,
                answer_note: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(QuestionError::from))
        .collect()
}

fn load_knowledge_links(
    connection: &Connection,
    question_id: &str,
) -> Result<Vec<QuestionKnowledgeLink>, QuestionError> {
    let mut statement = connection
        .prepare(
            "SELECT n.id, n.title, m.id, m.title
             FROM question_knowledge_node qn
             JOIN knowledge_node n ON n.id = qn.node_id
             JOIN knowledge_map m ON m.id = n.map_id
             WHERE qn.question_id = ?1
             ORDER BY m.title, n.title, n.id",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![question_id], |row| {
            Ok(QuestionKnowledgeLink {
                node_id: row.get(0)?,
                node_title: row.get(1)?,
                map_id: row.get(2)?,
                map_title: row.get(3)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(QuestionError::from))
        .collect()
}

fn to_u32(value: i64, column: usize) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|_| conversion_error(column, "integer is outside u32"))
}

fn optional_u32(value: Option<i64>, column: usize) -> rusqlite::Result<Option<u32>> {
    value.map(|value| to_u32(value, column)).transpose()
}

fn to_u8(value: i64, column: usize) -> rusqlite::Result<u8> {
    u8::try_from(value).map_err(|_| conversion_error(column, "integer is outside u8"))
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

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use tempfile::tempdir;
    use uuid::Uuid;

    use super::*;
    use crate::application::{
        AddQuestionAttemptInput, AddQuestionRegionInput, CreateQuestionInput, ImportRequest,
        QuestionRegionInput, QuestionUseCases, ResourceRepository, WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{SqliteBlobStore, SqliteWorkspaceRepository};

    fn region(page_number: u32) -> QuestionRegionInput {
        QuestionRegionInput {
            page_number,
            x: 0.2,
            y: 0.3,
            width: 0.5,
            height: 0.2,
        }
    }

    fn incorrect_attempt(question_id: &str) -> AddQuestionAttemptInput {
        AddQuestionAttemptInput {
            question_id: question_id.to_owned(),
            result: "incorrect".to_owned(),
            attempted_on: "2026-07-19".to_owned(),
            duration_seconds: Some(300),
            answer_note: Some("边界条件遗漏".to_owned()),
        }
    }

    #[test]
    fn question_regions_attempts_and_trash_round_trip() {
        let directory = tempdir().expect("temporary directory should exist");
        let workspace = SqliteWorkspaceRepository::new(directory.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let source = directory.path().join("workbook.pdf");
        std::fs::write(&source, b"question-fixture").expect("fixture should write");
        let resources = SqliteBlobStore::new(directory.path());
        let document = resources
            .import_file(
                &source,
                &ImportRequest {
                    job_id: Uuid::now_v7().to_string(),
                    document_id: Uuid::now_v7().to_string(),
                    title: "习题册".to_owned(),
                    kind: "pdf".to_owned(),
                    mime_type: "application/pdf".to_owned(),
                    created_at: 1_700_000_000_001,
                },
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .expect("workbook should import");
        resources
            .update_role(&document.id, "workbook")
            .expect("workbook role should persist");
        resources
            .save_reading_progress(&document.id, 3, 1)
            .expect("known page count should persist");
        let use_cases = QuestionUseCases::new(SqliteQuestionRepository::new(directory.path()));
        let created = use_cases
            .create_question(CreateQuestionInput {
                document_id: document.id,
                title: "线性表综合题".to_owned(),
                chapter: Some("数据结构".to_owned()),
                question_number: Some("1".to_owned()),
                difficulty: 4,
                analysis_markdown: None,
                region: QuestionRegionInput {
                    page_number: 1,
                    x: 0.1,
                    y: 0.2,
                    width: 0.4,
                    height: 0.2,
                },
                knowledge_node_ids: Vec::new(),
            })
            .expect("question should create");
        let with_region = use_cases
            .add_region(AddQuestionRegionInput {
                question_id: created.question.id.clone(),
                region: region(2),
            })
            .expect("second region should create");
        let practiced = use_cases
            .add_attempt(incorrect_attempt(&created.question.id))
            .expect("attempt should create");
        let out_of_bounds = use_cases.add_region(AddQuestionRegionInput {
            question_id: created.question.id.clone(),
            region: region(4),
        });
        assert_eq!(with_region.regions.len(), 2);
        assert_eq!(practiced.attempts.len(), 1);
        assert!(matches!(out_of_bounds, Err(QuestionError::InvalidRegion)));
        let one_region = use_cases
            .delete_region(&with_region.regions[1].id)
            .expect("second region should delete");
        let last_region = use_cases.delete_region(&one_region.regions[0].id);
        assert!(matches!(
            last_region,
            Err(QuestionError::LastRegionProtected)
        ));

        use_cases
            .trash_question(&created.question.id)
            .expect("question should trash");
        assert!(
            use_cases
                .list_for_document(&created.question.document_id)
                .expect("active questions should list")
                .is_empty()
        );
        resources
            .update_role(&created.question.document_id, "reference")
            .expect("workbook role should change");
        assert!(matches!(
            use_cases.restore_question(&created.question.id),
            Err(QuestionError::WorkbookNotFound)
        ));
        resources
            .update_role(&created.question.document_id, "workbook")
            .expect("workbook role should restore");
        let restored = use_cases
            .restore_question(&created.question.id)
            .expect("question should restore");
        assert_eq!(restored.question.title, "线性表综合题");
    }
}
