use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, TransactionBehavior, params};
use sha2::{Digest, Sha256};

use crate::backup::create_online_backup;
use crate::integrity::table_exists;
use crate::time::now_utc_millis;
use crate::{DatabaseError, OpenReport, Result};

pub(crate) const LATEST_SCHEMA_VERSION: i64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MigrationRisk {
    Low,
    High,
}

#[derive(Debug, Clone, Copy)]
struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
    risk: MigrationRisk,
}

const MIGRATION_001: Migration = Migration {
    version: 1,
    name: "workspace_and_processing_jobs",
    risk: MigrationRisk::Low,
    sql: r"
        CREATE TABLE workspace (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
            timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 80),
            created_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE processing_job (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
            kind TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'succeeded', 'failed', 'canceled')),
            started_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX idx_processing_job_recovery
            ON processing_job(workspace_id, state, updated_at);
    ",
};

const MIGRATION_002: Migration = Migration {
    version: 2,
    name: "task_attempt_and_review_probe",
    risk: MigrationRisk::High,
    sql: r"
        CREATE TABLE task (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
            planned_date TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'canceled')),
            title TEXT NOT NULL,
            created_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX idx_task_today
            ON task(workspace_id, planned_date, status);

        CREATE TABLE question (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE
        ) STRICT;

        CREATE INDEX idx_question_workspace ON question(workspace_id);

        CREATE TABLE attempt (
            id TEXT PRIMARY KEY,
            question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
            outcome TEXT NOT NULL CHECK (outcome IN ('mastered', 'failed')),
            attempted_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX idx_attempt_question_time
            ON attempt(question_id, attempted_at);

        CREATE TABLE review_state (
            question_id TEXT PRIMARY KEY REFERENCES question(id) ON DELETE CASCADE,
            workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
            due_date TEXT NOT NULL,
            suspended_at INTEGER,
            successful_streak INTEGER NOT NULL DEFAULT 0 CHECK (successful_streak >= 0)
        ) STRICT;

        CREATE INDEX idx_review_due
            ON review_state(workspace_id, due_date, suspended_at);

        CREATE TABLE review_event (
            id TEXT PRIMARY KEY,
            question_id TEXT NOT NULL REFERENCES question(id) ON DELETE CASCADE,
            attempt_id TEXT NOT NULL REFERENCES attempt(id) ON DELETE RESTRICT,
            rating TEXT NOT NULL CHECK (rating IN ('mastered', 'failed')),
            next_due_date TEXT NOT NULL,
            created_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX idx_review_event_question_time
            ON review_event(question_id, created_at);
    ",
};

const MIGRATIONS: &[Migration] = &[MIGRATION_001, MIGRATION_002];

pub(crate) fn migrate(
    connection: &mut Connection,
    snapshot_directory: &Path,
) -> Result<OpenReport> {
    migrate_with(connection, snapshot_directory, MIGRATIONS)
}

fn migrate_with(
    connection: &mut Connection,
    snapshot_directory: &Path,
    migrations: &[Migration],
) -> Result<OpenReport> {
    validate_embedded_migrations(migrations)?;
    let latest = migrations.last().map_or(0, |migration| migration.version);
    let current = current_version(connection)?;
    if current > latest {
        return Err(DatabaseError::UnsupportedSchema {
            found: current,
            supported: latest,
        });
    }

    validate_applied_migrations(connection, migrations, current)?;
    let pending = migrations
        .iter()
        .filter(|migration| migration.version > current)
        .copied()
        .collect::<Vec<_>>();

    let migration_snapshot = if current > 0
        && pending
            .iter()
            .any(|migration| migration.risk == MigrationRisk::High)
    {
        fs::create_dir_all(snapshot_directory)?;
        let snapshot_path =
            unique_snapshot_path(snapshot_directory, current, latest, now_utc_millis()?);
        Some(create_online_backup(connection, &snapshot_path)?)
    } else {
        None
    };

    let applied_versions = apply_migrations(connection, &pending)?;

    Ok(OpenReport {
        applied_versions,
        migration_snapshot,
    })
}

pub(crate) fn current_version(connection: &Connection) -> Result<i64> {
    if !table_exists(connection, "schema_migration")? {
        let user_version = pragma_user_version(connection)?;
        if user_version != 0 || has_untracked_application_tables(connection)? {
            return Err(DatabaseError::InconsistentMigrationHistory);
        }
        return Ok(0);
    }

    let version = connection.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migration",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if pragma_user_version(connection)? != version {
        return Err(DatabaseError::InconsistentMigrationHistory);
    }
    Ok(version)
}

