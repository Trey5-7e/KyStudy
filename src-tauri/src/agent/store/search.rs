//! Ranked literal search inside a single immutable authorized document selection.

use super::{AgentError, AgentStore, RunState, params, storage};
use crate::agent::ReadCall;
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    page: u32,
    offset: u32,
    match_count: u32,
}

impl AgentStore {
    pub(crate) fn search_agent_pages(
        &self,
        workspace: &str,
        run_id: &str,
        call: &ReadCall,
    ) -> Result<String, AgentError> {
        let query = call
            .query
            .as_deref()
            .filter(|q| !q.trim().is_empty() && q.len() <= 256 && !q.contains('\0'))
            .ok_or(AgentError::Invalid)?;
        let limit = call.limit.unwrap_or(5);
        if call.offset.is_some() || !(1..=8).contains(&limit) {
            return Err(AgentError::Invalid);
        }
        let tx = self.connection.unchecked_transaction().map_err(storage)?;
        let run = self.get(workspace, run_id)?;
        if run.state != RunState::Running || run.cancel_requested {
            return Err(AgentError::Stale);
        }
        let grant = self.context(workspace, run_id)?.grant;
        let selection = grant
            .pages
            .iter()
            .find(|p| {
                p.document_id == call.document_id
                    && p.revision == call.revision
                    && p.pages.contains(&call.page)
            })
            .ok_or(AgentError::Scope)?;
        super::resources::validate_selection(&tx, workspace, selection)?;
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(
                serde_json::to_vec(&("search-v1", workspace, run_id, &grant, query, limit))
                    .map_err(|_| AgentError::Store)?
            )
        );
        let start = decode_cursor(call.cursor.as_deref(), &fingerprint)?;
        let mut candidates = Vec::new();
        // SQL is bound per authorized page. Neither ranking nor counts inspect other pages.
        for page in &selection.pages {
            let (position, count, nul): (u32,u32,bool) = tx.query_row("SELECT instr(text_content,?3),(length(text_content)-length(replace(text_content,?3,'')))/length(?3),instr(text_content,char(0))>0 FROM resource_page_text WHERE document_id=?1 AND page_number=?2", params![call.document_id,page,query], |row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).map_err(storage)?;
            if nul {
                return Err(AgentError::IndexNotReady);
            }
            if position > 0 {
                candidates.push(Candidate {
                    page: *page,
                    offset: position - 1,
                    match_count: count,
                });
            }
        }
        candidates.sort_by(|a, b| {
            b.match_count
                .cmp(&a.match_count)
                .then_with(|| a.page.cmp(&b.page))
        });
        if start > candidates.len() || (start == candidates.len() && start != 0) {
            return Err(AgentError::Invalid);
        }
        let end = (start + usize::try_from(limit).map_err(|_| AgentError::Invalid)?)
            .min(candidates.len());
        let first = candidates.get(start);
        let page = first.map_or(call.page, |c| c.page);
        let mut excerpt: String = if let Some(hit) = first {
            tx.query_row("SELECT substr(text_content,?3,400) FROM resource_page_text WHERE document_id=?1 AND page_number=?2", params![call.document_id,hit.page,i64::from(hit.offset.saturating_sub(100))+1], |row|row.get(0)).map_err(storage)?
        } else {
            String::new()
        };
        let next = (end < candidates.len()).then(|| format!("v1:{fingerprint}:{end}"));
        loop {
            let result = serde_json::json!({"kind":"search_results","text":excerpt,"page":page,"found":first.is_some(),"truncated":first.is_some(),"candidates":&candidates[start..end],"totalMatchedPages":candidates.len(),"nextCursor":next,"warnings":["Only the first candidate excerpt is evidence; other candidate pages must be read before citation."]}).to_string();
            if serde_json::to_string(&result)
                .map_err(|_| AgentError::Store)?
                .len()
                <= 8000
            {
                tx.commit().map_err(storage)?;
                return Ok(result);
            }
            if excerpt.is_empty() {
                return Err(AgentError::Invalid);
            }
            excerpt = excerpt.chars().take(excerpt.chars().count() / 2).collect();
        }
    }
}

