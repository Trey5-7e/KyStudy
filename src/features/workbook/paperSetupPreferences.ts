import type {
  PaperScopeGroup,
  PaperScopeMode,
  PaperSpec,
  PaperTypeQuotas,
} from "./questionBankModel";
import type {
  PracticeStatus,
  SectionPart,
} from "../../shared/tauri/questionBankClient";
import type {
  AttemptResult,
  QuestionType,
} from "../../shared/tauri/questionClient";
import {
  DEFAULT_PAPER_VIEW_STATE,
  type PaperQuestionFilter,
  type PaperViewMode,
  type PaperViewState,
} from "./paperNavigationModel";

export const PAPER_SETUP_QUOTAS_STORAGE_KEY = "kystudy.paper-quotas.v1";
export const PAPER_DRAFT_STORAGE_KEY = "kystudy.paper-draft.v2";
export const LEGACY_PAPER_DRAFT_STORAGE_KEY = "kystudy.paper-draft.v1";
export const PAPER_VIEW_MODE_STORAGE_KEY = "kystudy.paper-view-mode.v1";
const MAX_PAPER_QUOTA = 50;

export interface PaperDraftScopeGroup {
  id: string;
  name: string;
  enabled: boolean;
  mode: PaperScopeMode;
  workbookIds: string[];
  chapterKeys: string[];
  sectionParts: SectionPart[];
  questionTypes: QuestionType[];
}

export interface PaperDraftRecipe {
  subjectIds: string[];
  scopeGroups: PaperDraftScopeGroup[];
  subjectQuotas: Record<string, PaperTypeQuotas>;
  statuses: PracticeStatus[];
}

export interface SavedPaperDraft {
  questionIds: string[];
  recipe: PaperDraftRecipe;
  results?: Record<string, AttemptResult>;
  recordedResults?: Record<string, AttemptResult>;
  view?: PaperViewState;
  savedAt: number;
}

export function loadPaperViewMode(
  storage: Storage | undefined = browserStorage(),
): PaperViewMode {
  if (storage === undefined) return DEFAULT_PAPER_VIEW_STATE.mode;
  try {
    return storage.getItem(PAPER_VIEW_MODE_STORAGE_KEY) === "single"
      ? "single"
      : "continuous";
  } catch {
    return DEFAULT_PAPER_VIEW_STATE.mode;
  }
}

