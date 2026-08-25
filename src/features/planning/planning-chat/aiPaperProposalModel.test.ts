import { describe, expect, it } from "vitest";

import type { IndexedQuestion } from "../../../shared/tauri/questionBankClient";
import {
  parseAiPaperProposal,
  resolveAiPaperProposal,
} from "./aiPaperProposalModel";

const mockQuestions: IndexedQuestion[] = [
  {
    id: "q-1",
    documentId: "doc-1",
    documentTitle: "高等数学复习全书.pdf",
    subjectId: "sub-1",
    subjectName: "高等数学",
    workbookId: "wb-1",
    workbookName: "考研高数 660 题",
    segmentId: "seg-1",
    chapter: "第一章 极限与连续",
    sectionPart: "basic",
    questionType: "choice",
    questionNumber: "1",
    title: "极限的保号性与计算",
    indexConfidence: 1,
    sortOrder: 1,
    attemptCount: 0,
    incorrectCount: 0,
    partialCount: 0,
    regions: [],
  },
  {
    id: "q-2",
    documentId: "doc-1",
    documentTitle: "高等数学复习全书.pdf",
    subjectId: "sub-1",
    subjectName: "高等数学",
    workbookId: "wb-1",
    workbookName: "考研高数 660 题",
    segmentId: "seg-1",
    chapter: "第二章 一元微分学",
    sectionPart: "comprehensive",
    questionType: "solution",
    questionNumber: "5",
    title: "拉格朗日中值定理与辅助函数证明",
    indexConfidence: 1,
    sortOrder: 2,
    attemptCount: 1,
    incorrectCount: 1,
    partialCount: 0,
    regions: [],
  },
];

describe("aiPaperProposalModel", () => {
  it("parses valid kystudy-paper json payload", () => {
    const json = JSON.stringify({
      title: "高数专项测试",
      description: "包含极限和中值定理",
      questionIds: ["q-1", "q-2"],
    });

    const parsed = parseAiPaperProposal(json);
    expect(parsed).toEqual({
      title: "高数专项测试",
      description: "包含极限和中值定理",
      questionIds: ["q-1", "q-2"],
    });
  });

  it("handles malformed JSON gracefully", () => {
    expect(parseAiPaperProposal("invalid json")).toBeUndefined();
    expect(parseAiPaperProposal("{}")).toBeUndefined();
    expect(
      parseAiPaperProposal(JSON.stringify({ title: "test", questionIds: [] })),
    ).toBeUndefined();
  });

  it("resolves question IDs into full questions and type counts", () => {
    const parsed = {
      title: "高数专项测试",
      description: "精选题",
      questionIds: ["q-1", "q-2", "q-non-existent"],
    };

    const resolved = resolveAiPaperProposal(parsed, mockQuestions);
    expect(resolved.totalCount).toBe(2);
    expect(resolved.choiceCount).toBe(1);
    expect(resolved.solutionCount).toBe(1);
    expect(resolved.blankCount).toBe(0);
    expect(resolved.questions.map((q) => q.id)).toEqual(["q-1", "q-2"]);
  });
});
