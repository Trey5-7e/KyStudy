import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import {
  buildResourceProtocolUrl,
  type ResourceReaderDescriptor,
} from "../../shared/tauri/resourceClient";
import type {
  IndexedQuestionDraft,
  SectionPart,
} from "../../shared/tauri/questionBankClient";
import type { QuestionType } from "../../shared/tauri/questionClient";
import type { OcrPageRecognition } from "../../shared/tauri/ocrClient";
import { openPdf } from "../library/pdf/pdfEngine";
import { HttpRangeSource } from "../library/pdf/rangeSource";

export interface DetectedPdfSubject {
  key: string;
  suggestedName: string;
  sourceHeading: string;
  pageStart: number;
  pageEnd: number;
  questions: IndexedQuestionDraft[];
  warningCount: number;
  ocrPageCount: number;
}

export interface OutlineNode {
  title: string;
  path: string[];
  pageNumber: number;
  top: number;
}

export interface PageItem {
  text: string;
  x: number;
  top: number;
  height?: number;
  source?: "text" | "ocr";
  confidence?: number;
}

export interface QuestionVerticalBounds {
  top: number;
  bottom: number;
}

export type QuestionNumberStyle = "parenthesized" | "decimal";

interface ContextState {
  chapter: string;
  sectionPart: SectionPart;
  questionType?: QuestionType;
}

interface LocatedDraft {
  draft: IndexedQuestionDraft;
  pageNumber: number;
  top: number;
}

interface PageSnapshot {
  pageNumber: number;
  width: number;
  height: number;
  items: PageItem[];
}

export interface AnalyzeWorkbookPdfOptions {
  signal?: AbortSignal;
  recognizePage?: PdfPageRecognizer;
  /** Test seam for the bounded, per-page PNG render. */
  renderPage?: PdfPageRenderer;
  onProgress?: (progress: AnalyzeWorkbookPdfProgress) => void;
}

export interface AnalyzeWorkbookPdfProgress {
  phase: "outline" | "text" | "ocr" | "complete";
  page?: number;
  pageStart?: number;
  pageEnd?: number;
  subject?: string;
  ocrPageCount?: number;
  warningCount?: number;
}

export type PdfPageRecognizer = (
  pageNumber: number,
  imageBytes: Uint8Array,
) => Promise<OcrPageRecognition>;

export type PdfPageRenderer = (
  page: PDFPageProxy,
  viewport: ReturnType<PDFPageProxy["getViewport"]>,
  signal?: AbortSignal,
) => Promise<Uint8Array>;

export class WorkbookPdfAnalyzeCanceledError extends Error {
  constructor() {
    super("PDF_INDEX_CANCELED");
    this.name = "WorkbookPdfAnalyzeCanceledError";
  }
}

function throwIfCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WorkbookPdfAnalyzeCanceledError();
  }
}

const QUESTION_NUMBER = /^\s*[（(]\s*(\d{1,3})\s*[)）]/;
const DECIMAL_QUESTION_NUMBER = /^\s*(\d{1,3})\s*[.．、]/;
const DECIMAL_MAX_X = 0.14;
const PARENTHESIZED_MAX_X = 0.22;
const CHAPTER_HEADING =
  /^第\s*[一二三四五六七八九十百零〇0-9]+\s*章(?:\s*.*)?$/;
const MAX_INDEXED_QUESTION_REGIONS = 12;
const MAX_CHAPTER_BYTES = 120;
const MARKER_MERGE_TOP_TOLERANCE = 0.03;
const MARKER_MERGE_X_TOLERANCE = 0.05;

interface ContinuationRegionResult {
  handled: boolean;
  truncated: boolean;
}

export async function analyzeWorkbookPdf(
  descriptor: ResourceReaderDescriptor,
  onProgress: (message: string) => void,
  options: AnalyzeWorkbookPdfOptions = {},
): Promise<DetectedPdfSubject[]> {
  throwIfCanceled(options.signal);
  const source = new HttpRangeSource(
    descriptor.title,
    descriptor.sizeBytes,
    buildResourceProtocolUrl(descriptor.documentId, "pdf"),
  );
  const session = await openPdf(source);
  try {
    throwIfCanceled(options.signal);
    onProgress("正在读取 PDF 书签目录…");
    options.onProgress?.({ phase: "outline" });
    const outline = await resolveOutline(session.document);
    const subjects = detectSubjects(
      outline,
      session.document.numPages,
      descriptor.title,
    );
    const results: DetectedPdfSubject[] = [];
    for (const [subjectIndex, subject] of subjects.entries()) {
      throwIfCanceled(options.signal);
      onProgress(
        `正在解析${subject.suggestedName}：第 ${subject.pageStart}/${subject.pageEnd} 页…`,
      );
      options.onProgress?.({
        phase: "text",
        pageStart: subject.pageStart,
        pageEnd: subject.pageEnd,
        subject: subject.suggestedName,
      });
      const parsed = await parseSubjectPages(
        session.document,
        outline,
        subject,
        (page) =>
          onProgress(
            `正在解析${subject.suggestedName}：第 ${page}/${subject.pageEnd} 页`,
          ),
        options,
      );
      results.push({
        ...subject,
        questions: parsed.questions,
        warningCount: parsed.warningCount,
        ocrPageCount: parsed.ocrPageCount,
      });
      options.onProgress?.({
        phase: "complete",
        pageStart: subject.pageStart,
        pageEnd: subject.pageEnd,
        subject: subject.suggestedName,
        ocrPageCount: parsed.ocrPageCount,
        warningCount: parsed.warningCount,
      });
      onProgress(
        `已完成 ${subjectIndex + 1}/${subjects.length} 个科目，共识别 ${parsed.questions.length} 道题。`,
      );
    }
    return results;
  } finally {
    await session.destroy();
  }
}

