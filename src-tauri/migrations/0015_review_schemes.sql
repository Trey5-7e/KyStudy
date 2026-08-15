CREATE TABLE workbook_profile (
    document_id TEXT PRIMARY KEY REFERENCES resource_document(id) ON DELETE CASCADE,
    default_subject_id TEXT REFERENCES subject(id) ON DELETE SET NULL,
    updated_at INTEGER NOT NULL
) STRICT;

ALTER TABLE question ADD COLUMN subject_id TEXT REFERENCES subject(id) ON DELETE SET NULL;
ALTER TABLE question ADD COLUMN question_type TEXT
    CHECK (question_type IS NULL OR question_type IN ('choice', 'blank', 'solution', 'other'));
ALTER TABLE question ADD COLUMN classification_source TEXT NOT NULL DEFAULT 'pending'
    CHECK (classification_source IN ('pending', 'automatic', 'manual'));
ALTER TABLE question ADD COLUMN classification_confidence REAL
    CHECK (classification_confidence IS NULL OR
           (classification_confidence >= 0.0 AND classification_confidence <= 1.0));

CREATE INDEX idx_question_effective_subject
    ON question(subject_id, question_type, deleted_at, document_id);

CREATE TABLE workspace_rest_weekday (
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    created_at INTEGER NOT NULL,
    PRIMARY KEY(workspace_id, weekday)
) STRICT, WITHOUT ROWID;

CREATE TABLE review_scheme (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80 AND trim(name) = name),
    subject_id TEXT NOT NULL REFERENCES subject(id) ON DELETE RESTRICT,
    all_subject_workbooks INTEGER NOT NULL DEFAULT 0 CHECK (all_subject_workbooks IN (0, 1)),
    daily_quota INTEGER NOT NULL CHECK (daily_quota BETWEEN 1 AND 100),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    archived_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE(workspace_id, name)
) STRICT;

CREATE INDEX idx_review_scheme_workspace_active
    ON review_scheme(workspace_id, archived_at, enabled, created_at, id);

CREATE TABLE review_scheme_document (
    scheme_id TEXT NOT NULL REFERENCES review_scheme(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(scheme_id, document_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_review_scheme_document_document
    ON review_scheme_document(document_id, scheme_id);

CREATE TABLE review_scheme_type_quota (
    scheme_id TEXT NOT NULL REFERENCES review_scheme(id) ON DELETE CASCADE,
    question_type TEXT NOT NULL CHECK (question_type IN ('choice', 'blank', 'solution', 'other')),
    quota INTEGER NOT NULL CHECK (quota BETWEEN 0 AND 100),
    PRIMARY KEY(scheme_id, question_type)
) STRICT, WITHOUT ROWID;

CREATE TABLE review_scheme_queue (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    scheme_id TEXT NOT NULL REFERENCES review_scheme(id) ON DELETE CASCADE,
    queue_date TEXT NOT NULL CHECK (length(queue_date) = 10),
    quota INTEGER NOT NULL CHECK (quota BETWEEN 1 AND 100),
    generated_at INTEGER NOT NULL,
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    UNIQUE(scheme_id, queue_date)
) STRICT;

CREATE INDEX idx_review_scheme_queue_date
    ON review_scheme_queue(queue_date, scheme_id);

CREATE TABLE review_scheme_queue_item (
    queue_id TEXT NOT NULL REFERENCES review_scheme_queue(id) ON DELETE CASCADE,
    queue_date TEXT NOT NULL CHECK (length(queue_date) = 10),
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    origin_date TEXT NOT NULL CHECK (length(origin_date) = 10),
    origin_position INTEGER NOT NULL CHECK (origin_position >= 0),
    priority_score INTEGER NOT NULL CHECK (priority_score >= 0),
    selection_kind TEXT NOT NULL CHECK (selection_kind IN ('carryover', 'overdue', 'due', 'new')),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed', 'carried')),
    review_event_id TEXT REFERENCES review_event(id) ON DELETE SET NULL,
    carried_to_queue_id TEXT REFERENCES review_scheme_queue(id) ON DELETE SET NULL,
    inserted_at INTEGER NOT NULL,
    completed_at INTEGER,
    PRIMARY KEY(queue_id, question_id),
    UNIQUE(queue_id, position),
    UNIQUE(queue_date, question_id),
    CHECK (
        (state = 'pending' AND review_event_id IS NULL AND carried_to_queue_id IS NULL AND completed_at IS NULL)
        OR
        (state = 'completed' AND review_event_id IS NOT NULL AND carried_to_queue_id IS NULL AND completed_at IS NOT NULL)
        OR
        (state = 'carried' AND review_event_id IS NULL AND carried_to_queue_id IS NOT NULL AND completed_at IS NULL)
    )
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_review_scheme_queue_item_pending
    ON review_scheme_queue_item(state, origin_date, origin_position, question_id);
