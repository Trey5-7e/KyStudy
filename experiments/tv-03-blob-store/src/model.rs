use std::path::{Path, PathBuf};

/// A file selected and canonicalized by the Rust boundary.
#[derive(Debug)]
pub struct AuthorizedSource {
    pub(crate) path: PathBuf,
    pub(crate) display_name: String,
    pub(crate) size_bytes: u64,
}

impl AuthorizedSource {
    /// Returns the display-only original file name.
    #[must_use]
    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    /// Returns the source size observed during authorization.
    #[must_use]
    pub const fn size_bytes(&self) -> u64 {
        self.size_bytes
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

/// Stable identifiers and metadata for one import use case.
#[derive(Debug, Clone, Copy)]
pub struct ImportRequest<'a> {
    /// Persistent background-job identifier.
    pub job_id: &'a str,
    /// `ResourceDocument` identifier created after commit.
    pub document_id: &'a str,
    /// Validated MIME type recorded with the resource.
    pub mime_type: &'a str,
    /// UTC millisecond timestamp supplied by the application layer.
    pub created_at: i64,
}

/// Progress emitted after a complete buffer has been written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImportProgress {
    /// Bytes durably copied into the current staging stream so far.
    pub copied_bytes: u64,
    /// Authorized source length.
    pub total_bytes: u64,
}

/// Control returned by the backend progress observer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportDirective {
    /// Continue reading the authorized source.
    Continue,
    /// Cancel before any formal Blob or `ResourceDocument` is committed.
    Cancel,
}

/// Successful import result without exposing the managed absolute path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportOutcome {
    /// SHA-256 of the imported content.
    pub sha256: String,
    /// Verified content size.
    pub size_bytes: u64,
    /// Whether an existing physical Blob was reused.
    pub reused_existing_blob: bool,
    /// `ResourceDocument` identifier created by the use case.
    pub document_id: String,
}

/// Aggregated workspace counts used by tests and health diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkspaceStats {
    /// Number of formal Blob rows.
    pub blob_count: u64,
    /// Number of `ResourceDocument` rows.
    pub document_count: u64,
    /// Number of active staging files.
    pub staging_file_count: u64,
    /// Number of failed jobs.
    pub failed_job_count: u64,
    /// Number of canceled jobs.
    pub canceled_job_count: u64,
    /// Number of jobs waiting in the recoverable committing state.
    pub committing_job_count: u64,
}

/// Classification assigned by a full Blob integrity scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntegrityIssueKind {
    /// The expected managed file is absent.
    Missing,
    /// The managed file exists but size or digest differs.
    Corrupted,
}

/// One non-sensitive integrity issue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntegrityIssue {
    /// Blob digest used as the stable diagnostic identifier.
    pub sha256: String,
    /// Missing or corrupted classification.
    pub kind: IntegrityIssueKind,
}

/// Result of a complete Blob integrity scan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntegrityReport {
    /// Number of verified healthy Blob files.
    pub healthy_count: u64,
    /// Missing and corrupted entries.
    pub issues: Vec<IntegrityIssue>,
}

/// Startup recovery outcome for interrupted imports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecoveryReport {
    /// Running jobs whose untrusted staging files were removed.
    pub cleaned_running_jobs: u64,
    /// Committing jobs successfully completed from staging or final paths.
    pub completed_committing_jobs: u64,
    /// Jobs that could not be recovered and were marked failed.
    pub failed_jobs: u64,
}

/// Verified metadata for one complete workspace backup directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupReport {
    /// Final backup directory.
    pub path: PathBuf,
    /// Number of formal Blob files included.
    pub blob_count: u64,
    /// Sum of database, Manifest, and Blob file sizes.
    pub total_bytes: u64,
}

/// Result of restoring a backup into a new workspace directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RestoreReport {
    /// New workspace directory.
    pub path: PathBuf,
    /// Number of verified Blob files restored.
    pub blob_count: u64,
}

/// Release-mode measurement for one generated input size.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportMeasurement {
    /// Input size in bytes.
    pub size_bytes: u64,
    /// Total import duration in milliseconds.
    pub elapsed_millis: u128,
    /// Mean throughput in MiB/s, scaled by 100 for stable integer reporting.
    pub throughput_mib_per_second_x100: u64,
    /// Whether preallocation and normal import succeeded.
    pub completed: bool,
}

/// Complete TV-03 large-file benchmark report.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BenchmarkReport {
    /// Fixed copy/hash buffer size.
    pub buffer_bytes: usize,
    /// Per-size import measurements.
    pub imports: Vec<ImportMeasurement>,
    /// Duration of a duplicate 1 GiB import in milliseconds.
    pub duplicate_import_millis: u128,
    /// Complete workspace backup duration in milliseconds.
    pub backup_millis: u128,
    /// Complete workspace restore duration in milliseconds.
    pub restore_millis: u128,
    /// Final backup size.
    pub backup_bytes: u64,
}
