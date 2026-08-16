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
// The M10 acceptance build used equivalent v13 SQL before that migration file was frozen.
const MIGRATION_013_LEGACY_CHECKSUMS: &[&str] =
    &["E0DFA397DC05C5404FD7F4B7AC68C9E1A4ADF8C02EEDB6E10AC135B6C0DFBCD2"];
// The v0.1.0 release candidate normalized line endings in these migration
// files after some workspaces had already recorded the original bytes. The
// second value for v15/v17 is the mixed-newline checksum produced by the
// Windows worktree used to create those workspaces.
const MIGRATION_015_LEGACY_CHECKSUMS: &[&str] = &[
    "2535352BA3F24A7291F9DBB7BA65A1A44F51CC5B4F242CDCBC3D8A447E3D321A",
    "EB4B6B1EAE66D7C7C31E1929956AE6364092C7131D0FE26D950E6B37B5F665C1",
];
const MIGRATION_017_LEGACY_CHECKSUMS: &[&str] = &[
    "B6C3C057B5A42BB1D8B1F678607BE7E1C06F3E23492BE67BA6DE44D6F07DB77C",
    "484ABC81FDDD41DC1C4325CC30A2389A6EE251A139886A828B54D63F95028CAE",
];

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
const MIGRATION_004: Migration = Migration {
    version: 4,
    name: "study_session",
    sql: include_str!("../../migrations/0004_study_session.sql"),
};
const MIGRATION_005: Migration = Migration {
    version: 5,
    name: "resource_reading_and_planning",
    sql: include_str!("../../migrations/0005_resource_planning.sql"),
};
const MIGRATION_006: Migration = Migration {
    version: 6,
    name: "mindmap_foundation",
    sql: include_str!("../../migrations/0006_mindmap.sql"),
};
const MIGRATION_007: Migration = Migration {
    version: 7,
    name: "workbook_question",
    sql: include_str!("../../migrations/0007_workbook_question.sql"),
};
const MIGRATION_008: Migration = Migration {
    version: 8,
    name: "mistake_review",
    sql: include_str!("../../migrations/0008_mistake_review.sql"),
};
const MIGRATION_009: Migration = Migration {
    version: 9,
    name: "resource_search",
    sql: include_str!("../../migrations/0009_resource_search.sql"),
};
const MIGRATION_010: Migration = Migration {
    version: 10,
    name: "ai_foundation",
    sql: include_str!("../../migrations/0010_ai_foundation.sql"),
};
const MIGRATION_011: Migration = Migration {
    version: 11,
    name: "ai_provider_management",
    sql: include_str!("../../migrations/0011_ai_provider_management.sql"),
};
const MIGRATION_012: Migration = Migration {
    version: 12,
    name: "planning_chat",
    sql: include_str!("../../migrations/0012_planning_chat.sql"),
};
const MIGRATION_013: Migration = Migration {
    version: 13,
    name: "question_region_ocr",
    sql: include_str!("../../migrations/0013_question_region_ocr.sql"),
};
const MIGRATION_014: Migration = Migration {
    version: 14,
    name: "plan_stage_tasks",
    sql: include_str!("../../migrations/0014_plan_stage_tasks.sql"),
};
const MIGRATION_015: Migration = Migration {
    version: 15,
    name: "review_schemes",
    sql: include_str!("../../migrations/0015_review_schemes.sql"),
};
const MIGRATION_016: Migration = Migration {
    version: 16,
    name: "review_cards_and_cycle_plans",
    sql: include_str!("../../migrations/0016_review_cards_and_cycle_plans.sql"),
};
const MIGRATION_017: Migration = Migration {
    version: 17,
    name: "question_bank_index",
    sql: include_str!("../../migrations/0017_question_bank_index.sql"),
};
const MIGRATION_018: Migration = Migration {
    version: 18,
    name: "resource_trash",
    sql: include_str!("../../migrations/0018_resource_trash.sql"),
};
const MIGRATION_019: Migration = Migration {
    version: 19,
    name: "question_gap_acknowledgements",
    sql: include_str!("../../migrations/0019_question_gap_acknowledgements.sql"),
};
const MIGRATION_020: Migration = Migration {
    version: 20,
    name: "question_bank_segment_trash",
    sql: include_str!("../../migrations/0020_question_bank_segment_trash.sql"),
};
const MIGRATION_021: Migration = Migration {
    version: 21,
    name: "cycle_plan_shift_undo",
    sql: include_str!("../../migrations/0021_cycle_plan_shift_undo.sql"),
};
const MIGRATION_022: Migration = Migration {
    version: 22,
    name: "cycle_plan_item_skipped",
    sql: include_str!("../../migrations/0022_cycle_plan_item_skipped.sql"),
};
const MIGRATION_023: Migration = Migration {
    version: 23,
    name: "xmind_import_format",
    sql: include_str!("../../migrations/0023_xmind_import_format.sql"),
};
const MIGRATION_024: Migration = Migration {
    version: 24,
    name: "question_ai_analysis",
    sql: include_str!("../../migrations/0024_question_ai_analysis.sql"),
};
const MIGRATION_025: Migration = Migration {
    version: 25,
    name: "question_ai_analysis_history",
    sql: include_str!("../../migrations/0025_question_ai_analysis_history.sql"),
};
const MIGRATIONS: &[Migration] = &[
    MIGRATION_001,
    MIGRATION_002,
    MIGRATION_003,
    MIGRATION_004,
    MIGRATION_005,
    MIGRATION_006,
    MIGRATION_007,
    MIGRATION_008,
    MIGRATION_009,
    MIGRATION_010,
    MIGRATION_011,
    MIGRATION_012,
    MIGRATION_013,
    MIGRATION_014,
    MIGRATION_015,
    MIGRATION_016,
    MIGRATION_017,
    MIGRATION_018,
    MIGRATION_019,
    MIGRATION_020,
    MIGRATION_021,
    MIGRATION_022,
    MIGRATION_023,
    MIGRATION_024,
    MIGRATION_025,
];

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
            || !migration_checksum_is_accepted(expected, checksum)
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
    // GitHub Actions and local Windows worktrees may compile the same SQL with
    // different newline bytes; persist a platform-independent checksum.
    let normalized_sql = migration.sql.replace("\r\n", "\n");
    checksum_sql(&normalized_sql)
}

