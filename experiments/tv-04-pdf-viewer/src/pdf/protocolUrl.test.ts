import { describe, expect, it, vi } from "vitest";

import { buildPdfProtocolUrl } from "./protocolUrl";

describe("Tauri PDF protocol URL", () => {
  it("passes only the opaque document ID to the Windows converter", () => {
    const converter = vi.fn(
      (value: string, protocol: string) =>
        `http://${protocol}.localhost/${encodeURIComponent(value)}`,
    );

    const url = buildPdfProtocolUrl("tv04-mixed-document", converter);

    expect(url).toBe("http://kystudy-pdf.localhost/tv04-mixed-document");
    expect(converter).toHaveBeenCalledWith(
      "tv04-mixed-document",
      "kystudy-pdf",
    );
    expect(url).not.toContain("%2F");
  });

  it("rejects a route or path instead of encoding it", () => {
    expect(() =>
      buildPdfProtocolUrl("/document/tv04-mixed-document", () => "unreachable"),
    ).toThrow("PDF_DOCUMENT_ID_INVALID");
  });

  it("rejects a storage-key shaped identifier", () => {
    expect(() =>
      buildPdfProtocolUrl("blobs/aa/bb/hash.blob", () => "unreachable"),
    ).toThrow("PDF_DOCUMENT_ID_INVALID");
  });
});
