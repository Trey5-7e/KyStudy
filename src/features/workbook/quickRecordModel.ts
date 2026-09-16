import type {
  AttemptResult,
  QuestionType,
} from "../../shared/tauri/questionClient";
import type {
  IndexedQuestion,
  SectionPart,
} from "../../shared/tauri/questionBankClient";
import { parseQuestionNumberSelection } from "./questionBankModel";
import {
  getConflictingPriorityTag,
  sanitizeQuestionTags,
} from "../review/mistakeTagModel";

export type AttemptMode = AttemptResult | "unattempted";
export type TagMode = "must_do" | "optional_do";
export type MatrixMode = AttemptMode | TagMode;

export type AttemptAction = AttemptMode | "clear";
export type MatrixAction = MatrixMode | "clear";

export type StagedResult = AttemptResult | "unattempted";
export type StagedAttempts = Record<string, StagedResult>;

export interface QuickRecordFields {
  completed: string;
  incorrect: string;
  partial: string;
}

export interface QuickRecordGroup {
  key: string;
  sectionPart: SectionPart;
  questionType: QuestionType;
  label: string;
  partLabel: string;
  typeLabel: string;
  questions: IndexedQuestion[];
}

export const PART_LABEL_MAP: Record<SectionPart, string> = {
  basic: "基础题",
  comprehensive: "综合题",
  extended: "拓展题",
  other: "其他",
};

export const TYPE_LABEL_MAP: Record<QuestionType, string> = {
  choice: "选择题",
  blank: "填空题",
  solution: "解答题",
  other: "其他",
};

export const ATTEMPT_MODE_OPTIONS: ReadonlyArray<{
  value: AttemptMode;
  label: string;
}> = [
  { value: "correct", label: "做对" },
  { value: "incorrect", label: "做错" },
  { value: "uncertain", label: "不全对" },
  { value: "unattempted", label: "未做" },
];

export const TAG_MODE_OPTIONS: ReadonlyArray<{
  value: TagMode;
  label: string;
  tagLabel: string;
}> = [
  { value: "must_do", label: "必做", tagLabel: "必做" },
  { value: "optional_do", label: "选做", tagLabel: "选做" },
];

export const MATRIX_MODE_OPTIONS: ReadonlyArray<{
  value: MatrixMode;
  label: string;
}> = [
  ...ATTEMPT_MODE_OPTIONS,
  ...TAG_MODE_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
];

export function parseMatrixNumbers(value: string): Set<string> {
  try {
    return new Set(parseQuestionNumberSelection(value));
  } catch {
    return new Set();
  }
}

export function formatMatrixNumbers(numbers: Set<string>): string {
  return [...numbers]
    .sort((left, right) => Number(left) - Number(right))
    .join(",");
}

export function updateMatrixFields(
  fields: QuickRecordFields,
  questionNumber: string,
  action: MatrixAction,
): QuickRecordFields {
  const next = {
    completed: parseMatrixNumbers(fields.completed),
    incorrect: parseMatrixNumbers(fields.incorrect),
    partial: parseMatrixNumbers(fields.partial),
  };
  next.completed.delete(questionNumber);
  next.incorrect.delete(questionNumber);
  next.partial.delete(questionNumber);
  if (action !== "clear") {
    const target =
      action === "correct"
        ? next.completed
        : action === "incorrect"
          ? next.incorrect
          : next.partial;
    target.add(questionNumber);
  }
  return {
    completed: formatMatrixNumbers(next.completed),
    incorrect: formatMatrixNumbers(next.incorrect),
    partial: formatMatrixNumbers(next.partial),
  };
}

export function matrixStatusByNumber(
  fields: QuickRecordFields,
): ReadonlyMap<string, AttemptResult> {
  const next = new Map<string, AttemptResult>();
  for (const number of parseMatrixNumbers(fields.completed))
    next.set(number, "correct");
  for (const number of parseMatrixNumbers(fields.partial))
    next.set(number, "uncertain");
  for (const number of parseMatrixNumbers(fields.incorrect))
    next.set(number, "incorrect");
  return next;
}

export interface MatrixCellState {
  effectiveStatus?: AttemptResult;
  isStaged: boolean;
  hasSavedStatus: boolean;
  label: string;
}

