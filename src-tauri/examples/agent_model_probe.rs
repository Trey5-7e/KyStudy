//! Explicitly authorized, bounded tool-protocol probe using an existing release Provider.
//! Reads only Provider metadata and its OS credential; never migrates the user's database.

use base64::Engine;
use rusqlite::{Connection, OpenFlags, params};
use serde_json::{Value, json};
use std::time::Duration;

const MODEL: &str = "deepseek-v4-flash-vision-exp";
const MAX_TOKENS: u64 = 80_000;

struct Probe {
    client: reqwest::Client,
    endpoint: String,
    key: String,
    reserved: u64,
    reported: u64,
    calls: u32,
}

struct Released(std::sync::Arc<std::sync::atomic::AtomicBool>);
impl Drop for Released {
    fn drop(&mut self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}

impl Probe {
    async fn cancel_stream(&mut self) -> Result<(), &'static str> {
        let body = json!({"model":MODEL,"messages":[{"role":"user","content":"Synthetic cancellation test: explain matrix similarity in detail."}],"stream":true,"max_tokens":512});
        let request = body.to_string();
        let estimate = u64::try_from(request.len()).map_err(|_| "INPUT_TOO_LARGE")? + 4096 + 512;
        if self
            .reserved
            .checked_add(estimate)
            .is_none_or(|sum| sum > MAX_TOKENS)
        {
            return Err("AUTHORIZED_TOKEN_CAP_EXHAUSTED");
        }
        self.reserved += estimate;
        println!(
            "{}",
            json!({"event":"reserved","reservedTokens":self.reserved,"cap":MAX_TOKENS,"stage":"cancel_probe"})
        );
        let client = self.client.clone();
        let endpoint = self.endpoint.clone();
        let key = self.key.clone();
        let released = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let guard = Released(released.clone());
        let (ready, started) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let _guard = guard;
            let mut response = client
                .post(endpoint)
                .bearer_auth(key)
                .header("Content-Type", "application/json")
                .body(request)
                .send()
                .await
                .map_err(|_| "CANCEL_TRANSPORT_ERROR")?;
            if !response.status().is_success() {
                return Err("CANCEL_HTTP_ERROR");
            }
            if response
                .chunk()
                .await
                .map_err(|_| "CANCEL_STREAM_ERROR")?
                .is_none()
            {
                return Err("CANCEL_STREAM_ALREADY_ENDED");
            }
            let _ = ready.send(());
            while response
                .chunk()
                .await
                .map_err(|_| "CANCEL_STREAM_ERROR")?
                .is_some()
            {}
            Ok::<_, &'static str>(())
        });
        if started.await.is_err() {
            let _ = task.await;
            return Err("CANCEL_STREAM_NOT_STARTED");
        }
        let before = std::time::Instant::now();
        task.abort();
        let canceled = task.await.is_err_and(|error| error.is_cancelled());
        let dropped = released.load(std::sync::atomic::Ordering::SeqCst);
        println!(
            "{}",
            json!({"model":MODEL,"stage":"body","joinedCanceled":canceled,"released":dropped,"elapsedMs":before.elapsed().as_millis(),"reservedTokens":self.reserved,"reportedTokens":null,"remoteBilling":"unknown after cancellation"})
        );
        if !canceled || !dropped {
            return Err("CANCEL_NOT_OBSERVED");
        }
        Ok(())
    }
    async fn request(&mut self, body: &Value) -> Result<Value, &'static str> {
        let request = body.to_string();
        let estimate = u64::try_from(request.len()).map_err(|_| "INPUT_TOO_LARGE")?
            + 4096
            + body["max_tokens"].as_u64().ok_or("OUTPUT_LIMIT_MISSING")?;
        if self.calls >= 4
            || self
                .reserved
                .checked_add(estimate)
                .is_none_or(|sum| sum > MAX_TOKENS)
        {
            return Err("AUTHORIZED_TOKEN_CAP_EXHAUSTED");
        }
        self.reserved += estimate;
        self.calls += 1;
        // Emit only counters before dispatch; never credentials, request bodies or reasoning.
        println!(
            "{}",
            json!({"event":"reserved","requests":self.calls,"reservedTokens":self.reserved,"cap":MAX_TOKENS})
        );
        let mut response = self
            .client
            .post(&self.endpoint)
            .bearer_auth(&self.key)
            .header("Content-Type", "application/json")
            .body(request)
            .send()
            .await
            .map_err(|_| "PROVIDER_TRANSPORT_ERROR")?;
        if !response.status().is_success() {
            println!(
                "{}",
                json!({"event":"http_error","status":response.status().as_u16()})
            );
            return Err("PROVIDER_HTTP_ERROR");
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "PROVIDER_STREAM_ERROR")?
        {
            if chunk.len() > 65_536 - bytes.len() {
                return Err("PROVIDER_RESPONSE_TOO_LARGE");
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|_| "PROVIDER_JSON_INVALID")?;
        let usage = value["usage"]["total_tokens"]
            .as_u64()
            .ok_or("PROVIDER_USAGE_MISSING")?;
        self.reported = self
            .reported
            .checked_add(usage)
            .ok_or("PROVIDER_USAGE_INVALID")?;
        if usage > estimate || self.reported > MAX_TOKENS {
            return Err("PROVIDER_USAGE_EXCEEDS_RESERVATION");
        }
        Ok(value)
    }
}

