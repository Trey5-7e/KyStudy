use std::collections::BTreeSet;

use uuid::Uuid;

use super::{PersistenceError, ScheduleError, current_utc_millis};
use crate::domain::{
    DateRange, LocalDate, NewTask, ScheduleValidationError, Task, TaskDraft, TaskPriority,
};

const MAX_RANGE_DAYS: i64 = 366;
const MAX_TASKS_PER_BATCH: usize = 200;

/// User-controlled recurrence and task fields for one plan stage expansion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanTaskScheduleInput {
    pub(crate) stage_id: String,
    pub(crate) subject_id: Option<String>,
    pub(crate) start_date: String,
    pub(crate) end_date: String,
    pub(crate) weekdays: Vec<u8>,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) estimated_minutes: Option<u32>,
    pub(crate) priority: String,
}

/// Active plan and stage facts required to validate an expansion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanScheduleContext {
    pub(crate) plan_title: String,
    pub(crate) stage_title: String,
    pub(crate) stage_start: LocalDate,
    pub(crate) stage_end: LocalDate,
}

/// One exact date shown before formal task creation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanTaskPreviewItem {
    pub(crate) planned_date: LocalDate,
    pub(crate) already_exists: bool,
}

/// Stable preview of the tasks affected by one confirmation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanTaskPreview {
    pub(crate) stage_id: String,
    pub(crate) plan_title: String,
    pub(crate) stage_title: String,
    pub(crate) items: Vec<PlanTaskPreviewItem>,
    pub(crate) create_count: u32,
    pub(crate) existing_count: u32,
}

/// Result of one atomic, idempotent stage expansion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanTaskCreation {
    pub(crate) created_tasks: Vec<Task>,
    pub(crate) skipped_existing: u32,
}

/// Stable plan-to-schedule failures without storage or SQL details.
#[derive(Debug, thiserror::Error)]
pub(crate) enum PlanScheduleError {
    #[error("plan schedule input is invalid")]
    InvalidInput,
    #[error("plan stage was not found")]
    StageNotFound,
    #[error("only an active plan can create schedule tasks")]
    PlanNotActive,
    #[error("plan task batch is too large")]
    TooManyTasks,
    #[error("stored plan schedule data is invalid")]
    InvalidStoredData,
    #[error(transparent)]
    Validation(#[from] ScheduleValidationError),
    #[error(transparent)]
    Schedule(#[from] ScheduleError),
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl PlanScheduleError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::InvalidInput | Self::Validation(_) => "PLAN_SCHEDULE_INPUT_INVALID",
            Self::StageNotFound => "PLAN_STAGE_NOT_FOUND",
            Self::PlanNotActive => "PLAN_SCHEDULE_PLAN_NOT_ACTIVE",
            Self::TooManyTasks => "PLAN_SCHEDULE_TOO_LARGE",
            Self::InvalidStoredData => "PLAN_SCHEDULE_DATA_INVALID",
            Self::Schedule(error) => error.code(),
            Self::Persistence(error) => error.code(),
        }
    }
}

/// Persistence boundary for previewing and atomically creating plan-derived tasks.
pub(crate) trait PlanScheduleRepository: Clone + Send + Sync + 'static {
    fn load_context(
        &self,
        stage_id: &str,
        subject_id: Option<&str>,
    ) -> Result<PlanScheduleContext, PlanScheduleError>;
    fn generated_dates(
        &self,
        stage_id: &str,
        range: &DateRange,
    ) -> Result<Vec<LocalDate>, PlanScheduleError>;
    fn create_stage_tasks(
        &self,
        stage_id: &str,
        tasks: &[NewTask],
    ) -> Result<Vec<Task>, PlanScheduleError>;
}

#[derive(Debug, Clone)]
pub(crate) struct PlanScheduleUseCases<R> {
    repository: R,
}

