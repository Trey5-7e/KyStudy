//! Pure domain values and invariants.

mod schedule;
mod workspace;

pub(crate) use schedule::{
    DateRange, LocalDate, NewStudySession, NewSubject, NewTask, RescheduleDraft,
    ScheduleValidationError, SplitChildDraft, SplitTaskDraft, StudySession, StudyStatistics,
    Subject, SubjectColor, SubjectStatistics, Task, TaskChange, TaskChangeSnapshot, TaskChangeType,
    TaskDetailsDraft, TaskDraft, TaskPriority, TaskSplit, TaskStatus, TaskTransition, TrashedTask,
};
pub(crate) use workspace::{LATEST_SCHEMA_VERSION, NewWorkspace, Workspace};
