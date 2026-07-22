CREATE TABLE mistake_profile (
    question_id TEXT PRIMARY KEY REFERENCES question(id) ON DELETE CASCADE,
    first_mistake_at INTEGER,
    last_mistake_at INTEGER,
    mistake_count INTEGER NOT NULL DEFAULT 0 CHECK (mistake_count >= 0),
    consecutive_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failure_count >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    user_priority INTEGER NOT NULL DEFAULT 3 CHECK (user_priority BETWEEN 1 AND 5),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (
        (mistake_count = 0 AND first_mistake_at IS NULL AND last_mistake_at IS NULL)
        OR
        (mistake_count > 0 AND first_mistake_at IS NOT NULL AND last_mistake_at IS NOT NULL
            AND last_mistake_at >= first_mistake_at)
    )
) STRICT;

CREATE INDEX idx_mistake_profile_active_priority
    ON mistake_profile(active, user_priority DESC, last_mistake_at, question_id);

CREATE TABLE review_state (
    question_id TEXT PRIMARY KEY REFERENCES question(id) ON DELETE CASCADE,
    policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
    mastery_level TEXT NOT NULL CHECK (mastery_level IN ('new', 'learning', 'uncertain', 'mastered')),
    due_date TEXT NOT NULL CHECK (length(due_date) = 10),
    last_reviewed_at INTEGER,
    successful_streak INTEGER NOT NULL DEFAULT 0 CHECK (successful_streak >= 0),
    manual_pin_date TEXT CHECK (manual_pin_date IS NULL OR length(manual_pin_date) = 10),
    suspended_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX idx_review_state_due
    ON review_state(due_date, suspended_at, question_id);

CREATE INDEX idx_review_state_pin
    ON review_state(manual_pin_date, suspended_at, question_id);

CREATE TABLE review_event (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    attempt_id TEXT REFERENCES question_attempt(id) ON DELETE SET NULL,
    rating TEXT NOT NULL CHECK (rating IN ('mastered', 'uncertain', 'failed', 'skipped')),
    previous_due_date TEXT NOT NULL CHECK (length(previous_due_date) = 10),
    next_due_date TEXT NOT NULL CHECK (length(next_due_date) = 10),
    interval_days INTEGER NOT NULL CHECK (interval_days BETWEEN 1 AND 3650),
    policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
    created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_review_event_question_time
    ON review_event(question_id, created_at DESC, id DESC);

CREATE TABLE daily_review_queue (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
    queue_date TEXT NOT NULL CHECK (length(queue_date) = 10),
    quota INTEGER NOT NULL CHECK (quota BETWEEN 1 AND 100),
    generated_at INTEGER NOT NULL,
    completed_count INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
    UNIQUE(workspace_id, queue_date)
) STRICT;

CREATE TABLE daily_review_item (
    queue_id TEXT NOT NULL REFERENCES daily_review_queue(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    priority_score INTEGER NOT NULL CHECK (priority_score >= 0),
    selection_kind TEXT NOT NULL CHECK (selection_kind IN ('pinned', 'overdue', 'due', 'new', 'early', 'manual')),
    overdue_days INTEGER NOT NULL CHECK (overdue_days >= 0),
    failure_streak INTEGER NOT NULL CHECK (failure_streak >= 0),
    mistake_count INTEGER NOT NULL CHECK (mistake_count >= 0),
    user_priority INTEGER NOT NULL CHECK (user_priority BETWEEN 1 AND 5),
    knowledge_weakness INTEGER NOT NULL CHECK (knowledge_weakness BETWEEN 0 AND 2),
    days_since_attempt INTEGER NOT NULL CHECK (days_since_attempt >= 0),
    is_early INTEGER NOT NULL CHECK (is_early IN (0, 1)),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed')),
    review_event_id TEXT REFERENCES review_event(id) ON DELETE SET NULL,
    inserted_at INTEGER NOT NULL,
    completed_at INTEGER,
    PRIMARY KEY(queue_id, question_id),
    UNIQUE(queue_id, position),
    CHECK (
        (state = 'pending' AND review_event_id IS NULL AND completed_at IS NULL)
        OR
        (state = 'completed' AND review_event_id IS NOT NULL AND completed_at IS NOT NULL)
    )
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_daily_review_item_queue_state
    ON daily_review_item(queue_id, state, position);

CREATE INDEX idx_daily_review_item_question
    ON daily_review_item(question_id, queue_id);

INSERT INTO mistake_profile(
    question_id, first_mistake_at, last_mistake_at, mistake_count,
    consecutive_failure_count, active, user_priority, created_at, updated_at
)
SELECT
    question_id, MIN(attempted_at), MAX(attempted_at), COUNT(*),
    0, 1, 3, MIN(attempted_at), MAX(attempted_at)
FROM question_attempt
WHERE result = 'incorrect'
GROUP BY question_id;

INSERT INTO review_state(
    question_id, policy_version, mastery_level, due_date,
    last_reviewed_at, successful_streak, manual_pin_date, suspended_at,
    created_at, updated_at
)
SELECT
    question_id, 1, 'learning',
    strftime('%Y-%m-%d', last_mistake_at / 1000, 'unixepoch'),
    NULL, 0, NULL, NULL, created_at, updated_at
FROM mistake_profile;