async function resolveOutline(
  document: PDFDocumentProxy,
): Promise<OutlineNode[]> {
  const raw = await document.getOutline();
  if (raw === null) return [];
  const nodes: OutlineNode[] = [];
  await walkOutline(document, raw, [], nodes);
  return nodes.sort(comparePosition);
}

async function walkOutline(
  document: PDFDocumentProxy,
  values: readonly unknown[],
  ancestors: string[],
  output: OutlineNode[],
): Promise<void> {
  for (const value of values) {
    if (!isRecord(value) || typeof value.title !== "string") continue;
    const title = normalizeText(value.title);
    const path = [...ancestors, title];
    const position = await resolveDestination(document, value.dest);
    if (position !== undefined) output.push({ title, path, ...position });
    if (Array.isArray(value.items)) {
      await walkOutline(document, value.items, path, output);
    }
  }
}

async function resolveDestination(
  document: PDFDocumentProxy,
  rawDestination: unknown,
): Promise<{ pageNumber: number; top: number } | undefined> {
  const destination =
    typeof rawDestination === "string"
      ? await document.getDestination(rawDestination)
      : Array.isArray(rawDestination)
        ? rawDestination
        : null;
  if (destination === null || destination.length === 0) return undefined;
  try {
    const pageIndex = await document.getPageIndex(destination[0] as never);
    const page = await document.getPage(pageIndex + 1);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const pdfTop =
        typeof destination[3] === "number" ? destination[3] : viewport.height;
      return {
        pageNumber: pageIndex + 1,
        top: clamp(1 - pdfTop / viewport.height, 0.04, 0.95),
      };
    } finally {
      page.cleanup();
    }
  } catch {
    return undefined;
  }
}

export function detectSubjects(
  outline: OutlineNode[],
  pageCount: number,
  documentTitle?: string,
): Array<
  Omit<DetectedPdfSubject, "questions" | "warningCount" | "ocrPageCount">
> {
  const ordered = outline
    .filter((node) => node.pageNumber >= 1 && node.pageNumber <= pageCount)
    .sort(comparePosition);
  const explicit = uniqueSubjectRoots(ordered);
  const title = normalizeText(documentTitle ?? "");
  const titleSubject = subjectName(title);
  const mixedTitle =
    isMixedSubjectTitle(title) ||
    ordered.some((node) => isMixedSubjectTitle(node.title));

  let candidates: SubjectRoot[];
  if (mixedTitle) {
    const inferred = inferMixedSubjectRoots(ordered);
    candidates = inferred.length > 0 ? inferred : explicit;
  } else {
    candidates = explicit;
    if (titleSubject !== undefined && candidates.length === 1) {
      const firstOutlinePage = ordered[0]?.pageNumber;
      if (firstOutlinePage !== undefined) {
        candidates = candidates.map((candidate) => ({
          ...candidate,
          pageNumber: firstOutlinePage,
        }));
      }
    }
  }
  if (candidates.length === 0 && titleSubject !== undefined) {
    candidates = [
      {
        title: title || titleSubject,
        sourceHeading: title || titleSubject,
        suggestedName: titleSubject,
        pageNumber: ordered[0]?.pageNumber ?? 1,
        top: 0,
      },
    ];
  }
  if (candidates.length === 0) {
    return [
      {
        key: "subject-1",
        suggestedName: "待确认科目",
        sourceHeading: "PDF 全部内容",
        pageStart: 1,
        pageEnd: pageCount,
      },
    ];
  }

  return candidates.map((node, index) => ({
    key: `subject-${index + 1}`,
    suggestedName: node.suggestedName,
    sourceHeading: node.sourceHeading,
    pageStart: Math.max(1, Math.min(pageCount, node.pageNumber)),
    pageEnd: Math.max(
      Math.max(1, Math.min(pageCount, node.pageNumber)),
      Math.min(
        pageCount,
        (candidates[index + 1]?.pageNumber ?? pageCount + 1) - 1,
      ),
    ),
  }));
}

interface SubjectRoot {
  title: string;
  sourceHeading: string;
  suggestedName: string;
  pageNumber: number;
  top: number;
}

function uniqueSubjectRoots(outline: readonly OutlineNode[]): SubjectRoot[] {
  const roots: SubjectRoot[] = [];
  const seen = new Set<string>();
  for (const node of outline) {
    const name = subjectName(node.title);
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    roots.push({
      title: node.title,
      sourceHeading: node.title,
      suggestedName: name,
      pageNumber: node.pageNumber,
      top: node.top,
    });
  }
  return roots;
}

