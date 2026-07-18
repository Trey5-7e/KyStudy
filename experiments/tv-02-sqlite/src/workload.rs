use std::hint::black_box;
use std::time::Instant;

use rusqlite::{TransactionBehavior, params};
use tempfile::tempdir;

use crate::{Database, DatabaseError, NewWorkspace, Result, ScaleReport};

const TASK_ROWS: u64 = 10_000;
const ATTEMPT_AND_REVIEW_ROWS: u64 = 100_000;
const QUERY_REPETITIONS: u128 = 500;
const WORKSPACE_ID: &str = "workspace-scale";
const TODAY: &str = "2026-07-18";

/// Generates the deterministic TV-02 scale fixture and returns release-mode measurements.
///
/// All files live in an automatically deleted temporary directory.
///
/// # Errors
///
/// Returns [`DatabaseError`] if setup, data generation, queries, backup, restore, or verification
/// fail.
pub fn run_scale_probe() -> Result<ScaleReport> {
    let directory = tempdir()?;
    let database_path = directory.path().join("scale.sqlite3");
    let snapshot_directory = directory.path().join("migration-snapshots");
    let (mut database, _) = Database::open(&database_path, &snapshot_directory)?;
    let capabilities = database.capabilities()?;
    database.create_workspace(NewWorkspace {
        id: WORKSPACE_ID,
        display_name: "TV-02 scale fixture",
        timezone: "Asia/Shanghai",
        created_at: 0,
    })?;

    let seed_started = Instant::now();
    seed_fixture(&mut database)?;
    let seed_millis = seed_started.elapsed().as_millis();
    database.connection.execute_batch("PRAGMA optimize;")?;

    let today_query_mean_micros = measure_mean_micros(|| {
        (black_box(database.today_task_count(WORKSPACE_ID, TODAY)?) == 2_500)
            .then_some(())
            .ok_or(DatabaseError::UnsupportedConfiguration {
                reason: "today-task scale query returned an unexpected count",
            })
    })?;
    let due_review_query_mean_micros = measure_mean_micros(|| {
        (black_box(database.due_review_count(WORKSPACE_ID, TODAY)?) == 60_000)
            .then_some(())
            .ok_or(DatabaseError::UnsupportedConfiguration {
                reason: "due-review scale query returned an unexpected count",
            })
    })?;

    let today_query_plan = database.query_plan(
        "SELECT COUNT(*) FROM task
         WHERE workspace_id = ?1 AND planned_date = ?2
           AND status IN ('pending', 'in_progress')",
        WORKSPACE_ID,
        TODAY,
    )?;
    let due_review_query_plan = database.query_plan(
        "SELECT COUNT(*) FROM review_state
         WHERE workspace_id = ?1 AND due_date <= ?2 AND suspended_at IS NULL",
        WORKSPACE_ID,
        TODAY,
    )?;

    let backup_path = directory.path().join("backups").join("scale.sqlite3");
    let backup_started = Instant::now();
    let backup = database.create_backup(&backup_path)?;
    let backup_millis = backup_started.elapsed().as_millis();

    let restore_path = directory.path().join("restored").join("workspace.sqlite3");
    let restore_started = Instant::now();
    Database::restore_backup(&backup.path, &backup.sha256, &restore_path)?;
    let restore_millis = restore_started.elapsed().as_millis();

    Ok(ScaleReport {
        capabilities,
        task_rows: TASK_ROWS,
        attempt_rows: ATTEMPT_AND_REVIEW_ROWS,
        review_event_rows: ATTEMPT_AND_REVIEW_ROWS,
        seed_millis,
        today_query_mean_micros,
        due_review_query_mean_micros,
        backup_millis,
        restore_millis,
        backup_bytes: backup.bytes,
        today_query_plan,
        due_review_query_plan,
    })
}

fn seed_fixture(database: &mut Database) -> Result<()> {
    let transaction = database
        .connection
        .transaction_with_behavior(TransactionBehavior::Immediate)?;

    {
        let mut insert_task = transaction.prepare(
            "INSERT INTO task(id, workspace_id, planned_date, status, title, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for index in 0..TASK_ROWS {
            let date = if index % 2 == 0 { TODAY } else { "2026-07-19" };
            let status = if index % 4 == 0 {
                "completed"
            } else {
                "pending"
            };
            insert_task.execute(params![
                format!("task-{index:05}"),
                WORKSPACE_ID,
                date,
                status,
                format!("Task {index}"),
                i64::try_from(index).map_err(|_| DatabaseError::ValueOutOfRange)?
            ])?;
        }
    }

    {
        let mut insert_question =
            transaction.prepare("INSERT INTO question(id, workspace_id) VALUES (?1, ?2)")?;
        let mut insert_attempt = transaction.prepare(
            "INSERT INTO attempt(id, question_id, outcome, attempted_at) VALUES (?1, ?2, ?3, ?4)",
        )?;
        let mut insert_review_state = transaction.prepare(
            "INSERT INTO review_state(question_id, workspace_id, due_date, suspended_at, successful_streak)
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )?;
        let mut insert_review_event = transaction.prepare(
            "INSERT INTO review_event(id, question_id, attempt_id, rating, next_due_date, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;

        for index in 0..ATTEMPT_AND_REVIEW_ROWS {
            let question_id = format!("question-{index:06}");
            let attempt_id = format!("attempt-{index:06}");
            let due_date = match index % 3 {
                0 => "2026-07-17",
                1 => TODAY,
                _ => "2026-07-19",
            };
            let suspended_at = (index % 10 == 0).then_some(1_i64);
            let timestamp = i64::try_from(index).map_err(|_| DatabaseError::ValueOutOfRange)?;

            insert_question.execute(params![question_id, WORKSPACE_ID])?;
            insert_attempt.execute(params![attempt_id, question_id, "failed", timestamp])?;
            insert_review_state.execute(params![
                question_id,
                WORKSPACE_ID,
                due_date,
                suspended_at,
                0
            ])?;
            insert_review_event.execute(params![
                format!("review-{index:06}"),
                question_id,
                attempt_id,
                "failed",
                due_date,
                timestamp
            ])?;
        }
    }

    transaction.commit()?;
    Ok(())
}

fn measure_mean_micros(mut query: impl FnMut() -> Result<()>) -> Result<u128> {
    let started = Instant::now();
    for _ in 0..QUERY_REPETITIONS {
        query()?;
    }
    Ok(started.elapsed().as_micros() / QUERY_REPETITIONS)
}
