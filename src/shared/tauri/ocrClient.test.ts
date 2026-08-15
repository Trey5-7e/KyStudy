import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  installOcrComponent,
  getOcrDownloadInfo,
  parseOcrDownloadEvent,
  normalizeOcrError,
  parseOcrComponentStatus,
  parseOcrPageRecognition,
  parseOcrRecognition,
  recognizePdfPage,
  removeOcrComponent,
  downloadOcrComponent,
} from "./ocrClient";

const mockedInvoke = vi.mocked(invoke);

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
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

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

  it("bridges PDF page recognition with the Rust request shape", async () => {
    const page = {
      pageNumber: 4,
      engine: "local-ocr",
      meanConfidence: 0.88,
      lines: [
        {
          text: "矩阵",
          confidence: 0.88,
          x: 0.1,
          y: 0.2,
          width: 0.4,
          height: 0.1,
          sortOrder: 0,
        },
      ],
    };
    mockedInvoke.mockResolvedValue(page);

    await expect(
      recognizePdfPage("operation-id", 4, new Uint8Array([0, 255, 8])),
    ).resolves.toEqual(page);
    expect(mockedInvoke).toHaveBeenCalledWith("recognize_pdf_page", {
      request: {
        operationId: "operation-id",
        pageNumber: 4,
        imageBytes: [0, 255, 8],
      },
    });
  });

  it("bridges local OCR component management without exposing a path", async () => {
    const status = {
      state: "available",
      engine: "local-ocr",
      modelsBundled: true,
      componentSizeBytes: 1024,
    };
    mockedInvoke.mockResolvedValue(status);

    await expect(installOcrComponent()).resolves.toEqual(status);
    expect(mockedInvoke).toHaveBeenLastCalledWith("install_ocr_component");

    await expect(removeOcrComponent()).resolves.toEqual(status);
    expect(mockedInvoke).toHaveBeenLastCalledWith("remove_ocr_component");
    expect(JSON.stringify(mockedInvoke.mock.calls)).not.toContain("Path");
  });

  it("bridges the guarded online OCR download contract", async () => {
    mockedInvoke
      .mockResolvedValueOnce({ available: false, engine: "local-ocr" })
      .mockResolvedValueOnce({
        state: "available",
        engine: "local-ocr",
        modelsBundled: true,
        componentSizeBytes: 1024,
      });

    await expect(getOcrDownloadInfo()).resolves.toEqual({
      available: false,
      engine: "local-ocr",
    });
    await expect(downloadOcrComponent("operation-id")).resolves.toMatchObject({
      state: "available",
    });
    expect(mockedInvoke).toHaveBeenLastCalledWith("download_ocr_component", {
      request: { operationId: "operation-id" },
    });
  });

  it("rejects malformed OCR download progress events", () => {
    expect(() =>
      parseOcrDownloadEvent({
        operationId: "operation-id",
        state: "running",
        copiedBytes: 5,
        totalBytes: 4,
      }),
    ).toThrowError("OCR_DOWNLOAD_EVENT_INVALID");
    expect(() =>
      parseOcrDownloadEvent({
        operationId: "operation-id",
        state: "failed",
        copiedBytes: 0,
        totalBytes: 0,
      }),
    ).toThrowError("OCR_DOWNLOAD_EVENT_INVALID");
  });

  it("rejects invalid page recognition summaries", () => {
    const page = {
      pageNumber: 4,
      engine: "local-ocr",
      meanConfidence: 0.88,
      lines: [],
    };

    expect(() =>
      parseOcrPageRecognition({ ...page, pageNumber: 0 }),
    ).toThrowError("OCR_PAGE_RECOGNITION_INVALID");
    expect(() =>
      parseOcrPageRecognition({ ...page, meanConfidence: 1.01 }),
    ).toThrowError("OCR_PAGE_RECOGNITION_INVALID");
  });

  it("rejects invalid PDF page OCR lines", () => {
    const page = {
      pageNumber: 4,
      engine: "local-ocr",
      meanConfidence: 0.88,
      lines: [
        {
          text: "矩阵",
          confidence: 0.88,
          x: 0.1,
          y: 0.2,
          width: 0.4,
          height: 0.1,
          sortOrder: 0,
        },
      ],
    };

    expect(() =>
      parseOcrPageRecognition({
        ...page,
        lines: [{ ...page.lines[0], text: "  " }],
      }),
    ).toThrowError("OCR_PAGE_LINE_INVALID");
    expect(() =>
      parseOcrPageRecognition({
        ...page,
        lines: [{ ...page.lines[0], confidence: -0.01 }],
      }),
    ).toThrowError("OCR_PAGE_LINE_INVALID");
    expect(() =>
      parseOcrPageRecognition({
        ...page,
        lines: [{ ...page.lines[0], x: 0.8, width: 0.4 }],
      }),
    ).toThrowError("OCR_PAGE_LINE_INVALID");
    expect(() =>
      parseOcrPageRecognition({
        ...page,
        lines: [{ ...page.lines[0], sortOrder: -1 }],
      }),
    ).toThrowError("OCR_PAGE_LINE_INVALID");
  });
});
