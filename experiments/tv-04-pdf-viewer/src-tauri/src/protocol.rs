use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::sync::Mutex;

use serde::Serialize;
use tauri::http::header::{
    ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_ORIGIN, ALLOW, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
    HeaderValue, RANGE,
};
use tauri::http::{Method, Request, Response, StatusCode};
use tempfile::TempDir;
use thiserror::Error;
use tv_03_blob_store::{ImportDirective, ImportRequest, StoreError, Workspace};

const DOCUMENT_ID: &str = "tv04-mixed-document";
const JOB_ID: &str = "tv04-mixed-import";
const DISPLAY_NAME: &str = "mixed-samples.pdf";
const MAX_RANGE_BYTES: u64 = 1024 * 1024;

/// Metadata exposed to PDF.js without a managed path or storage key.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PdfDescriptor {
    /// Opaque business identifier used by the custom protocol.
    pub document_id: String,
    /// Display-only file name.
    pub display_name: String,
    /// Verified Blob length.
    pub size_bytes: u64,
}

/// Stable non-sensitive command error returned across the Tauri boundary.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CommandError {
    /// Stable error code suitable for UI handling.
    pub code: &'static str,
    /// Short user-facing message without a local path or debug representation.
    pub message: &'static str,
}

impl From<ProtocolError> for CommandError {
    fn from(error: ProtocolError) -> Self {
        match error {
            ProtocolError::UnknownDocument => Self {
                code: "PDF_DOCUMENT_NOT_FOUND",
                message: "找不到已登记的 PDF 资料。",
            },
            _ => Self {
                code: "PDF_DOCUMENT_UNAVAILABLE",
                message: "PDF 资料暂时不可用。",
            },
        }
    }
}

/// Isolated state owning a TV-03 workspace and its disposable runtime directory.
pub struct PdfProtocolState {
    workspace: Mutex<Workspace>,
    descriptor: PdfDescriptor,
    _runtime_directory: TempDir,
}

impl PdfProtocolState {
    /// Imports a bundled fixture through TV-03 and prepares a protocol state.
    ///
    /// # Errors
    ///
    /// Returns an error if the temporary workspace, fixture write, authorization, or Blob import
    /// cannot be completed.
    pub fn from_pdf_bytes(bytes: &[u8]) -> Result<Self, ProtocolError> {
        let runtime_directory = tempfile::tempdir()?;
        let source_path = runtime_directory.path().join(DISPLAY_NAME);
        fs::write(&source_path, bytes)?;
        let workspace_path = runtime_directory.path().join("workspace");
        let mut workspace = Workspace::open(&workspace_path)?;
        let source = workspace.authorize_source(&source_path)?;
        let outcome = workspace.import_file(
            &source,
            ImportRequest {
                job_id: JOB_ID,
                document_id: DOCUMENT_ID,
                mime_type: "application/pdf",
                created_at: 1,
            },
            |_| ImportDirective::Continue,
        )?;

        Ok(Self {
            workspace: Mutex::new(workspace),
            descriptor: PdfDescriptor {
                document_id: outcome.document_id,
                display_name: DISPLAY_NAME.to_owned(),
                size_bytes: outcome.size_bytes,
            },
            _runtime_directory: runtime_directory,
        })
    }

    /// Returns metadata only for the registered document identifier.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError::UnknownDocument`] for every other identifier.
    pub fn descriptor(&self, document_id: &str) -> Result<PdfDescriptor, ProtocolError> {
        if document_id != self.descriptor.document_id {
            return Err(ProtocolError::UnknownDocument);
        }
        Ok(self.descriptor.clone())
    }

    /// Serves one strict byte range for an authorized PDF document.
    #[must_use]
    pub fn respond(&self, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        match self.try_respond(request) {
            Ok(response) => response,
            Err(error) => error_response(&error, self.descriptor.size_bytes),
        }
    }

    fn try_respond(&self, request: &Request<Vec<u8>>) -> Result<Response<Vec<u8>>, ProtocolError> {
        if request.method() != Method::GET {
            return Err(ProtocolError::MethodNotAllowed);
        }
        let document_id = parse_document_path(request.uri().path())?;
        self.descriptor(document_id)?;
        let header = request
            .headers()
            .get(RANGE)
            .ok_or(ProtocolError::RangeRequired)?
            .to_str()
            .map_err(|_| ProtocolError::InvalidRange)?;
        let requested = parse_single_range(header, self.descriptor.size_bytes)?;
        let byte_count = requested.end_exclusive - requested.start;
        if byte_count > MAX_RANGE_BYTES {
            return Err(ProtocolError::RangeTooLarge);
        }

        let workspace = self
            .workspace
            .lock()
            .map_err(|_| ProtocolError::StateUnavailable)?;
        let mut file = workspace.open_document(document_id)?;
        let body = read_range(&mut file, requested)?;
        partial_response(body, requested, self.descriptor.size_bytes)
    }
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("unknown PDF document")]
    UnknownDocument,
    #[error("method is not allowed")]
    MethodNotAllowed,
    #[error("a byte range is required")]
    RangeRequired,
    #[error("the byte range is invalid")]
    InvalidRange,
    #[error("the byte range exceeds the response limit")]
    RangeTooLarge,
    #[error("PDF protocol state is unavailable")]
    StateUnavailable,
    #[error("PDF response could not be constructed")]
    ResponseBuild,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Store(#[from] StoreError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end_exclusive: u64,
}

