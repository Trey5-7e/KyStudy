use super::{AgentError, Budget, Charge, Grant, RunSnapshot, RunState, TokenPolicy};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::Serialize;
use serde_json::json;

mod followup;
mod resources;
mod search;
pub(crate) use resources::{PageRequest, ProviderSelection};

/// Host inputs for a new Run, bound to an existing chat conversation.
pub struct NewRun<'a> {
    /// Host-generated UUID for the Run.
    pub id: &'a str,
    /// Current workspace ID, never supplied by the model.
    pub workspace: &'a str,
    /// Existing chat conversation ID in that workspace.
    pub conversation: &'a str,
    /// User's bounded goal.
    pub goal: &'a str,
    /// Host-resolved immutable source and Provider snapshot.
    pub grant: &'a Grant,
    /// User-visible limits for this new Run.
    pub budget: Budget,
    /// Explicit token policy. New application runs should use the default observation mode.
    pub token_policy: TokenPolicy,
}

/// Committed event for cursor-based replay. No reasoning or credentials belong here.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// Monotonic sequence within this Run.
    pub sequence: u32,
    /// Stable event category.
    pub kind: String,
    /// Bounded public snapshot JSON.
    pub payload: String,
}

/// Transactional `SQLite` adapter for schema 31; never creates or migrates databases.
pub struct AgentStore {
    connection: Connection,
}

