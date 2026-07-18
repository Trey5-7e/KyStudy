use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};

use fs4::{FileExt, TryLockError};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use tempfile::{Builder, TempPath};

use crate::db::{BlobRecord, JobRecord, active_jobs, all_blobs, open_database};
use crate::hash::{hash_file, stream_copy_and_hash};
use crate::pathing::{
    DATABASE_FILE_NAME, blob_path, staging_key, staging_path, storage_key, validate_storage_key,
};
use crate::{
    AuthorizedSource, ImportDirective, ImportOutcome, ImportProgress, ImportRequest,
    IntegrityIssue, IntegrityIssueKind, IntegrityReport, RecoveryReport, Result, StoreError,
    WorkspaceStats,
};

const FREE_SPACE_RESERVE_BYTES: u64 = 64 * 1024 * 1024;
const PROGRESS_PERSIST_INTERVAL_BYTES: u64 = 16 * 1024 * 1024;

/// Locked local workspace containing one `SQLite` database and content-addressed Blob tree.
pub struct Workspace {
    pub(crate) root: PathBuf,
    pub(crate) connection: Connection,
    _lock_file: File,
}

impl Workspace {
    /// Creates or opens one workspace and acquires its exclusive advisory lock.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError`] if directories, the lock, database configuration, schema, or
    /// integrity checks fail.
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root)?;
        let root = fs::canonicalize(root)?;
        fs::create_dir_all(root.join("blobs"))?;
        fs::create_dir_all(root.join("staging"))?;

        let lock_file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(".workspace.lock"))?;
        match FileExt::try_lock(&lock_file) {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) => return Err(StoreError::WorkspaceLocked),
            Err(TryLockError::Error(source)) => return Err(StoreError::Io { source }),
        }

        let connection = open_database(&root.join(DATABASE_FILE_NAME))?;
        Ok(Self {
            root,
            connection,
            _lock_file: lock_file,
        })
    }

    /// Converts a backend-selected path into a canonical, metadata-bound source token.
    ///
    /// Sources already inside the managed workspace are rejected to preserve the authorization
    /// and ownership boundary.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError`] if the source is absent, not a regular file, inside the workspace,
    /// or has no supported display name.
    pub fn authorize_source(&self, source_path: &Path) -> Result<AuthorizedSource> {
        let canonical = fs::canonicalize(source_path)?;
        if canonical.starts_with(&self.root) {
            return Err(StoreError::SourceInsideWorkspace);
        }
        let metadata = fs::metadata(&canonical)?;
        if !metadata.is_file() {
            return Err(StoreError::SourceNotFile);
        }
        let display_name = canonical
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or(StoreError::InvalidFileName)?
            .to_owned();
        Ok(AuthorizedSource {
            path: canonical,
            display_name,
            size_bytes: metadata.len(),
        })
    }

    /// Imports one authorized source using a fixed heap buffer and a cancelable progress observer.
    ///
    /// The source is first copied to same-filesystem staging while SHA-256 is calculated. The
    /// formal path is derived only from that digest. If the database commit fails after the file
    /// move, the Job remains `committing` so [`Self::recover_interrupted_imports`] can finish it.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError`] for invalid identifiers, insufficient space, cancellation, source
    /// mutation, I/O errors, or database failures. Normal cancellation and streaming failures do
    /// not leave formal Blob or `ResourceDocument` rows.
    pub fn import_file(
        &mut self,
        source: &AuthorizedSource,
        request: ImportRequest<'_>,
        mut observe: impl FnMut(ImportProgress) -> ImportDirective,
    ) -> Result<ImportOutcome> {
        validate_request(request)?;
        self.ensure_identifiers_available(request.job_id, request.document_id)?;
        let available = fs4::available_space(&self.root)?;
        ensure_available_space(source.size_bytes(), available, FREE_SPACE_RESERVE_BYTES)?;

        let mut source_file = File::open(source.path())?;
        let mut staging = Builder::new()
            .prefix("import-")
            .suffix(".part")
            .tempfile_in(self.root.join("staging"))?;
        FileExt::allocate(staging.as_file(), source.size_bytes())?;
        let staging_file_name = staging
            .path()
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(StoreError::InvalidManagedPath)?;
        let staging_key = staging_key(staging_file_name)?;

        self.connection.execute(
            "INSERT INTO processing_job(
                id, document_id, original_name, mime_type, expected_size, staging_key,
                state, progress_current, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', 0, ?7, ?7)",
            params![
                request.job_id,
                request.document_id,
                source.display_name(),
                request.mime_type,
                to_i64(source.size_bytes())?,
                staging_key,
                request.created_at
            ],
        )?;

        let mut last_persisted = 0_u64;
        let stream_result = stream_copy_and_hash(
            &mut source_file,
            staging.as_file_mut(),
            source.size_bytes(),
            |copied| {
                if observe(ImportProgress {
                    copied_bytes: copied,
                    total_bytes: source.size_bytes(),
                }) == ImportDirective::Cancel
                {
                    return Err(StoreError::ImportCanceled);
                }
                if copied.saturating_sub(last_persisted) >= PROGRESS_PERSIST_INTERVAL_BYTES {
                    self.persist_progress(request.job_id, copied, request.created_at)?;
                    last_persisted = copied;
                }
                Ok(())
            },
        );

        let (sha256, copied) = match stream_result {
            Ok(result) => result,
            Err(error) => {
                drop(staging);
                let (state, code) = if matches!(error, StoreError::ImportCanceled) {
                    ("canceled", "IMPORT_CANCELED")
                } else {
                    ("failed", error.code())
                };
                self.mark_job_terminal(request.job_id, state, code, request.created_at)?;
                return Err(error);
            }
        };
        staging.as_file_mut().set_len(copied)?;
        staging.as_file_mut().sync_all()?;
        let key = storage_key(&sha256)?;
        self.connection.execute(
            "UPDATE processing_job
             SET state = 'committing', progress_current = ?2, sha256 = ?3,
                 storage_key = ?4, updated_at = ?5
             WHERE id = ?1 AND state = 'running'",
            params![
                request.job_id,
                to_i64(copied)?,
                sha256,
                key,
                request.created_at
            ],
        )?;

        let job = JobRecord {
            id: request.job_id.to_owned(),
            document_id: request.document_id.to_owned(),
            original_name: source.display_name().to_owned(),
            mime_type: request.mime_type.to_owned(),
            expected_size: copied,
            staging_key,
            sha256: Some(sha256),
            storage_key: Some(key),
            state: "committing".to_owned(),
            created_at: request.created_at,
        };
        self.complete_live_import(&job, staging.into_temp_path())
    }

    /// Reconciles imports left by a process exit or database commit failure.
    ///
    /// Running jobs have untrusted staging removed and become failed. Committing jobs verify their
    /// digest and resume from either staging or the final content-addressed path.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError`] if Job inspection, cleanup, verification, or a recoverable commit
    /// cannot be completed.
    pub fn recover_interrupted_imports(&mut self) -> Result<RecoveryReport> {
        let jobs = active_jobs(&self.connection)?;
        let mut report = RecoveryReport {
            cleaned_running_jobs: 0,
            completed_committing_jobs: 0,
            failed_jobs: 0,
        };

        for job in jobs {
            if job.state == "running" {
                remove_file_if_present(&staging_path(&self.root, &job.staging_key)?)?;
                self.mark_job_terminal(&job.id, "failed", "IMPORT_INTERRUPTED", job.created_at)?;
                report.cleaned_running_jobs += 1;
                continue;
            }

            match self.complete_recovered_import(&job) {
                Ok(_) => report.completed_committing_jobs += 1,
                Err(StoreError::IntegrityMismatch | StoreError::InvalidManagedPath) => {
                    remove_file_if_present(&staging_path(&self.root, &job.staging_key)?)?;
                    self.mark_job_terminal(
                        &job.id,
                        "failed",
                        "IMPORT_RECOVERY_FAILED",
                        job.created_at,
                    )?;
                    report.failed_jobs += 1;
                }
                Err(error) => return Err(error),
            }
        }
        Ok(report)
    }

    /// Scans every formal Blob and updates its `ok`, `missing`, or `corrupted` state.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError`] if database records, managed paths, files, or state updates cannot
    /// be read safely.
    pub fn scan_integrity(&self) -> Result<IntegrityReport> {
        let records = all_blobs(&self.connection)?;
        let mut report = IntegrityReport {
            healthy_count: 0,
            issues: Vec::new(),
        };
        for record in records {
            validate_storage_key(&record.sha256, &record.storage_key)?;
            let path = blob_path(&self.root, &record.sha256)?;
            let classification = classify_blob(&path, &record)?;
            let state = match classification {
                None => {
                    report.healthy_count += 1;
                    "ok"
                }
                Some(kind) => {
                    report.issues.push(IntegrityIssue {
                        sha256: record.sha256.clone(),
                        kind,
                    });
                    match kind {
                        IntegrityIssueKind::Missing => "missing",
                        IntegrityIssueKind::Corrupted => "corrupted",
                    }
                }
            };
            self.connection.execute(
                "UPDATE blob SET integrity_state = ?2 WHERE sha256 = ?1",
                params![record.sha256, state],
            )?;
        }
        Ok(report)
    }

    /// Opens the managed Blob referenced by a `ResourceDocument` without returning its path.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError`] if the document is absent, its path invariant fails, or the file
    /// cannot be opened.
    pub fn open_document(&self, document_id: &str) -> Result<File> {
        let record = self
            .connection
            .query_row(
                "SELECT b.sha256, b.size_bytes, b.storage_key
                 FROM resource_document d
                 JOIN blob b ON b.sha256 = d.blob_sha256
                 WHERE d.id = ?1",
                [document_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()?
            .ok_or(StoreError::InvalidManagedPath)?;
        validate_storage_key(&record.0, &record.2)?;
        let path = blob_path(&self.root, &record.0)?;
        Ok(File::open(path)?)
    }

    /// Returns non-sensitive counts for the current workspace.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError`] if database or staging enumeration fails.
    pub fn stats(&self) -> Result<WorkspaceStats> {
        Ok(WorkspaceStats {
            blob_count: query_count(&self.connection, "SELECT COUNT(*) FROM blob")?,
            document_count: query_count(
                &self.connection,
                "SELECT COUNT(*) FROM resource_document",
            )?,
            staging_file_count: count_regular_files(&self.root.join("staging"))?,
            failed_job_count: query_count(
                &self.connection,
                "SELECT COUNT(*) FROM processing_job WHERE state = 'failed'",
            )?,
            canceled_job_count: query_count(
                &self.connection,
                "SELECT COUNT(*) FROM processing_job WHERE state = 'canceled'",
            )?,
            committing_job_count: query_count(
                &self.connection,
                "SELECT COUNT(*) FROM processing_job WHERE state = 'committing'",
            )?,
        })
    }

    fn ensure_identifiers_available(&self, job_id: &str, document_id: &str) -> Result<()> {
        let exists = self.connection.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM processing_job WHERE id = ?1 OR document_id = ?2
                UNION ALL
                SELECT 1 FROM resource_document WHERE id = ?2
             )",
            params![job_id, document_id],
            |row| row.get::<_, bool>(0),
        )?;
        if exists {
            Err(StoreError::IdentifierExists)
        } else {
            Ok(())
        }
    }

    fn persist_progress(&self, job_id: &str, copied: u64, updated_at: i64) -> Result<()> {
        self.connection.execute(
            "UPDATE processing_job SET progress_current = ?2, updated_at = ?3
             WHERE id = ?1 AND state = 'running'",
            params![job_id, to_i64(copied)?, updated_at],
        )?;
        Ok(())
    }

    fn mark_job_terminal(
        &self,
        job_id: &str,
        state: &str,
        error_code: &str,
        updated_at: i64,
    ) -> Result<()> {
        self.connection.execute(
            "UPDATE processing_job
             SET state = ?2, error_code = ?3, updated_at = ?4
             WHERE id = ?1",
            params![job_id, state, error_code, updated_at],
        )?;
        Ok(())
    }

    fn complete_live_import(
        &mut self,
        job: &JobRecord,
        staging: TempPath,
    ) -> Result<ImportOutcome> {
        let sha256 = job
            .sha256
            .as_deref()
            .ok_or(StoreError::InvalidManagedPath)?;
        let key = job
            .storage_key
            .as_deref()
            .ok_or(StoreError::InvalidManagedPath)?;
        validate_storage_key(sha256, key)?;
        let final_path = blob_path(&self.root, sha256)?;
        let reused = self.blob_exists(sha256)?;

        if reused && classify_expected(&final_path, sha256, job.expected_size)?.is_none() {
            drop(staging);
        } else if final_path.exists() {
            if classify_expected(&final_path, sha256, job.expected_size)?.is_some() {
                fs::remove_file(&final_path)?;
                persist_without_clobber(staging, &final_path)?;
            } else {
                drop(staging);
            }
        } else {
            persist_without_clobber(staging, &final_path)?;
        }

        self.commit_job(job)?;
        Ok(ImportOutcome {
            sha256: sha256.to_owned(),
            size_bytes: job.expected_size,
            reused_existing_blob: reused,
            document_id: job.document_id.clone(),
        })
    }

    fn complete_recovered_import(&mut self, job: &JobRecord) -> Result<ImportOutcome> {
        let sha256 = job
            .sha256
            .as_deref()
            .ok_or(StoreError::InvalidManagedPath)?;
        let key = job
            .storage_key
            .as_deref()
            .ok_or(StoreError::InvalidManagedPath)?;
        validate_storage_key(sha256, key)?;
        let final_path = blob_path(&self.root, sha256)?;
        let staging_path = staging_path(&self.root, &job.staging_key)?;
        let reused = self.blob_exists(sha256)?;

        if classify_expected(&final_path, sha256, job.expected_size)?.is_none() {
            remove_file_if_present(&staging_path)?;
        } else if staging_path.is_file()
            && classify_expected(&staging_path, sha256, job.expected_size)?.is_none()
        {
            if let Some(parent) = final_path.parent() {
                fs::create_dir_all(parent)?;
            }
            if final_path.exists() {
                fs::remove_file(&final_path)?;
            }
            fs::rename(&staging_path, &final_path)?;
        } else {
            return Err(StoreError::IntegrityMismatch);
        }

        self.commit_job(job)?;
        Ok(ImportOutcome {
            sha256: sha256.to_owned(),
            size_bytes: job.expected_size,
            reused_existing_blob: reused,
            document_id: job.document_id.clone(),
        })
    }

    fn commit_job(&mut self, job: &JobRecord) -> Result<()> {
        let sha256 = job
            .sha256
            .as_deref()
            .ok_or(StoreError::InvalidManagedPath)?;
        let key = job
            .storage_key
            .as_deref()
            .ok_or(StoreError::InvalidManagedPath)?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO blob(sha256, size_bytes, storage_key, integrity_state, created_at)
             VALUES (?1, ?2, ?3, 'ok', ?4)
             ON CONFLICT(sha256) DO NOTHING",
            params![sha256, to_i64(job.expected_size)?, key, job.created_at],
        )?;
        let stored = transaction.query_row(
            "SELECT size_bytes, storage_key FROM blob WHERE sha256 = ?1",
            [sha256],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )?;
        if u64::try_from(stored.0).map_err(|_| StoreError::ValueOutOfRange)? != job.expected_size
            || stored.1 != key
        {
            return Err(StoreError::IntegrityMismatch);
        }
        transaction.execute(
            "INSERT INTO resource_document(id, blob_sha256, original_name, mime_type, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                job.document_id,
                sha256,
                job.original_name,
                job.mime_type,
                job.created_at
            ],
        )?;
        transaction.execute(
            "UPDATE processing_job
             SET state = 'succeeded', error_code = NULL, updated_at = ?2
             WHERE id = ?1 AND state = 'committing'",
            params![job.id, job.created_at],
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn blob_exists(&self, sha256: &str) -> Result<bool> {
        Ok(self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM blob WHERE sha256 = ?1)",
            [sha256],
            |row| row.get::<_, bool>(0),
        )?)
    }
}

