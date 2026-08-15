use super::{LocalDate, QuestionBundle, QuestionType, ReviewEvent};

/// One fixed question-type quota inside a review scheme.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewSchemeTypeQuota {
    pub(crate) question_type: QuestionType,
    pub(crate) quota: u32,
}

/// Saved scope and daily composition for one independent review routine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReviewScheme {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) subject_id: String,
    pub(crate) subject_name: String,
    pub(crate) all_subject_workbooks: bool,
    pub(crate) daily_quota: u32,
    pub(crate) enabled: bool,
    pub(crate) document_ids: Vec<String>,
    pub(crate) type_quotas: Vec<ReviewSchemeTypeQuota>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// State of one question position in a scheme-specific daily queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReviewSchemeItemState {
    Pending,
    Completed,
    Carried,
}

impl ReviewSchemeItemState {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "completed" => Some(Self::Completed),
            "carried" => Some(Self::Carried),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Completed => "completed",
            Self::Carried => "carried",
        }
    }
}

/// One stable position in a scheme-specific queue.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReviewSchemeQueueItem {
    pub(crate) question: QuestionBundle,
    pub(crate) position: u32,
    pub(crate) origin_date: LocalDate,
    pub(crate) carried: bool,
    pub(crate) state: ReviewSchemeItemState,
    pub(crate) review_event: Option<ReviewEvent>,
    pub(crate) inserted_at: i64,
    pub(crate) completed_at: Option<i64>,
}

/// One immutable daily queue for one review scheme.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReviewSchemeQueue {
    pub(crate) id: String,
    pub(crate) scheme_id: String,
    pub(crate) queue_date: LocalDate,
    pub(crate) quota: u32,
    pub(crate) generated_at: i64,
    pub(crate) completed_count: u32,
    pub(crate) items: Vec<ReviewSchemeQueueItem>,
}

/// Today-facing summary for one saved scheme.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReviewSchemeToday {
    pub(crate) scheme: ReviewScheme,
    pub(crate) is_rest_day: bool,
    pub(crate) due_count: u32,
    pub(crate) pending_classification_count: u32,
    pub(crate) queue: Option<ReviewSchemeQueue>,
}

/// Complete review-scheme state needed by the simplified mistake page.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ReviewSchemeDashboard {
    pub(crate) rest_weekdays: Vec<u8>,
    pub(crate) schemes: Vec<ReviewSchemeToday>,
}