fn setup(path: &str, prior_reserved: u64) -> Result<Probe, &'static str> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "PROVIDER_CONFIG_UNAVAILABLE")?;
    let (base_url,secret_ref,protocol):(String,String,String)=db.query_row("SELECT p.base_url,p.secret_ref,p.provider_protocol FROM ai_provider_config p JOIN ai_model_profile m ON m.provider_config_id=p.id WHERE p.enabled=1 AND p.deleted_at IS NULL AND m.model_name=?1",params![MODEL],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(|_|"SELECTED_MODEL_CONFIG_NOT_FOUND")?;
    if protocol != "deepseek_chat" {
        return Err("SELECTED_PROTOCOL_MISMATCH");
    }
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let url = reqwest::Url::parse(&endpoint).map_err(|_| "PROVIDER_ENDPOINT_INVALID")?;
    if url.scheme() != "https"
        || url.host_str() != Some("api.deepseek.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
    {
        return Err("PROVIDER_ENDPOINT_NOT_AUTHORIZED");
    }
    let key = keyring::Entry::new("io.github.kystudy.ai", &secret_ref)
        .map_err(|_| "PROVIDER_CREDENTIAL_UNAVAILABLE")?
        .get_password()
        .map_err(|_| "PROVIDER_CREDENTIAL_UNAVAILABLE")?;
    if key.trim().is_empty() {
        return Err("PROVIDER_CREDENTIAL_UNAVAILABLE");
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_mins(1))
        .build()
        .map_err(|_| "CLIENT_INIT_FAILED")?;
    Ok(Probe {
        client,
        endpoint,
        key,
        reserved: prior_reserved,
        reported: 0,
        calls: 0,
    })
}

async fn tool_roundtrip(probe: &mut Probe) -> Result<bool, &'static str> {
    let mut messages = vec![
        json!({"role":"user","content":"This is a synthetic tool protocol test. Read document synthetic revision v1 page 1 using read_resource_pages. After the tool result, return only JSON with message and sourceIds, citing the tool's source_id. Do not use external knowledge."}),
    ];
    let first=probe.request(&json!({"model":MODEL,"messages":messages,"max_tokens":2048,"stream":false,"tools":[{"type":"function","function":{"name":"read_resource_pages","description":"Read the single synthetic page authorized for this test","parameters":{"type":"object","properties":{"documentId":{"type":"string","enum":["synthetic"]},"revision":{"type":"string","enum":["v1"]},"page":{"type":"integer","enum":[1]}},"required":["documentId","revision","page"],"additionalProperties":false}}}]})).await?;
    let choices = first["choices"].as_array().ok_or("CHOICES_MISSING")?;
    if choices.len() != 1 || choices[0]["finish_reason"] != "tool_calls" {
        return Err("NATIVE_TOOL_CALL_NOT_COMPLETED");
    }
    let message = &choices[0]["message"];
    let calls = message["tool_calls"]
        .as_array()
        .ok_or("NATIVE_TOOL_CALL_MISSING")?;
    if calls.len() != 1
        || calls[0]["type"] != "function"
        || calls[0]["function"]["name"] != "read_resource_pages"
    {
        return Err("NATIVE_TOOL_CALL_INVALID");
    }
    let id = calls[0]["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 128)
        .ok_or("CALL_ID_INVALID")?;
    let args: Value = serde_json::from_str(
        calls[0]["function"]["arguments"]
            .as_str()
            .ok_or("ARGUMENTS_MISSING")?,
    )
    .map_err(|_| "ARGUMENTS_INVALID")?;
    if args != json!({"documentId":"synthetic","revision":"v1","page":1}) {
        return Err("SYNTHETIC_SCOPE_DENIED");
    }
    // Retain Provider-required private continuation in memory only, never public output.
    messages.push(message.clone());
    messages.push(json!({"role":"tool","tool_call_id":id,"content":json!({"source_id":"synthetic:v1:1","text":"Similar matrices have the same eigenvalues."}).to_string()}));
    let final_reply=probe.request(&json!({"model":MODEL,"messages":messages,"max_tokens":2048,"stream":false,"response_format":{"type":"json_object"}})).await?;
    if final_reply["choices"][0]["finish_reason"] != "stop" {
        return Err("FINAL_ANSWER_INCOMPLETE");
    }
    let answer: Value = serde_json::from_str(
        final_reply["choices"][0]["message"]["content"]
            .as_str()
            .ok_or("FINAL_CONTENT_MISSING")?,
    )
    .map_err(|_| "FINAL_ENVELOPE_INVALID")?;
    Ok(answer["sourceIds"] == json!(["synthetic:v1:1"])
        && answer["message"]
            .as_str()
            .is_some_and(|message| !message.is_empty()))
}

async fn vision(probe: &mut Probe, red: bool) -> Result<bool, &'static str> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 32, 32);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|_| "IMAGE_FIXTURE_INVALID")?;
        let pixel = if red { [255, 0, 0] } else { [0, 0, 255] };
        let pixels = pixel.repeat(32 * 32);
        writer
            .write_image_data(&pixels)
            .map_err(|_| "IMAGE_FIXTURE_INVALID")?;
    }
    let image = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    let result=probe.request(&json!({"model":MODEL,"messages":[{"role":"user","content":[{"type":"text","text":"What is the dominant color in this image? Answer with one English color word only."},{"type":"image_url","image_url":{"url":image}}]}],"max_tokens":256,"stream":false})).await?;
    let answer = result["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("VISION_CONTENT_MISSING")?
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    Ok(answer == if red { "red" } else { "blue" })
}

