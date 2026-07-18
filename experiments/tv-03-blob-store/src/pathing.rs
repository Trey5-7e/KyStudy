use std::path::{Path, PathBuf};

use crate::{Result, StoreError};

pub(crate) const DATABASE_FILE_NAME: &str = "kystudy.sqlite3";
pub(crate) const MANIFEST_FILE_NAME: &str = "manifest.json";

pub(crate) fn storage_key(sha256: &str) -> Result<String> {
    validate_sha256(sha256)?;
    Ok(format!(
        "blobs/{}/{}/{}.blob",
        &sha256[0..2],
        &sha256[2..4],
        sha256
    ))
}

pub(crate) fn blob_path(root: &Path, sha256: &str) -> Result<PathBuf> {
    validate_sha256(sha256)?;
    Ok(root
        .join("blobs")
        .join(&sha256[0..2])
        .join(&sha256[2..4])
        .join(format!("{sha256}.blob")))
}

pub(crate) fn staging_key(file_name: &str) -> Result<String> {
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name == "."
        || file_name == ".."
    {
        return Err(StoreError::InvalidManagedPath);
    }
    Ok(format!("staging/{file_name}"))
}

pub(crate) fn staging_path(root: &Path, key: &str) -> Result<PathBuf> {
    let Some(file_name) = key.strip_prefix("staging/") else {
        return Err(StoreError::InvalidManagedPath);
    };
    if staging_key(file_name)? != key {
        return Err(StoreError::InvalidManagedPath);
    }
    Ok(root.join("staging").join(file_name))
}

pub(crate) fn validate_storage_key(sha256: &str, key: &str) -> Result<()> {
    if storage_key(sha256)? != key {
        return Err(StoreError::InvalidManagedPath);
    }
    Ok(())
}

pub(crate) fn validate_sha256(sha256: &str) -> Result<()> {
    let valid = sha256.len() == 64
        && sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte));
    if valid {
        Ok(())
    } else {
        Err(StoreError::InvalidManagedPath)
    }
}

#[cfg(test)]
mod tests {
    use super::{storage_key, validate_storage_key};

    #[test]
    fn validate_storage_key_rejects_path_traversal() {
        let sha256 = "A".repeat(64);

        let error = validate_storage_key(&sha256, "../outside.blob")
            .expect_err("path traversal must be rejected");

        assert_eq!(error.code(), "MANAGED_PATH_INVALID");
    }

    #[test]
    fn storage_key_is_deterministic_and_relative() {
        let sha256 = "ABCD".repeat(16);

        let key = storage_key(&sha256).expect("valid digest should produce a key");

        assert_eq!(key, format!("blobs/AB/CD/{sha256}.blob"));
    }
}
