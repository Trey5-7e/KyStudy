//! Pure domain values and invariants.

mod ai;
mod mindmap;
mod ocr;
mod planning;
mod question;
mod question_bank;
mod review;
mod review_scheme;
mod schedule;
mod search;
mod workspace;

pub(crate) use ai::{
    AiBudget, AiCallSummary, AiModelProfile, AiProviderConfig, AiProviderType, AiUsageSummary,
};
pub(crate) use mindmap::{
    KnowledgeMap, KnowledgeMapBundle, KnowledgeNode, KnowledgeNodeResource, MasteryState,
    MindMapDraftNode, MindMapImportDraft,
};
pub(crate) use ocr::{OcrRecognition, OcrRecognitionState, OcrTextLine};
pub(crate) use planning::{PlanReference, PlanStage, PlanStatus, StudyPlan, StudyPlanBundle};
pub(crate) use question::{
    AttemptResult, ClassificationSource, Question, QuestionAttempt, QuestionBundle,
    QuestionKnowledgeLink, QuestionRegion, QuestionType, WorkbookProfile, classify_question_text,
};
pub(crate) use question_bank::{
    IndexedQuestion, QuestionBankSnapshot, TrashedWorkbookDocumentSegment, WorkbookCategory,
    WorkbookDocumentSegment,
};
pub(crate) use review::{
    DailyReviewItem, DailyReviewQueue, MistakeProfile, ReviewBacklog, ReviewDashboard, ReviewEvent,
    ReviewItemState, ReviewMastery, ReviewPreferences, ReviewQuestion, ReviewRating, ReviewReason,
    ReviewSelectionKind, ReviewState,
};
pub(crate) use review_scheme::{
    ReviewScheme, ReviewSchemeDashboard, ReviewSchemeItemState, ReviewSchemeQueue,
    ReviewSchemeQueueItem, ReviewSchemeToday, ReviewSchemeTypeQuota,
};
pub(crate) use schedule::{
    DateRange, LocalDate, NewStudySession, NewSubject, NewTask, RescheduleDraft,
    ScheduleValidationError, SplitChildDraft, SplitTaskDraft, StudySession, StudyStatistics,
    Subject, SubjectColor, SubjectStatistics, Task, TaskChange, TaskChangeSnapshot, TaskChangeType,
    TaskDetailsDraft, TaskDraft, TaskPriority, TaskSplit, TaskStatus, TaskTransition, TrashedTask,
};
pub(crate) use search::{
    IndexedResourcePage, ResourceIndexSession, ResourceIndexState, ResourceIndexStatus,
    ResourceSearchMatchKind, ResourceSearchResult,
};
pub(crate) use workspace::{LATEST_SCHEMA_VERSION, NewWorkspace, Workspace};
mod cycle_plan;
pub(crate) use cycle_plan::{
    CyclePlan, CyclePlanDashboard, CyclePlanItem, CyclePlanItemState, CyclePlanOverview,
    CycleScheduleMode,
};
