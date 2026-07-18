use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, ErrorCode, OpenFlags, OptionalExtension, TransactionBehavior, params};
use sha2::{Digest, Sha256};

use crate::application::{PersistenceError, WorkspaceRepository, current_utc_millis};
use crate::domain::{LATEST_SCHEMA_VERSION, NewWorkspace, Workspace};

const APPLICATION_ID: i32 = 0x4B59_5354;
const BUSY_TIMEOUT: Duration = Duration::from_secs(2);
pub(crate) const DATABASE_FILE_NAME: &str = "kystudy.sqlite3";
const DEFAULT_WORKSPACE_DIRECTORY: &str = "default";
const MINIMUM_SAFE_SQLITE_VERSION: i32 = 3_051_003;

#[derive(Debug, Clone, Copy)]
struct Migration {
    version: u32,
    name: &'static str,
    sql: &'static str,
}

const MIGRATION_001: Migration = Migration {
    version: 1,
    name: "workspace_foundation",
    sql: include_str!("../../migrations/0001_workspace.sql"),
};
const MIGRATION_002: Migration = Migration {
    version: 2,
    name: "blob_import_foundation",
    sql: include_str!("../../migrations/0002_blob_import.sql"),
};
const MIGRATION_003: Migration = Migration {
    version: 3,
    name: "schedule_foundation",
    sql: include_str!("../../migrations/0003_schedule_foundation.sql"),
};
const MIGRATIONS: &[Migration] = &[MIGRATION_001, MIGRATION_002, MIGRATION_003];

/// `rusqlite` adapter for the single local workspace used in M1.
#[derive(Debug, Clone)]
pub(crate) struct SqliteWorkspaceRepository {
    workspaces_root: PathBuf,
}

impl SqliteWorkspaceRepository {
    /// Creates an adapter rooted below the application-owned data directory.
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        Self {
            workspaces_root: application_data_directory.join("workspaces"),
        }
    }

    pub(crate) fn workspace_directory(&self) -> PathBuf {
        self.workspaces_root.join(DEFAULT_WORKSPACE_DIRECTORY)
    }

    pub(crate) fn database_path(&self) -> PathBuf {
        self.workspace_directory().join(DATABASE_FILE_NAME)
    }
}

impl WorkspaceRepository for SqliteWorkspaceRepository {
    fn find_default(&self) -> Result<Option<Workspace>, PersistenceError> {
        let database_path = self.database_path();
        if !database_path.exists() {
            return Ok(None);
        }

        let mut connection = open_database(&database_path, false)?;
        migrate(&mut connection)?;
        load_workspace(&connection)
    }

    fn initialize_default(&self, workspace: &NewWorkspace) -> Result<Workspace, PersistenceError> {
        let workspace_directory = self.workspace_directory();
        fs::create_dir_all(&workspace_directory).map_err(storage_error)?;
        let database_path = self.database_path();
        let database_already_existed = database_path.exists();

        let result = initialize_database(&database_path, workspace);
        if result.is_err() && !database_already_existed {
            let _ = fs::remove_file(&database_path);
        }
        result
    }
}

fn initialize_database(
    database_path: &Path,
    workspace: &NewWorkspace,
) -> Result<Workspace, PersistenceError> {
    let mut connection = open_database(database_path, true)?;
    migrate(&mut connection)?;
    if let Some(existing) = load_workspace(&connection)? {
        return Ok(existing);
    }

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    transaction
        .execute(
            "INSERT INTO workspace(
                singleton_key, id, name, timezone, daily_review_quota,
                early_fill_enabled, created_at, updated_at, revision
             ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?6, 1)",
            params![
                workspace.id,
                workspace.name,
                workspace.timezone,
                workspace.daily_review_quota,
                workspace.early_fill_enabled,
                workspace.created_at
            ],
        )
        .map_err(database_error)?;
    transaction.commit().map_err(database_error)?;

    load_workspace(&connection)?.ok_or(PersistenceError::UnsupportedConfiguration)
}

pub(crate) fn open_database(path: &Path, create: bool) -> Result<Connection, PersistenceError> {
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    let connection = Connection::open_with_flags(path, flags).map_err(database_error)?;
    configure_connection(&connection)?;
    Ok(connection)
}

