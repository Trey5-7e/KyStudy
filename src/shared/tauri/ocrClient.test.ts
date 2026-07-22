import { describe, expect, it } from "vitest";

import {
  normalizeOcrError,
  parseOcrComponentStatus,
  parseOcrRecognition,
} from "./ocrClient";

const RECOGNITION = {
  id: "recognition-id",
  questionId: "question-id",
  regionId: "region-id",
  pageNumber: 3,
  engine: "local-ocr",
  recognizedText: "线性表",
  confirmedText: null,
  meanConfidence: 0.91,
  state: "draft",
  lines: [
    {
      id: "line-id",
      recognitionId: "recognition-id",
      text: "线性表",
      confidence: 0.91,
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.1,
      sortOrder: 0,
    },
  ],
  createdAt: 1,
  updatedAt: 2,
  workerPath: "C:/private/worker.exe",
};

describe("OCR client parsers", () => {
  it("keeps the public OCR draft without worker internals", () => {
    const parsed = parseOcrRecognition(RECOGNITION);
    const serialized = JSON.stringify(parsed);

    expect(parsed.state).toBe("draft");
    expect(parsed.confirmedText).toBeUndefined();
    expect(serialized).not.toContain("workerPath");
  });

  it("rejects line boxes outside the submitted image", () => {
    expect(() =>
      parseOcrRecognition({
        ...RECOGNITION,
        lines: [{ ...RECOGNITION.lines[0], x: 0.8, width: 0.4 }],
      }),
    ).toThrowError("OCR_TEXT_LINE_INVALID");
  });

  it("parses optional component size and maps stable errors", () => {
    expect(
      parseOcrComponentStatus({
        state: "available",
        engine: "local-ocr",
        modelsBundled: true,
        componentSizeBytes: 1024,
        componentPath: "C:/private/component",
      }).componentSizeBytes,
    ).toBe(1024);
    expect(normalizeOcrError({ code: "OCR_TIMEOUT" }).message).toContain(
      "超时",
    );
  });
});
