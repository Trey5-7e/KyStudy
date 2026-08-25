ALTER TABLE ai_conversation
ADD COLUMN conversation_kind TEXT NOT NULL DEFAULT 'planning'
CHECK (conversation_kind IN ('planning', 'chat'));

CREATE INDEX idx_ai_conversation_workspace_kind_updated
    ON ai_conversation(workspace_id, conversation_kind, updated_at DESC, id DESC);

-- Keep the call-purpose contract ready for the generic chat use case while
-- preserving every existing call and its foreign-key relationships.
ALTER TABLE ai_call RENAME TO ai_call_v27;

CREATE TABLE ai_call (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    provider_config_id TEXT NOT NULL REFERENCES ai_provider_config(id),
    model_profile_id TEXT NOT NULL REFERENCES ai_model_profile(id),
    conversation_id TEXT REFERENCES ai_conversation(id) ON DELETE SET NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('foundation_test', 'planning_chat', 'general_chat')),
    request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
    state TEXT NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed')),
    input_token_estimate INTEGER NOT NULL CHECK (input_token_estimate >= 0),
    output_token_limit INTEGER NOT NULL CHECK (output_token_limit > 0),
    cache_hit INTEGER NOT NULL DEFAULT 0 CHECK (cache_hit IN (0, 1)),
    error_code TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    CHECK (
        (state = 'pending' AND finished_at IS NULL AND error_code IS NULL)
        OR
        (state = 'succeeded' AND finished_at IS NOT NULL AND error_code IS NULL)
        OR
        (state = 'failed' AND finished_at IS NOT NULL AND error_code IS NOT NULL)
    )
) STRICT;

INSERT INTO ai_call(
    id, provider_config_id, model_profile_id, conversation_id, purpose,
    request_fingerprint, state, input_token_estimate, output_token_limit,
    cache_hit, error_code, started_at, finished_at
)
SELECT id, provider_config_id, model_profile_id, conversation_id, purpose,
       request_fingerprint, state, input_token_estimate, output_token_limit,
       cache_hit, error_code, started_at, finished_at
FROM ai_call_v27;

DROP TABLE ai_call_v27;

CREATE INDEX idx_ai_call_started_at ON ai_call(started_at DESC, id DESC);
CREATE INDEX idx_ai_call_fingerprint ON ai_call(request_fingerprint, state, started_at DESC);
CREATE INDEX idx_ai_call_conversation ON ai_call(conversation_id, started_at, id);
