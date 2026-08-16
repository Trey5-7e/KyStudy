CREATE TABLE question_ai_analysis_history (
    id TEXT PRIMARY KEY CHECK (length(id) = 36),
    question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    source_fingerprint TEXT NOT NULL CHECK (length(source_fingerprint) BETWEEN 1 AND 20000),
    call_id TEXT NOT NULL CHECK (length(call_id) = 36),
    response_text TEXT NOT NULL CHECK (length(trim(response_text)) BETWEEN 1 AND 20000),
    input_tokens INTEGER NOT NULL CHECK (input_tokens >= 0),
    output_tokens INTEGER NOT NULL CHECK (output_tokens >= 0),
    cached_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
    reasoning_tokens INTEGER NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
    finished_at INTEGER NOT NULL
) STRICT, WITHOUT ROWID;

CREATE INDEX idx_question_ai_analysis_history_question
    ON question_ai_analysis_history(question_id, finished_at DESC);

INSERT INTO question_ai_analysis_history(
    id, question_id, source_fingerprint, call_id, response_text,
    input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, finished_at
)
SELECT
    call_id, question_id, source_fingerprint, call_id, response_text,
    input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, finished_at
FROM question_ai_analysis;
