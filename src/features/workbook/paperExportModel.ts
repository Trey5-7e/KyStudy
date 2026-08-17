import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import type {
  QuestionRegion,
  QuestionType,
} from "../../shared/tauri/questionClient";

export const DEFAULT_SOLUTION_LINES = 8;
export const DEFAULT_OTHER_LINES = 0;

export type PaperAnswerStyle = "lines" | "blank";

export interface PaperExportSettings {
  title: string;
  studentName?: string;
  className?: string;
  date?: string;
  solutionLines: number;
  otherLines: number;
  answerStyle: PaperAnswerStyle;
}

export interface PaperExportRegion {
  id: string;
  pageNumber: number;
  sortOrder: number;
  width: number;
  height: number;
  imageId: string;
}

export interface PaperExportQuestion {
  id: string;
  questionNumber: string;
  questionType: QuestionType;
  title: string;
  regions: PaperExportRegion[];
}

export interface PaperExportSnapshot {
  id: string;
  createdAt: number;
  settings: PaperExportSettings;
  questions: PaperExportQuestion[];
}

export interface PaperExportIssue {
  code:
    | "EMPTY_PAPER"
    | "DUPLICATE_QUESTION"
    | "QUESTION_WITHOUT_REGION"
    | "INVALID_REGION"
    | "MISSING_IMAGE";
  questionId?: string;
  questionNumber?: string;
  message: string;
  action: string;
}

export class PaperExportValidationError extends Error {
  readonly issues: PaperExportIssue[];

  constructor(issues: PaperExportIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "PaperExportValidationError";
    this.issues = issues;
  }
}

export function defaultPaperExportSettings(
  now = new Date(),
): PaperExportSettings {
  return {
    title: "练习卷",
    studentName: "",
    className: "",
    date: formatPaperDate(now),
    solutionLines: DEFAULT_SOLUTION_LINES,
    otherLines: DEFAULT_OTHER_LINES,
    answerStyle: "lines",
  };
}

export function formatPaperDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function createPaperExportSnapshot(
  questions: readonly IndexedQuestion[],
  settings: PaperExportSettings,
  imagesByRegionId: ReadonlyMap<string, { width: number; height: number }>,
  now = Date.now(),
): PaperExportSnapshot {
  const snapshot: PaperExportSnapshot = {
    id: `paper-${now}-${questions.length}`,
    createdAt: now,
    settings: normalizePaperExportSettings(settings),
    questions: questions.map((question) => ({
      id: question.id,
      questionNumber: question.questionNumber,
      questionType: question.questionType,
      title: question.title,
      regions: [...question.regions].sort(regionSort).map((region) => {
        const image = imagesByRegionId.get(region.id);
        return {
          id: region.id,
          pageNumber: region.pageNumber,
          sortOrder: region.sortOrder,
          width: image?.width ?? 0,
          height: image?.height ?? 0,
          imageId: region.id,
        };
      }),
    })),
  };
  const issues = validatePaperExportSnapshot(snapshot, imagesByRegionId);
  if (issues.length > 0) throw new PaperExportValidationError(issues);
  return snapshot;
}

export function validatePaperExportSnapshot(
  snapshot: PaperExportSnapshot,
  imagesByRegionId?: ReadonlyMap<string, unknown>,
): PaperExportIssue[] {
  const issues: PaperExportIssue[] = [];
  if (snapshot.questions.length === 0) {
    issues.push({
      code: "EMPTY_PAPER",
      message: "当前练习卷没有题目，无法生成 PDF。",
      action: "先生成至少包含一道题的练习卷。",
    });
  }
  const questionIds = new Set<string>();
  for (const question of snapshot.questions) {
    const questionLabel = question.questionNumber || question.id;
    if (questionIds.has(question.id)) {
      issues.push({
        code: "DUPLICATE_QUESTION",
        questionId: question.id,
        questionNumber: questionLabel,
        message: `第 ${questionLabel} 题在试卷快照中重复。`,
        action: "刷新组卷后重试。",
      });
    }
    questionIds.add(question.id);
    if (question.regions.length === 0) {
      issues.push({
        code: "QUESTION_WITHOUT_REGION",
        questionId: question.id,
        questionNumber: questionLabel,
        message: `第 ${questionLabel} 题没有可导出的题图区域。`,
        action: "回到题库补齐题目区域后重试。",
      });
    }
    for (const region of question.regions) {
      if (
        !Number.isInteger(region.pageNumber) ||
        region.pageNumber < 1 ||
        !Number.isFinite(region.sortOrder) ||
        !Number.isFinite(region.width) ||
        !Number.isFinite(region.height) ||
        region.width <= 0 ||
        region.height <= 0 ||
        region.width > 20_000 ||
        region.height > 20_000 ||
        region.imageId.trim() === ""
      ) {
        issues.push({
          code: "INVALID_REGION",
          questionId: question.id,
          questionNumber: questionLabel,
          message: `第 ${questionLabel} 题包含无效题图区域。`,
          action: "检查题图坐标和原 PDF 是否可读取。",
        });
      } else if (
        imagesByRegionId !== undefined &&
        !imagesByRegionId.has(region.imageId)
      ) {
        issues.push({
          code: "MISSING_IMAGE",
          questionId: question.id,
          questionNumber: questionLabel,
          message: `第 ${questionLabel} 题的题图未能加载。`,
          action: "确认原 PDF 可读取后重新导出。",
        });
      }
    }
  }
  return issues;
}

export function normalizePaperExportSettings(
  settings: PaperExportSettings,
): PaperExportSettings {
  return {
    title: settings.title.trim() || "练习卷",
    studentName: settings.studentName?.trim(),
    className: settings.className?.trim(),
    date: settings.date?.trim(),
    solutionLines: clampLineCount(
      settings.solutionLines,
      DEFAULT_SOLUTION_LINES,
    ),
    otherLines: clampLineCount(settings.otherLines, DEFAULT_OTHER_LINES),
    answerStyle: settings.answerStyle === "blank" ? "blank" : "lines",
  };
}

export function sanitizePaperFileName(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/[. ]+$/g, "")
    .trim();
  return (normalized || "练习卷").slice(0, 80);
}

export function defaultPaperFileName(
  title: string,
  date = formatPaperDate(new Date()),
): string {
  const safeDate = date.trim() || formatPaperDate(new Date());
  return `${sanitizePaperFileName(title)}-${safeDate.replaceAll("-", "")}.pdf`;
}

function clampLineCount(value: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.min(12, Math.max(0, Math.round(value)))
    : fallback;
}

function regionSort(left: QuestionRegion, right: QuestionRegion): number {
  return left.sortOrder - right.sortOrder || left.pageNumber - right.pageNumber;
}
