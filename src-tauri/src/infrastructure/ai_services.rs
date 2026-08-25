use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use base64::Engine as _;
use keyring::{Entry, Error as KeyringError};
use reqwest::StatusCode;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::application::{
    AiError, AiFileAttachment, AiModelOption, AiProviderGateway, AiProviderResponse, SecretStore,
    estimate_tokens,
};
use crate::domain::{AiModelProfile, AiProviderConfig, AiProviderType};

const KEYRING_SERVICE: &str = "io.github.kystudy.ai";
const DEBUG_KEYRING_SERVICE: &str = "io.github.kystudy.ai-dev";
const PROVIDER_TIMEOUT: Duration = Duration::from_mins(1);
const MAXIMUM_RESPONSE_BYTES: u64 = 4 * 1024 * 1024;
const MAXIMUM_MODEL_LIST_BYTES: u64 = 2 * 1024 * 1024;
const MAXIMUM_MODEL_COUNT: usize = 1_000;
const MAXIMUM_NATIVE_FILE_BYTES: u64 = 24 * 1024 * 1024;

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
        file_attachments: &[AiFileAttachment],
        max_output_tokens: u32,
        secret: Option<&str>,
    ) -> Result<AiProviderResponse, AiError> {
        match provider.provider_type {
            AiProviderType::OfflineTest => Ok(offline_response(
                prompt,
                image_data_urls.len(),
                file_attachments.len(),
            )),
            AiProviderType::OpenAiResponses | AiProviderType::DoubaoResponses => {
                Self::execute_responses_api(
                    provider,
                    model,
                    prompt,
                    image_data_urls,
                    file_attachments,
                    max_output_tokens,
                    secret.ok_or(AiError::SecretMissing)?,
                )
            }
            AiProviderType::ZhipuChat
            | AiProviderType::QwenChat
            | AiProviderType::DeepSeekChat
            | AiProviderType::OpenAiChat
            | AiProviderType::LiteLlmGateway => Self::execute_chat_completions(
                provider,
                model,
                prompt,
                image_data_urls,
                file_attachments,
                max_output_tokens,
                secret.ok_or(AiError::SecretMissing)?,
            ),
            AiProviderType::SenseNovaChat => Self::execute_sensenova_chat(
                provider,
                model,
                prompt,
                image_data_urls,
                file_attachments,
                max_output_tokens,
                secret.ok_or(AiError::SecretMissing)?,
            ),
        }
    }

    fn execute_stream(
        &self,
        provider: &AiProviderConfig,
        model: &AiModelProfile,
        prompt: &str,
        image_data_urls: &[String],
        file_attachments: &[AiFileAttachment],
        max_output_tokens: u32,
        secret: Option<&str>,
        canceled: Option<&AtomicBool>,
        on_chunk: &mut dyn FnMut(&str) -> Result<(), AiError>,
    ) -> Result<AiProviderResponse, AiError> {
        match provider.provider_type {
            AiProviderType::OfflineTest => offline_response_stream(
                prompt,
                image_data_urls.len(),
                file_attachments.len(),
                canceled,
                on_chunk,
            ),
            AiProviderType::OpenAiResponses | AiProviderType::DoubaoResponses => {
                Self::execute_responses_api_stream(
                    provider,
                    model,
                    prompt,
                    image_data_urls,
                    file_attachments,
                    max_output_tokens,
                    secret.ok_or(AiError::SecretMissing)?,
                    canceled,
                    on_chunk,
                )
            }
            AiProviderType::ZhipuChat
            | AiProviderType::QwenChat
            | AiProviderType::DeepSeekChat
            | AiProviderType::OpenAiChat
            | AiProviderType::LiteLlmGateway => Self::execute_chat_completions_stream(
                provider,
                model,
                prompt,
                image_data_urls,
                file_attachments,
                max_output_tokens,
                secret.ok_or(AiError::SecretMissing)?,
                canceled,
                on_chunk,
            ),
            AiProviderType::SenseNovaChat => {
                let response = Self::execute_sensenova_chat(
                    provider,
                    model,
                    prompt,
                    image_data_urls,
                    file_attachments,
                    max_output_tokens,
                    secret.ok_or(AiError::SecretMissing)?,
                )?;
                on_chunk(&response.text)?;
                Ok(response)
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
        file_attachments: &[AiFileAttachment],
        max_output_tokens: u32,
        secret: &str,
    ) -> Result<AiProviderResponse, AiError> {
        let base_url = provider.base_url.as_deref().ok_or(AiError::InvalidInput)?;
        let endpoint = format!("{}/responses", base_url.trim_end_matches('/'));
        let url = reqwest::Url::parse(&endpoint).map_err(|_| AiError::InvalidInput)?;
        let client = provider_client()?;
        let response = client
            .post(url)
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/plain;q=0.9, */*;q=0.8",
            )
            .bearer_auth(secret)
            .json(&responses_request(
                &model.model_name,
                prompt,
                image_data_urls,
                file_attachments,
                max_output_tokens,
            )?)
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

    #[expect(
        clippy::too_many_arguments,
        reason = "Streaming implementation retains provider, cancellation, attachment and token options"
    )]
    fn execute_responses_api_stream(
        provider: &AiProviderConfig,
        model: &AiModelProfile,
        prompt: &str,
        image_data_urls: &[String],
        file_attachments: &[AiFileAttachment],
        max_output_tokens: u32,
        secret: &str,
        canceled: Option<&AtomicBool>,
        on_chunk: &mut dyn FnMut(&str) -> Result<(), AiError>,
    ) -> Result<AiProviderResponse, AiError> {
        let base_url = provider.base_url.as_deref().ok_or(AiError::InvalidInput)?;
        let endpoint = format!("{}/responses", base_url.trim_end_matches('/'));
        let url = reqwest::Url::parse(&endpoint).map_err(|_| AiError::InvalidInput)?;
        let client = provider_client()?;
        let req_body = responses_stream_request(
            &model.model_name,
            prompt,
            image_data_urls,
            file_attachments,
            max_output_tokens,
        )?;

        let response = client
            .post(url)
            .header(
                reqwest::header::ACCEPT,
                "text/event-stream, application/json;q=0.9, */*;q=0.8",
            )
            .bearer_auth(secret)
            .json(&req_body)
            .send()
            .map_err(|_| AiError::ProviderUnavailable)?;
        let status = response.status();
        if !status.is_success() {
            return Err(status_error(status));
        }

        let mut full_text = String::new();
        let mut usage: Option<ResponsesUsage> = None;
        let mut reader = BufReader::new(response);
        let mut line = String::new();
        let mut raw_buffer = String::new();

        loop {
            if canceled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
                return Err(AiError::Canceled);
            }
            line.clear();
            let bytes_read = reader
                .read_line(&mut line)
                .map_err(|_| AiError::ProviderUnavailable)?;
            if bytes_read == 0 {
                break;
            }
            raw_buffer.push_str(&line);
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with(':') {
                continue;
            }
            let data = if let Some(d) = trimmed.strip_prefix("data:") {
                d.trim()
            } else if let Some(d) = trimmed.strip_prefix("DATA:") {
                d.trim()
            } else {
                trimmed
            };
            if data == "[DONE]" || data == "[done]" {
                break;
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(err) = detect_provider_json_error(&val) {
                    return Err(err);
                }
                if let Some(chunk) = extract_any_chunk_text(&val) {
                    full_text.push_str(&chunk);
                    on_chunk(&chunk)?;
                }
                if let Some(u) = val.get("usage").and_then(|usage_val| {
                    serde_json::from_value::<ResponsesUsage>(usage_val.clone()).ok()
                }) {
                    usage = Some(u);
                }
            }
        }

        if full_text.trim().is_empty() {
            if let Ok(body) = serde_json::from_str::<ResponsesEnvelope>(&raw_buffer) {
                let text = body
                    .output
                    .into_iter()
                    .flat_map(|item| item.content)
                    .filter(|content| content.kind == "output_text")
                    .filter_map(|content| content.text)
                    .collect::<String>();
                if !text.trim().is_empty() {
                    on_chunk(&text)?;
                    let usage = body.usage;
                    return Ok(AiProviderResponse {
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
                    });
                }
            }
            return Err(AiError::ProviderInvalidResponse);
        }

        Ok(AiProviderResponse {
            text: full_text,
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
        file_attachments: &[AiFileAttachment],
        max_output_tokens: u32,
        secret: &str,
    ) -> Result<AiProviderResponse, AiError> {
        if !file_attachments.is_empty() {
            return Err(AiError::InvalidInput);
        }
        let base_url = provider.base_url.as_deref().ok_or(AiError::InvalidInput)?;
        let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let url = reqwest::Url::parse(&endpoint).map_err(|_| AiError::InvalidInput)?;
        let client = provider_client()?;
        let response = client
            .post(url)
            .header(
                reqwest::header::ACCEPT,
                "application/json, text/plain;q=0.9, */*;q=0.8",
            )
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

    #[expect(
        clippy::too_many_arguments,
        reason = "Streaming implementation retains provider, cancellation, attachment and token options"
    )]
    fn execute_chat_completions_stream(
        provider: &AiProviderConfig,
        model: &AiModelProfile,
        prompt: &str,
        image_data_urls: &[String],
        file_attachments: &[AiFileAttachment],
        max_output_tokens: u32,
        secret: &str,
        canceled: Option<&AtomicBool>,
        on_chunk: &mut dyn FnMut(&str) -> Result<(), AiError>,
    ) -> Result<AiProviderResponse, AiError> {
        if !file_attachments.is_empty() {
            return Err(AiError::InvalidInput);
        }
        let base_url = provider.base_url.as_deref().ok_or(AiError::InvalidInput)?;
        let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
        let url = reqwest::Url::parse(&endpoint).map_err(|_| AiError::InvalidInput)?;
        let client = provider_client()?;
        let mut req_body = chat_completions_request(
            &model.model_name,
            prompt,
            image_data_urls,
            max_output_tokens,
        );
        req_body["stream"] = serde_json::Value::Bool(true);

        let response = client
            .post(url)
            .header(
                reqwest::header::ACCEPT,
                "text/event-stream, application/json;q=0.9, */*;q=0.8",
            )
            .bearer_auth(secret)
            .json(&req_body)
            .send()
            .map_err(|_| AiError::ProviderUnavailable)?;
        let status = response.status();
        if !status.is_success() {
            return Err(status_error(status));
        }

        let mut full_text = String::new();
        let mut usage: Option<serde_json::Value> = None;
        let mut reader = BufReader::new(response);
        let mut line = String::new();
        let mut raw_buffer = String::new();

        loop {
            if canceled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
                return Err(AiError::Canceled);
            }
            line.clear();
            let bytes_read = reader
                .read_line(&mut line)
                .map_err(|_| AiError::ProviderUnavailable)?;
            if bytes_read == 0 {
                break;
            }
            raw_buffer.push_str(&line);
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with(':') {
                continue;
            }
            let data = if let Some(d) = trimmed.strip_prefix("data:") {
                d.trim()
            } else if let Some(d) = trimmed.strip_prefix("DATA:") {
                d.trim()
            } else {
                trimmed
            };
            if data == "[DONE]" || data == "[done]" {
                break;
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(err) = detect_provider_json_error(&value) {
                    return Err(err);
                }
                if let Some(usage_val) = value.get("usage").filter(|u| !u.is_null()) {
                    usage = Some(usage_val.clone());
                }
                if let Some(chunk) = extract_any_chunk_text(&value) {
                    full_text.push_str(&chunk);
                    on_chunk(&chunk)?;
                }
            }
        }

        if full_text.trim().is_empty() {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw_buffer) {
                if let Some(err) = detect_provider_json_error(&value) {
                    return Err(err);
                }
                let parsed = parse_chat_response(&value, prompt)?;
                on_chunk(&parsed.text)?;
                return Ok(parsed);
            }
            return Err(AiError::ProviderInvalidResponse);
        }

        let input_tokens = usage
            .as_ref()
            .and_then(|u| u.get("prompt_tokens"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or_else(|| estimate_tokens(prompt));
        let output_tokens = usage
            .as_ref()
            .and_then(|u| u.get("completion_tokens"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or_else(|| estimate_tokens(&full_text));
        let cached_input_tokens = usage
            .as_ref()
            .and_then(|u| u.get("prompt_tokens_details"))
            .and_then(|d| d.get("cached_tokens"))
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0);
        let reasoning_tokens = usage
            .as_ref()
            .and_then(|u| u.get("completion_tokens_details"))
            .and_then(|d| d.get("reasoning_tokens"))
            .and_then(serde_json::Value::as_u64)
            .or_else(|| {
                usage
                    .as_ref()
                    .and_then(|u| u.get("reasoning_tokens"))
                    .and_then(serde_json::Value::as_u64)
            })
            .unwrap_or(0);

        Ok(AiProviderResponse {
            text: full_text,
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

    fn execute_sensenova_chat(
        provider: &AiProviderConfig,
        model: &AiModelProfile,
        prompt: &str,
        image_data_urls: &[String],
        file_attachments: &[AiFileAttachment],
        max_output_tokens: u32,
        secret: &str,
    ) -> Result<AiProviderResponse, AiError> {
        if !file_attachments.is_empty() {
            return Err(AiError::InvalidInput);
        }
        let base_url = provider.base_url.as_deref().ok_or(AiError::InvalidInput)?;
        let endpoint = format!("{}/chat-completions", base_url.trim_end_matches('/'));
        let url = reqwest::Url::parse(&endpoint).map_err(|_| AiError::InvalidInput)?;
        let client = provider_client()?;
        let response = client
            .post(url)
            .bearer_auth(secret)
            .json(&sensenova_chat_request(
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
        parse_sensenova_chat_response(&value, prompt)
    }
}

fn provider_client() -> Result<Client, AiError> {
    Client::builder()
        .timeout(PROVIDER_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("KyStudy/0.1.4")
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
        .is_some_and(|object| !object.eq_ignore_ascii_case("list"))
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
    _max_output_tokens: u32,
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
        "stream": false,
    })
}

fn sensenova_chat_request(
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
                "image_url": image_url,
            })
        }));
        serde_json::Value::Array(parts)
    };
    serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": content }],
        "max_new_tokens": max_output_tokens,
        "n": 1,
        "stream": false,
        "temperature": 0.8,
        "top_p": 0.7,
        "thinking": { "enabled": false },
    })
}

