import type { ResourceReaderDescriptor } from "../../../shared/tauri/resourceClient";
import { buildResourceProtocolUrl } from "../../../shared/tauri/resourceClient";
import {
  beginResourceIndex,
  completeResourceIndex,
  failResourceIndex,
  interruptResourceIndex,
  storeResourcePageText,
  type ResourceIndexStatus,
} from "../../../shared/tauri/resourceSearchClient";
import {
  renderPdfPageForOcr,
  type PdfPageRecognizer,
  type PdfPageRenderer,
} from "./pdfOcr";
import { openPdf } from "./pdfEngine";
import { HttpRangeSource } from "./rangeSource";
import { joinPdfTextItems } from "./pdfTextItems";
import {
  mergeIndexedText,
  selectOcrLinesForIndex,
  shouldRequestPdfOcr,
} from "./pdfTextIndexerModel";

export class ResourceIndexCanceledError extends Error {
  constructor() {
    super("RESOURCE_INDEX_CANCELED");
    this.name = "ResourceIndexCanceledError";
  }
}

class ResourceIndexExtractionError extends Error {
  constructor() {
    super("RESOURCE_INDEX_EXTRACTION_FAILED");
    this.name = "ResourceIndexExtractionError";
  }
}

export interface IndexPdfTextOptions {
  recognizePage?: PdfPageRecognizer;
  renderPage?: PdfPageRenderer;
}

export async function indexPdfText(
  descriptor: ResourceReaderDescriptor,
  force: boolean,
  signal: AbortSignal,
  onProgress: (status: ResourceIndexStatus) => void,
  options: IndexPdfTextOptions = {},
): Promise<ResourceIndexStatus> {
  const source = new HttpRangeSource(
    descriptor.title,
    descriptor.sizeBytes,
    buildResourceProtocolUrl(descriptor.documentId, "pdf"),
  );
  let session: Awaited<ReturnType<typeof openPdf>> | undefined;
  try {
    session = await openPdf(source);
    throwIfCanceled(signal);
    const totalPages = session.document.numPages;
    const initial = await beginResourceIndex({
      documentId: descriptor.documentId,
      totalPages,
      force,
    });
    onProgress(initial.status);
    let started = initial;
    if (
      !started.needsIndexing &&
      options.recognizePage !== undefined &&
      started.status.textPages < started.status.indexedPages
    ) {
      started = await beginResourceIndex({
        documentId: descriptor.documentId,
        totalPages,
        force: true,
      });
      onProgress(started.status);
    }
    if (!started.needsIndexing) return started.status;
    for (
      let pageNumber = started.nextPage;
      pageNumber <= totalPages;
      pageNumber += 1
    ) {
      throwIfCanceled(signal);
      const page = await session.document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        throwIfCanceled(signal);
        const viewport = page.getViewport({ scale: 1 });
        const textLayer = joinPdfTextItems(content.items);
        const text = await enrichSparsePageText(
          page,
          viewport,
          pageNumber,
          textLayer,
          signal,
          options,
        );
        const status = await storeResourcePageText({
          documentId: descriptor.documentId,
          pageNumber,
          totalPages,
          widthPoints: viewport.width,
          heightPoints: viewport.height,
          text,
        });
        onProgress(status);
      } finally {
        page.cleanup();
      }
    }
    throwIfCanceled(signal);
    const completed = await completeResourceIndex(descriptor.documentId);
    onProgress(completed);
    return completed;
  } catch (error: unknown) {
    if (signal.aborted || error instanceof ResourceIndexCanceledError) {
      await interruptResourceIndex(descriptor.documentId).catch(
        () => undefined,
      );
      throw new ResourceIndexCanceledError();
    }
    await failResourceIndex(descriptor.documentId).catch(() => undefined);
    if (error instanceof Error) {
      throw new ResourceIndexExtractionError();
    }
    throw error;
  } finally {
    await session?.destroy();
  }
}

async function enrichSparsePageText(
  page: Parameters<PdfPageRenderer>[0],
  viewport: Parameters<PdfPageRenderer>[1],
  pageNumber: number,
  textLayer: string,
  signal: AbortSignal,
  options: IndexPdfTextOptions,
): Promise<string> {
  if (options.recognizePage === undefined || !shouldRequestPdfOcr(textLayer)) {
    return textLayer;
  }
  try {
    const imageBytes = await (options.renderPage ?? renderPdfPageForOcr)(
      page,
      viewport,
      signal,
    );
    throwIfCanceled(signal);
    const recognition = await options.recognizePage(
      pageNumber,
      imageBytes,
      signal,
    );
    throwIfCanceled(signal);
    const ocrText = selectOcrLinesForIndex(recognition.lines)
      .map((line) => line.text.trim())
      .join("\n");
    return mergeIndexedText(textLayer, ocrText);
  } catch {
    throwIfCanceled(signal);
    return textLayer;
  }
}

function throwIfCanceled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ResourceIndexCanceledError();
  }
}
