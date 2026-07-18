use std::fs::{self, File, OpenOptions};
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};

use fs4::FileExt;
use rusqlite::{Connection, MAIN_DB, OpenFlags};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::{Builder, TempDir};

use crate::application::{BackupError, BackupReport, BackupRepository, RestoreReport};
use crate::domain::LATEST_SCHEMA_VERSION;

use super::sqlite_blob_store::{blob_path, validate_storage_key};
use super::sqlite_workspace::{
    DATABASE_FILE_NAME, SqliteWorkspaceRepository, database_error, migrate, open_database,
    verify_database_snapshot, verify_database_snapshot_at_version,
};

const BACKUP_FORMAT_VERSION: u32 = 1;
const MINIMUM_BACKUP_SCHEMA_VERSION: u32 = 2;
const FREE_SPACE_RESERVE_BYTES: u64 = 64 * 1024 * 1024;
const MANIFEST_FILE_NAME: &str = "manifest.json";
const MAXIMUM_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
const STREAM_BUFFER_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BackupManifest {
    format_version: u32,
    schema_version: u32,
    producer: String,
    created_at: i64,
    workspace_id: String,
    database: ManifestFile,
    blobs: Vec<ManifestBlob>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestFile {
    relative_path: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ManifestBlob {
    sha256: String,
    size_bytes: u64,
    storage_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BlobRecord {
    sha256: String,
    size_bytes: u64,
    storage_key: String,
}

/// Complete backup adapter for the single default `SQLite` workspace.
#[derive(Debug, Clone)]
pub(crate) struct SqliteBackupStore {
    workspace_directory: PathBuf,
    database_path: PathBuf,
}

impl SqliteBackupStore {
    /// Creates a backup adapter rooted below the application-owned data directory.
    pub(crate) fn new(application_data_directory: &Path) -> Self {
        let workspace = SqliteWorkspaceRepository::new(application_data_directory);
        Self {
            workspace_directory: workspace.workspace_directory(),
            database_path: workspace.database_path(),
        }
    }
}

impl BackupRepository for SqliteBackupStore {
    fn create_backup(
        &self,
        destination: &Path,
        created_at: i64,
    ) -> Result<BackupReport, BackupError> {
        if !self.database_path.is_file() {
            return Err(BackupError::WorkspaceNotInitialized);
        }
        let parent = validate_new_destination(destination, &self.workspace_directory, None)?;
        let temporary = Builder::new()
            .prefix(".kystudy-backup-")
            .tempdir_in(&parent)?;

        let mut live_connection = open_database(&self.database_path, false)?;
        migrate(&mut live_connection)?;
        let database_destination = temporary.path().join(DATABASE_FILE_NAME);
        live_connection
            .backup(MAIN_DB, &database_destination, None)
            .map_err(database_error)?;
        let snapshot = open_snapshot(&database_destination)?;
        verify_database_snapshot(&snapshot)?;
        let workspace_id = load_workspace_id(&snapshot)?;
        let records = load_blob_records(&snapshot)?;
        drop(snapshot);

        let (database_sha256, database_size) = hash_file(&database_destination)?;
        ensure_space(&parent, required_backup_bytes(database_size, &records)?)?;
        let mut manifest_blobs = Vec::with_capacity(records.len());
        for record in records {
            validate_blob_record(&record)?;
            let source = managed_blob_path(&self.workspace_directory, &record.sha256)?;
            let target = managed_blob_path(temporary.path(), &record.sha256)?;
            fs::create_dir_all(target.parent().ok_or(BackupError::InvalidManagedPath)?)?;
            copy_file_verified(&source, &target, &record.sha256, record.size_bytes)?;
            manifest_blobs.push(ManifestBlob {
                sha256: record.sha256,
                size_bytes: record.size_bytes,
                storage_key: record.storage_key,
            });
        }

        let manifest = BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            schema_version: LATEST_SCHEMA_VERSION,
            producer: format!("KyStudy {}", env!("CARGO_PKG_VERSION")),
            created_at,
            workspace_id,
            database: ManifestFile {
                relative_path: DATABASE_FILE_NAME.to_owned(),
                sha256: database_sha256,
                size_bytes: database_size,
            },
            blobs: manifest_blobs,
        };
        write_manifest(temporary.path(), &manifest)?;
        verify_backup_directory(temporary.path(), &manifest)?;
        let total_bytes = total_backup_bytes(temporary.path(), &manifest)?;
        let blob_count =
            u64::try_from(manifest.blobs.len()).map_err(|_| BackupError::InvalidManifest)?;
        let directory_name = directory_name(destination)?;
        commit_directory(temporary, destination)?;

        Ok(BackupReport {
            directory_name,
            blob_count,
            total_bytes,
            created_at,
        })
    }

    fn restore_backup(
        &self,
        backup_directory: &Path,
        destination: &Path,
    ) -> Result<RestoreReport, BackupError> {
        let backup_directory = authorize_directory(backup_directory)?;
        let parent = validate_new_destination(
            destination,
            &self.workspace_directory,
            Some(&backup_directory),
        )?;
        let manifest = read_manifest(&backup_directory)?;
        verify_backup_directory(&backup_directory, &manifest)?;
        ensure_space(&parent, manifest_required_bytes(&manifest)?)?;
        let temporary = Builder::new()
            .prefix(".kystudy-restore-")
            .tempdir_in(&parent)?;

        let restored_database = temporary.path().join(DATABASE_FILE_NAME);
        copy_file_verified(
            &backup_directory.join(DATABASE_FILE_NAME),
            &restored_database,
            &manifest.database.sha256,
            manifest.database.size_bytes,
        )?;
        for blob in &manifest.blobs {
            validate_manifest_blob(blob)?;
            let source = managed_blob_path(&backup_directory, &blob.sha256)?;
            let target = managed_blob_path(temporary.path(), &blob.sha256)?;
            fs::create_dir_all(target.parent().ok_or(BackupError::InvalidManagedPath)?)?;
            copy_file_verified(&source, &target, &blob.sha256, blob.size_bytes)?;
        }

        let mut restored_connection = open_database(&restored_database, false)?;
        migrate(&mut restored_connection)?;
        verify_database_snapshot(&restored_connection)?;
        drop(restored_connection);
        let (database_sha256, database_size) = hash_file(&restored_database)?;
        let mut restored_manifest = manifest;
        restored_manifest.schema_version = LATEST_SCHEMA_VERSION;
        restored_manifest.database.sha256 = database_sha256;
        restored_manifest.database.size_bytes = database_size;
        write_manifest(temporary.path(), &restored_manifest)?;
        verify_backup_directory(temporary.path(), &restored_manifest)?;

        let blob_count = u64::try_from(restored_manifest.blobs.len())
            .map_err(|_| BackupError::InvalidManifest)?;
        let total_bytes = total_backup_bytes(temporary.path(), &restored_manifest)?;
        let directory_name = directory_name(destination)?;
        commit_directory(temporary, destination)?;

        Ok(RestoreReport {
            directory_name,
            blob_count,
            total_bytes,
        })
    }
}

fn authorize_directory(path: &Path) -> Result<PathBuf, BackupError> {
    let canonical = fs::canonicalize(path)?;
    if canonical.is_dir() {
        Ok(canonical)
    } else {
        Err(BackupError::SourceNotDirectory)
    }
}

fn validate_new_destination(
    destination: &Path,
    workspace_directory: &Path,
    forbidden_source: Option<&Path>,
) -> Result<PathBuf, BackupError> {
    if destination.exists() {
        return Err(BackupError::DestinationExists);
    }
    let parent = destination
        .parent()
        .ok_or(BackupError::InvalidManagedPath)?;
    let parent = authorize_directory(parent)?;
    if workspace_directory.exists() {
        let workspace = fs::canonicalize(workspace_directory)?;
        if parent.starts_with(workspace) {
            return Err(BackupError::DestinationInsideWorkspace);
        }
    }
    if forbidden_source.is_some_and(|source| parent.starts_with(source)) {
        return Err(BackupError::InvalidManagedPath);
    }
    Ok(parent)
}

fn open_snapshot(path: &Path) -> Result<Connection, BackupError> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(database_error)
    .map_err(BackupError::from)?;
    connection
        .pragma_update(None, "trusted_schema", false)
        .map_err(database_error)?;
    Ok(connection)
}

fn load_workspace_id(connection: &Connection) -> Result<String, BackupError> {
    connection
        .query_row(
            "SELECT id FROM workspace WHERE singleton_key = 1",
            [],
            |row| row.get(0),
        )
        .map_err(database_error)
        .map_err(BackupError::from)
}

fn load_blob_records(connection: &Connection) -> Result<Vec<BlobRecord>, BackupError> {
    let mut statement = connection
        .prepare(
            "SELECT sha256, size_bytes, storage_key
             FROM blob ORDER BY sha256",
        )
        .map_err(database_error)?;
    let rows = statement
        .query_map([], |row| {
            let size = row.get::<_, i64>(1)?;
            Ok((row.get::<_, String>(0)?, size, row.get::<_, String>(2)?))
        })
        .map_err(database_error)?;
    rows.map(|row| {
        let (sha256, size, storage_key) = row.map_err(database_error)?;
        Ok(BlobRecord {
            sha256,
            size_bytes: u64::try_from(size).map_err(|_| BackupError::InvalidManifest)?,
            storage_key,
        })
    })
    .collect()
}

fn validate_blob_record(record: &BlobRecord) -> Result<(), BackupError> {
    validate_storage_key(&record.sha256, &record.storage_key)
        .map_err(|_| BackupError::InvalidManagedPath)
}

fn validate_manifest_blob(blob: &ManifestBlob) -> Result<(), BackupError> {
    validate_storage_key(&blob.sha256, &blob.storage_key)
        .map_err(|_| BackupError::InvalidManagedPath)
}

fn managed_blob_path(root: &Path, sha256: &str) -> Result<PathBuf, BackupError> {
    blob_path(root, sha256).map_err(|_| BackupError::InvalidManagedPath)
}

fn write_manifest(directory: &Path, manifest: &BackupManifest) -> Result<(), BackupError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join(MANIFEST_FILE_NAME))?;
    serde_json::to_writer_pretty(&mut file, manifest)?;
    file.sync_all()?;
    Ok(())
}