function inferMixedSubjectRoots(
  outline: readonly OutlineNode[],
): SubjectRoot[] {
  const roots: SubjectRoot[] = [];
  let current: string | undefined;
  for (const node of outline) {
    const semantic = chapterSubjectSemantic(node.title);
    if (
      semantic === undefined ||
      semantic === "higher" ||
      semantic === current
    ) {
      continue;
    }
    current = semantic;
    roots.push({
      title: node.title,
      sourceHeading: node.title,
      suggestedName:
        semantic === "linear"
          ? "线性代数"
          : semantic === "probability"
            ? "概率论与数理统计"
            : "高等数学",
      pageNumber: node.pageNumber,
      top: node.top,
    });
  }
  return roots;
}

async function parseSubjectPages(
  document: PDFDocumentProxy,
  outline: OutlineNode[],
  subject: Omit<
    DetectedPdfSubject,
    "questions" | "warningCount" | "ocrPageCount"
  >,
  onPage: (page: number) => void,
  options: AnalyzeWorkbookPdfOptions,
): Promise<{
  questions: IndexedQuestionDraft[];
  warningCount: number;
  ocrPageCount: number;
}> {
  const context: ContextState = {
    chapter: "未分章",
    sectionPart: "other",
  };
  const located: LocatedDraft[] = [];
  const sourceKeyOccurrences = new Map<string, number>();
  let warningCount = 0;
  let ocrPageCount = 0;
  const pages: PageSnapshot[] = [];
  for (
    let pageNumber = subject.pageStart;
    pageNumber <= subject.pageEnd;
    pageNumber += 1
  ) {
    onPage(pageNumber);
    throwIfCanceled(options.signal);
    const page = await document.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const textItems = content.items
        .flatMap((item) => toPageItem(item, viewport.width, viewport.height))
        .filter((item) => item.top >= 0.04 && item.top <= 0.95)
        .sort((left, right) => left.top - right.top || left.x - right.x);
      let items = textItems;
      if (options.recognizePage !== undefined && pageNeedsOcr(textItems)) {
        ocrPageCount += 1;
        options.onProgress?.({
          phase: "ocr",
          page: pageNumber,
          pageStart: subject.pageStart,
          pageEnd: subject.pageEnd,
          subject: subject.suggestedName,
          ocrPageCount,
        });
        try {
          throwIfCanceled(options.signal);
          const imageBytes = await (options.renderPage ?? renderPageForOcr)(
            page,
            viewport,
            options.signal,
          );
          throwIfCanceled(options.signal);
          const recognition = await options.recognizePage(
            pageNumber,
            imageBytes,
          );
          throwIfCanceled(options.signal);
          const ocrItems = ocrRecognitionToPageItems(recognition);
          if (ocrItems.length > 0) {
            items = mergePageItems(textItems, ocrItems);
          }
        } catch (error: unknown) {
          throwIfCanceled(options.signal);
          warningCount += 1;
          options.onProgress?.({
            phase: "ocr",
            page: pageNumber,
            pageStart: subject.pageStart,
            pageEnd: subject.pageEnd,
            subject: subject.suggestedName,
            ocrPageCount,
            warningCount,
          });
          if (error instanceof WorkbookPdfAnalyzeCanceledError) throw error;
        }
      }
      pages.push({
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        items,
      });
    } finally {
      page.cleanup();
    }
  }

  const repeatedChrome = findRepeatedChromeKeys(pages, pages.length);
  let numberStyle: QuestionNumberStyle | undefined;
  for (const page of pages) {
    const items = filterPageItems(page.items, repeatedChrome);
    const pageStyle = detectQuestionNumberStyle(items);
    if (pageStyle === "decimal") numberStyle = "decimal";
    else if (numberStyle === undefined) numberStyle = pageStyle;
    const questionMarkers = new Map(
      findQuestionMarkers(items, numberStyle).map((marker) => [
        marker.item,
        marker.number,
      ]),
    );
    applyOutlineContext(context, outline, subject, page.pageNumber, 0);
    const anchors: Array<{
      item: PageItem;
      number: string;
      context: ContextState;
    }> = [];
    for (const item of items) {
      applyOutlineContext(context, outline, subject, page.pageNumber, item.top);
      const heading = classifyHeading(item.text);
      if (heading !== undefined) {
        Object.assign(context, heading);
        continue;
      }
      const number = questionMarkers.get(item);
      if (number !== undefined) {
        anchors.push({ item, number, context: { ...context } });
      }
    }

    const verticalBounds = inferQuestionVerticalBounds(
      items,
      anchors.map((anchor) => anchor.item.top),
    );
    if (anchors.length === 0) {
      const continuation = appendContinuationRegion(
        located,
        page.pageNumber,
        items,
      );
      if (continuation.handled) {
        if (continuation.truncated) warningCount += 1;
        continue;
      }
      if (hasBodyItems(items)) warningCount += 1;
      continue;
    }

    const firstAnchorTop = anchors[0]?.item.top ?? 0.95;
    const firstVisualTop = verticalBounds[0]?.top ?? firstAnchorTop;
    if (
      located.length > 0 &&
      !hasStructuralHeadingBefore(items, firstVisualTop)
    ) {
      const continuation = appendContinuationRegion(
        located,
        page.pageNumber,
        items.filter((item) => item.top < firstVisualTop),
      );
      if (continuation.truncated) warningCount += 1;
    }

    for (const [index, anchor] of anchors.entries()) {
      const structuralTop = nextStructuralHeadingTop(items, anchor.item.top);
      const inferred = verticalBounds[index];
      if (inferred === undefined) {
        warningCount += 1;
        continue;
      }
      const bottom = Math.max(
        inferred.top + 0.012,
        Math.min(inferred.bottom, structuralTop ?? 0.95, 0.95),
      );
      const top = inferred.top;
      const region = viewportRegion(page.pageNumber, top, bottom);
      if (region.height <= 0.002) {
        warningCount += 1;
        continue;
      }
      const regionItems = items.filter(
        (item) => item.top >= top - 0.004 && item.top <= bottom + 0.004,
      );
      const questionType =
        anchor.context.questionType ?? inferQuestionType(regionItems);
      const baseConfidence =
        anchor.context.chapter === "未分章" ||
        anchor.context.sectionPart === "other" ||
        questionType === "other"
          ? 0.72
          : 0.96;
      const ocrDetected = regionItems.some((item) => item.source === "ocr");
      const safeChapter = truncateUtf8(
        anchor.context.chapter,
        MAX_CHAPTER_BYTES,
      );
      const pageQuestionOrdinal = index + 1;
      const baseSourceKey = `${safeChapter}|${anchor.context.sectionPart}|${questionType}|${anchor.number}|${page.pageNumber}`;
      const occurrence = sourceKeyOccurrences.get(baseSourceKey) ?? 0;
      sourceKeyOccurrences.set(baseSourceKey, occurrence + 1);
      const sourceKey =
        occurrence === 0
          ? baseSourceKey
          : `${baseSourceKey}|${pageQuestionOrdinal}`;
      located.push({
        pageNumber: page.pageNumber,
        top,
        draft: {
          sourceKey,
          title: truncateUtf8(`第 ${anchor.number} 题`, 200),
          chapter: safeChapter,
          sectionPart: anchor.context.sectionPart,
          questionType,
          questionNumber: truncateUtf8(anchor.number, 60),
          indexConfidence: ocrDetected
            ? Math.min(baseConfidence, 0.72)
            : baseConfidence,
          regions: [region],
        },
      });
    }
  }
  return {
    questions: [...located]
      .sort(
        (left, right) =>
          left.pageNumber - right.pageNumber || left.top - right.top,
      )
      .map((value) => value.draft),
    warningCount,
    ocrPageCount,
  };
}

