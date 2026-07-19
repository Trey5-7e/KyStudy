CREATE TABLE knowledge_map (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    subject_id TEXT REFERENCES subject(id) ON DELETE RESTRICT,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120 AND trim(title) = title),
    root_node_id TEXT NOT NULL CHECK (length(root_node_id) = 36),
    current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision >= 1),
    deleted_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_knowledge_map_workspace_updated
    ON knowledge_map(workspace_id, deleted_at, updated_at DESC, id);

CREATE TABLE knowledge_node (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    map_id TEXT NOT NULL REFERENCES knowledge_map(id) ON DELETE CASCADE,
    subject_id TEXT REFERENCES subject(id) ON DELETE RESTRICT,
    parent_id TEXT REFERENCES knowledge_node(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200 AND trim(title) = title),
    note_markdown TEXT CHECK (note_markdown IS NULL OR length(note_markdown) <= 10000),
    mastery_state TEXT NOT NULL DEFAULT 'unknown'
        CHECK (mastery_state IN ('unknown', 'learning', 'weak', 'stable')),
    importance INTEGER NOT NULL DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    collapsed INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_knowledge_node_map_parent_order
    ON knowledge_node(map_id, parent_id, sort_order, id);

CREATE INDEX idx_knowledge_node_subject
    ON knowledge_node(map_id, subject_id, id);

CREATE TABLE knowledge_node_resource (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    node_id TEXT NOT NULL REFERENCES knowledge_node(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE RESTRICT,
    page_start INTEGER CHECK (page_start IS NULL OR page_start >= 1),
    page_end INTEGER CHECK (page_end IS NULL OR page_end >= page_start),
    note TEXT CHECK (note IS NULL OR length(note) <= 1000),
    created_at INTEGER NOT NULL,
    CHECK (
        (page_start IS NULL AND page_end IS NULL)
        OR (page_start IS NOT NULL AND page_end IS NOT NULL)
    )
) STRICT;

CREATE INDEX idx_knowledge_node_resource_node
    ON knowledge_node_resource(node_id, created_at, id);

CREATE TABLE knowledge_map_revision (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    map_id TEXT NOT NULL REFERENCES knowledge_map(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    change_summary TEXT NOT NULL CHECK (length(change_summary) BETWEEN 1 AND 120),
    created_at INTEGER NOT NULL,
    UNIQUE (map_id, revision_number)
) STRICT;

CREATE INDEX idx_knowledge_map_revision_map
    ON knowledge_map_revision(map_id, revision_number DESC);

CREATE TABLE map_import_draft (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    source_resource_id TEXT NOT NULL REFERENCES resource_document(id) ON DELETE RESTRICT,
    source_format TEXT NOT NULL CHECK (source_format IN ('opml', 'freemind')),
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    draft_tree_json TEXT NOT NULL CHECK (json_valid(draft_tree_json)),
    warnings_json TEXT NOT NULL CHECK (json_valid(warnings_json)),
    node_count INTEGER NOT NULL CHECK (node_count BETWEEN 1 AND 2000),
    state TEXT NOT NULL CHECK (state IN ('generated', 'accepted', 'rejected')),
    accepted_map_id TEXT REFERENCES knowledge_map(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_map_import_draft_workspace_state
    ON map_import_draft(workspace_id, state, updated_at DESC, id);
