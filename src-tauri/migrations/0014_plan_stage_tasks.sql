CREATE TABLE plan_stage_task (
    task_id TEXT PRIMARY KEY REFERENCES task(id) ON DELETE CASCADE,
    stage_id TEXT REFERENCES plan_stage(id) ON DELETE SET NULL,
    generated_date TEXT NOT NULL
        CHECK (
            length(generated_date) = 10
            AND generated_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        ),
    created_at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX idx_plan_stage_task_stage_date
    ON plan_stage_task(stage_id, generated_date)
    WHERE stage_id IS NOT NULL;
