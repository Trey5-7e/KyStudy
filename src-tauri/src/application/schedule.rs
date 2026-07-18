use super::{PersistenceError, current_utc_millis};
use crate::domain::{
    DateRange, LocalDate, NewSubject, NewTask, ScheduleValidationError, Subject, SubjectColor,
    Task, TaskDraft, TaskPriority, TaskTransition,
};

/// User-authored fields for one subject.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CreateSubjectInput {
    pub(crate) name: String,
    pub(crate) color_key: String,
    pub(crate) sort_order: u32,
}

/// User-authored fields for one manual task.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CreateTaskInput {
    pub(crate) subject_id: Option<String>,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) planned_date: String,
    pub(crate) estimated_minutes: Option<u32>,
    pub(crate) priority: String,
    pub(crate) manual_order: u32,
}

/// Stable failures from schedule use cases and persistence.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ScheduleError {
    /// No default workspace has been initialized.
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    /// An active subject already uses the normalized name.
    #[error("subject name already exists")]
    SubjectNameConflict,
    /// The selected subject does not exist or has been archived.
    #[error("subject is unavailable")]
    SubjectNotFound,
    /// The requested task does not exist in the current workspace.
    #[error("task is unavailable")]
    TaskNotFound,
    /// Persisted schedule data violates a domain invariant.
    #[error("stored schedule data is invalid")]
    InvalidStoredData,
    /// User input or a requested state transition is invalid.
    #[error(transparent)]
    Validation(#[from] ScheduleValidationError),
    /// The shared `SQLite` workspace boundary failed.
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl ScheduleError {
    /// Returns the stable code exposed by the command error DTO.
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::SubjectNameConflict => "SUBJECT_NAME_CONFLICT",
            Self::SubjectNotFound => "SUBJECT_NOT_FOUND",
            Self::TaskNotFound => "TASK_NOT_FOUND",
            Self::InvalidStoredData => "SCHEDULE_DATA_INVALID",
            Self::Validation(ScheduleValidationError::Transition) => "TASK_TRANSITION_INVALID",
            Self::Validation(_) => "SCHEDULE_INPUT_INVALID",
            Self::Persistence(error) => error.code(),
        }
    }
}

/// Database operations required by schedule use cases.
pub(crate) trait ScheduleRepository: Clone + Send + Sync + 'static {
    /// Creates one subject in the current workspace.
    fn create_subject(&self, subject: &NewSubject) -> Result<Subject, ScheduleError>;

    /// Lists active subjects in stable user order.
    fn list_subjects(&self) -> Result<Vec<Subject>, ScheduleError>;

    /// Creates one task and its immutable `created` history in one transaction.
    fn create_task(&self, task: &NewTask) -> Result<Task, ScheduleError>;

    /// Lists non-trashed tasks within an inclusive local date range.
    fn list_tasks(&self, range: &DateRange) -> Result<Vec<Task>, ScheduleError>;

    /// Applies one state transition and appends history in one transaction.
    fn transition_task(
        &self,
        task_id: &str,
        transition: TaskTransition,
        changed_at: i64,
    ) -> Result<Task, ScheduleError>;
}

/// Schedule use cases with a statically dispatched repository adapter.
#[derive(Debug, Clone)]
pub(crate) struct ScheduleUseCases<R> {
    repository: R,
}

impl<R: ScheduleRepository> ScheduleUseCases<R> {
    /// Composes schedule use cases with one repository implementation.
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Creates one subject using the current system timestamp.
    pub(crate) fn create_subject(
        &self,
        input: &CreateSubjectInput,
    ) -> Result<Subject, ScheduleError> {
        self.create_subject_at(input, current_utc_millis()?)
    }

    fn create_subject_at(
        &self,
        input: &CreateSubjectInput,
        created_at: i64,
    ) -> Result<Subject, ScheduleError> {
        let color = SubjectColor::parse(&input.color_key).ok_or(ScheduleValidationError::Text)?;
        let subject = NewSubject::new(&input.name, color, input.sort_order, created_at)?;
        self.repository.create_subject(&subject)
    }

    /// Lists active subjects in stable user order.
    pub(crate) fn list_subjects(&self) -> Result<Vec<Subject>, ScheduleError> {
        self.repository.list_subjects()
    }

    /// Creates one validated manual task using the current system timestamp.
    pub(crate) fn create_task(&self, input: CreateTaskInput) -> Result<Task, ScheduleError> {
        self.create_task_at(input, current_utc_millis()?)
    }

