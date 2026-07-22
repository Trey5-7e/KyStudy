import { describe, expect, it } from "vitest";

import {
  normalizeResourceSearchError,
  parseResourceIndexSession,
  parseResourceIndexStatus,
  parseResourceSearchResult,
} from "./resourceSearchClient";

const READY_STATUS = {
  documentId: "document-id",
  state: "ready",
  totalPages: 2,
  indexedPages: 2,
  textPages: 2,
  chunkCount: 4,
  updatedAt: 10,
  databasePath: "C:/private.sqlite3",
};

describe("resource search DTO validation", () => {
  it("keeps only the typed index status fields", () => {
    expect(parseResourceIndexStatus(READY_STATUS)).toEqual({
      documentId: "document-id",
      state: "ready",
      totalPages: 2,
      indexedPages: 2,
      textPages: 2,
      chunkCount: 4,
      updatedAt: 10,
    });
  });

  it("rejects a terminal status with incomplete pages", () => {
    expect(() =>
      parseResourceIndexStatus({ ...READY_STATUS, indexedPages: 1 }),
    ).toThrow("RESOURCE_INDEX_STATUS_INVALID");
  });

  it("rejects an index session whose resume page is outside the PDF", () => {
    expect(() =>
      parseResourceIndexSession({
        status: READY_STATUS,
        nextPage: 4,
        needsIndexing: false,
      }),
    ).toThrow("RESOURCE_INDEX_SESSION_INVALID");
  });

  it("strips internal search payloads", () => {
    expect(
      parseResourceSearchResult({
        documentId: "document-id",
        documentTitle: "408 规划",
        documentKind: "pdf",
        pageNumber: 12,
        excerpt: "第二阶段复习操作系统",
        matchKind: "page_text",
        sql: "SELECT * FROM resource_text_fts",
        chunkId: "private-chunk",
      }),
    ).toEqual({
      documentId: "document-id",
      documentTitle: "408 规划",
      documentKind: "pdf",
      pageNumber: 12,
      excerpt: "第二阶段复习操作系统",
      matchKind: "page_text",
    });
  });

  it("requires a page for page-text results", () => {
    expect(() =>
      parseResourceSearchResult({
        documentId: "document-id",
        documentTitle: "408 规划",
        documentKind: "pdf",
        excerpt: "操作系统",
        matchKind: "page_text",
      }),
    ).toThrow("RESOURCE_SEARCH_RESULT_INVALID");
  });

  it("maps PDF extraction failures without exposing internal details", () => {
    expect(
      normalizeResourceSearchError(
        new Error("RESOURCE_INDEX_EXTRACTION_FAILED"),
      ),
    ).toMatchObject({
      code: "RESOURCE_INDEX_EXTRACTION_FAILED",
      message: "PDF 文字层提取失败。",
    });
  });
});
