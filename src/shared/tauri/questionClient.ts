import { invoke } from "@tauri-apps/api/core";

import {
  normalizeResourceCommandError,
  type ResourceCommandError,
} from "./resourceClient";

export type AttemptResult = "correct" | "incorrect" | "uncertain";
export type QuestionType = "choice" | "blank" | "solution" | "other";
export type ClassificationSource = "pending" | "automatic" | "manual";

export interface Question {
  id: string;
  documentId: string;
  documentTitle: string;
  subjectId?: string;
  subjectName?: string;
  subjectInherited: boolean;
  questionType?: QuestionType;
  classificationSource: ClassificationSource;
  classificationConfidence?: number;
  title: string;
  chapter?: string;
  questionNumber?: string;
  difficulty: number;
  analysisMarkdown?: string;
  deletedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface QuestionRegion {
  id: string;
  questionId: string;
  documentId: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateVersion: 1;
  sortOrder: number;
  createdAt: number;
}

export interface QuestionAttempt {
  id: string;
  questionId: string;
  result: AttemptResult;
  attemptedAt: number;
  durationSeconds?: number;
  answerNote?: string;
  createdAt: number;
}

export interface QuestionKnowledgeLink {
  nodeId: string;
  nodeTitle: string;
  mapId: string;
  mapTitle: string;
}

export interface QuestionBundle {
  question: Question;
  regions: QuestionRegion[];
  attempts: QuestionAttempt[];
  knowledgeLinks: QuestionKnowledgeLink[];
}

export interface QuestionRegionInput {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreateQuestionInput {
  documentId: string;
  title: string;
  subjectId?: string;
  questionType?: QuestionType;
  chapter?: string;
  questionNumber?: string;
  difficulty: number;
  analysisMarkdown?: string;
  region: QuestionRegionInput;
  knowledgeNodeIds: string[];
}

export interface UpdateQuestionInput {
  questionId: string;
  title: string;
  subjectId?: string;
  questionType?: QuestionType;
  chapter?: string;
  questionNumber?: string;
  difficulty: number;
  analysisMarkdown?: string;
  knowledgeNodeIds: string[];
}

export interface AddQuestionAttemptInput {
  questionId: string;
  result: AttemptResult;
  attemptedOn: string;
  durationSeconds?: number;
  answerNote?: string;
}

export interface WorkbookProfile {
  documentId: string;
  defaultSubjectId?: string;
  defaultSubjectName?: string;
  pendingClassificationCount: number;
  updatedAt?: number;
}

const ATTEMPT_RESULTS = new Set<AttemptResult>([
  "correct",
  "incorrect",
  "uncertain",
]);
const QUESTION_TYPES = new Set<QuestionType>([
  "choice",
  "blank",
  "solution",
  "other",
]);
const CLASSIFICATION_SOURCES = new Set<ClassificationSource>([
  "pending",
  "automatic",
  "manual",
]);

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  WORKBOOK_NOT_FOUND: {
    message: "找不到可用的习题册 PDF。",
    action: "把 PDF 用途设为“习题册”，打开一次确认页数后刷新。",
  },
  QUESTION_NOT_FOUND: {
    message: "找不到这道题目。",
    action: "刷新题目列表后重新选择。",
  },
  QUESTION_REGION_NOT_FOUND: {
    message: "找不到这个题目区域。",
    action: "刷新题目后重新选择区域。",
  },
  QUESTION_INPUT_INVALID: {
    message: "题目内容或作答记录格式无效。",
    action: "检查标题、难度、耗时和文字长度后重试。",
  },
  QUESTION_REGION_INVALID: {
    message: "题目框选区域或页码无效。",
    action: "重新在当前 PDF 页面框选完整题目区域。",
  },
  QUESTION_LAST_REGION_PROTECTED: {
    message: "一道题必须至少保留一个来源区域。",
    action: "可以重新框选区域，或删除整道题。",
  },
  QUESTION_KNOWLEDGE_LINK_INVALID: {
    message: "关联的知识节点无效。",
    action: "刷新思维导图后重新选择知识节点。",
  },
  QUESTION_SUBJECT_NOT_FOUND: {
    message: "所选科目不存在或已经归档。",
    action: "刷新科目列表，或让题目继续继承习题册科目。",
  },
};

export async function listWorkbookQuestions(
  documentId: string,
): Promise<QuestionBundle[]> {
  return parseBundleList(
    await invoke("list_workbook_questions", { documentId }),
  );
}

export async function listTrashedQuestions(): Promise<QuestionBundle[]> {
  return parseBundleList(await invoke("list_trashed_questions"));
}

export async function getWorkbookProfile(
  documentId: string,
): Promise<WorkbookProfile> {
  return parseWorkbookProfile(
    await invoke("get_workbook_profile", { documentId }),
  );
}

export async function setWorkbookDefaultSubject(request: {
  documentId: string;
  subjectId?: string;
}): Promise<WorkbookProfile> {
  return parseWorkbookProfile(
    await invoke("set_workbook_default_subject", { request }),
  );
}

export async function batchClassifyQuestions(request: {
  documentId: string;
  questionIds: string[];
  questionType: QuestionType;
}): Promise<QuestionBundle[]> {
  return parseBundleList(await invoke("batch_classify_questions", { request }));
}

export async function createQuestion(
  request: CreateQuestionInput,
): Promise<QuestionBundle> {
  return parseQuestionBundle(await invoke("create_question", { request }));
}

export async function updateQuestion(
  request: UpdateQuestionInput,
): Promise<QuestionBundle> {
  return parseQuestionBundle(await invoke("update_question", { request }));
}

export async function addQuestionRegion(
  questionId: string,
  region: QuestionRegionInput,
): Promise<QuestionBundle> {
  return parseQuestionBundle(
    await invoke("add_question_region", { request: { questionId, region } }),
  );
}

export async function updateQuestionRegion(
  regionId: string,
  region: QuestionRegionInput,
): Promise<QuestionBundle> {
  return parseQuestionBundle(
    await invoke("update_question_region", { request: { regionId, region } }),
  );
}

export async function deleteQuestionRegion(
  regionId: string,
): Promise<QuestionBundle> {
  return parseQuestionBundle(
    await invoke("delete_question_region", { regionId }),
  );
}

export async function addQuestionAttempt(
  request: AddQuestionAttemptInput,
): Promise<QuestionBundle> {
  return parseQuestionBundle(await invoke("add_question_attempt", { request }));
}

export async function trashQuestion(questionId: string): Promise<void> {
  await invoke("trash_question", { questionId });
}

export async function restoreQuestion(
  questionId: string,
): Promise<QuestionBundle> {
  return parseQuestionBundle(await invoke("restore_question", { questionId }));
}

export function normalizeQuestionError(error: unknown): ResourceCommandError {
  if (isRecord(error) && typeof error.code === "string") {
    const copy = ERROR_COPY[error.code];
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

export function parseQuestionBundle(value: unknown): QuestionBundle {
  if (
    !isRecord(value) ||
    !Array.isArray(value.regions) ||
    !Array.isArray(value.attempts) ||
    !Array.isArray(value.knowledgeLinks)
  ) {
    throw new Error("QUESTION_BUNDLE_INVALID");
  }
  const regions = value.regions.map(parseQuestionRegion);
  if (regions.length === 0) {
    throw new Error("QUESTION_BUNDLE_INVALID");
  }
  return {
    question: parseQuestion(value.question),
    regions,
    attempts: value.attempts.map(parseQuestionAttempt),
    knowledgeLinks: value.knowledgeLinks.map(parseQuestionKnowledgeLink),
  };
}

function parseBundleList(value: unknown): QuestionBundle[] {
  if (!Array.isArray(value)) {
    throw new Error("QUESTION_LIST_INVALID");
  }
  return value.map(parseQuestionBundle);
}

function parseQuestion(value: unknown): Question {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.documentId !== "string" ||
    typeof value.documentTitle !== "string" ||
    !isOptionalString(value.subjectId) ||
    !isOptionalString(value.subjectName) ||
    typeof value.subjectInherited !== "boolean" ||
    !(
      value.questionType === null ||
      value.questionType === undefined ||
      QUESTION_TYPES.has(value.questionType as QuestionType)
    ) ||
    !CLASSIFICATION_SOURCES.has(
      value.classificationSource as ClassificationSource,
    ) ||
    !isOptionalConfidence(value.classificationConfidence) ||
    typeof value.title !== "string" ||
    !isOptionalString(value.chapter) ||
    !isOptionalString(value.questionNumber) ||
    !isIntegerInRange(value.difficulty, 1, 5) ||
    !isOptionalString(value.analysisMarkdown) ||
    !isOptionalNonNegativeInteger(value.deletedAt) ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("QUESTION_INVALID");
  }
  return {
    id: value.id,
    documentId: value.documentId,
    documentTitle: value.documentTitle,
    subjectId: optionalString(value.subjectId),
    subjectName: optionalString(value.subjectName),
    subjectInherited: value.subjectInherited,
    questionType:
      typeof value.questionType === "string"
        ? (value.questionType as QuestionType)
        : undefined,
    classificationSource: value.classificationSource as ClassificationSource,
    classificationConfidence:
      typeof value.classificationConfidence === "number"
        ? value.classificationConfidence
        : undefined,
    title: value.title,
    chapter: optionalString(value.chapter),
    questionNumber: optionalString(value.questionNumber),
    difficulty: value.difficulty,
    analysisMarkdown: optionalString(value.analysisMarkdown),
    deletedAt:
      typeof value.deletedAt === "number" ? value.deletedAt : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function parseWorkbookProfile(value: unknown): WorkbookProfile {
  if (
    !isRecord(value) ||
    typeof value.documentId !== "string" ||
    !isOptionalString(value.defaultSubjectId) ||
    !isOptionalString(value.defaultSubjectName) ||
    !isNonNegativeInteger(value.pendingClassificationCount) ||
    !isOptionalNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("WORKBOOK_PROFILE_INVALID");
  }
  return {
    documentId: value.documentId,
    defaultSubjectId: optionalString(value.defaultSubjectId),
    defaultSubjectName: optionalString(value.defaultSubjectName),
    pendingClassificationCount: value.pendingClassificationCount,
    updatedAt:
      typeof value.updatedAt === "number" ? value.updatedAt : undefined,
  };
}

function parseQuestionRegion(value: unknown): QuestionRegion {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.questionId !== "string" ||
    typeof value.documentId !== "string" ||
    !isPositiveInteger(value.pageNumber) ||
    !isNormalized(value.x) ||
    !isNormalized(value.y) ||
    !isPositiveNormalized(value.width) ||
    !isPositiveNormalized(value.height) ||
    value.x + value.width > 1.000_001 ||
    value.y + value.height > 1.000_001 ||
    value.coordinateVersion !== 1 ||
    !isNonNegativeInteger(value.sortOrder) ||
    !isNonNegativeInteger(value.createdAt)
  ) {
    throw new Error("QUESTION_REGION_INVALID");
  }
  return {
    id: value.id,
    questionId: value.questionId,
    documentId: value.documentId,
    pageNumber: value.pageNumber,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    coordinateVersion: 1,
    sortOrder: value.sortOrder,
    createdAt: value.createdAt,
  };
}

function parseQuestionAttempt(value: unknown): QuestionAttempt {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.questionId !== "string" ||
    !ATTEMPT_RESULTS.has(value.result as AttemptResult) ||
    !isNonNegativeInteger(value.attemptedAt) ||
    !isOptionalPositiveInteger(value.durationSeconds) ||
    !isOptionalString(value.answerNote) ||
    !isNonNegativeInteger(value.createdAt)
  ) {
    throw new Error("QUESTION_ATTEMPT_INVALID");
  }
  return {
    id: value.id,
    questionId: value.questionId,
    result: value.result as AttemptResult,
    attemptedAt: value.attemptedAt,
    durationSeconds:
      typeof value.durationSeconds === "number"
        ? value.durationSeconds
        : undefined,
    answerNote: optionalString(value.answerNote),
    createdAt: value.createdAt,
  };
}

function parseQuestionKnowledgeLink(value: unknown): QuestionKnowledgeLink {
  if (
    !isRecord(value) ||
    typeof value.nodeId !== "string" ||
    typeof value.nodeTitle !== "string" ||
    typeof value.mapId !== "string" ||
    typeof value.mapTitle !== "string"
  ) {
    throw new Error("QUESTION_KNOWLEDGE_LINK_INVALID");
  }
  return {
    nodeId: value.nodeId,
    nodeTitle: value.nodeTitle,
    mapId: value.mapId,
    mapTitle: value.mapTitle,
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

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isNormalized(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isOptionalConfidence(value: unknown): boolean {
  return value === undefined || value === null || isNormalized(value);
}

function isPositiveNormalized(value: unknown): value is number {
  return isNormalized(value) && value > 0;
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || value === null || isNonNegativeInteger(value);
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === undefined || value === null || isPositiveInteger(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
