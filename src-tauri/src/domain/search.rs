/// Persisted lifecycle for one PDF text-layer index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResourceIndexState {
    NotIndexed,
    Running,
    Interrupted,
    Failed,
    Ready,
    Empty,
}

impl ResourceIndexState {
    pub(crate) fn parse(value: &str) -> Option<Self> {
        match value {
            "not_indexed" => Some(Self::NotIndexed),
            "running" => Some(Self::Running),
            "interrupted" => Some(Self::Interrupted),
            "failed" => Some(Self::Failed),
            "ready" => Some(Self::Ready),
            "empty" => Some(Self::Empty),
            _ => None,
        }
    }

    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::NotIndexed => "not_indexed",
            Self::Running => "running",
            Self::Interrupted => "interrupted",
            Self::Failed => "failed",
            Self::Ready => "ready",
            Self::Empty => "empty",
        }
    }
}

/// Safe progress summary for one imported PDF.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceIndexStatus {
    pub(crate) document_id: String,
    pub(crate) state: ResourceIndexState,
    pub(crate) total_pages: Option<u32>,
    pub(crate) indexed_pages: u32,
    pub(crate) text_pages: u32,
    pub(crate) chunk_count: u32,
    pub(crate) updated_at: Option<i64>,
}

/// Resume decision returned before PDF.js starts extracting pages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceIndexSession {
    pub(crate) status: ResourceIndexStatus,
    pub(crate) next_page: u32,
    pub(crate) needs_indexing: bool,
}

/// Validated page text and deterministic chunks ready for one transaction.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct IndexedResourcePage {
    pub(crate) document_id: String,
    pub(crate) page_number: u32,
    pub(crate) total_pages: u32,
    pub(crate) width_points: f64,
    pub(crate) height_points: f64,
    pub(crate) text: String,
    pub(crate) chunks: Vec<String>,
}

/// User-facing kind of one local search match.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ResourceSearchMatchKind {
    Title,
    PageText,
}

impl ResourceSearchMatchKind {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Title => "title",
            Self::PageText => "page_text",
        }
    }
}

/// One bounded, path-free search result with an optional PDF page target.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceSearchResult {
    pub(crate) document_id: String,
    pub(crate) document_title: String,
    pub(crate) document_kind: String,
    pub(crate) page_number: Option<u32>,
    pub(crate) excerpt: String,
    pub(crate) match_kind: ResourceSearchMatchKind,
}