fn detect_provider_json_error(val: &serde_json::Value) -> Option<AiError> {
    if let Some(error) = val.get("error") {
        if let Some(code) = error.get("code").and_then(serde_json::Value::as_str) {
            match code {
                "invalid_api_key" | "authentication_error" | "unauthorized" => {
                    return Some(AiError::ProviderAuthentication);
                }
                "rate_limit_exceeded" | "insufficient_quota" | "quota_exceeded" => {
                    return Some(AiError::ProviderRateLimited);
                }
                _ => return Some(AiError::ProviderRejected),
            }
        }
        return Some(AiError::ProviderRejected);
    }
    None
}

fn extract_chat_response_text(value: &serde_json::Value) -> Option<String> {
    if let Some(choice) = value
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .and_then(|choices| choices.first())
    {
        if let Some(content) = choice.get("message").and_then(|m| m.get("content")) {
            if let Some(s) = content.as_str().filter(|s| !s.trim().is_empty()) {
                return Some(s.to_owned());
            }
            if let Some(parts) = content.as_array() {
                let text: String = parts
                    .iter()
                    .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
                    .collect();
                if !text.trim().is_empty() {
                    return Some(text);
                }
            }
        }
        if let Some(t) = choice
            .get("text")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            return Some(t.to_owned());
        }
        if let Some(s) = choice
            .get("delta")
            .and_then(|d| d.get("content"))
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.trim().is_empty())
        {
            return Some(s.to_owned());
        }
    }
    if let Some(content) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        return Some(content.to_owned());
    }
    if let Some(resp) = value
        .get("response")
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        return Some(resp.to_owned());
    }
    if let Some(t) = value
        .get("text")
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        return Some(t.to_owned());
    }
    if let Some(out) = value
        .get("output")
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        return Some(out.to_owned());
    }
    if let Some(content) = value.get("content").and_then(serde_json::Value::as_array) {
        let text: String = content
            .iter()
            .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
            .collect();
        if !text.trim().is_empty() {
            return Some(text);
        }
    }
    None
}

