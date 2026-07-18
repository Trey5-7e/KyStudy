import { describe, expect, it } from "vitest";

import {
  CoordinateError,
  normalizeViewportRegion,
  restoreViewportRegion,
  type NormalizedPdfRegion,
  type ViewportTransform,
} from "./coordinates";

const PAGE_BOX = { xMin: 0, yMin: 0, xMax: 600, yMax: 800 } as const;
const REGION: NormalizedPdfRegion = {
  coordinateVersion: 1,
  xMin: 0.17,
  yMin: 0.24,
  xMax: 0.68,
  yMax: 0.72,
};

describe("normalized PDF coordinates", () => {
  for (const rotation of [0, 90, 180, 270] as const) {
    it(`round-trips at ${rotation} degrees across viewport scales`, () => {
      const selection = restoreViewportRegion(
        REGION,
        createViewport(rotation, 1.75),
        PAGE_BOX,
      );
      const normalized = normalizeViewportRegion(
        selection,
        createViewport(rotation, 1.75),
        PAGE_BOX,
      );
      const restoredAtAnotherScale = restoreViewportRegion(
        normalized,
        createViewport(rotation, 0.83),
        PAGE_BOX,
      );
      const secondRoundTrip = normalizeViewportRegion(
        restoredAtAnotherScale,
        createViewport(rotation, 0.83),
        PAGE_BOX,
      );

      expect(maxRegionDifference(secondRoundTrip, REGION)).toBeLessThan(1e-12);
    });
  }

  it("clamps a partially outside selection to the page", () => {
    const normalized = normalizeViewportRegion(
      { x: -20, y: -30, width: 140, height: 180 },
      createViewport(0, 1),
      PAGE_BOX,
    );

    expect(normalized.xMin).toBe(0);
    expect(normalized.yMax).toBe(1);
  });

  it("rejects a selection that does not overlap the page", () => {
    expect(() =>
      normalizeViewportRegion(
        { x: -100, y: -100, width: 20, height: 20 },
        createViewport(0, 1),
        PAGE_BOX,
      ),
    ).toThrowError(new CoordinateError("REGION_OUTSIDE_PAGE"));
  });

  it("rejects an unknown coordinate version", () => {
    const invalid = {
      ...REGION,
      coordinateVersion: 2,
    } as unknown as NormalizedPdfRegion;
    expect(() =>
      restoreViewportRegion(invalid, createViewport(0, 1), PAGE_BOX),
    ).toThrowError(new CoordinateError("INVALID_NORMALIZED_REGION"));
  });
});

function createViewport(
  rotation: 0 | 90 | 180 | 270,
  scale: number,
): ViewportTransform {
  const width = rotation % 180 === 0 ? 600 * scale : 800 * scale;
  const height = rotation % 180 === 0 ? 800 * scale : 600 * scale;
  return {
    width,
    height,
    convertToViewportPoint(x, y) {
      switch (rotation) {
        case 0:
          return [x * scale, (800 - y) * scale];
        case 90:
          return [y * scale, x * scale];
        case 180:
          return [(600 - x) * scale, y * scale];
        case 270:
          return [(800 - y) * scale, (600 - x) * scale];
      }
    },
    convertToPdfPoint(x, y) {
      switch (rotation) {
        case 0:
          return [x / scale, 800 - y / scale];
        case 90:
          return [y / scale, x / scale];
        case 180:
          return [600 - x / scale, y / scale];
        case 270:
          return [600 - y / scale, 800 - x / scale];
      }
    },
  };
}

function maxRegionDifference(
  left: NormalizedPdfRegion,
  right: NormalizedPdfRegion,
) {
  return Math.max(
    Math.abs(left.xMin - right.xMin),
    Math.abs(left.yMin - right.yMin),
    Math.abs(left.xMax - right.xMax),
    Math.abs(left.yMax - right.yMax),
  );
}
