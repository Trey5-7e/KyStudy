ALTER TABLE workbook_document_segment
ADD COLUMN deleted_at INTEGER;

CREATE INDEX idx_workbook_segment_active
    ON workbook_document_segment(workspace_id, deleted_at, page_start, id);

CREATE TABLE workbook_segment_question_trash (
    segment_id TEXT NOT NULL REFERENCES workbook_document_segment(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    deleted_at INTEGER NOT NULL,
    PRIMARY KEY(segment_id, question_id)
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_workbook_segment_question_trash_question
    ON workbook_segment_question_trash(question_id, segment_id);
