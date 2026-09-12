import { describe, expect, it, vi } from "vitest";
import { filterCommands, type CommandItem } from "./commandPaletteModel";

const sampleCommands: CommandItem[] = [
  {
    id: "drill",
    title: "立即刷错题",
    description: "按错题算法直接推送高优先级错题",
    category: "action",
    icon: "bolt",
    keywords: ["cuoti", "shuati", "错题", "刷题", "算法"],
    perform: vi.fn(),
  },
  {
    id: "record",
    title: "快速登记做题",
    description: "在习题册打标矩阵中快速记录答题结果",
    category: "action",
    icon: "edit_note",
    keywords: ["dengji", "zuoti", "登记", "做题", "打标"],
    perform: vi.fn(),
  },
  {
    id: "paper",
    title: "智能组卷练习",
    description: "按范围生成或继续暂存的练习卷",
    category: "action",
    icon: "assignment",
    keywords: ["zujuan", "lianxi", "组卷", "练习", "套卷"],
    perform: vi.fn(),
  },
  {
    id: "nav-today",
    title: "今日学习",
    description: "查看今日重点任务与考试倒计时",
    category: "navigation",
    icon: "today",
    keywords: ["today", "jinri", "今日", "首页"],
    perform: vi.fn(),
  },
  {
    id: "nav-settings",
    title: "系统设置",
    description: "管理本地工作区与基础设置",
    category: "navigation",
    icon: "settings",
    keywords: ["settings", "shezhi", "设置", "偏好"],
    perform: vi.fn(),
  },
];

describe("commandPaletteModel", () => {
  it("returns all items when query is empty", () => {
    expect(filterCommands(sampleCommands, "")).toEqual(sampleCommands);
    expect(filterCommands(sampleCommands, "   ")).toEqual(sampleCommands);
  });

  it("filters items by title match", () => {
    const results = filterCommands(sampleCommands, "错题");
    expect(results.map((r) => r.id)).toEqual(["drill"]);
  });

  it("filters items by keywords", () => {
    const results = filterCommands(sampleCommands, "dengji");
    expect(results.map((r) => r.id)).toEqual(["record"]);
  });

  it("filters items by description", () => {
    const results = filterCommands(sampleCommands, "倒计时");
    expect(results.map((r) => r.id)).toEqual(["nav-today"]);
  });

  it("supports multi-word query", () => {
    const results = filterCommands(sampleCommands, "快速 登记");
    expect(results.map((r) => r.id)).toEqual(["record"]);
  });

  it("returns empty array when nothing matches", () => {
    const results = filterCommands(sampleCommands, "xyz123");
    expect(results).toEqual([]);
  });

  it("prioritizes title prefix match over keyword match", () => {
    const customCommands: CommandItem[] = [
      {
        id: "1",
        title: "错题专项练习",
        description: "练习",
        category: "action",
        icon: "bolt",
        keywords: ["cuoti"],
        perform: vi.fn(),
      },
      {
        id: "2",
        title: "智能练习",
        description: "错题练习",
        category: "action",
        icon: "assignment",
        keywords: ["错题"],
        perform: vi.fn(),
      },
    ];
    const results = filterCommands(customCommands, "错题");
    expect(results[0]?.id).toBe("1");
  });
});