fn checksum_sql(sql: &str) -> String {
    let digest = Sha256::digest(sql.as_bytes());
    format!("{digest:X}")
}

fn migration_checksum_is_accepted(migration: &Migration, checksum: &str) -> bool {
    if checksum == migration_checksum(migration)
        || checksum == checksum_sql(migration.sql)
        || checksum == checksum_sql(&migration.sql.replace("\r\n", "\n").replace('\n', "\r\n"))
    {
        return true;
    }
    match migration.version {
        version if version == MIGRATION_013.version => {
            MIGRATION_013_LEGACY_CHECKSUMS.contains(&checksum)
        }
        version if version == MIGRATION_015.version => {
            MIGRATION_015_LEGACY_CHECKSUMS.contains(&checksum)
        }
        version if version == MIGRATION_017.version => {
            MIGRATION_017_LEGACY_CHECKSUMS.contains(&checksum)
        }
        _ => false,
    }
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
    use rusqlite::{Connection, OptionalExtension};
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::{
        APPLICATION_ID, MIGRATION_001, MIGRATION_002, MIGRATION_003, MIGRATION_004, MIGRATION_005,
        MIGRATION_006, MIGRATION_007, MIGRATION_008, MIGRATION_009, MIGRATION_013,
        MIGRATION_013_LEGACY_CHECKSUMS, MIGRATION_014, MIGRATION_015,
        MIGRATION_015_LEGACY_CHECKSUMS, MIGRATION_016, MIGRATION_017,
        MIGRATION_017_LEGACY_CHECKSUMS, MIGRATION_019, MIGRATION_020, MIGRATION_021, MIGRATION_022,
        MIGRATION_023, MIGRATION_024, MIGRATION_025, MIGRATIONS, Migration,
        SqliteWorkspaceRepository, apply_migrations, configure_connection, migrate,
        migration_checksum,
    };
    use crate::application::{PersistenceError, WorkspaceRepository};
    use crate::domain::{LATEST_SCHEMA_VERSION, NewWorkspace};

    #[test]
    fn initialize_default_creates_the_first_schema() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());

        let workspace = repository
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");

        assert_eq!(workspace.schema_version, LATEST_SCHEMA_VERSION);
    }

    #[test]
    // The populated migration fixture intentionally keeps the full v21 SQL and
    // post-migration integrity assertions together as one executable contract.
    #[expect(clippy::too_many_lines)]
    fn v21_populated_cycle_items_upgrade_to_v22_and_clear_ephemeral_undo() {
        let mut connection = Connection::open_in_memory().expect("database should open");
        connection
            .pragma_update(None, "foreign_keys", true)
            .expect("foreign keys should enable");
        apply_migrations(&mut connection, &MIGRATIONS[..21]).expect("v21 schema should create");
        connection
            .execute_batch(
                "INSERT INTO workspace(
                    singleton_key, id, name, exam_name, exam_date, timezone,
                    daily_review_quota, early_fill_enabled, created_at, updated_at, revision
                 ) VALUES (
                    1, '019f7328-4b66-7613-9729-e3570fc41525', 'test', NULL, NULL,
                    'Asia/Shanghai', 5, 0, 100, 100, 1
                 );
                 INSERT INTO cycle_plan(
                    id, workspace_id, name, total_units, unit_label, start_date, deadline,
                    study_days_per_unit, schedule_mode, calendar_visible, archived_at,
                    created_at, updated_at
                 ) VALUES (
                    '019f7328-4b66-7613-9729-e3570fc41526',
                    '019f7328-4b66-7613-9729-e3570fc41525', 'cycle', 2, 'unit',
                    '2026-08-01', '2026-09-01', 1, 'rhythm', 1, NULL, 100, 200
                 );
                 INSERT INTO cycle_plan_item(
                    id, plan_id, unit_index, planned_start_date, planned_end_date,
                    original_start_date, original_end_date, state, completed_at,
                    shift_count, created_at, updated_at
                 ) VALUES
                    ('019f7328-4b66-7613-9729-e3570fc41527',
                     '019f7328-4b66-7613-9729-e3570fc41526', 1,
                     '2026-08-01', '2026-08-01', '2026-08-01', '2026-08-01',
                     'completed', 150, 2, 100, 150),
                    ('019f7328-4b66-7613-9729-e3570fc41528',
                     '019f7328-4b66-7613-9729-e3570fc41526', 2,
                     '2026-08-02', '2026-08-02', '2026-08-02', '2026-08-02',
                     'pending', NULL, 3, 100, 160);
                 INSERT INTO cycle_plan_shift_undo(
                    undo_token, plan_id, shifted_item_count, created_at, expires_at
                 ) VALUES (
                    '019f7328-4b66-7613-9729-e3570fc41529',
                    '019f7328-4b66-7613-9729-e3570fc41526', 1, 170, 5170
                 );
                 INSERT INTO cycle_plan_shift_undo_item(
                    undo_token, item_id, before_planned_start_date, before_planned_end_date,
                    before_shift_count, before_updated_at, shifted_planned_start_date,
                    shifted_planned_end_date, shifted_shift_count, shifted_updated_at
                 ) VALUES (
                    '019f7328-4b66-7613-9729-e3570fc41529',
                    '019f7328-4b66-7613-9729-e3570fc41528',
                    '2026-08-01', '2026-08-01', 2, 150,
                    '2026-08-02', '2026-08-02', 3, 160
                 );",
            )
            .expect("v21 cycle data should insert");

        apply_migrations(&mut connection, &[MIGRATION_022]).expect("v22 should migrate safely");

        let items = connection
            .prepare(
                "SELECT id, state, completed_at, skipped_at, shift_count, created_at, updated_at
                 FROM cycle_plan_item ORDER BY unit_index",
            )
            .expect("items should prepare")
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            })
            .expect("items should query")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("items should load");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].1, "completed");
        assert_eq!(items[0].2, Some(150));
        assert_eq!(items[0].3, None);
        assert_eq!((items[0].4, items[0].5, items[0].6), (2, 100, 150));
        assert_eq!(items[1].1, "pending");
        assert_eq!(items[1].2, None);
        assert_eq!(items[1].3, None);
        connection
            .execute(
                "UPDATE cycle_plan_item
                 SET state = 'skipped', skipped_at = 170, updated_at = 170
                 WHERE id = '019f7328-4b66-7613-9729-e3570fc41528'",
                [],
            )
            .expect("valid skipped state should satisfy the v22 check");
        let invalid = connection.execute(
            "UPDATE cycle_plan_item SET completed_at = 170
             WHERE id = '019f7328-4b66-7613-9729-e3570fc41528'",
            [],
        );
        assert!(invalid.is_err());
        let undo_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM cycle_plan_shift_undo", [], |row| {
                row.get(0)
            })
            .expect("undo count should load");
        assert_eq!(undo_count, 0);
        let foreign_key_target: String = connection
            .query_row(
                "PRAGMA foreign_key_list(cycle_plan_shift_undo_item)",
                [],
                |row| row.get(2),
            )
            .expect("undo item foreign key should exist");
        assert_eq!(foreign_key_target, "cycle_plan_item");
        let foreign_key_error: Option<String> = connection
            .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
            .optional()
            .expect("foreign key check should run");
        assert!(foreign_key_error.is_none());
    }

    #[test]
    fn v14_upgrade_to_latest_preserves_legacy_questions_and_adds_cycle_plans() {
        let mut connection = Connection::open_in_memory().expect("database should open");
        apply_migrations(&mut connection, &MIGRATIONS[..14]).expect("v14 schema should create");
        let workspace_id = "019f7328-4b66-7613-9729-e3570fc41525";
        let blob_id = "019f7328-4b66-7613-9729-e3570fc41526";
        let document_id = "019f7328-4b66-7613-9729-e3570fc41527";
        let question_id = "019f7328-4b66-7613-9729-e3570fc41528";
        connection
            .execute_batch(&format!(
                "INSERT INTO workspace(
                    singleton_key, id, name, exam_name, exam_date, timezone,
                    daily_review_quota, early_fill_enabled, created_at, updated_at, revision
                 ) VALUES (1, '{workspace_id}', '测试', NULL, NULL, 'Asia/Shanghai', 5, 0, 1, 1, 1);
                 INSERT INTO blob(id, workspace_id, sha256, size_bytes, storage_key, created_at)
                 VALUES ('{blob_id}', '{workspace_id}', '{}', 1, 'blobs/test', 1);
                 INSERT INTO resource_document(
                    id, workspace_id, blob_id, title, original_name, kind, mime_type,
                    created_at, updated_at, revision, role, page_count
                 ) VALUES ('{document_id}', '{workspace_id}', '{blob_id}', '旧习题册',
                           'old.pdf', 'pdf', 'application/pdf', 1, 1, 1, 'workbook', 10);
                 INSERT INTO question(
                    id, workspace_id, document_id, title, chapter, question_number,
                    difficulty, analysis_markdown, deleted_at, created_at, updated_at
                 ) VALUES ('{question_id}', '{workspace_id}', '{document_id}', '旧错题',
                           NULL, NULL, 3, NULL, NULL, 1, 1);",
                "A".repeat(64)
            ))
            .expect("legacy data should insert");

        migrate(&mut connection).expect("pending migrations should apply");
        let classification: (Option<String>, String, i64, i64) = connection
            .query_row(
                "SELECT question_type, classification_source,
                        (SELECT COUNT(*) FROM question WHERE id = ?1),
                        (SELECT COUNT(*) FROM sqlite_schema
                         WHERE type = 'table' AND name = 'cycle_plan')
                 FROM question WHERE id = ?1",
                [question_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("legacy question should remain readable");

        assert_eq!(classification, (None, "pending".to_owned(), 1, 1));
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
            .pragma_update(None, "user_version", LATEST_SCHEMA_VERSION + 1)
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
    fn find_default_accepts_migration_history_with_windows_line_endings() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let mut connection =
            Connection::open(repository.database_path()).expect("workspace database should open");
        configure_connection(&connection).expect("connection should configure");
        apply_migrations(&mut connection, MIGRATIONS).expect("latest schema should be created");

        for migration in [MIGRATION_015, MIGRATION_017] {
            let windows_sql = migration.sql.replace("\r\n", "\n").replace('\n', "\r\n");
            let checksum = format!("{:X}", Sha256::digest(windows_sql.as_bytes()));
            connection
                .execute(
                    "UPDATE schema_migration SET checksum = ?1 WHERE version = ?2",
                    (&checksum, migration.version),
                )
                .expect("fixture should use the Windows line-ending checksum");
        }
        drop(connection);

        repository
            .find_default()
            .expect("line-ending-only migration differences should remain readable");
    }

    #[test]
    fn find_default_upgrades_the_accepted_m10_v13_history_to_latest() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let mut connection =
            Connection::open(repository.database_path()).expect("workspace database should open");
        configure_connection(&connection).expect("connection should configure");
        apply_migrations(&mut connection, &MIGRATIONS[..13]).expect("v13 schema should be created");
        connection
            .execute(
                "UPDATE schema_migration SET checksum = ?1 WHERE version = 13",
                [MIGRATION_013_LEGACY_CHECKSUMS[0]],
            )
            .expect("fixture should use the M10 acceptance checksum");
        drop(connection);

        repository
            .find_default()
            .expect("the accepted M10 schema should upgrade");
        let connection =
            Connection::open(repository.database_path()).expect("upgraded database should reopen");
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("schema version should be readable");
        let plan_stage_task_exists: bool = connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_schema
                    WHERE type = 'table' AND name = 'plan_stage_task'
                 )",
                [],
                |row| row.get(0),
            )
            .expect("v14 table should be queryable");
        let stored_v13_checksum: String = connection
            .query_row(
                "SELECT checksum FROM schema_migration WHERE version = 13",
                [],
                |row| row.get(0),
            )
            .expect("v13 history should remain readable");

        assert_eq!(version, LATEST_SCHEMA_VERSION);
        assert!(plan_stage_task_exists);
        assert_eq!(stored_v13_checksum, MIGRATION_013_LEGACY_CHECKSUMS[0]);
    }

    #[test]
    fn find_default_accepts_known_legacy_v15_and_v17_histories() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let mut connection =
            Connection::open(repository.database_path()).expect("workspace database should open");
        configure_connection(&connection).expect("connection should configure");
        apply_migrations(&mut connection, MIGRATIONS).expect("latest schema should be created");
        connection
            .execute(
                "UPDATE schema_migration SET checksum = ?1 WHERE version = 15",
                [MIGRATION_015_LEGACY_CHECKSUMS[0]],
            )
            .expect("fixture should use the pre-normalization v15 checksum");
        connection
            .execute(
                "UPDATE schema_migration SET checksum = ?1 WHERE version = 17",
                [MIGRATION_017_LEGACY_CHECKSUMS[0]],
            )
            .expect("fixture should use the pre-normalization v17 checksum");
        drop(connection);

        repository
            .find_default()
            .expect("known legacy migration checksums should remain readable");
    }

    #[test]
    fn find_default_accepts_mixed_newline_worktree_histories() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let mut connection =
            Connection::open(repository.database_path()).expect("workspace database should open");
        configure_connection(&connection).expect("connection should configure");
        apply_migrations(&mut connection, MIGRATIONS).expect("latest schema should be created");
        connection
            .execute(
                "UPDATE schema_migration SET checksum = ?1 WHERE version = 15",
                [MIGRATION_015_LEGACY_CHECKSUMS[1]],
            )
            .expect("fixture should use the mixed-newline v15 checksum");
        connection
            .execute(
                "UPDATE schema_migration SET checksum = ?1 WHERE version = 17",
                [MIGRATION_017_LEGACY_CHECKSUMS[1]],
            )
            .expect("fixture should use the mixed-newline v17 checksum");
        drop(connection);

        repository
            .find_default()
            .expect("mixed-newline migration checksums should remain readable");
    }

    #[test]
    fn find_default_rejects_an_unknown_v13_checksum() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let mut connection =
            Connection::open(repository.database_path()).expect("workspace database should open");
        configure_connection(&connection).expect("connection should configure");
        apply_migrations(&mut connection, &MIGRATIONS[..13]).expect("v13 schema should be created");
        connection
            .execute(
                "UPDATE schema_migration SET checksum = 'unknown' WHERE version = 13",
                [],
            )
            .expect("fixture should change only the v13 checksum");
        drop(connection);

        let error = repository
            .find_default()
            .expect_err("an unknown v13 checksum must remain rejected");

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
        assert!(MIGRATION_004.sql.contains("CREATE TABLE study_session"));
        assert!(MIGRATION_005.sql.contains("CREATE TABLE study_plan"));
        assert!(MIGRATION_006.sql.contains("CREATE TABLE knowledge_map"));
        assert!(MIGRATION_007.sql.contains("CREATE TABLE question"));
        assert!(MIGRATION_008.sql.contains("CREATE TABLE mistake_profile"));
        assert!(
            MIGRATION_009
                .sql
                .contains("CREATE VIRTUAL TABLE resource_text_fts")
        );
        assert!(
            MIGRATION_013
                .sql
                .contains("CREATE TABLE question_region_ocr")
        );
        assert!(
            MIGRATION_013
                .sql
                .contains("CREATE TABLE question_region_ocr_line")
        );
        assert!(MIGRATION_014.sql.contains("CREATE TABLE plan_stage_task"));
        assert!(MIGRATION_015.sql.contains("CREATE TABLE review_scheme"));
        assert!(MIGRATION_016.sql.contains("CREATE TABLE cycle_plan"));
        assert!(
            MIGRATION_016
                .sql
                .contains("CREATE TABLE review_scheme_undo")
        );
        assert!(
            MIGRATION_019
                .sql
                .contains("CREATE TABLE question_gap_acknowledgement")
        );
        assert!(
            MIGRATION_020
                .sql
                .contains("CREATE TABLE workbook_segment_question_trash")
        );
        assert!(
            MIGRATION_021
                .sql
                .contains("CREATE TABLE cycle_plan_shift_undo")
        );
        assert!(
            MIGRATION_022
                .sql
                .contains("CREATE TABLE cycle_plan_item_new")
        );
        assert!(MIGRATION_023.sql.contains("'xmind'"));
        assert!(
            MIGRATION_024
                .sql
                .contains("CREATE TABLE question_ai_analysis")
        );
        assert!(
            MIGRATION_025
                .sql
                .contains("CREATE TABLE question_ai_analysis_history")
        );
    }

    #[test]
    fn find_default_upgrades_v22_mindmap_drafts_to_allow_xmind() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let mut connection =
            Connection::open(repository.database_path()).expect("workspace database should open");
        configure_connection(&connection).expect("connection should configure");
        apply_migrations(&mut connection, &MIGRATIONS[..22]).expect("v22 schema should create");
        connection
            .execute_batch(
                "INSERT INTO workspace(
                    singleton_key, id, name, exam_name, exam_date, timezone,
                    daily_review_quota, early_fill_enabled, created_at, updated_at, revision
                 ) VALUES (
                    1, '019f7328-4b66-7613-9729-e3570fc41525', 'test', NULL, NULL,
                    'Asia/Shanghai', 5, 0, 1, 1, 1
                 );
                 INSERT INTO blob(id, workspace_id, sha256, size_bytes, storage_key, created_at)
                 VALUES ('019f7328-4b66-7613-9729-e3570fc41526',
                         '019f7328-4b66-7613-9729-e3570fc41525',
                        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
                        1, 'blobs/test', 1);
                 INSERT INTO resource_document(
                    id, workspace_id, blob_id, title, original_name, kind, mime_type,
                    created_at, updated_at, revision, role
                 )
                 VALUES (
                    '019f7328-4b66-7613-9729-e3570fc41527',
                    '019f7328-4b66-7613-9729-e3570fc41525',
                    '019f7328-4b66-7613-9729-e3570fc41526', 'xmind', 'xmind.xmind',
                    'mindmap_source', 'application/x-xmind', 1, 1, 1, 'other'
                 );
                 INSERT INTO map_import_draft(
                    id, workspace_id, source_resource_id, source_format, title,
                    draft_tree_json, warnings_json, node_count, state, accepted_map_id,
                    created_at, updated_at
                 )
                 VALUES (
                    '019f7328-4b66-7613-9729-e3570fc41528',
                    '019f7328-4b66-7613-9729-e3570fc41525',
                    '019f7328-4b66-7613-9729-e3570fc41527', 'opml', '旧草案',
                    '{\"title\":\"根\",\"children\":[]}', '[]', 1, 'generated', NULL, 1, 1
                 );",
            )
            .expect("v22 fixture should insert");
        drop(connection);

        repository
            .find_default()
            .expect("v22 workspace should upgrade");

        let connection =
            Connection::open(repository.database_path()).expect("upgraded database should open");
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("schema version should be readable");
        connection
            .execute(
                "INSERT INTO map_import_draft(
                    id, workspace_id, source_resource_id, source_format, title,
                    draft_tree_json, warnings_json, node_count, state, accepted_map_id,
                    created_at, updated_at
                 )
                 SELECT '019f7328-4b66-7613-9729-e3570fc41529', id,
                        '019f7328-4b66-7613-9729-e3570fc41527', 'xmind', 'XMind 草案',
                        '{\"title\":\"根\",\"children\":[]}', '[]', 1, 'generated', NULL, 2, 2
                 FROM workspace",
                [],
            )
            .expect("upgraded schema should accept XMind drafts");

        assert_eq!(version, LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn find_default_upgrades_an_existing_v1_database_to_latest() {
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

        assert_eq!(version, LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn find_default_upgrades_an_existing_v3_database_to_latest() {
        let directory = tempdir().expect("temporary directory should exist");
        let repository = SqliteWorkspaceRepository::new(directory.path());
        std::fs::create_dir_all(repository.workspace_directory())
            .expect("workspace directory should exist");
        let mut connection =
            Connection::open(repository.database_path()).expect("workspace database should open");
        configure_connection(&connection).expect("connection should configure");
        apply_migrations(
            &mut connection,
            &[MIGRATION_001, MIGRATION_002, MIGRATION_003],
        )
        .expect("v3 migrations should apply");
        drop(connection);

        repository
            .find_default()
            .expect("opening should apply study-session migration");
        let connection =
            Connection::open(repository.database_path()).expect("upgraded database should reopen");
        let (version, session_table_count): (u32, i64) = (
            connection
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .expect("schema version should be readable"),
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_schema
                     WHERE type = 'table' AND name = 'study_session'",
                    [],
                    |row| row.get(0),
                )
                .expect("study session table should be readable"),
        );

        assert_eq!(version, LATEST_SCHEMA_VERSION);
        assert_eq!(session_table_count, 1);
    }
}
