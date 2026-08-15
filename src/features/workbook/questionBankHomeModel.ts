import type {
  IndexedQuestion,
  QuestionBankSnapshot,
  WorkbookDocumentSegment,
} from "../../shared/tauri/questionBankClient";

export interface QuestionBankWorkbookGroup {
  workbookId: string;
  workbookName: string;
  segments: WorkbookDocumentSegment[];
  questions: IndexedQuestion[];
}

export interface QuestionBankSubjectGroup {
  subjectId: string;
  subjectName: string;
  segments: WorkbookDocumentSegment[];
  questions: IndexedQuestion[];
  workbooks: QuestionBankWorkbookGroup[];
}

type MutableWorkbookGroup = QuestionBankWorkbookGroup;

interface MutableSubjectGroup extends QuestionBankSubjectGroup {
  workbookById: Map<string, MutableWorkbookGroup>;
}

/**
 * Groups one immutable question-bank snapshot for the home tree.
 *
 * The active segment list remains the source of truth for visible subjects and
 * workbooks. Questions that do not have a visible segment are intentionally not
 * introduced as orphan tree rows; this keeps the home page scoped to active
 * R29/R30 browsing semantics.
 */
export function groupQuestionBankSnapshot(
  snapshot: Pick<QuestionBankSnapshot, "segments" | "questions">,
): QuestionBankSubjectGroup[] {
  const subjectById = new Map<string, MutableSubjectGroup>();
  const segmentById = new Map<string, WorkbookDocumentSegment>();

  for (const segment of snapshot.segments) {
    segmentById.set(segment.id, segment);
    let subject = subjectById.get(segment.subjectId);
    if (subject === undefined) {
      subject = {
        subjectId: segment.subjectId,
        subjectName: segment.subjectName,
        segments: [],
        questions: [],
        workbooks: [],
        workbookById: new Map(),
      };
      subjectById.set(segment.subjectId, subject);
    }
    subject.segments.push(segment);

    let workbook = subject.workbookById.get(segment.workbookId);
    if (workbook === undefined) {
      workbook = {
        workbookId: segment.workbookId,
        workbookName: segment.workbookName,
        segments: [],
        questions: [],
      };
      subject.workbookById.set(segment.workbookId, workbook);
      subject.workbooks.push(workbook);
    }
    workbook.segments.push(segment);
  }

  for (const question of snapshot.questions) {
    const segment = segmentById.get(question.segmentId);
    const subject =
      segment === undefined ? undefined : subjectById.get(segment.subjectId);
    const workbook =
      segment === undefined
        ? undefined
        : subject?.workbookById.get(segment.workbookId);
    if (subject === undefined || workbook === undefined) continue;
    subject.questions.push(question);
    workbook.questions.push(question);
  }

  return [...subjectById.values()].map((subject) => ({
    subjectId: subject.subjectId,
    subjectName: subject.subjectName,
    segments: subject.segments,
    questions: subject.questions,
    workbooks: subject.workbooks,
  }));
}