fn read_manifest(directory: &Path) -> Result<BackupManifest, BackupError> {
    let path = directory.join(MANIFEST_FILE_NAME);
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() || metadata.len() > MAXIMUM_MANIFEST_BYTES {
        return Err(BackupError::InvalidManifest);
    }
    let file = File::open(path)?;
    serde_json::from_reader(BufReader::new(file)).map_err(BackupError::from)
}

fn verify_backup_directory(directory: &Path, manifest: &BackupManifest) -> Result<(), BackupError> {
    if manifest.format_version != BACKUP_FORMAT_VERSION
        || manifest.schema_version < MINIMUM_BACKUP_SCHEMA_VERSION
        || manifest.schema_version > LATEST_SCHEMA_VERSION
        || manifest.producer.is_empty()
        || manifest.created_at < 0
        || manifest.database.relative_path != DATABASE_FILE_NAME
    {
        return Err(BackupError::UnsupportedBackup);
    }
    verify_file(
        &directory.join(DATABASE_FILE_NAME),
        &manifest.database.sha256,
        manifest.database.size_bytes,
    )?;
    let connection = open_snapshot(&directory.join(DATABASE_FILE_NAME))?;
    verify_database_snapshot_at_version(&connection, manifest.schema_version)?;
    let workspace_id = load_workspace_id(&connection)?;
    let records = load_blob_records(&connection)?;
    drop(connection);
    if workspace_id != manifest.workspace_id || records.len() != manifest.blobs.len() {
        return Err(BackupError::InvalidManifest);
    }

    for (record, blob) in records.iter().zip(&manifest.blobs) {
        validate_blob_record(record)?;
        validate_manifest_blob(blob)?;
        if record.sha256 != blob.sha256
            || record.size_bytes != blob.size_bytes
            || record.storage_key != blob.storage_key
        {
            return Err(BackupError::InvalidManifest);
        }
        verify_file(
            &managed_blob_path(directory, &blob.sha256)?,
            &blob.sha256,
            blob.size_bytes,
        )?;
    }
    Ok(())
}

