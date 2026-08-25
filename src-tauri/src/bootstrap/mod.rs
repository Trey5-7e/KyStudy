//! Concrete application composition for the desktop runtime.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::application::{
    AiUseCases, AnalyticsUseCases, BackupUseCases, CyclePlanUseCases, KnowledgeUseCases,
    OcrUseCases, PlanProgressUseCases, PlanScheduleUseCases, PlanningChatUseCases,
    PlanningUseCases, QuestionBankUseCases, QuestionUseCases, ResourceUseCases,
    ReviewSchemeUseCases, ReviewUseCases, ScheduleUseCases, SearchUseCases, WorkspaceUseCases,
};
use crate::infrastructure::{
    LocalOcrWorker, ProviderRouter, SqliteAiRepository, SqliteAnalyticsRepository,
    SqliteBackupStore, SqliteBlobStore, SqliteCyclePlanRepository, SqliteKnowledgeRepository,
    SqliteOcrRepository, SqlitePlanProgressRepository, SqlitePlanningChatRepository,
    SqlitePlanningRepository, SqliteQuestionBankRepository, SqliteQuestionRepository,
    SqliteReviewRepository, SqliteReviewSchemeRepository, SqliteScheduleRepository,
    SqliteSearchRepository, SqliteWorkspaceRepository, SystemSecretStore,
};

/// Tracks cancel flags without sharing `SQLite` connections across threads.
#[derive(Debug, Clone, Default)]
pub(crate) struct ImportCoordinator {
    active: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

/// Tracks active OCR processes so a separate command can request cancellation.
#[derive(Debug, Clone, Default)]
pub(crate) struct OcrCoordinator {
    active: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

/// Tracks cancellable AI chat calls. The underlying HTTP request may still
/// finish, but the application drops its result after the flag is raised.
#[derive(Debug, Clone, Default)]
pub(crate) struct AiChatCoordinator {
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

impl OcrCoordinator {
    /// Registers the only OCR process allowed to run at a time.
    pub(crate) fn register(&self, operation_id: String) -> Option<Arc<AtomicBool>> {
        let mut active = self.active_jobs();
        if !active.is_empty() {
            return None;
        }
        let canceled = Arc::new(AtomicBool::new(false));
        active.insert(operation_id, Arc::clone(&canceled));
        Some(canceled)
    }

    /// Requests cancellation of a currently running OCR process.
    pub(crate) fn cancel(&self, operation_id: &str) -> bool {
        let Some(canceled) = self.active_jobs().get(operation_id).cloned() else {
            return false;
        };
        canceled.store(true, Ordering::Relaxed);
        true
    }

    /// Removes a completed operation from the cancellation registry.
    pub(crate) fn finish(&self, operation_id: &str) {
        self.active_jobs().remove(operation_id);
    }

    /// Reports whether a worker is still using the installed component.
    pub(crate) fn is_active(&self) -> bool {
        !self.active_jobs().is_empty()
    }