impl AgentStore {
    /// Called only after the application obtains the exclusive process ownership file lock.
    pub(crate) fn interrupt_orphans(
        &mut self,
        workspace: &str,
        now: i64,
    ) -> Result<(), AgentError> {
        let ids: Vec<String> = self
            .connection
            .prepare("SELECT id FROM ai_agent_run WHERE workspace_id=?1 AND state='running'")
            .map_err(storage)?
            .query_map([workspace], |row| row.get(0))
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)?;
        for id in ids {
            let run = self.get(workspace, &id)?;
            self.transition(workspace, &run, RunState::Interrupted, now)?;
        }
        Ok(())
    }
    /// Takes a Host-owned, already migrated connection. Does not access the filesystem.
    ///
    /// # Errors
    /// Returns a storage error if foreign keys or bounded lock waiting cannot be enabled.
    pub fn attach(connection: Connection) -> Result<Self, AgentError> {
        connection
            .pragma_update(None, "foreign_keys", true)
            .map_err(storage)?;
        connection
            .busy_timeout(std::time::Duration::from_secs(2))
            .map_err(storage)?;
        Ok(Self { connection })
    }

    /// Atomically creates Grant, queued Run and initial event. Does not start a task.
    ///
    /// # Errors
    /// Rejects invalid IDs/limits, non-chat or foreign conversations, and concurrent live Runs.
    pub fn create(&mut self, input: &NewRun<'_>, now: i64) -> Result<RunSnapshot, AgentError> {
        input.budget.validate()?;
        if input.token_policy != TokenPolicy::Observe
            && (input.budget.input == 0 || input.budget.output == 0)
        {
            return Err(AgentError::Invalid);
        }
        input.grant.validate()?;
        if [input.id, input.workspace, input.conversation]
            .iter()
            .any(|id| uuid::Uuid::parse_str(id).is_err())
            || input.goal.trim().is_empty()
            || input.goal.len() > 8192
        {
            return Err(AgentError::Invalid);
        }
        let grant = serde_json::to_string(input.grant).map_err(|_| AgentError::Invalid)?;
        if grant.len() > 65_536 {
            return Err(AgentError::Invalid);
        }
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let chat:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM ai_conversation WHERE id=?1 AND workspace_id=?2 AND conversation_kind='chat')",params![input.conversation,input.workspace],|row|row.get(0)).map_err(storage)?;
        if !chat {
            return Err(AgentError::Scope);
        }
        let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM ai_agent_run WHERE conversation_id=?1 AND state NOT IN ('completed','failed','canceled'))",[input.conversation],|row|row.get(0)).map_err(storage)?;
        if busy {
            return Err(AgentError::Busy);
        }
        let scope = uuid::Uuid::now_v7().to_string();
        tx.execute(
            "INSERT INTO ai_agent_scope(id,workspace_id,grant_json) VALUES (?1,?2,?3)",
            params![scope, input.workspace, grant],
        )
        .map_err(storage)?;
        tx.execute("INSERT INTO ai_agent_run(id,workspace_id,conversation_id,scope_id,state,goal,model_limit,tool_limit,input_limit,output_limit,active_limit_ms,event_sequence,created_at,updated_at,token_policy) VALUES (?1,?2,?3,?4,'queued',?5,?6,?7,?8,?9,?10,1,?11,?11,?12)",params![input.id,input.workspace,input.conversation,scope,input.goal,input.budget.models,input.budget.tools,input.budget.input,input.budget.output,input.budget.active_ms,now,input.token_policy.as_str()]).map_err(storage)?;
        let run = load(&tx, input.workspace, input.id)?;
        event(&tx, &run, "queued", now)?;
        tx.commit().map_err(storage)?;
        Ok(run)
    }

    /// Reads one snapshot with mandatory workspace isolation.
    ///
    /// # Errors
    /// Returns Scope when absent or foreign; storage failures remain sanitized.
    pub fn get(&self, workspace: &str, id: &str) -> Result<RunSnapshot, AgentError> {
        load(&self.connection, workspace, id)
    }

    pub(crate) fn latest(
        &self,
        workspace: &str,
        conversation: &str,
    ) -> Result<Option<RunSnapshot>, AgentError> {
        let id:Option<String>=self.connection.query_row("SELECT id FROM ai_agent_run WHERE workspace_id=?1 AND conversation_id=?2 ORDER BY created_at DESC,id DESC LIMIT 1",params![workspace,conversation],|row|row.get(0)).optional().map_err(storage)?;
        id.map(|id| self.get(workspace, &id)).transpose()
    }

    /// Claims a queued/interrupted Run after Host source and Provider revalidation.
    ///
    /// # Errors
    /// Rejects cancellation, stale revisions, revoked scopes and a busy workspace.
    pub fn claim(
        &mut self,
        workspace: &str,
        lease: &RunSnapshot,
        now: i64,
    ) -> Result<RunSnapshot, AgentError> {
        self.mutate(workspace,lease,"running",now,|tx,run|{
            if run.cancel_requested || !matches!(run.state,RunState::Queued|RunState::Interrupted) {return Err(AgentError::Transition);}
            let revoked:bool=tx.query_row("SELECT s.revoked_at IS NOT NULL FROM ai_agent_scope s JOIN ai_agent_run r ON r.scope_id=s.id WHERE r.id=?1",[&run.id],|row|row.get(0)).map_err(storage)?;
            if revoked {return Err(AgentError::Scope);}
            let busy:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM ai_agent_run WHERE workspace_id=?1 AND state='running')",[workspace],|row|row.get(0)).map_err(storage)?;
            if busy {return Err(AgentError::Busy);}
            run.state=RunState::Running;
            run.owner_epoch=run.owner_epoch.checked_add(1).ok_or(AgentError::Stale)?;
            Ok(())
        })
    }

    /// Atomically precharges a dispatch attempt and inserts a reserved step before returning.
    ///
    /// # Errors
    /// Rejects stale/canceled owners and overflow. Exhaustion atomically fails the Run.
    pub fn reserve(
        &mut self,
        workspace: &str,
        lease: &RunSnapshot,
        charge: Charge,
        now: i64,
    ) -> Result<RunSnapshot, AgentError> {
        let result=self.mutate(workspace,lease,"budget_reserved",now,|tx,run|{
            if run.state!=RunState::Running || run.cancel_requested {return Err(AgentError::Stale);}
            if matches!(charge,Charge::Model{output:0,..}) {return Err(AgentError::Invalid);}
            let revoked:bool=tx.query_row("SELECT s.revoked_at IS NOT NULL FROM ai_agent_scope s JOIN ai_agent_run r ON r.scope_id=s.id WHERE r.id=?1",[&run.id],|row|row.get(0)).map_err(storage)?;
            if revoked {return Err(AgentError::Scope);}
            if charge.kind().is_some() {
                let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM ai_agent_step WHERE run_id=?1 AND state='reserved')",[&run.id],|row|row.get(0)).map_err(storage)?;
                if pending {return Err(AgentError::Transition);}
                if run.used.active_ms>=run.limit.active_ms {run.state=RunState::Failed;return Ok(());}
            }
            let Ok(used)=run.used.add(charge.budget(),run.limit,run.token_policy) else {run.state=RunState::Failed;return Ok(());};
            run.used=used;
            if let Some(kind)=charge.kind() {
                let sequence=run.event_sequence.checked_add(1).ok_or(AgentError::Stale)?;
                tx.execute("INSERT INTO ai_agent_step(run_id,sequence,kind,state,owner_epoch) VALUES (?1,?2,?3,'reserved',?4)",params![run.id,sequence,kind,run.owner_epoch]).map_err(storage)?;
            }
            Ok(())
        })?;
        if result.state == RunState::Failed {
            Err(AgentError::Budget)
        } else {
            Ok(result)
        }
    }

    /// Records durable cancellation intent; active transport cleanup must precede Canceled.
    ///
    /// # Errors
    /// Stale revisions fail. Already terminal snapshots are returned unchanged.
    pub fn request_cancel(
        &mut self,
        workspace: &str,
        lease: &RunSnapshot,
        now: i64,
    ) -> Result<RunSnapshot, AgentError> {
        let run = self.get(workspace, &lease.id)?;
        if run.state.is_terminal() {
            return Ok(run);
        }
        self.mutate(workspace, lease, "cancel_requested", now, |_, run| {
            run.cancel_requested = true;
            if run.state == RunState::Queued {
                run.state = RunState::Canceled;
            }
            Ok(())
        })
    }

    /// Completes a state transition after the owner has finished relevant cleanup/receipts.
    ///
    /// # Errors
    /// Invalid transitions, stale tasks and completion after cancellation are rejected.
    pub fn transition(
        &mut self,
        workspace: &str,
        lease: &RunSnapshot,
        next: RunState,
        now: i64,
    ) -> Result<RunSnapshot, AgentError> {
        if next == RunState::Running {
            return Err(AgentError::Transition);
        }
        self.mutate(workspace,lease,state_name(next),now,|tx,run|{
            if !run.state.allows(next) || (run.cancel_requested && next!=RunState::Canceled && next!=RunState::Interrupted) {return Err(AgentError::Transition);}
            let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM ai_agent_step WHERE run_id=?1 AND state='reserved')",[&run.id],|row|row.get(0)).map_err(storage)?;
            if pending && next==RunState::Completed {return Err(AgentError::Transition);}
            if matches!(next,RunState::Interrupted|RunState::Canceled|RunState::Failed) {
                tx.execute("UPDATE ai_agent_step SET state='interrupted' WHERE run_id=?1 AND state='reserved'",[&run.id]).map_err(storage)?;
                run.owner_epoch=run.owner_epoch.checked_add(1).ok_or(AgentError::Stale)?;
            }
            run.state=next;Ok(())
        })
    }

    /// Fails the active owner with a stable error code and invalidates reserved steps.
    ///
    /// # Errors
    /// Rejects stale owners and a cancellation that won the race.
    pub fn fail(
        &mut self,
        workspace: &str,
        lease: &RunSnapshot,
        error: AgentError,
        now: i64,
    ) -> Result<RunSnapshot, AgentError> {
        self.mutate(workspace, lease, "failed", now, |tx, run| {
            if run.state != RunState::Running || run.cancel_requested {
                return Err(AgentError::Stale);
            }
            run.state = RunState::Failed;
            run.error_code = Some(error.to_string());
            run.owner_epoch = run.owner_epoch.checked_add(1).ok_or(AgentError::Stale)?;
            tx.execute(
                "UPDATE ai_agent_step SET state='interrupted' WHERE run_id=?1 AND state='reserved'",
                [&run.id],
            )
            .map_err(storage)?;
            Ok(())
        })
    }

    /// Finishes a reserved dispatch without a public result under the same owner.
    ///
    /// # Errors
    /// Rejects missing steps, stale epochs, and cancellation racing a result.
    pub fn finish_step(
        &mut self,
        workspace: &str,
        lease: &RunSnapshot,
        sequence: u32,
        now: i64,
    ) -> Result<RunSnapshot, AgentError> {
        self.finish_step_result(workspace, lease, sequence, &serde_json::Value::Null, now)
    }

    /// Atomically persists a bounded step result and event under the active owner.
    ///
    /// # Errors
    /// Rejects oversized results, canceled owners and missing/previously completed steps.
    pub fn finish_step_result(
        &mut self,
        workspace: &str,
        lease: &RunSnapshot,
        sequence: u32,
        result: &serde_json::Value,
        now: i64,
    ) -> Result<RunSnapshot, AgentError> {
        let encoded = serde_json::to_string(result).map_err(|_| AgentError::Protocol)?;
        if encoded.len() > 16_384 {
            return Err(AgentError::Invalid);
        }
        self.mutate(workspace,lease,"step_completed",now,|tx,run|{
            if run.state!=RunState::Running || run.cancel_requested {return Err(AgentError::Stale);}
            let count=tx.execute("UPDATE ai_agent_step SET state='completed',result_json=?4 WHERE run_id=?1 AND sequence=?2 AND owner_epoch=?3 AND state='reserved'",params![run.id,sequence,run.owner_epoch,encoded]).map_err(storage)?;
            if count!=1 {return Err(AgentError::Stale);}Ok(())
        })
    }

    /// Retrieves the Host context for dispatch, refusing revoked grants.
    ///
    /// # Errors
    /// Rejects foreign runs, revoked authorization and corrupt stored grants.
    pub fn context(
        &self,
        workspace: &str,
        id: &str,
    ) -> Result<super::ExecutionContext, AgentError> {
        self.get(workspace, id)?;
        let (goal,raw,owner_epoch):(String,String,u32)=self.connection.query_row("SELECT r.goal,s.grant_json,r.owner_epoch FROM ai_agent_run r JOIN ai_agent_scope s ON s.id=r.scope_id WHERE r.id=?1 AND s.workspace_id=?2 AND s.revoked_at IS NULL",params![id,workspace],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(storage)?.ok_or(AgentError::Scope)?;
        let grant: Grant = serde_json::from_str(&raw).map_err(|_| AgentError::Store)?;
        grant.validate()?;
        Ok(super::ExecutionContext {
            owner_epoch,
            goal,
            grant,
        })
    }

    /// Returns durable completed step results for semantic resume, never private protocol state.
    ///
    /// # Errors
    /// Rejects foreign runs or invalid stored JSON.
    pub fn results(&self, workspace: &str, id: &str) -> Result<Vec<serde_json::Value>, AgentError> {
        self.get(workspace, id)?;
        let mut query=self.connection.prepare("SELECT result_json FROM ai_agent_step WHERE run_id=?1 AND state='completed' AND result_json IS NOT NULL ORDER BY sequence LIMIT 32").map_err(storage)?;
        let strings: Vec<String> = query
            .query_map([id], |row| row.get(0))
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)?;
        strings
            .iter()
            .map(|raw| serde_json::from_str(raw).map_err(|_| AgentError::Store))
            .collect()
    }

    /// Replays at most 100 committed events strictly after the cursor.
    ///
    /// # Errors
    /// Foreign Run IDs are rejected; storage failures never expose raw SQL.
    pub fn events(&self, workspace: &str, id: &str, after: u32) -> Result<Vec<Event>, AgentError> {
        self.get(workspace, id)?;
        let mut query=self.connection.prepare("SELECT sequence,type,payload FROM ai_agent_event WHERE run_id=?1 AND sequence>?2 ORDER BY sequence LIMIT 100").map_err(storage)?;
        query
            .query_map(params![id, after], |row| {
                Ok(Event {
                    sequence: row.get(0)?,
                    kind: row.get(1)?,
                    payload: row.get(2)?,
                })
            })
            .map_err(storage)?
            .collect::<Result<_, _>>()
            .map_err(storage)
    }

    fn mutate(
        &mut self,
        workspace: &str,
        lease: &RunSnapshot,
        kind: &str,
        now: i64,
        change: impl FnOnce(&Transaction<'_>, &mut RunSnapshot) -> Result<(), AgentError>,
    ) -> Result<RunSnapshot, AgentError> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let mut run = load(&tx, workspace, &lease.id)?;
        if run.revision != lease.revision
            || run.owner_epoch != lease.owner_epoch
            || run.state.is_terminal()
        {
            return Err(AgentError::Stale);
        }
        change(&tx, &mut run)?;
        run.revision = run.revision.checked_add(1).ok_or(AgentError::Stale)?;
        run.event_sequence = run.event_sequence.checked_add(1).ok_or(AgentError::Stale)?;
        let error = (kind == "budget_reserved" && run.state == RunState::Failed)
            .then_some("AGENT_BUDGET_EXHAUSTED");
        if let Some(code) = error {
            run.error_code = Some(code.into());
            run.owner_epoch = run.owner_epoch.checked_add(1).ok_or(AgentError::Stale)?;
            tx.execute(
                "UPDATE ai_agent_step SET state='interrupted' WHERE run_id=?1 AND state='reserved'",
                [&run.id],
            )
            .map_err(storage)?;
        }
        if run.state == RunState::Failed && run.error_code.is_none() {
            run.error_code = Some(AgentError::Protocol.to_string());
        }
        tx.execute("UPDATE ai_agent_run SET state=?1,revision=?2,owner_epoch=?3,model_used=?4,tool_used=?5,input_used=?6,output_used=?7,active_elapsed_ms=?8,event_sequence=?9,cancel_requested_at=CASE WHEN ?10 THEN COALESCE(cancel_requested_at,?11) ELSE cancel_requested_at END,updated_at=?11,finished_at=?12,error_code=?13 WHERE id=?14 AND revision=?15",params![state_name(run.state),run.revision,run.owner_epoch,run.used.models,run.used.tools,run.used.input,run.used.output,run.used.active_ms,run.event_sequence,run.cancel_requested,now,run.state.is_terminal().then_some(now),run.error_code,run.id,lease.revision]).map_err(storage)?;
        event(
            &tx,
            &run,
            if error.is_some() {
                "budget_exhausted"
            } else {
                kind
            },
            now,
        )?;
        tx.commit().map_err(storage)?;
        Ok(run)
    }
}

