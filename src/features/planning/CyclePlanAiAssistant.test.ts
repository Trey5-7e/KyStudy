import { describe, expect, it } from "vitest";

import {
  buildCyclePlanPrompt,
  filterContextsAfterResourceToggle,
  filterPlanningResources,
  filterSearchResultsByResources,
  isCurrentCyclePlanRequest,
  isCyclePlanPreviewCurrent,
  parseCyclePlanCards,
  resetCyclePlanSearchState,
  togglePlanningResourceSelection,
} from "./CyclePlanAiAssistant";

const planningPdf = {
  id: "planning-pdf",
  title: "weekly-plan.pdf",
  kind: "pdf" as const,
  mimeType: "application/pdf",
  sizeBytes: 10,
  sha256: "A".repeat(64),
  reusedExistingBlob: false,
  role: "planning" as const,
  pageCount: 12,
  createdAt: 1,
};

const referencePdf = {
  ...planningPdf,
  id: "reference-pdf",
  title: "reference.pdf",
  role: "reference" as const,
};

describe("parseCyclePlanCards", () => {
  it("reads a bounded structured plan card list", () => {
    const cards = parseCyclePlanCards(
      '```json\n[{"name":"数学卷","totalUnits":20,"unitLabel":"套","startDate":"2026-08-01","deadline":"2026-12-21","studyDaysPerUnit":2,"scheduleMode":"rhythm"}]\n```',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]?.totalUnits).toBe("20");
  });

  it("rejects prose that cannot become a controlled draft", () => {
    expect(() => parseCyclePlanCards("请每天做一套卷")).toThrow(
      "AI_PLAN_CARDS_INVALID",
    );
  });
});

describe("buildCyclePlanPrompt", () => {
  it("only includes selected page excerpts, without local ids or paths", () => {
    const prompt = buildCyclePlanPrompt(
      "按资料安排强化阶段",
      {
        name: "数学强化",
        totalUnits: "20",
        unitLabel: "讲",
        startDate: "2026-08-01",
        deadline: "2026-10-01",
        studyDaysPerUnit: "2",
        scheduleMode: "rhythm",
      },
      [
        {
          documentId: "private-local-id",
          documentTitle: "强化经验.pdf",
          documentKind: "pdf",
          pageNumber: 12,
          excerpt: "每周保留一天用于休息和复盘。",
          matchKind: "page_text",
        },
      ],
      [],
    );

    expect(prompt).toContain("[资料1] 强化经验.pdf 第 12 页");
    expect(prompt).toContain("每周保留一天用于休息和复盘");
    expect(prompt).not.toContain("private-local-id");
    expect(prompt).not.toMatch(/[A-Z]:\\/);
  });

  it("reduces a source path to a human-readable file name", () => {
    const prompt = buildCyclePlanPrompt(
      "use the selected page",
      {
        name: "plan",
        totalUnits: "1",
        unitLabel: "set",
        startDate: "2026-08-01",
        deadline: "2026-08-01",
        studyDaysPerUnit: "1",
        scheduleMode: "rhythm",
      },
      [
        {
          documentId: "private-local-id",
          documentTitle: "C:\\Users\\private\\planning.pdf",
          documentKind: "pdf",
          pageNumber: 1,
          excerpt: "selected page text",
          matchKind: "page_text",
        },
      ],
      [],
    );

    expect(prompt).toContain("planning.pdf");
    expect(prompt).not.toContain("C:\\Users\\private");
  });

  it("invalidates an approved preview when any prepared input changes", () => {
    const prepared = buildCyclePlanPrompt(
      "按资料安排强化阶段",
      {
        name: "数学强化",
        totalUnits: "20",
        unitLabel: "讲",
        startDate: "2026-08-01",
        deadline: "2026-10-01",
        studyDaysPerUnit: "2",
        scheduleMode: "rhythm",
      },
      [],
      [],
    );
    const changed = prepared.replace("2026-10-01", "2026-11-01");

    expect(isCyclePlanPreviewCurrent(prepared, prepared)).toBe(true);
    expect(isCyclePlanPreviewCurrent(prepared, changed)).toBe(false);
    expect(isCyclePlanPreviewCurrent("", prepared)).toBe(false);
  });

  it("invalidates a preview when the previous AI drafts change", () => {
    const current = {
      name: "数学强化",
      totalUnits: "20",
      unitLabel: "讲",
      startDate: "2026-08-01",
      deadline: "2026-10-01",
      studyDaysPerUnit: "2",
      scheduleMode: "rhythm" as const,
    };
    const prepared = buildCyclePlanPrompt(
      "把第一阶段压缩到九月",
      current,
      [],
      [],
    );
    const changed = buildCyclePlanPrompt(
      "把第一阶段压缩到九月",
      current,
      [],
      [
        {
          ...current,
          name: "上一轮草案",
        },
      ],
    );

    expect(isCyclePlanPreviewCurrent(prepared, changed)).toBe(false);
  });
});

