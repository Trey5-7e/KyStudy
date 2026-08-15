import { describe, expect, it } from "vitest";

import { parseQuestionBundle } from "./questionClient";

const VALID_BUNDLE = {
  question: {
    id: "question-id",
    documentId: "document-id",
    documentTitle: "408 习题册",
    subjectId: "subject-id",
    subjectName: "数据结构",
    subjectInherited: true,
    questionType: "solution",
    classificationSource: "automatic",
    classificationConfidence: 0.82,
    title: "线性表综合题",
    chapter: "数据结构",
    questionNumber: "1",
    difficulty: 4,
    analysisMarkdown: "注意边界条件",
    deletedAt: null,
    createdAt: 1,
    updatedAt: 2,
    databasePath: "C:/private.sqlite3",
  },
  regions: [
    {
      id: "region-id",
      questionId: "question-id",
      documentId: "document-id",
      pageNumber: 2,
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.3,
      coordinateVersion: 1,
      sortOrder: 0,
      createdAt: 1,
      canvasPixels: [10, 20, 50, 30],
    },
  ],
  attempts: [
    {
      id: "attempt-id",
      questionId: "question-id",
      result: "incorrect",
      attemptedAt: 2,
      durationSeconds: 300,
      answerNote: "漏掉空表",
      createdAt: 2,
    },
  ],
  knowledgeLinks: [
    {
      nodeId: "node-id",
      nodeTitle: "线性表",
      mapId: "map-id",
      mapTitle: "数据结构",
    },
  ],
};

describe("parseQuestionBundle", () => {
  it("keeps typed normalized regions without internal fields", () => {
    const parsed = parseQuestionBundle(VALID_BUNDLE);
    const serialized = JSON.stringify(parsed);

    expect(parsed.regions[0]?.pageNumber).toBe(2);
    expect(parsed.attempts[0]?.result).toBe("incorrect");
    expect(serialized).not.toContain("databasePath");
    expect(serialized).not.toContain("canvasPixels");
  });

  it("rejects regions outside the normalized page", () => {
    expect(() =>
      parseQuestionBundle({
        ...VALID_BUNDLE,
        regions: [{ ...VALID_BUNDLE.regions[0], x: 0.8, width: 0.4 }],
      }),
    ).toThrowError("QUESTION_REGION_INVALID");
  });

  it("requires at least one formal source region", () => {
    expect(() =>
      parseQuestionBundle({ ...VALID_BUNDLE, regions: [] }),
    ).toThrowError("QUESTION_BUNDLE_INVALID");
  });
});