fn configure_connection(connection: &Connection) -> Result<(), PersistenceError> {
    if rusqlite::version_number() < MINIMUM_SAFE_SQLITE_VERSION {
        return Err(PersistenceError::UnsupportedConfiguration);
    }

    connection
        .busy_timeout(BUSY_TIMEOUT)
        .map_err(database_error)?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(database_error)?;
    let foreign_keys = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get::<_, bool>(0))
        .map_err(database_error)?;
    if !foreign_keys {
        return Err(PersistenceError::UnsupportedConfiguration);
    }

    let journal_mode = connection
        .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))
        .map_err(database_error)?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(PersistenceError::UnsupportedConfiguration);
    }

    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(database_error)?;
    connection
        .pragma_update(None, "trusted_schema", false)
        .map_err(database_error)?;
    Ok(())
}

pub(crate) fn migrate(connection: &mut Connection) -> Result<(), PersistenceError> {
    let application_id = connection
        .pragma_query_value(None, "application_id", |row| row.get::<_, i32>(0))
        .map_err(database_error)?;
    let current = current_schema_version(connection)?;

    if application_id != 0 && application_id != APPLICATION_ID {
        return Err(PersistenceError::UnsupportedConfiguration);
    }
    if current > LATEST_SCHEMA_VERSION {
        return Err(PersistenceError::UnsupportedSchema {
            found: current,
            supported: LATEST_SCHEMA_VERSION,
        });
    }
    if current > 0 && application_id != APPLICATION_ID {
        return Err(PersistenceError::UnsupportedConfiguration);
    }
    if current == 0 && has_application_tables(connection)? {
        return Err(PersistenceError::MigrationHistoryInconsistent);
    }

    validate_migration_history(connection, current)?;
    let pending_index =
        usize::try_from(current).map_err(|_| PersistenceError::MigrationHistoryInconsistent)?;
    apply_migrations(connection, &MIGRATIONS[pending_index..])
}

/// Verifies an immutable database snapshot without applying migrations or changing pragmas.
pub(crate) fn verify_database_snapshot(connection: &Connection) -> Result<(), PersistenceError> {
    verify_database_snapshot_at_version(connection, LATEST_SCHEMA_VERSION)
}

/// Verifies a known historical snapshot without migrating or changing pragmas.
pub(crate) fn verify_database_snapshot_at_version(
    connection: &Connection,
    expected_version: u32,
) -> Result<(), PersistenceError> {
    let application_id = connection
        .pragma_query_value(None, "application_id", |row| row.get::<_, i32>(0))
        .map_err(database_error)?;
    let current = current_schema_version(connection)?;
    if expected_version == 0
        || expected_version > LATEST_SCHEMA_VERSION
        || application_id != APPLICATION_ID
        || current != expected_version
    {
        return Err(PersistenceError::UnsupportedConfiguration);
    }
    validate_migration_history(connection, current)?;

    let quick_check = connection
        .pragma_query_value(None, "quick_check", |row| row.get::<_, String>(0))
        .map_err(database_error)?;
    if quick_check != "ok" {
        return Err(PersistenceError::UnsupportedConfiguration);
    }
    let mut statement = connection
        .prepare("PRAGMA foreign_key_check")
        .map_err(database_error)?;
    let mut rows = statement.query([]).map_err(database_error)?;
    if rows.next().map_err(database_error)?.is_some() {
        return Err(PersistenceError::UnsupportedConfiguration);
    }
    Ok(())
}

fn apply_migrations(
    connection: &mut Connection,
    migrations: &[Migration],
) -> Result<(), PersistenceError> {
    if migrations.is_empty() {
        return Ok(());
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;

    for migration in migrations {
        transaction.execute_batch(migration.sql).map_err(|source| {
            PersistenceError::MigrationFailed {
                source: Box::new(source),
            }
        })?;
        transaction
            .execute(
                "INSERT INTO schema_migration(version, name, checksum, applied_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    migration.version,
                    migration.name,
                    migration_checksum(migration),
                    current_utc_millis()?
                ],
            )
            .map_err(database_error)?;
        transaction
            .pragma_update(None, "user_version", migration.version)
            .map_err(database_error)?;
    }
    transaction
        .pragma_update(None, "application_id", APPLICATION_ID)
        .map_err(database_error)?;
    transaction.commit().map_err(database_error)
}