fn validate_request(request: ImportRequest<'_>) -> Result<()> {
    let identifiers_valid = !request.job_id.is_empty()
        && request.job_id.len() <= 120
        && !request.document_id.is_empty()
        && request.document_id.len() <= 120;
    let mime_valid = !request.mime_type.is_empty() && request.mime_type.len() <= 200;
    if identifiers_valid && mime_valid {
        Ok(())
    } else {
        Err(StoreError::IdentifierExists)
    }
}

fn ensure_available_space(size: u64, available: u64, reserve: u64) -> Result<()> {
    let required = size
        .checked_add(reserve)
        .ok_or(StoreError::ValueOutOfRange)?;
    if available < required {
        Err(StoreError::InsufficientSpace {
            required,
            available,
        })
    } else {
        Ok(())
    }
}

fn classify_blob(path: &Path, record: &BlobRecord) -> Result<Option<IntegrityIssueKind>> {
    classify_expected(path, &record.sha256, record.size_bytes)
}

fn classify_expected(
    path: &Path,
    expected_sha256: &str,
    expected_size: u64,
) -> Result<Option<IntegrityIssueKind>> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Some(IntegrityIssueKind::Missing));
        }
        Err(error) => return Err(error.into()),
    };
    if !metadata.is_file() || metadata.len() != expected_size {
        return Ok(Some(IntegrityIssueKind::Corrupted));
    }
    let (actual_sha256, actual_size) = hash_file(path)?;
    if actual_sha256 == expected_sha256 && actual_size == expected_size {
        Ok(None)
    } else {
        Ok(Some(IntegrityIssueKind::Corrupted))
    }
}

