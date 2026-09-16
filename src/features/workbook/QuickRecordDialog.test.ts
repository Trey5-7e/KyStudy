import { describe, expect, it } from "vitest";

import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import {
  deriveFieldsFromStaged,
  groupQuestionsByPartAndType,
  markAllQuestionsInGroup,
  matrixCellStatus,
  matrixStatusByNumber,
  setQuestionStagedResult,
  setQuestionTag,
  syncStagedFromFields,
  toggleQuestionStagedResult,
  toggleQuestionTag,
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

describe("groupQuestionsByPartAndType", () => {
  it("groups and sorts questions by sectionPart and questionType", () => {
    const q1 = {
      ...makeQuestion("10"),
      id: "q-10",
      sectionPart: "basic" as const,
      questionType: "choice" as const,
    };
    const q2 = {
      ...makeQuestion("2"),
      id: "q-2",
      sectionPart: "basic" as const,
      questionType: "choice" as const,
    };
    const q3 = {
      ...makeQuestion("1"),
      id: "q-blank-1",
      sectionPart: "basic" as const,
      questionType: "blank" as const,
    };
    const q4 = {
      ...makeQuestion("1"),
      id: "q-comp-1",
      sectionPart: "comprehensive" as const,
      questionType: "solution" as const,
    };

    const groups = groupQuestionsByPartAndType([q1, q2, q3, q4]);
    expect(groups).toHaveLength(3);

    expect(groups[0]?.label).toBe("基础题 · 选择题");
    expect(groups[0]?.questions.map((q) => q.questionNumber)).toEqual([
      "2",
      "10",
    ]);

    expect(groups[1]?.label).toBe("基础题 · 填空题");
    expect(groups[1]?.questions.map((q) => q.questionNumber)).toEqual(["1"]);

    expect(groups[2]?.label).toBe("综合题 · 解答题");
    expect(groups[2]?.questions.map((q) => q.questionNumber)).toEqual(["1"]);
  });
});

describe("staged attempts operations and bidirectional sync", () => {
  const q1 = { ...makeQuestion("1"), id: "q-1" };
  const q2 = { ...makeQuestion("2"), id: "q-2" };
  const q3 = { ...makeQuestion("3"), id: "q-3" };
  const questions = [q1, q2, q3];

  it("sets and toggles staged results by question ID", () => {
    let staged = setQuestionStagedResult({}, "q-1", "correct");
    expect(staged["q-1"]).toBe("correct");

    staged = toggleQuestionStagedResult(staged, "q-1", "correct");
    expect(staged["q-1"]).toBeUndefined();

    staged = toggleQuestionStagedResult(staged, "q-2", "incorrect");
    expect(staged["q-2"]).toBe("incorrect");
  });

  it("marks all questions in group or clears them", () => {
    let staged = markAllQuestionsInGroup({}, questions, "correct");
    expect(staged["q-1"]).toBe("correct");
    expect(staged["q-2"]).toBe("correct");
    expect(staged["q-3"]).toBe("correct");

    staged = markAllQuestionsInGroup(staged, [q1, q2], "clear");
    expect(staged["q-1"]).toBeUndefined();
    expect(staged["q-2"]).toBeUndefined();
    expect(staged["q-3"]).toBe("correct");
  });

  it("syncs staged state from fields and derives fields from staged state", () => {
    const fields = {
      completed: "1,3",
      incorrect: "2",
      partial: "",
    };
    const staged = syncStagedFromFields({}, questions, fields);
    expect(staged["q-1"]).toBe("correct");
    expect(staged["q-2"]).toBe("incorrect");
    expect(staged["q-3"]).toBe("correct");

    const derived = deriveFieldsFromStaged(staged, questions);
    expect(derived.completed).toBe("1,3");
    expect(derived.incorrect).toBe("2");
    expect(derived.partial).toBe("");
  });

  it("handles duplicate question numbers across different groups cleanly", () => {
    const choice1 = {
      ...makeQuestion("1"),
      id: "q-choice-1",
      sectionPart: "basic" as const,
      questionType: "choice" as const,
    };
    const blank1 = {
      ...makeQuestion("1"),
      id: "q-blank-1",
      sectionPart: "basic" as const,
      questionType: "blank" as const,
    };

    let staged = setQuestionStagedResult({}, choice1.id, "correct");
    staged = setQuestionStagedResult(staged, blank1.id, "incorrect");

    expect(staged["q-choice-1"]).toBe("correct");
    expect(staged["q-blank-1"]).toBe("incorrect");

    // Deriving fields for choice1 only reflects choice1's status
    const choiceFields = deriveFieldsFromStaged(staged, [choice1]);
    expect(choiceFields.completed).toBe("1");
    expect(choiceFields.incorrect).toBe("");

    // Deriving fields for blank1 only reflects blank1's status
    const blankFields = deriveFieldsFromStaged(staged, [blank1]);
    expect(blankFields.completed).toBe("");
    expect(blankFields.incorrect).toBe("1");
  });

  it("handles unattempted staged status on previously saved question", () => {
    const saved = makeQuestion("20", "correct");
    const cell = matrixCellStatus(saved, "unattempted");
    expect(cell.effectiveStatus).toBeUndefined();
    expect(cell.isStaged).toBe(true);
    expect(cell.hasSavedStatus).toBe(true);
    expect(cell.label).toBe("20题本次标记：未做（本次重置）");
  });

  it("toggles previously saved question to unattempted when clicked again", () => {
    const saved = makeQuestion("21", "correct");
    // Clicking on a question that is already "correct" toggles it to "unattempted"
    let staged = toggleQuestionStagedResult({}, saved, "correct");
    expect(staged[saved.id]).toBe("unattempted");

    // Clicking it again in "correct" mode toggles back to "correct"
    staged = toggleQuestionStagedResult(staged, saved, "correct");
    expect(staged[saved.id]).toBe("correct");
  });

  it("toggles unattempted mode directly", () => {
    const saved = makeQuestion("22", "incorrect");
    let staged = toggleQuestionStagedResult({}, saved, "unattempted");
    expect(staged[saved.id]).toBe("unattempted");

    const unsaved = makeQuestion("23", undefined);
    staged = setQuestionStagedResult(staged, unsaved.id, "correct");
    staged = toggleQuestionStagedResult(staged, unsaved, "unattempted");
    expect(staged[unsaved.id]).toBeUndefined();
  });
});

describe("question tags helpers", () => {
  it("toggles priority tags mutually exclusively and overrides smoothly", () => {
    let tagsMap: Record<string, string[]> = {};

    // 1. Initial tag: 必做
    tagsMap = toggleQuestionTag(tagsMap, "q-1", "必做");
    expect(tagsMap["q-1"]).toEqual(["必做"]);

    // 2. 选做 overrides 必做
    tagsMap = toggleQuestionTag(tagsMap, "q-1", "选做");
    expect(tagsMap["q-1"]).toEqual(["选做"]);

    // 3. 必做 overrides 选做
    tagsMap = toggleQuestionTag(tagsMap, "q-1", "必做");
    expect(tagsMap["q-1"]).toEqual(["必做"]);

    // 4. Clicking 必做 again toggles it off
    tagsMap = toggleQuestionTag(tagsMap, "q-1", "必做");
    expect(tagsMap["q-1"]).toBeUndefined();
  });

  it("sets question tag idempotently and cleans up conflicting priority tag", () => {
    let tagsMap: Record<string, string[]> = {};

    tagsMap = setQuestionTag(tagsMap, "q-2", "必做", true);
    expect(tagsMap["q-2"]).toEqual(["必做"]);

    // Setting 必做 again is idempotent
    tagsMap = setQuestionTag(tagsMap, "q-2", "必做", true);
    expect(tagsMap["q-2"]).toEqual(["必做"]);

    // Setting 选做 removes 必做
    tagsMap = setQuestionTag(tagsMap, "q-2", "选做", true);
    expect(tagsMap["q-2"]).toEqual(["选做"]);

    // Setting 必做 removes 选做
    tagsMap = setQuestionTag(tagsMap, "q-2", "必做", true);
    expect(tagsMap["q-2"]).toEqual(["必做"]);

    // Unsetting 必做 clears it
    tagsMap = setQuestionTag(tagsMap, "q-2", "必做", false);
    expect(tagsMap["q-2"]).toBeUndefined();
  });

  it("preserves non-conflicting mistake tags while switching priority tags", () => {
    let tagsMap: Record<string, string[]> = {
      "q-3": ["计算错误", "必做"],
    };

    // Switching to 选做 strips 必做 but retains 计算错误
    tagsMap = toggleQuestionTag(tagsMap, "q-3", "选做");
    expect(tagsMap["q-3"]).toEqual(["计算错误", "选做"]);

    // Drag-setting 必做 strips 选做 but retains 计算错误
    tagsMap = setQuestionTag(tagsMap, "q-3", "必做", true);
    expect(tagsMap["q-3"]).toEqual(["计算错误", "必做"]);
  });

  it("cleans up legacy dirty state where both 必做 and 选做 were present", () => {
    const dirtyMap: Record<string, string[]> = {
      "q-4": ["必做", "选做"],
    };

    // Clicking 选做 strips 必做 and leaves only 选做
    const cleaned = toggleQuestionTag(dirtyMap, "q-4", "选做");
    expect(cleaned["q-4"]).toEqual(["选做"]);
  });
});
