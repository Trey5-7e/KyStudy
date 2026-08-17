import { describe, expect, it } from "vitest";

import {
  DEFAULT_QUESTION_AI_INSTRUCTIONS,
  analysisPrompt,
  loadQuestionAiPrompt,
  loadQuestionAiInstructions,
  questionAiInputFingerprint,
  questionAiPromptContext,
  questionAiSourceFingerprint,
  saveQuestionAiPrompt,
  saveQuestionAiInstructions,
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

  it("uses custom instructions while preserving the question context", () => {
    const prompt = analysisPrompt(question, 2, "只输出关键公式和结论。");

    expect(prompt).toContain("题目：题目");
    expect(prompt).toContain("只输出关键公式和结论。");
    expect(prompt).not.toContain(DEFAULT_QUESTION_AI_INSTRUCTIONS);
    expect(prompt).toContain(questionAiPromptContext(question, 2));
  });

  it("persists custom instructions through the shared local preference", () => {
    saveQuestionAiInstructions("请优先说明错因。");

    expect(loadQuestionAiInstructions()).toBe("请优先说明错因。");

    saveQuestionAiInstructions("");
    expect(loadQuestionAiInstructions()).toBe(DEFAULT_QUESTION_AI_INSTRUCTIONS);
  });

  it("keeps saved source fingerprints independent from rendered image data", () => {
    const source = questionAiSourceFingerprint(question, [region]);

    expect(source).toBe(questionAiInputFingerprint(question, [region]));
    expect(source).not.toBe(
      questionAiInputFingerprint(
        question,
        [region],
        ["data:image/png;base64,AAA"],
      ),
    );
  });

  it("changes saved source fingerprints when the shared instructions change", () => {
    expect(
      questionAiSourceFingerprint(question, [region], "自定义错题分析指令"),
    ).not.toBe(questionAiSourceFingerprint(question, [region]));
  });

  it("isolates saved analyses by provider and model", () => {
    const openAi = questionAiSourceFingerprint(question, [region], undefined, {
      providerId: "openai",
      modelName: "gpt-4.1",
    });
    const deepSeek = questionAiSourceFingerprint(
      question,
      [region],
      undefined,
      {
        providerId: "deepseek",
        modelName: "deepseek-chat",
      },
    );
    expect(openAi).not.toBe(deepSeek);
  });

  it("loads the complete saved prompt and refreshes only the question context", () => {
    const firstContext = questionAiPromptContext(question, 2);
    const customPrompt = [
      "你是我的数学考研导师，请先指出最容易误判的地方。",
      firstContext.split("\n")[1],
      "请用表格列出关键步骤。",
    ].join("\n");
    saveQuestionAiPrompt(customPrompt, firstContext);

    const nextQuestion = { ...question, title: "下一道题" };
    const nextPrompt = loadQuestionAiPrompt(nextQuestion, 1);

    expect(nextPrompt).toContain("你是我的数学考研导师");
    expect(nextPrompt).toContain("题目：下一道题");
    expect(nextPrompt).toContain("图片：1 张");
    expect(nextPrompt).toContain("请用表格列出关键步骤。");
    expect(nextPrompt).not.toContain("题目：题目");

    saveQuestionAiPrompt("", firstContext);
  });

  it("keeps the default complete prompt compatible with the existing cache key", () => {
    const prompt = analysisPrompt(question, 2);

    expect(questionAiSourceFingerprint(question, [region], prompt)).toBe(
      questionAiSourceFingerprint(question, [region]),
    );
  });
});
