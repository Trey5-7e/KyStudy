export interface ViewportTransform {
  readonly width: number;
  readonly height: number;
  convertToPdfPoint(x: number, y: number): readonly number[];
  convertToViewportPoint(x: number, y: number): readonly number[];
}

export interface PdfPageBox {
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

export interface ViewportRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NormalizedPdfRegion {
  readonly coordinateVersion: 1;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
}

const COORDINATE_VERSION = 1 as const;

export function normalizeViewportRegion(
  rectangle: ViewportRectangle,
  viewport: ViewportTransform,
  pageBox: PdfPageBox,
): NormalizedPdfRegion {
  assertPageBox(pageBox);
  assertViewport(viewport);
  assertRectangle(rectangle);

  const left = clamp(rectangle.x, 0, viewport.width);
  const top = clamp(rectangle.y, 0, viewport.height);
  const right = clamp(rectangle.x + rectangle.width, 0, viewport.width);
  const bottom = clamp(rectangle.y + rectangle.height, 0, viewport.height);
  if (right <= left || bottom <= top) {
    throw new CoordinateError("REGION_OUTSIDE_PAGE");
  }

  const pdfPoints = rectangleCorners(left, top, right, bottom).map(([x, y]) => {
    const point = viewport.convertToPdfPoint(x, y);
    return pair(point);
  });
  const pdfBounds = bounds(pdfPoints);
  const pageWidth = pageBox.xMax - pageBox.xMin;
  const pageHeight = pageBox.yMax - pageBox.yMin;

  return {
    coordinateVersion: COORDINATE_VERSION,
    xMin: unit((pdfBounds.xMin - pageBox.xMin) / pageWidth),
    yMin: unit((pdfBounds.yMin - pageBox.yMin) / pageHeight),
    xMax: unit((pdfBounds.xMax - pageBox.xMin) / pageWidth),
    yMax: unit((pdfBounds.yMax - pageBox.yMin) / pageHeight),
  };
}

export function restoreViewportRegion(
  region: NormalizedPdfRegion,
  viewport: ViewportTransform,
  pageBox: PdfPageBox,
): ViewportRectangle {
  assertRegion(region);
  assertPageBox(pageBox);
  assertViewport(viewport);

  const pageWidth = pageBox.xMax - pageBox.xMin;
  const pageHeight = pageBox.yMax - pageBox.yMin;
  const left = pageBox.xMin + region.xMin * pageWidth;
  const right = pageBox.xMin + region.xMax * pageWidth;
  const bottom = pageBox.yMin + region.yMin * pageHeight;
  const top = pageBox.yMin + region.yMax * pageHeight;
  const viewportPoints = rectangleCorners(left, bottom, right, top).map(
    ([x, y]) => pair(viewport.convertToViewportPoint(x, y)),
  );
  const viewportBounds = bounds(viewportPoints);

  return {
    x: viewportBounds.xMin,
    y: viewportBounds.yMin,
    width: viewportBounds.xMax - viewportBounds.xMin,
    height: viewportBounds.yMax - viewportBounds.yMin,
  };
}

export class CoordinateError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CoordinateError";
  }
}

function rectangleCorners(
  left: number,
  top: number,
  right: number,
  bottom: number,
): ReadonlyArray<readonly [number, number]> {
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
}

function bounds(points: ReadonlyArray<readonly [number, number]>) {
  let xMin = Number.POSITIVE_INFINITY;
  let yMin = Number.POSITIVE_INFINITY;
  let xMax = Number.NEGATIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    xMin = Math.min(xMin, x);
    yMin = Math.min(yMin, y);
    xMax = Math.max(xMax, x);
    yMax = Math.max(yMax, y);
  }
  return { xMin, yMin, xMax, yMax };
}

function pair(point: readonly number[]): readonly [number, number] {
  if (point.length < 2 || !finite(point[0]) || !finite(point[1])) {
    throw new CoordinateError("INVALID_TRANSFORM_RESULT");
  }
  return [point[0], point[1]];
}

function assertPageBox(pageBox: PdfPageBox) {
  if (
    !finite(pageBox.xMin) ||
    !finite(pageBox.yMin) ||
    !finite(pageBox.xMax) ||
    !finite(pageBox.yMax) ||
    pageBox.xMax <= pageBox.xMin ||
    pageBox.yMax <= pageBox.yMin
  ) {
    throw new CoordinateError("INVALID_PAGE_BOX");
  }
}

function assertViewport(viewport: ViewportTransform) {
  if (!finite(viewport.width) || !finite(viewport.height)) {
    throw new CoordinateError("INVALID_VIEWPORT");
  }
  if (viewport.width <= 0 || viewport.height <= 0) {
    throw new CoordinateError("INVALID_VIEWPORT");
  }
}

function assertRectangle(rectangle: ViewportRectangle) {
  if (
    !finite(rectangle.x) ||
    !finite(rectangle.y) ||
    !finite(rectangle.width) ||
    !finite(rectangle.height) ||
    rectangle.width <= 0 ||
    rectangle.height <= 0
  ) {
    throw new CoordinateError("INVALID_REGION");
  }
}

function assertRegion(region: NormalizedPdfRegion) {
  if (
    region.coordinateVersion !== COORDINATE_VERSION ||
    !finite(region.xMin) ||
    !finite(region.yMin) ||
    !finite(region.xMax) ||
    !finite(region.yMax) ||
    region.xMin < 0 ||
    region.yMin < 0 ||
    region.xMax > 1 ||
    region.yMax > 1 ||
    region.xMax <= region.xMin ||
    region.yMax <= region.yMin
  ) {
    throw new CoordinateError("INVALID_NORMALIZED_REGION");
  }
}

function unit(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}
