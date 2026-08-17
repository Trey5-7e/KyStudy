ALTER TABLE ai_provider_config
ADD COLUMN provider_protocol TEXT NOT NULL DEFAULT 'openai_responses';

UPDATE ai_provider_config
SET provider_protocol = provider_type;
