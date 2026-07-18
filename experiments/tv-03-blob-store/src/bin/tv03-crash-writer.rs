//! Helper process that exits during a managed staging copy without running destructors.

use std::path::Path;
use std::process::ExitCode;

use tv_03_blob_store::{ImportDirective, ImportRequest, Workspace};

fn main() -> ExitCode {
    let arguments = std::env::args_os().collect::<Vec<_>>();
    let Some(workspace_root) = arguments.get(1) else {
        eprintln!("missing workspace root");
        return ExitCode::FAILURE;
    };
    let Some(source_path) = arguments.get(2) else {
        eprintln!("missing source path");
        return ExitCode::FAILURE;
    };

    let result = run_crash_import(Path::new(workspace_root), Path::new(source_path));
    if let Err(error) = result {
        eprintln!("crash import setup failed ({}): {error}", error.code());
        return ExitCode::FAILURE;
    }
    ExitCode::FAILURE
}

fn run_crash_import(workspace_root: &Path, source_path: &Path) -> tv_03_blob_store::Result<()> {
    let mut workspace = Workspace::open(workspace_root)?;
    let source = workspace.authorize_source(source_path)?;
    workspace.import_file(
        &source,
        ImportRequest {
            job_id: "job-crash",
            document_id: "document-crash",
            mime_type: "application/octet-stream",
            created_at: 1,
        },
        |progress| {
            if progress.copied_bytes >= 2 * 1024 * 1024 {
                std::process::exit(86);
            }
            ImportDirective::Continue
        },
    )?;
    Ok(())
}
