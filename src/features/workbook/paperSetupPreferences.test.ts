import { describe, expect, it } from "vitest";

import {
  PAPER_SETUP_QUOTAS_STORAGE_KEY,
  clearPaperDraft,
  createPaperDraftRecipe,
  loadPaperTypeQuotas,
  loadPaperDraft,
  paperSpecFromDraftRecipe,
  savePaperDraft,
  savePaperTypeQuotas,
} from "./paperSetupPreferences";

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

describe("paper setup preferences", () => {
  it("round-trips the last per-subject quotas", () => {
    const storage = memoryStorage();
    const quotas = new Map([
      ["math", { choice: 12, blank: 4, solution: 8 }],
      ["linear", { choice: 6, blank: 3, solution: 5 }],
    ]);

    savePaperTypeQuotas(quotas, storage);

    expect(loadPaperTypeQuotas(storage)).toEqual(quotas);
  });

  it("ignores malformed records and bounds persisted values", () => {
    const storage = memoryStorage();
    storage.setItem(
      PAPER_SETUP_QUOTAS_STORAGE_KEY,
      JSON.stringify({
        math: { choice: 60.4, blank: -2, solution: 2.6 },
        broken: { choice: "10", blank: 1, solution: 1 },
      }),
    );

    expect(loadPaperTypeQuotas(storage)).toEqual(
      new Map([["math", { choice: 50, blank: 0, solution: 3 }]]),
    );
  });

  it("persists a restorable recipe and de-duplicates its question ids", () => {
    const storage = memoryStorage();
    const recipe = createPaperDraftRecipe({
      subjectIds: new Set(["math"]),
      scopeGroups: [
        {
          id: "group-1",
          name: "范围 1",
          enabled: true,
          mode: "include",
          workbookIds: new Set(["workbook-1"]),
          chapterKeys: new Set(["workbook-1::第一章"]),
          sectionParts: new Set(["basic"]),
          questionTypes: new Set(["choice"]),
        },
      ],
      subjectQuotas: new Map([["math", { choice: 8, blank: 2, solution: 4 }]]),
      statuses: new Set(["unattempted", "incorrect"]),
    });

    savePaperDraft(
      { questionIds: ["q1", "q2", "q1"], recipe, savedAt: 42 },
      storage,
    );

    const loaded = loadPaperDraft(storage);
    expect(loaded?.questionIds).toEqual(["q1", "q2"]);
    expect(loaded?.savedAt).toBe(42);
    const spec = paperSpecFromDraftRecipe(loaded!.recipe);
    expect(spec.subjectIds).toEqual(new Set(["math"]));
    expect(spec.scopeGroups?.[0]?.questionTypes).toEqual(new Set(["choice"]));
    expect(spec.subjectQuotas).toEqual(
      new Map([["math", { choice: 8, blank: 2, solution: 4 }]]),
    );
  });

  it("round-trips paper answer marks and clears a completed draft", () => {
    const storage = memoryStorage();
    const recipe = createPaperDraftRecipe({
      subjectIds: new Set(["math"]),
      scopeGroups: [
        {
          id: "group-1",
          name: "范围 1",
          enabled: true,
          mode: "include",
          workbookIds: new Set(),
          chapterKeys: new Set(),
          sectionParts: new Set(),
          questionTypes: new Set(),
        },
      ],
      subjectQuotas: new Map([["math", { choice: 1, blank: 0, solution: 0 }]]),
      statuses: new Set(["unattempted"]),
    });

    savePaperDraft(
      {
        questionIds: ["q1"],
        recipe,
        results: { q1: "correct" },
        recordedResults: { q1: "correct" },
        savedAt: 7,
      },
      storage,
    );

    expect(loadPaperDraft(storage)?.results).toEqual({ q1: "correct" });
    expect(loadPaperDraft(storage)?.recordedResults).toEqual({
      q1: "correct",
    });

    clearPaperDraft(storage);
    expect(loadPaperDraft(storage)).toBeUndefined();
  });
});
