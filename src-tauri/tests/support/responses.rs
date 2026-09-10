//! Bounded Responses event experiment; private output items never become public text.

use super::{Call, ProtocolError, append, string};
use serde_json::{Value, json};
use std::fmt::Write;

#[derive(Default)]
pub(super) struct ResponsesStream {
    bytes: Vec<u8>,
    failed: bool,
}

pub(super) struct ResponseOutput {
    pub(super) text: String,
    pub(super) calls: Vec<Call>,
    private_items: Vec<Value>,
}

impl ResponsesStream {
    pub(super) fn feed(&mut self, bytes: &[u8]) -> Result<(), ProtocolError> {
        if self.failed || bytes.len() > 65_536 - self.bytes.len() {
            self.failed = true;
            return Err(ProtocolError);
        }
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }

    pub(super) fn finish(self) -> Result<ResponseOutput, ProtocolError> {
        if self.failed {
            return Err(ProtocolError);
        }
        let wire = std::str::from_utf8(&self.bytes)
            .map_err(|_| ProtocolError)?
            .replace("\r\n", "\n");
        if !wire.ends_with("\n\n") {
            return Err(ProtocolError);
        }
        let mut collector = Collector::default();
        for frame in wire.split("\n\n").filter(|frame| !frame.is_empty()) {
            let mut data = String::new();
            let mut name = None;
            for line in frame.lines() {
                if let Some(value) = line.strip_prefix("data: ") {
                    append(&mut data, value, 16_384)?;
                    append(&mut data, "\n", 16_384)?;
                } else if let Some(value) = line.strip_prefix("event: ") {
                    if name.replace(value).is_some() {
                        return Err(ProtocolError);
                    }
                } else if !line.starts_with(':') {
                    return Err(ProtocolError);
                }
            }
            if data.is_empty() {
                continue;
            }
            let event: Value = serde_json::from_str(&data).map_err(|_| ProtocolError)?;
            if name.is_some_and(|name| event["type"] != name) {
                return Err(ProtocolError);
            }
            collector.accept(&event)?;
        }
        collector.finish()
    }
}

#[derive(Default)]
struct Collector {
    sequence: Option<u64>,
    id: Option<String>,
    items: Vec<Value>,
    done_items: Vec<Value>,
    arguments_done: Vec<bool>,
    completed: bool,
    text_parts: Vec<Vec<TextPart>>,
}

#[derive(Default)]
struct TextPart {
    text: String,
    text_done: bool,
    completed: Option<Value>,
}

impl Collector {
    fn accept(&mut self, event: &Value) -> Result<(), ProtocolError> {
        let sequence = event["sequence_number"].as_u64().ok_or(ProtocolError)?;
        if self.completed || self.sequence.is_some_and(|old| sequence <= old) {
            return Err(ProtocolError);
        }
        self.sequence = Some(sequence);
        match string(&event["type"])? {
            "response.created" => {
                if self.id.is_some() {
                    return Err(ProtocolError);
                }
                let id = string(&event["response"]["id"])?;
                if id.is_empty() || id.len() > 128 {
                    return Err(ProtocolError);
                }
                self.id = Some(id.into());
            }
            "response.in_progress" => {
                if self.id.as_deref() != event["response"]["id"].as_str() {
                    return Err(ProtocolError);
                }
            }
            "response.output_item.added" => self.add(event)?,
            "response.function_call_arguments.delta" | "response.function_call_arguments.done" => {
                self.arguments(event)?;
            }
            "response.output_item.done" => self.item_done(event)?,
            "response.content_part.added"
            | "response.output_text.delta"
            | "response.output_text.done"
            | "response.content_part.done" => self.text_event(event)?,
            "response.completed" => {
                let response = &event["response"];
                if self.id.as_deref() != response["id"].as_str()
                    || response["status"] != "completed"
                    || !response["error"].is_null()
                    || !response["incomplete_details"].is_null()
                    || self.done_items.len() != self.items.len()
                    || response["output"] != json!(self.done_items)
                {
                    return Err(ProtocolError);
                }
                self.completed = true;
            }
            _ => return Err(ProtocolError),
        }
        Ok(())
    }