fn apply_migrations(connection: &mut Connection, migrations: &[Migration]) -> Result<Vec<i64>> {
    if migrations.is_empty() {
        return Ok(Vec::new());
    }

    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    transaction.execute_batch(
        r"
        CREATE TABLE IF NOT EXISTS schema_migration (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            checksum TEXT NOT NULL,
            applied_at INTEGER NOT NULL
        ) STRICT;
        ",
    )?;

    let mut applied = Vec::with_capacity(migrations.len());
    for migration in migrations {
        transaction.execute_batch(migration.sql).map_err(|source| {
            DatabaseError::MigrationFailed {
                version: migration.version,
                source,
            }
        })?;
        transaction.execute(
            "INSERT INTO schema_migration(version, name, checksum, applied_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                migration.version,
                migration.name,
                migration_checksum(migration),
                now_utc_millis()?
            ],
        )?;
        transaction.pragma_update(None, "user_version", migration.version)?;
        applied.push(migration.version);
    }

    transaction.commit()?;
    Ok(applied)
}

fn validate_applied_migrations(
    connection: &Connection,
    migrations: &[Migration],
    current: i64,
) -> Result<()> {
    if current == 0 {
        return Ok(());
    }

    let mut statement = connection
        .prepare("SELECT version, name, checksum FROM schema_migration ORDER BY version ASC")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let applied = rows.collect::<rusqlite::Result<Vec<_>>>()?;

    if i64::try_from(applied.len()).map_err(|_| DatabaseError::ValueOutOfRange)? != current {
        return Err(DatabaseError::InconsistentMigrationHistory);
    }

    for (index, (version, name, checksum)) in applied.iter().enumerate() {
        let expected = migrations
            .get(index)
            .ok_or(DatabaseError::UnsupportedSchema {
                found: *version,
                supported: LATEST_SCHEMA_VERSION,
            })?;
        if *version != expected.version || name != expected.name {
            return Err(DatabaseError::InconsistentMigrationHistory);
        }
        if checksum != &migration_checksum(expected) {
            return Err(DatabaseError::MigrationChecksumMismatch { version: *version });
        }
    }

    Ok(())
}

fn validate_embedded_migrations(migrations: &[Migration]) -> Result<()> {
    for (index, migration) in migrations.iter().enumerate() {
        let expected = i64::try_from(index + 1).map_err(|_| DatabaseError::ValueOutOfRange)?;
        if migration.version != expected {
            return Err(DatabaseError::InconsistentMigrationHistory);
        }
    }
    Ok(())
}

fn migration_checksum(migration: &Migration) -> String {
    let mut hasher = Sha256::new();
    hasher.update(migration.version.to_le_bytes());
    hasher.update(migration.name.as_bytes());
    hasher.update(migration.sql.as_bytes());
    let digest = hasher.finalize();
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0F)]));
    }
    encoded
}

fn pragma_user_version(connection: &Connection) -> Result<i64> {
    Ok(connection.pragma_query_value(None, "user_version", |row| row.get(0))?)
}

fn has_untracked_application_tables(connection: &Connection) -> Result<bool> {
    let count = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(count > 0)
}