const OCR_RENDER_LONG_EDGE = 1_800;
const OCR_MIN_PAGE_ITEMS = 4;
const OCR_MIN_PAGE_CHARACTERS = 32;

export function pageNeedsOcr(items: readonly PageItem[]): boolean {
  const body = items.filter(
    (item) =>
      item.top >= 0.08 &&
      item.top <= 0.9 &&
      !isPageChrome(item.text) &&
      classifyHeading(item.text) === undefined &&
      normalizeText(item.text) !== "",
  );
  const markers = findQuestionMarkers(items);
  const markerItems = new Set(markers.map((marker) => marker.item));
  if (
    markers.some((marker) => hasQuestionBody(items, marker.item, markerItems))
  ) {
    return false;
  }
  const characters = body.reduce(
    (total, item) => total + normalizeText(item.text).length,
    0,
  );
  return (
    body.length < OCR_MIN_PAGE_ITEMS || characters < OCR_MIN_PAGE_CHARACTERS
  );
}

function hasQuestionBody(
  items: readonly PageItem[],
  marker: PageItem,
  markerItems: ReadonlySet<PageItem>,
): boolean {
  if (inlineQuestionBody(marker)) return true;
  return items.some(
    (item) => !markerItems.has(item) && isQuestionBodyItem(item),
  );
}

function isQuestionBodyItem(item: PageItem): boolean {
  const text = normalizeText(item.text);
  return (
    item.top >= 0.045 &&
    item.top <= 0.94 &&
    text !== "" &&
    classifyHeading(text) === undefined &&
    !isPageChrome(text) &&
    !isLikelyQuestionLabel(text)
  );
}

function inlineQuestionBody(item: PageItem): boolean {
  if (parseQuestionNumber(item.text, item.x) === undefined) return false;
  const normalized = normalizeText(item.text);
  const body = normalized
    .replace(/^\s*[（(]\s*\d{1,3}\s*[)）]/, "")
    .replace(/^\s*\d{1,3}\s*[.．、]/, "")
    .trim();
  return body.length > 0;
}

