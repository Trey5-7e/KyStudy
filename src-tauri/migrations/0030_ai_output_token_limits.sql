-- Relax conservative token defaults on existing models so detailed AI answers are never prematurely truncated.
UPDATE ai_model_profile
SET max_output_tokens = 131072
WHERE max_output_tokens <= 8192;

-- Relax single call budget warning limit to 100000 to accommodate unlimited output lengths.
UPDATE ai_budget
SET single_call_limit = 100000
WHERE single_call_limit <= 16000;