fn persist_without_clobber(staging: TempPath, final_path: &Path) -> Result<()> {
    let parent = final_path.parent().ok_or(StoreError::InvalidManagedPath)?;
    fs::create_dir_all(parent)?;
    staging
        .persist_noclobber(final_path)
        .map_err(|error| StoreError::Io {
            source: error.error,
        })?;
    Ok(())
}

fn remove_file_if_present(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn count_regular_files(directory: &Path) -> Result<u64> {
    let mut count = 0_u64;
    for entry in fs::read_dir(directory)? {
        if entry?.file_type()?.is_file() {
            count = count.checked_add(1).ok_or(StoreError::ValueOutOfRange)?;
        }
    }
    Ok(count)
}

fn query_count(connection: &Connection, sql: &str) -> Result<u64> {
    let count = connection.query_row(sql, [], |row| row.get::<_, i64>(0))?;
    u64::try_from(count).map_err(|_| StoreError::ValueOutOfRange)
}

fn to_i64(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| StoreError::ValueOutOfRange)
}

#[cfg(test)]
mod tests {
    use std::fs::File;
    use std::io::Write;

    use tempfile::tempdir;

    use super::ensure_available_space;
    use crate::{ImportDirective, ImportRequest, Workspace};

    #[test]
    fn ensure_available_space_returns_stable_error_before_writing() {
        let error = ensure_available_space(100, 149, 50)
            .expect_err("one missing byte should reject the import");

        assert_eq!(error.code(), "DISK_SPACE_INSUFFICIENT");
    }

