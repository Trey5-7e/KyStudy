import { describe, expect, it } from "vitest";

import {
  PAPER_EXPORT_ANSWER_STORAGE_KEY,
  loadPaperExportAnswerPreference,
  savePaperExportAnswerPreference,
} from "./paperExportPreferences";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
    removeItem: (key: string): void => {
      values.delete(key);
    },
  } as unknown as Storage;
}

describe("paper export preferences", () => {
  it("round-trips the last answer area choice", () => {
    const storage = memoryStorage();
    const preference = {
      solutionLines: 12 as const,
      otherLines: 4 as const,
      answerStyle: "blank" as const,
    };

    expect(savePaperExportAnswerPreference(preference, storage)).toBe(true);
    expect(loadPaperExportAnswerPreference(storage)).toEqual(preference);
  });

  it("keeps older preferences valid and defaults other answer space to none", () => {
    const storage = memoryStorage();
    storage.setItem(
      PAPER_EXPORT_ANSWER_STORAGE_KEY,
      JSON.stringify({ solutionLines: 8, answerStyle: "lines" }),
    );

    expect(loadPaperExportAnswerPreference(storage)).toEqual({
      solutionLines: 8,
      otherLines: 0,
      answerStyle: "lines",
    });
  });

  it("ignores malformed or unsupported choices", () => {
    const storage = memoryStorage();
    storage.setItem(
      PAPER_EXPORT_ANSWER_STORAGE_KEY,
      JSON.stringify({
        solutionLines: 10,
        otherLines: 8,
        answerStyle: "blank",
      }),
    );
    expect(loadPaperExportAnswerPreference(storage)).toBeUndefined();
  });
});
