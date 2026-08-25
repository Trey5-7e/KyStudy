import { describe, expect, it } from "vitest";

import {
  parseAiAttachmentRef,
  parseAiModelCapabilities,
} from "./aiConversationContract";

describe("parseAiModelCapabilities", () => {
  it("accepts explicit and unknown capability states", () => {
    expect(
      parseAiModelCapabilities({
        supportsImage: true,
        supportsFile: false,
        supportsPdf: "unknown",
        capabilitySource: "tested",
      }),
    ).toEqual({
      supportsImage: true,
      supportsFile: false,
      supportsPdf: "unknown",
      capabilitySource: "tested",
    });
  });

  it("rejects an unsupported capability source", () => {
    expect(() =>
      parseAiModelCapabilities({
        supportsImage: "unknown",
        supportsFile: "unknown",
        supportsPdf: "unknown",
        capabilitySource: "provider",
      }),
    ).toThrowError("AI_MODEL_CAPABILITIES_INVALID");
  });
});

describe("parseAiAttachmentRef", () => {
  const base = {
    id: "attachment-id",
    conversationId: "conversation-id",
    source: "temporary",
    fileName: "worksheet.pdf",
    mimeType: "application/pdf",
    sizeBytes: 12,
    status: "ready",
    createdAt: 1,
    updatedAt: 2,
  };

  it("accepts a temporary attachment without a resource document", () => {
    expect(parseAiAttachmentRef(base).source).toBe("temporary");
  });

  it("accepts null optional fields from Rust Option values", () => {
    expect(
      parseAiAttachmentRef({
        ...base,
        documentId: null,
        sha256: null,
        errorCode: null,
      }),
    ).toEqual({
      id: "attachment-id",
      conversationId: "conversation-id",
      source: "temporary",
      fileName: "worksheet.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      status: "ready",
      createdAt: 1,
      updatedAt: 2,
    });
  });

  it("requires a document id for library attachments", () => {
    expect(() =>
      parseAiAttachmentRef({ ...base, source: "resource" }),
    ).toThrowError("AI_ATTACHMENT_INVALID");
  });

  it("requires an error code only for failed attachments", () => {
    expect(() =>
      parseAiAttachmentRef({ ...base, status: "failed" }),
    ).toThrowError("AI_ATTACHMENT_INVALID");
    expect(
      parseAiAttachmentRef({
        ...base,
        status: "failed",
        errorCode: "OCR_FAILED",
      }).errorCode,
    ).toBe("OCR_FAILED");
  });
});
