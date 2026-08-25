//! Application-level use cases and DTOs.

mod ai;
mod analytics;
mod backup;
mod cycle_plan;
mod mindmap;
mod mindmap_import;
mod ocr;
mod plan_progress;
mod plan_schedule;
mod planning;
mod planning_chat;
mod question;
mod question_bank;
mod resource;
mod review;
mod review_scheme;
mod runtime;
mod schedule;
mod search;
mod workspace;

#[cfg(test)]
pub(crate) use ai::AiProviderOverview;
pub(crate) use ai::{
    AiCachedResponse, AiCallPreview, AiCallPurpose, AiCallResult, AiError, AiFileAttachment,
    AiImagePreviewInput, AiModelOption, AiOverview, AiPreviewInput, AiProviderGateway,
    AiProviderResponse, AiRepository, AiUseCases, BeginAiCall, ListAiModelsInput,
    QuestionAiAnalysisHistoryEntry, QuestionAiAnalysisInput, SaveAiBudgetInput,
    SaveAiProviderCapabilitiesInput, SaveAiProviderInput, SecretStore, default_provider,
    estimate_tokens,
};
pub(crate) use analytics::{
    AnalyticsBacklog, AnalyticsError, AnalyticsInput, AnalyticsOverview, AnalyticsPeriodSummary,
    AnalyticsRepository, AnalyticsUseCases, DailyAnalyticsPoint, KnowledgeAnalytics,
    RepeatedMistakeAnalytics, SubjectAnalytics, rounded_percent,
};
pub(crate) use backup::{
    BackupError, BackupReport, BackupRepository, BackupUseCases, RestoreReport,
};
pub(crate) use cycle_plan::{
    ConfirmShiftCyclePlanInput, ConfirmedShiftMutation, CyclePlanError, CyclePlanRepository,
    CyclePlanUseCases, GeneratedCyclePlanItem, RestoreCyclePlanItemStateInput,
    SHIFT_UNDO_WINDOW_MS, SaveCyclePlanInput, SetCyclePlanItemStateInput,
    SetCyclePlanItemStateResult, ShiftCyclePlanInput, ShiftCyclePlanPreview, ShiftCyclePlanResult,
    ShiftCyclePlanUndo, ShiftProjection, ShiftedCyclePlanItem, UndoShiftCyclePlanInput,
    ValidatedShiftCyclePlanIntent, build_shift_projection, next_monotonic_updated_at,
};
pub(crate) use mindmap::{
    AddNodeResourceInput, CreateKnowledgeMapInput, KnowledgeError, KnowledgeRepository,
    KnowledgeUseCases, MoveKnowledgeNodeInput, UpdateKnowledgeMapInput, UpdateKnowledgeNodeInput,
    ValidatedKnowledgeNodeUpdate,
};
pub(crate) use ocr::{
    ConfirmQuestionRegionOcrInput, OCR_ENGINE_NAME, OcrComponentDownloader, OcrComponentManager,
    OcrComponentState, OcrComponentStatus, OcrEngine, OcrEngineLine, OcrEngineOutput, OcrError,
    OcrPackageOption, OcrPageLine, OcrPageRecognition, OcrRegionSource, OcrRepository, OcrUseCases,
    RecognizePdfPageInput, RecognizeQuestionRegionInput,
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
    AiAttachmentRef, ConfirmPlanningChatInput, PlanningAttachmentPreview, PlanningChatError,
    PlanningChatInput, PlanningChatPreview, PlanningChatReply, PlanningChatRepository,
    PlanningChatUseCases, PlanningContextSelection, PlanningConversation, PlanningMessage,
    PlanningQuestionContext, PlanningSource, ResolvedPlanningAttachment, ResolvedPlanningContext,
    ResolvedPlanningFile, TemporaryAttachmentInput, context_token_estimate, trim_chars,
};
pub(crate) use question::{
    AddQuestionAttemptInput, AddQuestionRegionInput, BatchClassifyQuestionsInput,
    CreateQuestionInput, QuestionError, QuestionRegionInput, QuestionRepository, QuestionUseCases,
    SetWorkbookSubjectInput, UpdateQuestionInput, UpdateQuestionRegionInput,
    ValidatedQuestionUpdate,
};
pub(crate) use question_bank::{
    BulkQuestionAttemptInput, CreateWorkbookCategoryInput, DeleteTrashedWorkbookSegmentInput,
    ImportQuestionIndexInput, IndexedQuestionDraftInput, IndexedQuestionRegionUpdateInput,
    InsertIndexedQuestionInput, QuestionBankError, QuestionBankRepository, QuestionBankUseCases,
    ReassignWorkbookSegmentInput, RecordBulkQuestionAttemptsInput, RenameWorkbookCategoryInput,
    ReplaceIndexedQuestionRegionsInput, RestoreWorkbookSegmentInput,
    SetQuestionGapAcknowledgementInput, TrashWorkbookSegmentInput, UpdateIndexedQuestionInput,
    ValidatedBulkAttempt, ValidatedIndexedQuestion, ValidatedIndexedQuestionUpdate,
    WorkbookSegmentAssignmentInput,
};
pub(crate) use resource::{
    ImportError, ImportProgress, ImportRequest, MindMapSource, ReadableResource, RecoveryReport,
    ResourceDocument, ResourceReaderDescriptor, ResourceRepository, ResourceUseCases,
    classify_source,
};
pub(crate) use review::{
    GenerateReviewQueueInput, InsertReviewQueueItemInput, PinQuestionReviewInput,
    REVIEW_POLICY_VERSION, ReviewCandidateFacts, ReviewDecision, ReviewError, ReviewRepository,
    ReviewUseCases, ScoredReviewCandidate, SetQuestionReviewInput, SubmitReviewInput,
    UpdateReviewPreferencesInput, ValidatedReviewSubmission, apply_rating, score_candidate,
};
pub(crate) use review_scheme::{
    GenerateReviewSchemeQueueInput, REVIEW_SCHEME_POLICY_VERSION, ReviewSchemeCandidate,
    ReviewSchemeCarryover, ReviewSchemeError, ReviewSchemeRepository, ReviewSchemeTypeQuotaInput,
    ReviewSchemeUseCases, SaveReviewSchemeInput, SubmitReviewSchemeResultInput,
    UndoReviewSchemeResultInput, ValidatedReviewScheme, ValidatedSchemeSubmission,
    apply_scheme_rating, select_scheme_questions,
};
pub(crate) use runtime::{RuntimeStatus, get_runtime_status};
pub(crate) use schedule::{
    CreateStudySessionInput, CreateSubjectInput, CreateTaskInput, RenameSubjectInput,
    RescheduleTaskInput, ScheduleError, ScheduleRepository, ScheduleUseCases, SplitChildInput,
    SplitTaskInput, UpdateTaskDetailsInput,
};
pub(crate) use search::{
    BeginResourceIndexInput, SearchError, SearchRepository, SearchResourcesInput, SearchUseCases,
    StoreResourcePageTextInput,
};
pub(crate) use workspace::{
    PersistenceError, WorkspaceRepository, WorkspaceUseCases, current_utc_millis,
};