export function ocrRecognitionToPageItems(
  recognition: Pick<OcrPageRecognition, "lines">,
): PageItem[] {
  return recognition.lines
    .filter(
      (line) =>
        normalizeText(line.text) !== "" &&
        line.x >= 0 &&
        line.y >= 0 &&
        line.width > 0 &&
        line.height > 0 &&
        line.x + line.width <= 1.001 &&
        line.y + line.height <= 1.001,
    )
    .map((line) => ({
      text: normalizeText(line.text),
      x: clamp(line.x, 0, 1),
      top: clamp(line.y, 0, 1),
      height: clamp(line.height, 0.001, 1),
      source: "ocr" as const,
      confidence: clamp(line.confidence, 0, 1),
    }))
    .sort((left, right) => left.top - right.top || left.x - right.x);
}

function mergePageItems(
  textItems: readonly PageItem[],
  ocrItems: readonly PageItem[],
): PageItem[] {
  const merged = [...textItems];
  for (const ocrItem of ocrItems) {
    const duplicate = merged.some(
      (textItem) =>
        comparableText(textItem.text) === comparableText(ocrItem.text) &&
        Math.abs(textItem.x - ocrItem.x) <= 0.025 &&
        Math.abs(textItem.top - ocrItem.top) <= 0.025,
    );
    if (!duplicate) merged.push(ocrItem);
  }
  return merged.sort((left, right) => left.top - right.top || left.x - right.x);
}

function comparableText(value: string): string {
  return normalizeText(value)
    .replace(/[！-～]/g, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    )
    .replace(/　/g, " ");
}

async function renderPageForOcr(
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

function filterPageItems(
  items: readonly PageItem[],
  repeatedChrome: ReadonlySet<string>,
): PageItem[] {
  return items.filter(
    (item) => !isPageChrome(item.text) && !repeatedChrome.has(chromeKey(item)),
  );
}

function findRepeatedChromeKeys(
  pages: readonly PageSnapshot[],
  pageCount: number,
): Set<string> {
  const occurrences = new Map<string, Set<number>>();
  for (const page of pages) {
    const seenOnPage = new Set<string>();
    for (const item of page.items) {
      if (classifyHeading(item.text) !== undefined || isPageChrome(item.text)) {
        continue;
      }
      if (
        parseQuestionNumber(item.text, item.x) !== undefined ||
        isLikelyQuestionLabel(item.text)
      ) {
        continue;
      }
      const key = chromeKey(item);
      if (seenOnPage.has(key)) continue;
      seenOnPage.add(key);
      const pageSet = occurrences.get(key) ?? new Set<number>();
      pageSet.add(page.pageNumber);
      occurrences.set(key, pageSet);
    }
  }
  const minimumOccurrences = Math.max(3, Math.ceil(pageCount * 0.05));
  return new Set(
    [...occurrences.entries()]
      .filter(([, pageNumbers]) => pageNumbers.size >= minimumOccurrences)
      .map(([key]) => key),
  );
}

function isLikelyQuestionLabel(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    /^\d{1,3}$/.test(normalized) ||
    /^[A-DＡ-Ｄ](?:[.．、:：)）])?$/.test(normalized) ||
    isOpeningParenthesis({ text: normalized, x: 0, top: 0 }) ||
    isClosingParenthesis({ text: normalized, x: 0, top: 0 })
  );
}

function chromeKey(item: PageItem): string {
  return `${normalizeText(item.text)}|${Math.round(item.x / 0.02)}|${Math.round(
    item.top / 0.02,
  )}`;
}

function appendContinuationRegion(
  located: LocatedDraft[],
  pageNumber: number,
  items: readonly PageItem[],
): ContinuationRegionResult {
  const previous = located.at(-1);
  if (previous === undefined || hasStructuralHeadingBefore(items, 0.94)) {
    return { handled: false, truncated: false };
  }
  const body = items.filter(isContinuationBodyItem);
  if (body.length === 0) return { handled: false, truncated: false };
  if (previous.draft.regions.length >= MAX_INDEXED_QUESTION_REGIONS) {
    return { handled: true, truncated: true };
  }
  const top = clamp(
    Math.min(...body.map((item) => item.top)) - 0.006,
    0.05,
    0.94,
  );
  const bottom = clamp(
    Math.max(...body.map((item) => item.top + (item.height ?? 0.012))) + 0.018,
    top + 0.012,
    0.94,
  );
  if (bottom - top <= 0.002) return { handled: false, truncated: false };
  if (
    previous.draft.regions.some((region) => region.pageNumber === pageNumber)
  ) {
    return { handled: true, truncated: false };
  }
  previous.draft.regions.push(viewportRegion(pageNumber, top, bottom));
  return { handled: true, truncated: false };
}

function isContinuationBodyItem(item: PageItem): boolean {
  return (
    item.top >= 0.05 &&
    item.top <= 0.92 &&
    classifyHeading(item.text) === undefined &&
    !isPageChrome(item.text) &&
    normalizeText(item.text).length > 0
  );
}

function hasBodyItems(items: readonly PageItem[]): boolean {
  return items.some(isContinuationBodyItem);
}

