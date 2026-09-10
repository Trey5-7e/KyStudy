use super::*;

pub(super) const WORKSPACE: &str = "00000000-0000-4000-8000-000000000001";
pub(super) const CHAT: &str = "00000000-0000-4000-8000-000000000002";
const CHAT2: &str = "00000000-0000-4000-8000-000000000003";
pub(super) const RUN: &str = "00000000-0000-4000-8000-000000000004";
const RUN2: &str = "00000000-0000-4000-8000-000000000005";

pub(super) fn fixture_connection() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    initialize(&db);
    db
}
fn initialize(db: &Connection) {
    db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE workspace(id TEXT PRIMARY KEY); CREATE TABLE ai_conversation(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspace(id),conversation_kind TEXT NOT NULL);").unwrap();
    db.execute("INSERT INTO workspace VALUES (?1)", [WORKSPACE])
        .unwrap();
    for chat in [CHAT, CHAT2] {
        db.execute(
            "INSERT INTO ai_conversation VALUES (?1,?2,'chat')",
            params![chat, WORKSPACE],
        )
        .unwrap();
    }
    db.execute_batch(include_str!("../../migrations/0031_agent_kernel.sql"))
        .unwrap();
    db.pragma_update(None, "foreign_keys", false).unwrap();
    db.execute_batch(include_str!("../../migrations/0032_agent_token_policy.sql"))
        .unwrap();
    db.pragma_update(None, "foreign_keys", true).unwrap();
}
fn grant() -> Grant {
    Grant {
        provider_id: "host-selected-provider".into(),
        provider_revision: "host-config-revision".into(),
        model: "deepseek-v4-flash-vision-exp".into(),
        pages: vec![],
    }
}

fn policy_run(store: &mut AgentStore, policy: TokenPolicy, budget: Budget) -> RunSnapshot {
    let run = store
        .create(
            &NewRun {
                id: RUN,
                workspace: WORKSPACE,
                conversation: CHAT,
                goal: "q",
                grant: &grant(),
                budget,
                token_policy: policy,
            },
            1,
        )
        .unwrap();
    store.claim(WORKSPACE, &run, 2).unwrap()
}

#[test]
fn observation_exceeds_old_token_caps_and_still_accounts_usage() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let run = policy_run(&mut store, TokenPolicy::Observe, Budget::default());
    let run = store
        .reserve(
            WORKSPACE,
            &run,
            Charge::Model {
                input: 100_000,
                output: 20_000,
            },
            3,
        )
        .unwrap();
    assert_eq!(
        (run.state, run.used.input, run.used.output),
        (RunState::Running, 100_000, 20_000)
    );
    assert!(!run.token_warning());
}

#[test]
fn warning_threshold_is_non_blocking_and_survives_reload() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let run = policy_run(
        &mut store,
        TokenPolicy::Warn,
        Budget {
            input: 10,
            output: 20,
            ..Budget::default()
        },
    );
    store
        .reserve(
            WORKSPACE,
            &run,
            Charge::Model {
                input: 11,
                output: 21,
            },
            3,
        )
        .unwrap();
    let run = store.get(WORKSPACE, RUN).unwrap();
    assert_eq!(run.state, RunState::Running);
    assert!(run.token_warning());
    assert_eq!(run.token_policy, TokenPolicy::Warn);
}

#[test]
fn explicitly_enabled_token_cap_prevents_dispatch_without_resetting_usage() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let run = policy_run(
        &mut store,
        TokenPolicy::Enforce,
        Budget {
            input: 100_000,
            output: 20_000,
            ..Budget::default()
        },
    );
    let run = store
        .reserve(
            WORKSPACE,
            &run,
            Charge::Model {
                input: 100_000,
                output: 20_000,
            },
            3,
        )
        .unwrap();
    let run = store
        .finish_step(WORKSPACE, &run, run.event_sequence, 4)
        .unwrap();
    assert_eq!(
        store
            .reserve(
                WORKSPACE,
                &run,
                Charge::Model {
                    input: 1,
                    output: 1
                },
                5
            )
            .unwrap_err(),
        AgentError::Budget
    );
    assert_eq!(store.get(WORKSPACE, RUN).unwrap().used.input, 100_000);
}

