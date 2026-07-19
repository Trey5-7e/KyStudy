//! Application-level use cases and DTOs.

mod backup;
mod planning;
mod resource;
mod runtime;
mod schedule;
mod workspace;

pub(crate) use backup::{
    BackupError, BackupReport, BackupRepository, BackupUseCases, RestoreReport,
};
pub(crate) use planning::{
    AddPlanReferenceInput, PlanningError, PlanningRepository, PlanningUseCases, SavePlanInput,
    SavePlanStageInput,
};
pub(crate) use resource::{
    ImportError, ImportProgress, ImportRequest, ReadableResource, RecoveryReport, ResourceDocument,
    ResourceReaderDescriptor, ResourceRepository, ResourceUseCases,
};
pub(crate) use runtime::{RuntimeStatus, get_runtime_status};
pub(crate) use schedule::{
    CreateStudySessionInput, CreateSubjectInput, CreateTaskInput, RescheduleTaskInput,
    ScheduleError, ScheduleRepository, ScheduleUseCases, SplitChildInput, SplitTaskInput,
    UpdateTaskDetailsInput,
};
pub(crate) use workspace::{
    PersistenceError, WorkspaceRepository, WorkspaceUseCases, current_utc_millis,
};
