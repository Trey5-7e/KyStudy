import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";
import {
  localDateForTimezone,
  type StudySubject,
} from "../../shared/tauri/scheduleClient";
import {
  listResources,
  type ResourceDocument,
} from "../../shared/tauri/resourceClient";
import {
  getReviewSchemeDashboard,
  normalizeReviewSchemeError,
  type ReviewSchemeCommandError,
  type ReviewSchemeDashboard,
  type ReviewScheme,
} from "../../shared/tauri/reviewSchemeClient";
import type { QuestionType } from "../../shared/tauri/questionClient";

export const QUESTION_TYPES: ReadonlyArray<{
  value: QuestionType;
  label: string;
}> = [
  { value: "choice", label: "选择" },
  { value: "blank", label: "填空" },
  { value: "solution", label: "解答" },
  { value: "other", label: "其他" },
];
export const WEEKDAYS = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];
export interface SchemeDraft {
  schemeId?: string;
  name: string;
  subjectId: string;
  allSubjectWorkbooks: boolean;
  dailyQuota: string;
  enabled: boolean;
  documentIds: string[];
  quotas: Record<QuestionType, string>;
}
export const EMPTY_DRAFT: SchemeDraft = {
  name: "",
  subjectId: "",
  allSubjectWorkbooks: false,
  dailyQuota: "5",
  enabled: true,
  documentIds: [],
  quotas: { choice: "2", blank: "1", solution: "2", other: "0" },
};
export interface ReadyState {
  today: string;
  dashboard: ReviewSchemeDashboard;
  subjects: StudySubject[];
  workbooks: ResourceDocument[];
}
export type PageState =
  | { kind: "loading" }
  | { kind: "missing-workspace" }
  | { kind: "ready"; value: ReadyState }
  | { kind: "error"; error: ReviewSchemeCommandError };
export async function loadReviewPage(): Promise<PageState> {
  try {
    const workspace = await getWorkspaceStatus();
    if (!workspace) return { kind: "missing-workspace" };
    const today = localDateForTimezone(new Date(), workspace.timezone);
    const [dashboard, subjects, resources] = await Promise.all([
      getReviewSchemeDashboard(today),
      import("../../shared/tauri/scheduleClient").then((m) => m.listSubjects()),
      listResources(),
    ]);
    return {
      kind: "ready",
      value: {
        today,
        dashboard,
        subjects: subjects.filter((s) => !s.archivedAt),
        workbooks: resources.filter(
          (r) => r.kind === "pdf" && r.role === "workbook",
        ),
      },
    };
  } catch (error) {
    return { kind: "error", error: normalizeReviewSchemeError(error) };
  }
}
export function sameSchemeDraft(a: SchemeDraft, b: SchemeDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
export function draftFromScheme(scheme: ReviewScheme): SchemeDraft {
  const quotas: Record<QuestionType, string> = {
    choice: "0",
    blank: "0",
    solution: "0",
    other: "0",
  };
  for (const q of scheme.typeQuotas)
    quotas[q.questionType as QuestionType] = String(q.quota);
  return {
    schemeId: scheme.id,
    name: scheme.name,
    subjectId: scheme.subjectId,
    allSubjectWorkbooks: scheme.allSubjectWorkbooks,
    dailyQuota: String(scheme.dailyQuota),
    enabled: scheme.enabled,
    documentIds: [...scheme.documentIds],
    quotas,
  };
}
export function toSaveInput(draft: SchemeDraft, today: string) {
  return {
    ...(draft.schemeId ? { schemeId: draft.schemeId } : {}),
    name: draft.name,
    subjectId: draft.subjectId,
    allSubjectWorkbooks: draft.allSubjectWorkbooks,
    dailyQuota: Number(draft.dailyQuota),
    enabled: draft.enabled,
    documentIds: draft.documentIds,
    typeQuotas: QUESTION_TYPES.map((item) => ({
      questionType: item.value,
      quota: Number(draft.quotas[item.value]),
    })),
    today,
  };
}
export function quotaSummary(
  quotas: Array<{ questionType: QuestionType; quota: number }>,
): string {
  return quotas
    .filter((q) => q.quota > 0)
    .map(
      (q) =>
        `${QUESTION_TYPES.find((i) => i.value === q.questionType)?.label ?? "待分类"} ${q.quota}`,
    )
    .join(" / ");
}