fn load(db: &Connection, workspace: &str, id: &str) -> Result<RunSnapshot, AgentError> {
    db.query_row("SELECT id,state,revision,owner_epoch,model_limit,tool_limit,input_limit,output_limit,active_limit_ms,model_used,tool_used,input_used,output_used,active_elapsed_ms,event_sequence,cancel_requested_at IS NOT NULL,error_code,token_policy FROM ai_agent_run WHERE id=?1 AND workspace_id=?2",params![id,workspace],|row|{
        let state:String=row.get(1)?;
        let state=serde_json::from_value(json!(state)).map_err(|err|rusqlite::Error::FromSqlConversionFailure(1,rusqlite::types::Type::Text,Box::new(err)))?;
        let policy:String=row.get(17)?;
        let token_policy=serde_json::from_value(json!(policy)).map_err(|err|rusqlite::Error::FromSqlConversionFailure(17,rusqlite::types::Type::Text,Box::new(err)))?;
        Ok(RunSnapshot{id:row.get(0)?,state,revision:row.get(2)?,owner_epoch:row.get(3)?,token_policy,limit:Budget{models:row.get(4)?,tools:row.get(5)?,input:row.get(6)?,output:row.get(7)?,active_ms:row.get(8)?},used:Budget{models:row.get(9)?,tools:row.get(10)?,input:row.get(11)?,output:row.get(12)?,active_ms:row.get(13)?},event_sequence:row.get(14)?,cancel_requested:row.get(15)?,error_code:row.get(16)?})
    }).optional().map_err(storage)?.ok_or(AgentError::Scope)
}

fn event(tx: &Transaction<'_>, run: &RunSnapshot, kind: &str, now: i64) -> Result<(), AgentError> {
    let payload = serde_json::to_string(run).map_err(|_| AgentError::Store)?;
    tx.execute("INSERT INTO ai_agent_event(run_id,sequence,type,payload,created_at) VALUES (?1,?2,?3,?4,?5)",params![run.id,run.event_sequence,kind,payload,now]).map_err(storage)?;
    Ok(())
}

fn state_name(state: RunState) -> &'static str {
    match state {
        RunState::Queued => "queued",
        RunState::Running => "running",
        RunState::WaitingForInput => "waiting_for_input",
        RunState::WaitingForApproval => "waiting_for_approval",
        RunState::WaitingForHandoff => "waiting_for_handoff",
        RunState::Interrupted => "interrupted",
        RunState::Completed => "completed",
        RunState::Failed => "failed",
        RunState::Canceled => "canceled",
    }
}

fn storage(_: rusqlite::Error) -> AgentError {
    AgentError::Store
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
