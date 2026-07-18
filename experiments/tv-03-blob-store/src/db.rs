use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use crate::{Result, StoreError};

pub(crate) const SCHEMA_VERSION: i64 = 1;

#[derive(Debug, Clone)]
pub(crate) struct BlobRecord {
    pub(crate) sha256: String,
    pub(crate) size_bytes: u64,
    pub(crate) storage_key: String,
}

#[derive(Debug, Clone)]
pub(crate) struct JobRecord {
    pub(crate) id: String,
    pub(crate) document_id: String,
    pub(crate) original_name: String,
    pub(crate) mime_type: String,
    pub(crate) expected_size: u64,
    pub(crate) staging_key: String,
    pub(crate) sha256: Option<String>,
    pub(crate) storage_key: Option<String>,
    pub(crate) state: String,
    pub(crate) created_at: i64,
}

pub(crate) fn open_database(path: &Path) -> Result<Connection> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.busy_timeout(Duration::from_secs(2))?;
    connection.pragma_update(None, "foreign_keys", true)?;
    let journal_mode = connection
        .pragma_update_and_check(None, "journal_mode", "WAL", |row| row.get::<_, String>(0))?;
    if !journal_mode.eq_ignore_ascii_case("wal") {
        return Err(StoreError::Database {
            source: rusqlite::Error::InvalidQuery,
        });
    }
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "trusted_schema", false)?;
    create_schema(&connection)?;
    verify_database(&connection)?;
    Ok(connection)
}

pub(crate) fn create_schema(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        r"
        CREATE TABLE IF NOT EXISTS blob (
            sha256 TEXT PRIMARY KEY CHECK(length(sha256) = 64),
            size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
            storage_key TEXT NOT NULL UNIQUE,
            integrity_state TEXT NOT NULL CHECK(integrity_state IN ('ok', 'missing', 'corrupted')),
            created_at INTEGER NOT NULL
        ) STRICT;

        CREATE TABLE IF NOT EXISTS resource_document (
            id TEXT PRIMARY KEY,
            blob_sha256 TEXT NOT NULL REFERENCES blob(sha256) ON DELETE RESTRICT,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            created_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_resource_document_blob
            ON resource_document(blob_sha256);

        CREATE TABLE IF NOT EXISTS processing_job (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL UNIQUE,
            original_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            expected_size INTEGER NOT NULL CHECK(expected_size >= 0),
            staging_key TEXT NOT NULL,
            sha256 TEXT,
            storage_key TEXT,
            state TEXT NOT NULL CHECK(state IN ('running', 'committing', 'succeeded', 'failed', 'canceled')),
            progress_current INTEGER NOT NULL DEFAULT 0 CHECK(progress_current >= 0),
            error_code TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        ) STRICT;

        CREATE INDEX IF NOT EXISTS idx_processing_job_recovery
            ON processing_job(state, updated_at);
        ",
    )?;
    connection.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    Ok(())
}

pub(crate) fn verify_database(connection: &Connection) -> Result<()> {
    let integrity =
        connection.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))?;
    if integrity != "ok" {
        return Err(StoreError::IntegrityMismatch);
    }
    let foreign_key_violations =
        connection.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if foreign_key_violations != 0 {
        return Err(StoreError::IntegrityMismatch);
    }
    let version =
        connection.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))?;
    if version != SCHEMA_VERSION {
        return Err(StoreError::UnsupportedBackup);
    }
    Ok(())
}

pub(crate) fn all_blobs(connection: &Connection) -> Result<Vec<BlobRecord>> {
    let mut statement = connection
        .prepare("SELECT sha256, size_bytes, storage_key FROM blob ORDER BY sha256 ASC")?;
    let rows = statement.query_map([], |row| {
        let size = row.get::<_, i64>(1)?;
        Ok((row.get::<_, String>(0)?, size, row.get::<_, String>(2)?))
    })?;
    rows.map(|row| {
        let (sha256, size, storage_key) = row?;
        Ok(BlobRecord {
            sha256,
            size_bytes: u64::try_from(size).map_err(|_| StoreError::ValueOutOfRange)?,
            storage_key,
        })
    })
    .collect()
}

pub(crate) fn active_jobs(connection: &Connection) -> Result<Vec<JobRecord>> {
    let mut statement = connection.prepare(
        "SELECT id, document_id, original_name, mime_type, expected_size, staging_key,
                sha256, storage_key, state, created_at
         FROM processing_job
         WHERE state IN ('running', 'committing')
         ORDER BY created_at ASC, id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, String>(8)?,
            row.get::<_, i64>(9)?,
        ))
    })?;
    rows.map(|row| {
        let (
            id,
            document_id,
            original_name,
            mime_type,
            expected_size,
            staging_key,
            sha256,
            storage_key,
            state,
            created_at,
        ) = row?;
        Ok(JobRecord {
            id,
            document_id,
            original_name,
            mime_type,
            expected_size: u64::try_from(expected_size).map_err(|_| StoreError::ValueOutOfRange)?,
            staging_key,
            sha256,
            storage_key,
            state,
            created_at,
        })
    })
    .collect()
}
