use super::{LocalDate, QuestionBundle};

/// User feedback after one scheduled review.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewRating {
    Mastered,
    Uncertain,
    Failed,
    Skipped,
}

impl ReviewRating {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "mastered" => Some(Self::Mastered),
            "uncertain" => Some(Self::Uncertain),
            "failed" => Some(Self::Failed),
            "skipped" => Some(Self::Skipped),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Mastered => "mastered",
            Self::Uncertain => "uncertain",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
        }
    }
}

/// Current user-facing mastery state for one active mistake.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewMastery {
    New,
    Learning,
    Uncertain,
    Mastered,
}

impl ReviewMastery {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "new" => Some(Self::New),
            "learning" => Some(Self::Learning),
            "uncertain" => Some(Self::Uncertain),
            "mastered" => Some(Self::Mastered),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Learning => "learning",
            Self::Uncertain => "uncertain",
            Self::Mastered => "mastered",
        }
    }
}

/// Why one question entered a stable daily queue snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewSelectionKind {
    Pinned,
    Overdue,
    Due,
    New,
    Early,
    Manual,
}

impl ReviewSelectionKind {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "pinned" => Some(Self::Pinned),
            "overdue" => Some(Self::Overdue),
            "due" => Some(Self::Due),
            "new" => Some(Self::New),
            "early" => Some(Self::Early),
            "manual" => Some(Self::Manual),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Pinned => "pinned",
            Self::Overdue => "overdue",
            Self::Due => "due",
            Self::New => "new",
            Self::Early => "early",
            Self::Manual => "manual",
        }
    }
}

/// Completion state of one immutable queue position.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewItemState {
    Pending,
    Completed,
}

impl ReviewItemState {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "completed" => Some(Self::Completed),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Completed => "completed",
        }
    }
}

/// Aggregate mistake facts derived from attempts plus user controls.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MistakeProfile {
    pub(crate) question_id: String,
    pub(crate) first_mistake_at: Option<i64>,
    pub(crate) last_mistake_at: Option<i64>,
    pub(crate) mistake_count: u32,
    pub(crate) consecutive_failure_count: u32,
    pub(crate) active: bool,
    pub(crate) user_priority: u8,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// Current scheduling state under one explicit policy version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewState {
    pub(crate) question_id: String,
    pub(crate) policy_version: u32,
    pub(crate) mastery: ReviewMastery,
    pub(crate) due_date: LocalDate,
    pub(crate) last_reviewed_at: Option<i64>,
    pub(crate) successful_streak: u32,
    pub(crate) manual_pin_date: Option<LocalDate>,
    pub(crate) suspended_at: Option<i64>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// One immutable review feedback and scheduling transition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewEvent {
    pub(crate) id: String,
    pub(crate) question_id: String,
    pub(crate) attempt_id: Option<String>,
    pub(crate) rating: ReviewRating,
    pub(crate) previous_due_date: LocalDate,
    pub(crate) next_due_date: LocalDate,
    pub(crate) interval_days: u32,
    pub(crate) policy_version: u32,
    pub(crate) created_at: i64,
}

/// Workspace-level defaults used when creating a daily queue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewPreferences {
    pub(crate) daily_quota: u32,
    pub(crate) early_fill_enabled: bool,
}

/// Typed explanation frozen with one queue item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewReason {
    pub(crate) selection: ReviewSelectionKind,
    pub(crate) overdue_days: u32,
    pub(crate) failure_streak: u32,
    pub(crate) mistake_count: u32,
    pub(crate) user_priority: u8,
    pub(crate) knowledge_weakness: u8,
    pub(crate) days_since_attempt: u32,
    pub(crate) is_early: bool,
}

/// One active mistake with its source question and recent history.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReviewQuestion {
    pub(crate) question: QuestionBundle,
    pub(crate) profile: MistakeProfile,
    pub(crate) state: ReviewState,
    pub(crate) recent_events: Vec<ReviewEvent>,
}

/// One position in the stable daily queue.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DailyReviewItem {
    pub(crate) question: QuestionBundle,
    pub(crate) available: bool,
    pub(crate) position: u32,
    pub(crate) priority_score: u32,
    pub(crate) reason: ReviewReason,
    pub(crate) state: ReviewItemState,
    pub(crate) review_event: Option<ReviewEvent>,
    pub(crate) inserted_at: i64,
    pub(crate) completed_at: Option<i64>,
}

/// One per-day queue snapshot that remains stable after generation.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DailyReviewQueue {
    pub(crate) id: String,
    pub(crate) queue_date: LocalDate,
    pub(crate) quota: u32,
    pub(crate) generated_at: i64,
    pub(crate) completed_count: u32,
    pub(crate) items: Vec<DailyReviewItem>,
}

/// Counts that keep the user's true review backlog visible.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewBacklog {
    pub(crate) active_count: u32,
    pub(crate) due_count: u32,
    pub(crate) overdue_count: u32,
    pub(crate) queued_remaining: u32,
    pub(crate) estimated_clear_days: u32,
}

/// Complete data required by the offline review page.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReviewDashboard {
    pub(crate) preferences: ReviewPreferences,
    pub(crate) backlog: ReviewBacklog,
    pub(crate) queue: Option<DailyReviewQueue>,
    pub(crate) active_questions: Vec<ReviewQuestion>,
}
