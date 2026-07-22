//! Local infrastructure adapters.

mod ai_services;
mod resource_protocol;
mod sqlite_ai;
mod sqlite_analytics;
mod sqlite_backup_store;
mod sqlite_blob_store;
mod sqlite_knowledge;
mod sqlite_planning;
mod sqlite_planning_chat;
mod sqlite_question;
mod sqlite_review;
mod sqlite_schedule;
mod sqlite_search;
mod sqlite_workspace;

pub(crate) use ai_services::{ProviderRouter, SystemSecretStore};
pub(crate) use resource_protocol::{respond_image, respond_pdf};
pub(crate) use sqlite_ai::SqliteAiRepository;
pub(crate) use sqlite_analytics::SqliteAnalyticsRepository;
pub(crate) use sqlite_backup_store::SqliteBackupStore;
pub(crate) use sqlite_blob_store::SqliteBlobStore;
pub(crate) use sqlite_knowledge::SqliteKnowledgeRepository;
pub(crate) use sqlite_planning::SqlitePlanningRepository;
pub(crate) use sqlite_planning_chat::SqlitePlanningChatRepository;
pub(crate) use sqlite_question::SqliteQuestionRepository;
pub(crate) use sqlite_review::SqliteReviewRepository;
pub(crate) use sqlite_schedule::SqliteScheduleRepository;
pub(crate) use sqlite_search::SqliteSearchRepository;
pub(crate) use sqlite_workspace::SqliteWorkspaceRepository;
