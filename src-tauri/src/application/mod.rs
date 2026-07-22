//! Application-level use cases and DTOs.

mod backup;
mod mindmap;
mod mindmap_import;
mod planning;
mod question;
mod resource;
mod review;
mod runtime;
mod schedule;
mod workspace;

pub(crate) use backup::{
    BackupError, BackupReport, BackupRepository, BackupUseCases, RestoreReport,
};
pub(crate) use mindmap::{
    AddNodeResourceInput, CreateKnowledgeMapInput, KnowledgeError, KnowledgeRepository,
    KnowledgeUseCases, MoveKnowledgeNodeInput, UpdateKnowledgeMapInput, UpdateKnowledgeNodeInput,
    ValidatedKnowledgeNodeUpdate,
};
pub(crate) use planning::{
    AddPlanReferenceInput, PlanningError, PlanningRepository, PlanningUseCases, SavePlanInput,
    SavePlanStageInput,
};
pub(crate) use question::{
    AddQuestionAttemptInput, AddQuestionRegionInput, CreateQuestionInput, QuestionError,
    QuestionRegionInput, QuestionRepository, QuestionUseCases, UpdateQuestionInput,
    ValidatedQuestionUpdate,
};
pub(crate) use resource::{
    ImportError, ImportProgress, ImportRequest, MindMapSource, ReadableResource, RecoveryReport,
    ResourceDocument, ResourceReaderDescriptor, ResourceRepository, ResourceUseCases,
};
pub(crate) use review::{
    GenerateReviewQueueInput, InsertReviewQueueItemInput, PinQuestionReviewInput,
    REVIEW_POLICY_VERSION, ReviewCandidateFacts, ReviewDecision, ReviewError, ReviewRepository,
    ReviewUseCases, ScoredReviewCandidate, SetQuestionReviewInput, SubmitReviewInput,
    UpdateReviewPreferencesInput, ValidatedReviewSubmission, apply_rating, score_candidate,
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