    #[test]
    fn committing_job_recovers_after_database_transaction_failure() {
        let directory = tempdir().expect("temporary directory should be created");
        let source_path = directory.path().join("source.bin");
        let mut source_file = File::create(&source_path).expect("source should be created");
        source_file
            .write_all(&vec![7_u8; 2 * 1024 * 1024])
            .expect("source should be written");
        drop(source_file);
        let workspace_path = directory.path().join("workspace");
        let mut workspace = Workspace::open(&workspace_path).expect("workspace should open");
        let source = workspace
            .authorize_source(&source_path)
            .expect("source should authorize");
        workspace
            .connection
            .execute_batch(
                "CREATE TRIGGER fail_document_insert
                 BEFORE INSERT ON resource_document
                 BEGIN SELECT RAISE(ABORT, 'forced document failure'); END;",
            )
            .expect("failure trigger should be installed");

        workspace
            .import_file(
                &source,
                ImportRequest {
                    job_id: "job-commit-failure",
                    document_id: "document-commit-failure",
                    mime_type: "application/octet-stream",
                    created_at: 1,
                },
                |_| ImportDirective::Continue,
            )
            .expect_err("database trigger should fail the final transaction");
        let before = workspace.stats().expect("stats should be readable");
        assert_eq!(before.committing_job_count, 1);

        workspace
            .connection
            .execute_batch("DROP TRIGGER fail_document_insert")
            .expect("failure trigger should be removed");
        let recovery = workspace
            .recover_interrupted_imports()
            .expect("committing job should recover");
        let after = workspace.stats().expect("final stats should be readable");

        assert_eq!(recovery.completed_committing_jobs, 1);
        assert_eq!(after.blob_count, 1);
        assert_eq!(after.document_count, 1);
        assert_eq!(after.committing_job_count, 0);
    }
}
