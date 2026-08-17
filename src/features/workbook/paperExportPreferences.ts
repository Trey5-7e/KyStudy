import type { PaperAnswerStyle } from "./paperExportModel";

export const PAPER_EXPORT_ANSWER_STORAGE_KEY = "kystudy.paper-export-answer.v1";

export interface PaperExportAnswerPreference {
  solutionLines: 4 | 8 | 12;
  otherLines: 0 | 4;
  answerStyle: PaperAnswerStyle;
}

export function loadPaperExportAnswerPreference(
  storage: Storage | undefined = browserStorage(),
): PaperExportAnswerPreference | undefined {
  if (storage === undefined) return undefined;
  try {
    const raw = storage.getItem(PAPER_EXPORT_ANSWER_STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return undefined;
    const solutionLines = parsed.solutionLines;
    const answerStyle = parsed.answerStyle;
    if (solutionLines !== 4 && solutionLines !== 8 && solutionLines !== 12) {
      return undefined;
    }
    if (answerStyle !== "lines" && answerStyle !== "blank") {
      return undefined;
    }
    const otherLines = parsed.otherLines === undefined ? 0 : parsed.otherLines;
    if (otherLines !== 0 && otherLines !== 4) {
      return undefined;
    }
    return { solutionLines, otherLines, answerStyle };
  } catch {
    return undefined;
  }
}

export function savePaperExportAnswerPreference(
  preference: PaperExportAnswerPreference,
  storage: Storage | undefined = browserStorage(),
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(
      PAPER_EXPORT_ANSWER_STORAGE_KEY,
      JSON.stringify(preference),
    );
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
