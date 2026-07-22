use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::{PersistenceError, current_utc_millis};
use crate::domain::{
    AiBudget, AiCallSummary, AiModelProfile, AiProviderConfig, AiProviderType, AiUsageSummary,
};

const MAX_PROMPT_CHARS: usize = 20_000;
const DEFAULT_CONTEXT_LIMIT: u32 = 128_000;
const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 800;
const DEFAULT_SINGLE_LIMIT: u64 = 8_000;
const DEFAULT_DAILY_LIMIT: u64 = 50_000;
const DEFAULT_MONTHLY_LIMIT: u64 = 1_000_000;
const CHINA_OFFSET_MILLIS: i64 = 8 * 60 * 60 * 1_000;
const DAY_MILLIS: i64 = 24 * 60 * 60 * 1_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SaveAiProviderInput {
    pub(crate) provider_type: String,
    pub(crate) display_name: String,
    pub(crate) base_url: Option<String>,
    pub(crate) model_name: String,
    pub(crate) context_limit: u32,
    pub(crate) max_output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SaveAiBudgetInput {
    pub(crate) single_call_limit: u64,
    pub(crate) daily_token_limit: u64,
    pub(crate) monthly_token_limit: u64,
    pub(crate) limit_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiPreviewInput {
    pub(crate) prompt: String,
    pub(crate) max_output_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiOverview {
    pub(crate) provider: AiProviderConfig,
    pub(crate) model: AiModelProfile,
    pub(crate) budget: AiBudget,
    pub(crate) usage: AiUsageSummary,
    pub(crate) has_secret: bool,
    pub(crate) calls: Vec<AiCallSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiCallPreview {
    pub(crate) provider_name: String,
    pub(crate) provider_type: AiProviderType,
    pub(crate) model_name: String,
    pub(crate) destination: String,
    pub(crate) prompt: String,
    pub(crate) input_token_estimate: u64,
    pub(crate) output_token_limit: u32,
    pub(crate) projected_tokens: u64,
    pub(crate) today_tokens: u64,
    pub(crate) month_tokens: u64,
    pub(crate) allowed: bool,
    pub(crate) warnings: Vec<String>,
    pub(crate) request_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiCallResult {
    pub(crate) call_id: String,
    pub(crate) response_text: String,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) cached_input_tokens: u64,
    pub(crate) reasoning_tokens: u64,
    pub(crate) usage_source: String,
    pub(crate) cache_hit: bool,
    pub(crate) finished_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiProviderResponse {
    pub(crate) text: String,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) cached_input_tokens: u64,
    pub(crate) reasoning_tokens: u64,
    pub(crate) usage_source: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AiCachedResponse {
    pub(crate) text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BeginAiCall {
    pub(crate) id: String,
    pub(crate) provider_id: String,
    pub(crate) model_id: String,
    pub(crate) request_fingerprint: String,
    pub(crate) input_token_estimate: u64,
    pub(crate) output_token_limit: u32,
    pub(crate) cache_hit: bool,
    pub(crate) started_at: i64,
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum AiError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("AI configuration was not found")]
    ConfigurationNotFound,
    #[error("AI input is invalid")]
    InvalidInput,
    #[error("AI token budget blocks this call")]
    BudgetBlocked,
    #[error("AI secret is missing")]
    SecretMissing,
    #[error("secure secret storage is unavailable")]
    SecretStoreUnavailable,
    #[error("AI provider rejected authentication")]
    ProviderAuthentication,
    #[error("AI provider rate limit was reached")]
    ProviderRateLimited,
    #[error("AI provider is unavailable")]
    ProviderUnavailable,
    #[error("AI provider returned an invalid response")]
    ProviderInvalidResponse,
    #[error("AI provider rejected the request")]
    ProviderRejected,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl AiError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::ConfigurationNotFound => "AI_CONFIGURATION_NOT_FOUND",
            Self::InvalidInput => "AI_INPUT_INVALID",
            Self::BudgetBlocked => "AI_BUDGET_BLOCKED",
            Self::SecretMissing => "AI_SECRET_MISSING",
            Self::SecretStoreUnavailable => "AI_SECRET_STORE_UNAVAILABLE",
            Self::ProviderAuthentication => "AI_PROVIDER_AUTHENTICATION_FAILED",
            Self::ProviderRateLimited => "AI_PROVIDER_RATE_LIMITED",
            Self::ProviderUnavailable => "AI_PROVIDER_UNAVAILABLE",
            Self::ProviderInvalidResponse => "AI_PROVIDER_RESPONSE_INVALID",
            Self::ProviderRejected => "AI_PROVIDER_REQUEST_REJECTED",
            Self::Persistence(error) => error.code(),
        }
    }
}

pub(crate) trait AiRepository: Clone + Send + Sync + 'static {
    fn recover_pending(&self, finished_at: i64) -> Result<u64, AiError>;
    fn ensure_defaults(&self, now: i64) -> Result<(), AiError>;
    fn load_configuration(&self) -> Result<(AiProviderConfig, AiModelProfile, AiBudget), AiError>;
    fn save_provider(
        &self,
        provider: &AiProviderConfig,
        model: &AiModelProfile,
    ) -> Result<(), AiError>;
    fn save_budget(&self, budget: &AiBudget) -> Result<(), AiError>;
    fn aggregate_usage(&self, day_start: i64, month_start: i64) -> Result<AiUsageSummary, AiError>;
    fn list_calls(&self, limit: u32) -> Result<Vec<AiCallSummary>, AiError>;
    fn find_cache(&self, fingerprint: &str) -> Result<Option<AiCachedResponse>, AiError>;
    fn begin_call(&self, call: &BeginAiCall) -> Result<(), AiError>;
    fn finish_call(
        &self,
        call_id: &str,
        fingerprint: &str,
        response: &AiProviderResponse,
        cache_hit: bool,
        finished_at: i64,
    ) -> Result<(), AiError>;
    fn fail_call(&self, call_id: &str, code: &str, finished_at: i64) -> Result<(), AiError>;
}

pub(crate) trait SecretStore: Clone + Send + Sync + 'static {
    fn has(&self, reference: &str) -> Result<bool, AiError>;
    fn get(&self, reference: &str) -> Result<Option<String>, AiError>;
    fn set(&self, reference: &str, secret: &str) -> Result<(), AiError>;
    fn delete(&self, reference: &str) -> Result<(), AiError>;
}

pub(crate) trait AiProviderGateway: Clone + Send + Sync + 'static {
    fn execute(
        &self,
        provider: &AiProviderConfig,
        model: &AiModelProfile,
        prompt: &str,
        max_output_tokens: u32,
        secret: Option<&str>,
    ) -> Result<AiProviderResponse, AiError>;
}

