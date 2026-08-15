ALTER TABLE resource_document
ADD COLUMN deleted_at INTEGER;

CREATE INDEX idx_resource_document_active
    ON resource_document(workspace_id, deleted_at, created_at DESC, id);
