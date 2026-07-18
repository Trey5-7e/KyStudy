use std::fs;
use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, TransactionBehavior, params};

use crate::backup::{create_online_backup, restore_verified_backup};
use crate::integrity::verify_connection;
use crate::migration::migrate;
use crate::{
    AttemptReview, BackupArtifact, CapabilityReport, DatabaseError, HealthReport, NewWorkspace,
    OpenReport, Result, RunningJob,
};

const BUSY_TIMEOUT: Duration = Duration::from_secs(2);
const MINIMUM_SAFE_SQLITE_VERSION: i32 = 3_051_003;

/// Purpose-specific Rust database boundary for the TV-02 experiment.
pub struct Database {
    pub(crate) connection: Connection,
}

impl Database {
    /// Opens or creates a workspace database, configures the connection, and applies migrations.
    ///
    /// `snapshot_directory` receives a verified snapshot before any pending high-risk migration.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if the directory, connection, configuration, backup, or migration
    /// cannot be completed safely.
    pub fn open(database_path: &Path, snapshot_directory: &Path) -> Result<(Self, OpenReport)> {
        let parent = database_path
            .parent()
            .ok_or(DatabaseError::UnsupportedConfiguration {
                reason: "database path has no parent directory",
            })?;
        fs::create_dir_all(parent)?;

        let mut connection = Connection::open_with_flags(
            database_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        configure_connection(&connection)?;
        let report = migrate(&mut connection, snapshot_directory)?;
        verify_connection(&connection)?;

        Ok((Self { connection }, report))
    }

    /// Creates one workspace record through a parameterized backend operation.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if validation constraints or persistence fail.
    pub fn create_workspace(&self, workspace: NewWorkspace<'_>) -> Result<()> {
        self.connection.execute(
            "INSERT INTO workspace(id, display_name, timezone, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                workspace.id,
                workspace.display_name,
                workspace.timezone,
                workspace.created_at
            ],
        )?;
        Ok(())
    }

    /// Creates a minimal question used by attempt and review use cases.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if the workspace does not exist or persistence fails.
    pub fn create_question(&self, id: &str, workspace_id: &str) -> Result<()> {
        self.connection.execute(
            "INSERT INTO question(id, workspace_id) VALUES (?1, ?2)",
            params![id, workspace_id],
        )?;
        Ok(())
    }

    /// Creates one dated task without exposing the underlying table shape.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if the workspace does not exist, values violate constraints, or
    /// persistence fails.
    pub fn create_task(
        &self,
        id: &str,
        workspace_id: &str,
        planned_date: &str,
        title: &str,
        created_at: i64,
    ) -> Result<()> {
        self.connection.execute(
            "INSERT INTO task(id, workspace_id, planned_date, status, title, created_at)
             VALUES (?1, ?2, ?3, 'pending', ?4, ?5)",
            params![id, workspace_id, planned_date, title, created_at],
        )?;
        Ok(())
    }