#[derive(Clone)]
pub(crate) struct AiUseCases<R, S, G> {
    repository: R,
    secrets: S,
    gateway: G,
}

impl<R: AiRepository, S: SecretStore, G: AiProviderGateway> AiUseCases<R, S, G> {
    pub(crate) const fn new(repository: R, secrets: S, gateway: G) -> Self {
        Self {
            repository,
            secrets,
            gateway,
        }
    }

    pub(crate) fn recover_interrupted(&self) -> Result<u64, AiError> {
        self.repository.recover_pending(current_utc_millis()?)
    }

    pub(crate) fn overview(&self) -> Result<AiOverview, AiError> {
        let now = current_utc_millis()?;
        self.repository.ensure_defaults(now)?;
        let (provider, model, budget) = self.repository.load_configuration()?;
        let (day_start, month_start) = usage_period_starts(now);
        let usage = self.repository.aggregate_usage(day_start, month_start)?;
        let has_secret = match provider.secret_ref.as_deref() {
            Some(reference) => self.secrets.has(reference)?,
            None => false,
        };
        Ok(AiOverview {
            provider,
            model,
            budget,
            usage,
            has_secret,
            calls: self.repository.list_calls(20)?,
        })
    }

    pub(crate) fn save_provider(&self, input: &SaveAiProviderInput) -> Result<AiOverview, AiError> {
        let provider_type =
            AiProviderType::parse(input.provider_type.trim()).ok_or(AiError::InvalidInput)?;
        let display_name = input.display_name.trim();
        let model_name = input.model_name.trim();
        if display_name.is_empty()
            || display_name.chars().count() > 80
            || model_name.is_empty()
            || model_name.chars().count() > 120
            || !(1_024..=2_000_000).contains(&input.context_limit)
            || !(1..=131_072).contains(&input.max_output_tokens)
            || input.max_output_tokens >= input.context_limit
        {
            return Err(AiError::InvalidInput);
        }
        let now = current_utc_millis()?;
        self.repository.ensure_defaults(now)?;
        let (existing, existing_model, _) = self.repository.load_configuration()?;
        let (base_url, secret_ref) = match provider_type {
            AiProviderType::OfflineTest => (None, None),
            AiProviderType::OpenAiResponses => {
                let base_url = normalize_base_url(input.base_url.as_deref())?;
                let reference = existing.secret_ref.unwrap_or_else(|| existing.id.clone());
                (Some(base_url), Some(reference))
            }
        };
        let provider = AiProviderConfig {
            id: existing.id,
            provider_type,
            display_name: display_name.to_owned(),
            base_url,
            secret_ref,
            enabled: true,
            updated_at: now,
        };
        let model = AiModelProfile {
            id: existing_model.id,
            provider_config_id: provider.id.clone(),
            model_name: model_name.to_owned(),
            context_limit: input.context_limit,
            max_output_tokens: input.max_output_tokens,
            updated_at: now,
        };
        self.repository.save_provider(&provider, &model)?;
        self.overview()
    }

