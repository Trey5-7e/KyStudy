use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read};
use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;
use rusqlite::backup::Backup;
use sha2::{Digest, Sha256};
use tempfile::Builder;

use crate::integrity::verify_connection;
use crate::migration::LATEST_SCHEMA_VERSION;
use crate::{BackupArtifact, DatabaseError, Result};

const BACKUP_PAGES_PER_STEP: i32 = 128;
const BACKUP_PAUSE: Duration = Duration::from_millis(5);

pub(crate) fn create_online_backup(
    source: &Connection,
    destination: &Path,
) -> Result<BackupArtifact> {
    if destination.exists() {
        return Err(DatabaseError::DestinationExists);
    }

    let parent = destination
        .parent()
        .ok_or(DatabaseError::UnsupportedConfiguration {
            reason: "backup destination has no parent directory",
        })?;
    fs::create_dir_all(parent)?;
    let reservation = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|source| {
            if source.kind() == io::ErrorKind::AlreadyExists {
                DatabaseError::DestinationExists
            } else {
                DatabaseError::Io { source }
            }
        })?;
    drop(reservation);

    let backup_result = (|| {
        let mut destination_connection = Connection::open(destination)?;
        let backup = Backup::new(source, &mut destination_connection)?;
        backup.run_to_completion(BACKUP_PAGES_PER_STEP, BACKUP_PAUSE, None)?;
        drop(backup);
        drop(destination_connection);

        inspect_backup(destination)
    })();

    if backup_result.is_err() {
        remove_file_if_present(destination);
        remove_file_if_present(&sidecar_path(destination, "-wal"));
        remove_file_if_present(&sidecar_path(destination, "-shm"));
    }

    backup_result
}

pub(crate) fn restore_verified_backup(
    backup_path: &Path,
    expected_sha256: &str,
    destination: &Path,
) -> Result<BackupArtifact> {
    if destination.exists() {
        return Err(DatabaseError::DestinationExists);
    }

    if sha256_file(backup_path)? != expected_sha256 {
        return Err(DatabaseError::ChecksumMismatch);
    }

    let parent = destination
        .parent()
        .ok_or(DatabaseError::UnsupportedConfiguration {
            reason: "restore destination has no parent directory",
        })?;
    fs::create_dir_all(parent)?;

    let mut source = File::open(backup_path)?;
    let mut temporary = Builder::new()
        .prefix(".kystudy-restore-")
        .suffix(".sqlite3")
        .tempfile_in(parent)?;
    io::copy(&mut source, &mut temporary)?;
    temporary.as_file().sync_all()?;

    let temporary_path = temporary.into_temp_path();
    if sha256_file(temporary_path.as_ref())? != expected_sha256 {
        return Err(DatabaseError::ChecksumMismatch);
    }

    let restored = inspect_backup(temporary_path.as_ref())?;
    if !(1..=LATEST_SCHEMA_VERSION).contains(&restored.schema_version) {
        return Err(DatabaseError::UnsupportedSchema {
            found: restored.schema_version,
            supported: LATEST_SCHEMA_VERSION,
        });
    }

    temporary_path
        .persist_noclobber(destination)
        .map_err(|error| DatabaseError::Io {
            source: error.error,
        })?;

    Ok(BackupArtifact {
        path: destination.to_path_buf(),
        ..restored
    })
}

pub(crate) fn inspect_backup(path: &Path) -> Result<BackupArtifact> {
    let connection = Connection::open(path)?;
    let health = verify_connection(&connection)?;
    drop(connection);

    Ok(BackupArtifact {
        path: path.to_path_buf(),
        sha256: sha256_file(path)?,
        schema_version: health.schema_version,
        bytes: fs::metadata(path)?.len(),
    })
}

pub(crate) fn sha256_file(path: &Path) -> Result<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    let digest = hasher.finalize();
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        write!(&mut encoded, "{byte:02X}").map_err(|_| DatabaseError::ValueOutOfRange)?;
    }
    Ok(encoded)
}

fn sidecar_path(database: &Path, suffix: &str) -> std::path::PathBuf {
    let mut path = database.as_os_str().to_os_string();
    path.push(suffix);
    path.into()
}

fn remove_file_if_present(path: &Path) {
    if let Err(error) = fs::remove_file(path)
        && error.kind() != io::ErrorKind::NotFound
    {
        // Cleanup is best-effort here; the original operation error remains primary.
    }
}