fn validate_migration_history(
    connection: &Connection,
    current: u32,
) -> Result<(), PersistenceError> {
    if current == 0 {
        return Ok(());
    }
    if !table_exists(connection, "schema_migration")? {
        return Err(PersistenceError::MigrationHistoryInconsistent);
    }

    let mut statement = connection
        .prepare("SELECT version, name, checksum FROM schema_migration ORDER BY version")
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(database_error)?;
    let applied = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(database_error)?;
    if applied.len()
        != usize::try_from(current).map_err(|_| PersistenceError::MigrationHistoryInconsistent)?
    {
        return Err(PersistenceError::MigrationHistoryInconsistent);
    }

    for (index, (version, name, checksum)) in applied.iter().enumerate() {
        let expected = MIGRATIONS
            .get(index)
            .ok_or(PersistenceError::MigrationHistoryInconsistent)?;
        if *version != expected.version
            || name != expected.name
            || checksum != &migration_checksum(expected)
        {
            return Err(PersistenceError::MigrationHistoryInconsistent);
        }
    }
    Ok(())
}

fn current_schema_version(connection: &Connection) -> Result<u32, PersistenceError> {
    let version = connection
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .map_err(database_error)?;
    u32::try_from(version).map_err(|_| PersistenceError::UnsupportedConfiguration)
}

fn has_application_tables(connection: &Connection) -> Result<bool, PersistenceError> {
    let count = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_schema
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(database_error)?;
    Ok(count > 0)
}

fn table_exists(connection: &Connection, name: &str) -> Result<bool, PersistenceError> {
    let count = connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = ?1",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .map_err(database_error)?;
    Ok(count == 1)
}

fn load_workspace(connection: &Connection) -> Result<Option<Workspace>, PersistenceError> {
    connection
        .query_row(
            "SELECT id, name, timezone, daily_review_quota,
                    early_fill_enabled, created_at
             FROM workspace WHERE singleton_key = 1",
            [],
            |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    timezone: row.get(2)?,
                    daily_review_quota: row.get(3)?,
                    early_fill_enabled: row.get(4)?,
                    created_at: row.get(5)?,
                    schema_version: LATEST_SCHEMA_VERSION,
                })
            },
        )
        .optional()
        .map_err(database_error)
}

fn migration_checksum(migration: &Migration) -> String {
    let digest = Sha256::digest(migration.sql.as_bytes());
    format!("{digest:X}")
}

fn storage_error(source: std::io::Error) -> PersistenceError {
    PersistenceError::StorageUnavailable {
        source: Box::new(source),
    }
}

