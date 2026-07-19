import { describe, expect, it } from "vitest";

import {
  normalizePdfSelection,
  projectNormalizedRegion,
  type PdfViewportAdapter,
} from "./pdfRegions";

const ROTATED_VIEWPORT: PdfViewportAdapter = {
  convertToPdfPoint(x, y) {
    return [100 - y, x];
  },
  convertToViewportPoint(x, y) {
    return [y, 100 - x];
  },
};

describe("PDF question region coordinates", () => {
  it("round-trips through a rotated viewport without canvas pixels", () => {
    const normalized = normalizePdfSelection(
      3,
      [0, 0, 100, 100],
      ROTATED_VIEWPORT,
      [20, 10],
      [60, 50],
    );
    const projected = projectNormalizedRegion(
      [0, 0, 100, 100],
      ROTATED_VIEWPORT,
      normalized,
    );

    expect(normalized).toEqual({
      pageNumber: 3,
      x: 0.5,
      y: 0.2,
      width: 0.4,
      height: 0.4,
    });
    expect(projected).toEqual({ left: 20, top: 10, width: 40, height: 40 });
  });

  it("clamps pointer coordinates to the PDF page", () => {
    const identity: PdfViewportAdapter = {
      convertToPdfPoint: (x, y) => [x, y],
      convertToViewportPoint: (x, y) => [x, y],
    };

    expect(
      normalizePdfSelection(
        1,
        [0, 0, 100, 200],
        identity,
        [-20, 40],
        [120, 180],
      ),
    ).toEqual({
      pageNumber: 1,
      x: 0,
      y: 0.2,
      width: 1,
      height: 0.7,
    });
  });
});