    pub(crate) fn save_budget(&self, input: &SaveAiBudgetInput) -> Result<AiOverview, AiError> {
        if input.single_call_limit == 0
            || input.daily_token_limit < input.single_call_limit
            || input.monthly_token_limit < input.daily_token_limit
            || input.single_call_limit > 2_000_000
            || input.daily_token_limit > 100_000_000
            || input.monthly_token_limit > 1_000_000_000
            || !matches!(input.limit_mode.as_str(), "warn" | "block")
        {
            return Err(AiError::InvalidInput);
        }
        self.repository.ensure_defaults(current_utc_millis()?)?;
        self.repository.save_budget(&AiBudget {
            single_call_limit: input.single_call_limit,
            daily_token_limit: input.daily_token_limit,
            monthly_token_limit: input.monthly_token_limit,
            limit_mode: input.limit_mode.clone(),
            updated_at: current_utc_millis()?,
        })?;
        self.overview()
    }

    pub(crate) fn set_secret(&self, secret: &str) -> Result<AiOverview, AiError> {
        let secret = secret.trim();
        if secret.is_empty() || secret.chars().count() > 4_096 {
            return Err(AiError::InvalidInput);
        }
        self.repository.ensure_defaults(current_utc_millis()?)?;
        let (provider, _, _) = self.repository.load_configuration()?;
        let reference = provider.secret_ref.ok_or(AiError::InvalidInput)?;
        self.secrets.set(&reference, secret)?;
        self.overview()
    }

    pub(crate) fn delete_secret(&self) -> Result<AiOverview, AiError> {
        self.repository.ensure_defaults(current_utc_millis()?)?;
        let (provider, _, _) = self.repository.load_configuration()?;
        if let Some(reference) = provider.secret_ref {
            self.secrets.delete(&reference)?;
        }
        self.overview()
    }

    pub(crate) fn preview(&self, input: &AiPreviewInput) -> Result<AiCallPreview, AiError> {
        let prompt = normalize_prompt(&input.prompt)?;
        self.repository.ensure_defaults(current_utc_millis()?)?;
        let (provider, model, budget) = self.repository.load_configuration()?;
        if input.max_output_tokens == 0
            || input.max_output_tokens > model.max_output_tokens
            || u64::from(input.max_output_tokens) >= u64::from(model.context_limit)
        {
            return Err(AiError::InvalidInput);
        }
        let input_token_estimate = estimate_tokens(&prompt);
        let projected_tokens = input_token_estimate + u64::from(input.max_output_tokens);
        if projected_tokens >= u64::from(model.context_limit) {
            return Err(AiError::InvalidInput);
        }
        let now = current_utc_millis()?;
        let (day_start, month_start) = usage_period_starts(now);
        let usage = self.repository.aggregate_usage(day_start, month_start)?;
        let warnings = budget_warnings(&budget, &usage, projected_tokens);
        let allowed = budget.limit_mode != "block" || warnings.is_empty();
        let destination = destination_label(&provider);
        let request_fingerprint = request_fingerprint(
            provider.provider_type,
            provider.base_url.as_deref(),
            &model.model_name,
            &prompt,
            input.max_output_tokens,
        );
        Ok(AiCallPreview {
            provider_name: provider.display_name,
            provider_type: provider.provider_type,
            model_name: model.model_name,
            destination,
            prompt,
            input_token_estimate,
            output_token_limit: input.max_output_tokens,
            projected_tokens,
            today_tokens: usage.today_tokens,
            month_tokens: usage.month_tokens,
            allowed,
            warnings,
            request_fingerprint,
        })
    }

