import { describe, expect, it } from "vitest";

import { resolveWorkbookPdfProfile } from "./workbookPdfProfiles";

describe("workbook PDF adaptation profiles", () => {
  it("selects the Li Yongle 660 high-mathematics profile", () => {
    expect(
      resolveWorkbookPdfProfile("【A4留白】李永乐660高数篇做题本.pdf"),
    ).toEqual({
      id: "li-yongle-660-gaoshu",
      allowUnpunctuatedQuestionNumbers: true,
    });
  });

  it("selects the 660 linear-algebra-and-probability profile", () => {
    expect(
      resolveWorkbookPdfProfile("【A4留白版】基础过关660线概篇.pdf"),
    ).toEqual({
      id: "li-yongle-660-xiangai",
      allowUnpunctuatedQuestionNumbers: true,
      plainBeforeParenthesized: true,
    });
  });

  it("selects the Li Yanfang 900 mathematics I high-mathematics profile", () => {
    expect(
      resolveWorkbookPdfProfile("【A4带空】27李艳芳900题数一高数题本.pdf"),
    ).toEqual({
      id: "li-yanfang-900-shuyi-gaoshu",
      allowUnpunctuatedQuestionNumbers: true,
    });
  });

  it("selects the Li Yanfang 900 mathematics I linear-algebra profile", () => {
    expect(
      resolveWorkbookPdfProfile("【A4带空】27李艳芳900题数一线代概率题本.pdf"),
    ).toEqual({
      id: "li-yanfang-900-shuyi-xiandai-gailv",
      allowUnpunctuatedQuestionNumbers: true,
    });
  });

  it("selects the Zhang Yu 1000 mathematics I profiles", () => {
    expect(
      resolveWorkbookPdfProfile("【A4基础强化合并】1000题数一高数篇.pdf"),
    ).toEqual({
      id: "zhang-yu-1000-shuyi-gaoshu",
      allowUnpunctuatedQuestionNumbers: true,
    });
    expect(resolveWorkbookPdfProfile("张宇1000题线代概率做题本.pdf")).toEqual({
      id: "zhang-yu-1000-shuyi-xiandai-gailv",
      allowUnpunctuatedQuestionNumbers: true,
    });
  });

  it("keeps the 900 high-mathematics pattern from matching the 1000 title", () => {
    const title = "【A4基础强化合并】1000题数一高数篇.pdf";
    expect(resolveWorkbookPdfProfile(title).id).toBe(
      "zhang-yu-1000-shuyi-gaoshu",
    );
  });

  it("provides default profile with unpunctuated question numbers enabled", () => {
    expect(resolveWorkbookPdfProfile("普通扫描题本.pdf")).toEqual({
      id: "generic-text-pdf",
      allowUnpunctuatedQuestionNumbers: true,
    });
  });
});