export function savePaperViewMode(
  mode: PaperViewMode,
  storage: Storage | undefined = browserStorage(),
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(PAPER_VIEW_MODE_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

export function loadPaperTypeQuotas(
  storage: Storage | undefined = browserStorage(),
): Map<string, PaperTypeQuotas> {
  if (storage === undefined) return new Map();
  try {
    const raw = storage.getItem(PAPER_SETUP_QUOTAS_STORAGE_KEY);
    if (raw === null) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return new Map();
    return new Map(
      Object.entries(parsed).flatMap(([subjectId, value]) => {
        const quota = parseQuota(value);
        return quota === undefined ? [] : [[subjectId, quota] as const];
      }),
    );
  } catch {
    return new Map();
  }
}

export function savePaperTypeQuotas(
  quotas: ReadonlyMap<string, PaperTypeQuotas>,
  storage: Storage | undefined = browserStorage(),
): void {
  if (storage === undefined) return;
  const serializable = Object.fromEntries(
    [...quotas].map(([subjectId, quota]) => [subjectId, normalizeQuota(quota)]),
  );
  try {
    storage.setItem(
      PAPER_SETUP_QUOTAS_STORAGE_KEY,
      JSON.stringify(serializable),
    );
  } catch {
    // Storage can be disabled or full in a desktop WebView. The dialog still
    // works for the current session when persistence is unavailable.
  }
}

export function createPaperDraftRecipe(input: {
  subjectIds: ReadonlySet<string>;
  scopeGroups: readonly PaperScopeGroup[];
  subjectQuotas: ReadonlyMap<string, PaperTypeQuotas>;
  statuses: ReadonlySet<PracticeStatus>;
}): PaperDraftRecipe {
  return {
    subjectIds: [...input.subjectIds],
    scopeGroups: input.scopeGroups.map((group) => ({
      id: group.id,
      name: group.name,
      enabled: group.enabled,
      mode: group.mode,
      workbookIds: [...group.workbookIds],
      chapterKeys: [...group.chapterKeys],
      sectionParts: [...group.sectionParts],
      questionTypes: [...group.questionTypes],
    })),
    subjectQuotas: Object.fromEntries(
      [...input.subjectQuotas].map(([subjectId, quota]) => [
        subjectId,
        normalizeQuota(quota),
      ]),
    ),
    statuses: [...input.statuses],
  };
}

export function paperSpecFromDraftRecipe(recipe: PaperDraftRecipe): PaperSpec {
  return {
    subjectIds: new Set(recipe.subjectIds),
    scopeGroups: recipe.scopeGroups.map((group) => ({
      id: group.id,
      name: group.name,
      enabled: group.enabled,
      mode: group.mode,
      workbookIds: new Set(group.workbookIds),
      chapterKeys: new Set(group.chapterKeys),
      sectionParts: new Set(group.sectionParts),
      questionTypes: new Set(group.questionTypes),
    })),
    subjectQuotas: new Map(
      Object.entries(recipe.subjectQuotas).map(([subjectId, quota]) => [
        subjectId,
        normalizeQuota(quota),
      ]),
    ),
    statuses: new Set(recipe.statuses),
    choiceCount: 0,
    blankCount: 0,
    solutionCount: 0,
  };
}

export function savePaperDraft(
  draft: SavedPaperDraft,
  storage: Storage | undefined = browserStorage(),
): boolean {
  if (storage === undefined) return false;
  try {
    storage.setItem(
      PAPER_DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        ...draft,
        questionIds: [...new Set(draft.questionIds)],
        results: normalizeResultRecord(draft.results),
        recordedResults: normalizeResultRecord(draft.recordedResults),
        view: normalizeViewState(draft.view),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadPaperDraft(
  storage: Storage | undefined = browserStorage(),
): SavedPaperDraft | undefined {
  if (storage === undefined) return undefined;
  try {
    const raw =
      storage.getItem(PAPER_DRAFT_STORAGE_KEY) ??
      storage.getItem(LEGACY_PAPER_DRAFT_STORAGE_KEY);
    if (raw === null) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return undefined;
    const questionIds = parseStringArray(parsed.questionIds);
    const recipe = parseRecipe(parsed.recipe);
    if (questionIds.length === 0 || recipe === undefined) return undefined;
    const savedAt =
      typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
        ? parsed.savedAt
        : 0;
    const results = parseResultRecord(parsed.results);
    const recordedResults = parseResultRecord(parsed.recordedResults);
    return {
      questionIds,
      recipe,
      ...(Object.keys(results).length > 0 ? { results } : {}),
      ...(Object.keys(recordedResults).length > 0 ? { recordedResults } : {}),
      view: normalizeViewState(parsed.view),
      savedAt,
    };
  } catch {
    return undefined;
  }
}

export function clearPaperDraft(
  storage: Storage | undefined = browserStorage(),
): void {
  if (storage === undefined) return;
  try {
    storage.removeItem(PAPER_DRAFT_STORAGE_KEY);
  } catch {
    // The completed paper is still closed even when storage cleanup fails.
  }
}

function parseRecipe(value: unknown): PaperDraftRecipe | undefined {
  if (!isRecord(value)) return undefined;
  const subjectIds = parseStringArray(value.subjectIds);
  const statuses = parseStatusArray(value.statuses);
  const scopeGroups = Array.isArray(value.scopeGroups)
    ? value.scopeGroups.flatMap((group) => {
        const parsed = parseScopeGroup(group);
        return parsed === undefined ? [] : [parsed];
      })
    : [];
  if (scopeGroups.length === 0) return undefined;
  if (!isRecord(value.subjectQuotas)) return undefined;
  const subjectQuotas = Object.fromEntries(
    Object.entries(value.subjectQuotas).flatMap(([subjectId, quota]) => {
      const parsed = parseQuota(quota);
      return parsed === undefined ? [] : [[subjectId, parsed] as const];
    }),
  );
  if (subjectIds.length === 0 || statuses.length === 0) return undefined;
  return { subjectIds, scopeGroups, subjectQuotas, statuses };
}

function parseScopeGroup(value: unknown): PaperDraftScopeGroup | undefined {
  if (!isRecord(value)) return undefined;
  const subjectParts = parseStringArray(value.sectionParts);
  const questionTypes = parseStringArray(value.questionTypes);
  const mode = value.mode;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.enabled !== "boolean" ||
    (mode !== "include" && mode !== "exclude") ||
    !subjectParts.every(isSectionPart) ||
    !questionTypes.every(isQuestionType)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    name: value.name,
    enabled: value.enabled,
    mode,
    workbookIds: parseStringArray(value.workbookIds),
    chapterKeys: parseStringArray(value.chapterKeys),
    sectionParts: subjectParts,
    questionTypes,
  };
}

function parseStatusArray(value: unknown): PracticeStatus[] {
  return parseStringArray(value).filter(isPracticeStatus);
}

function parseResultRecord(value: unknown): Record<string, AttemptResult> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([questionId, result]) =>
      isAttemptResult(result) ? [[questionId, result] as const] : [],
    ),
  );
}

function normalizeResultRecord(
  value: Record<string, AttemptResult> | undefined,
): Record<string, AttemptResult> | undefined {
  if (value === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(value).filter(([, result]) => isAttemptResult(result)),
  );
}

function normalizeViewState(value: unknown): PaperViewState {
  if (!isRecord(value)) return { ...DEFAULT_PAPER_VIEW_STATE };
  const mode: PaperViewMode = value.mode === "single" ? "single" : "continuous";
  const selectedQuestionType: PaperQuestionFilter = isPaperQuestionFilter(
    value.selectedQuestionType,
  )
    ? value.selectedQuestionType
    : "all";
  const activeQuestionId =
    typeof value.activeQuestionId === "string" &&
    value.activeQuestionId.length > 0
      ? value.activeQuestionId
      : undefined;
  return {
    mode,
    selectedQuestionType,
    ...(activeQuestionId === undefined ? {} : { activeQuestionId }),
  };
}

function isPaperQuestionFilter(value: unknown): value is PaperQuestionFilter {
  return value === "all" || isQuestionType(value);
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isSectionPart(value: string): value is SectionPart {
  return ["basic", "comprehensive", "extended", "other"].includes(value);
}

function isQuestionType(value: unknown): value is QuestionType {
  return (
    typeof value === "string" &&
    ["choice", "blank", "solution", "other"].includes(value)
  );
}

function isPracticeStatus(value: string): value is PracticeStatus {
  return ["unattempted", "correct", "uncertain", "incorrect"].includes(value);
}

function isAttemptResult(value: unknown): value is AttemptResult {
  return value === "correct" || value === "uncertain" || value === "incorrect";
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

function parseQuota(value: unknown): PaperTypeQuotas | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.choice !== "number" ||
    typeof value.blank !== "number" ||
    typeof value.solution !== "number" ||
    !Number.isFinite(value.choice) ||
    !Number.isFinite(value.blank) ||
    !Number.isFinite(value.solution)
  ) {
    return undefined;
  }
  return normalizeQuota({
    choice: value.choice,
    blank: value.blank,
    solution: value.solution,
  });
}

function normalizeQuota(quota: PaperTypeQuotas): PaperTypeQuotas {
  return {
    choice: normalizeQuotaValue(quota.choice),
    blank: normalizeQuotaValue(quota.blank),
    solution: normalizeQuotaValue(quota.solution),
  };
}

function normalizeQuotaValue(value: number): number {
  return Math.min(MAX_PAPER_QUOTA, Math.max(0, Math.round(value)));
}
