ALTER TABLE ai_provider_config ADD COLUMN deleted_at INTEGER;

CREATE INDEX idx_ai_provider_visible
    ON ai_provider_config(workspace_id, deleted_at, enabled DESC, updated_at DESC);
