ALTER TABLE ai_conversation
ADD COLUMN model_profile_id TEXT REFERENCES ai_model_profile(id) ON DELETE SET NULL;

CREATE INDEX idx_ai_conversation_model_profile
    ON ai_conversation(model_profile_id, updated_at DESC, id DESC);

ALTER TABLE ai_model_profile
ADD COLUMN supports_image TEXT NOT NULL DEFAULT 'unknown'
CHECK (supports_image IN ('supported', 'unsupported', 'unknown'));

ALTER TABLE ai_model_profile
ADD COLUMN supports_file TEXT NOT NULL DEFAULT 'unknown'
CHECK (supports_file IN ('supported', 'unsupported', 'unknown'));

ALTER TABLE ai_model_profile
ADD COLUMN supports_pdf TEXT NOT NULL DEFAULT 'unknown'
CHECK (supports_pdf IN ('supported', 'unsupported', 'unknown'));

ALTER TABLE ai_model_profile
ADD COLUMN capability_source TEXT NOT NULL DEFAULT 'unknown'
CHECK (capability_source IN ('manual', 'tested', 'unknown'));

CREATE TABLE ai_attachment_ref (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    conversation_id TEXT NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
    source TEXT NOT NULL CHECK (source IN ('resource', 'temporary')),
    document_id TEXT REFERENCES resource_document(id) ON DELETE RESTRICT,
    file_name TEXT NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 240),
    mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) BETWEEN 1 AND 120),
    size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 0 AND 104857600),
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    status TEXT NOT NULL CHECK (status IN ('ready', 'processing', 'expired', 'failed')),
    error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (
        (source = 'resource' AND document_id IS NOT NULL)
        OR
        (source = 'temporary' AND document_id IS NULL)
    ),
    CHECK (
        (status = 'failed' AND error_code IS NOT NULL)
        OR
        (status <> 'failed' AND error_code IS NULL)
    )
) STRICT;

CREATE INDEX idx_ai_attachment_conversation_updated
    ON ai_attachment_ref(conversation_id, updated_at DESC, id DESC);

CREATE INDEX idx_ai_attachment_document
    ON ai_attachment_ref(document_id, updated_at DESC, id DESC);
