use super::{AgentError, AgentStore, Grant, storage};
use crate::agent::{PageSelection, ReadCall, ReadTool};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PageRequest {
    pub document_id: String,
    pub pages: Vec<u32>,
}

// Host-only profile. Never serialize the credential reference to a public event or DTO.
#[derive(Clone, Serialize)]
pub(crate) struct ProviderSelection {
    pub id: String,
    pub endpoint: String,
    pub secret_ref: String,
    pub model: String,
    pub context_limit: u32,
    pub output_limit: u32,
    pub provider_updated: i64,
    pub model_updated: i64,
}

impl ProviderSelection {
    pub fn revision(&self) -> Result<String, AgentError> {
        Ok(format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(self).map_err(|_| AgentError::Store)?)
        ))
    }
}

impl AgentStore {
    pub(crate) fn authorize_agent_provider(
        &self,
        workspace: &str,
        id: &str,
        epoch: u32,
        expected: &str,
    ) -> Result<ProviderSelection, AgentError> {
        let run = self.get(workspace, id)?;
        if run.cancel_requested
            || run.state != crate::agent::RunState::Running
            || run.owner_epoch != epoch
        {
            return Err(AgentError::Stale);
        }
        let grant = self.context(workspace, id)?.grant;
        self.revalidate_sources(workspace, &grant)?;
        let profile = self.selected_provider(workspace, &grant.provider_id)?;
        if profile.revision()? != expected || expected != grant.provider_revision {
            return Err(AgentError::SourceStale);
        }
        Ok(profile)
    }
    pub(crate) fn selected_provider(
        &self,
        workspace: &str,
        id: &str,
    ) -> Result<ProviderSelection, AgentError> {
        let (base, secret_ref, protocol, model, context_limit, output_limit, provider_updated, model_updated): (String,String,String,String,u32,u32,i64,i64) = self.connection.query_row(
            "SELECT p.base_url,p.secret_ref,COALESCE(p.provider_protocol,p.provider_type),m.model_name,m.context_limit,m.max_output_tokens,p.updated_at,m.updated_at FROM ai_provider_config p JOIN ai_model_profile m ON m.provider_config_id=p.id WHERE p.id=?1 AND p.workspace_id=?2 AND p.enabled=1 AND p.deleted_at IS NULL",
            params![id,workspace], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?)),
        ).optional().map_err(storage)?.ok_or(AgentError::Scope)?;
        if protocol != "deepseek_chat" || model != "deepseek-v4-flash-vision-exp" {
            return Err(AgentError::Unsupported);
        }
        let mut url = reqwest::Url::parse(&base).map_err(|_| AgentError::Unsupported)?;
        if url.scheme() != "https"
            || url.host_str() != Some("api.deepseek.com")
            || url.port_or_known_default() != Some(443)
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || !matches!(url.path().trim_end_matches('/'), "" | "/v1")
        {
            return Err(AgentError::Unsupported);
        }
        let path = format!("{}/chat/completions", url.path().trim_end_matches('/'));
        url.set_path(&path);
        Ok(ProviderSelection {
            id: id.into(),
            endpoint: url.into(),
            secret_ref,
            model,
            context_limit,
            output_limit,
            provider_updated,
            model_updated,
        })
    }

    pub(crate) fn resolve_grant(
        &self,
        workspace: &str,
        provider: &ProviderSelection,
        requests: &[PageRequest],
    ) -> Result<Grant, AgentError> {
        if requests.is_empty() || requests.len() > 24 {
            return Err(AgentError::Invalid);
        }
        let tx = self.connection.unchecked_transaction().map_err(storage)?;
        let mut pages = Vec::new();
        let mut total = 0;
        for request in requests {
            let mut selected = request.pages.clone();
            selected.sort_unstable();
            selected.dedup();
            total += selected.len();
            if selected.is_empty()
                || selected.contains(&0)
                || total > 24
                || pages
                    .iter()
                    .any(|p: &PageSelection| p.document_id == request.document_id)
            {
                return Err(AgentError::Invalid);
            }
            let revision = source_revision(&tx, workspace, &request.document_id, &selected)?;
            pages.push(PageSelection {
                document_id: request.document_id.clone(),
                revision,
                pages: selected,
            });
        }
        tx.commit().map_err(storage)?;
        Ok(Grant {
            provider_id: provider.id.clone(),
            provider_revision: provider.revision()?,
            model: provider.model.clone(),
            pages,
        })
    }

    pub(crate) fn revalidate_sources(
        &self,
        workspace: &str,
        grant: &Grant,
    ) -> Result<(), AgentError> {
        let tx = self.connection.unchecked_transaction().map_err(storage)?;
        for selection in &grant.pages {
            validate_selection(&tx, workspace, selection)?;
        }
        tx.commit().map_err(storage)
    }

    pub(crate) fn read_agent_page(
        &self,
        workspace: &str,
        run_id: &str,
        call: &ReadCall,
    ) -> Result<String, AgentError> {
        if matches!(call.tool, ReadTool::SearchLearningResources) {
            return self.search_agent_pages(workspace, run_id, call);
        }
        if call.cursor.is_some() || call.limit.is_some() {
            return Err(AgentError::Invalid);
        }
        let tx = self.connection.unchecked_transaction().map_err(storage)?;
        let run = self.get(workspace, run_id)?;
        if run.state != crate::agent::RunState::Running || run.cancel_requested {
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
        validate_selection(&tx, workspace, selection)?;
        // Restrict both query and returned text in SQL. No path or unselected page is read.
        let offset = call.offset.unwrap_or(0);
        let (text, total): (String, u32) = match call.tool {
            ReadTool::ReadResourcePages => {
                if call.query.is_some() {
                    return Err(AgentError::Invalid);
                }
                // SQLite length() stops at NUL. Reject such an index instead of claiming false EOF.
                tx.query_row("SELECT substr(text_content,?3,2401),CASE WHEN instr(text_content,char(0))=0 THEN length(text_content) ELSE -1 END FROM resource_page_text WHERE document_id=?1 AND page_number=?2", params![call.document_id,call.page,i64::from(offset)+1],|r|Ok((r.get(0)?,r.get(1)?))).map_err(storage)?
            }
            ReadTool::SearchLearningResources => {
                return Err(AgentError::Protocol);
            }
        };
        tx.commit().map_err(storage)?;
        if offset > total {
            return Err(AgentError::Invalid);
        }
        let limit = if matches!(call.tool, ReadTool::ReadResourcePages) {
            2400
        } else {
            400
        };
        let mut truncated = text.chars().count() > limit;
        let mut excerpt = text.chars().take(limit).collect::<String>();
        loop {
            let mut result = serde_json::json!({"text":excerpt,"truncated":truncated,"found":!text.is_empty(),"page":call.page});
            if matches!(call.tool, ReadTool::ReadResourcePages) {
                let end = offset
                    + u32::try_from(excerpt.chars().count()).map_err(|_| AgentError::Store)?;
                result["offset"] = offset.into();
                result["endOffset"] = end.into();
                result["totalCharacters"] = total.into();
                result["nextOffset"] = if end < total {
                    end.into()
                } else {
                    serde_json::Value::Null
                };
                result["truncated"] = (end < total).into();
            }
            let encoded = result.to_string();
            if serde_json::to_string(&encoded)
                .map_err(|_| AgentError::Store)?
                .len()
                <= 8000
            {
                return Ok(encoded);
            }
            excerpt = excerpt.chars().take(excerpt.chars().count() / 2).collect();
            truncated = true;
        }
    }
}