    /// Atomically records an attempt, immutable review event, and current review state.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] and rolls back all three writes if any constraint or database
    /// operation fails.
    pub fn record_attempt_and_review(&mut self, input: AttemptReview<'_>) -> Result<()> {
        let outcome = if input.mastered { "mastered" } else { "failed" };
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;

        transaction.execute(
            "INSERT INTO attempt(id, question_id, outcome, attempted_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                input.attempt_id,
                input.question_id,
                outcome,
                input.attempted_at
            ],
        )?;
        transaction.execute(
            "INSERT INTO review_event(id, question_id, attempt_id, rating, next_due_date, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                input.review_event_id,
                input.question_id,
                input.attempt_id,
                outcome,
                input.next_due_date,
                input.attempted_at
            ],
        )?;
        transaction.execute(
            "INSERT INTO review_state(question_id, workspace_id, due_date, suspended_at, successful_streak)
             VALUES (?1, ?2, ?3, NULL, ?4)
             ON CONFLICT(question_id) DO UPDATE SET
                due_date = excluded.due_date,
                successful_streak = CASE
                    WHEN ?5 = 'mastered' THEN review_state.successful_streak + 1
                    ELSE 0
                END",
            params![
                input.question_id,
                input.workspace_id,
                input.next_due_date,
                i64::from(input.mastered),
                outcome
            ],
        )?;

        transaction.commit()?;
        Ok(())
    }

    /// Persists a recoverable background job before work begins.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if the workspace does not exist or persistence fails.
    pub fn start_processing_job(
        &self,
        id: &str,
        workspace_id: &str,
        kind: &str,
        started_at: i64,
    ) -> Result<()> {
        self.connection.execute(
            "INSERT INTO processing_job(id, workspace_id, kind, state, started_at, updated_at)
             VALUES (?1, ?2, ?3, 'running', ?4, ?4)",
            params![id, workspace_id, kind, started_at],
        )?;
        Ok(())
    }

    /// Lists jobs that need recovery handling after startup.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if the typed query cannot be prepared or read.
    pub fn running_jobs(&self, workspace_id: &str) -> Result<Vec<RunningJob>> {
        let mut statement = self.connection.prepare(
            "SELECT id, kind, updated_at FROM processing_job
             WHERE workspace_id = ?1 AND state = 'running'
             ORDER BY updated_at ASC, id ASC",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok(RunningJob {
                id: row.get(0)?,
                kind: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Counts non-completed tasks on one local calendar date.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if the query fails.
    pub fn today_task_count(&self, workspace_id: &str, date: &str) -> Result<u64> {
        let count = self.connection.query_row(
            "SELECT COUNT(*) FROM task
             WHERE workspace_id = ?1 AND planned_date = ?2
               AND status IN ('pending', 'in_progress')",
            params![workspace_id, date],
            |row| row.get::<_, i64>(0),
        )?;
        u64::try_from(count).map_err(|_| DatabaseError::ValueOutOfRange)
    }

    /// Counts active review states due on or before one local date.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if the query fails.
    pub fn due_review_count(&self, workspace_id: &str, date: &str) -> Result<u64> {
        let count = self.connection.query_row(
            "SELECT COUNT(*) FROM review_state
             WHERE workspace_id = ?1 AND due_date <= ?2 AND suspended_at IS NULL",
            params![workspace_id, date],
            |row| row.get::<_, i64>(0),
        )?;
        u64::try_from(count).map_err(|_| DatabaseError::ValueOutOfRange)
    }

    /// Runs structural and referential-integrity checks.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] when `SQLite` reports damage, foreign-key violations, or a query
    /// failure.
    pub fn health(&self) -> Result<HealthReport> {
        verify_connection(&self.connection)
    }

    /// Reports the exact `SQLite` runtime, compile options, and required connection capabilities.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if capability inspection or the FTS5 trigram probe fails.
    pub fn capabilities(&self) -> Result<CapabilityReport> {
        let (sqlite_version, sqlite_source_id) = self.connection.query_row(
            "SELECT sqlite_version(), sqlite_source_id()",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )?;
        let mut compile_statement = self.connection.prepare("PRAGMA compile_options")?;
        let compile_options = compile_statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let journal_mode = self
            .connection
            .pragma_query_value(None, "journal_mode", |row| row.get::<_, String>(0))?;
        let foreign_keys_enabled =
            self.connection
                .pragma_query_value(None, "foreign_keys", |row| row.get::<_, bool>(0))?;

        Ok(CapabilityReport {
            sqlite_version,
            sqlite_source_id,
            compile_options,
            journal_mode,
            foreign_keys_enabled,
            fts5_trigram_available: probe_fts5_trigram(&self.connection)?,
        })
    }

    /// Creates and verifies a consistent online backup without overwriting files.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if the destination exists or backup and verification fail.
    pub fn create_backup(&self, destination: &Path) -> Result<BackupArtifact> {
        create_online_backup(&self.connection, destination)
    }

    /// Restores a verified backup through a temporary file and never overwrites the destination.
    ///
    /// # Errors
    ///
    /// Returns [`DatabaseError`] if the checksum, schema, integrity, filesystem, or destination
    /// protection check fails.
    pub fn restore_backup(
        backup_path: &Path,
        expected_sha256: &str,
        destination: &Path,
    ) -> Result<BackupArtifact> {
        restore_verified_backup(backup_path, expected_sha256, destination)
    }

    pub(crate) fn query_plan(&self, sql: &str, first: &str, second: &str) -> Result<Vec<String>> {
        let explain = format!("EXPLAIN QUERY PLAN {sql}");
        let mut statement = self.connection.prepare(&explain)?;
        let rows = statement.query_map(params![first, second], |row| row.get::<_, String>(3))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }
}

pub(crate) fn configure_connection(connection: &Connection) -> Result<()> {
    if rusqlite::version_number() < MINIMUM_SAFE_SQLITE_VERSION {
        return Err(DatabaseError::UnsupportedConfiguration {
            reason: "SQLite must be 3.51.3 or newer because earlier WAL builds have a known corruption bug",
        });
    }

    connection.busy_timeout(BUSY_TIMEOUT)?;
    connection.pragma_update(None, "foreign_keys", true)?;
    let foreign_keys =
        connection.pragma_query_value(None, "foreign_keys", |row| row.get::<_, bool>(0))?;
    if !foreign_keys {
        return Err(DatabaseError::UnsupportedConfiguration {
            reason: "foreign-key enforcement could not be enabled",
        });
    }

    let journal_mode = connection
        .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(DatabaseError::UnsupportedConfiguration {
            reason: "WAL mode could not be enabled",
        });
    }

    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "trusted_schema", false)?;
    Ok(())
}

fn probe_fts5_trigram(connection: &Connection) -> Result<bool> {
    let probe_result = (|| {
        connection.execute_batch(
            "DROP TABLE IF EXISTS temp.tv02_fts_probe;
             CREATE VIRTUAL TABLE temp.tv02_fts_probe USING fts5(content, tokenize='trigram');
             INSERT INTO temp.tv02_fts_probe(content) VALUES ('线性代数错题复习');",
        )?;
        let count = connection.query_row(
            "SELECT COUNT(*) FROM temp.tv02_fts_probe WHERE tv02_fts_probe MATCH '线性代数'",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        Ok::<bool, rusqlite::Error>(count == 1)
    })();
    let _ = connection.execute_batch("DROP TABLE IF EXISTS temp.tv02_fts_probe;");
    Ok(probe_result?)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tempfile::tempdir;

    #[test]
    fn configure_connection_enables_required_pragmas() {
        let directory = tempdir().expect("temporary directory should be created");
        let connection = Connection::open(directory.path().join("connection.sqlite3"))
            .expect("file database should open");

        super::configure_connection(&connection).expect("connection should configure");

        let foreign_keys: bool = connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .expect("foreign-key setting should be readable");
        assert!(foreign_keys);
    }
}
