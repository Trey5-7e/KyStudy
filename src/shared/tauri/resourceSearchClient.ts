import { invoke } from "@tauri-apps/api/core";

export type ResourceIndexState =
  "not_indexed" | "running" | "interrupted" | "failed" | "ready" | "empty";

export interface ResourceIndexStatus {
  documentId: string;
  state: ResourceIndexState;
  totalPages?: number;
  indexedPages: number;
  textPages: number;
  chunkCount: number;
  updatedAt?: number;
}

export interface ResourceIndexSession {
  status: ResourceIndexStatus;
  nextPage: number;
  needsIndexing: boolean;
}

export interface ResourceSearchResult {
  documentId: string;
  documentTitle: string;
  documentKind: "pdf" | "image" | "document" | "mindmap_source";
  pageNumber?: number;
  excerpt: string;
  matchKind: "title" | "page_text";
}

export interface ResourceSearchCommandError {
  code: string;
  message: string;
  action: string;
  operationId?: string;
}

const INDEX_STATES = new Set<ResourceIndexState>([
  "not_indexed",
  "running",
  "interrupted",
  "failed",
  "ready",
  "empty",
]);
const RESOURCE_KINDS = new Set<ResourceSearchResult["documentKind"]>([
  "pdf",
  "image",
  "document",
  "mindmap_source",
]);
const MATCH_KINDS = new Set<ResourceSearchResult["matchKind"]>([
  "title",
  "page_text",
]);

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  WORKSPACE_NOT_INITIALIZED: {
    message: "尚未创建本地工作区。",
    action: "先创建工作区，再建立资料索引。",
  },
  RESOURCE_NOT_FOUND: {
    message: "找不到需要索引的本地资料。",
    action: "刷新资料列表后重新选择。",
  },
  RESOURCE_INDEX_UNSUPPORTED: {
    message: "这份资料暂时不能建立文字索引。",
    action: "当前只支持 PDF 文字层；扫描页需要等待 OCR 版本。",
  },
  RESOURCE_INDEX_INPUT_INVALID: {
    message: "索引页码、页面文字或搜索条件无效。",
    action: "重新打开 PDF 后再试，搜索词请控制在 100 个字符以内。",
  },
  RESOURCE_INDEX_NOT_RUNNING: {
    message: "这份资料当前没有正在执行的索引任务。",
    action: "刷新索引状态后选择继续或重新建立。",
  },
  RESOURCE_INDEX_INCOMPLETE: {
    message: "PDF 仍有页面尚未完成索引。",
    action: "继续处理剩余页面后再完成索引。",
  },
  RESOURCE_INDEX_EXTRACTION_FAILED: {
    message: "PDF 文字层提取失败。",
    action:
      "确认文件可以正常打开；加密、损坏或特殊排版 PDF 可暂时保留手动阅读。",
  },
  DATABASE_BUSY: {
    message: "本地数据库正在被占用。",
    action: "关闭其他 KyStudy 窗口后重试。",
  },
  DATABASE_ERROR: {
    message: "本地索引暂时无法读取。",
    action: "重新启动应用；原始 PDF 不会受到影响。",
  },
};

export async function listResourceIndexStatuses(): Promise<
  ResourceIndexStatus[]
> {
  const value: unknown = await invoke("list_resource_index_statuses");
  if (!Array.isArray(value)) {
    throw new Error("RESOURCE_INDEX_STATUS_LIST_INVALID");
  }
  return value.map(parseResourceIndexStatus);
}

export async function beginResourceIndex(request: {
  documentId: string;
  totalPages: number;
  force: boolean;
}): Promise<ResourceIndexSession> {
  return parseResourceIndexSession(
    await invoke("begin_resource_index", { request }),
  );
}

export async function storeResourcePageText(request: {
  documentId: string;
  pageNumber: number;
  totalPages: number;
  widthPoints: number;
  heightPoints: number;
  text: string;
}): Promise<ResourceIndexStatus> {
  return parseResourceIndexStatus(
    await invoke("store_resource_page_text", { request }),
  );
}

export async function completeResourceIndex(
  documentId: string,
): Promise<ResourceIndexStatus> {
  return parseResourceIndexStatus(
    await invoke("complete_resource_index", { documentId }),
  );
}

export async function interruptResourceIndex(
  documentId: string,
): Promise<ResourceIndexStatus> {
  return parseResourceIndexStatus(
    await invoke("interrupt_resource_index", { documentId }),
  );
}

export async function failResourceIndex(
  documentId: string,
): Promise<ResourceIndexStatus> {
  return parseResourceIndexStatus(
    await invoke("fail_resource_index", { documentId }),
  );
}

export async function clearResourceIndex(
  documentId: string,
): Promise<ResourceIndexStatus> {
  return parseResourceIndexStatus(
    await invoke("clear_resource_index", { documentId }),
  );
}

