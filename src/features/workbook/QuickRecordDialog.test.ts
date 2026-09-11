import { describe, expect, it } from "vitest";

import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import {
  matrixCellStatus,
  matrixStatusByNumber,
  updateMatrixFields,
} from "./quickRecordModel";

function makeQuestion(
  number: string,
  currentResult?: IndexedQuestion["currentResult"],
): IndexedQuestion {
  return {
    id: `q-${number}`,
    documentId: "doc-1",
    documentTitle: "880.pdf",
    subjectId: "math",
    subjectName: "高等数学",
    workbookId: "wb-1",
    workbookName: "880",
    segmentId: "seg-1",
    chapter: "第一章",
    sectionPart: "basic",
    questionType: "blank",
    questionNumber: number,
    title: `第 ${number} 题`,
    indexConfidence: 1,
    sortOrder: Number(number),
    currentResult,
    attemptCount: currentResult === undefined ? 0 : 1,
    incorrectCount: currentResult === "incorrect" ? 1 : 0,
    partialCount: currentResult === "uncertain" ? 1 : 0,
    regions: [],
  };
}

describe("QuickRecordDialog matrixCellStatus", () => {
  it("defaults to gray unattempted state when a question has no saved status and is not staged", () => {
    const question = makeQuestion("1", undefined);
    const cell = matrixCellStatus(question, undefined);

    expect(cell.effectiveStatus).toBeUndefined();
    expect(cell.isStaged).toBe(false);
    expect(cell.hasSavedStatus).toBe(false);
    expect(cell.label).toBe("1题未做");
  });

  it("defaults to saved 'correct' status color and label when question was previously saved", () => {
    const question = makeQuestion("15", "correct");
    const cell = matrixCellStatus(question, undefined);

    expect(cell.effectiveStatus).toBe("correct");
    expect(cell.isStaged).toBe(false);
    expect(cell.hasSavedStatus).toBe(true);
    expect(cell.label).toBe("15题已保存状态：做对");
  });

  it("defaults to saved 'incorrect' and 'uncertain' status colors when question was previously saved", () => {
    const wrong = makeQuestion("16", "incorrect");
    const wrongCell = matrixCellStatus(wrong, undefined);
    expect(wrongCell.effectiveStatus).toBe("incorrect");
    expect(wrongCell.isStaged).toBe(false);
    expect(wrongCell.hasSavedStatus).toBe(true);
    expect(wrongCell.label).toBe("16题已保存状态：做错");

    const partial = makeQuestion("17", "uncertain");
    const partialCell = matrixCellStatus(partial, undefined);
    expect(partialCell.effectiveStatus).toBe("uncertain");
    expect(partialCell.isStaged).toBe(false);
    expect(partialCell.hasSavedStatus).toBe(true);
    expect(partialCell.label).toBe("17题已保存状态：不全对");
  });

  it("overrides saved status with staged status when user marks question in current batch", () => {
    const question = makeQuestion("18", "correct");
    const cell = matrixCellStatus(question, "incorrect");

    expect(cell.effectiveStatus).toBe("incorrect");
    expect(cell.isStaged).toBe(true);
    expect(cell.hasSavedStatus).toBe(true);
    expect(cell.label).toBe("18题本次标记：做错");
  });

  it("shows staged status on an unattempted question", () => {
    const question = makeQuestion("19", undefined);
    const cell = matrixCellStatus(question, "correct");

    expect(cell.effectiveStatus).toBe("correct");
    expect(cell.isStaged).toBe(true);
    expect(cell.hasSavedStatus).toBe(false);
    expect(cell.label).toBe("19题本次标记：做对");
  });
});

describe("matrixStatusByNumber parsing", () => {
  it("maps input fields to matrix statuses correctly", () => {
    const statusMap = matrixStatusByNumber({
      completed: "1-3,5",
      incorrect: "2,7",
      partial: "8",
    });

    expect(statusMap.get("1")).toBe("correct");
    expect(statusMap.get("3")).toBe("correct");
    expect(statusMap.get("5")).toBe("correct");
    expect(statusMap.get("2")).toBe("incorrect");
    expect(statusMap.get("7")).toBe("incorrect");
    expect(statusMap.get("8")).toBe("uncertain");
    expect(statusMap.get("4")).toBeUndefined();
  });

  it("updates and clears matrix fields cleanly", () => {
    let fields = { completed: "1", incorrect: "", partial: "" };

    fields = updateMatrixFields(fields, "2", "incorrect");
    expect(fields.completed).toBe("1");
    expect(fields.incorrect).toBe("2");

    fields = updateMatrixFields(fields, "1", "clear");
    expect(fields.completed).toBe("");
    expect(fields.incorrect).toBe("2");

    fields = updateMatrixFields(fields, "2", "correct");
    expect(fields.completed).toBe("2");
    expect(fields.incorrect).toBe("");
  });
});
