import { describe, expect, it } from "vitest";
import {
  formatAttemptDuration,
  formatTimelineTimestamp,
  getAttemptResultMeta,
  getMasteryMeta,
  getReviewRatingMeta,
} from "./QuestionAttemptTimeline";

describe("QuestionAttemptTimeline helpers", () => {
  describe("formatAttemptDuration", () => {
    it("returns undefined for undefined or non-positive durations", () => {
      expect(formatAttemptDuration(undefined)).toBeUndefined();
      expect(formatAttemptDuration(0)).toBeUndefined();
      expect(formatAttemptDuration(-10)).toBeUndefined();
    });

    it("formats seconds under one minute", () => {
      expect(formatAttemptDuration(30)).toBe("30 秒");
      expect(formatAttemptDuration(59)).toBe("59 秒");
    });

    it("formats exact minutes", () => {
      expect(formatAttemptDuration(60)).toBe("1 分钟");
      expect(formatAttemptDuration(300)).toBe("5 分钟");
    });

    it("formats minutes with remaining seconds", () => {
      expect(formatAttemptDuration(65)).toBe("1 分 5 秒");
      expect(formatAttemptDuration(130)).toBe("2 分 10 秒");
    });
  });

  describe("formatTimelineTimestamp", () => {
    const baseNow = new Date("2026-09-13T12:00:00.000Z").getTime();

    it("formats recent seconds as 刚刚", () => {
      const stamp = baseNow - 20 * 1000;
      const res = formatTimelineTimestamp(stamp, baseNow);
      expect(res.relative).toBe("刚刚");
    });

    it("formats minutes ago", () => {
      const stamp = baseNow - 15 * 60 * 1000;
      const res = formatTimelineTimestamp(stamp, baseNow);
      expect(res.relative).toBe("15 分钟前");
    });

    it("formats hours ago", () => {
      const stamp = baseNow - 4 * 3600 * 1000;
      const res = formatTimelineTimestamp(stamp, baseNow);
      expect(res.relative).toBe("4 小时前");
    });

    it("formats 1 day ago as 昨天", () => {
      const stamp = baseNow - 25 * 3600 * 1000;
      const res = formatTimelineTimestamp(stamp, baseNow);
      expect(res.relative).toBe("昨天");
    });

    it("formats 2 days ago as 前天", () => {
      const stamp = baseNow - 49 * 3600 * 1000;
      const res = formatTimelineTimestamp(stamp, baseNow);
      expect(res.relative).toBe("前天");
    });

    it("formats days ago within a month", () => {
      const stamp = baseNow - 6 * 24 * 3600 * 1000;
      const res = formatTimelineTimestamp(stamp, baseNow);
      expect(res.relative).toBe("6 天前");
    });
  });

  describe("getMasteryMeta", () => {
    it("maps mastery strings to correct labels and tones", () => {
      expect(getMasteryMeta("mastered")).toEqual({
        label: "已攻克",
        tone: "success",
      });
      expect(getMasteryMeta("learning")).toEqual({
        label: "待攻克",
        tone: "warning",
      });
      expect(getMasteryMeta("uncertain")).toEqual({
        label: "模糊待复习",
        tone: "warning",
      });
      expect(getMasteryMeta("new")).toEqual({
        label: "新加入",
        tone: "info",
      });
      expect(getMasteryMeta(undefined)).toEqual({
        label: "练习中",
        tone: "neutral",
      });
    });
  });

  describe("getAttemptResultMeta", () => {
    it("maps attempt results to labels, tones and icons", () => {
      expect(getAttemptResultMeta("correct")).toEqual({
        label: "做对",
        tone: "success",
        icon: "check_circle",
      });
      expect(getAttemptResultMeta("uncertain")).toEqual({
        label: "模糊",
        tone: "warning",
        icon: "help",
      });
      expect(getAttemptResultMeta("incorrect")).toEqual({
        label: "做错",
        tone: "danger",
        icon: "cancel",
      });
    });
  });

  describe("getReviewRatingMeta", () => {
    it("maps review ratings to human-readable feedback", () => {
      expect(getReviewRatingMeta("mastered")).toEqual({
        label: "完全掌握",
        tone: "success",
      });
      expect(getReviewRatingMeta("uncertain")).toEqual({
        label: "有些模糊",
        tone: "warning",
      });
      expect(getReviewRatingMeta("failed")).toEqual({
        label: "不会做",
        tone: "danger",
      });
      expect(getReviewRatingMeta("skipped")).toEqual({
        label: "跳过",
        tone: "neutral",
      });
      expect(getReviewRatingMeta(undefined)).toBeUndefined();
    });
  });
});
