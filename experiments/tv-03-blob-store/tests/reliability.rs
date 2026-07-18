//! Cross-module reliability scenarios for the TV-03 Blob experiment.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;
use tempfile::tempdir;
use tv_03_blob_store::{ImportDirective, ImportRequest, IntegrityIssueKind, StoreError, Workspace};

const MIB: usize = 1024 * 1024;

struct Fixture {
    _directory: tempfile::TempDir,
    workspace_path: PathBuf,
    source_path: PathBuf,
    workspace: Workspace,
}

impl Fixture {
    fn new(source_mib: usize) -> Self {
        let directory = tempdir().expect("temporary directory should be created");
        let source_path = directory.path().join("source.bin");
        generate_file(&source_path, source_mib * MIB, 17);
        let workspace_path = directory.path().join("workspace");
        let workspace = Workspace::open(&workspace_path).expect("workspace should open");
        Self {
            _directory: directory,
            workspace_path,
            source_path,
            workspace,
        }
    }

    fn import(&mut self, job_id: &str, document_id: &str) -> String {
        let source = self
            .workspace
            .authorize_source(&self.source_path)
            .expect("source should authorize");
        self.workspace
            .import_file(
                &source,
                ImportRequest {
                    job_id,
                    document_id,
                    mime_type: "application/octet-stream",
                    created_at: 1,
                },
                |_| ImportDirective::Continue,
            )
            .expect("import should succeed")
            .sha256
    }

    fn blob_path(&self, sha256: &str) -> PathBuf {
        self.workspace_path
            .join("blobs")
            .join(&sha256[0..2])
            .join(&sha256[2..4])
            .join(format!("{sha256}.blob"))
    }
}

#[test]
fn duplicate_content_reuses_one_blob_for_two_documents() {
    let mut fixture = Fixture::new(4);
    let first_sha256 = fixture.import("job-1", "document-1");
    let source = fixture
        .workspace
        .authorize_source(&fixture.source_path)
        .expect("source should authorize again");

    let second = fixture
        .workspace
        .import_file(
            &source,
            ImportRequest {
                job_id: "job-2",
                document_id: "document-2",
                mime_type: "application/octet-stream",
                created_at: 2,
            },
            |_| ImportDirective::Continue,
        )
        .expect("duplicate import should succeed");
    let stats = fixture.workspace.stats().expect("stats should be readable");

    assert_eq!(second.sha256, first_sha256);
    assert!(second.reused_existing_blob);
    assert_eq!(stats.blob_count, 1);
    assert_eq!(stats.document_count, 2);
    assert_eq!(stats.staging_file_count, 0);
}

#[test]
fn cancellation_removes_staging_and_creates_no_formal_records() {
    let mut fixture = Fixture::new(8);
    let source = fixture
        .workspace
        .authorize_source(&fixture.source_path)
        .expect("source should authorize");

    let error = fixture
        .workspace
        .import_file(
            &source,
            ImportRequest {
                job_id: "job-cancel",
                document_id: "document-cancel",
                mime_type: "application/octet-stream",
                created_at: 1,
            },
            |progress| {
                if progress.copied_bytes >= 2 * MIB as u64 {
                    ImportDirective::Cancel
                } else {
                    ImportDirective::Continue
                }
            },
        )
        .expect_err("observer should cancel the import");
    let stats = fixture.workspace.stats().expect("stats should be readable");

    assert_eq!(error.code(), "IMPORT_CANCELED");
    assert_eq!(stats.blob_count, 0);
    assert_eq!(stats.document_count, 0);
    assert_eq!(stats.staging_file_count, 0);
    assert_eq!(stats.canceled_job_count, 1);
}

