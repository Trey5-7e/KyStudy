import type { PDFPageProxy } from "pdfjs-dist";

import {
  cancelOcr,
  getOcrStatus,
  recognizePdfPage,
  type OcrPageRecognition,
} from "../../../shared/tauri/ocrClient";

export type PdfPageRecognizer = (
  pageNumber: number,
  imageBytes: Uint8Array,
  signal?: AbortSignal,
) => Promise<OcrPageRecognition>;

export type PdfPageRenderer = (
  page: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy["getViewport"]>,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

// Formula-heavy workbook pages need enough pixels for superscripts, radicals,
// fractions, and small question markers. 3000 keeps the browser capture below
// the worker's 80MP/12MB safety limits for normal A4 pages while materially
// improving the signal sent to the optional local OCR component.
const OCR_RENDER_LONG_EDGE = 3_000;

/**
 * Creates the optional local OCR adapter used by PDF indexing flows.
 *
 * The adapter is deliberately created per indexing job so an unavailable or
 * malformed OCR component never prevents text-layer indexing from running.
 */
export async function createLocalPdfPageRecognizer(): Promise<
  PdfPageRecognizer | undefined
> {
  const status = await getOcrStatus();
  if (status.state !== "available") return undefined;

  return async (pageNumber, imageBytes, signal) => {
    if (signal?.aborted) {
      throw new PdfOcrCanceledError();
    }
    const operationId = crypto.randomUUID();
    const cancel = () => {
      void cancelOcr(operationId).catch(() => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await recognizePdfPage(operationId, pageNumber, imageBytes);
    } finally {
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) cancel();
    }
  };
}

export class PdfOcrCanceledError extends Error {
  constructor() {
    super("PDF_OCR_CANCELED");
    this.name = "PdfOcrCanceledError";
  }
}

export async function renderPdfPageForOcr(
  page: PDFPageProxy,
  baseViewport: ReturnType<PDFPageProxy["getViewport"]>,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  throwIfCanceled(signal);
  const longEdge = Math.max(baseViewport.width, baseViewport.height);
  const scale = longEdge <= 0 ? 1 : OCR_RENDER_LONG_EDGE / longEdge;
  const viewport = page.getViewport({ scale, rotation: page.rotate });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  const renderTask = page.render({
    canvas,
    viewport,
    background: "#ffffff",
  });
  const cancelRender = () => renderTask.cancel();
  signal?.addEventListener("abort", cancelRender, { once: true });
  try {
    await renderTask.promise;
    throwIfCanceled(signal);
    const blob = await canvasToPng(canvas);
    throwIfCanceled(signal);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    signal?.removeEventListener("abort", cancelRender);
    canvas.width = 0;
    canvas.height = 0;
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("PDF_OCR_CAPTURE_FAILED"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function throwIfCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PdfOcrCanceledError();
}
