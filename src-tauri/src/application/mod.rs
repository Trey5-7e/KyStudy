//! Application-level use cases and DTOs.

mod ai;
mod analytics;
mod backup;
mod mindmap;
mod mindmap_import;
mod ocr;
mod plan_progress;
mod plan_schedule;
mod planning;
mod planning_chat;
mod question;
mod resource;
mod review;
mod runtime;
mod schedule;
mod search;
mod workspace;

#[cfg(test)]
pub(crate) use ai::AiProviderOverview;
pub(crate) use ai::{
    AiCachedResponse, AiCallPreview, AiCallPurpose, AiCallResult, AiError, AiOverview,
    AiPreviewInput, AiProviderGateway, AiProviderResponse, AiRepository, AiUseCases, BeginAiCall,
    SaveAiBudgetInput, SaveAiProviderInput, SecretStore, default_provider, estimate_tokens,
};
pub(crate) use analytics::{
    AnalyticsBacklog, AnalyticsError, AnalyticsInput, AnalyticsOverview, AnalyticsPeriodSummary,
    AnalyticsRepository, AnalyticsUseCases, DailyAnalyticsPoint, KnowledgeAnalytics,
    RepeatedMistakeAnalytics, SubjectAnalytics, rounded_percent,
};
pub(crate) use backup::{
    BackupError, BackupReport, BackupRepository, BackupUseCases, RestoreReport,
};
pub(crate) use mindmap::{
    AddNodeResourceInput, CreateKnowledgeMapInput, KnowledgeError, KnowledgeRepository,
    KnowledgeUseCases, MoveKnowledgeNodeInput, UpdateKnowledgeMapInput, UpdateKnowledgeNodeInput,
    ValidatedKnowledgeNodeUpdate,
};
pub(crate) use ocr::{
    ConfirmQuestionRegionOcrInput, OCR_ENGINE_NAME, OcrComponentState, OcrComponentStatus,
    OcrEngine, OcrEngineLine, OcrEngineOutput, OcrError, OcrRegionSource, OcrRepository,
    OcrUseCases, RecognizeQuestionRegionInput,
};
pub(crate) use plan_progress::{
    PlanExecutionProgress, PlanProgressCounts, PlanProgressError, PlanProgressInput,
    PlanProgressRecord, PlanProgressRepository, PlanProgressSummary, PlanProgressUseCases,
    PlanStageProgress,
};
pub(crate) use plan_schedule::{
    PlanScheduleContext, PlanScheduleError, PlanScheduleRepository, PlanScheduleUseCases,
    PlanTaskCreation, PlanTaskPreview, PlanTaskPreviewItem, PlanTaskScheduleInput,
};
pub(crate) use planning::{
    AddPlanReferenceInput, PlanningError, PlanningRepository, PlanningUseCases, SavePlanInput,
    SavePlanStageInput,
};
pub(crate) use planning_chat::{
    ConfirmPlanningChatInput, PlanningChatError, PlanningChatInput, PlanningChatPreview,
    PlanningChatReply, PlanningChatRepository, PlanningChatUseCases, PlanningContextSelection,
    PlanningConversation, PlanningMessage, PlanningSource, ResolvedPlanningContext,
    context_token_estimate, trim_chars,
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
pub(crate) use search::{
    BeginResourceIndexInput, SearchError, SearchRepository, SearchResourcesInput, SearchUseCases,
    StoreResourcePageTextInput,
};
pub(crate) use workspace::{
    PersistenceError, WorkspaceRepository, WorkspaceUseCases, current_utc_millis,
};