    fn add(&mut self, event: &Value) -> Result<(), ProtocolError> {
        let item = &event["item"];
        if self.id.is_none()
            || event["output_index"].as_u64() != u64::try_from(self.items.len()).ok()
            || self.items.len() >= 16
            || !matches!(
                item["type"].as_str(),
                Some("message" | "reasoning" | "function_call")
            )
        {
            return Err(ProtocolError);
        }
        let id = string(&item["id"])?;
        if id.is_empty() || self.items.iter().any(|old| old["id"] == id) {
            return Err(ProtocolError);
        }
        if item["type"] == "function_call" {
            let call_id = string(&item["call_id"])?;
            if call_id.is_empty()
                || call_id.len() > 128
                || string(&item["name"])?.is_empty()
                || string(&item["name"])?.len() > 128
                || item["arguments"] != ""
                || self.items.iter().any(|old| old["call_id"] == call_id)
            {
                return Err(ProtocolError);
            }
        }
        self.items.push(item.clone());
        self.arguments_done.push(false);
        self.text_parts.push(Vec::new());
        Ok(())
    }

    fn text_event(&mut self, event: &Value) -> Result<(), ProtocolError> {
        let index = usize::try_from(event["output_index"].as_u64().ok_or(ProtocolError)?)
            .map_err(|_| ProtocolError)?;
        let item = self.items.get(index).ok_or(ProtocolError)?;
        if item["type"] != "message"
            || item["id"] != event["item_id"]
            || index < self.done_items.len()
        {
            return Err(ProtocolError);
        }
        let part_index = usize::try_from(event["content_index"].as_u64().ok_or(ProtocolError)?)
            .map_err(|_| ProtocolError)?;
        let parts = &mut self.text_parts[index];
        if event["type"] == "response.content_part.added" {
            if part_index != parts.len()
                || parts.len() >= 16
                || event["part"]["type"] != "output_text"
                || event["part"]["text"] != ""
            {
                return Err(ProtocolError);
            }
            parts.push(TextPart::default());
            return Ok(());
        }
        let part = parts.get_mut(part_index).ok_or(ProtocolError)?;
        if part.completed.is_some() {
            return Err(ProtocolError);
        }
        match event["type"].as_str() {
            Some("response.output_text.delta") if !part.text_done => {
                append(&mut part.text, string(&event["delta"])?, 8192)?;
            }
            Some("response.output_text.done") if !part.text_done && event["text"] == part.text => {
                part.text_done = true;
            }
            Some("response.content_part.done")
                if part.text_done
                    && event["part"]["text"] == part.text
                    && event["part"]["type"] == "output_text" =>
            {
                part.completed = Some(event["part"].clone());
            }
            _ => return Err(ProtocolError),
        }
        Ok(())
    }

    fn arguments(&mut self, event: &Value) -> Result<(), ProtocolError> {
        let index = usize::try_from(event["output_index"].as_u64().ok_or(ProtocolError)?)
            .map_err(|_| ProtocolError)?;
        let item = self.items.get_mut(index).ok_or(ProtocolError)?;
        if item["type"] != "function_call"
            || item["id"] != event["item_id"]
            || self.arguments_done[index]
        {
            return Err(ProtocolError);
        }
        let mut arguments = string(&item["arguments"])?.to_owned();
        if event["type"] == "response.function_call_arguments.delta" {
            append(&mut arguments, string(&event["delta"])?, 4096)?;
            item["arguments"] = json!(arguments);
        } else {
            if event["arguments"] != arguments {
                return Err(ProtocolError);
            }
            let parsed: Value = serde_json::from_str(&arguments).map_err(|_| ProtocolError)?;
            if !parsed.is_object() {
                return Err(ProtocolError);
            }
            self.arguments_done[index] = true;
        }
        Ok(())
    }

