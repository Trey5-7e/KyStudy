import { describe, expect, it } from "vitest";

import {
  normalizeResourceCommandError,
  parseImportEvent,
  parseResourceDocument,
} from "./resourceClient";

const VALID_RESOURCE = {
  id: "019f7328-4b66-7613-9729-e3570fc41525",
  title: "计算机组成原理错题",
  kind: "pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  sha256: "AB".repeat(32),
  reusedExistingBlob: false,
  createdAt: 1_700_000_000_000,
};

describe("parseResourceDocument", () => {
  it("returns typed metadata without accepting a path or storage key", () => {
    const resource = parseResourceDocument({
      ...VALID_RESOURCE,
      path: "C:\\private\\source.pdf",
      storageKey: "blobs/AB/CD/private.blob",
    });

    expect(resource).toEqual(VALID_RESOURCE);
    expect("path" in resource).toBe(false);
    expect("storageKey" in resource).toBe(false);
  });

  it("rejects a malformed content hash", () => {
    expect(() =>
      parseResourceDocument({ ...VALID_RESOURCE, sha256: "not-a-hash" }),
    ).toThrowError("RESOURCE_DOCUMENT_INVALID");
  });
});

describe("parseImportEvent", () => {
  it("requires a completed resource for a succeeded event", () => {
    expect(() =>
      parseImportEvent({
        operationId: "operation-1",
        state: "succeeded",
        copiedBytes: 10,
        totalBytes: 10,
        resource: null,
        error: null,
      }),
    ).toThrowError("IMPORT_EVENT_INVALID");
  });

  it("parses a running progress event", () => {
    const event = parseImportEvent({
      operationId: "operation-1",
      state: "running",
      copiedBytes: 5,
      totalBytes: 10,
      resource: null,
      error: null,
    });

    expect(event.copiedBytes).toBe(5);
  });
});

describe("normalizeResourceCommandError", () => {
  it("does not expose arbitrary backend error text", () => {
    const error = normalizeResourceCommandError({
      code: "UNKNOWN_ERROR",
      message: "C:\\private\\workspace",
    });

    expect(error.code).toBe("RESOURCE_UNAVAILABLE");
  });
});