fn decode_cursor(cursor: Option<&str>, fingerprint: &str) -> Result<usize, AgentError> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    if cursor.len() > 128 {
        return Err(AgentError::Invalid);
    }
    let prefix = format!("v1:{fingerprint}:");
    let index = cursor
        .strip_prefix(&prefix)
        .ok_or(AgentError::SourceStale)?;
    if index.is_empty() || !index.bytes().all(|b| b.is_ascii_digit()) {
        return Err(AgentError::Invalid);
    }
    index.parse().map_err(|_| AgentError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::store::resources::tests::{fixture, run_pages};
    use crate::agent::store::tests::{RUN, WORKSPACE};
    use crate::agent::{ReadTool, TokenPolicy};

    fn search_fixture() -> (AgentStore, ReadCall) {
        let mut store = fixture();
        store.connection.execute_batch("UPDATE resource_page_text SET text_content='前言 矩阵' WHERE page_number=1; UPDATE resource_page_text SET text_content='矩阵 矩阵 矩阵 页尾结论' WHERE page_number=2; INSERT INTO resource_page_text VALUES ('doc',3,'secret',1,'矩阵 矩阵 矩阵 矩阵 DO_NOT_DISCLOSE');").unwrap();
        let (_, mut call) = run_pages(&mut store, vec![1, 2]);
        call.tool = ReadTool::SearchLearningResources;
        call.query = Some("矩阵".into());
        call.limit = Some(1);
        (store, call)
    }

    #[test]
    fn ranks_only_authorized_pages_and_returns_actual_excerpt_page() {
        let (store, call) = search_fixture();
        let changes = store.connection.total_changes();
        let text = store.read_agent_page(WORKSPACE, RUN, &call).unwrap();
        let result: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(result["page"], 2);
        assert_eq!(result["totalMatchedPages"], 2);
        assert_eq!(result["candidates"][0]["matchCount"], 3);
        assert!(result["text"].as_str().unwrap().contains("页尾结论"));
        assert!(!text.contains("DO_NOT_DISCLOSE"));
        assert_eq!(store.connection.total_changes(), changes);
        assert_eq!(call.result_page(&text).unwrap(), 2);
    }

    #[test]
    fn cursor_visits_each_rank_once_and_rejects_query_limit_or_version_changes() {
        let (store, mut call) = search_fixture();
        let first: serde_json::Value =
            serde_json::from_str(&store.read_agent_page(WORKSPACE, RUN, &call).unwrap()).unwrap();
        call.cursor = Some(first["nextCursor"].as_str().unwrap().into());
        let second: serde_json::Value =
            serde_json::from_str(&store.read_agent_page(WORKSPACE, RUN, &call).unwrap()).unwrap();
        assert_eq!(second["page"], 1);
        assert!(second["nextCursor"].is_null());
        call.query = Some("前言".into());
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::SourceStale)
        );
        call.query = Some("矩阵".into());
        call.limit = Some(2);
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::SourceStale)
        );
        call.limit = Some(1);
        store
            .connection
            .execute(
                "UPDATE resource_page_text SET content_hash='new' WHERE page_number=2",
                [],
            )
            .unwrap();
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::SourceStale)
        );
    }

    #[test]
    fn literal_queries_empty_matches_and_unicode_offsets_remain_deterministic() {
        let (store, mut call) = search_fixture();
        call.query = Some("前言".into());
        let result: serde_json::Value =
            serde_json::from_str(&store.read_agent_page(WORKSPACE, RUN, &call).unwrap()).unwrap();
        assert_eq!(result["candidates"][0]["offset"], 0);
        call.query = Some("% OR 1=1".into());
        let result: serde_json::Value =
            serde_json::from_str(&store.read_agent_page(WORKSPACE, RUN, &call).unwrap()).unwrap();
        assert_eq!(result["found"], false);
        assert_eq!(result["text"], "");
        assert_eq!(result["totalMatchedPages"], 0);
    }

    #[test]
    fn cancel_foreign_workspace_and_unauthorized_anchor_block_search() {
        let (mut store, mut call) = search_fixture();
        assert_eq!(
            store.read_agent_page("foreign", RUN, &call),
            Err(AgentError::Scope)
        );
        call.page = 3;
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::Scope)
        );
        call.page = 1;
        let run = store.get(WORKSPACE, RUN).unwrap();
        store.request_cancel(WORKSPACE, &run, 3).unwrap();
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::Stale)
        );
        assert_eq!(run.token_policy, TokenPolicy::Observe);
    }

    #[test]
    fn escaped_excerpts_are_bounded_and_malformed_cursors_do_not_restart() {
        let (store, mut call) = search_fixture();
        store
            .connection
            .execute(
                "UPDATE resource_page_text SET text_content=?1 WHERE page_number=2",
                [format!("矩阵{}", "\u{1}".repeat(3000))],
            )
            .unwrap();
        let text = store.read_agent_page(WORKSPACE, RUN, &call).unwrap();
        assert!(serde_json::to_string(&text).unwrap().len() <= 8000);
        call.cursor = Some("invalid".into());
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::SourceStale)
        );
        call.cursor = None;
        call.offset = Some(1);
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::Invalid)
        );
    }
}
