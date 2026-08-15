use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use uuid::Uuid;

use crate::application::{
    REVIEW_SCHEME_POLICY_VERSION, ReviewDecision, ReviewSchemeCandidate, ReviewSchemeCarryover,
    ReviewSchemeError, ReviewSchemeRepository, ValidatedReviewScheme, ValidatedSchemeSubmission,
    apply_scheme_rating, select_scheme_questions,
};
use crate::domain::{
    AttemptResult, LocalDate, MistakeProfile, QuestionType, ReviewEvent, ReviewMastery,
    ReviewRating, ReviewScheme, ReviewSchemeDashboard, ReviewSchemeItemState, ReviewSchemeQueue,
    ReviewSchemeQueueItem, ReviewSchemeToday, ReviewSchemeTypeQuota, ReviewState,
};

use super::sqlite_question::load_bundle;
use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

/// `SQLite` persistence for independent review schemes and stable carryover queues.
#[derive(Debug, Clone)]
pub(crate) struct SqliteReviewSchemeRepository {
    database_path: PathBuf,
}

impl SqliteReviewSchemeRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, ReviewSchemeError> {
        if !self.database_path.exists() {
            return Err(ReviewSchemeError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl ReviewSchemeRepository for SqliteReviewSchemeRepository {
    fn dashboard(&self, today: &LocalDate) -> Result<ReviewSchemeDashboard, ReviewSchemeError> {
        let connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let rest_weekdays = load_rest_weekdays(&connection, &workspace_id)?;
        let rest_day = rest_weekdays.contains(&today.weekday_from_monday());
        let schemes = load_schemes(&connection, &workspace_id)?
            .into_iter()
            .map(|scheme| {
                let queue = load_scheme_queue(&connection, &scheme.id, today)?;
                Ok(ReviewSchemeToday {
                    due_count: count_due_questions(&connection, &scheme, today)?,
                    pending_classification_count: count_pending_classification(
                        &connection,
                        &scheme,
                    )?,
                    scheme,
                    is_rest_day: rest_day,
                    queue,
                })
            })
            .collect::<Result<Vec<_>, ReviewSchemeError>>()?;
        Ok(ReviewSchemeDashboard {
            rest_weekdays,
            schemes,
        })
    }

    fn save_scheme(
        &self,
        scheme: &ValidatedReviewScheme,
        updated_at: i64,
    ) -> Result<(), ReviewSchemeError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        let workspace_id = load_workspace_id(&transaction)?;
        ensure_subject(&transaction, &workspace_id, &scheme.subject_id)?;
        ensure_scheme_name_available(&transaction, &workspace_id, &scheme.name, &scheme.id)?;
        for document_id in &scheme.document_ids {
            ensure_workbook(&transaction, document_id)?;
        }
        let existing_created_at = transaction
            .query_row(
                "SELECT created_at FROM review_scheme
                 WHERE id = ?1 AND workspace_id = ?2 AND archived_at IS NULL",
                params![scheme.id, workspace_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(database_error)?;
        transaction
            .execute(
                "INSERT INTO review_scheme(
                    id, workspace_id, name, subject_id, all_subject_workbooks,
                    daily_quota, enabled, archived_at, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    subject_id = excluded.subject_id,
                    all_subject_workbooks = excluded.all_subject_workbooks,
                    daily_quota = excluded.daily_quota,
                    enabled = excluded.enabled,
                    updated_at = excluded.updated_at
                 WHERE review_scheme.workspace_id = excluded.workspace_id
                   AND review_scheme.archived_at IS NULL",
                params![
                    scheme.id,
                    workspace_id,
                    scheme.name,
                    scheme.subject_id,
                    scheme.all_subject_workbooks,
                    i64::from(scheme.daily_quota),
                    scheme.enabled,
                    existing_created_at.unwrap_or(scheme.created_at),
                    updated_at
                ],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "DELETE FROM review_scheme_document WHERE scheme_id = ?1",
                params![scheme.id],
            )
            .map_err(database_error)?;
        for document_id in &scheme.document_ids {
            transaction
                .execute(
                    "INSERT INTO review_scheme_document(scheme_id, document_id, created_at)
                     VALUES (?1, ?2, ?3)",
                    params![scheme.id, document_id, updated_at],
                )
                .map_err(database_error)?;
        }
        transaction
            .execute(
                "DELETE FROM review_scheme_type_quota WHERE scheme_id = ?1",
                params![scheme.id],
            )
            .map_err(database_error)?;
        for type_quota in &scheme.type_quotas {
            transaction
                .execute(
                    "INSERT INTO review_scheme_type_quota(scheme_id, question_type, quota)
                     VALUES (?1, ?2, ?3)",
                    params![
                        scheme.id,
                        type_quota.question_type.as_str(),
                        i64::from(type_quota.quota)
                    ],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn archive_scheme(&self, scheme_id: &str, archived_at: i64) -> Result<(), ReviewSchemeError> {
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE review_scheme
                 SET enabled = 0, archived_at = ?2, updated_at = ?2
                 WHERE id = ?1 AND archived_at IS NULL",
                params![scheme_id, archived_at],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(ReviewSchemeError::SchemeNotFound);
        }
        Ok(())
    }

    fn set_rest_weekdays(
        &self,
        rest_weekdays: &[u8],
        updated_at: i64,
    ) -> Result<(), ReviewSchemeError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        let workspace_id = load_workspace_id(&transaction)?;
        transaction
            .execute(
                "DELETE FROM workspace_rest_weekday WHERE workspace_id = ?1",
                params![workspace_id],
            )
            .map_err(database_error)?;
        for weekday in rest_weekdays {
            transaction
                .execute(
                    "INSERT INTO workspace_rest_weekday(workspace_id, weekday, created_at)
                     VALUES (?1, ?2, ?3)",
                    params![workspace_id, i64::from(*weekday), updated_at],
                )
                .map_err(database_error)?;
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn generate_queue(
        &self,
        scheme_id: &str,
        queue_date: &LocalDate,
        temporary_document_id: Option<&str>,
        generated_at: i64,
    ) -> Result<(), ReviewSchemeError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        let workspace_id = load_workspace_id(&transaction)?;
        let rest_weekdays = load_rest_weekdays(&transaction, &workspace_id)?;
        let scheme = load_scheme(&transaction, scheme_id, &workspace_id)?;
        if !scheme.enabled {
            return Err(ReviewSchemeError::SchemeNotFound);
        }
        if rest_weekdays.contains(&queue_date.weekday_from_monday()) {
            transaction.commit().map_err(database_error)?;
            return Ok(());
        }
        if queue_exists(&transaction, scheme_id, queue_date)? {
            transaction.commit().map_err(database_error)?;
            return Ok(());
        }
        if let Some(document_id) = temporary_document_id {
            ensure_temporary_document(&transaction, &scheme, document_id)?;
        }

        let queue_id = Uuid::now_v7().to_string();
        transaction
            .execute(
                "INSERT INTO review_scheme_queue(
                    id, scheme_id, queue_date, quota, generated_at, completed_count
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![
                    queue_id,
                    scheme.id,
                    queue_date.as_str(),
                    i64::from(scheme.daily_quota),
                    generated_at
                ],
            )
            .map_err(database_error)?;

        let carryovers =
            load_carryovers(&transaction, &scheme.id, queue_date, temporary_document_id)?;
        let candidates = load_candidates(&transaction, &scheme, queue_date, temporary_document_id)?;
        let selected = select_scheme_questions(
            carryovers,
            candidates,
            &scheme.type_quotas,
            scheme.daily_quota,
            queue_date,
        );
        for (position, item) in selected.iter().enumerate() {
            let position = u32::try_from(position).map_err(|_| invalid_stored())?;
            transaction
                .execute(
                    "INSERT INTO review_scheme_queue_item(
                        queue_id, queue_date, question_id, position, origin_date,
                        origin_position, priority_score, selection_kind, state,
                        review_event_id, carried_to_queue_id, inserted_at, completed_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending',
                               NULL, NULL, ?9, NULL)",
                    params![
                        queue_id,
                        queue_date.as_str(),
                        item.question_id,
                        i64::from(position),
                        item.origin_date.as_str(),
                        i64::from(item.origin_position),
                        i64::from(item.priority_score),
                        item.selection_kind.as_str(),
                        generated_at
                    ],
                )
                .map_err(database_error)?;
            if let Some(source_queue_id) = &item.source_queue_id {
                let changed = transaction
                    .execute(
                        "UPDATE review_scheme_queue_item
                         SET state = 'carried', carried_to_queue_id = ?3
                         WHERE queue_id = ?1 AND question_id = ?2 AND state = 'pending'",
                        params![source_queue_id, item.question_id, queue_id],
                    )
                    .map_err(database_error)?;
                if changed != 1 {
                    return Err(ReviewSchemeError::SchemeConflict);
                }
            }
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn submit_review(&self, input: &ValidatedSchemeSubmission) -> Result<(), ReviewSchemeError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        ensure_pending_item(&transaction, input)?;
        ensure_available_question(&transaction, &input.question_id)?;
        let workspace_id = load_workspace_id(&transaction)?;
        let rest_weekdays = load_rest_weekdays(&transaction, &workspace_id)?;
        let profile = load_profile(&transaction, &input.question_id)?;
        let state = load_state(&transaction, &input.question_id)?;
        let undo = ReviewUndoSnapshot::from_current(&profile, &state);
        let decision = apply_scheme_rating(
            &profile,
            &state,
            input.rating,
            &input.today,
            input.created_at,
            &rest_weekdays,
        )?;
        insert_attempt(&transaction, input)?;
        update_profile(&transaction, input, &decision)?;
        update_state(&transaction, input, &decision)?;
        insert_event(&transaction, input, &state, &decision)?;
        save_undo_snapshot(&transaction, input, &undo)?;
        complete_item(&transaction, input)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn undo_last_review(&self, queue_id: &str) -> Result<(), ReviewSchemeError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        let undo = load_undo_snapshot(&transaction, queue_id)?
            .ok_or(ReviewSchemeError::UndoUnavailable)?;
        restore_undo_snapshot(&transaction, queue_id, &undo)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }
}

#[derive(Debug)]
struct ReviewUndoSnapshot {
    question_id: String,
    event_id: String,
    attempt_id: String,
    first_mistake_at: Option<i64>,
    last_mistake_at: Option<i64>,
    mistake_count: u32,
    consecutive_failure_count: u32,
    profile_updated_at: i64,
    policy_version: u32,
    mastery_level: String,
    due_date: String,
    last_reviewed_at: Option<i64>,
    successful_streak: u32,
    manual_pin_date: Option<String>,
    state_updated_at: i64,
}

impl ReviewUndoSnapshot {
    fn from_current(profile: &MistakeProfile, state: &ReviewState) -> Self {
        Self {
            question_id: profile.question_id.clone(),
            event_id: String::new(),
            attempt_id: String::new(),
            first_mistake_at: profile.first_mistake_at,
            last_mistake_at: profile.last_mistake_at,
            mistake_count: profile.mistake_count,
            consecutive_failure_count: profile.consecutive_failure_count,
            profile_updated_at: profile.updated_at,
            policy_version: state.policy_version,
            mastery_level: state.mastery.as_str().to_owned(),
            due_date: state.due_date.as_str().to_owned(),
            last_reviewed_at: state.last_reviewed_at,
            successful_streak: state.successful_streak,
            manual_pin_date: state
                .manual_pin_date
                .as_ref()
                .map(|date| date.as_str().to_owned()),
            state_updated_at: state.updated_at,
        }
    }
}

fn save_undo_snapshot(
    transaction: &Transaction<'_>,
    input: &ValidatedSchemeSubmission,
    snapshot: &ReviewUndoSnapshot,
) -> Result<(), ReviewSchemeError> {
    transaction
        .execute(
            "DELETE FROM review_scheme_undo WHERE queue_id = ?1",
            params![input.queue_id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "INSERT INTO review_scheme_undo(
                queue_id, question_id, event_id, attempt_id,
                first_mistake_at, last_mistake_at, mistake_count,
                consecutive_failure_count, profile_updated_at, policy_version,
                mastery_level, due_date, last_reviewed_at, successful_streak,
                manual_pin_date, state_updated_at, saved_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
                ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
             )",
            params![
                input.queue_id,
                snapshot.question_id,
                input.event_id,
                input.attempt_id,
                snapshot.first_mistake_at,
                snapshot.last_mistake_at,
                i64::from(snapshot.mistake_count),
                i64::from(snapshot.consecutive_failure_count),
                snapshot.profile_updated_at,
                i64::from(snapshot.policy_version),
                snapshot.mastery_level,
                snapshot.due_date,
                snapshot.last_reviewed_at,
                i64::from(snapshot.successful_streak),
                snapshot.manual_pin_date,
                snapshot.state_updated_at,
                input.created_at,
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn load_undo_snapshot(
    transaction: &Transaction<'_>,
    queue_id: &str,
) -> Result<Option<ReviewUndoSnapshot>, ReviewSchemeError> {
    transaction
        .query_row(
            "SELECT question_id, event_id, attempt_id, first_mistake_at,
                    last_mistake_at, mistake_count, consecutive_failure_count,
                    profile_updated_at, policy_version, mastery_level, due_date,
                    last_reviewed_at, successful_streak, manual_pin_date,
                    state_updated_at
             FROM review_scheme_undo WHERE queue_id = ?1",
            params![queue_id],
            |row| {
                Ok(ReviewUndoSnapshot {
                    question_id: row.get(0)?,
                    event_id: row.get(1)?,
                    attempt_id: row.get(2)?,
                    first_mistake_at: row.get(3)?,
                    last_mistake_at: row.get(4)?,
                    mistake_count: to_u32(row.get(5)?, 5)?,
                    consecutive_failure_count: to_u32(row.get(6)?, 6)?,
                    profile_updated_at: row.get(7)?,
                    policy_version: to_u32(row.get(8)?, 8)?,
                    mastery_level: row.get(9)?,
                    due_date: row.get(10)?,
                    last_reviewed_at: row.get(11)?,
                    successful_streak: to_u32(row.get(12)?, 12)?,
                    manual_pin_date: row.get(13)?,
                    state_updated_at: row.get(14)?,
                })
            },
        )
        .optional()
        .map_err(database_error)
        .map_err(Into::into)
}

fn restore_undo_snapshot(
    transaction: &Transaction<'_>,
    queue_id: &str,
    snapshot: &ReviewUndoSnapshot,
) -> Result<(), ReviewSchemeError> {
    let changed = transaction
        .execute(
            "UPDATE review_scheme_queue_item
             SET state = 'pending', review_event_id = NULL, completed_at = NULL
             WHERE queue_id = ?1 AND question_id = ?2 AND state = 'completed'
               AND review_event_id = ?3",
            params![queue_id, snapshot.question_id, snapshot.event_id],
        )
        .map_err(database_error)?;
    if changed != 1 {
        return Err(ReviewSchemeError::UndoUnavailable);
    }
    transaction
        .execute(
            "UPDATE mistake_profile
             SET first_mistake_at = ?2, last_mistake_at = ?3, mistake_count = ?4,
                 consecutive_failure_count = ?5, updated_at = ?6
             WHERE question_id = ?1",
            params![
                snapshot.question_id,
                snapshot.first_mistake_at,
                snapshot.last_mistake_at,
                i64::from(snapshot.mistake_count),
                i64::from(snapshot.consecutive_failure_count),
                snapshot.profile_updated_at,
            ],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "UPDATE review_state
             SET policy_version = ?2, mastery_level = ?3, due_date = ?4,
                 last_reviewed_at = ?5, successful_streak = ?6,
                 manual_pin_date = ?7, updated_at = ?8
             WHERE question_id = ?1",
            params![
                snapshot.question_id,
                i64::from(snapshot.policy_version),
                snapshot.mastery_level,
                snapshot.due_date,
                snapshot.last_reviewed_at,
                i64::from(snapshot.successful_streak),
                snapshot.manual_pin_date,
                snapshot.state_updated_at,
            ],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM review_scheme_undo WHERE queue_id = ?1",
            params![queue_id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM review_event WHERE id = ?1",
            params![snapshot.event_id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "DELETE FROM question_attempt WHERE id = ?1",
            params![snapshot.attempt_id],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "UPDATE review_scheme_queue
             SET completed_count = (
                SELECT COUNT(*) FROM review_scheme_queue_item
                WHERE queue_id = ?1 AND state = 'completed'
             ) WHERE id = ?1",
            params![queue_id],
        )
        .map_err(database_error)?;
    Ok(())
}

fn immediate(connection: &mut Connection) -> Result<Transaction<'_>, ReviewSchemeError> {
    connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)
        .map_err(ReviewSchemeError::from)
}

fn load_workspace_id(connection: &Connection) -> Result<String, ReviewSchemeError> {
    connection
        .query_row(
            "SELECT id FROM workspace WHERE singleton_key = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(ReviewSchemeError::WorkspaceNotInitialized)
}

fn ensure_available_question(
    connection: &Connection,
    question_id: &str,
) -> Result<(), ReviewSchemeError> {
    let available = connection
        .query_row(
            "SELECT EXISTS(
                 SELECT 1
                 FROM question q
                 JOIN resource_document d ON d.id = q.document_id
                 WHERE q.id = ?1 AND q.deleted_at IS NULL
                   AND d.kind = 'pdf' AND d.role = 'workbook'
                   AND NOT EXISTS(
                       SELECT 1
                       FROM question_index_metadata m
                       JOIN workbook_document_segment s ON s.id = m.segment_id
                       WHERE m.question_id = q.id AND s.deleted_at IS NOT NULL
                   )
             )",
            params![question_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(database_error)?;
    if available {
        Ok(())
    } else {
        Err(ReviewSchemeError::QueueItemNotFound)
    }
}

fn load_rest_weekdays(
    connection: &Connection,
    workspace_id: &str,
) -> Result<Vec<u8>, ReviewSchemeError> {
    let mut statement = connection
        .prepare(
            "SELECT weekday FROM workspace_rest_weekday
             WHERE workspace_id = ?1 ORDER BY weekday",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![workspace_id], |row| to_u8(row.get(0)?, 0))
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(ReviewSchemeError::from))
        .collect()
}

fn load_schemes(
    connection: &Connection,
    workspace_id: &str,
) -> Result<Vec<ReviewScheme>, ReviewSchemeError> {
    let mut statement = connection
        .prepare(
            "SELECT id FROM review_scheme
             WHERE workspace_id = ?1 AND archived_at IS NULL
             ORDER BY enabled DESC, created_at, id",
        )
        .map_err(database_error)?;
    let ids = statement
        .query_map(params![workspace_id], |row| row.get::<_, String>(0))
        .map_err(database_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(database_error)?;
    ids.iter()
        .map(|id| load_scheme(connection, id, workspace_id))
        .collect()
}

fn load_scheme(
    connection: &Connection,
    scheme_id: &str,
    workspace_id: &str,
) -> Result<ReviewScheme, ReviewSchemeError> {
    let mut scheme = connection
        .query_row(
            "SELECT rs.id, rs.name, rs.subject_id, s.name,
                    rs.all_subject_workbooks, rs.daily_quota, rs.enabled,
                    rs.created_at, rs.updated_at
             FROM review_scheme rs JOIN subject s ON s.id = rs.subject_id
             WHERE rs.id = ?1 AND rs.workspace_id = ?2 AND rs.archived_at IS NULL",
            params![scheme_id, workspace_id],
            |row| {
                Ok(ReviewScheme {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    subject_id: row.get(2)?,
                    subject_name: row.get(3)?,
                    all_subject_workbooks: row.get(4)?,
                    daily_quota: to_u32(row.get(5)?, 5)?,
                    enabled: row.get(6)?,
                    document_ids: Vec::new(),
                    type_quotas: Vec::new(),
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(ReviewSchemeError::SchemeNotFound)?;
    scheme.document_ids = load_scheme_documents(connection, scheme_id)?;
    scheme.type_quotas = load_type_quotas(connection, scheme_id)?;
    Ok(scheme)
}

fn load_scheme_documents(
    connection: &Connection,
    scheme_id: &str,
) -> Result<Vec<String>, ReviewSchemeError> {
    let mut statement = connection
        .prepare(
            "SELECT document_id FROM review_scheme_document
             WHERE scheme_id = ?1 ORDER BY created_at, document_id",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![scheme_id], |row| row.get::<_, String>(0))
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(ReviewSchemeError::from))
        .collect()
}

fn load_type_quotas(
    connection: &Connection,
    scheme_id: &str,
) -> Result<Vec<ReviewSchemeTypeQuota>, ReviewSchemeError> {
    let mut statement = connection
        .prepare(
            "SELECT question_type, quota FROM review_scheme_type_quota
             WHERE scheme_id = ?1
             ORDER BY CASE question_type
                WHEN 'choice' THEN 0 WHEN 'blank' THEN 1
                WHEN 'solution' THEN 2 ELSE 3 END",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![scheme_id], |row| {
            let stored = row.get::<_, String>(0)?;
            Ok(ReviewSchemeTypeQuota {
                question_type: QuestionType::parse(&stored)
                    .ok_or_else(|| conversion_error(0, "invalid question type"))?,
                quota: to_u32(row.get(1)?, 1)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(ReviewSchemeError::from))
        .collect()
}

fn load_scheme_queue(
    connection: &Connection,
    scheme_id: &str,
    queue_date: &LocalDate,
) -> Result<Option<ReviewSchemeQueue>, ReviewSchemeError> {
    let raw = connection
        .query_row(
            "SELECT id, quota, generated_at, completed_count
             FROM review_scheme_queue WHERE scheme_id = ?1 AND queue_date = ?2",
            params![scheme_id, queue_date.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    to_u32(row.get(1)?, 1)?,
                    row.get::<_, i64>(2)?,
                    to_u32(row.get(3)?, 3)?,
                ))
            },
        )
        .optional()
        .map_err(database_error)?;
    let Some((id, quota, generated_at, completed_count)) = raw else {
        return Ok(None);
    };
    Ok(Some(ReviewSchemeQueue {
        items: load_queue_items(connection, &id)?,
        id,
        scheme_id: scheme_id.to_owned(),
        queue_date: queue_date.clone(),
        quota,
        generated_at,
        completed_count,
    }))
}

fn load_queue_items(
    connection: &Connection,
    queue_id: &str,
) -> Result<Vec<ReviewSchemeQueueItem>, ReviewSchemeError> {
    let mut statement = connection
        .prepare(
            "SELECT question_id, position, origin_date, selection_kind,
                    state, review_event_id, inserted_at, completed_at
             FROM review_scheme_queue_item
             WHERE queue_id = ?1 AND state != 'carried'
               AND (
                   state = 'completed'
                   OR (
                       EXISTS(
                           SELECT 1 FROM question q
                           WHERE q.id = review_scheme_queue_item.question_id
                             AND q.deleted_at IS NULL
                       )
                       AND NOT EXISTS(
                           SELECT 1
                           FROM question_index_metadata m
                           JOIN workbook_document_segment s ON s.id = m.segment_id
                           WHERE m.question_id = review_scheme_queue_item.question_id
                             AND s.deleted_at IS NOT NULL
                       )
                   )
               )
             ORDER BY position",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map(params![queue_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                to_u32(row.get(1)?, 1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, Option<i64>>(7)?,
            ))
        })
        .map_err(database_error)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(database_error)?;
    rows.into_iter()
        .map(
            |(
                question_id,
                position,
                origin_date,
                selection,
                state,
                event_id,
                inserted_at,
                completed_at,
            )| {
                Ok(ReviewSchemeQueueItem {
                    question: load_bundle(connection, &question_id).map_err(question_error)?,
                    position,
                    origin_date: LocalDate::parse(&origin_date).map_err(|_| invalid_stored())?,
                    carried: selection == "carryover",
                    state: ReviewSchemeItemState::parse(&state).ok_or_else(invalid_stored)?,
                    review_event: event_id
                        .as_deref()
                        .map(|id| load_event(connection, id))
                        .transpose()?,
                    inserted_at,
                    completed_at,
                })
            },
        )
        .collect()
}

fn count_due_questions(
    connection: &Connection,
    scheme: &ReviewScheme,
    today: &LocalDate,
) -> Result<u32, ReviewSchemeError> {
    let count = connection
        .query_row(
            "SELECT COUNT(*)
             FROM mistake_profile mp
             JOIN review_state st ON st.question_id = mp.question_id
             JOIN question q ON q.id = mp.question_id
             LEFT JOIN workbook_profile wp ON wp.document_id = q.document_id
             WHERE mp.active = 1 AND st.suspended_at IS NULL
               AND q.deleted_at IS NULL AND q.question_type IS NOT NULL
               AND COALESCE(q.subject_id, wp.default_subject_id) = ?1
               AND st.due_date <= ?2
               AND (?3 OR EXISTS(
                    SELECT 1 FROM review_scheme_document sd
                    WHERE sd.scheme_id = ?4 AND sd.document_id = q.document_id
               ))",
            params![
                scheme.subject_id,
                today.as_str(),
                scheme.all_subject_workbooks,
                scheme.id
            ],
            |row| row.get::<_, i64>(0),
        )
        .map_err(database_error)?;
    to_u32(count, 0).map_err(database_error).map_err(Into::into)
}

fn count_pending_classification(
    connection: &Connection,
    scheme: &ReviewScheme,
) -> Result<u32, ReviewSchemeError> {
    let count = connection
        .query_row(
            "SELECT COUNT(*) FROM question q
             LEFT JOIN workbook_profile wp ON wp.document_id = q.document_id
             WHERE q.deleted_at IS NULL AND q.question_type IS NULL
               AND COALESCE(q.subject_id, wp.default_subject_id) = ?1
               AND (?2 OR EXISTS(
                    SELECT 1 FROM review_scheme_document sd
                    WHERE sd.scheme_id = ?3 AND sd.document_id = q.document_id
               ))",
            params![scheme.subject_id, scheme.all_subject_workbooks, scheme.id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(database_error)?;
    to_u32(count, 0).map_err(database_error).map_err(Into::into)
}

fn load_carryovers(
    connection: &Connection,
    scheme_id: &str,
    queue_date: &LocalDate,
    temporary_document_id: Option<&str>,
) -> Result<Vec<ReviewSchemeCarryover>, ReviewSchemeError> {
    let mut statement = connection
        .prepare(
            "SELECT i.queue_id, i.question_id, q.document_id, q.question_type,
                    i.origin_date, i.origin_position, i.priority_score
             FROM review_scheme_queue_item i
             JOIN review_scheme_queue sq ON sq.id = i.queue_id
             JOIN question q ON q.id = i.question_id
             WHERE sq.scheme_id = ?1 AND sq.queue_date < ?2 AND i.state = 'pending'
               AND q.deleted_at IS NULL
               AND NOT EXISTS(
                   SELECT 1
                   FROM question_index_metadata m
                   JOIN workbook_document_segment s ON s.id = m.segment_id
                   WHERE m.question_id = q.id AND s.deleted_at IS NOT NULL
               )
               AND (?3 IS NULL OR q.document_id = ?3)
               AND NOT EXISTS(
                    SELECT 1 FROM review_scheme_queue_item other
                    WHERE other.question_id = i.question_id AND other.state = 'pending'
                      AND other.queue_id != i.queue_id
               )
             ORDER BY i.origin_date, i.origin_position, sq.queue_date, i.position",
        )
        .map_err(database_error)?;
    statement
        .query_map(
            params![scheme_id, queue_date.as_str(), temporary_document_id],
            |row| {
                let stored_type = row.get::<_, String>(3)?;
                Ok(ReviewSchemeCarryover {
                    source_queue_id: row.get(0)?,
                    question_id: row.get(1)?,
                    document_id: row.get(2)?,
                    question_type: QuestionType::parse(&stored_type)
                        .ok_or_else(|| conversion_error(3, "invalid question type"))?,
                    origin_date: LocalDate::parse(&row.get::<_, String>(4)?)
                        .map_err(|_| conversion_error(4, "invalid origin date"))?,
                    origin_position: to_u32(row.get(5)?, 5)?,
                    priority_score: to_u32(row.get(6)?, 6)?,
                })
            },
        )
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(ReviewSchemeError::from))
        .collect()
}

fn load_candidates(
    connection: &Connection,
    scheme: &ReviewScheme,
    today: &LocalDate,
    temporary_document_id: Option<&str>,
) -> Result<Vec<ReviewSchemeCandidate>, ReviewSchemeError> {
    let mut statement = connection
        .prepare(
            "SELECT mp.question_id, q.document_id, q.question_type, st.due_date,
                    st.last_reviewed_at, mp.last_mistake_at,
                    mp.consecutive_failure_count, mp.mistake_count,
                    CAST(COALESCE(julianday(?2) - julianday(
                        strftime('%Y-%m-%d', MAX(a.attempted_at) / 1000, 'unixepoch')
                    ), 0) AS INTEGER)
             FROM mistake_profile mp
             JOIN review_state st ON st.question_id = mp.question_id
             JOIN question q ON q.id = mp.question_id
             JOIN resource_document d ON d.id = q.document_id
             LEFT JOIN workbook_profile wp ON wp.document_id = q.document_id
             LEFT JOIN question_attempt a ON a.question_id = q.id
             WHERE mp.active = 1 AND st.suspended_at IS NULL
               AND q.deleted_at IS NULL AND q.question_type IS NOT NULL
               AND d.kind = 'pdf' AND d.role = 'workbook'
               AND COALESCE(q.subject_id, wp.default_subject_id) = ?1
               AND st.due_date <= ?2
               AND (?3 IS NULL OR q.document_id = ?3)
               AND (?4 OR EXISTS(
                    SELECT 1 FROM review_scheme_document sd
                    WHERE sd.scheme_id = ?5 AND sd.document_id = q.document_id
               ))
               AND NOT EXISTS(
                    SELECT 1 FROM review_scheme_queue_item pending
                    WHERE pending.question_id = q.id AND pending.state = 'pending'
               )
               AND NOT EXISTS(
                    SELECT 1 FROM review_scheme_queue_item assigned
                    WHERE assigned.question_id = q.id AND assigned.queue_date = ?2
               )
             GROUP BY mp.question_id",
        )
        .map_err(database_error)?;
    statement
        .query_map(
            params![
                scheme.subject_id,
                today.as_str(),
                temporary_document_id,
                scheme.all_subject_workbooks,
                scheme.id
            ],
            |row| {
                let stored_type = row.get::<_, String>(2)?;
                Ok(ReviewSchemeCandidate {
                    question_id: row.get(0)?,
                    document_id: row.get(1)?,
                    question_type: QuestionType::parse(&stored_type)
                        .ok_or_else(|| conversion_error(2, "invalid question type"))?,
                    due_date: LocalDate::parse(&row.get::<_, String>(3)?)
                        .map_err(|_| conversion_error(3, "invalid due date"))?,
                    last_reviewed_at: row.get(4)?,
                    last_mistake_at: row.get(5)?,
                    failure_streak: to_u32(row.get(6)?, 6)?,
                    mistake_count: to_u32(row.get(7)?, 7)?,
                    days_since_attempt: to_u32(row.get::<_, i64>(8)?.max(0), 8)?,
                })
            },
        )
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(ReviewSchemeError::from))
        .collect()
}

fn queue_exists(
    connection: &Connection,
    scheme_id: &str,
    queue_date: &LocalDate,
) -> Result<bool, ReviewSchemeError> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM review_scheme_queue WHERE scheme_id = ?1 AND queue_date = ?2
             )",
            params![scheme_id, queue_date.as_str()],
            |row| row.get(0),
        )
        .map_err(database_error)
        .map_err(Into::into)
}

fn ensure_subject(
    connection: &Connection,
    workspace_id: &str,
    subject_id: &str,
) -> Result<(), ReviewSchemeError> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM subject
                WHERE id = ?1 AND workspace_id = ?2 AND archived_at IS NULL
             )",
            params![subject_id, workspace_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(database_error)?;
    if exists {
        Ok(())
    } else {
        Err(ReviewSchemeError::SubjectNotFound)
    }
}

fn ensure_workbook(connection: &Connection, document_id: &str) -> Result<(), ReviewSchemeError> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM resource_document
                WHERE id = ?1 AND kind = 'pdf' AND role = 'workbook'
             )",
            params![document_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(database_error)?;
    if exists {
        Ok(())
    } else {
        Err(ReviewSchemeError::WorkbookNotFound)
    }
}

fn ensure_temporary_document(
    connection: &Connection,
    scheme: &ReviewScheme,
    document_id: &str,
) -> Result<(), ReviewSchemeError> {
    ensure_workbook(connection, document_id)?;
    if scheme.all_subject_workbooks || scheme.document_ids.iter().any(|id| id == document_id) {
        Ok(())
    } else {
        Err(ReviewSchemeError::WorkbookNotFound)
    }
}

fn ensure_scheme_name_available(
    connection: &Connection,
    workspace_id: &str,
    name: &str,
    scheme_id: &str,
) -> Result<(), ReviewSchemeError> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM review_scheme
                WHERE workspace_id = ?1 AND name = ?2 AND id != ?3
             )",
            params![workspace_id, name, scheme_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(database_error)?;
    if exists {
        Err(ReviewSchemeError::SchemeConflict)
    } else {
        Ok(())
    }
}

fn ensure_pending_item(
    connection: &Connection,
    input: &ValidatedSchemeSubmission,
) -> Result<(), ReviewSchemeError> {
    let state = connection
        .query_row(
            "SELECT i.state FROM review_scheme_queue_item i
             JOIN review_scheme_queue q ON q.id = i.queue_id
             WHERE i.queue_id = ?1 AND i.question_id = ?2 AND q.queue_date = ?3",
            params![input.queue_id, input.question_id, input.today.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(ReviewSchemeError::QueueItemNotFound)?;
    match state.as_str() {
        "pending" => Ok(()),
        "completed" => Err(ReviewSchemeError::QueueItemCompleted),
        _ => Err(ReviewSchemeError::QueueItemNotFound),
    }
}

fn load_profile(
    connection: &Connection,
    question_id: &str,
) -> Result<MistakeProfile, ReviewSchemeError> {
    connection
        .query_row(
            "SELECT question_id, first_mistake_at, last_mistake_at, mistake_count,
                    consecutive_failure_count, active, user_priority, created_at, updated_at
             FROM mistake_profile WHERE question_id = ?1 AND active = 1",
            params![question_id],
            |row| {
                Ok(MistakeProfile {
                    question_id: row.get(0)?,
                    first_mistake_at: row.get(1)?,
                    last_mistake_at: row.get(2)?,
                    mistake_count: to_u32(row.get(3)?, 3)?,
                    consecutive_failure_count: to_u32(row.get(4)?, 4)?,
                    active: row.get(5)?,
                    user_priority: to_u8(row.get(6)?, 6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(ReviewSchemeError::QueueItemNotFound)
}

fn load_state(
    connection: &Connection,
    question_id: &str,
) -> Result<ReviewState, ReviewSchemeError> {
    connection
        .query_row(
            "SELECT question_id, policy_version, mastery_level, due_date,
                    last_reviewed_at, successful_streak, manual_pin_date,
                    suspended_at, created_at, updated_at
             FROM review_state WHERE question_id = ?1",
            params![question_id],
            |row| {
                let mastery = row.get::<_, String>(2)?;
                let due_date = row.get::<_, String>(3)?;
                let manual_pin = row.get::<_, Option<String>>(6)?;
                Ok(ReviewState {
                    question_id: row.get(0)?,
                    policy_version: to_u32(row.get(1)?, 1)?,
                    mastery: ReviewMastery::parse(&mastery)
                        .ok_or_else(|| conversion_error(2, "invalid mastery"))?,
                    due_date: LocalDate::parse(&due_date)
                        .map_err(|_| conversion_error(3, "invalid due date"))?,
                    last_reviewed_at: row.get(4)?,
                    successful_streak: to_u32(row.get(5)?, 5)?,
                    manual_pin_date: manual_pin
                        .as_deref()
                        .map(LocalDate::parse)
                        .transpose()
                        .map_err(|_| conversion_error(6, "invalid pin date"))?,
                    suspended_at: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(ReviewSchemeError::QueueItemNotFound)
}

fn insert_attempt(
    transaction: &Transaction<'_>,
    input: &ValidatedSchemeSubmission,
) -> Result<(), ReviewSchemeError> {
    let result = match input.rating {
        ReviewRating::Mastered => AttemptResult::Correct,
        ReviewRating::Uncertain => AttemptResult::Uncertain,
        ReviewRating::Failed => AttemptResult::Incorrect,
        ReviewRating::Skipped => return Err(ReviewSchemeError::InvalidInput),
    };
    transaction
        .execute(
            "INSERT INTO question_attempt(
                id, question_id, result, attempted_at, duration_seconds, answer_note, created_at
             ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?4)",
            params![
                input.attempt_id,
                input.question_id,
                result.as_str(),
                input.created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn update_profile(
    transaction: &Transaction<'_>,
    input: &ValidatedSchemeSubmission,
    decision: &ReviewDecision,
) -> Result<(), ReviewSchemeError> {
    transaction
        .execute(
            "UPDATE mistake_profile
             SET first_mistake_at = ?2, last_mistake_at = ?3,
                 mistake_count = ?4, consecutive_failure_count = ?5,
                 updated_at = ?6
             WHERE question_id = ?1 AND active = 1",
            params![
                input.question_id,
                decision.first_mistake_at,
                decision.last_mistake_at,
                i64::from(decision.mistake_count),
                i64::from(decision.consecutive_failure_count),
                input.created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn update_state(
    transaction: &Transaction<'_>,
    input: &ValidatedSchemeSubmission,
    decision: &ReviewDecision,
) -> Result<(), ReviewSchemeError> {
    transaction
        .execute(
            "UPDATE review_state
             SET policy_version = ?2, mastery_level = ?3, due_date = ?4,
                 last_reviewed_at = ?5, successful_streak = ?6,
                 manual_pin_date = NULL, updated_at = ?5
             WHERE question_id = ?1 AND suspended_at IS NULL",
            params![
                input.question_id,
                i64::from(REVIEW_SCHEME_POLICY_VERSION),
                decision.mastery.as_str(),
                decision.next_due_date.as_str(),
                input.created_at,
                i64::from(decision.successful_streak)
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_event(
    transaction: &Transaction<'_>,
    input: &ValidatedSchemeSubmission,
    state: &ReviewState,
    decision: &ReviewDecision,
) -> Result<(), ReviewSchemeError> {
    transaction
        .execute(
            "INSERT INTO review_event(
                id, question_id, attempt_id, rating, previous_due_date,
                next_due_date, interval_days, policy_version, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                input.event_id,
                input.question_id,
                input.attempt_id,
                input.rating.as_str(),
                state.due_date.as_str(),
                decision.next_due_date.as_str(),
                i64::from(decision.interval_days),
                i64::from(REVIEW_SCHEME_POLICY_VERSION),
                input.created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn complete_item(
    transaction: &Transaction<'_>,
    input: &ValidatedSchemeSubmission,
) -> Result<(), ReviewSchemeError> {
    let changed = transaction
        .execute(
            "UPDATE review_scheme_queue_item
             SET state = 'completed', review_event_id = ?3, completed_at = ?4
             WHERE queue_id = ?1 AND question_id = ?2 AND state = 'pending'",
            params![
                input.queue_id,
                input.question_id,
                input.event_id,
                input.created_at
            ],
        )
        .map_err(database_error)?;
    if changed != 1 {
        return Err(ReviewSchemeError::QueueItemCompleted);
    }
    transaction
        .execute(
            "UPDATE review_scheme_queue
             SET completed_count = (
                SELECT COUNT(*) FROM review_scheme_queue_item
                WHERE queue_id = ?1 AND state = 'completed'
             ) WHERE id = ?1",
            params![input.queue_id],
        )
        .map_err(database_error)?;
    Ok(())
}

fn load_event(connection: &Connection, event_id: &str) -> Result<ReviewEvent, ReviewSchemeError> {
    connection
        .query_row(
            "SELECT id, question_id, attempt_id, rating, previous_due_date,
                    next_due_date, interval_days, policy_version, created_at
             FROM review_event WHERE id = ?1",
            params![event_id],
            |row| {
                let rating = row.get::<_, String>(3)?;
                Ok(ReviewEvent {
                    id: row.get(0)?,
                    question_id: row.get(1)?,
                    attempt_id: row.get(2)?,
                    rating: ReviewRating::parse(&rating)
                        .ok_or_else(|| conversion_error(3, "invalid rating"))?,
                    previous_due_date: LocalDate::parse(&row.get::<_, String>(4)?)
                        .map_err(|_| conversion_error(4, "invalid previous due date"))?,
                    next_due_date: LocalDate::parse(&row.get::<_, String>(5)?)
                        .map_err(|_| conversion_error(5, "invalid next due date"))?,
                    interval_days: to_u32(row.get(6)?, 6)?,
                    policy_version: to_u32(row.get(7)?, 7)?,
                    created_at: row.get(8)?,
                })
            },
        )
        .map_err(database_error)
        .map_err(Into::into)
}

fn to_u32(value: i64, column: usize) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|_| conversion_error(column, "integer exceeds u32"))
}

fn to_u8(value: i64, column: usize) -> rusqlite::Result<u8> {
    u8::try_from(value).map_err(|_| conversion_error(column, "integer exceeds u8"))
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

fn invalid_stored() -> ReviewSchemeError {
    ReviewSchemeError::Persistence(crate::application::PersistenceError::UnsupportedConfiguration)
}

fn question_error(error: crate::application::QuestionError) -> ReviewSchemeError {
    match error {
        crate::application::QuestionError::Persistence(error) => {
            ReviewSchemeError::Persistence(error)
        }
        _ => invalid_stored(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use tempfile::{TempDir, tempdir};

    use super::*;
    use crate::application::{
        AddQuestionAttemptInput, CreateQuestionInput, CreateSubjectInput, ImportRequest,
        QuestionRegionInput, QuestionUseCases, ResourceRepository, ReviewSchemeTypeQuotaInput,
        ReviewSchemeUseCases, SaveReviewSchemeInput, ScheduleUseCases, SetWorkbookSubjectInput,
        WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{
        SqliteBlobStore, SqliteQuestionRepository, SqliteScheduleRepository,
        SqliteWorkspaceRepository,
    };

    struct SchemeFixture {
        _directory: TempDir,
        questions: QuestionUseCases<SqliteQuestionRepository>,
        schemes: ReviewSchemeUseCases<SqliteReviewSchemeRepository>,
        document_id: String,
        subject_id: String,
    }

    impl SchemeFixture {
        fn add_mistake(&self, title: &str, question_type: &str) -> String {
            let question = self
                .questions
                .create_question(CreateQuestionInput {
                    document_id: self.document_id.clone(),
                    title: title.to_owned(),
                    subject_id: None,
                    question_type: Some(question_type.to_owned()),
                    chapter: None,
                    question_number: None,
                    difficulty: 3,
                    analysis_markdown: None,
                    region: QuestionRegionInput {
                        page_number: 1,
                        x: 0.1,
                        y: 0.1,
                        width: 0.4,
                        height: 0.2,
                    },
                    knowledge_node_ids: Vec::new(),
                })
                .expect("question should create");
            self.questions
                .add_attempt(AddQuestionAttemptInput {
                    question_id: question.question.id.clone(),
                    result: "incorrect".to_owned(),
                    attempted_on: "2026-07-19".to_owned(),
                    duration_seconds: None,
                    answer_note: None,
                })
                .expect("mistake should activate review");
            question.question.id
        }

        fn save_scheme(&self, daily_quota: u32) -> String {
            let dashboard = self
                .schemes
                .save_scheme(SaveReviewSchemeInput {
                    scheme_id: None,
                    name: "高数每日错题".to_owned(),
                    subject_id: self.subject_id.clone(),
                    all_subject_workbooks: false,
                    daily_quota,
                    enabled: true,
                    document_ids: vec![self.document_id.clone()],
                    type_quotas: vec![
                        quota("choice", 1),
                        quota("blank", 1),
                        quota("solution", daily_quota.saturating_sub(2)),
                        quota("other", 0),
                    ],
                    today: "2026-07-20".to_owned(),
                })
                .expect("scheme should save");
            dashboard.schemes[0].scheme.id.clone()
        }
    }

    fn quota(question_type: &str, quota: u32) -> ReviewSchemeTypeQuotaInput {
        ReviewSchemeTypeQuotaInput {
            question_type: question_type.to_owned(),
            quota,
        }
    }

    fn initialized_fixture() -> SchemeFixture {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let subject = ScheduleUseCases::new(SqliteScheduleRepository::new(directory.path()))
            .create_subject(&CreateSubjectInput {
                name: "高等数学".to_owned(),
                color_key: "blue".to_owned(),
                sort_order: 0,
            })
            .expect("subject should create");
        let source = directory.path().join("scheme-workbook.pdf");
        std::fs::write(&source, b"scheme-workbook").expect("fixture should write");
        let resources = SqliteBlobStore::new(directory.path());
        let document = resources
            .import_file(
                &source,
                &ImportRequest {
                    job_id: Uuid::now_v7().to_string(),
                    document_id: Uuid::now_v7().to_string(),
                    title: "高数习题册".to_owned(),
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
            .expect("page count should persist");
        let questions = QuestionUseCases::new(SqliteQuestionRepository::new(directory.path()));
        questions
            .set_workbook_subject(&SetWorkbookSubjectInput {
                document_id: document.id.clone(),
                subject_id: Some(subject.id.clone()),
            })
            .expect("workbook subject should persist");
        SchemeFixture {
            schemes: ReviewSchemeUseCases::new(SqliteReviewSchemeRepository::new(directory.path())),
            questions,
            document_id: document.id,
            subject_id: subject.id,
            _directory: directory,
        }
    }

    #[test]
    fn queue_fills_a_missing_type_without_crossing_the_scheme_scope() {
        let fixture = initialized_fixture();
        fixture.add_mistake("选择一", "choice");
        fixture.add_mistake("选择二", "choice");
        fixture.add_mistake("解答一", "solution");
        let scheme_id = fixture.save_scheme(3);

        let dashboard = fixture
            .schemes
            .generate_queue(&crate::application::GenerateReviewSchemeQueueInput {
                scheme_id,
                queue_date: "2026-07-20".to_owned(),
                temporary_document_id: None,
            })
            .expect("queue should generate");
        let queue = dashboard.schemes[0]
            .queue
            .as_ref()
            .expect("today queue should exist");

        assert_eq!(queue.items.len(), 3);
        assert!(
            queue
                .items
                .iter()
                .all(|item| item.question.question.document_id == fixture.document_id)
        );
    }

    #[test]
    fn unfinished_items_keep_their_order_at_the_next_queue_front() {
        let fixture = initialized_fixture();
        fixture.add_mistake("第一题", "choice");
        fixture.add_mistake("第二题", "blank");
        let scheme_id = fixture.save_scheme(2);
        let first_dashboard = fixture
            .schemes
            .generate_queue(&crate::application::GenerateReviewSchemeQueueInput {
                scheme_id: scheme_id.clone(),
                queue_date: "2026-07-20".to_owned(),
                temporary_document_id: None,
            })
            .expect("first queue should generate");
        let original_ids = first_dashboard.schemes[0]
            .queue
            .as_ref()
            .expect("first queue should exist")
            .items
            .iter()
            .map(|item| item.question.question.id.as_str())
            .collect::<Vec<_>>();

        let dashboard = fixture
            .schemes
            .generate_queue(&crate::application::GenerateReviewSchemeQueueInput {
                scheme_id,
                queue_date: "2026-07-21".to_owned(),
                temporary_document_id: None,
            })
            .expect("next queue should carry pending items");
        let items = &dashboard.schemes[0]
            .queue
            .as_ref()
            .expect("next queue should exist")
            .items;
        let carried_ids = items
            .iter()
            .map(|item| item.question.question.id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|item| item.carried));
        assert_eq!(carried_ids, original_ids);
    }

    #[test]
    fn rest_day_does_not_create_a_queue() {
        let fixture = initialized_fixture();
        fixture.add_mistake("休息日前错题", "solution");
        let scheme_id = fixture.save_scheme(2);
        fixture
            .schemes
            .set_rest_weekdays(&[6], "2026-07-19")
            .expect("rest day should save");

        let dashboard = fixture
            .schemes
            .generate_queue(&crate::application::GenerateReviewSchemeQueueInput {
                scheme_id,
                queue_date: "2026-07-19".to_owned(),
                temporary_document_id: None,
            })
            .expect("rest day generation should be harmless");

        assert!(dashboard.schemes[0].is_rest_day);
        assert!(dashboard.schemes[0].queue.is_none());
    }

    #[test]
    fn undo_restores_the_last_feedback_and_reopens_the_queue_item() {
        let fixture = initialized_fixture();
        let question_id = fixture.add_mistake("可撤销错题", "solution");
        let scheme_id = fixture.save_scheme(2);
        let generated = fixture
            .schemes
            .generate_queue(&crate::application::GenerateReviewSchemeQueueInput {
                scheme_id,
                queue_date: "2026-07-20".to_owned(),
                temporary_document_id: None,
            })
            .expect("queue should generate");
        let queue_id = generated.schemes[0]
            .queue
            .as_ref()
            .expect("queue should exist")
            .id
            .clone();
        let completed = fixture
            .schemes
            .submit_review(&crate::application::SubmitReviewSchemeResultInput {
                queue_id: queue_id.clone(),
                question_id,
                rating: "mastered".to_owned(),
                today: "2026-07-20".to_owned(),
            })
            .expect("feedback should save");
        assert_eq!(
            completed.schemes[0]
                .queue
                .as_ref()
                .expect("queue should exist")
                .completed_count,
            1
        );

        let undone = fixture
            .schemes
            .undo_last_review(&crate::application::UndoReviewSchemeResultInput {
                queue_id,
                today: "2026-07-20".to_owned(),
            })
            .expect("latest feedback should undo");
        let queue = undone.schemes[0]
            .queue
            .as_ref()
            .expect("queue should still exist");

        assert_eq!(queue.completed_count, 0);
        assert_eq!(queue.items[0].state, ReviewSchemeItemState::Pending);
        assert!(queue.items[0].review_event.is_none());
    }
}
