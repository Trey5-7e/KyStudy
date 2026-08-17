use std::collections::HashSet;
use std::io::Read;
use std::time::Duration;

use keyring::{Entry, Error as KeyringError};
use reqwest::StatusCode;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

use crate::application::{
    AiError, AiModelOption, AiProviderGateway, AiProviderResponse, SecretStore, estimate_tokens,
};
use crate::domain::{AiModelProfile, AiProviderConfig, AiProviderType};

const KEYRING_SERVICE: &str = "io.github.kystudy.ai";
const DEBUG_KEYRING_SERVICE: &str = "io.github.kystudy.ai-dev";
const PROVIDER_TIMEOUT: Duration = Duration::from_mins(1);
const MAXIMUM_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
const MAXIMUM_MODEL_LIST_BYTES: u64 = 2 * 1024 * 1024;
const MAXIMUM_MODEL_COUNT: usize = 1_000;

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
            AiProviderType::OpenAiResponses | AiProviderType::DoubaoResponses => {
                Self::execute_responses_api(
                    provider,
                    model,
                    prompt,
                    image_data_urls,
                    max_output_tokens,
                    secret.ok_or(AiError::SecretMissing)?,
                )
            }
            AiProviderType::ZhipuChat | AiProviderType::QwenChat | AiProviderType::DeepSeekChat => {
                Self::execute_chat_completions(
                    provider,
                    model,
                    prompt,
                    image_data_urls,
                    max_output_tokens,
                    secret.ok_or(AiError::SecretMissing)?,
                )
            }
        }
    }

    fn list_models(
        &self,
        provider_type: AiProviderType,
        base_url: &str,
        secret: &str,
    ) -> Result<Vec<AiModelOption>, AiError> {
        if matches!(provider_type, AiProviderType::OfflineTest) {
            return Err(AiError::ModelListUnsupported);
        }
        let qwen_endpoint = qwen_deployable_model_endpoint(base_url);
        let endpoint = qwen_endpoint.as_deref().map_or_else(
            || format!("{}/models", base_url.trim_end_matches('/')),
            str::to_owned,
        );
        let url = reqwest::Url::parse(&endpoint).map_err(|_| AiError::InvalidInput)?;
        let client = provider_client()?;
        let response = client
            .get(url)
            .bearer_auth(secret)
            .send()
            .map_err(|_| AiError::ProviderUnavailable)?;
        let status = response.status();
        if !status.is_success() {
            return Err(model_list_status_error(status));
        }
        let body = read_response_body(
            response,
            MAXIMUM_MODEL_LIST_BYTES,
            || AiError::ModelListInvalid,
            || AiError::ModelListTooLarge,
        )?;
        let value = serde_json::from_slice::<serde_json::Value>(&body)
            .map_err(|_| AiError::ModelListInvalid)?;
        if qwen_endpoint.is_some() {
            parse_qwen_model_list(&value)
        } else {
            parse_model_list(&value)
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
        let client = provider_client()?;
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
        let body = read_response_body(
            response,
            MAXIMUM_RESPONSE_BYTES,
            || AiError::ProviderInvalidResponse,
            || AiError::ProviderInvalidResponse,
        )?;
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

    fn execute_chat_completions(
        provider: &AiProviderConfig,
        model: &AiModelProfile,
        prompt: &str,
        image_data_urls: &[String],
        max_output_tokens: u32,
        secret: &str,
    ) -> Result<AiProviderResponse, AiError> {
        let base_url = provider.base_url.as_deref().ok_or(AiError::InvalidInput)?;
        let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let url = reqwest::Url::parse(&endpoint).map_err(|_| AiError::InvalidInput)?;
        let client = provider_client()?;
        let response = client
            .post(url)
            .bearer_auth(secret)
            .json(&chat_completions_request(
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
        let body = read_response_body(
            response,
            MAXIMUM_RESPONSE_BYTES,
            || AiError::ProviderInvalidResponse,
            || AiError::ProviderInvalidResponse,
        )?;
        let value = serde_json::from_slice::<serde_json::Value>(&body)
            .map_err(|_| AiError::ProviderInvalidResponse)?;
        parse_chat_response(&value, prompt)
    }
}

fn provider_client() -> Result<Client, AiError> {
    Client::builder()
        .timeout(PROVIDER_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AiError::ProviderUnavailable)
}

fn read_response_body<F, G>(
    response: reqwest::blocking::Response,
    maximum_bytes: u64,
    read_error: F,
    size_error: G,
) -> Result<Vec<u8>, AiError>
where
    F: Fn() -> AiError,
    G: Fn() -> AiError,
{
    let mut body = Vec::new();
    response
        .take(maximum_bytes.saturating_add(1))
        .read_to_end(&mut body)
        .map_err(|_| read_error())?;
    if u64::try_from(body.len()).map_or(true, |length| length > maximum_bytes) {
        return Err(size_error());
    }
    Ok(body)
}

fn model_list_status_error(status: StatusCode) -> AiError {
    match status.as_u16() {
        401 | 403 => AiError::ProviderAuthentication,
        404 | 405 => AiError::ModelListUnsupported,
        429 => AiError::ProviderRateLimited,
        500..=599 => AiError::ProviderUnavailable,
        _ => AiError::ModelListInvalid,
    }
}

fn parse_model_list(value: &serde_json::Value) -> Result<Vec<AiModelOption>, AiError> {
    if value
        .get("object")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|object| object != "list")
    {
        return Err(AiError::ModelListInvalid);
    }
    let data = value
        .get("data")
        .and_then(serde_json::Value::as_array)
        .ok_or(AiError::ModelListInvalid)?;
    if data.len() > MAXIMUM_MODEL_COUNT {
        return Err(AiError::ModelListTooLarge);
    }
    let mut seen = HashSet::new();
    let mut models = Vec::with_capacity(data.len());
    for item in data {
        let Some(id) = item.get("id").and_then(serde_json::Value::as_str) else {
            return Err(AiError::ModelListInvalid);
        };
        let id = id.trim();
        if id.is_empty() || id.chars().count() > 120 {
            return Err(AiError::ModelListInvalid);
        }
        if !seen.insert(id.to_owned()) {
            continue;
        }
        models.push(AiModelOption {
            id: id.to_owned(),
            owned_by: item
                .get("owned_by")
                .and_then(serde_json::Value::as_str)
                .map(ToOwned::to_owned),
            created_at: item.get("created").and_then(serde_json::Value::as_i64),
        });
    }
    models.sort_by(|left, right| {
        left.id
            .to_ascii_lowercase()
            .cmp(&right.id.to_ascii_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    if models.is_empty() {
        return Err(AiError::ModelListEmpty);
    }
    Ok(models)
}

fn qwen_deployable_model_endpoint(base_url: &str) -> Option<String> {
    let mut url = reqwest::Url::parse(base_url).ok()?;
    let host = url.host_str()?;
    let path = url.path().trim_end_matches('/');
    if !host.contains("dashscope")
        || !host.ends_with(".aliyuncs.com")
        || !path.ends_with("/compatible-mode/v1")
    {
        return None;
    }
    url.set_path("/api/v1/deployments/models");
    url.set_query(Some(
        "page_no=1&page_size=100&version=v1.0&model_source=base",
    ));
    Some(url.to_string())
}

fn parse_qwen_model_list(value: &serde_json::Value) -> Result<Vec<AiModelOption>, AiError> {
    let models = value
        .get("output")
        .and_then(|output| output.get("models"))
        .cloned()
        .ok_or(AiError::ModelListInvalid)?;
    let Some(models) = models.as_array() else {
        return Err(AiError::ModelListInvalid);
    };
    if models.len() > MAXIMUM_MODEL_COUNT {
        return Err(AiError::ModelListTooLarge);
    }
    let normalized = models
        .iter()
        .map(|model| {
            serde_json::json!({
                "id": model.get("model_name").and_then(serde_json::Value::as_str),
            })
        })
        .collect::<Vec<_>>();
    let normalized = serde_json::json!({ "data": normalized });
    parse_model_list(&normalized)
}

fn chat_completions_request(
    model: &str,
    prompt: &str,
    image_data_urls: &[String],
    max_output_tokens: u32,
) -> serde_json::Value {
    let content = if image_data_urls.is_empty() {
        serde_json::Value::String(prompt.to_owned())
    } else {
        let mut parts = vec![serde_json::json!({
            "type": "text",
            "text": prompt,
        })];
        parts.extend(image_data_urls.iter().map(|image_url| {
            serde_json::json!({
                "type": "image_url",
                "image_url": { "url": image_url },
            })
        }));
        serde_json::Value::Array(parts)
    };
    serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": content }],
        "max_tokens": max_output_tokens,
        "stream": false,
    })
}

fn parse_chat_response(
    value: &serde_json::Value,
    prompt: &str,
) -> Result<AiProviderResponse, AiError> {
    let message = value
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .ok_or(AiError::ProviderInvalidResponse)?;
    let text = match message.get("content") {
        Some(serde_json::Value::String(text)) => text.clone(),
        Some(serde_json::Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
            .collect::<String>(),
        _ => String::new(),
    };
    if text.trim().is_empty() {
        return Err(AiError::ProviderInvalidResponse);
    }
    let usage = value.get("usage");
    let input_tokens = usage
        .and_then(|usage| usage.get("prompt_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_else(|| estimate_tokens(prompt));
    let output_tokens = usage
        .and_then(|usage| usage.get("completion_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_else(|| estimate_tokens(&text));
    let cached_input_tokens = usage
        .and_then(|usage| usage.get("prompt_tokens_details"))
        .and_then(|details| details.get("cached_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    let reasoning_tokens = usage
        .and_then(|usage| usage.get("completion_tokens_details"))
        .and_then(|details| details.get("reasoning_tokens"))
        .and_then(serde_json::Value::as_u64)
        .or_else(|| {
            usage
                .and_then(|usage| usage.get("reasoning_tokens"))
                .and_then(serde_json::Value::as_u64)
        })
        .unwrap_or(0);
    Ok(AiProviderResponse {
        text,
        input_tokens,
        output_tokens,
        cached_input_tokens,
        reasoning_tokens,
        usage_source: if usage.is_some() {
            "provider"
        } else {
            "estimated"
        }
        .to_owned(),
    })
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
    #[serde(rename = "type")]
    kind: &'static str,
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
            kind: "message",
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
    use reqwest::StatusCode;

    use super::{
        chat_completions_request, model_list_status_error, offline_response, parse_chat_response,
        parse_model_list, parse_qwen_model_list, qwen_deployable_model_endpoint, responses_request,
        status_error,
    };
    use crate::application::{AiError, AiProviderGateway};
    use crate::domain::AiProviderType;

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

        assert_eq!(value["input"][0]["type"], "message");
        assert_eq!(value["input"][0]["content"][1]["image_url"], images[0]);
        assert_eq!(value["input"][0]["content"][2]["image_url"], images[1]);
    }

    #[test]
    fn chat_request_uses_openai_compatible_message_and_image_shape() {
        let images = vec!["data:image/png;base64,AAA".to_owned()];
        let value = chat_completions_request("glm-5", "分析", &images, 600);

        assert_eq!(value["messages"][0]["role"], "user");
        assert_eq!(value["messages"][0]["content"][0]["type"], "text");
        assert_eq!(
            value["messages"][0]["content"][1]["image_url"]["url"],
            images[0]
        );
        assert_eq!(value["stream"], false);
    }

    #[test]
    fn chat_response_extracts_text_and_provider_usage() {
        let value = serde_json::json!({
            "choices": [{ "message": { "content": "回答" } }],
            "usage": {
                "prompt_tokens": 12,
                "completion_tokens": 7,
                "prompt_tokens_details": { "cached_tokens": 2 },
                "completion_tokens_details": { "reasoning_tokens": 3 }
            }
        });
        let response = parse_chat_response(&value, "问题").expect("chat response should parse");

        assert_eq!(response.text, "回答");
        assert_eq!(response.input_tokens, 12);
        assert_eq!(response.output_tokens, 7);
        assert_eq!(response.cached_input_tokens, 2);
        assert_eq!(response.reasoning_tokens, 3);
        assert_eq!(response.usage_source, "provider");
    }

    #[test]
    fn model_list_parser_deduplicates_and_sorts_ids() {
        let value = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "Z-model", "owned_by": "provider" },
                { "id": "a-model" },
                { "id": "Z-model" }
            ]
        });
        let models = parse_model_list(&value).expect("model list should parse");

        assert_eq!(
            models
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            ["a-model", "Z-model"]
        );
    }

    #[test]
    fn model_list_is_unsupported_for_offline_provider() {
        let gateway = super::ProviderRouter;
        let result = gateway.list_models(
            AiProviderType::OfflineTest,
            "https://example.com/v1",
            "secret",
        );

        assert!(matches!(result, Err(AiError::ModelListUnsupported)));
    }

    #[test]
    fn qwen_compatible_base_url_uses_deployable_model_catalog() {
        let endpoint =
            qwen_deployable_model_endpoint("https://dashscope.aliyuncs.com/compatible-mode/v1")
                .expect("DashScope compatible endpoint should have a model catalog");

        assert_eq!(
            endpoint,
            "https://dashscope.aliyuncs.com/api/v1/deployments/models?page_no=1&page_size=100&version=v1.0&model_source=base"
        );
    }

    #[test]
    fn qwen_model_catalog_maps_model_name_to_model_id() {
        let value = serde_json::json!({
            "output": { "models": [{ "model_name": "qwen-plus" }] }
        });
        let models = parse_qwen_model_list(&value).expect("Qwen model catalog should parse");

        assert_eq!(models[0].id, "qwen-plus");
    }

    #[test]
    fn provider_status_mapping_preserves_actionable_categories() {
        assert!(matches!(
            model_list_status_error(StatusCode::NOT_FOUND),
            AiError::ModelListUnsupported
        ));
        assert!(matches!(
            status_error(StatusCode::UNAUTHORIZED),
            AiError::ProviderAuthentication
        ));
        assert!(matches!(
            status_error(StatusCode::TOO_MANY_REQUESTS),
            AiError::ProviderRateLimited
        ));
    }
}
