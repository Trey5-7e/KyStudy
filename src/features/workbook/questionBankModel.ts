import {
  practiceStatus,
  type IndexedQuestion,
  type PracticeStatus,
  type QuestionBankSnapshot,
  type SectionPart,
  type TrashedWorkbookDocumentSegment,
  type WorkbookCategory,
  type WorkbookDocumentSegment,
} from "../../shared/tauri/questionBankClient";
import type { QuestionType } from "../../shared/tauri/questionClient";

export type QuestionSegmentVisibility = "pending" | "browsable";
export type PaperScopeMode = "include" | "exclude";

export interface QuestionScope {
  subjectId?: string;
  workbookId?: string;
  chapter?: string;
  sectionPart?: SectionPart;
  questionType?: QuestionType;
}

/**
 * One composable paper range. Empty sets mean “all values” for that field;
 * populated sets are intersected within the group.
 */
export interface PaperScopeGroup {
  id: string;
  name: string;
  enabled: boolean;
  mode: PaperScopeMode;
  workbookIds: ReadonlySet<string>;
  /** Chapter keys are workbookId + chapter so same-named chapters stay scoped. */
  chapterKeys: ReadonlySet<string>;
  sectionParts: ReadonlySet<SectionPart>;
  questionTypes: ReadonlySet<QuestionType>;
}

export interface PaperTypeQuotas {
  choice: number;
  blank: number;
  solution: number;
}

export interface PaperSpec extends QuestionScope {
  subjectIds?: ReadonlySet<string>;
  /** Multiple groups are unioned; conditions inside one group are intersected. */
  scopeGroups?: ReadonlyArray<PaperScopeGroup>;
  /** When present, quotas are applied independently for each subject. */
  subjectQuotas?: ReadonlyMap<string, PaperTypeQuotas>;
  statuses: ReadonlySet<PracticeStatus>;
  choiceCount: number;
  blankCount: number;
  solutionCount: number;
}

export interface SegmentDeletionSummary {
  liveQuestionCount: number;
  attemptedQuestionCount: number;
  totalAttemptCount: number;
  hasAttemptHistory: boolean;
}

/**
 * Stable identity used while deciding whether an analyzed PDF range already
 * has an active question-bank segment.  Workbook id is deliberately omitted:
 * it is the value the import UI is deciding.
 */
export interface SegmentAssignmentTarget {
  documentId: string;
  subjectId: string;
  pageStart: number;
  pageEnd: number;
}

/**
 * Active segment candidates for one analyzed PDF range.  The backend's unique
 * key includes workbook id, so a range can legitimately have more than one
 * exact candidate.  We only provide a default when there is exactly one.
 */
export interface SegmentAssignmentMatches {
  exact: WorkbookDocumentSegment[];
  sameRangeOtherSubjects: WorkbookDocumentSegment[];
  defaultWorkbookId?: string;
}

export interface SegmentAssignmentConflictSummary {
  segmentId: string;
  documentId: string;
  documentTitle: string;
  pageStart: number;
  pageEnd: number;
  subjectId: string;
  subjectName: string;
  workbookId: string;
  workbookName: string;
  /** Number of live question rows in the supplied snapshot. */
  questionCount: number;
}

export interface SegmentAssignmentConflict {
  target: SegmentAssignmentTarget & { workbookId: string };
  existing: SegmentAssignmentConflictSummary[];
}

export interface SegmentRestoreConflict {
  target: TrashedWorkbookDocumentSegment;
  existing: SegmentAssignmentConflictSummary[];
}

export type SegmentReassignDisabledReason =
  "source-not-found" | "active-sibling" | "trashed-target";

export interface SegmentReassignAssessment {
  sourceSegmentId: string;
  targetWorkbookId: string;
  sameTarget: boolean;
  canReassign: boolean;
  disabledReason?: SegmentReassignDisabledReason;
  activeSiblings: SegmentAssignmentConflictSummary[];
  trashedTargets: TrashedWorkbookDocumentSegment[];
}

export interface SegmentReassignWorkbookOption extends SegmentReassignAssessment {
  workbook: WorkbookCategory;
}