pub(crate) fn database_error(source: rusqlite::Error) -> PersistenceError {
    let is_busy = matches!(
        source,
        rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error {
                code: ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked,
                ..
            },
            _
        )
    );
    if is_busy {
        PersistenceError::Busy {
            source: Box::new(source),
        }
    } else {
        PersistenceError::Database {
            source: Box::new(source),
        }
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tempfile::tempdir;

    use super::{
        APPLICATION_ID, MIGRATION_001, MIGRATION_002, MIGRATION_003, Migration,
        SqliteWorkspaceRepository, apply_migrations, configure_connection, migration_checksum,
    };
    use crate::application::{PersistenceError, WorkspaceRepository};
    use crate::domain::NewWorkspace;

    #[test]
    fn initialize_default_creates_the_first_schema() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());

        let workspace = repository
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");

        assert_eq!(workspace.schema_version, 3);
    }

    #[test]
    fn find_default_returns_the_same_workspace_after_reopen() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        let created = repository
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");

        let reopened = repository
            .find_default()
            .expect("workspace should reopen")
            .expect("workspace should be present");

        assert_eq!(reopened.id, created.id);
    }

    #[test]
    fn initialize_default_enables_foreign_keys() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        repository
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let connection =
            Connection::open(repository.database_path()).expect("workspace database should reopen");
        configure_connection(&connection).expect("connection should configure");

        let enabled: bool = connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .expect("foreign-key state should be readable");

        assert!(enabled);
    }

    #[test]
    fn find_default_rejects_a_newer_schema() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let connection =
            Connection::open(repository.database_path()).expect("workspace database should open");
        configure_connection(&connection).expect("connection should configure");
        connection
            .pragma_update(None, "application_id", APPLICATION_ID)
            .expect("application ID should be set");
        connection
            .pragma_update(None, "user_version", 4)
            .expect("future schema should be set");

        let error = repository
            .find_default()
            .expect_err("newer schema must be rejected");

        assert!(matches!(error, PersistenceError::UnsupportedSchema { .. }));
    }

    #[test]
    fn find_default_rejects_migration_checksum_drift() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        repository
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let connection =
            Connection::open(repository.database_path()).expect("workspace database should reopen");
        connection
            .execute("UPDATE schema_migration SET checksum = 'changed'", [])
            .expect("test should modify migration history");

        let error = repository
            .find_default()
            .expect_err("checksum drift must be rejected");

        assert!(matches!(
            error,
            PersistenceError::MigrationHistoryInconsistent
        ));
    }

    #[test]
    fn apply_migration_rolls_back_schema_when_sql_fails() {
        let directory = tempdir().expect("temporary directory should exist");
        let database_path = directory.path().join("rollback.sqlite3");
        let mut connection = Connection::open(database_path).expect("database should open");
        configure_connection(&connection).expect("connection should configure");
        let invalid = Migration {
            version: 1,
            name: "invalid_workspace_foundation",
            sql: "CREATE TABLE partial_workspace(id TEXT); INVALID SQL;",
        };

        apply_migrations(&mut connection, &[invalid])
            .expect_err("invalid migration should be rejected");
        let workspace_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_schema WHERE name = 'workspace'",
                [],
                |row| row.get(0),
            )
            .expect("schema should remain readable");

        assert_eq!(workspace_table_count, 0);
    }

    #[test]
    fn find_default_rejects_a_corrupted_database() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        std::fs::write(repository.database_path(), b"not a sqlite database")
            .expect("corrupted sample should be written");

        let error = repository
            .find_default()
            .expect_err("corrupted database must be rejected");

        assert!(matches!(error, PersistenceError::Database { .. }));
    }

    #[test]
    fn find_default_rejects_another_applications_database() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let connection =
            Connection::open(repository.database_path()).expect("foreign database should open");
        configure_connection(&connection).expect("connection should configure");
        connection
            .pragma_update(None, "application_id", 123_456)
            .expect("foreign application ID should be set");

        let error = repository
            .find_default()
            .expect_err("foreign database must be rejected");

        assert!(matches!(error, PersistenceError::UnsupportedConfiguration));
    }

    #[test]
    fn find_default_does_not_create_storage_when_workspace_is_missing() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());

        let workspace = repository.find_default().expect("status should load");

        assert!(workspace.is_none());
    }

    #[test]
    fn migration_checksum_is_deterministic() {
        assert_eq!(
            migration_checksum(&MIGRATION_001),
            migration_checksum(&MIGRATION_001)
        );
    }

    #[test]
    fn migration_sql_does_not_include_business_feature_tables() {
        assert!(!MIGRATION_002.sql.contains("CREATE TABLE task"));
        assert!(MIGRATION_003.sql.contains("CREATE TABLE task"));
    }

    #[test]
    fn find_default_upgrades_an_existing_v1_database_to_v3() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let mut connection =
            Connection::open(repository.database_path()).expect("workspace database should open");
        configure_connection(&connection).expect("connection should configure");
        apply_migrations(&mut connection, &[MIGRATION_001]).expect("v1 migration should apply");
        drop(connection);

        repository
            .find_default()
            .expect("opening should apply pending migrations");
        let connection =
            Connection::open(repository.database_path()).expect("upgraded database should reopen");
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("schema version should be readable");

        assert_eq!(version, 3);
    }
}
