import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const IMPORT_SOURCE = readFileSync(
  new URL("./MindMapImportPanel.tsx", import.meta.url),
  "utf8",
);
const DETAILS_SOURCE = readFileSync(
  new URL("./MindMapDetails.tsx", import.meta.url),
  "utf8",
);

describe("mind-map import boundary", () => {
  it("creates drafts from supported source resources including XMind", () => {
    expect(IMPORT_SOURCE).toContain('resource.kind === "mindmap_source"');
    expect(IMPORT_SOURCE).toContain(
      'selectedSource?.mimeType === "application/x-xmind"',
    );
    expect(IMPORT_SOURCE).toContain('if (effectiveSourceId !== "")');
    expect(IMPORT_SOURCE).toContain(
      'disabled={busy || effectiveSourceId === ""}',
    );
    expect(IMPORT_SOURCE).toContain("XMind");
    expect(IMPORT_SOURCE).toContain("读取主题层级与标题生成草案");
    expect(IMPORT_SOURCE).toContain("样式、关系线和附件");
  });

  it("keeps generated drafts reviewable before persistence", () => {
    expect(IMPORT_SOURCE).toContain('draft.state === "generated"');
    expect(IMPORT_SOURCE).toContain("onAcceptDraft(draft.id)");
    expect(IMPORT_SOURCE).toContain("onRejectDraft(draft.id)");
    expect(IMPORT_SOURCE).toContain('open={draft.state === "generated"}');
    expect(IMPORT_SOURCE).toContain("draft.warnings.map");
  });
});

describe("mind-map PDF resource boundary", () => {
  it("requires a complete positive and ordered PDF page range", () => {
    expect(DETAILS_SOURCE).toContain(
      'selectedResource.kind === "pdf" && hasStart !== hasEnd',
    );
    expect(DETAILS_SOURCE).toContain("PDF 页码需要同时填写起始页和结束页");
    expect(DETAILS_SOURCE).toContain("!Number.isInteger(start) || start < 1");
    expect(DETAILS_SOURCE).toContain(
      "!Number.isInteger(end) || end < (start ?? Number.MAX_SAFE_INTEGER)",
    );
    expect(DETAILS_SOURCE).toContain("请填写有效的 PDF 页码范围");
  });

  it("opens only browsable linked resources with the stored page", () => {
    expect(DETAILS_SOURCE).toContain(
      '(resource.kind === "pdf" || resource.kind === "image")',
    );
    expect(DETAILS_SOURCE).toContain(
      "onOpenResource(link.documentId, link.pageStart)",
    );
    expect(DETAILS_SOURCE).toContain('role="alert"');
  });
});