/**
 * Finds active segments for an analyzed PDF range.
 *
 * Matching is intentionally strict: document, subject, and the complete page
 * range must all match.  A same-document/same-range segment under another
 * subject is returned separately for an informational warning, never as a
 * workbook default.
 */
export function findMatchingSegments(
  segments: readonly WorkbookDocumentSegment[],
  target: SegmentAssignmentTarget,
): SegmentAssignmentMatches {
  const exact = segments.filter(
    (segment) =>
      segment.documentId === target.documentId &&
      segment.subjectId === target.subjectId &&
      segment.pageStart === target.pageStart &&
      segment.pageEnd === target.pageEnd,
  );
  const sameRangeOtherSubjects = segments.filter(
    (segment) =>
      segment.documentId === target.documentId &&
      segment.subjectId !== target.subjectId &&
      segment.pageStart === target.pageStart &&
      segment.pageEnd === target.pageEnd,
  );

  return {
    exact,
    sameRangeOtherSubjects,
    defaultWorkbookId: exact.length === 1 ? exact[0]?.workbookId : undefined,
  };
}

/**
 * Summarizes active exact matches that would be duplicated by assigning an
 * analyzed range to a different workbook.  Counts come from live question rows
 * rather than the persisted segment counter, which may lag after maintenance.
 */
export function segmentAssignmentConflict(
  snapshot: Pick<QuestionBankSnapshot, "segments" | "questions">,
  target: SegmentAssignmentTarget & { workbookId: string },
): SegmentAssignmentConflict | undefined {
  const matches = findMatchingSegments(snapshot.segments, target);
  const existing = matches.exact.filter(
    (segment) => segment.workbookId !== target.workbookId,
  );
  if (existing.length === 0) return undefined;

  const liveQuestionCounts = new Map<string, number>();
  for (const question of snapshot.questions) {
    liveQuestionCounts.set(
      question.segmentId,
      (liveQuestionCounts.get(question.segmentId) ?? 0) + 1,
    );
  }

  return {
    target,
    existing: existing.map((segment) => ({
      segmentId: segment.id,
      documentId: segment.documentId,
      documentTitle: segment.documentTitle,
      pageStart: segment.pageStart,
      pageEnd: segment.pageEnd,
      subjectId: segment.subjectId,
      subjectName: segment.subjectName,
      workbookId: segment.workbookId,
      workbookName: segment.workbookName,
      questionCount: liveQuestionCounts.get(segment.id) ?? 0,
    })),
  };
}

function sameSegmentIdentity(
  left: Pick<
    WorkbookDocumentSegment,
    "documentId" | "subjectId" | "pageStart" | "pageEnd"
  >,
  right: Pick<
    WorkbookDocumentSegment,
    "documentId" | "subjectId" | "pageStart" | "pageEnd"
  >,
): boolean {
  return (
    left.documentId === right.documentId &&
    left.subjectId === right.subjectId &&
    left.pageStart === right.pageStart &&
    left.pageEnd === right.pageEnd
  );
}

function toSegmentAssignmentConflictSummary(
  segment: WorkbookDocumentSegment,
  questions: readonly IndexedQuestion[],
): SegmentAssignmentConflictSummary {
  return {
    segmentId: segment.id,
    documentId: segment.documentId,
    documentTitle: segment.documentTitle,
    pageStart: segment.pageStart,
    pageEnd: segment.pageEnd,
    subjectId: segment.subjectId,
    subjectName: segment.subjectName,
    workbookId: segment.workbookId,
    workbookName: segment.workbookName,
    questionCount: countQuestionsInSegment(questions, segment.id),
  };
}

/**
 * Finds active segments that would block restoring a trashed segment.
 *
 * The exact identity deliberately excludes workbook id while the conflict
 * payload retains the existing workbook and live question count.  A matching
 * segment in the same workbook is therefore safe to restore; a matching
 * segment under any other workbook must disable the restore action until the
 * user resolves the assignment explicitly.
 */