fn main() {
    let args: Vec<_> = std::env::args().collect();
    if !matches!(args.len(), 4 | 6 | 7) || args[2] != "--authorized-token-cap" || args[3] != "80000"
    {
        eprintln!("Usage: agent_model_probe DATABASE --authorized-token-cap 80000");
        std::process::exit(2);
    }
    let cancel_only = args.len() == 7 && args[6] == "--cancel-only";
    let prior_reserved =
        if args.len() >= 6 && args[4] == "--prior-reserved" && (args.len() == 6 || cancel_only) {
            args[5].parse::<u64>().ok().filter(|n| *n < MAX_TOKENS)
        } else if args.len() == 4 {
            Some(0)
        } else {
            None
        };
    let Some(prior_reserved) = prior_reserved else {
        eprintln!("INVALID_PRIOR_RESERVATION");
        std::process::exit(2);
    };
    let result = tauri::async_runtime::block_on(async {
        let mut probe = setup(&args[1], prior_reserved)?;
        if cancel_only {
            return probe.cancel_stream().await;
        }
        let tool = tool_roundtrip(&mut probe).await?;
        if !tool {
            return Err("TOOL_SOURCE_VALIDATION_FAILED");
        }
        let blue = vision(&mut probe, false).await?;
        let red = vision(&mut probe, true).await?;
        println!(
            "{}",
            json!({"model":MODEL,"toolRoundtrip":tool,"blueImage":blue,"redImage":red,"requests":probe.calls,"reservedTokens":probe.reserved,"reportedTokens":probe.reported,"cap":MAX_TOKENS})
        );
        if !blue || !red {
            return Err("VISION_VALIDATION_FAILED");
        }
        Ok(())
    });
    if let Err(code) = result {
        eprintln!("{code}");
        std::process::exit(1);
    }
}