function hasStructuralHeadingBefore(
  items: readonly PageItem[],
  top: number,
): boolean {
  return items.some(
    (item) => item.top < top && classifyHeading(item.text) !== undefined,
  );
}

function toPageItem(
  value: unknown,
  pageWidth: number,
  pageHeight: number,
): PageItem[] {
  if (
    !isRecord(value) ||
    typeof value.str !== "string" ||
    !Array.isArray(value.transform) ||
    typeof value.transform[4] !== "number" ||
    typeof value.transform[5] !== "number"
  ) {
    return [];
  }
  const text = normalizeText(value.str);
  if (text === "") return [];
  const fontHeight =
    typeof value.height === "number"
      ? value.height
      : Math.abs(Number(value.transform[3] ?? 0));
  return [
    {
      text,
      x: clamp(value.transform[4] / pageWidth, 0, 1),
      top: clamp(
        (pageHeight - value.transform[5] - fontHeight) / pageHeight,
        0,
        1,
      ),
      height: clamp(fontHeight / pageHeight, 0.001, 1),
      source: "text",
    },
  ];
}

export function inferQuestionVerticalBounds(
  items: readonly PageItem[],
  anchorTops: readonly number[],
): QuestionVerticalBounds[] {
  const contentItems = items.filter(
    (item) =>
      item.top >= 0.045 &&
      item.top <= 0.94 &&
      classifyHeading(item.text) === undefined &&
      !isPageChrome(item.text),
  );
  const visualStarts = anchorTops.map((anchorTop, index) =>
    inferVisualStart(contentItems, anchorTop, anchorTops[index - 1] ?? 0.04),
  );
  return visualStarts.map((visualStart, index) => {
    const top = clamp(visualStart - 0.006, 0.05, 0.94);
    const nextVisualStart = visualStarts[index + 1];
    const limit =
      nextVisualStart === undefined ? 0.94 : nextVisualStart - 0.004;
    const questionItems = contentItems.filter(
      (item) => item.top >= top - 0.004 && item.top < limit,
    );
    const lastContentBottom = questionItems.reduce(
      (maximum, item) => Math.max(maximum, item.top + (item.height ?? 0.012)),
      top + 0.012,
    );
    const availableGap = Math.max(0, limit - lastContentBottom);
    const bottom =
      nextVisualStart === undefined
        ? Math.min(0.94, lastContentBottom + Math.min(0.018, availableGap))
        : Math.min(limit, lastContentBottom + availableGap / 2);
    return { top, bottom: Math.max(top + 0.012, bottom) };
  });
}

function inferVisualStart(
  items: readonly PageItem[],
  anchorTop: number,
  previousAnchorTop: number,
): number {
  const lowerLimit = Math.max(0.045, previousAnchorTop + 0.004);
  let currentTop = anchorTop;
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      const itemBottom = item.top + (item.height ?? 0.012);
      if (
        item.top >= lowerLimit &&
        item.top < currentTop &&
        item.top >= anchorTop - 0.2 &&
        itemBottom >= currentTop - 0.022
      ) {
        currentTop = item.top;
        changed = true;
      }
    }
  }
  return currentTop;
}

function isPageChrome(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    /第\s*\d+\s*页(?:\s*[,，/]?\s*共\s*\d+\s*页)?/i.test(normalized) ||
    /\bPage\s*\d+\s*(?:of|\/)\s*\d+\b/i.test(normalized) ||
    /公众号|微信公众号|张宇\s*1000\s*题|EduEditer|https?:\/\/|www\./i.test(
      normalized,
    )
  );
}

export function parseQuestionNumber(
  text: string,
  normalizedX: number,
): string | undefined {
  const normalized = normalizeText(text);
  const parenthesized = QUESTION_NUMBER.exec(normalized)?.[1];
  if (
    parenthesized !== undefined &&
    Number.isFinite(normalizedX) &&
    normalizedX <= PARENTHESIZED_MAX_X
  ) {
    return parenthesized;
  }
  if (!Number.isFinite(normalizedX) || normalizedX > DECIMAL_MAX_X) {
    return undefined;
  }
  const decimal = DECIMAL_QUESTION_NUMBER.exec(normalized);
  if (decimal !== null && !/^\s*\d{1,3}\s*[.．、]\s*\d/.test(normalized)) {
    return decimal[1];
  }
  return undefined;
}

export function detectQuestionNumberStyle(
  items: readonly PageItem[],
): QuestionNumberStyle {
  const filtered = items.filter(
    (item) =>
      item.x <= DECIMAL_MAX_X &&
      !isPageChrome(item.text) &&
      classifyHeading(item.text) === undefined,
  );
  if (hasDecimalMarker(filtered)) return "decimal";
  return "parenthesized";
}

