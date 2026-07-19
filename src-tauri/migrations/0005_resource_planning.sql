ALTER TABLE resource_document
ADD COLUMN role TEXT NOT NULL DEFAULT 'other'
    CHECK (role IN ('planning', 'reference', 'workbook', 'other'));

ALTER TABLE resource_document
ADD COLUMN page_count INTEGER
    CHECK (page_count IS NULL OR page_count >= 1);

CREATE TABLE resource_reading_state (
    document_id TEXT PRIMARY KEY REFERENCES resource_document(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    last_page INTEGER NOT NULL CHECK (last_page >= 1),
    last_opened_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= last_opened_at)
) STRICT;

CREATE INDEX idx_resource_reading_workspace_opened
    ON resource_reading_state(workspace_id, last_opened_at DESC, document_id);

CREATE TABLE study_plan (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120 AND trim(title) = title),
    target_exam TEXT CHECK (target_exam IS NULL OR length(target_exam) <= 120),
    exam_date TEXT
        CHECK (
            exam_date IS NULL
            OR (
                length(exam_date) = 10
                AND exam_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            )
        ),
    overview TEXT CHECK (overview IS NULL OR length(overview) <= 8000),
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_study_plan_workspace_status
    ON study_plan(workspace_id, status, updated_at DESC, id);

CREATE TABLE plan_stage (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    plan_id TEXT NOT NULL REFERENCES study_plan(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120 AND trim(title) = title),
    start_date TEXT NOT NULL
        CHECK (
            length(start_date) = 10
            AND start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        ),
    end_date TEXT NOT NULL
        CHECK (
            length(end_date) = 10
            AND end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        ),
    focus TEXT CHECK (focus IS NULL OR length(focus) <= 4000),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (start_date <= end_date)
) STRICT;

CREATE INDEX idx_plan_stage_plan_order
    ON plan_stage(plan_id, sort_order, start_date, id);

CREATE TABLE plan_reference (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    plan_id TEXT NOT NULL REFERENCES study_plan(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE RESTRICT,
    page_start INTEGER NOT NULL CHECK (page_start >= 1),
    page_end INTEGER NOT NULL CHECK (page_end >= page_start),
    note TEXT CHECK (note IS NULL OR length(note) <= 1000),
    created_at INTEGER NOT NULL,
    UNIQUE (plan_id, document_id, page_start, page_end)
) STRICT;

CREATE INDEX idx_plan_reference_plan_created
    ON plan_reference(plan_id, created_at, id);
