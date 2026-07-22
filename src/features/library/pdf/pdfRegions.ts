import type { QuestionRegionInput } from "../../../shared/tauri/questionClient";

export type PdfPageView = readonly [number, number, number, number];

export interface PdfViewportAdapter {
  convertToPdfPoint(x: number, y: number): number[];
  convertToViewportPoint(x: number, y: number): number[];
}

export interface ViewportRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface OcrRegionRenderSpec {
  scale: number;
  width: number;
  height: number;
}

export const OCR_REGION_LONG_EDGE_PIXELS = 1600;

export function normalizePdfSelection(
  pageNumber: number,
  pageView: PdfPageView,
  viewport: PdfViewportAdapter,
  start: readonly [number, number],
  end: readonly [number, number],
): QuestionRegionInput {
  const [pageX, pageY, pageRight, pageTop] = pageView;
  const pageWidth = pageRight - pageX;
  const pageHeight = pageTop - pageY;
  if (pageNumber < 1 || pageWidth <= 0 || pageHeight <= 0) {
    throw new Error("PDF_PAGE_VIEW_INVALID");
  }
  const [firstX, firstY] = point(
    viewport.convertToPdfPoint(start[0], start[1]),
  );
  const [secondX, secondY] = point(viewport.convertToPdfPoint(end[0], end[1]));
  const left = clamp(Math.min(firstX, secondX), pageX, pageRight);
  const right = clamp(Math.max(firstX, secondX), pageX, pageRight);
  const bottom = clamp(Math.min(firstY, secondY), pageY, pageTop);
  const top = clamp(Math.max(firstY, secondY), pageY, pageTop);

  return {
    pageNumber,
    x: (left - pageX) / pageWidth,
    y: (bottom - pageY) / pageHeight,
    width: (right - left) / pageWidth,
    height: (top - bottom) / pageHeight,
  };
}

export function projectNormalizedRegion(
  pageView: PdfPageView,
  viewport: PdfViewportAdapter,
  region: Pick<QuestionRegionInput, "x" | "y" | "width" | "height">,
): ViewportRectangle {
  const [pageX, pageY, pageRight, pageTop] = pageView;
  const pageWidth = pageRight - pageX;
  const pageHeight = pageTop - pageY;
  if (pageWidth <= 0 || pageHeight <= 0) {
    throw new Error("PDF_PAGE_VIEW_INVALID");
  }
  const left = pageX + region.x * pageWidth;
  const bottom = pageY + region.y * pageHeight;
  const right = left + region.width * pageWidth;
  const top = bottom + region.height * pageHeight;
  const corners = [
    point(viewport.convertToViewportPoint(left, bottom)),
    point(viewport.convertToViewportPoint(left, top)),
    point(viewport.convertToViewportPoint(right, bottom)),
    point(viewport.convertToViewportPoint(right, top)),
  ];
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
}

export function buildOcrRegionRenderSpec(
  pageView: PdfPageView,
  viewportAtScaleOne: PdfViewportAdapter,
  region: Pick<QuestionRegionInput, "x" | "y" | "width" | "height">,
): OcrRegionRenderSpec {
  const rectangle = projectNormalizedRegion(
    pageView,
    viewportAtScaleOne,
    region,
  );
  const longEdge = Math.max(rectangle.width, rectangle.height);
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    throw new Error("PDF_OCR_REGION_INVALID");
  }
  const scale = OCR_REGION_LONG_EDGE_PIXELS / longEdge;
  return {
    scale,
    width:
      rectangle.width >= rectangle.height
        ? OCR_REGION_LONG_EDGE_PIXELS
        : Math.max(1, Math.round(rectangle.width * scale)),
    height:
      rectangle.height >= rectangle.width
        ? OCR_REGION_LONG_EDGE_PIXELS
        : Math.max(1, Math.round(rectangle.height * scale)),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function point(values: number[]): [number, number] {
  if (values.length < 2) {
    throw new Error("PDF_VIEWPORT_POINT_INVALID");
  }
  return [values[0] ?? 0, values[1] ?? 0];
}
