use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};

use crate::application::{
    QuestionBankError, QuestionBankRepository, ValidatedBulkAttempt, ValidatedIndexedQuestion,
    ValidatedIndexedQuestionUpdate,
};
use crate::domain::{
    AttemptResult, IndexedQuestion, LocalDate, QuestionBankSnapshot, QuestionRegion, QuestionType,
    TrashedWorkbookDocumentSegment, WorkbookCategory, WorkbookDocumentSegment,
};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

/// `SQLite` adapter for the subject-first question bank and immutable practice history.
#[derive(Debug, Clone)]
pub(crate) struct SqliteQuestionBankRepository {
    database_path: PathBuf,
}

impl SqliteQuestionBankRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, QuestionBankError> {
        if !self.database_path.exists() {
            return Err(QuestionBankError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl QuestionBankRepository for SqliteQuestionBankRepository {
    fn snapshot(&self) -> Result<QuestionBankSnapshot, QuestionBankError> {
        if !self.database_path.exists() {
            return Ok(QuestionBankSnapshot {
                workbooks: Vec::new(),
                segments: Vec::new(),
                questions: Vec::new(),
            });
        }
        load_snapshot(&self.open()?)
    }

    fn list_trashed_segments(
        &self,
    ) -> Result<Vec<TrashedWorkbookDocumentSegment>, QuestionBankError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        load_trashed_segments(&self.open()?)
    }

    fn question_gap_acknowledgements(&self) -> Result<Vec<String>, QuestionBankError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        let Some(workspace_id) = load_workspace_id_optional(&connection)? else {
            return Ok(Vec::new());
        };
        load_question_gap_acknowledgements(&connection, &workspace_id)
    }

    fn set_question_gap_acknowledgement(
        &self,
        issue_key: &str,
        acknowledged: bool,
        acknowledged_at: i64,
    ) -> Result<Vec<String>, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let workspace_id = load_workspace_id(&transaction)?;
        if acknowledged {
            transaction
                .execute(
                    "INSERT INTO question_gap_acknowledgement(
                        workspace_id, issue_key, acknowledged_at
                     ) VALUES (?1, ?2, ?3)
                     ON CONFLICT(workspace_id, issue_key) DO UPDATE SET
                        acknowledged_at = excluded.acknowledged_at",
                    params![workspace_id, issue_key, acknowledged_at],
                )
                .map_err(database_error)?;
        } else {
            transaction
                .execute(
                    "DELETE FROM question_gap_acknowledgement
                     WHERE workspace_id = ?1 AND issue_key = ?2",
                    params![workspace_id, issue_key],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        load_question_gap_acknowledgements(&connection, &workspace_id)
    }

    fn create_workbook(
        &self,
        workbook: WorkbookCategory,
    ) -> Result<WorkbookCategory, QuestionBankError> {
        let connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let result = connection.execute(
            "INSERT INTO workbook_category(
                id, workspace_id, name, archived_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, NULL, ?4, ?4)",
            params![
                workbook.id,
                workspace_id,
                workbook.name,
                workbook.created_at
            ],
        );
        match result {
            Ok(_) => Ok(workbook),
            Err(error) if is_unique_constraint(&error) => {
                Err(QuestionBankError::WorkbookAlreadyExists)
            }
            Err(error) => Err(database_error(error).into()),
        }
    }

