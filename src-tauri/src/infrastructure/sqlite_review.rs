use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use uuid::Uuid;

use crate::application::{
    REVIEW_POLICY_VERSION, ReviewCandidateFacts, ReviewError, ReviewRepository,
    ScoredReviewCandidate, ValidatedReviewSubmission, apply_rating, score_candidate,
};
use crate::domain::{
    AttemptResult, DailyReviewItem, DailyReviewQueue, LocalDate, MistakeProfile, ReviewBacklog,
    ReviewDashboard, ReviewEvent, ReviewItemState, ReviewMastery, ReviewPreferences,
    ReviewQuestion, ReviewRating, ReviewReason, ReviewSelectionKind, ReviewState,
};

use super::sqlite_question::load_bundle;
use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

/// `SQLite` adapter for mistake state, scheduling, and daily queue snapshots.
#[derive(Debug, Clone)]
pub(crate) struct SqliteReviewRepository {
    database_path: PathBuf,
}

impl SqliteReviewRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, ReviewError> {
        if !self.database_path.exists() {
            return Err(ReviewError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl ReviewRepository for SqliteReviewRepository {
    fn dashboard(&self, today: &LocalDate) -> Result<ReviewDashboard, ReviewError> {
        let connection = self.open()?;
        let (workspace_id, preferences) = load_workspace_review(&connection)?;
        let queue = load_queue(&connection, &workspace_id, today)?;
        let active_questions = load_active_questions(&connection)?;
        let backlog = load_backlog(&connection, today, preferences.daily_quota, queue.as_ref())?;
        Ok(ReviewDashboard {
            preferences,
            backlog,
            queue,
            active_questions,
        })
    }

    fn update_preferences(
        &self,
        preferences: &ReviewPreferences,
        updated_at: i64,
    ) -> Result<(), ReviewError> {
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE workspace
                 SET daily_review_quota = ?1, early_fill_enabled = ?2,
                     updated_at = ?3, revision = revision + 1
                 WHERE singleton_key = 1",
                params![
                    i64::from(preferences.daily_quota),
                    preferences.early_fill_enabled,
                    updated_at
                ],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(ReviewError::WorkspaceNotInitialized);
        }
        Ok(())
    }

    fn set_question_review(
        &self,
        question_id: &str,
        active: bool,
        user_priority: u8,
        today: &LocalDate,
        updated_at: i64,
    ) -> Result<(), ReviewError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        ensure_available_question(&transaction, question_id)?;
        let existing = transaction
            .query_row(
                "SELECT active FROM mistake_profile WHERE question_id = ?1",
                params![question_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map_err(database_error)?;
        match (existing, active) {
            (None, true) => {
                insert_manual_profile(&transaction, question_id, user_priority, today, updated_at)?;
            }
            (None, false) => return Err(ReviewError::MistakeNotFound),
            (Some(was_active), true) => {
                transaction
                    .execute(
                        "UPDATE mistake_profile
                         SET active = 1, user_priority = ?2, updated_at = ?3
                         WHERE question_id = ?1",
                        params![question_id, i64::from(user_priority), updated_at],
                    )
                    .map_err(database_error)?;
                if !was_active {
                    transaction
                        .execute(
                            "UPDATE review_state
                             SET due_date = ?2, suspended_at = NULL, updated_at = ?3
                             WHERE question_id = ?1",
                            params![question_id, today.as_str(), updated_at],
                        )
                        .map_err(database_error)?;
                }
            }
            (Some(_), false) => {
                transaction
                    .execute(
                        "UPDATE mistake_profile SET active = 0, updated_at = ?2
                         WHERE question_id = ?1",
                        params![question_id, updated_at],
                    )
                    .map_err(database_error)?;
                transaction
                    .execute(
                        "UPDATE review_state
                         SET manual_pin_date = NULL, suspended_at = ?2, updated_at = ?2
                         WHERE question_id = ?1",
                        params![question_id, updated_at],
                    )
                    .map_err(database_error)?;
            }
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn pin_question(
        &self,
        question_id: &str,
        pin_date: Option<&LocalDate>,
        updated_at: i64,
    ) -> Result<(), ReviewError> {
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE review_state
                 SET manual_pin_date = ?2, updated_at = ?3
                 WHERE question_id = ?1 AND suspended_at IS NULL
                   AND EXISTS(
                       SELECT 1 FROM mistake_profile
                       WHERE question_id = ?1 AND active = 1
                   )",
                params![question_id, pin_date.map(LocalDate::as_str), updated_at],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(ReviewError::MistakeNotFound);
        }
        Ok(())
    }

    fn generate_queue(
        &self,
        queue_date: &LocalDate,
        requested_quota: Option<u32>,
        generated_at: i64,
    ) -> Result<(), ReviewError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        let (workspace_id, preferences) = load_workspace_review(&transaction)?;
        let exists: bool = transaction
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM daily_review_queue
                    WHERE workspace_id = ?1 AND queue_date = ?2
                 )",
                params![workspace_id, queue_date.as_str()],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if exists {
            transaction.commit().map_err(database_error)?;
            return Ok(());
        }
        let quota = requested_quota.unwrap_or(preferences.daily_quota);
        let queue_id = Uuid::now_v7().to_string();
        transaction
            .execute(
                "INSERT INTO daily_review_queue(
                    id, workspace_id, queue_date, quota, generated_at, completed_count
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 0)",
                params![
                    queue_id,
                    workspace_id,
                    queue_date.as_str(),
                    i64::from(quota),
                    generated_at
                ],
            )
            .map_err(database_error)?;
        let candidates = load_candidates(&transaction)?;
        let selected = select_candidates(
            candidates,
            quota,
            preferences.early_fill_enabled,
            queue_date,
        );
        for (position, candidate) in selected.iter().enumerate() {
            insert_scored_item(
                &transaction,
                &queue_id,
                candidate,
                u32::try_from(position).map_err(|_| invalid_stored())?,
                generated_at,
            )?;
        }
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn insert_queue_item(
        &self,
        queue_date: &LocalDate,
        question_id: &str,
        inserted_at: i64,
    ) -> Result<(), ReviewError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        let (workspace_id, _) = load_workspace_review(&transaction)?;
        let queue_id = transaction
            .query_row(
                "SELECT id FROM daily_review_queue
                 WHERE workspace_id = ?1 AND queue_date = ?2",
                params![workspace_id, queue_date.as_str()],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(ReviewError::QueueNotFound)?;
        let already_queued = transaction
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM daily_review_item
                    WHERE queue_id = ?1 AND question_id = ?2
                 )",
                params![queue_id, question_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(database_error)?;
        if already_queued {
            return Err(ReviewError::QueueItemAlreadyExists);
        }
        let facts = load_candidate(&transaction, question_id)?;
        let mut candidate = score_candidate(&facts, queue_date);
        candidate.reason.selection = ReviewSelectionKind::Manual;
        candidate.reason.is_early = candidate.due_date > *queue_date;
        let next_position: i64 = transaction
            .query_row(
                "SELECT COALESCE(MAX(position) + 1, 0)
                 FROM daily_review_item WHERE queue_id = ?1",
                params![queue_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        insert_scored_item(
            &transaction,
            &queue_id,
            &candidate,
            u32::try_from(next_position).map_err(|_| invalid_stored())?,
            inserted_at,
        )?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }

    fn submit_review(&self, input: &ValidatedReviewSubmission) -> Result<(), ReviewError> {
        let mut connection = self.open()?;
        let transaction = immediate(&mut connection)?;
        ensure_pending_item(&transaction, input)?;
        ensure_available_question(&transaction, &input.question_id)?;
        let profile = load_profile(&transaction, &input.question_id)?;
        if !profile.active {
            return Err(ReviewError::MistakeNotFound);
        }
        let state = load_state(&transaction, &input.question_id)?;
        let decision = apply_rating(
            &profile,
            &state,
            input.rating,
            &input.today,
            input.created_at,
        )?;
        if let Some(attempt_id) = &input.attempt_id {
            insert_review_attempt(&transaction, input, attempt_id)?;
        }
        update_profile_after_review(&transaction, input, &decision)?;
        update_state_after_review(&transaction, input, &decision)?;
        insert_review_event(&transaction, input, &state, &decision)?;
        complete_queue_item(&transaction, input)?;
        transaction.commit().map_err(database_error)?;
        Ok(())
    }
}

fn immediate(connection: &mut Connection) -> Result<Transaction<'_>, ReviewError> {
    connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)
        .map_err(ReviewError::from)
}

fn load_workspace_review(
    connection: &Connection,
) -> Result<(String, ReviewPreferences), ReviewError> {
    connection
        .query_row(
            "SELECT id, daily_review_quota, early_fill_enabled
             FROM workspace WHERE singleton_key = 1",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    ReviewPreferences {
                        daily_quota: to_u32(row.get(1)?, 1)?,
                        early_fill_enabled: row.get(2)?,
                    },
                ))
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(ReviewError::WorkspaceNotInitialized)
}

