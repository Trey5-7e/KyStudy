use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params, types::Type};
use sha2::{Digest, Sha256};

use crate::domain::AiConversationKind;

use crate::application::{
    AiAttachmentRef, PlanningChatError, PlanningChatRepository, PlanningContextSelection,
    PlanningConversation, PlanningMessage, PlanningSource, ResolvedPlanningAttachment,
    ResolvedPlanningContext, ResolvedPlanningFile, TemporaryAttachmentInput,
    context_token_estimate, trim_chars,
};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

const MAXIMUM_ATTACHMENTS: u32 = 6;
const MAXIMUM_ATTACHMENT_BYTES: i64 = 104_857_600;
const MAXIMUM_ATTACHMENT_TEXT_CHARS: usize = 8_000;

#[derive(Debug, Clone)]
pub(crate) struct SqlitePlanningChatRepository {
    database_path: PathBuf,
    temporary_directory: PathBuf,
    kind: AiConversationKind,
}

impl SqlitePlanningChatRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        Self::with_kind(application_data_directory, AiConversationKind::Planning)
    }

    pub(crate) fn new_chat(application_data_directory: &Path) -> Self {
        Self::with_kind(application_data_directory, AiConversationKind::Chat)
    }

    fn with_kind(application_data_directory: &Path, kind: AiConversationKind) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
            temporary_directory: application_data_directory.join("temporary-ai-attachments"),
            kind,
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

    fn temporary_directory_for(&self, attachment_id: &str) -> Option<PathBuf> {
        uuid::Uuid::parse_str(attachment_id)
            .ok()
            .map(|_| self.temporary_directory.join(attachment_id))
    }

    fn temporary_payload_is_valid(&self, attachment: &AiAttachmentRef) -> bool {
        let Some(directory) = self.temporary_directory_for(&attachment.id) else {
            return false;
        };
        fs::metadata(directory.join("payload"))
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() == attachment.size_bytes)
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
                "SELECT id, title, conversation_kind, model_profile_id, created_at, updated_at
                 FROM ai_conversation
                 WHERE conversation_kind = ?1
                 ORDER BY updated_at DESC, id DESC LIMIT 20",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([self.kind.as_str()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            })
            .map_err(database_error)?;
        rows.map(|row| {
            let (id, title, kind, model_profile_id, created_at, updated_at) =
                row.map_err(database_error)?;
            load_conversation(
                &connection,
                id,
                title,
                &kind,
                model_profile_id,
                created_at,
                updated_at,
                self.kind,
            )
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
                "INSERT INTO ai_conversation(
                    id, workspace_id, title, conversation_kind, created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
                params![id, workspace_id, title, self.kind.as_str(), now],
            )
            .map_err(database_error)?;
        Ok(PlanningConversation {
            id: id.to_owned(),
            title: title.to_owned(),
            kind: self.kind,
            model_profile_id: None,
            messages: Vec::new(),
            created_at: now,
            updated_at: now,
        })
    }

    fn rename_conversation(
        &self,
        conversation_id: &str,
        title: &str,
        now: i64,
    ) -> Result<PlanningConversation, PlanningChatError> {
        let connection = self.open()?;
        ensure_conversation(&connection, conversation_id, self.kind)?;
        connection
            .execute(
                "UPDATE ai_conversation SET title = ?2, updated_at = ?3 WHERE id = ?1",
                params![conversation_id, title, now],
            )
            .map_err(database_error)?;
        load_conversation_by_id(&connection, conversation_id, self.kind)
    }

    fn delete_conversation(&self, conversation_id: &str) -> Result<(), PlanningChatError> {
        let connection = self.open()?;
        ensure_conversation(&connection, conversation_id, self.kind)?;
        let temporary_ids = {
            let mut statement = connection
                .prepare(
                    "SELECT id FROM ai_attachment_ref
                     WHERE conversation_id = ?1 AND source = 'temporary'",
                )
                .map_err(database_error)?;
            statement
                .query_map([conversation_id], |row| row.get::<_, String>(0))
                .map_err(database_error)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(database_error)?
        };
        connection
            .execute(
                "DELETE FROM ai_conversation WHERE id = ?1",
                [conversation_id],
            )
            .map_err(database_error)?;
        for attachment_id in temporary_ids {
            if let Some(directory) = self.temporary_directory_for(&attachment_id) {
                let _ = fs::remove_dir_all(directory);
            }
        }
        Ok(())
    }

    fn list_attachments(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<AiAttachmentRef>, PlanningChatError> {
        let connection = self.open()?;
        ensure_conversation(&connection, conversation_id, self.kind)?;
        let mut statement = connection
            .prepare(
                "SELECT a.id, a.conversation_id, a.source, a.document_id, a.file_name,
                        a.mime_type, a.size_bytes, a.sha256,
                        CASE
                            WHEN a.source = 'resource'
                              AND a.status NOT IN ('expired', 'failed')
                              AND NOT EXISTS (
                                  SELECT 1
                                  FROM resource_document d
                                  JOIN blob b ON b.id = d.blob_id
                                  WHERE d.id = a.document_id
                                    AND d.deleted_at IS NULL
                                    AND b.integrity_state = 'ok'
                              )
                            THEN 'failed'
                            ELSE a.status
                        END AS status,
                        CASE
                            WHEN a.source = 'resource'
                              AND a.status NOT IN ('expired', 'failed')
                              AND NOT EXISTS (
                                  SELECT 1
                                  FROM resource_document d
                                  JOIN blob b ON b.id = d.blob_id
                                  WHERE d.id = a.document_id
                                    AND d.deleted_at IS NULL
                                    AND b.integrity_state = 'ok'
                              )
                            THEN 'AI_ATTACHMENT_RESOURCE_NOT_FOUND'
                            ELSE a.error_code
                        END AS error_code,
                        a.created_at, a.updated_at
                 FROM ai_attachment_ref a
                 WHERE a.conversation_id = ?1
                 ORDER BY a.updated_at DESC, a.id DESC",
            )
            .map_err(database_error)?;
        let rows = statement
            .query_map([conversation_id], attachment_from_row)
            .map_err(database_error)?;
        let mut attachments = rows
            .map(|row| {
                row.map_err(database_error)
                    .map_err(PlanningChatError::Persistence)
            })
            .collect::<Result<Vec<_>, _>>()?;
        for attachment in &mut attachments {
            if attachment.source == "temporary"
                && !matches!(attachment.status.as_str(), "expired" | "failed")
                && !self.temporary_payload_is_valid(attachment)
            {
                "failed".clone_into(&mut attachment.status);
                attachment.error_code = Some("AI_ATTACHMENT_TEMPORARY_NOT_FOUND".to_owned());
            }
        }
        Ok(attachments)
    }

    fn attach_resource(
        &self,
        conversation_id: &str,
        document_id: &str,
        attachment_id: &str,
        now: i64,
    ) -> Result<AiAttachmentRef, PlanningChatError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        ensure_conversation(&transaction, conversation_id, self.kind)?;

        if let Some(existing) = transaction
            .query_row(
                "SELECT id, conversation_id, source, document_id, file_name,
                        mime_type, size_bytes, sha256, status, error_code,
                        created_at, updated_at
                 FROM ai_attachment_ref
                 WHERE conversation_id = ?1 AND source = 'resource' AND document_id = ?2",
                params![conversation_id, document_id],
                attachment_from_row,
            )
            .optional()
            .map_err(database_error)?
        {
            return Ok(existing);
        }

        let count: u32 = transaction
            .query_row(
                "SELECT COUNT(*) FROM ai_attachment_ref WHERE conversation_id = ?1",
                [conversation_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if count >= MAXIMUM_ATTACHMENTS {
            return Err(PlanningChatError::AttachmentLimitReached);
        }

        let resource = transaction
            .query_row(
                "SELECT d.original_name, d.mime_type, b.size_bytes, b.sha256
                 FROM resource_document d
                 JOIN blob b ON b.id = d.blob_id
                 WHERE d.id = ?1 AND d.deleted_at IS NULL
                   AND b.integrity_state = 'ok'",
                [document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(database_error)?
            .ok_or(PlanningChatError::AttachmentResourceNotFound)?;
        if resource.0.trim().is_empty()
            || resource.0.chars().count() > 240
            || resource.1.trim().is_empty()
            || resource.1.chars().count() > 120
            || resource.2 < 0
            || resource.2 > MAXIMUM_ATTACHMENT_BYTES
            || resource.3.len() != 64
        {
            return Err(PlanningChatError::AttachmentInvalid);
        }

        transaction
            .execute(
                "INSERT INTO ai_attachment_ref(
                    id, conversation_id, source, document_id, file_name,
                    mime_type, size_bytes, sha256, status, error_code,
                    created_at, updated_at
                 ) VALUES (?1, ?2, 'resource', ?3, ?4, ?5, ?6, ?7,
                           'ready', NULL, ?8, ?8)",
                params![
                    attachment_id,
                    conversation_id,
                    document_id,
                    resource.0.trim(),
                    resource.1.trim(),
                    resource.2,
                    resource.3,
                    now,
                ],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        load_attachment_by_id(&connection, attachment_id)
    }

    fn attach_temporary(
        &self,
        input: TemporaryAttachmentInput,
        now: i64,
    ) -> Result<AiAttachmentRef, PlanningChatError> {
        let mut connection = self.open()?;
        ensure_conversation(&connection, &input.conversation_id, self.kind)?;
        let count: u32 = connection
            .query_row(
                "SELECT COUNT(*) FROM ai_attachment_ref WHERE conversation_id = ?1",
                [&input.conversation_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if count >= MAXIMUM_ATTACHMENTS {
            return Err(PlanningChatError::AttachmentLimitReached);
        }

        let Some(payload_directory) = self.temporary_directory_for(&input.attachment_id) else {
            return Err(PlanningChatError::AttachmentInvalid);
        };
        let payload_path = payload_directory.join("payload");
        if payload_path.exists() {
            return Err(PlanningChatError::AttachmentTemporaryFailed);
        }
        fs::create_dir_all(&payload_directory)
            .map_err(|_| PlanningChatError::AttachmentTemporaryFailed)?;
        if let Err(error) =
            copy_temporary_payload(input.file, &payload_path, input.size_bytes, &input.sha256)
        {
            let _ = fs::remove_dir_all(&payload_directory);
            return Err(error);
        }

        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let size_bytes =
            i64::try_from(input.size_bytes).map_err(|_| PlanningChatError::AttachmentInvalid)?;
        if let Err(error) = transaction.execute(
            "INSERT INTO ai_attachment_ref(
                id, conversation_id, source, document_id, file_name,
                mime_type, size_bytes, sha256, status, error_code,
                created_at, updated_at
             ) VALUES (?1, ?2, 'temporary', NULL, ?3, ?4, ?5, ?6,
                       'ready', NULL, ?7, ?7)",
            params![
                input.attachment_id,
                input.conversation_id,
                input.file_name.trim(),
                input.mime_type.trim(),
                size_bytes,
                input.sha256.to_ascii_uppercase(),
                now,
            ],
        ) {
            let _ = fs::remove_dir_all(&payload_directory);
            return Err(PlanningChatError::Persistence(database_error(error)));
        }
        transaction.commit().map_err(|error| {
            let _ = fs::remove_dir_all(&payload_directory);
            PlanningChatError::Persistence(database_error(error))
        })?;
        load_attachment_by_id(&connection, &input.attachment_id)
    }

    fn remove_attachment(&self, attachment_id: &str) -> Result<(), PlanningChatError> {
        let connection = self.open()?;
        let source = connection
            .query_row(
                "SELECT source FROM ai_attachment_ref WHERE id = ?1",
                [attachment_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(PlanningChatError::AttachmentNotFound)?;
        connection
            .execute(
                "DELETE FROM ai_attachment_ref WHERE id = ?1",
                [attachment_id],
            )
            .map_err(database_error)?;
        if source == "temporary"
            && let Some(directory) = self.temporary_directory_for(attachment_id)
        {
            let _ = fs::remove_dir_all(directory);
        }
        Ok(())
    }

    fn retry_attachment(
        &self,
        attachment_id: &str,
        now: i64,
    ) -> Result<AiAttachmentRef, PlanningChatError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let (source, document_id) = transaction
            .query_row(
                "SELECT source, document_id
                 FROM ai_attachment_ref
                 WHERE id = ?1",
                [attachment_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(PlanningChatError::AttachmentNotFound)?;
        let Some(document_id) = document_id else {
            return Err(PlanningChatError::AttachmentInvalid);
        };
        if source != "resource" {
            return Err(PlanningChatError::AttachmentInvalid);
        }
        let resource_exists: bool = transaction
            .query_row(
                "SELECT EXISTS(
                    SELECT 1
                    FROM resource_document d
                    JOIN blob b ON b.id = d.blob_id
                    WHERE d.id = ?1
                      AND d.deleted_at IS NULL
                      AND b.integrity_state = 'ok'
                )",
                [document_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if !resource_exists {
            return Err(PlanningChatError::AttachmentResourceNotFound);
        }
        transaction
            .execute(
                "UPDATE ai_attachment_ref
                 SET status = 'ready', error_code = NULL, updated_at = ?2
                 WHERE id = ?1",
                params![attachment_id, now],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        load_attachment_by_id(&connection, attachment_id)
    }

    fn expire_temporary_attachments(&self, now: i64) -> Result<(), PlanningChatError> {
        let connection = self.open()?;
        let temporary_ids = connection
            .prepare("SELECT id FROM ai_attachment_ref WHERE source = 'temporary'")
            .map_err(database_error)?
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(database_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(database_error)?;
        connection
            .execute(
                "UPDATE ai_attachment_ref
                 SET status = 'expired', error_code = NULL,
                     updated_at = CASE WHEN updated_at > ?1 THEN updated_at ELSE ?1 END
                 WHERE source = 'temporary' AND status <> 'expired'",
                [now],
            )
            .map_err(database_error)?;
        for attachment_id in temporary_ids {
            if let Some(directory) = self.temporary_directory_for(&attachment_id) {
                let _ = fs::remove_dir_all(directory);
            }
        }
        Ok(())
    }

    fn resolve_attachment_text(
        &self,
        document_id: &str,
    ) -> Result<Option<ResolvedPlanningAttachment>, PlanningChatError> {
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT c.page_number, c.text
                 FROM resource_text_chunk c
                 JOIN resource_document d ON d.id = c.document_id
                 WHERE c.document_id = ?1 AND d.deleted_at IS NULL
                 ORDER BY c.page_number, c.sequence",
            )
            .map_err(database_error)?;
        let mut rows = statement.query([document_id]).map_err(database_error)?;
        let mut text = String::new();
        let mut pages = HashSet::new();
        while let Some(row) = rows.next().map_err(database_error)? {
            let page_number = row.get::<_, i64>(0).map_err(database_error)?;
            let chunk = row.get::<_, String>(1).map_err(database_error)?;
            if page_number > 0 {
                pages.insert(page_number);
            }
            if text.chars().count() >= MAXIMUM_ATTACHMENT_TEXT_CHARS {
                continue;
            }
            let remaining = MAXIMUM_ATTACHMENT_TEXT_CHARS.saturating_sub(text.chars().count());
            text.push_str(&trim_chars(&chunk, remaining));
            text.push('\n');
        }
        let text = text.trim().to_owned();
        if text.is_empty() {
            return Ok(None);
        }
        Ok(Some(ResolvedPlanningAttachment {
            text,
            indexed_pages: u32::try_from(pages.len()).unwrap_or(u32::MAX),
        }))
    }

    fn resolve_temporary_attachment_file(
        &self,
        attachment_id: &str,
    ) -> Result<Option<ResolvedPlanningFile>, PlanningChatError> {
        let connection = self.open()?;
        let metadata = connection
            .query_row(
                "SELECT source, status, file_name, mime_type, size_bytes, sha256
                 FROM ai_attachment_ref WHERE id = ?1",
                [attachment_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, Option<String>>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(database_error)?;
        let Some((source, status, file_name, mime_type, size_bytes, sha256)) = metadata else {
            return Ok(None);
        };
        let Some(sha256) = sha256 else {
            return Ok(None);
        };
        if source != "temporary" || status != "ready" || size_bytes < 0 || sha256.len() != 64 {
            return Ok(None);
        }
        let size_bytes =
            u64::try_from(size_bytes).map_err(|_| PlanningChatError::AttachmentInvalid)?;
        let Some(directory) = self.temporary_directory_for(attachment_id) else {
            return Ok(None);
        };
        let path = directory.join("payload");
        if !temporary_payload_matches(&path, size_bytes, &sha256) {
            return Ok(None);
        }
        Ok(Some(ResolvedPlanningFile {
            file_name,
            mime_type,
            path,
            size_bytes,
            sha256,
        }))
    }

    fn load_history(
        &self,
        conversation_id: &str,
        limit: u32,
    ) -> Result<Vec<PlanningMessage>, PlanningChatError> {
        let connection = self.open()?;
        ensure_conversation(&connection, conversation_id, self.kind)?;
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
                           AND (?4 = 'chat' OR d.role = 'planning')
                         ORDER BY CASE
                            WHEN instr(lower(c.text), lower(?3)) > 0 THEN 0 ELSE 1
                         END, c.sequence
                         LIMIT 1",
                        params![
                            selection.document_id,
                            i64::from(selection.page_number),
                            selection.search_query.trim(),
                            self.kind.as_str(),
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
        ensure_conversation(&transaction, conversation_id, self.kind)?;
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
        load_conversation_by_id(&connection, conversation_id, self.kind)
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
    expected_kind: AiConversationKind,
) -> Result<PlanningConversation, PlanningChatError> {
    connection
        .query_row(
            "SELECT id, title, conversation_kind, model_profile_id, created_at, updated_at
             FROM ai_conversation
             WHERE id = ?1 AND conversation_kind = ?2",
            params![conversation_id, expected_kind.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(PlanningChatError::ConversationNotFound)
        .and_then(
            |(id, title, kind, model_profile_id, created_at, updated_at)| {
                load_conversation(
                    connection,
                    id,
                    title,
                    &kind,
                    model_profile_id,
                    created_at,
                    updated_at,
                    expected_kind,
                )
            },
        )
}

fn load_attachment_by_id(
    connection: &Connection,
    attachment_id: &str,
) -> Result<AiAttachmentRef, PlanningChatError> {
    Ok(connection
        .query_row(
            "SELECT id, conversation_id, source, document_id, file_name,
                    mime_type, size_bytes, sha256, status, error_code,
                    created_at, updated_at
             FROM ai_attachment_ref WHERE id = ?1",
            [attachment_id],
            attachment_from_row,
        )
        .map_err(database_error)?)
}

fn attachment_from_row(row: &Row<'_>) -> rusqlite::Result<AiAttachmentRef> {
    let size_bytes = row.get::<_, i64>(6)?;
    let size_bytes = u64::try_from(size_bytes).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(6, Type::Integer, Box::new(error))
    })?;
    Ok(AiAttachmentRef {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        source: row.get(2)?,
        document_id: row.get(3)?,
        file_name: row.get(4)?,
        mime_type: row.get(5)?,
        size_bytes,
        sha256: row.get(7)?,
        status: row.get(8)?,
        error_code: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

#[allow(clippy::too_many_arguments)]
fn load_conversation(
    connection: &Connection,
    id: String,
    title: String,
    kind: &str,
    model_profile_id: Option<String>,
    created_at: i64,
    updated_at: i64,
    expected_kind: AiConversationKind,
) -> Result<PlanningConversation, PlanningChatError> {
    let kind = AiConversationKind::parse(kind).ok_or(PlanningChatError::ConversationNotFound)?;
    if kind != expected_kind {
        return Err(PlanningChatError::ConversationNotFound);
    }
    Ok(PlanningConversation {
        messages: load_messages(connection, &id, 50, false)?,
        id,
        title,
        kind,
        model_profile_id,
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

fn copy_temporary_payload(
    mut source: File,
    destination: &Path,
    expected_size: u64,
    expected_sha256: &str,
) -> Result<(), PlanningChatError> {
    let mut target =
        File::create(destination).map_err(|_| PlanningChatError::AttachmentTemporaryFailed)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    let mut copied = 0_u64;
    loop {
        let read = source
            .read(&mut buffer)
            .map_err(|_| PlanningChatError::AttachmentTemporaryFailed)?;
        if read == 0 {
            break;
        }
        copied = copied
            .checked_add(read as u64)
            .ok_or(PlanningChatError::AttachmentTemporaryFailed)?;
        if copied > expected_size || copied > MAXIMUM_ATTACHMENT_BYTES as u64 {
            return Err(PlanningChatError::AttachmentInvalid);
        }
        target
            .write_all(&buffer[..read])
            .map_err(|_| PlanningChatError::AttachmentTemporaryFailed)?;
        hasher.update(&buffer[..read]);
    }
    if copied != expected_size
        || format!("{:X}", hasher.finalize()) != expected_sha256.to_ascii_uppercase()
    {
        return Err(PlanningChatError::AttachmentTemporaryFailed);
    }
    target
        .flush()
        .map_err(|_| PlanningChatError::AttachmentTemporaryFailed)
}

fn temporary_payload_matches(path: &Path, expected_size: u64, expected_sha256: &str) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() || metadata.len() != expected_size {
        return false;
    }
    let Ok(mut file) = File::open(path) else {
        return false;
    };
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let Ok(read) = file.read(&mut buffer) else {
            return false;
        };
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    format!("{:X}", hasher.finalize()) == expected_sha256.to_ascii_uppercase()
}

fn ensure_conversation(
    connection: &Connection,
    conversation_id: &str,
    expected_kind: AiConversationKind,
) -> Result<(), PlanningChatError> {
    let exists = connection
        .query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM ai_conversation
                 WHERE id = ?1 AND conversation_kind = ?2
             )",
            params![conversation_id, expected_kind.as_str()],
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
    use std::fs::{self, File};
    use std::sync::{Arc, Mutex, PoisonError};

    use rusqlite::params;
    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::SqlitePlanningChatRepository;
    use crate::application::{
        AiError, AiUseCases, ConfirmPlanningChatInput, PlanningChatError, PlanningChatInput,
        PlanningChatRepository, PlanningChatUseCases, PlanningContextSelection,
        SaveAiProviderCapabilitiesInput, SaveAiProviderInput, SecretStore,
        TemporaryAttachmentInput, WorkspaceRepository,
    };
    use crate::domain::{AiCapabilitySource, AiCapabilityState, AiModelCapabilities, NewWorkspace};
    use crate::infrastructure::{ProviderRouter, SqliteAiRepository, SqliteWorkspaceRepository};

    const DOCUMENT_ID: &str = "019f7328-4b66-7613-9729-e3570fc41525";

    struct ContextFixture {
        directory: tempfile::TempDir,
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
            directory,
            repository,
        }
    }

    #[test]
    fn chat_repository_isolated_from_planning_conversations() {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let planning = SqlitePlanningChatRepository::new(directory.path());
        let chat = SqlitePlanningChatRepository::new_chat(directory.path());

        planning
            .create_conversation(
                "019f7328-4b66-7613-9729-e3570fc41527",
                "规划会话",
                1_700_000_000_001,
            )
            .expect("planning conversation should create");
        chat.create_conversation(
            "019f7328-4b66-7613-9729-e3570fc41528",
            "通用会话",
            1_700_000_000_002,
        )
        .expect("chat conversation should create");

        let planning_items = planning
            .list_conversations()
            .expect("planning conversations should list");
        let chat_items = chat
            .list_conversations()
            .expect("chat conversations should list");
        assert_eq!(planning_items.len(), 1);
        assert_eq!(chat_items.len(), 1);
        assert_eq!(
            planning_items[0].kind,
            crate::domain::AiConversationKind::Planning
        );
        assert_eq!(chat_items[0].kind, crate::domain::AiConversationKind::Chat);
    }

    #[test]
    fn startup_expires_temporary_attachments_without_touching_conversation_history() {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let repository = SqlitePlanningChatRepository::new(directory.path());
        let conversation = repository
            .create_conversation(
                "019f7328-4b66-7613-9729-e3570fc41529",
                "temporary attachment",
                1_700_000_000_001,
            )
            .expect("conversation should create");
        let connection = repository.open().expect("database should open");
        connection
            .execute(
                "INSERT INTO ai_attachment_ref(
                    id, conversation_id, source, document_id, file_name,
                    mime_type, size_bytes, sha256, status, error_code,
                    created_at, updated_at
                 ) VALUES (?1, ?2, 'temporary', NULL, 'upload.pdf',
                           'application/pdf', 12, NULL, 'ready', NULL, ?3, ?4)",
                params![
                    "019f7328-4b66-7613-9729-e3570fc41530",
                    conversation.id,
                    1_700_000_000_010_i64,
                    1_700_000_000_020_i64
                ],
            )
            .expect("temporary attachment should insert");

        repository
            .expire_temporary_attachments(1_700_000_000_030)
            .expect("temporary attachment should expire");

        let (status, error_code, updated_at): (String, Option<String>, i64) = connection
            .query_row(
                "SELECT status, error_code, updated_at
                 FROM ai_attachment_ref WHERE id = ?1",
                ["019f7328-4b66-7613-9729-e3570fc41530"],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("temporary attachment should remain queryable");
        assert_eq!(status, "expired");
        assert_eq!(error_code, None);
        assert_eq!(updated_at, 1_700_000_000_030);
        assert_eq!(repository.list_conversations().unwrap().len(), 1);
    }

    #[test]
    fn temporary_attachment_copies_verified_bytes_and_removes_them_with_the_reference() {
        let fixture = context_fixture();
        let conversation_id = "019f7328-4b66-7613-9729-e3570fc41527";
        fixture
            .repository
            .create_conversation(conversation_id, "temporary upload", 10)
            .expect("conversation should create");
        let bytes = b"temporary attachment text";
        let source = fixture.directory.path().join("temporary-source.txt");
        fs::write(&source, bytes).expect("temporary source should write");
        let attachment_id = "019f7328-4b66-7613-9729-e3570fc41530";
        let attached = fixture
            .repository
            .attach_temporary(
                TemporaryAttachmentInput {
                    conversation_id: conversation_id.to_owned(),
                    attachment_id: attachment_id.to_owned(),
                    file_name: "temporary-source.txt".to_owned(),
                    mime_type: "text/plain".to_owned(),
                    size_bytes: bytes.len() as u64,
                    sha256: format!("{:X}", Sha256::digest(bytes)),
                    file: File::open(&source).expect("temporary source should open"),
                },
                11,
            )
            .expect("temporary attachment should persist");
        assert_eq!(attached.source, "temporary");
        assert_eq!(attached.status, "ready");
        let payload = fixture
            .directory
            .path()
            .join("temporary-ai-attachments")
            .join(attachment_id)
            .join("payload");
        assert_eq!(fs::read(&payload).expect("payload should exist"), bytes);

        fs::remove_file(&payload).expect("payload should be removable for diagnosis");
        let diagnosed = fixture
            .repository
            .list_attachments(conversation_id)
            .expect("attachments should list");
        assert_eq!(diagnosed[0].status, "failed");
        assert_eq!(
            diagnosed[0].error_code.as_deref(),
            Some("AI_ATTACHMENT_TEMPORARY_NOT_FOUND")
        );

        fixture
            .repository
            .remove_attachment(attachment_id)
            .expect("temporary attachment should remove");
        assert!(!payload.exists());
    }

    #[test]
    fn temporary_attachment_file_boundary_rejects_payload_changes() {
        let fixture = context_fixture();
        let conversation_id = "019f7328-4b66-7613-9729-e3570fc41527";
        fixture
            .repository
            .create_conversation(conversation_id, "native file boundary", 10)
            .expect("conversation should create");
        let bytes = b"verified native payload";
        let source = fixture.directory.path().join("native-source.txt");
        fs::write(&source, bytes).expect("native source should write");
        let attachment_id = "019f7328-4b66-7613-9729-e3570fc41530";
        fixture
            .repository
            .attach_temporary(
                TemporaryAttachmentInput {
                    conversation_id: conversation_id.to_owned(),
                    attachment_id: attachment_id.to_owned(),
                    file_name: "native-source.txt".to_owned(),
                    mime_type: "text/plain".to_owned(),
                    size_bytes: bytes.len() as u64,
                    sha256: format!("{:X}", Sha256::digest(bytes)),
                    file: File::open(&source).expect("native source should open"),
                },
                11,
            )
            .expect("temporary attachment should persist");

        let resolved = fixture
            .repository
            .resolve_temporary_attachment_file(attachment_id)
            .expect("native file should resolve")
            .expect("native file should be available");
        assert_eq!(resolved.size_bytes, bytes.len() as u64);
        assert_eq!(
            fs::read(&resolved.path).expect("payload should read"),
            bytes
        );

        fs::write(&resolved.path, b"tampered payload").expect("payload should mutate");
        assert!(
            fixture
                .repository
                .resolve_temporary_attachment_file(attachment_id)
                .expect("tampered payload lookup should not fail")
                .is_none()
        );
    }

    #[test]
    fn planning_preview_uses_native_file_only_after_capability_calibration() {
        let fixture = context_fixture();
        let conversation_id = "019f7328-4b66-7613-9729-e3570fc41527";
        fixture
            .repository
            .create_conversation(conversation_id, "native file preview", 10)
            .expect("conversation should create");
        let bytes = b"native provider input";
        let source = fixture.directory.path().join("native-provider.txt");
        fs::write(&source, bytes).expect("native source should write");
        let attachment_id = "019f7328-4b66-7613-9729-e3570fc41530";
        let attachment = fixture
            .repository
            .attach_temporary(
                TemporaryAttachmentInput {
                    conversation_id: conversation_id.to_owned(),
                    attachment_id: attachment_id.to_owned(),
                    file_name: "native-provider.txt".to_owned(),
                    mime_type: "text/plain".to_owned(),
                    size_bytes: bytes.len() as u64,
                    sha256: format!("{:X}", Sha256::digest(bytes)),
                    file: File::open(&source).expect("native source should open"),
                },
                11,
            )
            .expect("temporary attachment should persist");
        let ai = AiUseCases::new(
            SqliteAiRepository::new(fixture.directory.path()),
            MemorySecretStore::default(),
            ProviderRouter,
        );
        let provider = ai
            .create_provider(&SaveAiProviderInput {
                provider_type: "openai_responses".to_owned(),
                display_name: "Native file test".to_owned(),
                base_url: Some("https://api.openai.com/v1".to_owned()),
                model_name: "file-model".to_owned(),
                context_limit: 128_000,
                max_output_tokens: 800,
            })
            .expect("responses provider should create")
            .providers
            .into_iter()
            .find(|entry| entry.provider.display_name == "Native file test")
            .expect("new provider should be listed");
        ai.activate_provider(&provider.provider.id)
            .expect("responses provider should activate");
        ai.save_provider_capabilities(
            &provider.provider.id,
            &SaveAiProviderCapabilitiesInput {
                capabilities: AiModelCapabilities {
                    supports_image: AiCapabilityState::Unknown,
                    supports_file: AiCapabilityState::Supported,
                    supports_pdf: AiCapabilityState::Unknown,
                    capability_source: AiCapabilitySource::Manual,
                },
            },
        )
        .expect("file capability should calibrate");

        let use_cases = PlanningChatUseCases::new(fixture.repository.clone(), ai);
        let preview = use_cases
            .preview(&PlanningChatInput {
                conversation_id: conversation_id.to_owned(),
                question: "请读取这个文件".to_owned(),
                contexts: Vec::new(),
                question_context: None,
                attachment_ids: vec![attachment.id],
                image_data_urls: Vec::new(),
                max_output_tokens: 300,
            })
            .expect("native file preview should compile");
        assert_eq!(preview.transport, "native_file");
        assert_eq!(preview.attachments[0].transport, "native_file");
        assert!(preview.attachments[0].warning.is_none());
        assert!(preview.preview.prompt.contains("请读取这个文件"));
    }

    #[test]
    fn deleting_conversation_removes_temporary_payloads() {
        let fixture = context_fixture();
        let conversation_id = "019f7328-4b66-7613-9729-e3570fc41527";
        fixture
            .repository
            .create_conversation(conversation_id, "temporary cleanup", 10)
            .expect("conversation should create");
        let bytes = b"conversation-scoped temporary attachment";
        let source = fixture.directory.path().join("delete-source.txt");
        fs::write(&source, bytes).expect("temporary source should write");
        let attachment_id = "019f7328-4b66-7613-9729-e3570fc41530";
        fixture
            .repository
            .attach_temporary(
                TemporaryAttachmentInput {
                    conversation_id: conversation_id.to_owned(),
                    attachment_id: attachment_id.to_owned(),
                    file_name: "delete-source.txt".to_owned(),
                    mime_type: "text/plain".to_owned(),
                    size_bytes: bytes.len() as u64,
                    sha256: format!("{:X}", Sha256::digest(bytes)),
                    file: File::open(&source).expect("temporary source should open"),
                },
                11,
            )
            .expect("temporary attachment should persist");
        let payload = fixture
            .directory
            .path()
            .join("temporary-ai-attachments")
            .join(attachment_id)
            .join("payload");
        assert!(payload.exists());

        fixture
            .repository
            .delete_conversation(conversation_id)
            .expect("conversation should delete");
        assert!(!payload.exists());
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
            question_context: None,
            attachment_ids: Vec::new(),
            image_data_urls: Vec::new(),
            max_output_tokens: 300,
        };
        let preview = use_cases.preview(&chat).expect("preview should compile");
        let stale = use_cases.execute(&ConfirmPlanningChatInput {
            chat: chat.clone(),
            confirmed_prompt: preview.preview.prompt.clone(),
            confirmed_request_fingerprint: "0".repeat(64),
        });
        assert!(matches!(stale, Err(PlanningChatError::PreviewStale)));
        let reply = use_cases
            .execute(&ConfirmPlanningChatInput {
                chat,
                confirmed_prompt: preview.preview.prompt,
                confirmed_request_fingerprint: preview.preview.request_fingerprint,
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
    fn generic_chat_persists_general_chat_calls() {
        let directory = tempdir().expect("temporary directory should exist");
        SqliteWorkspaceRepository::new(directory.path())
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let repository = SqlitePlanningChatRepository::new_chat(directory.path());
        let ai = AiUseCases::new(
            SqliteAiRepository::new(directory.path()),
            MemorySecretStore::default(),
            ProviderRouter,
        );
        let use_cases = PlanningChatUseCases::new_chat(repository.clone(), ai);
        let conversation = use_cases
            .create("通用学习对话")
            .expect("chat conversation should create");
        let chat = PlanningChatInput {
            conversation_id: conversation.id,
            question: "请解释间隔重复的基本原则".to_owned(),
            contexts: Vec::new(),
            question_context: None,
            attachment_ids: Vec::new(),
            image_data_urls: Vec::new(),
            max_output_tokens: 300,
        };
        let preview = use_cases
            .preview(&chat)
            .expect("chat preview should compile");
        let reply = use_cases
            .execute(&ConfirmPlanningChatInput {
                chat,
                confirmed_prompt: preview.preview.prompt,
                confirmed_request_fingerprint: preview.preview.request_fingerprint,
            })
            .expect("chat should execute");

        let connection = repository.open().expect("database should open");
        let purpose: String = connection
            .query_row(
                "SELECT purpose FROM ai_call WHERE conversation_id = ?1",
                [reply.conversation.id],
                |row| row.get(0),
            )
            .expect("generic call should persist");
        assert_eq!(purpose, "general_chat");
    }

    #[test]
    fn resource_attachment_is_idempotent_and_removable() {
        let fixture = context_fixture();
        let conversation_id = "019f7328-4b66-7613-9729-e3570fc41527";
        fixture
            .repository
            .create_conversation(conversation_id, "Attachment test", 10)
            .expect("conversation should create");

        let first = fixture
            .repository
            .attach_resource(
                conversation_id,
                DOCUMENT_ID,
                "019f7328-4b66-7613-9729-e3570fc41528",
                11,
            )
            .expect("resource should attach");
        assert_eq!(first.source, "resource");
        assert_eq!(first.document_id.as_deref(), Some(DOCUMENT_ID));
        assert_eq!(first.file_name, "context.pdf");
        assert_eq!(first.status, "ready");

        fixture.set_document_metadata("planning", "pdf", Some(1_700_000_000_100));
        let unavailable = fixture
            .repository
            .list_attachments(conversation_id)
            .expect("attachment diagnostics should load");
        assert_eq!(unavailable[0].status, "failed");
        assert_eq!(
            unavailable[0].error_code.as_deref(),
            Some("AI_ATTACHMENT_RESOURCE_NOT_FOUND")
        );
        fixture.set_document_metadata("planning", "pdf", None);

        let idempotent = fixture
            .repository
            .attach_resource(
                conversation_id,
                DOCUMENT_ID,
                "019f7328-4b66-7613-9729-e3570fc41529",
                12,
            )
            .expect("re-attaching the same resource should be idempotent");
        assert_eq!(idempotent.id, first.id);
        assert_eq!(
            fixture
                .repository
                .list_attachments(conversation_id)
                .unwrap()
                .len(),
            1
        );

        fixture
            .repository
            .remove_attachment(&first.id)
            .expect("attachment should remove");
        assert!(
            fixture
                .repository
                .list_attachments(conversation_id)
                .expect("attachment list should load")
                .is_empty()
        );
        assert!(matches!(
            fixture.repository.remove_attachment(&first.id),
            Err(PlanningChatError::AttachmentNotFound)
        ));
    }

    #[test]
    fn attachment_text_resolution_counts_pages_and_bounds_missing_index() {
        let fixture = context_fixture();
        let resolved = fixture
            .repository
            .resolve_attachment_text(DOCUMENT_ID)
            .expect("indexed attachment text should resolve")
            .expect("fixture should contain indexed text");
        assert_eq!(resolved.text, "planning context");
        assert_eq!(resolved.indexed_pages, 1);

        fixture.set_document_metadata("planning", "pdf", Some(1_700_000_000_100));
        assert!(
            fixture
                .repository
                .resolve_attachment_text(DOCUMENT_ID)
                .expect("trashed attachment lookup should not fail")
                .is_none()
        );
    }

    #[test]
    fn planning_preview_exposes_local_text_transport_and_blocks_unindexed_text() {
        let fixture = context_fixture();
        let conversation_id = "019f7328-4b66-7613-9729-e3570fc41527";
        fixture
            .repository
            .create_conversation(conversation_id, "Attachment preview", 10)
            .expect("conversation should create");
        let attachment = fixture
            .repository
            .attach_resource(
                conversation_id,
                DOCUMENT_ID,
                "019f7328-4b66-7613-9729-e3570fc41528",
                11,
            )
            .expect("resource should attach");
        let ai = AiUseCases::new(
            SqliteAiRepository::new(fixture.directory.path()),
            MemorySecretStore::default(),
            ProviderRouter,
        );
        let use_cases = PlanningChatUseCases::new(fixture.repository.clone(), ai);
        let chat = PlanningChatInput {
            conversation_id: conversation_id.to_owned(),
            question: "请根据附件给出安排".to_owned(),
            contexts: Vec::new(),
            question_context: None,
            attachment_ids: vec![attachment.id.clone()],
            image_data_urls: Vec::new(),
            max_output_tokens: 300,
        };
        let preview = use_cases
            .preview(&chat)
            .expect("preview should resolve attachment text");
        assert_eq!(preview.transport, "local_text");
        assert_eq!(preview.attachments[0].indexed_pages, Some(1));
        assert!(preview.preview.prompt.contains("planning context"));
        assert!(preview.preview.allowed);

        fixture.set_document_metadata("planning", "pdf", Some(1_700_000_000_100));
        let blocked = use_cases
            .preview(&chat)
            .expect("unindexed preview should explain the block");
        assert!(!blocked.preview.allowed);
        assert!(blocked.attachments[0].warning.is_some());
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
