import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import {
  normalizeViewportRegion,
  restoreViewportRegion,
  type NormalizedPdfRegion,
} from "./pdf/coordinates";
import { openPdf } from "./pdf/pdfEngine";
import { HttpRangeSource } from "./pdf/rangeSource";
import { RenderCoordinator } from "./pdf/renderCoordinator";

const REGION: NormalizedPdfRegion = {
  coordinateVersion: 1,
  xMin: 0.18,
  yMin: 0.27,
  xMax: 0.71,
  yMax: 0.74,
};

export interface BrowserBenchmarkReport {
  readonly pdfJsVersion: string;
  readonly devicePixelRatio: number;
  readonly largePageCount: number;
  readonly mixedPageCount: number;
  readonly documentLoadMillis: number;
  readonly firstRenderMillis: number;
  readonly randomJumpMillis: readonly number[];
  readonly continuousRender: {
    readonly pageCount: number;
    readonly totalMillis: number;
    readonly meanMillis: number;
    readonly maximumMillis: number;
    readonly cycleEndHeapBytes: readonly (number | null)[];
  };
  readonly coordinateMaximumNormalizedError: number;
  readonly stablePhraseFound: boolean;
  readonly chineseTextFound: boolean;
  readonly scanTextItemCount: number;
  readonly corruptedPdfRejected: boolean;
  readonly canceledRenderCount: number;
  readonly rangeMetrics: {
    readonly large: ReturnType<HttpRangeSource["metrics"]>;
    readonly mixed: ReturnType<HttpRangeSource["metrics"]>;
  };
  readonly jsHeap: {
    readonly baselineBytes: number | null;
    readonly peakBytes: number | null;
    readonly finalBytes: number | null;
  };
}

export async function runBrowserBenchmark(): Promise<BrowserBenchmarkReport> {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.position = "fixed";
  canvas.style.left = "-10000px";
  document.body.append(canvas);

  const largeSource = await HttpRangeSource.open(
    "/fixtures/large-360-pages.pdf",
    "large-360-pages.pdf",
  );
  const loadStarted = performance.now();
  const largeSession = await openPdf(largeSource);
  const documentLoadMillis = performance.now() - loadStarted;
  const baselineHeap = heapBytes();
  let peakHeap = baselineHeap;

  const firstRenderMillis = await renderMeasured(
    largeSession.document,
    1,
    canvas,
  );
  peakHeap = maxHeap(peakHeap, heapBytes());
  const randomPages = [90, 180, 270, 360];
  const randomJumpMillis = [];
  for (const pageNumber of randomPages) {
    randomJumpMillis.push(
      await renderMeasured(largeSession.document, pageNumber, canvas),
    );
    peakHeap = maxHeap(peakHeap, heapBytes());
  }

  const continuousMeasurements = [];
  const cycleEndHeapBytes = [];
  const continuousStarted = performance.now();
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (let index = 0; index < 72; index += 1) {
      const pageNumber =
        ((index * 17 + cycle * 13) % largeSession.document.numPages) + 1;
      continuousMeasurements.push(
        await renderMeasured(largeSession.document, pageNumber, canvas, 0.9),
      );
      peakHeap = maxHeap(peakHeap, heapBytes());
    }
    forceGarbageCollection();
    await delay(50);
    cycleEndHeapBytes.push(heapBytes());
  }
  const continuousTotal = performance.now() - continuousStarted;

  const canceledRenderCount = await verifyRenderCancellation(
    largeSession.document,
    canvas,
  );

  const mixedSource = await HttpRangeSource.open(
    "/fixtures/mixed-samples.pdf",
    "mixed-samples.pdf",
  );
  const mixedSession = await openPdf(mixedSource);
  const text = await extractText(mixedSession.document, [1, 2, 3, 4]);
  const scanPage = await mixedSession.document.getPage(6);
  const scanText = await scanPage.getTextContent();
  scanPage.cleanup();
  const coordinateError = await measureCoordinateError(mixedSession.document);
  const corruptedPdfRejected = await verifyCorruptedPdfRejection();

  await largeSession.destroy();
  await mixedSession.destroy();
  canvas.width = 1;
  canvas.height = 1;
  canvas.remove();
  forceGarbageCollection();
  await delay(100);
  const finalHeap = heapBytes();

  const { version } = await import("pdfjs-dist");
  return {
    pdfJsVersion: version,
    devicePixelRatio: window.devicePixelRatio || 1,
    largePageCount: largeSession.document.numPages,
    mixedPageCount: mixedSession.document.numPages,
    documentLoadMillis,
    firstRenderMillis,
    randomJumpMillis,
    continuousRender: {
      pageCount: continuousMeasurements.length,
      totalMillis: continuousTotal,
      meanMillis: mean(continuousMeasurements),
      maximumMillis: Math.max(...continuousMeasurements),
      cycleEndHeapBytes,
    },
    coordinateMaximumNormalizedError: coordinateError,
    stablePhraseFound: text.includes("KyStudy TV-04 stable phrase"),
    chineseTextFound: text.includes("计算机考研"),
    scanTextItemCount: scanText.items.length,
    corruptedPdfRejected,
    canceledRenderCount,
    rangeMetrics: {
      large: largeSource.metrics(),
      mixed: mixedSource.metrics(),
    },
    jsHeap: {
      baselineBytes: baselineHeap,
      peakBytes: peakHeap,
      finalBytes: finalHeap,
    },
  };
}

