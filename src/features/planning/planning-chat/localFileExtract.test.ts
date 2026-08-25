import { describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "worker.js",
}));

import {
  extractLocalFileContent,
  extractStructuredPdfMarkdown,
} from "./localFileExtract";

describe("localFileExtract", () => {
  it("extracts text file contents successfully", async () => {
    const file = new File(["Hello KyStudy AI"], "note.txt", {
      type: "text/plain",
    });
    const result = await extractLocalFileContent(file);
    expect(result).toBeDefined();
    expect(result?.name).toBe("note.txt");
    expect(result?.text).toBe("Hello KyStudy AI");
  });

  it("extracts markdown file contents successfully", async () => {
    const file = new File(["# Math Problem\nFind limit."], "problem.md", {
      type: "text/markdown",
    });
    const result = await extractLocalFileContent(file);
    expect(result).toBeDefined();
    expect(result?.name).toBe("problem.md");
    expect(result?.text).toContain("# Math Problem");
  });

  it("extracts text from text-layer PDF", async () => {
    const { getDocument } = await import("pdfjs-dist");
    vi.mocked(getDocument).mockReturnValueOnce({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn().mockImplementation((pageNumber: number) =>
          Promise.resolve({
            getTextContent: () =>
              Promise.resolve({
                items: [
                  { str: `Question on page ${pageNumber}`, hasEOL: false },
                  { str: "Detailed math formula content here", hasEOL: true },
                ],
              }),
          }),
        ),
      }),
    } as unknown as ReturnType<typeof getDocument>);

    const file = new File([new Uint8Array([37, 80, 68, 70])], "exam.pdf", {
      type: "application/pdf",
    });
    const result = await extractLocalFileContent(file);
    expect(result).toBeDefined();
    expect(result?.name).toBe("exam.pdf");
    expect(result?.pageCount).toBe(2);
    expect(result?.text).toContain("### 第 1 页");
    expect(result?.text).toContain("Question on page 1");
  });

  it("reconstructs reading order from out-of-order PDF text items based on 2D coordinates", () => {
    const rawItems = [
      // Out of order: bottom line first
      {
        str: "Answer: B",
        transform: [10, 0, 0, 10, 50, 100],
        width: 60,
        height: 10,
      },
      // Top line, right part
      {
        str: "Find the limit of f(x)",
        transform: [10, 0, 0, 10, 100, 300],
        width: 120,
        height: 10,
      },
      // Top line, left part
      { str: "1.", transform: [10, 0, 0, 10, 50, 300], width: 20, height: 10 },
    ];
    const markdown = extractStructuredPdfMarkdown(rawItems);
    expect(markdown).toBe("1. Find the limit of f(x)\n\nAnswer: B");
  });

  it("detects scanned PDF with empty text layer and flags isScanned", async () => {
    const { getDocument } = await import("pdfjs-dist");
    vi.mocked(getDocument).mockReturnValueOnce({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getTextContent: () => Promise.resolve({ items: [] }),
          getViewport: () => ({ width: 800, height: 1000 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
      }),
    } as unknown as ReturnType<typeof getDocument>);

    const file = new File([new Uint8Array([37, 80, 68, 70])], "scanned.pdf", {
      type: "application/pdf",
    });
    const result = await extractLocalFileContent(file);
    expect(result).toBeDefined();
    expect(result?.name).toBe("scanned.pdf");
    expect(result?.isScanned).toBe(true);
  });

  it("returns undefined for unsupported binary file formats", async () => {
    const file = new File([new Uint8Array([0, 1, 2])], "data.bin", {
      type: "application/octet-stream",
    });
    const result = await extractLocalFileContent(file);
    expect(result).toBeUndefined();
  });
});
