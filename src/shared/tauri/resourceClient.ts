import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ResourceDocument {
  id: string;
  title: string;
  kind: "pdf" | "image" | "document" | "mindmap_source";
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  reusedExistingBlob: boolean;
  role: "planning" | "reference" | "workbook" | "other";
  pageCount?: number;
  lastPage?: number;
  lastOpenedAt?: number;
  createdAt: number;
}

export interface ResourceReaderDescriptor {
  documentId: string;
  title: string;
  kind: "pdf" | "image";
  mimeType: string;
  sizeBytes: number;
  pageCount?: number;
  lastPage?: number;
}

export interface ImportOperation {
  operationId: string;
}

export interface ResourceCommandError {
  code: string;
  message: string;
  action: string;
  operationId?: string;
}

export interface ImportEvent {
  operationId: string;
  state: "running" | "succeeded" | "failed" | "canceled";
  copiedBytes: number;
  totalBytes: number;
  resource?: ResourceDocument;
  error?: ResourceCommandError;
}

const IMPORT_EVENT_NAME = "kystudy-import-progress";

const ERROR_COPY: Record<string, { message: string; action: string }> = {
  WORKSPACE_NOT_INITIALIZED: {
    message: "尚未创建本地工作区。",
    action: "先创建本地工作区，再导入学习资料。",
  },
  SOURCE_NOT_FILE: {
    message: "所选内容不是可导入的本地文件。",
    action: "重新选择受支持的学习资料。",
  },
  SOURCE_NAME_INVALID: {
    message: "无法识别所选文件的名称。",
    action: "重命名文件后重新选择。",
  },
  SOURCE_INSIDE_WORKSPACE: {
    message: "不能再次导入 KyStudy 管理的内部文件。",
    action: "请从工作区外部选择原始资料。",
  },
  SOURCE_CHANGED: {
    message: "源文件在导入过程中发生了变化。",
    action: "等待下载或同步完成后重新导入。",
  },
  DISK_SPACE_INSUFFICIENT: {
    message: "磁盘剩余空间不足，无法安全导入。",
    action: "释放工作区所在磁盘的空间后重试。",
  },
  IMPORT_CANCELED: {
    message: "导入已取消。",
    action: "可以随时重新选择该资料。",
  },
  MANAGED_PATH_INVALID: {
    message: "资料库内部路径校验未通过。",
    action: "不要手动修改工作区文件；请保留数据并查看诊断信息。",
  },
  FILE_INTEGRITY_MISMATCH: {
    message: "资料完整性校验未通过。",
    action: "不要覆盖现有资料；请保留数据并查看诊断信息。",
  },
  FILE_OPERATION_FAILED: {
    message: "无法读取来源文件或写入本地资料库。",
    action: "检查文件占用、磁盘空间和目录权限后重试。",
  },
  RESOURCE_NOT_FOUND: {
    message: "找不到这份本地资料。",
    action: "刷新资料列表；如果问题持续存在，请检查工作区完整性。",
  },
  RESOURCE_READER_UNSUPPORTED: {
    message: "这种资料暂时不能在阅读器中打开。",
    action: "当前可直接阅读 PDF 和常见图片。",
  },
  RESOURCE_METADATA_INVALID: {
    message: "资料的分类或阅读进度无效。",
    action: "检查页码、总页数或资料用途后重试。",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseResourceDocument(value: unknown): ResourceDocument {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !["pdf", "image", "document", "mindmap_source"].includes(
      typeof value.kind === "string" ? value.kind : "",
    ) ||
    typeof value.mimeType !== "string" ||
    !isSafeNonNegativeInteger(value.sizeBytes) ||
    typeof value.sha256 !== "string" ||
    !/^[A-F0-9]{64}$/.test(value.sha256) ||
    typeof value.reusedExistingBlob !== "boolean" ||
    !["planning", "reference", "workbook", "other"].includes(
      typeof value.role === "string" ? value.role : "",
    ) ||
    !isOptionalPositiveInteger(value.pageCount) ||
    !isOptionalPositiveInteger(value.lastPage) ||
    !isOptionalNonNegativeInteger(value.lastOpenedAt) ||
    !isSafeNonNegativeInteger(value.createdAt)
  ) {
    throw new Error("RESOURCE_DOCUMENT_INVALID");
  }

  return {
    id: value.id,
    title: value.title,
    kind: value.kind as ResourceDocument["kind"],
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    sha256: value.sha256,
    reusedExistingBlob: value.reusedExistingBlob,
    role: value.role as ResourceDocument["role"],
    pageCount:
      typeof value.pageCount === "number" ? value.pageCount : undefined,
    lastPage: typeof value.lastPage === "number" ? value.lastPage : undefined,
    lastOpenedAt:
      typeof value.lastOpenedAt === "number" ? value.lastOpenedAt : undefined,
    createdAt: value.createdAt,
  };
}

function isOptionalPositiveInteger(value: unknown): boolean {
  return value === null || value === undefined || isPositiveInteger(value);
}

function isOptionalNonNegativeInteger(value: unknown): boolean {
  return (
    value === null || value === undefined || isSafeNonNegativeInteger(value)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return isSafeNonNegativeInteger(value) && value > 0;
}

export function parseResourceReaderDescriptor(
  value: unknown,
): ResourceReaderDescriptor {
  if (
    !isRecord(value) ||
    typeof value.documentId !== "string" ||
    typeof value.title !== "string" ||
    !["pdf", "image"].includes(
      typeof value.kind === "string" ? value.kind : "",
    ) ||
    typeof value.mimeType !== "string" ||
    !isSafeNonNegativeInteger(value.sizeBytes) ||
    !isOptionalPositiveInteger(value.pageCount) ||
    !isOptionalPositiveInteger(value.lastPage)
  ) {
    throw new Error("RESOURCE_READER_DESCRIPTOR_INVALID");
  }
  return {
    documentId: value.documentId,
    title: value.title,
    kind: value.kind as ResourceReaderDescriptor["kind"],
    mimeType: value.mimeType,
    sizeBytes: value.sizeBytes,
    pageCount:
      typeof value.pageCount === "number" ? value.pageCount : undefined,
    lastPage: typeof value.lastPage === "number" ? value.lastPage : undefined,
  };
}

export function parseImportEvent(value: unknown): ImportEvent {
  if (
    !isRecord(value) ||
    typeof value.operationId !== "string" ||
    !["running", "succeeded", "failed", "canceled"].includes(
      typeof value.state === "string" ? value.state : "",
    ) ||
    !isSafeNonNegativeInteger(value.copiedBytes) ||
    !isSafeNonNegativeInteger(value.totalBytes) ||
    value.copiedBytes > value.totalBytes
  ) {
    throw new Error("IMPORT_EVENT_INVALID");
  }

  const resource =
    value.resource === null || value.resource === undefined
      ? undefined
      : parseResourceDocument(value.resource);
  const error =
    value.error === null || value.error === undefined
      ? undefined
      : normalizeResourceCommandError(value.error);

  if (value.state === "succeeded" && resource === undefined) {
    throw new Error("IMPORT_EVENT_INVALID");
  }
  if (
    (value.state === "failed" || value.state === "canceled") &&
    error === undefined
  ) {
    throw new Error("IMPORT_EVENT_INVALID");
  }

  return {
    operationId: value.operationId,
    state: value.state as ImportEvent["state"],
    copiedBytes: value.copiedBytes,
    totalBytes: value.totalBytes,
    resource,
    error,
  };
}

export async function listResources(): Promise<ResourceDocument[]> {
  const value: unknown = await invoke("list_resources");
  if (!Array.isArray(value)) {
    throw new Error("RESOURCE_LIST_INVALID");
  }
  return value.map(parseResourceDocument);
}

export async function startResourceImport(): Promise<ImportOperation | null> {
  const value: unknown = await invoke("start_resource_import");
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || typeof value.operationId !== "string") {
    throw new Error("IMPORT_OPERATION_INVALID");
  }
  return { operationId: value.operationId };
}

export async function getResourceReaderDescriptor(
  documentId: string,
): Promise<ResourceReaderDescriptor> {
  const value: unknown = await invoke("get_resource_reader_descriptor", {
    documentId,
  });
  return parseResourceReaderDescriptor(value);
}

export async function updateResourceRole(
  documentId: string,
  role: ResourceDocument["role"],
): Promise<ResourceDocument> {
  const value: unknown = await invoke("update_resource_role", {
    documentId,
    role,
  });
  return parseResourceDocument(value);
}

export async function saveResourceReadingProgress(
  documentId: string,
  pageCount: number,
  lastPage: number,
): Promise<ResourceReaderDescriptor> {
  const value: unknown = await invoke("save_resource_reading_progress", {
    documentId,
    pageCount,
    lastPage,
  });
  return parseResourceReaderDescriptor(value);
}

const DOCUMENT_ID = /^[A-Fa-f0-9-]{36}$/;

export function buildResourceProtocolUrl(
  documentId: string,
  kind: "pdf" | "image",
): string {
  if (!DOCUMENT_ID.test(documentId)) {
    throw new Error("RESOURCE_DOCUMENT_ID_INVALID");
  }
  return convertFileSrc(
    documentId,
    kind === "pdf" ? "kystudy-pdf" : "kystudy-image",
  );
}

export async function cancelResourceImport(
  operationId: string,
): Promise<boolean> {
  const value: unknown = await invoke("cancel_resource_import", {
    operationId,
  });
  if (typeof value !== "boolean") {
    throw new Error("IMPORT_CANCEL_RESPONSE_INVALID");
  }
  return value;
}

export function listenToImportEvents(
  onEvent: (event: ImportEvent) => void,
): Promise<UnlistenFn> {
  return listen<unknown>(IMPORT_EVENT_NAME, (event) => {
    onEvent(parseImportEvent(event.payload));
  });
}

export function normalizeResourceCommandError(
  error: unknown,
): ResourceCommandError {
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

  return {
    code: "RESOURCE_UNAVAILABLE",
    message: "本地资料库暂时无法使用。",
    action: "重新启动应用后重试。",
  };
}
