//! Thin Tauri command adapters.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

use crate::application::{
    AddNodeResourceInput, AddPlanReferenceInput, AddQuestionAttemptInput, AddQuestionRegionInput,
    BackupError, BackupReport, BeginResourceIndexInput, CreateKnowledgeMapInput,
    CreateQuestionInput, CreateStudySessionInput, CreateSubjectInput, CreateTaskInput,
    GenerateReviewQueueInput, ImportError, ImportProgress, InsertReviewQueueItemInput,
    KnowledgeError, MoveKnowledgeNodeInput, PinQuestionReviewInput, PlanningError, QuestionError,
    QuestionRegionInput, RescheduleTaskInput, ResourceDocument, ResourceReaderDescriptor,
    RestoreReport, ReviewError, RuntimeStatus, SavePlanInput, SavePlanStageInput, ScheduleError,
    SearchError, SearchResourcesInput, SetQuestionReviewInput, SplitChildInput, SplitTaskInput,
    StoreResourcePageTextInput, SubmitReviewInput, UpdateKnowledgeMapInput,
    UpdateKnowledgeNodeInput, UpdateQuestionInput, UpdateReviewPreferencesInput,
    UpdateTaskDetailsInput, get_runtime_status as load_runtime_status,
};
use crate::bootstrap::AppState;
use crate::domain::{
    DailyReviewItem, DailyReviewQueue, KnowledgeMap, KnowledgeMapBundle, KnowledgeNode,
    KnowledgeNodeResource, MindMapDraftNode, MindMapImportDraft, MistakeProfile, PlanReference,
    PlanStage, Question, QuestionAttempt, QuestionBundle, QuestionKnowledgeLink, QuestionRegion,
    ResourceIndexSession, ResourceIndexStatus, ResourceSearchResult, ReviewBacklog,
    ReviewDashboard, ReviewEvent, ReviewPreferences, ReviewQuestion, ReviewReason, ReviewState,
    StudyPlan, StudyPlanBundle, StudySession, StudyStatistics, Subject, SubjectStatistics, Task,
    TaskChange, TaskChangeSnapshot, TaskSplit, TaskTransition, TrashedTask, Workspace,
};

#[tauri::command]
pub(crate) fn get_runtime_status() -> RuntimeStatus {
    load_runtime_status()
}

/// Workspace metadata returned without a database path or row representation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceStatusDto {
    id: String,
    name: String,
    timezone: String,
    daily_review_quota: u32,
    early_fill_enabled: bool,
    created_at: i64,
    schema_version: u32,
}

impl From<Workspace> for WorkspaceStatusDto {
    fn from(workspace: Workspace) -> Self {
        Self {
            id: workspace.id,
            name: workspace.name,
            timezone: workspace.timezone,
            daily_review_quota: workspace.daily_review_quota,
            early_fill_enabled: workspace.early_fill_enabled,
            created_at: workspace.created_at,
            schema_version: workspace.schema_version,
        }
    }
}

/// Subject metadata returned without database internals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubjectDto {
    id: String,
    name: String,
    color_key: &'static str,
    sort_order: u32,
    archived_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

impl From<Subject> for SubjectDto {
    fn from(subject: Subject) -> Self {
        Self {
            id: subject.id,
            name: subject.name,
            color_key: subject.color.as_str(),
            sort_order: subject.sort_order,
            archived_at: subject.archived_at,
            created_at: subject.created_at,
            updated_at: subject.updated_at,
        }
    }
}

/// Formal task fields returned without history snapshots or persistence details.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskDto {
    id: String,
    subject_id: Option<String>,
    parent_task_id: Option<String>,
    title: String,
    description: Option<String>,
    planned_date: String,
    estimated_minutes: Option<u32>,
    priority: &'static str,
    status: &'static str,
    manual_order: u32,
    completed_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

impl From<Task> for TaskDto {
    fn from(task: Task) -> Self {
        Self {
            id: task.id,
            subject_id: task.subject_id,
            parent_task_id: task.parent_task_id,
            title: task.title,
            description: task.description,
            planned_date: task.planned_date.as_str().to_owned(),
            estimated_minutes: task.estimated_minutes,
            priority: task.priority.as_str(),
            status: task.status.as_str(),
            manual_order: task.manual_order,
            completed_at: task.completed_at,
            created_at: task.created_at,
            updated_at: task.updated_at,
        }
    }
}

/// One soft-deleted task with only the timestamp needed by the recycle-bin UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrashedTaskDto {
    #[serde(flatten)]
    task: TaskDto,
    deleted_at: i64,
}

impl From<TrashedTask> for TrashedTaskDto {
    fn from(trashed: TrashedTask) -> Self {
        Self {
            task: TaskDto::from(trashed.task),
            deleted_at: trashed.deleted_at,
        }
    }
}

/// Parent and children returned after an atomic task split.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskSplitDto {
    parent: TaskDto,
    children: Vec<TaskDto>,
}

impl From<TaskSplit> for TaskSplitDto {
    fn from(split: TaskSplit) -> Self {
        Self {
            parent: TaskDto::from(split.parent),
            children: split.children.into_iter().map(TaskDto::from).collect(),
        }
    }
}

/// One actual study record returned without workspace or deletion internals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StudySessionDto {
    id: String,
    task_id: Option<String>,
    subject_id: Option<String>,
    session_date: String,
    duration_minutes: u32,
    completion_percent: u32,
    reflection: Option<String>,
    created_at: i64,
    updated_at: i64,
}

impl From<StudySession> for StudySessionDto {
    fn from(session: StudySession) -> Self {
        Self {
            id: session.id,
            task_id: session.task_id,
            subject_id: session.subject_id,
            session_date: session.session_date.as_str().to_owned(),
            duration_minutes: session.duration_minutes,
            completion_percent: session.completion_percent,
            reflection: session.reflection,
            created_at: session.created_at,
            updated_at: session.updated_at,
        }
    }
}

/// Per-subject aggregate safe for the statistics view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubjectStatisticsDto {
    subject_id: Option<String>,
    subject_name: String,
    color_key: &'static str,
    task_count: u32,
    actual_minutes: u32,
}

impl From<SubjectStatistics> for SubjectStatisticsDto {
    fn from(statistics: SubjectStatistics) -> Self {
        Self {
            subject_id: statistics.subject_id,
            subject_name: statistics.subject_name,
            color_key: statistics.color.as_str(),
            task_count: statistics.task_count,
            actual_minutes: statistics.actual_minutes,
        }
    }
}

/// Basic schedule and execution statistics for one explicit range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StudyStatisticsDto {
    task_count: u32,
    completed_task_count: u32,
    completion_rate_percent: Option<u32>,
    planned_minutes: u32,
    actual_minutes: u32,
    minute_difference: i64,
    overdue_task_count: u32,
    subjects: Vec<SubjectStatisticsDto>,
}

impl From<StudyStatistics> for StudyStatisticsDto {
    fn from(statistics: StudyStatistics) -> Self {
        Self {
            task_count: statistics.task_count,
            completed_task_count: statistics.completed_task_count,
            completion_rate_percent: statistics.completion_rate_percent,
            planned_minutes: statistics.planned_minutes,
            actual_minutes: statistics.actual_minutes,
            minute_difference: statistics.minute_difference,
            overdue_task_count: statistics.overdue_task_count,
            subjects: statistics
                .subjects
                .into_iter()
                .map(SubjectStatisticsDto::from)
                .collect(),
        }
    }
}

/// Explicit task fields for one history state without raw JSON.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskChangeSnapshotDto {
    subject_id: Option<String>,
    title: String,
    description: Option<String>,
    planned_date: String,
    estimated_minutes: Option<u32>,
    priority: &'static str,
    status: &'static str,
    manual_order: u32,
    completed_at: Option<i64>,
}

impl From<TaskChangeSnapshot> for TaskChangeSnapshotDto {
    fn from(snapshot: TaskChangeSnapshot) -> Self {
        Self {
            subject_id: snapshot.subject_id,
            title: snapshot.title,
            description: snapshot.description,
            planned_date: snapshot.planned_date.as_str().to_owned(),
            estimated_minutes: snapshot.estimated_minutes,
            priority: snapshot.priority.as_str(),
            status: snapshot.status.as_str(),
            manual_order: snapshot.manual_order,
            completed_at: snapshot.completed_at,
        }
    }
}

/// One readable immutable task change without persistence representations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskChangeDto {
    id: String,
    change_type: &'static str,
    before: Option<TaskChangeSnapshotDto>,
    after: Option<TaskChangeSnapshotDto>,
    reason: Option<String>,
    created_at: i64,
}

