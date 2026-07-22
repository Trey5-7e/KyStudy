import { invoke } from "@tauri-apps/api/core";

import { normalizeQuestionError, type QuestionRegion } from "./questionClient";
import type { ResourceCommandError } from "./resourceClient";

export type OcrComponentState = "missing" | "incomplete" | "available";
export type OcrRecognitionState = "draft" | "confirmed" | "superseded";

export interface OcrComponentStatus {
  state: OcrComponentState;
  engine: string;
  modelsBundled: boolean;
  componentSizeBytes?: number;
}

export interface OcrTextLine {
  id: string;
  recognitionId: string;
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sortOrder: number;
}

export interface OcrRecognition {
  id: string;
  questionId: string;
  regionId: string;
  pageNumber: number;
  engine: string;
  recognizedText: string;
  confirmedText?: string;
  meanConfidence: number;
  state: OcrRecognitionState;
  lines: OcrTextLine[];
  createdAt: number;
  updatedAt: number;
}

const COMPONENT_STATES = new Set<OcrComponentState>([
  "missing",
  "incomplete",
  "available",
]);
const RECOGNITION_STATES = new Set<OcrRecognitionState>([
  "draft",
  "confirmed",
  "superseded",
]);

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  OCR_REGION_NOT_FOUND: {
    message: "找不到可识别的题目区域。",
    action: "刷新习题册，并确认这个来源区域仍然存在。",
  },
  OCR_QUESTION_NOT_FOUND: {
    message: "找不到这道题目。",
    action: "刷新习题册后重新选择题目。",
  },
  OCR_RECOGNITION_NOT_FOUND: {
    message: "找不到这份 OCR 草稿。",
    action: "刷新识别结果，或重新识别当前区域。",
  },
  OCR_RECOGNITION_NOT_DRAFT: {
    message: "这份 OCR 结果已经确认或失效。",
    action: "刷新识别结果后再处理当前草稿。",
  },
  OCR_INPUT_INVALID: {
    message: "OCR 图片或确认文本无效。",
    action: "重新打开来源区域并识别，确认文本不能留空。",
  },
  OCR_COMPONENT_MISSING: {
    message: "本地 OCR 组件尚未安装。",
    action: "安装可选 OCR 组件后重新检测。PDF 阅读和手动框选仍可使用。",
  },
  OCR_COMPONENT_INCOMPLETE: {
    message: "本地 OCR 组件文件不完整。",
    action: "重新安装匹配当前版本的 OCR 组件。",
  },
  OCR_COMPONENT_INCOMPATIBLE: {
    message: "本地 OCR 组件版本不兼容。",
    action: "安装与当前 KyStudy 匹配的 OCR 组件后重试。",
  },
  OCR_CANCELED: {
    message: "OCR 已取消。",
    action: "原题目区域和已确认文本没有改变。",
  },
  OCR_TIMEOUT: {
    message: "本地 OCR 处理超时。",
    action: "缩小来源区域后重试。",
  },
  OCR_WORKER_FAILED: {
    message: "本地 OCR 组件未能完成识别。",
    action: "重新检测组件或缩小来源区域后重试。",
  },
  OCR_RESULT_INVALID: {
    message: "本地 OCR 没有返回可用结果。",
    action: "保留原图并重新识别，或直接人工录入。",
  },
  OCR_OPERATION_CONFLICT: {
    message: "已有 OCR 操作仍在运行。",
    action: "等待当前操作结束，或先取消再重试。",
  },
};

export async function getOcrStatus(): Promise<OcrComponentStatus> {
  return parseOcrComponentStatus(await invoke("get_ocr_status"));
}

export async function listQuestionOcr(
  questionId: string,
): Promise<OcrRecognition[]> {
  const value: unknown = await invoke("list_question_ocr", { questionId });
  if (!Array.isArray(value)) {
    throw new Error("OCR_RECOGNITION_LIST_INVALID");
  }
  return value.map(parseOcrRecognition);
}

export async function recognizeQuestionRegion(
  operationId: string,
  region: Pick<QuestionRegion, "id">,
  imageBytes: Uint8Array,
): Promise<OcrRecognition> {
  return parseOcrRecognition(
    await invoke("recognize_question_region", {
      request: {
        operationId,
        regionId: region.id,
        imageBytes: Array.from(imageBytes),
      },
    }),
  );
}