#[test]
fn token_policy_is_immutable_and_threshold_modes_require_positive_values() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    for token_policy in [TokenPolicy::Warn, TokenPolicy::Enforce] {
        assert_eq!(
            store
                .create(
                    &NewRun {
                        id: RUN,
                        workspace: WORKSPACE,
                        conversation: CHAT,
                        goal: "q",
                        grant: &grant(),
                        budget: Budget::default(),
                        token_policy
                    },
                    1
                )
                .unwrap_err(),
            AgentError::Invalid
        );
    }
    let run = policy_run(&mut store, TokenPolicy::Observe, Budget::default());
    assert!(store.connection.execute("UPDATE ai_agent_run SET token_policy='enforce',input_limit=1,output_limit=1,revision=revision+1 WHERE id=?1", [&run.id]).is_err());
}
fn create(store: &mut AgentStore, id: &str, chat: &str) -> RunSnapshot {
    store
        .create(
            &NewRun {
                id,
                workspace: WORKSPACE,
                conversation: chat,
                goal: "search-read-answer",
                grant: &grant(),
                budget: Budget::default(),
                token_policy: TokenPolicy::default(),
            },
            1,
        )
        .unwrap()
}

#[test]
fn queued_creation_has_one_committed_replayable_event() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let run = create(&mut store, RUN, CHAT);
    assert_eq!(run.state, RunState::Queued);
    let events = store.events(WORKSPACE, RUN, 0).unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].sequence, 1);
    assert!(store.events(WORKSPACE, RUN, 1).unwrap().is_empty());
    assert_eq!(store.get("foreign", RUN).unwrap_err(), AgentError::Scope);
}

#[test]
fn chat_kind_and_workspace_are_checked_before_writes() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    store
        .connection
        .execute(
            "UPDATE ai_conversation SET conversation_kind='planning'",
            [],
        )
        .unwrap();
    let result = store.create(
        &NewRun {
            id: RUN,
            workspace: WORKSPACE,
            conversation: CHAT,
            goal: "q",
            grant: &grant(),
            budget: Budget::default(),
            token_policy: TokenPolicy::default(),
        },
        0,
    );
    assert_eq!(result.unwrap_err(), AgentError::Scope);
    let count: i64 = store
        .connection
        .query_row("SELECT COUNT(*) FROM ai_agent_scope", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn workspace_and_conversation_ownership_are_exclusive() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let one = create(&mut store, RUN, CHAT);
    let two = create(&mut store, RUN2, CHAT2);
    let running = store.claim(WORKSPACE, &one, 2).unwrap();
    assert_eq!(
        store.claim(WORKSPACE, &two, 2).unwrap_err(),
        AgentError::Busy
    );
    assert_eq!(
        store.claim(WORKSPACE, &one, 2).unwrap_err(),
        AgentError::Stale
    );
    store
        .transition(WORKSPACE, &running, RunState::Interrupted, 3)
        .unwrap();
    assert_eq!(
        store.claim(WORKSPACE, &two, 4).unwrap().state,
        RunState::Running
    );
}

#[test]
fn reservation_precedes_dispatch_and_pending_step_prevents_completion() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let queued = create(&mut store, RUN, CHAT);
    let running = store.claim(WORKSPACE, &queued, 2).unwrap();
    let reserved = store
        .reserve(
            WORKSPACE,
            &running,
            Charge::Model {
                input: 100,
                output: 50,
            },
            3,
        )
        .unwrap();
    assert_eq!(
        (
            reserved.used.models,
            reserved.used.input,
            reserved.used.output
        ),
        (1, 100, 50)
    );
    assert_eq!(
        store
            .transition(WORKSPACE, &reserved, RunState::Completed, 4)
            .unwrap_err(),
        AgentError::Transition
    );
    let done = store
        .finish_step(WORKSPACE, &reserved, reserved.event_sequence, 4)
        .unwrap();
    let completed = store
        .transition(WORKSPACE, &done, RunState::Completed, 5)
        .unwrap();
    assert_eq!(completed.state, RunState::Completed);
    assert_eq!(
        store.claim(WORKSPACE, &completed, 6).unwrap_err(),
        AgentError::Stale
    );
}

