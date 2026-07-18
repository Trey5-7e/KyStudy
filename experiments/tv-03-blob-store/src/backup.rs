use std::fs::{self, File, OpenOptions};
use std::io::BufReader;
use std::path::{Path, PathBuf};

use rusqlite::{Connection, MAIN_DB};
use serde::{Deserialize, Serialize};
use tempfile::Builder;

use crate::db::{SCHEMA_VERSION, all_blobs, verify_database};
use crate::hash::{copy_file_verified, hash_file};
use crate::pathing::{DATABASE_FILE_NAME, MANIFEST_FILE_NAME, blob_path, validate_storage_key};
use crate::{BackupReport, RestoreReport, Result, StoreError, Workspace};

const BACKUP_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct BackupManifest {
    format_version: u32,
    schema_version: i64,
    producer: String,
    database: ManifestFile,
    blobs: Vec<ManifestBlob>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ManifestFile {
    relative_path: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct ManifestBlob {
    sha256: String,
    size_bytes: u64,
    storage_key: String,
}

impl Workspace {
    /// Creates a complete, versioned backup directory and never overwrites the destination.
    ///
    /// The operation verifies all formal Blobs before copying, uses `SQLite` Online Backup for the
    /// database, writes a SHA-256 Manifest, verifies the temporary backup, and only then renames
    /// the temporary directory to the requested destination on the same filesystem.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError`] if integrity checks, copying, serialization, verification, or the
    /// no-overwrite destination commit fails.
    pub fn create_backup(&self, destination: &Path) -> Result<BackupReport> {
        if destination.exists() {
            return Err(StoreError::DestinationExists);
        }
        let integrity = self.scan_integrity()?;
        if !integrity.issues.is_empty() {
            return Err(StoreError::IntegrityMismatch);
        }
        let parent = destination.parent().ok_or(StoreError::InvalidManagedPath)?;
        fs::create_dir_all(parent)?;
        let temporary = Builder::new()
            .prefix(".kystudy-backup-")
            .tempdir_in(parent)?;

        let database_destination = temporary.path().join(DATABASE_FILE_NAME);
        self.connection
            .backup(MAIN_DB, &database_destination, None)?;
        let (database_sha256, database_size) = hash_file(&database_destination)?;
        let blob_records = all_blobs(&self.connection)?;
        let mut manifest_blobs = Vec::with_capacity(blob_records.len());
        for record in blob_records {
            validate_storage_key(&record.sha256, &record.storage_key)?;
            let source = blob_path(&self.root, &record.sha256)?;
            let target = manifest_blob_path(temporary.path(), &record)?;
            let target_parent = target.parent().ok_or(StoreError::InvalidManagedPath)?;
            fs::create_dir_all(target_parent)?;
            copy_file_verified(&source, &target, &record.sha256, record.size_bytes)?;
            manifest_blobs.push(ManifestBlob {
                sha256: record.sha256,
                size_bytes: record.size_bytes,
                storage_key: record.storage_key,
            });
        }

        let manifest = BackupManifest {
            format_version: BACKUP_FORMAT_VERSION,
            schema_version: SCHEMA_VERSION,
            producer: "KyStudy TV-03".to_owned(),
            database: ManifestFile {
                relative_path: DATABASE_FILE_NAME.to_owned(),
                sha256: database_sha256,
                size_bytes: database_size,
            },
            blobs: manifest_blobs,
        };
        write_manifest(temporary.path(), &manifest)?;
        verify_backup_directory(temporary.path(), &manifest)?;
        let total_bytes = backup_total_bytes(temporary.path(), &manifest)?;
        let blob_count =
            u64::try_from(manifest.blobs.len()).map_err(|_| StoreError::ValueOutOfRange)?;

        let temporary_path = temporary.keep();
        if let Err(source) = fs::rename(&temporary_path, destination) {
            let _cleanup_result = fs::remove_dir_all(&temporary_path);
            if destination.exists() {
                return Err(StoreError::DestinationExists);
            }
            return Err(StoreError::Io { source });
        }

        Ok(BackupReport {
            path: destination.to_path_buf(),
            blob_count,
            total_bytes,
        })
    }

    /// Restores a complete backup into a temporary sibling directory and then switches it into a
    /// new workspace path.
    ///
    /// # Errors
    ///
    /// Returns [`StoreError`] if the Manifest, schema, database, any Blob, managed relative path,
    /// or destination safety check fails. A failed restore does not create the final destination.
    pub fn restore_backup(backup_directory: &Path, destination: &Path) -> Result<RestoreReport> {
        if destination.exists() {
            return Err(StoreError::DestinationExists);
        }
        let manifest = read_manifest(backup_directory)?;
        verify_backup_directory(backup_directory, &manifest)?;
        let parent = destination.parent().ok_or(StoreError::InvalidManagedPath)?;
        fs::create_dir_all(parent)?;
        let temporary = Builder::new()
            .prefix(".kystudy-restore-")
            .tempdir_in(parent)?;

        copy_file_verified(
            &backup_directory.join(DATABASE_FILE_NAME),
            &temporary.path().join(DATABASE_FILE_NAME),
            &manifest.database.sha256,
            manifest.database.size_bytes,
        )?;
        for blob in &manifest.blobs {
            validate_storage_key(&blob.sha256, &blob.storage_key)?;
            let source = blob_path(backup_directory, &blob.sha256)?;
            let target = blob_path(temporary.path(), &blob.sha256)?;
            fs::create_dir_all(target.parent().ok_or(StoreError::InvalidManagedPath)?)?;
            copy_file_verified(&source, &target, &blob.sha256, blob.size_bytes)?;
        }
        verify_restored_database(temporary.path(), &manifest)?;
        let blob_count =
            u64::try_from(manifest.blobs.len()).map_err(|_| StoreError::ValueOutOfRange)?;

        let temporary_path = temporary.keep();
        if let Err(source) = fs::rename(&temporary_path, destination) {
            let _cleanup_result = fs::remove_dir_all(&temporary_path);
            if destination.exists() {
                return Err(StoreError::DestinationExists);
            }
            return Err(StoreError::Io { source });
        }

        Ok(RestoreReport {
            path: destination.to_path_buf(),
            blob_count,
        })
    }
}

fn write_manifest(directory: &Path, manifest: &BackupManifest) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join(MANIFEST_FILE_NAME))?;
    serde_json::to_writer_pretty(&mut file, manifest)?;
    file.sync_all()?;
    Ok(())
}

