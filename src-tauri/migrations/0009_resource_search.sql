CREATE TABLE resource_index_job (
    document_id TEXT PRIMARY KEY REFERENCES resource_document(id) ON DELETE CASCADE,
    source_sha256 TEXT NOT NULL CHECK (length(source_sha256) = 64),
    state TEXT NOT NULL CHECK (state IN ('running', 'interrupted', 'failed', 'ready', 'empty')),
    total_pages INTEGER NOT NULL CHECK (total_pages > 0),
    indexed_pages INTEGER NOT NULL DEFAULT 0 CHECK (indexed_pages >= 0),
    text_pages INTEGER NOT NULL DEFAULT 0 CHECK (text_pages >= 0),
    chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
    error_code TEXT,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= started_at),
    completed_at INTEGER,
    CHECK (indexed_pages <= total_pages),
    CHECK (text_pages <= indexed_pages),
    CHECK (
        (state IN ('ready', 'empty') AND completed_at IS NOT NULL AND indexed_pages = total_pages)
        OR
        (state NOT IN ('ready', 'empty') AND completed_at IS NULL)
    )
) STRICT;

CREATE INDEX idx_resource_index_job_state
    ON resource_index_job(state, updated_at, document_id);

CREATE TABLE resource_page_text (
    document_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL CHECK (page_number > 0),
    width_points REAL NOT NULL CHECK (width_points > 0),
    height_points REAL NOT NULL CHECK (height_points > 0),
    text_state TEXT NOT NULL CHECK (text_state IN ('text', 'empty')),
    text_content TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
    indexed_at INTEGER NOT NULL,
    PRIMARY KEY(document_id, page_number),
    CHECK (
        (text_state = 'text' AND length(text_content) > 0)
        OR
        (text_state = 'empty' AND length(text_content) = 0)
    )
) STRICT, WITHOUT ROWID;

CREATE TABLE resource_text_chunk (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    text TEXT NOT NULL CHECK (length(text) > 0),
    chunk_hash TEXT NOT NULL CHECK (length(chunk_hash) = 64),
    created_at INTEGER NOT NULL,
    FOREIGN KEY(document_id, page_number)
        REFERENCES resource_page_text(document_id, page_number) ON DELETE CASCADE,
    UNIQUE(document_id, page_number, sequence)
) STRICT;

CREATE INDEX idx_resource_text_chunk_page
    ON resource_text_chunk(document_id, page_number, sequence);

CREATE VIRTUAL TABLE resource_text_fts USING fts5(
    chunk_id UNINDEXED,
    document_id UNINDEXED,
    page_number UNINDEXED,
    title,
    text,
    tokenize = 'trigram'
);
