use uuid::Uuid;

use super::{
    AiCallPreview, AiCallPurpose, AiCallResult, AiError, AiPreviewInput, AiProviderGateway,
    AiRepository, AiUseCases, PersistenceError, SecretStore, current_utc_millis, estimate_tokens,
};

const MAXIMUM_CONTEXTS: usize = 6;
const MAXIMUM_HISTORY_MESSAGES: u32 = 8;
const MAXIMUM_CONTEXT_CHARS: usize = 1_200;
const MAXIMUM_HISTORY_CHARS: usize = 6_000;
const MAXIMUM_OUTPUT_TOKENS: u32 = 1_800;

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
    pub(crate) max_output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConfirmPlanningChatInput {
    pub(crate) chat: PlanningChatInput,
    pub(crate) confirmed_prompt: String,
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
    pub(crate) messages: Vec<PlanningMessage>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResolvedPlanningContext {
    pub(crate) source: PlanningSource,
    pub(crate) text: String,
    pub(crate) content_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PlanningChatPreview {
    pub(crate) preview: AiCallPreview,
    pub(crate) sources: Vec<PlanningSource>,
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
}

impl<R: PlanningChatRepository, A: AiRepository, S: SecretStore, G: AiProviderGateway>
    PlanningChatUseCases<R, A, S, G>
{
    pub(crate) const fn new(repository: R, ai: AiUseCases<A, S, G>) -> Self {
        Self { repository, ai }
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

    pub(crate) fn preview(
        &self,
        input: &PlanningChatInput,
    ) -> Result<PlanningChatPreview, PlanningChatError> {
        let (prompt, contexts) = self.compile_prompt(input)?;
        let preview = self.ai.preview(&AiPreviewInput {
            prompt,
            max_output_tokens: input.max_output_tokens,
        })?;
        Ok(PlanningChatPreview {
            preview,
            sources: contexts.into_iter().map(|context| context.source).collect(),
        })
    }

    pub(crate) fn execute(
        &self,
        input: &ConfirmPlanningChatInput,
    ) -> Result<PlanningChatReply, PlanningChatError> {
        let (prompt, contexts) = self.compile_prompt(&input.chat)?;
        if prompt != input.confirmed_prompt {
            return Err(PlanningChatError::PreviewStale);
        }
        let result = self.ai.execute_for(
            &AiPreviewInput {
                prompt,
                max_output_tokens: input.chat.max_output_tokens,
            },
            AiCallPurpose::PlanningChat,
            Some(input.chat.conversation_id.clone()),
        )?;
        let conversation = self.repository.append_exchange(
            &input.chat.conversation_id,
            input.chat.question.trim(),
            &result.response_text,
            &result.call_id,
            &contexts,
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
    ) -> Result<(String, Vec<ResolvedPlanningContext>), PlanningChatError> {
        validate_id(&input.conversation_id)?;
        let question = required_text(&input.question, 4_000)?;
        if input.contexts.len() > MAXIMUM_CONTEXTS {
            return Err(PlanningChatError::InvalidInput);
        }
        if input.max_output_tokens == 0 || input.max_output_tokens > MAXIMUM_OUTPUT_TOKENS {
            return Err(PlanningChatError::InvalidInput);
        }
        let history = self
            .repository
            .load_history(&input.conversation_id, MAXIMUM_HISTORY_MESSAGES)?;
        let contexts = self.repository.resolve_contexts(&input.contexts)?;
        let prompt = build_prompt(&history, &contexts, question);
        Ok((prompt, contexts))
    }
}

fn build_prompt(
    history: &[PlanningMessage],
    contexts: &[ResolvedPlanningContext],
    question: &str,
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

pub(crate) fn trim_chars(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

pub(crate) fn context_token_estimate(value: &str) -> u64 {
    estimate_tokens(value)
}

#[cfg(test)]
mod tests {
    use super::{PlanningMessage, build_prompt, trim_chars};

    #[test]
    fn prompt_keeps_only_bounded_recent_history() {
        let history = vec![PlanningMessage {
            id: "message".to_owned(),
            role: "user".to_owned(),
            content: "甲".repeat(8_000),
            sources: Vec::new(),
            created_at: 1,
        }];

        let prompt = build_prompt(&history, &[], "如何安排强化阶段？");

        assert!(prompt.chars().count() < 8_000);
        assert!(prompt.contains("如何安排强化阶段？"));
    }

    #[test]
    fn character_trimming_preserves_unicode_boundaries() {
        assert_eq!(trim_chars("考研规划", 2), "考研");
    }
}
