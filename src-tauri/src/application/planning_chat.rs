use std::fmt::Write as _;
use std::fs::File;
use std::sync::atomic::{AtomicBool, Ordering};

use uuid::Uuid;

use crate::domain::{AiCapabilityState, AiConversationKind, AiProviderType};

use super::{
    AiCallPreview, AiCallPurpose, AiCallResult, AiError, AiFileAttachment, AiPreviewInput,
    AiProviderGateway, AiRepository, AiUseCases, PersistenceError, SecretStore, current_utc_millis,
    estimate_tokens,
};

const MAXIMUM_CONTEXTS: usize = 6;
const MAXIMUM_HISTORY_MESSAGES: u32 = 8;
const MAXIMUM_CONTEXT_CHARS: usize = 1_200;
const MAXIMUM_HISTORY_CHARS: usize = 6_000;
const MAXIMUM_QUESTION_IMAGES: usize = 16;
const MAXIMUM_QUESTION_CHARS: usize = 64_000;
const MAXIMUM_QUESTION_CONTEXT_CHARS: usize = 32_000;
const MAXIMUM_ATTACHMENTS: usize = 6;
const MAXIMUM_ATTACHMENT_TEXT_CHARS: usize = 64_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningContextSelection {
    pub(crate) document_id: String,
    pub(crate) page_number: u32,
    pub(crate) search_query: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningChatInput {
    pub(crate) conversation_id: String,
    pub(crate) question: String,
    pub(crate) contexts: Vec<PlanningContextSelection>,
    pub(crate) question_context: Option<PlanningQuestionContext>,
    pub(crate) attachment_ids: Vec<String>,
    pub(crate) image_data_urls: Vec<String>,
    pub(crate) max_output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningQuestionContext {
    pub(crate) title: String,
    pub(crate) document_title: String,
    pub(crate) analysis: Option<String>,
    pub(crate) image_data_urls: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConfirmPlanningChatInput {
    pub(crate) chat: PlanningChatInput,
    pub(crate) confirmed_prompt: String,
    pub(crate) confirmed_request_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningSource {
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) page_number: u32,
    pub(crate) citation_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningMessage {
    pub(crate) id: String,
    pub(crate) role: String,
    pub(crate) content: String,
    pub(crate) sources: Vec<PlanningSource>,
    pub(crate) created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningConversation {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) kind: AiConversationKind,
    pub(crate) model_profile_id: Option<String>,
    pub(crate) messages: Vec<PlanningMessage>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiAttachmentRef {
    pub(crate) id: String,
    pub(crate) conversation_id: String,
    pub(crate) source: String,
    pub(crate) document_id: Option<String>,
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: Option<String>,
    pub(crate) status: String,
    pub(crate) error_code: Option<String>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// A backend-authorized temporary file prepared by the native file picker.
/// The file handle never crosses into the `WebView`; the repository owns the
/// copy into its managed temporary directory and only persists safe metadata.
#[derive(Debug)]
pub(crate) struct TemporaryAttachmentInput {
    pub(crate) conversation_id: String,
    pub(crate) attachment_id: String,
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
    pub(crate) file: File,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedPlanningContext {
    pub(crate) source: PlanningSource,
    pub(crate) text: String,
    pub(crate) content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedPlanningAttachment {
    pub(crate) text: String,
    pub(crate) indexed_pages: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedPlanningFile {
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
    pub(crate) path: std::path::PathBuf,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningAttachmentPreview {
    pub(crate) id: String,
    pub(crate) file_name: String,
    pub(crate) transport: String,
    pub(crate) indexed_pages: Option<u32>,
    pub(crate) warning: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PlanningAttachmentPlan {
    transport: String,
    attachments: Vec<PlanningAttachmentPreview>,
    prompt_sections: Vec<String>,
    files: Vec<AiFileAttachment>,
    blocked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningChatPreview {
    pub(crate) preview: AiCallPreview,
    pub(crate) sources: Vec<PlanningSource>,
    pub(crate) transport: String,
    pub(crate) attachments: Vec<PlanningAttachmentPreview>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningChatReply {
    pub(crate) result: AiCallResult,
    pub(crate) conversation: PlanningConversation,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum PlanningChatError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("planning chat input is invalid")]
    InvalidInput,
    #[error("planning conversation was not found")]
    ConversationNotFound,
    #[error("planning source was not found")]
    ContextNotFound,
    #[error("planning preview changed before confirmation")]
    PreviewStale,
    #[error("planning reply was not found")]
    ReplyNotFound,
    #[error("AI attachment was not found")]
    AttachmentNotFound,
    #[error("AI attachment limit was reached")]
    AttachmentLimitReached,
    #[error("resource document was not found or is not ready")]
    AttachmentResourceNotFound,
    #[error("AI attachment metadata is invalid")]
    AttachmentInvalid,
    #[error("temporary AI attachment could not be stored")]
    AttachmentTemporaryFailed,
    #[error("temporary AI attachment is missing or has changed")]
    AttachmentTemporaryNotFound,
    #[error("AI attachment text has not been indexed")]
    AttachmentNotIndexed,
    #[error("planning chat was canceled")]
    Canceled,
    #[error(transparent)]
    Ai(#[from] AiError),
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl PlanningChatError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::InvalidInput => "PLANNING_CHAT_INPUT_INVALID",
            Self::ConversationNotFound => "PLANNING_CONVERSATION_NOT_FOUND",
            Self::ContextNotFound => "PLANNING_CONTEXT_NOT_FOUND",
            Self::PreviewStale => "PLANNING_PREVIEW_STALE",
            Self::ReplyNotFound => "PLANNING_REPLY_NOT_FOUND",
            Self::AttachmentNotFound => "AI_ATTACHMENT_NOT_FOUND",
            Self::AttachmentLimitReached => "AI_ATTACHMENT_LIMIT_REACHED",
            Self::AttachmentResourceNotFound => "AI_ATTACHMENT_RESOURCE_NOT_FOUND",
            Self::AttachmentInvalid => "AI_ATTACHMENT_INVALID",
            Self::AttachmentTemporaryFailed => "AI_ATTACHMENT_TEMPORARY_FAILED",
            Self::AttachmentTemporaryNotFound => "AI_ATTACHMENT_TEMPORARY_NOT_FOUND",
            Self::AttachmentNotIndexed => "AI_ATTACHMENT_NOT_INDEXED",
            Self::Canceled => "PLANNING_CHAT_CANCELED",
            Self::Ai(error) => error.code(),
            Self::Persistence(error) => error.code(),
        }
    }
}

pub(crate) trait PlanningChatRepository: Clone + Send + Sync + 'static {
    fn list_conversations(&self) -> Result<Vec<PlanningConversation>, PlanningChatError>;
    fn create_conversation(
        &self,
        id: &str,
        title: &str,
        now: i64,
    ) -> Result<PlanningConversation, PlanningChatError>;
    fn rename_conversation(
        &self,
        conversation_id: &str,
        title: &str,
        now: i64,
    ) -> Result<PlanningConversation, PlanningChatError>;
    fn delete_conversation(&self, conversation_id: &str) -> Result<(), PlanningChatError>;
    fn list_attachments(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<AiAttachmentRef>, PlanningChatError>;
    fn attach_resource(
        &self,
        conversation_id: &str,
        document_id: &str,
        attachment_id: &str,
        now: i64,
    ) -> Result<AiAttachmentRef, PlanningChatError>;
    fn attach_temporary(
        &self,
        input: TemporaryAttachmentInput,
        now: i64,
    ) -> Result<AiAttachmentRef, PlanningChatError>;
    fn retry_attachment(
        &self,
        attachment_id: &str,
        now: i64,
    ) -> Result<AiAttachmentRef, PlanningChatError>;
    fn expire_temporary_attachments(&self, now: i64) -> Result<(), PlanningChatError>;
    fn remove_attachment(&self, attachment_id: &str) -> Result<(), PlanningChatError>;
    fn resolve_attachment_text(
        &self,
        document_id: &str,
    ) -> Result<Option<ResolvedPlanningAttachment>, PlanningChatError>;
    fn resolve_temporary_attachment_file(
        &self,
        attachment_id: &str,
    ) -> Result<Option<ResolvedPlanningFile>, PlanningChatError>;
    fn load_history(
        &self,
        conversation_id: &str,
        limit: u32,
    ) -> Result<Vec<PlanningMessage>, PlanningChatError>;
    fn resolve_contexts(
        &self,
        selections: &[PlanningContextSelection],
    ) -> Result<Vec<ResolvedPlanningContext>, PlanningChatError>;
    fn append_exchange(
        &self,
        conversation_id: &str,
        question: &str,
        answer: &str,
        call_id: &str,
        contexts: &[ResolvedPlanningContext],
        now: i64,
    ) -> Result<PlanningConversation, PlanningChatError>;
    fn save_reply_as_plan(
        &self,
        message_id: &str,
        title: &str,
        plan_id: &str,
        now: i64,
    ) -> Result<String, PlanningChatError>;
}

#[derive(Clone)]
pub(crate) struct PlanningChatUseCases<R, A, S, G> {
    repository: R,
    ai: AiUseCases<A, S, G>,
    purpose: AiCallPurpose,
}

impl<R: PlanningChatRepository, A: AiRepository, S: SecretStore, G: AiProviderGateway>
    PlanningChatUseCases<R, A, S, G>
{
    pub(crate) const fn new(repository: R, ai: AiUseCases<A, S, G>) -> Self {
        Self::with_purpose(repository, ai, AiCallPurpose::PlanningChat)
    }

    pub(crate) const fn new_chat(repository: R, ai: AiUseCases<A, S, G>) -> Self {
        Self::with_purpose(repository, ai, AiCallPurpose::GeneralChat)
    }

    const fn with_purpose(repository: R, ai: AiUseCases<A, S, G>, purpose: AiCallPurpose) -> Self {
        Self {
            repository,
            ai,
            purpose,
        }
    }

    pub(crate) fn list(&self) -> Result<Vec<PlanningConversation>, PlanningChatError> {
        self.repository.list_conversations()
    }

    pub(crate) fn create(&self, title: &str) -> Result<PlanningConversation, PlanningChatError> {
        let title = required_text(title, 120)?;
        self.repository.create_conversation(
            &Uuid::now_v7().to_string(),
            title,
            current_utc_millis()?,
        )
    }

    pub(crate) fn rename(
        &self,
        conversation_id: &str,
        title: &str,
    ) -> Result<PlanningConversation, PlanningChatError> {
        validate_id(conversation_id)?;
        let title = required_text(title, 120)?;
        self.repository
            .rename_conversation(conversation_id, title, current_utc_millis()?)
    }

    pub(crate) fn delete(&self, conversation_id: &str) -> Result<(), PlanningChatError> {
        validate_id(conversation_id)?;
        self.repository.delete_conversation(conversation_id)
    }

    pub(crate) fn list_attachments(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<AiAttachmentRef>, PlanningChatError> {
        validate_id(conversation_id)?;
        self.repository.list_attachments(conversation_id)
    }

    pub(crate) fn attach_resource(
        &self,
        conversation_id: &str,
        document_id: &str,
    ) -> Result<AiAttachmentRef, PlanningChatError> {
        validate_id(conversation_id)?;
        validate_id(document_id)?;
        self.repository.attach_resource(
            conversation_id,
            document_id,
            &Uuid::now_v7().to_string(),
            current_utc_millis()?,
        )
    }

    pub(crate) fn attach_temporary(
        &self,
        input: TemporaryAttachmentInput,
    ) -> Result<AiAttachmentRef, PlanningChatError> {
        validate_id(&input.conversation_id)?;
        validate_id(&input.attachment_id)?;
        if input.file_name.trim().is_empty()
            || input.file_name.chars().count() > 240
            || input.mime_type.trim().is_empty()
            || input.mime_type.chars().count() > 120
            || input.size_bytes > 104_857_600
            || input.sha256.len() != 64
            || !input.sha256.chars().all(|value| value.is_ascii_hexdigit())
        {
            return Err(PlanningChatError::AttachmentInvalid);
        }
        // Keep ownership explicit at this boundary; the repository consumes the
        // authorized handle only after all metadata has passed validation.
        let now = current_utc_millis()?;
        self.repository.attach_temporary(input, now)
    }

    pub(crate) fn remove_attachment(&self, attachment_id: &str) -> Result<(), PlanningChatError> {
        validate_id(attachment_id)?;
        self.repository.remove_attachment(attachment_id)
    }

    pub(crate) fn retry_attachment(
        &self,
        attachment_id: &str,
    ) -> Result<AiAttachmentRef, PlanningChatError> {
        validate_id(attachment_id)?;
        self.repository
            .retry_attachment(attachment_id, current_utc_millis()?)
    }

    /// Temporary attachments are request-scoped and must never survive an
    /// application restart as usable input. Startup marks any interrupted or
    /// previously ready temporary reference as expired before the UI can list
    /// the conversation attachments.
    pub(crate) fn expire_temporary_attachments(&self) -> Result<(), PlanningChatError> {
        self.repository
            .expire_temporary_attachments(current_utc_millis()?)
    }

    pub(crate) fn preview(
        &self,
        input: &PlanningChatInput,
    ) -> Result<PlanningChatPreview, PlanningChatError> {
        let (prompt, contexts, images, attachments) = self.compile_prompt(input)?;
        let mut preview = self.ai.preview_with_images_and_files(
            &AiPreviewInput {
                prompt,
                max_output_tokens: input.max_output_tokens,
            },
            &images,
            &attachments.files,
        )?;
        preview.allowed &= !attachments.blocked;
        Ok(PlanningChatPreview {
            preview,
            sources: contexts.into_iter().map(|context| context.source).collect(),
            transport: attachments.transport,
            attachments: attachments.attachments,
        })
    }

    #[allow(dead_code)]
    pub(crate) fn execute(
        &self,
        input: &ConfirmPlanningChatInput,
    ) -> Result<PlanningChatReply, PlanningChatError> {
        let canceled = AtomicBool::new(false);
        self.execute_with_cancel(input, &canceled)
    }

    pub(crate) fn execute_with_cancel(
        &self,
        input: &ConfirmPlanningChatInput,
        canceled: &AtomicBool,
    ) -> Result<PlanningChatReply, PlanningChatError> {
        let (prompt, contexts, images, attachments) = self.compile_prompt(&input.chat)?;
        if canceled.load(Ordering::Relaxed) {
            return Err(PlanningChatError::Canceled);
        }
        if attachments.blocked {
            return Err(PlanningChatError::AttachmentNotIndexed);
        }
        let preview = self.ai.preview_with_images_and_files(
            &AiPreviewInput {
                prompt: prompt.clone(),
                max_output_tokens: input.chat.max_output_tokens,
            },
            &images,
            &attachments.files,
        )?;
        if prompt != input.confirmed_prompt
            || preview.request_fingerprint != input.confirmed_request_fingerprint
        {
            return Err(PlanningChatError::PreviewStale);
        }
        if canceled.load(Ordering::Relaxed) {
            return Err(PlanningChatError::Canceled);
        }
        self.complete_exchange(
            &input.chat,
            prompt,
            &contexts,
            &images,
            &attachments.files,
            canceled,
        )
    }

    /// Generic chat intentionally skips the planning preview/confirmation
    /// contract. It still uses the same bounded context and attachment
    /// validation, but sends the message as a normal conversation turn.
    pub(crate) fn execute_direct_with_cancel(
        &self,
        input: &PlanningChatInput,
        canceled: &AtomicBool,
    ) -> Result<PlanningChatReply, PlanningChatError> {
        let (prompt, contexts, images, attachments) = self.compile_prompt(input)?;
        if canceled.load(Ordering::Relaxed) {
            return Err(PlanningChatError::Canceled);
        }
        if attachments.blocked {
            return Err(PlanningChatError::AttachmentNotIndexed);
        }
        self.complete_exchange(
            input,
            prompt,
            &contexts,
            &images,
            &attachments.files,
            canceled,
        )
    }

    pub(crate) fn execute_with_cancel_stream(
        &self,
        input: &ConfirmPlanningChatInput,
        canceled: &AtomicBool,
        on_chunk: &mut dyn FnMut(&str) -> Result<(), AiError>,
    ) -> Result<PlanningChatReply, PlanningChatError> {
        let (prompt, contexts, images, attachments) = self.compile_prompt(&input.chat)?;
        if canceled.load(Ordering::Relaxed) {
            return Err(PlanningChatError::Canceled);
        }
        if attachments.blocked {
            return Err(PlanningChatError::AttachmentNotIndexed);
        }
        let preview = self.ai.preview_with_images_and_files(
            &AiPreviewInput {
                prompt: prompt.clone(),
                max_output_tokens: input.chat.max_output_tokens,
            },
            &images,
            &attachments.files,
        )?;
        if prompt != input.confirmed_prompt
            || preview.request_fingerprint != input.confirmed_request_fingerprint
        {
            return Err(PlanningChatError::PreviewStale);
        }
        if canceled.load(Ordering::Relaxed) {
            return Err(PlanningChatError::Canceled);
        }
        self.complete_exchange_stream(
            &input.chat,
            prompt,
            &contexts,
            &images,
            &attachments.files,
            canceled,
            on_chunk,
        )
    }

    pub(crate) fn execute_direct_with_cancel_stream(
        &self,
        input: &PlanningChatInput,
        canceled: &AtomicBool,
        on_chunk: &mut dyn FnMut(&str) -> Result<(), AiError>,
    ) -> Result<PlanningChatReply, PlanningChatError> {
        let (prompt, contexts, images, attachments) = self.compile_prompt(input)?;
        if canceled.load(Ordering::Relaxed) {
            return Err(PlanningChatError::Canceled);
        }
        if attachments.blocked {
            return Err(PlanningChatError::AttachmentNotIndexed);
        }
        self.complete_exchange_stream(
            input,
            prompt,
            &contexts,
            &images,
            &attachments.files,
            canceled,
            on_chunk,
        )
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "Stream execution requires input, prompt, contexts, image/file attachments, cancellation flag, and chunk callback"
    )]
    fn complete_exchange_stream(
        &self,
        input: &PlanningChatInput,
        prompt: String,
        contexts: &[ResolvedPlanningContext],
        images: &[String],
        files: &[AiFileAttachment],
        canceled: &AtomicBool,
        on_chunk: &mut dyn FnMut(&str) -> Result<(), AiError>,
    ) -> Result<PlanningChatReply, PlanningChatError> {
        let result = self
            .ai
            .execute_for_images_and_files_stream(
                &AiPreviewInput {
                    prompt,
                    max_output_tokens: input.max_output_tokens,
                },
                images,
                files,
                self.purpose,
                Some(input.conversation_id.clone()),
                true,
                Some(canceled),
                on_chunk,
            )
            .map_err(|error| match error {
                AiError::Canceled => PlanningChatError::Canceled,
                error => PlanningChatError::Ai(error),
            })?;
        if canceled.load(Ordering::Relaxed) {
            return Err(PlanningChatError::Canceled);
        }
        let user_content = input.question.trim().to_owned();
        let conversation = self.repository.append_exchange(
            &input.conversation_id,
            &user_content,
            &result.response_text,
            &result.call_id,
            contexts,
            current_utc_millis()?,
        )?;
        Ok(PlanningChatReply {
            result,
            conversation,
        })
    }

    fn complete_exchange(
        &self,
        input: &PlanningChatInput,
        prompt: String,
        contexts: &[ResolvedPlanningContext],
        images: &[String],
        files: &[AiFileAttachment],
        canceled: &AtomicBool,
    ) -> Result<PlanningChatReply, PlanningChatError> {
        let result = self
            .ai
            .execute_for_images_and_files_with_cancel(
                &AiPreviewInput {
                    prompt,
                    max_output_tokens: input.max_output_tokens,
                },
                images,
                files,
                self.purpose,
                Some(input.conversation_id.clone()),
                true,
                canceled,
            )
            .map_err(|error| match error {
                AiError::Canceled => PlanningChatError::Canceled,
                error => PlanningChatError::Ai(error),
            })?;
        if canceled.load(Ordering::Relaxed) {
            return Err(PlanningChatError::Canceled);
        }
        let user_content = input.question.trim().to_owned();
        let conversation = self.repository.append_exchange(
            &input.conversation_id,
            &user_content,
            &result.response_text,
            &result.call_id,
            contexts,
            current_utc_millis()?,
        )?;
        Ok(PlanningChatReply {
            result,
            conversation,
        })
    }

    pub(crate) fn save_reply_as_plan(
        &self,
        message_id: &str,
        title: &str,
    ) -> Result<String, PlanningChatError> {
        validate_id(message_id)?;
        let title = required_text(title, 120)?;
        self.repository.save_reply_as_plan(
            message_id,
            title,
            &Uuid::now_v7().to_string(),
            current_utc_millis()?,
        )
    }

    fn compile_prompt(
        &self,
        input: &PlanningChatInput,
    ) -> Result<
        (
            String,
            Vec<ResolvedPlanningContext>,
            Vec<String>,
            PlanningAttachmentPlan,
        ),
        PlanningChatError,
    > {
        validate_id(&input.conversation_id)?;
        let question = required_text(&input.question, MAXIMUM_QUESTION_CHARS)?;
        if input.contexts.len() > MAXIMUM_CONTEXTS {
            return Err(PlanningChatError::InvalidInput);
        }
        if input.max_output_tokens == 0 {
            return Err(PlanningChatError::InvalidInput);
        }
        let mut images = input.image_data_urls.clone();
        if let Some(question_context) = input.question_context.as_ref() {
            validate_question_context(question_context)?;
            images.extend(question_context.image_data_urls.clone());
        }
        if images.len() > MAXIMUM_QUESTION_IMAGES {
            return Err(PlanningChatError::InvalidInput);
        }
        let history = self
            .repository
            .load_history(&input.conversation_id, MAXIMUM_HISTORY_MESSAGES)?;
        let contexts = self.repository.resolve_contexts(&input.contexts)?;
        let attachments = self.resolve_attachments(input)?;
        let prompt = if self.purpose == AiCallPurpose::GeneralChat {
            build_general_prompt(
                &history,
                &contexts,
                question,
                input.question_context.as_ref(),
                &attachments.prompt_sections,
            )
        } else {
            build_prompt(
                &history,
                &contexts,
                question,
                input.question_context.as_ref(),
                &attachments.prompt_sections,
            )
        };
        Ok((prompt, contexts, images, attachments))
    }

    fn resolve_attachments(
        &self,
        input: &PlanningChatInput,
    ) -> Result<PlanningAttachmentPlan, PlanningChatError> {
        if input.attachment_ids.len() > MAXIMUM_ATTACHMENTS {
            return Err(PlanningChatError::InvalidInput);
        }
        if input.attachment_ids.is_empty() {
            return Ok(PlanningAttachmentPlan {
                transport: "none".to_owned(),
                attachments: Vec::new(),
                prompt_sections: Vec::new(),
                files: Vec::new(),
                blocked: false,
            });
        }
        let configured = self.repository.list_attachments(&input.conversation_id)?;
        let (provider_type, capabilities) = self.ai.active_model_transport()?;
        let mut seen = std::collections::HashSet::new();
        let mut previews = Vec::with_capacity(input.attachment_ids.len());
        let mut prompt_sections = Vec::new();
        let mut files = Vec::new();
        let mut blocked = false;
        for attachment_id in &input.attachment_ids {
            validate_id(attachment_id)?;
            if !seen.insert(attachment_id) {
                return Err(PlanningChatError::InvalidInput);
            }
            let attachment = configured
                .iter()
                .find(|entry| entry.id == *attachment_id)
                .ok_or(PlanningChatError::AttachmentNotFound)?;
            let mut warning = None;
            let mut indexed_pages = None;
            let mut transport = "local_text";
            if attachment.source == "temporary" {
                transport = "native_file";
                if attachment.status != "ready" {
                    warning = Some("电脑资料已过期，请重新选择文件".to_owned());
                    blocked = true;
                } else if !native_file_supported(provider_type, capabilities, &attachment.mime_type)
                {
                    warning = Some(native_file_capability_warning(
                        provider_type,
                        capabilities,
                        &attachment.mime_type,
                    ));
                    blocked = true;
                } else {
                    match self
                        .repository
                        .resolve_temporary_attachment_file(&attachment.id)?
                    {
                        Some(file) => files.push(AiFileAttachment {
                            file_name: file.file_name,
                            mime_type: file.mime_type,
                            path: file.path,
                            size_bytes: file.size_bytes,
                            sha256: file.sha256,
                        }),
                        None => return Err(PlanningChatError::AttachmentTemporaryNotFound),
                    }
                }
            } else if attachment.status != "ready" || attachment.document_id.is_none() {
                warning = Some("本地资料尚未完成索引，当前不会发送原始文件".to_owned());
                blocked = true;
            } else if let Some(document_id) = attachment.document_id.as_deref() {
                match self.repository.resolve_attachment_text(document_id)? {
                    Some(resolved) if !resolved.text.trim().is_empty() => {
                        indexed_pages = Some(resolved.indexed_pages);
                        prompt_sections.push(format!(
                            "{}（已索引 {} 页）：\n{}",
                            attachment.file_name,
                            resolved.indexed_pages,
                            trim_chars(&resolved.text, MAXIMUM_ATTACHMENT_TEXT_CHARS),
                        ));
                    }
                    _ => {
                        warning = Some("本地资料尚未建立可用文本索引，暂时无法发送".to_owned());
                        blocked = true;
                    }
                }
            }
            previews.push(PlanningAttachmentPreview {
                id: attachment.id.clone(),
                file_name: attachment.file_name.clone(),
                transport: transport.to_owned(),
                indexed_pages,
                warning,
            });
        }
        let transport = attachment_transport(&previews);
        Ok(PlanningAttachmentPlan {
            transport,
            attachments: previews,
            prompt_sections,
            files,
            blocked,
        })
    }
}

fn native_file_supported(
    provider_type: AiProviderType,
    capabilities: crate::domain::AiModelCapabilities,
    mime_type: &str,
) -> bool {
    if provider_type != AiProviderType::OpenAiResponses {
        return false;
    }
    if is_pdf_like(mime_type) {
        capabilities.supports_pdf == AiCapabilityState::Supported
    } else {
        capabilities.supports_file == AiCapabilityState::Supported
    }
}

fn native_file_capability_warning(
    provider_type: AiProviderType,
    capabilities: crate::domain::AiModelCapabilities,
    mime_type: &str,
) -> String {
    if provider_type != AiProviderType::OpenAiResponses {
        return "当前 Provider 未提供原生文件传输协议，请在资料库建立索引后发送".to_owned();
    }
    if is_pdf_like(mime_type) && capabilities.supports_pdf != AiCapabilityState::Supported {
        return "当前模型未确认支持原生 PDF，请在模型设置中校准能力后重试".to_owned();
    }
    "当前模型未确认支持原生文件，请在模型设置中校准能力后重试".to_owned()
}

fn attachment_transport(attachments: &[PlanningAttachmentPreview]) -> String {
    let Some(first) = attachments.first() else {
        return "none".to_owned();
    };
    if attachments
        .iter()
        .all(|attachment| attachment.transport == first.transport)
    {
        first.transport.clone()
    } else {
        "mixed".to_owned()
    }
}

fn build_prompt(
    history: &[PlanningMessage],
    contexts: &[ResolvedPlanningContext],
    question: &str,
    question_context: Option<&PlanningQuestionContext>,
    attachment_sections: &[String],
) -> String {
    let mut prompt = String::from(
        "你是 KyStudy 的考研规划助手。只提供可核对的建议，不替用户修改任何正式学习数据。\n引用资料时使用对应的 [资料N] 标签；资料不足时明确说明，不得编造页码。\n",
    );
    if !contexts.is_empty() {
        prompt.push_str("\n本轮用户明确选择的资料：\n");
        for context in contexts {
            prompt.push_str(&context.source.citation_label);
            prompt.push(' ');
            prompt.push_str(&context.source.document_title);
            prompt.push_str(" 第 ");
            prompt.push_str(&context.source.page_number.to_string());
            prompt.push_str(" 页\n");
            prompt.push_str(&trim_chars(&context.text, MAXIMUM_CONTEXT_CHARS));
            prompt.push('\n');
        }
    }
    if let Some(question_context) = question_context {
        prompt.push_str("\n当前题目上下文（仅用于本次调用，不写入对话附件）：\n");
        prompt.push_str("题目：");
        prompt.push_str(&question_context.title);
        prompt.push_str("\n来源：");
        prompt.push_str(&question_context.document_title);
        prompt.push('\n');
        if let Some(analysis) = question_context.analysis.as_deref() {
            prompt.push_str("当前解析：\n");
            prompt.push_str(&trim_chars(analysis, MAXIMUM_QUESTION_CONTEXT_CHARS));
            prompt.push('\n');
        }
        if !question_context.image_data_urls.is_empty() {
            prompt.push_str("已附加题目图片，按图片顺序理解题目区域。\n");
        }
    }
    if !attachment_sections.is_empty() {
        prompt.push_str("\n用户绑定的本地资料（仅使用已建立的本地索引文本）：\n");
        for (index, section) in attachment_sections.iter().enumerate() {
            let _ = writeln!(prompt, "[附件{}] {section}", index + 1);
        }
    }
    if !history.is_empty() {
        prompt.push_str("\n最近对话：\n");
        let mut remaining = MAXIMUM_HISTORY_CHARS;
        let mut entries = Vec::new();
        for message in history {
            if remaining == 0 {
                break;
            }
            let content = trim_chars(&message.content, remaining.min(1_500));
            remaining = remaining.saturating_sub(content.chars().count());
            let role = if message.role == "user" {
                "用户"
            } else {
                "助手"
            };
            entries.push(format!("{role}：{content}\n"));
        }
        for entry in entries.iter().rev() {
            prompt.push_str(entry);
        }
    }
    prompt.push_str("\n本轮问题：\n");
    prompt.push_str(question);
    prompt.push_str("\n\n请用中文回答，并给出可执行但需要用户确认的规划建议。");
    prompt
}

fn build_general_prompt(
    history: &[PlanningMessage],
    contexts: &[ResolvedPlanningContext],
    question: &str,
    question_context: Option<&PlanningQuestionContext>,
    attachment_sections: &[String],
) -> String {
    let mut prompt = String::new();
    if !contexts.is_empty() {
        prompt.push_str("资料：\n");
        for context in contexts {
            let _ = writeln!(
                prompt,
                "{} {} 第 {} 页\n{}",
                context.source.citation_label,
                context.source.document_title,
                context.source.page_number,
                trim_chars(&context.text, MAXIMUM_CONTEXT_CHARS),
            );
        }
    }
    if let Some(question_context) = question_context {
        prompt.push_str("题目：");
        prompt.push_str(&question_context.title);
        prompt.push_str("\n来源：");
        prompt.push_str(&question_context.document_title);
        prompt.push('\n');
        if let Some(analysis) = question_context.analysis.as_deref() {
            prompt.push_str("解析：\n");
            prompt.push_str(&trim_chars(analysis, MAXIMUM_QUESTION_CONTEXT_CHARS));
            prompt.push('\n');
        }
        if !question_context.image_data_urls.is_empty() {
            prompt.push_str("题目图片已附加。\n");
        }
    }
    if !attachment_sections.is_empty() {
        prompt.push_str("附件：\n");
        for section in attachment_sections {
            let _ = writeln!(prompt, "{section}");
        }
    }
    if !history.is_empty() {
        prompt.push_str("对话记录：\n");
        let mut remaining = MAXIMUM_HISTORY_CHARS;
        let mut entries = Vec::new();
        for message in history {
            if remaining == 0 {
                break;
            }
            let content = trim_chars(&message.content, remaining.min(1_500));
            remaining = remaining.saturating_sub(content.chars().count());
            let role = if message.role == "user" {
                "用户"
            } else {
                "助手"
            };
            entries.push(format!("{role}：{content}\n"));
        }
        for entry in entries.iter().rev() {
            prompt.push_str(entry);
        }
    }
    prompt.push_str(question);
    prompt
}

fn validate_question_context(context: &PlanningQuestionContext) -> Result<(), PlanningChatError> {
    if context.title.trim().is_empty()
        || context.title.chars().count() > 300
        || context.document_title.trim().is_empty()
        || context.document_title.chars().count() > 300
        || context.image_data_urls.len() > MAXIMUM_QUESTION_IMAGES
        || context
            .analysis
            .as_deref()
            .is_some_and(|value| value.chars().count() > MAXIMUM_QUESTION_CONTEXT_CHARS)
    {
        return Err(PlanningChatError::InvalidInput);
    }
    Ok(())
}

fn required_text(value: &str, maximum: usize) -> Result<&str, PlanningChatError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum {
        Err(PlanningChatError::InvalidInput)
    } else {
        Ok(value)
    }
}

fn validate_id(value: &str) -> Result<(), PlanningChatError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| PlanningChatError::InvalidInput)
}

fn is_pdf_like(mime_type: &str) -> bool {
    mime_type.eq_ignore_ascii_case("application/pdf")
        || mime_type.to_ascii_lowercase().ends_with("+pdf")
}

pub(crate) fn trim_chars(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

pub(crate) fn context_token_estimate(value: &str) -> u64 {
    estimate_tokens(value)
}

#[cfg(test)]
mod tests {
    use super::{
        PlanningMessage, PlanningQuestionContext, build_prompt, trim_chars,
        validate_question_context,
    };

    #[test]
    fn prompt_keeps_only_bounded_recent_history() {
        let history = vec![PlanningMessage {
            id: "message".to_owned(),
            role: "user".to_owned(),
            content: "甲".repeat(8_000),
            sources: Vec::new(),
            created_at: 1,
        }];

        let prompt = build_prompt(&history, &[], "如何安排强化阶段？", None, &[]);

        assert!(prompt.chars().count() < 8_000);
        assert!(prompt.contains("如何安排强化阶段？"));
    }

    #[test]
    fn character_trimming_preserves_unicode_boundaries() {
        assert_eq!(trim_chars("考研规划", 2), "考研");
    }

    #[test]
    fn question_context_is_bounded_and_images_are_not_prompt_text() {
        let context = PlanningQuestionContext {
            title: "题目标题".to_owned(),
            document_title: "资料.pdf".to_owned(),
            analysis: Some("当前解析".to_owned()),
            image_data_urls: vec!["data:image/png;base64,AAA".to_owned()],
        };
        validate_question_context(&context).expect("question context should be valid");
        let prompt = build_prompt(&[], &[], "继续讲解", Some(&context), &[]);
        assert!(prompt.contains("题目标题"));
        assert!(prompt.contains("当前解析"));
        assert!(!prompt.contains("data:image/png"));

        let too_many_images = PlanningQuestionContext {
            image_data_urls: vec!["image".to_owned(); 17],
            ..context
        };
        assert!(validate_question_context(&too_many_images).is_err());
    }

    #[test]
    fn general_chat_prompt_does_not_add_planning_instructions() {
        let prompt = super::build_general_prompt(&[], &[], "你好", None, &[]);

        assert_eq!(prompt, "你好");
        assert!(!prompt.contains("KyStudy"));
        assert!(!prompt.contains("规划建议"));
    }
}
