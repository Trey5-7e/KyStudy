use super::{AgentError, AgentStore, Charge, Grant, RunSnapshot, RunState};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

type Work = Box<dyn FnOnce(&mut AgentStore) + Send>;

struct WorkerOwner {
    sender: Option<tokio::sync::mpsc::Sender<Work>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for WorkerOwner {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Single owned database thread with an eight-operation bounded queue.
#[derive(Clone)]
pub struct StoreWorker(Arc<WorkerOwner>);

impl StoreWorker {
    /// Moves the connection to one owned thread. No `SQLite` work runs on the async executor.
    ///
    /// # Errors
    /// Returns Store if the worker cannot be started.
    pub fn new(mut store: AgentStore) -> Result<Self, AgentError> {
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<Work>(8);
        let thread = std::thread::Builder::new()
            .name("learning-agent-store".into())
            .spawn(move || {
                while let Some(operation) = receiver.blocking_recv() {
                    operation(&mut store);
                }
            })
            .map_err(|_| AgentError::Store)?;
        Ok(Self(Arc::new(WorkerOwner {
            sender: Some(sender),
            thread: Some(thread),
        })))
    }

    /// Executes one short Host database operation, applying queue backpressure.
    ///
    /// # Errors
    /// Propagates sanitized operation errors or a disconnected worker.
    pub async fn call<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut AgentStore) -> Result<T, AgentError> + Send + 'static,
    ) -> Result<T, AgentError> {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        self.0
            .sender
            .as_ref()
            .ok_or(AgentError::Store)?
            .send(Box::new(move |store| {
                let _ = sender.send(operation(store));
            }))
            .await
            .map_err(|_| AgentError::Store)?;
        receiver.await.map_err(|_| AgentError::Store)?
    }
}

/// Revalidated context; Provider credentials remain exclusively inside the Adapter.
#[derive(Clone)]
pub struct ExecutionContext {
    /// Owner epoch captured before dispatch; stale drivers cannot initiate a new request.
    pub owner_epoch: u32,
    /// Original user goal, preserved on every model round.
    pub goal: String,
    /// Immutable Host Provider/source selection.
    pub grant: Grant,
}

/// Read-only tools available in the M1 vertical path. Other P0 tools arrive in M2-M4.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadTool {
    /// Search within authorized indexed material.
    SearchLearningResources,
    /// Read one authorized indexed page.
    ReadResourcePages,
}

/// Fully assembled native call; no model-supplied workspace, path or SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadCall {
    /// Provider call ID for result pairing.
    pub id: String,
    /// Closed tool registry for this vertical path.
    pub tool: ReadTool,
    /// Document already selected by the Host.
    pub document_id: String,
    /// Exact authorized source revision.
    pub revision: String,
    /// Positive authorized page number.
    pub page: u32,
    /// Optional literal query for the bounded page-search tool.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    /// Unicode character offset within the same authorized page; absent means zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offset: Option<u32>,
    /// Opaque query/version-bound cursor for ranked search.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Maximum ranked candidate pages (1..=8, default 5).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

impl ReadCall {
    pub(crate) fn result_page(&self, text: &str) -> Result<u32, AgentError> {
        if matches!(self.tool, ReadTool::SearchLearningResources)
            && let Ok(value) = serde_json::from_str::<Value>(text)
            && value["kind"] == "search_results"
        {
            return value["page"]
                .as_u64()
                .and_then(|p| u32::try_from(p).ok())
                .filter(|p| *p > 0)
                .ok_or(AgentError::Protocol);
        }
        // Older receipts and read tools remain anchored to the requested page.
        Ok(self.page)
    }
}

/// A complete Provider turn; adapters must reject EOF/incomplete tool arguments first.
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ProviderTurn {
    /// Request one bounded read-only tool.
    Tool {
        /// Complete native call.
        call: ReadCall,
    },
    /// Final answer with Host-produced source IDs.
    Final {
        /// User-visible answer.
        message: String,
        /// Previously issued source IDs.
        source_ids: Vec<String>,
    },
    /// Ask a single clarification without creating a tool call.
    NeedsInput {
        /// One bounded user-visible question.
        question: String,
    },
}

/// Narrow asynchronous Provider boundary; production Adapters must implement safe estimation.
pub trait Provider: Send {
    /// Per-request output allowance chosen by the Adapter for the model and task.
    /// This is not a cumulative application token cutoff.
    fn output_tokens(&self) -> u32 {
        4096
    }
    /// Conservative input estimate including schemas and protocol overhead.
    ///
    /// # Errors
    /// Reject inputs that cannot be safely bounded.
    fn input_tokens(
        &self,
        context: &ExecutionContext,
        history: &[Value],
    ) -> Result<u32, AgentError>;
    /// Makes one request, obeying the supplied output allowance and preserving private protocol state.
    fn request(
        &mut self,
        context: ExecutionContext,
        history: Vec<Value>,
        output_limit: u32,
    ) -> impl Future<Output = Result<ProviderTurn, AgentError>> + Send;
}