#[test]
fn canceled_owner_cannot_publish_or_reserve_more_work() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let queued = create(&mut store, RUN, CHAT);
    let running = store.claim(WORKSPACE, &queued, 2).unwrap();
    let reserved = store.reserve(WORKSPACE, &running, Charge::Tool, 3).unwrap();
    let cancel = store.request_cancel(WORKSPACE, &reserved, 4).unwrap();
    assert!(cancel.cancel_requested);
    assert_eq!(cancel.state, RunState::Running);
    assert_eq!(
        store
            .finish_step(WORKSPACE, &reserved, reserved.event_sequence, 5)
            .unwrap_err(),
        AgentError::Stale
    );
    assert_eq!(
        store
            .reserve(WORKSPACE, &cancel, Charge::Tool, 5)
            .unwrap_err(),
        AgentError::Stale
    );
    let canceled = store
        .transition(WORKSPACE, &cancel, RunState::Canceled, 6)
        .unwrap();
    assert_eq!(
        store
            .request_cancel(WORKSPACE, &canceled, 7)
            .unwrap()
            .revision,
        canceled.revision
    );
}

#[test]
fn queued_cancel_never_claims_an_owner() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let run = create(&mut store, RUN, CHAT);
    let canceled = store.request_cancel(WORKSPACE, &run, 2).unwrap();
    assert_eq!(canceled.state, RunState::Canceled);
    assert_eq!(canceled.owner_epoch, 0);
}

#[test]
fn exclusive_host_recovery_interrupts_orphans_without_resetting_usage_or_restarting() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let queued = create(&mut store, RUN, CHAT);
    let running = store.claim(WORKSPACE, &queued, 2).unwrap();
    let reserved = store
        .reserve(
            WORKSPACE,
            &running,
            Charge::Model {
                input: 123,
                output: 456,
            },
            3,
        )
        .unwrap();
    store.interrupt_orphans(WORKSPACE, 4).unwrap();
    let interrupted = store.get(WORKSPACE, RUN).unwrap();
    assert_eq!(interrupted.state, RunState::Interrupted);
    assert_eq!(interrupted.used, reserved.used);
    assert!(interrupted.owner_epoch > reserved.owner_epoch);
    assert_eq!(
        store
            .finish_step(WORKSPACE, &reserved, reserved.event_sequence, 5)
            .unwrap_err(),
        AgentError::Stale
    );
}

#[test]
fn exhaustion_is_a_durable_failed_event_without_extra_dispatch() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let queued = create(&mut store, RUN, CHAT);
    let running = store.claim(WORKSPACE, &queued, 2).unwrap();
    assert_eq!(
        store
            .reserve(WORKSPACE, &running, Charge::ActiveMilliseconds(300_001), 3)
            .unwrap_err(),
        AgentError::Budget
    );
    let failed = store.get(WORKSPACE, RUN).unwrap();
    assert_eq!(failed.state, RunState::Failed);
    assert_eq!(failed.used.models, 0);
    assert_eq!(
        store.events(WORKSPACE, RUN, 2).unwrap()[0].kind,
        "budget_exhausted"
    );
}

