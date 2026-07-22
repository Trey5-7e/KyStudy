use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};

use crate::application::{OcrError, OcrRegionSource, OcrRepository};
use crate::domain::{OcrRecognition, OcrRecognitionState, OcrTextLine};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

/// `SQLite` persistence for OCR drafts and user-confirmed question-region text.
#[derive(Debug, Clone)]
pub(crate) struct SqliteOcrRepository {
    database_path: PathBuf,
}

impl SqliteOcrRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, OcrError> {
        if !self.database_path.exists() {
            return Err(OcrError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl OcrRepository for SqliteOcrRepository {
    fn find_active_region(&self, region_id: &str) -> Result<OcrRegionSource, OcrError> {
        let connection = self.open()?;
        connection
            .query_row(
                "SELECT r.question_id, r.id, r.page_number
                 FROM question_region r
                 JOIN question q ON q.id = r.question_id
                 WHERE r.id = ?1 AND q.deleted_at IS NULL",
                [region_id],
                |row| {
                    Ok(OcrRegionSource {
                        question_id: row.get(0)?,
                        region_id: row.get(1)?,
                        page_number: to_u32(row.get(2)?, 2)?,
                    })
                },
            )
            .optional()
            .map_err(database_error)?
            .ok_or(OcrError::RegionNotFound)
    }

    fn list_current(&self, question_id: &str) -> Result<Vec<OcrRecognition>, OcrError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        ensure_active_question(&connection, question_id)?;
        let mut statement = connection
            .prepare(
                "SELECT o.id
                 FROM question_region_ocr o
                 JOIN question_region r ON r.id = o.region_id
                 WHERE r.question_id = ?1 AND o.state IN ('draft', 'confirmed')
                 ORDER BY r.sort_order,
                          CASE o.state WHEN 'draft' THEN 0 ELSE 1 END,
                          o.updated_at DESC, o.id DESC",
            )
            .map_err(database_error)?;
        let ids = statement
            .query_map([question_id], |row| row.get::<_, String>(0))
            .map_err(database_error)?
            .map(|row| row.map_err(database_error))
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter()
            .map(|id| load_recognition(&connection, id))
            .collect()
    }

    fn replace_draft(&self, recognition: OcrRecognition) -> Result<OcrRecognition, OcrError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let source = load_active_region(&transaction, &recognition.region_id)?;
        if source.question_id != recognition.question_id
            || source.page_number != recognition.page_number
            || recognition.state != OcrRecognitionState::Draft
            || recognition.confirmed_text.is_some()
        {
            return Err(OcrError::ResultInvalid);
        }
        transaction
            .execute(
                "DELETE FROM question_region_ocr
                 WHERE region_id = ?1 AND state = 'draft'",
                [recognition.region_id.as_str()],
            )
            .map_err(database_error)?;
        insert_recognition(&transaction, &recognition)?;
        insert_lines(&transaction, &recognition.lines)?;
        transaction.commit().map_err(database_error)?;
        load_recognition(&connection, &recognition.id)
    }

    fn confirm_draft(
        &self,
        recognition_id: &str,
        confirmed_text: &str,
        updated_at: i64,
    ) -> Result<OcrRecognition, OcrError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let (region_id, state) = transaction
            .query_row(
                "SELECT o.region_id, o.state
                 FROM question_region_ocr o
                 JOIN question_region r ON r.id = o.region_id
                 JOIN question q ON q.id = r.question_id
                 WHERE o.id = ?1 AND q.deleted_at IS NULL",
                [recognition_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(OcrError::RecognitionNotFound)?;
        if state != OcrRecognitionState::Draft.as_str() {
            return Err(OcrError::RecognitionNotDraft);
        }
        transaction
            .execute(
                "UPDATE question_region_ocr
                 SET state = 'superseded', updated_at = ?2
                 WHERE region_id = ?1 AND state = 'confirmed'",
                params![region_id, updated_at],
            )
            .map_err(database_error)?;
        let changed = transaction
            .execute(
                "UPDATE question_region_ocr
                 SET state = 'confirmed', confirmed_text = ?2, updated_at = ?3
                 WHERE id = ?1 AND state = 'draft'",
                params![recognition_id, confirmed_text, updated_at],
            )
            .map_err(database_error)?;
        if changed != 1 {
            return Err(OcrError::RecognitionNotFound);
        }
        transaction.commit().map_err(database_error)?;
        load_recognition(&connection, recognition_id)
    }

    fn discard_draft(&self, recognition_id: &str) -> Result<(), OcrError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let state = transaction
            .query_row(
                "SELECT o.state
                 FROM question_region_ocr o
                 JOIN question_region r ON r.id = o.region_id
                 JOIN question q ON q.id = r.question_id
                 WHERE o.id = ?1 AND q.deleted_at IS NULL",
                [recognition_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(OcrError::RecognitionNotFound)?;
        if state != OcrRecognitionState::Draft.as_str() {
            return Err(OcrError::RecognitionNotDraft);
        }
        transaction
            .execute(
                "DELETE FROM question_region_ocr WHERE id = ?1 AND state = 'draft'",
                [recognition_id],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }
}

fn ensure_active_question(connection: &Connection, question_id: &str) -> Result<(), OcrError> {
    let found = connection
        .query_row(
            "SELECT 1 FROM question WHERE id = ?1 AND deleted_at IS NULL",
            [question_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(database_error)?;
    found.ok_or(OcrError::QuestionNotFound)
}

fn load_active_region(
    connection: &Connection,
    region_id: &str,
) -> Result<OcrRegionSource, OcrError> {
    connection
        .query_row(
            "SELECT r.question_id, r.id, r.page_number
             FROM question_region r
             JOIN question q ON q.id = r.question_id
             WHERE r.id = ?1 AND q.deleted_at IS NULL",
            [region_id],
            |row| {
                Ok(OcrRegionSource {
                    question_id: row.get(0)?,
                    region_id: row.get(1)?,
                    page_number: to_u32(row.get(2)?, 2)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(OcrError::RegionNotFound)
}

fn insert_recognition(
    transaction: &Transaction<'_>,
    recognition: &OcrRecognition,
) -> Result<(), OcrError> {
    transaction
        .execute(
            "INSERT INTO question_region_ocr(
                id, region_id, engine, recognized_text, confirmed_text,
                mean_confidence, state, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                recognition.id,
                recognition.region_id,
                recognition.engine,
                recognition.recognized_text,
                recognition.confirmed_text,
                recognition.mean_confidence,
                recognition.state.as_str(),
                recognition.created_at,
                recognition.updated_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_lines(transaction: &Transaction<'_>, lines: &[OcrTextLine]) -> Result<(), OcrError> {
    for line in lines {
        transaction
            .execute(
                "INSERT INTO question_region_ocr_line(
                    id, recognition_id, text, confidence,
                    x, y, width, height, sort_order
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    line.id,
                    line.recognition_id,
                    line.text,
                    line.confidence,
                    line.x,
                    line.y,
                    line.width,
                    line.height,
                    i64::from(line.sort_order),
                ],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn load_recognition(
    connection: &Connection,
    recognition_id: &str,
) -> Result<OcrRecognition, OcrError> {
    let mut recognition = connection
        .query_row(
            "SELECT o.id, r.question_id, o.region_id, r.page_number,
                    o.engine, o.recognized_text, o.confirmed_text,
                    o.mean_confidence, o.state, o.created_at, o.updated_at
             FROM question_region_ocr o
             JOIN question_region r ON r.id = o.region_id
             WHERE o.id = ?1",
            [recognition_id],
            |row| {
                let state = row.get::<_, String>(8)?;
                Ok(OcrRecognition {
                    id: row.get(0)?,
                    question_id: row.get(1)?,
                    region_id: row.get(2)?,
                    page_number: to_u32(row.get(3)?, 3)?,
                    engine: row.get(4)?,
                    recognized_text: row.get(5)?,
                    confirmed_text: row.get(6)?,
                    mean_confidence: row.get(7)?,
                    state: OcrRecognitionState::parse(&state).ok_or_else(|| {
                        conversion_error(8, "OCR state is outside the known lifecycle")
                    })?,
                    lines: Vec::new(),
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(OcrError::RecognitionNotFound)?;
    recognition.lines = load_lines(connection, recognition_id)?;
    Ok(recognition)
}

fn load_lines(connection: &Connection, recognition_id: &str) -> Result<Vec<OcrTextLine>, OcrError> {
    let mut statement = connection
        .prepare(
            "SELECT id, recognition_id, text, confidence,
                    x, y, width, height, sort_order
             FROM question_region_ocr_line
             WHERE recognition_id = ?1 ORDER BY sort_order, id",
        )
        .map_err(database_error)?;
    let lines = statement
        .query_map([recognition_id], |row| {
            Ok(OcrTextLine {
                id: row.get(0)?,
                recognition_id: row.get(1)?,
                text: row.get(2)?,
                confidence: row.get(3)?,
                x: row.get(4)?,
                y: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                sort_order: to_u32(row.get(8)?, 8)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(lines)
}

fn to_u32(value: i64, column: usize) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|_| conversion_error(column, "integer is outside u32"))
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

    use tempfile::{TempDir, tempdir};
    use uuid::Uuid;

    use super::*;
    use crate::application::{
        CreateQuestionInput, ImportRequest, QuestionRegionInput, QuestionUseCases,
        ResourceRepository, WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{
        SqliteBlobStore, SqliteQuestionRepository, SqliteWorkspaceRepository,
    };

    fn fixture() -> (TempDir, String, String) {
        let directory = tempdir().expect("temporary directory should exist");
        let workspace = SqliteWorkspaceRepository::new(directory.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let source = directory.path().join("workbook.pdf");
        std::fs::write(&source, b"ocr-question-fixture").expect("fixture should write");
        let resources = SqliteBlobStore::new(directory.path());
        let document = resources
            .import_file(
                &source,
                &ImportRequest {
                    job_id: Uuid::now_v7().to_string(),
                    document_id: Uuid::now_v7().to_string(),
                    title: "OCR 习题册".to_owned(),
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
        let question = QuestionUseCases::new(SqliteQuestionRepository::new(directory.path()))
            .create_question(CreateQuestionInput {
                document_id: document.id,
                title: "二叉树遍历".to_owned(),
                chapter: None,
                question_number: None,
                difficulty: 3,
                analysis_markdown: None,
                region: QuestionRegionInput {
                    page_number: 1,
                    x: 0.1,
                    y: 0.2,
                    width: 0.5,
                    height: 0.2,
                },
                knowledge_node_ids: Vec::new(),
            })
            .expect("question should create");
        let question_id = question.question.id;
        let region_id = question.regions[0].id.clone();
        (directory, question_id, region_id)
    }

    fn recognition(question_id: String, region_id: String) -> OcrRecognition {
        let id = Uuid::now_v7().to_string();
        OcrRecognition {
            id: id.clone(),
            question_id,
            region_id,
            page_number: 1,
            engine: crate::application::OCR_ENGINE_NAME.to_owned(),
            recognized_text: "前序遍历".to_owned(),
            confirmed_text: None,
            mean_confidence: 0.98,
            state: OcrRecognitionState::Draft,
            lines: vec![OcrTextLine {
                id: Uuid::now_v7().to_string(),
                recognition_id: id,
                text: "前序遍历".to_owned(),
                confidence: 0.98,
                x: 0.1,
                y: 0.2,
                width: 0.5,
                height: 0.1,
                sort_order: 0,
            }],
            created_at: 1_700_000_000_100,
            updated_at: 1_700_000_000_100,
        }
    }

    #[test]
    fn draft_confirmation_round_trips_typed_lines() {
        let (directory, question_id, region_id) = fixture();
        let repository = SqliteOcrRepository::new(directory.path());
        let draft = repository
            .replace_draft(recognition(question_id.clone(), region_id))
            .expect("draft should persist");

        let confirmed = repository
            .confirm_draft(&draft.id, "前序：根、左、右", 1_700_000_000_200)
            .expect("draft should confirm");
        let listed = repository
            .list_current(&question_id)
            .expect("current recognition should list");

        assert_eq!(confirmed.state, OcrRecognitionState::Confirmed);
        assert_eq!(
            confirmed.confirmed_text.as_deref(),
            Some("前序：根、左、右")
        );
        assert_eq!(confirmed.lines.len(), 1);
        assert_eq!(listed, vec![confirmed]);
    }

    #[test]
    fn new_draft_preserves_the_confirmed_result() {
        let (directory, question_id, region_id) = fixture();
        let repository = SqliteOcrRepository::new(directory.path());
        let first = repository
            .replace_draft(recognition(question_id.clone(), region_id.clone()))
            .expect("first draft should persist");
        repository
            .confirm_draft(&first.id, "第一次确认", 1_700_000_000_200)
            .expect("first draft should confirm");

        repository
            .replace_draft(recognition(question_id.clone(), region_id))
            .expect("second draft should persist");
        let listed = repository
            .list_current(&question_id)
            .expect("draft and confirmation should list");

        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].state, OcrRecognitionState::Draft);
        assert_eq!(listed[1].state, OcrRecognitionState::Confirmed);
    }
}
