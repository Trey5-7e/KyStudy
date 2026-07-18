use std::error::Error;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::domain::{NewWorkspace, Workspace};

type BoxError = Box<dyn Error + Send + Sync>;

/// Stable persistence failures shared by the use case and its infrastructure adapter.
#[derive(Debug, thiserror::Error)]
pub(crate) enum PersistenceError {
    /// The database could not obtain its write lock in time.
    #[error("database is busy")]
    Busy {
        #[source]
        source: BoxError,
    },
    /// The workspace directory or database file could not be accessed.
    #[error("workspace storage is unavailable")]
    StorageUnavailable {
        #[source]
        source: BoxError,
    },
    /// The local database does not belong to `KyStudy` or violates a required invariant.
    #[error("database configuration is unsupported")]
    UnsupportedConfiguration,
    /// The database was created by a newer application schema.
    #[error("database schema {found} is newer than supported schema {supported}")]
    UnsupportedSchema { found: u32, supported: u32 },
    /// Migration history differs from the migration embedded in this application.
    #[error("migration history is inconsistent")]
    MigrationHistoryInconsistent,
    /// A migration failed and its transaction was rolled back.
    #[error("database migration failed")]
    MigrationFailed {
        #[source]
        source: BoxError,
    },
    /// `SQLite` could not read or write a typed workspace record.
    #[error("workspace database operation failed")]
    Database {
        #[source]
        source: BoxError,
    },
    /// The system clock cannot be represented as a UTC millisecond timestamp.
    #[error("system time is unsupported")]
    InvalidSystemTime,
}

impl PersistenceError {
    /// Returns the stable code exposed by the command error DTO.
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::Busy { .. } => "DATABASE_BUSY",
            Self::StorageUnavailable { .. } => "WORKSPACE_STORAGE_UNAVAILABLE",
            Self::UnsupportedConfiguration => "DATABASE_CONFIGURATION_UNSUPPORTED",
            Self::UnsupportedSchema { .. } => "SCHEMA_VERSION_UNSUPPORTED",
            Self::MigrationHistoryInconsistent => "MIGRATION_HISTORY_INCONSISTENT",
            Self::MigrationFailed { .. } => "MIGRATION_FAILED",
            Self::Database { .. } => "DATABASE_ERROR",
            Self::InvalidSystemTime => "SYSTEM_TIME_INVALID",
        }
    }
}

/// Persistence operations required by the workspace use cases.
pub(crate) trait WorkspaceRepository: Clone + Send + Sync + 'static {
    /// Returns the existing default workspace without creating one.
    fn find_default(&self) -> Result<Option<Workspace>, PersistenceError>;

    /// Creates the default workspace, or returns the existing record after a concurrent call.
    fn initialize_default(&self, workspace: &NewWorkspace) -> Result<Workspace, PersistenceError>;
}

/// Workspace use cases with a statically dispatched persistence adapter.
#[derive(Debug, Clone)]
pub(crate) struct WorkspaceUseCases<R> {
    repository: R,
}

impl<R: WorkspaceRepository> WorkspaceUseCases<R> {
    /// Composes workspace use cases with one repository implementation.
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Returns the current workspace if it has already been initialized.
    pub(crate) fn status(&self) -> Result<Option<Workspace>, PersistenceError> {
        self.repository.find_default()
    }

    /// Creates the first workspace with product defaults and returns its persisted metadata.
    pub(crate) fn initialize_default(&self) -> Result<Workspace, PersistenceError> {
        let workspace = NewWorkspace::default_at(current_utc_millis()?);
        self.repository.initialize_default(&workspace)
    }
}

/// Returns the current UTC Unix timestamp in milliseconds.
pub(crate) fn current_utc_millis() -> Result<i64, PersistenceError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| PersistenceError::InvalidSystemTime)?;
    i64::try_from(duration.as_millis()).map_err(|_| PersistenceError::InvalidSystemTime)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{PersistenceError, WorkspaceRepository, WorkspaceUseCases};
    use crate::domain::{NewWorkspace, Workspace};

    #[derive(Debug, Clone, Default)]
    struct MemoryRepository {
        workspace: Arc<Mutex<Option<Workspace>>>,
    }

    impl WorkspaceRepository for MemoryRepository {
        fn find_default(&self) -> Result<Option<Workspace>, PersistenceError> {
            let workspace =
                self.workspace
                    .lock()
                    .map_err(|source| PersistenceError::StorageUnavailable {
                        source: Box::new(std::io::Error::other(source.to_string())),
                    })?;
            Ok(workspace.clone())
        }

        fn initialize_default(
            &self,
            workspace: &NewWorkspace,
        ) -> Result<Workspace, PersistenceError> {
            let persisted = Workspace {
                id: workspace.id.clone(),
                name: workspace.name.clone(),
                timezone: workspace.timezone.clone(),
                daily_review_quota: workspace.daily_review_quota,
                early_fill_enabled: workspace.early_fill_enabled,
                created_at: workspace.created_at,
                schema_version: 1,
            };
            let mut current =
                self.workspace
                    .lock()
                    .map_err(|source| PersistenceError::StorageUnavailable {
                        source: Box::new(std::io::Error::other(source.to_string())),
                    })?;
            Ok(current.get_or_insert(persisted).clone())
        }
    }

    #[test]
    fn status_returns_none_before_initialization() {
        let use_cases = WorkspaceUseCases::new(MemoryRepository::default());

        assert_eq!(use_cases.status().expect("status should load"), None);
    }

    #[test]
    fn initialize_default_persists_a_workspace() {
        let use_cases = WorkspaceUseCases::new(MemoryRepository::default());

        let workspace = use_cases
            .initialize_default()
            .expect("workspace should initialize");

        assert_eq!(workspace.name, "我的考研工作区");
    }
}
