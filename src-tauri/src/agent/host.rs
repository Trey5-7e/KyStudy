use super::{
    AgentError, AgentTask, Event, Provider, RunSnapshot, RunState, StoreWorker, ToolExecutor,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct StartAgentRun {
    pub conversation_id: String,
    pub provider_id: String,
    pub goal: String,
    pub previous_run_id: Option<String>,
    pub pages: Vec<super::PageRequest>,
    #[serde(default)]
    pub budget: super::Budget,
    #[serde(default)]
    pub token_policy: super::TokenPolicy,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentRunDetail {
    pub run: RunSnapshot,
    pub goal: String,
    pub grant: super::Grant,
    pub results: Vec<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentSource {
    pub document_id: String,
    pub page: u32,
}

struct IndexedTools {
    store: StoreWorker,
    workspace: String,
    run_id: String,
}

struct OwnedProvider<P> {
    inner: P,
    _ownership: Option<Arc<std::fs::File>>,
}
impl<P: Provider> Provider for OwnedProvider<P> {
    fn output_tokens(&self) -> u32 {
        self.inner.output_tokens()
    }
    fn input_tokens(
        &self,
        context: &super::ExecutionContext,
        history: &[serde_json::Value],
    ) -> Result<u32, AgentError> {
        self.inner.input_tokens(context, history)
    }
    async fn request(
        &mut self,
        context: super::ExecutionContext,
        history: Vec<serde_json::Value>,
        output_limit: u32,
    ) -> Result<super::ProviderTurn, AgentError> {
        self.inner.request(context, history, output_limit).await
    }
}
impl ToolExecutor for IndexedTools {
    async fn execute(&mut self, call: super::ReadCall) -> Result<String, AgentError> {
        let workspace = self.workspace.clone();
        let id = self.run_id.clone();
        self.store
            .call(move |db| db.read_agent_page(&workspace, &id, &call))
            .await
    }
}

/// Workspace-bound task owner for application commands; no UI lifetime owns a driver.
#[derive(Clone)]
pub struct AgentHost {
    store: StoreWorker,
    workspace: String,
    tasks: Arc<tokio::sync::Mutex<HashMap<String, AgentTask>>>,
    ownership: Option<Arc<std::fs::File>>,
}

impl AgentHost {
    pub(crate) fn with_ownership(mut self, file: std::fs::File) -> Self {
        self.ownership = Some(Arc::new(file));
        self
    }
    pub(crate) async fn latest(
        &self,
        conversation: String,
    ) -> Result<Option<RunSnapshot>, AgentError> {
        let workspace = self.workspace.clone();
        self.store
            .call(move |db| db.latest(&workspace, &conversation))
            .await
    }

    pub(crate) async fn source(
        &self,
        id: String,
        source_id: String,
    ) -> Result<AgentSource, AgentError> {
        let workspace = self.workspace.clone();
        self.store
            .call(move |db| {
                let grant = db.context(&workspace, &id)?.grant;
                if !db
                    .results(&workspace, &id)?
                    .iter()
                    .any(|r| r["kind"] == "tool_result" && r["source_id"] == source_id)
                {
                    return Err(AgentError::Scope);
                }
                db.revalidate_sources(&workspace, &grant)?;
                for selection in grant.pages {
                    for page in selection.pages {
                        if format!("{}:{}:{page}", selection.document_id, selection.revision)
                            == source_id
                        {
                            return Ok(AgentSource {
                                document_id: selection.document_id,
                                page,
                            });
                        }
                    }
                }
                Err(AgentError::Scope)
            })
            .await
    }
    pub(crate) async fn start_readonly(
        &self,
        input: StartAgentRun,
        conversation_lease: super::ConversationLease,
    ) -> Result<RunSnapshot, AgentError> {
        let workspace = self.workspace.clone();
        let id = uuid::Uuid::now_v7().to_string();
        let run_id = id.clone();
        let (run, profile) = self
            .store
            .call(move |db| {
                let profile = db.selected_provider(&workspace, &input.provider_id)?;
                let grant = db.resolve_grant(&workspace, &profile, &input.pages)?;
                let goal = match input.previous_run_id {
                    Some(previous) => db.followup_goal(
                        &workspace,
                        &input.conversation_id,
                        &previous,
                        &grant,
                        &input.goal,
                    )?,
                    None => input.goal,
                };
                let run = db.create(
                    &super::NewRun {
                        id: &run_id,
                        workspace: &workspace,
                        conversation: &input.conversation_id,
                        goal: &goal,
                        grant: &grant,
                        budget: input.budget,
                        token_policy: input.token_policy,
                    },
                    super::runtime::now(),
                )?;
                Ok((run, profile))
            })
            .await?;
        let provider = match super::deepseek::DeepSeekProvider::new(
            self.store.clone(),
            self.workspace.clone(),
            id.clone(),
            profile,
            conversation_lease,
        ) {
            Ok(provider) => provider,
            Err(error) => {
                self.cancel(&id).await?;
                return Err(error);
            }
        };
        let tools = IndexedTools {
            store: self.store.clone(),
            workspace: self.workspace.clone(),
            run_id: id.clone(),
        };
        let result = self.start(run, provider, tools).await;
        if result.is_err() {
            // A failed claim must not leave a queued conversation permanently occupied.
            let workspace = self.workspace.clone();
            let _ = self
                .store
                .call(move |db| {
                    let run = db.get(&workspace, &id)?;
                    if run.state == RunState::Queued {
                        db.request_cancel(&workspace, &run, super::runtime::now())?;
                    }
                    Ok(())
                })
                .await;
        }
        result
    }

    pub(crate) async fn detail(&self, id: &str) -> Result<AgentRunDetail, AgentError> {
        let workspace = self.workspace.clone();
        let id = id.to_owned();
        self.store
            .call(move |db| {
                let context = db.context(&workspace, &id)?;
                Ok(AgentRunDetail {
                    run: db.get(&workspace, &id)?,
                    goal: context.goal,
                    grant: context.grant,
                    results: db.results(&workspace, &id)?,
                })
            })
            .await
    }
    /// Binds a Host to an already initialized database and authoritative workspace ID.
    #[must_use]
    pub fn new(store: StoreWorker, workspace: String) -> Self {
        Self {
            store,
            workspace,
            tasks: Arc::default(),
            ownership: None,
        }
    }

    /// Starts an explicitly requested Run and retains its cancellation handle.
    /// The caller must revalidate the source and Provider configuration first.
    ///
    /// # Errors
    /// Returns Busy for duplicate ownership or propagates claim/store errors.
    pub async fn start(
        &self,
        lease: RunSnapshot,
        provider: impl Provider + 'static,
        executor: impl ToolExecutor + 'static,
    ) -> Result<RunSnapshot, AgentError> {
        let mut tasks = self.tasks.lock().await;
        tasks.retain(|_, task| !task.is_finished());
        if tasks.contains_key(&lease.id) {
            return Err(AgentError::Busy);
        }
        let id = lease.id.clone();
        let task = AgentTask::start(
            self.store.clone(),
            self.workspace.clone(),
            lease,
            OwnedProvider {
                inner: provider,
                _ownership: self.ownership.clone(),
            },
            executor,
        )
        .await?;
        tasks.insert(id.clone(), task);
        drop(tasks);
        self.snapshot(&id).await
    }

    /// Reads the committed state; completed task handles are reclaimed on observation.
    ///
    /// # Errors
    /// Returns Scope for runs outside this workspace or sanitized store errors.
    pub async fn snapshot(&self, id: &str) -> Result<RunSnapshot, AgentError> {
        let workspace = self.workspace.clone();
        let id = id.to_owned();
        let snapshot = self.store.call(move |db| db.get(&workspace, &id)).await?;
        self.tasks
            .lock()
            .await
            .retain(|_, task| !task.is_finished());
        Ok(snapshot)
    }

    /// Replays committed events after a cursor without depending on transient UI delivery.
    ///
    /// # Errors
    /// Returns Scope for foreign runs or sanitized persistence errors.
    pub async fn events(&self, id: &str, after: u32) -> Result<Vec<Event>, AgentError> {
        let workspace = self.workspace.clone();
        let id = id.to_owned();
        self.store
            .call(move |db| db.events(&workspace, &id, after))
            .await
    }

    /// Cancels and joins the owned driver before publishing canceled.
    /// Cleanup continues if the command's response listener disappears.
    ///
    /// # Errors
    /// Returns Busy for an active Run owned elsewhere; does not forge cleanup confirmation.
    pub async fn cancel(&self, id: &str) -> Result<RunSnapshot, AgentError> {
        let host = self.clone();
        let id = id.to_owned();
        tauri::async_runtime::spawn(async move {
            let mut tasks = host.tasks.lock().await;
            if let Some(task) = tasks.remove(&id) {
                // Keep other start/cancel commands serialized until this owner's cleanup completes.
                return task.cancel().await;
            }
            let workspace = host.workspace.clone();
            host.store
                .call(move |db| {
                    let run = db.get(&workspace, &id)?;
                    if run.state.is_terminal() {
                        return Ok(run);
                    }
                    if !matches!(
                        run.state,
                        RunState::Queued | RunState::WaitingForInput | RunState::Interrupted
                    ) {
                        return Err(AgentError::Busy);
                    }
                    let requested = db.request_cancel(&workspace, &run, super::runtime::now())?;
                    if requested.state.is_terminal() {
                        Ok(requested)
                    } else {
                        db.transition(
                            &workspace,
                            &requested,
                            RunState::Canceled,
                            super::runtime::now(),
                        )
                    }
                })
                .await
        })
        .await
        .map_err(|_| AgentError::Store)?
    }
}