export function findSegmentRestoreConflicts(
  snapshot: Pick<QuestionBankSnapshot, "segments" | "questions">,
  trashedSegment: TrashedWorkbookDocumentSegment,
): SegmentRestoreConflict | undefined {
  const conflict = segmentAssignmentConflict(snapshot, {
    documentId: trashedSegment.documentId,
    subjectId: trashedSegment.subjectId,
    pageStart: trashedSegment.pageStart,
    pageEnd: trashedSegment.pageEnd,
    workbookId: trashedSegment.workbookId,
  });
  if (conflict === undefined) return undefined;
  return {
    target: trashedSegment,
    existing: conflict.existing,
  };
}

export const segmentRestoreConflict = findSegmentRestoreConflicts;

/**
 * Assesses whether an active segment can move to one target workbook.
 *
 * Exact identity intentionally includes the document, subject, and complete
 * page range, but not the workbook.  Existing active siblings and trashed
 * target rows are returned as displayable data so a manager can explain why a
 * target is disabled without keeping a second copy of UI state.
 */
export function findSegmentReassignConflicts(
  snapshot: Pick<QuestionBankSnapshot, "segments" | "questions">,
  trashedSegments: readonly TrashedWorkbookDocumentSegment[],
  sourceSegment: WorkbookDocumentSegment,
  targetWorkbookId: string,
): SegmentReassignAssessment {
  const sourceExists = snapshot.segments.some(
    (segment) => segment.id === sourceSegment.id,
  );
  const sameTarget = sourceSegment.workbookId === targetWorkbookId;
  const activeSiblings = snapshot.segments
    .filter(
      (segment) =>
        segment.id !== sourceSegment.id &&
        sameSegmentIdentity(segment, sourceSegment),
    )
    .map((segment) =>
      toSegmentAssignmentConflictSummary(segment, snapshot.questions),
    );
  const trashedTargets = trashedSegments.filter(
    (segment) =>
      segment.id !== sourceSegment.id &&
      segment.workbookId === targetWorkbookId &&
      sameSegmentIdentity(segment, sourceSegment),
  );

  let disabledReason: SegmentReassignDisabledReason | undefined;
  if (!sourceExists) {
    disabledReason = "source-not-found";
  } else if (!sameTarget && activeSiblings.length > 0) {
    disabledReason = "active-sibling";
  } else if (!sameTarget && trashedTargets.length > 0) {
    disabledReason = "trashed-target";
  }

  return {
    sourceSegmentId: sourceSegment.id,
    targetWorkbookId,
    sameTarget,
    canReassign: disabledReason === undefined,
    disabledReason,
    activeSiblings,
    trashedTargets,
  };
}

/** Returns one pure reassignment assessment for every active workbook option. */
export function getSegmentReassignOptions(
  snapshot: Pick<QuestionBankSnapshot, "workbooks" | "segments" | "questions">,
  trashedSegments: readonly TrashedWorkbookDocumentSegment[],
  sourceSegment: WorkbookDocumentSegment,
): SegmentReassignWorkbookOption[] {
  return snapshot.workbooks.map((workbook) => ({
    workbook,
    ...findSegmentReassignConflicts(
      snapshot,
      trashedSegments,
      sourceSegment,
      workbook.id,
    ),
  }));
}

export const segmentReassignConflicts = findSegmentReassignConflicts;
export const segmentReassignOptions = getSegmentReassignOptions;

export function segmentDeletionSummary(
  segment: Pick<WorkbookDocumentSegment, "id">,
  questions: readonly Pick<IndexedQuestion, "segmentId" | "attemptCount">[],
): SegmentDeletionSummary {
  let liveQuestionCount = 0;
  let attemptedQuestionCount = 0;
  let totalAttemptCount = 0;

  for (const question of questions) {
    if (question.segmentId !== segment.id) continue;
    liveQuestionCount += 1;
    if (question.attemptCount > 0) attemptedQuestionCount += 1;
    totalAttemptCount += question.attemptCount;
  }

  return {
    liveQuestionCount,
    attemptedQuestionCount,
    totalAttemptCount,
    hasAttemptHistory: totalAttemptCount > 0,
  };
}

/** Returns only the live indexed questions belonging to one segment. */
export function questionsInSegment(
  questions: readonly IndexedQuestion[],
  segmentId: string,
): IndexedQuestion[] {
  return questions.filter((question) => question.segmentId === segmentId);
}

