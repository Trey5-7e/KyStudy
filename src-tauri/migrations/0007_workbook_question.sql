CREATE TABLE question (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200 AND trim(title) = title),
    chapter TEXT CHECK (chapter IS NULL OR (length(chapter) BETWEEN 1 AND 120 AND trim(chapter) = chapter)),
    question_number TEXT CHECK (question_number IS NULL OR (length(question_number) BETWEEN 1 AND 60 AND trim(question_number) = question_number)),
    difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
    analysis_markdown TEXT CHECK (analysis_markdown IS NULL OR length(analysis_markdown) <= 20000),
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_question_document_active
    ON question(document_id, deleted_at, updated_at DESC, id);

CREATE INDEX idx_question_workspace_trash
    ON question(workspace_id, deleted_at DESC, id);

CREATE TABLE question_region (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE RESTRICT,
    page_number INTEGER NOT NULL CHECK (page_number >= 1),
    x REAL NOT NULL CHECK (x >= 0.0 AND x <= 1.0),
    y REAL NOT NULL CHECK (y >= 0.0 AND y <= 1.0),
    width REAL NOT NULL CHECK (width > 0.0 AND width <= 1.0 AND x + width <= 1.000001),
    height REAL NOT NULL CHECK (height > 0.0 AND height <= 1.0 AND y + height <= 1.000001),
    coordinate_version INTEGER NOT NULL DEFAULT 1 CHECK (coordinate_version = 1),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at INTEGER NOT NULL,
    UNIQUE(question_id, sort_order)
) STRICT;

CREATE INDEX idx_question_region_document_page
    ON question_region(document_id, page_number, question_id, sort_order);

CREATE TABLE question_knowledge_node (
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES knowledge_node(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(question_id, node_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_question_knowledge_node_node
    ON question_knowledge_node(node_id, question_id);

CREATE TABLE question_attempt (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    result TEXT NOT NULL CHECK (result IN ('correct', 'incorrect', 'uncertain')),
    attempted_at INTEGER NOT NULL,
    duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 86400),
    answer_note TEXT CHECK (answer_note IS NULL OR length(answer_note) <= 10000),
    created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_question_attempt_question_time
    ON question_attempt(question_id, attempted_at DESC, id DESC);
