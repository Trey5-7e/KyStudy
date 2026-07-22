CREATE TABLE ai_conversation (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_ai_conversation_workspace_updated
    ON ai_conversation(workspace_id, updated_at DESC, id DESC);

CREATE TABLE ai_call_v12 (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    provider_config_id TEXT NOT NULL REFERENCES ai_provider_config(id),
    model_profile_id TEXT NOT NULL REFERENCES ai_model_profile(id),
    conversation_id TEXT REFERENCES ai_conversation(id) ON DELETE SET NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('foundation_test', 'planning_chat')),
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

INSERT INTO ai_call_v12(
    id, provider_config_id, model_profile_id, conversation_id, purpose,
    request_fingerprint, state, input_token_estimate, output_token_limit,
    cache_hit, error_code, started_at, finished_at
)
SELECT id, provider_config_id, model_profile_id, NULL, purpose,
       request_fingerprint, state, input_token_estimate, output_token_limit,
       cache_hit, error_code, started_at, finished_at
FROM ai_call;

CREATE TABLE ai_usage_v12 (
    ai_call_id TEXT PRIMARY KEY REFERENCES ai_call_v12(id) ON DELETE CASCADE,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    usage_source TEXT NOT NULL CHECK (usage_source IN ('provider', 'estimated', 'cache'))
) STRICT, WITHOUT ROWID;

INSERT INTO ai_usage_v12
SELECT ai_call_id, input_tokens, output_tokens, cached_input_tokens,
       reasoning_tokens, usage_source
FROM ai_usage;

DROP TABLE ai_usage;
DROP TABLE ai_call;
ALTER TABLE ai_call_v12 RENAME TO ai_call;
ALTER TABLE ai_usage_v12 RENAME TO ai_usage;

CREATE INDEX idx_ai_call_started_at ON ai_call(started_at DESC, id DESC);
CREATE INDEX idx_ai_call_fingerprint ON ai_call(request_fingerprint, state, started_at DESC);
CREATE INDEX idx_ai_call_conversation ON ai_call(conversation_id, started_at, id);

CREATE TABLE ai_message (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content_markdown TEXT NOT NULL CHECK (length(trim(content_markdown)) BETWEEN 1 AND 20000),
    ai_call_id TEXT UNIQUE REFERENCES ai_call(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    CHECK (
        (role = 'user' AND ai_call_id IS NULL)
        OR role = 'assistant'
    )
) STRICT;

CREATE INDEX idx_ai_message_conversation_created
    ON ai_message(conversation_id, created_at, id);

CREATE TABLE ai_context_ref (
    ai_call_id TEXT NOT NULL REFERENCES ai_call(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE RESTRICT,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    citation_label TEXT NOT NULL CHECK (length(citation_label) BETWEEN 1 AND 30),
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    token_estimate INTEGER NOT NULL CHECK (token_estimate > 0),
    PRIMARY KEY(ai_call_id, document_id, page_number)
) STRICT, WITHOUT ROWID;

ALTER TABLE study_plan
ADD COLUMN source_ai_message_id TEXT REFERENCES ai_message(id) ON DELETE SET NULL;
