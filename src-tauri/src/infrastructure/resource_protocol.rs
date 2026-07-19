use std::io::{Read, Seek, SeekFrom};

use tauri::http::header::{
    ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_ORIGIN, ALLOW, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE,
    HeaderValue, RANGE,
};
use tauri::http::{Method, Request, Response, StatusCode};

use crate::application::{ImportError, ResourceUseCases};

use super::SqliteBlobStore;

const MAX_RANGE_BYTES: u64 = 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

/// Serves one strict byte range from a registered PDF.
pub(crate) fn respond_pdf(
    resources: &ResourceUseCases<SqliteBlobStore>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    match try_respond_pdf(resources, request) {
        Ok(response) => response,
        Err(error) => error_response(&error),
    }
}

/// Serves one complete, size-bounded registered image.
pub(crate) fn respond_image(
    resources: &ResourceUseCases<SqliteBlobStore>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    match try_respond_image(resources, request) {
        Ok(response) => response,
        Err(error) => error_response(&error),
    }
}

fn try_respond_pdf(
    resources: &ResourceUseCases<SqliteBlobStore>,
    request: &Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, ProtocolError> {
    require_get(request)?;
    let document_id = parse_document_path(request.uri().path())?;
    let mut readable = resources.open_readable(document_id)?;
    if readable.mime_type != "application/pdf" {
        return Err(ProtocolError::WrongKind);
    }
    let header = request
        .headers()
        .get(RANGE)
        .ok_or(ProtocolError::PdfRange(readable.size_bytes))?
        .to_str()
        .map_err(|_| ProtocolError::PdfRange(readable.size_bytes))?;
    let requested = parse_single_range(header, readable.size_bytes)
        .map_err(|_| ProtocolError::PdfRange(readable.size_bytes))?;
    if requested.end_exclusive - requested.start > MAX_RANGE_BYTES {
        return Err(ProtocolError::PdfRange(readable.size_bytes));
    }
    readable.file.seek(SeekFrom::Start(requested.start))?;
    let byte_count = usize::try_from(requested.end_exclusive - requested.start)
        .map_err(|_| ProtocolError::InvalidRange)?;
    let mut body = vec![0_u8; byte_count];
    readable.file.read_exact(&mut body)?;
    partial_pdf_response(body, requested, readable.size_bytes)
}

fn try_respond_image(
    resources: &ResourceUseCases<SqliteBlobStore>,
    request: &Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, ProtocolError> {
    require_get(request)?;
    let document_id = parse_document_path(request.uri().path())?;
    let mut readable = resources.open_readable(document_id)?;
    if !readable.mime_type.starts_with("image/") {
        return Err(ProtocolError::WrongKind);
    }
    if readable.size_bytes > MAX_IMAGE_BYTES {
        return Err(ProtocolError::ImageTooLarge);
    }
    let capacity =
        usize::try_from(readable.size_bytes).map_err(|_| ProtocolError::ImageTooLarge)?;
    let mut body = Vec::with_capacity(capacity);
    readable.file.read_to_end(&mut body)?;
    if body.len() != capacity {
        return Err(ProtocolError::ReadFailed);
    }
    complete_response(body, &readable.mime_type)
}

#[derive(Debug, thiserror::Error)]
enum ProtocolError {
    #[error("unknown document")]
    UnknownDocument,
    #[error("method not allowed")]
    MethodNotAllowed,
    #[error("wrong reader kind")]
    WrongKind,
    #[error("invalid range")]
    InvalidRange,
    #[error("PDF range rejected")]
    PdfRange(u64),
    #[error("image too large")]
    ImageTooLarge,
    #[error("registered resource could not be read")]
    ReadFailed,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Resource(#[from] ImportError),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end_exclusive: u64,
}

fn require_get(request: &Request<Vec<u8>>) -> Result<(), ProtocolError> {
    if request.method() != Method::GET {
        return Err(ProtocolError::MethodNotAllowed);
    }
    Ok(())
}

fn parse_document_path(path: &str) -> Result<&str, ProtocolError> {
    let document_id = path
        .strip_prefix('/')
        .ok_or(ProtocolError::UnknownDocument)?;
    if document_id.len() != 36
        || document_id.contains('/')
        || document_id.contains('\\')
        || !document_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err(ProtocolError::UnknownDocument);
    }
    Ok(document_id)
}

fn parse_single_range(value: &str, total_length: u64) -> Result<ByteRange, ProtocolError> {
    if total_length == 0 {
        return Err(ProtocolError::InvalidRange);
    }
    let range = value
        .strip_prefix("bytes=")
        .ok_or(ProtocolError::InvalidRange)?;
    if range.contains(',') {
        return Err(ProtocolError::InvalidRange);
    }
    let (start, end) = range.split_once('-').ok_or(ProtocolError::InvalidRange)?;
    if start.is_empty() {
        let suffix = parse_positive_u64(end)?;
        let actual = suffix.min(total_length);
        return Ok(ByteRange {
            start: total_length - actual,
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
    let value = value
        .parse::<u64>()
        .map_err(|_| ProtocolError::InvalidRange)?;
    if value == 0 {
        return Err(ProtocolError::InvalidRange);
    }
    Ok(value)
}

fn partial_pdf_response(
    body: Vec<u8>,
    range: ByteRange,
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
        &(range.end_exclusive - range.start).to_string(),
    )?;
    insert_dynamic(
        response.headers_mut(),
        CONTENT_RANGE,
        &format!(
            "bytes {}-{}/{}",
            range.start,
            range.end_exclusive - 1,
            total_length
        ),
    )?;
    Ok(response)
}

fn complete_response(body: Vec<u8>, mime_type: &str) -> Result<Response<Vec<u8>>, ProtocolError> {
    let content_length = body.len();
    let mut response = Response::new(body);
    insert_dynamic(response.headers_mut(), CONTENT_TYPE, mime_type)?;
    insert_dynamic(
        response.headers_mut(),
        CONTENT_LENGTH,
        &content_length.to_string(),
    )?;
    insert_static(response.headers_mut(), ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    Ok(response)
}

fn error_response(error: &ProtocolError) -> Response<Vec<u8>> {
    let (status, code) = match error {
        ProtocolError::UnknownDocument
        | ProtocolError::WrongKind
        | ProtocolError::Resource(
            ImportError::DocumentNotFound | ImportError::UnsupportedReaderKind,
        ) => (StatusCode::NOT_FOUND, "RESOURCE_NOT_FOUND"),
        ProtocolError::MethodNotAllowed => (StatusCode::METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED"),
        ProtocolError::PdfRange(_) | ProtocolError::InvalidRange => {
            (StatusCode::RANGE_NOT_SATISFIABLE, "PDF_RANGE_INVALID")
        }
        ProtocolError::ImageTooLarge => (StatusCode::PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE"),
        _ => (StatusCode::INTERNAL_SERVER_ERROR, "RESOURCE_UNAVAILABLE"),
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
    if let ProtocolError::PdfRange(total_length) = error {
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
    let value = HeaderValue::from_str(value).map_err(|_| ProtocolError::ReadFailed)?;
    headers.insert(name, value);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_uuid_path_is_accepted() {
        let id = "018f7328-4b66-7613-9729-e3570fc41525";

        assert_eq!(
            parse_document_path(&format!("/{id}")).expect("direct ID should parse"),
            id
        );
    }

    #[test]
    fn nested_or_encoded_path_is_rejected() {
        assert!(parse_document_path("/document/018f7328-4b66-7613-9729-e3570fc41525").is_err());
        assert!(parse_document_path("/%2Fdocument%2Fid").is_err());
    }

    #[test]
    fn multiple_or_oversized_ranges_are_rejected() {
        assert!(parse_single_range("bytes=0-2,4-6", 100).is_err());
        let range = parse_single_range("bytes=0-1048576", 2_000_000)
            .expect("syntactically valid range should parse");
        assert!(range.end_exclusive - range.start > MAX_RANGE_BYTES);
    }

    #[test]
    fn suffix_range_is_bounded_by_document_length() {
        assert_eq!(
            parse_single_range("bytes=-200", 100).expect("suffix should parse"),
            ByteRange {
                start: 0,
                end_exclusive: 100,
            }
        );
    }

    #[test]
    fn rejected_pdf_range_reports_the_registered_length() {
        let response = error_response(&ProtocolError::PdfRange(321));

        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            response.headers().get(CONTENT_RANGE),
            Some(&HeaderValue::from_static("bytes */321"))
        );
    }
}