export async function searchResources(
  query: string,
  limit = 30,
): Promise<ResourceSearchResult[]> {
  const value: unknown = await invoke("search_resources", {
    request: { query, limit },
  });
  if (!Array.isArray(value)) {
    throw new Error("RESOURCE_SEARCH_RESULTS_INVALID");
  }
  return value.map(parseResourceSearchResult);
}

export function parseResourceIndexStatus(value: unknown): ResourceIndexStatus {
  if (
    !isRecord(value) ||
    typeof value.documentId !== "string" ||
    !INDEX_STATES.has(value.state as ResourceIndexState) ||
    !isOptionalPositiveInteger(value.totalPages) ||
    !isNonNegativeInteger(value.indexedPages) ||
    !isNonNegativeInteger(value.textPages) ||
    !isNonNegativeInteger(value.chunkCount) ||
    !isOptionalNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("RESOURCE_INDEX_STATUS_INVALID");
  }
  const totalPages =
    typeof value.totalPages === "number" ? value.totalPages : undefined;
  if (
    value.textPages > value.indexedPages ||
    (totalPages !== undefined && value.indexedPages > totalPages) ||
    ((value.state === "ready" || value.state === "empty") &&
      (totalPages === undefined || value.indexedPages !== totalPages)) ||
    (value.state === "ready" && value.chunkCount === 0) ||
    (value.state === "empty" &&
      (value.textPages !== 0 || value.chunkCount !== 0))
  ) {
    throw new Error("RESOURCE_INDEX_STATUS_INVALID");
  }
  return {
    documentId: value.documentId,
    state: value.state as ResourceIndexState,
    totalPages,
    indexedPages: value.indexedPages,
    textPages: value.textPages,
    chunkCount: value.chunkCount,
    updatedAt:
      typeof value.updatedAt === "number" ? value.updatedAt : undefined,
  };
}

export function parseResourceIndexSession(
  value: unknown,
): ResourceIndexSession {
  if (
    !isRecord(value) ||
    !isPositiveInteger(value.nextPage) ||
    typeof value.needsIndexing !== "boolean"
  ) {
    throw new Error("RESOURCE_INDEX_SESSION_INVALID");
  }
  const status = parseResourceIndexStatus(value.status);
  if (
    status.totalPages === undefined ||
    value.nextPage > status.totalPages + 1 ||
    (!value.needsIndexing &&
      status.state !== "ready" &&
      status.state !== "empty")
  ) {
    throw new Error("RESOURCE_INDEX_SESSION_INVALID");
  }
  return {
    status,
    nextPage: value.nextPage,
    needsIndexing: value.needsIndexing,
  };
}

export function parseResourceSearchResult(
  value: unknown,
): ResourceSearchResult {
  if (
    !isRecord(value) ||
    typeof value.documentId !== "string" ||
    typeof value.documentTitle !== "string" ||
    !RESOURCE_KINDS.has(
      value.documentKind as ResourceSearchResult["documentKind"],
    ) ||
    !isOptionalPositiveInteger(value.pageNumber) ||
    typeof value.excerpt !== "string" ||
    value.excerpt.length > 1_000 ||
    !MATCH_KINDS.has(value.matchKind as ResourceSearchResult["matchKind"])
  ) {
    throw new Error("RESOURCE_SEARCH_RESULT_INVALID");
  }
  const pageNumber =
    typeof value.pageNumber === "number" ? value.pageNumber : undefined;
  if (value.matchKind === "page_text" && pageNumber === undefined) {
    throw new Error("RESOURCE_SEARCH_RESULT_INVALID");
  }
  return {
    documentId: value.documentId,
    documentTitle: value.documentTitle,
    documentKind: value.documentKind as ResourceSearchResult["documentKind"],
    pageNumber,
    excerpt: value.excerpt,
    matchKind: value.matchKind as ResourceSearchResult["matchKind"],
  };
}

export function normalizeResourceSearchError(
  error: unknown,
): ResourceSearchCommandError {
  const code =
    isRecord(error) && typeof error.code === "string"
      ? error.code
      : error instanceof Error &&
          error.message === "RESOURCE_INDEX_EXTRACTION_FAILED"
        ? error.message
        : undefined;
  if (code !== undefined) {
    const copy = ERROR_COPY[code];
    if (copy !== undefined) {
      return {
        code,
        ...copy,
        operationId:
          isRecord(error) && typeof error.operationId === "string"
            ? error.operationId
            : undefined,
      };
    }
  }
  return {
    code: "RESOURCE_SEARCH_UNAVAILABLE",
    message: "本地资料搜索暂时无法使用。",
    action: "重新启动应用后重试；原始资料不会受到影响。",
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

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === null || value === undefined || isPositiveInteger(value);
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === null || value === undefined || isNonNegativeInteger(value);
}
