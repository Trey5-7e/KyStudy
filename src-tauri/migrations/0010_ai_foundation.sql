CREATE TABLE ai_provider_config (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('offline_test', 'openai_responses')),
    display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
    base_url TEXT,
    secret_ref TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (
        (provider_type = 'offline_test' AND base_url IS NULL AND secret_ref IS NULL)
        OR
        (provider_type = 'openai_responses' AND base_url IS NOT NULL AND secret_ref IS NOT NULL)
    )
) STRICT;

CREATE UNIQUE INDEX idx_ai_provider_single_enabled
    ON ai_provider_config(workspace_id) WHERE enabled = 1;

CREATE TABLE ai_model_profile (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    provider_config_id TEXT NOT NULL REFERENCES ai_provider_config(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL CHECK (length(trim(model_name)) BETWEEN 1 AND 120),
    context_limit INTEGER NOT NULL CHECK (context_limit BETWEEN 1024 AND 2000000),
    max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 131072),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE(provider_config_id)
) STRICT;

CREATE TABLE ai_budget (
    workspace_id TEXT PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
    single_call_limit INTEGER NOT NULL CHECK (single_call_limit BETWEEN 1 AND 2000000),
    daily_token_limit INTEGER NOT NULL CHECK (daily_token_limit BETWEEN 1 AND 100000000),
    monthly_token_limit INTEGER NOT NULL CHECK (monthly_token_limit BETWEEN 1 AND 1000000000),
    limit_mode TEXT NOT NULL CHECK (limit_mode IN ('warn', 'block')),
    updated_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE ai_call (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    provider_config_id TEXT NOT NULL REFERENCES ai_provider_config(id),
    model_profile_id TEXT NOT NULL REFERENCES ai_model_profile(id),
    purpose TEXT NOT NULL CHECK (purpose IN ('foundation_test')),
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

CREATE INDEX idx_ai_call_started_at ON ai_call(started_at DESC, id DESC);
CREATE INDEX idx_ai_call_fingerprint ON ai_call(request_fingerprint, state, started_at DESC);

CREATE TABLE ai_usage (
    ai_call_id TEXT PRIMARY KEY REFERENCES ai_call(id) ON DELETE CASCADE,
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    usage_source TEXT NOT NULL CHECK (usage_source IN ('provider', 'estimated', 'cache'))
) STRICT, WITHOUT ROWID;

CREATE TABLE ai_response_cache (
    request_fingerprint TEXT PRIMARY KEY CHECK (length(request_fingerprint) = 64),
    response_text TEXT NOT NULL CHECK (length(response_text) > 0),
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL CHECK (last_used_at >= created_at)
) STRICT, WITHOUT ROWID;