    pub(crate) fn execute(&self, input: &AiPreviewInput) -> Result<AiCallResult, AiError> {
        let preview = self.preview(input)?;
        if !preview.allowed {
            return Err(AiError::BudgetBlocked);
        }
        let (provider, model, _) = self.repository.load_configuration()?;
        let started_at = current_utc_millis()?;
        let call_id = Uuid::now_v7().to_string();
        if let Some(cached) = self.repository.find_cache(&preview.request_fingerprint)? {
            let call = BeginAiCall {
                id: call_id.clone(),
                provider_id: provider.id,
                model_id: model.id,
                request_fingerprint: preview.request_fingerprint.clone(),
                input_token_estimate: preview.input_token_estimate,
                output_token_limit: input.max_output_tokens,
                cache_hit: true,
                started_at,
            };
            self.repository.begin_call(&call)?;
            let response = AiProviderResponse {
                text: cached.text,
                input_tokens: 0,
                output_tokens: 0,
                cached_input_tokens: 0,
                reasoning_tokens: 0,
                usage_source: "cache".to_owned(),
            };
            let finished_at = current_utc_millis()?;
            self.repository.finish_call(
                &call_id,
                &preview.request_fingerprint,
                &response,
                true,
                finished_at,
            )?;
            return Ok(result_from_response(call_id, response, true, finished_at));
        }

        let secret = match provider.secret_ref.as_deref() {
            Some(reference) => self.secrets.get(reference)?,
            None => None,
        };
        let call = BeginAiCall {
            id: call_id.clone(),
            provider_id: provider.id.clone(),
            model_id: model.id.clone(),
            request_fingerprint: preview.request_fingerprint.clone(),
            input_token_estimate: preview.input_token_estimate,
            output_token_limit: input.max_output_tokens,
            cache_hit: false,
            started_at,
        };
        self.repository.begin_call(&call)?;
        let response = self.gateway.execute(
            &provider,
            &model,
            &preview.prompt,
            input.max_output_tokens,
            secret.as_deref(),
        );
        let finished_at = current_utc_millis()?;
        match response {
            Ok(response) => {
                self.repository.finish_call(
                    &call_id,
                    &preview.request_fingerprint,
                    &response,
                    false,
                    finished_at,
                )?;
                Ok(result_from_response(call_id, response, false, finished_at))
            }
            Err(error) => {
                self.repository
                    .fail_call(&call_id, error.code(), finished_at)?;
                Err(error)
            }
        }
    }
}

fn result_from_response(
    call_id: String,
    response: AiProviderResponse,
    cache_hit: bool,
    finished_at: i64,
) -> AiCallResult {
    AiCallResult {
        call_id,
        response_text: response.text,
        input_tokens: response.input_tokens,
        output_tokens: response.output_tokens,
        cached_input_tokens: response.cached_input_tokens,
        reasoning_tokens: response.reasoning_tokens,
        usage_source: response.usage_source,
        cache_hit,
        finished_at,
    }
}

fn normalize_prompt(value: &str) -> Result<String, AiError> {
    let prompt = value.trim();
    if prompt.is_empty() || prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(AiError::InvalidInput);
    }
    Ok(prompt.to_owned())
}

fn normalize_base_url(value: Option<&str>) -> Result<String, AiError> {
    let value = value.unwrap_or("https://api.openai.com/v1").trim();
    if value.len() > 500
        || value.contains(['\n', '\r', '\t', '@', '?', '#'])
        || !(value.starts_with("https://")
            || value.starts_with("http://localhost")
            || value.starts_with("http://127.0.0.1"))
    {
        return Err(AiError::InvalidInput);
    }
    Ok(value.trim_end_matches('/').to_owned())
}

pub(crate) fn estimate_tokens(value: &str) -> u64 {
    let mut ascii = 0_u64;
    let mut non_ascii = 0_u64;
    for character in value.chars() {
        if character.is_ascii() {
            ascii += 1;
        } else {
            non_ascii += 1;
        }
    }
    non_ascii + ascii.div_ceil(4) + 24
}

fn budget_warnings(budget: &AiBudget, usage: &AiUsageSummary, projected: u64) -> Vec<String> {
    let mut warnings = Vec::new();
    if projected > budget.single_call_limit {
        warnings.push("single_call".to_owned());
    }
    if usage.today_tokens.saturating_add(projected) > budget.daily_token_limit {
        warnings.push("daily".to_owned());
    }
    if usage.month_tokens.saturating_add(projected) > budget.monthly_token_limit {
        warnings.push("monthly".to_owned());
    }
    warnings
}

