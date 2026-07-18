//! Cross-module reliability scenarios for the TV-02 `SQLite` experiment.

use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::process::Command;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::{Connection, TransactionBehavior};
use sha2::{Digest, Sha256};
use tempfile::tempdir;
use tv_02_sqlite::{AttemptReview, Database, DatabaseError, NewWorkspace};

fn open_fixture() -> (tempfile::TempDir, Database) {
    let directory = tempdir().expect("temporary directory should be created");
    let database_path = directory.path().join("workspace.sqlite3");
    let snapshots = directory.path().join("migration-snapshots");
    let (database, report) =
        Database::open(&database_path, &snapshots).expect("fixture database should open");
    assert_eq!(report.applied_versions, [1, 2]);
    (directory, database)
}

fn create_workspace_and_question(database: &Database) {
    database
        .create_workspace(NewWorkspace {
            id: "workspace-1",
            display_name: "TV-02 fixture",
            timezone: "Asia/Shanghai",
            created_at: 1,
        })
        .expect("workspace should be created");
    database
        .create_question("question-1", "workspace-1")
        .expect("question should be created");
}

#[test]
fn open_configures_foreign_keys_wal_and_fts5_then_reopens_idempotently() {
    let (directory, database) = open_fixture();
    let capabilities = database
        .capabilities()
        .expect("capabilities should be inspectable");

    assert!(capabilities.foreign_keys_enabled);
    assert_eq!(capabilities.journal_mode.to_ascii_lowercase(), "wal");
    assert!(capabilities.fts5_trigram_available);
    assert!(
        capabilities
            .compile_options
            .iter()
            .any(|option| option == "ENABLE_FTS5"),
        "bundled SQLite should report ENABLE_FTS5"
    );

    drop(database);
    let database_path = directory.path().join("workspace.sqlite3");
    let snapshots = directory.path().join("migration-snapshots");
    let (_, reopen_report) =
        Database::open(&database_path, &snapshots).expect("database should reopen");
    assert!(reopen_report.applied_versions.is_empty());
}

#[test]
fn create_question_rejects_missing_workspace_foreign_key() {
    let (_directory, database) = open_fixture();

    let error = database
        .create_question("orphan-question", "missing-workspace")
        .expect_err("orphan question must be rejected");

    assert_eq!(error.code(), "DATABASE_ERROR");
}

#[test]
fn record_attempt_and_review_rolls_back_attempt_when_event_is_duplicate() {
    let (_directory, mut database) = open_fixture();
    create_workspace_and_question(&database);
    database
        .record_attempt_and_review(AttemptReview {
            attempt_id: "attempt-1",
            review_event_id: "event-1",
            question_id: "question-1",
            workspace_id: "workspace-1",
            attempted_at: 10,
            next_due_date: "2026-07-19",
            mastered: false,
        })
        .expect("first atomic write should succeed");

    database
        .record_attempt_and_review(AttemptReview {
            attempt_id: "attempt-2",
            review_event_id: "event-1",
            question_id: "question-1",
            workspace_id: "workspace-1",
            attempted_at: 20,
            next_due_date: "2026-07-20",
            mastered: true,
        })
        .expect_err("duplicate immutable event should fail the transaction");

    database
        .record_attempt_and_review(AttemptReview {
            attempt_id: "attempt-2",
            review_event_id: "event-2",
            question_id: "question-1",
            workspace_id: "workspace-1",
            attempted_at: 20,
            next_due_date: "2026-07-20",
            mastered: true,
        })
        .expect("rolled-back attempt identifier should remain reusable");
}

#[test]
fn online_backup_restores_to_new_path_and_refuses_overwrite() {
    let (directory, database) = open_fixture();
    create_workspace_and_question(&database);
    let backup_path = directory.path().join("backups").join("workspace.sqlite3");
    let backup = database
        .create_backup(&backup_path)
        .expect("online backup should succeed");
    let restored_path = directory.path().join("restored").join("workspace.sqlite3");

    let restored = Database::restore_backup(&backup.path, &backup.sha256, &restored_path)
        .expect("verified backup should restore");
    assert_eq!(restored.sha256, backup.sha256);

    let error = Database::restore_backup(&backup.path, &backup.sha256, &restored_path)
        .expect_err("restore must not overwrite an existing database");
    assert!(matches!(error, DatabaseError::DestinationExists));
}

#[test]
fn corrupted_backup_is_rejected_before_destination_switch() {
    let (directory, database) = open_fixture();
    let backup_path = directory.path().join("backups").join("workspace.sqlite3");
    let backup = database
        .create_backup(&backup_path)
        .expect("online backup should succeed");
    let corrupted_path = directory.path().join("backups").join("corrupted.sqlite3");
    fs::copy(&backup.path, &corrupted_path).expect("backup copy should be created");
    let mut corrupted = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&corrupted_path)
        .expect("corrupted fixture should open");
    corrupted
        .seek(SeekFrom::Start(0))
        .expect("fixture should seek");
    corrupted
        .write_all(b"Not SQLite format")
        .expect("fixture header should be corrupted");
    corrupted.sync_all().expect("fixture should be durable");
    drop(corrupted);
    let corrupted_sha256 = sha256(&corrupted_path);
    let destination = directory
        .path()
        .join("restore-target")
        .join("workspace.sqlite3");

    Database::restore_backup(&corrupted_path, &corrupted_sha256, &destination)
        .expect_err("structurally damaged backup must be rejected");

    assert!(
        !destination.exists(),
        "failed restore must not switch destination"
    );
}

