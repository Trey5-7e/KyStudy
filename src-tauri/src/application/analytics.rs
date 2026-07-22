use super::PersistenceError;
use crate::domain::{DateRange, LocalDate, SubjectColor};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AnalyticsInput {
    pub(crate) today: String,
    pub(crate) days: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AnalyticsPeriodSummary {
    pub(crate) task_count: u32,
    pub(crate) completed_task_count: u32,
    pub(crate) completion_rate_percent: Option<u32>,
    pub(crate) planned_minutes: u32,
    pub(crate) actual_minutes: u32,
    pub(crate) attempt_count: u32,
    pub(crate) correct_attempt_count: u32,
    pub(crate) accuracy_percent: Option<u32>,
    pub(crate) review_item_count: u32,
    pub(crate) completed_review_count: u32,
    pub(crate) review_completion_percent: Option<u32>,
    pub(crate) ai_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AnalyticsBacklog {
    pub(crate) overdue_tasks: u32,
    pub(crate) active_mistakes: u32,
    pub(crate) due_reviews: u32,
    pub(crate) queued_reviews: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DailyAnalyticsPoint {
    pub(crate) date: String,
    pub(crate) task_count: u32,
    pub(crate) completed_task_count: u32,
    pub(crate) planned_minutes: u32,
    pub(crate) actual_minutes: u32,
    pub(crate) attempt_count: u32,
    pub(crate) correct_attempt_count: u32,
    pub(crate) review_item_count: u32,
    pub(crate) completed_review_count: u32,
    pub(crate) ai_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SubjectAnalytics {
    pub(crate) subject_id: Option<String>,
    pub(crate) subject_name: String,
    pub(crate) color: SubjectColor,
    pub(crate) task_count: u32,
    pub(crate) completed_task_count: u32,
    pub(crate) completion_rate_percent: Option<u32>,
    pub(crate) actual_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KnowledgeAnalytics {
    pub(crate) node_id: String,
    pub(crate) node_title: String,
    pub(crate) map_id: String,
    pub(crate) map_title: String,
    pub(crate) subject_name: Option<String>,
    pub(crate) question_count: u32,
    pub(crate) attempt_count: u32,
    pub(crate) correct_attempt_count: u32,
    pub(crate) accuracy_percent: Option<u32>,
    pub(crate) active_mistake_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RepeatedMistakeAnalytics {
    pub(crate) question_id: String,
    pub(crate) question_title: String,
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) mistake_count: u32,
    pub(crate) consecutive_failure_count: u32,
    pub(crate) mastery: String,
    pub(crate) due_date: String,
    pub(crate) last_mistake_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AnalyticsOverview {
    pub(crate) range_start: String,
    pub(crate) range_end: String,
    pub(crate) previous_range_start: String,
    pub(crate) previous_range_end: String,
    pub(crate) current: AnalyticsPeriodSummary,
    pub(crate) previous: AnalyticsPeriodSummary,
    pub(crate) backlog: AnalyticsBacklog,
    pub(crate) daily: Vec<DailyAnalyticsPoint>,
    pub(crate) subjects: Vec<SubjectAnalytics>,
    pub(crate) knowledge: Vec<KnowledgeAnalytics>,
    pub(crate) repeated_mistakes: Vec<RepeatedMistakeAnalytics>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum AnalyticsError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("analytics input is invalid")]
    InvalidInput,
    #[error("stored analytics data is invalid")]
    InvalidStoredData,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl AnalyticsError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::InvalidInput => "ANALYTICS_INPUT_INVALID",
            Self::InvalidStoredData => "ANALYTICS_DATA_INVALID",
            Self::Persistence(error) => error.code(),
        }
    }
}

pub(crate) trait AnalyticsRepository: Clone + Send + Sync + 'static {
    fn load(
        &self,
        current: &DateRange,
        previous: &DateRange,
        today: &LocalDate,
    ) -> Result<AnalyticsOverview, AnalyticsError>;
}

#[derive(Debug, Clone)]
pub(crate) struct AnalyticsUseCases<R> {
    repository: R,
}

impl<R: AnalyticsRepository> AnalyticsUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn overview(
        &self,
        input: &AnalyticsInput,
    ) -> Result<AnalyticsOverview, AnalyticsError> {
        if !matches!(input.days, 7 | 28 | 90) {
            return Err(AnalyticsError::InvalidInput);
        }
        let today =
            LocalDate::parse(input.today.trim()).map_err(|_| AnalyticsError::InvalidInput)?;
        let span = input.days - 1;
        let current_start = today
            .subtract_days(span)
            .map_err(|_| AnalyticsError::InvalidInput)?;
        let previous_end = current_start
            .subtract_days(1)
            .map_err(|_| AnalyticsError::InvalidInput)?;
        let previous_start = previous_end
            .subtract_days(span)
            .map_err(|_| AnalyticsError::InvalidInput)?;
        self.repository.load(
            &DateRange::new(current_start, today.clone())
                .map_err(|_| AnalyticsError::InvalidInput)?,
            &DateRange::new(previous_start, previous_end)
                .map_err(|_| AnalyticsError::InvalidInput)?,
            &today,
        )
    }
}

pub(crate) fn rounded_percent(part: u32, total: u32) -> Option<u32> {
    (total > 0).then(|| {
        let bounded_part = part.min(total);
        let percent = (u64::from(bounded_part) * 100 + u64::from(total) / 2) / u64::from(total);
        u32::try_from(percent).unwrap_or(100)
    })
}

#[cfg(test)]
mod tests {
    use super::rounded_percent;

    #[test]
    fn percentage_is_absent_for_an_empty_denominator() {
        assert_eq!(rounded_percent(0, 0), None);
    }

    #[test]
    fn percentage_uses_nearest_integer_rounding() {
        assert_eq!(rounded_percent(2, 3), Some(67));
    }

    #[test]
    fn percentage_handles_maximum_counts_without_overflow() {
        assert_eq!(rounded_percent(u32::MAX, u32::MAX), Some(100));
    }
}
