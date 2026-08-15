import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import type { AttemptResult } from "../../shared/tauri/questionClient";
import type { PaperDraftRecipe } from "./paperSetupPreferences";

export type QuestionBankTool =
  | "subject"
  | "workbook"
  | "manual"
  | "browse"
  | "record"
  | "paper"
  | "refresh"
  | "ocr";

export interface QuestionBankOpenRequest {
  kind: "resume-or-create-paper";
  nonce: number;
}

export type QuestionBankToolsSection =
  "category" | "index" | "practice" | "maintenance";

export type DialogKind = Exclude<QuestionBankTool, "refresh"> | "import";

export type QuestionBankWindowOrigin =
  | { kind: "root" }
  | {
      kind: "tools";
      section: QuestionBankToolsSection;
      focusTool?: QuestionBankTool;
    }
  | { kind: "segment-manager"; segmentId: string };

export type QuestionBankWindow =
  | {
      kind: "tools";
      section: QuestionBankToolsSection;
      focusTool?: QuestionBankTool;
    }
  | { kind: "segment-manager"; segmentId: string }
  | { kind: "segment-trash" }
  | {
      kind: "dialog";
      dialog: DialogKind;
      segmentId?: string;
      origin: QuestionBankWindowOrigin;
    }
  | {
      kind: "paper";
      questions: IndexedQuestion[];
      recipe?: PaperDraftRecipe;
      results?: Record<string, AttemptResult>;
      recordedResults?: Record<string, AttemptResult>;
      origin: QuestionBankWindowOrigin;
    };

export const ROOT_WINDOW_ORIGIN: QuestionBankWindowOrigin = {
  kind: "root",
};

export function toolWindow(
  section: QuestionBankToolsSection,
  focusTool?: QuestionBankTool,
): Extract<QuestionBankWindow, { kind: "tools" }> {
  return { kind: "tools", section, focusTool };
}

export function toolDialogWindow(
  tool: DialogKind,
  section: QuestionBankToolsSection,
): Extract<QuestionBankWindow, { kind: "dialog" }> {
  return {
    kind: "dialog",
    dialog: tool,
    origin: {
      kind: "tools",
      section,
      focusTool: tool === "import" ? undefined : tool,
    },
  };
}

export function managerDialogWindow(
  dialog: Extract<DialogKind, "browse" | "manual">,
  segmentId: string,
): Extract<QuestionBankWindow, { kind: "dialog" }> {
  return {
    kind: "dialog",
    dialog,
    segmentId,
    origin: { kind: "segment-manager", segmentId },
  };
}

export function paperWindow(
  questions: IndexedQuestion[],
  origin: QuestionBankWindowOrigin,
  recipe?: PaperDraftRecipe,
  results?: Record<string, AttemptResult>,
  recordedResults?: Record<string, AttemptResult>,
): Extract<QuestionBankWindow, { kind: "paper" }> {
  return {
    kind: "paper",
    questions,
    origin,
    recipe,
    results,
    recordedResults,
  };
}

/**
 * Resolve the Back button for a child window. A supplied segment set is used
 * to avoid returning to a manager whose segment was removed while the child
 * window was open.
 */
export function questionBankBackTarget(
  window: QuestionBankWindow,
  availableSegmentIds?: ReadonlySet<string>,
): QuestionBankWindow | undefined {
  if (window.kind !== "dialog" && window.kind !== "paper") return undefined;
  return originTarget(window.origin, availableSegmentIds);
}

export function questionBankCloseTarget(): undefined {
  return undefined;
}

export function questionBankWindowSegmentId(
  window: QuestionBankWindow,
): string | undefined {
  if (window.kind === "segment-manager") return window.segmentId;
  if (
    (window.kind === "dialog" || window.kind === "paper") &&
    window.origin.kind === "segment-manager"
  ) {
    return window.origin.segmentId;
  }
  return undefined;
}

function originTarget(
  origin: QuestionBankWindowOrigin,
  availableSegmentIds?: ReadonlySet<string>,
): QuestionBankWindow | undefined {
  if (origin.kind === "root") return undefined;
  if (origin.kind === "tools") {
    return toolWindow(origin.section, origin.focusTool);
  }
  if (
    availableSegmentIds !== undefined &&
    !availableSegmentIds.has(origin.segmentId)
  ) {
    return undefined;
  }
  return { kind: "segment-manager", segmentId: origin.segmentId };
}