#[test]
fn event_failure_rolls_back_step_and_budget_atomically() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let queued = create(&mut store, RUN, CHAT);
    let running = store.claim(WORKSPACE, &queued, 2).unwrap();
    store.connection.execute_batch("CREATE TRIGGER fail_event BEFORE INSERT ON ai_agent_event BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert_eq!(
        store
            .reserve(WORKSPACE, &running, Charge::Tool, 3)
            .unwrap_err(),
        AgentError::Store
    );
    assert_eq!(store.get(WORKSPACE, RUN).unwrap().used.tools, 0);
    let count: u32 = store
        .connection
        .query_row("SELECT COUNT(*) FROM ai_agent_step", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn reopen_and_explicit_recovery_preserve_budget_and_invalidate_old_owner() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("fixture.sqlite");
    let db = Connection::open(&path).unwrap();
    initialize(&db);
    let mut store = AgentStore::attach(db).unwrap();
    let queued = create(&mut store, RUN, CHAT);
    let running = store.claim(WORKSPACE, &queued, 2).unwrap();
    let old = store
        .reserve(
            WORKSPACE,
            &running,
            Charge::Model {
                input: 100,
                output: 50,
            },
            3,
        )
        .unwrap();
    drop(store);
    let mut store = AgentStore::attach(Connection::open(&path).unwrap()).unwrap();
    let snapshot = store.get(WORKSPACE, RUN).unwrap();
    assert_eq!(snapshot.state, RunState::Running);
    let interrupted = store
        .transition(WORKSPACE, &snapshot, RunState::Interrupted, 4)
        .unwrap();
    let resumed = store.claim(WORKSPACE, &interrupted, 5).unwrap();
    assert_eq!(resumed.used, old.used);
    assert!(resumed.owner_epoch > old.owner_epoch);
    assert_eq!(
        store
            .finish_step(WORKSPACE, &old, old.event_sequence, 6)
            .unwrap_err(),
        AgentError::Stale
    );
}

#[test]
fn independent_connections_cannot_claim_the_same_revision() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("fixture.sqlite");
    let db = Connection::open(&path).unwrap();
    initialize(&db);
    let mut first = AgentStore::attach(db).unwrap();
    let queued = create(&mut first, RUN, CHAT);
    let mut second = AgentStore::attach(Connection::open(&path).unwrap()).unwrap();
    first.claim(WORKSPACE, &queued, 2).unwrap();
    assert_eq!(
        second.claim(WORKSPACE, &queued, 2).unwrap_err(),
        AgentError::Stale
    );
}

#[test]
fn deleting_conversation_cleans_agent_scope_steps_and_events() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    create(&mut store, RUN, CHAT);
    store
        .connection
        .execute("DELETE FROM ai_conversation WHERE id=?1", [CHAT])
        .unwrap();
    for table in [
        "ai_agent_scope",
        "ai_agent_run",
        "ai_agent_step",
        "ai_agent_event",
    ] {
        let count: u32 = store
            .connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[test]
fn sql_terminal_and_budget_invariants_cannot_be_bypassed() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let queued = create(&mut store, RUN, CHAT);
    let running = store.claim(WORKSPACE, &queued, 2).unwrap();
    assert!(
        store
            .connection
            .execute(
                "UPDATE ai_agent_run SET input_limit=999999,revision=revision+1",
                []
            )
            .is_err()
    );
    let done = store
        .transition(WORKSPACE, &running, RunState::Completed, 3)
        .unwrap();
    assert!(
        store
            .connection
            .execute(
                "UPDATE ai_agent_run SET state='running',finished_at=NULL,revision=revision+1",
                []
            )
            .is_err()
    );
    assert_eq!(store.get(WORKSPACE, RUN).unwrap().revision, done.revision);
}

#[test]
fn revoked_scope_and_pending_step_prevent_new_dispatch() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let queued = create(&mut store, RUN, CHAT);
    let running = store.claim(WORKSPACE, &queued, 2).unwrap();
    let reserved = store.reserve(WORKSPACE, &running, Charge::Tool, 3).unwrap();
    assert_eq!(
        store
            .reserve(
                WORKSPACE,
                &reserved,
                Charge::Model {
                    input: 1,
                    output: 1
                },
                4
            )
            .unwrap_err(),
        AgentError::Transition
    );
    let done = store
        .finish_step(WORKSPACE, &reserved, reserved.event_sequence, 4)
        .unwrap();
    store
        .connection
        .execute("UPDATE ai_agent_scope SET revoked_at=5", [])
        .unwrap();
    assert_eq!(
        store
            .reserve(WORKSPACE, &done, Charge::Tool, 6)
            .unwrap_err(),
        AgentError::Scope
    );
}

