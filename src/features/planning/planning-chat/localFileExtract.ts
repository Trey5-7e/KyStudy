import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { joinPdfTextItems } from "../../library/pdf/pdfTextItems";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface LocalComposerFile {
  name: string;
  size: number;
  text: string;
  pageCount?: number;
  images?: string[];
  isScanned?: boolean;
}

const CJK_CHARACTER = /[\u3400-\u9fff\uf900-\ufaff]/;
const CLOSING_PUNCTUATION = /[，。！？；：、,.!?;:）】》]/;
const OPENING_PUNCTUATION = /[（【《]/;

function needsSpace(previous: string, current: string): boolean {
  if (previous === "" || current === "") return false;
  if (
    (CJK_CHARACTER.test(previous) && CJK_CHARACTER.test(current)) ||
    CLOSING_PUNCTUATION.test(current) ||
    OPENING_PUNCTUATION.test(previous)
  ) {
    return false;
  }
  return true;
}

interface CoordinateItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

function isCoordinateItem(value: unknown): value is CoordinateItem {
  return (
    typeof value === "object" &&
    value !== null &&
    "str" in value &&
    typeof (value as { str: unknown }).str === "string" &&
    (value as { str: string }).str !== "" &&
    "transform" in value &&
    Array.isArray((value as { transform: unknown }).transform) &&
    (value as { transform: unknown[] }).transform.length >= 6
  );
}

/**
 * Reconstructs layout-aware, structured Markdown from raw PDF.js text items
 * using 2D spatial coordinate clustering (top-to-bottom descending Y, left-to-right ascending X).
 */
export function extractStructuredPdfMarkdown(
  items: readonly unknown[],
): string {
  const coordItems = items.filter(isCoordinateItem);
  if (coordItems.length === 0) {
    return joinPdfTextItems(items);
  }

  // 1. Cluster text items into horizontal line groups by Y coordinate
  const lineClusters: Array<{
    y: number;
    height: number;
    items: CoordinateItem[];
  }> = [];

  for (const item of coordItems) {
    const y = item.transform[5] ?? 0;
    const height = Math.max(
      item.height || Math.abs(item.transform[3] ?? 10),
      8,
    );
    const existingLine = lineClusters.find(
      (line) => Math.abs(line.y - y) <= Math.max(height * 0.45, 4),
    );
    if (existingLine) {
      existingLine.items.push(item);
      existingLine.height = Math.max(existingLine.height, height);
    } else {
      lineClusters.push({ y, height, items: [item] });
    }
  }

  // 2. Sort lines from top of the page to bottom (PDF Y-coordinate is bottom-origin, so descending Y)
  lineClusters.sort((a, b) => b.y - a.y);

  // 3. For each line, sort items from left to right (ascending X)
  const lines: string[] = [];
  let prevY: number | null = null;
  let prevHeight = 12;

  for (const line of lineClusters) {
    line.items.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0));

    let lineStr = "";
    let prevItemEnd = -1;
    let prevChar = "";

    for (const item of line.items) {
      const x = item.transform[4] ?? 0;
      const firstChar = item.str[0] ?? "";

      if (
        lineStr !== "" &&
        prevItemEnd >= 0 &&
        x - prevItemEnd > 2 &&
        needsSpace(prevChar, firstChar)
      ) {
        lineStr += " ";
      }

      lineStr += item.str;
      prevItemEnd = x + (item.width || 0);
      prevChar = item.str.at(-1) ?? prevChar;
    }

    const trimmed = lineStr.trim();
    if (trimmed.length === 0) continue;

    // Detect paragraph breaks based on vertical gap
    if (prevY !== null) {
      const vGap = prevY - line.y;
      if (vGap > prevHeight * 1.8) {
        lines.push("");
      }
    }

    lines.push(trimmed);
    prevY = line.y;
    prevHeight = line.height;
  }

  return lines.join("\n");
}

async function renderPageToDataUrl(page: unknown): Promise<string | undefined> {
  try {
    if (
      typeof page !== "object" ||
      page === null ||
      !("getViewport" in page) ||
      !("render" in page)
    ) {
      return undefined;
    }
    const pdfPage = page as {
      getViewport(options: { scale: number }): {
        width: number;
        height: number;
      };
      render(options: {
        canvasContext: CanvasRenderingContext2D;
        viewport: { width: number; height: number };
      }): { promise: Promise<void> };
    };
    if (typeof document === "undefined") return undefined;
    const viewport = pdfPage.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(viewport.width, 1600);
    canvas.height = Math.min(viewport.height, 2400);
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return undefined;
  }
}

export async function extractLocalFileContent(
  file: File,
): Promise<LocalComposerFile | undefined> {
  try {
    if (file.name.endsWith(".pdf") || file.type === "application/pdf") {
      const buffer = await file.arrayBuffer();
      const task = getDocument({ data: new Uint8Array(buffer) });
      const pdf = await task.promise;
      const pagesText: string[] = [];
      const numPages = Math.min(pdf.numPages, 40);
      let totalExtractedLength = 0;

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageString = extractStructuredPdfMarkdown(textContent.items);
        if (pageString.trim().length > 0) {
          totalExtractedLength += pageString.trim().length;
          pagesText.push(`### 第 ${i} 页\n${pageString.trim()}`);
        }
      }

      // If text layer is missing or very sparse (e.g. scanned exam papers), render pages to images
      const isScanned =
        pagesText.length === 0 ||
        totalExtractedLength < Math.max(20, numPages * 10);

      let pageImages: string[] | undefined;
      if (isScanned) {
        const visionPages = Math.min(pdf.numPages, 8);
        const rendered: Array<string | undefined> = [];
        for (let i = 1; i <= visionPages; i++) {
          const page = await pdf.getPage(i);
          const dataUrl = await renderPageToDataUrl(page);
          rendered.push(dataUrl);
        }
        const validImages = rendered.filter(
          (url): url is string => url !== undefined,
        );
        if (validImages.length > 0) {
          pageImages = validImages;
        }
      }

      let finalText: string;
      if (pagesText.length > 0 && !isScanned) {
        finalText = pagesText.join("\n\n");
      } else if (pageImages && pageImages.length > 0) {
        finalText = `（扫描版 PDF，共 ${pdf.numPages} 页，已提取前 ${pageImages.length} 页高清视觉图元送入模型解析）`;
      } else {
        finalText =
          pagesText.length > 0
            ? pagesText.join("\n\n")
            : `（注：【${file.name}】未检测到可提取的文本层）`;
      }

      return {
        name: file.name,
        size: file.size,
        text: finalText,
        pageCount: pdf.numPages,
        images: pageImages,
        isScanned,
      };
    }

    if (
      file.type.startsWith("text/") ||
      file.name.endsWith(".txt") ||
      file.name.endsWith(".md") ||
      file.name.endsWith(".json")
    ) {
      const text = await file.text();
      return {
        name: file.name,
        size: file.size,
        text: text.slice(0, 60_000),
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}
