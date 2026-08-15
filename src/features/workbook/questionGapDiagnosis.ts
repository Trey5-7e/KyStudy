import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";

export type QuestionGapIssue = MissingQuestionIssue | IndexReviewIssue;

interface BaseQuestionGapIssue {
  id: string;
  subjectName: string;
  workbookName: string;
  chapter: string;
  sectionPart: IndexedQuestion["sectionPart"];
  questionType: IndexedQuestion["questionType"];
  evidence: string;
}

export interface MissingQuestionIssue extends BaseQuestionGapIssue {
  kind: "missing";
  suggestedQuestionNumber: string;
  anchorQuestionId: string;
  placement: "before";
  confidence: "high" | "medium";
}

export interface IndexReviewIssue extends BaseQuestionGapIssue {
  kind: "duplicate" | "large_jump" | "non_numeric";
  questionId: string;
}

const MAX_EXPANDED_GAP = 12;
const MAX_ISSUES = 100;

interface NumberedQuestion {
  question: IndexedQuestion;
  number: number;
}

type ContinuityMode = "global" | "per_type" | "ambiguous";

/**
 * `questions` is the range currently visible in the browser.  The optional
 * second argument lets the caller provide the unfiltered range as context so
 * that a question-type filter cannot hide a number that belongs to a shared
 * numbering run.
 */
export function diagnoseQuestionGaps(
  questions: readonly IndexedQuestion[],
  contextQuestions: readonly IndexedQuestion[] = questions,
): QuestionGapIssue[] {
  if (questions.length === 0) return [];

  const visibleIds = new Set(questions.map((question) => question.id));
  const contextById = new Map<string, IndexedQuestion>();
  for (const question of contextQuestions) {
    contextById.set(question.id, question);
  }
  // Keep the call safe when a caller passes a partial context range.
  for (const question of questions) contextById.set(question.id, question);

  const groups = new Map<string, IndexedQuestion[]>();
  for (const question of contextById.values()) {
    const key = [
      question.segmentId,
      question.chapter,
      question.sectionPart,
    ].join("\u0000");
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [question]);
    else group.push(question);
  }

  const issues: QuestionGapIssue[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort(compareQuestionOrder);
    let numberedRun: NumberedQuestion[] = [];
    let canInferInitialGap = true;
    for (const question of ordered) {
      const number = parseQuestionNumber(question.questionNumber);
      if (number === undefined) {
        diagnoseNumberedRun(
          issues,
          numberedRun,
          canInferInitialGap,
          visibleIds,
        );
        if (issues.length >= MAX_ISSUES) return issues.slice(0, MAX_ISSUES);
        numberedRun = [];
        canInferInitialGap = false;
        if (visibleIds.has(question.id)) {
          issues.push({
            ...issueContext(question),
            id: `non_numeric|${question.id}|${question.questionNumber.trim()}`,
            kind: "non_numeric",
            questionId: question.id,
            evidence: `题号“${question.questionNumber}”不是纯数字，未参与连续性判断，建议人工抽查。`,
          });
        }
        if (issues.length >= MAX_ISSUES) return issues.slice(0, MAX_ISSUES);
        continue;
      }

      const previous = numberedRun.at(-1);
      // A same-type backward number is a conservative boundary for a new
      // subsection or question set. Cross-type decreases are left in the run
      // so that independent per-type numbering can be recognized first.
      const sameTypeReset =
        previous !== undefined &&
        number < previous.number &&
        previous.question.questionType === question.questionType;
      if (sameTypeReset) {
        diagnoseNumberedRun(issues, numberedRun, false, visibleIds);
        if (issues.length >= MAX_ISSUES) return issues.slice(0, MAX_ISSUES);
        numberedRun = [];
        canInferInitialGap = false;
      }
      numberedRun.push({ question, number });
    }
    diagnoseNumberedRun(issues, numberedRun, canInferInitialGap, visibleIds);
    if (issues.length >= MAX_ISSUES) return issues.slice(0, MAX_ISSUES);
  }
  return issues.slice(0, MAX_ISSUES);
}

function diagnoseNumberedRun(
  issues: QuestionGapIssue[],
  numbered: readonly NumberedQuestion[],
  canInferInitialGap: boolean,
  visibleIds: ReadonlySet<string>,
): void {
  const first = numbered[0];
  if (first === undefined) return;
  const mode = inferContinuityMode(numbered);
  if (
    canInferInitialGap &&
    mode === "global" &&
    first.number > 1 &&
    first.number <= MAX_EXPANDED_GAP + 1
  ) {
    addMissingRange(
      issues,
      first.question,
      1,
      first.number - 1,
      undefined,
      visibleIds,
    );
  }

  if (mode === "per_type") {
    const byType = new Map<
      IndexedQuestion["questionType"],
      NumberedQuestion[]
    >();
    for (const entry of numbered) {
      const values = byType.get(entry.question.questionType);
      if (values === undefined)
        byType.set(entry.question.questionType, [entry]);
      else values.push(entry);
    }
    for (const values of byType.values()) {
      compareNumberedPairs(issues, values, visibleIds);
      if (issues.length >= MAX_ISSUES) return;
    }
    return;
  }

  if (mode === "global") {
    compareNumberedPairs(issues, numbered, visibleIds);
    return;
  }

  // Ambiguous type transitions are deliberately conservative: only a
  // same-type pair that is adjacent in source order can create an issue.
  for (let index = 1; index < numbered.length; index += 1) {
    const previous = numbered[index - 1];
    const current = numbered[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      previous.question.questionType === current.question.questionType
    ) {
      compareNumberedPairs(issues, [previous, current], visibleIds);
    }
    if (issues.length >= MAX_ISSUES) return;
  }
}

