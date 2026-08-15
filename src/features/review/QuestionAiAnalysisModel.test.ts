import { describe, expect, it } from "vitest";

import {
  analysisPrompt,
  questionAiInputFingerprint,
} from "./QuestionAiAnalysisModel";

const question = {
  id: "q1",
  documentId: "d1",
  documentTitle: "doc",
  subjectInherited: false,
  classificationSource: "pending",
  title: "题目",
  difficulty: 1,
  createdAt: 1,
  updatedAt: 2,
} as const;
const region = {
  id: "r1",
  questionId: "q1",
  documentId: "d1",
  pageNumber: 1,
  x: 1,
  y: 2,
  width: 3,
  height: 4,
  coordinateVersion: 1,
  sortOrder: 0,
  createdAt: 1,
} as const;

describe("QuestionAiAnalysisModel", () => {
  it("fingerprint changes when question, region, or image changes", () => {
    const base = questionAiInputFingerprint(question, [region], ["data:a"]);
    expect(
      questionAiInputFingerprint(
        { ...question, title: "changed" },
        [region],
        ["data:a"],
      ),
    ).not.toBe(base);
    expect(
      questionAiInputFingerprint(question, [{ ...region, x: 9 }], ["data:a"]),
    ).not.toBe(base);
    expect(questionAiInputFingerprint(question, [region], ["data:b"])).not.toBe(
      base,
    );
  });

  it("includes the exact question and image count in the prompt", () => {
    const prompt = analysisPrompt(question, 2);
    expect(prompt).toContain("题目：题目");
    expect(prompt).toContain("图片：2 张");
  });
});
