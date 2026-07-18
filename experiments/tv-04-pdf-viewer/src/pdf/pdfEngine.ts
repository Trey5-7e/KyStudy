import {
  GlobalWorkerOptions,
  PDFDataRangeTransport,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import type { PdfRangeSource } from "./rangeSource";
import { diagnosticCode } from "./diagnostics";

const RANGE_CHUNK_BYTES = 64 * 1024;

GlobalWorkerOptions.workerSrc = workerUrl;

export interface PdfSession {
  readonly document: PDFDocumentProxy;
  readonly loadingTask: PDFDocumentLoadingTask;
  destroy(): Promise<void>;
}

export async function openPdf(source: PdfRangeSource): Promise<PdfSession> {
  const initialEnd = Math.min(source.length, RANGE_CHUNK_BYTES);
  const initialController = new AbortController();
  const initialData = await source.read(
    0,
    initialEnd,
    initialController.signal,
  );
  const transport = new SourceRangeTransport(source, initialData);
  const loadingTask = getDocument({
    range: transport,
    rangeChunkSize: RANGE_CHUNK_BYTES,
    disableStream: true,
    disableAutoFetch: true,
    stopAtErrors: true,
  });
  let document: PDFDocumentProxy;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    transport.abort();
    await loadingTask.destroy();
    throw error;
  }

  return {
    document,
    loadingTask,
    async destroy() {
      transport.abort();
      await loadingTask.destroy();
    },
  };
}

class SourceRangeTransport extends PDFDataRangeTransport {
  private readonly controllers = new Set<AbortController>();

  constructor(
    private readonly source: PdfRangeSource,
    initialData: Uint8Array,
  ) {
    super(source.length, initialData, false, source.name);
  }

  override requestDataRange(begin: number, end: number) {
    const controller = new AbortController();
    this.controllers.add(controller);
    void this.source
      .read(begin, end, controller.signal)
      .then((bytes) => this.onDataRange(begin, bytes))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          this.onDataRange(begin, null);
          console.error("PDF_RANGE_READ_FAILED", diagnosticCode(error));
        }
      })
      .finally(() => this.controllers.delete(controller));
  }

  override abort() {
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }
}
