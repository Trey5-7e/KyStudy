use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};

use crate::application::{
    PlanningChatError, PlanningChatRepository, PlanningContextSelection, PlanningConversation,
    PlanningMessage, PlanningSource, ResolvedPlanningContext, context_token_estimate, trim_chars,
};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

#[derive(Debug, Clone)]
pub(crate) struct SqlitePlanningChatRepository {
    database_path: PathBuf,
}

impl SqlitePlanningChatRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, PlanningChatError> {
        if !self.database_path.exists() {
            return Err(PlanningChatError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

impl PlanningChatRepository for SqlitePlanningChatRepository {
    fn list_conversations(&self) -> Result<Vec<PlanningConversation>, PlanningChatError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id, title, created_at, updated_at FROM ai_conversation
                 ORDER BY updated_at DESC, id DESC LIMIT 20",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(database_error)?;
        rows.map(|row| {
            let (id, title, created_at, updated_at) = row.map_err(database_error)?;
            load_conversation(&connection, id, title, created_at, updated_at)
        })
        .collect()
    }

    fn create_conversation(
        &self,
        id: &str,
        title: &str,
        now: i64,
    ) -> Result<PlanningConversation, PlanningChatError> {
        let connection = self.open()?;
        let workspace_id = workspace_id(&connection)?;
        connection
            .execute(
                "INSERT INTO ai_conversation(id, workspace_id, title, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, workspace_id, title, now],
            )
            .map_err(database_error)?;
        Ok(PlanningConversation {
            id: id.to_owned(),
            title: title.to_owned(),
            messages: Vec::new(),
            created_at: now,
            updated_at: now,
        })
    }

    fn load_history(
        &self,
        conversation_id: &str,
        limit: u32,
    ) -> Result<Vec<PlanningMessage>, PlanningChatError> {
        let connection = self.open()?;
        ensure_conversation(&connection, conversation_id)?;
        load_messages(&connection, conversation_id, limit, true)
    }

    fn resolve_contexts(
        &self,
        selections: &[PlanningContextSelection],
    ) -> Result<Vec<ResolvedPlanningContext>, PlanningChatError> {
        let connection = self.open()?;
        let mut seen = HashSet::new();
        selections
            .iter()
            .enumerate()
            .map(|(index, selection)| {
                if uuid::Uuid::parse_str(&selection.document_id).is_err()
                    || selection.page_number == 0
                    || selection.search_query.trim().is_empty()
                    || selection.search_query.chars().count() > 100
                    || !seen.insert((selection.document_id.as_str(), selection.page_number))
                {
                    return Err(PlanningChatError::InvalidInput);
                }
                let resolved = connection
                    .query_row(
                        "SELECT d.title, c.text, c.chunk_hash
                         FROM resource_text_chunk c
                         JOIN resource_document d ON d.id = c.document_id
                         WHERE c.document_id = ?1 AND c.page_number = ?2
                           AND d.deleted_at IS NULL
                           AND d.role = 'planning'
                         ORDER BY CASE
                            WHEN instr(lower(c.text), lower(?3)) > 0 THEN 0 ELSE 1
                         END, c.sequence
                         LIMIT 1",
                        params![
                            selection.document_id,
                            i64::from(selection.page_number),
                            selection.search_query.trim()
                        ],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                            ))
                        },
                    )
                    .optional()
                    .map_err(database_error)?
                    .ok_or(PlanningChatError::ContextNotFound)?;
                Ok(ResolvedPlanningContext {
                    source: PlanningSource {
                        document_id: selection.document_id.clone(),
                        document_title: resolved.0,
                        page_number: selection.page_number,
                        citation_label: format!("[资料{}]", index + 1),
                    },
                    text: resolved.1,
                    content_hash: resolved.2,
                })
            })
            .collect()
    }

    fn append_exchange(
        &self,
        conversation_id: &str,
        question: &str,
        answer: &str,
        call_id: &str,
        contexts: &[ResolvedPlanningContext],
        now: i64,
    ) -> Result<PlanningConversation, PlanningChatError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        ensure_conversation(&transaction, conversation_id)?;
        let user_message_id = uuid::Uuid::now_v7().to_string();
        let assistant_message_id = uuid::Uuid::now_v7().to_string();
        transaction
            .execute(
                "INSERT INTO ai_message(id, conversation_id, role, content_markdown, created_at)
                 VALUES (?1, ?2, 'user', ?3, ?4)",
                params![user_message_id, conversation_id, question, now],
            )
            .map_err(database_error)?;
        transaction
            .execute(
                "INSERT INTO ai_message(
                    id, conversation_id, role, content_markdown, ai_call_id, created_at
                 ) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5)",
                params![
                    assistant_message_id,
                    conversation_id,
                    answer,
                    call_id,
                    now + 1
                ],
            )
            .map_err(database_error)?;
        for context in contexts {
            transaction
                .execute(
                    "INSERT INTO ai_context_ref(
                        ai_call_id, document_id, page_number, citation_label,
                        content_hash, token_estimate
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        call_id,
                        context.source.document_id,
                        i64::from(context.source.page_number),
                        context.source.citation_label,
                        context.content_hash,
                        i64::try_from(context_token_estimate(&context.text))
                            .map_err(|_| PlanningChatError::InvalidInput)?,
                    ],
                )
                .map_err(database_error)?;
        }
        transaction
            .execute(
                "UPDATE ai_conversation SET updated_at = ?2 WHERE id = ?1",
                params![conversation_id, now + 1],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        load_conversation_by_id(&connection, conversation_id)
    }

    fn save_reply_as_plan(
        &self,
        message_id: &str,
        title: &str,
        plan_id: &str,
        now: i64,
    ) -> Result<String, PlanningChatError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let (overview, call_id) = transaction
            .query_row(
                "SELECT content_markdown, ai_call_id FROM ai_message
                 WHERE id = ?1 AND role = 'assistant' AND ai_call_id IS NOT NULL",
                [message_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(PlanningChatError::ReplyNotFound)?;
        if overview.chars().count() > 8_000 {
            return Err(PlanningChatError::InvalidInput);
        }
        let workspace_id = workspace_id(&transaction)?;
        transaction
            .execute(
                "INSERT INTO study_plan(
                    id, workspace_id, title, overview, status, revision,
                    created_at, updated_at, source_ai_message_id
                 ) VALUES (?1, ?2, ?3, ?4, 'draft', 1, ?5, ?5, ?6)",
                params![plan_id, workspace_id, title, overview, now, message_id],
            )
            .map_err(database_error)?;
        let mut statement = transaction
            .prepare(
                "SELECT document_id, page_number, citation_label
                 FROM ai_context_ref WHERE ai_call_id = ?1
                 ORDER BY citation_label, document_id, page_number",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([call_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(database_error)?;
        for row in rows {
            let (document_id, page_number, label) = row.map_err(database_error)?;
            transaction
                .execute(
                    "INSERT INTO plan_reference(
                        id, plan_id, document_id, page_start, page_end, note, created_at
                     ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)",
                    params![
                        uuid::Uuid::now_v7().to_string(),
                        plan_id,
                        document_id,
                        page_number,
                        format!("来自 AI 规划对话 {label}"),
                        now
                    ],
                )
                .map_err(database_error)?;
        }
        drop(statement);
        transaction.commit().map_err(database_error)?;
        Ok(plan_id.to_owned())
    }
}