fn parse_chat_response(
    value: &serde_json::Value,
    prompt: &str,
) -> Result<AiProviderResponse, AiError> {
    if let Some(err) = detect_provider_json_error(value) {
        return Err(err);
    }
    let text = extract_chat_response_text(value).ok_or(AiError::ProviderInvalidResponse)?;
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

fn parse_sensenova_chat_response(
    value: &serde_json::Value,
    prompt: &str,
) -> Result<AiProviderResponse, AiError> {
    if value
        .get("status")
        .and_then(|status| status.get("code"))
        .and_then(serde_json::Value::as_i64)
        .is_some_and(|code| code != 0)
    {
        return Err(AiError::ProviderRejected);
    }
    let data = value.get("data").ok_or(AiError::ProviderInvalidResponse)?;
    let choice = data
        .get("choices")
        .and_then(serde_json::Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or(AiError::ProviderInvalidResponse)?;
    let text = choice
        .get("message")
        .and_then(serde_json::Value::as_str)
        .or_else(|| choice.get("reply").and_then(serde_json::Value::as_str))
        .or_else(|| choice.get("delta").and_then(serde_json::Value::as_str))
        .unwrap_or_default()
        .to_owned();
    if text.trim().is_empty() {
        return Err(AiError::ProviderInvalidResponse);
    }
    let usage = data.get("usage");
    let input_tokens = usage
        .and_then(|usage| usage.get("prompt_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_else(|| estimate_tokens(prompt));
    let output_tokens = usage
        .and_then(|usage| usage.get("completion_tokens"))
        .and_then(serde_json::Value::as_u64)
        .unwrap_or_else(|| estimate_tokens(&text));
    Ok(AiProviderResponse {
        text,
        input_tokens,
        output_tokens,
        cached_input_tokens: 0,
        reasoning_tokens: 0,
        usage_source: if usage.is_some() {
            "provider"
        } else {
            "estimated"
        }
        .to_owned(),
    })
}

fn extract_choice_chunk_text(choice: &serde_json::Value) -> Option<String> {
    if let Some(delta) = choice.get("delta") {
        if let Some(content) = delta.get("content") {
            if let Some(s) = content.as_str().filter(|s| !s.is_empty()) {
                return Some(s.to_owned());
            }
            if let Some(arr) = content.as_array() {
                let joined: String = arr
                    .iter()
                    .filter_map(|part| part.get("text").and_then(serde_json::Value::as_str))
                    .collect();
                if !joined.is_empty() {
                    return Some(joined);
                }
            }
        }
        if let Some(text) = delta
            .get("text")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty())
        {
            return Some(text.to_owned());
        }
    }
    if let Some(text) = choice
        .get("text")
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Some(text.to_owned());
    }
    if let Some(content) = choice
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Some(content.to_owned());
    }
    None
}

fn extract_any_chunk_text(val: &serde_json::Value) -> Option<String> {
    // 1. Chat completions choices array
    if let Some(choices) = val.get("choices").and_then(serde_json::Value::as_array) {
        let accumulated: String = choices
            .iter()
            .filter_map(extract_choice_chunk_text)
            .collect();
        if !accumulated.is_empty() {
            return Some(accumulated);
        }
    }

    // 2. OpenAI / Doubao Responses API
    if let Some(delta) = val.get("delta") {
        if let Some(s) = delta.as_str().filter(|s| !s.is_empty()) {
            return Some(s.to_owned());
        }
        if let Some(text) = delta
            .get("text")
            .and_then(serde_json::Value::as_str)
            .filter(|s| !s.is_empty())
        {
            return Some(text.to_owned());
        }
    }

    // 3. Direct response fields (NDJSON / simple proxies)
    if let Some(content) = val
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Some(content.to_owned());
    }
    if let Some(resp) = val
        .get("response")
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Some(resp.to_owned());
    }
    if let Some(text) = val
        .get("text")
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Some(text.to_owned());
    }
    if let Some(output) = val
        .get("output")
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Some(output.to_owned());
    }
    if let Some(text) = val
        .get("part")
        .and_then(|p| p.get("text"))
        .and_then(serde_json::Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Some(text.to_owned());
    }

    None
}

