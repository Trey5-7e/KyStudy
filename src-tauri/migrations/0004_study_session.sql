CREATE TABLE study_session (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    task_id TEXT REFERENCES task(id) ON DELETE RESTRICT,
    subject_id TEXT REFERENCES subject(id) ON DELETE RESTRICT,
    session_date TEXT NOT NULL
        CHECK (
            length(session_date) = 10
            AND session_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        ),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
    completion_percent INTEGER NOT NULL CHECK (completion_percent BETWEEN 0 AND 100),
    reflection TEXT CHECK (reflection IS NULL OR length(reflection) <= 2000),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    deleted_at INTEGER
) STRICT;

CREATE INDEX idx_study_session_workspace_date
    ON study_session(workspace_id, session_date, deleted_at, created_at, id);

CREATE INDEX idx_study_session_task
    ON study_session(task_id, session_date, deleted_at);

CREATE INDEX idx_study_session_subject
    ON study_session(workspace_id, subject_id, session_date, deleted_at);
