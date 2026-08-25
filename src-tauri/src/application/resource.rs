use std::fs::File;
use std::path::Path;
use std::sync::atomic::AtomicBool;

use uuid::Uuid;

use super::{PersistenceError, current_utc_millis};

/// One imported resource returned without its managed path or storage key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceDocument {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) mime_type: String,
    pub(crate) size_bytes: u64,
    pub(crate) sha256: String,
    pub(crate) reused_existing_blob: bool,
    pub(crate) role: String,
    pub(crate) page_count: Option<u32>,
    pub(crate) last_page: Option<u32>,
    pub(crate) last_opened_at: Option<i64>,
    pub(crate) created_at: i64,
}

/// Metadata required to open one registered local resource without exposing its path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResourceReaderDescriptor {
    pub(crate) document_id: String,
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) mime_type: String,
    pub(crate) size_bytes: u64,
    pub(crate) page_count: Option<u32>,
    pub(crate) last_page: Option<u32>,
}

/// Backend-authorized file used only by the custom protocol boundary.
#[derive(Debug)]
pub(crate) struct ReadableResource {
    pub(crate) file: File,
    pub(crate) mime_type: String,
    pub(crate) size_bytes: u64,
}

/// Bounded bytes from one registered structured mind-map source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MindMapSource {
    pub(crate) document_id: String,
    pub(crate) title: String,
    pub(crate) mime_type: String,
    pub(crate) bytes: Vec<u8>,
}

/// Progress emitted after each bounded streaming chunk is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ImportProgress {
    pub(crate) copied_bytes: u64,
    pub(crate) total_bytes: u64,
}

/// Startup reconciliation counts for interrupted imports.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct RecoveryReport {
    pub(crate) interrupted: u64,
    pub(crate) completed: u64,
    pub(crate) failed: u64,
}

/// Internal metadata generated for one backend-authorized import.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ImportRequest {
    pub(crate) job_id: String,
    pub(crate) document_id: String,
    pub(crate) title: String,
    pub(crate) kind: String,
    pub(crate) mime_type: String,
    pub(crate) created_at: i64,
}

/// Stable failures from the file import and recovery boundary.
#[derive(Debug, thiserror::Error)]
pub(crate) enum ImportError {
    /// No workspace exists yet.
    #[error("workspace is not initialized")]
    WorkspaceNotInitialized,
    /// The selected source is not a regular local file.
    #[error("selected source is not a regular file")]
    SourceNotFile,
    /// Managed workspace content cannot be selected as a new external source.
    #[error("selected source is inside the managed workspace")]
    SourceInsideWorkspace,
    /// A supported Unicode display name could not be derived.
    #[error("selected source name is unsupported")]
    InvalidFileName,
    /// The source length changed while streaming.
    #[error("source changed during import")]
    SourceChanged,
    /// Available space cannot hold staging plus the configured reserve.
    #[error("insufficient disk space")]
    InsufficientSpace,
    /// The user canceled before formal commit.
    #[error("import canceled")]
    Canceled,
    /// A managed relative path violated the content-addressed layout.
    #[error("managed path is invalid")]
    InvalidManagedPath,
    /// Existing or staged bytes do not match trusted metadata.
    #[error("file integrity verification failed")]
    IntegrityMismatch,
    /// The requested document identifier is not registered in this workspace.
    #[error("resource document was not found")]
    DocumentNotFound,
    /// The registered resource cannot be opened by the requested reader.
    #[error("resource kind is not supported by this reader")]
    UnsupportedReaderKind,
    /// A role, page count, reading position, or reference page was invalid.
    #[error("resource metadata is invalid")]
    InvalidMetadata,
    /// A structured source exceeds the parser's fixed byte limit.
    #[error("mind-map source is too large")]
    MindMapSourceTooLarge,
    /// A temporary attachment exceeds the AI upload limit.
    #[error("temporary attachment is too large")]
    AttachmentTooLarge,
    /// A managed filesystem operation failed.
    #[error("managed file operation failed")]
    File {
        #[source]
        source: std::io::Error,
    },
    /// The `SQLite` workspace boundary failed.
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

impl ImportError {
    /// Returns the stable code used by command events and DTOs.
    pub(crate) const fn code(&self) -> &'static str {
        match self {
            Self::WorkspaceNotInitialized => "WORKSPACE_NOT_INITIALIZED",
            Self::SourceNotFile => "SOURCE_NOT_FILE",
            Self::SourceInsideWorkspace => "SOURCE_INSIDE_WORKSPACE",
            Self::InvalidFileName => "SOURCE_NAME_INVALID",
            Self::SourceChanged => "SOURCE_CHANGED",
            Self::InsufficientSpace => "DISK_SPACE_INSUFFICIENT",
            Self::Canceled => "IMPORT_CANCELED",
            Self::InvalidManagedPath => "MANAGED_PATH_INVALID",
            Self::IntegrityMismatch => "FILE_INTEGRITY_MISMATCH",
            Self::DocumentNotFound => "RESOURCE_NOT_FOUND",
            Self::UnsupportedReaderKind => "RESOURCE_READER_UNSUPPORTED",
            Self::InvalidMetadata => "RESOURCE_METADATA_INVALID",
            Self::MindMapSourceTooLarge => "MINDMAP_SOURCE_TOO_LARGE",
            Self::AttachmentTooLarge => "AI_ATTACHMENT_TOO_LARGE",
            Self::File { .. } => "FILE_OPERATION_FAILED",
            Self::Persistence(error) => error.code(),
        }
    }
}