/** Counts live indexed questions belonging to one segment. */
export function countQuestionsInSegment(
  questions: readonly Pick<IndexedQuestion, "segmentId">[],
  segmentId: string,
): number {
  let count = 0;
  for (const question of questions) {
    if (question.segmentId === segmentId) count += 1;
  }
  return count;
}

/**
 * Describes whether a segment can contribute questions to browsing/filtering.
 *
 * A segment row can exist before its index import has completed.  Persisted
 * question counts can lag maintenance, so the live question rows in the
 * supplied snapshot are the source of truth for whether this snapshot can
 * actually browse the segment.  Keep pending segments conservative even if
 * stale rows happen to be present while an import is in progress.
 */
export function questionSegmentVisibility(
  segment: Pick<WorkbookDocumentSegment, "id" | "indexState" | "questionCount">,
  questions: readonly Pick<IndexedQuestion, "segmentId">[],
): QuestionSegmentVisibility {
  if (segment.indexState === "pending") return "pending";
  return questions.some((question) => question.segmentId === segment.id)
    ? "browsable"
    : "pending";
}

export function questionsInScope(
  questions: readonly IndexedQuestion[],
  scope: QuestionScope,
): IndexedQuestion[] {
  return questions.filter(
    (question) =>
      (scope.subjectId === undefined ||
        question.subjectId === scope.subjectId) &&
      (scope.workbookId === undefined ||
        question.workbookId === scope.workbookId) &&
      (scope.chapter === undefined || question.chapter === scope.chapter) &&
      (scope.sectionPart === undefined ||
        question.sectionPart === scope.sectionPart) &&
      (scope.questionType === undefined ||
        question.questionType === scope.questionType),
  );
}

export function paperChapterKey(workbookId: string, chapter: string): string {
  return `${workbookId}\u0000${chapter}`;
}

/** Returns questions matching one paper range group. */
export function questionsInPaperScope(
  questions: readonly IndexedQuestion[],
  group: Pick<
    PaperScopeGroup,
    "workbookIds" | "chapterKeys" | "sectionParts" | "questionTypes"
  >,
): IndexedQuestion[] {
  return questions.filter((question) => {
    const chapterKey = paperChapterKey(question.workbookId, question.chapter);
    return (
      (group.workbookIds.size === 0 ||
        group.workbookIds.has(question.workbookId)) &&
      (group.chapterKeys.size === 0 || group.chapterKeys.has(chapterKey)) &&
      (group.sectionParts.size === 0 ||
        group.sectionParts.has(question.sectionPart)) &&
      (group.questionTypes.size === 0 ||
        group.questionTypes.has(question.questionType))
    );
  });
}

/**
 * Returns enabled paper ranges in source order. Include groups are unioned;
 * exclude groups always win over included questions.
 */
export function questionsInPaperScopeGroups(
  questions: readonly IndexedQuestion[],
  groups: readonly PaperScopeGroup[],
): IndexedQuestion[] {
  if (groups.length === 0) return [...questions];
  const enabledGroups = groups.filter((group) => group.enabled);
  if (enabledGroups.length === 0) return [];
  const includeGroups = enabledGroups.filter(
    (group) => group.mode === "include",
  );
  const excludeGroups = enabledGroups.filter(
    (group) => group.mode === "exclude",
  );
  const matchingIds = new Set(
    includeGroups.length === 0 ? questions.map((question) => question.id) : [],
  );
  for (const group of includeGroups) {
    for (const question of questionsInPaperScope(questions, group)) {
      matchingIds.add(question.id);
    }
  }
  const excludedIds = new Set<string>();
  for (const group of excludeGroups) {
    for (const question of questionsInPaperScope(questions, group)) {
      excludedIds.add(question.id);
    }
  }
  return questions.filter(
    (question) => matchingIds.has(question.id) && !excludedIds.has(question.id),
  );
}

