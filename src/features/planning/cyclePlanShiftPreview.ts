import type {
  ConfirmCyclePlanShiftRequest,
  CyclePlanShiftPreview,
  PreviewCyclePlanShiftRequest,
} from "../../shared/tauri/cyclePlanClient";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function createCyclePlanShiftPreview(
  request: PreviewCyclePlanShiftRequest,
  preview: CyclePlanShiftPreview,
): CyclePlanShiftPreview {
  if (
    !validRequest(request) ||
    !validPreview(preview) ||
    preview.planId !== request.planId ||
    preview.fromDate !== request.fromDate ||
    preview.studyDays !== request.studyDays
  ) {
    throw new Error("CYCLE_PLAN_SHIFT_PREVIEW_INVALID");
  }
  return {
    ...preview,
    restWeekdays: [...preview.restWeekdays],
  };
}

export function canConfirmCyclePlanShiftPreview(
  preview: CyclePlanShiftPreview,
): boolean {
  return preview.affectedItemCount > 0 && preview.previewToken !== null;
}

export function createConfirmCyclePlanShiftRequest(
  preview: CyclePlanShiftPreview,
): ConfirmCyclePlanShiftRequest {
  if (!canConfirmCyclePlanShiftPreview(preview)) {
    throw new Error("CYCLE_PLAN_SHIFT_PREVIEW_EMPTY");
  }
  return {
    planId: preview.planId,
    fromDate: preview.fromDate,
    studyDays: preview.studyDays,
    previewToken: preview.previewToken as string,
  };
}

export function cyclePlanShiftPreviewIdentity(
  preview: CyclePlanShiftPreview,
): string {
  return JSON.stringify([
    preview.planId,
    preview.fromDate,
    preview.studyDays,
    preview.affectedItemCount,
    preview.previewToken ?? "empty",
  ]);
}

export function cyclePlanShiftPreviewRequestIdentity(
  request: PreviewCyclePlanShiftRequest,
): string {
  return `${request.planId}:${request.fromDate}:${request.studyDays}`;
}

export function cyclePlanShiftDeadlineWarning(
  preview: CyclePlanShiftPreview,
): string | undefined {
  return preview.exceedsDeadlineByDays === 0
    ? undefined
    : `顺延后预计超过截止日期 ${preview.exceedsDeadlineByDays} 天，仍可按原节奏确认。`;
}

export function cyclePlanShiftRestDaysLabel(
  preview: CyclePlanShiftPreview,
): string {
  if (preview.restWeekdays.length === 0) {
    return "当前未设置每周休息日。";
  }
  return `排程会自动跳过${preview.restWeekdays
    .map((weekday) => WEEKDAYS[weekday])
    .join("、")}。`;
}

function validRequest(request: PreviewCyclePlanShiftRequest): boolean {
  return (
    typeof request.planId === "string" &&
    request.planId.length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(request.fromDate) &&
    Number.isSafeInteger(request.studyDays) &&
    request.studyDays > 0
  );
}

function validPreview(preview: CyclePlanShiftPreview): boolean {
  return (
    typeof preview === "object" &&
    preview !== null &&
    Number.isSafeInteger(preview.affectedItemCount) &&
    preview.affectedItemCount >= 0 &&
    ((preview.affectedItemCount === 0 && preview.previewToken === null) ||
      (preview.affectedItemCount > 0 &&
        typeof preview.previewToken === "string" &&
        preview.previewToken.trim().length > 0)) &&
    Number.isSafeInteger(preview.exceedsDeadlineByDays) &&
    preview.exceedsDeadlineByDays >= 0 &&
    Array.isArray(preview.restWeekdays) &&
    preview.restWeekdays.every(
      (weekday) =>
        Number.isSafeInteger(weekday) && weekday >= 0 && weekday <= 6,
    ) &&
    new Set(preview.restWeekdays).size === preview.restWeekdays.length
  );
}
