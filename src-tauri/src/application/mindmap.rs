use uuid::Uuid;

use super::{
    ImportError, PersistenceError, ResourceRepository, ResourceUseCases, current_utc_millis,
};
use crate::domain::{
    KnowledgeMap, KnowledgeMapBundle, KnowledgeNode, KnowledgeNodeResource, MasteryState,
    MindMapImportDraft,
};

use super::mindmap_import::parse_mindmap_source;

/// Maximum source size loaded into memory while generating a mind-map draft.
///
/// The parser is intentionally bounded even though source files are stored on
/// disk, because draft generation needs to inspect the structured document.
pub(super) const MAX_MINDMAP_SOURCE_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CreateKnowledgeMapInput {
    pub(crate) title: String,
    pub(crate) subject_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UpdateKnowledgeMapInput {
    pub(crate) map_id: String,
    pub(crate) title: String,
    pub(crate) subject_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UpdateKnowledgeNodeInput {
    pub(crate) node_id: String,
    pub(crate) title: String,
    pub(crate) note_markdown: Option<String>,
    pub(crate) mastery_state: String,
    pub(crate) importance: u8,
    pub(crate) subject_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ValidatedKnowledgeNodeUpdate {
    pub(crate) node_id: String,
    pub(crate) title: String,
    pub(crate) note_markdown: Option<String>,
    pub(crate) mastery_state: MasteryState,
    pub(crate) importance: u8,
    pub(crate) subject_id: Option<String>,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MoveKnowledgeNodeInput {
    pub(crate) node_id: String,
    pub(crate) new_parent_id: String,
    pub(crate) position: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AddNodeResourceInput {
    pub(crate) node_id: String,
    pub(crate) document_id: String,
    pub(crate) page_start: Option<u32>,
    pub(crate) page_end: Option<u32>,
    pub(crate) note: Option<String>,
}

/// Stable failures from knowledge-map editing and import.
#[derive(Debug, thiserror::Error)]
pub(crate) enum KnowledgeError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("knowledge map was not found")]
    MapNotFound,
    #[error("knowledge node was not found")]
    NodeNotFound,
    #[error("knowledge input is invalid")]
    InvalidInput,
    #[error("the root node cannot be moved or deleted")]
    RootProtected,
    #[error("the requested move would create a cycle")]
    CycleDetected,
    #[error("knowledge map node limit was reached")]
    NodeLimitExceeded,
    #[error("resource association is invalid")]
    InvalidResourceReference,
    #[error("import draft was not found")]
    DraftNotFound,
    #[error("mind-map source format is not supported")]
    UnsupportedFormat,
    #[error("mind-map source could not be parsed")]
    InvalidImportSource,
    #[error("mind-map source exceeds a parser limit")]
    ImportLimitExceeded,
    #[error(transparent)]
    Source(#[from] ImportError),
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl KnowledgeError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::MapNotFound => "KNOWLEDGE_MAP_NOT_FOUND",
            Self::NodeNotFound => "KNOWLEDGE_NODE_NOT_FOUND",
            Self::InvalidInput => "KNOWLEDGE_INPUT_INVALID",
            Self::RootProtected => "KNOWLEDGE_ROOT_PROTECTED",
            Self::CycleDetected => "KNOWLEDGE_CYCLE_DETECTED",
            Self::NodeLimitExceeded => "KNOWLEDGE_NODE_LIMIT_REACHED",
            Self::InvalidResourceReference => "KNOWLEDGE_RESOURCE_INVALID",
            Self::DraftNotFound => "MINDMAP_DRAFT_NOT_FOUND",
            Self::UnsupportedFormat => "MINDMAP_FORMAT_UNSUPPORTED",
            Self::InvalidImportSource => "MINDMAP_SOURCE_INVALID",
            Self::ImportLimitExceeded => "MINDMAP_IMPORT_LIMIT_REACHED",
            Self::Source(error) => error.code(),
            Self::Persistence(error) => error.code(),
        }
    }
}

/// Formal knowledge-map and import-draft persistence boundary.
pub(crate) trait KnowledgeRepository: Clone + Send + Sync + 'static {
    fn list_maps(&self) -> Result<Vec<KnowledgeMapBundle>, KnowledgeError>;
    fn create_map(
        &self,
        map: KnowledgeMap,
        root: KnowledgeNode,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn update_map(
        &self,
        map_id: &str,
        title: &str,
        subject_id: Option<&str>,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn duplicate_map(
        &self,
        map_id: &str,
        new_map_id: &str,
        new_root_id: &str,
        created_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn trash_map(&self, map_id: &str, deleted_at: i64) -> Result<(), KnowledgeError>;
    fn create_node(&self, node: KnowledgeNode) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn update_node(
        &self,
        update: &ValidatedKnowledgeNodeUpdate,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn move_node(
        &self,
        node_id: &str,
        new_parent_id: &str,
        position: u32,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn delete_subtree(
        &self,
        node_id: &str,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn set_collapsed(
        &self,
        node_id: &str,
        collapsed: bool,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn add_resource(
        &self,
        resource: KnowledgeNodeResource,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn delete_resource(
        &self,
        resource_id: &str,
        updated_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn undo(&self, map_id: &str, updated_at: i64) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn redo(&self, map_id: &str, updated_at: i64) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn list_import_drafts(&self) -> Result<Vec<MindMapImportDraft>, KnowledgeError>;
    fn save_import_draft(
        &self,
        draft: MindMapImportDraft,
    ) -> Result<MindMapImportDraft, KnowledgeError>;
    fn accept_import_draft(
        &self,
        draft_id: &str,
        map_id: &str,
        root_node_id: &str,
        created_at: i64,
    ) -> Result<KnowledgeMapBundle, KnowledgeError>;
    fn reject_import_draft(
        &self,
        draft_id: &str,
        updated_at: i64,
    ) -> Result<MindMapImportDraft, KnowledgeError>;
}

/// Manual knowledge-map and structured-import use cases.
#[derive(Debug, Clone)]
pub(crate) struct KnowledgeUseCases<R, S> {
    repository: R,
    sources: ResourceUseCases<S>,
}

impl<R: KnowledgeRepository, S: ResourceRepository> KnowledgeUseCases<R, S> {
    pub(crate) const fn new(repository: R, sources: ResourceUseCases<S>) -> Self {
        Self {
            repository,
            sources,
        }
    }

    pub(crate) fn list_maps(&self) -> Result<Vec<KnowledgeMapBundle>, KnowledgeError> {
        self.repository.list_maps()
    }

    pub(crate) fn create_map(
        &self,
        input: CreateKnowledgeMapInput,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        let title = required_text(&input.title, 120)?;
        validate_optional_id(input.subject_id.as_deref())?;
        let now = current_utc_millis()?;
        let map_id = Uuid::now_v7().to_string();
        let root_node_id = Uuid::now_v7().to_string();
        self.repository.create_map(
            KnowledgeMap {
                id: map_id.clone(),
                subject_id: input.subject_id.clone(),
                title: title.clone(),
                root_node_id: root_node_id.clone(),
                current_revision: 1,
                deleted_at: None,
                created_at: now,
                updated_at: now,
            },
            KnowledgeNode {
                id: root_node_id,
                map_id,
                subject_id: input.subject_id,
                parent_id: None,
                title,
                note_markdown: None,
                mastery_state: MasteryState::Unknown,
                importance: 3,
                sort_order: 0,
                collapsed: false,
                created_at: now,
                updated_at: now,
            },
        )
    }

    pub(crate) fn update_map(
        &self,
        input: &UpdateKnowledgeMapInput,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(&input.map_id)?;
        validate_optional_id(input.subject_id.as_deref())?;
        self.repository.update_map(
            &input.map_id,
            &required_text(&input.title, 120)?,
            input.subject_id.as_deref(),
            current_utc_millis()?,
        )
    }

    pub(crate) fn duplicate_map(&self, map_id: &str) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(map_id)?;
        self.repository.duplicate_map(
            map_id,
            &Uuid::now_v7().to_string(),
            &Uuid::now_v7().to_string(),
            current_utc_millis()?,
        )
    }

    pub(crate) fn trash_map(&self, map_id: &str) -> Result<(), KnowledgeError> {
        validate_id(map_id)?;
        self.repository.trash_map(map_id, current_utc_millis()?)
    }

    pub(crate) fn create_node(
        &self,
        map_id: &str,
        parent_id: &str,
        title: &str,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(map_id)?;
        validate_id(parent_id)?;
        let now = current_utc_millis()?;
        self.repository.create_node(KnowledgeNode {
            id: Uuid::now_v7().to_string(),
            map_id: map_id.to_owned(),
            subject_id: None,
            parent_id: Some(parent_id.to_owned()),
            title: required_text(title, 200)?,
            note_markdown: None,
            mastery_state: MasteryState::Unknown,
            importance: 3,
            sort_order: u32::MAX,
            collapsed: false,
            created_at: now,
            updated_at: now,
        })
    }

    pub(crate) fn update_node(
        &self,
        input: UpdateKnowledgeNodeInput,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(&input.node_id)?;
        validate_optional_id(input.subject_id.as_deref())?;
        if !(1..=5).contains(&input.importance) {
            return Err(KnowledgeError::InvalidInput);
        }
        let mastery =
            MasteryState::parse(&input.mastery_state).ok_or(KnowledgeError::InvalidInput)?;
        let note = optional_text(input.note_markdown, 10_000)?;
        self.repository.update_node(&ValidatedKnowledgeNodeUpdate {
            node_id: input.node_id,
            title: required_text(&input.title, 200)?,
            note_markdown: note,
            mastery_state: mastery,
            importance: input.importance,
            subject_id: input.subject_id,
            updated_at: current_utc_millis()?,
        })
    }

    pub(crate) fn move_node(
        &self,
        input: &MoveKnowledgeNodeInput,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(&input.node_id)?;
        validate_id(&input.new_parent_id)?;
        self.repository.move_node(
            &input.node_id,
            &input.new_parent_id,
            input.position,
            current_utc_millis()?,
        )
    }

    pub(crate) fn delete_subtree(
        &self,
        node_id: &str,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(node_id)?;
        self.repository
            .delete_subtree(node_id, current_utc_millis()?)
    }

    pub(crate) fn set_collapsed(
        &self,
        node_id: &str,
        collapsed: bool,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(node_id)?;
        self.repository
            .set_collapsed(node_id, collapsed, current_utc_millis()?)
    }

    pub(crate) fn add_resource(
        &self,
        input: AddNodeResourceInput,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(&input.node_id)?;
        validate_id(&input.document_id)?;
        let pages_valid = match (input.page_start, input.page_end) {
            (None, None) => true,
            (Some(start), Some(end)) => start > 0 && end >= start,
            _ => false,
        };
        if !pages_valid {
            return Err(KnowledgeError::InvalidResourceReference);
        }
        self.repository.add_resource(KnowledgeNodeResource {
            id: Uuid::now_v7().to_string(),
            node_id: input.node_id,
            document_id: input.document_id,
            document_title: String::new(),
            page_start: input.page_start,
            page_end: input.page_end,
            note: optional_text(input.note, 1_000)?,
            created_at: current_utc_millis()?,
        })
    }

    pub(crate) fn delete_resource(
        &self,
        resource_id: &str,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(resource_id)?;
        self.repository
            .delete_resource(resource_id, current_utc_millis()?)
    }

    pub(crate) fn undo(&self, map_id: &str) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(map_id)?;
        self.repository.undo(map_id, current_utc_millis()?)
    }

    pub(crate) fn redo(&self, map_id: &str) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(map_id)?;
        self.repository.redo(map_id, current_utc_millis()?)
    }

    pub(crate) fn list_import_drafts(&self) -> Result<Vec<MindMapImportDraft>, KnowledgeError> {
        self.repository.list_import_drafts()
    }

    pub(crate) fn create_import_draft(
        &self,
        document_id: &str,
    ) -> Result<MindMapImportDraft, KnowledgeError> {
        validate_id(document_id)?;
        let source = self
            .sources
            .read_mindmap_source(document_id, MAX_MINDMAP_SOURCE_BYTES)?;
        let parsed = parse_mindmap_source(&source)?;
        let now = current_utc_millis()?;
        self.repository.save_import_draft(MindMapImportDraft {
            id: Uuid::now_v7().to_string(),
            source_resource_id: source.document_id,
            source_format: parsed.source_format,
            title: parsed.title,
            tree: parsed.tree,
            warnings: parsed.warnings,
            node_count: parsed.node_count,
            state: "generated".to_owned(),
            accepted_map_id: None,
            created_at: now,
            updated_at: now,
        })
    }

    pub(crate) fn accept_import_draft(
        &self,
        draft_id: &str,
    ) -> Result<KnowledgeMapBundle, KnowledgeError> {
        validate_id(draft_id)?;
        self.repository.accept_import_draft(
            draft_id,
            &Uuid::now_v7().to_string(),
            &Uuid::now_v7().to_string(),
            current_utc_millis()?,
        )
    }

    pub(crate) fn reject_import_draft(
        &self,
        draft_id: &str,
    ) -> Result<MindMapImportDraft, KnowledgeError> {
        validate_id(draft_id)?;
        self.repository
            .reject_import_draft(draft_id, current_utc_millis()?)
    }
}

fn required_text(value: &str, maximum: usize) -> Result<String, KnowledgeError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > maximum {
        return Err(KnowledgeError::InvalidInput);
    }
    Ok(value.to_owned())
}

fn optional_text(value: Option<String>, maximum: usize) -> Result<Option<String>, KnowledgeError> {
    match value {
        Some(value) if !value.trim().is_empty() => {
            let value = value.trim();
            if value.chars().count() > maximum {
                return Err(KnowledgeError::InvalidInput);
            }
            Ok(Some(value.to_owned()))
        }
        _ => Ok(None),
    }
}

fn validate_id(value: &str) -> Result<(), KnowledgeError> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| KnowledgeError::InvalidInput)
}

fn validate_optional_id(value: Option<&str>) -> Result<(), KnowledgeError> {
    value.map_or(Ok(()), validate_id)
}