impl<R: PlanScheduleRepository> PlanScheduleUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn preview(
        &self,
        input: &PlanTaskScheduleInput,
    ) -> Result<PlanTaskPreview, PlanScheduleError> {
        let validated = self.validate(input)?;
        let existing = self
            .repository
            .generated_dates(&input.stage_id, &validated.range)?
            .into_iter()
            .collect::<BTreeSet<_>>();
        let items = validated
            .dates
            .into_iter()
            .map(|planned_date| PlanTaskPreviewItem {
                already_exists: existing.contains(&planned_date),
                planned_date,
            })
            .collect::<Vec<_>>();
        let existing_count =
            checked_count(items.iter().filter(|item| item.already_exists).count())?;
        let total = checked_count(items.len())?;
        Ok(PlanTaskPreview {
            stage_id: input.stage_id.clone(),
            plan_title: validated.context.plan_title,
            stage_title: validated.context.stage_title,
            items,
            create_count: total - existing_count,
            existing_count,
        })
    }

    pub(crate) fn confirm(
        &self,
        input: &PlanTaskScheduleInput,
    ) -> Result<PlanTaskCreation, PlanScheduleError> {
        let validated = self.validate(input)?;
        let total = checked_count(validated.dates.len())?;
        let created_at = current_utc_millis()?;
        let tasks = validated
            .dates
            .into_iter()
            .map(|planned_date| {
                let draft = TaskDraft::new(
                    input.subject_id.clone(),
                    &input.title,
                    input.description.as_deref(),
                    planned_date,
                    input.estimated_minutes,
                    validated.priority,
                    0,
                )?;
                NewTask::manual(draft, created_at)
            })
            .collect::<Result<Vec<_>, ScheduleValidationError>>()?;
        let created_tasks = self
            .repository
            .create_stage_tasks(&input.stage_id, &tasks)?;
        let created_count = checked_count(created_tasks.len())?;
        if created_count > total {
            return Err(PlanScheduleError::InvalidStoredData);
        }
        Ok(PlanTaskCreation {
            created_tasks,
            skipped_existing: total - created_count,
        })
    }

    fn validate(
        &self,
        input: &PlanTaskScheduleInput,
    ) -> Result<ValidatedSchedule, PlanScheduleError> {
        if Uuid::parse_str(&input.stage_id).is_err() {
            return Err(PlanScheduleError::InvalidInput);
        }
        let start = LocalDate::parse(input.start_date.trim())?;
        let end = LocalDate::parse(input.end_date.trim())?;
        let range = DateRange::new(start.clone(), end.clone())?;
        let context = self
            .repository
            .load_context(&input.stage_id, input.subject_id.as_deref())?;
        if start < context.stage_start || end > context.stage_end {
            return Err(PlanScheduleError::InvalidInput);
        }
        let span = end.days_since(&start) + 1;
        if !(1..=MAX_RANGE_DAYS).contains(&span) {
            return Err(PlanScheduleError::InvalidInput);
        }
        let weekdays = validate_weekdays(&input.weekdays)?;
        let priority =
            TaskPriority::parse(&input.priority).ok_or(PlanScheduleError::InvalidInput)?;
        TaskDraft::new(
            input.subject_id.clone(),
            &input.title,
            input.description.as_deref(),
            start.clone(),
            input.estimated_minutes,
            priority,
            0,
        )?;
        let last_offset = u32::try_from(span - 1).map_err(|_| PlanScheduleError::InvalidInput)?;
        let dates = (0..=last_offset)
            .map(|offset| start.add_days(offset))
            .filter_map(|date| match date {
                Ok(date) if weekdays[usize::from(date.weekday_from_monday())] => Some(Ok(date)),
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            })
            .collect::<Result<Vec<_>, ScheduleValidationError>>()?;
        if dates.is_empty() {
            return Err(PlanScheduleError::InvalidInput);
        }
        if dates.len() > MAX_TASKS_PER_BATCH {
            return Err(PlanScheduleError::TooManyTasks);
        }
        Ok(ValidatedSchedule {
            context,
            range,
            dates,
            priority,
        })
    }
}

#[derive(Debug)]
struct ValidatedSchedule {
    context: PlanScheduleContext,
    range: DateRange,
    dates: Vec<LocalDate>,
    priority: TaskPriority,
}

fn validate_weekdays(values: &[u8]) -> Result<[bool; 7], PlanScheduleError> {
    if values.is_empty() {
        return Err(PlanScheduleError::InvalidInput);
    }
    let mut weekdays = [false; 7];
    for value in values {
        let slot = weekdays
            .get_mut(usize::from(*value))
            .ok_or(PlanScheduleError::InvalidInput)?;
        if *slot {
            return Err(PlanScheduleError::InvalidInput);
        }
        *slot = true;
    }
    Ok(weekdays)
}