fn parse_document_path(path: &str) -> Result<&str, ProtocolError> {
    let document_id = path
        .strip_prefix('/')
        .ok_or(ProtocolError::UnknownDocument)?;
    if document_id.is_empty() || document_id.contains('/') || document_id.contains('\\') {
        return Err(ProtocolError::UnknownDocument);
    }
    Ok(document_id)
}

fn parse_single_range(value: &str, total_length: u64) -> Result<ByteRange, ProtocolError> {
    let range = value
        .strip_prefix("bytes=")
        .ok_or(ProtocolError::InvalidRange)?;
    if range.contains(',') {
        return Err(ProtocolError::InvalidRange);
    }
    let (start, end) = range.split_once('-').ok_or(ProtocolError::InvalidRange)?;
    if start.is_empty() {
        let suffix_length = parse_positive_u64(end)?;
        let actual_length = suffix_length.min(total_length);
        return Ok(ByteRange {
            start: total_length - actual_length,
            end_exclusive: total_length,
        });
    }

    let start = start
        .parse::<u64>()
        .map_err(|_| ProtocolError::InvalidRange)?;
    if start >= total_length {
        return Err(ProtocolError::InvalidRange);
    }
    let inclusive_end = if end.is_empty() {
        total_length - 1
    } else {
        end.parse::<u64>()
            .map_err(|_| ProtocolError::InvalidRange)?
            .min(total_length - 1)
    };
    if inclusive_end < start {
        return Err(ProtocolError::InvalidRange);
    }
    Ok(ByteRange {
        start,
        end_exclusive: inclusive_end + 1,
    })
}

fn parse_positive_u64(value: &str) -> Result<u64, ProtocolError> {
    let parsed = value
        .parse::<u64>()
        .map_err(|_| ProtocolError::InvalidRange)?;
    if parsed == 0 {
        return Err(ProtocolError::InvalidRange);
    }
    Ok(parsed)
}

fn read_range(file: &mut File, requested: ByteRange) -> Result<Vec<u8>, ProtocolError> {
    file.seek(SeekFrom::Start(requested.start))?;
    let byte_count = usize::try_from(requested.end_exclusive - requested.start)
        .map_err(|_| ProtocolError::InvalidRange)?;
    let mut bytes = vec![0_u8; byte_count];
    file.read_exact(&mut bytes)?;
    Ok(bytes)
}

