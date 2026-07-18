use rusqlite::Connection;

use crate::{DatabaseError, HealthReport, Result};

pub(crate) fn verify_connection(connection: &Connection) -> Result<HealthReport> {
    let mut integrity_statement = connection.prepare("PRAGMA integrity_check")?;
    let integrity_rows = integrity_statement.query_map([], |row| row.get::<_, String>(0))?;
    let integrity_results = integrity_rows.collect::<rusqlite::Result<Vec<_>>>()?;

    if integrity_results.as_slice() != ["ok"] {
        return Err(DatabaseError::IntegrityCheckFailed {
            issue_count: integrity_results.len(),
        });
    }

    let violation_count =
        connection.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if violation_count > 0 {
        return Err(DatabaseError::ForeignKeyCheckFailed {
            violation_count: usize::try_from(violation_count)
                .map_err(|_| DatabaseError::ValueOutOfRange)?,
        });
    }

    let schema_version = crate::migration::current_version(connection)?;
    let running_job_count = if table_exists(connection, "processing_job")? {
        let count = connection.query_row(
            "SELECT COUNT(*) FROM processing_job WHERE state = 'running'",
            [],
            |row| row.get::<_, i64>(0),
        )?;
        u64::try_from(count).map_err(|_| DatabaseError::ValueOutOfRange)?
    } else {
        0
    };

    Ok(HealthReport {
        schema_version,
        running_job_count,
    })
}

pub(crate) fn table_exists(connection: &Connection, table: &str) -> Result<bool> {
    let exists = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get::<_, bool>(0),
    )?;
    Ok(exists)
}