    fn save_segments(
        &self,
        segments: &[WorkbookDocumentSegment],
    ) -> Result<Vec<WorkbookDocumentSegment>, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let workspace_id = load_workspace_id(&transaction)?;
        for segment in segments {
            validate_segment_links(&transaction, segment)?;
        }
        find_active_segment_conflicts(&transaction, segments)?;
        let mut saved_ids = Vec::with_capacity(segments.len());
        for segment in segments {
            let existing_deleted_at = transaction
                .query_row(
                    "SELECT deleted_at FROM workbook_document_segment
                     WHERE document_id = ?1 AND subject_id = ?2 AND workbook_id = ?3
                       AND page_start = ?4 AND page_end = ?5",
                    params![
                        segment.document_id,
                        segment.subject_id,
                        segment.workbook_id,
                        i64::from(segment.page_start),
                        i64::from(segment.page_end),
                    ],
                    |row| row.get::<_, Option<i64>>(0),
                )
                .optional()
                .map_err(database_error)?
                .flatten();
            transaction
                .execute(
                    "INSERT INTO workbook_document_segment(
                        id, workspace_id, document_id, subject_id, workbook_id,
                        source_heading, page_start, page_end, index_state,
                        question_count, deleted_at, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', 0, NULL, ?9, ?9)
                     ON CONFLICT(document_id, subject_id, workbook_id, page_start, page_end)
                     DO UPDATE SET source_heading = excluded.source_heading,
                                   deleted_at = NULL,
                                   updated_at = excluded.updated_at",
                    params![
                        segment.id,
                        workspace_id,
                        segment.document_id,
                        segment.subject_id,
                        segment.workbook_id,
                        segment.source_heading,
                        i64::from(segment.page_start),
                        i64::from(segment.page_end),
                        segment.updated_at,
                    ],
                )
                .map_err(database_error)?;
            let saved_id = transaction
                .query_row(
                    "SELECT id FROM workbook_document_segment
                     WHERE document_id = ?1 AND subject_id = ?2 AND workbook_id = ?3
                       AND page_start = ?4 AND page_end = ?5",
                    params![
                        segment.document_id,
                        segment.subject_id,
                        segment.workbook_id,
                        i64::from(segment.page_start),
                        i64::from(segment.page_end),
                    ],
                    |row| row.get::<_, String>(0),
                )
                .map_err(database_error)?;
            if let Some(deleted_at) = existing_deleted_at {
                restore_segment_questions(&transaction, &saved_id, deleted_at, segment.updated_at)?;
            }
            merge_contained_segments(&transaction, segment, &saved_id)?;
            saved_ids.push(saved_id);
        }
        transaction.commit().map_err(database_error)?;
        let snapshot = load_snapshot(&connection)?;
        Ok(snapshot
            .segments
            .into_iter()
            .filter(|segment| saved_ids.contains(&segment.id))
            .collect())
    }

    fn trash_segment(
        &self,
        segment_id: &str,
        deleted_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let segment_deleted_at = transaction
            .query_row(
                "SELECT deleted_at FROM workbook_document_segment WHERE id = ?1",
                params![segment_id],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(database_error)?;
        let Some(segment_deleted_at) = segment_deleted_at else {
            return Err(QuestionBankError::SegmentNotFound);
        };
        if segment_deleted_at.is_some() {
            return Err(QuestionBankError::SegmentNotActive);
        }

        transaction
            .execute(
                "INSERT INTO workbook_segment_question_trash(segment_id, question_id, deleted_at)
                 SELECT m.segment_id, m.question_id, ?2
                 FROM question_index_metadata m
                 JOIN question q ON q.id = m.question_id
                 WHERE m.segment_id = ?1 AND q.deleted_at IS NULL",
                params![segment_id, deleted_at],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "UPDATE question
                 SET deleted_at = ?2, updated_at = ?2
                 WHERE id IN (
                     SELECT question_id FROM workbook_segment_question_trash
                     WHERE segment_id = ?1 AND deleted_at = ?2
                 ) AND deleted_at IS NULL",
                params![segment_id, deleted_at],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "UPDATE workbook_document_segment
                 SET deleted_at = ?2, question_count = 0,
                     index_state = 'pending', updated_at = ?2
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![segment_id, deleted_at],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        load_snapshot(&connection)
    }

    fn restore_segment(
        &self,
        segment_id: &str,
        expected_deleted_at: i64,
        restored_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let segment = load_trashed_segment_context(&transaction, segment_id, expected_deleted_at)?;
        validate_restorable_segment_links(&transaction, &segment)?;
        let active_segment = segment.as_workbook_segment();
        find_active_segment_conflicts(&transaction, std::slice::from_ref(&active_segment))?;
        restore_segment_questions(&transaction, segment_id, expected_deleted_at, restored_at)?;
        transaction
            .execute(
                "UPDATE workbook_document_segment
                 SET deleted_at = NULL, updated_at = ?2
                 WHERE id = ?1 AND deleted_at = ?3",
                params![segment_id, restored_at, expected_deleted_at],
            )
            .map_err(database_error)?;
        refresh_segment_question_state(&transaction, segment_id, restored_at)?;
        transaction.commit().map_err(database_error)?;
        load_snapshot(&connection)
    }

    fn reassign_segment(
        &self,
        segment_id: &str,
        target_workbook_id: &str,
        expected_updated_at: i64,
        expected_deleted_at: Option<i64>,
        reassigned_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let workspace_id = load_workspace_id(&transaction)?;
        let segment = load_reassign_segment_context(&transaction, segment_id, &workspace_id)?;

        if segment.deleted_at != expected_deleted_at {
            return Err(QuestionBankError::SegmentReassignStale);
        }
        if segment.deleted_at.is_some() {
            return Err(QuestionBankError::SegmentNotActive);
        }
        if segment.updated_at != expected_updated_at {
            return Err(QuestionBankError::SegmentReassignStale);
        }
        validate_reassign_target_workbook(&transaction, target_workbook_id, &workspace_id)?;
        find_reassign_segment_conflicts(&transaction, &segment, target_workbook_id, &workspace_id)?;

        let metadata_needs_update = transaction
            .query_row(
                "SELECT EXISTS(
                     SELECT 1 FROM question_index_metadata
                     WHERE segment_id = ?1 AND workbook_id <> ?2
                 )",
                params![segment.id, target_workbook_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(database_error)?;
        let workbook_changed = segment.workbook_id != target_workbook_id;
        if !workbook_changed && !metadata_needs_update {
            transaction.commit().map_err(database_error)?;
            return load_snapshot(&connection);
        }

        let reassigned_at = reassigned_at.max(segment.updated_at.saturating_add(1));
        let changed = transaction
            .execute(
                "UPDATE workbook_document_segment
                 SET workbook_id = ?2, updated_at = ?3
                 WHERE id = ?1 AND workspace_id = ?4
                   AND deleted_at IS NULL AND updated_at = ?5",
                params![
                    segment.id,
                    target_workbook_id,
                    reassigned_at,
                    workspace_id,
                    expected_updated_at,
                ],
            )
            .map_err(map_reassign_write_error)?;
        if changed != 1 {
            return Err(QuestionBankError::SegmentReassignStale);
        }
        transaction
            .execute(
                "UPDATE question_index_metadata
                 SET workbook_id = ?2, updated_at = MAX(updated_at, ?3)
                 WHERE segment_id = ?1",
                params![segment.id, target_workbook_id, reassigned_at],
            )
            .map_err(map_reassign_write_error)?;
        transaction.commit().map_err(database_error)?;
        load_snapshot(&connection)
    }

    fn import_index(
        &self,
        segment_id: &str,
        questions: &[ValidatedIndexedQuestion],
        updated_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let segment = load_segment_context(&transaction, segment_id)?;
        for question in questions {
            validate_index_regions(question, &segment)?;
            upsert_indexed_question(&transaction, &segment, question, updated_at)?;
        }
        let (question_count, low_confidence): (i64, i64) = transaction
            .query_row(
                "SELECT COUNT(*),
                        COALESCE(SUM(CASE WHEN m.index_confidence < 0.75 THEN 1 ELSE 0 END), 0)
                 FROM question_index_metadata m
                 JOIN question q ON q.id = m.question_id
                 WHERE m.segment_id = ?1 AND q.deleted_at IS NULL",
                params![segment_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "UPDATE workbook_document_segment
                 SET index_state = ?2, question_count = ?3, updated_at = ?4
                 WHERE id = ?1",
                params![
                    segment_id,
                    if low_confidence > 0 {
                        "needs_review"
                    } else {
                        "ready"
                    },
                    question_count,
                    updated_at,
                ],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        load_snapshot(&connection)
    }

    fn record_attempts(
        &self,
        attempts: &[ValidatedBulkAttempt],
        attempted_on: &LocalDate,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        for attempt in attempts {
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM question q
                     JOIN question_index_metadata m ON m.question_id = q.id
                     JOIN workbook_document_segment s ON s.id = m.segment_id
                     WHERE q.id = ?1 AND q.deleted_at IS NULL
                       AND s.deleted_at IS NULL",
                    params![attempt.question_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(database_error)?
                .is_some();
            if !exists {
                return Err(QuestionBankError::QuestionNotFound);
            }
            transaction
                .execute(
                    "INSERT INTO question_attempt(
                        id, question_id, result, attempted_at,
                        duration_seconds, answer_note, created_at
                     ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?4)",
                    params![
                        attempt.id,
                        attempt.question_id,
                        attempt.result.as_str(),
                        attempt.attempted_at,
                    ],
                )
                .map_err(database_error)?;
            match attempt.result {
                AttemptResult::Incorrect => activate_incorrect_attempt(
                    &transaction,
                    &attempt.question_id,
                    attempted_on,
                    attempt.attempted_at,
                )?,
                AttemptResult::Uncertain => activate_partial_attempt(
                    &transaction,
                    &attempt.question_id,
                    attempted_on,
                    attempt.attempted_at,
                )?,
                AttemptResult::Correct => {}
            }
            transaction
                .execute(
                    "UPDATE question SET updated_at = ?2 WHERE id = ?1",
                    params![attempt.question_id, attempt.attempted_at],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        load_snapshot(&connection)
    }

    fn update_question(
        &self,
        update: &ValidatedIndexedQuestionUpdate,
        updated_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let changed = transaction
            .execute(
                "UPDATE question
                 SET title = ?2, chapter = ?3, question_number = ?4,
                     question_type = ?5, classification_source = 'manual',
                     classification_confidence = 1.0, updated_at = ?6
                 WHERE id = ?1 AND deleted_at IS NULL
                   AND EXISTS (
                       SELECT 1 FROM question_index_metadata m
                       JOIN workbook_document_segment s ON s.id = m.segment_id
                       WHERE m.question_id = ?1 AND s.deleted_at IS NULL
                   )",
                params![
                    update.question_id,
                    update.title,
                    update.chapter,
                    update.question_number,
                    update.question_type.as_str(),
                    updated_at,
                ],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(QuestionBankError::QuestionNotFound);
        }
        transaction
            .execute(
                "UPDATE question_index_metadata
                 SET section_part = ?2, index_source = 'manual',
                     index_confidence = 1.0, updated_at = ?3
                 WHERE question_id = ?1",
                params![update.question_id, update.section_part, updated_at],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        load_snapshot(&connection)
    }

    fn replace_question_regions(
        &self,
        question_id: &str,
        regions: &[QuestionRegion],
        updated_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let segment = load_indexed_question_segment(&transaction, question_id)?;
        if regions.iter().any(|region| {
            region.page_number < segment.page_start || region.page_number > segment.page_end
        }) {
            return Err(QuestionBankError::InvalidInput);
        }
        replace_stored_question_regions(
            &transaction,
            question_id,
            &segment.document_id,
            regions,
            updated_at,
        )?;
        transaction.commit().map_err(database_error)?;
        load_snapshot(&connection)
    }

    fn insert_question_relative(
        &self,
        anchor_question_id: &str,
        question: &ValidatedIndexedQuestion,
        insert_before: bool,
        updated_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let (segment, anchor_order) =
            load_indexed_question_position(&transaction, anchor_question_id)?;
        validate_index_regions(question, &segment)?;
        let insertion_order = if insert_before {
            anchor_order
        } else {
            anchor_order
                .checked_add(1)
                .ok_or(QuestionBankError::InvalidInput)?
        };
        transaction
            .execute(
                "UPDATE question_index_metadata
                 SET sort_order = sort_order + 1, updated_at = ?3
                 WHERE segment_id = ?1 AND sort_order >= ?2",
                params![segment.id, i64::from(insertion_order), updated_at],
            )
            .map_err(database_error)?;
        let mut inserted = question.clone();
        inserted.sort_order = insertion_order;
        write_question_record(
            &transaction,
            &segment,
            &inserted,
            &inserted.id,
            false,
            true,
            updated_at,
        )?;
        replace_index_regions(&transaction, &segment, &inserted, &inserted.id, updated_at)?;
        write_index_metadata(&transaction, &segment, &inserted, &inserted.id, updated_at)?;
        transaction
            .execute(
                "UPDATE question_index_metadata
                 SET index_source = 'manual', index_confidence = 1.0
                 WHERE question_id = ?1",
                params![inserted.id],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "UPDATE question
                 SET classification_source = 'manual', classification_confidence = 1.0
                 WHERE id = ?1",
                params![inserted.id],
            )
            .map_err(database_error)?;
        refresh_segment_question_count(&transaction, &segment.id, updated_at)?;
        transaction.commit().map_err(database_error)?;
        load_snapshot(&connection)
    }

    fn trash_question(
        &self,
        question_id: &str,
        deleted_at: i64,
    ) -> Result<QuestionBankSnapshot, QuestionBankError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let segment_id = transaction
            .query_row(
                "SELECT m.segment_id
                 FROM question_index_metadata m
                 JOIN question q ON q.id = m.question_id
                 JOIN workbook_document_segment s ON s.id = m.segment_id
                 WHERE q.id = ?1 AND q.deleted_at IS NULL
                   AND s.deleted_at IS NULL",
                params![question_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(QuestionBankError::QuestionNotFound)?;
        transaction
            .execute(
                "UPDATE question SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![question_id, deleted_at],
            )
            .map_err(database_error)?;
        let question_count = transaction
            .query_row(
                "SELECT COUNT(*)
                 FROM question_index_metadata m
                 JOIN question q ON q.id = m.question_id
                 WHERE m.segment_id = ?1 AND q.deleted_at IS NULL",
                params![segment_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "UPDATE workbook_document_segment
                 SET question_count = ?2, updated_at = ?3 WHERE id = ?1",
                params![segment_id, question_count, deleted_at],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        load_snapshot(&connection)
    }
}

fn load_indexed_question_segment(
    transaction: &Transaction<'_>,
    question_id: &str,
) -> Result<SegmentContext, QuestionBankError> {
    let segment_id = transaction
        .query_row(
            "SELECT m.segment_id
              FROM question_index_metadata m
              JOIN question q ON q.id = m.question_id
              JOIN workbook_document_segment s ON s.id = m.segment_id
              WHERE q.id = ?1 AND q.deleted_at IS NULL
                AND s.deleted_at IS NULL",
            params![question_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionBankError::QuestionNotFound)?;
    load_segment_context(transaction, &segment_id)
}

fn load_indexed_question_position(
    transaction: &Transaction<'_>,
    question_id: &str,
) -> Result<(SegmentContext, u32), QuestionBankError> {
    let (segment_id, sort_order) = transaction
        .query_row(
            "SELECT m.segment_id, m.sort_order
              FROM question_index_metadata m
              JOIN question q ON q.id = m.question_id
              JOIN workbook_document_segment s ON s.id = m.segment_id
              WHERE q.id = ?1 AND q.deleted_at IS NULL
                AND s.deleted_at IS NULL",
            params![question_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?)),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionBankError::QuestionNotFound)?;
    Ok((load_segment_context(transaction, &segment_id)?, sort_order))
}

fn refresh_segment_question_count(
    transaction: &Transaction<'_>,
    segment_id: &str,
    updated_at: i64,
) -> Result<(), QuestionBankError> {
    let question_count = transaction
        .query_row(
            "SELECT COUNT(*)
             FROM question_index_metadata m
             JOIN question q ON q.id = m.question_id
             WHERE m.segment_id = ?1 AND q.deleted_at IS NULL",
            params![segment_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "UPDATE workbook_document_segment
             SET question_count = ?2, index_state = 'ready', updated_at = ?3
             WHERE id = ?1",
            params![segment_id, question_count, updated_at],
        )
        .map_err(database_error)?;
    Ok(())
}

fn refresh_segment_question_state(
    transaction: &Transaction<'_>,
    segment_id: &str,
    updated_at: i64,
) -> Result<(), QuestionBankError> {
    let (question_count, low_confidence): (i64, i64) = transaction
        .query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN m.index_confidence < 0.75 THEN 1 ELSE 0 END), 0)
             FROM question_index_metadata m
             JOIN question q ON q.id = m.question_id
             WHERE m.segment_id = ?1 AND q.deleted_at IS NULL",
            params![segment_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "UPDATE workbook_document_segment
             SET question_count = ?2,
                 index_state = CASE WHEN ?2 = 0 THEN 'pending'
                                    WHEN ?3 > 0 THEN 'needs_review'
                                    ELSE 'ready' END,
                 updated_at = ?4
             WHERE id = ?1 AND deleted_at IS NULL",
            params![segment_id, question_count, low_confidence, updated_at],
        )
        .map_err(database_error)?;
    Ok(())
}

fn replace_stored_question_regions(
    transaction: &Transaction<'_>,
    question_id: &str,
    document_id: &str,
    regions: &[QuestionRegion],
    updated_at: i64,
) -> Result<(), QuestionBankError> {
    let existing_ids = load_question_region_ids(transaction, question_id)?;
    let retained_ids = regions
        .iter()
        .map(|region| region.id.clone())
        .collect::<HashSet<_>>();
    transaction
        .execute(
            "UPDATE question_region SET sort_order = sort_order + 100
             WHERE question_id = ?1",
            params![question_id],
        )
        .map_err(database_error)?;
    for region in regions {
        write_question_region(
            transaction,
            question_id,
            document_id,
            region,
            existing_ids.contains(&region.id),
            updated_at,
        )?;
    }
    for region_id in existing_ids.difference(&retained_ids) {
        transaction
            .execute(
                "DELETE FROM question_region WHERE id = ?1",
                params![region_id],
            )
            .map_err(database_error)?;
    }
    transaction
        .execute(
            "UPDATE question_index_metadata
             SET index_source = 'manual', index_confidence = 1.0, updated_at = ?2
             WHERE question_id = ?1",
            params![question_id, updated_at],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "UPDATE question SET updated_at = ?2 WHERE id = ?1",
            params![question_id, updated_at],
        )
        .map_err(database_error)?;
    Ok(())
}

fn restore_segment_questions(
    transaction: &Transaction<'_>,
    segment_id: &str,
    deleted_at: i64,
    updated_at: i64,
) -> Result<(), QuestionBankError> {
    transaction
        .execute(
            "UPDATE question
             SET deleted_at = NULL, updated_at = ?3
             WHERE id IN (
                 SELECT t.question_id
                 FROM workbook_segment_question_trash t
                 WHERE t.segment_id = ?1 AND t.deleted_at = ?2
             ) AND deleted_at = ?2",
            params![segment_id, deleted_at, updated_at],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM workbook_segment_question_trash WHERE segment_id = ?1",
            params![segment_id],
        )
        .map_err(database_error)?;
    Ok(())
}

fn load_question_region_ids(
    transaction: &Transaction<'_>,
    question_id: &str,
) -> Result<HashSet<String>, QuestionBankError> {
    let mut statement = transaction
        .prepare("SELECT id FROM question_region WHERE question_id = ?1")
        .map_err(database_error)?;
    statement
        .query_map(params![question_id], |row| row.get::<_, String>(0))
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(QuestionBankError::from))
        .collect()
}

fn write_question_region(
    transaction: &Transaction<'_>,
    question_id: &str,
    document_id: &str,
    region: &QuestionRegion,
    exists: bool,
    updated_at: i64,
) -> Result<(), QuestionBankError> {
    if exists {
        transaction
            .execute(
                "UPDATE question_region
                 SET page_number = ?3, x = ?4, y = ?5, width = ?6,
                     height = ?7, sort_order = ?8
                 WHERE id = ?1 AND question_id = ?2",
                params![
                    region.id,
                    question_id,
                    i64::from(region.page_number),
                    region.x,
                    region.y,
                    region.width,
                    region.height,
                    i64::from(region.sort_order),
                ],
            )
            .map_err(database_error)?;
    } else {
        transaction
            .execute(
                "INSERT INTO question_region(
                    id, question_id, document_id, page_number, x, y, width, height,
                    coordinate_version, sort_order, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10)",
                params![
                    region.id,
                    question_id,
                    document_id,
                    i64::from(region.page_number),
                    region.x,
                    region.y,
                    region.width,
                    region.height,
                    i64::from(region.sort_order),
                    updated_at,
                ],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn merge_contained_segments(
    transaction: &Transaction<'_>,
    segment: &WorkbookDocumentSegment,
    target_id: &str,
) -> Result<(), QuestionBankError> {
    let mut statement = transaction
        .prepare(
            "SELECT id FROM workbook_document_segment
             WHERE document_id = ?1 AND subject_id = ?2 AND workbook_id = ?3
               AND page_start >= ?4 AND page_end <= ?5 AND id <> ?6
               AND deleted_at IS NULL",
        )
        .map_err(database_error)?;
    let redundant_ids = statement
        .query_map(
            params![
                segment.document_id,
                segment.subject_id,
                segment.workbook_id,
                i64::from(segment.page_start),
                i64::from(segment.page_end),
                target_id,
            ],
            |row| row.get::<_, String>(0),
        )
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for redundant_id in redundant_ids {
        transaction
            .execute(
                "UPDATE question_index_metadata
                 SET segment_id = ?2, workbook_id = ?3, updated_at = ?4
                 WHERE segment_id = ?1",
                params![
                    redundant_id,
                    target_id,
                    segment.workbook_id,
                    segment.updated_at
                ],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "DELETE FROM workbook_document_segment WHERE id = ?1",
                params![redundant_id],
            )
            .map_err(database_error)?;
    }
    let (question_count, low_confidence): (i64, i64) = transaction
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN m.index_confidence < 0.75 THEN 1 ELSE 0 END), 0)
             FROM question_index_metadata m
             JOIN question q ON q.id = m.question_id
             WHERE m.segment_id = ?1 AND q.deleted_at IS NULL",
            params![target_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "UPDATE workbook_document_segment
             SET question_count = ?2,
                 index_state = CASE WHEN ?2 = 0 THEN 'pending'
                                    WHEN ?3 > 0 THEN 'needs_review'
                                    ELSE 'ready' END,
                 updated_at = ?4
             WHERE id = ?1",
            params![
                target_id,
                question_count,
                low_confidence,
                segment.updated_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

#[derive(Debug)]
struct SegmentContext {
    id: String,
    workspace_id: String,
    document_id: String,
    subject_id: String,
    workbook_id: String,
    page_start: u32,
    page_end: u32,
}

#[derive(Debug)]
struct TrashedSegmentContext {
    id: String,
    document_id: String,
    subject_id: String,
    workbook_id: String,
    source_heading: String,
    page_start: u32,
    page_end: u32,
    index_state: String,
    question_count: u32,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug)]
struct ReassignSegmentContext {
    id: String,
    document_id: String,
    subject_id: String,
    workbook_id: String,
    page_start: u32,
    page_end: u32,
    updated_at: i64,
    deleted_at: Option<i64>,
}

impl TrashedSegmentContext {
    fn as_workbook_segment(&self) -> WorkbookDocumentSegment {
        WorkbookDocumentSegment {
            id: self.id.clone(),
            document_id: self.document_id.clone(),
            document_title: String::new(),
            subject_id: self.subject_id.clone(),
            subject_name: String::new(),
            workbook_id: self.workbook_id.clone(),
            workbook_name: String::new(),
            source_heading: self.source_heading.clone(),
            page_start: self.page_start,
            page_end: self.page_end,
            index_state: self.index_state.clone(),
            question_count: self.question_count,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
    }
}

fn load_trashed_segment_context(
    transaction: &Transaction<'_>,
    segment_id: &str,
    expected_deleted_at: i64,
) -> Result<TrashedSegmentContext, QuestionBankError> {
    let context = transaction
        .query_row(
            "SELECT id, document_id, subject_id, workbook_id,
                    source_heading, page_start, page_end, index_state,
                    question_count, created_at, updated_at, deleted_at
             FROM workbook_document_segment
             WHERE id = ?1",
            params![segment_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, u32>(5)?,
                    row.get::<_, u32>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, u32>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                    row.get::<_, Option<i64>>(11)?,
                ))
            },
        )
        .optional()
        .map_err(database_error)?;
    let Some((
        id,
        document_id,
        subject_id,
        workbook_id,
        source_heading,
        page_start,
        page_end,
        index_state,
        question_count,
        created_at,
        updated_at,
        deleted_at,
    )) = context
    else {
        return Err(QuestionBankError::SegmentNotFound);
    };
    let Some(deleted_at) = deleted_at else {
        return Err(QuestionBankError::SegmentNotTrashed);
    };
    if deleted_at != expected_deleted_at {
        return Err(QuestionBankError::SegmentRestoreStale);
    }
    Ok(TrashedSegmentContext {
        id,
        document_id,
        subject_id,
        workbook_id,
        source_heading,
        page_start,
        page_end,
        index_state,
        question_count,
        created_at,
        updated_at,
    })
}

fn validate_restorable_segment_links(
    transaction: &Transaction<'_>,
    segment: &TrashedSegmentContext,
) -> Result<(), QuestionBankError> {
    let page_count = transaction
        .query_row(
            "SELECT page_count FROM resource_document
             WHERE id = ?1 AND kind = 'pdf' AND deleted_at IS NULL",
            params![segment.document_id],
            |row| row.get::<_, Option<u32>>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionBankError::DocumentNotFound)?;
    if page_count.is_some_and(|count| segment.page_end > count) {
        return Err(QuestionBankError::InvalidInput);
    }
    let subject_exists = transaction
        .query_row(
            "SELECT 1 FROM subject WHERE id = ?1 AND archived_at IS NULL",
            params![segment.subject_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(database_error)?
        .is_some();
    if !subject_exists {
        return Err(QuestionBankError::SubjectNotFound);
    }
    let workbook_exists = transaction
        .query_row(
            "SELECT 1 FROM workbook_category WHERE id = ?1 AND archived_at IS NULL",
            params![segment.workbook_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(database_error)?
        .is_some();
    if !workbook_exists {
        return Err(QuestionBankError::WorkbookNotFound);
    }
    Ok(())
}

fn load_segment_context(
    connection: &Connection,
    segment_id: &str,
) -> Result<SegmentContext, QuestionBankError> {
    connection
        .query_row(
            "SELECT id, workspace_id, document_id, subject_id, workbook_id, page_start, page_end
             FROM workbook_document_segment
             WHERE id = ?1 AND deleted_at IS NULL",
            params![segment_id],
            |row| {
                Ok(SegmentContext {
                    id: row.get(0)?,
                    workspace_id: row.get(1)?,
                    document_id: row.get(2)?,
                    subject_id: row.get(3)?,
                    workbook_id: row.get(4)?,
                    page_start: row.get(5)?,
                    page_end: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionBankError::SegmentNotFound)
}

fn load_reassign_segment_context(
    transaction: &Transaction<'_>,
    segment_id: &str,
    workspace_id: &str,
) -> Result<ReassignSegmentContext, QuestionBankError> {
    transaction
        .query_row(
            "SELECT id, document_id, subject_id, workbook_id,
                    page_start, page_end, updated_at, deleted_at
             FROM workbook_document_segment
             WHERE id = ?1 AND workspace_id = ?2",
            params![segment_id, workspace_id],
            |row| {
                Ok(ReassignSegmentContext {
                    id: row.get(0)?,
                    document_id: row.get(1)?,
                    subject_id: row.get(2)?,
                    workbook_id: row.get(3)?,
                    page_start: row.get(4)?,
                    page_end: row.get(5)?,
                    updated_at: row.get(6)?,
                    deleted_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionBankError::SegmentNotFound)
}

fn validate_reassign_target_workbook(
    transaction: &Transaction<'_>,
    workbook_id: &str,
    workspace_id: &str,
) -> Result<(), QuestionBankError> {
    let exists = transaction
        .query_row(
            "SELECT 1 FROM workbook_category
             WHERE id = ?1 AND workspace_id = ?2 AND archived_at IS NULL",
            params![workbook_id, workspace_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(database_error)?
        .is_some();
    if !exists {
        return Err(QuestionBankError::WorkbookNotFound);
    }
    Ok(())
}

fn find_reassign_segment_conflicts(
    transaction: &Transaction<'_>,
    segment: &ReassignSegmentContext,
    target_workbook_id: &str,
    workspace_id: &str,
) -> Result<(), QuestionBankError> {
    let mut statement = transaction
        .prepare(
            "SELECT id, workbook_id, deleted_at
             FROM workbook_document_segment
             WHERE workspace_id = ?1 AND document_id = ?2 AND subject_id = ?3
               AND page_start = ?4 AND page_end = ?5 AND id <> ?6
             ORDER BY id",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map(
            params![
                workspace_id,
                segment.document_id,
                segment.subject_id,
                i64::from(segment.page_start),
                i64::from(segment.page_end),
                segment.id,
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                ))
            },
        )
        .map_err(database_error)?;
    let mut conflicts = Vec::new();
    for row in rows {
        let (existing_segment_id, existing_workbook_id, deleted_at) =
            row.map_err(database_error)?;
        if deleted_at.is_none() || existing_workbook_id == target_workbook_id {
            conflicts.push((
                segment.document_id.clone(),
                segment.subject_id.clone(),
                segment.page_start,
                segment.page_end,
                target_workbook_id.to_owned(),
                existing_segment_id,
                existing_workbook_id,
            ));
        }
    }
    drop(statement);
    conflicts.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.3.cmp(&right.3))
            .then_with(|| left.4.cmp(&right.4))
            .then_with(|| left.5.cmp(&right.5))
            .then_with(|| left.6.cmp(&right.6))
    });
    if conflicts.is_empty() {
        Ok(())
    } else {
        Err(QuestionBankError::segment_assignment_conflicts(conflicts))
    }
}

fn map_reassign_write_error(error: rusqlite::Error) -> QuestionBankError {
    if is_unique_constraint(&error) {
        QuestionBankError::segment_assignment_conflicts(Vec::new())
    } else {
        database_error(error).into()
    }
}

fn upsert_indexed_question(
    transaction: &Transaction<'_>,
    segment: &SegmentContext,
    question: &ValidatedIndexedQuestion,
    updated_at: i64,
) -> Result<(), QuestionBankError> {
    let existing = transaction
        .query_row(
            "SELECT question_id, index_source FROM question_index_metadata
             WHERE segment_id = ?1 AND source_key = ?2",
            params![segment.id, question.source_key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(database_error)?;
    let question_id = existing
        .as_ref()
        .map_or(question.id.as_str(), |value| value.0.as_str());
    let replace_regions = existing.as_ref().is_none_or(|value| value.1 != "manual");
    write_question_record(
        transaction,
        segment,
        question,
        question_id,
        existing.is_some(),
        replace_regions,
        updated_at,
    )?;
    if replace_regions {
        replace_index_regions(transaction, segment, question, question_id, updated_at)?;
    }
    write_index_metadata(transaction, segment, question, question_id, updated_at)
}

fn write_question_record(
    transaction: &Transaction<'_>,
    segment: &SegmentContext,
    question: &ValidatedIndexedQuestion,
    question_id: &str,
    exists: bool,
    replace_regions: bool,
    updated_at: i64,
) -> Result<(), QuestionBankError> {
    if !exists {
        transaction
            .execute(
                "INSERT INTO question(
                    id, workspace_id, document_id, title, chapter, question_number,
                    difficulty, analysis_markdown, deleted_at, created_at, updated_at,
                    subject_id, question_type, classification_source,
                    classification_confidence
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 3, NULL, NULL, ?7, ?7,
                           ?8, ?9, 'automatic', ?10)",
                params![
                    question_id,
                    segment.workspace_id,
                    segment.document_id,
                    question.title,
                    question.chapter,
                    question.question_number,
                    updated_at,
                    segment.subject_id,
                    question.question_type.as_str(),
                    question.index_confidence,
                ],
            )
            .map_err(database_error)?;
        return Ok(());
    }
    transaction
        .execute(
            "UPDATE question SET title = ?2, chapter = ?3, question_number = ?4,
                 subject_id = ?5, question_type = ?6,
                 classification_source = 'automatic',
                 classification_confidence = ?7, updated_at = ?8
              WHERE id = ?1",
            params![
                question_id,
                question.title,
                question.chapter,
                question.question_number,
                segment.subject_id,
                question.question_type.as_str(),
                question.index_confidence,
                updated_at,
            ],
        )
        .map_err(database_error)?;
    if replace_regions {
        transaction
            .execute(
                "DELETE FROM question_region WHERE question_id = ?1",
                params![question_id],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn replace_index_regions(
    transaction: &Transaction<'_>,
    segment: &SegmentContext,
    question: &ValidatedIndexedQuestion,
    question_id: &str,
    updated_at: i64,
) -> Result<(), QuestionBankError> {
    for (index, region) in question.regions.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO question_region(
                    id, question_id, document_id, page_number, x, y, width, height,
                    coordinate_version, sort_order, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10)",
                params![
                    uuid::Uuid::now_v7().to_string(),
                    question_id,
                    segment.document_id,
                    i64::from(region.page_number),
                    region.x,
                    region.y,
                    region.width,
                    region.height,
                    i64::try_from(index).map_err(|_| QuestionBankError::InvalidInput)?,
                    updated_at,
                ],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn write_index_metadata(
    transaction: &Transaction<'_>,
    segment: &SegmentContext,
    question: &ValidatedIndexedQuestion,
    question_id: &str,
    updated_at: i64,
) -> Result<(), QuestionBankError> {
    transaction
        .execute(
            "INSERT INTO question_index_metadata(
                question_id, workbook_id, segment_id, source_key, section_part,
                index_source, index_confidence, sort_order, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'pdf_outline', ?6, ?7, ?8, ?8)
             ON CONFLICT(question_id) DO UPDATE SET
                source_key = excluded.source_key,
                section_part = excluded.section_part,
                index_confidence = CASE
                    WHEN question_index_metadata.index_source = 'manual'
                    THEN question_index_metadata.index_confidence
                    ELSE excluded.index_confidence
                END,
                sort_order = excluded.sort_order,
                updated_at = excluded.updated_at",
            params![
                question_id,
                segment.workbook_id,
                segment.id,
                question.source_key,
                question.section_part,
                question.index_confidence,
                i64::from(question.sort_order),
                updated_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn validate_segment_links(
    connection: &Connection,
    segment: &WorkbookDocumentSegment,
) -> Result<(), QuestionBankError> {
    let page_count = connection
        .query_row(
            "SELECT page_count FROM resource_document
             WHERE id = ?1 AND kind = 'pdf'",
            params![segment.document_id],
            |row| row.get::<_, Option<u32>>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionBankError::DocumentNotFound)?;
    if page_count.is_some_and(|count| segment.page_end > count) {
        return Err(QuestionBankError::InvalidInput);
    }
    let subject_exists = connection
        .query_row(
            "SELECT 1 FROM subject WHERE id = ?1 AND archived_at IS NULL",
            params![segment.subject_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(database_error)?
        .is_some();
    if !subject_exists {
        return Err(QuestionBankError::SubjectNotFound);
    }
    let workbook_exists = connection
        .query_row(
            "SELECT 1 FROM workbook_category WHERE id = ?1 AND archived_at IS NULL",
            params![segment.workbook_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(database_error)?
        .is_some();
    if !workbook_exists {
        return Err(QuestionBankError::WorkbookNotFound);
    }
    Ok(())
}

fn find_active_segment_conflicts(
    transaction: &Transaction<'_>,
    segments: &[WorkbookDocumentSegment],
) -> Result<(), QuestionBankError> {
    let mut conflicts = Vec::new();
    for segment in segments {
        let mut statement = transaction
            .prepare(
                "SELECT id, workbook_id
                 FROM workbook_document_segment
                 WHERE document_id = ?1 AND subject_id = ?2
                   AND page_start = ?3 AND page_end = ?4
                   AND deleted_at IS NULL
                 ORDER BY id",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map(
                params![
                    segment.document_id,
                    segment.subject_id,
                    i64::from(segment.page_start),
                    i64::from(segment.page_end),
                ],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .map_err(database_error)?;
        for row in rows {
            let (existing_segment_id, existing_workbook_id) = row.map_err(database_error)?;
            if existing_workbook_id == segment.workbook_id {
                continue;
            }
            conflicts.push((
                segment.document_id.clone(),
                segment.subject_id.clone(),
                segment.page_start,
                segment.page_end,
                segment.workbook_id.clone(),
                existing_segment_id,
                existing_workbook_id,
            ));
        }
    }
    conflicts.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.2.cmp(&right.2))
            .then_with(|| left.3.cmp(&right.3))
            .then_with(|| left.4.cmp(&right.4))
            .then_with(|| left.5.cmp(&right.5))
            .then_with(|| left.6.cmp(&right.6))
    });
    if !conflicts.is_empty() {
        return Err(QuestionBankError::segment_assignment_conflicts(conflicts));
    }
    Ok(())
}

fn validate_index_regions(
    question: &ValidatedIndexedQuestion,
    segment: &SegmentContext,
) -> Result<(), QuestionBankError> {
    if question.regions.iter().any(|region| {
        region.page_number < segment.page_start || region.page_number > segment.page_end
    }) {
        return Err(QuestionBankError::InvalidInput);
    }
    Ok(())
}

fn load_snapshot(connection: &Connection) -> Result<QuestionBankSnapshot, QuestionBankError> {
    Ok(QuestionBankSnapshot {
        workbooks: load_workbooks(connection)?,
        segments: load_segments(connection)?,
        questions: load_questions(connection)?,
    })
}

fn load_workbooks(connection: &Connection) -> Result<Vec<WorkbookCategory>, QuestionBankError> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, created_at, updated_at FROM workbook_category
             WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE, id",
        )
        .map_err(database_error)?;
    statement
        .query_map([], |row| {
            Ok(WorkbookCategory {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn load_segments(
    connection: &Connection,
) -> Result<Vec<WorkbookDocumentSegment>, QuestionBankError> {
    let mut statement = connection
        .prepare(
            "SELECT s.id, s.document_id, d.title, s.subject_id, subject.name,
                    s.workbook_id, w.name, s.source_heading, s.page_start, s.page_end,
                    s.index_state, s.question_count, s.created_at, s.updated_at
             FROM workbook_document_segment s
             JOIN resource_document d ON d.id = s.document_id
             JOIN subject ON subject.id = s.subject_id
             JOIN workbook_category w ON w.id = s.workbook_id
             WHERE w.archived_at IS NULL AND s.deleted_at IS NULL
             ORDER BY subject.sort_order, subject.name, w.name, s.page_start, s.id",
        )
        .map_err(database_error)?;
    statement
        .query_map([], |row| {
            Ok(WorkbookDocumentSegment {
                id: row.get(0)?,
                document_id: row.get(1)?,
                document_title: row.get(2)?,
                subject_id: row.get(3)?,
                subject_name: row.get(4)?,
                workbook_id: row.get(5)?,
                workbook_name: row.get(6)?,
                source_heading: row.get(7)?,
                page_start: row.get(8)?,
                page_end: row.get(9)?,
                index_state: row.get(10)?,
                question_count: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn load_trashed_segments(
    connection: &Connection,
) -> Result<Vec<TrashedWorkbookDocumentSegment>, QuestionBankError> {
    let mut statement = connection
        .prepare(
            "SELECT s.id, s.document_id, d.title, s.subject_id, subject.name,
                    s.workbook_id, w.name, s.source_heading, s.page_start, s.page_end,
                    s.index_state, s.question_count, s.created_at, s.updated_at,
                    s.deleted_at,
                    (SELECT COUNT(*)
                     FROM workbook_segment_question_trash t
                     JOIN question q ON q.id = t.question_id
                     WHERE t.segment_id = s.id
                       AND t.deleted_at = s.deleted_at
                       AND q.deleted_at = s.deleted_at)
             FROM workbook_document_segment s
             JOIN resource_document d ON d.id = s.document_id
             JOIN subject ON subject.id = s.subject_id
             JOIN workbook_category w ON w.id = s.workbook_id
             WHERE s.deleted_at IS NOT NULL
             ORDER BY subject.sort_order, subject.name COLLATE NOCASE,
                      w.name COLLATE NOCASE, s.page_start, s.page_end, s.id",
        )
        .map_err(database_error)?;
    statement
        .query_map([], |row| {
            Ok(TrashedWorkbookDocumentSegment {
                id: row.get(0)?,
                document_id: row.get(1)?,
                document_title: row.get(2)?,
                subject_id: row.get(3)?,
                subject_name: row.get(4)?,
                workbook_id: row.get(5)?,
                workbook_name: row.get(6)?,
                source_heading: row.get(7)?,
                page_start: row.get(8)?,
                page_end: row.get(9)?,
                index_state: row.get(10)?,
                question_count: row.get(11)?,
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
                deleted_at: row.get::<_, i64>(14)?,
                restorable_question_count: row.get(15)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn load_questions(connection: &Connection) -> Result<Vec<IndexedQuestion>, QuestionBankError> {
    let mut statement = connection
        .prepare(
            "SELECT q.id, q.document_id, d.title, q.subject_id, subject.name,
                    m.workbook_id, w.name, m.segment_id, COALESCE(q.chapter, '未分章'),
                    m.section_part, m.source_key, q.question_type,
                    COALESCE(q.question_number, ''),
                    q.title, m.index_confidence, m.sort_order,
                    (SELECT a.result FROM question_attempt a
                     WHERE a.question_id = q.id ORDER BY a.attempted_at DESC, a.id DESC LIMIT 1),
                    (SELECT COUNT(*) FROM question_attempt a WHERE a.question_id = q.id),
                    (SELECT COUNT(*) FROM question_attempt a
                     WHERE a.question_id = q.id AND a.result = 'incorrect'),
                    (SELECT COUNT(*) FROM question_attempt a
                     WHERE a.question_id = q.id AND a.result = 'uncertain')
             FROM question_index_metadata m
             JOIN question q ON q.id = m.question_id
             JOIN resource_document d ON d.id = q.document_id
             JOIN subject ON subject.id = q.subject_id
             JOIN workbook_category w ON w.id = m.workbook_id
             JOIN workbook_document_segment segment ON segment.id = m.segment_id
             WHERE q.deleted_at IS NULL AND w.archived_at IS NULL
               AND segment.deleted_at IS NULL
             ORDER BY subject.sort_order, subject.name, w.name,
                      segment.page_start, m.sort_order, q.id",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            let question_type: Option<String> = row.get(11)?;
            let current_result: Option<String> = row.get(16)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
                question_type,
                row.get::<_, String>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, f64>(14)?,
                row.get::<_, u32>(15)?,
                current_result,
                row.get::<_, u32>(17)?,
                row.get::<_, u32>(18)?,
                row.get::<_, u32>(19)?,
            ))
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|row| {
            let question_type =
                parse_question_type_with_legacy_fallback(row.11.as_deref(), &row.10);
            let current_result = match row.16.as_deref() {
                Some(value) => {
                    Some(AttemptResult::parse(value).ok_or(QuestionBankError::InvalidInput)?)
                }
                None => None,
            };
            Ok(IndexedQuestion {
                id: row.0.clone(),
                document_id: row.1,
                document_title: row.2,
                subject_id: row.3,
                subject_name: row.4,
                workbook_id: row.5,
                workbook_name: row.6,
                segment_id: row.7,
                chapter: row.8,
                section_part: row.9,
                question_type,
                question_number: row.12,
                title: row.13,
                index_confidence: row.14,
                sort_order: row.15,
                current_result,
                attempt_count: row.17,
                incorrect_count: row.18,
                partial_count: row.19,
                regions: load_regions(connection, &row.0)?,
            })
        })
        .collect()
}

fn parse_question_type_with_legacy_fallback(
    stored_type: Option<&str>,
    source_key: &str,
) -> QuestionType {
    stored_type
        .and_then(QuestionType::parse)
        .or_else(|| source_key.split('|').nth(2).and_then(QuestionType::parse))
        .unwrap_or(QuestionType::Other)
}

fn load_regions(
    connection: &Connection,
    question_id: &str,
) -> Result<Vec<QuestionRegion>, QuestionBankError> {
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
                page_number: row.get(3)?,
                x: row.get(4)?,
                y: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                coordinate_version: row.get(8)?,
                sort_order: row.get(9)?,
                created_at: row.get(10)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn load_workspace_id(connection: &Connection) -> Result<String, QuestionBankError> {
    connection
        .query_row(
            "SELECT id FROM workspace ORDER BY created_at LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(QuestionBankError::WorkspaceNotInitialized)
}

fn load_workspace_id_optional(
    connection: &Connection,
) -> Result<Option<String>, QuestionBankError> {
    connection
        .query_row(
            "SELECT id FROM workspace ORDER BY created_at LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)
        .map_err(Into::into)
}

fn load_question_gap_acknowledgements(
    connection: &Connection,
    workspace_id: &str,
) -> Result<Vec<String>, QuestionBankError> {
    let mut statement = connection
        .prepare(
            "SELECT issue_key
             FROM question_gap_acknowledgement
             WHERE workspace_id = ?1
             ORDER BY issue_key COLLATE BINARY",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![workspace_id], |row| row.get::<_, String>(0))
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn activate_incorrect_attempt(
    transaction: &Transaction<'_>,
    question_id: &str,
    attempted_on: &LocalDate,
    attempted_at: i64,
) -> Result<(), QuestionBankError> {
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
                active = 1, updated_at = excluded.updated_at",
            params![question_id, attempted_at],
        )
        .map_err(database_error)?;
    activate_review_state(
        transaction,
        question_id,
        attempted_on,
        attempted_at,
        "learning",
        1,
    )
}

fn activate_partial_attempt(
    transaction: &Transaction<'_>,
    question_id: &str,
    attempted_on: &LocalDate,
    attempted_at: i64,
) -> Result<(), QuestionBankError> {
    transaction
        .execute(
            "INSERT INTO mistake_profile(
                question_id, first_mistake_at, last_mistake_at, mistake_count,
                consecutive_failure_count, active, user_priority, created_at, updated_at
             ) VALUES (?1, NULL, NULL, 0, 0, 1, 3, ?2, ?2)
             ON CONFLICT(question_id) DO UPDATE SET active = 1, updated_at = excluded.updated_at",
            params![question_id, attempted_at],
        )
        .map_err(database_error)?;
    activate_review_state(
        transaction,
        question_id,
        attempted_on,
        attempted_at,
        "uncertain",
        2,
    )
}

fn activate_review_state(
    transaction: &Transaction<'_>,
    question_id: &str,
    attempted_on: &LocalDate,
    attempted_at: i64,
    mastery: &str,
    policy_version: i64,
) -> Result<(), QuestionBankError> {
    transaction
        .execute(
            "INSERT INTO review_state(
                question_id, policy_version, mastery_level, due_date,
                last_reviewed_at, successful_streak, manual_pin_date, suspended_at,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, NULL, 0, NULL, NULL, ?5, ?5)
             ON CONFLICT(question_id) DO UPDATE SET
                mastery_level = excluded.mastery_level,
                due_date = MIN(review_state.due_date, excluded.due_date),
                successful_streak = 0, suspended_at = NULL,
                updated_at = excluded.updated_at",
            params![
                question_id,
                policy_version,
                mastery,
                attempted_on.as_str(),
                attempted_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn is_unique_constraint(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(code, _)
            if code.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use tempfile::{TempDir, tempdir};
    use uuid::Uuid;

    use super::*;
    use crate::application::{
        BulkQuestionAttemptInput, CreateSubjectInput, CreateWorkbookCategoryInput,
        ImportQuestionIndexInput, ImportRequest, IndexedQuestionDraftInput,
        IndexedQuestionRegionUpdateInput, InsertIndexedQuestionInput, QuestionBankUseCases,
        QuestionRegionInput, ReassignWorkbookSegmentInput, RecordBulkQuestionAttemptsInput,
        ReplaceIndexedQuestionRegionsInput, ResourceRepository, RestoreWorkbookSegmentInput,
        ScheduleUseCases, SetQuestionGapAcknowledgementInput, TrashWorkbookSegmentInput,
        UpdateIndexedQuestionInput, WorkbookSegmentAssignmentInput, WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{
        SqliteBlobStore, SqliteScheduleRepository, SqliteWorkspaceRepository,
    };

    #[test]
    fn legacy_missing_question_type_uses_source_key_classification() {
        let parsed = parse_question_type_with_legacy_fallback(None, "第0章 零基础|other|blank|4|1");

        assert_eq!(parsed, QuestionType::Blank);
    }

    #[test]
    fn valid_question_type_takes_precedence_over_source_key() {
        let parsed = parse_question_type_with_legacy_fallback(
            Some("choice"),
            "第0章 零基础|other|blank|4|1",
        );

        assert_eq!(parsed, QuestionType::Choice);
    }

    #[test]
    fn unknown_legacy_question_type_defaults_to_other() {
        let parsed = parse_question_type_with_legacy_fallback(
            Some("legacy-type"),
            "第0章 零基础|other|unclassified|4|1",
        );

        assert_eq!(parsed, QuestionType::Other);
    }

    #[test]
    fn snapshot_accepts_legacy_null_question_type() {
        let (directory, bank, _segment_id, indexed) = question_bank_fixture(1);
        let question_id = indexed.questions[0].id.clone();
        let database_path = directory.path().join("workspaces/default/kystudy.sqlite3");
        let connection = Connection::open(database_path).expect("fixture database should open");
        connection
            .execute(
                "UPDATE question SET question_type = NULL WHERE id = ?1",
                rusqlite::params![question_id],
            )
            .expect("legacy question type should be cleared");
        connection
            .execute(
                "UPDATE question_index_metadata
                 SET source_key = '第0章 零基础|other|blank|4|1'
                 WHERE question_id = ?1",
                rusqlite::params![indexed.questions[0].id],
            )
            .expect("legacy source key should be restored");
        drop(connection);

        let snapshot = bank
            .snapshot()
            .expect("legacy null question type should not block snapshot loading");

        assert_eq!(snapshot.questions[0].question_type, QuestionType::Blank);
    }

    #[test]
    fn question_gap_acknowledgements_are_sorted_and_idempotent() {
        let directory = tempdir().expect("temporary directory should exist");
        let workspace = SqliteWorkspaceRepository::new(directory.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let bank = QuestionBankUseCases::new(SqliteQuestionBankRepository::new(directory.path()));

        let listed = bank
            .set_question_gap_acknowledgement(&SetQuestionGapAcknowledgementInput {
                issue_key: " jump|question-z ".to_owned(),
                acknowledged: true,
            })
            .expect("jump issue should be acknowledged");
        assert_eq!(listed, vec!["jump|question-z"]);

        let listed = bank
            .set_question_gap_acknowledgement(&SetQuestionGapAcknowledgementInput {
                issue_key: "duplicate|question-a".to_owned(),
                acknowledged: true,
            })
            .expect("duplicate issue should be acknowledged");
        assert_eq!(listed, vec!["duplicate|question-a", "jump|question-z"]);

        let listed = bank
            .set_question_gap_acknowledgement(&SetQuestionGapAcknowledgementInput {
                issue_key: "duplicate|question-a".to_owned(),
                acknowledged: true,
            })
            .expect("repeating acknowledgement should be idempotent");
        assert_eq!(listed, vec!["duplicate|question-a", "jump|question-z"]);

        let reopened =
            QuestionBankUseCases::new(SqliteQuestionBankRepository::new(directory.path()))
                .question_gap_acknowledgements()
                .expect("acknowledgements should survive reopen");
        assert_eq!(reopened, vec!["duplicate|question-a", "jump|question-z"]);

        let listed = bank
            .set_question_gap_acknowledgement(&SetQuestionGapAcknowledgementInput {
                issue_key: "jump|question-z".to_owned(),
                acknowledged: false,
            })
            .expect("jump issue should be restored");
        assert_eq!(listed, vec!["duplicate|question-a"]);
    }

    #[test]
    fn question_gap_acknowledgement_list_is_empty_without_workspace() {
        let directory = tempdir().expect("temporary directory should exist");
        let bank = QuestionBankUseCases::new(SqliteQuestionBankRepository::new(directory.path()));

        let listed = bank
            .question_gap_acknowledgements()
            .expect("missing workspace should return an empty list");

        assert!(listed.is_empty());
    }

    #[test]
    fn question_gap_acknowledgement_set_requires_workspace() {
        let directory = tempdir().expect("temporary directory should exist");
        let bank = QuestionBankUseCases::new(SqliteQuestionBankRepository::new(directory.path()));

        let error = bank
            .set_question_gap_acknowledgement(&SetQuestionGapAcknowledgementInput {
                issue_key: "duplicate|question-a".to_owned(),
                acknowledged: true,
            })
            .expect_err("setting without a workspace should fail");

        assert!(matches!(error, QuestionBankError::WorkspaceNotInitialized));
    }

    #[test]
    fn indexed_question_round_trip_preserves_hierarchy_regions_and_attempt_history() {
        let directory = tempdir().expect("temporary directory should exist");
        let workspace = SqliteWorkspaceRepository::new(directory.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let source = directory.path().join("880.pdf");
        std::fs::write(&source, b"indexed-question-fixture").expect("fixture should write");
        let resources = SqliteBlobStore::new(directory.path());
        let document = resources
            .import_file(
                &source,
                &ImportRequest {
                    job_id: Uuid::now_v7().to_string(),
                    document_id: Uuid::now_v7().to_string(),
                    title: "880 高数".to_owned(),
                    kind: "pdf".to_owned(),
                    mime_type: "application/pdf".to_owned(),
                    created_at: 1_700_000_000_001,
                },
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .expect("PDF should import");
        resources
            .save_reading_progress(&document.id, 97, 1)
            .expect("page count should persist");
        let schedules = ScheduleUseCases::new(SqliteScheduleRepository::new(directory.path()));
        let subject = schedules
            .create_subject(&CreateSubjectInput {
                name: "高等数学".to_owned(),
                color_key: "blue".to_owned(),
                sort_order: 0,
            })
            .expect("subject should create");
        let bank = QuestionBankUseCases::new(SqliteQuestionBankRepository::new(directory.path()));
        let workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "880".to_owned(),
            })
            .expect("workbook should create");
        let segment = bank
            .save_segments(vec![WorkbookSegmentAssignmentInput {
                document_id: document.id,
                subject_id: subject.id,
                workbook_id: workbook.id,
                source_heading: "高等数学篇".to_owned(),
                page_start: 2,
                page_end: 97,
            }])
            .expect("segment should create")
            .remove(0);
        let indexed = bank
            .import_index(ImportQuestionIndexInput {
                segment_id: segment.id,
                questions: vec![IndexedQuestionDraftInput {
                    source_key: "第一章|basic|blank|3|4".to_owned(),
                    title: "第 3 题".to_owned(),
                    chapter: "第一章 函数、极限、连续".to_owned(),
                    section_part: "basic".to_owned(),
                    question_type: "blank".to_owned(),
                    question_number: "3".to_owned(),
                    index_confidence: 0.96,
                    regions: vec![QuestionRegionInput {
                        page_number: 4,
                        x: 0.07,
                        y: 0.2,
                        width: 0.86,
                        height: 0.15,
                    }],
                }],
            })
            .expect("index should import");
        let question_id = indexed.questions[0].id.clone();
        let practiced = bank
            .record_attempts(RecordBulkQuestionAttemptsInput {
                attempted_on: "2026-08-01".to_owned(),
                entries: vec![BulkQuestionAttemptInput {
                    question_id: question_id.clone(),
                    result: "uncertain".to_owned(),
                }],
            })
            .expect("attempt should persist");

        assert_eq!(
            (
                practiced.questions[0].workbook_name.as_str(),
                practiced.questions[0].regions.len(),
                practiced.questions[0].partial_count,
            ),
            ("880", 1, 1),
        );

        assert_indexed_regions_can_be_replaced(&bank, &practiced, &question_id);
        assert_questions_can_be_inserted_around_anchor(&bank, &question_id);

        assert_indexed_question_can_be_edited_and_trashed(&bank, &question_id);
    }

    #[test]
    fn segment_trash_hides_questions_preserves_history_and_resaves_restore() {
        let (directory, bank, segment_id, indexed) = question_bank_fixture(2);
        let segment = bank
            .snapshot()
            .expect("segment snapshot should load")
            .segments
            .into_iter()
            .find(|segment| segment.id == segment_id)
            .expect("fixture segment should be present");
        let question_ids = indexed
            .questions
            .iter()
            .map(|question| question.id.clone())
            .collect::<Vec<_>>();
        bank.record_attempts(RecordBulkQuestionAttemptsInput {
            attempted_on: "2026-08-01".to_owned(),
            entries: vec![BulkQuestionAttemptInput {
                question_id: question_ids[0].clone(),
                result: "incorrect".to_owned(),
            }],
        })
        .expect("attempt should persist before segment trash");

        let trashed = bank
            .trash_segment(&TrashWorkbookSegmentInput {
                segment_id: segment_id.clone(),
            })
            .expect("segment should move to trash");
        assert!(trashed.segments.is_empty());
        assert!(trashed.questions.is_empty());

        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should reopen");
        let retained: (i64, i64, i64, i64, i64) = connection
            .query_row(
                "SELECT
                     (SELECT COUNT(*) FROM question_index_metadata WHERE segment_id = ?1),
                     (SELECT COUNT(*) FROM question_region WHERE question_id = ?2),
                     (SELECT COUNT(*) FROM question_attempt WHERE question_id = ?2),
                     (SELECT COUNT(*) FROM mistake_profile WHERE question_id = ?2),
                     (SELECT COUNT(*) FROM review_state WHERE question_id = ?2)",
                params![segment_id, question_ids[0]],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .expect("history rows should remain after segment trash");
        assert_eq!(retained, (2, 1, 1, 1, 1));
        let foreign_key_violations = connection
            .prepare("PRAGMA foreign_key_check")
            .expect("foreign key check should prepare")
            .query_map([], |_| Ok(()))
            .expect("foreign key check should run")
            .count();
        assert_eq!(foreign_key_violations, 0);

        let duplicate_trash = bank
            .trash_segment(&TrashWorkbookSegmentInput {
                segment_id: segment_id.clone(),
            })
            .expect_err("already trashed segment should be rejected");
        assert!(matches!(
            duplicate_trash,
            QuestionBankError::SegmentNotActive
        ));

        let restored = bank
            .save_segments(vec![WorkbookSegmentAssignmentInput {
                document_id: segment.document_id,
                subject_id: segment.subject_id,
                workbook_id: segment.workbook_id,
                source_heading: segment.source_heading,
                page_start: segment.page_start,
                page_end: segment.page_end,
            }])
            .expect("saving the same segment should restore it");
        assert_eq!(restored.len(), 1);
        let restored_snapshot = bank.snapshot().expect("restored snapshot should load");
        assert_eq!(
            restored_snapshot
                .questions
                .iter()
                .map(|question| question.id.as_str())
                .collect::<Vec<_>>(),
            question_ids.iter().map(String::as_str).collect::<Vec<_>>()
        );
        assert_eq!(restored_snapshot.questions[0].attempt_count, 1);
    }

    #[test]
    fn segment_restore_does_not_revive_question_trashed_before_segment() {
        let (directory, bank, segment_id, indexed) = question_bank_fixture(2);
        let first_id = indexed.questions[0].id.clone();
        let second_id = indexed.questions[1].id.clone();
        let segment = bank
            .snapshot()
            .expect("segment snapshot should load")
            .segments
            .into_iter()
            .find(|segment| segment.id == segment_id)
            .expect("fixture segment should be present");
        bank.trash_question(&first_id)
            .expect("single question should move to trash first");
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: segment_id.clone(),
        })
        .expect("segment should move to trash");
        bank.save_segments(vec![WorkbookSegmentAssignmentInput {
            document_id: segment.document_id,
            subject_id: segment.subject_id,
            workbook_id: segment.workbook_id,
            source_heading: segment.source_heading,
            page_start: segment.page_start,
            page_end: segment.page_end,
        }])
        .expect("same segment should restore");

        let reimported = bank
            .import_index(ImportQuestionIndexInput {
                segment_id,
                questions: vec![
                    IndexedQuestionDraftInput {
                        source_key: "fixture-question-0".to_owned(),
                        title: "Reimported deleted question".to_owned(),
                        chapter: "Fixture chapter".to_owned(),
                        section_part: "basic".to_owned(),
                        question_type: "blank".to_owned(),
                        question_number: "1".to_owned(),
                        index_confidence: 0.98,
                        regions: vec![QuestionRegionInput {
                            page_number: 2,
                            x: 0.1,
                            y: 0.1,
                            width: 0.4,
                            height: 0.2,
                        }],
                    },
                    IndexedQuestionDraftInput {
                        source_key: "fixture-question-1".to_owned(),
                        title: "Reimported active question".to_owned(),
                        chapter: "Fixture chapter".to_owned(),
                        section_part: "basic".to_owned(),
                        question_type: "blank".to_owned(),
                        question_number: "2".to_owned(),
                        index_confidence: 0.98,
                        regions: vec![QuestionRegionInput {
                            page_number: 3,
                            x: 0.1,
                            y: 0.1,
                            width: 0.4,
                            height: 0.2,
                        }],
                    },
                ],
            })
            .expect("reimport should keep the earlier single-question trash state");
        assert_eq!(reimported.questions.len(), 1);
        assert_eq!(reimported.questions[0].id, second_id);
        assert_eq!(reimported.questions[0].title, "Reimported active question");

        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should reopen");
        let first_deleted_at: Option<i64> = connection
            .query_row(
                "SELECT deleted_at FROM question WHERE id = ?1",
                params![first_id],
                |row| row.get(0),
            )
            .expect("single trashed question should remain deleted");
        assert!(first_deleted_at.is_some());
    }

    #[test]
    fn trashed_segment_list_is_stable_and_excludes_active_segments() {
        let (_directory, bank, segment_id, _indexed) = question_bank_fixture(1);
        assert_eq!(bank.list_trashed_workbook_segments().unwrap().len(), 0);
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: segment_id.clone(),
        })
        .expect("segment should move to trash");

        let first = bank
            .list_trashed_workbook_segments()
            .expect("trashed segment list should load");
        let second = bank
            .list_trashed_workbook_segments()
            .expect("repeated trashed segment list should load");
        assert_eq!(first, second);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].id, segment_id);
        assert_eq!(first[0].restorable_question_count, 1);
        assert_eq!(first[0].question_count, 0);
        assert_eq!(first[0].index_state, "pending");
        assert!(
            bank.snapshot()
                .expect("active snapshot should load")
                .segments
                .is_empty()
        );
    }

    #[test]
    fn explicit_segment_restore_preserves_ids_history_regions_and_recomputes_state() {
        let (_directory, bank, segment_id, indexed) = question_bank_fixture(2);
        let question_id = indexed.questions[0].id.clone();
        let reimported = bank
            .import_index(ImportQuestionIndexInput {
                segment_id: segment_id.clone(),
                questions: vec![IndexedQuestionDraftInput {
                    source_key: "fixture-question-0".to_owned(),
                    title: "Low-confidence fixture question".to_owned(),
                    chapter: "Fixture chapter".to_owned(),
                    section_part: "basic".to_owned(),
                    question_type: "blank".to_owned(),
                    question_number: "1".to_owned(),
                    index_confidence: 0.4,
                    regions: vec![QuestionRegionInput {
                        page_number: 2,
                        x: 0.1,
                        y: 0.1,
                        width: 0.4,
                        height: 0.2,
                    }],
                }],
            })
            .expect("low-confidence reimport should persist");
        let region_id = reimported.questions[0].regions[0].id.clone();
        bank.record_attempts(RecordBulkQuestionAttemptsInput {
            attempted_on: "2026-08-01".to_owned(),
            entries: vec![BulkQuestionAttemptInput {
                question_id: question_id.clone(),
                result: "incorrect".to_owned(),
            }],
        })
        .expect("attempt should persist before segment trash");
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: segment_id.clone(),
        })
        .expect("segment should move to trash");
        let deleted_at = bank
            .list_trashed_workbook_segments()
            .expect("trash list should load")[0]
            .deleted_at;

        let restored = bank
            .restore_workbook_segment(&RestoreWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                expected_deleted_at: deleted_at,
            })
            .expect("segment should restore explicitly");
        let segment = restored
            .segments
            .iter()
            .find(|segment| segment.id == segment_id)
            .expect("restored segment should be visible");
        assert_eq!(
            (segment.id.as_str(), segment.question_count),
            (segment_id.as_str(), 2)
        );
        assert_eq!(segment.index_state, "needs_review");
        let restored_question = restored
            .questions
            .iter()
            .find(|question| question.id == question_id)
            .expect("restored question should be visible");
        assert_eq!(restored_question.regions[0].id, region_id);
        assert_eq!(restored_question.attempt_count, 1);
        assert!(
            bank.list_trashed_workbook_segments()
                .expect("trash list should reload")
                .is_empty()
        );
    }

    #[test]
    fn explicit_segment_restore_keeps_previously_trashed_question_deleted() {
        let (directory, bank, segment_id, indexed) = question_bank_fixture(2);
        let first_id = indexed.questions[0].id.clone();
        let second_id = indexed.questions[1].id.clone();
        bank.trash_question(&first_id)
            .expect("single question should move to trash first");
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: segment_id.clone(),
        })
        .expect("segment should move to trash");
        let deleted_at = bank
            .list_trashed_workbook_segments()
            .expect("trash list should load")[0]
            .deleted_at;

        let restored = bank
            .restore_workbook_segment(&RestoreWorkbookSegmentInput {
                segment_id,
                expected_deleted_at: deleted_at,
            })
            .expect("segment should restore explicitly");
        assert_eq!(restored.questions.len(), 1);
        assert_eq!(restored.questions[0].id, second_id);

        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should reopen");
        let first_deleted_at: Option<i64> = connection
            .query_row(
                "SELECT deleted_at FROM question WHERE id = ?1",
                params![first_id],
                |row| row.get(0),
            )
            .expect("single trashed question should remain deleted");
        assert!(first_deleted_at.is_some());
    }

    #[test]
    fn explicit_segment_restore_conflict_leaves_trash_unchanged() {
        let (directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot
            .segments
            .into_iter()
            .find(|segment| segment.id == segment_id)
            .expect("fixture segment should be present");
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: segment_id.clone(),
        })
        .expect("segment should move to trash");
        let deleted_at = bank
            .list_trashed_workbook_segments()
            .expect("trash list should load")[0]
            .deleted_at;
        let other_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Other workbook".to_owned(),
            })
            .expect("other workbook should create");
        bank.save_segments(vec![WorkbookSegmentAssignmentInput {
            document_id: segment.document_id,
            subject_id: segment.subject_id,
            workbook_id: other_workbook.id,
            source_heading: segment.source_heading,
            page_start: segment.page_start,
            page_end: segment.page_end,
        }])
        .expect("other workbook should take the free exact range");

        let error = bank
            .restore_workbook_segment(&RestoreWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                expected_deleted_at: deleted_at,
            })
            .expect_err("active other-workbook range should block restore");
        assert_eq!(error.code(), "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT");

        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should reopen");
        let persisted_deleted_at: Option<i64> = connection
            .query_row(
                "SELECT deleted_at FROM workbook_document_segment WHERE id = ?1",
                params![segment_id],
                |row| row.get(0),
            )
            .expect("segment should remain persisted");
        assert_eq!(persisted_deleted_at, Some(deleted_at));
        assert_eq!(
            bank.list_trashed_workbook_segments()
                .expect("trash list should remain available")
                .len(),
            1
        );
    }

    #[test]
    fn explicit_segment_restore_rejects_stale_expected_deleted_at_without_writes() {
        let (directory, bank, segment_id, _indexed) = question_bank_fixture(1);
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: segment_id.clone(),
        })
        .expect("segment should move to trash");
        let deleted_at = bank
            .list_trashed_workbook_segments()
            .expect("trash list should load")[0]
            .deleted_at;
        let error = bank
            .restore_workbook_segment(&RestoreWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                expected_deleted_at: deleted_at + 1,
            })
            .expect_err("stale restore precondition should fail");
        assert!(matches!(error, QuestionBankError::SegmentRestoreStale));
        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should reopen");
        let persisted_deleted_at: Option<i64> = connection
            .query_row(
                "SELECT deleted_at FROM workbook_document_segment WHERE id = ?1",
                params![segment_id],
                |row| row.get(0),
            )
            .expect("segment should remain persisted");
        assert_eq!(persisted_deleted_at, Some(deleted_at));
    }

    #[test]
    fn explicit_segment_restore_rejects_unavailable_subject_without_writes() {
        let (directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let subject_id = snapshot.segments[0].subject_id.clone();
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: segment_id.clone(),
        })
        .expect("segment should move to trash");
        let deleted_at = bank
            .list_trashed_workbook_segments()
            .expect("trash list should load")[0]
            .deleted_at;
        let schedules = ScheduleUseCases::new(SqliteScheduleRepository::new(directory.path()));
        schedules
            .archive_subject(&subject_id)
            .expect("subject should archive");

        let error = bank
            .restore_workbook_segment(&RestoreWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                expected_deleted_at: deleted_at,
            })
            .expect_err("archived subject should block restore");
        assert!(matches!(error, QuestionBankError::SubjectNotFound));
        assert_eq!(
            bank.list_trashed_workbook_segments()
                .expect("trash list should remain available")
                .len(),
            1
        );
    }

    #[test]
    fn active_segment_reassignment_updates_metadata_and_preserves_history() {
        let (directory, bank, segment_id, indexed) = question_bank_fixture(1);
        let question_id = indexed.questions[0].id.clone();
        let original_workbook_id = indexed.questions[0].workbook_id.clone();
        let original_segment = bank
            .snapshot()
            .expect("snapshot should load")
            .segments
            .into_iter()
            .find(|segment| segment.id == segment_id)
            .expect("segment should exist");
        bank.record_attempts(RecordBulkQuestionAttemptsInput {
            attempted_on: "2026-08-01".to_owned(),
            entries: vec![BulkQuestionAttemptInput {
                question_id: question_id.clone(),
                result: "incorrect".to_owned(),
            }],
        })
        .expect("attempt should persist");
        let repository = SqliteQuestionBankRepository::new(directory.path());
        let before_ids: (String, String, String) = repository
            .open()
            .expect("database should open")
            .query_row(
                "SELECT r.id, a.id, rs.question_id
                 FROM question_region r
                 JOIN question_attempt a ON a.question_id = r.question_id
                 JOIN review_state rs ON rs.question_id = r.question_id
                 WHERE r.question_id = ?1
                 ORDER BY a.attempted_at, a.id
                 LIMIT 1",
                params![question_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("history IDs should load");
        let target_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Reassigned workbook".to_owned(),
            })
            .expect("target workbook should create");

        let reassigned = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                target_workbook_id: target_workbook.id.clone(),
                expected_updated_at: original_segment.updated_at,
                expected_deleted_at: None,
            })
            .expect("active segment should reassign");
        let reassigned_segment = reassigned
            .segments
            .iter()
            .find(|segment| segment.id == segment_id)
            .expect("reassigned segment should remain active");
        let reassigned_question = reassigned
            .questions
            .iter()
            .find(|question| question.id == question_id)
            .expect("question should remain active");
        assert_eq!(reassigned_segment.workbook_id, target_workbook.id);
        assert_ne!(reassigned_segment.updated_at, original_segment.updated_at);
        assert_eq!(reassigned_question.workbook_id, target_workbook.id);
        assert_eq!(reassigned_question.regions[0].id, before_ids.0);
        assert_eq!(reassigned_question.attempt_count, 1);

        let connection = repository.open().expect("database should reopen");
        let metadata_workbook_id: String = connection
            .query_row(
                "SELECT workbook_id FROM question_index_metadata WHERE segment_id = ?1",
                params![segment_id],
                |row| row.get(0),
            )
            .expect("metadata should remain");
        let after_ids: (String, String, String) = connection
            .query_row(
                "SELECT r.id, a.id, rs.question_id
                 FROM question_region r
                 JOIN question_attempt a ON a.question_id = r.question_id
                 JOIN review_state rs ON rs.question_id = r.question_id
                 WHERE r.question_id = ?1
                 ORDER BY a.attempted_at, a.id
                 LIMIT 1",
                params![question_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("history IDs should remain");
        assert_eq!(metadata_workbook_id, target_workbook.id);
        assert_eq!(after_ids, before_ids);
        assert_ne!(original_workbook_id, target_workbook.id);
        let foreign_key_violations = connection
            .prepare("PRAGMA foreign_key_check")
            .expect("foreign key check should prepare")
            .query_map([], |_| Ok(()))
            .expect("foreign key check should run")
            .count();
        assert_eq!(foreign_key_violations, 0);
    }

    #[test]
    fn active_segment_reassignment_same_workbook_is_idempotent() {
        let (_directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot
            .segments
            .iter()
            .find(|segment| segment.id == segment_id)
            .expect("segment should exist");
        let first = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                target_workbook_id: segment.workbook_id.clone(),
                expected_updated_at: segment.updated_at,
                expected_deleted_at: None,
            })
            .expect("same workbook reassignment should be a no-op");
        let first_segment = first
            .segments
            .iter()
            .find(|value| value.id == segment_id)
            .expect("segment should remain active");
        assert_eq!(first_segment.updated_at, segment.updated_at);
        let second = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id,
                target_workbook_id: first_segment.workbook_id.clone(),
                expected_updated_at: first_segment.updated_at,
                expected_deleted_at: None,
            })
            .expect("repeating the no-op should remain idempotent");
        assert_eq!(second.segments[0].updated_at, segment.updated_at);
    }

    #[test]
    fn trashed_segment_reassignment_is_rejected_without_writes() {
        let (directory, bank, segment_id, _indexed) = question_bank_fixture(1);
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: segment_id.clone(),
        })
        .expect("segment should move to trash");
        let trashed = bank
            .list_trashed_workbook_segments()
            .expect("trash list should load")[0]
            .clone();
        let target_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Rejected target".to_owned(),
            })
            .expect("target workbook should create");
        let stale_error = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                target_workbook_id: target_workbook.id.clone(),
                expected_updated_at: trashed.updated_at,
                expected_deleted_at: Some(trashed.deleted_at + 1),
            })
            .expect_err("stale deleted_at should be rejected");
        assert!(matches!(
            stale_error,
            QuestionBankError::SegmentReassignStale
        ));
        let error = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                target_workbook_id: target_workbook.id,
                expected_updated_at: trashed.updated_at,
                expected_deleted_at: Some(trashed.deleted_at),
            })
            .expect_err("trashed segment should not be reassigned");
        assert!(matches!(error, QuestionBankError::SegmentNotActive));
        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should reopen");
        let persisted: (String, Option<i64>, i64) = connection
            .query_row(
                "SELECT workbook_id, deleted_at, updated_at
                 FROM workbook_document_segment WHERE id = ?1",
                params![segment_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("trashed segment should remain");
        assert_eq!(persisted.0, trashed.workbook_id);
        assert_eq!(persisted.1, Some(trashed.deleted_at));
        assert_eq!(persisted.2, trashed.updated_at);
    }

    #[test]
    fn active_segment_reassignment_rejects_stale_updated_at() {
        let (directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot.segments[0].clone();
        let target_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Stale target".to_owned(),
            })
            .expect("target workbook should create");
        let error = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                target_workbook_id: target_workbook.id,
                expected_updated_at: segment.updated_at + 1,
                expected_deleted_at: None,
            })
            .expect_err("stale updated_at should be rejected");
        assert!(matches!(error, QuestionBankError::SegmentReassignStale));
        let persisted = bank.snapshot().expect("snapshot should remain readable");
        assert_eq!(persisted.segments[0].workbook_id, segment.workbook_id);
        let connection = SqliteQuestionBankRepository::new(directory.path())
            .open()
            .expect("database should reopen");
        let foreign_key_violations = connection
            .prepare("PRAGMA foreign_key_check")
            .expect("foreign key check should prepare")
            .query_map([], |_| Ok(()))
            .expect("foreign key check should run")
            .count();
        assert_eq!(foreign_key_violations, 0);
    }

    #[test]
    fn active_segment_reassignment_rejects_exact_trashed_target_without_writes() {
        let (directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot.segments[0].clone();
        let target_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Trashed target".to_owned(),
            })
            .expect("target workbook should create");
        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should open");
        let workspace_id: String = connection
            .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
            .expect("workspace should exist");
        let trashed_target_id = Uuid::now_v7().to_string();
        connection
            .execute(
                "INSERT INTO workbook_document_segment(
                    id, workspace_id, document_id, subject_id, workbook_id,
                    source_heading, page_start, page_end, index_state,
                    question_count, deleted_at, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', 0, NULL, ?9, ?9)",
                params![
                    trashed_target_id,
                    workspace_id,
                    segment.document_id,
                    segment.subject_id,
                    target_workbook.id,
                    segment.source_heading,
                    i64::from(segment.page_start),
                    i64::from(segment.page_end),
                    segment.created_at,
                ],
            )
            .expect("target segment should insert");
        drop(connection);
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: trashed_target_id,
        })
        .expect("target segment should move to trash");
        let error = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                target_workbook_id: target_workbook.id,
                expected_updated_at: segment.updated_at,
                expected_deleted_at: None,
            })
            .expect_err("trashed target should occupy the exact unique identity");
        assert_eq!(error.code(), "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT");
        let persisted = bank.snapshot().expect("snapshot should remain readable");
        assert_eq!(persisted.segments[0].id, segment_id);
        assert_eq!(persisted.segments[0].workbook_id, segment.workbook_id);
    }

    #[test]
    fn active_segment_reassignment_rejects_exact_active_sibling_without_writes() {
        let (directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot.segments[0].clone();
        let target_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Active sibling target".to_owned(),
            })
            .expect("target workbook should create");
        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should open");
        let workspace_id: String = connection
            .query_row("SELECT id FROM workspace LIMIT 1", [], |row| row.get(0))
            .expect("workspace should exist");
        connection
            .execute(
                "INSERT INTO workbook_document_segment(
                    id, workspace_id, document_id, subject_id, workbook_id,
                    source_heading, page_start, page_end, index_state,
                    question_count, deleted_at, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', 0, NULL, ?9, ?9)",
                params![
                    Uuid::now_v7().to_string(),
                    workspace_id,
                    segment.document_id,
                    segment.subject_id,
                    target_workbook.id,
                    segment.source_heading,
                    i64::from(segment.page_start),
                    i64::from(segment.page_end),
                    segment.created_at,
                ],
            )
            .expect("active sibling should insert");
        drop(connection);
        let error = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                target_workbook_id: target_workbook.id,
                expected_updated_at: segment.updated_at,
                expected_deleted_at: None,
            })
            .expect_err("active exact sibling should block reassignment");
        assert_eq!(error.code(), "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT");
        let persisted = bank.snapshot().expect("snapshot should remain readable");
        assert!(
            persisted.segments.iter().any(|value| {
                value.id == segment_id && value.workbook_id == segment.workbook_id
            })
        );
    }

    #[test]
    fn active_segment_reassignment_allows_same_pages_for_different_subject() {
        let (directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot.segments[0].clone();
        let target_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Subject-isolated target".to_owned(),
            })
            .expect("target workbook should create");
        let schedules = ScheduleUseCases::new(SqliteScheduleRepository::new(directory.path()));
        let other_subject = schedules
            .create_subject(&CreateSubjectInput {
                name: "Other subject for reassignment".to_owned(),
                color_key: "green".to_owned(),
                sort_order: 1,
            })
            .expect("other subject should create");
        bank.save_segments(vec![WorkbookSegmentAssignmentInput {
            document_id: segment.document_id.clone(),
            subject_id: other_subject.id,
            workbook_id: target_workbook.id.clone(),
            source_heading: "Same pages, other subject".to_owned(),
            page_start: segment.page_start,
            page_end: segment.page_end,
        }])
        .expect("different subject should not conflict");
        let reassigned = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id,
                target_workbook_id: target_workbook.id,
                expected_updated_at: segment.updated_at,
                expected_deleted_at: None,
            })
            .expect("different subject should be isolated");
        assert_eq!(reassigned.segments.len(), 2);
    }

    #[test]
    fn active_segment_reassignment_repairs_inconsistent_metadata_atomically() {
        let (directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot.segments[0].clone();
        let other_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Metadata repair target".to_owned(),
            })
            .expect("other workbook should create");
        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should open");
        connection
            .execute(
                "UPDATE question_index_metadata SET workbook_id = ?1 WHERE segment_id = ?2",
                params![other_workbook.id, segment_id],
            )
            .expect("fixture metadata should be made inconsistent");
        drop(connection);
        let repaired = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                target_workbook_id: segment.workbook_id.clone(),
                expected_updated_at: segment.updated_at,
                expected_deleted_at: None,
            })
            .expect("same-workbook reassignment should repair metadata");
        assert!(repaired.segments[0].updated_at > segment.updated_at);
        let connection = repository.open().expect("database should reopen");
        let metadata_workbook: String = connection
            .query_row(
                "SELECT workbook_id FROM question_index_metadata WHERE segment_id = ?1",
                params![segment_id],
                |row| row.get(0),
            )
            .expect("metadata should be repaired");
        assert_eq!(metadata_workbook, segment.workbook_id);
    }

    #[test]
    fn active_segment_reassignment_rolls_back_when_metadata_write_fails() {
        let (directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot.segments[0].clone();
        let target_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Rollback target".to_owned(),
            })
            .expect("target workbook should create");
        let repository = SqliteQuestionBankRepository::new(directory.path());
        let connection = repository.open().expect("database should open");
        connection
            .execute_batch(&format!(
                "CREATE TRIGGER fail_reassign_metadata
                 BEFORE UPDATE OF workbook_id ON question_index_metadata
                 WHEN NEW.segment_id = '{segment_id}'
                 BEGIN SELECT RAISE(ABORT, 'injected reassignment failure'); END;"
            ))
            .expect("failure trigger should create");
        drop(connection);
        let error = bank
            .reassign_workbook_segment(&ReassignWorkbookSegmentInput {
                segment_id: segment_id.clone(),
                target_workbook_id: target_workbook.id,
                expected_updated_at: segment.updated_at,
                expected_deleted_at: None,
            })
            .expect_err("metadata failure should abort reassignment");
        assert_eq!(error.code(), "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT");
        let persisted = bank.snapshot().expect("snapshot should remain readable");
        assert_eq!(persisted.segments[0].workbook_id, segment.workbook_id);
        assert_eq!(persisted.segments[0].updated_at, segment.updated_at);
    }

    #[test]
    fn active_segment_assignment_conflict_blocks_other_workbook() {
        let (_directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot
            .segments
            .into_iter()
            .find(|segment| segment.id == segment_id)
            .expect("fixture segment should be present");
        let other_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Other workbook".to_owned(),
            })
            .expect("other workbook should create");

        let error = bank
            .save_segments(vec![WorkbookSegmentAssignmentInput {
                document_id: segment.document_id.clone(),
                subject_id: segment.subject_id.clone(),
                workbook_id: other_workbook.id,
                source_heading: segment.source_heading.clone(),
                page_start: segment.page_start,
                page_end: segment.page_end,
            }])
            .expect_err("an active range cannot move to another workbook");

        assert_eq!(error.code(), "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT");
        let QuestionBankError::SegmentAssignmentConflict { conflicts } = error else {
            panic!("expected a typed segment assignment conflict");
        };
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].existing_segment_id, segment_id);
        assert_eq!(conflicts[0].existing_workbook_id, segment.workbook_id);

        let persisted = bank.snapshot().expect("snapshot should remain unchanged");
        assert_eq!(persisted.segments.len(), 1);
        assert_eq!(persisted.segments[0].id, segment_id);
    }

    #[test]
    fn active_segment_assignment_same_workbook_is_idempotent() {
        let (_directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot
            .segments
            .into_iter()
            .find(|segment| segment.id == segment_id)
            .expect("fixture segment should be present");

        let saved = bank
            .save_segments(vec![WorkbookSegmentAssignmentInput {
                document_id: segment.document_id,
                subject_id: segment.subject_id,
                workbook_id: segment.workbook_id,
                source_heading: "Updated heading".to_owned(),
                page_start: segment.page_start,
                page_end: segment.page_end,
            }])
            .expect("the same active workbook range should be idempotent");

        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].id, segment_id);
        assert_eq!(saved[0].source_heading, "Updated heading");
    }

    #[test]
    fn same_range_for_different_subjects_is_allowed_in_one_batch() {
        let (directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot
            .segments
            .into_iter()
            .find(|segment| segment.id == segment_id)
            .expect("fixture segment should be present");
        let schedules = ScheduleUseCases::new(SqliteScheduleRepository::new(directory.path()));
        let other_subject = schedules
            .create_subject(&CreateSubjectInput {
                name: "Other subject".to_owned(),
                color_key: "green".to_owned(),
                sort_order: 1,
            })
            .expect("other subject should create");

        let saved = bank
            .save_segments(vec![
                WorkbookSegmentAssignmentInput {
                    document_id: segment.document_id.clone(),
                    subject_id: segment.subject_id,
                    workbook_id: segment.workbook_id.clone(),
                    source_heading: segment.source_heading.clone(),
                    page_start: segment.page_start,
                    page_end: segment.page_end,
                },
                WorkbookSegmentAssignmentInput {
                    document_id: segment.document_id,
                    subject_id: other_subject.id.clone(),
                    workbook_id: segment.workbook_id,
                    source_heading: "Other subject range".to_owned(),
                    page_start: segment.page_start,
                    page_end: segment.page_end,
                },
            ])
            .expect("a mixed PDF may reuse a range for another subject");

        assert_eq!(saved.len(), 2);
        assert!(
            saved
                .iter()
                .any(|value| value.subject_id == other_subject.id)
        );
    }

    #[test]
    fn segment_assignment_conflict_rolls_back_the_entire_batch() {
        let (_directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot
            .segments
            .into_iter()
            .find(|segment| segment.id == segment_id)
            .expect("fixture segment should be present");
        let other_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Other workbook".to_owned(),
            })
            .expect("other workbook should create");

        let error = bank
            .save_segments(vec![
                WorkbookSegmentAssignmentInput {
                    document_id: segment.document_id.clone(),
                    subject_id: segment.subject_id.clone(),
                    workbook_id: segment.workbook_id.clone(),
                    source_heading: "Contained range".to_owned(),
                    page_start: 2,
                    page_end: 5,
                },
                WorkbookSegmentAssignmentInput {
                    document_id: segment.document_id,
                    subject_id: segment.subject_id,
                    workbook_id: other_workbook.id,
                    source_heading: segment.source_heading,
                    page_start: segment.page_start,
                    page_end: segment.page_end,
                },
            ])
            .expect_err("one conflicting assignment should reject the whole batch");

        assert_eq!(error.code(), "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT");
        let persisted = bank.snapshot().expect("snapshot should remain unchanged");
        assert_eq!(persisted.segments.len(), 1);
        assert_eq!(persisted.segments[0].id, segment_id);
    }

    #[test]
    fn only_trashed_other_workbook_range_allows_new_target() {
        let (_directory, bank, segment_id, snapshot) = question_bank_fixture(1);
        let segment = snapshot
            .segments
            .into_iter()
            .find(|segment| segment.id == segment_id)
            .expect("fixture segment should be present");
        bank.trash_segment(&TrashWorkbookSegmentInput {
            segment_id: segment_id.clone(),
        })
        .expect("fixture segment should move to trash");
        let other_workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Other workbook".to_owned(),
            })
            .expect("other workbook should create");

        let saved = bank
            .save_segments(vec![WorkbookSegmentAssignmentInput {
                document_id: segment.document_id,
                subject_id: segment.subject_id,
                workbook_id: other_workbook.id.clone(),
                source_heading: segment.source_heading,
                page_start: segment.page_start,
                page_end: segment.page_end,
            }])
            .expect("a trashed range in another workbook should not block a new target");

        assert_eq!(saved.len(), 1);
        assert_ne!(saved[0].id, segment_id);
        assert_eq!(saved[0].workbook_id, other_workbook.id);
    }

    #[test]
    fn relative_insert_preserves_reordered_sequence_after_repository_reopen() {
        let (directory, bank, _segment_id, indexed) = question_bank_fixture(3);
        let original_ids = indexed
            .questions
            .iter()
            .map(|question| question.id.clone())
            .collect::<Vec<_>>();

        let after_first = bank
            .insert_question_relative(relative_insert_input(&original_ids[0], "after", "1.5"))
            .expect("question should insert after the first anchor");
        let after_first_id = after_first.questions[1].id.clone();
        let before_third = bank
            .insert_question_relative(relative_insert_input(&original_ids[2], "before", "2.5"))
            .expect("question should insert before the third anchor");
        let before_third_id = before_third.questions[3].id.clone();

        let reopened =
            QuestionBankUseCases::new(SqliteQuestionBankRepository::new(directory.path()))
                .snapshot()
                .expect("reopened repository should load the committed order");
        let persisted_order = reopened
            .questions
            .iter()
            .map(|question| (question.id.clone(), question.sort_order))
            .collect::<Vec<_>>();
        assert_eq!(
            persisted_order,
            vec![
                (original_ids[0].clone(), 0),
                (after_first_id, 1),
                (original_ids[1].clone(), 2),
                (before_third_id, 3),
                (original_ids[2].clone(), 4),
            ]
        );
    }

    #[test]
    fn relative_insert_rolls_back_reordering_when_metadata_write_fails() {
        let (directory, bank, _segment_id, indexed) = question_bank_fixture(3);
        let original_order = indexed
            .questions
            .iter()
            .map(|question| question.id.clone())
            .collect::<Vec<_>>();
        let anchor_id = original_order[1].clone();
        let failed_question_id = Uuid::now_v7().to_string();
        let repository = SqliteQuestionBankRepository::new(directory.path());

        repository
            .insert_question_relative(
                &anchor_id,
                &ValidatedIndexedQuestion {
                    id: failed_question_id.clone(),
                    // This source key already belongs to the anchor's segment. The conflict is
                    // reached only after the sort shift, question insert, and region insert.
                    source_key: "fixture-question-1".to_owned(),
                    title: "Failed fixture question".to_owned(),
                    chapter: "Fixture chapter".to_owned(),
                    section_part: "basic".to_owned(),
                    question_type: QuestionType::Blank,
                    question_number: "failed".to_owned(),
                    index_confidence: 1.0,
                    sort_order: 0,
                    regions: vec![QuestionRegion {
                        id: Uuid::now_v7().to_string(),
                        question_id: failed_question_id,
                        document_id: String::new(),
                        page_number: 2,
                        x: 0.1,
                        y: 0.1,
                        width: 0.4,
                        height: 0.2,
                        coordinate_version: 1,
                        sort_order: 0,
                        created_at: 2_000_000_000_000,
                    }],
                },
                true,
                2_000_000_000_000,
            )
            .expect_err("duplicate source key should fail after the reorder work");

        let persisted_order = bank
            .snapshot()
            .expect("failed insert should leave a readable question bank")
            .questions
            .into_iter()
            .map(|question| question.id)
            .collect::<Vec<_>>();
        assert_eq!(persisted_order, original_order);
    }

    #[test]
    fn automatic_reimport_preserves_manually_corrected_question_regions() {
        let (_directory, bank, segment_id, indexed) = question_bank_fixture(1);
        let question = &indexed.questions[0];
        let question_id = question.id.clone();
        let source_key = "fixture-question-0".to_owned();
        let manual_region_id = question.regions[0].id.clone();

        bank.replace_question_regions(ReplaceIndexedQuestionRegionsInput {
            question_id: question_id.clone(),
            regions: vec![IndexedQuestionRegionUpdateInput {
                region_id: Some(manual_region_id.clone()),
                region: QuestionRegionInput {
                    page_number: 6,
                    x: 0.31,
                    y: 0.42,
                    width: 0.4,
                    height: 0.2,
                },
            }],
        })
        .expect("manual region correction should persist");

        let reimported = bank
            .import_index(ImportQuestionIndexInput {
                segment_id,
                questions: vec![IndexedQuestionDraftInput {
                    source_key,
                    title: "Automatically refreshed title".to_owned(),
                    chapter: "Fixture chapter".to_owned(),
                    section_part: "basic".to_owned(),
                    question_type: "blank".to_owned(),
                    question_number: "1".to_owned(),
                    index_confidence: 0.91,
                    regions: vec![QuestionRegionInput {
                        page_number: 2,
                        x: 0.55,
                        y: 0.1,
                        width: 0.35,
                        height: 0.2,
                    }],
                }],
            })
            .expect("automatic reimport should update the index");
        let region = &reimported.questions[0].regions[0];
        assert_eq!(
            (
                region.id.as_str(),
                region.page_number,
                region.x,
                region.y,
                region.width,
                region.height,
            ),
            (manual_region_id.as_str(), 6, 0.31, 0.42, 0.4, 0.2)
        );
    }

    fn assert_questions_can_be_inserted_around_anchor(
        bank: &QuestionBankUseCases<SqliteQuestionBankRepository>,
        question_id: &str,
    ) {
        let before = bank
            .insert_question_relative(relative_insert_input(question_id, "before", "2"))
            .expect("question should insert before anchor");
        let before_id = before.questions[0].id.clone();
        let after = bank
            .insert_question_relative(relative_insert_input(question_id, "after", "4"))
            .expect("question should insert after anchor");
        let after_id = after.questions[2].id.clone();
        assert_eq!(
            after
                .questions
                .iter()
                .map(|question| question.id.as_str())
                .collect::<Vec<_>>(),
            [before_id.as_str(), question_id, after_id.as_str()],
        );
        bank.trash_question(&before_id)
            .expect("before fixture should trash");
        bank.trash_question(&after_id)
            .expect("after fixture should trash");
    }

    fn relative_insert_input(
        question_id: &str,
        placement: &str,
        question_number: &str,
    ) -> InsertIndexedQuestionInput {
        InsertIndexedQuestionInput {
            anchor_question_id: question_id.to_owned(),
            placement: placement.to_owned(),
            title: format!("第 {question_number} 题"),
            chapter: "第一章 极限".to_owned(),
            section_part: "basic".to_owned(),
            question_type: "blank".to_owned(),
            question_number: question_number.to_owned(),
            regions: vec![QuestionRegionInput {
                page_number: 4,
                x: 0.07,
                y: 0.42,
                width: 0.86,
                height: 0.12,
            }],
        }
    }

    fn assert_indexed_regions_can_be_replaced(
        bank: &QuestionBankUseCases<SqliteQuestionBankRepository>,
        snapshot: &QuestionBankSnapshot,
        question_id: &str,
    ) {
        let original_region_id = snapshot.questions[0].regions[0].id.clone();
        let adjusted = bank
            .replace_question_regions(ReplaceIndexedQuestionRegionsInput {
                question_id: question_id.to_owned(),
                regions: vec![
                    IndexedQuestionRegionUpdateInput {
                        region_id: Some(original_region_id.clone()),
                        region: QuestionRegionInput {
                            page_number: 4,
                            x: 0.08,
                            y: 0.18,
                            width: 0.84,
                            height: 0.2,
                        },
                    },
                    IndexedQuestionRegionUpdateInput {
                        region_id: None,
                        region: QuestionRegionInput {
                            page_number: 5,
                            x: 0.07,
                            y: 0.55,
                            width: 0.86,
                            height: 0.15,
                        },
                    },
                ],
            })
            .expect("indexed regions should update atomically");
        assert_eq!(
            (
                adjusted.questions[0].regions.len(),
                adjusted.questions[0].regions[0].id.as_str(),
                adjusted.questions[0].regions[1].page_number,
            ),
            (2, original_region_id.as_str(), 5),
        );
    }

    fn assert_indexed_question_can_be_edited_and_trashed(
        bank: &QuestionBankUseCases<SqliteQuestionBankRepository>,
        question_id: &str,
    ) {
        let updated = bank
            .update_question(UpdateIndexedQuestionInput {
                question_id: question_id.to_owned(),
                title: "手动校对后的第 3 题".to_owned(),
                chapter: "第一章 极限".to_owned(),
                section_part: "comprehensive".to_owned(),
                question_type: "solution".to_owned(),
                question_number: "3".to_owned(),
            })
            .expect("indexed metadata should update");
        assert_eq!(
            (
                updated.questions[0].title.as_str(),
                updated.questions[0].section_part.as_str(),
                updated.questions[0].question_type.as_str(),
            ),
            ("手动校对后的第 3 题", "comprehensive", "solution"),
        );

        let trashed = bank
            .trash_question(question_id)
            .expect("indexed question should trash");
        assert_eq!(
            (trashed.questions.len(), trashed.segments[0].question_count),
            (0, 0)
        );
    }

    fn question_bank_fixture(
        question_count: usize,
    ) -> (
        TempDir,
        QuestionBankUseCases<SqliteQuestionBankRepository>,
        String,
        QuestionBankSnapshot,
    ) {
        assert!(question_count > 0);
        let directory = tempdir().expect("temporary directory should exist");
        let workspace = SqliteWorkspaceRepository::new(directory.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let source = directory.path().join("question-bank-fixture.pdf");
        std::fs::write(&source, b"question-bank-fixture").expect("fixture should write");
        let resources = SqliteBlobStore::new(directory.path());
        let document = resources
            .import_file(
                &source,
                &ImportRequest {
                    job_id: Uuid::now_v7().to_string(),
                    document_id: Uuid::now_v7().to_string(),
                    title: "Question bank fixture".to_owned(),
                    kind: "pdf".to_owned(),
                    mime_type: "application/pdf".to_owned(),
                    created_at: 1_700_000_000_001,
                },
                &AtomicBool::new(false),
                &mut |_| {},
            )
            .expect("PDF should import");
        resources
            .save_reading_progress(&document.id, 20, 1)
            .expect("page count should persist");
        let schedules = ScheduleUseCases::new(SqliteScheduleRepository::new(directory.path()));
        let subject = schedules
            .create_subject(&CreateSubjectInput {
                name: "Fixture subject".to_owned(),
                color_key: "blue".to_owned(),
                sort_order: 0,
            })
            .expect("subject should create");
        let bank = QuestionBankUseCases::new(SqliteQuestionBankRepository::new(directory.path()));
        let workbook = bank
            .create_workbook(&CreateWorkbookCategoryInput {
                name: "Fixture workbook".to_owned(),
            })
            .expect("workbook should create");
        let segment = bank
            .save_segments(vec![WorkbookSegmentAssignmentInput {
                document_id: document.id,
                subject_id: subject.id,
                workbook_id: workbook.id,
                source_heading: "Fixture segment".to_owned(),
                page_start: 1,
                page_end: 20,
            }])
            .expect("segment should create")
            .remove(0);
        let questions = (0..question_count)
            .map(|index| IndexedQuestionDraftInput {
                source_key: format!("fixture-question-{index}"),
                title: format!("Fixture question {index}"),
                chapter: "Fixture chapter".to_owned(),
                section_part: "basic".to_owned(),
                question_type: "blank".to_owned(),
                question_number: (index + 1).to_string(),
                index_confidence: 0.96,
                regions: vec![QuestionRegionInput {
                    page_number: u32::try_from(index + 2)
                        .expect("fixture question page number should fit in u32"),
                    x: 0.1,
                    y: 0.1,
                    width: 0.4,
                    height: 0.2,
                }],
            })
            .collect();
        let indexed = bank
            .import_index(ImportQuestionIndexInput {
                segment_id: segment.id.clone(),
                questions,
            })
            .expect("index should import");
        (directory, bank, segment.id, indexed)
    }
}
