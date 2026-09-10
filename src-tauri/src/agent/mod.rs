//! Host-only learning Agent kernel. No commands or model tools are registered here.
//!
//! The caller supplies a workspace database already migrated by the application.
//! All mutations are short synchronous transactions; execute them on a bounded
//! blocking executor, never hold a transaction while awaiting a Provider or UI.

mod deepseek;
mod gate;
mod host;
mod model;
mod runtime;
mod store;
pub(crate) use gate::{ConversationGate, ConversationLease};
pub use host::AgentHost;
pub(crate) use host::{AgentRunDetail, AgentSource, StartAgentRun};
pub use model::{
    AgentError, Budget, Charge, Grant, PageSelection, RunSnapshot, RunState, TokenPolicy,
};
pub use runtime::{
    AgentTask, ExecutionContext, Provider, ProviderTurn, ReadCall, ReadTool, StoreWorker,
    ToolExecutor,
};
pub(crate) use store::PageRequest;
pub use store::{AgentStore, Event, NewRun};