/// Host read-only domain executor. Implementations recheck source existence/revision before reading.
pub trait ToolExecutor: Send {
    /// Reads only the authorized page; the Runtime supplies the source ID, never the model.
    fn execute(
        &mut self,
        call: ReadCall,
    ) -> impl Future<Output = Result<String, AgentError>> + Send;
}

/// Owns the task/cancellation handle independently of the currently displayed page.
pub struct AgentTask {
    task: Option<tauri::async_runtime::JoinHandle<Result<RunSnapshot, AgentError>>>,
    store: StoreWorker,
    workspace: String,
    id: String,
}

impl Drop for AgentTask {
    fn drop(&mut self) {
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

impl AgentTask {
    pub(super) fn is_finished(&self) -> bool {
        self.task
            .as_ref()
            .is_none_or(|task| task.inner().is_finished())
    }
    /// Claims one Run and starts a bounded asynchronous driver. No network is built into this kernel.
    ///
    /// # Errors
    /// Rejects stale leases, revoked scopes or another workspace owner before spawning.
    pub async fn start(
        store: StoreWorker,
        workspace: String,
        lease: RunSnapshot,
        provider: impl Provider + 'static,
        executor: impl ToolExecutor + 'static,
    ) -> Result<Self, AgentError> {
        let scope = workspace.clone();
        let claimed = store
            .call(move |db| db.claim(&scope, &lease, now()))
            .await?;
        let id = claimed.id.clone();
        let driver_store = store.clone();
        let driver_workspace = workspace.clone();
        let task = tauri::async_runtime::spawn(async move {
            drive(driver_store, driver_workspace, claimed, provider, executor).await
        });
        Ok(Self {
            task: Some(task),
            store,
            workspace,
            id,
        })
    }

    /// Waits for completion while preserving the task owner.
    ///
    /// # Errors
    /// Returns driver errors, or Stale if the task was externally aborted.
    pub async fn wait(mut self) -> Result<RunSnapshot, AgentError> {
        self.task
            .as_mut()
            .ok_or(AgentError::Stale)?
            .await
            .map_err(|_| AgentError::Stale)?
    }

    /// Persists cancel intent, aborts and joins the async task, then records canceled.
    ///
    /// # Errors
    /// Returns persistence errors without claiming that cleanup was recorded successfully.
    pub async fn cancel(mut self) -> Result<RunSnapshot, AgentError> {
        let workspace = self.workspace.clone();
        let id = self.id.clone();
        let requested = self
            .store
            .call(move |db| {
                let lease = db.get(&workspace, &id)?;
                db.request_cancel(&workspace, &lease, now())
            })
            .await?;
        if let Some(task) = self.task.take() {
            if !requested.state.is_terminal() {
                task.abort();
            }
            let _ = task.await;
        }
        if requested.state.is_terminal() {
            return Ok(requested);
        }
        let workspace = self.workspace.clone();
        let id = self.id.clone();
        self.store
            .call(move |db| {
                let lease = db.get(&workspace, &id)?;
                db.transition(&workspace, &lease, RunState::Canceled, now())
            })
            .await
    }
}

struct Driver {
    store: StoreWorker,
    workspace: String,
    lease: RunSnapshot,
}

impl Driver {
    async fn reserve(&mut self, charge: Charge) -> Result<(), AgentError> {
        let workspace = self.workspace.clone();
        let lease = self.lease.clone();
        self.lease = self
            .store
            .call(move |db| db.reserve(&workspace, &lease, charge, now()))
            .await?;
        Ok(())
    }
    async fn finish(&mut self, sequence: u32, result: Value) -> Result<(), AgentError> {
        let workspace = self.workspace.clone();
        let lease = self.lease.clone();
        self.lease = self
            .store
            .call(move |db| db.finish_step_result(&workspace, &lease, sequence, &result, now()))
            .await?;
        Ok(())
    }
    async fn transition(&mut self, state: RunState) -> Result<(), AgentError> {
        let workspace = self.workspace.clone();
        let lease = self.lease.clone();
        self.lease = self
            .store
            .call(move |db| db.transition(&workspace, &lease, state, now()))
            .await?;
        Ok(())
    }
    async fn timed<T>(
        &mut self,
        future: impl Future<Output = Result<T, AgentError>>,
    ) -> Result<T, AgentError> {
        let remaining = self
            .lease
            .limit
            .active_ms
            .saturating_sub(self.lease.used.active_ms);
        if remaining == 0 {
            return Err(AgentError::Budget);
        }
        let started = Instant::now();
        let result =
            tokio::time::timeout(Duration::from_millis(u64::from(remaining)), future).await;
        let elapsed = u32::try_from(started.elapsed().as_millis())
            .unwrap_or(u32::MAX)
            .min(remaining);
        self.reserve(Charge::ActiveMilliseconds(elapsed)).await?;
        result.map_err(|_| AgentError::Budget)?
    }
}

async fn drive(
    store: StoreWorker,
    workspace: String,
    lease: RunSnapshot,
    mut provider: impl Provider,
    mut executor: impl ToolExecutor,
) -> Result<RunSnapshot, AgentError> {
    let mut driver = Driver {
        store,
        workspace,
        lease,
    };
    let outcome = run_loop(&mut driver, &mut provider, &mut executor).await;
    if let Err(error) = outcome {
        let scope = driver.workspace.clone();
        let id = driver.lease.id.clone();
        let epoch = driver.lease.owner_epoch;
        // Never overwrite a cancellation or a newer owner's terminal decision.
        let _ = driver
            .store
            .call(move |db| {
                let current = db.get(&scope, &id)?;
                if current.owner_epoch == epoch
                    && current.state == RunState::Running
                    && !current.cancel_requested
                {
                    db.fail(&scope, &current, error, now())?;
                }
                Ok(())
            })
            .await;
        return Err(error);
    }
    Ok(driver.lease)
}

async fn run_loop(
    driver: &mut Driver,
    provider: &mut impl Provider,
    executor: &mut impl ToolExecutor,
) -> Result<(), AgentError> {
    loop {
        let workspace = driver.workspace.clone();
        let id = driver.lease.id.clone();
        let (context, history) = driver
            .store
            .call(move |db| Ok((db.context(&workspace, &id)?, db.results(&workspace, &id)?)))
            .await?;
        if let Some(last) = history.last().filter(|item| {
            matches!(
                item["kind"].as_str(),
                Some("tool" | "final" | "needs_input")
            )
        }) {
            // Recover committed output before asking the Provider again; counters are not reset.
            let turn: ProviderTurn =
                serde_json::from_value(last.clone()).map_err(|_| AgentError::Protocol)?;
            if consume_turn(
                driver,
                executor,
                &context.grant,
                &history[..history.len() - 1],
                turn,
            )
            .await?
            {
                return Ok(());
            }
            continue;
        }
        let input = provider.input_tokens(&context, &history)?;
        let requested_output = provider.output_tokens();
        let output = if driver.lease.token_policy == super::TokenPolicy::Enforce {
            requested_output.min(
                driver
                    .lease
                    .limit
                    .output
                    .saturating_sub(driver.lease.used.output),
            )
        } else {
            requested_output
        };
        if output == 0 {
            return Err(AgentError::Budget);
        }
        driver.reserve(Charge::Model { input, output }).await?;
        let sequence = driver.lease.event_sequence;
        let grant = context.grant.clone();
        let turn = driver
            .timed(provider.request(context, history.clone(), output))
            .await?;
        let encoded = serde_json::to_value(&turn).map_err(|_| AgentError::Protocol)?;
        driver.finish(sequence, encoded).await?;
        if consume_turn(driver, executor, &grant, &history, turn).await? {
            return Ok(());
        }
    }
}

async fn consume_turn(
    driver: &mut Driver,
    executor: &mut impl ToolExecutor,
    grant: &Grant,
    history: &[Value],
    turn: ProviderTurn,
) -> Result<bool, AgentError> {
    match turn {
        ProviderTurn::Tool { call } => {
            driver.reserve(Charge::Tool).await?;
            let sequence = driver.lease.event_sequence;
            authorize(grant, &call, history)?;
            let call_id = call.id.clone();
            let text = driver.timed(executor.execute(call.clone())).await?;
            let page = call.result_page(&text)?;
            if !grant.pages.iter().any(|p| {
                p.document_id == call.document_id
                    && p.revision == call.revision
                    && p.pages.contains(&page)
            }) {
                return Err(AgentError::Scope);
            }
            let source_id = format!("{}:{}:{page}", call.document_id, call.revision);
            driver.finish(sequence,json!({"kind":"tool_result","call_id":call_id,"source_id":source_id,"text":text})).await?;
            Ok(false)
        }
        ProviderTurn::Final {
            message,
            source_ids,
        } => {
            if message.trim().is_empty()
                || source_ids.iter().any(|source| {
                    !history
                        .iter()
                        .any(|item| item["kind"] == "tool_result" && item["source_id"] == *source)
                })
            {
                return Err(AgentError::Protocol);
            }
            driver.transition(RunState::Completed).await?;
            Ok(true)
        }
        ProviderTurn::NeedsInput { question } => {
            if question.trim().is_empty() || question.len() > 1024 {
                return Err(AgentError::Protocol);
            }
            driver.transition(RunState::WaitingForInput).await?;
            Ok(true)
        }
    }
}

fn authorize(grant: &Grant, call: &ReadCall, history: &[Value]) -> Result<(), AgentError> {
    if call.id.is_empty()
        || call.id.len() > 128
        || history
            .iter()
            .any(|item| item["kind"] == "tool" && item["call"]["id"] == call.id)
    {
        return Err(AgentError::Protocol);
    }
    if !grant.pages.iter().any(|selection| {
        selection.document_id == call.document_id
            && selection.revision == call.revision
            && selection.pages.contains(&call.page)
    }) {
        return Err(AgentError::Scope);
    }
    Ok(())
}

pub(super) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
        })
}