fn offline_response(prompt: &str, image_count: usize, file_count: usize) -> AiProviderResponse {
    let preview = prompt.chars().take(120).collect::<String>();
    let text = format!(
        "离线测试已完成。KyStudy 收到 {image_count} 张题目图片和 {file_count} 个原生文件，外发预览内容为：“{preview}”。这只是确定性测试结果，不是学习建议，也不会修改任何本地数据。"
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

fn offline_response_stream(
    prompt: &str,
    image_count: usize,
    file_count: usize,
    canceled: Option<&AtomicBool>,
    on_chunk: &mut dyn FnMut(&str) -> Result<(), AiError>,
) -> Result<AiProviderResponse, AiError> {
    let full = offline_response(prompt, image_count, file_count);
    let chars: Vec<char> = full.text.chars().collect();
    for chunk in chars.chunks(16) {
        if canceled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return Err(AiError::Canceled);
        }
        let chunk_str: String = chunk.iter().collect();
        on_chunk(&chunk_str)?;
    }
    Ok(full)
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
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    stream: bool,
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
    #[serde(rename = "input_file")]
    File {
        filename: &'a str,
        file_data: String,
    },
}

fn responses_request<'a>(
    model: &'a str,
    prompt: &'a str,
    image_data_urls: &'a [String],
    file_attachments: &'a [AiFileAttachment],
    max_output_tokens: u32,
) -> Result<ResponsesRequest<'a>, AiError> {
    responses_request_internal(
        model,
        prompt,
        image_data_urls,
        file_attachments,
        max_output_tokens,
        false,
    )
}