impl From<std::io::Error> for ImportError {
    fn from(source: std::io::Error) -> Self {
        Self::File { source }
    }
}

/// File and database operations required by resource use cases.
pub(crate) trait ResourceRepository: Clone + Send + Sync + 'static {
    /// Streams one backend-selected local file into managed storage.
    fn import_file(
        &self,
        source: &Path,
        request: &ImportRequest,
        canceled: &AtomicBool,
        observe: &mut (dyn FnMut(ImportProgress) + Send),
    ) -> Result<ResourceDocument, ImportError>;

    /// Reconciles jobs left in running or committing state.
    fn recover_interrupted_imports(&self) -> Result<RecoveryReport, ImportError>;

    /// Lists formal resources without exposing managed locations.
    fn list_resources(&self) -> Result<Vec<ResourceDocument>, ImportError>;

    /// Hides one resource from the library while preserving managed bytes for references.
    fn trash_resource(&self, document_id: &str, deleted_at: i64) -> Result<(), ImportError>;

    /// Loads reader metadata for one PDF or image document.
    fn reader_descriptor(&self, document_id: &str)
    -> Result<ResourceReaderDescriptor, ImportError>;

    /// Opens one registered PDF or image for a custom protocol response.
    fn open_readable(&self, document_id: &str) -> Result<ReadableResource, ImportError>;

    /// Saves a user-selected semantic role for one resource.
    fn update_role(&self, document_id: &str, role: &str) -> Result<ResourceDocument, ImportError>;

    /// Saves the verified PDF page count and the current page.
    fn save_reading_progress(
        &self,
        document_id: &str,
        page_count: u32,
        last_page: u32,
    ) -> Result<ResourceReaderDescriptor, ImportError>;

    /// Reads one registered OPML, `FreeMind`, or `XMind` source under a fixed limit.
    fn read_mindmap_source(
        &self,
        document_id: &str,
        maximum_bytes: u64,
    ) -> Result<MindMapSource, ImportError>;
}

/// Resource use cases with a statically dispatched storage adapter.
#[derive(Debug, Clone)]
pub(crate) struct ResourceUseCases<R> {
    repository: R,
}

impl<R: ResourceRepository> ResourceUseCases<R> {
    /// Composes resource use cases with one storage adapter.
    pub(crate) const fn new(repository: R) -> Self {
        Self { repository }
    }

    /// Imports a backend-selected source using product metadata defaults.
    pub(crate) fn import_file(
        &self,
        source: &Path,
        canceled: &AtomicBool,
        observe: &mut (dyn FnMut(ImportProgress) + Send),
    ) -> Result<ResourceDocument, ImportError> {
        let (title, kind, mime_type) = classify_source(source)?;
        let request = ImportRequest {
            job_id: Uuid::now_v7().to_string(),
            document_id: Uuid::now_v7().to_string(),
            title,
            kind,
            mime_type,
            created_at: current_utc_millis()?,
        };
        self.repository
            .import_file(source, &request, canceled, observe)
    }

