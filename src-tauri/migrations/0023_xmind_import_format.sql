CREATE TABLE map_import_draft_new (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    source_resource_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE RESTRICT,
    source_format TEXT NOT NULL CHECK (source_format IN ('opml', 'freemind', 'xmind')),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    draft_tree_json TEXT NOT NULL CHECK (json_valid(draft_tree_json)),
    warnings_json TEXT NOT NULL CHECK (json_valid(warnings_json)),
    node_count INTEGER NOT NULL CHECK (node_count BETWEEN 1 AND 2000),
    state TEXT NOT NULL CHECK (state IN ('generated', 'accepted', 'rejected')),
    accepted_map_id TEXT REFERENCES knowledge_map(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

INSERT INTO map_import_draft_new(
    id, workspace_id, source_resource_id, source_format, title,
    draft_tree_json, warnings_json, node_count, state, accepted_map_id,
    created_at, updated_at
)
SELECT
    id, workspace_id, source_resource_id, source_format, title,
    draft_tree_json, warnings_json, node_count, state, accepted_map_id,
    created_at, updated_at
FROM map_import_draft;

DROP TABLE map_import_draft;

ALTER TABLE map_import_draft_new RENAME TO map_import_draft;

CREATE INDEX idx_map_import_draft_workspace_state
    ON map_import_draft(workspace_id, state, updated_at DESC, id);