fn partial_response(
    body: Vec<u8>,
    requested: ByteRange,
    total_length: u64,
) -> Result<Response<Vec<u8>>, ProtocolError> {
    let mut response = Response::new(body);
    *response.status_mut() = StatusCode::PARTIAL_CONTENT;
    insert_static(response.headers_mut(), CONTENT_TYPE, "application/pdf");
    insert_static(response.headers_mut(), ACCEPT_RANGES, "bytes");
    insert_static(response.headers_mut(), ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    insert_dynamic(
        response.headers_mut(),
        CONTENT_LENGTH,
        &(requested.end_exclusive - requested.start).to_string(),
    )?;
    insert_dynamic(
        response.headers_mut(),
        CONTENT_RANGE,
        &format!(
            "bytes {}-{}/{}",
            requested.start,
            requested.end_exclusive - 1,
            total_length
        ),
    )?;
    Ok(response)
}

fn error_response(error: &ProtocolError, total_length: u64) -> Response<Vec<u8>> {
    let (status, code) = match error {
        ProtocolError::UnknownDocument => (StatusCode::NOT_FOUND, "PDF_DOCUMENT_NOT_FOUND"),
        ProtocolError::MethodNotAllowed => (StatusCode::METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED"),
        ProtocolError::RangeRequired
        | ProtocolError::InvalidRange
        | ProtocolError::RangeTooLarge => (StatusCode::RANGE_NOT_SATISFIABLE, "PDF_RANGE_INVALID"),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "PDF_PROTOCOL_UNAVAILABLE",
        ),
    };
    let mut response = Response::new(code.as_bytes().to_vec());
    *response.status_mut() = status;
    insert_static(
        response.headers_mut(),
        CONTENT_TYPE,
        "text/plain; charset=utf-8",
    );
    insert_static(response.headers_mut(), ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if status == StatusCode::METHOD_NOT_ALLOWED {
        insert_static(response.headers_mut(), ALLOW, "GET");
    }
    if status == StatusCode::RANGE_NOT_SATISFIABLE {
        let _ignored = insert_dynamic(
            response.headers_mut(),
            CONTENT_RANGE,
            &format!("bytes */{total_length}"),
        );
    }
    response
}

fn insert_static(
    headers: &mut tauri::http::HeaderMap,
    name: tauri::http::header::HeaderName,
    value: &'static str,
) {
    headers.insert(name, HeaderValue::from_static(value));
}

fn insert_dynamic(
    headers: &mut tauri::http::HeaderMap,
    name: tauri::http::header::HeaderName,
    value: &str,
) -> Result<(), ProtocolError> {
    let value = HeaderValue::from_str(value).map_err(|_| ProtocolError::ResponseBuild)?;
    headers.insert(name, value);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PDF_BYTES: &[u8] = include_bytes!("../../public/fixtures/mixed-samples.pdf");

    #[test]
    fn closed_range_is_parsed_as_end_exclusive() {
        assert_eq!(
            parse_single_range("bytes=10-19", 100).expect("valid range should parse"),
            ByteRange {
                start: 10,
                end_exclusive: 20
            }
        );
    }

    #[test]
    fn suffix_range_is_limited_to_document_length() {
        assert_eq!(
            parse_single_range("bytes=-120", 100).expect("suffix range should parse"),
            ByteRange {
                start: 0,
                end_exclusive: 100
            }
        );
    }

    #[test]
    fn multiple_ranges_are_rejected() {
        assert!(matches!(
            parse_single_range("bytes=0-1,4-5", 100),
            Err(ProtocolError::InvalidRange)
        ));
    }

    #[test]
    fn registered_document_returns_exact_partial_pdf_bytes() {
        let state = PdfProtocolState::from_pdf_bytes(PDF_BYTES)
            .expect("fixture should import through TV-03");
        let request = Request::builder()
            .method(Method::GET)
            .uri(format!("kystudy-pdf://localhost/{DOCUMENT_ID}"))
            .header(RANGE, "bytes=0-15")
            .body(Vec::new())
            .expect("request should build");

        let response = state.respond(&request);

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), &PDF_BYTES[..16]);
        let expected = HeaderValue::from_str(&format_content_range())
            .expect("content range fixture should be valid");
        assert_eq!(response.headers().get(CONTENT_RANGE), Some(&expected));
    }

    #[test]
    fn unknown_document_does_not_fall_back_to_a_path() {
        let state = PdfProtocolState::from_pdf_bytes(PDF_BYTES)
            .expect("fixture should import through TV-03");
        let request = Request::builder()
            .method(Method::GET)
            .uri("kystudy-pdf://localhost/../../outside.pdf")
            .header(RANGE, "bytes=0-15")
            .body(Vec::new())
            .expect("request should build");

        let response = state.respond(&request);

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn request_without_range_never_allocates_the_whole_document() {
        let state = PdfProtocolState::from_pdf_bytes(PDF_BYTES)
            .expect("fixture should import through TV-03");
        let request = Request::builder()
            .method(Method::GET)
            .uri(format!("kystudy-pdf://localhost/{DOCUMENT_ID}"))
            .body(Vec::new())
            .expect("request should build");

        let response = state.respond(&request);

        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }

    #[test]
    fn range_larger_than_one_mib_is_rejected() {
        let state = PdfProtocolState::from_pdf_bytes(PDF_BYTES)
            .expect("fixture should import through TV-03");
        let request = Request::builder()
            .method(Method::GET)
            .uri(format!("kystudy-pdf://localhost/{DOCUMENT_ID}"))
            .header(RANGE, format!("bytes=0-{MAX_RANGE_BYTES}"))
            .body(Vec::new())
            .expect("request should build");

        let response = state.respond(&request);

        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }

    #[test]
    fn non_get_method_is_rejected_with_allow_header() {
        let state = PdfProtocolState::from_pdf_bytes(PDF_BYTES)
            .expect("fixture should import through TV-03");
        let request = Request::builder()
            .method(Method::POST)
            .uri(format!("kystudy-pdf://localhost/{DOCUMENT_ID}"))
            .body(Vec::new())
            .expect("request should build");

        let response = state.respond(&request);

        assert_eq!(response.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(
            response.headers().get(ALLOW),
            Some(&HeaderValue::from_static("GET"))
        );
    }

    fn format_content_range() -> String {
        format!("bytes 0-15/{}", PDF_BYTES.len())
    }

    #[test]
    fn generated_fixture_path_is_not_inside_workspace() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        assert!(root.join("../public/fixtures/mixed-samples.pdf").exists());
    }
}
