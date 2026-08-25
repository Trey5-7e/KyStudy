//! Thin Tauri command adapters.

use std::{
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::{DialogExt, FilePath};
use uuid::Uuid;

use crate::application::{
    AddNodeResourceInput, AddPlanReferenceInput, AddQuestionAttemptInput, AddQuestionRegionInput,
    AiAttachmentRef, AiCallPreview, AiCallResult, AiError, AiImagePreviewInput, AiModelOption,
    AiOverview, AiPreviewInput, AnalyticsBacklog, AnalyticsError, AnalyticsInput,
    AnalyticsOverview, AnalyticsPeriodSummary, BackupError, BackupReport,
    BatchClassifyQuestionsInput, BeginResourceIndexInput, BulkQuestionAttemptInput,
    ConfirmPlanningChatInput, ConfirmQuestionRegionOcrInput, ConfirmShiftCyclePlanInput,
    CreateKnowledgeMapInput, CreateQuestionInput, CreateStudySessionInput, CreateSubjectInput,
    CreateTaskInput, CreateWorkbookCategoryInput, CyclePlanError, DailyAnalyticsPoint,
    DeleteTrashedWorkbookSegmentInput, GenerateReviewQueueInput, GenerateReviewSchemeQueueInput,
    ImportError, ImportProgress, ImportQuestionIndexInput, IndexedQuestionDraftInput,
    IndexedQuestionRegionUpdateInput, InsertIndexedQuestionInput, InsertReviewQueueItemInput,
    KnowledgeAnalytics, KnowledgeError, ListAiModelsInput, MoveKnowledgeNodeInput,
    OcrComponentStatus, OcrError, OcrPageLine, OcrPageRecognition, PinQuestionReviewInput,
    PlanExecutionProgress, PlanProgressError, PlanProgressInput, PlanProgressSummary,
    PlanScheduleError, PlanStageProgress, PlanTaskCreation, PlanTaskPreview, PlanTaskPreviewItem,
    PlanTaskScheduleInput, PlanningAttachmentPreview, PlanningChatError, PlanningChatInput,
    PlanningChatPreview, PlanningChatReply, PlanningContextSelection, PlanningConversation,
    PlanningError, PlanningMessage, PlanningQuestionContext, PlanningSource,
    QuestionAiAnalysisHistoryEntry, QuestionBankError, QuestionError, QuestionRegionInput,
    ReassignWorkbookSegmentInput, RecognizePdfPageInput, RecognizeQuestionRegionInput,
    RecordBulkQuestionAttemptsInput, RenameSubjectInput, RenameWorkbookCategoryInput,
    RepeatedMistakeAnalytics, ReplaceIndexedQuestionRegionsInput, RescheduleTaskInput,
    ResourceDocument, ResourceReaderDescriptor, RestoreCyclePlanItemStateInput, RestoreReport,
    RestoreWorkbookSegmentInput, ReviewError, ReviewSchemeError, ReviewSchemeTypeQuotaInput,
    RuntimeStatus, SaveAiBudgetInput, SaveAiProviderCapabilitiesInput, SaveAiProviderInput,
    SaveCyclePlanInput, SavePlanInput, SavePlanStageInput, SaveReviewSchemeInput, ScheduleError,
    SearchError, SearchResourcesInput, SetCyclePlanItemStateInput, SetCyclePlanItemStateResult,
    SetQuestionGapAcknowledgementInput, SetQuestionReviewInput, SetWorkbookSubjectInput,
    ShiftCyclePlanInput, ShiftCyclePlanPreview, ShiftCyclePlanResult, ShiftCyclePlanUndo,
    SplitChildInput, SplitTaskInput, StoreResourcePageTextInput, SubjectAnalytics,
    SubmitReviewInput, SubmitReviewSchemeResultInput, TemporaryAttachmentInput,
    TrashWorkbookSegmentInput, UndoReviewSchemeResultInput, UndoShiftCyclePlanInput,
    UpdateIndexedQuestionInput, UpdateKnowledgeMapInput, UpdateKnowledgeNodeInput,
    UpdateQuestionInput, UpdateQuestionRegionInput, UpdateReviewPreferencesInput,
    UpdateTaskDetailsInput, WorkbookSegmentAssignmentInput, classify_source,
    get_runtime_status as load_runtime_status,
};
use crate::bootstrap::AppState;
use crate::domain::{
    AiCapabilityState, CyclePlan, CyclePlanDashboard, CyclePlanItem, CyclePlanOverview,
    DailyReviewItem, DailyReviewQueue, IndexedQuestion, KnowledgeMap, KnowledgeMapBundle,
    KnowledgeNode, KnowledgeNodeResource, MindMapDraftNode, MindMapImportDraft, MistakeProfile,
    OcrRecognition, OcrTextLine, PlanReference, PlanStage, Question, QuestionAttempt,
    QuestionBankSnapshot, QuestionBundle, QuestionKnowledgeLink, QuestionRegion, QuestionType,
    ResourceIndexSession, ResourceIndexStatus, ResourceSearchResult, ReviewBacklog,
    ReviewDashboard, ReviewEvent, ReviewPreferences, ReviewQuestion, ReviewReason, ReviewScheme,
    ReviewSchemeDashboard, ReviewSchemeQueue, ReviewSchemeQueueItem, ReviewSchemeToday,
    ReviewSchemeTypeQuota, ReviewState, StudyPlan, StudyPlanBundle, StudySession, StudyStatistics,
    Subject, SubjectStatistics, Task, TaskChange, TaskChangeSnapshot, TaskSplit, TaskTransition,
    TrashedTask, TrashedWorkbookDocumentSegment, WorkbookCategory, WorkbookDocumentSegment,
    WorkbookProfile, Workspace,
};

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command handlers receive managed State by value"
)]
pub(crate) fn get_runtime_status(state: State<'_, AppState>) -> RuntimeStatus {
    load_runtime_status(state.data_directory())
}

#[tauri::command]
pub(crate) async fn get_analytics_overview(
    request: AnalyticsRequestDto,
    state: State<'_, AppState>,
) -> Result<AnalyticsOverviewDto, AppErrorDto> {
    let use_cases = state.analytics.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.overview(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_analytics(&error))
}

#[tauri::command]
pub(crate) async fn get_plan_execution_progress(
    request: PlanProgressRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanExecutionProgressDto, AppErrorDto> {
    let use_cases = state.plan_progress.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.overview(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_plan_progress(&error))
}

#[tauri::command]
pub(crate) async fn get_ai_overview(
    state: State<'_, AppState>,
) -> Result<AiOverviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.overview())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn save_paper_pdf(
    app: AppHandle,
    request: SavePaperPdfRequestDto,
) -> Result<Option<SavePaperPdfDto>, AppErrorDto> {
    if request.bytes.is_empty()
        || request.bytes.len() > 50 * 1024 * 1024
        || !request.bytes.starts_with(b"%PDF-")
        || !valid_pdf_file_name(&request.file_name)
    {
        return Err(AppErrorDto::paper_export_invalid());
    }
    let file_name = ensure_pdf_extension(&request.file_name);
    let dialog_file_name = file_name.clone();
    let dialog_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        dialog_app
            .dialog()
            .file()
            .set_title("保存练习卷 PDF")
            .set_file_name(&dialog_file_name)
            .add_filter("PDF 文件", &["pdf"])
            .blocking_save_file()
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?;
    let Some(selected) = selected else {
        return Ok(None);
    };
    let FilePath::Path(path) = selected else {
        return Err(AppErrorDto::paper_export_write_failed());
    };
    let bytes = request.bytes;
    let saved_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map_or_else(|| file_name.clone(), str::to_owned);
    tauri::async_runtime::spawn_blocking(move || fs::write(&path, bytes))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|_| AppErrorDto::paper_export_write_failed())?;
    Ok(Some(SavePaperPdfDto {
        file_name: saved_name,
    }))
}

fn valid_pdf_file_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 120
        && Path::new(trimmed)
            .file_name()
            .and_then(|name| name.to_str())
            == Some(trimmed)
        && !trimmed.chars().any(char::is_control)
}

fn ensure_pdf_extension(value: &str) -> String {
    if value.to_ascii_lowercase().ends_with(".pdf") {
        value.trim().to_owned()
    } else {
        format!("{}.pdf", value.trim())
    }
}

