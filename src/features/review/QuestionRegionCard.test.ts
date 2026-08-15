import { describe, expect, it, vi } from "vitest";

vi.mock("../../shared/tauri/resourceClient", () => ({
  buildResourceProtocolUrl: vi.fn(() => "http://localhost/resource.pdf"),
  getResourceReaderDescriptor: vi.fn(),
}));
vi.mock("../library/pdf/PdfReader", () => ({
  capturePdfRegionPng: vi.fn(),
}));
vi.mock("../library/pdf/pdfEngine", () => ({
  openPdf: vi.fn(),
}));

import type { QuestionRegion } from "../../shared/tauri/questionClient";
import { getResourceReaderDescriptor } from "../../shared/tauri/resourceClient";
import { capturePdfRegionPng } from "../library/pdf/PdfReader";
import { openPdf } from "../library/pdf/pdfEngine";
import {
  questionRegionActiveIndex,
  questionRegionNavigateIndex,
  questionRegionShouldCloseOnKey,
  questionRegionViewerFocusIndex,
  renderRegions,
} from "./QuestionRegionCard";

describe("question region active image", () => {
  it("clamps the active index when rendered regions change", () => {
    expect(questionRegionActiveIndex(3, 2)).toBe(1);
    expect(questionRegionActiveIndex(-1, 2)).toBe(0);
  });

  it("uses the neutral index for an empty viewer", () => {
    expect(questionRegionActiveIndex(4, 0)).toBe(0);
  });

  it("wraps previous and next navigation across rendered regions", () => {
    expect(questionRegionNavigateIndex(0, "previous", 3)).toBe(2);
    expect(questionRegionNavigateIndex(2, "next", 3)).toBe(0);
    expect(questionRegionNavigateIndex(12, "next", 3)).toBe(0);
  });

  it("wraps focus within the viewer toolbar", () => {
    expect(questionRegionViewerFocusIndex(0, "backward", 3)).toBe(2);
    expect(questionRegionViewerFocusIndex(2, "forward", 3)).toBe(0);
    expect(questionRegionViewerFocusIndex(-1, "forward", 3)).toBe(0);
    expect(questionRegionViewerFocusIndex(-1, "backward", 3)).toBe(2);
    expect(questionRegionViewerFocusIndex(0, "forward", 0)).toBe(-1);
  });

  it("only treats Escape as the viewer close key", () => {
    expect(questionRegionShouldCloseOnKey("Escape")).toBe(true);
    expect(questionRegionShouldCloseOnKey("Enter")).toBe(false);
  });

  it("revokes completed object URLs when a later region fails", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getResourceReaderDescriptor).mockResolvedValue({
      documentId: "document-1",
      title: "paper.pdf",
      kind: "pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
    });
    vi.mocked(openPdf).mockResolvedValue({
      document: {} as never,
      destroy,
    });
    vi.mocked(capturePdfRegionPng)
      .mockResolvedValueOnce(Uint8Array.of(1, 2, 3))
      .mockRejectedValueOnce(new Error("SECOND_REGION_FAILED"));
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 120, height: 80, close: vi.fn() }),
    );
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:completed-region");
    const revokeObjectUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const regions: QuestionRegion[] = [1, 2].map((pageNumber, index) => ({
      id: `region-${index + 1}`,
      questionId: "question-1",
      documentId: "document-1",
      pageNumber,
      x: 0.1,
      y: 0.1,
      width: 0.5,
      height: 0.25,
      coordinateVersion: 1,
      sortOrder: index,
      createdAt: 1,
    }));

    try {
      await expect(renderRegions("document-1", regions)).rejects.toThrow(
        "SECOND_REGION_FAILED",
      );
      expect(createObjectUrl).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:completed-region");
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      createObjectUrl.mockRestore();
      revokeObjectUrl.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