#[test]
fn source_size_change_marks_job_failed_and_removes_staging() {
    let mut fixture = Fixture::new(4);
    let source = fixture
        .workspace
        .authorize_source(&fixture.source_path)
        .expect("source should authorize before mutation");
    OpenOptions::new()
        .write(true)
        .open(&fixture.source_path)
        .expect("source fixture should reopen")
        .set_len((2 * MIB) as u64)
        .expect("source fixture should be truncated");

    let error = fixture
        .workspace
        .import_file(
            &source,
            ImportRequest {
                job_id: "job-source-change",
                document_id: "document-source-change",
                mime_type: "application/octet-stream",
                created_at: 1,
            },
            |_| ImportDirective::Continue,
        )
        .expect_err("changed source length must fail");
    let stats = fixture.workspace.stats().expect("stats should be readable");

    assert_eq!(error.code(), "SOURCE_CHANGED");
    assert_eq!(stats.staging_file_count, 0);
    assert_eq!(stats.blob_count, 0);
    assert_eq!(stats.document_count, 0);
    assert_eq!(stats.failed_job_count, 1);
}

#[test]
fn second_workspace_writer_is_rejected_by_lock() {
    let fixture = Fixture::new(1);

    let error = Workspace::open(&fixture.workspace_path)
        .err()
        .expect("second writer should be rejected");

    assert!(matches!(error, StoreError::WorkspaceLocked));
}

#[test]
fn process_exit_during_copy_is_cleaned_on_recovery() {
    let fixture = Fixture::new(12);
    let Fixture {
        _directory,
        workspace_path,
        source_path,
        workspace,
    } = fixture;
    drop(workspace);
    let crash_exit = Command::new(env!("CARGO_BIN_EXE_tv03-crash-writer"))
        .arg(&workspace_path)
        .arg(&source_path)
        .status()
        .expect("crash writer should launch");
    assert!(!crash_exit.success(), "helper should terminate abnormally");
    let mut workspace = Workspace::open(&workspace_path).expect("workspace should reopen");

    let recovery = workspace
        .recover_interrupted_imports()
        .expect("running import should be cleaned");
    let recovered_stats = workspace.stats().expect("stats should be readable");

    assert_eq!(recovery.cleaned_running_jobs, 1);
    assert_eq!(recovered_stats.staging_file_count, 0);
    assert_eq!(recovered_stats.blob_count, 0);
    assert_eq!(recovered_stats.document_count, 0);
    assert_eq!(recovered_stats.failed_job_count, 1);
}

#[test]
fn integrity_scan_classifies_missing_blob() {
    let mut fixture = Fixture::new(2);
    let sha256 = fixture.import("job-missing", "document-missing");
    fs::remove_file(fixture.blob_path(&sha256)).expect("managed fixture Blob should be removed");

    let report = fixture
        .workspace
        .scan_integrity()
        .expect("integrity scan should complete");

    assert_eq!(report.healthy_count, 0);
    assert_eq!(report.issues.len(), 1);
    assert_eq!(report.issues[0].kind, IntegrityIssueKind::Missing);
}

#[test]
fn integrity_scan_classifies_corrupted_blob() {
    let mut fixture = Fixture::new(2);
    let sha256 = fixture.import("job-corrupt", "document-corrupt");
    let mut blob = OpenOptions::new()
        .write(true)
        .open(fixture.blob_path(&sha256))
        .expect("managed fixture Blob should open");
    blob.seek(SeekFrom::Start(0)).expect("Blob should seek");
    blob.write_all(b"changed").expect("Blob should be changed");
    blob.sync_all().expect("Blob change should be durable");

    let report = fixture
        .workspace
        .scan_integrity()
        .expect("integrity scan should complete");

    assert_eq!(report.issues.len(), 1);
    assert_eq!(report.issues[0].kind, IntegrityIssueKind::Corrupted);
}

