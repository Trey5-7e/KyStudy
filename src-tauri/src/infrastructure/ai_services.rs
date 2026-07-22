use std::io::Read;
use std::time::Duration;

use keyring::{Entry, Error as KeyringError};
use reqwest::StatusCode;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

use crate::application::{
    AiError, AiProviderGateway, AiProviderResponse, SecretStore, estimate_tokens,
};
use crate::domain::{AiModelProfile, AiProviderConfig, AiProviderType};

const KEYRING_SERVICE: &str = "io.github.kystudy.ai";
const PROVIDER_TIMEOUT: Duration = Duration::from_mins(1);
const MAXIMUM_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SystemSecretStore;

impl SecretStore for SystemSecretStore {
    fn has(&self, reference: &str) -> Result<bool, AiError> {
        self.get(reference).map(|secret| secret.is_some())
    }

    fn get(&self, reference: &str) -> Result<Option<String>, AiError> {
        let entry = entry(reference)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(_) => Err(AiError::SecretStoreUnavailable),
        }
    }

    fn set(&self, reference: &str, secret: &str) -> Result<(), AiError> {
        entry(reference)?
            .set_password(secret)
            .map_err(|_| AiError::SecretStoreUnavailable)
    }

    fn delete(&self, reference: &str) -> Result<(), AiError> {
        match entry(reference)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err(AiError::SecretStoreUnavailable),
        }
    }
}

fn entry(reference: &str) -> Result<Entry, AiError> {
    if reference.is_empty() || reference.len() > 120 {
        return Err(AiError::InvalidInput);
    }
    Entry::new(KEYRING_SERVICE, reference).map_err(|_| AiError::SecretStoreUnavailable)
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ProviderRouter;

impl AiProviderGateway for ProviderRouter {
    fn execute(
        &self,
        provider: &AiProviderConfig,
        model: &AiModelProfile,
        prompt: &str,
        max_output_tokens: u32,
        secret: Option<&str>,
    ) -> Result<AiProviderResponse, AiError> {
        match provider.provider_type {
            AiProviderType::OfflineTest => Ok(offline_response(prompt)),
            AiProviderType::OpenAiResponses => Self::execute_responses_api(
                provider,
                model,
                prompt,
                max_output_tokens,
                secret.ok_or(AiError::SecretMissing)?,
            ),
        }
    }
}

impl ProviderRouter {
    fn execute_responses_api(
        provider: &AiProviderConfig,
        model: &AiModelProfile,
        prompt: &str,
        max_output_tokens: u32,
        secret: &str,
    ) -> Result<AiProviderResponse, AiError> {
        let base_url = provider.base_url.as_deref().ok_or(AiError::InvalidInput)?;
        let endpoint = format!("{}/responses", base_url.trim_end_matches('/'));
        let url = reqwest::Url::parse(&endpoint).map_err(|_| AiError::InvalidInput)?;
        let secure = url.scheme() == "https";
        let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
        if !secure && !local {
            return Err(AiError::InvalidInput);
        }
        let client = Client::builder()
            .timeout(PROVIDER_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| AiError::ProviderUnavailable)?;
        let response = client
            .post(url)
            .bearer_auth(secret)
            .json(&ResponsesRequest {
                model: &model.model_name,
                input: prompt,
                max_output_tokens,
                store: false,
            })
            .send()
            .map_err(|_| AiError::ProviderUnavailable)?;
        let status = response.status();
        if !status.is_success() {
            return Err(status_error(status));
        }
        let mut body = Vec::new();
        response
            .take(MAXIMUM_RESPONSE_BYTES + 1)
            .read_to_end(&mut body)
            .map_err(|_| AiError::ProviderInvalidResponse)?;
        if u64::try_from(body.len()).map_or(true, |length| length > MAXIMUM_RESPONSE_BYTES) {
            return Err(AiError::ProviderInvalidResponse);
        }
        let body = serde_json::from_slice::<ResponsesEnvelope>(&body)
            .map_err(|_| AiError::ProviderInvalidResponse)?;
        if body
            .status
            .as_deref()
            .is_some_and(|value| value != "completed")
        {
            return Err(AiError::ProviderRejected);
        }
        let text = body
            .output
            .into_iter()
            .flat_map(|item| item.content)
            .filter(|content| content.kind == "output_text")
            .filter_map(|content| content.text)
            .collect::<String>();
        if text.trim().is_empty() {
            return Err(AiError::ProviderInvalidResponse);
        }
        let usage = body.usage;
        Ok(AiProviderResponse {
            text,
            input_tokens: usage
                .as_ref()
                .map_or_else(|| estimate_tokens(prompt), |item| item.input_tokens),
            output_tokens: usage
                .as_ref()
                .map_or_else(|| estimate_tokens("response"), |item| item.output_tokens),
            cached_input_tokens: usage
                .as_ref()
                .and_then(|item| item.input_tokens_details.as_ref())
                .map_or(0, |details| details.cached_tokens),
            reasoning_tokens: usage
                .as_ref()
                .and_then(|item| item.output_tokens_details.as_ref())
                .map_or(0, |details| details.reasoning_tokens),
            usage_source: if usage.is_some() {
                "provider"
            } else {
                "estimated"
            }
            .to_owned(),
        })
    }
}

fn offline_response(prompt: &str) -> AiProviderResponse {
    let preview = prompt.chars().take(120).collect::<String>();
    let text = format!(
        "离线测试已完成。KyStudy 收到的外发预览内容为：“{preview}”。这只是确定性测试结果，不是学习建议，也不会修改任何本地数据。"
    );
    AiProviderResponse {
        input_tokens: estimate_tokens(prompt),
        output_tokens: estimate_tokens(&text),
        cached_input_tokens: 0,
        reasoning_tokens: 0,
        usage_source: "estimated".to_owned(),
        text,
    }
}

fn status_error(status: StatusCode) -> AiError {
    match status.as_u16() {
        401 | 403 => AiError::ProviderAuthentication,
        429 => AiError::ProviderRateLimited,
        500..=599 => AiError::ProviderUnavailable,
        _ => AiError::ProviderRejected,
    }
}

#[derive(Debug, Serialize)]
struct ResponsesRequest<'a> {
    model: &'a str,
    input: &'a str,
    max_output_tokens: u32,
    store: bool,
}

#[derive(Debug, Deserialize)]
struct ResponsesEnvelope {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    output: Vec<ResponsesOutputItem>,
    usage: Option<ResponsesUsage>,
}

#[derive(Debug, Deserialize)]
struct ResponsesOutputItem {
    #[serde(default)]
    content: Vec<ResponsesContent>,
}

#[derive(Debug, Deserialize)]
struct ResponsesContent {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResponsesUsage {
    input_tokens: u64,
    output_tokens: u64,
    input_tokens_details: Option<InputTokenDetails>,
    output_tokens_details: Option<OutputTokenDetails>,
}

#[derive(Debug, Deserialize)]
struct InputTokenDetails {
    #[serde(default)]
    cached_tokens: u64,
}

#[derive(Debug, Deserialize)]
struct OutputTokenDetails {
    #[serde(default)]
    reasoning_tokens: u64,
}

#[cfg(test)]
mod tests {
    use super::offline_response;

    #[test]
    fn offline_provider_is_deterministic_and_reports_estimated_usage() {
        let first = offline_response("测试外发内容");
        let second = offline_response("测试外发内容");

        assert_eq!(first, second);
        assert_eq!(first.usage_source, "estimated");
    }
}