fn checked_count(value: usize) -> Result<u32, PlanScheduleError> {
    u32::try_from(value).map_err(|_| PlanScheduleError::InvalidStoredData)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex, PoisonError};

    use super::*;

    #[derive(Debug, Clone)]
    struct FakeRepository {
        context: PlanScheduleContext,
        existing: Vec<LocalDate>,
        saved: Arc<Mutex<Vec<NewTask>>>,
    }

    impl PlanScheduleRepository for FakeRepository {
        fn load_context(
            &self,
            _stage_id: &str,
            _subject_id: Option<&str>,
        ) -> Result<PlanScheduleContext, PlanScheduleError> {
            Ok(self.context.clone())
        }

        fn generated_dates(
            &self,
            _stage_id: &str,
            _range: &DateRange,
        ) -> Result<Vec<LocalDate>, PlanScheduleError> {
            Ok(self.existing.clone())
        }

        fn create_stage_tasks(
            &self,
            _stage_id: &str,
            tasks: &[NewTask],
        ) -> Result<Vec<Task>, PlanScheduleError> {
            self.saved
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .extend_from_slice(tasks);
            Ok(tasks.iter().map(task_from_new).collect())
        }
    }

    fn task_from_new(task: &NewTask) -> Task {
        Task {
            id: task.id.clone(),
            subject_id: task.draft.subject_id.clone(),
            parent_task_id: None,
            title: task.draft.title.clone(),
            description: task.draft.description.clone(),
            planned_date: task.draft.planned_date.clone(),
            estimated_minutes: task.draft.estimated_minutes,
            priority: task.draft.priority,
            status: crate::domain::TaskStatus::Todo,
            manual_order: 0,
            completed_at: None,
            created_at: task.created_at,
            updated_at: task.created_at,
        }
    }

    fn fixture() -> (PlanScheduleUseCases<FakeRepository>, PlanTaskScheduleInput) {
        let stage_id = Uuid::now_v7().to_string();
        let repository = FakeRepository {
            context: PlanScheduleContext {
                plan_title: "408 备考".to_owned(),
                stage_title: "基础阶段".to_owned(),
                stage_start: LocalDate::parse("2026-07-20").expect("date should parse"),
                stage_end: LocalDate::parse("2026-07-26").expect("date should parse"),
            },
            existing: vec![LocalDate::parse("2026-07-22").expect("date should parse")],
            saved: Arc::new(Mutex::new(Vec::new())),
        };
        (
            PlanScheduleUseCases::new(repository),
            PlanTaskScheduleInput {
                stage_id,
                subject_id: None,
                start_date: "2026-07-20".to_owned(),
                end_date: "2026-07-26".to_owned(),
                weekdays: vec![0, 2, 4],
                title: "数据结构基础".to_owned(),
                description: None,
                estimated_minutes: Some(90),
                priority: "normal".to_owned(),
            },
        )
    }

    #[test]
    fn preview_marks_existing_dates_without_hiding_candidates() {
        let (use_cases, input) = fixture();

        let preview = use_cases.preview(&input).expect("preview should succeed");

        assert_eq!(preview.items.len(), 3);
        assert_eq!(preview.create_count, 2);
        assert_eq!(preview.existing_count, 1);
    }

    #[test]
    fn preview_uses_monday_based_weekday_selection() {
        let (use_cases, input) = fixture();

        let preview = use_cases.preview(&input).expect("preview should succeed");
        let dates = preview
            .items
            .into_iter()
            .map(|item| item.planned_date.as_str().to_owned())
            .collect::<Vec<_>>();

        assert_eq!(dates, ["2026-07-20", "2026-07-22", "2026-07-24"]);
    }

    #[test]
    fn preview_rejects_dates_outside_the_stage() {
        let (use_cases, mut input) = fixture();
        input.end_date = "2026-07-27".to_owned();

        let result = use_cases.preview(&input);

        assert!(matches!(result, Err(PlanScheduleError::InvalidInput)));
    }

    #[test]
    fn confirm_builds_one_validated_task_for_each_selected_date() {
        let (use_cases, input) = fixture();

        let result = use_cases
            .confirm(&input)
            .expect("confirmation should succeed");

        assert_eq!(result.created_tasks.len(), 3);
        assert_eq!(result.created_tasks[0].title, "数据结构基础");
    }
}
