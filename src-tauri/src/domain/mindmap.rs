use serde::{Deserialize, Serialize};

/// User-selected learning state for one knowledge node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MasteryState {
    Unknown,
    Learning,
    Weak,
    Stable,
}

impl MasteryState {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "unknown" => Some(Self::Unknown),
            "learning" => Some(Self::Learning),
            "weak" => Some(Self::Weak),
            "stable" => Some(Self::Stable),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Learning => "learning",
            Self::Weak => "weak",
            Self::Stable => "stable",
        }
    }
}

/// One formal, library-independent knowledge map.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KnowledgeMap {
    pub(crate) id: String,
    pub(crate) subject_id: Option<String>,
    pub(crate) title: String,
    pub(crate) root_node_id: String,
    pub(crate) current_revision: u32,
    pub(crate) deleted_at: Option<i64>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// One semantic tree node independent of any canvas component.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeNode {
    pub(crate) id: String,
    pub(crate) map_id: String,
    pub(crate) subject_id: Option<String>,
    pub(crate) parent_id: Option<String>,
    pub(crate) title: String,
    pub(crate) note_markdown: Option<String>,
    pub(crate) mastery_state: MasteryState,
    pub(crate) importance: u8,
    pub(crate) sort_order: u32,
    pub(crate) collapsed: bool,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

/// One formal node-to-resource association.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KnowledgeNodeResource {
    pub(crate) id: String,
    pub(crate) node_id: String,
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) page_start: Option<u32>,
    pub(crate) page_end: Option<u32>,
    pub(crate) note: Option<String>,
    pub(crate) created_at: i64,
}

/// A complete formal map returned to the editor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KnowledgeMapBundle {
    pub(crate) map: KnowledgeMap,
    pub(crate) nodes: Vec<KnowledgeNode>,
    pub(crate) resources: Vec<KnowledgeNodeResource>,
    pub(crate) can_undo: bool,
    pub(crate) can_redo: bool,
}

/// One format-independent node in a pending import tree.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MindMapDraftNode {
    pub(crate) title: String,
    pub(crate) note_markdown: Option<String>,
    pub(crate) children: Vec<Self>,
}

/// A typed import draft that cannot modify formal nodes until accepted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MindMapImportDraft {
    pub(crate) id: String,
    pub(crate) source_resource_id: String,
    pub(crate) source_format: String,
    pub(crate) title: String,
    pub(crate) tree: MindMapDraftNode,
    pub(crate) warnings: Vec<String>,
    pub(crate) node_count: u32,
    pub(crate) state: String,
    pub(crate) accepted_map_id: Option<String>,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}