    fn item_done(&mut self, event: &Value) -> Result<(), ProtocolError> {
        let index = self.done_items.len();
        let old = self.items.get(index).ok_or(ProtocolError)?;
        let item = &event["item"];
        if event["output_index"].as_u64() != u64::try_from(index).ok()
            || item["id"] != old["id"]
            || item["type"] != old["type"]
        {
            return Err(ProtocolError);
        }
        if item["type"] == "function_call"
            && (!self.arguments_done[index]
                || item["arguments"] != old["arguments"]
                || item["name"] != old["name"]
                || item["call_id"] != old["call_id"])
        {
            return Err(ProtocolError);
        }
        if item["type"] == "message" {
            let parts: Vec<_> = self.text_parts[index]
                .iter()
                .map(|part| part.completed.as_ref().ok_or(ProtocolError))
                .collect::<Result<_, _>>()?;
            if item["content"] != json!(parts) {
                return Err(ProtocolError);
            }
        }
        self.done_items.push(item.clone());
        Ok(())
    }

    fn finish(self) -> Result<ResponseOutput, ProtocolError> {
        if !self.completed {
            return Err(ProtocolError);
        }
        let mut text = String::new();
        let mut calls = Vec::new();
        for item in &self.done_items {
            match string(&item["type"])? {
                "message" => {
                    if item["role"] != "assistant" || item["status"] != "completed" {
                        return Err(ProtocolError);
                    }
                    for part in item["content"].as_array().ok_or(ProtocolError)? {
                        if part["type"] != "output_text" {
                            return Err(ProtocolError);
                        }
                        append(&mut text, string(&part["text"])?, 8192)?;
                    }
                }
                "function_call" => calls.push(Call {
                    id: string(&item["call_id"])?.into(),
                    name: string(&item["name"])?.into(),
                    arguments: string(&item["arguments"])?.into(),
                }),
                "reasoning" => (),
                _ => return Err(ProtocolError),
            }
        }
        Ok(ResponseOutput {
            text,
            calls,
            private_items: self.done_items,
        })
    }
}

impl ResponseOutput {
    pub(super) fn continuation(
        &self,
        results: &[(&str, &str)],
    ) -> Result<Vec<Value>, ProtocolError> {
        if results.len() != self.calls.len() {
            return Err(ProtocolError);
        }
        let mut input = self.private_items.clone();
        for call in &self.calls {
            let matches: Vec<_> = results.iter().filter(|(id, _)| *id == call.id).collect();
            if matches.len() != 1 || matches[0].1.len() > 16_384 {
                return Err(ProtocolError);
            }
            input.push(
                json!({"type":"function_call_output","call_id":call.id,"output":matches[0].1}),
            );
        }
        Ok(input)
    }
}

