CREATE TABLE question_region_ocr (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    region_id TEXT NOT NULL REFERENCES question_region(id) ON DELETE CASCADE,
    engine TEXT NOT NULL CHECK (length(engine) BETWEEN 1 AND 120),
    recognized_text TEXT NOT NULL CHECK (length(recognized_text) <= 100000),
    confirmed_text TEXT CHECK (confirmed_text IS NULL OR length(trim(confirmed_text)) BETWEEN 1 AND 100000),
    mean_confidence REAL NOT NULL CHECK (mean_confidence >= 0.0 AND mean_confidence <= 1.0),
    state TEXT NOT NULL CHECK (state IN ('draft', 'confirmed', 'superseded')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
    CHECK (
        (state = 'draft' AND confirmed_text IS NULL)
        OR
        (state IN ('confirmed', 'superseded') AND confirmed_text IS NOT NULL)
    )
) STRICT;

CREATE UNIQUE INDEX idx_question_region_ocr_one_draft
    ON question_region_ocr(region_id) WHERE state = 'draft';

CREATE UNIQUE INDEX idx_question_region_ocr_one_confirmed
    ON question_region_ocr(region_id) WHERE state = 'confirmed';

CREATE INDEX idx_question_region_ocr_region_state
    ON question_region_ocr(region_id, state, updated_at DESC, id DESC);

CREATE TABLE question_region_ocr_line (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    recognition_id TEXT NOT NULL REFERENCES question_region_ocr(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
    confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    x REAL NOT NULL CHECK (x >= 0.0 AND x <= 1.0),
    y REAL NOT NULL CHECK (y >= 0.0 AND y <= 1.0),
    width REAL NOT NULL CHECK (width > 0.0 AND width <= 1.0 AND x + width <= 1.000001),
    height REAL NOT NULL CHECK (height > 0.0 AND height <= 1.0 AND y + height <= 1.000001),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    UNIQUE(recognition_id, sort_order)
) STRICT;