pub(super) fn validate_selection(
    db: &Connection,
    workspace: &str,
    selection: &PageSelection,
) -> Result<(), AgentError> {
    if source_revision(db, workspace, &selection.document_id, &selection.pages)?
        != selection.revision
    {
        return Err(AgentError::SourceStale);
    }
    Ok(())
}

fn source_revision(
    db: &Connection,
    workspace: &str,
    id: &str,
    pages: &[u32],
) -> Result<String, AgentError> {
    let source: Option<(String,i64,String,String,i64)> = db.query_row(
        "SELECT b.sha256,d.revision,j.source_sha256,j.state,j.started_at FROM resource_document d JOIN blob b ON b.id=d.blob_id AND b.workspace_id=d.workspace_id LEFT JOIN resource_index_job j ON j.document_id=d.id WHERE d.id=?1 AND d.workspace_id=?2 AND d.deleted_at IS NULL AND d.kind='pdf' AND b.integrity_state='ok'",
        params![id,workspace],|r|Ok((r.get(0)?,r.get(1)?,r.get::<_,Option<String>>(2)?.unwrap_or_default(),r.get::<_,Option<String>>(3)?.unwrap_or_default(),r.get::<_,Option<i64>>(4)?.unwrap_or_default())),
    ).optional().map_err(storage)?;
    let source = source.ok_or(AgentError::Scope)?;
    if source.0 != source.2 || !matches!(source.3.as_str(), "ready" | "empty") {
        return Err(AgentError::IndexNotReady);
    }
    let mut hasher = Sha256::new();
    hasher.update(serde_json::to_vec(&source).map_err(|_| AgentError::Store)?);
    for page in pages {
        let value:Option<(String,i64)> = db.query_row("SELECT content_hash,indexed_at FROM resource_page_text WHERE document_id=?1 AND page_number=?2",params![id,page],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(storage)?;
        let value = value.ok_or(AgentError::IndexNotReady)?;
        hasher.update(serde_json::to_vec(&(page, value)).map_err(|_| AgentError::Store)?);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::agent::store::tests::{CHAT, RUN, WORKSPACE, fixture_connection};
    use crate::agent::{Budget, NewRun, TokenPolicy};

    #[test]
    fn cursor_reads_unicode_and_escaped_text_without_gaps() {
        let mut store = fixture();
        let full = format!("{}页尾证据", "汉🙂\"\\\n".repeat(1800));
        store
            .connection
            .execute(
                "UPDATE resource_page_text SET text_content=?1 WHERE page_number=1",
                [&full],
            )
            .unwrap();
        let (_, mut call) = run(&mut store);
        let mut actual = String::new();
        loop {
            let encoded = store.read_agent_page(WORKSPACE, RUN, &call).unwrap();
            assert!(serde_json::to_string(&encoded).unwrap().len() <= 8000);
            let result: serde_json::Value = serde_json::from_str(&encoded).unwrap();
            actual.push_str(result["text"].as_str().unwrap());
            if result["nextOffset"].is_null() {
                break;
            }
            let next = u32::try_from(result["nextOffset"].as_u64().unwrap()).unwrap();
            assert!(next > call.offset.unwrap_or(0));
            call.offset = Some(next);
        }
        assert_eq!(actual, full);
        call.offset = Some(u32::MAX);
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::Invalid)
        );
    }

    #[test]
    fn continuation_rechecks_source_revision() {
        let mut store = fixture();
        let (_, mut call) = run(&mut store);
        call.offset = Some(1);
        store
            .connection
            .execute(
                "UPDATE resource_page_text SET content_hash='changed' WHERE page_number=1",
                [],
            )
            .unwrap();
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::SourceStale)
        );
    }

    #[test]
    fn nul_in_index_cannot_be_reported_as_complete_page() {
        let mut store = fixture();
        store
            .connection
            .execute(
                "UPDATE resource_page_text SET text_content=?1 WHERE page_number=1",
                ["前文\0后文"],
            )
            .unwrap();
        let (_, call) = run(&mut store);
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call),
            Err(AgentError::Store)
        );
    }

    #[test]
    fn followup_requires_completed_same_conversation_scope_and_current_sources() {
        let mut store = fixture();
        let (grant, _) = run(&mut store);
        assert_eq!(
            store.followup_goal(WORKSPACE, CHAT, RUN, &grant, "追问"),
            Err(AgentError::Transition)
        );
        let lease = store.get(WORKSPACE, RUN).unwrap();
        let lease = store
            .reserve(
                WORKSPACE,
                &lease,
                crate::agent::Charge::Model {
                    input: 1,
                    output: 1,
                },
                3,
            )
            .unwrap();
        let lease = store
            .finish_step_result(
                WORKSPACE,
                &lease,
                lease.event_sequence,
                &serde_json::json!({"kind":"final","message":"公开回答","source_ids":[]}),
                4,
            )
            .unwrap();
        store
            .transition(WORKSPACE, &lease, crate::agent::RunState::Completed, 5)
            .unwrap();
        let goal = store
            .followup_goal(WORKSPACE, CHAT, RUN, &grant, "追问")
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&goal).unwrap();
        assert_eq!(value["previousAnswer"], "公开回答");
        assert_eq!(
            store.followup_goal(WORKSPACE, "other", RUN, &grant, "追问"),
            Err(AgentError::Scope)
        );
        let mut changed = grant.clone();
        changed.pages[0].pages.push(2);
        assert_eq!(
            store.followup_goal(WORKSPACE, CHAT, RUN, &changed, "追问"),
            Err(AgentError::SourceStale)
        );
        changed = grant.clone();
        changed.provider_revision = "changed".into();
        assert_eq!(
            store.followup_goal(WORKSPACE, CHAT, RUN, &changed, "追问"),
            Err(AgentError::SourceStale)
        );
        store
            .connection
            .execute(
                "UPDATE resource_page_text SET content_hash='changed' WHERE page_number=1",
                [],
            )
            .unwrap();
        assert_eq!(
            store.followup_goal(WORKSPACE, CHAT, RUN, &grant, "追问"),
            Err(AgentError::SourceStale)
        );
    }

    pub(in crate::agent::store) fn fixture() -> AgentStore {
        let db = fixture_connection();
        db.execute_batch("CREATE TABLE blob(id TEXT,workspace_id TEXT,sha256 TEXT,integrity_state TEXT);
            CREATE TABLE resource_document(id TEXT,workspace_id TEXT,blob_id TEXT,kind TEXT,deleted_at INTEGER,revision INTEGER);
            CREATE TABLE resource_index_job(document_id TEXT,source_sha256 TEXT,state TEXT,started_at INTEGER);
            CREATE TABLE resource_page_text(document_id TEXT,page_number INTEGER,content_hash TEXT,indexed_at INTEGER,text_content TEXT);
            CREATE TABLE ai_provider_config(id TEXT,workspace_id TEXT,base_url TEXT,secret_ref TEXT,provider_protocol TEXT,provider_type TEXT,enabled INTEGER,deleted_at INTEGER,updated_at INTEGER);
            CREATE TABLE ai_model_profile(provider_config_id TEXT,model_name TEXT,context_limit INTEGER,max_output_tokens INTEGER,updated_at INTEGER);").unwrap();
        db.execute("INSERT INTO blob VALUES ('b',?1,'hash','ok')", [WORKSPACE])
            .unwrap();
        db.execute(
            "INSERT INTO resource_document VALUES ('doc',?1,'b','pdf',NULL,1)",
            [WORKSPACE],
        )
        .unwrap();
        db.execute_batch(
            "INSERT INTO resource_index_job VALUES ('doc','hash','ready',1);
            INSERT INTO resource_page_text VALUES ('doc',1,'page-one',1,'矩阵具有相同特征值。');
            INSERT INTO resource_page_text VALUES ('doc',2,'page-two',1,'DO_NOT_DISCLOSE');",
        )
        .unwrap();
        db.execute("INSERT INTO ai_provider_config VALUES ('provider',?1,'https://api.deepseek.com','reference','deepseek_chat','openai_responses',1,NULL,1)",[WORKSPACE]).unwrap();
        db.execute_batch("INSERT INTO ai_model_profile VALUES ('provider','deepseek-v4-flash-vision-exp',262144,8192,1);").unwrap();
        AgentStore::attach(db).unwrap()
    }
    fn run(store: &mut AgentStore) -> (Grant, ReadCall) {
        run_pages(store, vec![1])
    }
    pub(in crate::agent::store) fn run_pages(
        store: &mut AgentStore,
        pages: Vec<u32>,
    ) -> (Grant, ReadCall) {
        let profile = store.selected_provider(WORKSPACE, "provider").unwrap();
        let grant = store
            .resolve_grant(
                WORKSPACE,
                &profile,
                &[PageRequest {
                    document_id: "doc".into(),
                    pages,
                }],
            )
            .unwrap();
        let run = store
            .create(
                &NewRun {
                    id: RUN,
                    workspace: WORKSPACE,
                    conversation: CHAT,
                    goal: "q",
                    grant: &grant,
                    budget: Budget::default(),
                    token_policy: TokenPolicy::Observe,
                },
                1,
            )
            .unwrap();
        store.claim(WORKSPACE, &run, 2).unwrap();
        let call = ReadCall {
            id: "call".into(),
            tool: ReadTool::ReadResourcePages,
            document_id: "doc".into(),
            revision: grant.pages[0].revision.clone(),
            page: 1,
            query: None,
            offset: None,
            cursor: None,
            limit: None,
        };
        (grant, call)
    }
    #[test]
    fn indexed_read_and_literal_search_never_expand_to_unselected_pages() {
        let mut store = fixture();
        let (_, mut call) = run(&mut store);
        let text = store.read_agent_page(WORKSPACE, RUN, &call).unwrap();
        assert!(text.contains("特征值"));
        assert!(!text.contains("DO_NOT_DISCLOSE"));
        call.tool = ReadTool::SearchLearningResources;
        call.query = Some("特征值".into());
        assert!(
            store
                .read_agent_page(WORKSPACE, RUN, &call)
                .unwrap()
                .contains("特征值")
        );
        call.page = 2;
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call).unwrap_err(),
            AgentError::Scope
        );
        assert_eq!(
            store.read_agent_page("foreign", RUN, &call).unwrap_err(),
            AgentError::Scope
        );
    }
    #[test]
    fn rebuilt_index_or_deleted_source_invalidates_the_grant_before_reading() {
        let mut store = fixture();
        let (grant, call) = run(&mut store);
        store
            .connection
            .execute(
                "UPDATE resource_page_text SET content_hash='new' WHERE page_number=1",
                [],
            )
            .unwrap();
        assert_eq!(
            store.revalidate_sources(WORKSPACE, &grant).unwrap_err(),
            AgentError::SourceStale
        );
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call).unwrap_err(),
            AgentError::SourceStale
        );
        store
            .connection
            .execute("UPDATE resource_document SET deleted_at=2", [])
            .unwrap();
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call).unwrap_err(),
            AgentError::Scope
        );
    }
    #[test]
    fn missing_index_is_not_implicitly_built_and_references_are_host_generated() {
        let mut store = fixture();
        let (_, call) = run(&mut store);
        store
            .connection
            .execute("UPDATE resource_index_job SET state='running'", [])
            .unwrap();
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call).unwrap_err(),
            AgentError::IndexNotReady
        );
        assert_eq!(
            store
                .connection
                .query_row("SELECT state FROM resource_index_job", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "running"
        );
    }
    #[test]
    fn profile_admission_rejects_foreign_endpoints_and_pins_settings() {
        let store = fixture();
        let old = store
            .selected_provider(WORKSPACE, "provider")
            .unwrap()
            .revision()
            .unwrap();
        store
            .connection
            .execute("UPDATE ai_model_profile SET updated_at=2", [])
            .unwrap();
        assert_ne!(
            old,
            store
                .selected_provider(WORKSPACE, "provider")
                .unwrap()
                .revision()
                .unwrap()
        );
        for url in [
            "http://api.deepseek.com",
            "https://api.deepseek.com.evil.test",
            "https://api.deepseek.com/?redirect=evil",
            "https://key@api.deepseek.com",
            "https://api.deepseek.com:444",
        ] {
            store
                .connection
                .execute("UPDATE ai_provider_config SET base_url=?1", [url])
                .unwrap();
            assert!(matches!(
                store.selected_provider(WORKSPACE, "provider"),
                Err(AgentError::Unsupported)
            ));
        }
    }
    #[test]
    fn escaped_text_is_bounded_for_durable_result_and_cancel_blocks_reading() {
        let mut store = fixture();
        let (_, call) = run(&mut store);
        store
            .connection
            .execute(
                "UPDATE resource_page_text SET text_content=?1 WHERE page_number=1",
                ["\u{1}".repeat(4000)],
            )
            .unwrap();
        let result = store.read_agent_page(WORKSPACE, RUN, &call).unwrap();
        assert!(serde_json::to_string(&result).unwrap().len() <= 8000);
        assert!(result.contains("\"truncated\":true"));
        let current = store.get(WORKSPACE, RUN).unwrap();
        store.request_cancel(WORKSPACE, &current, 3).unwrap();
        assert_eq!(
            store.read_agent_page(WORKSPACE, RUN, &call).unwrap_err(),
            AgentError::Stale
        );
    }

    #[test]
    fn dispatch_revalidation_rejects_stale_owners_configuration_changes_and_cancel() {
        let mut store = fixture();
        let (grant, _) = run(&mut store);
        assert!(
            store
                .authorize_agent_provider(WORKSPACE, RUN, 1, &grant.provider_revision)
                .is_ok()
        );
        assert!(matches!(
            store.authorize_agent_provider(WORKSPACE, RUN, 2, &grant.provider_revision),
            Err(AgentError::Stale)
        ));
        store
            .connection
            .execute("UPDATE ai_model_profile SET updated_at=2", [])
            .unwrap();
        assert!(matches!(
            store.authorize_agent_provider(WORKSPACE, RUN, 1, &grant.provider_revision),
            Err(AgentError::SourceStale)
        ));
        let current = store.get(WORKSPACE, RUN).unwrap();
        store.request_cancel(WORKSPACE, &current, 3).unwrap();
        assert!(matches!(
            store.authorize_agent_provider(WORKSPACE, RUN, 1, &grant.provider_revision),
            Err(AgentError::Stale)
        ));
    }
}
