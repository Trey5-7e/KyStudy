CREATE TABLE question_gap_acknowledgement (
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    issue_key TEXT NOT NULL CHECK (length(issue_key) BETWEEN 1 AND 500),
    acknowledged_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, issue_key)
) STRICT;