    fn create_task_at(
        &self,
        input: CreateTaskInput,
        created_at: i64,
    ) -> Result<Task, ScheduleError> {
        let date = LocalDate::parse(&input.planned_date)?;
        let priority = TaskPriority::parse(&input.priority).ok_or(ScheduleValidationError::Text)?;
        let draft = TaskDraft::new(
            input.subject_id,
            &input.title,
            input.description.as_deref(),
            date,
            input.estimated_minutes,
            priority,
            input.manual_order,
        )?;
        self.repository
            .create_task(&NewTask::manual(draft, created_at)?)
    }

    /// Lists tasks for one validated inclusive date range.
    pub(crate) fn list_tasks(&self, start: &str, end: &str) -> Result<Vec<Task>, ScheduleError> {
        let range = DateRange::new(LocalDate::parse(start)?, LocalDate::parse(end)?)?;
        self.repository.list_tasks(&range)
    }

    /// Applies one supported task transition using the current system timestamp.
    pub(crate) fn transition_task(
        &self,
        task_id: &str,
        transition: TaskTransition,
    ) -> Result<Task, ScheduleError> {
        if uuid::Uuid::parse_str(task_id).is_err() {
            return Err(ScheduleValidationError::Identifier.into());
        }
        self.repository
            .transition_task(task_id, transition, current_utc_millis()?)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

    use super::{
        CreateSubjectInput, CreateTaskInput, ScheduleError, ScheduleRepository, ScheduleUseCases,
    };
    use crate::domain::{
        DateRange, NewSubject, NewTask, Subject, Task, TaskStatus, TaskTransition,
    };

    #[derive(Debug, Clone, Default)]
    struct MemoryScheduleRepository {
        tasks: Arc<Mutex<Vec<Task>>>,
    }

    impl MemoryScheduleRepository {
        fn tasks(&self) -> MutexGuard<'_, Vec<Task>> {
            self.tasks.lock().unwrap_or_else(PoisonError::into_inner)
        }
    }

    impl ScheduleRepository for MemoryScheduleRepository {
        fn create_subject(&self, subject: &NewSubject) -> Result<Subject, ScheduleError> {
            Ok(Subject {
                id: subject.id.clone(),
                name: subject.name.clone(),
                color: subject.color,
                sort_order: subject.sort_order,
                archived_at: None,
                created_at: subject.created_at,
                updated_at: subject.created_at,
            })
        }

        fn list_subjects(&self) -> Result<Vec<Subject>, ScheduleError> {
            Ok(Vec::new())
        }

        fn create_task(&self, task: &NewTask) -> Result<Task, ScheduleError> {
            let created = Task {
                id: task.id.clone(),
                subject_id: task.draft.subject_id.clone(),
                parent_task_id: None,
                title: task.draft.title.clone(),
                description: task.draft.description.clone(),
                planned_date: task.draft.planned_date.clone(),
                estimated_minutes: task.draft.estimated_minutes,
                priority: task.draft.priority,
                status: TaskStatus::Todo,
                manual_order: task.draft.manual_order,
                completed_at: None,
                created_at: task.created_at,
                updated_at: task.created_at,
            };
            self.tasks().push(created.clone());
            Ok(created)
        }

        fn list_tasks(&self, range: &DateRange) -> Result<Vec<Task>, ScheduleError> {
            Ok(self
                .tasks()
                .iter()
                .filter(|task| task.planned_date >= range.start && task.planned_date <= range.end)
                .cloned()
                .collect())
        }

        fn transition_task(
            &self,
            task_id: &str,
            transition: TaskTransition,
            changed_at: i64,
        ) -> Result<Task, ScheduleError> {
            let mut tasks = self.tasks();
            let task = tasks
                .iter_mut()
                .find(|task| task.id == task_id)
                .ok_or(ScheduleError::TaskNotFound)?;
            task.transition(transition, changed_at)?;
            Ok(task.clone())
        }
    }

    #[test]
    fn create_subject_trims_user_input() {
        let use_cases = ScheduleUseCases::new(MemoryScheduleRepository::default());

        let subject = use_cases
            .create_subject_at(
                &CreateSubjectInput {
                    name: "  408  ".to_owned(),
                    color_key: "blue".to_owned(),
                    sort_order: 0,
                },
                1_700_000_000_000,
            )
            .expect("subject should be valid");

        assert_eq!(subject.name, "408");
    }

    #[test]
    fn create_task_rejects_an_impossible_date() {
        let use_cases = ScheduleUseCases::new(MemoryScheduleRepository::default());

        let error = use_cases
            .create_task_at(
                CreateTaskInput {
                    subject_id: None,
                    title: "高等数学".to_owned(),
                    description: None,
                    planned_date: "2026-02-29".to_owned(),
                    estimated_minutes: Some(60),
                    priority: "normal".to_owned(),
                    manual_order: 0,
                },
                1_700_000_000_000,
            )
            .expect_err("invalid date must be rejected");

        assert_eq!(error.code(), "SCHEDULE_INPUT_INVALID");
    }
}