fn request_fingerprint(
    provider_type: AiProviderType,
    base_url: Option<&str>,
    model_name: &str,
    prompt: &str,
    max_output_tokens: u32,
) -> String {
    let mut hasher = Sha256::new();
    for value in [
        "kystudy-ai-v1",
        provider_type.as_str(),
        base_url.unwrap_or("local"),
        model_name,
        prompt,
    ] {
        hasher.update(value.as_bytes());
        hasher.update([0]);
    }
    hasher.update(max_output_tokens.to_le_bytes());
    format!("{:X}", hasher.finalize())
}

fn destination_label(provider: &AiProviderConfig) -> String {
    match provider.provider_type {
        AiProviderType::OfflineTest => "本机离线测试 Provider".to_owned(),
        AiProviderType::OpenAiResponses => provider
            .base_url
            .as_deref()
            .and_then(|url| url.split_once("://"))
            .and_then(|(_, rest)| rest.split('/').next())
            .filter(|host| !host.is_empty())
            .map_or_else(|| "已配置的 HTTPS Provider".to_owned(), ToOwned::to_owned),
    }
}

fn usage_period_starts(now: i64) -> (i64, i64) {
    let local_days = (now + CHINA_OFFSET_MILLIS).div_euclid(DAY_MILLIS);
    let day_start = local_days * DAY_MILLIS - CHINA_OFFSET_MILLIS;
    let (year, month, _) = civil_from_days(local_days);
    let month_days = days_from_civil(year, month, 1);
    let month_start = month_days * DAY_MILLIS - CHINA_OFFSET_MILLIS;
    (day_start, month_start)
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let year_of_era = adjusted_year - era * 400;
    let month_prime = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

pub(crate) fn default_provider(now: i64) -> (AiProviderConfig, AiModelProfile, AiBudget) {
    let provider_id = Uuid::now_v7().to_string();
    (
        AiProviderConfig {
            id: provider_id.clone(),
            provider_type: AiProviderType::OfflineTest,
            display_name: "离线测试 Provider".to_owned(),
            base_url: None,
            secret_ref: None,
            enabled: true,
            updated_at: now,
        },
        AiModelProfile {
            id: Uuid::now_v7().to_string(),
            provider_config_id: provider_id,
            model_name: "kystudy-offline-test-v1".to_owned(),
            context_limit: DEFAULT_CONTEXT_LIMIT,
            max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
            updated_at: now,
        },
        AiBudget {
            single_call_limit: DEFAULT_SINGLE_LIMIT,
            daily_token_limit: DEFAULT_DAILY_LIMIT,
            monthly_token_limit: DEFAULT_MONTHLY_LIMIT,
            limit_mode: "block".to_owned(),
            updated_at: now,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        AiBudget, AiUsageSummary, budget_warnings, estimate_tokens, normalize_base_url,
        usage_period_starts,
    };

    #[test]
    fn token_estimate_counts_chinese_more_conservatively_than_ascii() {
        assert!(estimate_tokens("计算机组成原理") > estimate_tokens("computer"));
    }

    #[test]
    fn base_url_rejects_credentials_and_non_local_plain_http() {
        assert!(normalize_base_url(Some("http://example.com/v1")).is_err());
        assert!(normalize_base_url(Some("https://key@example.com/v1")).is_err());
        assert_eq!(
            normalize_base_url(Some("http://localhost:11434/v1/"))
                .expect("local provider URL should be accepted"),
            "http://localhost:11434/v1"
        );
    }

    #[test]
    fn hard_budget_reports_each_crossed_scope() {
        let budget = AiBudget {
            single_call_limit: 100,
            daily_token_limit: 150,
            monthly_token_limit: 500,
            limit_mode: "block".to_owned(),
            updated_at: 0,
        };
        let usage = AiUsageSummary {
            today_tokens: 100,
            month_tokens: 450,
        };
        assert_eq!(
            budget_warnings(&budget, &usage, 101),
            vec!["single_call", "daily", "monthly"]
        );
    }

    #[test]
    fn usage_periods_use_asia_shanghai_calendar_boundaries() {
        let (day, month) = usage_period_starts(1_721_577_600_000);
        assert!(day >= month);
        assert_eq!((day + 8 * 3_600_000) % 86_400_000, 0);
    }
}
