import { describe, expect, it } from "vitest";

import type { ResourceIndexStatus } from "../../shared/tauri/resourceSearchClient";
import {
  formatResourceIndexStatus,
  replaceResourceIndexStatus,
} from "./resourceIndexModel";

function status(
  documentId: string,
  overrides: Partial<ResourceIndexStatus> = {},
): ResourceIndexStatus {
  return {
    documentId,
    state: "ready",
    totalPages: 1200,
    indexedPages: 1200,
    textPages: 1000,
    chunkCount: 2400,
    ...overrides,
  };
}

describe("resource index display model", () => {
  it("replaces one status without dropping other documents", () => {
    const current = [status("a"), status("b")];
    expect(
      replaceResourceIndexStatus(current, status("b", { state: "empty" })),
    ).toEqual([current[0], status("b", { state: "empty" })]);
  });

  it("uses grouped numeric labels for long index progress", () => {
    expect(formatResourceIndexStatus(status("a"))).toContain("1,200/1,200");
    expect(formatResourceIndexStatus(status("a"))).toContain("1,000 页有文字");
    expect(formatResourceIndexStatus(status("a"))).toContain("2,400 个片段");
  });
});