export function findQuestionMarkers(
  items: readonly PageItem[],
  style?: QuestionNumberStyle,
): Array<{ item: PageItem; number: string }> {
  const markers: Array<{ item: PageItem; number: string }> = [];
  const effectiveStyle = style ?? detectQuestionNumberStyle(items);
  const filtered = items.filter((item) => !isPageChrome(item.text));
  for (const [index, item] of filtered.entries()) {
    const combined = parseQuestionNumber(item.text, item.x);
    if (
      combined !== undefined &&
      (effectiveStyle === "decimal"
        ? !isParenthesizedText(item.text)
        : isParenthesizedText(item.text))
    ) {
      markers.push({ item, number: combined });
      continue;
    }
    if (
      effectiveStyle === "decimal" ||
      !isOpeningParenthesis(item) ||
      item.x > PARENTHESIZED_MAX_X
    ) {
      continue;
    }
    const number = filtered[index + 1];
    const closing = filtered[index + 2];
    if (
      number !== undefined &&
      closing !== undefined &&
      /^\d{1,3}$/.test(number.text) &&
      isClosingParenthesis(closing) &&
      sameLine(item, number) &&
      sameLine(item, closing) &&
      number.x - item.x < 0.035 &&
      closing.x - item.x < 0.05
    ) {
      markers.push({ item, number: number.text });
    }
  }
  for (const [index, item] of filtered.entries()) {
    if (effectiveStyle !== "decimal" || item.x > DECIMAL_MAX_X) continue;
    if (parseQuestionNumber(item.text, item.x) !== undefined) continue;
    const number = /^\s*\d{1,3}\s*$/.test(item.text)
      ? item.text.trim()
      : undefined;
    const punctuation = filtered[index + 1];
    if (
      number !== undefined &&
      punctuation !== undefined &&
      /^[.．、]$/.test(punctuation.text) &&
      sameLine(item, punctuation) &&
      punctuation.x - item.x < 0.04
    ) {
      markers.push({ item, number });
    }
  }
  return deduplicateQuestionMarkers(markers);
}

function deduplicateQuestionMarkers(
  markers: readonly { item: PageItem; number: string }[],
): Array<{ item: PageItem; number: string }> {
  const deduplicated: Array<{ item: PageItem; number: string }> = [];
  for (const marker of markers) {
    const duplicateIndex = deduplicated.findIndex(
      (candidate) =>
        candidate.number === marker.number &&
        Math.abs(candidate.item.top - marker.item.top) <=
          MARKER_MERGE_TOP_TOLERANCE &&
        Math.abs(candidate.item.x - marker.item.x) <=
          MARKER_MERGE_X_TOLERANCE &&
        markersLikelyShareSource(candidate.item, marker.item),
    );
    if (duplicateIndex < 0) {
      deduplicated.push(marker);
      continue;
    }
    const current = deduplicated[duplicateIndex]!;
    if (markerPreference(marker.item) < markerPreference(current.item)) {
      deduplicated[duplicateIndex] = marker;
    }
  }
  return deduplicated;
}

function markersLikelyShareSource(left: PageItem, right: PageItem): boolean {
  if (left === right) return true;
  if (left.source === "text" && right.source === "text") return false;
  if (left.source === "ocr" && right.source === "ocr") return false;
  return left.source !== right.source;
}

function markerPreference(item: PageItem): number {
  if (item.source === "text") return 0;
  if (item.source === undefined) return 1;
  return 2;
}

function isOpeningParenthesis(item: PageItem): boolean {
  return item.text === "(" || item.text === "（";
}

function isClosingParenthesis(item: PageItem): boolean {
  return item.text === ")" || item.text === "）";
}

function sameLine(left: PageItem, right: PageItem): boolean {
  return Math.abs(left.top - right.top) <= 0.003;
}

function isParenthesizedText(text: string): boolean {
  return QUESTION_NUMBER.test(normalizeText(text));
}

function hasDecimalMarker(items: readonly PageItem[]): boolean {
  for (const [index, item] of items.entries()) {
    const text = normalizeText(item.text);
    if (DECIMAL_QUESTION_NUMBER.test(text)) {
      const next = items[index + 1];
      const isParenthesizedMiddle =
        /^\s*\d{1,3}\s*$/.test(text) &&
        next !== undefined &&
        isClosingParenthesis(next);
      if (!isParenthesizedMiddle && !/^\s*\d{1,3}\s*\.\s*\d/.test(text)) {
        return true;
      }
    }
    const next = items[index + 1];
    if (
      /^\s*\d{1,3}\s*$/.test(text) &&
      next !== undefined &&
      /^[.．、]$/.test(next.text) &&
      sameLine(item, next) &&
      next.x - item.x < 0.04
    ) {
      return true;
    }
  }
  return false;
}

export function classifyHeading(
  text: string,
): Partial<ContextState> | undefined {
  const normalized = normalizeText(text).replace(
    /^(?:[一二三四五六七八九十百零〇0-9]+、)\s*/,
    "",
  );
  if (CHAPTER_HEADING.test(normalized)) {
    return { chapter: normalized };
  }
  if (containsAny(normalized, ["基础部分", "基础题"])) {
    return { sectionPart: "basic" };
  }
  if (
    containsAny(normalized, [
      "强化部分",
      "强化题",
      "综合题",
      "综合篇",
      "测试卷",
    ])
  ) {
    return { sectionPart: "comprehensive" };
  }
  if (containsAny(normalized, ["拓展部分", "拓展题"])) {
    return { sectionPart: "extended" };
  }
  if (normalized.includes("选择题")) return { questionType: "choice" };
  if (normalized.includes("填空题")) return { questionType: "blank" };
  if (containsAny(normalized, ["解答题", "证明题"])) {
    return { questionType: "solution" };
  }
  return undefined;
}

