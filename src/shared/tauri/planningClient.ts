import { invoke } from "@tauri-apps/api/core";

import {
  normalizeResourceCommandError,
  type ResourceCommandError,
} from "./resourceClient";

export interface StudyPlan {
  id: string;
  title: string;
  targetExam?: string;
  examDate?: string;
  overview?: string;
  status: "draft" | "active" | "archived";
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlanStage {
  id: string;
  planId: string;
  title: string;
  startDate: string;
  endDate: string;
  focus?: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlanReference {
  id: string;
  planId: string;
  documentId: string;
  documentTitle: string;
  pageStart: number;
  pageEnd: number;
  note?: string;
  createdAt: number;
}

export interface StudyPlanBundle {
  plan: StudyPlan;
  stages: PlanStage[];
  references: PlanReference[];
}

export interface SavePlanInput {
  id?: string;
  expectedRevision?: number;
  title: string;
  targetExam?: string;
  examDate?: string;
  overview?: string;
}

export interface SavePlanStageInput {
  id?: string;
  planId: string;
  expectedPlanRevision: number;
  title: string;
  startDate: string;
  endDate: string;
  focus?: string;
  sortOrder: number;
}

export interface AddPlanReferenceInput {
  planId: string;
  expectedPlanRevision: number;
  documentId: string;
  pageStart: number;
  pageEnd: number;
  note?: string;
}

const PLAN_ERROR_COPY: Record<string, { message: string; action: string }> = {
  PLAN_INPUT_INVALID: {
    message: "个人计划内容不完整或格式无效。",
    action: "检查标题、日期范围和文字长度后重试。",
  },
  PLAN_NOT_FOUND: {
    message: "找不到这份个人计划。",
    action: "刷新计划列表后重新选择。",
  },
  PLAN_SAVE_STALE: {
    message: "个人计划已在其他窗口发生变化。",
    action: "刷新计划后重新核对考试信息再保存。",
  },
  PLAN_STAGE_NOT_FOUND: {
    message: "找不到这个计划阶段。",
    action: "刷新计划后重新编辑阶段。",
  },
  PLAN_REFERENCE_NOT_FOUND: {
    message: "找不到这条资料引用。",
    action: "刷新计划后重新选择引用。",
  },
  PLAN_REFERENCE_INVALID: {
    message: "资料引用的 PDF 或页码范围无效。",
    action: "选择已导入的 PDF，并检查起止页码。",
  },
};

export async function listStudyPlans(): Promise<StudyPlanBundle[]> {
  const value: unknown = await invoke("list_study_plans");
  if (!Array.isArray(value)) {
    throw new Error("PLAN_LIST_INVALID");
  }
  return value.map(parseStudyPlanBundle);
}

export async function saveStudyPlan(
  request: SavePlanInput,
): Promise<StudyPlanBundle> {
  return parseStudyPlanBundle(await invoke("save_study_plan", { request }));
}

export async function setStudyPlanStatus(
  planId: string,
  expectedRevision: number,
  status: StudyPlan["status"],
): Promise<StudyPlanBundle> {
  return parseStudyPlanBundle(
    await invoke("set_study_plan_status", { planId, expectedRevision, status }),
  );
}

export async function savePlanStage(
  request: SavePlanStageInput,
): Promise<PlanStage> {
  return parsePlanStage(await invoke("save_plan_stage", { request }));
}

export async function deletePlanStage(
  stageId: string,
  expectedPlanRevision: number,
): Promise<void> {
  await invoke("delete_plan_stage", { stageId, expectedPlanRevision });
}

export async function addPlanReference(
  request: AddPlanReferenceInput,
): Promise<PlanReference> {
  return parsePlanReference(await invoke("add_plan_reference", { request }));
}

export async function deletePlanReference(
  referenceId: string,
  expectedPlanRevision: number,
): Promise<void> {
  await invoke("delete_plan_reference", {
    referenceId,
    expectedPlanRevision,
  });
}

export function normalizePlanningError(error: unknown): ResourceCommandError {
  if (isRecord(error) && typeof error.code === "string") {
    const copy = PLAN_ERROR_COPY[error.code];
    if (copy !== undefined) {
      return {
        code: error.code,
        ...copy,
        operationId:
          typeof error.operationId === "string" ? error.operationId : undefined,
      };
    }
  }
  return normalizeResourceCommandError(error);
}

export function parseStudyPlanBundle(value: unknown): StudyPlanBundle {
  if (
    !isRecord(value) ||
    !Array.isArray(value.stages) ||
    !Array.isArray(value.references)
  ) {
    throw new Error("PLAN_BUNDLE_INVALID");
  }
  return {
    plan: parsePlan(value.plan),
    stages: value.stages.map(parsePlanStage),
    references: value.references.map(parsePlanReference),
  };
}

function parsePlan(value: unknown): StudyPlan {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !isOptionalString(value.targetExam) ||
    !isOptionalString(value.examDate) ||
    !isOptionalString(value.overview) ||
    !["draft", "active", "archived"].includes(
      typeof value.status === "string" ? value.status : "",
    ) ||
    !isNonNegativeInteger(value.revision) ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("PLAN_INVALID");
  }
  return {
    id: value.id,
    title: value.title,
    targetExam: optionalString(value.targetExam),
    examDate: optionalString(value.examDate),
    overview: optionalString(value.overview),
    status: value.status as StudyPlan["status"],
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parsePlanStage(value: unknown): PlanStage {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.planId !== "string" ||
    typeof value.title !== "string" ||
    typeof value.startDate !== "string" ||
    typeof value.endDate !== "string" ||
    !isOptionalString(value.focus) ||
    !isNonNegativeInteger(value.sortOrder) ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("PLAN_STAGE_INVALID");
  }
  return {
    id: value.id,
    planId: value.planId,
    title: value.title,
    startDate: value.startDate,
    endDate: value.endDate,
    focus: optionalString(value.focus),
    sortOrder: value.sortOrder,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parsePlanReference(value: unknown): PlanReference {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.planId !== "string" ||
    typeof value.documentId !== "string" ||
    typeof value.documentTitle !== "string" ||
    !isPositiveInteger(value.pageStart) ||
    !isPositiveInteger(value.pageEnd) ||
    value.pageEnd < value.pageStart ||
    !isOptionalString(value.note) ||
    !isNonNegativeInteger(value.createdAt)
  ) {
    throw new Error("PLAN_REFERENCE_INVALID");
  }
  return {
    id: value.id,
    planId: value.planId,
    documentId: value.documentId,
    documentTitle: value.documentTitle,
    pageStart: value.pageStart,
    pageEnd: value.pageEnd,
    note: optionalString(value.note),
    createdAt: value.createdAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isNonNegativeInteger(value) && value > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