describe("parseCyclePlanCards boundaries", () => {
  it("keeps at most five cards and normalizes bounded text fields", () => {
    const cards = Array.from({ length: 7 }, (_, index) => ({
      name: `计划 ${index}`,
      totalUnits: 20,
      unitLabel: "套",
      startDate: "2026-08-01",
      deadline: "2026-12-21",
      studyDaysPerUnit: 2,
      scheduleMode: "rhythm",
    }));

    const parsed = parseCyclePlanCards(JSON.stringify(cards));

    expect(parsed).toHaveLength(5);
    expect(parsed[0]?.name).toBe("计划 0");
    expect(parsed[4]?.name).toBe("计划 4");
  });

  it("rejects unsafe numeric fields before a draft can be adopted", () => {
    expect(() =>
      parseCyclePlanCards(
        JSON.stringify([
          {
            name: "过大计划",
            totalUnits: 501,
            unitLabel: "套",
            startDate: "2026-08-01",
            deadline: "2026-12-21",
            studyDaysPerUnit: 2,
            scheduleMode: "rhythm",
          },
        ]),
      ),
    ).toThrow("AI_PLAN_CARDS_INVALID");
  });
});

describe("cycle planning resource selection", () => {
  it("only exposes resources marked for planning", () => {
    expect(filterPlanningResources([planningPdf, referencePdf])).toEqual([
      planningPdf,
    ]);
  });

  it("toggles a resource without duplicating it, so the same control removes it", () => {
    expect(togglePlanningResourceSelection([], planningPdf)).toEqual([
      planningPdf,
    ]);
    expect(togglePlanningResourceSelection([planningPdf], planningPdf)).toEqual(
      [],
    );
  });

  it("keeps selected page contexts aligned with the current resource scope", () => {
    const contexts = [
      {
        documentId: planningPdf.id,
        documentTitle: planningPdf.title,
        documentKind: "pdf" as const,
        pageNumber: 2,
        excerpt: "planning",
        matchKind: "page_text" as const,
      },
      {
        documentId: referencePdf.id,
        documentTitle: referencePdf.title,
        documentKind: "pdf" as const,
        pageNumber: 3,
        excerpt: "reference",
        matchKind: "page_text" as const,
      },
    ];

    expect(filterContextsAfterResourceToggle(contexts, [planningPdf])).toEqual([
      contexts[0],
    ]);
    expect(
      filterContextsAfterResourceToggle(contexts, [], planningPdf.id),
    ).toEqual([contexts[1]]);
  });

  it("resets search results when the resource scope changes", () => {
    expect(resetCyclePlanSearchState()).toEqual({
      results: [],
      attempted: false,
    });
  });

  it("accepts only the latest mounted async request", () => {
    expect(isCurrentCyclePlanRequest(2, 2, true)).toBe(true);
    expect(isCurrentCyclePlanRequest(1, 2, true)).toBe(false);
    expect(isCurrentCyclePlanRequest(2, 2, false)).toBe(false);
  });

  it("keeps only page text from selected documents while preserving the unscoped path", () => {
    const results = [
      {
        documentId: planningPdf.id,
        documentTitle: planningPdf.title,
        documentKind: "pdf" as const,
        pageNumber: 2,
        excerpt: "selected",
        matchKind: "page_text" as const,
      },
      {
        documentId: referencePdf.id,
        documentTitle: referencePdf.title,
        documentKind: "pdf" as const,
        pageNumber: 3,
        excerpt: "other",
        matchKind: "page_text" as const,
      },
      {
        documentId: planningPdf.id,
        documentTitle: planningPdf.title,
        documentKind: "pdf" as const,
        excerpt: "title only",
        matchKind: "title" as const,
      },
    ];

    expect(filterSearchResultsByResources(results, [planningPdf])).toEqual([
      results[0],
    ]);
    expect(filterSearchResultsByResources(results, [])).toEqual([
      results[0],
      results[1],
    ]);
  });
});
