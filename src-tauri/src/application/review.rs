use uuid::Uuid;

use super::{PersistenceError, current_utc_millis};
use crate::domain::{
    LocalDate, MistakeProfile, ReviewDashboard, ReviewMastery, ReviewPreferences, ReviewRating,
    ReviewReason, ReviewSelectionKind, ReviewState,
};

pub(crate) const REVIEW_POLICY_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UpdateReviewPreferencesInput {
    pub(crate) daily_quota: u32,
    pub(crate) early_fill_enabled: bool,
    pub(crate) today: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SetQuestionReviewInput {
    pub(crate) question_id: String,
    pub(crate) active: bool,
    pub(crate) user_priority: u8,
    pub(crate) today: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PinQuestionReviewInput {
    pub(crate) question_id: String,
    pub(crate) pin_date: Option<String>,
    pub(crate) today: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GenerateReviewQueueInput {
    pub(crate) queue_date: String,
    pub(crate) quota: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InsertReviewQueueItemInput {
    pub(crate) queue_date: String,
    pub(crate) question_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SubmitReviewInput {
    pub(crate) queue_id: String,
    pub(crate) question_id: String,
    pub(crate) rating: String,
    pub(crate) today: String,
    pub(crate) duration_seconds: Option<u32>,
    pub(crate) answer_note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedReviewSubmission {
    pub(crate) event_id: String,
    pub(crate) attempt_id: Option<String>,
    pub(crate) queue_id: String,
    pub(crate) question_id: String,
    pub(crate) rating: ReviewRating,
    pub(crate) today: LocalDate,
    pub(crate) duration_seconds: Option<u32>,
    pub(crate) answer_note: Option<String>,
    pub(crate) created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewCandidateFacts {
    pub(crate) question_id: String,
    pub(crate) due_date: LocalDate,
    pub(crate) manual_pin_date: Option<LocalDate>,
    pub(crate) last_reviewed_at: Option<i64>,
    pub(crate) last_mistake_at: Option<i64>,
    pub(crate) last_attempt_date: Option<LocalDate>,
    pub(crate) failure_streak: u32,
    pub(crate) mistake_count: u32,
    pub(crate) user_priority: u8,
    pub(crate) knowledge_weakness: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ScoredReviewCandidate {
    pub(crate) question_id: String,
    pub(crate) due_date: LocalDate,
    pub(crate) last_mistake_at: Option<i64>,
    pub(crate) priority_score: u32,
    pub(crate) reason: ReviewReason,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewDecision {
    pub(crate) mastery: ReviewMastery,
    pub(crate) next_due_date: LocalDate,
    pub(crate) interval_days: u32,
    pub(crate) successful_streak: u32,
    pub(crate) consecutive_failure_count: u32,
    pub(crate) mistake_count: u32,
    pub(crate) first_mistake_at: Option<i64>,
    pub(crate) last_mistake_at: Option<i64>,
}

/// Stable failures from mistake and daily review management.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ReviewError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("review question was not found")]
    QuestionNotFound,
    #[error("active mistake profile was not found")]
    MistakeNotFound,
    #[error("daily review queue was not found")]
    QueueNotFound,
    #[error("daily review item was not found")]
    QueueItemNotFound,
    #[error("daily review item is already completed")]
    QueueItemCompleted,
    #[error("daily review item already exists")]
    QueueItemAlreadyExists,
    #[error("daily review input is invalid")]
    InvalidInput,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl ReviewError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::QuestionNotFound => "REVIEW_QUESTION_NOT_FOUND",
            Self::MistakeNotFound => "REVIEW_MISTAKE_NOT_FOUND",
            Self::QueueNotFound => "REVIEW_QUEUE_NOT_FOUND",
            Self::QueueItemNotFound => "REVIEW_QUEUE_ITEM_NOT_FOUND",
            Self::QueueItemCompleted => "REVIEW_QUEUE_ITEM_COMPLETED",
            Self::QueueItemAlreadyExists => "REVIEW_QUEUE_ITEM_EXISTS",
            Self::InvalidInput => "REVIEW_INPUT_INVALID",
            Self::Persistence(error) => error.code(),
        }
    }
}

/// Persistence boundary for mistake profiles, scheduling state, and queue snapshots.
pub(crate) trait ReviewRepository: Clone + Send + Sync + 'static {
    fn dashboard(&self, today: &LocalDate) -> Result<ReviewDashboard, ReviewError>;
    fn update_preferences(
        &self,
        preferences: &ReviewPreferences,
        updated_at: i64,
    ) -> Result<(), ReviewError>;
    fn set_question_review(
        &self,
        question_id: &str,
        active: bool,
        user_priority: u8,
        today: &LocalDate,
        updated_at: i64,
    ) -> Result<(), ReviewError>;
    fn pin_question(
        &self,
        question_id: &str,
        pin_date: Option<&LocalDate>,
        updated_at: i64,
    ) -> Result<(), ReviewError>;
    fn generate_queue(
        &self,
        queue_date: &LocalDate,
        quota: Option<u32>,
        generated_at: i64,
    ) -> Result<(), ReviewError>;
    fn insert_queue_item(
        &self,
        queue_date: &LocalDate,
        question_id: &str,
        inserted_at: i64,
    ) -> Result<(), ReviewError>;
    fn submit_review(&self, input: &ValidatedReviewSubmission) -> Result<(), ReviewError>;
}

/// Offline review use cases with a statically dispatched persistence adapter.
#[derive(Debug, Clone)]
pub(crate) struct ReviewUseCases<R> {
    repository: R,
}

impl<R: ReviewRepository> ReviewUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn dashboard(&self, today: &str) -> Result<ReviewDashboard, ReviewError> {
        self.repository.dashboard(&parse_date(today)?)
    }

    pub(crate) fn update_preferences(
        &self,
        input: &UpdateReviewPreferencesInput,
    ) -> Result<ReviewDashboard, ReviewError> {
        validate_quota(input.daily_quota)?;
        let today = parse_date(&input.today)?;
        self.repository.update_preferences(
            &ReviewPreferences {
                daily_quota: input.daily_quota,
                early_fill_enabled: input.early_fill_enabled,
            },
            current_utc_millis()?,
        )?;
        self.repository.dashboard(&today)
    }

    pub(crate) fn set_question_review(
        &self,
        input: &SetQuestionReviewInput,
    ) -> Result<ReviewDashboard, ReviewError> {
        validate_id(&input.question_id)?;
        validate_priority(input.user_priority)?;
        let today = parse_date(&input.today)?;
        self.repository.set_question_review(
            &input.question_id,
            input.active,
            input.user_priority,
            &today,
            current_utc_millis()?,
        )?;
        self.repository.dashboard(&today)
    }

    pub(crate) fn pin_question(
        &self,
        input: &PinQuestionReviewInput,
    ) -> Result<ReviewDashboard, ReviewError> {
        validate_id(&input.question_id)?;
        let today = parse_date(&input.today)?;
        let pin_date = input.pin_date.as_deref().map(parse_date).transpose()?;
        self.repository.pin_question(
            &input.question_id,
            pin_date.as_ref(),
            current_utc_millis()?,
        )?;
        self.repository.dashboard(&today)
    }

    pub(crate) fn generate_queue(
        &self,
        input: &GenerateReviewQueueInput,
    ) -> Result<ReviewDashboard, ReviewError> {
        let queue_date = parse_date(&input.queue_date)?;
        if let Some(quota) = input.quota {
            validate_quota(quota)?;
        }
        self.repository
            .generate_queue(&queue_date, input.quota, current_utc_millis()?)?;
        self.repository.dashboard(&queue_date)
    }

    pub(crate) fn insert_queue_item(
        &self,
        input: &InsertReviewQueueItemInput,
    ) -> Result<ReviewDashboard, ReviewError> {
        validate_id(&input.question_id)?;
        let queue_date = parse_date(&input.queue_date)?;
        self.repository.insert_queue_item(
            &queue_date,
            &input.question_id,
            current_utc_millis()?,
        )?;
        self.repository.dashboard(&queue_date)
    }

    pub(crate) fn submit_review(
        &self,
        input: SubmitReviewInput,
    ) -> Result<ReviewDashboard, ReviewError> {
        validate_id(&input.queue_id)?;
        validate_id(&input.question_id)?;
        let rating = ReviewRating::parse(&input.rating).ok_or(ReviewError::InvalidInput)?;
        let today = parse_date(&input.today)?;
        if input
            .duration_seconds
            .is_some_and(|seconds| !(1..=86_400).contains(&seconds))
        {
            return Err(ReviewError::InvalidInput);
        }
        let answer_note = optional_text(input.answer_note, 10_000)?;
        let created_at = current_utc_millis()?;
        self.repository.submit_review(&ValidatedReviewSubmission {
            event_id: Uuid::now_v7().to_string(),
            attempt_id: (rating != ReviewRating::Skipped).then(|| Uuid::now_v7().to_string()),
            queue_id: input.queue_id,
            question_id: input.question_id,
            rating,
            today: today.clone(),
            duration_seconds: input.duration_seconds,
            answer_note,
            created_at,
        })?;
        self.repository.dashboard(&today)
    }
}

pub(crate) fn score_candidate(
    facts: &ReviewCandidateFacts,
    today: &LocalDate,
) -> ScoredReviewCandidate {
    let overdue_days = nonnegative_days(today.days_since(&facts.due_date));
    let days_since_attempt = facts
        .last_attempt_date
        .as_ref()
        .map_or(0, |date| nonnegative_days(today.days_since(date)).min(365));
    let pinned = facts.manual_pin_date.as_ref() == Some(today);
    let selection = if pinned {
        ReviewSelectionKind::Pinned
    } else if facts.last_reviewed_at.is_none() {
        ReviewSelectionKind::New
    } else if overdue_days > 0 {
        ReviewSelectionKind::Overdue
    } else if facts.due_date == *today {
        ReviewSelectionKind::Due
    } else {
        ReviewSelectionKind::Early
    };
    let priority_score = u32::from(pinned) * 1_000_000
        + overdue_days.saturating_mul(10_000)
        + facts.failure_streak.saturating_mul(1_000)
        + facts.mistake_count.saturating_mul(100)
        + u32::from(facts.user_priority) * 20
        + u32::from(facts.knowledge_weakness) * 30
        + days_since_attempt;
    ScoredReviewCandidate {
        question_id: facts.question_id.clone(),
        due_date: facts.due_date.clone(),
        last_mistake_at: facts.last_mistake_at,
        priority_score,
        reason: ReviewReason {
            selection,
            overdue_days,
            failure_streak: facts.failure_streak,
            mistake_count: facts.mistake_count,
            user_priority: facts.user_priority,
            knowledge_weakness: facts.knowledge_weakness,
            days_since_attempt,
            is_early: selection == ReviewSelectionKind::Early,
        },
    }
}

pub(crate) fn apply_rating(
    profile: &MistakeProfile,
    state: &ReviewState,
    rating: ReviewRating,
    today: &LocalDate,
    created_at: i64,
) -> Result<ReviewDecision, ReviewError> {
    let (
        mastery,
        successful_streak,
        failure_count,
        mistake_count,
        first_mistake_at,
        last_mistake_at,
    ) = match rating {
        ReviewRating::Mastered => (
            ReviewMastery::Mastered,
            state.successful_streak.saturating_add(1),
            0,
            profile.mistake_count,
            profile.first_mistake_at,
            profile.last_mistake_at,
        ),
        ReviewRating::Uncertain => (
            ReviewMastery::Uncertain,
            0,
            profile.consecutive_failure_count,
            profile.mistake_count,
            profile.first_mistake_at,
            profile.last_mistake_at,
        ),
        ReviewRating::Failed => (
            ReviewMastery::Learning,
            0,
            profile.consecutive_failure_count.saturating_add(1),
            profile.mistake_count.saturating_add(1),
            profile.first_mistake_at.or(Some(created_at)),
            Some(created_at),
        ),
        ReviewRating::Skipped => (
            state.mastery,
            state.successful_streak,
            profile.consecutive_failure_count,
            profile.mistake_count,
            profile.first_mistake_at,
            profile.last_mistake_at,
        ),
    };
    let interval_days = interval_days(rating, successful_streak);
    Ok(ReviewDecision {
        mastery,
        next_due_date: today
            .add_days(interval_days)
            .map_err(|_| ReviewError::InvalidInput)?,
        interval_days,
        successful_streak,
        consecutive_failure_count: failure_count,
        mistake_count,
        first_mistake_at,
        last_mistake_at,
    })
}

fn interval_days(rating: ReviewRating, successful_streak: u32) -> u32 {
    match rating {
        ReviewRating::Failed | ReviewRating::Skipped => 1,
        ReviewRating::Uncertain => 3,
        ReviewRating::Mastered => match successful_streak {
            0 | 1 => 7,
            2 => 14,
            3 => 30,
            _ => 60,
        },
    }
}

fn parse_date(value: &str) -> Result<LocalDate, ReviewError> {
    LocalDate::parse(value.trim()).map_err(|_| ReviewError::InvalidInput)
}

fn validate_id(value: &str) -> Result<(), ReviewError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| ReviewError::InvalidInput)
}

fn validate_quota(value: u32) -> Result<(), ReviewError> {
    if (1..=100).contains(&value) {
        Ok(())
    } else {
        Err(ReviewError::InvalidInput)
    }
}

fn validate_priority(value: u8) -> Result<(), ReviewError> {
    if (1..=5).contains(&value) {
        Ok(())
    } else {
        Err(ReviewError::InvalidInput)
    }
}

fn optional_text(value: Option<String>, maximum: usize) -> Result<Option<String>, ReviewError> {
    match value {
        Some(value) if !value.trim().is_empty() => {
            let value = value.trim();
            if value.chars().count() > maximum {
                return Err(ReviewError::InvalidInput);
            }
            Ok(Some(value.to_owned()))
        }
        _ => Ok(None),
    }
}

fn nonnegative_days(value: i64) -> u32 {
    u32::try_from(value.max(0)).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn date(value: &str) -> LocalDate {
        LocalDate::parse(value).expect("fixture date should parse")
    }

    fn profile() -> MistakeProfile {
        MistakeProfile {
            question_id: Uuid::now_v7().to_string(),
            first_mistake_at: Some(10),
            last_mistake_at: Some(20),
            mistake_count: 3,
            consecutive_failure_count: 2,
            active: true,
            user_priority: 4,
            created_at: 10,
            updated_at: 20,
        }
    }

    fn state() -> ReviewState {
        ReviewState {
            question_id: Uuid::now_v7().to_string(),
            policy_version: REVIEW_POLICY_VERSION,
            mastery: ReviewMastery::Learning,
            due_date: date("2026-07-15"),
            last_reviewed_at: Some(20),
            successful_streak: 0,
            manual_pin_date: None,
            suspended_at: None,
            created_at: 10,
            updated_at: 20,
        }
    }

    #[test]
    fn score_candidate_prioritizes_pin_and_exposes_typed_reasons() {
        let facts = ReviewCandidateFacts {
            question_id: Uuid::now_v7().to_string(),
            due_date: date("2026-07-15"),
            manual_pin_date: Some(date("2026-07-19")),
            last_reviewed_at: Some(1),
            last_mistake_at: Some(1),
            last_attempt_date: Some(date("2026-07-10")),
            failure_streak: 2,
            mistake_count: 3,
            user_priority: 4,
            knowledge_weakness: 2,
        };

        let scored = score_candidate(&facts, &date("2026-07-19"));

        assert_eq!(scored.reason.selection, ReviewSelectionKind::Pinned);
        assert_eq!(scored.reason.overdue_days, 4);
        assert!(scored.priority_score > 1_000_000);
    }

    #[test]
    fn mastered_feedback_uses_progressive_intervals() {
        let mut state = state();
        state.successful_streak = 2;

        let decision = apply_rating(
            &profile(),
            &state,
            ReviewRating::Mastered,
            &date("2026-07-19"),
            30,
        )
        .expect("feedback should schedule");

        assert_eq!(decision.interval_days, 30);
        assert_eq!(decision.next_due_date.as_str(), "2026-08-18");
    }

    #[test]
    fn failed_feedback_adds_a_real_mistake_and_resets_mastery() {
        let decision = apply_rating(
            &profile(),
            &state(),
            ReviewRating::Failed,
            &date("2026-07-19"),
            30,
        )
        .expect("feedback should schedule");

        assert_eq!(decision.mistake_count, 4);
        assert_eq!(decision.consecutive_failure_count, 3);
        assert_eq!(decision.next_due_date.as_str(), "2026-07-20");
    }

    #[test]
    fn skipped_feedback_preserves_mastery_and_mistake_counts() {
        let current_profile = profile();
        let current_state = state();

        let decision = apply_rating(
            &current_profile,
            &current_state,
            ReviewRating::Skipped,
            &date("2026-07-19"),
            30,
        )
        .expect("feedback should schedule");

        assert_eq!(decision.mastery, current_state.mastery);
        assert_eq!(decision.mistake_count, current_profile.mistake_count);
        assert_eq!(decision.successful_streak, current_state.successful_streak);
    }
}
