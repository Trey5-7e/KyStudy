use std::io;

use rusqlite::{Error as SqliteError, ErrorCode};

/// Errors produced by the TV-03 file and database boundary.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum StoreError {
    /// Another process already holds the workspace write lock.
    #[error("workspace is already open for writing")]
    WorkspaceLocked,

    /// The authorized source is not a regular file.
    #[error("selected source is not a regular file")]
    SourceNotFile,

    /// The source is inside the managed workspace and cannot be re-imported by path.
    #[error("selected source is inside the managed workspace")]
    SourceInsideWorkspace,

    /// A stable file name could not be derived from the source.
    #[error("selected source has no supported file name")]
    InvalidFileName,

    /// The file changed size while it was being imported.
    #[error("source file changed during import")]
    SourceChanged,

    /// The current filesystem cannot reserve enough bytes for staging.
    #[error("insufficient disk space for import")]
    InsufficientSpace {
        /// Bytes required for the source plus the configured safety reserve.
        required: u64,
        /// Bytes currently available to the application.
        available: u64,
    },

    /// The caller requested cancellation before the file was committed.
    #[error("file import was canceled")]
    ImportCanceled,

    /// A caller-provided identifier is already present.
    #[error("import identifier already exists")]
    IdentifierExists,

    /// A relative storage key or manifest path violated the fixed layout.
    #[error("managed relative path is invalid")]
    InvalidManagedPath,

    /// The backup format or schema version is not supported.
    #[error("backup format is unsupported")]
    UnsupportedBackup,

    /// Backup JSON could not be parsed or did not match database records.
    #[error("backup manifest is invalid")]
    InvalidManifest,

    /// A file size or digest did not match the trusted record.
    #[error("file integrity verification failed")]
    IntegrityMismatch,

    /// Backup and restore operations never overwrite an existing target.
    #[error("destination already exists")]
    DestinationExists,

    /// `SQLite` could not obtain a lock within the configured timeout.
    #[error("database is busy; retry the operation")]
    DatabaseBusy {
        /// Original `SQLite` error retained for local diagnostics.
        #[source]
        source: SqliteError,
    },

    /// A `SQLite` operation failed.
    #[error("database operation failed")]
    Database {
        /// Original `SQLite` error retained for local diagnostics.
        #[source]
        source: SqliteError,
    },

    /// A filesystem operation failed. The display message does not expose paths.
    #[error("managed file operation failed")]
    Io {
        /// Original I/O error retained for local diagnostics.
        #[source]
        source: io::Error,
    },

    /// JSON serialization or deserialization failed.
    #[error("manifest serialization failed")]
    Json {
        /// Original JSON error retained for local diagnostics.
        #[source]
        source: serde_json::Error,
    },

    /// A count or timestamp cannot fit in the stable report type.
    #[error("numeric value is outside the supported range")]
    ValueOutOfRange,
}

impl StoreError {
    /// Returns a stable machine code suitable for a future Command error DTO.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceLocked => "WORKSPACE_LOCKED",
            Self::SourceNotFile => "SOURCE_NOT_FILE",
            Self::SourceInsideWorkspace => "SOURCE_INSIDE_WORKSPACE",
            Self::InvalidFileName => "SOURCE_NAME_INVALID",
            Self::SourceChanged => "SOURCE_CHANGED",
            Self::InsufficientSpace { .. } => "DISK_SPACE_INSUFFICIENT",
            Self::ImportCanceled => "IMPORT_CANCELED",
            Self::IdentifierExists => "IMPORT_IDENTIFIER_EXISTS",
            Self::InvalidManagedPath => "MANAGED_PATH_INVALID",
            Self::UnsupportedBackup => "BACKUP_VERSION_UNSUPPORTED",
            Self::InvalidManifest => "BACKUP_MANIFEST_INVALID",
            Self::IntegrityMismatch => "FILE_INTEGRITY_MISMATCH",
            Self::DestinationExists => "DESTINATION_EXISTS",
            Self::DatabaseBusy { .. } => "DATABASE_BUSY",
            Self::Database { .. } => "DATABASE_ERROR",
            Self::Io { .. } => "FILE_OPERATION_FAILED",
            Self::Json { .. } => "MANIFEST_SERIALIZATION_FAILED",
            Self::ValueOutOfRange => "VALUE_OUT_OF_RANGE",
        }
    }
}

impl From<SqliteError> for StoreError {
    fn from(source: SqliteError) -> Self {
        let busy = matches!(
            source,
            SqliteError::SqliteFailure(
                rusqlite::ffi::Error {
                    code: ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked,
                    ..
                },
                _
            )
        );
        if busy {
            Self::DatabaseBusy { source }
        } else {
            Self::Database { source }
        }
    }
}

impl From<io::Error> for StoreError {
    fn from(source: io::Error) -> Self {
        Self::Io { source }
    }
}

impl From<serde_json::Error> for StoreError {
    fn from(source: serde_json::Error) -> Self {
        Self::Json { source }
    }
}
