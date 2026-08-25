import type { QuestionType } from "../../shared/tauri/questionClient";
import type { DetectedPdfSubject } from "./pdfQuestionIndexer";

export const WORKBOOK_PDF_BASELINE_SCHEMA_VERSION = 1 as const;

const QUESTION_TYPES: readonly QuestionType[] = [
  "choice",
  "blank",
  "solution",
  "other",
];

export type WorkbookPdfQuestionTypeCounts = Record<QuestionType, number>;

export interface WorkbookPdfBaselineSubject {
  key: string;
  profileId: string;
  suggestedName: string;
  sourceHeading: string;
  pageStart: number;
  pageEnd: number;
  questionCount: number;
  questionTypeCounts: WorkbookPdfQuestionTypeCounts;
  warningCount: number;
  ocrPageCount: number;
  unresolvedMarkerCount: number;
  crossPageQuestionCount: number;
}

export interface WorkbookPdfBaselineReport {
  schemaVersion: typeof WORKBOOK_PDF_BASELINE_SCHEMA_VERSION;
  source: {
    title: string;
    sha256: string;
    pageCount: number;
  };
  analysis: {
    profileIds: string[];
    subjectCount: number;
    questionCount: number;
    questionTypeCounts: WorkbookPdfQuestionTypeCounts;
    warningCount: number;
    ocrPageCount: number;
    unresolvedMarkerCount: number;
    crossPageQuestionCount: number;
  };
  subjects: WorkbookPdfBaselineSubject[];
}

export function buildWorkbookPdfBaseline(input: {
  title: string;
  sha256: string;
  pageCount?: number;
  subjects: readonly DetectedPdfSubject[];
}): WorkbookPdfBaselineReport {
  const subjects = input.subjects.map(toBaselineSubject);
  const pageCount = Math.max(
    1,
    input.pageCount ?? 0,
    ...subjects.map((subject) => subject.pageEnd),
  );
  const questionTypeCounts = createQuestionTypeCounts();
  for (const subject of subjects) {
    addQuestionTypeCounts(questionTypeCounts, subject.questionTypeCounts);
  }

  return {
    schemaVersion: WORKBOOK_PDF_BASELINE_SCHEMA_VERSION,
    source: {
      title: input.title,
      sha256: input.sha256,
      pageCount,
    },
    analysis: {
      profileIds: [
        ...new Set(subjects.map((subject) => subject.profileId)),
      ].sort(),
      subjectCount: subjects.length,
      questionCount: subjects.reduce(
        (total, subject) => total + subject.questionCount,
        0,
      ),
      questionTypeCounts,
      warningCount: subjects.reduce(
        (total, subject) => total + subject.warningCount,
        0,
      ),
      ocrPageCount: subjects.reduce(
        (total, subject) => total + subject.ocrPageCount,
        0,
      ),
      unresolvedMarkerCount: subjects.reduce(
        (total, subject) => total + subject.unresolvedMarkerCount,
        0,
      ),
      crossPageQuestionCount: subjects.reduce(
        (total, subject) => total + subject.crossPageQuestionCount,
        0,
      ),
    },
    subjects,
  };
}

export function serializeWorkbookPdfBaseline(
  report: WorkbookPdfBaselineReport,
): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function workbookPdfBaselineFileName(title: string): string {
  const withoutExtension = title.replace(/\.[^.]+$/u, "");
  const safeTitle = withoutExtension
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "");
  return `${safeTitle || "workbook-pdf"}-baseline.json`;
}

function toBaselineSubject(
  subject: DetectedPdfSubject,
): WorkbookPdfBaselineSubject {
  const questionTypeCounts = createQuestionTypeCounts();
  for (const question of subject.questions) {
    questionTypeCounts[question.questionType] += 1;
  }
  return {
    key: subject.key,
    profileId: subject.profileId,
    suggestedName: subject.suggestedName,
    sourceHeading: subject.sourceHeading,
    pageStart: subject.pageStart,
    pageEnd: subject.pageEnd,
    questionCount: subject.questions.length,
    questionTypeCounts,
    warningCount: subject.warningCount,
    ocrPageCount: subject.ocrPageCount,
    unresolvedMarkerCount: subject.unresolvedMarkerCount,
    crossPageQuestionCount: subject.crossPageQuestionCount,
  };
}

function createQuestionTypeCounts(): WorkbookPdfQuestionTypeCounts {
  return Object.fromEntries(
    QUESTION_TYPES.map((questionType) => [questionType, 0]),
  ) as WorkbookPdfQuestionTypeCounts;
}

function addQuestionTypeCounts(
  target: WorkbookPdfQuestionTypeCounts,
  source: WorkbookPdfQuestionTypeCounts,
): void {
  for (const questionType of QUESTION_TYPES) {
    target[questionType] += source[questionType];
  }
}
