import type { PDFDocumentProxy } from "pdfjs-dist";

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
import {
  renderPdfPageForOcr,
  type PdfPageRecognizer,
  type PdfPageRenderer,
} from "../library/pdf/pdfOcr";
import { HttpRangeSource } from "../library/pdf/rangeSource";
import { selectOcrLinesForIndex } from "../library/pdf/pdfTextIndexerModel";
import type { WorkbookPdfAdaptationProfile } from "./workbookPdfProfiles";

export interface DetectedPdfSubject {
  key: string;
  profileId: string;
  suggestedName: string;
  sourceHeading: string;
  pageStart: number;
  pageEnd: number;
  questions: IndexedQuestionDraft[];
  warningCount: number;
  ocrPageCount: number;
  unresolvedMarkerCount: number;
  crossPageQuestionCount: number;
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

export type QuestionNumberStyle = "parenthesized" | "decimal" | "plain";

interface ContextState {
  chapter: string;
  sectionPart: SectionPart;
  questionType?: QuestionType;
  subChapter?: string;
}

interface MarkerSequenceState {
  contextKey: string;
  lastNumber: number;
}

const MARKER_SEQUENCE_MAX_STEP = 5;

/**
 * Question numbers run consecutively inside one chapter/part/type context.
 * Wrapped body lines that start with a digit at the left margin produce
 * phantom markers whose number repeats or goes backwards; those are dropped.
 */
function anchorPassesSequenceCheck(
  anchor: { item: PageItem; number: string; context: ContextState },
  state: MarkerSequenceState,
  isTwoColumn: boolean,
): boolean {
  if (isTwoColumn) return true;
  // Parenthesized markers follow their own layout rules and may legitimately
  // repeat inside one context; only plain/decimal runs are sequence-checked.
  const text = normalizeText(anchor.item.text);
  if (QUESTION_NUMBER.test(text) || BRACKETED_QUESTION_NUMBER.test(text)) {
    return true;
  }
  const numeric = Number.parseInt(anchor.number, 10);
  if (!Number.isFinite(numeric)) return true;
  const key =
    `${anchor.context.chapter}|${anchor.context.sectionPart}|` +
    `${anchor.context.questionType ?? ""}|${anchor.context.subChapter ?? ""}`;
  if (key !== state.contextKey) {
    state.contextKey = key;
    state.lastNumber = numeric;
    return true;
  }
  if (
    numeric > state.lastNumber &&
    numeric - state.lastNumber <= MARKER_SEQUENCE_MAX_STEP
  ) {
    state.lastNumber = numeric;
    return true;
  }
  return false;
}

function composeChapterLabel(context: ContextState): string {
  return context.subChapter === undefined
    ? context.chapter
    : `${context.chapter}·${context.subChapter}`;
}

function resolveHeading(
  text: string,
  outlineTitles: ReadonlySet<string>,
): Partial<ContextState> | undefined {
  const direct = classifyHeading(text);
  if (direct !== undefined) return direct;
  const normalized = normalizeText(text);
  if (
    (outlineTitles.has(normalized) ||
      WORKBOOK_TOPIC_CHAPTERS.has(normalized)) &&
    normalized.length >= 2 &&
    normalized.length <= 40 &&
    !/^[\d\s.,、．.()（）:：\-—·]+$/.test(normalized)
  ) {
    return { chapter: normalized };
  }
  return undefined;
}

function applyContextHeading(
  target: ContextState,
  heading: Partial<ContextState>,
): void {
  if (heading.chapter !== undefined && heading.subChapter === undefined) {
    target.subChapter = undefined;
  }
  Object.assign(target, heading);
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
  profile?: WorkbookPdfAdaptationProfile;
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
const BRACKETED_QUESTION_NUMBER = /^\s*[【［\[]\s*(\d{1,3})\s*[】］\]]/;
const DECIMAL_QUESTION_NUMBER = /^\s*(\d{1,3})\s*[.．、)）:：]/;
// Plain question numbers: "1 设...", "3 lim...", "4 I =...", "11 [x]...",
// "43I =...", "100 已知...". The alternation stays anchored to the whole
// string so wrapped body lines that merely contain letters never qualify.
const PLAIN_QUESTION_START =
  /^\s*(\d{1,3})(?:\s+[^\d\s.,，、:：)）\]】].*|[\u3400-\u9fff\u4e00-\u9fa5a-zA-Z\\[({\u3010\uFF08].*)$/;
const DECIMAL_MAX_X = 0.14;
const PARENTHESIZED_MAX_X = 0.22;
const CHAPTER_HEADING =
  /^第\s*[一二三四五六七八九十百零〇0-9]+\s*(?:章|篇|单元)(?:\s*.*)?$/;
const PART_PREFIX_CHAPTER_HEADING =
  /^(?:(基础|强化|综合)篇)?\s*(第\s*[一二三四五六七八九十百零〇0-9]+\s*(?:章|篇|单元)(?:\s*.*)?)$/;
const SUBSECTION_HEADING = /^(基础部分|强化部分|综合部分)\s*[-–—·:：]\s*(.+)$/;
const TEST_PAPER_HEADING =
  /^测试卷\s*[一二三四五六七八九十百零〇0-9]+\s*\S*.*$/;
// Standalone topic lines used by common 做题本 workbooks. Exact full-string
// matches only, so chapters survive even when a PDF lacks usable bookmarks.
const WORKBOOK_TOPIC_CHAPTERS: ReadonlySet<string> = new Set([
  "行列式",
  "矩阵",
  "向量",
  "向量组",
  "线性方程组",
  "特征值和特征向量",
  "特征值与特征向量",
  "二次型",
  "随机事件和概率",
  "随机事件与概率",
  "随机变量及其概率分布",
  "一维随机变量及其分布",
  "多维随机变量及其分布",
  "随机变量的数字特征",
  "大数定律和中心极限定理",
  "大数定律与中心极限定理",
  "数理统计的基本概念",
  "数理统计",
  "参数估计",
  "假设检验",
]);
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
        profileId: options.profile?.id ?? "generic-text-pdf",
        questions: parsed.questions,
        warningCount: parsed.warningCount,
        ocrPageCount: parsed.ocrPageCount,
        unresolvedMarkerCount: parsed.unresolvedMarkerCount,
        crossPageQuestionCount: parsed.crossPageQuestionCount,
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
  Omit<
    DetectedPdfSubject,
    | "questions"
    | "warningCount"
    | "ocrPageCount"
    | "profileId"
    | "unresolvedMarkerCount"
    | "crossPageQuestionCount"
  >
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
    | "questions"
    | "warningCount"
    | "ocrPageCount"
    | "profileId"
    | "unresolvedMarkerCount"
    | "crossPageQuestionCount"
  >,
  onPage: (page: number) => void,
  options: AnalyzeWorkbookPdfOptions,
): Promise<{
  questions: IndexedQuestionDraft[];
  warningCount: number;
  ocrPageCount: number;
  unresolvedMarkerCount: number;
  crossPageQuestionCount: number;
}> {
  const context: ContextState = {
    chapter: "未分章",
    sectionPart: "other",
  };
  const outlineTitles = new Set(outline.map((node) => node.title));
  const located: LocatedDraft[] = [];
  const sourceKeyOccurrences = new Map<string, number>();
  const markerSequence: MarkerSequenceState = {
    contextKey: "",
    lastNumber: 0,
  };
  let warningCount = 0;
  let ocrPageCount = 0;
  let unresolvedMarkerCount = 0;
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
      if (
        options.recognizePage !== undefined &&
        pageNeedsOcr(textItems, options.profile)
      ) {
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
          const imageBytes = await (options.renderPage ?? renderPdfPageForOcr)(
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
    const pageStyle = detectQuestionNumberStyleEvidence(items, options.profile);
    if (pageStyle !== undefined) {
      numberStyle = pageStyle;
    }
    const questionMarkers = new Map(
      findQuestionMarkers(items, numberStyle, options.profile).map((marker) => [
        marker.item,
        marker.number,
      ]),
    );
    applyOutlineContext(
      context,
      outlineTitles,
      outline,
      subject,
      page.pageNumber,
      0,
    );
    const leftContext: ContextState = { ...context };
    const rightContext: ContextState = { ...context };
    const anchors: Array<{
      item: PageItem;
      number: string;
      context: ContextState;
    }> = [];

    for (const item of items) {
      const isRight = item.x >= RIGHT_COLUMN_MIN_X;
      const targetCtx = isRight ? rightContext : leftContext;
      applyOutlineContext(
        targetCtx,
        outlineTitles,
        outline,
        subject,
        page.pageNumber,
        item.top,
      );
      const heading = resolveHeading(item.text, outlineTitles);
      if (heading !== undefined) {
        applyContextHeading(targetCtx, heading);
        if (
          heading.chapter !== undefined ||
          heading.sectionPart !== undefined ||
          heading.subChapter !== undefined
        ) {
          applyContextHeading(leftContext, heading);
          applyContextHeading(rightContext, heading);
          applyContextHeading(context, heading);
        }
        continue;
      }
      const number = questionMarkers.get(item);
      if (number !== undefined) {
        anchors.push({ item, number, context: { ...targetCtx } });
      }
    }
    Object.assign(context, leftContext);

    if (anchors.length === 0) {
      const continuation = appendContinuationRegion(
        located,
        page.pageNumber,
        items,
        options.profile,
      );
      if (continuation.handled) {
        if (continuation.truncated) warningCount += 1;
        continue;
      }
      if (hasBodyItems(items)) warningCount += 1;
      if (hasBodyItems(items)) unresolvedMarkerCount += 1;
      continue;
    }

    const hasRightColumnAnchors = anchors.some(
      (a) => a.item.x >= RIGHT_COLUMN_MIN_X,
    );
    const columnGroups = hasRightColumnAnchors
      ? [
          {
            column: "left" as const,
            anchors: anchors
              .filter((a) => a.item.x < LEFT_COLUMN_MAX_X)
              .sort((a, b) => a.item.top - b.item.top),
            items: items.filter((i) => i.x < 0.52),
          },
          {
            column: "right" as const,
            anchors: anchors
              .filter((a) => a.item.x >= RIGHT_COLUMN_MIN_X)
              .sort((a, b) => a.item.top - b.item.top),
            items: items.filter((i) => i.x >= 0.46),
          },
        ].filter((g) => g.anchors.length > 0)
      : [
          {
            column: "full" as const,
            anchors: anchors.sort((a, b) => a.item.top - b.item.top),
            items,
          },
        ];

    const firstGroup = columnGroups[0];
    const firstAnchorTop = firstGroup?.anchors[0]?.item.top ?? 0.95;
    if (
      located.length > 0 &&
      !hasStructuralHeadingBefore(items, firstAnchorTop)
    ) {
      const continuation = appendContinuationRegion(
        located,
        page.pageNumber,
        items.filter((item) => item.top < firstAnchorTop),
        options.profile,
      );
      if (continuation.truncated) warningCount += 1;
    }

    for (const group of columnGroups) {
      const twoColumnPage = hasRightColumnAnchors;
      const passingAnchors = group.anchors.filter((anchor) =>
        anchorPassesSequenceCheck(anchor, markerSequence, twoColumnPage),
      );
      const verticalBounds = inferQuestionVerticalBounds(
        group.items,
        passingAnchors.map((anchor) => anchor.item.top),
      );

      for (const [index, anchor] of passingAnchors.entries()) {
        const structuralTop = nextStructuralHeadingTop(
          group.items,
          anchor.item.top,
        );
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
        const region = viewportRegion(
          page.pageNumber,
          top,
          bottom,
          group.column,
        );
        if (region.height <= 0.002) {
          warningCount += 1;
          continue;
        }
        const regionItems = group.items.filter(
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
        const effectiveChapter = composeChapterLabel(anchor.context);
        const safeChapter = truncateUtf8(effectiveChapter, MAX_CHAPTER_BYTES);
        const pageQuestionOrdinal = located.length + 1;
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
  }
  const questions = located.map((value) => value.draft);
  return {
    questions,
    warningCount,
    ocrPageCount,
    unresolvedMarkerCount,
    crossPageQuestionCount: questions.filter(
      (question) => question.regions.length > 1,
    ).length,
  };
}

const OCR_MIN_PAGE_ITEMS = 4;
const OCR_MIN_PAGE_CHARACTERS = 32;

export function pageNeedsOcr(
  items: readonly PageItem[],
  profile?: WorkbookPdfAdaptationProfile,
): boolean {
  const body = items.filter(
    (item) =>
      item.top >= 0.08 &&
      item.top <= 0.9 &&
      !isPageChrome(item.text) &&
      classifyHeading(item.text) === undefined &&
      normalizeText(item.text) !== "",
  );
  const markers = findQuestionMarkers(items, undefined, profile);
  const markerItems = new Set(markers.map((marker) => marker.item));
  if (
    markers.some((marker) =>
      hasQuestionBody(items, marker.item, markerItems, profile),
    )
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
  profile?: WorkbookPdfAdaptationProfile,
): boolean {
  if (inlineQuestionBody(marker, profile)) return true;
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

function inlineQuestionBody(
  item: PageItem,
  profile?: WorkbookPdfAdaptationProfile,
): boolean {
  if (parseQuestionNumber(item.text, item.x, profile) === undefined) {
    return false;
  }
  const normalized = normalizeText(item.text);
  const body = normalized
    .replace(/^\s*[（(]\s*\d{1,3}\s*[)）]/, "")
    .replace(/^\s*[【［\[]\s*\d{1,3}\s*[】］\]]/, "")
    .replace(/^\s*\d{1,3}\s*[.．、)）:：]/, "")
    .replace(/^\s*\d{1,3}\s+/, "")
    .replace(/^\s*\d{1,3}/, "")
    .trim();
  return body.length > 0;
}

export function ocrRecognitionToPageItems(
  recognition: Pick<OcrPageRecognition, "lines">,
): PageItem[] {
  return selectOcrLinesForIndex(recognition.lines)
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
      // Uniform 做题本 layouts start many questions at near-identical
      // coordinates with the same opener ("设", "已知", "若矩阵"). Short CJK
      // tokens are collision-prone chrome keys and can silence real question
      // bodies, so only longer text may become repeated-chrome candidates.
      const normalizedForChrome = normalizeText(item.text);
      if (
        normalizedForChrome.length <= 6 &&
        /[\u3400-\u9fff\u4e00-\u9fa5]/.test(normalizedForChrome)
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
  profile?: WorkbookPdfAdaptationProfile,
): ContinuationRegionResult {
  const previous = located.at(-1);
  if (previous === undefined) {
    return { handled: false, truncated: false };
  }
  const lastRegion = previous.draft.regions.at(-1);
  if (
    lastRegion === undefined ||
    lastRegion.pageNumber !== pageNumber - 1 ||
    1 - lastRegion.y < 0.8
  ) {
    return { handled: false, truncated: false };
  }
  if (
    hasStructuralHeadingBefore(items, 0.94) ||
    hasQuestionMarkerLikeItem(items, profile)
  ) {
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

function hasQuestionMarkerLikeItem(
  items: readonly PageItem[],
  profile?: WorkbookPdfAdaptationProfile,
): boolean {
  return items.some(
    (item) =>
      parseQuestionNumber(item.text, item.x, profile) !== undefined ||
      isLikelyQuestionLabel(item.text) ||
      PLAIN_QUESTION_START.test(normalizeText(item.text)),
  );
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
    /公众号|微信公众号|张宇\s*1000\s*题|做题本集结地|EduEditer|https?:\/\/|www\./i.test(
      normalized,
    )
  );
}

const LEFT_COLUMN_MAX_X = 0.4;
const RIGHT_COLUMN_MIN_X = 0.42;
const RIGHT_COLUMN_MAX_OFFSET = 0.46;

export function isPageTwoColumn(items: readonly PageItem[]): boolean {
  const lineMap = new Map<
    number,
    { minX: number; maxX: number; count: number }
  >();
  for (const item of items) {
    if (item.top < 0.045 || item.top > 0.95 || isPageChrome(item.text))
      continue;
    let foundKey: number | undefined;
    for (const key of lineMap.keys()) {
      if (Math.abs(key - item.top) <= 0.004) {
        foundKey = key;
        break;
      }
    }
    if (foundKey === undefined) {
      lineMap.set(item.top, { minX: item.x, maxX: item.x, count: 1 });
    } else {
      const line = lineMap.get(foundKey)!;
      line.minX = Math.min(line.minX, item.x);
      line.maxX = Math.max(line.maxX, item.x);
      line.count += 1;
    }
  }

  let fullWidthLineCount = 0;
  for (const line of lineMap.values()) {
    if (line.minX < 0.35 && line.maxX > 0.55) {
      fullWidthLineCount += 1;
    }
  }

  if (fullWidthLineCount >= 3) {
    return false;
  }

  // A single right-column candidate is not enough: diagram-heavy pages often
  // contain one stray math fragment near the middle that looks like a marker.
  const rightColumnCandidates = items.filter(
    (item) =>
      item.x >= 0.42 &&
      item.x <= 0.6 &&
      parseQuestionNumber(item.text, item.x, undefined, true) !== undefined,
  );
  return rightColumnCandidates.length >= 2;
}

function isMarkerXValid(
  x: number,
  maxLeft: number,
  isTwoColumn = false,
): boolean {
  if (x <= maxLeft) return true;
  if (!isTwoColumn) return false;
  return x >= RIGHT_COLUMN_MIN_X && x <= maxLeft + RIGHT_COLUMN_MAX_OFFSET;
}

export function parseQuestionNumber(
  text: string,
  normalizedX: number,
  profile?: WorkbookPdfAdaptationProfile,
  isTwoColumn = false,
): string | undefined {
  const normalized = normalizeText(text);
  if (!Number.isFinite(normalizedX)) {
    return undefined;
  }
  // 1. Bracketed question numbers: 【13】, [13], ［13］
  const bracketed = BRACKETED_QUESTION_NUMBER.exec(normalized)?.[1];
  if (
    bracketed !== undefined &&
    bracketed !== "0" &&
    isMarkerXValid(normalizedX, PARENTHESIZED_MAX_X, isTwoColumn)
  ) {
    return bracketed;
  }
  // 2. Parenthesized question numbers: (13), （13）
  const parenthesized = QUESTION_NUMBER.exec(normalized)?.[1];
  if (
    parenthesized !== undefined &&
    parenthesized !== "0" &&
    isMarkerXValid(normalizedX, PARENTHESIZED_MAX_X, isTwoColumn)
  ) {
    return parenthesized;
  }
  if (!isMarkerXValid(normalizedX, DECIMAL_MAX_X, isTwoColumn)) {
    return undefined;
  }
  // 3. Decimal / Punctuation question numbers: 1., 1．, 1、, 1), 1）, 1:, 1：
  const decimal = DECIMAL_QUESTION_NUMBER.exec(normalized);
  if (
    decimal !== null &&
    decimal[1] !== "0" &&
    !/^\s*\d{1,3}\s*[.．、)）:：]\s*\d/.test(normalized)
  ) {
    return decimal[1];
  }
  // 4. Plain question numbers: 1 设..., 3 lim..., 4 I =..., 11 [x]..., 43I =..., 100 已知...
  if (
    profile === undefined ||
    profile.allowUnpunctuatedQuestionNumbers !== false
  ) {
    const plain = PLAIN_QUESTION_START.exec(normalized)?.[1];
    if (plain !== undefined && plain !== "0") {
      return plain;
    }
  }
  return undefined;
}

export function detectQuestionNumberStyle(
  items: readonly PageItem[],
  profile?: WorkbookPdfAdaptationProfile,
): QuestionNumberStyle {
  return detectQuestionNumberStyleEvidence(items, profile) ?? "parenthesized";
}

/**
 * Returns the marker style only when the page carries real evidence; a page
 * without any candidate (blank space, pure diagrams) yields undefined so the
 * previously established style stays in effect instead of being reset.
 */
function detectQuestionNumberStyleEvidence(
  items: readonly PageItem[],
  profile?: WorkbookPdfAdaptationProfile,
): QuestionNumberStyle | undefined {
  // Style evidence is judged strictly against the left content margin so a
  // stray math fragment near the middle of a diagram-heavy page cannot flip
  // the whole page (and following pages) away from the real marker style.
  const filtered = items.filter(
    (item) =>
      isMarkerXValid(item.x, PARENTHESIZED_MAX_X, false) &&
      !isPageChrome(item.text) &&
      classifyHeading(item.text) === undefined,
  );
  if (hasDecimalMarker(filtered, false)) {
    return "decimal";
  }
  const plainAllowed =
    profile === undefined || profile.allowUnpunctuatedQuestionNumbers !== false;
  if (plainAllowed && profile?.plainBeforeParenthesized === true) {
    // 做题本 answer areas are saturated with "(1)" blank labels; for books
    // that opt in, plain body evidence wins before parenthesized labels.
    if (hasPlainMarker(filtered, false)) {
      return "plain";
    }
  }
  if (hasParenthesizedMarker(filtered, false)) {
    return "parenthesized";
  }
  if (plainAllowed && hasPlainMarker(filtered, false)) {
    return "plain";
  }
  return undefined;
}

/**
 * Page styles follow evidence priority decimal > plain > parenthesized and
 * persist once established; a page without candidates never resets them.
 * Plain deliberately outranks parenthesized because 做题本 answer areas are
 * saturated with "(1)" blank labels that would otherwise mask real questions.
 */
export function findQuestionMarkers(
  items: readonly PageItem[],
  style?: QuestionNumberStyle,
  profile?: WorkbookPdfAdaptationProfile,
): Array<{ item: PageItem; number: string }> {
  const isTwoColumn = isPageTwoColumn(items);
  const effectiveStyle = style ?? detectQuestionNumberStyle(items, profile);
  const filtered = items.filter((item) => !isPageChrome(item.text));
  const markers: Array<{ item: PageItem; number: string }> = [];

  for (const [index, item] of filtered.entries()) {
    const isParen = isParenthesizedText(item.text);
    const isDec = isDecimalText(item.text);
    const parsed = parseQuestionNumber(item.text, item.x, profile, isTwoColumn);

    if (parsed !== undefined) {
      if (
        effectiveStyle === "parenthesized" &&
        (isParen || isClosingParenText(item.text))
      ) {
        markers.push({ item, number: parsed });
        continue;
      }
      if (effectiveStyle === "decimal" && isDec && !isParen) {
        markers.push({ item, number: parsed });
        continue;
      }
      if (effectiveStyle === "plain" && !isParen && !isDec) {
        markers.push({ item, number: parsed });
        continue;
      }
    }

    if (
      effectiveStyle === "parenthesized" &&
      isOpeningParenthesis(item) &&
      isMarkerXValid(item.x, PARENTHESIZED_MAX_X, isTwoColumn)
    ) {
      const number = filtered[index + 1];
      const closing = filtered[index + 2];
      if (
        number !== undefined &&
        closing !== undefined &&
        /^\d{1,3}$/.test(number.text) &&
        isClosingParenthesis(closing) &&
        Math.abs(item.top - number.top) <= 0.008 &&
        Math.abs(item.top - closing.top) <= 0.008 &&
        number.x - item.x < 0.035 &&
        closing.x - item.x < 0.055
      ) {
        markers.push({ item, number: number.text });
        continue;
      }
      if (
        number !== undefined &&
        /^\d{1,3}[)）\]］】]/.test(number.text) &&
        Math.abs(item.top - number.top) <= 0.008 &&
        number.x - item.x < 0.04
      ) {
        const num = /^\d{1,3}/.exec(number.text)?.[0];
        if (num !== undefined) {
          markers.push({ item, number: num });
          continue;
        }
      }
    }

    if (
      effectiveStyle === "parenthesized" &&
      isMarkerXValid(item.x, PARENTHESIZED_MAX_X, isTwoColumn)
    ) {
      const prev = filtered[index - 1];
      const isInsideParens =
        prev !== undefined &&
        isOpeningParenthesis(prev) &&
        Math.abs(prev.top - item.top) <= 0.008;
      if (!isInsideParens) {
        const closingMatch = /^\s*(\d{1,3})\s*[)）\]］】]/.exec(item.text);
        const closingNum = closingMatch?.[1];
        if (closingNum !== undefined) {
          markers.push({ item, number: closingNum });
          continue;
        }
        const numberMatch = /^\s*(\d{1,3})\s*$/.exec(item.text);
        const num = numberMatch?.[1];
        const next = filtered[index + 1];
        if (
          num !== undefined &&
          next !== undefined &&
          isClosingParenthesis(next) &&
          Math.abs(item.top - next.top) <= 0.008 &&
          next.x - item.x < 0.04
        ) {
          markers.push({ item, number: num });
          continue;
        }
      }
    }

    if (
      effectiveStyle === "plain" &&
      isStandalonePlainQuestionMarker(filtered, index, item, isTwoColumn)
    ) {
      const num = /^\s*(\d{1,3})/.exec(item.text)?.[1];
      if (num !== undefined) {
        markers.push({ item, number: num });
        continue;
      }
    }

    if (
      effectiveStyle === "decimal" &&
      isMarkerXValid(item.x, DECIMAL_MAX_X, isTwoColumn)
    ) {
      const prev = filtered[index - 1];
      const isInsideParens =
        prev !== undefined &&
        isOpeningParenthesis(prev) &&
        Math.abs(prev.top - item.top) <= 0.008;
      const number = /^\s*(\d{1,3})\s*$/.exec(item.text)?.[1];
      const punctuation = filtered[index + 1];
      if (
        !isInsideParens &&
        number !== undefined &&
        punctuation !== undefined &&
        /^[.．、:：]$/.test(punctuation.text) &&
        Math.abs(item.top - punctuation.top) <= 0.008 &&
        punctuation.x - item.x < 0.04
      ) {
        markers.push({ item, number });
        continue;
      }
    }
  }

  return deduplicateQuestionMarkers(
    dropDigitRowClusters(markers.filter((marker) => marker.number !== "0")),
  );
}

/**
 * Answer sheets print blank-numbering rows like "1 2 3 4" inside the answer
 * space. Question markers never share one line with another bare number in a
 * single column layout, so any same-line digit-only cluster is not questions.
 */
function dropDigitRowClusters(
  markers: ReadonlyArray<{ item: PageItem; number: string }>,
): Array<{ item: PageItem; number: string }> {
  type Marker = { item: PageItem; number: string };
  const lineGroups = new Map<number, Marker[]>();
  for (const marker of markers) {
    if (!/^\d{1,3}$/.test(normalizeText(marker.item.text))) continue;
    const bucket = Math.round(marker.item.top / 0.008);
    const group = lineGroups.get(bucket);
    if (group !== undefined) {
      group.push(marker);
    } else {
      lineGroups.set(bucket, [marker]);
    }
  }
  const clustered = new Set<{ item: PageItem; number: string }>();
  for (const group of lineGroups.values()) {
    for (const marker of group) {
      for (const other of group) {
        if (
          other !== marker &&
          Math.abs(other.item.x - marker.item.x) <= 0.35 &&
          Math.abs(other.item.top - marker.item.top) <= 0.006
        ) {
          clustered.add(marker);
          break;
        }
      }
    }
  }
  return markers.filter((marker) => !clustered.has(marker));
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

function hasPlainMarker(
  items: readonly PageItem[],
  isTwoColumn = false,
): boolean {
  return items.some((item, index) =>
    isStandalonePlainQuestionMarker(items, index, item, isTwoColumn),
  );
}

function isStandalonePlainQuestionMarker(
  items: readonly PageItem[],
  index: number,
  item: PageItem,
  isTwoColumn = false,
): boolean {
  const text = normalizeText(item.text);
  if (
    !isMarkerXValid(item.x, DECIMAL_MAX_X, isTwoColumn) ||
    item.top < 0.045 ||
    item.top > 0.92 ||
    isPageChrome(text) ||
    classifyHeading(text) !== undefined
  ) {
    return false;
  }
  if (/^\s*0(?!\d)/.test(text)) {
    return false;
  }
  if (PLAIN_QUESTION_START.test(text)) {
    return true;
  }
  if (!/^\d{1,3}$/.test(text)) return false;
  const next = items[index + 1];
  // A real question body starts with prose or math content; wrapped formula
  // fragments continue with bare punctuation or digits ("1 , 2 , -1 ...").
  return (
    next !== undefined &&
    sameLine(item, next) &&
    isQuestionBodyItem(next) &&
    !/^[.,，。、;；:：!？?\)\）\]】》>"'”’\-—…·\d]/.test(
      normalizeText(next.text),
    )
  );
}

function isOpeningParenthesis(item: PageItem): boolean {
  const text = item.text.trim();
  return (
    text.startsWith("(") ||
    text.startsWith("（") ||
    text.startsWith("[") ||
    text.startsWith("［") ||
    text.startsWith("【")
  );
}

function isClosingParenthesis(item: PageItem): boolean {
  const text = item.text.trim();
  return (
    text.startsWith(")") ||
    text.startsWith("）") ||
    text.startsWith("]") ||
    text.startsWith("］") ||
    text.startsWith("】")
  );
}

function isClosingParenText(text: string): boolean {
  const normalized = normalizeText(text);
  return /^\s*\d{1,3}\s*[)）\]］】]/.test(normalized);
}