fn load_conversation_by_id(
    connection: &Connection,
    conversation_id: &str,
) -> Result<PlanningConversation, PlanningChatError> {
    connection
        .query_row(
            "SELECT id, title, created_at, updated_at FROM ai_conversation WHERE id = ?1",
            [conversation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(PlanningChatError::ConversationNotFound)
        .and_then(|(id, title, created_at, updated_at)| {
            load_conversation(connection, id, title, created_at, updated_at)
        })
}

fn load_conversation(
    connection: &Connection,
    id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
) -> Result<PlanningConversation, PlanningChatError> {
    Ok(PlanningConversation {
        messages: load_messages(connection, &id, 50, false)?,
        id,
        title,
        created_at,
        updated_at,
    })
}

fn load_messages(
    connection: &Connection,
    conversation_id: &str,
    limit: u32,
    newest_first: bool,
) -> Result<Vec<PlanningMessage>, PlanningChatError> {
    let mut statement = connection
        .prepare(
            "SELECT id, role, content_markdown, ai_call_id, created_at
             FROM ai_message WHERE conversation_id = ?1
             ORDER BY created_at DESC, id DESC LIMIT ?2",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map(params![conversation_id, i64::from(limit)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(database_error)?;
    let mut messages = rows
        .map(|row| {
            let (id, role, content, call_id, created_at) = row.map_err(database_error)?;
            let sources = call_id.map_or_else(
                || Ok(Vec::new()),
                |call_id| load_sources(connection, &call_id),
            )?;
            Ok(PlanningMessage {
                id,
                role,
                content: trim_chars(&content, 20_000),
                sources,
                created_at,
            })
        })
        .collect::<Result<Vec<_>, PlanningChatError>>()?;
    if !newest_first {
        messages.reverse();
    }
    Ok(messages)
}

fn load_sources(
    connection: &Connection,
    call_id: &str,
) -> Result<Vec<PlanningSource>, PlanningChatError> {
    let mut statement = connection
        .prepare(
            "SELECT r.document_id, d.title, r.page_number, r.citation_label
             FROM ai_context_ref r
             JOIN resource_document d ON d.id = r.document_id
             WHERE r.ai_call_id = ?1
             ORDER BY r.citation_label, r.document_id, r.page_number",
        )
        .map_err(database_error)?;
    statement
        .query_map([call_id], |row| {
            Ok(PlanningSource {
                document_id: row.get(0)?,
                document_title: row.get(1)?,
                page_number: u32::try_from(row.get::<_, i64>(2)?).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Integer,
                        Box::new(error),
                    )
                })?,
                citation_label: row.get(3)?,
            })
        })
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(Into::into))
        .collect()
}