    /// Recovers interrupted imports before returning the current resource list.
    pub(crate) fn recover_and_list(
        &self,
    ) -> Result<(RecoveryReport, Vec<ResourceDocument>), ImportError> {
        let report = self.repository.recover_interrupted_imports()?;
        let resources = self.repository.list_resources()?;
        Ok((report, resources))
    }

    /// Lists formal resources without re-running startup recovery.
    pub(crate) fn list(&self) -> Result<Vec<ResourceDocument>, ImportError> {
        self.repository.list_resources()
    }

    /// Removes one resource from the active library without breaking existing question cards.
    pub(crate) fn trash(&self, document_id: &str) -> Result<(), ImportError> {
        Uuid::parse_str(document_id).map_err(|_| ImportError::InvalidMetadata)?;
        self.repository
            .trash_resource(document_id, current_utc_millis()?)
    }

    /// Loads safe metadata before opening a registered PDF or image.
    pub(crate) fn reader_descriptor(
        &self,
        document_id: &str,
    ) -> Result<ResourceReaderDescriptor, ImportError> {
        self.repository.reader_descriptor(document_id)
    }

    /// Opens registered bytes for a controlled custom-protocol response.
    pub(crate) fn open_readable(&self, document_id: &str) -> Result<ReadableResource, ImportError> {
        self.repository.open_readable(document_id)
    }

    /// Updates the user-selected resource role.
    pub(crate) fn update_role(
        &self,
        document_id: &str,
        role: &str,
    ) -> Result<ResourceDocument, ImportError> {
        self.repository.update_role(document_id, role)
    }

    /// Persists PDF page metadata after a successful reader render.
    pub(crate) fn save_reading_progress(
        &self,
        document_id: &str,
        page_count: u32,
        last_page: u32,
    ) -> Result<ResourceReaderDescriptor, ImportError> {
        self.repository
            .save_reading_progress(document_id, page_count, last_page)
    }

    /// Loads bounded structured source bytes without exposing a managed path.
    pub(crate) fn read_mindmap_source(
        &self,
        document_id: &str,
        maximum_bytes: u64,
    ) -> Result<MindMapSource, ImportError> {
        self.repository
            .read_mindmap_source(document_id, maximum_bytes)
    }
}

pub(crate) fn classify_source(path: &Path) -> Result<(String, String, String), ImportError> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or(ImportError::InvalidFileName)?;
    let title = path
        .file_stem()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(file_name)
        .chars()
        .take(240)
        .collect::<String>();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    let (kind, mime_type) = match extension.as_str() {
        "pdf" => ("pdf", "application/pdf"),
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "webp" => ("image", "image/webp"),
        "xmind" => ("mindmap_source", "application/x-xmind"),
        "opml" => ("mindmap_source", "text/x-opml"),
        "mm" => ("mindmap_source", "application/x-freemind"),
        "md" => ("document", "text/markdown"),
        "txt" => ("document", "text/plain"),
        _ => ("document", "application/octet-stream"),
    };
    Ok((title, kind.to_owned(), mime_type.to_owned()))
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::classify_source;

    #[test]
    fn classify_source_recognizes_pdf_files() {
        let (_, kind, _) =
            classify_source(Path::new("计算机组成原理.pdf")).expect("PDF name should classify");

        assert_eq!(kind, "pdf");
    }

    #[test]
    fn classify_source_preserves_a_unicode_title() {
        let (title, _, _) =
            classify_source(Path::new("线性代数错题.md")).expect("Unicode name should classify");

        assert_eq!(title, "线性代数错题");
    }

    #[test]
    fn classify_source_recognizes_supported_mindmap_formats() {
        let formats = [
            ("大纲.opml", "text/x-opml"),
            ("知识树.mm", "application/x-freemind"),
            ("原始导图.xmind", "application/x-xmind"),
        ];

        for (file_name, expected_mime_type) in formats {
            let (_, kind, mime_type) =
                classify_source(Path::new(file_name)).expect("mind-map source should classify");
            assert_eq!(kind, "mindmap_source");
            assert_eq!(mime_type, expected_mime_type);
        }
    }
}