function sameLine(left: PageItem, right: PageItem): boolean {
  return Math.abs(left.top - right.top) <= 0.005;
}

function isParenthesizedText(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    QUESTION_NUMBER.test(normalized) ||
    BRACKETED_QUESTION_NUMBER.test(normalized)
  );
}

function isDecimalText(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    DECIMAL_QUESTION_NUMBER.test(normalized) &&
    !/^\s*\d{1,3}\s*[.．、)）:：]\s*\d/.test(normalized)
  );
}

function hasParenthesizedMarker(
  items: readonly PageItem[],
  isTwoColumn = false,
): boolean {
  for (const [index, item] of items.entries()) {
    const text = normalizeText(item.text);
    if (isParenthesizedText(text)) {
      return true;
    }
    if (
      isOpeningParenthesis(item) &&
      isMarkerXValid(item.x, PARENTHESIZED_MAX_X, isTwoColumn)
    ) {
      const number = items[index + 1];
      const closing = items[index + 2];
      if (
        number !== undefined &&
        closing !== undefined &&
        /^\d{1,3}$/.test(number.text) &&
        isClosingParenthesis(closing) &&
        Math.abs(item.top - number.top) <= 0.008 &&
        Math.abs(item.top - closing.top) <= 0.008
      ) {
        return true;
      }
      if (
        number !== undefined &&
        /^\d{1,3}[)）\]］】]/.test(number.text) &&
        Math.abs(item.top - number.top) <= 0.008
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasDecimalMarker(
  items: readonly PageItem[],
  isTwoColumn = false,
): boolean {
  for (const [index, item] of items.entries()) {
    const text = normalizeText(item.text);
    const prev = items[index - 1];
    const isInsideParens =
      prev !== undefined &&
      isOpeningParenthesis(prev) &&
      Math.abs(prev.top - item.top) <= 0.008;
    const decimalDigit = DECIMAL_QUESTION_NUMBER.exec(text)?.[1];
    if (
      decimalDigit !== undefined &&
      decimalDigit !== "0" &&
      isMarkerXValid(item.x, DECIMAL_MAX_X, isTwoColumn)
    ) {
      const next = items[index + 1];
      const isParenthesizedMiddle =
        /^\s*\d{1,3}\s*$/.test(text) &&
        next !== undefined &&
        isClosingParenthesis(next);
      if (
        !isInsideParens &&
        !isParenthesizedMiddle &&
        !/^\s*\d{1,3}\s*[.．、)）:：]\s*\d/.test(text)
      ) {
        return true;
      }
    }
    const next = items[index + 1];
    if (
      !isInsideParens &&
      /^\s*[1-9]\d{0,2}\s*$/.test(text) &&
      isMarkerXValid(item.x, DECIMAL_MAX_X, isTwoColumn) &&
      next !== undefined &&
      /^[.．、:：]$/.test(next.text) &&
      Math.abs(item.top - next.top) <= 0.008 &&
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
  const prefixChapter = PART_PREFIX_CHAPTER_HEADING.exec(normalized);
  if (prefixChapter !== null && prefixChapter[2] !== undefined) {
    const sectionPart =
      prefixChapter[1] === "基础"
        ? ({ sectionPart: "basic" } as Partial<ContextState>)
        : prefixChapter[1] === "强化" || prefixChapter[1] === "综合"
          ? ({ sectionPart: "comprehensive" } as Partial<ContextState>)
          : {};
    return { chapter: normalizeText(prefixChapter[2]), ...sectionPart };
  }
  if (CHAPTER_HEADING.test(normalized)) {
    return { chapter: normalized };
  }
  const subsection = SUBSECTION_HEADING.exec(normalized);
  if (
    subsection !== null &&
    subsection[1] !== undefined &&
    subsection[2] !== undefined
  ) {
    return {
      sectionPart: subsection[1] === "基础部分" ? "basic" : "comprehensive",
      subChapter: normalizeText(subsection[2]),
    };
  }
  if (TEST_PAPER_HEADING.test(normalized)) {
    return { subChapter: normalized };
  }
  const category = /^([ABC])\s*类$/i.exec(normalized)?.[1]?.toUpperCase();
  if (category === "A") return { sectionPart: "basic" };
  if (category === "B") return { sectionPart: "comprehensive" };
  if (category === "C") return { sectionPart: "extended" };
  if (
    containsAny(normalized, [
      "基础部分",
      "基础题",
      "基础篇",
      "基础训练",
      "基础演练",
      "基础过关",
      "基础通关",
    ])
  ) {
    return { sectionPart: "basic" };
  }
  if (
    containsAny(normalized, [
      "强化部分",
      "强化题",
      "强化篇",
      "强化训练",
      "强化提高",
      "综合题",
      "综合篇",
      "测试卷",
      "真题精析",
      "真题精选",
    ])
  ) {
    return { sectionPart: "comprehensive" };
  }
  if (
    containsAny(normalized, [
      "拓展部分",
      "拓展题",
      "拓展篇",
      "提高题",
      "提高篇",
      "拔高篇",
    ])
  ) {
    return { sectionPart: "extended" };
  }
  if (
    containsAny(normalized, [
      "选择题",
      "选择部分",
      "选择填空题",
      "选择与填空题",
      "单项选择题",
      "多项选择题",
      "单选题",
      "多选题",
    ])
  ) {
    return { questionType: "choice" };
  }
  if (containsAny(normalized, ["填空题", "填空部分"])) {
    return { questionType: "blank" };
  }
  if (
    containsAny(normalized, [
      "解答题",
      "解答部分",
      "证明题",
      "计算题",
      "应用题",
      "综合解答题",
    ])
  ) {
    return { questionType: "solution" };
  }
  if (
    /^(?:第[一二三四五六七八九十百0-9]+[章节篇部分讲]|Chapter|Section|Part)\b/i.test(
      normalized,
    ) ||
    /^(?:[一二三四五六七八九十]+[、.．]|\([一二三四五六七八九十]+\)|（[一二三四五六七八九十]+）)/.test(
      normalized,
    ) ||
    /^(?:题型|考点|专题|微专题|模块)[一二三四五六七八九十0-9]+/.test(
      normalized,
    ) ||
    /^【(?:考点|题型|专题|真题|基础|强化|拔高|解析|详解|点睛|归纳|总结|精析|通关|知识清单|考情分析)[^】]*】/.test(
      normalized,
    ) ||
    /^(?:高等数学|线性代数|概率论与数理统计|概率论|高数|线代|概率)(?:篇|部分)?$/.test(
      normalized,
    )
  ) {
    return {};
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
  outlineTitles: ReadonlySet<string>,
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
    const heading = resolveHeading(title, outlineTitles);
    if (heading !== undefined) applyContextHeading(context, heading);
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

function viewportRegion(
  pageNumber: number,
  top: number,
  bottom: number,
  column: "left" | "right" | "full" = "full",
) {
  if (column === "left") {
    return {
      pageNumber,
      x: 0.04,
      y: clamp(1 - bottom, 0, 1),
      width: 0.46,
      height: clamp(bottom - top, 0.003, 0.94),
    };
  }
  if (column === "right") {
    return {
      pageNumber,
      x: 0.5,
      y: clamp(1 - bottom, 0, 1),
      width: 0.46,
      height: clamp(bottom - top, 0.003, 0.94),
    };
  }
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