export function inferQuestionType(items: readonly PageItem[]): QuestionType {
  const text = items.map((item) => normalizeText(item.text)).join(" ");
  const optionLabels = new Set<string>();
  for (const [index, item] of items.entries()) {
    const normalized = normalizeText(item.text);
    const inline = /(?:^|\s)([A-DＡ-Ｄ])\s*[.．、:：)）]/g;
    for (const match of normalized.matchAll(inline)) {
      optionLabels.add(normalizeOptionLabel(match[1] ?? ""));
    }
    const next = items[index + 1];
    if (
      /^[A-DＡ-Ｄ]$/.test(normalized) &&
      next !== undefined &&
      /^[.．、:：)）]$/.test(next.text) &&
      sameLine(item, next)
    ) {
      optionLabels.add(normalizeOptionLabel(normalized));
    }
  }
  if (optionLabels.size >= 2) return "choice";
  if (/_{2,}|(?:_\s*){3,}|＿{2,}|﹍{2,}|﹏{2,}|-{3,}|—{3,}/.test(text)) {
    return "blank";
  }
  if (
    /求|计算|证明|解(?:答|方程|下列|\s*[：:]|$)|solve|calculate|prove|find\b/i.test(
      text,
    )
  ) {
    return "solution";
  }
  return "other";
}

function normalizeOptionLabel(value: string): string {
  return value.replace(/[Ａ-Ｄ]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0xfee0),
  );
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function applyOutlineContext(
  context: ContextState,
  outline: OutlineNode[],
  subject: Pick<DetectedPdfSubject, "pageStart" | "pageEnd">,
  pageNumber: number,
  top: number,
): void {
  const current = outline
    .filter(
      (node) =>
        node.pageNumber >= subject.pageStart &&
        node.pageNumber <= subject.pageEnd &&
        (node.pageNumber < pageNumber ||
          (node.pageNumber === pageNumber && node.top <= top)),
    )
    .at(-1);
  if (current === undefined) return;
  for (const title of current.path) {
    const heading = classifyHeading(title);
    if (heading !== undefined) Object.assign(context, heading);
  }
}

function nextStructuralHeadingTop(
  items: PageItem[],
  after: number,
): number | undefined {
  return items.find(
    (item) =>
      item.top > after + 0.005 && classifyHeading(item.text) !== undefined,
  )?.top;
}

function viewportRegion(pageNumber: number, top: number, bottom: number) {
  return {
    pageNumber,
    x: 0.07,
    y: clamp(1 - bottom, 0, 1),
    width: 0.86,
    height: clamp(bottom - top, 0.003, 0.94),
  };
}

function subjectName(title: string): string | undefined {
  const normalized = normalizeText(title);
  if (containsAny(normalized, ["高等数学", "高数篇", "高数", "数一高数"])) {
    return "高等数学";
  }
  if (containsAny(normalized, ["线性代数", "线代"])) return "线性代数";
  if (containsAny(normalized, ["概率论", "数理统计"])) {
    return "概率论与数理统计";
  }
  return undefined;
}

function isMixedSubjectTitle(title: string): boolean {
  const normalized = normalizeText(title);
  return (
    containsAny(normalized, [
      "线概篇",
      "线代概率",
      "线性代数/概率",
      "线性代数与概率",
    ]) ||
    (normalized.includes("线性代数") && normalized.includes("概率论"))
  );
}

type ChapterSubjectSemantic = "linear" | "probability" | "higher";

function chapterSubjectSemantic(
  title: string,
): ChapterSubjectSemantic | undefined {
  const normalized = normalizeText(title);
  if (
    containsAny(normalized, [
      "概率论",
      "数理统计",
      "随机变量",
      "随机事件",
      "概率分布",
      "数学期望",
      "大数定律",
      "中心极限定理",
    ])
  ) {
    return "probability";
  }
  if (
    containsAny(normalized, [
      "线性代数",
      "线代",
      "行列式",
      "矩阵",
      "向量",
      "线性方程",
      "特征值",
      "二次型",
    ])
  ) {
    return "linear";
  }
  if (containsAny(normalized, ["高等数学", "高数", "函数", "极限", "微积分"])) {
    return "higher";
  }
  return undefined;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).length <= maximumBytes) return value;
  const suffix = "…";
  const suffixBytes = encoder.encode(suffix).length;
  const budget = Math.max(0, maximumBytes - suffixBytes);
  let output = "";
  for (const character of value) {
    const next = output + character;
    if (encoder.encode(next).length > budget) break;
    output = next;
  }
  return output + suffix;
}

function comparePosition(left: OutlineNode, right: OutlineNode): number {
  return (
    left.pageNumber - right.pageNumber ||
    left.top - right.top ||
    left.path.length - right.path.length
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
