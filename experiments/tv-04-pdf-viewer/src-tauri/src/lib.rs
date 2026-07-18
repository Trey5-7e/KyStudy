//! Tauri custom-protocol boundary for the disposable `KyStudy` TV-04 PDF experiment.
//!
//! The frontend receives only a `document_id` and verified length. Every PDF byte request is a
//! bounded single range resolved through TV-03's `Workspace::open_document`; no absolute managed
//! path, storage key, arbitrary SQL, or shell capability crosses into React.

mod protocol;

use std::error::Error;

use protocol::{CommandError, PdfDescriptor, PdfProtocolState};
use tauri::{Manager, State};

const PDF_FIXTURE: &[u8] = include_bytes!("../../public/fixtures/mixed-samples.pdf");

#[tauri::command(rename_all = "camelCase")]
// Tauri's command extractor deserializes owned arguments and injects `State` by value.
#[expect(clippy::needless_pass_by_value)]
fn get_pdf_descriptor(
    state: State<'_, PdfProtocolState>,
    document_id: String,
) -> Result<PdfDescriptor, CommandError> {
    state.descriptor(&document_id).map_err(Into::into)
}

/// Runs the disposable Tauri PDF experiment.
///
/// # Errors
///
/// Returns an error if the fixture cannot be imported into the isolated TV-03 workspace or the
/// Tauri runtime cannot start.
pub fn run() -> Result<(), Box<dyn Error>> {
    tauri::Builder::default()
        .setup(|app| {
            let state = PdfProtocolState::from_pdf_bytes(PDF_FIXTURE)?;
            app.manage(state);
            Ok(())
        })
        .register_uri_scheme_protocol("kystudy-pdf", |context, request| {
            context
                .app_handle()
                .try_state::<PdfProtocolState>()
                .map_or_else(
                    || {
                        tauri::http::Response::builder()
                            .status(tauri::http::StatusCode::SERVICE_UNAVAILABLE)
                            .body(b"PDF_PROTOCOL_UNAVAILABLE".to_vec())
                            .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
                    },
                    |state| state.respond(&request),
                )
        })
        .invoke_handler(tauri::generate_handler![get_pdf_descriptor])
        .run(tauri::generate_context!())?;
    Ok(())
}