fn responses_stream_request<'a>(
    model: &'a str,
    prompt: &'a str,
    image_data_urls: &'a [String],
    file_attachments: &'a [AiFileAttachment],
    max_output_tokens: u32,
) -> Result<ResponsesRequest<'a>, AiError> {
    responses_request_internal(
        model,
        prompt,
        image_data_urls,
        file_attachments,
        max_output_tokens,
        true,
    )
}

fn responses_request_internal<'a>(
    model: &'a str,
    prompt: &'a str,
    image_data_urls: &'a [String],
    file_attachments: &'a [AiFileAttachment],
    max_output_tokens: u32,
    stream: bool,
) -> Result<ResponsesRequest<'a>, AiError> {
    let input = if image_data_urls.is_empty() && file_attachments.is_empty() {
        ResponsesInput::Text(prompt)
    } else {
        let mut content = Vec::with_capacity(
            image_data_urls
                .len()
                .saturating_add(file_attachments.len())
                .saturating_add(1),
        );
        content.push(ResponsesContentPart::Text { text: prompt });
        content.extend(
            image_data_urls
                .iter()
                .map(|image_url| ResponsesContentPart::Image {
                    image_url,
                    detail: "auto",
                }),
        );
        for attachment in file_attachments {
            let encoded = read_native_file(attachment)?;
            content.push(ResponsesContentPart::File {
                filename: &attachment.file_name,
                file_data: encoded,
            });
        }
        ResponsesInput::Messages(vec![ResponsesMessage {
            kind: "message",
            role: "user",
            content,
        }])
    };
    Ok(ResponsesRequest {
        model,
        input,
        max_output_tokens,
        store: false,
        stream,
    })
}

