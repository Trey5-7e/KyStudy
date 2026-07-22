use super::{PersistenceError, current_utc_millis};
use crate::domain::{
    IndexedResourcePage, ResourceIndexSession, ResourceIndexStatus, ResourceSearchResult,
};

const MAXIMUM_PDF_PAGES: u32 = 100_000;
const MAXIMUM_PAGE_TEXT_CHARS: usize = 500_000;
const MAXIMUM_SEARCH_CHARS: usize = 100;
const MAXIMUM_SEARCH_RESULTS: u32 = 100;
const CHUNK_TARGET_CHARS: usize = 900;
const CHUNK_MINIMUM_CHARS: usize = 650;
const CHUNK_OVERLAP_CHARS: usize = 80;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BeginResourceIndexInput {
    pub(crate) document_id: String,
    pub(crate) total_pages: u32,
    pub(crate) force: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct StoreResourcePageTextInput {
    pub(crate) document_id: String,
    pub(crate) page_number: u32,
    pub(crate) total_pages: u32,
    pub(crate) width_points: f64,
    pub(crate) height_points: f64,
    pub(crate) text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SearchResourcesInput {
    pub(crate) query: String,
    pub(crate) limit: Option<u32>,
}

/// Stable failures from local text extraction and search management.
#[derive(Debug, thiserror::Error)]
pub(crate) enum SearchError {
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    #[error("resource document was not found")]
    DocumentNotFound,
    #[error("resource is not an indexable PDF")]
    UnsupportedDocument,
    #[error("resource index input is invalid")]
    InvalidInput,
    #[error("resource index is not running")]
    IndexNotRunning,
    #[error("resource index is incomplete")]
    IndexIncomplete,
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl SearchError {
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::DocumentNotFound => "RESOURCE_NOT_FOUND",
            Self::UnsupportedDocument => "RESOURCE_INDEX_UNSUPPORTED",
            Self::InvalidInput => "RESOURCE_INDEX_INPUT_INVALID",
            Self::IndexNotRunning => "RESOURCE_INDEX_NOT_RUNNING",
            Self::IndexIncomplete => "RESOURCE_INDEX_INCOMPLETE",
            Self::Persistence(error) => error.code(),
        }
    }
}

/// Persistence boundary for derived PDF text and local search indexes.
pub(crate) trait SearchRepository: Clone + Send + Sync + 'static {
    fn recover_interrupted(&self, updated_at: i64) -> Result<u64, SearchError>;
    fn list_statuses(&self) -> Result<Vec<ResourceIndexStatus>, SearchError>;
    fn begin_index(
        &self,
        input: &BeginResourceIndexInput,
        started_at: i64,
    ) -> Result<ResourceIndexSession, SearchError>;
    fn store_page(
        &self,
        page: &IndexedResourcePage,
        indexed_at: i64,
    ) -> Result<ResourceIndexStatus, SearchError>;
    fn complete_index(
        &self,
        document_id: &str,
        completed_at: i64,
    ) -> Result<ResourceIndexStatus, SearchError>;
    fn interrupt_index(
        &self,
        document_id: &str,
        updated_at: i64,
    ) -> Result<ResourceIndexStatus, SearchError>;
    fn fail_index(
        &self,
        document_id: &str,
        updated_at: i64,
    ) -> Result<ResourceIndexStatus, SearchError>;
    fn clear_index(&self, document_id: &str) -> Result<ResourceIndexStatus, SearchError>;
    fn search(&self, query: &str, limit: u32) -> Result<Vec<ResourceSearchResult>, SearchError>;
}

/// Local parsing and search use cases with a statically dispatched repository.
#[derive(Debug, Clone)]
pub(crate) struct SearchUseCases<R> {
    repository: R,
}

impl<R: SearchRepository> SearchUseCases<R> {
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    pub(crate) fn recover_interrupted(&self) -> Result<u64, SearchError> {
        self.repository.recover_interrupted(current_utc_millis()?)
    }

    pub(crate) fn list_statuses(&self) -> Result<Vec<ResourceIndexStatus>, SearchError> {
        self.repository.list_statuses()
    }

    pub(crate) fn begin_index(
        &self,
        input: &BeginResourceIndexInput,
    ) -> Result<ResourceIndexSession, SearchError> {
        validate_id(&input.document_id)?;
        validate_total_pages(input.total_pages)?;
        self.repository.begin_index(input, current_utc_millis()?)
    }

    pub(crate) fn store_page(
        &self,
        input: StoreResourcePageTextInput,
    ) -> Result<ResourceIndexStatus, SearchError> {
        let page = validate_page(input)?;
        self.repository.store_page(&page, current_utc_millis()?)
    }

    pub(crate) fn complete_index(
        &self,
        document_id: &str,
    ) -> Result<ResourceIndexStatus, SearchError> {
        validate_id(document_id)?;
        self.repository
            .complete_index(document_id, current_utc_millis()?)
    }

    pub(crate) fn interrupt_index(
        &self,
        document_id: &str,
    ) -> Result<ResourceIndexStatus, SearchError> {
        validate_id(document_id)?;
        self.repository
            .interrupt_index(document_id, current_utc_millis()?)
    }

