//! Local infrastructure adapters.

mod resource_protocol;
mod sqlite_backup_store;
mod sqlite_blob_store;
mod sqlite_knowledge;
mod sqlite_planning;
mod sqlite_question;
mod sqlite_review;
mod sqlite_schedule;
mod sqlite_workspace;

pub(crate) use resource_protocol::{respond_image, respond_pdf};
pub(crate) use sqlite_backup_store::SqliteBackupStore;
pub(crate) use sqlite_blob_store::SqliteBlobStore;
pub(crate) use sqlite_knowledge::SqliteKnowledgeRepository;
pub(crate) use sqlite_planning::SqlitePlanningRepository;
pub(crate) use sqlite_question::SqliteQuestionRepository;
pub(crate) use sqlite_review::SqliteReviewRepository;
pub(crate) use sqlite_schedule::SqliteScheduleRepository;
pub(crate) use sqlite_workspace::SqliteWorkspaceRepository;