fn read_native_file(attachment: &AiFileAttachment) -> Result<String, AiError> {
    if attachment.size_bytes > MAXIMUM_NATIVE_FILE_BYTES {
        return Err(AiError::NativeAttachmentTooLarge);
    }
    let mut file = File::open(&attachment.path).map_err(|_| AiError::AttachmentIntegrityFailed)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|_| AiError::AttachmentIntegrityFailed)?;
    if bytes.len() as u64 != attachment.size_bytes
        || format!("{:X}", Sha256::digest(&bytes)) != attachment.sha256.to_ascii_uppercase()
    {
        return Err(AiError::AttachmentIntegrityFailed);
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
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
    use std::sync::atomic::AtomicBool;

    use reqwest::StatusCode;
    use sha2::{Digest, Sha256};
    use tempfile::NamedTempFile;

    use super::{
        chat_completions_request, model_list_status_error, offline_response, parse_chat_response,
        parse_model_list, parse_qwen_model_list, parse_sensenova_chat_response,
        qwen_deployable_model_endpoint, responses_request, responses_stream_request,
        sensenova_chat_request, status_error,
    };
    use crate::application::{AiError, AiFileAttachment, AiProviderGateway};
    use crate::domain::AiProviderType;

    #[test]
    fn offline_provider_is_deterministic_and_reports_estimated_usage() {
        let first = offline_response("测试外发内容", 0, 0);
        let second = offline_response("测试外发内容", 0, 0);

        assert_eq!(first, second);
        assert_eq!(first.usage_source, "estimated");
    }

    #[test]
    fn responses_request_uses_ordered_image_parts_for_question_analysis() {
        let images = vec![
            "data:image/png;base64,AAA".to_owned(),
            "data:image/jpeg;base64,BBB".to_owned(),
        ];
        let request =
            responses_request("model", "分析", &images, &[], 600).expect("request should build");
        let value = serde_json::to_value(request).expect("request should serialize");

        assert_eq!(value["input"][0]["type"], "message");
        assert_eq!(value["input"][0]["content"][1]["image_url"], images[0]);
        assert_eq!(value["input"][0]["content"][2]["image_url"], images[1]);
    }

    #[test]
    fn responses_request_embeds_only_verified_native_file_data() {
        let bytes = b"native file body";
        let file = NamedTempFile::new().expect("temporary file should create");
        std::fs::write(file.path(), bytes).expect("temporary file should write");
        let attachment = AiFileAttachment {
            file_name: "notes.txt".to_owned(),
            mime_type: "text/plain".to_owned(),
            path: file.path().to_owned(),
            size_bytes: bytes.len() as u64,
            sha256: format!("{:X}", Sha256::digest(bytes)),
        };
        let attachments = [attachment];
        let request = responses_request("model", "读取", &[], &attachments, 600)
            .expect("native file request should build");
        let value = serde_json::to_value(request).expect("request should serialize");

        assert_eq!(value["input"][0]["content"][1]["type"], "input_file");
        assert_eq!(value["input"][0]["content"][1]["filename"], "notes.txt");
        assert_eq!(
            value["input"][0]["content"][1]["file_data"],
            "bmF0aXZlIGZpbGUgYm9keQ=="
        );
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
    fn sensenova_request_uses_native_fields_and_image_url_strings() {
        let images = vec!["data:image/png;base64,AAA".to_owned()];
        let value = sensenova_chat_request("SenseNova-V6-5-Pro", "分析", &images, 600);

        assert_eq!(value["messages"][0]["role"], "user");
        assert_eq!(value["messages"][0]["content"][0]["type"], "text");
        assert_eq!(value["messages"][0]["content"][1]["image_url"], images[0]);
        assert_eq!(value["max_new_tokens"], 600);
        assert_eq!(value["thinking"]["enabled"], false);
    }

    #[test]
    fn sensenova_response_unwraps_native_data_envelope() {
        let value = serde_json::json!({
            "data": {
                "choices": [{ "message": "回答", "finish_reason": "stop" }],
                "usage": { "prompt_tokens": 12, "completion_tokens": 7 }
            },
            "status": { "code": 0, "message": "ok" }
        });
        let response =
            parse_sensenova_chat_response(&value, "问题").expect("SenseNova response should parse");

        assert_eq!(response.text, "回答");
        assert_eq!(response.input_tokens, 12);
        assert_eq!(response.output_tokens, 7);
        assert_eq!(response.usage_source, "provider");
    }

    #[test]
    fn sensenova_response_maps_nonzero_status_to_rejected() {
        let value = serde_json::json!({
            "data": { "choices": [] },
            "status": { "code": 1001, "message": "bad request" }
        });

        assert!(matches!(
            parse_sensenova_chat_response(&value, "问题"),
            Err(AiError::ProviderRejected)
        ));
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
    fn model_list_parser_accepts_sensenova_uppercase_list_envelope() {
        let value = serde_json::json!({
            "object": "LIST",
            "data": [{ "id": "SenseNova-V6-5-Pro" }]
        });

        let models = parse_model_list(&value).expect("SenseNova model list should parse");

        assert_eq!(models[0].id, "SenseNova-V6-5-Pro");
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

    #[test]
    fn offline_response_stream_yields_all_chunks_and_full_response() {
        let mut chunks = Vec::new();
        let response =
            super::offline_response_stream("考研数学复习计划", 0, 0, None, &mut |chunk| {
                chunks.push(chunk.to_owned());
                Ok(())
            })
            .expect("offline stream should succeed");

        let accumulated = chunks.concat();
        assert_eq!(accumulated, response.text);
        assert!(!chunks.is_empty());
    }

    #[test]
    fn offline_response_stream_stops_on_cancellation() {
        let canceled = AtomicBool::new(true);
        let mut chunks = Vec::new();
        let result = super::offline_response_stream(
            "考研数学复习计划",
            0,
            0,
            Some(&canceled),
            &mut |chunk| {
                chunks.push(chunk.to_owned());
                Ok(())
            },
        );

        assert!(matches!(result, Err(AiError::Canceled)));
        assert!(chunks.is_empty());
    }

    #[test]
    fn responses_stream_request_serializes_stream_flag() {
        let req = responses_stream_request("gpt-4o", "测试", &[], &[], 1000)
            .expect("stream request should build");
        let serialized = serde_json::to_value(&req).expect("should serialize");
        assert_eq!(serialized["stream"], serde_json::json!(true));
    }

    #[test]
    fn extract_any_chunk_text_handles_various_delta_and_ndjson_formats() {
        // Standard delta content string
        let standard = serde_json::json!({
            "choices": [{
                "delta": { "content": "你好" }
            }]
        });
        assert_eq!(
            super::extract_any_chunk_text(&standard),
            Some("你好".to_owned())
        );

        // Delta reasoning content
        // Delta reasoning content is ignored from final output stream
        let reasoning = serde_json::json!({
            "choices": [{
                "delta": { "reasoning_content": "思考中" }
            }]
        });
        assert_eq!(super::extract_any_chunk_text(&reasoning), None);

        // Delta content array
        let array_content = serde_json::json!({
            "choices": [{
                "delta": {
                    "content": [
                        { "type": "text", "text": "第一" },
                        { "type": "text", "text": "部分" }
                    ]
                }
            }]
        });
        assert_eq!(
            super::extract_any_chunk_text(&array_content),
            Some("第一部分".to_owned())
        );

        // Delta text
        let delta_text = serde_json::json!({
            "choices": [{
                "delta": { "text": "增量文本" }
            }]
        });
        assert_eq!(
            super::extract_any_chunk_text(&delta_text),
            Some("增量文本".to_owned())
        );

        // Top level text under choice
        let choice_text = serde_json::json!({
            "choices": [{
                "text": "顶层文本"
            }]
        });
        assert_eq!(
            super::extract_any_chunk_text(&choice_text),
            Some("顶层文本".to_owned())
        );

        // Responses API delta
        let str_delta = serde_json::json!({ "delta": "流式" });
        assert_eq!(
            super::extract_any_chunk_text(&str_delta),
            Some("流式".to_owned())
        );

        // Direct message content (NDJSON)
        let ndjson = serde_json::json!({ "message": { "content": "NDJSON文本" } });
        assert_eq!(
            super::extract_any_chunk_text(&ndjson),
            Some("NDJSON文本".to_owned())
        );

        // Empty delta returns None
        let empty = serde_json::json!({
            "choices": [{
                "delta": { "content": "" }
            }]
        });
        assert_eq!(super::extract_any_chunk_text(&empty), None);
    }

    #[test]
    fn parse_chat_response_handles_choice_text_and_error_formats() {
        let legacy_json = serde_json::json!({
            "choices": [{
                "text": "传统补全格式回复"
            }]
        });
        let parsed =
            parse_chat_response(&legacy_json, "prompt").expect("should parse legacy choice text");
        assert_eq!(parsed.text, "传统补全格式回复");

        let error_json = serde_json::json!({
            "error": {
                "message": "Incorrect API key provided",
                "code": "invalid_api_key"
            }
        });
        let err = parse_chat_response(&error_json, "prompt").unwrap_err();
        assert!(matches!(err, AiError::ProviderAuthentication));
    }
}