async function verifyCorruptedPdfRejection() {
  const source = await HttpRangeSource.open(
    "/fixtures/corrupted-truncated.pdf",
    "corrupted-truncated.pdf",
  );
  try {
    const session = await openPdf(source);
    await session.destroy();
    return false;
  } catch {
    return true;
  }
}

async function renderMeasured(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale = 1.15,
) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const started = performance.now();
  await page.render({
    canvas,
    viewport,
    transform:
      outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise;
  const elapsed = performance.now() - started;
  page.cleanup();
  return elapsed;
}

async function verifyRenderCancellation(
  pdf: PDFDocumentProxy,
  canvas: HTMLCanvasElement,
) {
  const firstPage = await pdf.getPage(1);
  const secondPage = await pdf.getPage(2);
  const coordinator = new RenderCoordinator();
  const viewport = firstPage.getViewport({ scale: 2.4 });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const first = coordinator.render(() =>
    firstPage.render({ canvas, viewport }),
  );
  await Promise.resolve();
  const secondViewport = secondPage.getViewport({ scale: 1 });
  const second = coordinator.render(() => {
    canvas.width = Math.floor(secondViewport.width);
    canvas.height = Math.floor(secondViewport.height);
    return secondPage.render({ canvas, viewport: secondViewport });
  });
  const results = await Promise.all([first, second]);
  firstPage.cleanup();
  secondPage.cleanup();
  return results.filter((rendered) => !rendered).length;
}

async function extractText(
  pdf: PDFDocumentProxy,
  pageNumbers: readonly number[],
) {
  const fragments = [];
  for (const pageNumber of pageNumbers) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item) {
        fragments.push(item.str);
      }
    }
    page.cleanup();
  }
  return fragments.join(" ");
}

async function measureCoordinateError(pdf: PDFDocumentProxy) {
  let maximumError = 0;
  for (let pageNumber = 1; pageNumber <= 4; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const pageBox = toPageBox(page.view);
    for (const extraRotation of [0, 90, 180, 270]) {
      const viewport = page.getViewport({
        scale: 1.37,
        rotation: (page.rotate + extraRotation) % 360,
      });
      const restored = restoreViewportRegion(REGION, viewport, pageBox);
      const roundTrip = normalizeViewportRegion(restored, viewport, pageBox);
      maximumError = Math.max(
        maximumError,
        regionDifference(REGION, roundTrip),
      );
    }
    page.cleanup();
  }
  return maximumError;
}

function toPageBox(view: readonly number[]) {
  if (view.length < 4) {
    throw new Error("PDF_PAGE_BOX_INVALID");
  }
  return { xMin: view[0], yMin: view[1], xMax: view[2], yMax: view[3] };
}

function regionDifference(
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

function heapBytes() {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize: number };
    }
  ).memory;
  return memory?.usedJSHeapSize ?? null;
}

function maxHeap(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function forceGarbageCollection() {
  const collector = (window as Window & { gc?: () => void }).gc;
  collector?.();
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
