CREATE TABLE cycle_plan_shift_undo (
    undo_token TEXT PRIMARY KEY CHECK (length(undo_token) = 36),
    plan_id TEXT NOT NULL REFERENCES cycle_plan(id) ON DELETE CASCADE,
    shifted_item_count INTEGER NOT NULL CHECK (shifted_item_count > 0),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
) STRICT;

CREATE UNIQUE INDEX idx_cycle_plan_shift_undo_plan
    ON cycle_plan_shift_undo(plan_id);

CREATE TABLE cycle_plan_shift_undo_item (
    undo_token TEXT NOT NULL REFERENCES cycle_plan_shift_undo(undo_token) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES cycle_plan_item(id) ON DELETE CASCADE,
    before_planned_start_date TEXT NOT NULL CHECK (length(before_planned_start_date) = 10),
    before_planned_end_date TEXT NOT NULL CHECK (length(before_planned_end_date) = 10),
    before_shift_count INTEGER NOT NULL CHECK (before_shift_count >= 0),
    before_updated_at INTEGER NOT NULL CHECK (before_updated_at >= 0),
    shifted_planned_start_date TEXT NOT NULL CHECK (length(shifted_planned_start_date) = 10),
    shifted_planned_end_date TEXT NOT NULL CHECK (length(shifted_planned_end_date) = 10),
    shifted_shift_count INTEGER NOT NULL CHECK (shifted_shift_count >= 0),
    shifted_updated_at INTEGER NOT NULL CHECK (shifted_updated_at >= 0),
    PRIMARY KEY (undo_token, item_id)
) STRICT;

CREATE INDEX idx_cycle_plan_shift_undo_item_item
    ON cycle_plan_shift_undo_item(item_id, undo_token);