export async function cancelOcr(operationId: string): Promise<boolean> {
  const value: unknown = await invoke("cancel_ocr", { operationId });
  if (typeof value !== "boolean") {
    throw new Error("OCR_CANCEL_RESULT_INVALID");
  }
  return value;
}

export async function confirmQuestionRegionOcr(
  recognitionId: string,
  confirmedText: string,
): Promise<OcrRecognition> {
  return parseOcrRecognition(
    await invoke("confirm_question_region_ocr", {
      request: { recognitionId, confirmedText },
    }),
  );
}

export async function discardQuestionRegionOcr(
  recognitionId: string,
): Promise<void> {
  await invoke("discard_question_region_ocr", { recognitionId });
}

export function normalizeOcrError(error: unknown): ResourceCommandError {
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
  if (
    error instanceof Error &&
    [
      "PDF_READER_NOT_READY",
      "PDF_OCR_REGION_INVALID",
      "PDF_OCR_CAPTURE_FAILED",
    ].includes(error.message)
  ) {
    return {
      code: error.message,
      message: "暂时无法生成这个题目区域的识别图片。",
      action: "等待 PDF 页面加载完成后重试。",
    };
  }
  return normalizeQuestionError(error);
}

export function parseOcrComponentStatus(value: unknown): OcrComponentStatus {
  if (
    !isRecord(value) ||
    !COMPONENT_STATES.has(value.state as OcrComponentState) ||
    typeof value.engine !== "string" ||
    typeof value.modelsBundled !== "boolean" ||
    !isOptionalNonNegativeInteger(value.componentSizeBytes)
  ) {
    throw new Error("OCR_COMPONENT_STATUS_INVALID");
  }
  return {
    state: value.state as OcrComponentState,
    engine: value.engine,
    modelsBundled: value.modelsBundled,
    componentSizeBytes: optionalNumber(value.componentSizeBytes),
  };
}

export function parseOcrRecognition(value: unknown): OcrRecognition {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.questionId !== "string" ||
    typeof value.regionId !== "string" ||
    !isPositiveInteger(value.pageNumber) ||
    typeof value.engine !== "string" ||
    typeof value.recognizedText !== "string" ||
    !isOptionalString(value.confirmedText) ||
    !isConfidence(value.meanConfidence) ||
    !RECOGNITION_STATES.has(value.state as OcrRecognitionState) ||
    !Array.isArray(value.lines) ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("OCR_RECOGNITION_INVALID");
  }
  const state = value.state as OcrRecognitionState;
  const confirmedText = optionalString(value.confirmedText);
  if (
    (state === "draft" && confirmedText !== undefined) ||
    (state !== "draft" && confirmedText === undefined)
  ) {
    throw new Error("OCR_RECOGNITION_INVALID");
  }
  return {
    id: value.id,
    questionId: value.questionId,
    regionId: value.regionId,
    pageNumber: value.pageNumber,
    engine: value.engine,
    recognizedText: value.recognizedText,
    confirmedText,
    meanConfidence: value.meanConfidence,
    state,
    lines: value.lines.map(parseOcrTextLine),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseOcrTextLine(value: unknown): OcrTextLine {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.recognitionId !== "string" ||
    typeof value.text !== "string" ||
    !isConfidence(value.confidence) ||
    !isNormalized(value.x) ||
    !isNormalized(value.y) ||
    !isPositiveNormalized(value.width) ||
    !isPositiveNormalized(value.height) ||
    value.x + value.width > 1.000_001 ||
    value.y + value.height > 1.000_001 ||
    !isNonNegativeInteger(value.sortOrder)
  ) {
    throw new Error("OCR_TEXT_LINE_INVALID");
  }
  return {
    id: value.id,
    recognitionId: value.recognitionId,
    text: value.text,
    confidence: value.confidence,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    sortOrder: value.sortOrder,
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

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || value === null || isNonNegativeInteger(value);
}

function isConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isNormalized(value: unknown): value is number {
  return isConfidence(value);
}

function isPositiveNormalized(value: unknown): value is number {
  return isNormalized(value) && value > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
