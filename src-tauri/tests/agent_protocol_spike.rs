//! M0-B Chat Completions fixture adapter; not a production/model compatibility claim.

use serde_json::{Value, json};

#[path = "support/answer.rs"]
mod answer;
#[path = "support/protocol_loop.rs"]
mod protocol_loop;
#[path = "support/responses.rs"]
mod responses;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("AGENT_PROVIDER_PROTOCOL_ERROR")]
struct ProtocolError;

#[derive(Debug, Default, PartialEq, Eq)]
struct Call {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Debug, Default)]
struct ChatStream {
    line: Vec<u8>,
    data: String,
    bytes: usize,
    failed: bool,
    done: bool,
    finish: Option<String>,
    response_id: Option<String>,
    text: String,
    calls: Vec<Call>,
    usage: Option<Value>,
}

#[derive(Debug)]
struct Completed {
    text: String,
    calls: Vec<Call>,
    usage: Option<Value>,
}

fn string(value: &Value) -> Result<&str, ProtocolError> {
    value.as_str().ok_or(ProtocolError)
}

fn append(target: &mut String, value: &str, limit: usize) -> Result<(), ProtocolError> {
    if value.len() > limit.saturating_sub(target.len()) {
        return Err(ProtocolError);
    }
    target.push_str(value);
    Ok(())
}

impl ChatStream {
    // Feed never exposes executable calls. Only consuming finish can yield a completed batch.
    fn feed(&mut self, bytes: &[u8]) -> Result<(), ProtocolError> {
        if self.failed {
            return Err(ProtocolError);
        }
        let result = self.feed_inner(bytes);
        self.failed = result.is_err();
        result
    }

