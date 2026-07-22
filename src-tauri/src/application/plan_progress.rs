use uuid::Uuid;

use super::{PersistenceError, rounded_percent};
use crate::domain::{LocalDate, PlanStatus};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanProgressInput {
    pub(crate) plan_id: String,
    pub(crate) today: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PlanProgressCounts {
    pub(crate) generated_task_count: u32,
    pub(crate) effective_task_count: u32,
    pub(crate) completed_task_count: u32,
    pub(crate) remaining_task_count: u32,
    pub(crate) overdue_task_count: u32,
    pub(crate) canceled_task_count: u32,
    pub(crate) trashed_task_count: u32,
    pub(crate) planned_minutes: u32,
    pub(crate) actual_minutes: u32,
}

impl PlanProgressCounts {
    fn validate(&self) -> Result<(), PlanProgressError> {
        let effective_and_canceled = self
            .effective_task_count
            .checked_add(self.canceled_task_count)
            .ok_or(PlanProgressError::InvalidStoredData)?;
        let classified = effective_and_canceled
            .checked_add(self.trashed_task_count)
            .ok_or(PlanProgressError::InvalidStoredData)?;
        let effective_states = self
            .completed_task_count
            .checked_add(self.remaining_task_count)
            .ok_or(PlanProgressError::InvalidStoredData)?;
        if classified != self.generated_task_count
            || effective_states != self.effective_task_count
            || self.overdue_task_count > self.remaining_task_count
        {
            return Err(PlanProgressError::InvalidStoredData);
        }
        Ok(())
    }

    fn checked_add(&mut self, other: &Self) -> Result<(), PlanProgressError> {
        self.generated_task_count =
            checked_sum(self.generated_task_count, other.generated_task_count)?;
        self.effective_task_count =
            checked_sum(self.effective_task_count, other.effective_task_count)?;
        self.completed_task_count =
            checked_sum(self.completed_task_count, other.completed_task_count)?;
        self.remaining_task_count =
            checked_sum(self.remaining_task_count, other.remaining_task_count)?;
        self.overdue_task_count = checked_sum(self.overdue_task_count, other.overdue_task_count)?;
        self.canceled_task_count =
            checked_sum(self.canceled_task_count, other.canceled_task_count)?;
        self.trashed_task_count = checked_sum(self.trashed_task_count, other.trashed_task_count)?;
        self.planned_minutes = checked_sum(self.planned_minutes, other.planned_minutes)?;
        self.actual_minutes = checked_sum(self.actual_minutes, other.actual_minutes)?;
        Ok(())
    }

    fn into_summary(self) -> Result<PlanProgressSummary, PlanProgressError> {
        self.validate()?;
        Ok(PlanProgressSummary {
            completion_rate_percent: rounded_percent(
                self.completed_task_count,
                self.effective_task_count,
            ),
            counts: self,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanProgressSummary {
    pub(crate) counts: PlanProgressCounts,
    pub(crate) completion_rate_percent: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanStageProgress {
    pub(crate) stage_id: String,
    pub(crate) stage_title: String,
    pub(crate) start_date: LocalDate,
    pub(crate) end_date: LocalDate,
    pub(crate) summary: PlanProgressSummary,
}

impl PlanStageProgress {
    pub(crate) fn new(
        stage_id: String,
        stage_title: String,
        start_date: LocalDate,
        end_date: LocalDate,
        counts: PlanProgressCounts,
    ) -> Result<Self, PlanProgressError> {
        if start_date > end_date {
            return Err(PlanProgressError::InvalidStoredData);
        }
        Ok(Self {
            stage_id,
            stage_title,
            start_date,
            end_date,
            summary: counts.into_summary()?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanProgressRecord {
    pub(crate) plan_id: String,
    pub(crate) plan_title: String,
    pub(crate) plan_status: PlanStatus,
    pub(crate) stages: Vec<PlanStageProgress>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanExecutionProgress {
    pub(crate) plan_id: String,
    pub(crate) plan_title: String,
    pub(crate) plan_status: PlanStatus,
    pub(crate) summary: PlanProgressSummary,
    pub(crate) stages: Vec<PlanStageProgress>,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PlanProgressError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("plan progress input is invalid")]
    InvalidInput,
    #[error("study plan was not found")]
    PlanNotFound,
    #[error("stored plan progress data is invalid")]
    InvalidStoredData,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl PlanProgressError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::InvalidInput => "PLAN_PROGRESS_INPUT_INVALID",
            Self::PlanNotFound => "PLAN_PROGRESS_NOT_FOUND",
            Self::InvalidStoredData => "PLAN_PROGRESS_DATA_INVALID",
            Self::Persistence(error) => error.code(),
        }
    }
}

pub(crate) trait PlanProgressRepository: Clone + Send + Sync + 'static {
    fn load(
        &self,
        plan_id: &str,
        today: &LocalDate,
    ) -> Result<PlanProgressRecord, PlanProgressError>;
}

#[derive(Debug, Clone)]
pub(crate) struct PlanProgressUseCases<R> {
    repository: R,
}

impl<R: PlanProgressRepository> PlanProgressUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn overview(
        &self,
        input: &PlanProgressInput,
    ) -> Result<PlanExecutionProgress, PlanProgressError> {
        let plan_id = input.plan_id.trim();
        if Uuid::parse_str(plan_id).is_err() {
            return Err(PlanProgressError::InvalidInput);
        }
        let today =
            LocalDate::parse(input.today.trim()).map_err(|_| PlanProgressError::InvalidInput)?;
        let record = self.repository.load(plan_id, &today)?;
        if record.plan_id != plan_id {
            return Err(PlanProgressError::InvalidStoredData);
        }
        let mut counts = PlanProgressCounts::default();
        for stage in &record.stages {
            counts.checked_add(&stage.summary.counts)?;
        }
        Ok(PlanExecutionProgress {
            plan_id: record.plan_id,
            plan_title: record.plan_title,
            plan_status: record.plan_status,
            summary: counts.into_summary()?,
            stages: record.stages,
        })
    }
}

fn checked_sum(left: u32, right: u32) -> Result<u32, PlanProgressError> {
    left.checked_add(right)
        .ok_or(PlanProgressError::InvalidStoredData)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone)]
    struct FakeRepository {
        record: PlanProgressRecord,
    }

    impl PlanProgressRepository for FakeRepository {
        fn load(
            &self,
            _plan_id: &str,
            _today: &LocalDate,
        ) -> Result<PlanProgressRecord, PlanProgressError> {
            Ok(self.record.clone())
        }
    }

    fn stage(stage_id: &str, completed: u32, remaining: u32) -> PlanStageProgress {
        PlanStageProgress::new(
            stage_id.to_owned(),
            format!("阶段 {stage_id}"),
            LocalDate::parse("2026-07-01").expect("date should parse"),
            LocalDate::parse("2026-07-31").expect("date should parse"),
            PlanProgressCounts {
                generated_task_count: completed + remaining + 1,
                effective_task_count: completed + remaining,
                completed_task_count: completed,
                remaining_task_count: remaining,
                overdue_task_count: remaining.min(1),
                canceled_task_count: 1,
                trashed_task_count: 0,
                planned_minutes: (completed + remaining) * 60,
                actual_minutes: completed * 45,
            },
        )
        .expect("stage should be valid")
    }

    #[test]
    fn overview_summarizes_stage_progress_without_counting_canceled_tasks() {
        let plan_id = Uuid::now_v7().to_string();
        let use_cases = PlanProgressUseCases::new(FakeRepository {
            record: PlanProgressRecord {
                plan_id: plan_id.clone(),
                plan_title: "408 计划".to_owned(),
                plan_status: PlanStatus::Active,
                stages: vec![stage("a", 2, 1), stage("b", 1, 2)],
            },
        });

        let progress = use_cases
            .overview(&PlanProgressInput {
                plan_id,
                today: "2026-07-22".to_owned(),
            })
            .expect("progress should load");

        assert_eq!(progress.summary.counts.generated_task_count, 8);
        assert_eq!(progress.summary.counts.effective_task_count, 6);
        assert_eq!(progress.summary.counts.completed_task_count, 3);
        assert_eq!(progress.summary.completion_rate_percent, Some(50));
    }

    #[test]
    fn stage_rejects_counts_that_hide_an_unclassified_task() {
        let result = PlanStageProgress::new(
            "stage".to_owned(),
            "阶段".to_owned(),
            LocalDate::parse("2026-07-01").expect("date should parse"),
            LocalDate::parse("2026-07-31").expect("date should parse"),
            PlanProgressCounts {
                generated_task_count: 2,
                effective_task_count: 1,
                completed_task_count: 1,
                ..PlanProgressCounts::default()
            },
        );

        assert!(matches!(result, Err(PlanProgressError::InvalidStoredData)));
    }
}
