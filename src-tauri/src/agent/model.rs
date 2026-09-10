use serde::{Deserialize, Serialize};

/// Stable errors safe to expose without database or credential details.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AgentError {
    /// The selected source or index revision changed after authorization.
    #[error("AGENT_SOURCE_STALE")]
    SourceStale,
    /// Text must be indexed explicitly before the Agent can use it.
    #[error("AGENT_INDEX_NOT_READY")]
    IndexNotReady,
    /// The selected Provider/model is outside the admitted initial combination.
    #[error("AGENT_TOOLS_UNSUPPORTED")]
    Unsupported,
    /// Provider output is invalid or cannot be continued safely.
    #[error("AGENT_PROVIDER_PROTOCOL_ERROR")]
    Protocol,
    /// Invalid or oversized Host input.
    #[error("AGENT_INVALID_ARGUMENTS")]
    Invalid,
    /// Workspace, conversation, grant or source authorization is invalid.
    #[error("AGENT_SCOPE_DENIED")]
    Scope,
    /// Revision or execution ownership no longer matches.
    #[error("AGENT_STALE_OWNER")]
    Stale,
    /// Another run owns the workspace or conversation.
    #[error("AGENT_WORKSPACE_BUSY")]
    Busy,
    /// Hard dispatch budget is exhausted.
    #[error("AGENT_BUDGET_EXHAUSTED")]
    Budget,
    /// Invalid lifecycle transition.
    #[error("AGENT_INVALID_TRANSITION")]
    Transition,
    /// Sanitized persistence failure.
    #[error("AGENT_STORE_ERROR")]
    Store,
}

/// Complete Run lifecycle; terminal states have no legal successors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    /// Explicitly started, not automatically dispatched.
    Queued,
    /// Holds the workspace execution slot.
    Running,
    /// Awaiting a bound user answer.
    WaitingForInput,
    /// Awaiting a bound approval decision.
    WaitingForApproval,
    /// Awaiting draft handoff acknowledgement.
    WaitingForHandoff,
    /// Owner lost or explicit interruption; never resumes automatically.
    Interrupted,
    /// Successfully finished.
    Completed,
    /// Failed without discarding prior evidence.
    Failed,
    /// Canceled after local task cleanup.
    Canceled,
}

impl RunState {
    /// Whether further execution is permanently forbidden.
    #[must_use]
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Canceled)
    }
    /// Validates the plan's state transition graph.
    #[must_use]
    pub fn allows(self, next: Self) -> bool {
        use RunState::{
            Canceled, Completed, Failed, Interrupted, Queued, Running, WaitingForApproval,
            WaitingForHandoff, WaitingForInput,
        };
        match self {
            Queued => matches!(next, Running | Canceled),
            Running => matches!(
                next,
                WaitingForInput
                    | WaitingForApproval
                    | WaitingForHandoff
                    | Interrupted
                    | Completed
                    | Failed
                    | Canceled
            ),
            WaitingForInput | WaitingForApproval | Interrupted => {
                matches!(next, Running | Canceled | Failed)
            }
            WaitingForHandoff => matches!(next, Running | Interrupted | Canceled | Failed),
            Completed | Failed | Canceled => false,
        }
    }
}

/// Host-resolved document revision and selected page numbers; empty means none.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageSelection {
    /// Authorized document ID.
    pub document_id: String,
    /// Immutable source revision.
    pub revision: String,
    /// Explicit positive pages; no implicit whole-document expansion.
    pub pages: Vec<u32>,
}

/// Immutable Host authorization, not a model-generated tool argument.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Grant {
    /// ID of the user-selected Provider configuration.
    pub provider_id: String,
    /// Configuration fingerprint, checked again by the eventual Adapter.
    pub provider_revision: String,
    /// Exact selected model, with no silent fallback.
    pub model: String,
    /// Authorized document pages and versions.
    pub pages: Vec<PageSelection>,
}

impl Grant {
    pub(super) fn validate(&self) -> Result<(), AgentError> {
        if [&self.provider_id, &self.provider_revision, &self.model]
            .iter()
            .any(|s| s.is_empty() || s.len() > 256)
            || self.pages.len() > 100
        {
            return Err(AgentError::Invalid);
        }
        for page in &self.pages {
            if page.document_id.is_empty()
                || page.document_id.len() > 128
                || page.revision.is_empty()
                || page.revision.len() > 128
                || page.pages.len() > 24
                || page.pages.contains(&0)
            {
                return Err(AgentError::Invalid);
            }
        }
        Ok(())
    }
}