#[test]
fn elapsed_time_boundary_stops_dispatch_without_resetting_counter() {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let queued = create(&mut store, RUN, CHAT);
    let running = store.claim(WORKSPACE, &queued, 2).unwrap();
    let elapsed = store
        .reserve(WORKSPACE, &running, Charge::ActiveMilliseconds(180_000), 3)
        .unwrap();
    assert_eq!(
        store
            .reserve(WORKSPACE, &elapsed, Charge::Tool, 4)
            .unwrap_err(),
        AgentError::Budget
    );
    assert_eq!(store.get(WORKSPACE, RUN).unwrap().used.active_ms, 180_000);
}

fn runtime_fixture(budget: Budget) -> (crate::agent::StoreWorker, RunSnapshot) {
    let mut store = AgentStore::attach(fixture_connection()).unwrap();
    let mut grant = grant();
    grant.pages.push(crate::agent::PageSelection {
        document_id: "doc".into(),
        revision: "v1".into(),
        pages: vec![1],
    });
    let run = store
        .create(
            &NewRun {
                id: RUN,
                workspace: WORKSPACE,
                conversation: CHAT,
                goal: "q",
                grant: &grant,
                budget,
                token_policy: TokenPolicy::default(),
            },
            1,
        )
        .unwrap();
    (crate::agent::StoreWorker::new(store).unwrap(), run)
}

struct FakeProvider;
impl crate::agent::Provider for FakeProvider {
    fn input_tokens(
        &self,
        _: &crate::agent::ExecutionContext,
        _: &[serde_json::Value],
    ) -> Result<u32, AgentError> {
        Ok(10)
    }
    async fn request(
        &mut self,
        context: crate::agent::ExecutionContext,
        history: Vec<serde_json::Value>,
        output_limit: u32,
    ) -> Result<crate::agent::ProviderTurn, AgentError> {
        use crate::agent::{ProviderTurn, ReadCall, ReadTool};
        assert_eq!(context.goal, "q");
        assert_eq!(output_limit, self.output_tokens());
        let results = history
            .iter()
            .filter(|item| item["kind"] == "tool_result")
            .count();
        Ok(match results {
            0 | 1 => ProviderTurn::Tool {
                call: ReadCall {
                    id: format!("call{results}"),
                    tool: if results == 0 {
                        ReadTool::SearchLearningResources
                    } else {
                        ReadTool::ReadResourcePages
                    },
                    document_id: "doc".into(),
                    revision: "v1".into(),
                    page: 1,
                    query: None,
                    offset: None,
                    cursor: None,
                    limit: None,
                },
            },
            _ => ProviderTurn::Final {
                message: "verified from fixture".into(),
                source_ids: vec!["doc:v1:1".into()],
            },
        })
    }
}
struct FakeTools;
impl crate::agent::ToolExecutor for FakeTools {
    async fn execute(&mut self, call: crate::agent::ReadCall) -> Result<String, AgentError> {
        assert_eq!(call.document_id, "doc");
        Ok("synthetic evidence".into())
    }
}

#[test]
fn asynchronous_fake_provider_finishes_search_read_answer_with_durable_history() {
    tauri::async_runtime::block_on(async {
        let (worker, run) = runtime_fixture(Budget::default());
        let task = crate::agent::AgentTask::start(
            worker.clone(),
            WORKSPACE.into(),
            run,
            FakeProvider,
            FakeTools,
        )
        .await
        .unwrap();
        let completed = task.wait().await.unwrap();
        assert_eq!(completed.state, RunState::Completed);
        assert_eq!((completed.used.models, completed.used.tools), (3, 2));
        let history = worker.call(|db| db.results(WORKSPACE, RUN)).await.unwrap();
        assert_eq!(history.len(), 5);
        assert_eq!(history[4]["kind"], "final");
    });
}

