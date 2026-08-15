import { describe, expect, it } from "vitest";

import type { ResourceDocument } from "../../shared/tauri/resourceClient";
import {
  canOpenResource,
  formatResourceBytes,
  formatResourceCount,
  nextResourceFileView,
  nextResourceTab,
  resourceProgressLabel,
} from "./resourceListModel";

function resource(overrides: Partial<ResourceDocument> = {}): ResourceDocument {
  return {
    id: "resource-1",
    title: "学习资料",
    kind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    sha256: "hash",
    reusedExistingBlob: false,
    role: "other",
    createdAt: 1,
    ...overrides,
  };
}

describe("resource list navigation", () => {
  it("keeps section tabs circular and supports Home/End", () => {
    expect(nextResourceTab("files", "ArrowRight")).toBe("mindmaps");
    expect(nextResourceTab("mindmaps", "ArrowLeft")).toBe("files");
    expect(nextResourceTab("mindmaps", "Home")).toBe("files");
    expect(nextResourceTab("files", "End")).toBe("mindmaps");
    expect(nextResourceTab("files", "Enter")).toBeNull();
  });

  it("keeps browse/search navigation circular for arrows and bounds", () => {
    expect(nextResourceFileView("browse", "ArrowDown")).toBe("search");
    expect(nextResourceFileView("search", "ArrowUp")).toBe("browse");
    expect(nextResourceFileView("search", "Home")).toBe("browse");
    expect(nextResourceFileView("browse", "End")).toBe("search");
    expect(nextResourceFileView("browse", "Enter")).toBeNull();
  });
});

describe("resource row display rules", () => {
  it("only opens resources supported by the reader", () => {
    expect(canOpenResource(resource({ kind: "pdf" }))).toBe(true);
    expect(canOpenResource(resource({ kind: "image" }))).toBe(true);
    expect(canOpenResource(resource({ kind: "document" }))).toBe(false);
    expect(canOpenResource(resource({ kind: "mindmap_source" }))).toBe(false);
  });

  it("formats bytes and reading progress for dense metadata cells", () => {
    expect(formatResourceCount(1024)).toBe("1,024");
    expect(formatResourceBytes(512)).toBe("512 B");
    expect(formatResourceBytes(1024)).toBe("1.0 KiB");
    expect(formatResourceBytes(1024 * 1024)).toBe("1.0 MiB");
    expect(resourceProgressLabel(resource())).toBeNull();
    expect(resourceProgressLabel(resource({ lastPage: 3 }))).toContain("3");
    expect(
      resourceProgressLabel(resource({ lastPage: 3, pageCount: 12 })),
    ).toContain("3/12");
    expect(
      resourceProgressLabel(resource({ lastPage: 1000, pageCount: 2000 })),
    ).toContain("1,000/2,000");
  });
});
