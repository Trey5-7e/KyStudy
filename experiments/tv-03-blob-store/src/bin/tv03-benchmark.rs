//! Release-mode 10 MiB, 300 MiB, and 1 GiB TV-03 measurement executable.

use std::path::PathBuf;
use std::process::ExitCode;

use tv_03_blob_store::{BenchmarkReport, run_large_file_benchmark};

fn main() -> ExitCode {
    let Some(base_root) = std::env::var_os("KYSTUDY_TV03_BENCH_ROOT") else {
        eprintln!("KYSTUDY_TV03_BENCH_ROOT must point to an explicit temporary directory");
        return ExitCode::FAILURE;
    };
    match run_large_file_benchmark(&PathBuf::from(base_root)) {
        Ok(report) => {
            print_report(&report);
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("TV-03 benchmark failed ({}): {error}", error.code());
            ExitCode::FAILURE
        }
    }
}

fn print_report(report: &BenchmarkReport) {
    println!("TV-03 release large-file probe");
    println!("stream buffer: {} bytes", report.buffer_bytes);
    for import in &report.imports {
        println!(
            "import {} bytes: {} ms, {}.{:02} MiB/s",
            import.size_bytes,
            import.elapsed_millis,
            import.throughput_mib_per_second_x100 / 100,
            import.throughput_mib_per_second_x100 % 100
        );
    }
    println!(
        "duplicate 1 GiB import: {} ms",
        report.duplicate_import_millis
    );
    println!("complete backup: {} ms", report.backup_millis);
    println!("complete restore: {} ms", report.restore_millis);
    println!("backup bytes: {}", report.backup_bytes);
}