impl From<TaskChange> for TaskChangeDto {
    fn from(change: TaskChange) -> Self {
        Self {
            id: change.id,
            change_type: change.change_type.as_str(),
            before: change.before.map(TaskChangeSnapshotDto::from),
            after: change.after.map(TaskChangeSnapshotDto::from),
            reason: change.reason,
            created_at: change.created_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateSubjectRequestDto {
    name: String,
    color_key: String,
    sort_order: u32,
}

impl From<CreateSubjectRequestDto> for CreateSubjectInput {
    fn from(request: CreateSubjectRequestDto) -> Self {
        Self {
            name: request.name,
            color_key: request.color_key,
            sort_order: request.sort_order,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateTaskRequestDto {
    subject_id: Option<String>,
    title: String,
    description: Option<String>,
    planned_date: String,
    estimated_minutes: Option<u32>,
    priority: String,
    manual_order: u32,
}

impl From<CreateTaskRequestDto> for CreateTaskInput {
    fn from(request: CreateTaskRequestDto) -> Self {
        Self {
            subject_id: request.subject_id,
            title: request.title,
            description: request.description,
            planned_date: request.planned_date,
            estimated_minutes: request.estimated_minutes,
            priority: request.priority,
            manual_order: request.manual_order,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateTaskDetailsRequestDto {
    subject_id: Option<String>,
    title: String,
    description: Option<String>,
    estimated_minutes: Option<u32>,
    priority: String,
}

impl From<UpdateTaskDetailsRequestDto> for UpdateTaskDetailsInput {
    fn from(request: UpdateTaskDetailsRequestDto) -> Self {
        Self {
            subject_id: request.subject_id,
            title: request.title,
            description: request.description,
            estimated_minutes: request.estimated_minutes,
            priority: request.priority,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RescheduleTaskRequestDto {
    planned_date: String,
    reason: String,
}

impl From<RescheduleTaskRequestDto> for RescheduleTaskInput {
    fn from(request: RescheduleTaskRequestDto) -> Self {
        Self {
            planned_date: request.planned_date,
            reason: request.reason,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SplitChildRequestDto {
    title: String,
    description: Option<String>,
    estimated_minutes: Option<u32>,
}

impl From<SplitChildRequestDto> for SplitChildInput {
    fn from(request: SplitChildRequestDto) -> Self {
        Self {
            title: request.title,
            description: request.description,
            estimated_minutes: request.estimated_minutes,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SplitTaskRequestDto {
    children: Vec<SplitChildRequestDto>,
}

impl From<SplitTaskRequestDto> for SplitTaskInput {
    fn from(request: SplitTaskRequestDto) -> Self {
        Self {
            children: request
                .children
                .into_iter()
                .map(SplitChildInput::from)
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateStudySessionRequestDto {
    task_id: Option<String>,
    subject_id: Option<String>,
    session_date: String,
    duration_minutes: u32,
    completion_percent: u32,
    reflection: Option<String>,
}

impl From<CreateStudySessionRequestDto> for CreateStudySessionInput {
    fn from(request: CreateStudySessionRequestDto) -> Self {
        Self {
            task_id: request.task_id,
            subject_id: request.subject_id,
            session_date: request.session_date,
            duration_minutes: request.duration_minutes,
            completion_percent: request.completion_percent,
            reflection: request.reflection,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavePlanRequestDto {
    id: Option<String>,
    title: String,
    target_exam: Option<String>,
    exam_date: Option<String>,
    overview: Option<String>,
}

impl From<SavePlanRequestDto> for SavePlanInput {
    fn from(request: SavePlanRequestDto) -> Self {
        Self {
            id: request.id,
            title: request.title,
            target_exam: request.target_exam,
            exam_date: request.exam_date,
            overview: request.overview,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavePlanStageRequestDto {
    id: Option<String>,
    plan_id: String,
    title: String,
    start_date: String,
    end_date: String,
    focus: Option<String>,
    sort_order: u32,
}

impl From<SavePlanStageRequestDto> for SavePlanStageInput {
    fn from(request: SavePlanStageRequestDto) -> Self {
        Self {
            id: request.id,
            plan_id: request.plan_id,
            title: request.title,
            start_date: request.start_date,
            end_date: request.end_date,
            focus: request.focus,
            sort_order: request.sort_order,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddPlanReferenceRequestDto {
    plan_id: String,
    document_id: String,
    page_start: u32,
    page_end: u32,
    note: Option<String>,
}

impl From<AddPlanReferenceRequestDto> for AddPlanReferenceInput {
    fn from(request: AddPlanReferenceRequestDto) -> Self {
        Self {
            plan_id: request.plan_id,
            document_id: request.document_id,
            page_start: request.page_start,
            page_end: request.page_end,
            note: request.note,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StudyPlanDto {
    id: String,
    title: String,
    target_exam: Option<String>,
    exam_date: Option<String>,
    overview: Option<String>,
    status: &'static str,
    revision: u32,
    created_at: i64,
    updated_at: i64,
}

impl From<StudyPlan> for StudyPlanDto {
    fn from(plan: StudyPlan) -> Self {
        Self {
            id: plan.id,
            title: plan.title,
            target_exam: plan.target_exam,
            exam_date: plan.exam_date,
            overview: plan.overview,
            status: plan.status.as_str(),
            revision: plan.revision,
            created_at: plan.created_at,
            updated_at: plan.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanStageDto {
    id: String,
    plan_id: String,
    title: String,
    start_date: String,
    end_date: String,
    focus: Option<String>,
    sort_order: u32,
    created_at: i64,
    updated_at: i64,
}

impl From<PlanStage> for PlanStageDto {
    fn from(stage: PlanStage) -> Self {
        Self {
            id: stage.id,
            plan_id: stage.plan_id,
            title: stage.title,
            start_date: stage.start_date,
            end_date: stage.end_date,
            focus: stage.focus,
            sort_order: stage.sort_order,
            created_at: stage.created_at,
            updated_at: stage.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanReferenceDto {
    id: String,
    plan_id: String,
    document_id: String,
    document_title: String,
    page_start: u32,
    page_end: u32,
    note: Option<String>,
    created_at: i64,
}

impl From<PlanReference> for PlanReferenceDto {
    fn from(reference: PlanReference) -> Self {
        Self {
            id: reference.id,
            plan_id: reference.plan_id,
            document_id: reference.document_id,
            document_title: reference.document_title,
            page_start: reference.page_start,
            page_end: reference.page_end,
            note: reference.note,
            created_at: reference.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StudyPlanBundleDto {
    plan: StudyPlanDto,
    stages: Vec<PlanStageDto>,
    references: Vec<PlanReferenceDto>,
}

impl From<StudyPlanBundle> for StudyPlanBundleDto {
    fn from(bundle: StudyPlanBundle) -> Self {
        Self {
            plan: StudyPlanDto::from(bundle.plan),
            stages: bundle.stages.into_iter().map(PlanStageDto::from).collect(),
            references: bundle
                .references
                .into_iter()
                .map(PlanReferenceDto::from)
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateKnowledgeMapRequestDto {
    title: String,
    subject_id: Option<String>,
}

impl From<CreateKnowledgeMapRequestDto> for CreateKnowledgeMapInput {
    fn from(request: CreateKnowledgeMapRequestDto) -> Self {
        Self {
            title: request.title,
            subject_id: request.subject_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateKnowledgeMapRequestDto {
    map_id: String,
    title: String,
    subject_id: Option<String>,
}

impl From<UpdateKnowledgeMapRequestDto> for UpdateKnowledgeMapInput {
    fn from(request: UpdateKnowledgeMapRequestDto) -> Self {
        Self {
            map_id: request.map_id,
            title: request.title,
            subject_id: request.subject_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateKnowledgeNodeRequestDto {
    node_id: String,
    title: String,
    note_markdown: Option<String>,
    mastery_state: String,
    importance: u8,
    subject_id: Option<String>,
}

impl From<UpdateKnowledgeNodeRequestDto> for UpdateKnowledgeNodeInput {
    fn from(request: UpdateKnowledgeNodeRequestDto) -> Self {
        Self {
            node_id: request.node_id,
            title: request.title,
            note_markdown: request.note_markdown,
            mastery_state: request.mastery_state,
            importance: request.importance,
            subject_id: request.subject_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MoveKnowledgeNodeRequestDto {
    node_id: String,
    new_parent_id: String,
    position: u32,
}

impl From<MoveKnowledgeNodeRequestDto> for MoveKnowledgeNodeInput {
    fn from(request: MoveKnowledgeNodeRequestDto) -> Self {
        Self {
            node_id: request.node_id,
            new_parent_id: request.new_parent_id,
            position: request.position,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddNodeResourceRequestDto {
    node_id: String,
    document_id: String,
    page_start: Option<u32>,
    page_end: Option<u32>,
    note: Option<String>,
}

impl From<AddNodeResourceRequestDto> for AddNodeResourceInput {
    fn from(request: AddNodeResourceRequestDto) -> Self {
        Self {
            node_id: request.node_id,
            document_id: request.document_id,
            page_start: request.page_start,
            page_end: request.page_end,
            note: request.note,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeMapDto {
    id: String,
    subject_id: Option<String>,
    title: String,
    root_node_id: String,
    current_revision: u32,
    created_at: i64,
    updated_at: i64,
}

impl From<KnowledgeMap> for KnowledgeMapDto {
    fn from(map: KnowledgeMap) -> Self {
        Self {
            id: map.id,
            subject_id: map.subject_id,
            title: map.title,
            root_node_id: map.root_node_id,
            current_revision: map.current_revision,
            created_at: map.created_at,
            updated_at: map.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeNodeDto {
    id: String,
    map_id: String,
    subject_id: Option<String>,
    parent_id: Option<String>,
    title: String,
    note_markdown: Option<String>,
    mastery_state: &'static str,
    importance: u8,
    sort_order: u32,
    collapsed: bool,
    created_at: i64,
    updated_at: i64,
}

impl From<KnowledgeNode> for KnowledgeNodeDto {
    fn from(node: KnowledgeNode) -> Self {
        Self {
            id: node.id,
            map_id: node.map_id,
            subject_id: node.subject_id,
            parent_id: node.parent_id,
            title: node.title,
            note_markdown: node.note_markdown,
            mastery_state: node.mastery_state.as_str(),
            importance: node.importance,
            sort_order: node.sort_order,
            collapsed: node.collapsed,
            created_at: node.created_at,
            updated_at: node.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeNodeResourceDto {
    id: String,
    node_id: String,
    document_id: String,
    document_title: String,
    page_start: Option<u32>,
    page_end: Option<u32>,
    note: Option<String>,
    created_at: i64,
}

impl From<KnowledgeNodeResource> for KnowledgeNodeResourceDto {
    fn from(resource: KnowledgeNodeResource) -> Self {
        Self {
            id: resource.id,
            node_id: resource.node_id,
            document_id: resource.document_id,
            document_title: resource.document_title,
            page_start: resource.page_start,
            page_end: resource.page_end,
            note: resource.note,
            created_at: resource.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeMapBundleDto {
    map: KnowledgeMapDto,
    nodes: Vec<KnowledgeNodeDto>,
    resources: Vec<KnowledgeNodeResourceDto>,
    can_undo: bool,
    can_redo: bool,
}

impl From<KnowledgeMapBundle> for KnowledgeMapBundleDto {
    fn from(bundle: KnowledgeMapBundle) -> Self {
        Self {
            map: KnowledgeMapDto::from(bundle.map),
            nodes: bundle
                .nodes
                .into_iter()
                .map(KnowledgeNodeDto::from)
                .collect(),
            resources: bundle
                .resources
                .into_iter()
                .map(KnowledgeNodeResourceDto::from)
                .collect(),
            can_undo: bundle.can_undo,
            can_redo: bundle.can_redo,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MindMapDraftNodeDto {
    title: String,
    note_markdown: Option<String>,
    children: Vec<Self>,
}

impl From<MindMapDraftNode> for MindMapDraftNodeDto {
    fn from(node: MindMapDraftNode) -> Self {
        Self {
            title: node.title,
            note_markdown: node.note_markdown,
            children: node
                .children
                .into_iter()
                .map(MindMapDraftNodeDto::from)
                .collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MindMapImportDraftDto {
    id: String,
    source_resource_id: String,
    source_format: String,
    title: String,
    tree: MindMapDraftNodeDto,
    warnings: Vec<String>,
    node_count: u32,
    state: String,
    accepted_map_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

impl From<MindMapImportDraft> for MindMapImportDraftDto {
    fn from(draft: MindMapImportDraft) -> Self {
        Self {
            id: draft.id,
            source_resource_id: draft.source_resource_id,
            source_format: draft.source_format,
            title: draft.title,
            tree: MindMapDraftNodeDto::from(draft.tree),
            warnings: draft.warnings,
            node_count: draft.node_count,
            state: draft.state,
            accepted_map_id: draft.accepted_map_id,
            created_at: draft.created_at,
            updated_at: draft.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuestionRegionRequestDto {
    page_number: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl From<QuestionRegionRequestDto> for QuestionRegionInput {
    fn from(request: QuestionRegionRequestDto) -> Self {
        Self {
            page_number: request.page_number,
            x: request.x,
            y: request.y,
            width: request.width,
            height: request.height,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateQuestionRequestDto {
    document_id: String,
    title: String,
    chapter: Option<String>,
    question_number: Option<String>,
    difficulty: u8,
    analysis_markdown: Option<String>,
    region: QuestionRegionRequestDto,
    knowledge_node_ids: Vec<String>,
}

impl From<CreateQuestionRequestDto> for CreateQuestionInput {
    fn from(request: CreateQuestionRequestDto) -> Self {
        Self {
            document_id: request.document_id,
            title: request.title,
            chapter: request.chapter,
            question_number: request.question_number,
            difficulty: request.difficulty,
            analysis_markdown: request.analysis_markdown,
            region: request.region.into(),
            knowledge_node_ids: request.knowledge_node_ids,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateQuestionRequestDto {
    question_id: String,
    title: String,
    chapter: Option<String>,
    question_number: Option<String>,
    difficulty: u8,
    analysis_markdown: Option<String>,
    knowledge_node_ids: Vec<String>,
}

impl From<UpdateQuestionRequestDto> for UpdateQuestionInput {
    fn from(request: UpdateQuestionRequestDto) -> Self {
        Self {
            question_id: request.question_id,
            title: request.title,
            chapter: request.chapter,
            question_number: request.question_number,
            difficulty: request.difficulty,
            analysis_markdown: request.analysis_markdown,
            knowledge_node_ids: request.knowledge_node_ids,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddQuestionRegionRequestDto {
    question_id: String,
    region: QuestionRegionRequestDto,
}

impl From<AddQuestionRegionRequestDto> for AddQuestionRegionInput {
    fn from(request: AddQuestionRegionRequestDto) -> Self {
        Self {
            question_id: request.question_id,
            region: request.region.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AddQuestionAttemptRequestDto {
    question_id: String,
    result: String,
    attempted_on: String,
    duration_seconds: Option<u32>,
    answer_note: Option<String>,
}

impl From<AddQuestionAttemptRequestDto> for AddQuestionAttemptInput {
    fn from(request: AddQuestionAttemptRequestDto) -> Self {
        Self {
            question_id: request.question_id,
            result: request.result,
            attempted_on: request.attempted_on,
            duration_seconds: request.duration_seconds,
            answer_note: request.answer_note,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionDto {
    id: String,
    document_id: String,
    document_title: String,
    title: String,
    chapter: Option<String>,
    question_number: Option<String>,
    difficulty: u8,
    analysis_markdown: Option<String>,
    deleted_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

impl From<Question> for QuestionDto {
    fn from(question: Question) -> Self {
        Self {
            id: question.id,
            document_id: question.document_id,
            document_title: question.document_title,
            title: question.title,
            chapter: question.chapter,
            question_number: question.number_label,
            difficulty: question.difficulty,
            analysis_markdown: question.analysis_markdown,
            deleted_at: question.deleted_at,
            created_at: question.created_at,
            updated_at: question.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionRegionDto {
    id: String,
    question_id: String,
    document_id: String,
    page_number: u32,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    coordinate_version: u8,
    sort_order: u32,
    created_at: i64,
}

impl From<QuestionRegion> for QuestionRegionDto {
    fn from(region: QuestionRegion) -> Self {
        Self {
            id: region.id,
            question_id: region.question_id,
            document_id: region.document_id,
            page_number: region.page_number,
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
            coordinate_version: region.coordinate_version,
            sort_order: region.sort_order,
            created_at: region.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionAttemptDto {
    id: String,
    question_id: String,
    result: &'static str,
    attempted_at: i64,
    duration_seconds: Option<u32>,
    answer_note: Option<String>,
    created_at: i64,
}

impl From<QuestionAttempt> for QuestionAttemptDto {
    fn from(attempt: QuestionAttempt) -> Self {
        Self {
            id: attempt.id,
            question_id: attempt.question_id,
            result: attempt.result.as_str(),
            attempted_at: attempt.attempted_at,
            duration_seconds: attempt.duration_seconds,
            answer_note: attempt.answer_note,
            created_at: attempt.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionKnowledgeLinkDto {
    node_id: String,
    node_title: String,
    map_id: String,
    map_title: String,
}

impl From<QuestionKnowledgeLink> for QuestionKnowledgeLinkDto {
    fn from(link: QuestionKnowledgeLink) -> Self {
        Self {
            node_id: link.node_id,
            node_title: link.node_title,
            map_id: link.map_id,
            map_title: link.map_title,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionBundleDto {
    question: QuestionDto,
    regions: Vec<QuestionRegionDto>,
    attempts: Vec<QuestionAttemptDto>,
    knowledge_links: Vec<QuestionKnowledgeLinkDto>,
}

impl From<QuestionBundle> for QuestionBundleDto {
    fn from(bundle: QuestionBundle) -> Self {
        Self {
            question: bundle.question.into(),
            regions: bundle.regions.into_iter().map(Into::into).collect(),
            attempts: bundle.attempts.into_iter().map(Into::into).collect(),
            knowledge_links: bundle.knowledge_links.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateReviewPreferencesRequestDto {
    daily_quota: u32,
    early_fill_enabled: bool,
    today: String,
}

impl From<UpdateReviewPreferencesRequestDto> for UpdateReviewPreferencesInput {
    fn from(request: UpdateReviewPreferencesRequestDto) -> Self {
        Self {
            daily_quota: request.daily_quota,
            early_fill_enabled: request.early_fill_enabled,
            today: request.today,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetQuestionReviewRequestDto {
    question_id: String,
    active: bool,
    user_priority: u8,
    today: String,
}

impl From<SetQuestionReviewRequestDto> for SetQuestionReviewInput {
    fn from(request: SetQuestionReviewRequestDto) -> Self {
        Self {
            question_id: request.question_id,
            active: request.active,
            user_priority: request.user_priority,
            today: request.today,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PinQuestionReviewRequestDto {
    question_id: String,
    pin_date: Option<String>,
    today: String,
}

impl From<PinQuestionReviewRequestDto> for PinQuestionReviewInput {
    fn from(request: PinQuestionReviewRequestDto) -> Self {
        Self {
            question_id: request.question_id,
            pin_date: request.pin_date,
            today: request.today,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GenerateReviewQueueRequestDto {
    queue_date: String,
    quota: Option<u32>,
}

impl From<GenerateReviewQueueRequestDto> for GenerateReviewQueueInput {
    fn from(request: GenerateReviewQueueRequestDto) -> Self {
        Self {
            queue_date: request.queue_date,
            quota: request.quota,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InsertReviewQueueItemRequestDto {
    queue_date: String,
    question_id: String,
}

impl From<InsertReviewQueueItemRequestDto> for InsertReviewQueueItemInput {
    fn from(request: InsertReviewQueueItemRequestDto) -> Self {
        Self {
            queue_date: request.queue_date,
            question_id: request.question_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SubmitReviewRequestDto {
    queue_id: String,
    question_id: String,
    rating: String,
    today: String,
    duration_seconds: Option<u32>,
    answer_note: Option<String>,
}

impl From<SubmitReviewRequestDto> for SubmitReviewInput {
    fn from(request: SubmitReviewRequestDto) -> Self {
        Self {
            queue_id: request.queue_id,
            question_id: request.question_id,
            rating: request.rating,
            today: request.today,
            duration_seconds: request.duration_seconds,
            answer_note: request.answer_note,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewPreferencesDto {
    daily_quota: u32,
    early_fill_enabled: bool,
}

impl From<ReviewPreferences> for ReviewPreferencesDto {
    fn from(preferences: ReviewPreferences) -> Self {
        Self {
            daily_quota: preferences.daily_quota,
            early_fill_enabled: preferences.early_fill_enabled,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MistakeProfileDto {
    question_id: String,
    first_mistake_at: Option<i64>,
    last_mistake_at: Option<i64>,
    mistake_count: u32,
    consecutive_failure_count: u32,
    active: bool,
    user_priority: u8,
    created_at: i64,
    updated_at: i64,
}

impl From<MistakeProfile> for MistakeProfileDto {
    fn from(profile: MistakeProfile) -> Self {
        Self {
            question_id: profile.question_id,
            first_mistake_at: profile.first_mistake_at,
            last_mistake_at: profile.last_mistake_at,
            mistake_count: profile.mistake_count,
            consecutive_failure_count: profile.consecutive_failure_count,
            active: profile.active,
            user_priority: profile.user_priority,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewStateDto {
    question_id: String,
    policy_version: u32,
    mastery: &'static str,
    due_date: String,
    last_reviewed_at: Option<i64>,
    successful_streak: u32,
    manual_pin_date: Option<String>,
    suspended_at: Option<i64>,
    created_at: i64,
    updated_at: i64,
}

impl From<ReviewState> for ReviewStateDto {
    fn from(state: ReviewState) -> Self {
        Self {
            question_id: state.question_id,
            policy_version: state.policy_version,
            mastery: state.mastery.as_str(),
            due_date: state.due_date.as_str().to_owned(),
            last_reviewed_at: state.last_reviewed_at,
            successful_streak: state.successful_streak,
            manual_pin_date: state.manual_pin_date.map(|date| date.as_str().to_owned()),
            suspended_at: state.suspended_at,
            created_at: state.created_at,
            updated_at: state.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewEventDto {
    id: String,
    question_id: String,
    attempt_id: Option<String>,
    rating: &'static str,
    previous_due_date: String,
    next_due_date: String,
    interval_days: u32,
    policy_version: u32,
    created_at: i64,
}

impl From<ReviewEvent> for ReviewEventDto {
    fn from(event: ReviewEvent) -> Self {
        Self {
            id: event.id,
            question_id: event.question_id,
            attempt_id: event.attempt_id,
            rating: event.rating.as_str(),
            previous_due_date: event.previous_due_date.as_str().to_owned(),
            next_due_date: event.next_due_date.as_str().to_owned(),
            interval_days: event.interval_days,
            policy_version: event.policy_version,
            created_at: event.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewReasonDto {
    selection: &'static str,
    overdue_days: u32,
    failure_streak: u32,
    mistake_count: u32,
    user_priority: u8,
    knowledge_weakness: u8,
    days_since_attempt: u32,
    is_early: bool,
}

impl From<ReviewReason> for ReviewReasonDto {
    fn from(reason: ReviewReason) -> Self {
        Self {
            selection: reason.selection.as_str(),
            overdue_days: reason.overdue_days,
            failure_streak: reason.failure_streak,
            mistake_count: reason.mistake_count,
            user_priority: reason.user_priority,
            knowledge_weakness: reason.knowledge_weakness,
            days_since_attempt: reason.days_since_attempt,
            is_early: reason.is_early,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewQuestionDto {
    question: QuestionBundleDto,
    profile: MistakeProfileDto,
    state: ReviewStateDto,
    recent_events: Vec<ReviewEventDto>,
}

impl From<ReviewQuestion> for ReviewQuestionDto {
    fn from(question: ReviewQuestion) -> Self {
        Self {
            question: question.question.into(),
            profile: question.profile.into(),
            state: question.state.into(),
            recent_events: question.recent_events.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DailyReviewItemDto {
    question: QuestionBundleDto,
    available: bool,
    position: u32,
    priority_score: u32,
    reason: ReviewReasonDto,
    state: &'static str,
    review_event: Option<ReviewEventDto>,
    inserted_at: i64,
    completed_at: Option<i64>,
}

impl From<DailyReviewItem> for DailyReviewItemDto {
    fn from(item: DailyReviewItem) -> Self {
        Self {
            question: item.question.into(),
            available: item.available,
            position: item.position,
            priority_score: item.priority_score,
            reason: item.reason.into(),
            state: item.state.as_str(),
            review_event: item.review_event.map(Into::into),
            inserted_at: item.inserted_at,
            completed_at: item.completed_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DailyReviewQueueDto {
    id: String,
    queue_date: String,
    quota: u32,
    generated_at: i64,
    completed_count: u32,
    items: Vec<DailyReviewItemDto>,
}

impl From<DailyReviewQueue> for DailyReviewQueueDto {
    fn from(queue: DailyReviewQueue) -> Self {
        Self {
            id: queue.id,
            queue_date: queue.queue_date.as_str().to_owned(),
            quota: queue.quota,
            generated_at: queue.generated_at,
            completed_count: queue.completed_count,
            items: queue.items.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewBacklogDto {
    active_count: u32,
    due_count: u32,
    overdue_count: u32,
    queued_remaining: u32,
    estimated_clear_days: u32,
}

impl From<ReviewBacklog> for ReviewBacklogDto {
    fn from(backlog: ReviewBacklog) -> Self {
        Self {
            active_count: backlog.active_count,
            due_count: backlog.due_count,
            overdue_count: backlog.overdue_count,
            queued_remaining: backlog.queued_remaining,
            estimated_clear_days: backlog.estimated_clear_days,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewDashboardDto {
    preferences: ReviewPreferencesDto,
    backlog: ReviewBacklogDto,
    queue: Option<DailyReviewQueueDto>,
    active_questions: Vec<ReviewQuestionDto>,
}

impl From<ReviewDashboard> for ReviewDashboardDto {
    fn from(dashboard: ReviewDashboard) -> Self {
        Self {
            preferences: dashboard.preferences.into(),
            backlog: dashboard.backlog.into(),
            queue: dashboard.queue.map(Into::into),
            active_questions: dashboard
                .active_questions
                .into_iter()
                .map(Into::into)
                .collect(),
        }
    }
}

/// Imported resource metadata that deliberately excludes every local path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceDocumentDto {
    id: String,
    title: String,
    kind: String,
    mime_type: String,
    size_bytes: u64,
    sha256: String,
    reused_existing_blob: bool,
    role: String,
    page_count: Option<u32>,
    last_page: Option<u32>,
    last_opened_at: Option<i64>,
    created_at: i64,
}

impl From<ResourceDocument> for ResourceDocumentDto {
    fn from(document: ResourceDocument) -> Self {
        Self {
            id: document.id,
            title: document.title,
            kind: document.kind,
            mime_type: document.mime_type,
            size_bytes: document.size_bytes,
            sha256: document.sha256,
            reused_existing_blob: document.reused_existing_blob,
            role: document.role,
            page_count: document.page_count,
            last_page: document.last_page,
            last_opened_at: document.last_opened_at,
            created_at: document.created_at,
        }
    }
}

/// Safe metadata needed by the PDF or image reader.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceReaderDescriptorDto {
    document_id: String,
    title: String,
    kind: String,
    mime_type: String,
    size_bytes: u64,
    page_count: Option<u32>,
    last_page: Option<u32>,
}

impl From<ResourceReaderDescriptor> for ResourceReaderDescriptorDto {
    fn from(descriptor: ResourceReaderDescriptor) -> Self {
        Self {
            document_id: descriptor.document_id,
            title: descriptor.title,
            kind: descriptor.kind,
            mime_type: descriptor.mime_type,
            size_bytes: descriptor.size_bytes,
            page_count: descriptor.page_count,
            last_page: descriptor.last_page,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BeginResourceIndexRequestDto {
    document_id: String,
    total_pages: u32,
    force: bool,
}

impl From<BeginResourceIndexRequestDto> for BeginResourceIndexInput {
    fn from(request: BeginResourceIndexRequestDto) -> Self {
        Self {
            document_id: request.document_id,
            total_pages: request.total_pages,
            force: request.force,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StoreResourcePageTextRequestDto {
    document_id: String,
    page_number: u32,
    total_pages: u32,
    width_points: f64,
    height_points: f64,
    text: String,
}

impl From<StoreResourcePageTextRequestDto> for StoreResourcePageTextInput {
    fn from(request: StoreResourcePageTextRequestDto) -> Self {
        Self {
            document_id: request.document_id,
            page_number: request.page_number,
            total_pages: request.total_pages,
            width_points: request.width_points,
            height_points: request.height_points,
            text: request.text,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SearchResourcesRequestDto {
    query: String,
    limit: Option<u32>,
}

impl From<SearchResourcesRequestDto> for SearchResourcesInput {
    fn from(request: SearchResourcesRequestDto) -> Self {
        Self {
            query: request.query,
            limit: request.limit,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceIndexStatusDto {
    document_id: String,
    state: &'static str,
    total_pages: Option<u32>,
    indexed_pages: u32,
    text_pages: u32,
    chunk_count: u32,
    updated_at: Option<i64>,
}

impl From<ResourceIndexStatus> for ResourceIndexStatusDto {
    fn from(status: ResourceIndexStatus) -> Self {
        Self {
            document_id: status.document_id,
            state: status.state.as_str(),
            total_pages: status.total_pages,
            indexed_pages: status.indexed_pages,
            text_pages: status.text_pages,
            chunk_count: status.chunk_count,
            updated_at: status.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceIndexSessionDto {
    status: ResourceIndexStatusDto,
    next_page: u32,
    needs_indexing: bool,
}

impl From<ResourceIndexSession> for ResourceIndexSessionDto {
    fn from(session: ResourceIndexSession) -> Self {
        Self {
            status: session.status.into(),
            next_page: session.next_page,
            needs_indexing: session.needs_indexing,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResourceSearchResultDto {
    document_id: String,
    document_title: String,
    document_kind: String,
    page_number: Option<u32>,
    excerpt: String,
    match_kind: &'static str,
}

impl From<ResourceSearchResult> for ResourceSearchResultDto {
    fn from(result: ResourceSearchResult) -> Self {
        Self {
            document_id: result.document_id,
            document_title: result.document_title,
            document_kind: result.document_kind,
            page_number: result.page_number,
            excerpt: result.excerpt,
            match_kind: result.match_kind.as_str(),
        }
    }
}

/// Handle returned after the user selected a source in the native dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportOperationDto {
    operation_id: String,
}

/// One progress or terminal event for an active import operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportEventDto {
    operation_id: String,
    state: &'static str,
    copied_bytes: u64,
    total_bytes: u64,
    resource: Option<ResourceDocumentDto>,
    error: Option<AppErrorDto>,
}

/// Verified backup metadata returned without the selected destination path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackupReportDto {
    directory_name: String,
    blob_count: u64,
    total_bytes: u64,
    created_at: i64,
}

impl From<BackupReport> for BackupReportDto {
    fn from(report: BackupReport) -> Self {
        Self {
            directory_name: report.directory_name,
            blob_count: report.blob_count,
            total_bytes: report.total_bytes,
            created_at: report.created_at,
        }
    }
}

/// Verified restore metadata returned without the selected destination path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreReportDto {
    directory_name: String,
    blob_count: u64,
    total_bytes: u64,
}

impl From<RestoreReport> for RestoreReportDto {
    fn from(report: RestoreReport) -> Self {
        Self {
            directory_name: report.directory_name,
            blob_count: report.blob_count,
            total_bytes: report.total_bytes,
        }
    }
}

const IMPORT_EVENT_NAME: &str = "kystudy-import-progress";

/// Stable, non-sensitive command failure returned to the `WebView`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppErrorDto {
    code: &'static str,
    message: &'static str,
    action: &'static str,
    operation_id: String,
}

impl AppErrorDto {
    fn from_persistence(error: &crate::application::PersistenceError) -> Self {
        let (message, action) = match error {
            crate::application::PersistenceError::Busy { .. } => (
                "本地数据库正在被占用，请稍后重试。",
                "关闭其他 KyStudy 窗口后重试。",
            ),
            crate::application::PersistenceError::UnsupportedSchema { .. } => (
                "这个工作区由更新版本的 KyStudy 创建，当前版本无法安全打开。",
                "请升级 KyStudy 后重试。",
            ),
            crate::application::PersistenceError::MigrationHistoryInconsistent
            | crate::application::PersistenceError::MigrationFailed { .. } => (
                "工作区数据库升级未能安全完成。",
                "不要覆盖文件；请保留工作区并查看诊断信息。",
            ),
            crate::application::PersistenceError::StorageUnavailable { .. } => {
                ("无法访问本地工作区存储。", "检查磁盘空间和目录权限后重试。")
            }
            crate::application::PersistenceError::UnsupportedConfiguration
            | crate::application::PersistenceError::Database { .. }
            | crate::application::PersistenceError::InvalidSystemTime => (
                "本地工作区暂时无法打开。",
                "重新启动应用；如果仍失败，请导出诊断信息。",
            ),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn task_failed() -> Self {
        Self {
            code: "INTERNAL_ERROR",
            message: "本地任务意外中断。",
            action: "重新启动应用后重试。",
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_import(error: &ImportError) -> Self {
        let (message, action) = match error {
            ImportError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建本地工作区，再导入学习资料。")
            }
            ImportError::SourceNotFile | ImportError::InvalidFileName => (
                "所选内容不是可导入的本地文件。",
                "重新选择 PDF、图片、XMind、OPML、Markdown 或文本文件。",
            ),
            ImportError::SourceInsideWorkspace => (
                "不能把 KyStudy 管理的内部文件再次作为来源导入。",
                "请从工作区外部选择原始资料。",
            ),
            ImportError::SourceChanged => (
                "源文件在导入过程中发生了变化。",
                "等待文件下载或同步完成后重新导入。",
            ),
            ImportError::InsufficientSpace => (
                "磁盘剩余空间不足，无法安全导入。",
                "释放工作区所在磁盘的空间后重试。",
            ),
            ImportError::Canceled => ("导入已取消。", "可以随时重新选择该资料。"),
            ImportError::InvalidManagedPath | ImportError::IntegrityMismatch => (
                "资料完整性校验未通过。",
                "不要手动覆盖工作区文件；请保留数据并查看诊断信息。",
            ),
            ImportError::DocumentNotFound => (
                "找不到这份本地资料。",
                "刷新资料列表；如果问题持续存在，请检查工作区完整性。",
            ),
            ImportError::UnsupportedReaderKind => (
                "这种资料暂时不能在阅读器中打开。",
                "当前可直接阅读 PDF 和常见图片，其他格式将在后续支持。",
            ),
            ImportError::InvalidMetadata => (
                "资料的分类或阅读进度无效。",
                "检查页码、总页数或资料用途后重试。",
            ),
            ImportError::MindMapSourceTooLarge => (
                "思维导图源文件超过当前安全上限。",
                "请把源文件精简到 4 MiB 以内，或拆分为多张导图后重试。",
            ),
            ImportError::File { .. } => (
                "无法读取来源文件或写入本地资料库。",
                "检查文件占用、磁盘空间和目录权限后重试。",
            ),
            ImportError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_search(error: &SearchError) -> Self {
        let (message, action) = match error {
            SearchError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建工作区，再建立资料索引。")
            }
            SearchError::DocumentNotFound => {
                ("找不到需要索引的本地资料。", "刷新资料列表后重新选择。")
            }
            SearchError::UnsupportedDocument => (
                "这份资料暂时不能建立文字索引。",
                "当前只支持带文字层的 PDF；扫描页需要等待 OCR 版本。",
            ),
            SearchError::InvalidInput => (
                "索引页码、页面文字或搜索条件无效。",
                "重新打开 PDF 后再试，搜索词请控制在 100 个字符以内。",
            ),
            SearchError::IndexNotRunning => (
                "这份资料当前没有正在执行的索引任务。",
                "刷新索引状态后选择继续或重新建立。",
            ),
            SearchError::IndexIncomplete => (
                "PDF 仍有页面尚未完成索引。",
                "继续处理剩余页面后再完成索引。",
            ),
            SearchError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_planning(error: &PlanningError) -> Self {
        let (message, action) = match error {
            PlanningError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建本地工作区，再建立个人计划。")
            }
            PlanningError::InvalidInput => (
                "个人计划内容不完整或格式无效。",
                "检查标题、日期范围和文字长度后重试。",
            ),
            PlanningError::PlanNotFound => ("找不到这份个人计划。", "刷新计划列表后重新选择。"),
            PlanningError::StageNotFound => ("找不到这个计划阶段。", "刷新计划后重新编辑阶段。"),
            PlanningError::ReferenceNotFound => {
                ("找不到这条资料引用。", "刷新计划后重新选择引用。")
            }
            PlanningError::InvalidReference => (
                "资料引用的 PDF 或页码范围无效。",
                "选择已导入的 PDF，并检查起止页码。",
            ),
            PlanningError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_knowledge(error: &KnowledgeError) -> Self {
        let (message, action) = match error {
            KnowledgeError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建本地工作区，再建立思维导图。")
            }
            KnowledgeError::MapNotFound => ("找不到这张思维导图。", "刷新导图列表后重新选择。"),
            KnowledgeError::NodeNotFound => ("找不到这个知识节点。", "刷新导图后重新选择节点。"),
            KnowledgeError::InvalidInput => (
                "导图内容不完整或格式无效。",
                "检查标题、掌握状态、重要度或标识后重试。",
            ),
            KnowledgeError::RootProtected => (
                "根节点不能移动或删除。",
                "可以编辑根节点内容，或操作它下面的子节点。",
            ),
            KnowledgeError::CycleDetected => (
                "这次移动会让节点成为自己的后代。",
                "请选择当前节点子树之外的父节点。",
            ),
            KnowledgeError::NodeLimitExceeded => (
                "这张导图已达到 2000 个节点的首版上限。",
                "拆分为多张导图后继续整理。",
            ),
            KnowledgeError::InvalidResourceReference => (
                "节点关联的资料或页码范围无效。",
                "选择已导入资料，并检查 PDF 起止页码。",
            ),
            KnowledgeError::DraftNotFound => (
                "找不到可处理的导入草案。",
                "刷新草案列表，或重新从源文件生成。",
            ),
            KnowledgeError::UnsupportedFormat => (
                "当前不能直接解析这种思维导图格式。",
                "XMind 请先导出为 OPML；本批次正式支持 OPML 和 FreeMind .mm。",
            ),
            KnowledgeError::InvalidImportSource => (
                "思维导图源文件结构无效或包含不安全声明。",
                "确认文件能在原软件中打开，再导出为标准 OPML 或 FreeMind .mm。",
            ),
            KnowledgeError::ImportLimitExceeded => (
                "导入内容超过节点数或层级安全上限。",
                "把导图拆分到每张 2000 个节点、32 层以内后重试。",
            ),
            KnowledgeError::Source(error) => return Self::from_import(error),
            KnowledgeError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_question(error: &QuestionError) -> Self {
        let (message, action) = match error {
            QuestionError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建本地工作区，再管理习题。")
            }
            QuestionError::WorkbookNotFound => (
                "找不到可用的习题册 PDF。",
                "把 PDF 用途设为“习题册”，打开一次确认页数后重试。",
            ),
            QuestionError::QuestionNotFound => ("找不到这道题目。", "刷新题目列表后重新选择。"),
            QuestionError::RegionNotFound => ("找不到这个题目区域。", "刷新题目后重新选择区域。"),
            QuestionError::InvalidInput => (
                "题目内容或作答记录格式无效。",
                "检查标题、难度、耗时和文字长度后重试。",
            ),
            QuestionError::InvalidRegion => (
                "题目框选区域或页码无效。",
                "重新在当前 PDF 页面框选完整题目区域。",
            ),
            QuestionError::LastRegionProtected => (
                "一道题必须至少保留一个来源区域。",
                "可以重新框选区域，或删除整道题。",
            ),
            QuestionError::InvalidKnowledgeLink => {
                ("关联的知识节点无效。", "刷新思维导图后重新选择知识节点。")
            }
            QuestionError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_review(error: &ReviewError) -> Self {
        let (message, action) = match error {
            ReviewError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建本地工作区，再使用错题复习。")
            }
            ReviewError::QuestionNotFound => (
                "找不到可复习的题目。",
                "确认题目仍在有效习题册中，然后刷新复习页。",
            ),
            ReviewError::MistakeNotFound => (
                "这道题当前不在错题复习中。",
                "刷新错题列表，或先把题目加入复习。",
            ),
            ReviewError::QueueNotFound => (
                "今天的复习队列尚未生成。",
                "先生成今日队列，再追加或完成题目。",
            ),
            ReviewError::QueueItemNotFound => {
                ("今日队列中找不到这道题。", "刷新复习页后重新选择。")
            }
            ReviewError::QueueItemCompleted => (
                "这道题今天已经完成复习。",
                "查看复习历史，不要重复提交同一队列项。",
            ),
            ReviewError::QueueItemAlreadyExists => (
                "这道题已经在今日复习队列中。",
                "直接在今日队列中完成它，无需重复追加。",
            ),
            ReviewError::InvalidInput => (
                "复习设置、日期或反馈格式无效。",
                "检查配额、重要度、耗时和日期后重试。",
            ),
            ReviewError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_backup(error: &BackupError) -> Self {
        let (message, action) = match error {
            BackupError::WorkspaceNotInitialized => (
                "尚未创建可备份的本地工作区。",
                "先创建工作区，再创建完整备份。",
            ),
            BackupError::SourceNotDirectory => (
                "所选位置不是可用的本地文件夹。",
                "重新选择备份文件夹或目标父文件夹。",
            ),
            BackupError::DestinationInsideWorkspace => (
                "备份不能保存在 KyStudy 管理的工作区内部。",
                "请选择工作区之外的文件夹。",
            ),
            BackupError::UnsupportedBackup => (
                "该备份版本或数据库版本不受当前 KyStudy 支持。",
                "使用创建该备份的兼容版本进行恢复。",
            ),
            BackupError::InvalidManifest | BackupError::InvalidManagedPath => (
                "备份清单无效或包含不安全路径。",
                "不要修改备份目录；请重新选择一份完整备份。",
            ),
            BackupError::IntegrityMismatch => (
                "备份中的文件完整性校验未通过。",
                "不要使用该备份恢复；请保留它以便诊断。",
            ),
            BackupError::DestinationExists => (
                "目标目录已经存在，KyStudy 不会覆盖它。",
                "重新选择目标父文件夹后再试。",
            ),
            BackupError::InsufficientSpace => (
                "目标磁盘空间不足，无法安全完成操作。",
                "释放目标磁盘空间后重试。",
            ),
            BackupError::File { .. } => (
                "无法读取备份或写入目标文件夹。",
                "检查文件占用、磁盘空间和目录权限后重试。",
            ),
            BackupError::Manifest { .. } => (
                "备份清单无法读取。",
                "重新选择未被修改的 KyStudy 备份目录。",
            ),
            BackupError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_schedule(error: &ScheduleError) -> Self {
        let (message, action) = match error {
            ScheduleError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建本地工作区，再管理学习任务。")
            }
            ScheduleError::SubjectNameConflict => (
                "已经存在同名的有效科目。",
                "使用不同名称，或先归档现有科目。",
            ),
            ScheduleError::SubjectNotFound => (
                "所选科目不存在或已经归档。",
                "重新选择有效科目，或暂时使用未分类。",
            ),
            ScheduleError::TaskNotFound => ("该任务不存在或已进入回收站。", "刷新今日任务后重试。"),
            ScheduleError::InvalidStoredData => (
                "本地日程数据未通过完整性校验。",
                "不要覆盖工作区；请先创建完整备份并保留诊断信息。",
            ),
            ScheduleError::Validation(_) => (
                "任务内容或状态不符合要求。",
                "检查标题、日期、预计时长和当前任务状态后重试。",
            ),
            ScheduleError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }
}

#[tauri::command]
pub(crate) async fn get_workspace_status(
    state: State<'_, AppState>,
) -> Result<Option<WorkspaceStatusDto>, AppErrorDto> {
    let use_cases = state.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.status())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|workspace| workspace.map(WorkspaceStatusDto::from))
        .map_err(|error| AppErrorDto::from_persistence(&error))
}

#[tauri::command]
pub(crate) async fn initialize_default_workspace(
    state: State<'_, AppState>,
) -> Result<WorkspaceStatusDto, AppErrorDto> {
    let use_cases = state.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.initialize_default())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(WorkspaceStatusDto::from)
        .map_err(|error| AppErrorDto::from_persistence(&error))
}

#[tauri::command]
pub(crate) async fn list_subjects(
    state: State<'_, AppState>,
) -> Result<Vec<SubjectDto>, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_subjects())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|subjects| subjects.into_iter().map(SubjectDto::from).collect())
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn create_subject(
    request: CreateSubjectRequestDto,
    state: State<'_, AppState>,
) -> Result<SubjectDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let input = CreateSubjectInput::from(request);
        use_cases.create_subject(&input)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(SubjectDto::from)
    .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn archive_subject(
    subject_id: String,
    state: State<'_, AppState>,
) -> Result<SubjectDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.archive_subject(&subject_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(SubjectDto::from)
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn list_tasks_for_range(
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<TaskDto>, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_tasks(&start_date, &end_date))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|tasks| tasks.into_iter().map(TaskDto::from).collect())
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn create_task(
    request: CreateTaskRequestDto,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.create_task(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(TaskDto::from)
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn update_task_details(
    task_id: String,
    request: UpdateTaskDetailsRequestDto,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.update_task_details(&task_id, request.into())
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(TaskDto::from)
    .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn reschedule_task(
    task_id: String,
    request: RescheduleTaskRequestDto,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.reschedule_task(&task_id, &request.into())
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(TaskDto::from)
    .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn transition_task(
    task_id: String,
    transition: String,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppErrorDto> {
    let transition = TaskTransition::parse(&transition).ok_or_else(|| {
        AppErrorDto::from_schedule(&ScheduleError::Validation(
            crate::domain::ScheduleValidationError::Transition,
        ))
    })?;
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.transition_task(&task_id, transition))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(TaskDto::from)
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn list_task_changes(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<TaskChangeDto>, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_task_changes(&task_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|changes| changes.into_iter().map(TaskChangeDto::from).collect())
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn split_task(
    task_id: String,
    request: SplitTaskRequestDto,
    state: State<'_, AppState>,
) -> Result<TaskSplitDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.split_task(&task_id, request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(TaskSplitDto::from)
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn trash_task(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<TrashedTaskDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.trash_task(&task_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(TrashedTaskDto::from)
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn list_trashed_tasks(
    state: State<'_, AppState>,
) -> Result<Vec<TrashedTaskDto>, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_trashed_tasks())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|tasks| tasks.into_iter().map(TrashedTaskDto::from).collect())
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn restore_trashed_task(
    task_id: String,
    state: State<'_, AppState>,
) -> Result<TaskDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.restore_trashed_task(&task_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(TaskDto::from)
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn list_overdue_tasks(
    today: String,
    state: State<'_, AppState>,
) -> Result<Vec<TaskDto>, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_overdue_tasks(&today))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|tasks| tasks.into_iter().map(TaskDto::from).collect())
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn create_study_session(
    request: CreateStudySessionRequestDto,
    state: State<'_, AppState>,
) -> Result<StudySessionDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.create_study_session(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(StudySessionDto::from)
        .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn list_study_sessions(
    start_date: String,
    end_date: String,
    state: State<'_, AppState>,
) -> Result<Vec<StudySessionDto>, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.list_study_sessions(&start_date, &end_date)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(|sessions| sessions.into_iter().map(StudySessionDto::from).collect())
    .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn get_study_statistics(
    start_date: String,
    end_date: String,
    today: String,
    state: State<'_, AppState>,
) -> Result<StudyStatisticsDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.study_statistics(&start_date, &end_date, &today)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(StudyStatisticsDto::from)
    .map_err(|error| AppErrorDto::from_schedule(&error))
}

#[tauri::command]
pub(crate) async fn list_resources(
    state: State<'_, AppState>,
) -> Result<Vec<ResourceDocumentDto>, AppErrorDto> {
    let use_cases = state.resources.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|resources| {
            resources
                .into_iter()
                .map(ResourceDocumentDto::from)
                .collect()
        })
        .map_err(|error| AppErrorDto::from_import(&error))
}

#[tauri::command]
pub(crate) async fn get_resource_reader_descriptor(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<ResourceReaderDescriptorDto, AppErrorDto> {
    let use_cases = state.resources.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.reader_descriptor(&document_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(ResourceReaderDescriptorDto::from)
        .map_err(|error| AppErrorDto::from_import(&error))
}

#[tauri::command]
pub(crate) async fn update_resource_role(
    document_id: String,
    role: String,
    state: State<'_, AppState>,
) -> Result<ResourceDocumentDto, AppErrorDto> {
    let use_cases = state.resources.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.update_role(&document_id, &role))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(ResourceDocumentDto::from)
        .map_err(|error| AppErrorDto::from_import(&error))
}

#[tauri::command]
pub(crate) async fn save_resource_reading_progress(
    document_id: String,
    page_count: u32,
    last_page: u32,
    state: State<'_, AppState>,
) -> Result<ResourceReaderDescriptorDto, AppErrorDto> {
    let use_cases = state.resources.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.save_reading_progress(&document_id, page_count, last_page)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(ResourceReaderDescriptorDto::from)
    .map_err(|error| AppErrorDto::from_import(&error))
}

#[tauri::command]
pub(crate) async fn list_resource_index_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<ResourceIndexStatusDto>, AppErrorDto> {
    let use_cases = state.search.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_statuses())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|statuses| statuses.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_search(&error))
}

#[tauri::command]
pub(crate) async fn begin_resource_index(
    request: BeginResourceIndexRequestDto,
    state: State<'_, AppState>,
) -> Result<ResourceIndexSessionDto, AppErrorDto> {
    let use_cases = state.search.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.begin_index(&request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_search(&error))
}

#[tauri::command]
pub(crate) async fn store_resource_page_text(
    request: StoreResourcePageTextRequestDto,
    state: State<'_, AppState>,
) -> Result<ResourceIndexStatusDto, AppErrorDto> {
    let use_cases = state.search.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.store_page(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_search(&error))
}

#[tauri::command]
pub(crate) async fn complete_resource_index(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<ResourceIndexStatusDto, AppErrorDto> {
    let use_cases = state.search.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.complete_index(&document_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_search(&error))
}

#[tauri::command]
pub(crate) async fn interrupt_resource_index(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<ResourceIndexStatusDto, AppErrorDto> {
    let use_cases = state.search.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.interrupt_index(&document_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_search(&error))
}

#[tauri::command]
pub(crate) async fn fail_resource_index(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<ResourceIndexStatusDto, AppErrorDto> {
    let use_cases = state.search.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.fail_index(&document_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_search(&error))
}

#[tauri::command]
pub(crate) async fn clear_resource_index(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<ResourceIndexStatusDto, AppErrorDto> {
    let use_cases = state.search.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.clear_index(&document_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_search(&error))
}

#[tauri::command]
pub(crate) async fn search_resources(
    request: SearchResourcesRequestDto,
    state: State<'_, AppState>,
) -> Result<Vec<ResourceSearchResultDto>, AppErrorDto> {
    let use_cases = state.search.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.search(&request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|results| results.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_search(&error))
}

#[tauri::command]
pub(crate) async fn list_study_plans(
    state: State<'_, AppState>,
) -> Result<Vec<StudyPlanBundleDto>, AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|plans| plans.into_iter().map(StudyPlanBundleDto::from).collect())
        .map_err(|error| AppErrorDto::from_planning(&error))
}

#[tauri::command]
pub(crate) async fn save_study_plan(
    request: SavePlanRequestDto,
    state: State<'_, AppState>,
) -> Result<StudyPlanBundleDto, AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.save_plan(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(StudyPlanBundleDto::from)
        .map_err(|error| AppErrorDto::from_planning(&error))
}

#[tauri::command]
pub(crate) async fn set_study_plan_status(
    plan_id: String,
    status: String,
    state: State<'_, AppState>,
) -> Result<StudyPlanBundleDto, AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.set_status(&plan_id, &status))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(StudyPlanBundleDto::from)
        .map_err(|error| AppErrorDto::from_planning(&error))
}

#[tauri::command]
pub(crate) async fn save_plan_stage(
    request: SavePlanStageRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanStageDto, AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.save_stage(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(PlanStageDto::from)
        .map_err(|error| AppErrorDto::from_planning(&error))
}

#[tauri::command]
pub(crate) async fn delete_plan_stage(
    stage_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete_stage(&stage_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_planning(&error))
}

#[tauri::command]
pub(crate) async fn add_plan_reference(
    request: AddPlanReferenceRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanReferenceDto, AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.add_reference(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(PlanReferenceDto::from)
        .map_err(|error| AppErrorDto::from_planning(&error))
}

#[tauri::command]
pub(crate) async fn delete_plan_reference(
    reference_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete_reference(&reference_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_planning(&error))
}

#[tauri::command]
pub(crate) async fn list_knowledge_maps(
    state: State<'_, AppState>,
) -> Result<Vec<KnowledgeMapBundleDto>, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_maps())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|maps| maps.into_iter().map(KnowledgeMapBundleDto::from).collect())
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn create_knowledge_map(
    request: CreateKnowledgeMapRequestDto,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.create_map(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn update_knowledge_map(
    request: UpdateKnowledgeMapRequestDto,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let input = request.into();
        use_cases.update_map(&input)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(KnowledgeMapBundleDto::from)
    .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn duplicate_knowledge_map(
    map_id: String,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.duplicate_map(&map_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn trash_knowledge_map(
    map_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.trash_map(&map_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn create_knowledge_node(
    map_id: String,
    parent_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.create_node(&map_id, &parent_id, &title))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn update_knowledge_node(
    request: UpdateKnowledgeNodeRequestDto,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.update_node(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn move_knowledge_node(
    request: MoveKnowledgeNodeRequestDto,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let input = request.into();
        use_cases.move_node(&input)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(KnowledgeMapBundleDto::from)
    .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn delete_knowledge_subtree(
    node_id: String,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete_subtree(&node_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn set_knowledge_node_collapsed(
    node_id: String,
    collapsed: bool,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.set_collapsed(&node_id, collapsed))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn add_knowledge_node_resource(
    request: AddNodeResourceRequestDto,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.add_resource(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn delete_knowledge_node_resource(
    resource_id: String,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete_resource(&resource_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn undo_knowledge_map(
    map_id: String,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.undo(&map_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn redo_knowledge_map(
    map_id: String,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.redo(&map_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn list_mindmap_import_drafts(
    state: State<'_, AppState>,
) -> Result<Vec<MindMapImportDraftDto>, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_import_drafts())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|drafts| {
            drafts
                .into_iter()
                .map(MindMapImportDraftDto::from)
                .collect()
        })
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn create_mindmap_import_draft(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<MindMapImportDraftDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.create_import_draft(&document_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(MindMapImportDraftDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn accept_mindmap_import_draft(
    draft_id: String,
    state: State<'_, AppState>,
) -> Result<KnowledgeMapBundleDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.accept_import_draft(&draft_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(KnowledgeMapBundleDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn reject_mindmap_import_draft(
    draft_id: String,
    state: State<'_, AppState>,
) -> Result<MindMapImportDraftDto, AppErrorDto> {
    let use_cases = state.knowledge.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.reject_import_draft(&draft_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(MindMapImportDraftDto::from)
        .map_err(|error| AppErrorDto::from_knowledge(&error))
}

#[tauri::command]
pub(crate) async fn list_workbook_questions(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<QuestionBundleDto>, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_for_document(&document_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|questions| questions.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn list_trashed_questions(
    state: State<'_, AppState>,
) -> Result<Vec<QuestionBundleDto>, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_trashed())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|questions| questions.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn create_question(
    request: CreateQuestionRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBundleDto, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.create_question(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn update_question(
    request: UpdateQuestionRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBundleDto, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.update_question(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn add_question_region(
    request: AddQuestionRegionRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBundleDto, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.add_region(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn delete_question_region(
    region_id: String,
    state: State<'_, AppState>,
) -> Result<QuestionBundleDto, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete_region(&region_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn add_question_attempt(
    request: AddQuestionAttemptRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBundleDto, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.add_attempt(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn trash_question(
    question_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.trash_question(&question_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn restore_question(
    question_id: String,
    state: State<'_, AppState>,
) -> Result<QuestionBundleDto, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.restore_question(&question_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn get_review_dashboard(
    today: String,
    state: State<'_, AppState>,
) -> Result<ReviewDashboardDto, AppErrorDto> {
    let use_cases = state.reviews.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.dashboard(&today))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review(&error))
}

#[tauri::command]
pub(crate) async fn update_review_preferences(
    request: UpdateReviewPreferencesRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewDashboardDto, AppErrorDto> {
    let use_cases = state.reviews.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.update_preferences(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review(&error))
}

#[tauri::command]
pub(crate) async fn set_question_review(
    request: SetQuestionReviewRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewDashboardDto, AppErrorDto> {
    let use_cases = state.reviews.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.set_question_review(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review(&error))
}

#[tauri::command]
pub(crate) async fn pin_question_review(
    request: PinQuestionReviewRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewDashboardDto, AppErrorDto> {
    let use_cases = state.reviews.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.pin_question(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review(&error))
}

#[tauri::command]
pub(crate) async fn generate_daily_review_queue(
    request: GenerateReviewQueueRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewDashboardDto, AppErrorDto> {
    let use_cases = state.reviews.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.generate_queue(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review(&error))
}

#[tauri::command]
pub(crate) async fn insert_daily_review_item(
    request: InsertReviewQueueItemRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewDashboardDto, AppErrorDto> {
    let use_cases = state.reviews.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.insert_queue_item(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review(&error))
}

#[tauri::command]
pub(crate) async fn submit_review_result(
    request: SubmitReviewRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewDashboardDto, AppErrorDto> {
    let use_cases = state.reviews.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.submit_review(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review(&error))
}

#[tauri::command]
pub(crate) async fn start_resource_import(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<ImportOperationDto>, AppErrorDto> {
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .add_filter(
                "学习资料",
                &[
                    "pdf", "png", "jpg", "jpeg", "webp", "xmind", "opml", "mm", "md", "txt",
                ],
            )
            .blocking_pick_file()
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let FilePath::Path(source) = selected else {
        return Err(AppErrorDto::from_import(&ImportError::SourceNotFile));
    };

    let operation_id = Uuid::now_v7().to_string();
    let canceled = state.imports.register(operation_id.clone());
    let use_cases = state.resources.clone();
    let coordinator = state.imports.clone();
    let operations = state.operations.clone();
    let task_operation_id = operation_id.clone();
    let task_app = app.clone();
    std::mem::drop(tauri::async_runtime::spawn_blocking(move || {
        let mut last_progress = ImportProgress {
            copied_bytes: 0,
            total_bytes: 0,
        };
        let result = operations.run(|| {
            let mut observe = |progress: ImportProgress| {
                last_progress = progress;
                emit_import_event(
                    &task_app,
                    ImportEventDto {
                        operation_id: task_operation_id.clone(),
                        state: "running",
                        copied_bytes: progress.copied_bytes,
                        total_bytes: progress.total_bytes,
                        resource: None,
                        error: None,
                    },
                );
            };
            use_cases.import_file(&source, &canceled, &mut observe)
        });
        let event = match result {
            Ok(resource) => ImportEventDto {
                operation_id: task_operation_id.clone(),
                state: "succeeded",
                copied_bytes: resource.size_bytes,
                total_bytes: resource.size_bytes,
                resource: Some(ResourceDocumentDto::from(resource)),
                error: None,
            },
            Err(error) => ImportEventDto {
                operation_id: task_operation_id.clone(),
                state: if matches!(error, ImportError::Canceled) {
                    "canceled"
                } else {
                    "failed"
                },
                copied_bytes: last_progress.copied_bytes,
                total_bytes: last_progress.total_bytes,
                resource: None,
                error: Some(AppErrorDto::from_import(&error)),
            },
        };
        emit_import_event(&task_app, event);
        coordinator.finish(&task_operation_id);
    }));

    Ok(Some(ImportOperationDto { operation_id }))
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command extraction provides owned arguments and managed state wrappers"
)]
pub(crate) fn cancel_resource_import(operation_id: String, state: State<'_, AppState>) -> bool {
    state.imports.cancel(&operation_id)
}

#[tauri::command]
pub(crate) async fn create_workspace_backup(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<BackupReportDto>, AppErrorDto> {
    let Some(parent) = pick_local_folder(&app, "选择备份保存位置").await? else {
        return Ok(None);
    };
    let use_cases = state.backups.clone();
    let operations = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || operations.run(|| use_cases.create_in(&parent)))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(BackupReportDto::from)
        .map(Some)
        .map_err(|error| AppErrorDto::from_backup(&error))
}

#[tauri::command]
pub(crate) async fn restore_workspace_backup(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<RestoreReportDto>, AppErrorDto> {
    let Some(backup_directory) = pick_local_folder(&app, "选择 KyStudy 备份目录").await?
    else {
        return Ok(None);
    };
    let Some(parent) = pick_local_folder(&app, "选择恢复副本保存位置").await? else {
        return Ok(None);
    };
    let use_cases = state.backups.clone();
    let operations = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || {
        operations.run(|| use_cases.restore_into(&backup_directory, &parent))
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(RestoreReportDto::from)
    .map(Some)
    .map_err(|error| AppErrorDto::from_backup(&error))
}

async fn pick_local_folder(
    app: &AppHandle,
    title: &'static str,
) -> Result<Option<std::path::PathBuf>, AppErrorDto> {
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title(title)
            .blocking_pick_folder()
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?;
    match selected {
        None => Ok(None),
        Some(FilePath::Path(path)) => Ok(Some(path)),
        Some(FilePath::Url(_)) => Err(AppErrorDto::from_backup(&BackupError::SourceNotDirectory)),
    }
}

fn emit_import_event(app: &AppHandle, event: ImportEventDto) {
    if app.emit(IMPORT_EVENT_NAME, event).is_err() {
        eprintln!("KYSTUDY_IMPORT_EVENT_EMIT_FAILED");
    }
}

#[cfg(test)]
mod tests {
    use super::{
        AppErrorDto, BackupReportDto, KnowledgeMapBundleDto, QuestionBundleDto,
        RescheduleTaskRequestDto, ResourceDocumentDto, ResourceSearchResultDto, ReviewReasonDto,
        SubjectDto, TaskChangeDto, TaskDto, UpdateTaskDetailsRequestDto, get_runtime_status,
    };
    use crate::application::{BackupReport, PersistenceError, ResourceDocument, ScheduleError};
    use crate::domain::{
        AttemptResult, KnowledgeMap, KnowledgeMapBundle, KnowledgeNode, KnowledgeNodeResource,
        LocalDate, MasteryState, Question, QuestionAttempt, QuestionBundle, QuestionRegion,
        ResourceSearchMatchKind, ResourceSearchResult, ReviewReason, ReviewSelectionKind, Subject,
        SubjectColor, Task, TaskChange, TaskChangeSnapshot, TaskChangeType, TaskPriority,
        TaskStatus,
    };

    #[test]
    fn subject_dto_exposes_only_safe_management_fields() {
        let dto = SubjectDto::from(Subject {
            id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            name: "408".to_owned(),
            color: SubjectColor::Blue,
            sort_order: 0,
            archived_at: Some(1_700_000_000_100),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_100,
        });

        let value = serde_json::to_value(dto).expect("subject DTO should serialize");

        assert_eq!(value["archivedAt"], 1_700_000_000_100_i64);
        assert!(value.get("workspaceId").is_none());
        assert!(value.get("databasePath").is_none());
    }

    #[test]
    fn task_details_request_rejects_a_planned_date_field() {
        let value = serde_json::json!({
            "subjectId": null,
            "title": "线性代数强化",
            "description": null,
            "estimatedMinutes": 90,
            "priority": "normal",
            "plannedDate": "2026-07-19"
        });

        let result = serde_json::from_value::<UpdateTaskDetailsRequestDto>(value);

        assert!(result.is_err());
    }

    #[test]
    fn reschedule_request_rejects_unrelated_task_fields() {
        let value = serde_json::json!({
            "plannedDate": "2026-07-20",
            "reason": "先完成前置章节",
            "title": "不允许顺便修改标题"
        });

        let result = serde_json::from_value::<RescheduleTaskRequestDto>(value);

        assert!(result.is_err());
    }

    #[test]
    fn backup_dto_serialization_never_exposes_destination_path() {
        let dto = BackupReportDto::from(BackupReport {
            directory_name: "KyStudy-backup-safe".to_owned(),
            blob_count: 2,
            total_bytes: 4096,
            created_at: 1_700_000_000_000,
        });

        let value = serde_json::to_value(dto).expect("backup DTO should serialize");

        assert!(value.get("path").is_none());
        assert!(value.get("destination").is_none());
        assert!(value.get("directoryName").is_some());
    }

    #[test]
    fn resource_dto_serialization_never_exposes_managed_locations() {
        let dto = ResourceDocumentDto::from(ResourceDocument {
            id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            title: "local resource".to_owned(),
            kind: "pdf".to_owned(),
            mime_type: "application/pdf".to_owned(),
            size_bytes: 128,
            sha256: "AB".repeat(32),
            reused_existing_blob: false,
            role: "planning".to_owned(),
            page_count: Some(6),
            last_page: Some(2),
            last_opened_at: Some(1_700_000_000_100),
            created_at: 1_700_000_000_000,
        });

        let value = serde_json::to_value(dto).expect("resource DTO should serialize");

        assert!(value.get("path").is_none());
        assert!(value.get("storageKey").is_none());
        assert!(value.get("originalName").is_none());
    }

    #[test]
    fn resource_search_dto_exposes_no_chunk_or_index_internals() {
        let dto = ResourceSearchResultDto::from(ResourceSearchResult {
            document_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            document_title: "408 规划".to_owned(),
            document_kind: "pdf".to_owned(),
            page_number: Some(12),
            excerpt: "第二阶段复习操作系统".to_owned(),
            match_kind: ResourceSearchMatchKind::PageText,
        });

        let value = serde_json::to_value(dto).expect("search DTO should serialize");

        assert!(value.get("chunkId").is_none());
        assert!(value.get("contentHash").is_none());
        assert!(value.get("databasePath").is_none());
        assert_eq!(value["pageNumber"], 12);
    }

    #[test]
    fn knowledge_dto_exposes_typed_content_without_snapshots_or_storage_details() {
        let map_id = "019f7328-4b66-7613-9729-e3570fc41525".to_owned();
        let node_id = "019f7328-4b66-7613-9729-e3570fc41526".to_owned();
        let dto = KnowledgeMapBundleDto::from(KnowledgeMapBundle {
            map: KnowledgeMap {
                id: map_id.clone(),
                subject_id: None,
                title: "408 知识树".to_owned(),
                root_node_id: node_id.clone(),
                current_revision: 2,
                deleted_at: None,
                created_at: 1_700_000_000_000,
                updated_at: 1_700_000_000_100,
            },
            nodes: vec![KnowledgeNode {
                id: node_id.clone(),
                map_id,
                subject_id: None,
                parent_id: None,
                title: "数据结构".to_owned(),
                note_markdown: Some("线性表".to_owned()),
                mastery_state: MasteryState::Learning,
                importance: 5,
                sort_order: 0,
                collapsed: false,
                created_at: 1_700_000_000_000,
                updated_at: 1_700_000_000_100,
            }],
            resources: vec![KnowledgeNodeResource {
                id: "019f7328-4b66-7613-9729-e3570fc41527".to_owned(),
                node_id,
                document_id: "019f7328-4b66-7613-9729-e3570fc41528".to_owned(),
                document_title: "王道数据结构".to_owned(),
                page_start: Some(10),
                page_end: Some(12),
                note: None,
                created_at: 1_700_000_000_100,
            }],
            can_undo: true,
            can_redo: false,
        });

        let value = serde_json::to_value(dto).expect("knowledge DTO should serialize");

        assert_eq!(value["nodes"][0]["masteryState"], "learning");
        assert!(value["map"].get("deletedAt").is_none());
        assert!(value.get("snapshotJson").is_none());
        assert!(value.get("databasePath").is_none());
        assert!(value["resources"][0].get("storageKey").is_none());
    }

    #[test]
    fn question_dto_exposes_normalized_regions_without_canvas_or_paths() {
        let question_id = "019f7328-4b66-7613-9729-e3570fc41525".to_owned();
        let document_id = "019f7328-4b66-7613-9729-e3570fc41526".to_owned();
        let dto = QuestionBundleDto::from(QuestionBundle {
            question: Question {
                id: question_id.clone(),
                document_id: document_id.clone(),
                document_title: "408 习题册".to_owned(),
                title: "线性表综合题".to_owned(),
                chapter: Some("数据结构".to_owned()),
                number_label: Some("1".to_owned()),
                difficulty: 4,
                analysis_markdown: None,
                deleted_at: None,
                created_at: 1_700_000_000_000,
                updated_at: 1_700_000_000_100,
            },
            regions: vec![QuestionRegion {
                id: "019f7328-4b66-7613-9729-e3570fc41527".to_owned(),
                question_id: question_id.clone(),
                document_id,
                page_number: 2,
                x: 0.1,
                y: 0.2,
                width: 0.5,
                height: 0.3,
                coordinate_version: 1,
                sort_order: 0,
                created_at: 1_700_000_000_000,
            }],
            attempts: vec![QuestionAttempt {
                id: "019f7328-4b66-7613-9729-e3570fc41528".to_owned(),
                question_id,
                result: AttemptResult::Incorrect,
                attempted_at: 1_700_000_000_100,
                duration_seconds: Some(180),
                answer_note: Some("边界条件遗漏".to_owned()),
                created_at: 1_700_000_000_100,
            }],
            knowledge_links: Vec::new(),
        });

        let value = serde_json::to_value(dto).expect("question DTO should serialize");

        assert_eq!(value["regions"][0]["coordinateVersion"], 1);
        assert!(value.get("databasePath").is_none());
        assert!(value["regions"][0].get("canvasPixels").is_none());
        assert!(value["regions"][0].get("storageKey").is_none());
    }

    #[test]
    fn review_reason_dto_exposes_typed_factors_without_internal_payloads() {
        let dto = ReviewReasonDto::from(ReviewReason {
            selection: ReviewSelectionKind::Overdue,
            overdue_days: 4,
            failure_streak: 2,
            mistake_count: 3,
            user_priority: 5,
            knowledge_weakness: 2,
            days_since_attempt: 8,
            is_early: false,
        });

        let value = serde_json::to_value(dto).expect("review reason DTO should serialize");

        assert_eq!(value["selection"], "overdue");
        assert!(value.get("reasonJson").is_none());
        assert!(value.get("sql").is_none());
        assert!(value.get("databasePath").is_none());
    }

    #[test]
    fn task_dto_serialization_never_exposes_audit_or_storage_details() {
        let dto = TaskDto::from(Task {
            id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            subject_id: None,
            parent_task_id: None,
            title: "线性代数强化".to_owned(),
            description: None,
            planned_date: LocalDate::parse("2026-07-18").expect("fixture date should parse"),
            estimated_minutes: Some(90),
            priority: TaskPriority::High,
            status: TaskStatus::Todo,
            manual_order: 0,
            completed_at: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
        });

        let value = serde_json::to_value(dto).expect("task DTO should serialize");

        assert!(value.get("beforeJson").is_none());
        assert!(value.get("afterJson").is_none());
        assert!(value.get("databasePath").is_none());
    }

    #[test]
    fn task_change_dto_exposes_typed_snapshots_without_raw_json() {
        let task = Task {
            id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            subject_id: None,
            parent_task_id: None,
            title: "线性代数强化".to_owned(),
            description: None,
            planned_date: LocalDate::parse("2026-07-20").expect("fixture date should parse"),
            estimated_minutes: Some(90),
            priority: TaskPriority::High,
            status: TaskStatus::Todo,
            manual_order: 0,
            completed_at: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_100,
        };
        let dto = TaskChangeDto::from(TaskChange {
            id: "019f7328-4b66-7613-9729-e3570fc41526".to_owned(),
            task_id: task.id.clone(),
            change_type: TaskChangeType::Rescheduled,
            before: Some(TaskChangeSnapshot::from(&task)),
            after: Some(TaskChangeSnapshot::from(&task)),
            reason: Some("调整计划".to_owned()),
            created_at: 1_700_000_000_100,
        });

        let value = serde_json::to_value(dto).expect("task change DTO should serialize");

        assert!(value.get("before").is_some());
        assert!(value.get("beforeJson").is_none());
        assert!(value.get("afterJson").is_none());
        assert!(value.get("taskId").is_none());
        assert!(value.get("databasePath").is_none());
    }

    #[test]
    fn schedule_error_dto_does_not_expose_stored_data() {
        let dto = AppErrorDto::from_schedule(&ScheduleError::InvalidStoredData);

        assert_eq!(dto.message, "本地日程数据未通过完整性校验。");
    }

    #[test]
    fn get_runtime_status_delegates_to_the_application_use_case() {
        let status = get_runtime_status();

        assert_eq!(status, crate::application::get_runtime_status());
    }

    #[test]
    fn app_error_dto_does_not_expose_internal_error_text() {
        let error = PersistenceError::StorageUnavailable {
            source: Box::new(std::io::Error::other("C:\\private\\workspace")),
        };

        let dto = AppErrorDto::from_persistence(&error);

        assert_eq!(dto.message, "无法访问本地工作区存储。");
    }
}
