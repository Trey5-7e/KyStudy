import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  addPlanReference,
  deletePlanReference,
  deletePlanStage,
  normalizePlanningError,
  parseStudyPlanBundle,
  saveStudyPlan,
  savePlanStage,
  setStudyPlanStatus,
} from "./planningClient";

const mockedInvoke = vi.mocked(invoke);

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

describe("study plan save concurrency", () => {
  beforeEach(() => mockedInvoke.mockReset());

  it("sends the current revision when updating exam information", async () => {
    mockedInvoke.mockResolvedValue(VALID_BUNDLE);
    const request = {
      id: VALID_BUNDLE.plan.id,
      expectedRevision: 4,
      title: "159 天备考计划",
      targetExam: "计算机考研",
      examDate: "2026-12-25",
    };

    await saveStudyPlan(request);

    expect(mockedInvoke).toHaveBeenCalledWith("save_study_plan", { request });
  });

  it("keeps stale exam saves actionable", () => {
    expect(normalizePlanningError({ code: "PLAN_SAVE_STALE" })).toEqual({
      code: "PLAN_SAVE_STALE",
      message: "个人计划已在其他窗口发生变化。",
      action: "刷新计划后重新核对考试信息再保存。",
    });
  });

  it("sends the current revision when changing plan status", async () => {
    mockedInvoke.mockResolvedValue(VALID_BUNDLE);

    await setStudyPlanStatus(VALID_BUNDLE.plan.id, 4, "active");

    expect(mockedInvoke).toHaveBeenCalledWith("set_study_plan_status", {
      planId: VALID_BUNDLE.plan.id,
      expectedRevision: 4,
      status: "active",
    });
  });

  it("sends the parent revision for stage and reference mutations", async () => {
    const stage = VALID_BUNDLE.stages[0];
    const reference = VALID_BUNDLE.references[0];
    if (stage === undefined || reference === undefined) {
      throw new Error("valid fixture should include a stage and reference");
    }
    mockedInvoke.mockResolvedValueOnce(stage);
    await savePlanStage({
      planId: VALID_BUNDLE.plan.id,
      expectedPlanRevision: 4,
      title: "基础阶段",
      startDate: "2026-07-19",
      endDate: "2026-09-01",
      sortOrder: 0,
    });
    await deletePlanStage(stage.id, 5);
    mockedInvoke.mockResolvedValueOnce(reference);
    await addPlanReference({
      planId: VALID_BUNDLE.plan.id,
      expectedPlanRevision: 6,
      documentId: reference.documentId,
      pageStart: 2,
      pageEnd: 3,
    });
    await deletePlanReference(reference.id, 7);

    expect(
      mockedInvoke.mock.calls.map(([command, payload]) => [command, payload]),
    ).toEqual([
      [
        "save_plan_stage",
        {
          request: expect.objectContaining({ expectedPlanRevision: 4 }),
        },
      ],
      [
        "delete_plan_stage",
        expect.objectContaining({ expectedPlanRevision: 5 }),
      ],
      [
        "add_plan_reference",
        {
          request: expect.objectContaining({ expectedPlanRevision: 6 }),
        },
      ],
      [
        "delete_plan_reference",
        expect.objectContaining({ expectedPlanRevision: 7 }),
      ],
    ]);
  });
});
