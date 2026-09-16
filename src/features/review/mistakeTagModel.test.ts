import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTagToQuestion,
  batchAddTagsToQuestions,
  batchRemoveTagsFromQuestions,
  getAllAvailableTags,
  getConflictingPriorityTag,
  getMistakeTagTone,
  getQuestionTags,
  loadAllQuestionTags,
  loadCustomTags,
  MISTAKE_TAGS_STORAGE_KEY,
  PRESET_MISTAKE_TAGS,
  removeTagFromQuestion,
  sanitizeQuestionTags,
  saveAllQuestionTags,
  saveCustomTags,
} from "./mistakeTagModel";

describe("mistakeTagModel", () => {
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
    });
  });

  describe("getMistakeTagTone", () => {
    it("returns tone for preset tags", () => {
      expect(getMistakeTagTone("计算失误")).toBe("danger");
      expect(getMistakeTagTone("概念模糊")).toBe("warning");
      expect(getMistakeTagTone("典型好题")).toBe("success");
    });

    it("returns neutral for custom tags", () => {
      expect(getMistakeTagTone("泰勒展开")).toBe("neutral");
    });
  });

  describe("load and save question tags", () => {
    it("returns empty object on empty storage", () => {
      expect(loadAllQuestionTags()).toEqual({});
    });

    it("loads valid question tags map", () => {
      mockStorage[MISTAKE_TAGS_STORAGE_KEY] = JSON.stringify({
        q1: ["计算失误", "概念模糊"],
        q2: ["思路卡壳"],
      });
      const tags = loadAllQuestionTags();
      expect(tags).toEqual({
        q1: ["计算失误", "概念模糊"],
        q2: ["思路卡壳"],
      });
    });

    it("handles malformed JSON gracefully", () => {
      mockStorage[MISTAKE_TAGS_STORAGE_KEY] = "not-a-json";
      expect(loadAllQuestionTags()).toEqual({});
    });

    it("saves question tags map to localStorage", () => {
      saveAllQuestionTags({ q1: ["计算失误"] });
      expect(JSON.parse(mockStorage[MISTAKE_TAGS_STORAGE_KEY]!)).toEqual({
        q1: ["计算失误"],
      });
    });
  });

  describe("load and save custom tags", () => {
    it("returns empty array on empty storage", () => {
      expect(loadCustomTags()).toEqual([]);
    });

    it("saves and loads custom tags deduplicated", () => {
      saveCustomTags(["中值定理", "洛必达", "中值定理"]);
      expect(loadCustomTags()).toEqual(["中值定理", "洛必达"]);
    });
  });

  describe("addTagToQuestion and removeTagFromQuestion", () => {
    it("adds preset tag to question without adding to custom tags", () => {
      addTagToQuestion("q1", "计算失误");
      expect(getQuestionTags("q1")).toEqual(["计算失误"]);
      expect(loadCustomTags()).toEqual([]);
    });

    it("adds custom tag to question and registers to custom tags", () => {
      addTagToQuestion("q1", "多元微分");
      expect(getQuestionTags("q1")).toEqual(["多元微分"]);
      expect(loadCustomTags()).toEqual(["多元微分"]);
    });

    it("avoids duplicate tags on same question", () => {
      addTagToQuestion("q1", "计算失误");
      addTagToQuestion("q1", "计算失误");
      expect(getQuestionTags("q1")).toEqual(["计算失误"]);
    });

    it("removes tag from question and cleans up empty key", () => {
      addTagToQuestion("q1", "计算失误");
      addTagToQuestion("q1", "思路卡壳");
      removeTagFromQuestion("q1", "计算失误");
      expect(getQuestionTags("q1")).toEqual(["思路卡壳"]);
      removeTagFromQuestion("q1", "思路卡壳");
      expect(getQuestionTags("q1")).toEqual([]);
      expect(loadAllQuestionTags()).toEqual({});
    });
  });

  describe("batch operations", () => {
    it("batch adds tags to multiple questions", () => {
      batchAddTagsToQuestions(["q1", "q2"], ["计算失误", "反常积分"]);
      expect(getQuestionTags("q1")).toEqual(["计算失误", "反常积分"]);
      expect(getQuestionTags("q2")).toEqual(["计算失误", "反常积分"]);
      expect(loadCustomTags()).toEqual(["反常积分"]);
    });

    it("batch removes tags from multiple questions", () => {
      batchAddTagsToQuestions(["q1", "q2"], ["计算失误", "思路卡壳"]);
      batchRemoveTagsFromQuestions(["q1", "q2"], ["计算失误"]);
      expect(getQuestionTags("q1")).toEqual(["思路卡壳"]);
      expect(getQuestionTags("q2")).toEqual(["思路卡壳"]);
    });
  });

  describe("getAllAvailableTags", () => {
    it("combines presets and custom tags", () => {
      saveCustomTags(["定积分定义", "计算失误"]);
      const all = getAllAvailableTags();
      expect(all).toContain("计算失误");
      expect(all).toContain("定积分定义");
      expect(all.length).toBe(PRESET_MISTAKE_TAGS.length + 1);
    });
  });

  describe("priority tags mutual exclusivity & sanitization", () => {
    it("identifies conflicting priority tags correctly", () => {
      expect(getConflictingPriorityTag("必做")).toBe("选做");
      expect(getConflictingPriorityTag("选做")).toBe("必做");
      expect(getConflictingPriorityTag("计算失误")).toBeUndefined();
    });

    it("sanitizes conflicting tags and preserves the later one when no preferred tag is specified", () => {
      expect(sanitizeQuestionTags(["选做", "必做"])).toEqual(["必做"]);
      expect(sanitizeQuestionTags(["必做", "选做"])).toEqual(["选做"]);
      expect(sanitizeQuestionTags(["选做", "计算失误", "必做"])).toEqual([
        "计算失误",
        "必做",
      ]);
    });

    it("sanitizes conflicting tags respecting preferredTag override", () => {
      expect(sanitizeQuestionTags(["必做", "选做"], "必做")).toEqual(["必做"]);
      expect(sanitizeQuestionTags(["必做", "选做"], "选做")).toEqual(["选做"]);
    });

    it("loadAllQuestionTags self-heals corrupted storage containing both 必做 and 选做", () => {
      mockStorage[MISTAKE_TAGS_STORAGE_KEY] = JSON.stringify({
        q1: ["选做", "必做"],
        q2: ["计算失误", "必做", "选做"],
        q3: ["典型好题"],
      });
      const result = loadAllQuestionTags();
      expect(result.q1).toEqual(["必做"]);
      expect(result.q2).toEqual(["计算失误", "选做"]);
      expect(result.q3).toEqual(["典型好题"]);

      // Verify that cleaned data was written back to localStorage
      const savedInStorage = JSON.parse(mockStorage[MISTAKE_TAGS_STORAGE_KEY]!);
      expect(savedInStorage.q1).toEqual(["必做"]);
      expect(savedInStorage.q2).toEqual(["计算失误", "选做"]);
    });

    it("addTagToQuestion automatically removes 选做 when adding 必做", () => {
      addTagToQuestion("q1", "选做");
      expect(getQuestionTags("q1")).toEqual(["选做"]);

      addTagToQuestion("q1", "必做");
      expect(getQuestionTags("q1")).toEqual(["必做"]);
    });

    it("addTagToQuestion automatically removes 必做 when adding 选做", () => {
      addTagToQuestion("q1", "必做");
      expect(getQuestionTags("q1")).toEqual(["必做"]);

      addTagToQuestion("q1", "选做");
      expect(getQuestionTags("q1")).toEqual(["选做"]);
    });

    it("batchAddTagsToQuestions enforces mutual exclusivity across questions", () => {
      addTagToQuestion("q1", "选做");
      addTagToQuestion("q2", "选做");

      batchAddTagsToQuestions(["q1", "q2"], ["必做", "典型好题"]);
      expect(getQuestionTags("q1")).toEqual(["必做", "典型好题"]);
      expect(getQuestionTags("q2")).toEqual(["必做", "典型好题"]);
    });
  });
});
