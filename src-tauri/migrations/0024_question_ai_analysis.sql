CREATE TABLE question_ai_analysis (
    question_id TEXT PRIMARY KEY REFERENCES question(id) ON DELETE CASCADE,
    source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) BETWEEN 1 AND 20000),
    call_id TEXT NOT NULL CHECK (length(call_id) = 36),
    response_text TEXT NOT NULL CHECK (length(trim(response_text)) BETWEEN 1 AND 20000),
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    finished_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_question_ai_analysis_finished_at
    ON question_ai_analysis(finished_at DESC, question_id);
