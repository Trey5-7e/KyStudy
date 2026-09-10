-- Executed with foreign keys disabled by the migration runner, inside one transaction.
CREATE TABLE ai_agent_run_v32 (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
    scope_id TEXT NOT NULL UNIQUE REFERENCES ai_agent_scope(id),
    state TEXT NOT NULL CHECK(state IN ('queued','running','waiting_for_input','waiting_for_approval','waiting_for_handoff','interrupted','completed','failed','canceled')),
    goal TEXT NOT NULL CHECK(length(trim(goal)) BETWEEN 1 AND 8192),
    revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
    owner_epoch INTEGER NOT NULL DEFAULT 0 CHECK(owner_epoch >= 0),
    model_limit INTEGER NOT NULL CHECK(model_limit BETWEEN 1 AND 8),
    tool_limit INTEGER NOT NULL CHECK(tool_limit BETWEEN 1 AND 12),
    input_limit INTEGER NOT NULL CHECK(input_limit BETWEEN 0 AND 4294967295),
    output_limit INTEGER NOT NULL CHECK(output_limit BETWEEN 0 AND 4294967295),
    active_limit_ms INTEGER NOT NULL CHECK(active_limit_ms BETWEEN 1 AND 300000),
    model_used INTEGER NOT NULL DEFAULT 0 CHECK(model_used >= 0),
    tool_used INTEGER NOT NULL DEFAULT 0 CHECK(tool_used >= 0),
    input_used INTEGER NOT NULL DEFAULT 0 CHECK(input_used >= 0),
    output_used INTEGER NOT NULL DEFAULT 0 CHECK(output_used >= 0),
    active_elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK(active_elapsed_ms >= 0),
    event_sequence INTEGER NOT NULL DEFAULT 0 CHECK(event_sequence >= 0),
    cancel_requested_at INTEGER,
    error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER,
    token_policy TEXT NOT NULL DEFAULT 'observe' CHECK(token_policy IN ('observe','warn','enforce')),
    CHECK(token_policy='observe' OR (input_limit>0 AND output_limit>0)),
    CHECK((state IN ('completed','failed','canceled')) = (finished_at IS NOT NULL)),
    CHECK((state='failed') = (error_code IS NOT NULL))
) STRICT;

-- Retain legacy limits, terminal states, scopes and child receipts without rewriting events.
INSERT INTO ai_agent_run_v32 SELECT r.*, 'enforce' FROM ai_agent_run r;
DROP TRIGGER agent_run_scope_cleanup;
DROP TABLE ai_agent_run;
ALTER TABLE ai_agent_run_v32 RENAME TO ai_agent_run;

CREATE UNIQUE INDEX idx_agent_workspace_owner ON ai_agent_run(workspace_id) WHERE state = 'running';
CREATE UNIQUE INDEX idx_agent_conversation_live ON ai_agent_run(conversation_id) WHERE state NOT IN ('completed','failed','canceled');
CREATE TRIGGER agent_run_scope_insert BEFORE INSERT ON ai_agent_run BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM ai_agent_scope s WHERE s.id=NEW.scope_id AND s.workspace_id=NEW.workspace_id AND s.revoked_at IS NULL)
        OR NOT EXISTS(SELECT 1 FROM ai_conversation c WHERE c.id=NEW.conversation_id AND c.workspace_id=NEW.workspace_id AND c.conversation_kind='chat')
        THEN RAISE(ABORT,'agent_scope_denied') END;
END;
CREATE TRIGGER agent_run_immutable BEFORE UPDATE ON ai_agent_run BEGIN
    SELECT CASE WHEN NEW.id!=OLD.id OR NEW.workspace_id!=OLD.workspace_id OR NEW.conversation_id!=OLD.conversation_id OR NEW.scope_id!=OLD.scope_id
        OR NEW.model_limit!=OLD.model_limit OR NEW.tool_limit!=OLD.tool_limit OR NEW.input_limit!=OLD.input_limit OR NEW.output_limit!=OLD.output_limit OR NEW.active_limit_ms!=OLD.active_limit_ms OR NEW.token_policy!=OLD.token_policy
        OR NEW.model_used<OLD.model_used OR NEW.tool_used<OLD.tool_used OR NEW.input_used<OLD.input_used OR NEW.output_used<OLD.output_used OR NEW.active_elapsed_ms<OLD.active_elapsed_ms
        OR NEW.owner_epoch<OLD.owner_epoch OR NEW.revision!=OLD.revision+1 OR OLD.state IN ('completed','failed','canceled')
        THEN RAISE(ABORT,'agent_immutable') END;
END;
CREATE TRIGGER agent_run_transition BEFORE UPDATE OF state ON ai_agent_run WHEN NEW.state!=OLD.state BEGIN
    SELECT CASE WHEN NOT (
        (OLD.state='queued' AND NEW.state IN ('running','canceled')) OR
        (OLD.state='running' AND NEW.state IN ('waiting_for_input','waiting_for_approval','waiting_for_handoff','interrupted','completed','failed','canceled')) OR
        (OLD.state IN ('waiting_for_input','waiting_for_approval','interrupted') AND NEW.state IN ('running','canceled','failed')) OR
        (OLD.state='waiting_for_handoff' AND NEW.state IN ('running','interrupted','canceled','failed'))
    ) THEN RAISE(ABORT,'agent_transition_invalid') END;
END;
CREATE TRIGGER agent_run_scope_cleanup AFTER DELETE ON ai_agent_run BEGIN
    DELETE FROM ai_agent_scope WHERE id=OLD.scope_id;
END;
