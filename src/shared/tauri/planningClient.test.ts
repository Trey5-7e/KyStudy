import { describe, expect, it } from "vitest";

import { parseStudyPlanBundle } from "./planningClient";

const VALID_BUNDLE = {
  plan: {
    id: "019f7328-4b66-7613-9729-e3570fc41525",
    title: "159 天备考计划",
    targetExam: "计算机考研",
    examDate: "2026-12-25",
    overview: "手动草案",
    status: "draft",
    revision: 1,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  },
  stages: [
    {
      id: "019f7328-4b66-7613-9729-e3570fc41526",
      planId: "019f7328-4b66-7613-9729-e3570fc41525",
      title: "基础阶段",
      startDate: "2026-07-19",
      endDate: "2026-09-01",
      focus: "数学与 408",
      sortOrder: 0,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    },
  ],
  references: [
    {
      id: "019f7328-4b66-7613-9729-e3570fc41527",
      planId: "019f7328-4b66-7613-9729-e3570fc41525",
      documentId: "019f7328-4b66-7613-9729-e3570fc41528",
      documentTitle: "规划经验",
      pageStart: 2,
      pageEnd: 3,
      note: "阶段划分依据",
      createdAt: 1_700_000_000_000,
    },
  ],
};

describe("parseStudyPlanBundle", () => {
  it("returns typed stages and page references", () => {
    const bundle = parseStudyPlanBundle(VALID_BUNDLE);

    expect(bundle.plan.status).toBe("draft");
    expect(bundle.stages[0]?.title).toBe("基础阶段");
    expect(bundle.references[0]?.pageEnd).toBe(3);
  });

  it("rejects a reversed page range", () => {
    expect(() =>
      parseStudyPlanBundle({
        ...VALID_BUNDLE,
        references: [
          { ...VALID_BUNDLE.references[0], pageStart: 4, pageEnd: 3 },
        ],
      }),
    ).toThrowError("PLAN_REFERENCE_INVALID");
  });
});
