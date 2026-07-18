use std::fs::{self, File};
use std::io::Write;
use std::path::Path;
use std::time::Instant;

use fs4::FileExt;
use tempfile::Builder;

use crate::hash::STREAM_BUFFER_BYTES;
use crate::{
    BenchmarkReport, ImportDirective, ImportMeasurement, ImportRequest, Result, StoreError,
    Workspace,
};

const MIB: u64 = 1024 * 1024;
const SAMPLE_SIZES: &[u64] = &[10 * MIB, 300 * MIB, 1024 * MIB];

/// Generates, imports, backs up, and restores the TV-03 large-file samples under `base_root`.
///
/// The generated directory is deleted on normal return. Callers should place `base_root` on the
/// filesystem they intend to measure.
///
/// # Errors
///
/// Returns [`StoreError`] if sample generation, import, backup, restore, or verification fails.
pub fn run_large_file_benchmark(base_root: &Path) -> Result<BenchmarkReport> {
    fs::create_dir_all(base_root)?;
    let run_directory = Builder::new()
        .prefix("kystudy-tv03-bench-")
        .tempdir_in(base_root)?;
    let source_directory = run_directory.path().join("sources");
    let workspace_directory = run_directory.path().join("workspace");
    fs::create_dir_all(&source_directory)?;
    let mut workspace = Workspace::open(&workspace_directory)?;
    let mut imports = Vec::with_capacity(SAMPLE_SIZES.len());

    for (index, size) in SAMPLE_SIZES.iter().copied().enumerate() {
        let source_path = source_directory.join(format!("sample-{size}.bin"));
        generate_file(&source_path, size, u8::try_from(index).unwrap_or_default())?;
        let source = workspace.authorize_source(&source_path)?;
        let started = Instant::now();
        workspace.import_file(
            &source,
            ImportRequest {
                job_id: &format!("job-{index}"),
                document_id: &format!("document-{index}"),
                mime_type: "application/octet-stream",
                created_at: i64::try_from(index).map_err(|_| StoreError::ValueOutOfRange)?,
            },
            |_| ImportDirective::Continue,
        )?;
        let elapsed = started.elapsed();
        imports.push(ImportMeasurement {
            size_bytes: size,
            elapsed_millis: elapsed.as_millis(),
            throughput_mib_per_second_x100: throughput_x100(size, elapsed.as_micros())?,
            completed: true,
        });
    }

    let duplicate_path = source_directory.join(format!("sample-{}.bin", SAMPLE_SIZES[2]));
    let duplicate_source = workspace.authorize_source(&duplicate_path)?;
    let duplicate_started = Instant::now();
    let duplicate = workspace.import_file(
        &duplicate_source,
        ImportRequest {
            job_id: "job-duplicate",
            document_id: "document-duplicate",
            mime_type: "application/octet-stream",
            created_at: 100,
        },
        |_| ImportDirective::Continue,
    )?;
    if !duplicate.reused_existing_blob {
        return Err(StoreError::IntegrityMismatch);
    }
    let duplicate_import_millis = duplicate_started.elapsed().as_millis();

    let backup_path = run_directory.path().join("backup.kystudy-dir");
    let backup_started = Instant::now();
    let backup = workspace.create_backup(&backup_path)?;
    let backup_millis = backup_started.elapsed().as_millis();

    let restore_path = run_directory.path().join("restored-workspace");
    let restore_started = Instant::now();
    Workspace::restore_backup(&backup.path, &restore_path)?;
    let restore_millis = restore_started.elapsed().as_millis();
    let restored = Workspace::open(&restore_path)?;
    let restored_stats = restored.stats()?;
    if restored_stats.blob_count != 3 || restored_stats.document_count != 4 {
        return Err(StoreError::InvalidManifest);
    }

    Ok(BenchmarkReport {
        buffer_bytes: STREAM_BUFFER_BYTES,
        imports,
        duplicate_import_millis,
        backup_millis,
        restore_millis,
        backup_bytes: backup.total_bytes,
    })
}

fn generate_file(path: &Path, size: u64, seed: u8) -> Result<()> {
    let mut file = File::create_new(path)?;
    FileExt::allocate(&file, size)?;
    let mut block = vec![0_u8; STREAM_BUFFER_BYTES].into_boxed_slice();
    for (index, byte) in block.iter_mut().enumerate() {
        *byte = seed.wrapping_add(u8::try_from(index % 251).unwrap_or_default());
    }
    let mut remaining = size;
    while remaining > 0 {
        let write_size = usize::try_from(remaining.min(STREAM_BUFFER_BYTES as u64))
            .map_err(|_| StoreError::ValueOutOfRange)?;
        file.write_all(&block[..write_size])?;
        remaining -= u64::try_from(write_size).map_err(|_| StoreError::ValueOutOfRange)?;
    }
    file.set_len(size)?;
    file.sync_all()?;
    Ok(())
}

fn throughput_x100(size: u64, elapsed_micros: u128) -> Result<u64> {
    if elapsed_micros == 0 {
        return Err(StoreError::ValueOutOfRange);
    }
    let scaled = u128::from(size)
        .checked_mul(100)
        .and_then(|value| value.checked_mul(1_000_000))
        .ok_or(StoreError::ValueOutOfRange)?
        / u128::from(MIB)
        / elapsed_micros;
    u64::try_from(scaled).map_err(|_| StoreError::ValueOutOfRange)
}