fn copy_file_verified(
    source: &Path,
    destination: &Path,
    expected_sha256: &str,
    expected_size: u64,
) -> Result<(), BackupError> {
    ensure_regular_file(source, expected_size)?;
    let mut source_file = File::open(source)?;
    let mut target = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    target.allocate(expected_size)?;
    let (actual_sha256, actual_size) = copy_and_hash(&mut source_file, &mut target)?;
    if actual_sha256 != expected_sha256 || actual_size != expected_size {
        return Err(BackupError::IntegrityMismatch);
    }
    target.set_len(actual_size)?;
    target.sync_all()?;
    Ok(())
}

fn verify_file(path: &Path, expected_sha256: &str, expected_size: u64) -> Result<(), BackupError> {
    ensure_regular_file(path, expected_size)?;
    let (actual_sha256, actual_size) = hash_file(path)?;
    if actual_sha256 == expected_sha256 && actual_size == expected_size {
        Ok(())
    } else {
        Err(BackupError::IntegrityMismatch)
    }
}

fn ensure_regular_file(path: &Path, expected_size: u64) -> Result<(), BackupError> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_file() && metadata.len() == expected_size {
        Ok(())
    } else {
        Err(BackupError::IntegrityMismatch)
    }
}

fn hash_file(path: &Path) -> Result<(String, u64), BackupError> {
    let mut file = File::open(path)?;
    copy_and_hash(&mut file, &mut std::io::sink())
}

