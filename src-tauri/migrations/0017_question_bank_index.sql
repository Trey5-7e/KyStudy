CREATE TABLE workbook_category (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND trim(name) = name),
    archived_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE(workspace_id, name)
) STRICT;

CREATE INDEX idx_workbook_category_active
    ON workbook_category(workspace_id, archived_at, name, id);

CREATE TABLE workbook_document_segment (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE RESTRICT,
    subject_id TEXT NOT NULL REFERENCES subject(id) ON DELETE RESTRICT,
    workbook_id TEXT NOT NULL REFERENCES workbook_category(id) ON DELETE RESTRICT,
    source_heading TEXT NOT NULL CHECK (length(source_heading) BETWEEN 1 AND 200),
    page_start INTEGER NOT NULL CHECK (page_start >= 1),
    page_end INTEGER NOT NULL CHECK (page_end >= page_start),
    index_state TEXT NOT NULL DEFAULT 'pending'
        CHECK (index_state IN ('pending', 'ready', 'needs_review')),
    question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE(document_id, subject_id, workbook_id, page_start, page_end)
) STRICT;

CREATE INDEX idx_workbook_segment_tree
    ON workbook_document_segment(subject_id, workbook_id, page_start, id);

CREATE INDEX idx_workbook_segment_document
    ON workbook_document_segment(document_id, page_start, page_end, id);

CREATE TABLE question_index_metadata (
    question_id TEXT PRIMARY KEY REFERENCES question(id) ON DELETE CASCADE,
    workbook_id TEXT NOT NULL REFERENCES workbook_category(id) ON DELETE RESTRICT,
    segment_id TEXT NOT NULL REFERENCES workbook_document_segment(id) ON DELETE CASCADE,
    source_key TEXT NOT NULL CHECK (length(source_key) BETWEEN 1 AND 500),
    section_part TEXT NOT NULL CHECK (
        section_part IN ('basic', 'comprehensive', 'extended', 'other')
    ),
    index_source TEXT NOT NULL DEFAULT 'pdf_outline'
        CHECK (index_source IN ('pdf_outline', 'manual')),
    index_confidence REAL NOT NULL CHECK (
        index_confidence >= 0.0 AND index_confidence <= 1.0
    ),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE(segment_id, source_key)
) STRICT;

CREATE INDEX idx_question_index_workbook
    ON question_index_metadata(workbook_id, segment_id, sort_order, question_id);
