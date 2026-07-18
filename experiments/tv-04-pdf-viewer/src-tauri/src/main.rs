//! Native entry point for the disposable TV-04 Tauri experiment.

use std::process::ExitCode;

fn main() -> ExitCode {
    if tv_04_pdf_viewer_lib::run().is_ok() {
        ExitCode::SUCCESS
    } else {
        eprintln!("TV04_START_FAILED");
        ExitCode::FAILURE
    }
}
