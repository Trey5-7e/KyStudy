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
const DEBUG_KEYRING_SERVICE: &str = "io.github.kystudy.ai-dev";
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
    let service = if cfg!(debug_assertions) {
        DEBUG_KEYRING_SERVICE
    } else {
        KEYRING_SERVICE
    };
    Entry::new(service, reference).map_err(|_| AiError::SecretStoreUnavailable)
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ProviderRouter;

impl AiProviderGateway for ProviderRouter {
    fn execute(
        &self,
        provider: &AiProviderConfig,
        model: &AiModelProfile,
        prompt: &str,
        image_data_urls: &[String],
        max_output_tokens: u32,
        secret: Option<&str>,
    ) -> Result<AiProviderResponse, AiError> {
        match provider.provider_type {
            AiProviderType::OfflineTest => Ok(offline_response(prompt, image_data_urls.len())),
            AiProviderType::OpenAiResponses => Self::execute_responses_api(
                provider,
                model,
                prompt,
                image_data_urls,
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
        image_data_urls: &[String],
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
            .json(&responses_request(
                &model.model_name,
                prompt,
                image_data_urls,
                max_output_tokens,
            ))
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

fn offline_response(prompt: &str, image_count: usize) -> AiProviderResponse {
    let preview = prompt.chars().take(120).collect::<String>();
    let text = format!(
        "离线测试已完成。KyStudy 收到 {image_count} 张题目图片，外发预览内容为：“{preview}”。这只是确定性测试结果，不是学习建议，也不会修改任何本地数据。"
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
    input: ResponsesInput<'a>,
    max_output_tokens: u32,
    store: bool,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum ResponsesInput<'a> {
    Text(&'a str),
    Messages(Vec<ResponsesMessage<'a>>),
}

#[derive(Debug, Serialize)]
struct ResponsesMessage<'a> {
    role: &'static str,
    content: Vec<ResponsesContentPart<'a>>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum ResponsesContentPart<'a> {
    #[serde(rename = "input_text")]
    Text { text: &'a str },
    #[serde(rename = "input_image")]
    Image {
        image_url: &'a str,
        detail: &'static str,
    },
}

fn responses_request<'a>(
    model: &'a str,
    prompt: &'a str,
    image_data_urls: &'a [String],
    max_output_tokens: u32,
) -> ResponsesRequest<'a> {
    let input = if image_data_urls.is_empty() {
        ResponsesInput::Text(prompt)
    } else {
        let mut content = Vec::with_capacity(image_data_urls.len() + 1);
        content.push(ResponsesContentPart::Text { text: prompt });
        content.extend(
            image_data_urls
                .iter()
                .map(|image_url| ResponsesContentPart::Image {
                    image_url,
                    detail: "auto",
                }),
        );
        ResponsesInput::Messages(vec![ResponsesMessage {
            role: "user",
            content,
        }])
    };
    ResponsesRequest {
        model,
        input,
        max_output_tokens,
        store: false,
    }
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
    use super::{offline_response, responses_request};

    #[test]
    fn offline_provider_is_deterministic_and_reports_estimated_usage() {
        let first = offline_response("测试外发内容", 0);
        let second = offline_response("测试外发内容", 0);

        assert_eq!(first, second);
        assert_eq!(first.usage_source, "estimated");
    }

    #[test]
    fn responses_request_uses_ordered_image_parts_for_question_analysis() {
        let images = vec![
            "data:image/png;base64,AAA".to_owned(),
            "data:image/jpeg;base64,BBB".to_owned(),
        ];
        let request = responses_request("model", "分析", &images, 600);
        let value = serde_json::to_value(request).expect("request should serialize");

        assert_eq!(value["input"][0]["content"][1]["image_url"], images[0]);
        assert_eq!(value["input"][0]["content"][2]["image_url"], images[1]);
    }
}
