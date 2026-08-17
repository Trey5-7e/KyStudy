/// Provider protocols supported by the AI foundation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AiProviderType {
    OfflineTest,
    OpenAiResponses,
    ZhipuChat,
    QwenChat,
    DoubaoResponses,
    DeepSeekChat,
}

impl AiProviderType {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::OfflineTest => "offline_test",
            Self::OpenAiResponses => "openai_responses",
            Self::ZhipuChat => "zhipu_chat",
            Self::QwenChat => "qwen_chat",
            Self::DoubaoResponses => "doubao_responses",
            Self::DeepSeekChat => "deepseek_chat",
        }
    }

    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "offline_test" => Some(Self::OfflineTest),
            "openai_responses" => Some(Self::OpenAiResponses),
            "zhipu_chat" => Some(Self::ZhipuChat),
            "qwen_chat" => Some(Self::QwenChat),
            "doubao_responses" => Some(Self::DoubaoResponses),
            "deepseek_chat" => Some(Self::DeepSeekChat),
            _ => None,
        }
    }

    pub(crate) const fn is_remote(self) -> bool {
        !matches!(self, Self::OfflineTest)
    }
}

/// Non-sensitive provider configuration persisted in the workspace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiProviderConfig {
    pub(crate) id: String,
    pub(crate) provider_type: AiProviderType,
    pub(crate) display_name: String,
    pub(crate) base_url: Option<String>,
    pub(crate) secret_ref: Option<String>,
    pub(crate) enabled: bool,
    pub(crate) updated_at: i64,
}

/// Model limits associated with one provider configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiModelProfile {
    pub(crate) id: String,
    pub(crate) provider_config_id: String,
    pub(crate) model_name: String,
    pub(crate) context_limit: u32,
    pub(crate) max_output_tokens: u32,
    pub(crate) updated_at: i64,
}

/// Workspace token budget. Currency estimates remain out of M8.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiBudget {
    pub(crate) single_call_limit: u64,
    pub(crate) daily_token_limit: u64,
    pub(crate) monthly_token_limit: u64,
    pub(crate) limit_mode: String,
    pub(crate) updated_at: i64,
}

/// Aggregated usage for the current local day and month.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct AiUsageSummary {
    pub(crate) today_tokens: u64,
    pub(crate) month_tokens: u64,
}

/// One sanitized AI call history item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiCallSummary {
    pub(crate) id: String,
    pub(crate) provider_name: String,
    pub(crate) model_name: String,
    pub(crate) state: String,
    pub(crate) cache_hit: bool,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) error_code: Option<String>,
    pub(crate) started_at: i64,
    pub(crate) finished_at: Option<i64>,
}
