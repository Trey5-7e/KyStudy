CREATE TABLE schema_migration (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE workspace (
    singleton_key INTEGER NOT NULL PRIMARY KEY CHECK (singleton_key = 1),
    id TEXT NOT NULL UNIQUE CHECK (length(id) = 36),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    exam_name TEXT CHECK (exam_name IS NULL OR length(exam_name) BETWEEN 1 AND 120),
    exam_date TEXT CHECK (exam_date IS NULL OR length(exam_date) = 10),
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 80),
    daily_review_quota INTEGER NOT NULL CHECK (daily_review_quota BETWEEN 1 AND 100),
    early_fill_enabled INTEGER NOT NULL CHECK (early_fill_enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
) STRICT;
