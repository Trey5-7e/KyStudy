const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export type FileSrcConverter = (filePath: string, protocol: string) => string;

export function buildPdfProtocolUrl(
  documentId: string,
  convertFileSrc: FileSrcConverter,
) {
  if (!DOCUMENT_ID.test(documentId)) {
    throw new Error("PDF_DOCUMENT_ID_INVALID");
  }
  // Tauri percent-encodes the whole first argument. Passing a route such as `/document/id`
  // would turn its slashes into `%2F` and no longer match the Rust protocol path on Windows.
  return convertFileSrc(documentId, "kystudy-pdf");
}