    fn feed_inner(&mut self, bytes: &[u8]) -> Result<(), ProtocolError> {
        if bytes.len() > 65_536 - self.bytes {
            return Err(ProtocolError);
        }
        self.bytes += bytes.len();
        for byte in bytes {
            if self.done {
                return Err(ProtocolError);
            }
            if *byte != b'\n' {
                if self.line.len() >= 16_384 {
                    return Err(ProtocolError);
                }
                self.line.push(*byte);
                continue;
            }
            let line = std::mem::take(&mut self.line);
            let line = std::str::from_utf8(&line)
                .map_err(|_| ProtocolError)?
                .trim_end_matches('\r');
            if line.is_empty() {
                if !self.data.is_empty() {
                    let data = std::mem::take(&mut self.data);
                    self.event(data.trim_end_matches('\n'))?;
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                append(
                    &mut self.data,
                    data.strip_prefix(' ').unwrap_or(data),
                    16_384,
                )?;
                append(&mut self.data, "\n", 16_384)?;
            } else if !line.starts_with(':') {
                return Err(ProtocolError);
            }
        }
        Ok(())
    }

    fn event(&mut self, data: &str) -> Result<(), ProtocolError> {
        if data == "[DONE]" {
            if self.finish.is_none() {
                return Err(ProtocolError);
            }
            self.done = true;
            return Ok(());
        }
        let event: Value = serde_json::from_str(data).map_err(|_| ProtocolError)?;
        if event["object"] != "chat.completion.chunk" {
            return Err(ProtocolError);
        }
        let id = string(&event["id"])?;
        if id.is_empty() || id.len() > 128 || self.response_id.as_ref().is_some_and(|old| old != id)
        {
            return Err(ProtocolError);
        }
        self.response_id = Some(id.into());
        let choices = event["choices"].as_array().ok_or(ProtocolError)?;
        if !event["usage"].is_null() {
            if self.usage.is_some() {
                return Err(ProtocolError);
            }
            self.usage = Some(event["usage"].clone());
        }
        if choices.is_empty() {
            return if self.finish.is_some() && self.usage.is_some() {
                Ok(())
            } else {
                Err(ProtocolError)
            };
        }
        if choices.len() != 1 || choices[0]["index"] != 0 || self.finish.is_some() {
            return Err(ProtocolError);
        }
        let choice = &choices[0];
        self.delta(&choice["delta"])?;
        if !choice["finish_reason"].is_null() {
            let reason = string(&choice["finish_reason"])?;
            if !matches!(
                (reason, self.calls.is_empty()),
                ("stop", true) | ("tool_calls", false)
            ) {
                return Err(ProtocolError);
            }
            self.finish = Some(reason.into());
        }
        Ok(())
    }

    fn delta(&mut self, delta: &Value) -> Result<(), ProtocolError> {
        let fields = delta.as_object().ok_or(ProtocolError)?;
        if fields
            .keys()
            .any(|key| !matches!(key.as_str(), "role" | "content" | "tool_calls"))
            || (!delta["role"].is_null() && delta["role"] != "assistant")
        {
            return Err(ProtocolError);
        }
        if !delta["content"].is_null() {
            append(&mut self.text, string(&delta["content"])?, 8192)?;
        }
        if let Some(calls) = delta.get("tool_calls") {
            for call in calls.as_array().ok_or(ProtocolError)? {
                self.call_delta(call)?;
            }
        }
        Ok(())
    }

    fn call_delta(&mut self, delta: &Value) -> Result<(), ProtocolError> {
        let index = delta["index"].as_u64().ok_or(ProtocolError)?;
        let index = usize::try_from(index).map_err(|_| ProtocolError)?;
        if index > self.calls.len() || index >= 12 {
            return Err(ProtocolError);
        }
        if index == self.calls.len() {
            if delta["type"] != "function" {
                return Err(ProtocolError);
            }
            let id = string(&delta["id"])?;
            if id.is_empty() || id.len() > 128 || self.calls.iter().any(|call| call.id == id) {
                return Err(ProtocolError);
            }
            self.calls.push(Call {
                id: id.into(),
                ..Call::default()
            });
        } else if (!delta["id"].is_null() && delta["id"] != self.calls[index].id)
            || (!delta["type"].is_null() && delta["type"] != "function")
        {
            return Err(ProtocolError);
        }
        let function = delta["function"].as_object().ok_or(ProtocolError)?;
        let call = &mut self.calls[index];
        if let Some(name) = function.get("name") {
            append(&mut call.name, string(name)?, 128)?;
        }
        if let Some(arguments) = function.get("arguments") {
            append(&mut call.arguments, string(arguments)?, 4096)?;
        }
        Ok(())
    }

    fn finish(self) -> Result<Completed, ProtocolError> {
        if self.failed || !self.done || !self.line.is_empty() || !self.data.is_empty() {
            return Err(ProtocolError);
        }
        for call in &self.calls {
            let arguments: Value =
                serde_json::from_str(&call.arguments).map_err(|_| ProtocolError)?;
            if call.name.is_empty() || !arguments.is_object() {
                return Err(ProtocolError);
            }
        }
        Ok(Completed {
            text: self.text,
            calls: self.calls,
            usage: self.usage,
        })
    }
}

impl Completed {
    fn continuation(&self, results: &[(&str, &str)]) -> Result<Vec<Value>, ProtocolError> {
        if results.len() != self.calls.len() {
            return Err(ProtocolError);
        }
        let mut messages = vec![json!({"role":"assistant", "content":self.text,
            "tool_calls":self.calls.iter().map(|call| json!({"id":call.id,"type":"function","function":{"name":call.name,"arguments":call.arguments}})).collect::<Vec<_>>()})];
        for call in &self.calls {
            let matches: Vec<_> = results.iter().filter(|(id, _)| *id == call.id).collect();
            if matches.len() != 1 || matches[0].1.len() > 16_384 {
                return Err(ProtocolError);
            }
            messages.push(json!({"role":"tool","tool_call_id":call.id,"content":matches[0].1}));
        }
        Ok(messages)
    }
}

fn chunk(delta: &Value, finish: &Value) -> String {
    format!(
        "data: {}\r\n\r\n",
        json!({"id":"fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":delta,"finish_reason":finish}]})
    )
}