struct DropSignal(std::sync::Arc<std::sync::atomic::AtomicBool>);
impl Drop for DropSignal {
    fn drop(&mut self) {
        self.0.store(true, std::sync::atomic::Ordering::SeqCst);
    }
}
struct SilentProvider {
    ready: std::sync::Arc<tokio::sync::Notify>,
    dropped: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

#[test]
fn host_owns_driver_after_start_returns_and_cancel_joins_it() {
    tauri::async_runtime::block_on(async {
        let (worker, run) = runtime_fixture(Budget::default());
        let host = crate::agent::AgentHost::new(worker, WORKSPACE.into());
        let ready = std::sync::Arc::new(tokio::sync::Notify::new());
        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        host.start(
            run,
            SilentProvider {
                ready: ready.clone(),
                dropped: dropped.clone(),
            },
            FakeTools,
        )
        .await
        .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), ready.notified())
            .await
            .unwrap();
        assert!(!dropped.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(host.snapshot(RUN).await.unwrap().state, RunState::Running);
        assert_eq!(host.cancel(RUN).await.unwrap().state, RunState::Canceled);
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(host.cancel(RUN).await.unwrap().state, RunState::Canceled);
        assert!(!host.events(RUN, 0).await.unwrap().is_empty());
    });
}

#[test]
fn host_refuses_foreign_runs_and_unowned_active_cleanup() {
    tauri::async_runtime::block_on(async {
        let (worker, run) = runtime_fixture(Budget::default());
        let owned = crate::agent::AgentHost::new(worker.clone(), WORKSPACE.into());
        let foreign = crate::agent::AgentHost::new(worker.clone(), "foreign".into());
        assert_eq!(foreign.snapshot(RUN).await.unwrap_err(), AgentError::Scope);
        assert_eq!(foreign.cancel(RUN).await.unwrap_err(), AgentError::Scope);
        worker
            .call(move |db| db.claim(WORKSPACE, &run, 2))
            .await
            .unwrap();
        assert_eq!(owned.cancel(RUN).await.unwrap_err(), AgentError::Busy);
        assert_eq!(owned.snapshot(RUN).await.unwrap().state, RunState::Running);
    });
}

#[test]
fn canceling_recovered_or_waiting_runs_releases_the_conversation_for_a_new_run() {
    for next in [RunState::Interrupted, RunState::WaitingForInput] {
        tauri::async_runtime::block_on(async {
            let (worker, run) = runtime_fixture(Budget::default());
            worker
                .call(move |db| {
                    let running = db.claim(WORKSPACE, &run, 2)?;
                    db.transition(WORKSPACE, &running, next, 3)
                })
                .await
                .unwrap();
            let host = crate::agent::AgentHost::new(worker.clone(), WORKSPACE.into());
            assert_eq!(host.cancel(RUN).await.unwrap().state, RunState::Canceled);
            let new = worker.call(|db| Ok(create(db, RUN2, CHAT))).await.unwrap();
            assert_eq!(new.state, RunState::Queued);
        });
    }
}

#[test]
fn host_cancellation_finishes_when_command_listener_disappears() {
    tauri::async_runtime::block_on(async {
        let (worker, run) = runtime_fixture(Budget::default());
        let host = crate::agent::AgentHost::new(worker, WORKSPACE.into());
        let ready = std::sync::Arc::new(tokio::sync::Notify::new());
        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        host.start(
            run,
            SilentProvider {
                ready: ready.clone(),
                dropped: dropped.clone(),
            },
            FakeTools,
        )
        .await
        .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), ready.notified())
            .await
            .unwrap();
        {
            use std::future::Future;
            let mut cancel = std::pin::pin!(host.cancel(RUN));
            std::future::poll_fn(|cx| {
                let _ = cancel.as_mut().poll(cx);
                std::task::Poll::Ready(())
            })
            .await;
        }
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if host.snapshot(RUN).await.unwrap().state == RunState::Canceled {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
    });
}
impl crate::agent::Provider for SilentProvider {
    fn input_tokens(
        &self,
        _: &crate::agent::ExecutionContext,
        _: &[serde_json::Value],
    ) -> Result<u32, AgentError> {
        Ok(10)
    }
    async fn request(
        &mut self,
        _: crate::agent::ExecutionContext,
        _: Vec<serde_json::Value>,
        _: u32,
    ) -> Result<crate::agent::ProviderTurn, AgentError> {
        let _drop = DropSignal(self.dropped.clone());
        self.ready.notify_one();
        std::future::pending().await
    }
}