export function matrixCellStatus(
  question: IndexedQuestion,
  stagedStatus?: StagedResult,
): MatrixCellState {
  const savedStatus = question.currentResult;
  const hasSavedStatus = savedStatus !== undefined;
  const isStaged = stagedStatus !== undefined;

  let effectiveStatus: AttemptResult | undefined;
  if (stagedStatus === "unattempted") {
    effectiveStatus = undefined;
  } else if (stagedStatus !== undefined) {
    effectiveStatus = stagedStatus;
  } else {
    effectiveStatus = savedStatus;
  }

  const statusText =
    stagedStatus === "unattempted"
      ? "未做（本次重置）"
      : effectiveStatus === "correct"
        ? "做对"
        : effectiveStatus === "incorrect"
          ? "做错"
          : effectiveStatus === "uncertain"
            ? "不全对"
            : "未做";

  const label = isStaged
    ? `${question.questionNumber}题本次标记：${statusText}`
    : hasSavedStatus
      ? `${question.questionNumber}题已保存状态：${statusText}`
      : `${question.questionNumber}题未做`;

  return {
    effectiveStatus,
    isStaged,
    hasSavedStatus,
    label,
  };
}

export function compareMatrixQuestions(
  left: IndexedQuestion,
  right: IndexedQuestion,
): number {
  const leftNumber = Number(left.questionNumber.trim());
  const rightNumber = Number(right.questionNumber.trim());
  const leftNumeric = Number.isSafeInteger(leftNumber);
  const rightNumeric = Number.isSafeInteger(rightNumber);
  if (leftNumeric && rightNumeric && leftNumber !== rightNumber)
    return leftNumber - rightNumber;
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.questionNumber.localeCompare(right.questionNumber, "zh-CN");
}

export function groupQuestionsByPartAndType(
  questions: readonly IndexedQuestion[],
): QuickRecordGroup[] {
  const map = new Map<string, IndexedQuestion[]>();
  for (const question of questions) {
    const key = `${question.sectionPart}:${question.questionType}`;
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(question);
  }

  const partOrder: SectionPart[] = [
    "basic",
    "comprehensive",
    "extended",
    "other",
  ];
  const typeOrder: QuestionType[] = ["choice", "blank", "solution", "other"];

  const groups: QuickRecordGroup[] = [];
  for (const part of partOrder) {
    for (const qType of typeOrder) {
      const key = `${part}:${qType}`;
      const groupQuestions = map.get(key);
      if (groupQuestions && groupQuestions.length > 0) {
        groupQuestions.sort(compareMatrixQuestions);
        const partLabel = PART_LABEL_MAP[part] ?? part;
        const typeLabel = TYPE_LABEL_MAP[qType] ?? qType;
        groups.push({
          key,
          sectionPart: part,
          questionType: qType,
          label: `${partLabel} · ${typeLabel}`,
          partLabel,
          typeLabel,
          questions: groupQuestions,
        });
      }
    }
  }

  for (const [key, groupQuestions] of map.entries()) {
    if (!groups.some((g) => g.key === key)) {
      groupQuestions.sort(compareMatrixQuestions);
      const [p, t] = key.split(":") as [SectionPart, QuestionType];
      groups.push({
        key,
        sectionPart: p,
        questionType: t,
        label: `${p} · ${t}`,
        partLabel: p,
        typeLabel: t,
        questions: groupQuestions,
      });
    }
  }

  return groups;
}

export function setQuestionStagedResult(
  staged: StagedAttempts,
  questionId: string,
  action: MatrixAction,
): StagedAttempts {
  const next = { ...staged };
  if (action === "clear") {
    delete next[questionId];
  } else if (
    action === "correct" ||
    action === "incorrect" ||
    action === "uncertain" ||
    action === "unattempted"
  ) {
    next[questionId] = action;
  }
  return next;
}

export function toggleQuestionStagedResult(
  staged: StagedAttempts,
  target: string | IndexedQuestion,
  mode: AttemptMode,
): StagedAttempts {
  const questionId = typeof target === "string" ? target : target.id;
  const savedStatus =
    typeof target === "string" ? undefined : target.currentResult;
  const currentStaged = staged[questionId];
  const effectiveStatus =
    currentStaged === "unattempted"
      ? undefined
      : (currentStaged ?? savedStatus);

  if (effectiveStatus === mode) {
    return savedStatus !== undefined
      ? setQuestionStagedResult(staged, questionId, "unattempted")
      : setQuestionStagedResult(staged, questionId, "clear");
  }

  if (mode === "unattempted") {
    if (effectiveStatus === undefined) {
      return setQuestionStagedResult(staged, questionId, "clear");
    }
    return savedStatus !== undefined
      ? setQuestionStagedResult(staged, questionId, "unattempted")
      : setQuestionStagedResult(staged, questionId, "clear");
  }

  return setQuestionStagedResult(staged, questionId, mode);
}

