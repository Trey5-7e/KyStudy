//! `SQLite` reliability experiment for `KyStudy` TV-02.
//!
//! The crate deliberately exposes purpose-specific Rust operations instead of arbitrary SQL. It
//! validates connection configuration, migrations, transactions, integrity, crash recovery, and
//! backup restoration before the formal `KyStudy` application is initialized.

mod backup;
mod database;
mod error;
mod integrity;
mod migration;
mod model;
mod time;
mod workload;

pub use database::Database;
pub use error::DatabaseError;
pub use model::{
    AttemptReview, BackupArtifact, CapabilityReport, HealthReport, NewWorkspace, OpenReport,
    RunningJob, ScaleReport,
};
pub use workload::run_scale_probe;

/// Result alias used by the TV-02 database boundary.
pub type Result<T> = std::result::Result<T, DatabaseError>;