    fn active_jobs(&self) -> MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.active.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl AiChatCoordinator {
    pub(crate) fn register(&self, operation_id: String) -> Option<Arc<AtomicBool>> {
        let mut active = self.active_jobs();
        if active.contains_key(&operation_id) {
            return None;
        }
        let canceled = Arc::new(AtomicBool::new(false));
        active.insert(operation_id, Arc::clone(&canceled));
        Some(canceled)
    }

    pub(crate) fn cancel(&self, operation_id: &str) -> bool {
        let Some(canceled) = self.active_jobs().get(operation_id).cloned() else {
            return false;
        };
        canceled.store(true, Ordering::Relaxed);
        true
    }

    pub(crate) fn finish(&self, operation_id: &str) {
        self.active_jobs().remove(operation_id);
    }

    fn active_jobs(&self) -> MutexGuard<'_, HashMap<String, Arc<AtomicBool>>> {
        self.active.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// State managed by Tauri and shared with thin command adapters.
pub(crate) struct AppState {
    application_data_directory: PathBuf,
    pub(crate) workspace: WorkspaceUseCases<SqliteWorkspaceRepository>,
    pub(crate) resources: ResourceUseCases<SqliteBlobStore>,
    pub(crate) schedule: ScheduleUseCases<SqliteScheduleRepository>,
    pub(crate) plan_schedule: PlanScheduleUseCases<SqliteScheduleRepository>,
    pub(crate) plan_progress: PlanProgressUseCases<SqlitePlanProgressRepository>,
    pub(crate) planning: PlanningUseCases<SqlitePlanningRepository>,
    pub(crate) knowledge: KnowledgeUseCases<SqliteKnowledgeRepository, SqliteBlobStore>,
    pub(crate) questions: QuestionUseCases<SqliteQuestionRepository>,
    pub(crate) question_bank: QuestionBankUseCases<SqliteQuestionBankRepository>,
    pub(crate) ocr: OcrUseCases<SqliteOcrRepository, LocalOcrWorker>,
    pub(crate) reviews: ReviewUseCases<SqliteReviewRepository>,
    pub(crate) review_schemes: ReviewSchemeUseCases<SqliteReviewSchemeRepository>,
    pub(crate) cycle_plans: CyclePlanUseCases<SqliteCyclePlanRepository>,
    pub(crate) search: SearchUseCases<SqliteSearchRepository>,
    pub(crate) ai: AiUseCases<SqliteAiRepository, SystemSecretStore, ProviderRouter>,
    pub(crate) analytics: AnalyticsUseCases<SqliteAnalyticsRepository>,
    pub(crate) planning_chat: PlanningChatUseCases<
        SqlitePlanningChatRepository,
        SqliteAiRepository,
        SystemSecretStore,
        ProviderRouter,
    >,
    pub(crate) ai_chat: PlanningChatUseCases<
        SqlitePlanningChatRepository,
        SqliteAiRepository,
        SystemSecretStore,
        ProviderRouter,
    >,
    pub(crate) backups: BackupUseCases<SqliteBackupStore>,
    pub(crate) imports: ImportCoordinator,
    pub(crate) ocr_jobs: OcrCoordinator,
    pub(crate) ai_chat_jobs: AiChatCoordinator,
    pub(crate) operations: WorkspaceOperationGate,
}

impl AppState {
    /// Composes the workspace use cases below an application-owned directory.
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace_repository = SqliteWorkspaceRepository::new(application_data_directory);
        let blob_store = SqliteBlobStore::new(application_data_directory);
        let schedule_repository = SqliteScheduleRepository::new(application_data_directory);
        let planning_repository = SqlitePlanningRepository::new(application_data_directory);
        let plan_progress_repository =
            SqlitePlanProgressRepository::new(application_data_directory);
        let knowledge_repository = SqliteKnowledgeRepository::new(application_data_directory);
        let question_repository = SqliteQuestionRepository::new(application_data_directory);
        let question_bank_repository =
            SqliteQuestionBankRepository::new(application_data_directory);
        let ocr_repository = SqliteOcrRepository::new(application_data_directory);
        let review_repository = SqliteReviewRepository::new(application_data_directory);
        let review_scheme_repository =
            SqliteReviewSchemeRepository::new(application_data_directory);
        let cycle_plan_repository = SqliteCyclePlanRepository::new(application_data_directory);
        let search_repository = SqliteSearchRepository::new(application_data_directory);
        let ai_repository = SqliteAiRepository::new(application_data_directory);
        let analytics_repository = SqliteAnalyticsRepository::new(application_data_directory);
        let planning_chat_repository =
            SqlitePlanningChatRepository::new(application_data_directory);
        let ai_chat_repository = SqlitePlanningChatRepository::new_chat(application_data_directory);
        let backup_store = SqliteBackupStore::new(application_data_directory);
        let ai = AiUseCases::new(ai_repository, SystemSecretStore, ProviderRouter);
        Self {
            application_data_directory: application_data_directory.to_path_buf(),
            workspace: WorkspaceUseCases::new(workspace_repository),
            resources: ResourceUseCases::new(blob_store.clone()),
            schedule: ScheduleUseCases::new(schedule_repository.clone()),
            plan_schedule: PlanScheduleUseCases::new(schedule_repository),
            plan_progress: PlanProgressUseCases::new(plan_progress_repository),
            planning: PlanningUseCases::new(planning_repository),
            knowledge: KnowledgeUseCases::new(
                knowledge_repository,
                ResourceUseCases::new(blob_store),
            ),
            questions: QuestionUseCases::new(question_repository),
            question_bank: QuestionBankUseCases::new(question_bank_repository),
            ocr: OcrUseCases::new(
                ocr_repository,
                LocalOcrWorker::new(application_data_directory),
            ),
            reviews: ReviewUseCases::new(review_repository),
            review_schemes: ReviewSchemeUseCases::new(review_scheme_repository),
            cycle_plans: CyclePlanUseCases::new(cycle_plan_repository),
            search: SearchUseCases::new(search_repository),
            planning_chat: PlanningChatUseCases::new(planning_chat_repository, ai.clone()),
            ai_chat: PlanningChatUseCases::new_chat(ai_chat_repository, ai.clone()),
            ai,
            analytics: AnalyticsUseCases::new(analytics_repository),
            backups: BackupUseCases::new(backup_store),
            imports: ImportCoordinator::default(),
            ocr_jobs: OcrCoordinator::default(),
            ai_chat_jobs: AiChatCoordinator::default(),
            operations: WorkspaceOperationGate::default(),
        }
    }

    pub(crate) fn data_directory(&self) -> &Path {
        &self.application_data_directory
    }
}

#[cfg(test)]
mod tests {
    use super::{AiChatCoordinator, ImportCoordinator, OcrCoordinator};

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

    #[test]
    fn ocr_coordinator_rejects_duplicate_jobs_and_cleans_up() {
        let coordinator = OcrCoordinator::default();
        let canceled = coordinator
            .register("ocr-job".to_owned())
            .expect("the first OCR job should register");

        assert!(coordinator.register("ocr-job".to_owned()).is_none());
        assert!(coordinator.register("another-job".to_owned()).is_none());
        assert!(coordinator.cancel("ocr-job"));
        assert!(canceled.load(std::sync::atomic::Ordering::Relaxed));

        coordinator.finish("ocr-job");
        assert!(!coordinator.cancel("ocr-job"));
        assert!(coordinator.register("ocr-job".to_owned()).is_some());
    }

    #[test]
    fn ai_chat_coordinator_cancels_and_releases_one_operation() {
        let coordinator = AiChatCoordinator::default();
        let canceled = coordinator
            .register("ai-chat-job".to_owned())
            .expect("the AI chat operation should register");

        assert!(coordinator.register("ai-chat-job".to_owned()).is_none());
        assert!(coordinator.cancel("ai-chat-job"));
        assert!(canceled.load(std::sync::atomic::Ordering::Relaxed));

        coordinator.finish("ai-chat-job");
        assert!(!coordinator.cancel("ai-chat-job"));
        assert!(coordinator.register("ai-chat-job".to_owned()).is_some());
    }
}
