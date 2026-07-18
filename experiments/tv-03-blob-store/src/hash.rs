use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::{Result, StoreError};

/// Fixed heap buffer used by imports, backup copies, restores, and integrity scans.
pub const STREAM_BUFFER_BYTES: usize = 1024 * 1024;

pub(crate) fn stream_copy_and_hash(
    reader: &mut impl Read,
    writer: &mut impl Write,
    expected_size: u64,
    mut on_chunk: impl FnMut(u64) -> Result<()>,
) -> Result<(String, u64)> {
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
            .checked_add(u64::try_from(read).map_err(|_| StoreError::ValueOutOfRange)?)
            .ok_or(StoreError::ValueOutOfRange)?;
        on_chunk(copied)?;
    }

    if copied != expected_size {
        return Err(StoreError::SourceChanged);
    }

    Ok((encode_digest(hasher.finalize().as_slice()), copied))
}

pub(crate) fn hash_file(path: &Path) -> Result<(String, u64)> {
    let expected_size = std::fs::metadata(path)?.len();
    let mut file = File::open(path)?;
    let mut sink = std::io::sink();
    stream_copy_and_hash(&mut file, &mut sink, expected_size, |_| Ok(()))
}

pub(crate) fn copy_file_verified(
    source: &Path,
    destination: &Path,
    expected_sha256: &str,
    expected_size: u64,
) -> Result<()> {
    let mut source_file = File::open(source)?;
    let mut destination_file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let (actual_sha256, actual_size) = stream_copy_and_hash(
        &mut source_file,
        &mut destination_file,
        expected_size,
        |_| Ok(()),
    )?;
    destination_file.sync_all()?;

    if actual_sha256 != expected_sha256 || actual_size != expected_size {
        return Err(StoreError::IntegrityMismatch);
    }
    Ok(())
}

fn encode_digest(digest: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0F)]));
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::stream_copy_and_hash;

    #[test]
    fn stream_copy_and_hash_rejects_changed_source_length() {
        let mut input = &b"short"[..];
        let mut output = Vec::new();

        let error = stream_copy_and_hash(&mut input, &mut output, 10, |_| Ok(()))
            .expect_err("length mismatch must be rejected");

        assert_eq!(error.code(), "SOURCE_CHANGED");
    }
}
