use std::path::PathBuf;

/// Metadata required to create a local `KyStudy` workspace.
#[derive(Debug, Clone, Copy)]
pub struct NewWorkspace<'a> {
    /// Application-generated stable identifier.
    pub id: &'a str,
    /// User-visible workspace name.
    pub display_name: &'a str,
    /// IANA timezone name used for local calendar dates.
    pub timezone: &'a str,
    /// Creation time as UTC milliseconds.
    pub created_at: i64,
}

/// Input for one atomic attempt, review-event, and review-state update.
#[derive(Debug, Clone, Copy)]
pub struct AttemptReview<'a> {
    /// New attempt identifier.
    pub attempt_id: &'a str,
    /// New immutable review-event identifier.
    pub review_event_id: &'a str,
    /// Existing question identifier.
    pub question_id: &'a str,
    /// Workspace that owns the question and review state.
    pub workspace_id: &'a str,
    /// Attempt time as UTC milliseconds.
    pub attempted_at: i64,
    /// Next local review date in `YYYY-MM-DD` format.
    pub next_due_date: &'a str,
    /// Whether the learner considered the answer mastered.
    pub mastered: bool,
}

/// One background job that was still running when the database was inspected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunningJob {
    /// Stable job identifier.
    pub id: String,
    /// Stable job kind rather than implementation type information.
    pub kind: String,
    /// Last persisted UTC millisecond timestamp.
    pub updated_at: i64,
}

/// Result of opening a database and bringing it to the embedded schema version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenReport {
    /// Migration versions applied by this open operation.
    pub applied_versions: Vec<i64>,
    /// Snapshot created before the first pending high-risk migration, if any.
    pub migration_snapshot: Option<BackupArtifact>,
}

/// Verified metadata for one standalone `SQLite` backup.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupArtifact {
    /// Backend-only local path. A future Command DTO must not expose this blindly.
    pub path: PathBuf,
    /// Uppercase SHA-256 of the completed main database file.
    pub sha256: String,
    /// Schema version found in the verified backup.
    pub schema_version: i64,
    /// Main database file size in bytes.
    pub bytes: u64,
}

/// `SQLite` runtime and connection capabilities observed by the experiment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilityReport {
    /// Runtime `SQLite` semantic version.
    pub sqlite_version: String,
    /// Runtime `SQLite` source identifier.
    pub sqlite_source_id: String,
    /// Compile options reported by `SQLite`.
    pub compile_options: Vec<String>,
    /// Effective journal mode for the opened workspace.
    pub journal_mode: String,
    /// Whether foreign-key enforcement is active on this connection.
    pub foreign_keys_enabled: bool,
    /// Whether an FTS5 table with the trigram tokenizer could be queried.
    pub fts5_trigram_available: bool,
}

/// Result of a complete database health inspection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HealthReport {
    /// Current embedded migration version.
    pub schema_version: i64,
    /// Number of jobs persisted in the recoverable `running` state.
    pub running_job_count: u64,
}

/// Release-mode measurements for the deterministic TV-02 scale fixture.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScaleReport {
    /// Runtime and compile-time capabilities used for this measurement.
    pub capabilities: CapabilityReport,
    /// Number of task rows generated.
    pub task_rows: u64,
    /// Number of attempt rows generated.
    pub attempt_rows: u64,
    /// Number of immutable review events generated.
    pub review_event_rows: u64,
    /// Time used to generate all scale rows.
    pub seed_millis: u128,
    /// Mean time of the indexed today-task count query.
    pub today_query_mean_micros: u128,
    /// Mean time of the indexed due-review count query.
    pub due_review_query_mean_micros: u128,
    /// Time used by `SQLite` Online Backup and verification.
    pub backup_millis: u128,
    /// Time used to verify and restore the backup to a new path.
    pub restore_millis: u128,
    /// Verified backup size in bytes.
    pub backup_bytes: u64,
    /// Query planner detail for the today-task lookup.
    pub today_query_plan: Vec<String>,
    /// Query planner detail for the due-review lookup.
    pub due_review_query_plan: Vec<String>,
}