export function toggleQuestionTag(
  tagsMap: Record<string, string[]>,
  questionId: string,
  tagLabel: string,
): Record<string, string[]> {
  const current = tagsMap[questionId] ?? [];
  const conflicting = getConflictingPriorityTag(tagLabel);
  let next: string[];

  // If both tags are currently present (legacy/stale state) and user clicks one of them,
  // keep the clicked tag and remove the conflicting one.
  if (
    conflicting !== undefined &&
    current.includes(conflicting) &&
    current.includes(tagLabel)
  ) {
    next = current.filter((t) => t !== conflicting);
  } else if (current.includes(tagLabel)) {
    // If user clicks the tag that is already set (and no conflict), toggle it off.
    next = current.filter((t) => t !== tagLabel);
  } else {
    // Add tagLabel and remove conflicting tag if any.
    const base =
      conflicting !== undefined
        ? current.filter((t) => t !== conflicting)
        : current;
    next = sanitizeQuestionTags([...base, tagLabel], tagLabel);
  }

  const copy = { ...tagsMap };
  if (next.length > 0) {
    copy[questionId] = next;
  } else {
    delete copy[questionId];
  }
  return copy;
}

export function setQuestionTag(
  tagsMap: Record<string, string[]>,
  questionId: string,
  tagLabel: string,
  add: boolean,
): Record<string, string[]> {
  const current = tagsMap[questionId] ?? [];
  const conflicting = getConflictingPriorityTag(tagLabel);

  if (add) {
    const base =
      conflicting !== undefined
        ? current.filter((t) => t !== conflicting)
        : current;
    const cleanList = sanitizeQuestionTags([...base, tagLabel], tagLabel);
    if (
      cleanList.length === current.length &&
      cleanList.every((t, i) => t === current[i])
    ) {
      return tagsMap;
    }
    return { ...tagsMap, [questionId]: cleanList };
  }

  const next = current.filter((t) => t !== tagLabel);
  if (next.length === current.length) return tagsMap;
  const copy = { ...tagsMap };
  if (next.length > 0) {
    copy[questionId] = next;
  } else {
    delete copy[questionId];
  }
  return copy;
}

export function markAllQuestionsInGroup(
  staged: StagedAttempts,
  questions: readonly IndexedQuestion[],
  action: AttemptAction | MatrixAction,
): StagedAttempts {
  const next = { ...staged };
  for (const q of questions) {
    if (action === "clear") {
      delete next[q.id];
    } else if (
      action === "correct" ||
      action === "incorrect" ||
      action === "uncertain" ||
      action === "unattempted"
    ) {
      next[q.id] = action;
    }
  }
  return next;
}

export function syncStagedFromFields(
  staged: StagedAttempts,
  targetQuestions: readonly IndexedQuestion[],
  fields: QuickRecordFields,
): StagedAttempts {
  const completedNumbers = parseMatrixNumbers(fields.completed);
  const incorrectNumbers = parseMatrixNumbers(fields.incorrect);
  const partialNumbers = parseMatrixNumbers(fields.partial);

  const next = { ...staged };
  for (const q of targetQuestions) {
    if (incorrectNumbers.has(q.questionNumber)) {
      next[q.id] = "incorrect";
    } else if (partialNumbers.has(q.questionNumber)) {
      next[q.id] = "uncertain";
    } else if (completedNumbers.has(q.questionNumber)) {
      next[q.id] = "correct";
    } else {
      delete next[q.id];
    }
  }
  return next;
}

export function deriveFieldsFromStaged(
  staged: StagedAttempts,
  targetQuestions: readonly IndexedQuestion[],
): QuickRecordFields {
  const completed = new Set<string>();
  const incorrect = new Set<string>();
  const partial = new Set<string>();

  for (const q of targetQuestions) {
    const res = staged[q.id];
    if (res === "correct") {
      completed.add(q.questionNumber);
    } else if (res === "incorrect") {
      incorrect.add(q.questionNumber);
    } else if (res === "uncertain") {
      partial.add(q.questionNumber);
    }
  }

  return {
    completed: formatMatrixNumbers(completed),
    incorrect: formatMatrixNumbers(incorrect),
    partial: formatMatrixNumbers(partial),
  };
}