fn read_manifest(directory: &Path) -> Result<BackupManifest> {
    let file = File::open(directory.join(MANIFEST_FILE_NAME))?;
    Ok(serde_json::from_reader(BufReader::new(file))?)
}

fn verify_backup_directory(directory: &Path, manifest: &BackupManifest) -> Result<()> {
    if manifest.format_version != BACKUP_FORMAT_VERSION
        || manifest.schema_version != SCHEMA_VERSION
        || manifest.database.relative_path != DATABASE_FILE_NAME
    {
        return Err(StoreError::UnsupportedBackup);
    }
    verify_file_entry(directory, &manifest.database)?;

    let backup_connection = Connection::open(directory.join(DATABASE_FILE_NAME))?;
    verify_database(&backup_connection)?;
    let records = all_blobs(&backup_connection)?;
    drop(backup_connection);
    if records.len() != manifest.blobs.len() {
        return Err(StoreError::InvalidManifest);
    }

    for (record, blob) in records.iter().zip(&manifest.blobs) {
        if record.sha256 != blob.sha256
            || record.size_bytes != blob.size_bytes
            || record.storage_key != blob.storage_key
        {
            return Err(StoreError::InvalidManifest);
        }
        validate_storage_key(&blob.sha256, &blob.storage_key)?;
        let path = blob_path(directory, &blob.sha256)?;
        let (actual_sha256, actual_size) = hash_file(&path)?;
        if actual_sha256 != blob.sha256 || actual_size != blob.size_bytes {
            return Err(StoreError::IntegrityMismatch);
        }
    }
    Ok(())
}

fn verify_restored_database(directory: &Path, manifest: &BackupManifest) -> Result<()> {
    let connection = Connection::open(directory.join(DATABASE_FILE_NAME))?;
    verify_database(&connection)?;
    let records = all_blobs(&connection)?;
    drop(connection);
    if records.len() != manifest.blobs.len() {
        return Err(StoreError::InvalidManifest);
    }
    for record in records {
        let path = blob_path(directory, &record.sha256)?;
        let (actual_sha256, actual_size) = hash_file(&path)?;
        if actual_sha256 != record.sha256 || actual_size != record.size_bytes {
            return Err(StoreError::IntegrityMismatch);
        }
    }
    Ok(())
}

fn verify_file_entry(directory: &Path, entry: &ManifestFile) -> Result<()> {
    if entry.relative_path != DATABASE_FILE_NAME {
        return Err(StoreError::InvalidManagedPath);
    }
    let (actual_sha256, actual_size) = hash_file(&directory.join(DATABASE_FILE_NAME))?;
    if actual_sha256 != entry.sha256 || actual_size != entry.size_bytes {
        return Err(StoreError::IntegrityMismatch);
    }
    Ok(())
}

fn manifest_blob_path(root: &Path, record: &crate::db::BlobRecord) -> Result<PathBuf> {
    validate_storage_key(&record.sha256, &record.storage_key)?;
    blob_path(root, &record.sha256)
}

fn backup_total_bytes(directory: &Path, manifest: &BackupManifest) -> Result<u64> {
    let manifest_size = fs::metadata(directory.join(MANIFEST_FILE_NAME))?.len();
    manifest.blobs.iter().try_fold(
        manifest.database.size_bytes.saturating_add(manifest_size),
        |total, blob| {
            total
                .checked_add(blob.size_bytes)
                .ok_or(StoreError::ValueOutOfRange)
        },
    )
}
