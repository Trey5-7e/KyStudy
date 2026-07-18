//! Helper process that persists a recoverable job and terminates without running destructors.

use std::path::Path;
use std::process::ExitCode;
use std::time::Duration;

use rusqlite::{Connection, params};
use tv_02_sqlite::{Database, NewWorkspace};

fn main() -> ExitCode {
    let arguments = std::env::args_os().collect::<Vec<_>>();
    let Some(database_path) = arguments.get(1) else {
        eprintln!("missing database path");
        return ExitCode::FAILURE;
    };
    let Some(snapshot_directory) = arguments.get(2) else {
        eprintln!("missing snapshot directory");
        return ExitCode::FAILURE;
    };

    let result = persist_running_job(Path::new(database_path), Path::new(snapshot_directory));
    if let Err(error) = result {
        eprintln!("crash fixture setup failed ({}): {error}", error.code());
        return ExitCode::FAILURE;
    }
    let uncommitted_connection = match begin_uncommitted_write(Path::new(database_path)) {
        Ok(connection) => connection,
        Err(error) => {
            eprintln!(
                "uncommitted crash fixture failed ({}): {error}",
                error.code()
            );
            return ExitCode::FAILURE;
        }
    };
    std::hint::black_box(&uncommitted_connection);

    // `process::exit` deliberately skips destructors and simulates abrupt application termination.
    std::process::exit(86);
}

fn persist_running_job(
    database_path: &Path,
    snapshot_directory: &Path,
) -> tv_02_sqlite::Result<()> {
    let (database, _) = Database::open(database_path, snapshot_directory)?;
    database.create_workspace(NewWorkspace {
        id: "workspace-crash",
        display_name: "Crash recovery fixture",
        timezone: "Asia/Shanghai",
        created_at: 1,
    })?;
    database.start_processing_job("job-crash", "workspace-crash", "pdf_parse_probe", 2)?;
    Ok(())
}

fn begin_uncommitted_write(database_path: &Path) -> tv_02_sqlite::Result<Connection> {
    let connection = Connection::open(database_path)?;
    connection.busy_timeout(Duration::from_secs(2))?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.execute_batch("BEGIN IMMEDIATE")?;
    connection.execute(
        "INSERT INTO task(id, workspace_id, planned_date, status, title, created_at)
         VALUES (?1, ?2, ?3, 'pending', ?4, ?5)",
        params![
            "task-uncommitted-crash",
            "workspace-crash",
            "2026-07-18",
            "Must roll back",
            3
        ],
    )?;
    Ok(connection)
}
