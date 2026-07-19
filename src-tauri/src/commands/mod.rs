//! Thin Tauri command adapters.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

use crate::application::{
    BackupError, BackupReport, CreateStudySessionInput, CreateSubjectInput, CreateTaskInput,
    ImportError, ImportProgress, RescheduleTaskInput, ResourceDocument, RestoreReport,
    RuntimeStatus, ScheduleError, SplitChildInput, SplitTaskInput, UpdateTaskDetailsInput,
    get_runtime_status as load_runtime_status,
};
use crate::bootstrap::AppState;
use crate::domain::{
    StudySession, StudyStatistics, Subject, SubjectStatistics, Task, TaskChange,
    TaskChangeSnapshot, TaskSplit, TaskTransition, TrashedTask, Workspace,
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
            created_at: document.created_at,
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
                    "pdf", "png", "jpg", "jpeg", "webp", "xmind", "opml", "md", "txt",
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
        AppErrorDto, BackupReportDto, RescheduleTaskRequestDto, ResourceDocumentDto, SubjectDto,
        TaskChangeDto, TaskDto, UpdateTaskDetailsRequestDto, get_runtime_status,
    };
    use crate::application::{BackupReport, PersistenceError, ResourceDocument, ScheduleError};
    use crate::domain::{
        LocalDate, Subject, SubjectColor, Task, TaskChange, TaskChangeSnapshot, TaskChangeType,
        TaskPriority, TaskStatus,
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
            created_at: 1_700_000_000_000,
        });

        let value = serde_json::to_value(dto).expect("resource DTO should serialize");

        assert!(value.get("path").is_none());
        assert!(value.get("storageKey").is_none());
        assert!(value.get("originalName").is_none());
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
