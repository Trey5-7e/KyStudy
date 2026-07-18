CREATE TABLE blob (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
    size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
    storage_key TEXT NOT NULL UNIQUE,
    integrity_state TEXT NOT NULL DEFAULT 'ok'
        CHECK (integrity_state IN ('ok', 'missing', 'corrupted')),
    created_at INTEGER NOT NULL,
    UNIQUE (workspace_id, sha256)
) STRICT;

CREATE TABLE resource_document (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    blob_id TEXT NOT NULL REFERENCES blob(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
    original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 240),
    kind TEXT NOT NULL CHECK (kind IN ('pdf', 'image', 'document', 'mindmap_source')),
    mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 200),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
) STRICT;

CREATE INDEX idx_resource_document_workspace_created
    ON resource_document(workspace_id, created_at DESC, id);

CREATE TABLE processing_job (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL CHECK (length(document_id) = 36),
    job_type TEXT NOT NULL CHECK (job_type = 'import'),
    state TEXT NOT NULL
        CHECK (state IN ('running', 'committing', 'succeeded', 'failed', 'canceled', 'interrupted')),
    original_name TEXT NOT NULL CHECK (length(original_name) BETWEEN 1 AND 240),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
    kind TEXT NOT NULL CHECK (kind IN ('pdf', 'image', 'document', 'mindmap_source')),
    mime_type TEXT NOT NULL CHECK (length(mime_type) BETWEEN 1 AND 200),
    expected_size INTEGER NOT NULL CHECK (expected_size >= 0),
    progress_current INTEGER NOT NULL DEFAULT 0 CHECK (progress_current >= 0),
    staging_key TEXT NOT NULL,
    sha256 TEXT CHECK (sha256 IS NULL OR length(sha256) = 64),
    storage_key TEXT,
    error_code TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_processing_job_document
    ON processing_job(document_id);

CREATE INDEX idx_processing_job_recovery
    ON processing_job(workspace_id, state, updated_at);