fn unique_snapshot_path(directory: &Path, from: i64, to: i64, timestamp: i64) -> PathBuf {
    directory.join(format!(
        "migration-v{from}-to-v{to}-{timestamp}-{}.sqlite3",
        std::process::id()
    ))
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tempfile::tempdir;

    use super::{
        MIGRATION_001, MIGRATIONS, Migration, MigrationRisk, apply_migrations, current_version,
        migrate_with, migration_checksum, validate_applied_migrations,
    };
    use crate::DatabaseError;

    #[test]
    fn apply_migrations_rolls_back_all_schema_changes_when_later_sql_fails() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        let invalid = Migration {
            version: 2,
            name: "invalid_probe",
            sql: "CREATE TABLE partial_probe(id INTEGER); INVALID SQL;",
            risk: MigrationRisk::High,
        };

        let error = apply_migrations(&mut connection, &[MIGRATION_001, invalid])
            .expect_err("invalid migration should fail");

        assert!(
            matches!(error, DatabaseError::MigrationFailed { version: 2, .. }),
            "unexpected error: {error:?}"
        );
        assert_eq!(
            current_version(&connection).expect("rolled-back database should be readable"),
            0
        );
    }

    #[test]
    fn validate_applied_migrations_rejects_checksum_drift() {
        let mut connection = Connection::open_in_memory().expect("in-memory database should open");
        apply_migrations(&mut connection, &[MIGRATION_001]).expect("first migration should apply");
        connection
            .execute(
                "UPDATE schema_migration SET checksum = 'changed' WHERE version = 1",
                [],
            )
            .expect("test should alter migration history");

        let error = validate_applied_migrations(&connection, MIGRATIONS, 1)
            .expect_err("checksum drift must be rejected");

        assert!(matches!(
            error,
            DatabaseError::MigrationChecksumMismatch { version: 1 }
        ));
    }

    #[test]
    fn migration_checksum_is_deterministic() {
        assert_eq!(
            migration_checksum(&MIGRATION_001),
            migration_checksum(&MIGRATION_001)
        );
    }

    #[test]
    fn high_risk_pending_migration_creates_verified_snapshot() {
        let directory = tempdir().expect("temporary directory should be created");
        let database_path = directory.path().join("workspace.sqlite3");
        let snapshot_directory = directory.path().join("snapshots");
        let mut connection = Connection::open(&database_path).expect("database should open");
        crate::database::configure_connection(&connection).expect("connection should configure");
        apply_migrations(&mut connection, &[MIGRATION_001]).expect("first migration should apply");

        let report = super::migrate(&mut connection, &snapshot_directory)
            .expect("second migration should apply");
        let snapshot = report
            .migration_snapshot
            .expect("high-risk migration should create a snapshot");

        assert!(snapshot.path.exists(), "snapshot should remain available");
    }

    #[test]
    fn failed_high_risk_migration_preserves_and_restores_pre_migration_snapshot() {
        let directory = tempdir().expect("temporary directory should be created");
        let database_path = directory.path().join("workspace.sqlite3");
        let snapshot_directory = directory.path().join("snapshots");
        let mut connection = Connection::open(&database_path).expect("database should open");
        crate::database::configure_connection(&connection).expect("connection should configure");
        apply_migrations(&mut connection, &[MIGRATION_001]).expect("first migration should apply");
        let invalid = Migration {
            version: 2,
            name: "invalid_high_risk_probe",
            sql: "CREATE TABLE partial_probe(id INTEGER); INVALID SQL;",
            risk: MigrationRisk::High,
        };

        migrate_with(
            &mut connection,
            &snapshot_directory,
            &[MIGRATION_001, invalid],
        )
        .expect_err("invalid high-risk migration should fail");
        assert_eq!(
            current_version(&connection).expect("source should remain readable"),
            1
        );
        drop(connection);

        let snapshot_path = std::fs::read_dir(&snapshot_directory)
            .expect("snapshot directory should be readable")
            .next()
            .expect("failed migration should leave a snapshot entry")
            .expect("snapshot entry should be readable")
            .path();
        let snapshot = crate::backup::inspect_backup(&snapshot_path)
            .expect("pre-migration snapshot should be valid");
        let restored_path = directory.path().join("restored.sqlite3");
        let restored = crate::backup::restore_verified_backup(
            &snapshot.path,
            &snapshot.sha256,
            &restored_path,
        )
        .expect("known older schema should restore safely");

        assert_eq!(restored.schema_version, 1);
    }
}