fn copy_and_hash(
    reader: &mut impl Read,
    writer: &mut impl Write,
) -> Result<(String, u64), BackupError> {
    let mut buffer = vec![0_u8; STREAM_BUFFER_BYTES].into_boxed_slice();
    let mut hasher = Sha256::new();
    let mut copied = 0_u64;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        writer.write_all(&buffer[..read])?;
        hasher.update(&buffer[..read]);
        copied = copied
            .checked_add(u64::try_from(read).map_err(|_| BackupError::IntegrityMismatch)?)
            .ok_or(BackupError::IntegrityMismatch)?;
    }
    Ok((format!("{:X}", hasher.finalize()), copied))
}

fn required_backup_bytes(database_size: u64, records: &[BlobRecord]) -> Result<u64, BackupError> {
    records.iter().try_fold(database_size, |total, record| {
        total
            .checked_add(record.size_bytes)
            .ok_or(BackupError::InsufficientSpace)
    })
}

fn manifest_required_bytes(manifest: &BackupManifest) -> Result<u64, BackupError> {
    manifest
        .blobs
        .iter()
        .try_fold(manifest.database.size_bytes, |total, blob| {
            total
                .checked_add(blob.size_bytes)
                .ok_or(BackupError::InsufficientSpace)
        })
}

fn ensure_space(parent: &Path, content_bytes: u64) -> Result<(), BackupError> {
    let required = content_bytes
        .checked_add(FREE_SPACE_RESERVE_BYTES)
        .ok_or(BackupError::InsufficientSpace)?;
    if fs4::available_space(parent)? >= required {
        Ok(())
    } else {
        Err(BackupError::InsufficientSpace)
    }
}

fn total_backup_bytes(directory: &Path, manifest: &BackupManifest) -> Result<u64, BackupError> {
    let manifest_size = fs::metadata(directory.join(MANIFEST_FILE_NAME))?.len();
    manifest.blobs.iter().try_fold(
        manifest.database.size_bytes.saturating_add(manifest_size),
        |total, blob| {
            total
                .checked_add(blob.size_bytes)
                .ok_or(BackupError::InvalidManifest)
        },
    )
}

fn directory_name(path: &Path) -> Result<String, BackupError> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .ok_or(BackupError::InvalidManagedPath)
}

