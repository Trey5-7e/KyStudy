CREATE TABLE review_scheme_undo (
    queue_id TEXT PRIMARY KEY REFERENCES review_scheme_queue(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL REFERENCES review_event(id) ON DELETE CASCADE,
    attempt_id TEXT NOT NULL REFERENCES question_attempt(id) ON DELETE CASCADE,
    first_mistake_at INTEGER,
    last_mistake_at INTEGER,
    mistake_count INTEGER NOT NULL CHECK (mistake_count >= 0),
    consecutive_failure_count INTEGER NOT NULL CHECK (consecutive_failure_count >= 0),
    profile_updated_at INTEGER NOT NULL,
    policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
    mastery_level TEXT NOT NULL CHECK (mastery_level IN ('new', 'learning', 'uncertain', 'mastered')),
    due_date TEXT NOT NULL CHECK (length(due_date) = 10),
    last_reviewed_at INTEGER,
    successful_streak INTEGER NOT NULL CHECK (successful_streak >= 0),
    manual_pin_date TEXT CHECK (manual_pin_date IS NULL OR length(manual_pin_date) = 10),
    state_updated_at INTEGER NOT NULL,
    saved_at INTEGER NOT NULL
) STRICT;

CREATE TABLE cycle_plan (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120 AND trim(name) = name),
    total_units INTEGER NOT NULL CHECK (total_units BETWEEN 1 AND 500),
    unit_label TEXT NOT NULL CHECK (length(unit_label) BETWEEN 1 AND 20 AND trim(unit_label) = unit_label),
    start_date TEXT NOT NULL CHECK (length(start_date) = 10),
    deadline TEXT NOT NULL CHECK (length(deadline) = 10),
    study_days_per_unit INTEGER NOT NULL CHECK (study_days_per_unit BETWEEN 1 AND 30),
    schedule_mode TEXT NOT NULL DEFAULT 'rhythm' CHECK (schedule_mode IN ('rhythm', 'even')),
    calendar_visible INTEGER NOT NULL DEFAULT 1 CHECK (calendar_visible IN (0, 1)),
    archived_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE(workspace_id, name)
) STRICT;

CREATE INDEX idx_cycle_plan_workspace_active
    ON cycle_plan(workspace_id, archived_at, created_at, id);

CREATE TABLE cycle_plan_item (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    plan_id TEXT NOT NULL REFERENCES cycle_plan(id) ON DELETE CASCADE,
    unit_index INTEGER NOT NULL CHECK (unit_index >= 1),
    planned_start_date TEXT NOT NULL CHECK (length(planned_start_date) = 10),
    planned_end_date TEXT NOT NULL CHECK (length(planned_end_date) = 10),
    original_start_date TEXT NOT NULL CHECK (length(original_start_date) = 10),
    original_end_date TEXT NOT NULL CHECK (length(original_end_date) = 10),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed')),
    completed_at INTEGER,
    shift_count INTEGER NOT NULL DEFAULT 0 CHECK (shift_count >= 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    UNIQUE(plan_id, unit_index),
    CHECK (
        (state = 'pending' AND completed_at IS NULL)
        OR (state = 'completed' AND completed_at IS NOT NULL)
    )
) STRICT;

CREATE INDEX idx_cycle_plan_item_calendar
    ON cycle_plan_item(planned_start_date, planned_end_date, state, plan_id);
