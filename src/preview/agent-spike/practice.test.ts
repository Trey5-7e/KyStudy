import { describe, expect, it } from "vitest";
import fixture from "./fixtures/practice.json";
import { generateWeightedPaper } from "../../features/workbook/questionBankModel";
import type {
  IndexedQuestion,
  PracticeStatus,
} from "../../shared/tauri/questionBankClient";
import type { QuestionType } from "../../shared/tauri/questionClient";
import {
  loadPaperDraft,
  PAPER_DRAFT_STORAGE_KEY,
  type SavedPaperDraft,
} from "../../features/workbook/paperSetupPreferences";
import {
  IsolatedStorage,
  acknowledgeDraft,
  deliverDraft,
} from "./practiceHandoff";

function candidates(): IndexedQuestion[] {
  return fixture.questions
    .filter(
      (q) =>
        fixture.allowedIds.includes(q.id) &&
        !fixture.attempts.some(
          (a) => a.questionId === q.id && a.date === fixture.today,
        ),
    )
    .map((q, index) => ({
      id: q.id,
      documentId: "synthetic",
      documentTitle: "Synthetic",
      subjectId: q.subject,
      subjectName: q.subject,
      workbookId: "book",
      workbookName: "Book",
      segmentId: "segment",
      chapter: "1",
      sectionPart: "basic",
      questionType: q.kind as QuestionType,
      questionNumber: q.id,
      title: q.id,
      indexConfidence: 1,
      sortOrder: index,
      currentResult:
        q.status === "unattempted"
          ? undefined
          : (q.status as IndexedQuestion["currentResult"]),
      attemptCount: 1,
      incorrectCount: q.incorrectCount,
      partialCount: q.partialCount,
      regions: [],
    }));
}

function random(seed: number): () => number {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

const draft: SavedPaperDraft = {
  questionIds: fixture.expectedIds,
  recipe: {
    subjectIds: ["linear"],
    scopeGroups: [
      {
        id: "scope",
        name: "Fixture",
        enabled: true,
        mode: "include",
        workbookIds: ["book"],
        chapterKeys: [],
        sectionParts: [],
        questionTypes: [],
      },
    ],
    subjectQuotas: { linear: fixture.quotas },
    statuses: ["incorrect", "uncertain", "correct", "unattempted"],
  },
  savedAt: 1_788_624_000_000,
};

describe("M0 shared selector and isolated draft handoff", () => {
  it("malformed receipts and invalid drafts fail closed", () => {
    const storage = new IsolatedStorage();
    storage.setItem("m0.isolated-handoff-receipt", "{}");
    expect(() => deliverDraft("handoff1", draft, storage)).toThrow("CONFLICT");
    expect(() => acknowledgeDraft("handoff1", storage)).toThrow("CONFLICT");
    expect(() =>
      deliverDraft(
        "handoff1",
        { ...draft, questionIds: [] },
        new IsolatedStorage(),
      ),
    ).toThrow("SAVE_FAILED");
  });
  it("matches the Rust golden seed using the unchanged existing selector", () => {
    const picked = generateWeightedPaper(
      candidates(),
      {
        statuses: new Set<PracticeStatus>([
          "incorrect",
          "uncertain",
          "correct",
          "unattempted",
        ]),
        choiceCount: 4,
        blankCount: 3,
        solutionCount: 3,
      },
      random(fixture.seed),
    );
    expect(picked.map((q) => q.id)).toEqual(fixture.expectedIds);
    expect(new Set(picked.map((q) => q.id)).size).toBe(10);
  });
  it("roundtrips the existing SavedPaperDraft contract without loss", () => {
    const storage = new IsolatedStorage();
    expect(deliverDraft("handoff1", draft, storage)).toBe("saved");
    const restored = loadPaperDraft(storage)!;
    expect(restored.questionIds).toEqual(draft.questionIds);
    expect(restored.recipe).toEqual(draft.recipe);
    acknowledgeDraft("handoff1", storage);
    expect(deliverDraft("handoff1", draft, storage)).toBe("reconciled");
  });
  it("reconciles after save-before-ACK crash without writing the draft again", () => {
    const storage = new IsolatedStorage();
    expect(() => deliverDraft("handoff1", draft, storage, true)).toThrow(
      "CRASH",
    );
    const before = storage.getItem(PAPER_DRAFT_STORAGE_KEY);
    expect(deliverDraft("handoff1", draft, storage)).toBe("reconciled");
    acknowledgeDraft("handoff1", storage);
    expect(storage.getItem(PAPER_DRAFT_STORAGE_KEY)).toBe(before);
  });
  it("does not overwrite an existing or corrupted draft", () => {
    for (const raw of [
      "corrupted",
      JSON.stringify({ ...draft, results: { q01: "incorrect" } }),
    ]) {
      const storage = new IsolatedStorage();
      storage.setItem(PAPER_DRAFT_STORAGE_KEY, raw);
      expect(() => deliverDraft("handoff1", draft, storage)).toThrow(
        "CONFLICT",
      );
      expect(storage.getItem(PAPER_DRAFT_STORAGE_KEY)).toBe(raw);
    }
  });
  it("changed answers after a crash prevent a replay overwrite", () => {
    const storage = new IsolatedStorage();
    expect(() => deliverDraft("handoff1", draft, storage, true)).toThrow(
      "CRASH",
    );
    const updated = JSON.stringify({ ...draft, results: { q01: "correct" } });
    storage.setItem(PAPER_DRAFT_STORAGE_KEY, updated);
    expect(() => deliverDraft("handoff1", draft, storage)).toThrow("CONFLICT");
    expect(() => acknowledgeDraft("handoff1", storage)).toThrow("CONFLICT");
    expect(storage.getItem(PAPER_DRAFT_STORAGE_KEY)).toBe(updated);
  });
  it("same handoff ID cannot change the selected questions", () => {
    const storage = new IsolatedStorage();
    deliverDraft("handoff1", draft, storage);
    expect(() =>
      deliverDraft("handoff1", { ...draft, questionIds: ["other"] }, storage),
    ).toThrow("CONFLICT");
  });
  it("storage failure does not acknowledge a missing draft", () => {
    class FullStorage extends IsolatedStorage {
      override setItem(key: string, value: string): void {
        if (key === PAPER_DRAFT_STORAGE_KEY) throw new Error("full");
        super.setItem(key, value);
      }
    }
    const storage = new FullStorage();
    expect(() => deliverDraft("handoff1", draft, storage)).toThrow(
      "SAVE_FAILED",
    );
    expect(() => acknowledgeDraft("handoff1", storage)).toThrow("CONFLICT");
  });
});