function compareNumberedPairs(
  issues: QuestionGapIssue[],
  numbered: readonly NumberedQuestion[],
  visibleIds: ReadonlySet<string>,
): void {
  for (let index = 1; index < numbered.length; index += 1) {
    const previous = numbered[index - 1];
    const current = numbered[index];
    if (previous === undefined || current === undefined) continue;
    if (current.number === previous.number) {
      if (issues.length >= MAX_ISSUES || !visibleIds.has(current.question.id)) {
        if (issues.length >= MAX_ISSUES) return;
        continue;
      }
      issues.push({
        ...issueContext(current.question),
        id: `duplicate|${previous.question.id}|${previous.number}|${current.question.id}|${current.number}`,
        kind: "duplicate",
        questionId: current.question.id,
        evidence: `题号 ${current.number} 连续出现 2 次，可能存在重复索引或漏分题。`,
      });
    } else if (current.number > previous.number + 1) {
      const gapSize = current.number - previous.number - 1;
      if (gapSize <= MAX_EXPANDED_GAP) {
        addMissingRange(
          issues,
          current.question,
          previous.number + 1,
          current.number - 1,
          previous.number,
          visibleIds,
        );
      } else {
        addLargeJump(
          issues,
          current.question,
          previous.number,
          current.number,
          previous.question.id,
          visibleIds,
        );
      }
    }
    if (issues.length >= MAX_ISSUES) return;
  }
}

function inferContinuityMode(
  numbered: readonly NumberedQuestion[],
): ContinuityMode {
  const types = new Set(numbered.map((entry) => entry.question.questionType));
  if (types.size <= 1) return "global";

  const crossTypePairs = pairwise(numbered).filter(
    ([previous, current]) =>
      previous.question.questionType !== current.question.questionType,
  );
  if (crossTypePairs.length === 0) return "global";
  if (
    crossTypePairs.every(
      ([previous, current]) => current.number > previous.number,
    )
  ) {
    return "global";
  }

  const byType = new Map<IndexedQuestion["questionType"], NumberedQuestion[]>();
  for (const entry of numbered) {
    const values = byType.get(entry.question.questionType);
    if (values === undefined) byType.set(entry.question.questionType, [entry]);
    else values.push(entry);
  }
  const perTypePairs = [...byType.values()].flatMap(pairwise);
  if (
    perTypePairs.length > 0 &&
    perTypePairs.every(
      ([previous, current]) => current.number >= previous.number,
    )
  ) {
    return "per_type";
  }
  return "ambiguous";
}

function pairwise(
  numbered: readonly NumberedQuestion[],
): Array<[NumberedQuestion, NumberedQuestion]> {
  const pairs: Array<[NumberedQuestion, NumberedQuestion]> = [];
  for (let index = 1; index < numbered.length; index += 1) {
    const previous = numbered[index - 1];
    const current = numbered[index];
    if (previous !== undefined && current !== undefined) {
      pairs.push([previous, current]);
    }
  }
  return pairs;
}

function compareQuestionOrder(
  left: IndexedQuestion,
  right: IndexedQuestion,
): number {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}

function addLargeJump(
  issues: QuestionGapIssue[],
  question: IndexedQuestion,
  previousNumber: number | undefined,
  currentNumber: number,
  previousQuestionId?: string,
  visibleIds?: ReadonlySet<string>,
): void {
  if (
    issues.length >= MAX_ISSUES ||
    (visibleIds !== undefined && !visibleIds.has(question.id))
  ) {
    return;
  }
  issues.push({
    ...issueContext(question),
    id:
      previousQuestionId === undefined
        ? `jump|${question.id}|${currentNumber}`
        : `jump|${previousQuestionId}|${previousNumber}|${question.id}|${currentNumber}`,
    kind: "large_jump",
    questionId: question.id,
    evidence:
      previousNumber === undefined
        ? `本组索引从第 ${currentNumber} 题开始，跨度较大，建议先检查是否换了小节或存在批量缺漏。`
        : `题号从 ${previousNumber} 跳到 ${currentNumber}，跨度较大，建议先检查是否换了小节或存在批量缺漏。`,
  });
}

function addMissingRange(
  issues: QuestionGapIssue[],
  anchor: IndexedQuestion,
  start: number,
  end: number,
  previousNumber?: number,
  visibleIds?: ReadonlySet<string>,
): void {
  if (visibleIds !== undefined && !visibleIds.has(anchor.id)) return;
  for (
    let number = start;
    number <= end && issues.length < MAX_ISSUES;
    number += 1
  ) {
    const page = anchor.regions[0]?.pageNumber;
    issues.push({
      ...issueContext(anchor),
      id: `missing|${anchor.id}|${number}`,
      kind: "missing",
      suggestedQuestionNumber: String(number),
      anchorQuestionId: anchor.id,
      placement: "before",
      confidence: end - start <= 2 ? "high" : "medium",
      evidence:
        previousNumber === undefined
          ? `本组索引从第 ${anchor.questionNumber} 题开始，可能缺少第 ${number} 题。${page === undefined ? "" : ` 建议从 PDF 第 ${page} 页附近检查。`}`
          : `题号从 ${previousNumber} 跳到 ${anchor.questionNumber}，可能缺少第 ${number} 题。${page === undefined ? "" : ` 建议从 PDF 第 ${page} 页及前一页附近检查。`}`,
    });
  }
}

function issueContext(question: IndexedQuestion) {
  return {
    subjectName: question.subjectName,
    workbookName: question.workbookName,
    chapter: question.chapter,
    sectionPart: question.sectionPart,
    questionType: question.questionType,
  };
}

function parseQuestionNumber(value: string): number | undefined {
  const normalized = value.trim();
  if (!/^\d{1,3}$/.test(normalized)) return undefined;
  const number = Number(normalized);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
