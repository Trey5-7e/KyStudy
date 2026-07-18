use std::path::Path;

use uuid::Uuid;

use super::{PersistenceError, current_utc_millis};

/// Verified metadata for one complete workspace backup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BackupReport {
    pub(crate) directory_name: String,
    pub(crate) blob_count: u64,
    pub(crate) total_bytes: u64,
    pub(crate) created_at: i64,
}

/// Verified metadata for one independently restored workspace copy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RestoreReport {
    pub(crate) directory_name: String,
    pub(crate) blob_count: u64,
    pub(crate) total_bytes: u64,
}

/// Stable failures from complete backup and restore operations.
#[derive(Debug, thiserror::Error)]
pub(crate) enum BackupError {
    /// No default workspace exists yet.
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    /// A selected backup or destination parent is not a local directory.
    #[error("selected location is not a local directory")]
    SourceNotDirectory,
    /// A backup destination is inside the managed workspace.
    #[error("backup destination is inside the managed workspace")]
    DestinationInsideWorkspace,
    /// The backup format or schema version is unsupported.
    #[error("backup format is unsupported")]
    UnsupportedBackup,
    /// The Manifest and database records do not describe the same files.
    #[error("backup manifest is invalid")]
    InvalidManifest,
    /// A managed path violates the fixed backup or Blob layout.
    #[error("managed backup path is invalid")]
    InvalidManagedPath,
    /// A database or Blob digest does not match trusted metadata.
    #[error("backup integrity verification failed")]
    IntegrityMismatch,
    /// Backup and restore commits never overwrite an existing directory.
    #[error("destination already exists")]
    DestinationExists,
    /// The selected disk cannot hold the complete operation plus its reserve.
    #[error("insufficient disk space")]
    InsufficientSpace,
    /// A managed file operation failed.
    #[error("managed backup file operation failed")]
    File {
        #[source]
        source: std::io::Error,
    },
    /// Manifest serialization or deserialization failed.
    #[error("manifest serialization failed")]
    Manifest {
        #[source]
        source: serde_json::Error,
    },
    /// The `SQLite` workspace boundary failed.
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl BackupError {
    /// Returns the stable code exposed through the command boundary.
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::SourceNotDirectory => "BACKUP_SOURCE_NOT_DIRECTORY",
            Self::DestinationInsideWorkspace => "BACKUP_DESTINATION_INSIDE_WORKSPACE",
            Self::UnsupportedBackup => "BACKUP_VERSION_UNSUPPORTED",
            Self::InvalidManifest => "BACKUP_MANIFEST_INVALID",
            Self::InvalidManagedPath => "MANAGED_PATH_INVALID",
            Self::IntegrityMismatch => "FILE_INTEGRITY_MISMATCH",
            Self::DestinationExists => "DESTINATION_EXISTS",
            Self::InsufficientSpace => "DISK_SPACE_INSUFFICIENT",
            Self::File { .. } => "FILE_OPERATION_FAILED",
            Self::Manifest { .. } => "MANIFEST_SERIALIZATION_FAILED",
            Self::Persistence(error) => error.code(),
        }
    }
}

impl From<std::io::Error> for BackupError {
    fn from(source: std::io::Error) -> Self {
        Self::File { source }
    }
}

impl From<serde_json::Error> for BackupError {
    fn from(source: serde_json::Error) -> Self {
        Self::Manifest { source }
    }
}

/// Complete backup operations required by the application use cases.
pub(crate) trait BackupRepository: Clone + Send + Sync + 'static {
    /// Creates and verifies a new backup directory.
    fn create_backup(
        &self,
        destination: &Path,
        created_at: i64,
    ) -> Result<BackupReport, BackupError>;

    /// Restores a verified backup into a new, independent directory.
    fn restore_backup(
        &self,
        backup_directory: &Path,
        destination: &Path,
    ) -> Result<RestoreReport, BackupError>;
}

/// Backup use cases with a statically dispatched storage adapter.
#[derive(Debug, Clone)]
pub(crate) struct BackupUseCases<R> {
    repository: R,
}

impl<R: BackupRepository> BackupUseCases<R> {
    /// Composes backup use cases with one storage adapter.
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Creates a uniquely named backup below a backend-selected parent directory.
    pub(crate) fn create_in(&self, parent: &Path) -> Result<BackupReport, BackupError> {
        let created_at = current_utc_millis()?;
        let destination = parent.join(unique_directory_name("KyStudy-backup", created_at));
        self.repository.create_backup(&destination, created_at)
    }

    /// Restores a backup below a backend-selected parent without replacing current data.
    pub(crate) fn restore_into(
        &self,
        backup_directory: &Path,
        parent: &Path,
    ) -> Result<RestoreReport, BackupError> {
        let created_at = current_utc_millis()?;
        let destination = parent.join(unique_directory_name("KyStudy-restored", created_at));
        self.repository
            .restore_backup(backup_directory, &destination)
    }
}

fn unique_directory_name(prefix: &str, created_at: i64) -> String {
    let identifier = Uuid::now_v7().as_simple().to_string();
    format!("{prefix}-{created_at}-{identifier}")
}

#[cfg(test)]
mod tests {
    use super::unique_directory_name;

    #[test]
    fn generated_backup_directory_name_is_relative_and_unique() {
        let first = unique_directory_name("KyStudy-backup", 1_700_000_000_000);
        let second = unique_directory_name("KyStudy-backup", 1_700_000_000_000);

        assert!(first.starts_with("KyStudy-backup-1700000000000-"));
        assert_ne!(first, second);
        assert!(!first.contains(['/', '\\']));
    }
}
