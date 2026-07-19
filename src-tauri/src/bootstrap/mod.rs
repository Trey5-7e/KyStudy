//! Concrete application composition for the desktop runtime.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::application::{
    BackupUseCases, PlanningUseCases, ResourceUseCases, ScheduleUseCases, WorkspaceUseCases,
};
use crate::infrastructure::{
    SqliteBackupStore, SqliteBlobStore, SqlitePlanningRepository, SqliteScheduleRepository,
    SqliteWorkspaceRepository,
};

/// Tracks cancel flags without sharing `SQLite` connections across threads.
#[derive(Debug, Clone, Default)]
pub(crate) struct ImportCoordinator {
    active: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

/// Serializes operations that must observe one complete workspace state.
#[derive(Debug, Clone, Default)]
pub(crate) struct WorkspaceOperationGate {
    lock: Arc<Mutex<()>>,
}

impl WorkspaceOperationGate {
    /// Runs one import, backup, or restore operation under the shared gate.
    pub(crate) fn run<T>(&self, operation: impl FnOnce() -> T) -> T {
        let _guard = self.lock.lock().unwrap_or_else(PoisonError::into_inner);
        operation()
    }
}

impl ImportCoordinator {
    /// Registers one operation before its blocking import task starts.
    pub(crate) fn register(&self, operation_id: String) -> Arc<AtomicBool> {
        let canceled = Arc::new(AtomicBool::new(false));
        self.active_jobs()
            .insert(operation_id, Arc::clone(&canceled));
        canceled
    }

    /// Requests cancellation if the operation is still streaming.
    pub(crate) fn cancel(&self, operation_id: &str) -> bool {
        let Some(canceled) = self.active_jobs().get(operation_id).cloned() else {
            return false;
        };
        canceled.store(true, Ordering::Relaxed);
        true
    }

    /// Removes a completed operation from the in-memory registry.
    pub(crate) fn finish(&self, operation_id: &str) {
        self.active_jobs().remove(operation_id);
    }

    fn active_jobs(&self) -> MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.active.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// State managed by Tauri and shared with thin command adapters.
pub(crate) struct AppState {
    pub(crate) workspace: WorkspaceUseCases<SqliteWorkspaceRepository>,
    pub(crate) resources: ResourceUseCases<SqliteBlobStore>,
    pub(crate) schedule: ScheduleUseCases<SqliteScheduleRepository>,
    pub(crate) planning: PlanningUseCases<SqlitePlanningRepository>,
    pub(crate) backups: BackupUseCases<SqliteBackupStore>,
    pub(crate) imports: ImportCoordinator,
    pub(crate) operations: WorkspaceOperationGate,
}

impl AppState {
    /// Composes the workspace use cases below an application-owned directory.
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace_repository = SqliteWorkspaceRepository::new(application_data_directory);
        let blob_store = SqliteBlobStore::new(application_data_directory);
        let schedule_repository = SqliteScheduleRepository::new(application_data_directory);
        let planning_repository = SqlitePlanningRepository::new(application_data_directory);
        let backup_store = SqliteBackupStore::new(application_data_directory);
        Self {
            workspace: WorkspaceUseCases::new(workspace_repository),
            resources: ResourceUseCases::new(blob_store),
            schedule: ScheduleUseCases::new(schedule_repository),
            planning: PlanningUseCases::new(planning_repository),
            backups: BackupUseCases::new(backup_store),
            imports: ImportCoordinator::default(),
            operations: WorkspaceOperationGate::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ImportCoordinator;

    #[test]
    fn coordinator_cancels_only_active_operations() {
        let coordinator = ImportCoordinator::default();
        let canceled = coordinator.register("active".to_owned());

        let accepted = coordinator.cancel("active");
        coordinator.finish("active");

        assert!(accepted);
        assert!(canceled.load(std::sync::atomic::Ordering::Relaxed));
        assert!(!coordinator.cancel("active"));
    }
}
