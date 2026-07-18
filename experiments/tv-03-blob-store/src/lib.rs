//! Content-addressed file-store reliability experiment for `KyStudy` TV-03.
//!
//! The crate validates fixed-memory imports, SHA-256 physical deduplication, persistent recovery
//! Jobs, integrity scans, and complete workspace backup restoration. Public operations are
//! purpose-specific and do not accept arbitrary managed storage keys or SQL.

mod backup;
mod benchmark;
mod db;
mod error;
mod hash;
mod model;
mod pathing;
mod workspace;

pub use benchmark::run_large_file_benchmark;
pub use error::StoreError;
pub use hash::STREAM_BUFFER_BYTES;
pub use model::{
    AuthorizedSource, BackupReport, BenchmarkReport, ImportDirective, ImportMeasurement,
    ImportOutcome, ImportProgress, ImportRequest, IntegrityIssue, IntegrityIssueKind,
    IntegrityReport, RecoveryReport, RestoreReport, WorkspaceStats,
};
pub use workspace::Workspace;

/// Result alias for the TV-03 file and database boundary.
pub type Result<T> = std::result::Result<T, StoreError>;