    pub(crate) fn fail_index(&self, document_id: &str) -> Result<ResourceIndexStatus, SearchError> {
        validate_id(document_id)?;
        self.repository
            .fail_index(document_id, current_utc_millis()?)
    }

    pub(crate) fn clear_index(
        &self,
        document_id: &str,
    ) -> Result<ResourceIndexStatus, SearchError> {
        validate_id(document_id)?;
        self.repository.clear_index(document_id)
    }

    pub(crate) fn search(
        &self,
        input: &SearchResourcesInput,
    ) -> Result<Vec<ResourceSearchResult>, SearchError> {
        let query = input.query.trim();
        let length = query.chars().count();
        if length == 0 || length > MAXIMUM_SEARCH_CHARS {
            return Err(SearchError::InvalidInput);
        }
        let limit = input.limit.unwrap_or(30);
        if limit == 0 || limit > MAXIMUM_SEARCH_RESULTS {
            return Err(SearchError::InvalidInput);
        }
        self.repository.search(query, limit)
    }
}

fn validate_page(input: StoreResourcePageTextInput) -> Result<IndexedResourcePage, SearchError> {
    validate_id(&input.document_id)?;
    validate_total_pages(input.total_pages)?;
    if input.page_number == 0
        || input.page_number > input.total_pages
        || !input.width_points.is_finite()
        || !input.height_points.is_finite()
        || !(1.0..=20_000.0).contains(&input.width_points)
        || !(1.0..=20_000.0).contains(&input.height_points)
        || input.text.chars().count() > MAXIMUM_PAGE_TEXT_CHARS
    {
        return Err(SearchError::InvalidInput);
    }
    let text = normalize_text(&input.text);
    let chunks = chunk_text(&text);
    Ok(IndexedResourcePage {
        document_id: input.document_id,
        page_number: input.page_number,
        total_pages: input.total_pages,
        width_points: input.width_points,
        height_points: input.height_points,
        text,
        chunks,
    })
}

fn validate_total_pages(total_pages: u32) -> Result<(), SearchError> {
    if total_pages == 0 || total_pages > MAXIMUM_PDF_PAGES {
        Err(SearchError::InvalidInput)
    } else {
        Ok(())
    }
}

fn validate_id(value: &str) -> Result<(), SearchError> {
    if value.len() == 36 && UuidLike::is_valid(value) {
        Ok(())
    } else {
        Err(SearchError::InvalidInput)
    }
}

struct UuidLike;

impl UuidLike {
    fn is_valid(value: &str) -> bool {
        uuid::Uuid::parse_str(value).is_ok()
    }
}

fn normalize_text(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut pending_space = false;
    for character in value.trim().chars() {
        if character.is_whitespace() {
            pending_space = !normalized.is_empty();
        } else {
            if pending_space {
                normalized.push(' ');
                pending_space = false;
            }
            normalized.push(character);
        }
    }
    normalized
}

fn chunk_text(text: &str) -> Vec<String> {
    let characters = text.chars().collect::<Vec<_>>();
    if characters.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < characters.len() {
        let target_end = (start + CHUNK_TARGET_CHARS).min(characters.len());
        let end = find_chunk_end(&characters, start, target_end);
        let chunk = characters[start..end]
            .iter()
            .collect::<String>()
            .trim()
            .to_owned();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }
        if end == characters.len() {
            break;
        }
        start = end.saturating_sub(CHUNK_OVERLAP_CHARS).max(start + 1);
    }
    chunks
}

fn find_chunk_end(characters: &[char], start: usize, target_end: usize) -> usize {
    if target_end == characters.len() {
        return target_end;
    }
    let minimum_end = (start + CHUNK_MINIMUM_CHARS).min(target_end);
    (minimum_end..target_end)
        .rev()
        .find(|index| is_chunk_boundary(characters[*index - 1]))
        .unwrap_or(target_end)
}

fn is_chunk_boundary(character: char) -> bool {
    matches!(character, '。' | '！' | '？' | '；' | '.' | '!' | '?' | ';')
}

#[cfg(test)]
mod tests {
    use super::{StoreResourcePageTextInput, chunk_text, normalize_text, validate_page};

    #[test]
    fn normalize_text_collapses_pdf_whitespace_without_dropping_unicode() {
        assert_eq!(
            normalize_text("  数据结构\n\n  线性表  "),
            "数据结构 线性表"
        );
    }

    #[test]
    fn chunk_text_keeps_short_page_in_one_chunk() {
        assert_eq!(
            chunk_text("线性表的顺序存储结构。"),
            ["线性表的顺序存储结构。"]
        );
    }

    #[test]
    fn chunk_text_uses_overlap_for_long_pages() {
        let text = "数据结构。".repeat(300);
        let chunks = chunk_text(&text);

        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 900));
    }

    #[test]
    fn validate_page_rejects_a_page_outside_the_document() {
        let error = validate_page(StoreResourcePageTextInput {
            document_id: "019f7328-4b66-7613-9729-e3570fc41525".to_owned(),
            page_number: 3,
            total_pages: 2,
            width_points: 595.0,
            height_points: 842.0,
            text: "content".to_owned(),
        })
        .expect_err("out-of-range page must fail");

        assert_eq!(error.code(), "RESOURCE_INDEX_INPUT_INVALID");
    }
}