#[test]
fn cancellation_joins_and_drops_silent_provider_before_canceled_state() {
    tauri::async_runtime::block_on(async {
        let (worker, run) = runtime_fixture(Budget::default());
        let ready = std::sync::Arc::new(tokio::sync::Notify::new());
        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task = crate::agent::AgentTask::start(
            worker.clone(),
            WORKSPACE.into(),
            run,
            SilentProvider {
                ready: ready.clone(),
                dropped: dropped.clone(),
            },
            FakeTools,
        )
        .await
        .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), ready.notified())
            .await
            .unwrap();
        let canceled = task.cancel().await.unwrap();
        assert_eq!(canceled.state, RunState::Canceled);
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(canceled.used.models, 1);
        assert!(
            worker
                .call(|db| db.results(WORKSPACE, RUN))
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn silent_provider_is_bounded_by_active_timeout_without_user_cancel() {
    tauri::async_runtime::block_on(async {
        let (worker, run) = runtime_fixture(Budget {
            active_ms: 20,
            ..Budget::default()
        });
        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task = crate::agent::AgentTask::start(
            worker.clone(),
            WORKSPACE.into(),
            run,
            SilentProvider {
                ready: std::sync::Arc::new(tokio::sync::Notify::new()),
                dropped: dropped.clone(),
            },
            FakeTools,
        )
        .await
        .unwrap();
        assert_eq!(task.wait().await.unwrap_err(), AgentError::Budget);
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
        let failed = worker.call(|db| db.get(WORKSPACE, RUN)).await.unwrap();
        assert_eq!(failed.state, RunState::Failed);
        assert_eq!(failed.error_code.as_deref(), Some("AGENT_BUDGET_EXHAUSTED"));
    });
}

#[test]
fn semantic_resume_consumes_committed_call_before_new_model_request() {
    tauri::async_runtime::block_on(async {
        let (worker, queued) = runtime_fixture(Budget::default());
        let interrupted=worker.call(move|db|{
            let running=db.claim(WORKSPACE,&queued,2)?;
            let reserved=db.reserve(WORKSPACE,&running,Charge::Model{input:10,output:512},3)?;
            let turn=json!({"kind":"tool","call":{"id":"call0","tool":"search_learning_resources","documentId":"doc","revision":"v1","page":1}});
            let completed=db.finish_step_result(WORKSPACE,&reserved,reserved.event_sequence,&turn,4)?;
            let tool=db.reserve(WORKSPACE,&completed,Charge::Tool,5)?;
            db.transition(WORKSPACE,&tool,RunState::Interrupted,6)
        }).await.unwrap();
        let task = crate::agent::AgentTask::start(
            worker.clone(),
            WORKSPACE.into(),
            interrupted,
            FakeProvider,
            FakeTools,
        )
        .await
        .unwrap();
        let done = task.wait().await.unwrap();
        assert_eq!(done.state, RunState::Completed);
        assert_eq!((done.used.models, done.used.tools), (3, 3));
    });
}

#[test]
fn dropping_wait_future_does_not_detach_the_provider_task() {
    tauri::async_runtime::block_on(async {
        let (worker, run) = runtime_fixture(Budget::default());
        let ready = std::sync::Arc::new(tokio::sync::Notify::new());
        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task = crate::agent::AgentTask::start(
            worker,
            WORKSPACE.into(),
            run,
            SilentProvider {
                ready: ready.clone(),
                dropped: dropped.clone(),
            },
            FakeTools,
        )
        .await
        .unwrap();
        let waiter = tokio::spawn(task.wait());
        tokio::time::timeout(std::time::Duration::from_secs(2), ready.notified())
            .await
            .unwrap();
        waiter.abort();
        let _ = waiter.await;
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !dropped.load(std::sync::atomic::Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Provider task must not detach from its owner");
    });
}