export function parseQuestionNumberSelection(value: string): string[] {
  const numbers = new Set<number>();
  for (const rawPart of value.replaceAll("，", ",").split(",")) {
    const part = rawPart.trim();
    if (part === "") continue;
    const range = /^(\d{1,4})\s*[-—~至]\s*(\d{1,4})$/.exec(part);
    if (range !== null) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end < start || end - start > 500) {
        throw new Error("QUESTION_NUMBER_RANGE_INVALID");
      }
      for (let number = start; number <= end; number += 1) numbers.add(number);
      continue;
    }
    if (!/^\d{1,4}$/.test(part) || Number(part) < 1) {
      throw new Error("QUESTION_NUMBER_RANGE_INVALID");
    }
    numbers.add(Number(part));
  }
  return [...numbers].sort((left, right) => left - right).map(String);
}

export function generateWeightedPaper(
  questions: readonly IndexedQuestion[],
  spec: PaperSpec,
  random: () => number = Math.random,
): IndexedQuestion[] {
  const scopedQuestions =
    spec.scopeGroups === undefined
      ? questionsInScope(questions, spec)
      : questionsInPaperScopeGroups(
          questionsInScope(questions, spec),
          spec.scopeGroups,
        );
  const candidates = scopedQuestions.filter(
    (question) =>
      (spec.subjectIds === undefined ||
        spec.subjectIds.has(question.subjectId)) &&
      spec.statuses.has(practiceStatus(question)),
  );
  if (spec.subjectQuotas === undefined) {
    return samplePaperQuotas(
      candidates,
      {
        choice: spec.choiceCount,
        blank: spec.blankCount,
        solution: spec.solutionCount,
      },
      random,
    );
  }
  const subjectIds = [
    ...new Set(candidates.map((question) => question.subjectId)),
  ];
  const sampledBySubject = new Map(
    subjectIds.map((subjectId) => [
      subjectId,
      samplePaperQuotas(
        candidates.filter((question) => question.subjectId === subjectId),
        spec.subjectQuotas?.get(subjectId) ?? {
          choice: spec.choiceCount,
          blank: spec.blankCount,
          solution: spec.solutionCount,
        },
        random,
      ),
    ]),
  );
  return PAPER_QUESTION_TYPES.flatMap((questionType) =>
    subjectIds.flatMap((subjectId) =>
      (sampledBySubject.get(subjectId) ?? []).filter(
        (question) => question.questionType === questionType,
      ),
    ),
  );
}

const PAPER_QUESTION_TYPES: readonly QuestionType[] = [
  "choice",
  "blank",
  "solution",
];

function samplePaperQuotas(
  candidates: readonly IndexedQuestion[],
  quotas: PaperTypeQuotas,
  random: () => number,
): IndexedQuestion[] {
  const entries: ReadonlyArray<[QuestionType, number]> = [
    ["choice", quotas.choice],
    ["blank", quotas.blank],
    ["solution", quotas.solution],
  ];
  return entries.flatMap(([questionType, count]) =>
    weightedSampleWithoutReplacement(
      candidates.filter((question) => question.questionType === questionType),
      count,
      random,
    ),
  );
}

function weightedSampleWithoutReplacement(
  candidates: readonly IndexedQuestion[],
  requestedCount: number,
  random: () => number,
): IndexedQuestion[] {
  const available = [...candidates];
  const selected: IndexedQuestion[] = [];
  const count = Math.min(Math.max(0, requestedCount), available.length);
  while (selected.length < count) {
    const weights = available.map(questionWeight);
    const total = weights.reduce((sum, value) => sum + value, 0);
    let cursor = random() * total;
    let selectedIndex = available.length - 1;
    for (const [index, weight] of weights.entries()) {
      cursor -= weight;
      if (cursor <= 0) {
        selectedIndex = index;
        break;
      }
    }
    const [question] = available.splice(selectedIndex, 1);
    if (question !== undefined) selected.push(question);
  }
  return selected;
}

export function questionWeight(question: IndexedQuestion): number {
  const stateWeight: Record<PracticeStatus, number> = {
    unattempted: 1.2,
    correct: 0.55,
    uncertain: 2,
    incorrect: 3,
  };
  return (
    stateWeight[practiceStatus(question)] +
    question.incorrectCount * 0.35 +
    question.partialCount * 0.2
  );
}