fn ensure_conversation(
    connection: &Connection,
    conversation_id: &str,
) -> Result<(), PlanningChatError> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM ai_conversation WHERE id = ?1)",
            [conversation_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(database_error)?;
    if exists {
        Ok(())
    } else {
        Err(PlanningChatError::ConversationNotFound)
    }
}

fn workspace_id(connection: &Connection) -> Result<String, PlanningChatError> {
    connection
        .query_row(
            "SELECT id FROM workspace WHERE singleton_key = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(PlanningChatError::WorkspaceNotInitialized)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, PoisonError};

    use rusqlite::params;
    use tempfile::tempdir;

    use super::SqlitePlanningChatRepository;
    use crate::application::{
        AiError, AiUseCases, ConfirmPlanningChatInput, PlanningChatError, PlanningChatInput,
        PlanningChatRepository, PlanningChatUseCases, PlanningContextSelection, SecretStore,
        WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{ProviderRouter, SqliteAiRepository, SqliteWorkspaceRepository};

    const DOCUMENT_ID: &str = "019f7328-4b66-7613-9729-e3570fc41525";

    struct ContextFixture {
        _directory: tempfile::TempDir,
        repository: SqlitePlanningChatRepository,
    }

    impl ContextFixture {
        fn selection(document_id: &str) -> PlanningContextSelection {
            PlanningContextSelection {
                document_id: document_id.to_owned(),
                page_number: 1,
                search_query: "context".to_owned(),
            }
        }

        fn assert_context_not_found(&self) {
            let error = self
                .repository
                .resolve_contexts(&[Self::selection(DOCUMENT_ID)])
                .expect_err("ineligible documents must not resolve as planning context");
            assert!(matches!(error, PlanningChatError::ContextNotFound));
        }

        fn set_document_metadata(&self, role: &str, kind: &str, deleted_at: Option<i64>) {
            let connection = self.repository.open().expect("database should open");
            connection
                .execute(
                    "UPDATE resource_document
                     SET role = ?1, kind = ?2, deleted_at = ?3
                     WHERE id = ?4",
                    params![role, kind, deleted_at, DOCUMENT_ID],
                )
                .expect("document metadata should update");
        }
    }

    fn context_fixture() -> ContextFixture {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let repository = SqlitePlanningChatRepository::new(directory.path());
        let connection = repository.open().expect("database should open");
        let workspace_id: String = connection
            .query_row(
                "SELECT id FROM workspace WHERE singleton_key = 1",
                [],
                |row| row.get(0),
            )
            .expect("workspace should exist");
        let blob_id = "019f7328-4b66-7613-9729-e3570fc41526";
        let hash = "0".repeat(64);
        connection
            .execute(
                "INSERT INTO blob(
                    id, workspace_id, sha256, size_bytes, storage_key, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![blob_id, &workspace_id, &hash, 1_i64, "blobs/context", 1_i64],
            )
            .expect("blob fixture should insert");
        connection
            .execute(
                "INSERT INTO resource_document(
                    id, workspace_id, blob_id, title, original_name, kind, mime_type,
                    created_at, updated_at, revision, role, page_count, deleted_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, 'pdf', 'application/pdf', ?6, ?6, 1,
                           'planning', 1, NULL)",
                params![
                    DOCUMENT_ID,
                    &workspace_id,
                    blob_id,
                    "Active planning PDF",
                    "context.pdf",
                    1_i64
                ],
            )
            .expect("document fixture should insert");
        connection
            .execute(
                "INSERT INTO resource_page_text(
                    document_id, page_number, width_points, height_points, text_state,
                    text_content, content_hash, indexed_at
                 ) VALUES (?1, 1, 1.0, 1.0, 'text', ?2, ?3, ?4)",
                params![DOCUMENT_ID, "planning context", &hash, 1_i64],
            )
            .expect("page text fixture should insert");
        connection
            .execute(
                "INSERT INTO resource_text_chunk(
                    id, document_id, page_number, sequence, text, chunk_hash, created_at
                 ) VALUES (?1, ?2, 1, 0, ?3, ?4, ?5)",
                params![
                    uuid::Uuid::now_v7().to_string(),
                    DOCUMENT_ID,
                    "planning context",
                    &hash,
                    1_i64
                ],
            )
            .expect("text chunk fixture should insert");

        ContextFixture {
            _directory: directory,
            repository,
        }
    }

    #[derive(Debug, Clone, Default)]
    struct MemorySecretStore(Arc<Mutex<HashMap<String, String>>>);

    impl SecretStore for MemorySecretStore {
        fn has(&self, reference: &str) -> Result<bool, AiError> {
            Ok(self
                .0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .contains_key(reference))
        }

        fn get(&self, reference: &str) -> Result<Option<String>, AiError> {
            Ok(self
                .0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get(reference)
                .cloned())
        }

        fn set(&self, reference: &str, secret: &str) -> Result<(), AiError> {
            self.0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(reference.to_owned(), secret.to_owned());
            Ok(())
        }

        fn delete(&self, reference: &str) -> Result<(), AiError> {
            self.0
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(reference);
            Ok(())
        }
    }

    #[test]
    fn confirmed_reply_persists_messages_and_creates_only_a_draft_plan() {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let repository = SqlitePlanningChatRepository::new(directory.path());
        let ai = AiUseCases::new(
            SqliteAiRepository::new(directory.path()),
            MemorySecretStore::default(),
            ProviderRouter,
        );
        let use_cases = PlanningChatUseCases::new(repository.clone(), ai);
        let conversation = use_cases
            .create("强化阶段讨论")
            .expect("conversation should create");
        let chat = PlanningChatInput {
            conversation_id: conversation.id,
            question: "如何安排每天的复习？".to_owned(),
            contexts: Vec::new(),
            max_output_tokens: 300,
        };
        let preview = use_cases.preview(&chat).expect("preview should compile");
        let reply = use_cases
            .execute(&ConfirmPlanningChatInput {
                chat,
                confirmed_prompt: preview.preview.prompt,
            })
            .expect("confirmed chat should execute");

        assert_eq!(reply.conversation.messages.len(), 2);
        let assistant = reply
            .conversation
            .messages
            .last()
            .expect("assistant message should exist");
        let plan_id = use_cases
            .save_reply_as_plan(&assistant.id, "AI 强化规划草案")
            .expect("reply should become a draft");
        let connection = repository.open().expect("database should open");
        let (status, source_message, purpose) = connection
            .query_row(
                "SELECT p.status, p.source_ai_message_id, c.purpose
                 FROM study_plan p
                 JOIN ai_message m ON m.id = p.source_ai_message_id
                 JOIN ai_call c ON c.id = m.ai_call_id
                 WHERE p.id = ?1",
                [plan_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .expect("draft provenance should load");

        assert_eq!(status, "draft");
        assert_eq!(source_message, assistant.id);
        assert_eq!(purpose, "planning_chat");
    }

    #[test]
    fn resolve_contexts_accepts_active_planning_pdf_page_text() {
        let fixture = context_fixture();

        let contexts = fixture
            .repository
            .resolve_contexts(&[ContextFixture::selection(DOCUMENT_ID)])
            .expect("active planning PDF should resolve");

        assert_eq!(
            (
                contexts[0].source.document_title.as_str(),
                contexts[0].text.as_str()
            ),
            ("Active planning PDF", "planning context")
        );
    }

    #[test]
    fn resolve_contexts_accepts_active_planning_non_pdf_page_text() {
        let fixture = context_fixture();
        fixture.set_document_metadata("planning", "document", None);

        let contexts = fixture
            .repository
            .resolve_contexts(&[ContextFixture::selection(DOCUMENT_ID)])
            .expect("active planning non-PDF should resolve");

        assert_eq!(contexts[0].text, "planning context");
    }

    #[test]
    fn resolve_contexts_rejects_reference_workbook_and_trashed_documents() {
        let fixture = context_fixture();

        for (role, kind, deleted_at) in [
            ("reference", "pdf", None),
            ("workbook", "pdf", None),
            ("planning", "pdf", Some(1_700_000_000_100_i64)),
        ] {
            fixture.set_document_metadata(role, kind, deleted_at);
            fixture.assert_context_not_found();
        }
    }
}