/// User-selected cumulative token behavior; independent of loop/time protection.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenPolicy {
    /// Account for usage without imposing cumulative token limits.
    #[default]
    Observe,
    /// Expose threshold status without stopping dispatch.
    Warn,
    /// Stop before exceeding explicitly selected input/output thresholds.
    Enforce,
}

impl TokenPolicy {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Observe => "observe",
            Self::Warn => "warn",
            Self::Enforce => "enforce",
        }
    }
}

/// Cumulative dispatch limits or counters; token thresholds apply only to selected policies.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Budget {
    /// Model requests including retries and summary.
    pub models: u32,
    /// Tool attempts including rejected and cached attempts.
    pub tools: u32,
    /// Input threshold (zero when unset), or reserved input usage when used as a counter.
    pub input: u32,
    /// Output threshold (zero when unset), or reserved output usage when used as a counter.
    pub output: u32,
    /// Active monotonic elapsed milliseconds; excludes waiting time.
    pub active_ms: u32,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            models: 6,
            tools: 8,
            input: 0,
            output: 0,
            active_ms: 180_000,
        }
    }
}

impl Budget {
    pub(super) fn zero() -> Self {
        Self {
            models: 0,
            tools: 0,
            input: 0,
            output: 0,
            active_ms: 0,
        }
    }
    pub(super) fn validate(self) -> Result<(), AgentError> {
        if self.models == 0
            || self.models > 8
            || self.tools == 0
            || self.tools > 12
            || self.active_ms == 0
            || self.active_ms > 300_000
        {
            return Err(AgentError::Invalid);
        }
        Ok(())
    }
    pub(super) fn add(
        self,
        charge: Self,
        limit: Self,
        policy: TokenPolicy,
    ) -> Result<Self, AgentError> {
        let add = |a: u32, b: u32, max: u32| {
            a.checked_add(b)
                .filter(|sum| *sum <= max)
                .ok_or(AgentError::Budget)
        };
        Ok(Self {
            models: add(self.models, charge.models, limit.models)?,
            tools: add(self.tools, charge.tools, limit.tools)?,
            input: add(
                self.input,
                charge.input,
                if policy == TokenPolicy::Enforce {
                    limit.input
                } else {
                    u32::MAX
                },
            )?,
            output: add(
                self.output,
                charge.output,
                if policy == TokenPolicy::Enforce {
                    limit.output
                } else {
                    u32::MAX
                },
            )?,
            active_ms: add(self.active_ms, charge.active_ms, limit.active_ms)?,
        })
    }
}

/// Intent that is durably charged before any external dispatch.
#[derive(Debug, Clone, Copy)]
pub enum Charge {
    /// A model call with preflight input estimate and bounded output allowance.
    Model {
        /// Input token estimate.
        input: u32,
        /// Maximum output tokens for this request.
        output: u32,
    },
    /// One tool attempt; this does not grant permission to execute it.
    Tool,
    /// Increment from a monotonic clock, never wall-clock subtraction.
    ActiveMilliseconds(u32),
}

impl Charge {
    pub(super) fn budget(self) -> Budget {
        let mut budget = Budget::zero();
        match self {
            Self::Model { input, output } => {
                budget.models = 1;
                budget.input = input;
                budget.output = output;
            }
            Self::Tool => budget.tools = 1,
            Self::ActiveMilliseconds(ms) => budget.active_ms = ms,
        }
        budget
    }
    pub(super) fn kind(self) -> Option<&'static str> {
        match self {
            Self::Model { .. } => Some("model"),
            Self::Tool => Some("tool"),
            Self::ActiveMilliseconds(_) => None,
        }
    }
}

/// Read-only persisted Run snapshot used as the revision/epoch lease.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSnapshot {
    /// Run ID.
    pub id: String,
    /// Current lifecycle state.
    pub state: RunState,
    /// Monotonic optimistic concurrency revision.
    pub revision: u32,
    /// Execution epoch; stale task completions must never publish.
    pub owner_epoch: u32,
    /// Immutable per-run limits.
    pub limit: Budget,
    /// Immutable user-selected token policy, defaulting to observation for new runs.
    pub token_policy: TokenPolicy,
    /// Counters preserved across interruption and resume.
    pub used: Budget,
    /// Last committed event sequence.
    pub event_sequence: u32,
    /// Durable cancellation request; dispatch is forbidden once true.
    pub cancel_requested: bool,
    /// Stable failure code, present only for a failed Run.
    pub error_code: Option<String>,
}

impl RunSnapshot {
    /// Whether a non-blocking token warning should be shown.
    #[must_use]
    pub fn token_warning(&self) -> bool {
        self.token_policy == TokenPolicy::Warn
            && (self.used.input >= self.limit.input || self.used.output >= self.limit.output)
    }
}
