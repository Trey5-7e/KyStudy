import { describe, expect, it } from "vitest";

import type {
  CyclePlanShiftPreview,
  PreviewCyclePlanShiftRequest,
} from "../../shared/tauri/cyclePlanClient";
import {
  canConfirmCyclePlanShiftPreview,
  createConfirmCyclePlanShiftRequest,
  createCyclePlanShiftPreview,
  cyclePlanShiftDeadlineWarning,
  cyclePlanShiftPreviewIdentity,
  cyclePlanShiftPreviewRequestIdentity,
  cyclePlanShiftRestDaysLabel,
} from "./cyclePlanShiftPreview";

const REQUEST: PreviewCyclePlanShiftRequest = {
  planId: "plan-id",
  fromDate: "2026-08-11",
  studyDays: 1,
};

const PREVIEW: CyclePlanShiftPreview = {
  ...REQUEST,
  affectedItemCount: 3,
  currentEstimatedEndDate: "2026-09-10",
  newEstimatedEndDate: "2026-09-13",
  deadline: "2026-09-11",
  exceedsDeadlineByDays: 2,
  restWeekdays: [5, 6],
  previewToken: "opaque/server-preview-token",
};

describe("cycle plan shift preview model", () => {
  it("creates an exact confirm request from an opaque server token", () => {
    const preview = createCyclePlanShiftPreview(REQUEST, PREVIEW);

    expect(createConfirmCyclePlanShiftRequest(preview)).toEqual({
      planId: "plan-id",
      fromDate: "2026-08-11",
      studyDays: 1,
      previewToken: "opaque/server-preview-token",
    });
    expect(canConfirmCyclePlanShiftPreview(preview)).toBe(true);
  });

  it("keeps request and preview identities stable and distinct", () => {
    expect(cyclePlanShiftPreviewRequestIdentity(REQUEST)).toBe(
      "plan-id:2026-08-11:1",
    );
    expect(cyclePlanShiftPreviewIdentity(PREVIEW)).toBe(
      '["plan-id","2026-08-11",1,3,"opaque/server-preview-token"]',
    );
    expect(
      cyclePlanShiftPreviewIdentity({
        ...PREVIEW,
        previewToken: "new-token",
      }),
    ).not.toBe(cyclePlanShiftPreviewIdentity(PREVIEW));
  });

  it("disables confirmation for a zero-item preview", () => {
    const empty = createCyclePlanShiftPreview(REQUEST, {
      ...PREVIEW,
      affectedItemCount: 0,
      previewToken: null,
    });

    expect(canConfirmCyclePlanShiftPreview(empty)).toBe(false);
    expect(() => createConfirmCyclePlanShiftRequest(empty)).toThrowError(
      "CYCLE_PLAN_SHIFT_PREVIEW_EMPTY",
    );
  });

  it("rejects a mismatched plan or invalid token relation", () => {
    expect(() =>
      createCyclePlanShiftPreview(REQUEST, {
        ...PREVIEW,
        planId: "other-plan",
      }),
    ).toThrowError("CYCLE_PLAN_SHIFT_PREVIEW_INVALID");
    expect(() =>
      createCyclePlanShiftPreview(REQUEST, {
        ...PREVIEW,
        previewToken: null,
      }),
    ).toThrowError("CYCLE_PLAN_SHIFT_PREVIEW_INVALID");
  });

  it("describes deadline and rest-day boundaries", () => {
    expect(cyclePlanShiftDeadlineWarning(PREVIEW)).toBe(
      "顺延后预计超过截止日期 2 天，仍可按原节奏确认。",
    );
    expect(
      cyclePlanShiftDeadlineWarning({
        ...PREVIEW,
        exceedsDeadlineByDays: 0,
      }),
    ).toBeUndefined();
    expect(cyclePlanShiftRestDaysLabel(PREVIEW)).toBe(
      "排程会自动跳过周六、周日。",
    );
    expect(cyclePlanShiftRestDaysLabel({ ...PREVIEW, restWeekdays: [] })).toBe(
      "当前未设置每周休息日。",
    );
  });
});