fn fixture_events() -> Vec<Value> {
    let reasoning = json!({"id":"rs1","type":"reasoning","summary":[],"encrypted_content":"opaque-fixture-only"});
    let message = json!({"id":"m1","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":"查资料","annotations":[]}]});
    let call = json!({"id":"fc1","type":"function_call","call_id":"c1","name":"read_resource_pages","arguments":"{\"page\":1}","status":"completed"});
    let mut events = vec![
        json!({"type":"response.created","response":{"id":"resp1"}}),
        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"rs1","type":"reasoning","summary":[]}}),
        json!({"type":"response.output_item.done","output_index":0,"item":reasoning}),
        json!({"type":"response.output_item.added","output_index":1,"item":{"id":"m1","type":"message","role":"assistant","status":"in_progress","content":[]}}),
        json!({"type":"response.output_item.done","output_index":1,"item":message}),
        json!({"type":"response.output_item.added","output_index":2,"item":{"id":"fc1","type":"function_call","call_id":"c1","name":"read_resource_pages","arguments":""}}),
        json!({"type":"response.function_call_arguments.delta","output_index":2,"item_id":"fc1","delta":"{\"page\":"}),
        json!({"type":"response.function_call_arguments.delta","output_index":2,"item_id":"fc1","delta":"1}"}),
        json!({"type":"response.function_call_arguments.done","output_index":2,"item_id":"fc1","arguments":"{\"page\":1}"}),
        json!({"type":"response.output_item.done","output_index":2,"item":call}),
        json!({"type":"response.completed","response":{"id":"resp1","status":"completed","output":[reasoning,message,call]}}),
    ];
    events.splice(4..4,[
        json!({"type":"response.content_part.added","output_index":1,"content_index":0,"item_id":"m1","part":{"type":"output_text","text":"","annotations":[]}}),
        json!({"type":"response.output_text.delta","output_index":1,"content_index":0,"item_id":"m1","delta":"查"}),
        json!({"type":"response.output_text.delta","output_index":1,"content_index":0,"item_id":"m1","delta":"资料"}),
        json!({"type":"response.output_text.done","output_index":1,"content_index":0,"item_id":"m1","text":"查资料"}),
        json!({"type":"response.content_part.done","output_index":1,"content_index":0,"item_id":"m1","part":{"type":"output_text","text":"查资料","annotations":[]}}),
    ]);
    events
}

fn wire(events: &[Value]) -> String {
    events
        .iter()
        .enumerate()
        .fold(String::new(), |mut wire, (index, event)| {
            let mut event = event.clone();
            event["sequence_number"] = json!(index);
            write!(
                wire,
                "event: {}\ndata: {event}\n\n",
                event["type"].as_str().unwrap()
            )
            .unwrap();
            wire
        })
}

#[test]
fn same_semantics_as_chat_with_private_continuation_preserved() {
    let wire = wire(&fixture_events());
    for split in 0..=wire.len() {
        let mut stream = ResponsesStream::default();
        stream.feed(&wire.as_bytes()[..split]).unwrap();
        stream.feed(&wire.as_bytes()[split..]).unwrap();
        let result = stream.finish().unwrap();
        let mut chat = super::ChatStream::default();
        chat.feed(super::fixture().as_bytes()).unwrap();
        let chat = chat.finish().unwrap();
        assert_eq!(
            (result.text.as_str(), &result.calls),
            (chat.text.as_str(), &chat.calls)
        );
        let input = result.continuation(&[("c1", "evidence")]).unwrap();
        assert_eq!(input[0]["encrypted_content"], "opaque-fixture-only");
        assert!(!result.text.contains("opaque"));
        assert_eq!(input[3]["call_id"], "c1");
    }
}

#[test]
fn incomplete_mismatched_or_replayed_events_fail() {
    for mode in 0..7 {
        let mut events = fixture_events();
        match mode {
            0 => {
                events.pop();
            }
            1 => events[13]["arguments"] = json!("{}"),
            2 => events[12]["item_id"] = json!("forged"),
            3 => events[15]["response"]["status"] = json!("incomplete"),
            4 => events[15]["response"]["output"][2]["arguments"] = json!("{}"),
            5 => events.push(events[15].clone()),
            _ => events[10]["item"]["type"] = json!("shell_call"),
        }
        let mut stream = ResponsesStream::default();
        stream.feed(wire(&events).as_bytes()).unwrap();
        assert!(stream.finish().is_err(), "case {mode}");
    }
}

#[test]
fn oversized_responses_and_missing_outputs_cannot_continue() {
    let mut stream = ResponsesStream::default();
    assert!(stream.feed(&vec![0; 65_537]).is_err());
    assert!(stream.finish().is_err());
    let mut stream = ResponsesStream::default();
    stream.feed(wire(&fixture_events()).as_bytes()).unwrap();
    let result = stream.finish().unwrap();
    assert!(result.continuation(&[]).is_err());
    assert!(result.continuation(&[("forged", "x")]).is_err());
}
