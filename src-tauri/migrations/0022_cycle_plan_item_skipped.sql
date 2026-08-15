DELETE FROM cycle_plan_shift_undo;

DROP TABLE cycle_plan_shift_undo_item;

CREATE TABLE cycle_plan_item_new (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    plan_id TEXT NOT NULL REFERENCES cycle_plan(id) ON DELETE CASCADE,
    unit_index INTEGER NOT NULL CHECK (unit_index >= 1),
    planned_start_date TEXT NOT NULL CHECK (length(planned_start_date) = 10),
    planned_end_date TEXT NOT NULL CHECK (length(planned_end_date) = 10),
    original_start_date TEXT NOT NULL CHECK (length(original_start_date) = 10),
    original_end_date TEXT NOT NULL CHECK (length(original_end_date) = 10),
    state TEXT NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'completed', 'skipped')),
    completed_at INTEGER,
    skipped_at INTEGER,
    shift_count INTEGER NOT NULL DEFAULT 0 CHECK (shift_count >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE(plan_id, unit_index),
    CHECK (
        (state = 'pending' AND completed_at IS NULL AND skipped_at IS NULL)
        OR (state = 'completed' AND completed_at IS NOT NULL AND skipped_at IS NULL)
        OR (state = 'skipped' AND completed_at IS NULL AND skipped_at IS NOT NULL)
    )
) STRICT;

INSERT INTO cycle_plan_item_new(
    id, plan_id, unit_index, planned_start_date, planned_end_date,
    original_start_date, original_end_date, state, completed_at, skipped_at,
    shift_count, created_at, updated_at
)
SELECT
    id, plan_id, unit_index, planned_start_date, planned_end_date,
    original_start_date, original_end_date, state, completed_at, NULL,
    shift_count, created_at, updated_at
FROM cycle_plan_item;

DROP TABLE cycle_plan_item;

ALTER TABLE cycle_plan_item_new RENAME TO cycle_plan_item;

CREATE INDEX idx_cycle_plan_item_calendar
    ON cycle_plan_item(planned_start_date, planned_end_date, state, plan_id);

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
