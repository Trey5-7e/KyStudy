use std::collections::HashMap;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::application::{
    KnowledgeError, KnowledgeRepository, PersistenceError, ValidatedKnowledgeNodeUpdate,
};
use crate::domain::{
    KnowledgeMap, KnowledgeMapBundle, KnowledgeNode, KnowledgeNodeResource, MasteryState,
    MindMapDraftNode, MindMapImportDraft,
};

use super::sqlite_workspace::{SqliteWorkspaceRepository, database_error, migrate, open_database};

const MAX_MAP_NODES: i64 = 2_000;

/// `SQLite` adapter for formal knowledge maps, revisions, links, and import drafts.
#[derive(Debug, Clone)]
pub(crate) struct SqliteKnowledgeRepository {
    database_path: PathBuf,
}

impl SqliteKnowledgeRepository {
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            database_path: workspace.database_path(),
        }
    }

    fn open(&self) -> Result<Connection, KnowledgeError> {
        if !self.database_path.exists() {
            return Err(KnowledgeError::WorkspaceNotInitialized);
        }
        let mut connection = open_database(&self.database_path, false)?;
        migrate(&mut connection)?;
        Ok(connection)
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapSnapshot {
    title: String,
    subject_id: Option<String>,
    root_node_id: String,
    nodes: Vec<KnowledgeNode>,
    resources: Vec<KnowledgeNodeResource>,
}

impl KnowledgeRepository for SqliteKnowledgeRepository {
    fn list_maps(&self) -> Result<Vec<KnowledgeMapBundle>, KnowledgeError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id FROM knowledge_map
                 WHERE deleted_at IS NULL
                 ORDER BY updated_at DESC, id DESC",
            )
            .map_err(database_error)?;
        let ids = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(database_error)?
            .map(|row| row.map_err(database_error))
            .collect::<Result<Vec<_>, _>>()?;
        ids.iter().map(|id| load_bundle(&connection, id)).collect()
    }

    fn create_map(
        &self,
        map: KnowledgeMap,
        root: KnowledgeNode,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        insert_map(&transaction, &workspace_id, &map)?;
        insert_node(&transaction, &root)?;
        insert_initial_revision(&transaction, &map.id, map.created_at, "创建导图")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &map.id)
    }

    fn update_map(
        &self,
        map_id: &str,
        title: &str,
        subject_id: Option<&str>,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let changed = transaction
            .execute(
                "UPDATE knowledge_map
                 SET title = ?2, subject_id = ?3, updated_at = ?4
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![map_id, title, subject_id, updated_at],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(KnowledgeError::MapNotFound);
        }
        append_revision(&transaction, map_id, updated_at, "编辑导图信息")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, map_id)
    }

    fn duplicate_map(
        &self,
        map_id: &str,
        new_map_id: &str,
        new_root_id: &str,
        created_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let source = load_bundle(&connection, map_id)?;
        let workspace_id = load_workspace_id(&connection)?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let copied_title = format!("{} 副本", source.map.title);
        let copied_title: String = copied_title.chars().take(120).collect();
        let copied_map = KnowledgeMap {
            id: new_map_id.to_owned(),
            subject_id: source.map.subject_id.clone(),
            title: copied_title,
            root_node_id: new_root_id.to_owned(),
            current_revision: 1,
            deleted_at: None,
            created_at,
            updated_at: created_at,
        };
        insert_map(&transaction, &workspace_id, &copied_map)?;
        let mut ids = HashMap::with_capacity(source.nodes.len());
        ids.insert(source.map.root_node_id.clone(), new_root_id.to_owned());
        for node in &source.nodes {
            ids.entry(node.id.clone())
                .or_insert_with(|| Uuid::now_v7().to_string());
        }
        for node in &source.nodes {
            let id = ids.get(&node.id).ok_or(KnowledgeError::InvalidInput)?;
            let parent_id = match &node.parent_id {
                Some(parent) => Some(
                    ids.get(parent)
                        .cloned()
                        .ok_or(KnowledgeError::InvalidInput)?,
                ),
                None => None,
            };
            insert_node(
                &transaction,
                &KnowledgeNode {
                    id: id.clone(),
                    map_id: new_map_id.to_owned(),
                    subject_id: node.subject_id.clone(),
                    parent_id,
                    title: node.title.clone(),
                    note_markdown: node.note_markdown.clone(),
                    mastery_state: node.mastery_state,
                    importance: node.importance,
                    sort_order: node.sort_order,
                    collapsed: node.collapsed,
                    created_at,
                    updated_at: created_at,
                },
            )?;
        }
        for resource in &source.resources {
            let node_id = ids
                .get(&resource.node_id)
                .ok_or(KnowledgeError::InvalidInput)?;
            insert_resource_link(
                &transaction,
                &KnowledgeNodeResource {
                    id: Uuid::now_v7().to_string(),
                    node_id: node_id.clone(),
                    document_id: resource.document_id.clone(),
                    document_title: resource.document_title.clone(),
                    page_start: resource.page_start,
                    page_end: resource.page_end,
                    note: resource.note.clone(),
                    created_at,
                },
            )?;
        }
        insert_initial_revision(&transaction, new_map_id, created_at, "复制导图")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, new_map_id)
    }

    fn trash_map(&self, map_id: &str, deleted_at: i64) -> Result<(), KnowledgeError> {
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE knowledge_map
                 SET deleted_at = ?2, updated_at = ?2
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![map_id, deleted_at],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(KnowledgeError::MapNotFound);
        }
        Ok(())
    }

    fn create_node(&self, mut node: KnowledgeNode) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        ensure_active_map(&transaction, &node.map_id)?;
        let parent_map =
            load_node_map_id(&transaction, node.parent_id.as_deref().unwrap_or_default())?;
        if parent_map != node.map_id {
            return Err(KnowledgeError::NodeNotFound);
        }
        let count: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM knowledge_node WHERE map_id = ?1",
                params![node.map_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if count >= MAX_MAP_NODES {
            return Err(KnowledgeError::NodeLimitExceeded);
        }
        node.sort_order = u32::try_from(sibling_count(
            &transaction,
            &node.map_id,
            node.parent_id.as_deref(),
        )?)
        .map_err(|_| KnowledgeError::NodeLimitExceeded)?;
        insert_node(&transaction, &node)?;
        append_revision(&transaction, &node.map_id, node.created_at, "添加知识节点")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &node.map_id)
    }

    fn update_node(
        &self,
        update: &ValidatedKnowledgeNodeUpdate,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let map_id = load_node_map_id(&transaction, &update.node_id)?;
        ensure_active_map(&transaction, &map_id)?;
        transaction
            .execute(
                "UPDATE knowledge_node
                 SET title = ?2, note_markdown = ?3, mastery_state = ?4,
                     importance = ?5, subject_id = ?6, updated_at = ?7
                 WHERE id = ?1",
                params![
                    update.node_id,
                    update.title,
                    update.note_markdown,
                    update.mastery_state.as_str(),
                    i64::from(update.importance),
                    update.subject_id,
                    update.updated_at
                ],
            )
            .map_err(database_error)?;
        append_revision(&transaction, &map_id, update.updated_at, "编辑知识节点")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &map_id)
    }

    fn move_node(
        &self,
        node_id: &str,
        new_parent_id: &str,
        position: u32,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let (map_id, old_parent_id) = transaction
            .query_row(
                "SELECT map_id, parent_id FROM knowledge_node WHERE id = ?1",
                params![node_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(KnowledgeError::NodeNotFound)?;
        if old_parent_id.is_none() {
            return Err(KnowledgeError::RootProtected);
        }
        if node_id == new_parent_id || load_node_map_id(&transaction, new_parent_id)? != map_id {
            return Err(KnowledgeError::CycleDetected);
        }
        let is_descendant: bool = transaction
            .query_row(
                "WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM knowledge_node WHERE parent_id = ?1
                    UNION ALL
                    SELECT n.id FROM knowledge_node n
                    JOIN descendants d ON n.parent_id = d.id
                 )
                 SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?2)",
                params![node_id, new_parent_id],
                |row| row.get(0),
            )
            .map_err(database_error)?;
        if is_descendant {
            return Err(KnowledgeError::CycleDetected);
        }
        transaction
            .execute(
                "UPDATE knowledge_node SET parent_id = ?2, updated_at = ?3 WHERE id = ?1",
                params![node_id, new_parent_id, updated_at],
            )
            .map_err(database_error)?;
        normalize_siblings(
            &transaction,
            &map_id,
            old_parent_id.as_deref(),
            None,
            updated_at,
        )?;
        normalize_siblings(
            &transaction,
            &map_id,
            Some(new_parent_id),
            Some((node_id, position)),
            updated_at,
        )?;
        append_revision(&transaction, &map_id, updated_at, "移动知识节点")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &map_id)
    }

    fn delete_subtree(
        &self,
        node_id: &str,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let (map_id, parent_id) = transaction
            .query_row(
                "SELECT map_id, parent_id FROM knowledge_node WHERE id = ?1",
                params![node_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(KnowledgeError::NodeNotFound)?;
        if parent_id.is_none() {
            return Err(KnowledgeError::RootProtected);
        }
        transaction
            .execute(
                "DELETE FROM knowledge_node
                 WHERE id IN (
                    WITH RECURSIVE subtree(id) AS (
                        SELECT ?1
                        UNION ALL
                        SELECT n.id FROM knowledge_node n JOIN subtree s ON n.parent_id = s.id
                    ) SELECT id FROM subtree
                 )",
                params![node_id],
            )
            .map_err(database_error)?;
        normalize_siblings(
            &transaction,
            &map_id,
            parent_id.as_deref(),
            None,
            updated_at,
        )?;
        append_revision(&transaction, &map_id, updated_at, "删除知识节点子树")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &map_id)
    }

    fn set_collapsed(
        &self,
        node_id: &str,
        collapsed: bool,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let map_id = load_node_map_id(&transaction, node_id)?;
        transaction
            .execute(
                "UPDATE knowledge_node SET collapsed = ?2, updated_at = ?3 WHERE id = ?1",
                params![node_id, collapsed, updated_at],
            )
            .map_err(database_error)?;
        append_revision(&transaction, &map_id, updated_at, "折叠或展开节点")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &map_id)
    }

    fn add_resource(
        &self,
        mut resource: KnowledgeNodeResource,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let map_id = load_node_map_id(&transaction, &resource.node_id)?;
        let document = transaction
            .query_row(
                "SELECT title, kind, page_count FROM resource_document WHERE id = ?1",
                params![resource.document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<i64>>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(database_error)?
            .ok_or(KnowledgeError::InvalidResourceReference)?;
        if let (Some(start), Some(end)) = (resource.page_start, resource.page_end)
            && (document.1 != "pdf"
                || end < start
                || document.2.is_some_and(|count| i64::from(end) > count))
        {
            return Err(KnowledgeError::InvalidResourceReference);
        }
        resource.document_title = document.0;
        insert_resource_link(&transaction, &resource)?;
        append_revision(&transaction, &map_id, resource.created_at, "关联学习资料")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &map_id)
    }

    fn delete_resource(
        &self,
        resource_id: &str,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let map_id = transaction
            .query_row(
                "SELECT n.map_id FROM knowledge_node_resource r
                 JOIN knowledge_node n ON n.id = r.node_id WHERE r.id = ?1",
                params![resource_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(database_error)?
            .ok_or(KnowledgeError::InvalidResourceReference)?;
        transaction
            .execute(
                "DELETE FROM knowledge_node_resource WHERE id = ?1",
                params![resource_id],
            )
            .map_err(database_error)?;
        append_revision(&transaction, &map_id, updated_at, "移除资料关联")?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, &map_id)
    }

    fn undo(&self, map_id: &str, updated_at: i64) -> Result<KnowledgeMapBundle, KnowledgeError> {
        move_revision(&mut self.open()?, map_id, -1, updated_at)
    }

    fn redo(&self, map_id: &str, updated_at: i64) -> Result<KnowledgeMapBundle, KnowledgeError> {
        move_revision(&mut self.open()?, map_id, 1, updated_at)
    }

    fn list_import_drafts(&self) -> Result<Vec<MindMapImportDraft>, KnowledgeError> {
        if !self.database_path.exists() {
            return Ok(Vec::new());
        }
        let connection = self.open()?;
        let mut statement = connection
            .prepare(
                "SELECT id, source_resource_id, source_format, title, draft_tree_json,
                        warnings_json, node_count, state, accepted_map_id, created_at, updated_at
                 FROM map_import_draft
                 ORDER BY updated_at DESC, id DESC",
            )
            .map_err(database_error)?;
        statement
            .query_map([], map_import_draft_row)
            .map_err(database_error)?
            .map(|row| {
                let row = row.map_err(database_error).map_err(KnowledgeError::from)?;
                decode_import_draft(row)
            })
            .collect()
    }

    fn save_import_draft(
        &self,
        draft: MindMapImportDraft,
    ) -> Result<MindMapImportDraft, KnowledgeError> {
        let connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let tree = serde_json::to_string(&draft.tree).map_err(json_error)?;
        let warnings = serde_json::to_string(&draft.warnings).map_err(json_error)?;
        connection
            .execute(
                "INSERT INTO map_import_draft(
                    id, workspace_id, source_resource_id, source_format, title,
                    draft_tree_json, warnings_json, node_count, state, accepted_map_id,
                    created_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'generated', NULL, ?9, ?9)",
                params![
                    draft.id,
                    workspace_id,
                    draft.source_resource_id,
                    draft.source_format,
                    draft.title,
                    tree,
                    warnings,
                    i64::from(draft.node_count),
                    draft.created_at
                ],
            )
            .map_err(database_error)?;
        load_import_draft(&connection, &draft.id)
    }

    fn accept_import_draft(
        &self,
        draft_id: &str,
        map_id: &str,
        root_node_id: &str,
        created_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let mut connection = self.open()?;
        let workspace_id = load_workspace_id(&connection)?;
        let draft = load_import_draft(&connection, draft_id)?;
        if draft.state != "generated" {
            return Err(KnowledgeError::DraftNotFound);
        }
        let transaction = connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(database_error)?;
        let map = KnowledgeMap {
            id: map_id.to_owned(),
            subject_id: None,
            title: draft.title,
            root_node_id: root_node_id.to_owned(),
            current_revision: 1,
            deleted_at: None,
            created_at,
            updated_at: created_at,
        };
        insert_map(&transaction, &workspace_id, &map)?;
        insert_draft_tree(
            &transaction,
            &draft.tree,
            map_id,
            None,
            Some(root_node_id),
            0,
            created_at,
        )?;
        insert_initial_revision(&transaction, map_id, created_at, "确认导入草案")?;
        transaction
            .execute(
                "UPDATE map_import_draft
                 SET state = 'accepted', accepted_map_id = ?2, updated_at = ?3
                 WHERE id = ?1 AND state = 'generated'",
                params![draft_id, map_id, created_at],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        load_bundle(&connection, map_id)
    }

    fn reject_import_draft(
        &self,
        draft_id: &str,
        updated_at: i64,
    ) -> Result<MindMapImportDraft, KnowledgeError> {
        let connection = self.open()?;
        let changed = connection
            .execute(
                "UPDATE map_import_draft SET state = 'rejected', updated_at = ?2
                 WHERE id = ?1 AND state = 'generated'",
                params![draft_id, updated_at],
            )
            .map_err(database_error)?;
        if changed == 0 {
            return Err(KnowledgeError::DraftNotFound);
        }
        load_import_draft(&connection, draft_id)
    }
}

fn insert_map(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    map: &KnowledgeMap,
) -> Result<(), KnowledgeError> {
    transaction
        .execute(
            "INSERT INTO knowledge_map(
                id, workspace_id, subject_id, title, root_node_id,
                current_revision, deleted_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, NULL, ?6, ?6)",
            params![
                map.id,
                workspace_id,
                map.subject_id,
                map.title,
                map.root_node_id,
                map.created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_node(transaction: &Transaction<'_>, node: &KnowledgeNode) -> Result<(), KnowledgeError> {
    transaction
        .execute(
            "INSERT INTO knowledge_node(
                id, map_id, subject_id, parent_id, title, note_markdown,
                mastery_state, importance, sort_order, collapsed, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                node.id,
                node.map_id,
                node.subject_id,
                node.parent_id,
                node.title,
                node.note_markdown,
                node.mastery_state.as_str(),
                i64::from(node.importance),
                i64::from(node.sort_order),
                node.collapsed,
                node.created_at,
                node.updated_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_resource_link(
    transaction: &Transaction<'_>,
    resource: &KnowledgeNodeResource,
) -> Result<(), KnowledgeError> {
    transaction
        .execute(
            "INSERT INTO knowledge_node_resource(
                id, node_id, document_id, page_start, page_end, note, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                resource.id,
                resource.node_id,
                resource.document_id,
                resource.page_start.map(i64::from),
                resource.page_end.map(i64::from),
                resource.note,
                resource.created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn insert_initial_revision(
    transaction: &Transaction<'_>,
    map_id: &str,
    created_at: i64,
    summary: &str,
) -> Result<(), KnowledgeError> {
    let snapshot = encode_snapshot(transaction, map_id)?;
    transaction
        .execute(
            "INSERT INTO knowledge_map_revision(
                id, map_id, revision_number, snapshot_json, change_summary, created_at
             ) VALUES (?1, ?2, 1, ?3, ?4, ?5)",
            params![
                Uuid::now_v7().to_string(),
                map_id,
                snapshot,
                summary,
                created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn append_revision(
    transaction: &Transaction<'_>,
    map_id: &str,
    created_at: i64,
    summary: &str,
) -> Result<(), KnowledgeError> {
    let current: i64 = transaction
        .query_row(
            "SELECT current_revision FROM knowledge_map
             WHERE id = ?1 AND deleted_at IS NULL",
            params![map_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(KnowledgeError::MapNotFound)?;
    transaction
        .execute(
            "DELETE FROM knowledge_map_revision
             WHERE map_id = ?1 AND revision_number > ?2",
            params![map_id, current],
        )
        .map_err(database_error)?;
    let next = current
        .checked_add(1)
        .ok_or(KnowledgeError::NodeLimitExceeded)?;
    transaction
        .execute(
            "UPDATE knowledge_map
             SET current_revision = ?2, updated_at = ?3 WHERE id = ?1",
            params![map_id, next, created_at],
        )
        .map_err(database_error)?;
    let snapshot = encode_snapshot(transaction, map_id)?;
    transaction
        .execute(
            "INSERT INTO knowledge_map_revision(
                id, map_id, revision_number, snapshot_json, change_summary, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                Uuid::now_v7().to_string(),
                map_id,
                next,
                snapshot,
                summary,
                created_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn move_revision(
    connection: &mut Connection,
    map_id: &str,
    direction: i64,
    updated_at: i64,
) -> Result<KnowledgeMapBundle, KnowledgeError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(database_error)?;
    let current: i64 = transaction
        .query_row(
            "SELECT current_revision FROM knowledge_map
             WHERE id = ?1 AND deleted_at IS NULL",
            params![map_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(KnowledgeError::MapNotFound)?;
    let target = current.saturating_add(direction);
    let snapshot = transaction
        .query_row(
            "SELECT snapshot_json FROM knowledge_map_revision
             WHERE map_id = ?1 AND revision_number = ?2",
            params![map_id, target],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?;
    if let Some(snapshot) = snapshot {
        restore_snapshot(&transaction, map_id, target, &snapshot, updated_at)?;
    }
    transaction.commit().map_err(database_error)?;
    load_bundle(connection, map_id)
}

fn encode_snapshot(connection: &Connection, map_id: &str) -> Result<String, KnowledgeError> {
    let map = load_map(connection, map_id)?;
    let nodes = load_nodes(connection, map_id)?;
    let resources = load_resources(connection, map_id)?;
    serde_json::to_string(&MapSnapshot {
        title: map.title,
        subject_id: map.subject_id,
        root_node_id: map.root_node_id,
        nodes,
        resources,
    })
    .map_err(json_error)
}

fn restore_snapshot(
    transaction: &Transaction<'_>,
    map_id: &str,
    revision: i64,
    snapshot: &str,
    updated_at: i64,
) -> Result<(), KnowledgeError> {
    let snapshot: MapSnapshot = serde_json::from_str(snapshot).map_err(json_error)?;
    transaction
        .execute(
            "DELETE FROM knowledge_node WHERE map_id = ?1",
            params![map_id],
        )
        .map_err(database_error)?;
    for node in &snapshot.nodes {
        insert_node(transaction, node)?;
    }
    for resource in &snapshot.resources {
        insert_resource_link(transaction, resource)?;
    }
    transaction
        .execute(
            "UPDATE knowledge_map
             SET title = ?2, subject_id = ?3, root_node_id = ?4,
                 current_revision = ?5, updated_at = ?6
             WHERE id = ?1",
            params![
                map_id,
                snapshot.title,
                snapshot.subject_id,
                snapshot.root_node_id,
                revision,
                updated_at
            ],
        )
        .map_err(database_error)?;
    Ok(())
}

fn load_bundle(
    connection: &Connection,
    map_id: &str,
) -> Result<KnowledgeMapBundle, KnowledgeError> {
    let map = load_map(connection, map_id)?;
    if map.deleted_at.is_some() {
        return Err(KnowledgeError::MapNotFound);
    }
    let nodes = load_nodes(connection, map_id)?;
    let resources = load_resources(connection, map_id)?;
    let can_redo: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM knowledge_map_revision
                WHERE map_id = ?1 AND revision_number = ?2
             )",
            params![map_id, i64::from(map.current_revision) + 1],
            |row| row.get(0),
        )
        .map_err(database_error)?;
    let can_undo = map.current_revision > 1;
    Ok(KnowledgeMapBundle {
        map,
        nodes,
        resources,
        can_undo,
        can_redo,
    })
}

fn load_map(connection: &Connection, map_id: &str) -> Result<KnowledgeMap, KnowledgeError> {
    connection
        .query_row(
            "SELECT id, subject_id, title, root_node_id, current_revision,
                    deleted_at, created_at, updated_at
             FROM knowledge_map WHERE id = ?1",
            params![map_id],
            |row| {
                Ok(KnowledgeMap {
                    id: row.get(0)?,
                    subject_id: row.get(1)?,
                    title: row.get(2)?,
                    root_node_id: row.get(3)?,
                    current_revision: to_u32(row.get::<_, i64>(4)?, 4)?,
                    deleted_at: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(database_error)?
        .ok_or(KnowledgeError::MapNotFound)
}

fn load_nodes(connection: &Connection, map_id: &str) -> Result<Vec<KnowledgeNode>, KnowledgeError> {
    let mut statement = connection
        .prepare(
            "WITH RECURSIVE tree(
                id, map_id, subject_id, parent_id, title, note_markdown,
                mastery_state, importance, sort_order, collapsed, created_at, updated_at, depth
             ) AS (
                SELECT id, map_id, subject_id, parent_id, title, note_markdown,
                       mastery_state, importance, sort_order, collapsed, created_at, updated_at, 0
                FROM knowledge_node WHERE map_id = ?1 AND parent_id IS NULL
                UNION ALL
                SELECT n.id, n.map_id, n.subject_id, n.parent_id, n.title, n.note_markdown,
                       n.mastery_state, n.importance, n.sort_order, n.collapsed,
                       n.created_at, n.updated_at, tree.depth + 1
                FROM knowledge_node n JOIN tree ON n.parent_id = tree.id
             )
             SELECT id, map_id, subject_id, parent_id, title, note_markdown,
                    mastery_state, importance, sort_order, collapsed, created_at, updated_at
             FROM tree ORDER BY depth, parent_id, sort_order, id",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![map_id], map_node_row)
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(KnowledgeError::from))
        .collect()
}

fn load_resources(
    connection: &Connection,
    map_id: &str,
) -> Result<Vec<KnowledgeNodeResource>, KnowledgeError> {
    let mut statement = connection
        .prepare(
            "SELECT r.id, r.node_id, r.document_id, d.title,
                    r.page_start, r.page_end, r.note, r.created_at
             FROM knowledge_node_resource r
             JOIN knowledge_node n ON n.id = r.node_id
             JOIN resource_document d ON d.id = r.document_id
             WHERE n.map_id = ?1 ORDER BY r.created_at, r.id",
        )
        .map_err(database_error)?;
    statement
        .query_map(params![map_id], map_resource_row)
        .map_err(database_error)?
        .map(|row| row.map_err(database_error).map_err(KnowledgeError::from))
        .collect()
}

fn map_node_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeNode> {
    let mastery = row.get::<_, String>(6)?;
    Ok(KnowledgeNode {
        id: row.get(0)?,
        map_id: row.get(1)?,
        subject_id: row.get(2)?,
        parent_id: row.get(3)?,
        title: row.get(4)?,
        note_markdown: row.get(5)?,
        mastery_state: MasteryState::parse(&mastery)
            .ok_or_else(|| conversion_error(6, "invalid mastery state"))?,
        importance: to_u8(row.get::<_, i64>(7)?, 7)?,
        sort_order: to_u32(row.get::<_, i64>(8)?, 8)?,
        collapsed: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn map_resource_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<KnowledgeNodeResource> {
    Ok(KnowledgeNodeResource {
        id: row.get(0)?,
        node_id: row.get(1)?,
        document_id: row.get(2)?,
        document_title: row.get(3)?,
        page_start: optional_u32(row.get::<_, Option<i64>>(4)?, 4)?,
        page_end: optional_u32(row.get::<_, Option<i64>>(5)?, 5)?,
        note: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn normalize_siblings(
    transaction: &Transaction<'_>,
    map_id: &str,
    parent_id: Option<&str>,
    moving: Option<(&str, u32)>,
    updated_at: i64,
) -> Result<(), KnowledgeError> {
    let mut statement = transaction
        .prepare(
            "SELECT id FROM knowledge_node
             WHERE map_id = ?1 AND parent_id IS ?2
             ORDER BY sort_order, id",
        )
        .map_err(database_error)?;
    let mut ids = statement
        .query_map(params![map_id, parent_id], |row| row.get::<_, String>(0))
        .map_err(database_error)?
        .map(|row| row.map_err(database_error))
        .collect::<Result<Vec<_>, _>>()?;
    if let Some((moving_id, position)) = moving {
        ids.retain(|id| id != moving_id);
        let position = usize::try_from(position)
            .unwrap_or(usize::MAX)
            .min(ids.len());
        ids.insert(position, moving_id.to_owned());
    }
    for (index, id) in ids.iter().enumerate() {
        transaction
            .execute(
                "UPDATE knowledge_node SET sort_order = ?2, updated_at = ?3 WHERE id = ?1",
                params![
                    id,
                    i64::try_from(index).map_err(|_| KnowledgeError::NodeLimitExceeded)?,
                    updated_at
                ],
            )
            .map_err(database_error)?;
    }
    Ok(())
}

fn sibling_count(
    connection: &Connection,
    map_id: &str,
    parent_id: Option<&str>,
) -> Result<i64, KnowledgeError> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM knowledge_node WHERE map_id = ?1 AND parent_id IS ?2",
            params![map_id, parent_id],
            |row| row.get(0),
        )
        .map_err(database_error)
        .map_err(Into::into)
}

fn ensure_active_map(connection: &Connection, map_id: &str) -> Result<(), KnowledgeError> {
    let exists: bool = connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM knowledge_map WHERE id = ?1 AND deleted_at IS NULL
             )",
            params![map_id],
            |row| row.get(0),
        )
        .map_err(database_error)?;
    if !exists {
        return Err(KnowledgeError::MapNotFound);
    }
    Ok(())
}

fn load_node_map_id(connection: &Connection, node_id: &str) -> Result<String, KnowledgeError> {
    connection
        .query_row(
            "SELECT map_id FROM knowledge_node WHERE id = ?1",
            params![node_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(KnowledgeError::NodeNotFound)
}

fn load_workspace_id(connection: &Connection) -> Result<String, KnowledgeError> {
    connection
        .query_row(
            "SELECT id FROM workspace ORDER BY created_at LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database_error)?
        .ok_or(KnowledgeError::WorkspaceNotInitialized)
}

fn insert_draft_tree(
    transaction: &Transaction<'_>,
    node: &MindMapDraftNode,
    map_id: &str,
    parent_id: Option<&str>,
    forced_id: Option<&str>,
    sort_order: u32,
    created_at: i64,
) -> Result<String, KnowledgeError> {
    let id = forced_id.map_or_else(|| Uuid::now_v7().to_string(), str::to_owned);
    insert_node(
        transaction,
        &KnowledgeNode {
            id: id.clone(),
            map_id: map_id.to_owned(),
            subject_id: None,
            parent_id: parent_id.map(str::to_owned),
            title: node.title.clone(),
            note_markdown: node.note_markdown.clone(),
            mastery_state: MasteryState::Unknown,
            importance: 3,
            sort_order,
            collapsed: false,
            created_at,
            updated_at: created_at,
        },
    )?;
    for (index, child) in node.children.iter().enumerate() {
        insert_draft_tree(
            transaction,
            child,
            map_id,
            Some(&id),
            None,
            u32::try_from(index).map_err(|_| KnowledgeError::ImportLimitExceeded)?,
            created_at,
        )?;
    }
    Ok(id)
}

type ImportDraftRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    i64,
    String,
    Option<String>,
    i64,
    i64,
);

fn map_import_draft_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ImportDraftRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
        row.get(9)?,
        row.get(10)?,
    ))
}

fn decode_import_draft(row: ImportDraftRow) -> Result<MindMapImportDraft, KnowledgeError> {
    Ok(MindMapImportDraft {
        id: row.0,
        source_resource_id: row.1,
        source_format: row.2,
        title: row.3,
        tree: serde_json::from_str(&row.4).map_err(json_error)?,
        warnings: serde_json::from_str(&row.5).map_err(json_error)?,
        node_count: u32::try_from(row.6).map_err(|_| KnowledgeError::InvalidImportSource)?,
        state: row.7,
        accepted_map_id: row.8,
        created_at: row.9,
        updated_at: row.10,
    })
}

fn load_import_draft(
    connection: &Connection,
    draft_id: &str,
) -> Result<MindMapImportDraft, KnowledgeError> {
    let row = connection
        .query_row(
            "SELECT id, source_resource_id, source_format, title, draft_tree_json,
                    warnings_json, node_count, state, accepted_map_id, created_at, updated_at
             FROM map_import_draft WHERE id = ?1",
            params![draft_id],
            map_import_draft_row,
        )
        .optional()
        .map_err(database_error)?
        .ok_or(KnowledgeError::DraftNotFound)?;
    decode_import_draft(row)
}

fn json_error(error: serde_json::Error) -> KnowledgeError {
    KnowledgeError::Persistence(PersistenceError::Database {
        source: Box::new(error),
    })
}

fn optional_u32(value: Option<i64>, index: usize) -> rusqlite::Result<Option<u32>> {
    value.map(|value| to_u32(value, index)).transpose()
}

fn to_u32(value: i64, index: usize) -> rusqlite::Result<u32> {
    u32::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}

fn to_u8(value: i64, index: usize) -> rusqlite::Result<u8> {
    u8::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            Box::new(error),
        )
    })
}

fn conversion_error(index: usize, message: &'static str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        index,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use tempfile::tempdir;

    use super::SqliteKnowledgeRepository;
    use crate::application::{
        CreateKnowledgeMapInput, KnowledgeUseCases, MoveKnowledgeNodeInput, ResourceUseCases,
        UpdateKnowledgeNodeInput, WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{SqliteBlobStore, SqliteWorkspaceRepository};

    #[test]
    fn node_edit_move_and_revision_round_trip() {
        let directory = tempdir().expect("temporary directory should exist");
        initialize_workspace(directory.path());
        let use_cases = knowledge_use_cases(directory.path());
        let created = use_cases
            .create_map(CreateKnowledgeMapInput {
                title: "408".to_owned(),
                subject_id: None,
            })
            .expect("map should create");
        let root_id = created.map.root_node_id.clone();
        let with_data_structure = use_cases
            .create_node(&created.map.id, &root_id, "数据结构")
            .expect("first child should create");
        let data_structure = with_data_structure
            .nodes
            .iter()
            .find(|node| node.title == "数据结构")
            .expect("new child should exist")
            .id
            .clone();
        let with_graph = use_cases
            .create_node(&created.map.id, &data_structure, "图")
            .expect("grandchild should create");
        let graph = with_graph
            .nodes
            .iter()
            .find(|node| node.title == "图")
            .expect("grandchild should exist")
            .id
            .clone();
        let edited = use_cases
            .update_node(UpdateKnowledgeNodeInput {
                node_id: graph.clone(),
                title: "图论与图算法".to_owned(),
                note_markdown: Some("重点复习最短路径".to_owned()),
                mastery_state: "weak".to_owned(),
                importance: 5,
                subject_id: None,
            })
            .expect("node should update");
        assert_eq!(
            edited
                .nodes
                .iter()
                .find(|node| node.id == graph)
                .expect("edited node should exist")
                .mastery_state
                .as_str(),
            "weak"
        );

        let cycle = use_cases.move_node(&MoveKnowledgeNodeInput {
            node_id: data_structure.clone(),
            new_parent_id: graph.clone(),
            position: 0,
        });
        assert!(cycle.is_err());
        let moved = use_cases
            .move_node(&MoveKnowledgeNodeInput {
                node_id: graph.clone(),
                new_parent_id: root_id,
                position: 0,
            })
            .expect("valid move should persist");
        assert_eq!(
            moved
                .nodes
                .iter()
                .find(|node| node.id == graph)
                .expect("moved node should exist")
                .parent_id
                .as_deref(),
            Some(moved.map.root_node_id.as_str())
        );

        let undone = use_cases.undo(&moved.map.id).expect("move should undo");
        assert_eq!(
            undone
                .nodes
                .iter()
                .find(|node| node.id == graph)
                .expect("restored node should exist")
                .parent_id
                .as_deref(),
            Some(data_structure.as_str())
        );
        let redone = use_cases.redo(&moved.map.id).expect("move should redo");
        assert_eq!(
            redone
                .nodes
                .iter()
                .find(|node| node.id == graph)
                .expect("redone node should exist")
                .parent_id
                .as_deref(),
            Some(redone.map.root_node_id.as_str())
        );
    }

    #[test]
    fn opml_import_stays_draft_until_explicit_acceptance() {
        let directory = tempdir().expect("temporary directory should exist");
        initialize_workspace(directory.path());
        let resources = ResourceUseCases::new(SqliteBlobStore::new(directory.path()));
        let source = directory.path().join("408.opml");
        std::fs::write(
            &source,
            r#"<?xml version="1.0"?><opml><body><outline text="408"><outline text="数据结构"/><outline text="操作系统"/></outline></body></opml>"#,
        )
        .expect("OPML fixture should write");
        let resource = resources
            .import_file(&source, &AtomicBool::new(false), &mut |_| {})
            .expect("OPML should import as resource");
        let use_cases = knowledge_use_cases(directory.path());

        let draft = use_cases
            .create_import_draft(&resource.id)
            .expect("draft should parse");

        assert_eq!(draft.state, "generated");
        assert_eq!(draft.node_count, 3);
        assert!(use_cases.list_maps().expect("maps should list").is_empty());
        let accepted = use_cases
            .accept_import_draft(&draft.id)
            .expect("draft should create formal map");
        assert_eq!(accepted.nodes.len(), 3);
        assert_eq!(accepted.nodes[0].title, "408");
    }

    #[test]
    fn duplicate_map_uses_new_business_ids_and_keeps_structure() {
        let directory = tempdir().expect("temporary directory should exist");
        initialize_workspace(directory.path());
        let use_cases = knowledge_use_cases(directory.path());
        let original = use_cases
            .create_map(CreateKnowledgeMapInput {
                title: "数学".to_owned(),
                subject_id: None,
            })
            .expect("map should create");
        let original = use_cases
            .create_node(&original.map.id, &original.map.root_node_id, "高数")
            .expect("child should create");

        let copied = use_cases
            .duplicate_map(&original.map.id)
            .expect("map should duplicate");

        assert_ne!(copied.map.id, original.map.id);
        assert_ne!(copied.map.root_node_id, original.map.root_node_id);
        assert_eq!(copied.nodes.len(), original.nodes.len());
        assert_eq!(copied.nodes[1].title, "高数");
    }

    fn knowledge_use_cases(
        directory: &std::path::Path,
    ) -> KnowledgeUseCases<SqliteKnowledgeRepository, SqliteBlobStore> {
        KnowledgeUseCases::new(
            SqliteKnowledgeRepository::new(directory),
            ResourceUseCases::new(SqliteBlobStore::new(directory)),
        )
    }

    fn initialize_workspace(directory: &std::path::Path) {
        SqliteWorkspaceRepository::new(directory)
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
    }
}
