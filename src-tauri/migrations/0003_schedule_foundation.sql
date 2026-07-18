CREATE TABLE subject (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40 AND trim(name) = name),
    color_key TEXT NOT NULL
        CHECK (color_key IN ('slate', 'blue', 'cyan', 'green', 'amber', 'orange', 'rose', 'purple')),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    archived_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE UNIQUE INDEX idx_subject_active_name
    ON subject(workspace_id, name COLLATE NOCASE)
    WHERE archived_at IS NULL;

CREATE INDEX idx_subject_workspace_order
    ON subject(workspace_id, archived_at, sort_order, created_at, id);

CREATE TABLE task (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    subject_id TEXT REFERENCES subject(id) ON DELETE RESTRICT,
    parent_task_id TEXT REFERENCES task(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120 AND trim(title) = title),
    description TEXT CHECK (description IS NULL OR length(description) <= 2000),
    planned_date TEXT NOT NULL
        CHECK (
            length(planned_date) = 10
            AND planned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        ),
    estimated_minutes INTEGER CHECK (estimated_minutes BETWEEN 1 AND 1440),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
    status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'done', 'canceled')),
    manual_order INTEGER NOT NULL CHECK (manual_order >= 0),
    source_type TEXT NOT NULL CHECK (source_type = 'manual'),
    completed_at INTEGER,
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (
        (status = 'done' AND completed_at IS NOT NULL)
        OR (status <> 'done' AND completed_at IS NULL)
    )
) STRICT;

CREATE INDEX idx_task_workspace_date_status
    ON task(workspace_id, planned_date, status, deleted_at);

CREATE INDEX idx_task_workspace_subject_date
    ON task(workspace_id, subject_id, planned_date);

CREATE INDEX idx_task_parent
    ON task(parent_task_id);

CREATE TABLE task_change (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
    change_type TEXT NOT NULL
        CHECK (
            change_type IN (
                'created', 'edited', 'rescheduled', 'started', 'completed',
                'reopened', 'canceled', 'restored', 'split', 'trashed'
            )
        ),
    before_json TEXT,
    after_json TEXT,
    reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
    created_at INTEGER NOT NULL,
    CHECK (before_json IS NOT NULL OR after_json IS NOT NULL)
) STRICT;

CREATE INDEX idx_task_change_task_created
    ON task_change(task_id, created_at, id);
