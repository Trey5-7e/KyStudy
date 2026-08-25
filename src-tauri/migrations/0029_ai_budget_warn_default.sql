-- The initial v1.3 defaults were intentionally conservative and used hard
-- blocking. Preserve explicit custom budgets, but make the untouched default
-- profile informational so normal AI conversations are not blocked by an
-- estimate alone. Users can still opt into hard blocking in Model & API.
UPDATE ai_budget
SET limit_mode = 'warn'
WHERE single_call_limit = 8000
  AND daily_token_limit = 50000
  AND monthly_token_limit = 1000000
  AND limit_mode = 'block';