fn commit_directory(temporary: TempDir, destination: &Path) -> Result<(), BackupError> {
    let temporary_path = temporary.keep();
    if let Err(source) = fs::rename(&temporary_path, destination) {
        let _cleanup_result = fs::remove_dir_all(&temporary_path);
        if destination.exists() {
            return Err(BackupError::DestinationExists);
        }
        return Err(BackupError::File { source });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::AtomicBool;

    use rusqlite::Connection;
    use tempfile::{TempDir, tempdir};
    use uuid::Uuid;

    use super::{
        BackupManifest, MANIFEST_FILE_NAME, SqliteBackupStore, hash_file, managed_blob_path,
        read_manifest,
    };
    use crate::application::{
        BackupRepository, ImportRequest, ResourceRepository, WorkspaceRepository,
    };
    use crate::domain::NewWorkspace;
    use crate::infrastructure::{SqliteBlobStore, SqliteWorkspaceRepository};

    struct Fixture {
        _application_data: TempDir,
        workspace: SqliteWorkspaceRepository,
        backup: SqliteBackupStore,
        document_sha256: String,
    }

    fn initialized_fixture() -> Fixture {
        let application_data = tempdir().expect("temporary application data should exist");
        let workspace = SqliteWorkspaceRepository::new(application_data.path());
        workspace
            .initialize_default(&NewWorkspace::default_at(1_700_000_000_000))
            .expect("workspace should initialize");
        let source = application_data.path().join("source.pdf");
        fs::write(&source, b"backup-fixture-content").expect("source fixture should be written");
        let blob_store = SqliteBlobStore::new(application_data.path());
        let request = ImportRequest {
            job_id: Uuid::now_v7().to_string(),
            document_id: Uuid::now_v7().to_string(),
            title: "backup fixture".to_owned(),
            kind: "pdf".to_owned(),
            mime_type: "application/pdf".to_owned(),
            created_at: 1_700_000_000_001,
        };
        let document = blob_store
            .import_file(&source, &request, &AtomicBool::new(false), &mut |_| {})
            .expect("source should import");

        Fixture {
            backup: SqliteBackupStore::new(application_data.path()),
            _application_data: application_data,
            workspace,
            document_sha256: document.sha256,
        }
    }

    fn create_backup(fixture: &Fixture, output: &TempDir) -> std::path::PathBuf {
        let destination = output.path().join("backup");
        fixture
            .backup
            .create_backup(&destination, 1_700_000_000_002)
            .expect("backup should complete");
        destination
    }

    #[test]
    fn complete_backup_restores_database_and_blob_to_a_different_root() {
        let fixture = initialized_fixture();
        let output = tempdir().expect("output directory should exist");
        let backup = create_backup(&fixture, &output);
        let restored_application_data = output.path().join("restored-app-data");
        let restored_workspaces = restored_application_data.join("workspaces");
        fs::create_dir_all(&restored_workspaces).expect("restored workspaces parent should exist");
        let destination = restored_workspaces.join("default");

        let report = fixture
            .backup
            .restore_backup(&backup, &destination)
            .expect("backup should restore");
        let restored_blob = managed_blob_path(&destination, &fixture.document_sha256)
            .expect("restored Blob path should derive");
        let restored_resources = SqliteBlobStore::new(&restored_application_data)
            .list_resources()
            .expect("restored workspace should open through the formal adapter");

        assert_eq!(report.blob_count, 1);
        assert_eq!(restored_resources.len(), 1);
        assert_eq!(
            fs::read(restored_blob).expect("restored Blob should be readable"),
            b"backup-fixture-content"
        );
        assert!(destination.join(MANIFEST_FILE_NAME).is_file());
    }

    #[test]
    fn backup_excludes_staging_and_unmanaged_workspace_files() {
        let fixture = initialized_fixture();
        let staging = fixture.workspace.workspace_directory().join("staging");
        fs::create_dir_all(&staging).expect("staging should exist");
        fs::write(staging.join("partial.part"), b"partial")
            .expect("staging fixture should be written");
        fs::write(
            fixture.workspace.workspace_directory().join("private.key"),
            b"secret",
        )
        .expect("excluded fixture should be written");
        let output = tempdir().expect("output directory should exist");

        let backup = create_backup(&fixture, &output);

        assert!(!backup.join("staging").exists());
        assert!(!backup.join("private.key").exists());
    }

    #[test]
    fn restore_rejects_a_corrupted_blob_without_creating_destination() {
        let fixture = initialized_fixture();
        let output = tempdir().expect("output directory should exist");
        let backup = create_backup(&fixture, &output);
        let backup_blob = managed_blob_path(&backup, &fixture.document_sha256)
            .expect("backup Blob path should derive");
        fs::write(backup_blob, b"corrupted").expect("backup Blob should be corrupted");
        let destination = output.path().join("must-not-exist");

        let error = fixture
            .backup
            .restore_backup(&backup, &destination)
            .expect_err("corrupted backup must be rejected");

        assert_eq!(error.code(), "FILE_INTEGRITY_MISMATCH");
        assert!(!destination.exists());
    }

    #[test]
    fn restore_rejects_manifest_path_traversal_before_creating_destination() {
        let fixture = initialized_fixture();
        let output = tempdir().expect("output directory should exist");
        let backup = create_backup(&fixture, &output);
        let mut manifest: BackupManifest = read_manifest(&backup).expect("manifest should load");
        manifest.blobs[0].storage_key = "../outside.blob".to_owned();
        fs::write(
            backup.join(MANIFEST_FILE_NAME),
            serde_json::to_vec_pretty(&manifest).expect("manifest should serialize"),
        )
        .expect("manifest fixture should update");
        let destination = output.path().join("must-not-exist");

        let error = fixture
            .backup
            .restore_backup(&backup, &destination)
            .expect_err("path traversal must be rejected");

        assert_eq!(error.code(), "MANAGED_PATH_INVALID");
        assert!(!destination.exists());
    }

    #[test]
    fn backup_never_overwrites_an_existing_destination() {
        let fixture = initialized_fixture();
        let output = tempdir().expect("output directory should exist");
        let destination = output.path().join("existing");
        fs::create_dir(&destination).expect("existing destination should be created");
        fs::write(destination.join("marker.txt"), b"keep").expect("marker should be written");

        let error = fixture
            .backup
            .create_backup(&destination, 1_700_000_000_002)
            .expect_err("existing destination must be rejected");

        assert_eq!(error.code(), "DESTINATION_EXISTS");
        assert_eq!(
            fs::read(destination.join("marker.txt")).expect("marker should remain"),
            b"keep"
        );
    }

    #[test]
    fn restore_works_without_an_existing_local_workspace() {
        let fixture = initialized_fixture();
        let output = tempdir().expect("output directory should exist");
        let backup = create_backup(&fixture, &output);
        let empty_application_data = tempdir().expect("empty application data should exist");
        let restore_store = SqliteBackupStore::new(empty_application_data.path());
        let destination = output.path().join("restored-without-current-workspace");

        let report = restore_store
            .restore_backup(&backup, &destination)
            .expect("portable backup should restore independently");

        assert_eq!(report.blob_count, 1);
        assert!(destination.join("kystudy.sqlite3").is_file());
    }

    #[test]
    fn restore_migrates_a_verified_v2_backup_copy_to_the_latest_schema() {
        let fixture = initialized_fixture();
        let output = tempdir().expect("output directory should exist");
        let backup = create_backup(&fixture, &output);
        let database_path = backup.join("kystudy.sqlite3");
        let connection = Connection::open(&database_path).expect("backup database should open");
        connection
            .execute_batch(
                "DROP TABLE task_change;
                 DROP TABLE task;
                 DROP TABLE subject;
                 DELETE FROM schema_migration WHERE version = 3;
                 PRAGMA user_version = 2;",
            )
            .expect("fixture should represent a v2 backup");
        drop(connection);
        let (sha256, size_bytes) = hash_file(&database_path).expect("database should hash");
        let mut manifest = read_manifest(&backup).expect("manifest should load");
        manifest.schema_version = 2;
        manifest.database.sha256 = sha256;
        manifest.database.size_bytes = size_bytes;
        fs::write(
            backup.join(MANIFEST_FILE_NAME),
            serde_json::to_vec_pretty(&manifest).expect("manifest should serialize"),
        )
        .expect("historical manifest should update");
        let destination = output.path().join("restored-v2");

        fixture
            .backup
            .restore_backup(&backup, &destination)
            .expect("known v2 backup should restore");
        let restored = Connection::open(destination.join("kystudy.sqlite3"))
            .expect("restored database should open");
        let version: u32 = restored
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("restored schema should be readable");
        let restored_manifest =
            read_manifest(&destination).expect("restored manifest should be readable");

        assert_eq!(version, 3);
        assert_eq!(restored_manifest.schema_version, 3);
    }

    #[test]
    fn backup_rejects_a_missing_formal_blob_without_creating_destination() {
        let fixture = initialized_fixture();
        let blob = managed_blob_path(
            &fixture.workspace.workspace_directory(),
            &fixture.document_sha256,
        )
        .expect("managed Blob path should derive");
        fs::remove_file(blob).expect("formal Blob fixture should be removed");
        let output = tempdir().expect("output directory should exist");
        let destination = output.path().join("must-not-exist");

        let error = fixture
            .backup
            .create_backup(&destination, 1_700_000_000_002)
            .expect_err("missing formal Blob must block backup");

        assert_eq!(error.code(), "FILE_OPERATION_FAILED");
        assert!(!destination.exists());
    }
}
