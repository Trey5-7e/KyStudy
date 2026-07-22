//! Pure domain values and invariants.

mod ai;
mod mindmap;
mod ocr;
mod planning;
mod question;
mod review;
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
    AttemptResult, Question, QuestionAttempt, QuestionBundle, QuestionKnowledgeLink, QuestionRegion,
};
pub(crate) use review::{
    DailyReviewItem, DailyReviewQueue, MistakeProfile, ReviewBacklog, ReviewDashboard, ReviewEvent,
    ReviewItemState, ReviewMastery, ReviewPreferences, ReviewQuestion, ReviewRating, ReviewReason,
    ReviewSelectionKind, ReviewState,
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