fn fixture() -> String {
    [chunk(&json!({"role":"assistant","content":"查资料","tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"read_resource_pages","arguments":"{\"page\":"}}]}), &Value::Null),
     chunk(&json!({"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}), &Value::Null),
     chunk(&json!({}), &json!("tool_calls")),
     "data: [DONE]\r\n\r\n".into()].concat()
}

#[test]
fn every_byte_split_preserves_mixed_text_and_native_call() {
    let fixture = fixture();
    for split in 0..=fixture.len() {
        let mut stream = ChatStream::default();
        stream.feed(&fixture.as_bytes()[..split]).unwrap();
        stream.feed(&fixture.as_bytes()[split..]).unwrap();
        let completed = stream.finish().unwrap();
        assert_eq!(completed.text, "查资料");
        assert_eq!(
            completed.calls,
            vec![Call {
                id: "c1".into(),
                name: "read_resource_pages".into(),
                arguments: r#"{"page":1}"#.into()
            }]
        );
    }
}

#[test]
fn unfinished_stream_never_yields_calls() {
    let fixture = fixture();
    for end in 0..fixture.len() {
        let mut stream = ChatStream::default();
        stream.feed(&fixture.as_bytes()[..end]).unwrap();
        assert!(stream.finish().is_err());
    }
}

#[test]
fn continuation_pairs_results_and_preserves_assistant_call() {
    let mut stream = ChatStream::default();
    stream.feed(fixture().as_bytes()).unwrap();
    let completed = stream.finish().unwrap();
    let messages = completed.continuation(&[("c1", "page evidence")]).unwrap();
    assert_eq!(messages[0]["tool_calls"][0]["id"], "c1");
    assert_eq!(
        messages[1],
        json!({"role":"tool","tool_call_id":"c1","content":"page evidence"})
    );
    assert!(completed.continuation(&[]).is_err());
    assert!(completed.continuation(&[("forged", "x")]).is_err());
}

#[test]
fn text_only_stop_preserves_usage() {
    let mut stream = ChatStream::default();
    let usage = json!({"prompt_tokens":10,"completion_tokens":5,"total_tokens":15});
    let wire = [
        chunk(&json!({"content":"answer"}), &json!("stop")),
        format!(
            "data: {}\n\n",
            json!({"id":"fixture","object":"chat.completion.chunk","choices":[],"usage":usage})
        ),
        "data: [DONE]\n\n".into(),
    ]
    .concat();
    stream.feed(wire.as_bytes()).unwrap();
    let completed = stream.finish().unwrap();
    assert!(completed.calls.is_empty());
    assert_eq!(completed.usage, Some(usage));
}

#[test]
fn invalid_finish_and_arguments_fail_closed() {
    for wire in [
        "data: [DONE]\n\n".into(),
        fixture().replace(
            "\"finish_reason\":\"tool_calls\"",
            "\"finish_reason\":\"length\"",
        ),
        fixture().replace("1}", "1"),
        fixture().replace("read_resource_pages", ""),
        fixture().replace("\"index\":0,\"type\"", "\"index\":99,\"type\""),
    ] {
        let mut stream = ChatStream::default();
        let fed = stream.feed(wire.as_bytes());
        assert!(fed.is_err() || stream.finish().is_err(), "accepted {wire}");
    }
}

#[test]
fn oversize_or_trailing_data_poison_the_stream() {
    for wire in [
        vec![b'x'; 65_537],
        [fixture().as_bytes(), b"data: extra\n\n"].concat(),
        vec![0xff, b'\n'],
    ] {
        let mut stream = ChatStream::default();
        assert!(stream.feed(&wire).is_err());
        assert!(stream.feed(b"").is_err());
        assert!(stream.finish().is_err());
    }
}

#[test]
fn multiple_calls_pair_by_id_not_result_arrival_order() {
    let wire = [chunk(&json!({"tool_calls":[
        {"index":0,"id":"a","type":"function","function":{"name":"search_learning_resources","arguments":"{}"}},
        {"index":1,"id":"b","type":"function","function":{"name":"read_resource_pages","arguments":"{}"}}
    ]}), &json!("tool_calls")), "data: [DONE]\n\n".into()].concat();
    let mut stream = ChatStream::default();
    stream.feed(wire.as_bytes()).unwrap();
    let completed = stream.finish().unwrap();
    let messages = completed
        .continuation(&[("b", "second"), ("a", "first")])
        .unwrap();
    assert_eq!(messages[1]["content"], "first");
    assert_eq!(messages[2]["content"], "second");
    assert!(completed.continuation(&[("a", "x"), ("a", "y")]).is_err());
}

#[test]
fn mismatched_identity_refusal_and_post_finish_delta_fail() {
    let prefix = chunk(&json!({"content":"before"}), &Value::Null);
    for suffix in [
        chunk(&json!({"content":"other"}), &json!("stop"))
            .replace("\"id\":\"fixture\"", "\"id\":\"switched\""),
        chunk(&json!({"refusal":"no"}), &json!("stop")),
        chunk(&json!({}), &json!("content_filter")),
        [
            chunk(&json!({}), &json!("stop")),
            chunk(&json!({"content":"late"}), &Value::Null),
        ]
        .concat(),
    ] {
        let mut stream = ChatStream::default();
        stream.feed(prefix.as_bytes()).unwrap();
        assert!(stream.feed(suffix.as_bytes()).is_err());
        assert!(stream.finish().is_err());
    }
}

#[test]
fn event_and_argument_limits_are_enforced_before_completion() {
    for wire in [
        "x".repeat(16_385),
        chunk(
            &json!({"tool_calls":[{"index":0,"id":"a","type":"function","function":{"name":"read","arguments":"x".repeat(4097)}}]}),
            &Value::Null,
        ),
    ] {
        let mut stream = ChatStream::default();
        assert!(stream.feed(wire.as_bytes()).is_err());
        assert!(stream.finish().is_err());
    }
}
