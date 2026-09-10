use super::AgentError;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

/// Shared by ordinary chat and Agent dispatch in the same application workspace.
#[derive(Clone, Default)]
pub(crate) struct ConversationGate(Arc<Mutex<HashSet<String>>>);

pub(crate) struct ConversationLease {
    gate: ConversationGate,
    conversation: String,
}

impl ConversationGate {
    pub fn acquire(&self, conversation: &str) -> Result<ConversationLease, AgentError> {
        let mut active = self.0.lock().map_err(|_| AgentError::Store)?;
        if !active.insert(conversation.into()) {
            return Err(AgentError::Busy);
        }
        Ok(ConversationLease {
            gate: self.clone(),
            conversation: conversation.into(),
        })
    }
}

impl Drop for ConversationLease {
    fn drop(&mut self) {
        if let Ok(mut active) = self.gate.0.lock() {
            active.remove(&self.conversation);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chat_and_agent_leases_exclude_each_other_until_actual_release() {
        let gate = ConversationGate::default();
        let lease = gate.acquire("chat").unwrap();
        assert!(matches!(gate.acquire("chat"), Err(AgentError::Busy)));
        assert!(gate.acquire("different").is_ok());
        drop(lease);
        assert!(gate.acquire("chat").is_ok());
    }
}