#[tauri::command]
pub(crate) async fn list_ai_models(
    request: ListAiModelsRequestDto,
    state: State<'_, AppState>,
) -> Result<Vec<AiModelOptionDto>, AppErrorDto> {
    let use_cases = state.ai.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_models(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|models| models.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn create_ai_provider(
    request: SaveAiProviderRequestDto,
    state: State<'_, AppState>,
) -> Result<AiOverviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.create_provider(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn update_ai_provider(
    provider_id: String,
    request: SaveAiProviderRequestDto,
    state: State<'_, AppState>,
) -> Result<AiOverviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.update_provider(&provider_id, &input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn save_ai_provider_capabilities(
    provider_id: String,
    request: SaveAiProviderCapabilitiesRequestDto,
    state: State<'_, AppState>,
) -> Result<AiOverviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    let input = request
        .try_into()
        .map_err(|error| AppErrorDto::from_ai(&error))?;
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.save_provider_capabilities(&provider_id, &input)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(Into::into)
    .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn activate_ai_provider(
    provider_id: String,
    state: State<'_, AppState>,
) -> Result<AiOverviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.activate_provider(&provider_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn delete_ai_provider(
    provider_id: String,
    state: State<'_, AppState>,
) -> Result<AiOverviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete_provider(&provider_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn save_ai_budget(
    request: SaveAiBudgetRequestDto,
    state: State<'_, AppState>,
) -> Result<AiOverviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.save_budget(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn save_ai_secret(
    request: SaveAiSecretRequestDto,
    state: State<'_, AppState>,
) -> Result<AiOverviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.set_secret(&request.provider_id, &request.secret)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(Into::into)
    .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn delete_ai_secret(
    provider_id: String,
    state: State<'_, AppState>,
) -> Result<AiOverviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete_secret(&provider_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn preview_ai_call(
    request: AiPreviewRequestDto,
    state: State<'_, AppState>,
) -> Result<AiCallPreviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.preview(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn execute_ai_call(
    request: AiPreviewRequestDto,
    state: State<'_, AppState>,
) -> Result<AiCallResultDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.execute(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn preview_question_ai_analysis(
    request: AiImagePreviewRequestDto,
    state: State<'_, AppState>,
) -> Result<AiCallPreviewDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.preview_question_analysis(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn get_question_ai_analysis(
    request: QuestionAiAnalysisLookupRequestDto,
    state: State<'_, AppState>,
) -> Result<Option<AiCallResultDto>, AppErrorDto> {
    let use_cases = state.ai.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.question_analysis(&request.question_id, &request.source_fingerprint)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(|result| result.map(Into::into))
    .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn list_question_ai_analysis_history(
    request: QuestionAiAnalysisHistoryLookupRequestDto,
    state: State<'_, AppState>,
) -> Result<Vec<QuestionAiAnalysisHistoryEntryDto>, AppErrorDto> {
    let use_cases = state.ai.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.question_analysis_history(&request.question_id)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(|entries| entries.into_iter().map(Into::into).collect())
    .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn execute_question_ai_analysis(
    request: QuestionAiAnalysisRequestDto,
    state: State<'_, AppState>,
) -> Result<AiCallResultDto, AppErrorDto> {
    let use_cases = state.ai.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.execute_question_analysis(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ai(&error))
}

#[tauri::command]
pub(crate) async fn list_planning_conversations(
    state: State<'_, AppState>,
) -> Result<Vec<PlanningConversationDto>, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|items| items.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn create_planning_conversation(
    request: CreatePlanningConversationRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanningConversationDto, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.create(&request.title))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn rename_planning_conversation(
    request: RenamePlanningConversationRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanningConversationDto, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.rename(&request.conversation_id, &request.title)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(Into::into)
    .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn delete_planning_conversation(
    request: PlanningConversationIdRequestDto,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete(&request.conversation_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn list_ai_attachments(
    conversation_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AiAttachmentRefDto>, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_attachments(&conversation_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|items| items.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn attach_resource_to_ai_conversation(
    request: AttachAiResourceRequestDto,
    state: State<'_, AppState>,
) -> Result<AiAttachmentRefDto, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.attach_resource(&request.conversation_id, &request.document_id)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(Into::into)
    .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn attach_temporary_ai_attachment(
    app: AppHandle,
    conversation_id: String,
    state: State<'_, AppState>,
) -> Result<Option<AiAttachmentRefDto>, AppErrorDto> {
    let Some(source) = pick_temporary_attachment_source(&app).await? else {
        return Ok(None);
    };
    let data_directory = state.data_directory().to_owned();
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let input = prepare_temporary_attachment(&source, &data_directory, conversation_id)
            .map_err(|error| AppErrorDto::from_import(&error))?;
        use_cases
            .attach_temporary(input)
            .map(AiAttachmentRefDto::from)
            .map(Some)
            .map_err(|error| AppErrorDto::from_planning_chat(&error))
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
}

#[tauri::command]
pub(crate) async fn remove_ai_attachment(
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.remove_attachment(&attachment_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn retry_ai_attachment(
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<AiAttachmentRefDto, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.retry_attachment(&attachment_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn preview_planning_chat(
    request: PlanningChatRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanningChatPreviewDto, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.preview(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn execute_planning_chat(
    request: ConfirmPlanningChatRequestDto,
    operation_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<PlanningChatReplyDto, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    let input = request.into();
    let operation_id = operation_id.unwrap_or_else(|| Uuid::now_v7().to_string());
    let canceled = state
        .ai_chat_jobs
        .register(operation_id.clone())
        .ok_or_else(AppErrorDto::ai_chat_operation_conflict)?;
    let coordinator = state.ai_chat_jobs.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        use_cases.execute_with_cancel(&input, &canceled)
    })
    .await;
    coordinator.finish(&operation_id);
    result
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn execute_planning_chat_stream(
    request: ConfirmPlanningChatRequestDto,
    operation_id: Option<String>,
    on_event: tauri::ipc::Channel<AiChatStreamChunkDto>,
    state: State<'_, AppState>,
) -> Result<PlanningChatReplyDto, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    let input = request.into();
    let operation_id = operation_id.unwrap_or_else(|| Uuid::now_v7().to_string());
    let canceled = state
        .ai_chat_jobs
        .register(operation_id.clone())
        .ok_or_else(AppErrorDto::ai_chat_operation_conflict)?;
    let coordinator = state.ai_chat_jobs.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        use_cases.execute_with_cancel_stream(&input, &canceled, &mut |delta| {
            on_event
                .send(AiChatStreamChunkDto {
                    delta: delta.to_owned(),
                })
                .map_err(|_| crate::application::AiError::Canceled)
        })
    })
    .await;
    coordinator.finish(&operation_id);
    result
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn save_planning_reply_as_draft(
    request: SavePlanningReplyRequestDto,
    state: State<'_, AppState>,
) -> Result<SavedPlanningDraftDto, AppErrorDto> {
    let use_cases = state.planning_chat.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.save_reply_as_plan(&request.message_id, &request.title)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(|plan_id| SavedPlanningDraftDto { plan_id })
    .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn list_ai_chat_conversations(
    state: State<'_, AppState>,
) -> Result<Vec<PlanningConversationDto>, AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|items| items.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn create_ai_chat_conversation(
    request: CreatePlanningConversationRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanningConversationDto, AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.create(&request.title))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn rename_ai_chat_conversation(
    request: RenamePlanningConversationRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanningConversationDto, AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.rename(&request.conversation_id, &request.title)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(Into::into)
    .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn delete_ai_chat_conversation(
    request: PlanningConversationIdRequestDto,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete(&request.conversation_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn list_ai_chat_attachments(
    conversation_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AiAttachmentRefDto>, AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_attachments(&conversation_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|items| items.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn attach_resource_to_ai_chat(
    request: AttachAiResourceRequestDto,
    state: State<'_, AppState>,
) -> Result<AiAttachmentRefDto, AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.attach_resource(&request.conversation_id, &request.document_id)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(Into::into)
    .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn attach_temporary_ai_chat_attachment(
    app: AppHandle,
    conversation_id: String,
    state: State<'_, AppState>,
) -> Result<Option<AiAttachmentRefDto>, AppErrorDto> {
    let Some(source) = pick_temporary_attachment_source(&app).await? else {
        return Ok(None);
    };
    let data_directory = state.data_directory().to_owned();
    let use_cases = state.ai_chat.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let input = prepare_temporary_attachment(&source, &data_directory, conversation_id)
            .map_err(|error| AppErrorDto::from_import(&error))?;
        use_cases
            .attach_temporary(input)
            .map(AiAttachmentRefDto::from)
            .map(Some)
            .map_err(|error| AppErrorDto::from_planning_chat(&error))
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
}

#[tauri::command]
pub(crate) async fn remove_ai_chat_attachment(
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.remove_attachment(&attachment_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn retry_ai_chat_attachment(
    attachment_id: String,
    state: State<'_, AppState>,
) -> Result<AiAttachmentRefDto, AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.retry_attachment(&attachment_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn preview_ai_chat(
    request: PlanningChatRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanningChatPreviewDto, AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.preview(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn execute_ai_chat(
    request: PlanningChatRequestDto,
    operation_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<PlanningChatReplyDto, AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    let input = request.into();
    let operation_id = operation_id.unwrap_or_else(|| Uuid::now_v7().to_string());
    let canceled = state
        .ai_chat_jobs
        .register(operation_id.clone())
        .ok_or_else(AppErrorDto::ai_chat_operation_conflict)?;
    let coordinator = state.ai_chat_jobs.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        use_cases.execute_direct_with_cancel(&input, &canceled)
    })
    .await;
    coordinator.finish(&operation_id);
    result
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
pub(crate) async fn execute_ai_chat_stream(
    request: PlanningChatRequestDto,
    operation_id: Option<String>,
    on_event: tauri::ipc::Channel<AiChatStreamChunkDto>,
    state: State<'_, AppState>,
) -> Result<PlanningChatReplyDto, AppErrorDto> {
    let use_cases = state.ai_chat.clone();
    let input = request.into();
    let operation_id = operation_id.unwrap_or_else(|| Uuid::now_v7().to_string());
    let canceled = state
        .ai_chat_jobs
        .register(operation_id.clone())
        .ok_or_else(AppErrorDto::ai_chat_operation_conflict)?;
    let coordinator = state.ai_chat_jobs.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        use_cases.execute_direct_with_cancel_stream(&input, &canceled, &mut |delta| {
            on_event
                .send(AiChatStreamChunkDto {
                    delta: delta.to_owned(),
                })
                .map_err(|_| crate::application::AiError::Canceled)
        })
    })
    .await;
    coordinator.finish(&operation_id);
    result
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_planning_chat(&error))
}

#[tauri::command]
#[expect(
    clippy::needless_pass_by_value,
    reason = "Tauri command handlers receive owned arguments and managed State"
)]
pub(crate) fn cancel_ai_chat(operation_id: String, state: State<'_, AppState>) -> bool {
    Uuid::parse_str(&operation_id).is_ok() && state.ai_chat_jobs.cancel(&operation_id)
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AnalyticsRequestDto {
    today: String,
    days: u32,
}

impl From<AnalyticsRequestDto> for AnalyticsInput {
    fn from(value: AnalyticsRequestDto) -> Self {
        Self {
            today: value.today,
            days: value.days,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalyticsPeriodSummaryDto {
    task_count: u32,
    completed_task_count: u32,
    completion_rate_percent: Option<u32>,
    planned_minutes: u32,
    actual_minutes: u32,
    attempt_count: u32,
    correct_attempt_count: u32,
    accuracy_percent: Option<u32>,
    review_item_count: u32,
    completed_review_count: u32,
    review_completion_percent: Option<u32>,
    ai_tokens: u64,
}

impl From<AnalyticsPeriodSummary> for AnalyticsPeriodSummaryDto {
    fn from(value: AnalyticsPeriodSummary) -> Self {
        Self {
            task_count: value.task_count,
            completed_task_count: value.completed_task_count,
            completion_rate_percent: value.completion_rate_percent,
            planned_minutes: value.planned_minutes,
            actual_minutes: value.actual_minutes,
            attempt_count: value.attempt_count,
            correct_attempt_count: value.correct_attempt_count,
            accuracy_percent: value.accuracy_percent,
            review_item_count: value.review_item_count,
            completed_review_count: value.completed_review_count,
            review_completion_percent: value.review_completion_percent,
            ai_tokens: value.ai_tokens,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalyticsBacklogDto {
    overdue_tasks: u32,
    active_mistakes: u32,
    due_reviews: u32,
    queued_reviews: u32,
}

impl From<AnalyticsBacklog> for AnalyticsBacklogDto {
    fn from(value: AnalyticsBacklog) -> Self {
        Self {
            overdue_tasks: value.overdue_tasks,
            active_mistakes: value.active_mistakes,
            due_reviews: value.due_reviews,
            queued_reviews: value.queued_reviews,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DailyAnalyticsPointDto {
    date: String,
    task_count: u32,
    completed_task_count: u32,
    planned_minutes: u32,
    actual_minutes: u32,
    attempt_count: u32,
    correct_attempt_count: u32,
    review_item_count: u32,
    completed_review_count: u32,
    ai_tokens: u64,
}

impl From<DailyAnalyticsPoint> for DailyAnalyticsPointDto {
    fn from(value: DailyAnalyticsPoint) -> Self {
        Self {
            date: value.date,
            task_count: value.task_count,
            completed_task_count: value.completed_task_count,
            planned_minutes: value.planned_minutes,
            actual_minutes: value.actual_minutes,
            attempt_count: value.attempt_count,
            correct_attempt_count: value.correct_attempt_count,
            review_item_count: value.review_item_count,
            completed_review_count: value.completed_review_count,
            ai_tokens: value.ai_tokens,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubjectAnalyticsDto {
    subject_id: Option<String>,
    subject_name: String,
    color_key: &'static str,
    task_count: u32,
    completed_task_count: u32,
    completion_rate_percent: Option<u32>,
    actual_minutes: u32,
}

impl From<SubjectAnalytics> for SubjectAnalyticsDto {
    fn from(value: SubjectAnalytics) -> Self {
        Self {
            subject_id: value.subject_id,
            subject_name: value.subject_name,
            color_key: value.color.as_str(),
            task_count: value.task_count,
            completed_task_count: value.completed_task_count,
            completion_rate_percent: value.completion_rate_percent,
            actual_minutes: value.actual_minutes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeAnalyticsDto {
    node_id: String,
    node_title: String,
    map_id: String,
    map_title: String,
    subject_name: Option<String>,
    question_count: u32,
    attempt_count: u32,
    correct_attempt_count: u32,
    accuracy_percent: Option<u32>,
    active_mistake_count: u32,
}

impl From<KnowledgeAnalytics> for KnowledgeAnalyticsDto {
    fn from(value: KnowledgeAnalytics) -> Self {
        Self {
            node_id: value.node_id,
            node_title: value.node_title,
            map_id: value.map_id,
            map_title: value.map_title,
            subject_name: value.subject_name,
            question_count: value.question_count,
            attempt_count: value.attempt_count,
            correct_attempt_count: value.correct_attempt_count,
            accuracy_percent: value.accuracy_percent,
            active_mistake_count: value.active_mistake_count,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepeatedMistakeAnalyticsDto {
    question_id: String,
    question_title: String,
    document_id: String,
    document_title: String,
    mistake_count: u32,
    consecutive_failure_count: u32,
    mastery: String,
    due_date: String,
    last_mistake_at: Option<i64>,
}

impl From<RepeatedMistakeAnalytics> for RepeatedMistakeAnalyticsDto {
    fn from(value: RepeatedMistakeAnalytics) -> Self {
        Self {
            question_id: value.question_id,
            question_title: value.question_title,
            document_id: value.document_id,
            document_title: value.document_title,
            mistake_count: value.mistake_count,
            consecutive_failure_count: value.consecutive_failure_count,
            mastery: value.mastery,
            due_date: value.due_date,
            last_mistake_at: value.last_mistake_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AnalyticsOverviewDto {
    range_start: String,
    range_end: String,
    previous_range_start: String,
    previous_range_end: String,
    current: AnalyticsPeriodSummaryDto,
    previous: AnalyticsPeriodSummaryDto,
    backlog: AnalyticsBacklogDto,
    daily: Vec<DailyAnalyticsPointDto>,
    subjects: Vec<SubjectAnalyticsDto>,
    knowledge: Vec<KnowledgeAnalyticsDto>,
    repeated_mistakes: Vec<RepeatedMistakeAnalyticsDto>,
}

impl From<AnalyticsOverview> for AnalyticsOverviewDto {
    fn from(value: AnalyticsOverview) -> Self {
        Self {
            range_start: value.range_start,
            range_end: value.range_end,
            previous_range_start: value.previous_range_start,
            previous_range_end: value.previous_range_end,
            current: value.current.into(),
            previous: value.previous.into(),
            backlog: value.backlog.into(),
            daily: value.daily.into_iter().map(Into::into).collect(),
            subjects: value.subjects.into_iter().map(Into::into).collect(),
            knowledge: value.knowledge.into_iter().map(Into::into).collect(),
            repeated_mistakes: value
                .repeated_mistakes
                .into_iter()
                .map(Into::into)
                .collect(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlanProgressRequestDto {
    plan_id: String,
    today: String,
}

impl From<PlanProgressRequestDto> for PlanProgressInput {
    fn from(value: PlanProgressRequestDto) -> Self {
        Self {
            plan_id: value.plan_id,
            today: value.today,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanProgressSummaryDto {
    generated_task_count: u32,
    effective_task_count: u32,
    completed_task_count: u32,
    remaining_task_count: u32,
    overdue_task_count: u32,
    canceled_task_count: u32,
    trashed_task_count: u32,
    planned_minutes: u32,
    actual_minutes: u32,
    completion_rate_percent: Option<u32>,
}

impl From<PlanProgressSummary> for PlanProgressSummaryDto {
    fn from(value: PlanProgressSummary) -> Self {
        Self {
            generated_task_count: value.counts.generated_task_count,
            effective_task_count: value.counts.effective_task_count,
            completed_task_count: value.counts.completed_task_count,
            remaining_task_count: value.counts.remaining_task_count,
            overdue_task_count: value.counts.overdue_task_count,
            canceled_task_count: value.counts.canceled_task_count,
            trashed_task_count: value.counts.trashed_task_count,
            planned_minutes: value.counts.planned_minutes,
            actual_minutes: value.counts.actual_minutes,
            completion_rate_percent: value.completion_rate_percent,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanStageProgressDto {
    stage_id: String,
    stage_title: String,
    start_date: String,
    end_date: String,
    summary: PlanProgressSummaryDto,
}

impl From<PlanStageProgress> for PlanStageProgressDto {
    fn from(value: PlanStageProgress) -> Self {
        Self {
            stage_id: value.stage_id,
            stage_title: value.stage_title,
            start_date: value.start_date.as_str().to_owned(),
            end_date: value.end_date.as_str().to_owned(),
            summary: value.summary.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanExecutionProgressDto {
    plan_id: String,
    plan_title: String,
    plan_status: String,
    summary: PlanProgressSummaryDto,
    stages: Vec<PlanStageProgressDto>,
}

impl From<PlanExecutionProgress> for PlanExecutionProgressDto {
    fn from(value: PlanExecutionProgress) -> Self {
        Self {
            plan_id: value.plan_id,
            plan_title: value.plan_title,
            plan_status: value.plan_status.as_str().to_owned(),
            summary: value.summary.into(),
            stages: value.stages.into_iter().map(Into::into).collect(),
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RenameSubjectRequestDto {
    subject_id: String,
    name: String,
}

impl From<RenameSubjectRequestDto> for RenameSubjectInput {
    fn from(request: RenameSubjectRequestDto) -> Self {
        Self {
            subject_id: request.subject_id,
            name: request.name,
        }
    }
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
    expected_revision: Option<u32>,
    title: String,
    target_exam: Option<String>,
    exam_date: Option<String>,
    overview: Option<String>,
}

impl From<SavePlanRequestDto> for SavePlanInput {
    fn from(request: SavePlanRequestDto) -> Self {
        Self {
            id: request.id,
            expected_revision: request.expected_revision,
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
    expected_plan_revision: u32,
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
            expected_plan_revision: request.expected_plan_revision,
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
    expected_plan_revision: u32,
    document_id: String,
    page_start: u32,
    page_end: u32,
    note: Option<String>,
}

impl From<AddPlanReferenceRequestDto> for AddPlanReferenceInput {
    fn from(request: AddPlanReferenceRequestDto) -> Self {
        Self {
            plan_id: request.plan_id,
            expected_plan_revision: request.expected_plan_revision,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlanTaskScheduleRequestDto {
    stage_id: String,
    subject_id: Option<String>,
    start_date: String,
    end_date: String,
    weekdays: Vec<u8>,
    title: String,
    description: Option<String>,
    estimated_minutes: Option<u32>,
    priority: String,
}

impl From<PlanTaskScheduleRequestDto> for PlanTaskScheduleInput {
    fn from(request: PlanTaskScheduleRequestDto) -> Self {
        Self {
            stage_id: request.stage_id,
            subject_id: request.subject_id,
            start_date: request.start_date,
            end_date: request.end_date,
            weekdays: request.weekdays,
            title: request.title,
            description: request.description,
            estimated_minutes: request.estimated_minutes,
            priority: request.priority,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanTaskPreviewItemDto {
    planned_date: String,
    already_exists: bool,
}

impl From<PlanTaskPreviewItem> for PlanTaskPreviewItemDto {
    fn from(item: PlanTaskPreviewItem) -> Self {
        Self {
            planned_date: item.planned_date.as_str().to_owned(),
            already_exists: item.already_exists,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanTaskPreviewDto {
    stage_id: String,
    plan_title: String,
    stage_title: String,
    items: Vec<PlanTaskPreviewItemDto>,
    create_count: u32,
    existing_count: u32,
}

impl From<PlanTaskPreview> for PlanTaskPreviewDto {
    fn from(preview: PlanTaskPreview) -> Self {
        Self {
            stage_id: preview.stage_id,
            plan_title: preview.plan_title,
            stage_title: preview.stage_title,
            items: preview.items.into_iter().map(Into::into).collect(),
            create_count: preview.create_count,
            existing_count: preview.existing_count,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanTaskCreationDto {
    created_tasks: Vec<TaskDto>,
    skipped_existing: u32,
}

impl From<PlanTaskCreation> for PlanTaskCreationDto {
    fn from(creation: PlanTaskCreation) -> Self {
        Self {
            created_tasks: creation.created_tasks.into_iter().map(Into::into).collect(),
            skipped_existing: creation.skipped_existing,
        }
    }
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
    subject_id: Option<String>,
    question_type: Option<String>,
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
            subject_id: request.subject_id,
            question_type: request.question_type,
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
    subject_id: Option<String>,
    question_type: Option<String>,
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
            subject_id: request.subject_id,
            question_type: request.question_type,
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
pub(crate) struct UpdateQuestionRegionRequestDto {
    region_id: String,
    region: QuestionRegionRequestDto,
}

impl From<UpdateQuestionRegionRequestDto> for UpdateQuestionRegionInput {
    fn from(request: UpdateQuestionRegionRequestDto) -> Self {
        Self {
            region_id: request.region_id,
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

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionDto {
    id: String,
    document_id: String,
    document_title: String,
    subject_id: Option<String>,
    subject_name: Option<String>,
    subject_inherited: bool,
    question_type: Option<&'static str>,
    classification_source: &'static str,
    classification_confidence: Option<f64>,
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
            subject_id: question.subject_id,
            subject_name: question.subject_name,
            subject_inherited: question.subject_inherited,
            question_type: question.question_type.map(QuestionType::as_str),
            classification_source: question.classification_source.as_str(),
            classification_confidence: question.classification_confidence,
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
pub(crate) struct SetWorkbookSubjectRequestDto {
    document_id: String,
    subject_id: Option<String>,
}

impl From<SetWorkbookSubjectRequestDto> for SetWorkbookSubjectInput {
    fn from(request: SetWorkbookSubjectRequestDto) -> Self {
        Self {
            document_id: request.document_id,
            subject_id: request.subject_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BatchClassifyQuestionsRequestDto {
    document_id: String,
    question_ids: Vec<String>,
    question_type: String,
}

impl From<BatchClassifyQuestionsRequestDto> for BatchClassifyQuestionsInput {
    fn from(request: BatchClassifyQuestionsRequestDto) -> Self {
        Self {
            document_id: request.document_id,
            question_ids: request.question_ids,
            question_type: request.question_type,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkbookProfileDto {
    document_id: String,
    default_subject_id: Option<String>,
    default_subject_name: Option<String>,
    pending_classification_count: u32,
    updated_at: Option<i64>,
}

impl From<WorkbookProfile> for WorkbookProfileDto {
    fn from(profile: WorkbookProfile) -> Self {
        Self {
            document_id: profile.document_id,
            default_subject_id: profile.default_subject_id,
            default_subject_name: profile.default_subject_name,
            pending_classification_count: profile.pending_classification_count,
            updated_at: profile.updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreateWorkbookCategoryRequestDto {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RenameWorkbookCategoryRequestDto {
    workbook_id: String,
    name: String,
}

impl From<RenameWorkbookCategoryRequestDto> for RenameWorkbookCategoryInput {
    fn from(value: RenameWorkbookCategoryRequestDto) -> Self {
        Self {
            workbook_id: value.workbook_id,
            name: value.name,
        }
    }
}

impl From<CreateWorkbookCategoryRequestDto> for CreateWorkbookCategoryInput {
    fn from(value: CreateWorkbookCategoryRequestDto) -> Self {
        Self { name: value.name }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct WorkbookSegmentAssignmentRequestDto {
    document_id: String,
    subject_id: String,
    workbook_id: String,
    source_heading: String,
    page_start: u32,
    page_end: u32,
}

impl From<WorkbookSegmentAssignmentRequestDto> for WorkbookSegmentAssignmentInput {
    fn from(value: WorkbookSegmentAssignmentRequestDto) -> Self {
        Self {
            document_id: value.document_id,
            subject_id: value.subject_id,
            workbook_id: value.workbook_id,
            source_heading: value.source_heading,
            page_start: value.page_start,
            page_end: value.page_end,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RestoreWorkbookSegmentRequestDto {
    segment_id: String,
    expected_deleted_at: i64,
}

impl From<RestoreWorkbookSegmentRequestDto> for RestoreWorkbookSegmentInput {
    fn from(value: RestoreWorkbookSegmentRequestDto) -> Self {
        Self {
            segment_id: value.segment_id,
            expected_deleted_at: value.expected_deleted_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeleteTrashedWorkbookSegmentRequestDto {
    segment_id: String,
    expected_deleted_at: i64,
}

impl From<DeleteTrashedWorkbookSegmentRequestDto> for DeleteTrashedWorkbookSegmentInput {
    fn from(value: DeleteTrashedWorkbookSegmentRequestDto) -> Self {
        Self {
            segment_id: value.segment_id,
            expected_deleted_at: value.expected_deleted_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReassignWorkbookSegmentRequestDto {
    segment_id: String,
    target_workbook_id: String,
    expected_updated_at: i64,
    expected_deleted_at: Option<i64>,
}

impl From<ReassignWorkbookSegmentRequestDto> for ReassignWorkbookSegmentInput {
    fn from(value: ReassignWorkbookSegmentRequestDto) -> Self {
        Self {
            segment_id: value.segment_id,
            target_workbook_id: value.target_workbook_id,
            expected_updated_at: value.expected_updated_at,
            expected_deleted_at: value.expected_deleted_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IndexedQuestionDraftRequestDto {
    source_key: String,
    title: String,
    chapter: String,
    section_part: String,
    question_type: String,
    question_number: String,
    index_confidence: f64,
    regions: Vec<QuestionRegionRequestDto>,
}

impl From<IndexedQuestionDraftRequestDto> for IndexedQuestionDraftInput {
    fn from(value: IndexedQuestionDraftRequestDto) -> Self {
        Self {
            source_key: value.source_key,
            title: value.title,
            chapter: value.chapter,
            section_part: value.section_part,
            question_type: value.question_type,
            question_number: value.question_number,
            index_confidence: value.index_confidence,
            regions: value.regions.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImportQuestionIndexRequestDto {
    segment_id: String,
    questions: Vec<IndexedQuestionDraftRequestDto>,
}

impl From<ImportQuestionIndexRequestDto> for ImportQuestionIndexInput {
    fn from(value: ImportQuestionIndexRequestDto) -> Self {
        Self {
            segment_id: value.segment_id,
            questions: value.questions.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct BulkQuestionAttemptRequestDto {
    question_id: String,
    result: String,
}

impl From<BulkQuestionAttemptRequestDto> for BulkQuestionAttemptInput {
    fn from(value: BulkQuestionAttemptRequestDto) -> Self {
        Self {
            question_id: value.question_id,
            result: value.result,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecordBulkQuestionAttemptsRequestDto {
    attempted_on: String,
    entries: Vec<BulkQuestionAttemptRequestDto>,
}

impl From<RecordBulkQuestionAttemptsRequestDto> for RecordBulkQuestionAttemptsInput {
    fn from(value: RecordBulkQuestionAttemptsRequestDto) -> Self {
        Self {
            attempted_on: value.attempted_on,
            entries: value.entries.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UpdateIndexedQuestionRequestDto {
    question_id: String,
    title: String,
    chapter: String,
    section_part: String,
    question_type: String,
    question_number: String,
}

impl From<UpdateIndexedQuestionRequestDto> for UpdateIndexedQuestionInput {
    fn from(value: UpdateIndexedQuestionRequestDto) -> Self {
        Self {
            question_id: value.question_id,
            title: value.title,
            chapter: value.chapter,
            section_part: value.section_part,
            question_type: value.question_type,
            question_number: value.question_number,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct IndexedQuestionRegionUpdateRequestDto {
    region_id: Option<String>,
    #[serde(flatten)]
    region: QuestionRegionRequestDto,
}

impl From<IndexedQuestionRegionUpdateRequestDto> for IndexedQuestionRegionUpdateInput {
    fn from(value: IndexedQuestionRegionUpdateRequestDto) -> Self {
        Self {
            region_id: value.region_id,
            region: value.region.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReplaceIndexedQuestionRegionsRequestDto {
    question_id: String,
    regions: Vec<IndexedQuestionRegionUpdateRequestDto>,
}

impl From<ReplaceIndexedQuestionRegionsRequestDto> for ReplaceIndexedQuestionRegionsInput {
    fn from(value: ReplaceIndexedQuestionRegionsRequestDto) -> Self {
        Self {
            question_id: value.question_id,
            regions: value.regions.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InsertIndexedQuestionRequestDto {
    anchor_question_id: String,
    placement: String,
    title: String,
    chapter: String,
    section_part: String,
    question_type: String,
    question_number: String,
    regions: Vec<QuestionRegionRequestDto>,
}

impl From<InsertIndexedQuestionRequestDto> for InsertIndexedQuestionInput {
    fn from(value: InsertIndexedQuestionRequestDto) -> Self {
        Self {
            anchor_question_id: value.anchor_question_id,
            placement: value.placement,
            title: value.title,
            chapter: value.chapter,
            section_part: value.section_part,
            question_type: value.question_type,
            question_number: value.question_number,
            regions: value.regions.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkbookCategoryDto {
    id: String,
    name: String,
    created_at: i64,
    updated_at: i64,
}

impl From<WorkbookCategory> for WorkbookCategoryDto {
    fn from(value: WorkbookCategory) -> Self {
        Self {
            id: value.id,
            name: value.name,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkbookDocumentSegmentDto {
    id: String,
    document_id: String,
    document_title: String,
    subject_id: String,
    subject_name: String,
    workbook_id: String,
    workbook_name: String,
    source_heading: String,
    page_start: u32,
    page_end: u32,
    index_state: String,
    question_count: u32,
    created_at: i64,
    updated_at: i64,
}

impl From<WorkbookDocumentSegment> for WorkbookDocumentSegmentDto {
    fn from(value: WorkbookDocumentSegment) -> Self {
        Self {
            id: value.id,
            document_id: value.document_id,
            document_title: value.document_title,
            subject_id: value.subject_id,
            subject_name: value.subject_name,
            workbook_id: value.workbook_id,
            workbook_name: value.workbook_name,
            source_heading: value.source_heading,
            page_start: value.page_start,
            page_end: value.page_end,
            index_state: value.index_state,
            question_count: value.question_count,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrashedWorkbookDocumentSegmentDto {
    id: String,
    document_id: String,
    document_title: String,
    subject_id: String,
    subject_name: String,
    workbook_id: String,
    workbook_name: String,
    source_heading: String,
    page_start: u32,
    page_end: u32,
    index_state: String,
    question_count: u32,
    created_at: i64,
    updated_at: i64,
    deleted_at: i64,
    restorable_question_count: u32,
}

impl From<TrashedWorkbookDocumentSegment> for TrashedWorkbookDocumentSegmentDto {
    fn from(value: TrashedWorkbookDocumentSegment) -> Self {
        Self {
            id: value.id,
            document_id: value.document_id,
            document_title: value.document_title,
            subject_id: value.subject_id,
            subject_name: value.subject_name,
            workbook_id: value.workbook_id,
            workbook_name: value.workbook_name,
            source_heading: value.source_heading,
            page_start: value.page_start,
            page_end: value.page_end,
            index_state: value.index_state,
            question_count: value.question_count,
            created_at: value.created_at,
            updated_at: value.updated_at,
            deleted_at: value.deleted_at,
            restorable_question_count: value.restorable_question_count,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexedQuestionDto {
    id: String,
    document_id: String,
    document_title: String,
    subject_id: String,
    subject_name: String,
    workbook_id: String,
    workbook_name: String,
    segment_id: String,
    chapter: String,
    section_part: String,
    question_type: &'static str,
    question_number: String,
    title: String,
    index_confidence: f64,
    sort_order: u32,
    current_result: Option<&'static str>,
    attempt_count: u32,
    incorrect_count: u32,
    partial_count: u32,
    regions: Vec<QuestionRegionDto>,
}

impl From<IndexedQuestion> for IndexedQuestionDto {
    fn from(value: IndexedQuestion) -> Self {
        Self {
            id: value.id,
            document_id: value.document_id,
            document_title: value.document_title,
            subject_id: value.subject_id,
            subject_name: value.subject_name,
            workbook_id: value.workbook_id,
            workbook_name: value.workbook_name,
            segment_id: value.segment_id,
            chapter: value.chapter,
            section_part: value.section_part,
            question_type: value.question_type.as_str(),
            question_number: value.question_number,
            title: value.title,
            index_confidence: value.index_confidence,
            sort_order: value.sort_order,
            current_result: value
                .current_result
                .map(crate::domain::AttemptResult::as_str),
            attempt_count: value.attempt_count,
            incorrect_count: value.incorrect_count,
            partial_count: value.partial_count,
            regions: value.regions.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionBankSnapshotDto {
    workbooks: Vec<WorkbookCategoryDto>,
    segments: Vec<WorkbookDocumentSegmentDto>,
    questions: Vec<IndexedQuestionDto>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionGapAcknowledgementsDto {
    issue_keys: Vec<String>,
}

impl From<Vec<String>> for QuestionGapAcknowledgementsDto {
    fn from(issue_keys: Vec<String>) -> Self {
        Self { issue_keys }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetQuestionGapAcknowledgementRequestDto {
    issue_key: String,
    acknowledged: bool,
}

impl From<SetQuestionGapAcknowledgementRequestDto> for SetQuestionGapAcknowledgementInput {
    fn from(request: SetQuestionGapAcknowledgementRequestDto) -> Self {
        Self {
            issue_key: request.issue_key,
            acknowledged: request.acknowledged,
        }
    }
}

impl From<QuestionBankSnapshot> for QuestionBankSnapshotDto {
    fn from(value: QuestionBankSnapshot) -> Self {
        Self {
            workbooks: value.workbooks.into_iter().map(Into::into).collect(),
            segments: value.segments.into_iter().map(Into::into).collect(),
            questions: value.questions.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecognizeQuestionRegionRequestDto {
    operation_id: String,
    region_id: String,
    image_bytes: Vec<u8>,
}

impl From<RecognizeQuestionRegionRequestDto> for RecognizeQuestionRegionInput {
    fn from(request: RecognizeQuestionRegionRequestDto) -> Self {
        Self {
            region_id: request.region_id,
            image_bytes: request.image_bytes,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RecognizePdfPageRequestDto {
    operation_id: String,
    page_number: u32,
    image_bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DownloadOcrComponentRequestDto {
    operation_id: String,
    #[serde(default)]
    version: Option<String>,
}

impl From<RecognizePdfPageRequestDto> for RecognizePdfPageInput {
    fn from(request: RecognizePdfPageRequestDto) -> Self {
        Self {
            page_number: request.page_number,
            image_bytes: request.image_bytes,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConfirmQuestionRegionOcrRequestDto {
    recognition_id: String,
    confirmed_text: String,
}

impl From<ConfirmQuestionRegionOcrRequestDto> for ConfirmQuestionRegionOcrInput {
    fn from(request: ConfirmQuestionRegionOcrRequestDto) -> Self {
        Self {
            recognition_id: request.recognition_id,
            confirmed_text: request.confirmed_text,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrComponentStatusDto {
    state: &'static str,
    engine: &'static str,
    models_bundled: bool,
    component_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrPackageOptionDto {
    version_id: &'static str,
    label: &'static str,
    description: &'static str,
    download_size_bytes: u64,
    installed_size_bytes: u64,
    is_recommended: bool,
}

impl From<crate::application::OcrPackageOption> for OcrPackageOptionDto {
    fn from(option: crate::application::OcrPackageOption) -> Self {
        Self {
            version_id: option.version_id,
            label: option.label,
            description: option.description,
            download_size_bytes: option.download_size_bytes,
            installed_size_bytes: option.installed_size_bytes,
            is_recommended: option.is_recommended,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrComponentDownloadInfoDto {
    available: bool,
    engine: &'static str,
    default_version: &'static str,
    versions: Vec<OcrPackageOptionDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OcrDownloadEventDto {
    operation_id: String,
    state: &'static str,
    copied_bytes: u64,
    total_bytes: u64,
    error: Option<AppErrorDto>,
}

impl From<OcrComponentStatus> for OcrComponentStatusDto {
    fn from(status: OcrComponentStatus) -> Self {
        Self {
            state: status.state.as_str(),
            engine: status.engine,
            models_bundled: status.models_bundled,
            component_size_bytes: status.component_size_bytes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrTextLineDto {
    id: String,
    recognition_id: String,
    text: String,
    confidence: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    sort_order: u32,
}

impl From<OcrTextLine> for OcrTextLineDto {
    fn from(line: OcrTextLine) -> Self {
        Self {
            id: line.id,
            recognition_id: line.recognition_id,
            text: line.text,
            confidence: line.confidence,
            x: line.x,
            y: line.y,
            width: line.width,
            height: line.height,
            sort_order: line.sort_order,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrRecognitionDto {
    id: String,
    question_id: String,
    region_id: String,
    page_number: u32,
    engine: String,
    recognized_text: String,
    confirmed_text: Option<String>,
    mean_confidence: f64,
    state: &'static str,
    lines: Vec<OcrTextLineDto>,
    created_at: i64,
    updated_at: i64,
}

impl From<OcrRecognition> for OcrRecognitionDto {
    fn from(recognition: OcrRecognition) -> Self {
        Self {
            id: recognition.id,
            question_id: recognition.question_id,
            region_id: recognition.region_id,
            page_number: recognition.page_number,
            engine: recognition.engine,
            recognized_text: recognition.recognized_text,
            confirmed_text: recognition.confirmed_text,
            mean_confidence: recognition.mean_confidence,
            state: recognition.state.as_str(),
            lines: recognition.lines.into_iter().map(Into::into).collect(),
            created_at: recognition.created_at,
            updated_at: recognition.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrPageLineDto {
    text: String,
    confidence: f64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    sort_order: u32,
}

impl From<OcrPageLine> for OcrPageLineDto {
    fn from(line: OcrPageLine) -> Self {
        Self {
            text: line.text,
            confidence: line.confidence,
            x: line.x,
            y: line.y,
            width: line.width,
            height: line.height,
            sort_order: line.sort_order,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OcrPageRecognitionDto {
    page_number: u32,
    engine: String,
    mean_confidence: f64,
    lines: Vec<OcrPageLineDto>,
}

impl From<OcrPageRecognition> for OcrPageRecognitionDto {
    fn from(recognition: OcrPageRecognition) -> Self {
        Self {
            page_number: recognition.page_number,
            engine: recognition.engine,
            mean_confidence: recognition.mean_confidence,
            lines: recognition.lines.into_iter().map(Into::into).collect(),
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReviewSchemeTypeQuotaRequestDto {
    question_type: String,
    quota: u32,
}

impl From<ReviewSchemeTypeQuotaRequestDto> for ReviewSchemeTypeQuotaInput {
    fn from(request: ReviewSchemeTypeQuotaRequestDto) -> Self {
        Self {
            question_type: request.question_type,
            quota: request.quota,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveReviewSchemeRequestDto {
    scheme_id: Option<String>,
    name: String,
    subject_id: String,
    all_subject_workbooks: bool,
    daily_quota: u32,
    enabled: bool,
    document_ids: Vec<String>,
    type_quotas: Vec<ReviewSchemeTypeQuotaRequestDto>,
    today: String,
}

impl From<SaveReviewSchemeRequestDto> for SaveReviewSchemeInput {
    fn from(request: SaveReviewSchemeRequestDto) -> Self {
        Self {
            scheme_id: request.scheme_id,
            name: request.name,
            subject_id: request.subject_id,
            all_subject_workbooks: request.all_subject_workbooks,
            daily_quota: request.daily_quota,
            enabled: request.enabled,
            document_ids: request.document_ids,
            type_quotas: request.type_quotas.into_iter().map(Into::into).collect(),
            today: request.today,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GenerateReviewSchemeQueueRequestDto {
    scheme_id: String,
    queue_date: String,
    temporary_document_id: Option<String>,
}

impl From<GenerateReviewSchemeQueueRequestDto> for GenerateReviewSchemeQueueInput {
    fn from(request: GenerateReviewSchemeQueueRequestDto) -> Self {
        Self {
            scheme_id: request.scheme_id,
            queue_date: request.queue_date,
            temporary_document_id: request.temporary_document_id,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SubmitReviewSchemeResultRequestDto {
    queue_id: String,
    question_id: String,
    rating: String,
    today: String,
}

impl From<SubmitReviewSchemeResultRequestDto> for SubmitReviewSchemeResultInput {
    fn from(request: SubmitReviewSchemeResultRequestDto) -> Self {
        Self {
            queue_id: request.queue_id,
            question_id: request.question_id,
            rating: request.rating,
            today: request.today,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UndoReviewSchemeResultRequestDto {
    queue_id: String,
    today: String,
}

impl From<UndoReviewSchemeResultRequestDto> for UndoReviewSchemeResultInput {
    fn from(request: UndoReviewSchemeResultRequestDto) -> Self {
        Self {
            queue_id: request.queue_id,
            today: request.today,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewSchemeTypeQuotaDto {
    question_type: &'static str,
    quota: u32,
}

impl From<ReviewSchemeTypeQuota> for ReviewSchemeTypeQuotaDto {
    fn from(value: ReviewSchemeTypeQuota) -> Self {
        Self {
            question_type: value.question_type.as_str(),
            quota: value.quota,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewSchemeDto {
    id: String,
    name: String,
    subject_id: String,
    subject_name: String,
    all_subject_workbooks: bool,
    daily_quota: u32,
    enabled: bool,
    document_ids: Vec<String>,
    type_quotas: Vec<ReviewSchemeTypeQuotaDto>,
    created_at: i64,
    updated_at: i64,
}

impl From<ReviewScheme> for ReviewSchemeDto {
    fn from(value: ReviewScheme) -> Self {
        Self {
            id: value.id,
            name: value.name,
            subject_id: value.subject_id,
            subject_name: value.subject_name,
            all_subject_workbooks: value.all_subject_workbooks,
            daily_quota: value.daily_quota,
            enabled: value.enabled,
            document_ids: value.document_ids,
            type_quotas: value.type_quotas.into_iter().map(Into::into).collect(),
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewSchemeQueueItemDto {
    question: QuestionBundleDto,
    position: u32,
    origin_date: String,
    carried: bool,
    state: &'static str,
    review_event: Option<ReviewEventDto>,
    inserted_at: i64,
    completed_at: Option<i64>,
}

impl From<ReviewSchemeQueueItem> for ReviewSchemeQueueItemDto {
    fn from(value: ReviewSchemeQueueItem) -> Self {
        Self {
            question: value.question.into(),
            position: value.position,
            origin_date: value.origin_date.as_str().to_owned(),
            carried: value.carried,
            state: value.state.as_str(),
            review_event: value.review_event.map(Into::into),
            inserted_at: value.inserted_at,
            completed_at: value.completed_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewSchemeQueueDto {
    id: String,
    scheme_id: String,
    queue_date: String,
    quota: u32,
    generated_at: i64,
    completed_count: u32,
    items: Vec<ReviewSchemeQueueItemDto>,
}

impl From<ReviewSchemeQueue> for ReviewSchemeQueueDto {
    fn from(value: ReviewSchemeQueue) -> Self {
        Self {
            id: value.id,
            scheme_id: value.scheme_id,
            queue_date: value.queue_date.as_str().to_owned(),
            quota: value.quota,
            generated_at: value.generated_at,
            completed_count: value.completed_count,
            items: value.items.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewSchemeTodayDto {
    scheme: ReviewSchemeDto,
    is_rest_day: bool,
    due_count: u32,
    pending_classification_count: u32,
    queue: Option<ReviewSchemeQueueDto>,
}

impl From<ReviewSchemeToday> for ReviewSchemeTodayDto {
    fn from(value: ReviewSchemeToday) -> Self {
        Self {
            scheme: value.scheme.into(),
            is_rest_day: value.is_rest_day,
            due_count: value.due_count,
            pending_classification_count: value.pending_classification_count,
            queue: value.queue.map(Into::into),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReviewSchemeDashboardDto {
    rest_weekdays: Vec<u8>,
    schemes: Vec<ReviewSchemeTodayDto>,
}

impl From<ReviewSchemeDashboard> for ReviewSchemeDashboardDto {
    fn from(value: ReviewSchemeDashboard) -> Self {
        Self {
            rest_weekdays: value.rest_weekdays,
            schemes: value.schemes.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveCyclePlanRequestDto {
    plan_id: Option<String>,
    expected_updated_at: Option<i64>,
    name: String,
    total_units: u32,
    unit_label: String,
    start_date: String,
    deadline: String,
    study_days_per_unit: u32,
    schedule_mode: String,
    calendar_visible: bool,
}

impl From<SaveCyclePlanRequestDto> for SaveCyclePlanInput {
    fn from(value: SaveCyclePlanRequestDto) -> Self {
        Self {
            plan_id: value.plan_id,
            expected_updated_at: value.expected_updated_at,
            name: value.name,
            total_units: value.total_units,
            unit_label: value.unit_label,
            start_date: value.start_date,
            deadline: value.deadline,
            study_days_per_unit: value.study_days_per_unit,
            schedule_mode: value.schedule_mode,
            calendar_visible: value.calendar_visible,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SetCyclePlanItemStateRequestDto {
    item_id: String,
    target_state: String,
    expected_updated_at: i64,
}

impl From<SetCyclePlanItemStateRequestDto> for SetCyclePlanItemStateInput {
    fn from(value: SetCyclePlanItemStateRequestDto) -> Self {
        Self {
            item_id: value.item_id,
            target_state: value.target_state,
            expected_updated_at: value.expected_updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RestoreCyclePlanItemStateRequestDto {
    item_id: String,
    state: String,
    completed_at: Option<i64>,
    skipped_at: Option<i64>,
    expected_updated_at: i64,
}

impl From<RestoreCyclePlanItemStateRequestDto> for RestoreCyclePlanItemStateInput {
    fn from(value: RestoreCyclePlanItemStateRequestDto) -> Self {
        Self {
            item_id: value.item_id,
            original_state: value.state,
            original_completed_at: value.completed_at,
            original_skipped_at: value.skipped_at,
            expected_updated_at: value.expected_updated_at,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ShiftCyclePlanRequestDto {
    plan_id: String,
    from_date: String,
    study_days: u32,
}

impl From<ShiftCyclePlanRequestDto> for ShiftCyclePlanInput {
    fn from(value: ShiftCyclePlanRequestDto) -> Self {
        Self {
            plan_id: value.plan_id,
            from_date: value.from_date,
            study_days: value.study_days,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConfirmShiftCyclePlanRequestDto {
    plan_id: String,
    from_date: String,
    study_days: u32,
    preview_token: String,
}

impl From<ConfirmShiftCyclePlanRequestDto> for ConfirmShiftCyclePlanInput {
    fn from(value: ConfirmShiftCyclePlanRequestDto) -> Self {
        Self {
            plan_id: value.plan_id,
            from_date: value.from_date,
            study_days: value.study_days,
            preview_token: value.preview_token,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct UndoShiftCyclePlanRequestDto {
    plan_id: String,
    undo_token: String,
}

impl From<UndoShiftCyclePlanRequestDto> for UndoShiftCyclePlanInput {
    fn from(value: UndoShiftCyclePlanRequestDto) -> Self {
        Self {
            plan_id: value.plan_id,
            undo_token: value.undo_token,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CyclePlanDto {
    id: String,
    name: String,
    total_units: u32,
    unit_label: String,
    start_date: String,
    deadline: String,
    study_days_per_unit: u32,
    schedule_mode: &'static str,
    calendar_visible: bool,
    created_at: i64,
    updated_at: i64,
}

impl From<CyclePlan> for CyclePlanDto {
    fn from(value: CyclePlan) -> Self {
        Self {
            id: value.id,
            name: value.name,
            total_units: value.total_units,
            unit_label: value.unit_label,
            start_date: value.start_date.as_str().to_owned(),
            deadline: value.deadline.as_str().to_owned(),
            study_days_per_unit: value.study_days_per_unit,
            schedule_mode: value.schedule_mode.as_str(),
            calendar_visible: value.calendar_visible,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CyclePlanItemDto {
    id: String,
    plan_id: String,
    unit_index: u32,
    planned_start_date: String,
    planned_end_date: String,
    original_start_date: String,
    original_end_date: String,
    state: &'static str,
    completed_at: Option<i64>,
    skipped_at: Option<i64>,
    shift_count: u32,
    updated_at: i64,
}

impl From<CyclePlanItem> for CyclePlanItemDto {
    fn from(value: CyclePlanItem) -> Self {
        Self {
            id: value.id,
            plan_id: value.plan_id,
            unit_index: value.unit_index,
            planned_start_date: value.planned_start_date.as_str().to_owned(),
            planned_end_date: value.planned_end_date.as_str().to_owned(),
            original_start_date: value.original_start_date.as_str().to_owned(),
            original_end_date: value.original_end_date.as_str().to_owned(),
            state: value.state.as_str(),
            completed_at: value.completed_at,
            skipped_at: value.skipped_at,
            shift_count: value.shift_count,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CyclePlanOverviewDto {
    plan: CyclePlanDto,
    items: Vec<CyclePlanItemDto>,
    completed_count: u32,
    skipped_count: u32,
    progress_percent: u32,
    estimated_end_date: String,
    exceeds_deadline: bool,
    recommended_study_days_per_unit: Option<u32>,
    recommended_total_units: Option<u32>,
}

impl From<CyclePlanOverview> for CyclePlanOverviewDto {
    fn from(value: CyclePlanOverview) -> Self {
        Self {
            plan: value.plan.into(),
            items: value.items.into_iter().map(Into::into).collect(),
            completed_count: value.completed_count,
            skipped_count: value.skipped_count,
            progress_percent: value.progress_percent,
            estimated_end_date: value.estimated_end_date.as_str().to_owned(),
            exceeds_deadline: value.exceeds_deadline,
            recommended_study_days_per_unit: value.recommended_study_days_per_unit,
            recommended_total_units: value.recommended_total_units,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CyclePlanDashboardDto {
    rest_weekdays: Vec<u8>,
    plans: Vec<CyclePlanOverviewDto>,
}

impl From<CyclePlanDashboard> for CyclePlanDashboardDto {
    fn from(value: CyclePlanDashboard) -> Self {
        Self {
            rest_weekdays: value.rest_weekdays,
            plans: value.plans.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShiftCyclePlanUndoDto {
    plan_id: String,
    undo_token: String,
    expires_at: i64,
}

impl From<ShiftCyclePlanUndo> for ShiftCyclePlanUndoDto {
    fn from(value: ShiftCyclePlanUndo) -> Self {
        Self {
            plan_id: value.plan_id,
            undo_token: value.undo_token,
            expires_at: value.expires_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShiftCyclePlanResultDto {
    dashboard: CyclePlanDashboardDto,
    shifted_item_count: u32,
    undo: Option<ShiftCyclePlanUndoDto>,
}

impl From<ShiftCyclePlanResult> for ShiftCyclePlanResultDto {
    fn from(value: ShiftCyclePlanResult) -> Self {
        Self {
            dashboard: value.dashboard.into(),
            shifted_item_count: value.shifted_item_count,
            undo: value.undo.map(Into::into),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShiftCyclePlanPreviewDto {
    plan_id: String,
    from_date: String,
    study_days: u32,
    affected_item_count: u32,
    current_estimated_end_date: String,
    new_estimated_end_date: String,
    deadline: String,
    exceeds_deadline_by_days: u32,
    rest_weekdays: Vec<u8>,
    preview_token: Option<String>,
}

impl From<ShiftCyclePlanPreview> for ShiftCyclePlanPreviewDto {
    fn from(value: ShiftCyclePlanPreview) -> Self {
        Self {
            plan_id: value.plan_id,
            from_date: value.from_date.as_str().to_owned(),
            study_days: value.study_days,
            affected_item_count: value.affected_item_count,
            current_estimated_end_date: value.current_estimated_end_date.as_str().to_owned(),
            new_estimated_end_date: value.new_estimated_end_date.as_str().to_owned(),
            deadline: value.deadline.as_str().to_owned(),
            exceeds_deadline_by_days: value.exceeds_deadline_by_days,
            rest_weekdays: value.rest_weekdays,
            preview_token: value.preview_token,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetCyclePlanItemStateResultDto {
    dashboard: CyclePlanDashboardDto,
    item_id: String,
    item_updated_at: i64,
}

impl From<SetCyclePlanItemStateResult> for SetCyclePlanItemStateResultDto {
    fn from(value: SetCyclePlanItemStateResult) -> Self {
        Self {
            dashboard: value.dashboard.into(),
            item_id: value.item_id,
            item_updated_at: value.item_updated_at,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveAiProviderRequestDto {
    provider_type: String,
    display_name: String,
    base_url: Option<String>,
    model_name: String,
    context_limit: u32,
    max_output_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[allow(
    clippy::struct_field_names,
    reason = "Fields mirror the public capability request contract"
)]
pub(crate) struct SaveAiProviderCapabilitiesRequestDto {
    supports_image: String,
    supports_file: String,
    supports_pdf: String,
}

impl TryFrom<SaveAiProviderCapabilitiesRequestDto> for SaveAiProviderCapabilitiesInput {
    type Error = AiError;

    fn try_from(request: SaveAiProviderCapabilitiesRequestDto) -> Result<Self, Self::Error> {
        let parse =
            |value: String| AiCapabilityState::parse(value.trim()).ok_or(AiError::InvalidInput);
        Ok(Self {
            capabilities: crate::domain::AiModelCapabilities {
                supports_image: parse(request.supports_image)?,
                supports_file: parse(request.supports_file)?,
                supports_pdf: parse(request.supports_pdf)?,
                capability_source: crate::domain::AiCapabilitySource::Manual,
            },
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavePaperPdfRequestDto {
    file_name: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavePaperPdfDto {
    file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ListAiModelsRequestDto {
    provider_id: Option<String>,
    provider_type: String,
    base_url: String,
    api_key: Option<String>,
}

impl From<ListAiModelsRequestDto> for ListAiModelsInput {
    fn from(request: ListAiModelsRequestDto) -> Self {
        Self {
            provider_id: request.provider_id,
            provider_type: request.provider_type,
            base_url: request.base_url,
            temporary_secret: request.api_key,
        }
    }
}

impl From<SaveAiProviderRequestDto> for SaveAiProviderInput {
    fn from(request: SaveAiProviderRequestDto) -> Self {
        Self {
            provider_type: request.provider_type,
            display_name: request.display_name,
            base_url: request.base_url,
            model_name: request.model_name,
            context_limit: request.context_limit,
            max_output_tokens: request.max_output_tokens,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveAiBudgetRequestDto {
    single_call_limit: u64,
    daily_token_limit: u64,
    monthly_token_limit: u64,
    limit_mode: String,
}

impl From<SaveAiBudgetRequestDto> for SaveAiBudgetInput {
    fn from(request: SaveAiBudgetRequestDto) -> Self {
        Self {
            single_call_limit: request.single_call_limit,
            daily_token_limit: request.daily_token_limit,
            monthly_token_limit: request.monthly_token_limit,
            limit_mode: request.limit_mode,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AiPreviewRequestDto {
    prompt: String,
    max_output_tokens: u32,
}

impl From<AiPreviewRequestDto> for AiPreviewInput {
    fn from(request: AiPreviewRequestDto) -> Self {
        Self {
            prompt: request.prompt,
            max_output_tokens: request.max_output_tokens,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AiImagePreviewRequestDto {
    prompt: String,
    image_data_urls: Vec<String>,
    max_output_tokens: u32,
}

impl From<AiImagePreviewRequestDto> for AiImagePreviewInput {
    fn from(request: AiImagePreviewRequestDto) -> Self {
        Self {
            prompt: request.prompt,
            image_data_urls: request.image_data_urls,
            max_output_tokens: request.max_output_tokens,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuestionAiAnalysisLookupRequestDto {
    question_id: String,
    source_fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuestionAiAnalysisHistoryLookupRequestDto {
    question_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct QuestionAiAnalysisRequestDto {
    question_id: String,
    source_fingerprint: String,
    prompt: String,
    image_data_urls: Vec<String>,
    max_output_tokens: u32,
    force_refresh: bool,
}

impl From<QuestionAiAnalysisRequestDto> for crate::application::QuestionAiAnalysisInput {
    fn from(request: QuestionAiAnalysisRequestDto) -> Self {
        Self {
            question_id: request.question_id,
            source_fingerprint: request.source_fingerprint,
            prompt: request.prompt,
            image_data_urls: request.image_data_urls,
            max_output_tokens: request.max_output_tokens,
            force_refresh: request.force_refresh,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SaveAiSecretRequestDto {
    provider_id: String,
    secret: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiProviderDto {
    id: String,
    provider_type: &'static str,
    display_name: String,
    base_url: Option<String>,
    model_name: String,
    context_limit: u32,
    max_output_tokens: u32,
    capabilities: AiModelCapabilitiesDto,
    has_secret: bool,
    active: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
enum AiCapabilityValueDto {
    Boolean(bool),
    Unknown(&'static str),
}

impl From<AiCapabilityState> for AiCapabilityValueDto {
    fn from(value: AiCapabilityState) -> Self {
        match value {
            AiCapabilityState::Supported => Self::Boolean(true),
            AiCapabilityState::Unsupported => Self::Boolean(false),
            AiCapabilityState::Unknown => Self::Unknown("unknown"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiModelCapabilitiesDto {
    supports_image: AiCapabilityValueDto,
    supports_file: AiCapabilityValueDto,
    supports_pdf: AiCapabilityValueDto,
    capability_source: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiModelOptionDto {
    id: String,
    owned_by: Option<String>,
    created_at: Option<i64>,
}

impl From<AiModelOption> for AiModelOptionDto {
    fn from(model: AiModelOption) -> Self {
        Self {
            id: model.id,
            owned_by: model.owned_by,
            created_at: model.created_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiBudgetDto {
    single_call_limit: u64,
    daily_token_limit: u64,
    monthly_token_limit: u64,
    limit_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiUsageDto {
    today_tokens: u64,
    month_tokens: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiCallSummaryDto {
    id: String,
    provider_name: String,
    model_name: String,
    state: String,
    cache_hit: bool,
    input_tokens: u64,
    output_tokens: u64,
    error_code: Option<String>,
    started_at: i64,
    finished_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiOverviewDto {
    providers: Vec<AiProviderDto>,
    active_provider_id: String,
    budget: AiBudgetDto,
    usage: AiUsageDto,
    calls: Vec<AiCallSummaryDto>,
}

impl From<AiOverview> for AiOverviewDto {
    fn from(overview: AiOverview) -> Self {
        Self {
            providers: overview
                .providers
                .into_iter()
                .map(|entry| AiProviderDto {
                    id: entry.provider.id,
                    provider_type: entry.provider.provider_type.as_str(),
                    display_name: entry.provider.display_name,
                    base_url: entry.provider.base_url,
                    model_name: entry.model.model_name,
                    context_limit: entry.model.context_limit,
                    max_output_tokens: entry.model.max_output_tokens,
                    capabilities: AiModelCapabilitiesDto {
                        supports_image: entry.model.capabilities.supports_image.into(),
                        supports_file: entry.model.capabilities.supports_file.into(),
                        supports_pdf: entry.model.capabilities.supports_pdf.into(),
                        capability_source: entry.model.capabilities.capability_source.as_str(),
                    },
                    has_secret: entry.has_secret,
                    active: entry.provider.enabled,
                })
                .collect(),
            active_provider_id: overview.active_provider_id,
            budget: AiBudgetDto {
                single_call_limit: overview.budget.single_call_limit,
                daily_token_limit: overview.budget.daily_token_limit,
                monthly_token_limit: overview.budget.monthly_token_limit,
                limit_mode: overview.budget.limit_mode,
            },
            usage: AiUsageDto {
                today_tokens: overview.usage.today_tokens,
                month_tokens: overview.usage.month_tokens,
            },
            calls: overview
                .calls
                .into_iter()
                .map(|call| AiCallSummaryDto {
                    id: call.id,
                    provider_name: call.provider_name,
                    model_name: call.model_name,
                    state: call.state,
                    cache_hit: call.cache_hit,
                    input_tokens: call.input_tokens,
                    output_tokens: call.output_tokens,
                    error_code: call.error_code,
                    started_at: call.started_at,
                    finished_at: call.finished_at,
                })
                .collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiCallPreviewDto {
    provider_name: String,
    provider_type: &'static str,
    model_name: String,
    destination: String,
    prompt: String,
    input_token_estimate: u64,
    output_token_limit: u32,
    projected_tokens: u64,
    today_tokens: u64,
    month_tokens: u64,
    allowed: bool,
    warnings: Vec<String>,
    request_fingerprint: String,
}

impl From<AiCallPreview> for AiCallPreviewDto {
    fn from(preview: AiCallPreview) -> Self {
        Self {
            provider_name: preview.provider_name,
            provider_type: preview.provider_type.as_str(),
            model_name: preview.model_name,
            destination: preview.destination,
            prompt: preview.prompt,
            input_token_estimate: preview.input_token_estimate,
            output_token_limit: preview.output_token_limit,
            projected_tokens: preview.projected_tokens,
            today_tokens: preview.today_tokens,
            month_tokens: preview.month_tokens,
            allowed: preview.allowed,
            warnings: preview.warnings,
            request_fingerprint: preview.request_fingerprint,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiCallResultDto {
    call_id: String,
    response_text: String,
    input_tokens: u64,
    output_tokens: u64,
    cached_input_tokens: u64,
    reasoning_tokens: u64,
    usage_source: String,
    cache_hit: bool,
    finished_at: i64,
}

impl From<AiCallResult> for AiCallResultDto {
    fn from(result: AiCallResult) -> Self {
        Self {
            call_id: result.call_id,
            response_text: result.response_text,
            input_tokens: result.input_tokens,
            output_tokens: result.output_tokens,
            cached_input_tokens: result.cached_input_tokens,
            reasoning_tokens: result.reasoning_tokens,
            usage_source: result.usage_source,
            cache_hit: result.cache_hit,
            finished_at: result.finished_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuestionAiAnalysisHistoryEntryDto {
    source_fingerprint: String,
    result: AiCallResultDto,
}

impl From<QuestionAiAnalysisHistoryEntry> for QuestionAiAnalysisHistoryEntryDto {
    fn from(entry: QuestionAiAnalysisHistoryEntry) -> Self {
        Self {
            source_fingerprint: entry.source_fingerprint,
            result: entry.result.into(),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CreatePlanningConversationRequestDto {
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RenamePlanningConversationRequestDto {
    conversation_id: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlanningConversationIdRequestDto {
    conversation_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlanningContextSelectionDto {
    document_id: String,
    page_number: u32,
    search_query: String,
}

impl From<PlanningContextSelectionDto> for PlanningContextSelection {
    fn from(value: PlanningContextSelectionDto) -> Self {
        Self {
            document_id: value.document_id,
            page_number: value.page_number,
            search_query: value.search_query,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlanningChatRequestDto {
    conversation_id: String,
    question: String,
    contexts: Vec<PlanningContextSelectionDto>,
    question_context: Option<PlanningQuestionContextDto>,
    #[serde(default)]
    attachment_ids: Vec<String>,
    #[serde(default)]
    image_data_urls: Vec<String>,
    max_output_tokens: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AttachAiResourceRequestDto {
    conversation_id: String,
    document_id: String,
}

impl From<PlanningChatRequestDto> for PlanningChatInput {
    fn from(value: PlanningChatRequestDto) -> Self {
        Self {
            conversation_id: value.conversation_id,
            question: value.question,
            contexts: value.contexts.into_iter().map(Into::into).collect(),
            question_context: value.question_context.map(Into::into),
            attachment_ids: value.attachment_ids,
            image_data_urls: value.image_data_urls,
            max_output_tokens: value.max_output_tokens,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ConfirmPlanningChatRequestDto {
    conversation_id: String,
    question: String,
    contexts: Vec<PlanningContextSelectionDto>,
    question_context: Option<PlanningQuestionContextDto>,
    #[serde(default)]
    attachment_ids: Vec<String>,
    #[serde(default)]
    image_data_urls: Vec<String>,
    max_output_tokens: u32,
    confirmed_prompt: String,
    confirmed_request_fingerprint: String,
}

impl From<ConfirmPlanningChatRequestDto> for ConfirmPlanningChatInput {
    fn from(value: ConfirmPlanningChatRequestDto) -> Self {
        Self {
            chat: PlanningChatInput {
                conversation_id: value.conversation_id,
                question: value.question,
                contexts: value.contexts.into_iter().map(Into::into).collect(),
                question_context: value.question_context.map(Into::into),
                attachment_ids: value.attachment_ids,
                image_data_urls: value.image_data_urls,
                max_output_tokens: value.max_output_tokens,
            },
            confirmed_prompt: value.confirmed_prompt,
            confirmed_request_fingerprint: value.confirmed_request_fingerprint,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PlanningQuestionContextDto {
    title: String,
    document_title: String,
    analysis: Option<String>,
    image_data_urls: Vec<String>,
}

impl From<PlanningQuestionContextDto> for PlanningQuestionContext {
    fn from(value: PlanningQuestionContextDto) -> Self {
        Self {
            title: value.title,
            document_title: value.document_title,
            analysis: value.analysis,
            image_data_urls: value.image_data_urls,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavePlanningReplyRequestDto {
    message_id: String,
    title: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedPlanningDraftDto {
    plan_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiChatStreamChunkDto {
    pub(crate) delta: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanningSourceDto {
    document_id: String,
    document_title: String,
    page_number: u32,
    citation_label: String,
}

impl From<PlanningSource> for PlanningSourceDto {
    fn from(value: PlanningSource) -> Self {
        Self {
            document_id: value.document_id,
            document_title: value.document_title,
            page_number: value.page_number,
            citation_label: value.citation_label,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanningMessageDto {
    id: String,
    role: String,
    content: String,
    sources: Vec<PlanningSourceDto>,
    created_at: i64,
}

impl From<PlanningMessage> for PlanningMessageDto {
    fn from(value: PlanningMessage) -> Self {
        Self {
            id: value.id,
            role: value.role,
            content: value.content,
            sources: value.sources.into_iter().map(Into::into).collect(),
            created_at: value.created_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanningConversationDto {
    id: String,
    title: String,
    kind: &'static str,
    model_profile_id: Option<String>,
    messages: Vec<PlanningMessageDto>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiAttachmentRefDto {
    id: String,
    conversation_id: String,
    source: String,
    document_id: Option<String>,
    file_name: String,
    mime_type: String,
    size_bytes: u64,
    sha256: Option<String>,
    status: String,
    error_code: Option<String>,
    created_at: i64,
    updated_at: i64,
}

impl From<AiAttachmentRef> for AiAttachmentRefDto {
    fn from(value: AiAttachmentRef) -> Self {
        Self {
            id: value.id,
            conversation_id: value.conversation_id,
            source: value.source,
            document_id: value.document_id,
            file_name: value.file_name,
            mime_type: value.mime_type,
            size_bytes: value.size_bytes,
            sha256: value.sha256,
            status: value.status,
            error_code: value.error_code,
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

impl From<PlanningConversation> for PlanningConversationDto {
    fn from(value: PlanningConversation) -> Self {
        Self {
            id: value.id,
            title: value.title,
            kind: value.kind.as_str(),
            model_profile_id: value.model_profile_id,
            messages: value.messages.into_iter().map(Into::into).collect(),
            created_at: value.created_at,
            updated_at: value.updated_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanningChatPreviewDto {
    preview: AiCallPreviewDto,
    sources: Vec<PlanningSourceDto>,
    transport: String,
    attachments: Vec<PlanningAttachmentPreviewDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanningAttachmentPreviewDto {
    id: String,
    file_name: String,
    transport: String,
    indexed_pages: Option<u32>,
    warning: Option<String>,
}

impl From<PlanningAttachmentPreview> for PlanningAttachmentPreviewDto {
    fn from(value: PlanningAttachmentPreview) -> Self {
        Self {
            id: value.id,
            file_name: value.file_name,
            transport: value.transport,
            indexed_pages: value.indexed_pages,
            warning: value.warning,
        }
    }
}

impl From<PlanningChatPreview> for PlanningChatPreviewDto {
    fn from(value: PlanningChatPreview) -> Self {
        Self {
            preview: value.preview.into(),
            sources: value.sources.into_iter().map(Into::into).collect(),
            transport: value.transport,
            attachments: value.attachments.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlanningChatReplyDto {
    result: AiCallResultDto,
    conversation: PlanningConversationDto,
}

impl From<PlanningChatReply> for PlanningChatReplyDto {
    fn from(value: PlanningChatReply) -> Self {
        Self {
            result: value.result.into(),
            conversation: value.conversation.into(),
        }
    }
}

const IMPORT_EVENT_NAME: &str = "kystudy-import-progress";
const OCR_DOWNLOAD_EVENT_NAME: &str = "kystudy-ocr-download-progress";

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
    fn ai_chat_operation_conflict() -> Self {
        Self {
            code: "AI_CHAT_OPERATION_CONFLICT",
            message: "当前已有一条 AI 对话正在执行。",
            action: "先取消当前操作或等待完成后再试。",
            operation_id: Uuid::new_v4().to_string(),
        }
    }

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

    fn paper_export_invalid() -> Self {
        Self {
            code: "PAPER_EXPORT_INVALID",
            message: "试卷 PDF 内容或文件名无效。",
            action: "重新生成试卷后重试。",
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn paper_export_write_failed() -> Self {
        Self {
            code: "PAPER_EXPORT_WRITE_FAILED",
            message: "无法写入试卷 PDF。",
            action: "检查保存位置、磁盘空间和文件占用后重试。",
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_analytics(error: &AnalyticsError) -> Self {
        let (message, action) = match error {
            AnalyticsError::WorkspaceNotInitialized => (
                "尚未创建本地工作区。",
                "先创建工作区并记录学习数据，再查看分析。",
            ),
            AnalyticsError::InvalidInput => (
                "分析日期或统计周期无效。",
                "选择 7 天、28 天或 90 天后重试。",
            ),
            AnalyticsError::InvalidStoredData => (
                "部分学习统计数据超出安全范围。",
                "保留工作区并创建备份，不要手动修改数据库。",
            ),
            AnalyticsError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_plan_progress(error: &PlanProgressError) -> Self {
        let (message, action) = match error {
            PlanProgressError::WorkspaceNotInitialized => (
                "尚未创建本地工作区。",
                "先创建工作区并确认计划任务，再查看执行进度。",
            ),
            PlanProgressError::InvalidInput => ("计划进度请求无效。", "刷新个人计划后重新选择。"),
            PlanProgressError::PlanNotFound => ("找不到这份个人计划。", "刷新计划列表后重新选择。"),
            PlanProgressError::InvalidStoredData => (
                "部分计划进度数据不完整。",
                "先创建完整备份，不要手动修改数据库。",
            ),
            PlanProgressError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
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
                "请把源文件精简到 100 MiB 以内，或拆分为多张导图后重试。",
            ),
            ImportError::AttachmentTooLarge => (
                "临时资料超过 100 MiB 限制。",
                "选择更小的资料，或先导入资料库并建立本地索引。",
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

    fn from_ai(error: &AiError) -> Self {
        let (message, action) = match error {
            AiError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建工作区，再配置 AI。")
            }
            AiError::ConfigurationNotFound => {
                ("AI 配置尚未初始化。", "重新打开 AI 基础设施面板后重试。")
            }
            AiError::InvalidInput => (
                "AI 配置、上下文或 Token 上限无效。",
                "检查模型名称、地址、文字长度和 Token 数值后重试。",
            ),
            AiError::ProviderLimitReached => (
                "AI Provider 已达到 20 个本地配置上限。",
                "删除不再使用的 Provider 后重试。",
            ),
            AiError::BudgetBlocked => (
                "本次调用已被 Token 硬预算阻止。",
                "减少上下文或输出上限，或明确调整预算后重新预览。",
            ),
            AiError::SecretMissing => (
                "当前 Provider 尚未保存 API Key。",
                "把密钥保存到系统凭据存储后重新预览。",
            ),
            AiError::SecretStoreUnavailable => (
                "系统安全凭据存储暂时不可用。",
                "确认当前 Windows 用户可使用凭据管理器后重试。",
            ),
            AiError::ProviderAuthentication => (
                "AI Provider 拒绝了身份验证。",
                "检查 API Key 是否有效；密钥内容不会写入日志。",
            ),
            AiError::ProviderRateLimited => (
                "AI Provider 当前限制了请求频率或额度。",
                "稍后重试，并检查 Provider 侧额度。",
            ),
            AiError::ProviderUnavailable => (
                "暂时无法连接 AI Provider。",
                "检查网络和 Provider 地址后重试，离线功能不受影响。",
            ),
            AiError::ProviderInvalidResponse => (
                "AI Provider 返回了无法识别的结果。",
                "确认该地址兼容所选 Provider 协议后重试。",
            ),
            AiError::ProviderRejected => (
                "AI Provider 拒绝了本次请求。",
                "检查模型名称和 Provider 账户权限后重试。",
            ),
            AiError::Canceled => (
                "本次 AI 对话已取消，回复未写入本地对话。",
                "可以重新生成预览后再发送。",
            ),
            AiError::ModelListUnsupported => (
                "该 Provider 不提供兼容的模型列表接口。",
                "继续手动填写模型 ID，并通过连接测试验证。",
            ),
            AiError::ModelListEmpty => (
                "Provider 未返回可用模型。",
                "确认 API Key 的权限和账户中已启用的模型，或手动填写模型 ID。",
            ),
            AiError::ModelListInvalid => (
                "Provider 返回的模型列表格式无法识别。",
                "确认基础地址指向 API 根路径，或手动填写模型 ID。",
            ),
            AiError::ModelListTooLarge => (
                "Provider 返回的模型列表过大。",
                "缩小账户模型范围后重试，或手动填写模型 ID。",
            ),
            AiError::AttachmentIntegrityFailed => (
                "原生附件完整性校验未通过。",
                "重新选择电脑资料；文件不会在校验失败时发送给 Provider。",
            ),
            AiError::NativeAttachmentTooLarge => (
                "原生附件超过当前 Provider 的安全上传上限。",
                "选择不超过 24 MiB 的电脑资料，或先导入资料库建立本地索引。",
            ),
            AiError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_planning_chat(error: &PlanningChatError) -> Self {
        let (message, action) = match error {
            PlanningChatError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建工作区，再开始 AI 规划对话。")
            }
            PlanningChatError::InvalidInput => (
                "规划对话、资料范围或输出上限无效。",
                "检查问题长度、资料数量和 Token 上限后重新预览。",
            ),
            PlanningChatError::ConversationNotFound => {
                ("找不到这段规划对话。", "刷新对话列表或新建一段对话后重试。")
            }
            PlanningChatError::ContextNotFound => (
                "选中的资料页没有可用文字片段。",
                "重新建立该 PDF 的文字索引，或改选其他搜索结果。",
            ),
            PlanningChatError::PreviewStale => (
                "资料或对话已变化，本次确认已失效。",
                "重新生成外发预览并核对完整文本后再确认。",
            ),
            PlanningChatError::ReplyNotFound => (
                "找不到可保存的 AI 回复。",
                "刷新对话后选择一条完整的助手回复。",
            ),
            PlanningChatError::AttachmentNotFound => {
                ("找不到这条对话附件。", "刷新当前对话后重新选择资料。")
            }
            PlanningChatError::AttachmentLimitReached => (
                "当前对话最多保留 6 个附件。",
                "移除不再需要的资料后再添加。",
            ),
            PlanningChatError::AttachmentResourceNotFound => (
                "这份资料已不存在或尚未完成导入。",
                "刷新资料库后选择一份状态正常的资料。",
            ),
            PlanningChatError::AttachmentInvalid => (
                "这份资料的附件元数据不符合安全限制。",
                "选择 100 MiB 以内且文件信息完整的资料。",
            ),
            PlanningChatError::AttachmentTemporaryFailed => (
                "临时资料未能安全保存。",
                "检查磁盘空间和资料权限后重新选择。",
            ),
            PlanningChatError::AttachmentTemporaryNotFound => {
                ("电脑资料已丢失或发生变化。", "重新选择电脑资料后再发送。")
            }
            PlanningChatError::AttachmentNotIndexed => (
                "本地资料尚未建立可用的文本索引。",
                "等待资料索引完成或重新导入后再发送。",
            ),
            PlanningChatError::Canceled => (
                "本次 AI 对话已取消，回复未写入本地对话。",
                "可以重新生成预览后再发送。",
            ),
            PlanningChatError::Ai(error) => return Self::from_ai(error),
            PlanningChatError::Persistence(error) => return Self::from_persistence(error),
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
                "当前支持 PDF 文字层；扫描页请安装并启用本地 OCR 组件后重试。",
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
            PlanningError::PlanSaveStale => (
                "个人计划已在其他窗口发生变化。",
                "刷新计划后重新核对考试信息再保存。",
            ),
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

    fn from_plan_schedule(error: &PlanScheduleError) -> Self {
        let (message, action) = match error {
            PlanScheduleError::InvalidInput | PlanScheduleError::Validation(_) => (
                "阶段展开设置不完整或超出阶段日期。",
                "检查日期范围、星期、标题、时长和优先级后重新预览。",
            ),
            PlanScheduleError::StageNotFound => {
                ("找不到这个计划阶段。", "刷新个人计划后重新选择阶段。")
            }
            PlanScheduleError::PlanNotActive => (
                "只有当前计划可以展开到日程。",
                "先把这份计划确认为当前计划，再重新预览。",
            ),
            PlanScheduleError::TooManyTasks => (
                "本次将创建的任务数量过多。",
                "缩短日期范围或减少每周执行天数后重新预览。",
            ),
            PlanScheduleError::InvalidStoredData => (
                "计划与日程的关联数据不完整。",
                "先创建完整备份，不要手动修改数据库。",
            ),
            PlanScheduleError::Schedule(error) => return Self::from_schedule(error),
            PlanScheduleError::Persistence(error) => return Self::from_persistence(error),
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
                "请确认文件是 XMind、OPML 或 FreeMind .mm，并重新生成草案。",
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
            QuestionError::SubjectNotFound => (
                "所选科目不存在或已经归档。",
                "刷新科目列表，或让题目继续继承习题册科目。",
            ),
            QuestionError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_question_bank(error: &QuestionBankError) -> Self {
        let (message, action) = match error {
            QuestionBankError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建本地工作区，再建立题库索引。")
            }
            QuestionBankError::InvalidInput => (
                "题库索引或做题记录格式无效。",
                "检查页面范围、题号和分类后重新提交。",
            ),
            QuestionBankError::WorkbookAlreadyExists => (
                "已经有同名练习册。",
                "直接选择已有练习册，或换一个能够区分版本的名称。",
            ),
            QuestionBankError::WorkbookNotFound => {
                ("找不到所选练习册分类。", "刷新题库，或重新创建练习册分类。")
            }
            QuestionBankError::DocumentNotFound => (
                "找不到要解析的 PDF。",
                "确认资料仍在资料库中，然后重新选择。",
            ),
            QuestionBankError::SubjectNotFound => {
                ("找不到所选科目。", "刷新科目列表，或先新建科目分类。")
            }
            QuestionBankError::SegmentNotFound => (
                "找不到这段 PDF 科目内容。",
                "重新分析 PDF 并确认科目和练习册归类。",
            ),
            QuestionBankError::SegmentNotActive => (
                "这段 PDF 科目内容已经移入回收站。",
                "重新保存同一分段以恢复可见索引，或刷新题库后重试。",
            ),
            QuestionBankError::SegmentNotTrashed => (
                "该 PDF 科目分段当前不在回收站",
                "刷新题库后确认分段状态，再重试恢复。",
            ),
            QuestionBankError::SegmentRestoreStale => (
                "该 PDF 科目分段的回收站状态已变化",
                "刷新回收站列表后重新选择该分段，避免覆盖新的删除状态。",
            ),
            QuestionBankError::SegmentReassignStale => (
                "PDF segment assignment changed",
                "Refresh the question bank and retry the reassignment.",
            ),
            QuestionBankError::SegmentAssignmentConflict { .. } => (
                "这段 PDF 科目内容已经归属于另一个练习册。",
                "保留已有归类，或先更正已有分段后再重试。",
            ),
            QuestionBankError::QuestionNotFound => {
                ("找不到要登记的索引题目。", "刷新题库后重新选择题号。")
            }
            QuestionBankError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_ocr(error: &OcrError) -> Self {
        let (message, action) = match error {
            OcrError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建工作区，再使用本地 OCR。")
            }
            OcrError::QuestionNotFound | OcrError::RegionNotFound => (
                "找不到可识别的题目区域。",
                "刷新习题册，并确认题目和来源区域仍然存在。",
            ),
            OcrError::RecognitionNotFound => (
                "找不到这份 OCR 草稿。",
                "刷新 OCR 结果，或重新识别当前区域。",
            ),
            OcrError::RecognitionNotDraft => (
                "这份 OCR 结果已经确认或失效。",
                "刷新 OCR 结果后再处理当前草稿。",
            ),
            OcrError::InvalidInput => (
                "OCR 图片或确认文本不符合安全范围。",
                "重新打开 PDF 区域并识别，确认文本需保留有效内容。",
            ),
            OcrError::ComponentMissing => (
                "本地 OCR 组件尚未安装。",
                "安装可选 OCR 组件后重新检测；PDF 阅读和手动框选仍可使用。",
            ),
            OcrError::ComponentIncomplete => (
                "本地 OCR 组件文件不完整。",
                "重新安装 OCR 组件，不要手动拼接模型目录。",
            ),
            OcrError::ComponentIncompatible => (
                "本地 OCR 组件版本不兼容。",
                "安装与当前 KyStudy 匹配的 OCR 组件后重试。",
            ),
            OcrError::ComponentSourceInvalid => (
                "所选文件夹不是完整的 KyStudy OCR 组件。",
                "选择包含完整模型文件的 kystudy-ocr-worker 文件夹。",
            ),
            OcrError::ComponentInstallFailed => (
                "OCR 组件安装或修复未完成。",
                "检查目标磁盘空间和权限后，重新选择完整组件文件夹。",
            ),
            OcrError::ComponentRemovalFailed => {
                ("OCR 组件移除未完成。", "关闭正在运行的 OCR 操作后重试。")
            }
            OcrError::Canceled => ("OCR 已取消。", "原题目区域保持不变，可以稍后重新识别。"),
            OcrError::ComponentDownloadUnavailable => (
                "OCR online download unavailable.",
                "Use local installation or retry later.",
            ),
            OcrError::ComponentDownloadFailed => (
                "OCR component download failed.",
                "Check the network connection and retry; the existing component was kept.",
            ),
            OcrError::ComponentDownloadIntegrity => (
                "OCR component integrity verification failed.",
                "Retry the download or use a complete local component folder.",
            ),
            OcrError::ComponentArchiveInvalid => (
                "The downloaded OCR component archive is invalid.",
                "Retry the download or use a complete local component folder.",
            ),
            OcrError::Timeout => (
                "本地 OCR 处理超时。",
                "缩小框选区域后重试；原 PDF 和已确认文本不受影响。",
            ),
            OcrError::WorkerFailed | OcrError::ResultInvalid => (
                "本地 OCR 未能返回可用结果。",
                "重新检测组件或缩小区域后重试，并保留原图人工录入。",
            ),
            OcrError::OperationConflict => (
                "已有 OCR 操作仍在运行。",
                "等待当前操作结束，或先取消后再试。",
            ),
            OcrError::Persistence(error) => return Self::from_persistence(error),
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

    fn from_review_scheme(error: &ReviewSchemeError) -> Self {
        let (message, action) = match error {
            ReviewSchemeError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建本地工作区，再设置错题方案。")
            }
            ReviewSchemeError::SchemeNotFound => {
                ("找不到这份复习方案。", "刷新错题页后重新选择方案。")
            }
            ReviewSchemeError::SchemeConflict => (
                "复习方案名称或队列状态发生冲突。",
                "更换方案名称或刷新今日队列后重试。",
            ),
            ReviewSchemeError::SubjectNotFound => {
                ("方案选择的科目不存在或已归档。", "刷新科目列表后重新选择。")
            }
            ReviewSchemeError::WorkbookNotFound => (
                "方案中的习题册不可用或不在当前范围。",
                "刷新习题册列表并重新选择范围。",
            ),
            ReviewSchemeError::QueueItemNotFound => {
                ("今日队列中找不到这道题。", "刷新错题页后从当前题继续。")
            }
            ReviewSchemeError::QueueItemCompleted => {
                ("这道题已经提交反馈。", "继续下一题，不要重复提交。")
            }
            ReviewSchemeError::UndoUnavailable => {
                ("没有可以撤销的反馈。", "继续当前复习，或刷新后重试。")
            }
            ReviewSchemeError::InvalidInput => (
                "复习方案、题型配额或日期无效。",
                "确认题型数量之和等于每日总量后重试。",
            ),
            ReviewSchemeError::Persistence(error) => return Self::from_persistence(error),
        };
        Self {
            code: error.code(),
            message,
            action,
            operation_id: Uuid::new_v4().to_string(),
        }
    }

    fn from_cycle_plan(error: &CyclePlanError) -> Self {
        let (message, action) = match error {
            CyclePlanError::WorkspaceNotInitialized => {
                ("尚未创建本地工作区。", "先创建本地工作区，再添加周期计划。")
            }
            CyclePlanError::PlanNotFound => ("找不到这份周期计划。", "刷新计划页后重新选择。"),
            CyclePlanError::ItemNotFound => ("找不到这个计划事项。", "刷新月历后重新操作。"),
            CyclePlanError::ItemStateStale => (
                "Cycle-plan item state changed in another window.",
                "Refresh the cycle plan and retry.",
            ),
            CyclePlanError::ShiftUndoUnavailable => (
                "This cycle-plan shift can no longer be undone.",
                "Undo is available for five seconds after the latest shift.",
            ),
            CyclePlanError::ShiftUndoStale => (
                "The cycle-plan changed in another window.",
                "Refresh the cycle plan; the shift was not partially undone.",
            ),
            CyclePlanError::ShiftPreviewStale => (
                "顺延预览已与当前计划不一致。",
                "刷新预览并确认最新排程后重试。",
            ),
            CyclePlanError::SaveStale => (
                "周期计划已在其他窗口发生变化。",
                "刷新计划并重新核对编辑内容后再保存。",
            ),
            CyclePlanError::InvalidInput | CyclePlanError::Validation(_) => (
                "周期计划的数量、日期或节奏无效。",
                "检查开始日、截止日、总量和每个单位所需学习日。",
            ),
            CyclePlanError::CompletedProgressConflict => (
                "已有完成或跳过事项的序号超出新的总量。",
                "请增大总量，保留所有完成或跳过事项后再保存。",
            ),
            CyclePlanError::Persistence(error) => return Self::from_persistence(error),
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
pub(crate) async fn rename_subject(
    request: RenameSubjectRequestDto,
    state: State<'_, AppState>,
) -> Result<SubjectDto, AppErrorDto> {
    let use_cases = state.schedule.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.rename_subject(&input))
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
pub(crate) async fn trash_resource(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.resources.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.trash(&document_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
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
    expected_revision: u32,
    status: String,
    state: State<'_, AppState>,
) -> Result<StudyPlanBundleDto, AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.set_status(&plan_id, expected_revision, &status)
    })
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
    expected_plan_revision: u32,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.delete_stage(&stage_id, expected_plan_revision)
    })
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
    expected_plan_revision: u32,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.planning.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.delete_reference(&reference_id, expected_plan_revision)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map_err(|error| AppErrorDto::from_planning(&error))
}

#[tauri::command]
pub(crate) async fn preview_plan_stage_tasks(
    request: PlanTaskScheduleRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanTaskPreviewDto, AppErrorDto> {
    let use_cases = state.plan_schedule.clone();
    let input = PlanTaskScheduleInput::from(request);
    tauri::async_runtime::spawn_blocking(move || use_cases.preview(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_plan_schedule(&error))
}

#[tauri::command]
pub(crate) async fn confirm_plan_stage_tasks(
    request: PlanTaskScheduleRequestDto,
    state: State<'_, AppState>,
) -> Result<PlanTaskCreationDto, AppErrorDto> {
    let use_cases = state.plan_schedule.clone();
    let input = PlanTaskScheduleInput::from(request);
    tauri::async_runtime::spawn_blocking(move || use_cases.confirm(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_plan_schedule(&error))
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
pub(crate) async fn get_question_bank(
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.snapshot())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn list_trashed_workbook_segments(
    state: State<'_, AppState>,
) -> Result<Vec<TrashedWorkbookDocumentSegmentDto>, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_trashed_workbook_segments())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|segments| segments.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn get_question_gap_acknowledgements(
    state: State<'_, AppState>,
) -> Result<QuestionGapAcknowledgementsDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.question_gap_acknowledgements())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn set_question_gap_acknowledgement(
    request: SetQuestionGapAcknowledgementRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionGapAcknowledgementsDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.set_question_gap_acknowledgement(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn create_workbook_category(
    request: CreateWorkbookCategoryRequestDto,
    state: State<'_, AppState>,
) -> Result<WorkbookCategoryDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.create_workbook(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn archive_workbook_category(
    workbook_id: String,
    state: State<'_, AppState>,
) -> Result<WorkbookCategoryDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.archive_workbook(&workbook_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn rename_workbook_category(
    request: RenameWorkbookCategoryRequestDto,
    state: State<'_, AppState>,
) -> Result<WorkbookCategoryDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.rename_workbook(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn save_workbook_segments(
    assignments: Vec<WorkbookSegmentAssignmentRequestDto>,
    state: State<'_, AppState>,
) -> Result<Vec<WorkbookDocumentSegmentDto>, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    let input = assignments.into_iter().map(Into::into).collect();
    tauri::async_runtime::spawn_blocking(move || use_cases.save_segments(input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|segments| segments.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn import_question_index(
    request: ImportQuestionIndexRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.import_index(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn record_bulk_question_attempts(
    request: RecordBulkQuestionAttemptsRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.record_attempts(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn update_indexed_question(
    request: UpdateIndexedQuestionRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.update_question(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn replace_indexed_question_regions(
    request: ReplaceIndexedQuestionRegionsRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.replace_question_regions(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn insert_indexed_question(
    request: InsertIndexedQuestionRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.insert_question_relative(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn trash_indexed_question(
    question_id: String,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.trash_question(&question_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn trash_workbook_segment(
    segment_id: String,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    let input = TrashWorkbookSegmentInput { segment_id };
    tauri::async_runtime::spawn_blocking(move || use_cases.trash_segment(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn restore_workbook_segment(
    input: RestoreWorkbookSegmentRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    let input = input.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.restore_workbook_segment(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn delete_workbook_segment(
    input: DeleteTrashedWorkbookSegmentRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    let input = input.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete_trashed_workbook_segment(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn delete_all_trashed_workbook_segments(
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.delete_all_trashed_workbook_segments())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
}

#[tauri::command]
pub(crate) async fn reassign_workbook_segment(
    input: ReassignWorkbookSegmentRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBankSnapshotDto, AppErrorDto> {
    let use_cases = state.question_bank.clone();
    let input = input.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.reassign_workbook_segment(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question_bank(&error))
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
pub(crate) async fn get_workbook_profile(
    document_id: String,
    state: State<'_, AppState>,
) -> Result<WorkbookProfileDto, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.workbook_profile(&document_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn set_workbook_default_subject(
    request: SetWorkbookSubjectRequestDto,
    state: State<'_, AppState>,
) -> Result<WorkbookProfileDto, AppErrorDto> {
    let use_cases = state.questions.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.set_workbook_subject(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_question(&error))
}

#[tauri::command]
pub(crate) async fn batch_classify_questions(
    request: BatchClassifyQuestionsRequestDto,
    state: State<'_, AppState>,
) -> Result<Vec<QuestionBundleDto>, AppErrorDto> {
    let use_cases = state.questions.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.batch_classify(&input))
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
pub(crate) async fn update_question_region(
    request: UpdateQuestionRegionRequestDto,
    state: State<'_, AppState>,
) -> Result<QuestionBundleDto, AppErrorDto> {
    let use_cases = state.questions.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.update_region(request.into()))
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
pub(crate) async fn get_ocr_status(
    state: State<'_, AppState>,
) -> Result<OcrComponentStatusDto, AppErrorDto> {
    let use_cases = state.ocr.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.status())
        .await
        .map(OcrComponentStatusDto::from)
        .map_err(|_| AppErrorDto::task_failed())
}

#[tauri::command]
pub(crate) async fn get_ocr_download_info(
    state: State<'_, AppState>,
) -> Result<OcrComponentDownloadInfoDto, AppErrorDto> {
    let use_cases = state.ocr.clone();
    tauri::async_runtime::spawn_blocking(move || OcrComponentDownloadInfoDto {
        available: use_cases.download_available(),
        engine: crate::application::OCR_ENGINE_NAME,
        default_version: "v0.1.4",
        versions: use_cases
            .download_packages()
            .into_iter()
            .map(OcrPackageOptionDto::from)
            .collect(),
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())
}

#[tauri::command]
pub(crate) async fn download_ocr_component(
    app: AppHandle,
    request: DownloadOcrComponentRequestDto,
    state: State<'_, AppState>,
) -> Result<OcrComponentStatusDto, AppErrorDto> {
    let operation_id = request.operation_id;
    let version = request.version;
    if Uuid::parse_str(&operation_id).is_err() {
        return Err(AppErrorDto::from_ocr(&OcrError::InvalidInput));
    }
    let coordinator = state.ocr_jobs.clone();
    let canceled = coordinator
        .register(operation_id.clone())
        .ok_or_else(|| AppErrorDto::from_ocr(&OcrError::OperationConflict))?;
    let use_cases = state.ocr.clone();
    let task_operation_id = operation_id.clone();
    let task_app = app.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let mut last_progress = (0_u64, 0_u64);
        let result = {
            let mut observe = |copied_bytes: u64, total_bytes: u64| {
                last_progress = (copied_bytes, total_bytes);
                emit_ocr_download_event(
                    &task_app,
                    OcrDownloadEventDto {
                        operation_id: task_operation_id.clone(),
                        state: "running",
                        copied_bytes,
                        total_bytes,
                        error: None,
                    },
                );
            };
            use_cases.download_component(version.as_deref(), &canceled, &mut observe)
        };
        (result, last_progress)
    })
    .await;
    coordinator.finish(&operation_id);

    let (result, (copied_bytes, total_bytes)) = outcome.map_err(|_| AppErrorDto::task_failed())?;
    match result {
        Ok(status) => {
            emit_ocr_download_event(
                &app,
                OcrDownloadEventDto {
                    operation_id,
                    state: "succeeded",
                    copied_bytes,
                    total_bytes,
                    error: None,
                },
            );
            Ok(status.into())
        }
        Err(error) => {
            let app_error = AppErrorDto::from_ocr(&error);
            emit_ocr_download_event(
                &app,
                OcrDownloadEventDto {
                    operation_id,
                    state: if matches!(error, OcrError::Canceled) {
                        "canceled"
                    } else {
                        "failed"
                    },
                    copied_bytes,
                    total_bytes,
                    error: Some(app_error.clone()),
                },
            );
            Err(app_error)
        }
    }
}

#[tauri::command]
pub(crate) async fn install_ocr_component(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<OcrComponentStatusDto>, AppErrorDto> {
    if state.ocr_jobs.is_active() {
        return Err(AppErrorDto::from_ocr(&OcrError::OperationConflict));
    }
    let Some(source) = pick_local_folder(&app, "选择 KyStudy OCR 组件文件夹").await? else {
        return Ok(None);
    };
    let use_cases = state.ocr.clone();
    let operations = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || {
        operations.run(|| use_cases.install_component(&source))
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(OcrComponentStatusDto::from)
    .map(Some)
    .map_err(|error| AppErrorDto::from_ocr(&error))
}

#[tauri::command]
pub(crate) async fn remove_ocr_component(
    state: State<'_, AppState>,
) -> Result<OcrComponentStatusDto, AppErrorDto> {
    if state.ocr_jobs.is_active() {
        return Err(AppErrorDto::from_ocr(&OcrError::OperationConflict));
    }
    let use_cases = state.ocr.clone();
    let operations = state.operations.clone();
    tauri::async_runtime::spawn_blocking(move || operations.run(|| use_cases.remove_component()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(OcrComponentStatusDto::from)
        .map_err(|error| AppErrorDto::from_ocr(&error))
}

#[tauri::command]
pub(crate) async fn list_question_ocr(
    question_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<OcrRecognitionDto>, AppErrorDto> {
    let use_cases = state.ocr.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.list_for_question(&question_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(|recognitions| recognitions.into_iter().map(Into::into).collect())
        .map_err(|error| AppErrorDto::from_ocr(&error))
}

#[tauri::command]
pub(crate) async fn recognize_question_region(
    request: RecognizeQuestionRegionRequestDto,
    state: State<'_, AppState>,
) -> Result<OcrRecognitionDto, AppErrorDto> {
    let operation_id = request.operation_id.clone();
    if Uuid::parse_str(&operation_id).is_err() {
        return Err(AppErrorDto::from_ocr(&OcrError::InvalidInput));
    }
    let coordinator = state.ocr_jobs.clone();
    let canceled = coordinator
        .register(operation_id.clone())
        .ok_or_else(|| AppErrorDto::from_ocr(&OcrError::OperationConflict))?;
    let use_cases = state.ocr.clone();
    let input = request.into();
    let outcome =
        tauri::async_runtime::spawn_blocking(move || use_cases.recognize_region(&input, &canceled))
            .await;
    coordinator.finish(&operation_id);
    outcome
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ocr(&error))
}

#[tauri::command]
pub(crate) async fn recognize_pdf_page(
    request: RecognizePdfPageRequestDto,
    state: State<'_, AppState>,
) -> Result<OcrPageRecognitionDto, AppErrorDto> {
    let operation_id = request.operation_id.clone();
    if Uuid::parse_str(&operation_id).is_err() {
        return Err(AppErrorDto::from_ocr(&OcrError::InvalidInput));
    }
    let coordinator = state.ocr_jobs.clone();
    let canceled = coordinator
        .register(operation_id.clone())
        .ok_or_else(|| AppErrorDto::from_ocr(&OcrError::OperationConflict))?;
    let use_cases = state.ocr.clone();
    let input = request.into();
    let outcome =
        tauri::async_runtime::spawn_blocking(move || use_cases.recognize_page(&input, &canceled))
            .await;
    coordinator.finish(&operation_id);
    outcome
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ocr(&error))
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri owns deserialized command arguments and state guards.
pub(crate) fn cancel_ocr(operation_id: String, state: State<'_, AppState>) -> bool {
    Uuid::parse_str(&operation_id).is_ok() && state.ocr_jobs.cancel(&operation_id)
}

fn emit_ocr_download_event(app: &AppHandle, event: OcrDownloadEventDto) {
    let _ = app.emit(OCR_DOWNLOAD_EVENT_NAME, event);
}

#[tauri::command]
pub(crate) async fn confirm_question_region_ocr(
    request: ConfirmQuestionRegionOcrRequestDto,
    state: State<'_, AppState>,
) -> Result<OcrRecognitionDto, AppErrorDto> {
    let use_cases = state.ocr.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.confirm(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_ocr(&error))
}

#[tauri::command]
pub(crate) async fn discard_question_region_ocr(
    recognition_id: String,
    state: State<'_, AppState>,
) -> Result<(), AppErrorDto> {
    let use_cases = state.ocr.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.discard(&recognition_id))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_ocr(&error))
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
pub(crate) async fn get_review_scheme_dashboard(
    today: String,
    state: State<'_, AppState>,
) -> Result<ReviewSchemeDashboardDto, AppErrorDto> {
    let use_cases = state.review_schemes.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.dashboard(&today))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review_scheme(&error))
}

#[tauri::command]
pub(crate) async fn save_review_scheme(
    request: SaveReviewSchemeRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewSchemeDashboardDto, AppErrorDto> {
    let use_cases = state.review_schemes.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.save_scheme(request.into()))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review_scheme(&error))
}

#[tauri::command]
pub(crate) async fn archive_review_scheme(
    scheme_id: String,
    today: String,
    state: State<'_, AppState>,
) -> Result<ReviewSchemeDashboardDto, AppErrorDto> {
    let use_cases = state.review_schemes.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.archive_scheme(&scheme_id, &today))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review_scheme(&error))
}

#[tauri::command]
pub(crate) async fn set_review_rest_weekdays(
    rest_weekdays: Vec<u8>,
    today: String,
    state: State<'_, AppState>,
) -> Result<ReviewSchemeDashboardDto, AppErrorDto> {
    let review_schemes = state.review_schemes.clone();
    let dashboard = tauri::async_runtime::spawn_blocking(move || {
        review_schemes.set_rest_weekdays(&rest_weekdays, &today)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map_err(|error| AppErrorDto::from_review_scheme(&error))?;
    let cycle_plans = state.cycle_plans.clone();
    tauri::async_runtime::spawn_blocking(move || cycle_plans.refresh_schedules())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map_err(|error| AppErrorDto::from_cycle_plan(&error))?;
    Ok(dashboard.into())
}

#[tauri::command]
pub(crate) async fn generate_review_scheme_queue(
    request: GenerateReviewSchemeQueueRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewSchemeDashboardDto, AppErrorDto> {
    let use_cases = state.review_schemes.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.generate_queue(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review_scheme(&error))
}

#[tauri::command]
pub(crate) async fn submit_review_scheme_result(
    request: SubmitReviewSchemeResultRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewSchemeDashboardDto, AppErrorDto> {
    let use_cases = state.review_schemes.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.submit_review(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review_scheme(&error))
}

#[tauri::command]
pub(crate) async fn undo_review_scheme_result(
    request: UndoReviewSchemeResultRequestDto,
    state: State<'_, AppState>,
) -> Result<ReviewSchemeDashboardDto, AppErrorDto> {
    let use_cases = state.review_schemes.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.undo_last_review(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_review_scheme(&error))
}

#[tauri::command]
pub(crate) async fn get_cycle_plan_dashboard(
    state: State<'_, AppState>,
) -> Result<CyclePlanDashboardDto, AppErrorDto> {
    let use_cases = state.cycle_plans.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.dashboard())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_cycle_plan(&error))
}

#[tauri::command]
pub(crate) async fn save_cycle_plan(
    request: SaveCyclePlanRequestDto,
    state: State<'_, AppState>,
) -> Result<CyclePlanDashboardDto, AppErrorDto> {
    let use_cases = state.cycle_plans.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.save_plan(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_cycle_plan(&error))
}

#[tauri::command]
pub(crate) async fn set_cycle_plan_item_state(
    request: SetCyclePlanItemStateRequestDto,
    state: State<'_, AppState>,
) -> Result<SetCyclePlanItemStateResultDto, AppErrorDto> {
    let use_cases = state.cycle_plans.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.set_item_state(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_cycle_plan(&error))
}

#[tauri::command]
pub(crate) async fn restore_cycle_plan_item_state(
    request: RestoreCyclePlanItemStateRequestDto,
    state: State<'_, AppState>,
) -> Result<CyclePlanDashboardDto, AppErrorDto> {
    let use_cases = state.cycle_plans.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.restore_item_state(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_cycle_plan(&error))
}

#[tauri::command]
pub(crate) async fn preview_cycle_plan_shift(
    request: ShiftCyclePlanRequestDto,
    state: State<'_, AppState>,
) -> Result<ShiftCyclePlanPreviewDto, AppErrorDto> {
    let use_cases = state.cycle_plans.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.preview_shift_plan(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_cycle_plan(&error))
}

#[tauri::command]
pub(crate) async fn confirm_cycle_plan_shift(
    request: ConfirmShiftCyclePlanRequestDto,
    state: State<'_, AppState>,
) -> Result<ShiftCyclePlanResultDto, AppErrorDto> {
    let use_cases = state.cycle_plans.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.confirm_shift_plan(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_cycle_plan(&error))
}

#[tauri::command]
pub(crate) async fn undo_shift_cycle_plan(
    request: UndoShiftCyclePlanRequestDto,
    state: State<'_, AppState>,
) -> Result<CyclePlanDashboardDto, AppErrorDto> {
    let use_cases = state.cycle_plans.clone();
    let input = request.into();
    tauri::async_runtime::spawn_blocking(move || use_cases.undo_shift_plan(&input))
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_cycle_plan(&error))
}

#[tauri::command]
pub(crate) async fn archive_cycle_plan(
    plan_id: String,
    expected_updated_at: i64,
    state: State<'_, AppState>,
) -> Result<CyclePlanDashboardDto, AppErrorDto> {
    let use_cases = state.cycle_plans.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use_cases.archive_plan(&plan_id, expected_updated_at)
    })
    .await
    .map_err(|_| AppErrorDto::task_failed())?
    .map(Into::into)
    .map_err(|error| AppErrorDto::from_cycle_plan(&error))
}

#[tauri::command]
pub(crate) async fn refresh_cycle_plan_schedules(
    state: State<'_, AppState>,
) -> Result<CyclePlanDashboardDto, AppErrorDto> {
    let use_cases = state.cycle_plans.clone();
    tauri::async_runtime::spawn_blocking(move || use_cases.refresh_schedules())
        .await
        .map_err(|_| AppErrorDto::task_failed())?
        .map(Into::into)
        .map_err(|error| AppErrorDto::from_cycle_plan(&error))
}

const MAXIMUM_TEMPORARY_ATTACHMENT_BYTES: u64 = 104_857_600;

async fn pick_temporary_attachment_source(app: &AppHandle) -> Result<Option<PathBuf>, AppErrorDto> {
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
    match selected {
        None => Ok(None),
        Some(FilePath::Path(path)) => Ok(Some(path)),
        Some(FilePath::Url(_)) => Err(AppErrorDto::from_import(&ImportError::SourceNotFile)),
    }
}

fn prepare_temporary_attachment(
    path: &Path,
    data_directory: &Path,
    conversation_id: String,
) -> Result<TemporaryAttachmentInput, ImportError> {
    let source = path.canonicalize()?;
    let managed_root = data_directory
        .canonicalize()
        .unwrap_or_else(|_| data_directory.to_owned());
    if source.starts_with(&managed_root) {
        return Err(ImportError::SourceInsideWorkspace);
    }
    let metadata = fs::metadata(&source)?;
    if !metadata.is_file() {
        return Err(ImportError::SourceNotFile);
    }
    let size_bytes = metadata.len();
    if size_bytes > MAXIMUM_TEMPORARY_ATTACHMENT_BYTES {
        return Err(ImportError::AttachmentTooLarge);
    }
    let (.., mime_type) = classify_source(&source)?;
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .ok_or(ImportError::InvalidFileName)?
        .to_owned();
    let mut file = fs::File::open(&source)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    file.seek(SeekFrom::Start(0))?;
    Ok(TemporaryAttachmentInput {
        conversation_id,
        attachment_id: Uuid::now_v7().to_string(),
        file_name,
        mime_type,
        size_bytes,
        sha256: format!("{:X}", hasher.finalize()),
        file,
    })
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
        AiOverviewDto, AppErrorDto, BackupReportDto, ConfirmShiftCyclePlanRequestDto,
        CyclePlanItemDto, KnowledgeMapBundleDto, OcrPageRecognitionDto, OcrRecognitionDto,
        PlanExecutionProgressDto, PlanProgressRequestDto, PlanTaskScheduleRequestDto,
        QuestionBundleDto, ReassignWorkbookSegmentRequestDto, RescheduleTaskRequestDto,
        ResourceDocumentDto, ResourceSearchResultDto, RestoreCyclePlanItemStateRequestDto,
        ReviewReasonDto, SaveCyclePlanRequestDto, SetCyclePlanItemStateRequestDto,
        SetCyclePlanItemStateResultDto, ShiftCyclePlanPreviewDto, ShiftCyclePlanResultDto,
        SubjectDto, TaskChangeDto, TaskDto, UndoShiftCyclePlanRequestDto,
        UpdateTaskDetailsRequestDto,
    };
    use crate::application::{
        AiOverview, AiProviderOverview, BackupReport, CyclePlanError, OcrPageLine,
        OcrPageRecognition, PersistenceError, PlanExecutionProgress, PlanProgressCounts,
        PlanProgressSummary, PlanStageProgress, QuestionBankError, ReassignWorkbookSegmentInput,
        ResourceDocument, RestoreCyclePlanItemStateInput, ScheduleError,
        SetCyclePlanItemStateResult, ShiftCyclePlanPreview, ShiftCyclePlanResult,
        ShiftCyclePlanUndo, UndoShiftCyclePlanInput, default_provider,
    };
    use crate::domain::{
        AttemptResult, CyclePlanDashboard, CyclePlanItem, CyclePlanItemState, KnowledgeMap,
        KnowledgeMapBundle, KnowledgeNode, KnowledgeNodeResource, LocalDate, MasteryState,
        OcrRecognition, OcrRecognitionState, OcrTextLine, PlanStatus, Question, QuestionAttempt,
        QuestionBundle, QuestionRegion, ResourceSearchMatchKind, ResourceSearchResult,
        ReviewReason, ReviewSelectionKind, Subject, SubjectColor, Task, TaskChange,
        TaskChangeSnapshot, TaskChangeType, TaskPriority, TaskStatus,
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
    fn plan_progress_dto_exposes_only_typed_aggregates() {
        let summary = PlanProgressSummary {
            counts: PlanProgressCounts {
                generated_task_count: 2,
                effective_task_count: 2,
                completed_task_count: 1,
                remaining_task_count: 1,
                overdue_task_count: 1,
                canceled_task_count: 0,
                trashed_task_count: 0,
                planned_minutes: 120,
                actual_minutes: 45,
            },
            completion_rate_percent: Some(50),
        };
        let dto = PlanExecutionProgressDto::from(PlanExecutionProgress {
            plan_id: "plan-id".to_owned(),
            plan_title: "408 计划".to_owned(),
            plan_status: PlanStatus::Active,
            summary: summary.clone(),
            stages: vec![PlanStageProgress {
                stage_id: "stage-id".to_owned(),
                stage_title: "基础阶段".to_owned(),
                start_date: LocalDate::parse("2026-07-01").expect("date should parse"),
                end_date: LocalDate::parse("2026-07-31").expect("date should parse"),
                summary,
            }],
        });

        let value = serde_json::to_value(dto).expect("plan progress DTO should serialize");

        assert_eq!(value["summary"]["completionRatePercent"], 50);
        assert!(value.get("taskIds").is_none());
        assert!(value.get("sql").is_none());
        assert!(value.get("databasePath").is_none());
    }

    #[test]
    fn plan_progress_request_rejects_frontend_authored_task_ids() {
        let request = serde_json::from_value::<PlanProgressRequestDto>(serde_json::json!({
            "planId": "019f7328-4b66-7613-9729-e3570fc41525",
            "today": "2026-07-22",
            "taskIds": ["private"]
        }));

        assert!(request.is_err());
    }

    #[test]
    fn ai_overview_dto_never_exposes_secret_references_or_fingerprints() {
        let (mut provider, model, budget) = default_provider(1_700_000_000_000);
        provider.secret_ref = Some("private-secret-reference".to_owned());
        let dto = AiOverviewDto::from(AiOverview {
            active_provider_id: provider.id.clone(),
            providers: vec![AiProviderOverview {
                provider,
                model,
                has_secret: true,
            }],
            budget,
            usage: crate::domain::AiUsageSummary::default(),
            calls: Vec::new(),
        });

        let serialized = serde_json::to_string(&dto).expect("AI overview should serialize");

        assert!(!serialized.contains("private-secret-reference"));
        assert!(!serialized.contains("fingerprint"));
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
    fn plan_schedule_request_rejects_frontend_authored_tasks() {
        let value = serde_json::json!({
            "stageId": "019f7328-4b66-7613-9729-e3570fc41525",
            "subjectId": null,
            "startDate": "2026-07-20",
            "endDate": "2026-07-26",
            "weekdays": [0, 2, 4],
            "title": "数据结构基础",
            "description": null,
            "estimatedMinutes": 90,
            "priority": "normal",
            "tasks": [{ "plannedDate": "2026-01-01" }]
        });

        let result = serde_json::from_value::<PlanTaskScheduleRequestDto>(value);

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
                subject_id: None,
                subject_name: None,
                subject_inherited: false,
                question_type: Some(crate::domain::QuestionType::Solution),
                classification_source: crate::domain::ClassificationSource::Manual,
                classification_confidence: Some(1.0),
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
    fn ocr_dto_exposes_text_boxes_without_worker_internals() {
        let recognition_id = "019f7328-4b66-7613-9729-e3570fc41525".to_owned();
        let dto = OcrRecognitionDto::from(OcrRecognition {
            id: recognition_id.clone(),
            question_id: "019f7328-4b66-7613-9729-e3570fc41526".to_owned(),
            region_id: "019f7328-4b66-7613-9729-e3570fc41527".to_owned(),
            page_number: 2,
            engine: "local-ocr".to_owned(),
            recognized_text: "线性表".to_owned(),
            confirmed_text: None,
            mean_confidence: 0.98,
            state: OcrRecognitionState::Draft,
            lines: vec![OcrTextLine {
                id: "019f7328-4b66-7613-9729-e3570fc41528".to_owned(),
                recognition_id,
                text: "线性表".to_owned(),
                confidence: 0.98,
                x: 0.1,
                y: 0.2,
                width: 0.5,
                height: 0.1,
                sort_order: 0,
            }],
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
        });

        let value = serde_json::to_value(dto).expect("OCR DTO should serialize");

        assert_eq!(value["lines"][0]["confidence"], 0.98);
        assert!(value.get("componentPath").is_none());
        assert!(value.get("temporaryImage").is_none());
        assert!(value.get("stderr").is_none());
        assert!(value.get("workerResponse").is_none());
    }

    #[test]
    fn pdf_page_ocr_dto_exposes_only_safe_normalized_lines() {
        let dto = OcrPageRecognitionDto::from(OcrPageRecognition {
            page_number: 3,
            engine: "local-ocr".to_owned(),
            mean_confidence: 0.98,
            lines: vec![OcrPageLine {
                text: "绾挎€ц〃".to_owned(),
                confidence: 0.98,
                x: 0.1,
                y: 0.2,
                width: 0.5,
                height: 0.1,
                sort_order: 0,
            }],
        });

        let value = serde_json::to_value(dto).expect("page OCR DTO should serialize");

        assert_eq!(value["pageNumber"], 3);
        assert_eq!(value["lines"][0]["confidence"], 0.98);
        assert!(value["lines"][0].get("id").is_none());
        assert!(value["lines"][0].get("recognitionId").is_none());
        assert!(value.get("componentPath").is_none());
        assert!(value.get("temporaryImage").is_none());
        assert!(value.get("stderr").is_none());
        assert!(value.get("workerResponse").is_none());
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
    fn segment_assignment_conflict_maps_to_stable_safe_error() {
        let error = QuestionBankError::segment_assignment_conflicts(vec![(
            "document-id".to_owned(),
            "subject-id".to_owned(),
            3,
            98,
            "workbook-1000".to_owned(),
            "segment-880".to_owned(),
            "workbook-880".to_owned(),
        )]);

        let dto = AppErrorDto::from_question_bank(&error);

        assert_eq!(dto.code, "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT");
        assert_eq!(dto.message, "这段 PDF 科目内容已经归属于另一个练习册。");
        assert_eq!(dto.action, "保留已有归类，或先更正已有分段后再重试。");
        assert!(uuid::Uuid::parse_str(&dto.operation_id).is_ok());
        let serialized = serde_json::to_value(&dto).expect("error DTO should serialize");
        assert!(serialized.get("conflicts").is_none());
        assert!(serialized.get("databasePath").is_none());
    }

    #[test]
    fn segment_restore_state_errors_map_to_stable_codes() {
        let not_trashed = AppErrorDto::from_question_bank(&QuestionBankError::SegmentNotTrashed);
        assert_eq!(not_trashed.code, "QUESTION_BANK_SEGMENT_NOT_TRASHED");
        let stale = AppErrorDto::from_question_bank(&QuestionBankError::SegmentRestoreStale);
        assert_eq!(stale.code, "QUESTION_BANK_SEGMENT_RESTORE_STALE");
        let serialized = serde_json::to_value(stale).expect("restore error should serialize");
        assert!(serialized.get("path").is_none());
        assert!(serialized.get("sql").is_none());
    }

    #[test]
    fn segment_reassignment_stale_maps_to_a_stable_safe_code() {
        let stale = AppErrorDto::from_question_bank(&QuestionBankError::SegmentReassignStale);

        assert_eq!(stale.code, "QUESTION_BANK_SEGMENT_REASSIGN_STALE");
        let serialized = serde_json::to_value(stale).expect("reassignment error should serialize");
        assert!(serialized.get("path").is_none());
        assert!(serialized.get("sql").is_none());
    }

    #[test]
    fn cycle_plan_item_dto_exposes_version_and_restore_request_maps_exact_timestamp() {
        let dto = CyclePlanItemDto::from(CyclePlanItem {
            id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            plan_id: "019f7328-4b66-7613-9729-e3570fc41526".to_owned(),
            unit_index: 1,
            planned_start_date: LocalDate::parse("2026-07-29").expect("date should parse"),
            planned_end_date: LocalDate::parse("2026-07-30").expect("date should parse"),
            original_start_date: LocalDate::parse("2026-07-29").expect("date should parse"),
            original_end_date: LocalDate::parse("2026-07-30").expect("date should parse"),
            state: CyclePlanItemState::Completed,
            completed_at: Some(1_700_000_000_100),
            skipped_at: None,
            shift_count: 0,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_200,
        });
        let value = serde_json::to_value(dto).expect("cycle item DTO should serialize");
        assert_eq!(value["updatedAt"], 1_700_000_000_200_i64);
        assert!(value["skippedAt"].is_null());

        let set_request =
            serde_json::from_value::<SetCyclePlanItemStateRequestDto>(serde_json::json!({
                "itemId": "019f7328-4b66-7613-9729-e3570fc41525",
                "targetState": "skipped",
                "expectedUpdatedAt": 1_700_000_000_200_i64
            }))
            .expect("set state request should deserialize");
        let set_input: crate::application::SetCyclePlanItemStateInput = set_request.into();
        assert_eq!(set_input.target_state, "skipped");

        let request =
            serde_json::from_value::<RestoreCyclePlanItemStateRequestDto>(serde_json::json!({
                "itemId": "019f7328-4b66-7613-9729-e3570fc41525",
                "state": "completed",
                "completedAt": 1_700_000_000_100_i64,
                "skippedAt": null,
                "expectedUpdatedAt": 1_700_000_000_200_i64
            }))
            .expect("restore request should deserialize");
        let input: RestoreCyclePlanItemStateInput = request.into();
        assert_eq!(input.original_state, "completed");
        assert_eq!(input.original_completed_at, Some(1_700_000_000_100));
        assert_eq!(input.original_skipped_at, None);
        assert_eq!(input.expected_updated_at, 1_700_000_000_200);
        assert!(
            serde_json::from_value::<RestoreCyclePlanItemStateRequestDto>(serde_json::json!({
                "itemId": "019f7328-4b66-7613-9729-e3570fc41525",
                "originalState": "completed",
                "completedAt": 1_700_000_000_100_i64,
                "skippedAt": null,
                "expectedUpdatedAt": 1_700_000_000_200_i64
            }))
            .is_err()
        );

        let stale = AppErrorDto::from_cycle_plan(&CyclePlanError::ItemStateStale);
        assert_eq!(stale.code, "CYCLE_PLAN_ITEM_STATE_STALE");
        let serialized = serde_json::to_value(stale).expect("cycle plan error should serialize");
        assert!(serialized.get("sql").is_none());
    }

    #[test]
    fn shift_cycle_plan_result_exposes_only_backend_undo_token() {
        let dto = ShiftCyclePlanResultDto::from(ShiftCyclePlanResult {
            dashboard: CyclePlanDashboard {
                rest_weekdays: Vec::new(),
                plans: Vec::new(),
            },
            shifted_item_count: 2,
            undo: Some(ShiftCyclePlanUndo {
                plan_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
                undo_token: "019f7328-4b66-7613-9729-e3570fc41526".to_owned(),
                expires_at: 1_700_000_005_000,
            }),
        });
        let value = serde_json::to_value(dto).expect("shift result should serialize");
        assert_eq!(value["shiftedItemCount"], 2);
        assert_eq!(value["undo"]["expiresAt"], 1_700_000_005_000_i64);
        assert!(value["undo"].get("beforeDates").is_none());

        let request = serde_json::from_value::<UndoShiftCyclePlanRequestDto>(serde_json::json!({
            "planId": "019f7328-4b66-7613-9729-e3570fc41525",
            "undoToken": "opaque-shift-token"
        }))
        .expect("undo request should deserialize");
        let input: UndoShiftCyclePlanInput = request.into();
        assert_eq!(input.plan_id, "019f7328-4b66-7613-9729-e3570fc41525");
        assert_eq!(input.undo_token, "opaque-shift-token");
    }

    #[test]
    fn shift_undo_errors_use_stable_cycle_plan_codes() {
        assert_eq!(
            AppErrorDto::from_cycle_plan(&CyclePlanError::ShiftUndoUnavailable).code,
            "CYCLE_PLAN_SHIFT_UNDO_UNAVAILABLE"
        );
        assert_eq!(
            AppErrorDto::from_cycle_plan(&CyclePlanError::ShiftUndoStale).code,
            "CYCLE_PLAN_SHIFT_UNDO_STALE"
        );
    }

    #[test]
    fn shift_preview_and_confirm_dtos_expose_only_the_frozen_contract() {
        let dto = ShiftCyclePlanPreviewDto::from(ShiftCyclePlanPreview {
            plan_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            from_date: LocalDate::parse("2026-08-01").expect("date should parse"),
            study_days: 2,
            affected_item_count: 3,
            current_estimated_end_date: LocalDate::parse("2026-08-20").expect("date should parse"),
            new_estimated_end_date: LocalDate::parse("2026-08-24").expect("date should parse"),
            deadline: LocalDate::parse("2026-08-22").expect("date should parse"),
            exceeds_deadline_by_days: 2,
            rest_weekdays: vec![5, 6],
            preview_token: Some(format!("cpsp1_{}", "a".repeat(64))),
        });
        let value = serde_json::to_value(dto).expect("preview should serialize");
        assert_eq!(value["affectedItemCount"], 3);
        assert_eq!(value["currentEstimatedEndDate"], "2026-08-20");
        assert_eq!(value["newEstimatedEndDate"], "2026-08-24");
        assert_eq!(value["exceedsDeadlineByDays"], 2);
        assert!(value.get("expiresAt").is_none());

        let request =
            serde_json::from_value::<ConfirmShiftCyclePlanRequestDto>(serde_json::json!({
                "planId": "019f7328-4b66-7613-9729-e3570fc41525",
                "fromDate": "2026-08-01",
                "studyDays": 2,
                "previewToken": format!("cpsp1_{}", "a".repeat(64))
            }))
            .expect("frozen confirm request should deserialize");
        let input: crate::application::ConfirmShiftCyclePlanInput = request.into();
        assert_eq!(input.study_days, 2);
        assert!(
            serde_json::from_value::<ConfirmShiftCyclePlanRequestDto>(serde_json::json!({
                "planId": "019f7328-4b66-7613-9729-e3570fc41525",
                "fromDate": "2026-08-01",
                "studyDays": 2,
                "previewToken": format!("cpsp1_{}", "a".repeat(64)),
                "beforeDates": []
            }))
            .is_err()
        );
        let stale = AppErrorDto::from_cycle_plan(&CyclePlanError::ShiftPreviewStale);
        assert_eq!(stale.code, "CYCLE_PLAN_SHIFT_PREVIEW_STALE");
        assert_eq!(stale.message, "顺延预览已与当前计划不一致。");
        assert_eq!(stale.action, "刷新预览并确认最新排程后重试。");
    }

    #[test]
    fn completed_progress_conflict_matches_the_cycle_plan_client_contract() {
        let dto = AppErrorDto::from_cycle_plan(&CyclePlanError::CompletedProgressConflict);

        assert_eq!(dto.code, "CYCLE_PLAN_COMPLETED_CONFLICT");
        assert_eq!(dto.message, "已有完成或跳过事项的序号超出新的总量。");
        assert_eq!(dto.action, "请增大总量，保留所有完成或跳过事项后再保存。");
    }

    #[test]
    fn cycle_plan_save_dto_uses_camel_case_cas_and_stable_stale_copy() {
        let request = serde_json::from_value::<SaveCyclePlanRequestDto>(serde_json::json!({
            "planId": "019f7328-4b66-7613-9729-e3570fc41525",
            "expectedUpdatedAt": 1_700_000_000_100_i64,
            "name": "cycle",
            "totalUnits": 3,
            "unitLabel": "unit",
            "startDate": "2026-08-01",
            "deadline": "2026-12-31",
            "studyDaysPerUnit": 1,
            "scheduleMode": "rhythm",
            "calendarVisible": true
        }))
        .expect("save request should deserialize");
        let input: crate::application::SaveCyclePlanInput = request.into();
        assert_eq!(input.expected_updated_at, Some(1_700_000_000_100));
        assert!(
            serde_json::from_value::<SaveCyclePlanRequestDto>(serde_json::json!({
                "planId": null,
                "expectedUpdatedAt": null,
                "name": "cycle",
                "totalUnits": 3,
                "unitLabel": "unit",
                "startDate": "2026-08-01",
                "deadline": "2026-12-31",
                "studyDaysPerUnit": 1,
                "scheduleMode": "rhythm",
                "calendarVisible": true,
                "expected_updated_at": 1
            }))
            .is_err()
        );
        let stale = AppErrorDto::from_cycle_plan(&CyclePlanError::SaveStale);
        assert_eq!(stale.code, "CYCLE_PLAN_SAVE_STALE");
        assert_eq!(stale.message, "周期计划已在其他窗口发生变化。");
        assert_eq!(stale.action, "刷新计划并重新核对编辑内容后再保存。");
    }

    #[test]
    fn cycle_plan_state_result_dto_exposes_the_atomic_mutation_token() {
        let dto = SetCyclePlanItemStateResultDto::from(SetCyclePlanItemStateResult {
            dashboard: CyclePlanDashboard {
                rest_weekdays: Vec::new(),
                plans: Vec::new(),
            },
            item_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            item_updated_at: 1_700_000_000_200,
        });

        let value = serde_json::to_value(dto).expect("mutation result should serialize");

        assert_eq!(value["itemUpdatedAt"], 1_700_000_000_200_i64);
        assert_eq!(value["itemId"], "019f7328-4b66-7613-9729-e3570fc41525");
        assert!(value["dashboard"].is_object());
    }

    #[test]
    fn reassign_workbook_segment_request_uses_camel_case_tokens() {
        let dto: ReassignWorkbookSegmentRequestDto = serde_json::from_value(serde_json::json!({
            "segmentId": "019fc6fa-ff79-74c3-ba08-f8673cc939bf",
            "targetWorkbookId": "019fc6fb-01f4-76b3-9498-754a9461230b",
            "expectedUpdatedAt": 1_700_000_000_000_i64,
            "expectedDeletedAt": null
        }))
        .expect("reassignment request should deserialize");
        let input: ReassignWorkbookSegmentInput = dto.into();

        assert_eq!(input.expected_updated_at, 1_700_000_000_000);
        assert_eq!(input.expected_deleted_at, None);
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