fn ensure_available_question(
    connection: &Connection,
    question_id: &str,
) -> Result<(), ReviewError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM question q
                JOIN resource_document d ON d.id = q.document_id
                WHERE q.id = ?1 AND q.deleted_at IS NULL
                  AND d.kind = 'pdf' AND d.role = 'workbook'
             )",
            params![question_id],
            |row| row.get(0),
        )
        .map_err(database_error)?;
    if exists {
        Ok(())
    } else {
        Err(ReviewError::QuestionNotFound)
    }
}

fn insert_manual_profile(
    transaction: &Transaction<'_>,
    question_id: &str,
    user_priority: u8,
    today: &LocalDate,
    created_at: i64,
) -> Result<(), ReviewError> {
    transaction
        .execute(
            "INSERT INTO mistake_profile(
                question_id, first_mistake_at, last_mistake_at, mistake_count,
                consecutive_failure_count, active, user_priority, created_at, updated_at
             ) VALUES (?1, NULL, NULL, 0, 0, 1, ?2, ?3, ?3)",
            params![question_id, i64::from(user_priority), created_at],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "INSERT INTO review_state(
                question_id, policy_version, mastery_level, due_date,
                last_reviewed_at, successful_streak, manual_pin_date, suspended_at,
                created_at, updated_at
             ) VALUES (?1, ?2, 'new', ?3, NULL, 0, NULL, NULL, ?4, ?4)",
            params![
                question_id,
                i64::from(REVIEW_POLICY_VERSION),
                today.as_str(),
                created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn load_candidates(connection: &Connection) -> Result<Vec<ReviewCandidateFacts>, ReviewError> {
    let sql = format!("{CANDIDATE_QUERY} GROUP BY mp.question_id");
    let mut statement = connection.prepare(&sql).map_err(database_error)?;
    statement
        .query_map([], raw_candidate)
        .map_err(database_error)?
        .map(|row| {
            let raw = row.map_err(database_error)?;
            parse_candidate(raw)
        })
        .collect()
}

fn load_candidate(
    connection: &Connection,
    question_id: &str,
) -> Result<ReviewCandidateFacts, ReviewError> {
    let sql = format!("{CANDIDATE_QUERY} AND mp.question_id = ?1 GROUP BY mp.question_id");
    let raw = connection
        .query_row(&sql, params![question_id], raw_candidate)
        .optional()
        .map_err(database_error)?
        .ok_or(ReviewError::MistakeNotFound)?;
    parse_candidate(raw)
}

const CANDIDATE_QUERY: &str = "
    SELECT mp.question_id, rs.due_date, rs.manual_pin_date, rs.last_reviewed_at,
           mp.last_mistake_at, mp.consecutive_failure_count, mp.mistake_count,
           mp.user_priority,
           strftime('%Y-%m-%d', MAX(a.attempted_at) / 1000, 'unixepoch'),
           COALESCE(MAX(CASE n.mastery_state WHEN 'weak' THEN 2 WHEN 'learning' THEN 1 ELSE 0 END), 0)
    FROM mistake_profile mp
    JOIN review_state rs ON rs.question_id = mp.question_id
    JOIN question q ON q.id = mp.question_id
    JOIN resource_document d ON d.id = q.document_id
    LEFT JOIN question_attempt a ON a.question_id = mp.question_id
    LEFT JOIN question_knowledge_node qn ON qn.question_id = mp.question_id
    LEFT JOIN knowledge_node n ON n.id = qn.node_id
    WHERE mp.active = 1 AND rs.suspended_at IS NULL AND q.deleted_at IS NULL
      AND d.kind = 'pdf' AND d.role = 'workbook'";

#[derive(Debug)]
struct RawCandidate {
    question_id: String,
    due_date: String,
    manual_pin_date: Option<String>,
    last_reviewed_at: Option<i64>,
    last_mistake_at: Option<i64>,
    failure_streak: i64,
    mistake_count: i64,
    user_priority: i64,
    last_attempt_date: Option<String>,
    knowledge_weakness: i64,
}

fn raw_candidate(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawCandidate> {
    Ok(RawCandidate {
        question_id: row.get(0)?,
        due_date: row.get(1)?,
        manual_pin_date: row.get(2)?,
        last_reviewed_at: row.get(3)?,
        last_mistake_at: row.get(4)?,
        failure_streak: row.get(5)?,
        mistake_count: row.get(6)?,
        user_priority: row.get(7)?,
        last_attempt_date: row.get(8)?,
        knowledge_weakness: row.get(9)?,
    })
}

fn parse_candidate(raw: RawCandidate) -> Result<ReviewCandidateFacts, ReviewError> {
    Ok(ReviewCandidateFacts {
        question_id: raw.question_id,
        due_date: LocalDate::parse(&raw.due_date).map_err(|_| invalid_stored())?,
        manual_pin_date: raw
            .manual_pin_date
            .as_deref()
            .map(LocalDate::parse)
            .transpose()
            .map_err(|_| invalid_stored())?,
        last_reviewed_at: raw.last_reviewed_at,
        last_mistake_at: raw.last_mistake_at,
        last_attempt_date: raw
            .last_attempt_date
            .as_deref()
            .map(LocalDate::parse)
            .transpose()
            .map_err(|_| invalid_stored())?,
        failure_streak: to_u32(raw.failure_streak, 5).map_err(database_error)?,
        mistake_count: to_u32(raw.mistake_count, 6).map_err(database_error)?,
        user_priority: to_u8(raw.user_priority, 7).map_err(database_error)?,
        knowledge_weakness: to_u8(raw.knowledge_weakness, 9).map_err(database_error)?,
    })
}

fn select_candidates(
    candidates: Vec<ReviewCandidateFacts>,
    quota: u32,
    early_fill_enabled: bool,
    today: &LocalDate,
) -> Vec<ScoredReviewCandidate> {
    let (mut due, mut early): (Vec<_>, Vec<_>) = candidates
        .into_iter()
        .map(|candidate| score_candidate(&candidate, today))
        .partition(|candidate| !candidate.reason.is_early);
    sort_candidates(&mut due);
    sort_candidates(&mut early);
    let limit = usize::try_from(quota).unwrap_or(usize::MAX);
    due.truncate(limit);
    if early_fill_enabled && due.len() < limit {
        early.truncate(limit - due.len());
        due.extend(early);
    }
    due
}

fn sort_candidates(candidates: &mut [ScoredReviewCandidate]) {
    candidates.sort_by(|left, right| {
        right
            .priority_score
            .cmp(&left.priority_score)
            .then_with(|| left.due_date.cmp(&right.due_date))
            .then_with(|| right.last_mistake_at.cmp(&left.last_mistake_at))
            .then_with(|| left.question_id.cmp(&right.question_id))
    });
}

fn insert_scored_item(
    transaction: &Transaction<'_>,
    queue_id: &str,
    candidate: &ScoredReviewCandidate,
    position: u32,
    inserted_at: i64,
) -> Result<(), ReviewError> {
    let reason = &candidate.reason;
    transaction
        .execute(
            "INSERT INTO daily_review_item(
                queue_id, question_id, position, priority_score, selection_kind,
                overdue_days, failure_streak, mistake_count, user_priority,
                knowledge_weakness, days_since_attempt, is_early, state,
                review_event_id, inserted_at, completed_at
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                'pending', NULL, ?13, NULL
             )",
            params![
                queue_id,
                candidate.question_id,
                i64::from(position),
                i64::from(candidate.priority_score),
                reason.selection.as_str(),
                i64::from(reason.overdue_days),
                i64::from(reason.failure_streak),
                i64::from(reason.mistake_count),
                i64::from(reason.user_priority),
                i64::from(reason.knowledge_weakness),
                i64::from(reason.days_since_attempt),
                reason.is_early,
                inserted_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn load_active_questions(connection: &Connection) -> Result<Vec<ReviewQuestion>, ReviewError> {
    let mut statement = connection
        .prepare(
            "SELECT mp.question_id FROM mistake_profile mp
             JOIN review_state rs ON rs.question_id = mp.question_id
             JOIN question q ON q.id = mp.question_id
             JOIN resource_document d ON d.id = q.document_id
             WHERE mp.active = 1 AND rs.suspended_at IS NULL AND q.deleted_at IS NULL
               AND d.kind = 'pdf' AND d.role = 'workbook'
             ORDER BY rs.due_date, mp.user_priority DESC, mp.updated_at DESC, mp.question_id",
        )
        .map_err(database_error)?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    ids.iter()
        .map(|question_id| load_review_question(connection, question_id))
        .collect()
}

fn load_review_question(
    connection: &Connection,
    question_id: &str,
) -> Result<ReviewQuestion, ReviewError> {
    Ok(ReviewQuestion {
        question: load_bundle(connection, question_id).map_err(question_error)?,
        profile: load_profile(connection, question_id)?,
        state: load_state(connection, question_id)?,
        recent_events: load_recent_events(connection, question_id, 5)?,
    })
}

fn load_profile(connection: &Connection, question_id: &str) -> Result<MistakeProfile, ReviewError> {
    connection
        .query_row(
            "SELECT question_id, first_mistake_at, last_mistake_at, mistake_count,
                    consecutive_failure_count, active, user_priority, created_at, updated_at
             FROM mistake_profile WHERE question_id = ?1",
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
        .ok_or(ReviewError::MistakeNotFound)
}

fn load_state(connection: &Connection, question_id: &str) -> Result<ReviewState, ReviewError> {
    let raw = connection
        .query_row(
            "SELECT question_id, policy_version, mastery_level, due_date,
                    last_reviewed_at, successful_streak, manual_pin_date,
                    suspended_at, created_at, updated_at
             FROM review_state WHERE question_id = ?1",
            params![question_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, i64>(9)?,
                ))
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(ReviewError::MistakeNotFound)?;
    Ok(ReviewState {
        question_id: raw.0,
        policy_version: to_u32(raw.1, 1).map_err(database_error)?,
        mastery: ReviewMastery::parse(&raw.2).ok_or_else(invalid_stored)?,
        due_date: LocalDate::parse(&raw.3).map_err(|_| invalid_stored())?,
        last_reviewed_at: raw.4,
        successful_streak: to_u32(raw.5, 5).map_err(database_error)?,
        manual_pin_date: raw
            .6
            .as_deref()
            .map(LocalDate::parse)
            .transpose()
            .map_err(|_| invalid_stored())?,
        suspended_at: raw.7,
        created_at: raw.8,
        updated_at: raw.9,
    })
}

fn load_recent_events(
    connection: &Connection,
    question_id: &str,
    limit: u32,
) -> Result<Vec<ReviewEvent>, ReviewError> {
    let mut statement = connection
        .prepare(
            "SELECT id, question_id, attempt_id, rating, previous_due_date,
                    next_due_date, interval_days, policy_version, created_at
             FROM review_event WHERE question_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![question_id, i64::from(limit)], raw_event)
        .map_err(database_error)?
        .map(|row| parse_event(row.map_err(database_error)?))
        .collect()
}

#[derive(Debug)]
struct RawEvent {
    id: String,
    question_id: String,
    attempt_id: Option<String>,
    rating: String,
    previous_due_date: String,
    next_due_date: String,
    interval_days: i64,
    policy_version: i64,
    created_at: i64,
}

fn raw_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawEvent> {
    Ok(RawEvent {
        id: row.get(0)?,
        question_id: row.get(1)?,
        attempt_id: row.get(2)?,
        rating: row.get(3)?,
        previous_due_date: row.get(4)?,
        next_due_date: row.get(5)?,
        interval_days: row.get(6)?,
        policy_version: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn parse_event(raw: RawEvent) -> Result<ReviewEvent, ReviewError> {
    Ok(ReviewEvent {
        id: raw.id,
        question_id: raw.question_id,
        attempt_id: raw.attempt_id,
        rating: ReviewRating::parse(&raw.rating).ok_or_else(invalid_stored)?,
        previous_due_date: LocalDate::parse(&raw.previous_due_date)
            .map_err(|_| invalid_stored())?,
        next_due_date: LocalDate::parse(&raw.next_due_date).map_err(|_| invalid_stored())?,
        interval_days: to_u32(raw.interval_days, 6).map_err(database_error)?,
        policy_version: to_u32(raw.policy_version, 7).map_err(database_error)?,
        created_at: raw.created_at,
    })
}

fn load_queue(
    connection: &Connection,
    workspace_id: &str,
    queue_date: &LocalDate,
) -> Result<Option<DailyReviewQueue>, ReviewError> {
    let header = connection
        .query_row(
            "SELECT id, quota, generated_at, completed_count
             FROM daily_review_queue WHERE workspace_id = ?1 AND queue_date = ?2",
            params![workspace_id, queue_date.as_str()],
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
        .map_err(database_error)?;
    let Some((id, quota, generated_at, completed_count)) = header else {
        return Ok(None);
    };
    let items = load_queue_items(connection, &id)?;
    Ok(Some(DailyReviewQueue {
        id,
        queue_date: queue_date.clone(),
        quota: to_u32(quota, 1).map_err(database_error)?,
        generated_at,
        completed_count: to_u32(completed_count, 3).map_err(database_error)?,
        items,
    }))
}

#[derive(Debug)]
struct RawQueueItem {
    question_id: String,
    position: i64,
    priority_score: i64,
    selection: String,
    overdue_days: i64,
    failure_streak: i64,
    mistake_count: i64,
    user_priority: i64,
    knowledge_weakness: i64,
    days_since_attempt: i64,
    is_early: bool,
    state: String,
    review_event_id: Option<String>,
    inserted_at: i64,
    completed_at: Option<i64>,
    available: bool,
}

fn load_queue_items(
    connection: &Connection,
    queue_id: &str,
) -> Result<Vec<DailyReviewItem>, ReviewError> {
    let mut statement = connection
        .prepare(
            "SELECT i.question_id, i.position, i.priority_score, i.selection_kind,
                    i.overdue_days, i.failure_streak, i.mistake_count, i.user_priority,
                    i.knowledge_weakness, i.days_since_attempt, i.is_early, i.state,
                    i.review_event_id, i.inserted_at, i.completed_at,
                    q.deleted_at IS NULL AND d.kind = 'pdf' AND d.role = 'workbook'
             FROM daily_review_item i
             JOIN question q ON q.id = i.question_id
             JOIN resource_document d ON d.id = q.document_id
             WHERE i.queue_id = ?1 ORDER BY i.position",
        )
        .map_err(database_error)?;
    let raw_items = statement
        .query_map(params![queue_id], |row| {
            Ok(RawQueueItem {
                question_id: row.get(0)?,
                position: row.get(1)?,
                priority_score: row.get(2)?,
                selection: row.get(3)?,
                overdue_days: row.get(4)?,
                failure_streak: row.get(5)?,
                mistake_count: row.get(6)?,
                user_priority: row.get(7)?,
                knowledge_weakness: row.get(8)?,
                days_since_attempt: row.get(9)?,
                is_early: row.get(10)?,
                state: row.get(11)?,
                review_event_id: row.get(12)?,
                inserted_at: row.get(13)?,
                completed_at: row.get(14)?,
                available: row.get(15)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    raw_items
        .into_iter()
        .map(|raw| parse_queue_item(connection, &raw))
        .collect()
}

fn parse_queue_item(
    connection: &Connection,
    raw: &RawQueueItem,
) -> Result<DailyReviewItem, ReviewError> {
    let selection = ReviewSelectionKind::parse(&raw.selection).ok_or_else(invalid_stored)?;
    let review_event = raw
        .review_event_id
        .as_deref()
        .map(|event_id| load_event(connection, event_id))
        .transpose()?;
    Ok(DailyReviewItem {
        question: load_bundle(connection, &raw.question_id).map_err(question_error)?,
        available: raw.available,
        position: to_u32(raw.position, 1).map_err(database_error)?,
        priority_score: to_u32(raw.priority_score, 2).map_err(database_error)?,
        reason: ReviewReason {
            selection,
            overdue_days: to_u32(raw.overdue_days, 4).map_err(database_error)?,
            failure_streak: to_u32(raw.failure_streak, 5).map_err(database_error)?,
            mistake_count: to_u32(raw.mistake_count, 6).map_err(database_error)?,
            user_priority: to_u8(raw.user_priority, 7).map_err(database_error)?,
            knowledge_weakness: to_u8(raw.knowledge_weakness, 8).map_err(database_error)?,
            days_since_attempt: to_u32(raw.days_since_attempt, 9).map_err(database_error)?,
            is_early: raw.is_early,
        },
        state: ReviewItemState::parse(&raw.state).ok_or_else(invalid_stored)?,
        review_event,
        inserted_at: raw.inserted_at,
        completed_at: raw.completed_at,
    })
}

fn load_event(connection: &Connection, event_id: &str) -> Result<ReviewEvent, ReviewError> {
    let raw = connection
        .query_row(
            "SELECT id, question_id, attempt_id, rating, previous_due_date,
                    next_due_date, interval_days, policy_version, created_at
             FROM review_event WHERE id = ?1",
            params![event_id],
            raw_event,
        )
        .optional()
        .map_err(database_error)?
        .ok_or_else(invalid_stored)?;
    parse_event(raw)
}

fn load_backlog(
    connection: &Connection,
    today: &LocalDate,
    daily_quota: u32,
    queue: Option<&DailyReviewQueue>,
) -> Result<ReviewBacklog, ReviewError> {
    let (active, due, overdue) = connection
        .query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN rs.due_date <= ?1 OR rs.manual_pin_date = ?1 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN rs.due_date < ?1 THEN 1 ELSE 0 END)
             FROM mistake_profile mp
             JOIN review_state rs ON rs.question_id = mp.question_id
             JOIN question q ON q.id = mp.question_id
             JOIN resource_document d ON d.id = q.document_id
             WHERE mp.active = 1 AND rs.suspended_at IS NULL AND q.deleted_at IS NULL
               AND d.kind = 'pdf' AND d.role = 'workbook'",
            params![today.as_str()],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?.unwrap_or(0),
                    row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                ))
            },
        )
        .map_err(database_error)?;
    let queued_remaining = queue.map_or(0, |value| {
        value
            .items
            .iter()
            .filter(|item| item.state == ReviewItemState::Pending)
            .count()
    });
    let due_count = to_u32(due, 1).map_err(database_error)?;
    let effective_quota = queue.map_or(daily_quota, |value| value.quota);
    let estimated_clear_days = if due_count == 0 {
        0
    } else {
        due_count.div_ceil(effective_quota)
    };
    Ok(ReviewBacklog {
        active_count: to_u32(active, 0).map_err(database_error)?,
        due_count,
        overdue_count: to_u32(overdue, 2).map_err(database_error)?,
        queued_remaining: u32::try_from(queued_remaining).unwrap_or(u32::MAX),
        estimated_clear_days,
    })
}

fn ensure_pending_item(
    transaction: &Transaction<'_>,
    input: &ValidatedReviewSubmission,
) -> Result<(), ReviewError> {
    let state = transaction
        .query_row(
            "SELECT i.state FROM daily_review_item i
             JOIN daily_review_queue q ON q.id = i.queue_id
             WHERE i.queue_id = ?1 AND i.question_id = ?2 AND q.queue_date = ?3",
            params![input.queue_id, input.question_id, input.today.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(ReviewError::QueueItemNotFound)?;
    match ReviewItemState::parse(&state) {
        Some(ReviewItemState::Pending) => Ok(()),
        Some(ReviewItemState::Completed) => Err(ReviewError::QueueItemCompleted),
        None => Err(invalid_stored()),
    }
}

fn insert_review_attempt(
    transaction: &Transaction<'_>,
    input: &ValidatedReviewSubmission,
    attempt_id: &str,
) -> Result<(), ReviewError> {
    let result = match input.rating {
        ReviewRating::Mastered => AttemptResult::Correct,
        ReviewRating::Uncertain => AttemptResult::Uncertain,
        ReviewRating::Failed => AttemptResult::Incorrect,
        ReviewRating::Skipped => return Err(ReviewError::InvalidInput),
    };
    transaction
        .execute(
            "INSERT INTO question_attempt(
                id, question_id, result, attempted_at,
                duration_seconds, answer_note, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4)",
            params![
                attempt_id,
                input.question_id,
                result.as_str(),
                input.created_at,
                input.duration_seconds.map(i64::from),
                input.answer_note
            ],
        )
        .map_err(database_error)?;
    transaction
        .execute(
            "UPDATE question SET updated_at = ?2 WHERE id = ?1",
            params![input.question_id, input.created_at],
        )
        .map_err(database_error)?;
    Ok(())
}

fn update_profile_after_review(
    transaction: &Transaction<'_>,
    input: &ValidatedReviewSubmission,
    decision: &crate::application::ReviewDecision,
) -> Result<(), ReviewError> {
    transaction
        .execute(
            "UPDATE mistake_profile
             SET first_mistake_at = ?2, last_mistake_at = ?3, mistake_count = ?4,
                 consecutive_failure_count = ?5, updated_at = ?6
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

fn update_state_after_review(
    transaction: &Transaction<'_>,
    input: &ValidatedReviewSubmission,
    decision: &crate::application::ReviewDecision,
) -> Result<(), ReviewError> {
    transaction
        .execute(
            "UPDATE review_state
             SET policy_version = ?2, mastery_level = ?3, due_date = ?4,
                 last_reviewed_at = ?5, successful_streak = ?6,
                 manual_pin_date = NULL, updated_at = ?5
             WHERE question_id = ?1 AND suspended_at IS NULL",
            params![
                input.question_id,
                i64::from(REVIEW_POLICY_VERSION),
                decision.mastery.as_str(),
                decision.next_due_date.as_str(),
                input.created_at,
                i64::from(decision.successful_streak)
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_review_event(
    transaction: &Transaction<'_>,
    input: &ValidatedReviewSubmission,
    previous: &ReviewState,
    decision: &crate::application::ReviewDecision,
) -> Result<(), ReviewError> {
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
                previous.due_date.as_str(),
                decision.next_due_date.as_str(),
                i64::from(decision.interval_days),
                i64::from(REVIEW_POLICY_VERSION),
                input.created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn complete_queue_item(
    transaction: &Transaction<'_>,
    input: &ValidatedReviewSubmission,
) -> Result<(), ReviewError> {
    let changed = transaction
        .execute(
            "UPDATE daily_review_item
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
    if changed == 0 {
        return Err(ReviewError::QueueItemCompleted);
    }
    transaction
        .execute(
            "UPDATE daily_review_queue
             SET completed_count = completed_count + 1 WHERE id = ?1",
            params![input.queue_id],
        )
        .map_err(database_error)?;
    Ok(())
}

fn to_u32(value: i64, column: usize) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|_| conversion_error(column, "integer is outside u32"))
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

fn invalid_stored() -> ReviewError {
    ReviewError::Persistence(crate::application::PersistenceError::UnsupportedConfiguration)
}

fn question_error(error: crate::application::QuestionError) -> ReviewError {
    match error {
        crate::application::QuestionError::Persistence(error) => ReviewError::Persistence(error),
        crate::application::QuestionError::WorkspaceNotInitialized => {
            ReviewError::WorkspaceNotInitialized
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
        AddQuestionAttemptInput, CreateQuestionInput, GenerateReviewQueueInput, ImportRequest,
        InsertReviewQueueItemInput, PinQuestionReviewInput, QuestionRegionInput, QuestionUseCases,
        ResourceRepository, ReviewUseCases, SetQuestionReviewInput, SubmitReviewInput,
        UpdateReviewPreferencesInput, WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{
        SqliteBlobStore, SqliteQuestionRepository, SqliteWorkspaceRepository,
    };

    struct ReviewFixture {
        directory: TempDir,
        questions: QuestionUseCases<SqliteQuestionRepository>,
        reviews: ReviewUseCases<SqliteReviewRepository>,
        document_id: String,
        question_id: String,
    }

    impl ReviewFixture {
        fn create_question(&self, title: &str) -> String {
            self.questions
                .create_question(CreateQuestionInput {
                    document_id: self.document_id.clone(),
                    title: title.to_owned(),
                    subject_id: None,
                    question_type: Some("solution".to_owned()),
                    chapter: Some("数据结构".to_owned()),
                    question_number: None,
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
                .expect("question should create")
                .question
                .id
        }

        fn add_attempt(&self, question_id: &str, result: &str) {
            self.questions
                .add_attempt(AddQuestionAttemptInput {
                    question_id: question_id.to_owned(),
                    result: result.to_owned(),
                    attempted_on: "2026-07-19".to_owned(),
                    duration_seconds: Some(120),
                    answer_note: None,
                })
                .expect("attempt should persist");
        }
    }

    fn initialized_fixture() -> ReviewFixture {
        let directory = tempdir().expect("temporary directory should exist");
        let workspace = SqliteWorkspaceRepository::new(directory.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let source = directory.path().join("review-workbook.pdf");
        std::fs::write(&source, b"review-question-fixture").expect("fixture should write");
        let resources = SqliteBlobStore::new(directory.path());
        let document = resources
            .import_file(
                &source,
                &ImportRequest {
                    job_id: Uuid::now_v7().to_string(),
                    document_id: Uuid::now_v7().to_string(),
                    title: "复习习题册".to_owned(),
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
        let reviews = ReviewUseCases::new(SqliteReviewRepository::new(directory.path()));
        let mut fixture = ReviewFixture {
            directory,
            questions,
            reviews,
            document_id: document.id,
            question_id: String::new(),
        };
        fixture.question_id = fixture.create_question("线性表错题");
        fixture
    }

    #[test]
    fn incorrect_attempt_activates_a_due_mistake_profile() {
        let fixture = initialized_fixture();
        fixture.add_attempt(&fixture.question_id, "incorrect");

        let dashboard = fixture
            .reviews
            .dashboard("2026-07-19")
            .expect("dashboard should load");

        assert_eq!(dashboard.backlog.active_count, 1);
        assert_eq!(dashboard.backlog.due_count, 1);
        assert_eq!(dashboard.active_questions[0].profile.mistake_count, 1);
        assert_eq!(
            dashboard.active_questions[0].state.mastery,
            ReviewMastery::Learning
        );
    }

    #[test]
    fn existing_daily_queue_stays_stable_until_manual_insertion() {
        let fixture = initialized_fixture();
        fixture.add_attempt(&fixture.question_id, "incorrect");
        fixture
            .reviews
            .generate_queue(&GenerateReviewQueueInput {
                queue_date: "2026-07-19".to_owned(),
                quota: Some(5),
            })
            .expect("queue should generate");
        let second_id = fixture.create_question("树与二叉树错题");
        fixture.add_attempt(&second_id, "incorrect");

        let stable = fixture
            .reviews
            .generate_queue(&GenerateReviewQueueInput {
                queue_date: "2026-07-19".to_owned(),
                quota: Some(5),
            })
            .expect("existing queue should return");

        assert_eq!(
            stable.queue.as_ref().map(|queue| queue.items.len()),
            Some(1)
        );
        assert_eq!(stable.backlog.due_count, 2);

        let inserted = fixture
            .reviews
            .insert_queue_item(&InsertReviewQueueItemInput {
                queue_date: "2026-07-19".to_owned(),
                question_id: second_id,
            })
            .expect("manual item should append");
        let queue = inserted.queue.expect("queue should exist");
        assert_eq!(queue.items.len(), 2);
        assert_eq!(queue.items[1].reason.selection, ReviewSelectionKind::Manual);

        let duplicate = fixture
            .reviews
            .insert_queue_item(&InsertReviewQueueItemInput {
                queue_date: "2026-07-19".to_owned(),
                question_id: fixture.question_id.clone(),
            })
            .expect_err("an existing queue item must not be inserted twice");
        assert!(matches!(duplicate, ReviewError::QueueItemAlreadyExists));
    }

    #[test]
    fn mastered_review_appends_attempt_event_and_updates_due_date() {
        let fixture = initialized_fixture();
        fixture.add_attempt(&fixture.question_id, "incorrect");
        let generated = fixture
            .reviews
            .generate_queue(&GenerateReviewQueueInput {
                queue_date: "2026-07-19".to_owned(),
                quota: None,
            })
            .expect("queue should generate");
        let queue_id = generated.queue.expect("queue should exist").id;

        let dashboard = fixture
            .reviews
            .submit_review(SubmitReviewInput {
                queue_id,
                question_id: fixture.question_id.clone(),
                rating: "mastered".to_owned(),
                today: "2026-07-19".to_owned(),
                duration_seconds: Some(60),
                answer_note: Some("本次已掌握".to_owned()),
            })
            .expect("review should complete");

        let queue = dashboard.queue.expect("queue should remain visible");
        assert_eq!(queue.completed_count, 1);
        assert_eq!(queue.items[0].state, ReviewItemState::Completed);
        assert_eq!(
            dashboard.active_questions[0].state.due_date.as_str(),
            "2026-07-26"
        );
        assert_eq!(dashboard.active_questions[0].question.attempts.len(), 2);
        assert_eq!(dashboard.active_questions[0].recent_events.len(), 1);
    }

    #[test]
    fn preferences_update_changes_backlog_clear_estimate() {
        let fixture = initialized_fixture();
        fixture.add_attempt(&fixture.question_id, "incorrect");

        let dashboard = fixture
            .reviews
            .update_preferences(&UpdateReviewPreferencesInput {
                daily_quota: 1,
                early_fill_enabled: true,
                today: "2026-07-19".to_owned(),
            })
            .expect("preferences should update");

        assert_eq!(dashboard.preferences.daily_quota, 1);
        assert!(dashboard.preferences.early_fill_enabled);
        assert_eq!(dashboard.backlog.estimated_clear_days, 1);
    }

    #[test]
    fn early_fill_marks_a_future_question_without_changing_its_due_date() {
        let fixture = initialized_fixture();
        fixture.add_attempt(&fixture.question_id, "incorrect");
        fixture
            .reviews
            .update_preferences(&UpdateReviewPreferencesInput {
                daily_quota: 1,
                early_fill_enabled: true,
                today: "2026-07-19".to_owned(),
            })
            .expect("preferences should update");
        let generated = fixture
            .reviews
            .generate_queue(&GenerateReviewQueueInput {
                queue_date: "2026-07-19".to_owned(),
                quota: None,
            })
            .expect("first queue should generate");
        fixture
            .reviews
            .submit_review(SubmitReviewInput {
                queue_id: generated.queue.expect("queue should exist").id,
                question_id: fixture.question_id.clone(),
                rating: "mastered".to_owned(),
                today: "2026-07-19".to_owned(),
                duration_seconds: None,
                answer_note: None,
            })
            .expect("mastered review should schedule");

        let next_day = fixture
            .reviews
            .generate_queue(&GenerateReviewQueueInput {
                queue_date: "2026-07-20".to_owned(),
                quota: None,
            })
            .expect("early queue should generate");
        let item = &next_day.queue.expect("queue should exist").items[0];
        assert_eq!(item.reason.selection, ReviewSelectionKind::Early);
        assert!(item.reason.is_early);
        assert_eq!(
            next_day.active_questions[0].state.due_date.as_str(),
            "2026-07-26"
        );
    }

    #[test]
    fn skipped_review_records_event_without_creating_an_attempt() {
        let fixture = initialized_fixture();
        fixture.add_attempt(&fixture.question_id, "incorrect");
        let generated = fixture
            .reviews
            .generate_queue(&GenerateReviewQueueInput {
                queue_date: "2026-07-19".to_owned(),
                quota: None,
            })
            .expect("queue should generate");

        let dashboard = fixture
            .reviews
            .submit_review(SubmitReviewInput {
                queue_id: generated.queue.expect("queue should exist").id,
                question_id: fixture.question_id.clone(),
                rating: "skipped".to_owned(),
                today: "2026-07-19".to_owned(),
                duration_seconds: None,
                answer_note: None,
            })
            .expect("skip should complete queue item");

        assert_eq!(dashboard.active_questions[0].question.attempts.len(), 1);
        assert!(
            dashboard.active_questions[0].recent_events[0]
                .attempt_id
                .is_none()
        );
        assert_eq!(
            dashboard.active_questions[0].state.due_date.as_str(),
            "2026-07-20"
        );
    }

    #[test]
    fn manual_activation_pin_and_suspend_preserve_a_zero_mistake_profile() {
        let fixture = initialized_fixture();
        let activated = fixture
            .reviews
            .set_question_review(&SetQuestionReviewInput {
                question_id: fixture.question_id.clone(),
                active: true,
                user_priority: 5,
                today: "2026-07-19".to_owned(),
            })
            .expect("manual activation should persist");
        assert_eq!(activated.active_questions[0].profile.mistake_count, 0);
        let pinned = fixture
            .reviews
            .pin_question(&PinQuestionReviewInput {
                question_id: fixture.question_id.clone(),
                pin_date: Some("2026-07-19".to_owned()),
                today: "2026-07-19".to_owned(),
            })
            .expect("pin should persist");
        assert_eq!(
            pinned.active_questions[0]
                .state
                .manual_pin_date
                .as_ref()
                .map(LocalDate::as_str),
            Some("2026-07-19")
        );

        let suspended = fixture
            .reviews
            .set_question_review(&SetQuestionReviewInput {
                question_id: fixture.question_id.clone(),
                active: false,
                user_priority: 5,
                today: "2026-07-19".to_owned(),
            })
            .expect("suspension should persist");
        assert!(suspended.active_questions.is_empty());
    }

    #[test]
    fn schema_v8_backfills_historical_incorrect_attempts() {
        let fixture = initialized_fixture();
        fixture.add_attempt(&fixture.question_id, "incorrect");
        let database_path = fixture
            .directory
            .path()
            .join("workspaces/default/kystudy.sqlite3");
        let connection = Connection::open(database_path).expect("database should open");
        connection
            .execute_batch(
                "DROP INDEX idx_resource_document_active;
                 ALTER TABLE resource_document DROP COLUMN deleted_at;
                 DROP TABLE review_scheme_undo;
                 DROP TABLE question_gap_acknowledgement;
                 DROP TABLE cycle_plan_shift_undo_item;
                 DROP TABLE cycle_plan_shift_undo;
                 DROP TABLE cycle_plan_item;
                 DROP TABLE cycle_plan;
                 DROP TABLE ai_context_ref;
                 DROP TABLE review_scheme_queue_item;
                 DROP TABLE review_scheme_queue;
                 DROP TABLE review_scheme_type_quota;
                 DROP TABLE review_scheme_document;
                 DROP TABLE review_scheme;
                 DROP TABLE workspace_rest_weekday;
                 DROP TABLE workbook_profile;
                 DROP TABLE ai_message;
                 DROP TABLE ai_conversation;
                 ALTER TABLE study_plan DROP COLUMN source_ai_message_id;
                 DROP TABLE question_ai_analysis_history;
                 DROP TABLE question_ai_analysis;
                 DROP TABLE ai_response_cache;
                 DROP TABLE ai_usage;
                 DROP TABLE ai_call;
                 DROP TABLE ai_budget;
                 DROP TABLE ai_model_profile;
                 DROP TABLE ai_provider_config;
                 DROP TABLE resource_text_fts;
                 DROP TABLE resource_text_chunk;
                 DROP TABLE resource_page_text;
                 DROP TABLE resource_index_job;
                 DROP TABLE daily_review_item;
                 DROP TABLE daily_review_queue;
                 DROP TABLE review_event;
                 DROP TABLE review_state;
                 DROP TABLE mistake_profile;
                 DROP TABLE plan_stage_task;
                 DROP TABLE question_region_ocr_line;
                 DROP TABLE question_region_ocr;
                 DROP TABLE workbook_segment_question_trash;
                 DROP TABLE question_index_metadata;
                 DROP TABLE workbook_document_segment;
                 DROP TABLE workbook_category;
                 DROP INDEX idx_question_effective_subject;
                 ALTER TABLE question DROP COLUMN classification_confidence;
                 ALTER TABLE question DROP COLUMN classification_source;
                 ALTER TABLE question DROP COLUMN question_type;
                 ALTER TABLE question DROP COLUMN subject_id;
                 DELETE FROM schema_migration WHERE version IN (8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25);
                 PRAGMA user_version = 7;",
            )
            .expect("fixture should become schema v7");
        drop(connection);

        let dashboard = fixture
            .reviews
            .dashboard("2026-07-19")
            .expect("schema should migrate and backfill");

        assert_eq!(dashboard.active_questions[0].profile.mistake_count, 1);
        assert_eq!(
            dashboard.active_questions[0].state.mastery,
            ReviewMastery::Learning
        );
    }
}
