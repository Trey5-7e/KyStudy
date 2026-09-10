//! Deterministic request-only evidence compaction. Durable receipts stay untouched.

use super::{AgentError, ReadCall, Value, json};
use std::collections::{HashMap, HashSet};

pub(super) fn messages(
    history: &[Value],
    assistants: &HashMap<String, Value>,
) -> Result<Vec<Value>, AgentError> {
    if !history.len().is_multiple_of(2) {
        return Err(AgentError::Protocol);
    }
    let mut messages = Vec::with_capacity(history.len());
    let mut seen = HashMap::<(String, String), String>::new();
    let mut call_ids = HashSet::new();
    for pair in history.chunks_exact(2) {
        let [request, receipt] = pair else {
            return Err(AgentError::Protocol);
        };
        if request["kind"] != "tool" || receipt["kind"] != "tool_result" {
            return Err(AgentError::Protocol);
        }
        let call: ReadCall =
            serde_json::from_value(request["call"].clone()).map_err(|_| AgentError::Protocol)?;
        let text = receipt["text"].as_str().ok_or(AgentError::Protocol)?;
        let source = format!(
            "{}:{}:{}",
            call.document_id,
            call.revision,
            call.result_page(text)?
        );
        if receipt["call_id"] != call.id
            || receipt["source_id"] != source
            || !call_ids.insert(call.id.clone())
        {
            return Err(AgentError::Protocol);
        }
        let native = assistants.get(&call.id).ok_or(AgentError::SourceStale)?;
        // Only the transport ID and the equivalent absent/zero read offset are normalized.
        // Query whitespace, page, revision and all evidence metadata retain their semantics.
        let key = json!({"tool":call.tool,"documentId":call.document_id,"revision":call.revision,"page":call.page,"query":call.query,"offset":call.offset.unwrap_or(0),"cursor":call.cursor,"limit":call.limit}).to_string();
        let fingerprint = (key, text.to_owned());
        let full = json!({"source_id":source,"result":text}).to_string();
        let content = if let Some(first) = seen.get(&fingerprint) {
            let reference = json!({"source_id":source,"duplicateOfCallId":first,"note":"Exact same verified result as the earlier tool response in this request; use that evidence. No new page content."}).to_string();
            if reference.len() < full.len() {
                reference
            } else {
                full
            }
        } else {
            seen.insert(fingerprint, call.id.clone());
            full
        };
        // Keep every native assistant and its own result ID, including required private continuation.
        messages.push(native.clone());
        messages.push(json!({"role":"tool","tool_call_id":call.id,"content":content}));
    }
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(calls: &[(&str, u32, &str)]) -> (Vec<Value>, HashMap<String, Value>) {
        let mut history = Vec::new();
        let mut private = HashMap::new();
        for (id, offset, text) in calls {
            history.push(json!({"kind":"tool","call":{"id":id,"tool":"read_resource_pages","documentId":"doc","revision":"v1","page":1,"offset":offset}}));
            history.push(
                json!({"kind":"tool_result","call_id":id,"source_id":"doc:v1:1","text":text}),
            );
            private.insert((*id).to_owned(), json!({"role":"assistant","reasoning_content":format!("private-{id}"),"tool_calls":[{"id":id,"type":"function"}]}));
        }
        (history, private)
    }

    #[test]
    fn exact_duplicate_reuses_first_evidence_without_rewriting_durable_history() {
        let text = "汉字证据".repeat(1000);
        let (history, private) = fixture(&[("a", 0, &text), ("b", 0, &text)]);
        let before = history.clone();
        let compact = messages(&history, &private).unwrap();
        let first: Value = serde_json::from_str(compact[1]["content"].as_str().unwrap()).unwrap();
        let second: Value = serde_json::from_str(compact[3]["content"].as_str().unwrap()).unwrap();
        assert_eq!(first["result"], text);
        assert_eq!(second["duplicateOfCallId"], "a");
        assert_eq!(compact[2]["reasoning_content"], "private-b");
        assert_eq!(compact[3]["tool_call_id"], "b");
        assert_eq!(history, before);
        let baseline_bytes = compact[1]["content"].as_str().unwrap().len() * 2;
        let compact_bytes = compact[1]["content"].as_str().unwrap().len()
            + compact[3]["content"].as_str().unwrap().len();
        assert!(compact_bytes * 100 < baseline_bytes * 55);
    }

    #[test]
    fn different_offsets_or_evidence_are_not_compacted() {
        let text = "evidence".repeat(100);
        let changed = format!("{text}different tail");
        let (history, private) = fixture(&[("a", 0, &text), ("b", 1, &text), ("c", 0, &changed)]);
        assert!(
            !format!("{:?}", messages(&history, &private).unwrap()).contains("duplicateOfCallId")
        );
    }

    #[test]
    fn source_revision_and_query_are_part_of_identity() {
        let text = "evidence".repeat(100);
        let (mut history, private) = fixture(&[("a", 0, &text), ("b", 0, &text)]);
        history[2]["call"]["revision"] = json!("v2");
        history[3]["source_id"] = json!("doc:v2:1");
        assert!(
            !format!("{:?}", messages(&history, &private).unwrap()).contains("duplicateOfCallId")
        );
        history[2]["call"]["revision"] = json!("v1");
        history[3]["source_id"] = json!("doc:v1:1");
        for index in [0, 2] {
            history[index]["call"]["tool"] = json!("search_learning_resources");
            history[index]["call"]
                .as_object_mut()
                .unwrap()
                .remove("offset");
        }
        history[0]["call"]["query"] = json!("query");
        history[2]["call"]["query"] = json!(" query ");
        assert!(
            !format!("{:?}", messages(&history, &private).unwrap()).contains("duplicateOfCallId")
        );
    }

    #[test]
    fn malformed_pair_missing_private_or_foreign_source_is_rejected() {
        let (history, private) = fixture(&[("a", 0, "text")]);
        assert!(matches!(
            messages(&history[..1], &private),
            Err(AgentError::Protocol)
        ));
        assert!(matches!(
            messages(&history, &HashMap::new()),
            Err(AgentError::SourceStale)
        ));
        let mut wrong = history;
        wrong[1]["source_id"] = json!("foreign:v1:1");
        assert!(matches!(
            messages(&wrong, &private),
            Err(AgentError::Protocol)
        ));
    }

    #[test]
    fn small_results_are_not_expanded_and_zero_offset_is_equivalent() {
        let text = "large".repeat(100);
        let (mut history, private) = fixture(&[("a", 0, &text), ("b", 0, &text)]);
        history[0]["call"].as_object_mut().unwrap().remove("offset");
        assert!(
            format!("{:?}", messages(&history, &private).unwrap()).contains("duplicateOfCallId")
        );
        let (history, private) = fixture(&[("a", 0, "ok"), ("b", 0, "ok")]);
        assert!(
            !format!("{:?}", messages(&history, &private).unwrap()).contains("duplicateOfCallId")
        );
    }

    #[test]
    fn duplicate_ids_and_mispaired_receipts_are_rejected() {
        let (history, private) = fixture(&[("a", 0, "text"), ("a", 0, "text")]);
        assert!(matches!(
            messages(&history, &private),
            Err(AgentError::Protocol)
        ));
        let (mut history, private) = fixture(&[("a", 0, "text")]);
        history[1]["call_id"] = json!("other");
        assert!(matches!(
            messages(&history, &private),
            Err(AgentError::Protocol)
        ));
    }

    #[test]
    fn references_never_point_to_another_reference_or_a_previous_request() {
        let text = "evidence".repeat(100);
        let (history, private) = fixture(&[("a", 0, &text), ("b", 0, &text), ("c", 0, &text)]);
        let compact = messages(&history, &private).unwrap();
        let last: Value = serde_json::from_str(compact[5]["content"].as_str().unwrap()).unwrap();
        assert_eq!(last["duplicateOfCallId"], "a");
        let later = messages(&history[4..], &private).unwrap();
        let only: Value = serde_json::from_str(later[1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(only["result"], text);
    }
}