#[test]
fn second_writer_waits_for_first_writer_within_busy_timeout() {
    let (directory, database) = open_fixture();
    database
        .create_workspace(NewWorkspace {
            id: "workspace-lock",
            display_name: "Lock fixture",
            timezone: "Asia/Shanghai",
            created_at: 1,
        })
        .expect("workspace should be created");
    drop(database);
    let database_path = directory.path().join("workspace.sqlite3");
    let first_path = database_path.clone();
    let (ready_sender, ready_receiver) = mpsc::channel();
    let (release_sender, release_receiver) = mpsc::channel();

    let first_writer = thread::spawn(move || -> rusqlite::Result<()> {
        let mut connection = configured_connection(&first_path)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO task(id, workspace_id, planned_date, status, title, created_at)
             VALUES ('lock-1', 'workspace-lock', '2026-07-18', 'pending', 'First', 1)",
            [],
        )?;
        ready_sender
            .send(())
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        release_receiver
            .recv()
            .map_err(|_| rusqlite::Error::InvalidQuery)?;
        transaction.commit()
    });
    ready_receiver
        .recv()
        .expect("first writer should acquire the lock");

    let releaser = thread::spawn(move || {
        thread::sleep(Duration::from_millis(250));
        release_sender
            .send(())
            .expect("first writer should still be waiting");
    });
    let second = configured_connection(&database_path).expect("second connection should open");
    let started = Instant::now();
    second
        .execute(
            "INSERT INTO task(id, workspace_id, planned_date, status, title, created_at)
             VALUES ('lock-2', 'workspace-lock', '2026-07-18', 'pending', 'Second', 2)",
            [],
        )
        .expect("second writer should succeed after waiting");
    let waited = started.elapsed();

    releaser.join().expect("releaser should finish");
    first_writer
        .join()
        .expect("first writer thread should finish")
        .expect("first transaction should commit");
    assert!(
        waited >= Duration::from_millis(150),
        "writer did not wait: {waited:?}"
    );
    assert!(
        waited < Duration::from_secs(2),
        "writer exceeded timeout: {waited:?}"
    );
}

#[test]
fn writer_timeout_maps_to_stable_database_busy_error() {
    let (directory, database) = open_fixture();
    database
        .create_workspace(NewWorkspace {
            id: "workspace-timeout",
            display_name: "Timeout fixture",
            timezone: "Asia/Shanghai",
            created_at: 1,
        })
        .expect("workspace should be created");
    drop(database);
    let database_path = directory.path().join("workspace.sqlite3");
    let mut first = configured_connection(&database_path).expect("first connection should open");
    let first_transaction = first
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .expect("first writer should acquire the lock");
    let second = Connection::open(&database_path).expect("second connection should open");
    second
        .busy_timeout(Duration::from_millis(75))
        .expect("short timeout should configure");

    let sqlite_error = second
        .execute(
            "INSERT INTO task(id, workspace_id, planned_date, status, title, created_at)
             VALUES ('timeout-2', 'workspace-timeout', '2026-07-18', 'pending', 'Second', 2)",
            [],
        )
        .expect_err("second writer should time out while the first holds the lock");
    let database_error = DatabaseError::from(sqlite_error);

    assert_eq!(database_error.code(), "DATABASE_BUSY");
    first_transaction
        .rollback()
        .expect("first transaction should roll back");
}

#[test]
fn abrupt_process_exit_reopens_and_exposes_running_job_for_recovery() {
    let directory = tempdir().expect("temporary directory should be created");
    let database_path = directory.path().join("crash.sqlite3");
    let snapshots = directory.path().join("migration-snapshots");
    let status = Command::new(env!("CARGO_BIN_EXE_tv02-crash-writer"))
        .arg(&database_path)
        .arg(&snapshots)
        .status()
        .expect("crash writer should launch");
    assert!(!status.success(), "fixture should terminate abnormally");

    let (database, report) =
        Database::open(&database_path, &snapshots).expect("database should recover and reopen");
    let jobs = database
        .running_jobs("workspace-crash")
        .expect("running jobs should be queryable");
    let task_count = database
        .today_task_count("workspace-crash", "2026-07-18")
        .expect("committed task count should be queryable");

    assert!(report.applied_versions.is_empty());
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].id, "job-crash");
    assert_eq!(task_count, 0, "uncommitted crash write must be absent");
}

fn configured_connection(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let connection = Connection::open(path)?;
    connection.busy_timeout(Duration::from_secs(2))?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    Ok(connection)
}

fn sha256(path: &std::path::Path) -> String {
    let mut file = std::fs::File::open(path).expect("hash source should open");
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        let read = file
            .read(&mut buffer)
            .expect("hash source should be readable");
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0F)]));
    }
    encoded
}
