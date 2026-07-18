use std::io;

use rusqlite::{Error as SqliteError, ErrorCode};

/// Errors produced by the TV-02 database boundary.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum DatabaseError {
    /// `SQLite` could not obtain the required lock before the configured timeout.
    #[error("database is busy; retry the operation")]
    Busy {
        /// Original `SQLite` lock error retained for local diagnostics.
        #[source]
        source: SqliteError,
    },

    /// A `SQLite` operation failed for a reason that is not represented separately.
    #[error("database operation failed")]
    Sqlite {
        /// Original `SQLite` error retained for local diagnostics.
        #[source]
        source: SqliteError,
    },

    /// A filesystem operation failed. Paths stay in the error source and are not displayed.
    #[error("database file operation failed")]
    Io {
        /// Original I/O error retained for local diagnostics.
        #[source]
        source: io::Error,
    },

    /// The opened `SQLite` build or connection does not satisfy a required invariant.
    #[error("database configuration is unsupported: {reason}")]
    UnsupportedConfiguration {
        /// Stable, non-sensitive explanation of the missing invariant.
        reason: &'static str,
    },

    /// The database schema is newer than this application understands.
    #[error("database schema version {found} is newer than supported version {supported}")]
    UnsupportedSchema {
        /// Version read from the database.
        found: i64,
        /// Latest version embedded in this application.
        supported: i64,
    },

    /// Migration history and the embedded migration no longer have the same checksum.
    #[error("database migration {version} does not match the embedded migration")]
    MigrationChecksumMismatch {
        /// Applied migration whose checksum drifted.
        version: i64,
    },

    /// Migration history contains a gap, unexpected name, or inconsistent user version.
    #[error("database migration history is inconsistent")]
    InconsistentMigrationHistory,

    /// Applying a versioned migration failed.
    #[error("database migration {version} failed and was rolled back")]
    MigrationFailed {
        /// Migration version that failed.
        version: i64,
        /// Original `SQLite` error retained for local diagnostics.
        #[source]
        source: SqliteError,
    },

    /// `SQLite` detected structural damage.
    #[error("database integrity check failed with {issue_count} issue(s)")]
    IntegrityCheckFailed {
        /// Number of structural issues reported by `SQLite`.
        issue_count: usize,
    },

    /// `SQLite` detected referential-integrity violations.
    #[error("database foreign-key check failed with {violation_count} violation(s)")]
    ForeignKeyCheckFailed {
        /// Number of referential-integrity violations reported by `SQLite`.
        violation_count: usize,
    },

    /// A backup or temporary restore file did not match the expected digest.
    #[error("backup checksum does not match the expected value")]
    ChecksumMismatch,

    /// Restore and backup operations never overwrite an existing destination.
    #[error("destination already exists")]
    DestinationExists,

    /// The system clock cannot be represented as a UTC millisecond timestamp.
    #[error("system clock value is unsupported")]
    InvalidSystemTime,

    /// A measured count or duration cannot fit in the report's stable integer type.
    #[error("measured value is outside the supported range")]
    ValueOutOfRange,
}

impl DatabaseError {
    /// Returns the stable diagnostic code suitable for an application error DTO.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Busy { .. } => "DATABASE_BUSY",
            Self::Sqlite { .. } => "DATABASE_ERROR",
            Self::Io { .. } => "DATABASE_FILE_ERROR",
            Self::UnsupportedConfiguration { .. } => "DATABASE_CONFIGURATION_UNSUPPORTED",
            Self::UnsupportedSchema { .. } => "SCHEMA_VERSION_UNSUPPORTED",
            Self::MigrationChecksumMismatch { .. } => "MIGRATION_CHECKSUM_MISMATCH",
            Self::InconsistentMigrationHistory => "MIGRATION_HISTORY_INCONSISTENT",
            Self::MigrationFailed { .. } => "MIGRATION_FAILED",
            Self::IntegrityCheckFailed { .. } => "DATABASE_INTEGRITY_FAILED",
            Self::ForeignKeyCheckFailed { .. } => "FOREIGN_KEY_CHECK_FAILED",
            Self::ChecksumMismatch => "BACKUP_CHECKSUM_MISMATCH",
            Self::DestinationExists => "DESTINATION_EXISTS",
            Self::InvalidSystemTime => "SYSTEM_TIME_INVALID",
            Self::ValueOutOfRange => "VALUE_OUT_OF_RANGE",
        }
    }
}

impl From<SqliteError> for DatabaseError {
    fn from(source: SqliteError) -> Self {
        let is_busy = matches!(
            source,
            SqliteError::SqliteFailure(
                rusqlite::ffi::Error {
                    code: ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked,
                    ..
                },
                _
            )
        );

        if is_busy {
            Self::Busy { source }
        } else {
            Self::Sqlite { source }
        }
    }
}

impl From<io::Error> for DatabaseError {
    fn from(source: io::Error) -> Self {
        Self::Io { source }
    }
}
