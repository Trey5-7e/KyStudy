import { describe, expect, it } from "vitest";

import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import {
  managerDialogWindow,
  paperWindow,
  questionBankBackTarget,
  questionBankCloseTarget,
  questionBankWindowSegmentId,
  toolDialogWindow,
  toolWindow,
  type QuestionBankWindow,
} from "./questionBankWindowModel";

const questions = [] as IndexedQuestion[];

describe("question bank window navigation", () => {
  it("returns a tools child to its section and focus tool", () => {
    const child = toolDialogWindow("browse", "index");

    expect(questionBankBackTarget(child)).toEqual(
      toolWindow("index", "browse"),
    );
  });

  it("returns manager children to the latest manager", () => {
    const child = managerDialogWindow("manual", "segment-1");

    expect(questionBankBackTarget(child, new Set(["segment-1"]))).toEqual({
      kind: "segment-manager",
      segmentId: "segment-1",
    });
  });

  it("returns root when the manager segment disappeared", () => {
    const child = managerDialogWindow("browse", "missing-segment");

    expect(questionBankBackTarget(child, new Set())).toBeUndefined();
  });

  it("invalidates a paper back target when its manager segment disappears", () => {
    const paper = paperWindow(questions, {
      kind: "segment-manager",
      segmentId: "removed-segment",
    });

    expect(questionBankBackTarget(paper, new Set())).toBeUndefined();
    expect(questionBankBackTarget(paper, new Set(["removed-segment"]))).toEqual(
      { kind: "segment-manager", segmentId: "removed-segment" },
    );
  });

  it("does not provide Back targets for root windows", () => {
    expect(questionBankBackTarget(toolWindow("category"))).toBeUndefined();
    expect(
      questionBankBackTarget({
        kind: "segment-manager",
        segmentId: "segment-1",
      }),
    ).toBeUndefined();
    expect(questionBankBackTarget({ kind: "segment-trash" })).toBeUndefined();
  });

  it("preserves origins while entering a generated paper", () => {
    const paper = paperWindow(
      questions,
      toolDialogWindow("paper", "practice").origin,
    );

    expect(paper.origin).toEqual({
      kind: "tools",
      section: "practice",
      focusTool: "paper",
    });
    expect(questionBankBackTarget(paper)).toEqual(
      toolWindow("practice", "paper"),
    );
  });

  it("closes every flow to root and keeps one active variant", () => {
    const windows: QuestionBankWindow[] = [
      toolWindow("category"),
      { kind: "segment-manager", segmentId: "segment-1" },
      { kind: "segment-trash" },
      toolDialogWindow("subject", "category"),
      paperWindow(questions, { kind: "root" }),
    ];

    expect(windows.every((window) => typeof window.kind === "string")).toBe(
      true,
    );
    expect(windows.map(() => questionBankCloseTarget())).toEqual(
      windows.map(() => undefined),
    );
  });

  it("tracks the segment id through manager children and papers", () => {
    const manager = {
      kind: "segment-manager",
      segmentId: "segment-2",
    } as const;
    const dialog = managerDialogWindow("browse", manager.segmentId);
    const paper = paperWindow(questions, manager);

    expect(questionBankWindowSegmentId(manager)).toBe("segment-2");
    expect(questionBankWindowSegmentId(dialog)).toBe("segment-2");
    expect(questionBankWindowSegmentId(paper)).toBe("segment-2");
    expect(questionBankWindowSegmentId(toolWindow("practice"))).toBeUndefined();
  });
});
