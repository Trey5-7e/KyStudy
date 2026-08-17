import type {
  PaperExportQuestion,
  PaperExportSnapshot,
} from "./paperExportModel";
import type { QuestionType } from "../../shared/tauri/questionClient";

export const A4_PAGE_WIDTH = 595.28;
export const A4_PAGE_HEIGHT = 841.89;
export const PAPER_MARGIN = 42.52;
export const PAPER_CONTENT_WIDTH = A4_PAGE_WIDTH - PAPER_MARGIN * 2;
export const PAPER_SECTION_HEADING_WIDTH = 180;
export const PAPER_SECTION_HEADING_HEIGHT = 24;
const QUESTION_GAP = 16;
const REGION_GAP = 6;
const SECTION_HEADING_GAP = 8;
const ANSWER_LINE_HEIGHT = 22.5;

export interface PaperLayoutText {
  kind: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold?: boolean;
}

export interface PaperLayoutImage {
  kind: "image";
  imageId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaperLayoutLine {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type PaperLayoutElement =
  PaperLayoutText | PaperLayoutImage | PaperLayoutLine;

export interface PaperLayoutPage {
  number: number;
  elements: PaperLayoutElement[];
}

export interface PaperExportLayout {
  pageWidth: number;
  pageHeight: number;
  contentWidth: number;
  pages: PaperLayoutPage[];
  pageCount: number;
}

export function layoutPaper(snapshot: PaperExportSnapshot): PaperExportLayout {
  const pages: PaperLayoutPage[] = [{ number: 1, elements: [] }];
  let y = PAPER_MARGIN;
  const usableBottom = A4_PAGE_HEIGHT - PAPER_MARGIN;
  const renderedSectionTypes = new Set<QuestionType>();

  for (const question of snapshot.questions) {
    if (question.regions.length === 0) {
      throw new Error("PAPER_EXPORT_QUESTION_WITHOUT_REGION");
    }
    const needsSectionHeading = !renderedSectionTypes.has(
      question.questionType,
    );
    const blockHeight = estimateQuestionHeight(
      question,
      snapshot,
      needsSectionHeading,
    );
    if (y > PAPER_MARGIN && y + blockHeight > usableBottom) {
      startPage(pages);
      y = PAPER_MARGIN;
    }
    if (needsSectionHeading) {
      if (y + PAPER_SECTION_HEADING_HEIGHT > usableBottom) {
        startPage(pages);
        y = PAPER_MARGIN;
      }
      pages[pages.length - 1]!.elements.push({
        kind: "image",
        imageId: paperSectionHeadingImageId(question.questionType),
        x: PAPER_MARGIN,
        y,
        width: PAPER_SECTION_HEADING_WIDTH,
        height: PAPER_SECTION_HEADING_HEIGHT,
      });
      renderedSectionTypes.add(question.questionType);
      y += PAPER_SECTION_HEADING_HEIGHT + SECTION_HEADING_GAP;
    }
    for (const region of question.regions) {
      const width = Math.min(PAPER_CONTENT_WIDTH, region.width);
      const height = (region.height / region.width) * width;
      if (height > usableBottom - PAPER_MARGIN) {
        throw new Error("PAPER_EXPORT_IMAGE_TOO_TALL");
      }
      if (y + height > usableBottom) {
        startPage(pages);
        y = PAPER_MARGIN;
      }
      pages[pages.length - 1]!.elements.push({
        kind: "image",
        imageId: region.imageId,
        x: PAPER_MARGIN + (PAPER_CONTENT_WIDTH - width) / 2,
        y,
        width,
        height,
      });
      y += height + REGION_GAP;
    }
    const answerLines = answerLineCount(question, snapshot);
    if (answerLines > 0) {
      for (let line = 0; line < answerLines; line += 1) {
        if (y + ANSWER_LINE_HEIGHT > usableBottom) {
          startPage(pages);
          y = PAPER_MARGIN;
        }
        if (snapshot.settings.answerStyle === "lines") {
          pages[pages.length - 1]!.elements.push({
            kind: "line",
            x1: PAPER_MARGIN,
            y1: y + ANSWER_LINE_HEIGHT - 5,
            x2: A4_PAGE_WIDTH - PAPER_MARGIN,
            y2: y + ANSWER_LINE_HEIGHT - 5,
          });
        }
        y += ANSWER_LINE_HEIGHT;
      }
    }
    y += QUESTION_GAP;
  }
  return {
    pageWidth: A4_PAGE_WIDTH,
    pageHeight: A4_PAGE_HEIGHT,
    contentWidth: PAPER_CONTENT_WIDTH,
    pages,
    pageCount: pages.length,
  };
}

function startPage(pages: PaperLayoutPage[]): void {
  const page: PaperLayoutPage = {
    number: pages.length + 1,
    elements: [],
  };
  pages.push(page);
}

function estimateQuestionHeight(
  question: PaperExportQuestion,
  snapshot: PaperExportSnapshot,
  includeSectionHeading: boolean,
): number {
  const imageHeight = question.regions.reduce(
    (total, region) =>
      total +
      Math.min(PAPER_CONTENT_WIDTH, region.width) *
        (region.height / region.width) +
      REGION_GAP,
    0,
  );
  return (
    (includeSectionHeading
      ? PAPER_SECTION_HEADING_HEIGHT + SECTION_HEADING_GAP
      : 0) +
    imageHeight +
    answerLineCount(question, snapshot) * ANSWER_LINE_HEIGHT +
    QUESTION_GAP
  );
}

export function paperSectionHeadingImageId(questionType: QuestionType): string {
  return `paper-section-heading-${questionType}`;
}

export function paperSectionHeadingText(questionType: QuestionType): string {
  const headings: Record<QuestionType, string> = {
    choice: "一、选择题",
    blank: "二、填空题",
    solution: "三、解答题",
    other: "四、其他题型",
  };
  return headings[questionType];
}

function answerLineCount(
  question: PaperExportQuestion,
  snapshot: PaperExportSnapshot,
): number {
  if (question.questionType === "solution")
    return snapshot.settings.solutionLines;
  if (question.questionType === "other") return snapshot.settings.otherLines;
  return 0;
}