#[test]
fn complete_backup_restores_documents_at_different_absolute_path() {
    let mut fixture = Fixture::new(3);
    fixture.import("job-backup", "document-backup");
    let backup_path = fixture
        .workspace_path
        .parent()
        .expect("workspace should have a parent")
        .join("backup-dir");
    let backup = fixture
        .workspace
        .create_backup(&backup_path)
        .expect("complete backup should succeed");
    assert!(!backup.path.join("staging").exists());
    assert!(!backup.path.join(".workspace.lock").exists());
    let restored_path = fixture
        .workspace_path
        .parent()
        .expect("workspace should have a parent")
        .join("restored-different-path");

    Workspace::restore_backup(&backup.path, &restored_path)
        .expect("verified backup should restore");
    let restored = Workspace::open(&restored_path).expect("restored workspace should open");
    let mut restored_document = restored
        .open_document("document-backup")
        .expect("restored document should open");
    let mut restored_bytes = Vec::new();
    restored_document
        .read_to_end(&mut restored_bytes)
        .expect("restored document should be readable");

    assert_eq!(restored_bytes.len(), 3 * MIB);
    assert_eq!(restored_bytes[0], 17);
}

#[test]
fn corrupted_backup_blob_does_not_create_restore_target() {
    let mut fixture = Fixture::new(2);
    let sha256 = fixture.import("job-backup-corrupt", "document-backup-corrupt");
    let parent = fixture
        .workspace_path
        .parent()
        .expect("workspace should have parent");
    let backup_path = parent.join("backup-corrupt");
    fixture
        .workspace
        .create_backup(&backup_path)
        .expect("backup should succeed");
    let backup_blob = backup_path
        .join("blobs")
        .join(&sha256[0..2])
        .join(&sha256[2..4])
        .join(format!("{sha256}.blob"));
    let mut blob = OpenOptions::new()
        .write(true)
        .open(backup_blob)
        .expect("backup Blob should open");
    blob.write_all(b"damage")
        .expect("backup Blob should change");
    blob.sync_all().expect("damage should be durable");
    let restored_path = parent.join("must-not-exist");

    Workspace::restore_backup(&backup_path, &restored_path)
        .expect_err("damaged backup must be rejected");

    assert!(!restored_path.exists());
}

#[test]
fn manifest_path_traversal_is_rejected_before_restore_target_creation() {
    let mut fixture = Fixture::new(1);
    fixture.import("job-path", "document-path");
    let parent = fixture
        .workspace_path
        .parent()
        .expect("workspace should have parent");
    let backup_path = parent.join("backup-path");
    fixture
        .workspace
        .create_backup(&backup_path)
        .expect("backup should succeed");
    let manifest_path = backup_path.join("manifest.json");
    let mut manifest: Value =
        serde_json::from_reader(File::open(&manifest_path).expect("manifest fixture should open"))
            .expect("manifest fixture should parse");
    manifest["blobs"][0]["storage_key"] = Value::String("../outside.blob".to_owned());
    let mut manifest_file = File::create(&manifest_path).expect("manifest should reopen for write");
    serde_json::to_writer_pretty(&mut manifest_file, &manifest)
        .expect("modified manifest should serialize");
    manifest_file
        .sync_all()
        .expect("manifest change should be durable");
    let restore_path = parent.join("path-restore-must-not-exist");

    Workspace::restore_backup(&backup_path, &restore_path)
        .expect_err("path traversal manifest must be rejected");

    assert!(!restore_path.exists());
}

#[test]
fn source_inside_workspace_is_not_authorized() {
    let fixture = Fixture::new(1);
    let inside_path = fixture.workspace_path.join("inside.bin");
    generate_file(&inside_path, MIB, 3);

    let error = fixture
        .workspace
        .authorize_source(&inside_path)
        .expect_err("managed path must not become an external source");

    assert_eq!(error.code(), "SOURCE_INSIDE_WORKSPACE");
}

fn generate_file(path: &Path, size: usize, seed: u8) {
    let mut file = File::create(path).expect("source fixture should be created");
    let block = vec![seed; MIB].into_boxed_slice();
    let mut remaining = size;
    while remaining > 0 {
        let write_size = remaining.min(block.len());
        file.write_all(&block[..write_size])
            .expect("source fixture should be written");
        remaining -= write_size;
    }
    file.sync_all().expect("source fixture should be durable");
}
