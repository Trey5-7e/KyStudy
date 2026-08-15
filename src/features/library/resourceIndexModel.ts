import type { ResourceDocument } from "../../shared/tauri/resourceClient";
import type { ResourceIndexStatus } from "../../shared/tauri/resourceSearchClient";
import { formatResourceCount } from "./resourceListModel";

export interface ActiveResourceIndex {
  documentId: string;
  indexedPages: number;
  totalPages: number;
  canceling: boolean;
}

/** Replace one document's status without dropping statuses returned for other documents. */
export function replaceResourceIndexStatus(
  statuses: ResourceIndexStatus[],
  next: ResourceIndexStatus,
): ResourceIndexStatus[] {
  const found = statuses.some(
    (status) => status.documentId === next.documentId,
  );
  return found
    ? statuses.map((status) =>
        status.documentId === next.documentId ? next : status,
      )
    : [...statuses, next];
}

export function notIndexedResourceStatus(
  resource: ResourceDocument,
): ResourceIndexStatus {
  return {
    documentId: resource.id,
    state: "not_indexed",
    totalPages: resource.pageCount,
    indexedPages: 0,
    textPages: 0,
    chunkCount: 0,
  };
}

export function formatResourceIndexStatus(status: ResourceIndexStatus): string {
  const progress =
    status.totalPages === undefined
      ? ""
      : ` · ${formatResourceCount(status.indexedPages)}/${formatResourceCount(status.totalPages)} 页`;
  const detail =
    status.textPages === 0
      ? ""
      : ` · ${formatResourceCount(status.textPages)} 页有文字 · ${formatResourceCount(status.chunkCount)} 个片段`;
  return `${
    {
      not_indexed: "尚未索引",
      running: "正在索引",
      interrupted: "上次索引已中断",
      failed: "索引失败",
      ready: "可以搜索",
      empty: "未检测到文字层",
    }[status.state]
  }${progress}${detail}`;
}

export function isCanceledResourceIndexError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ResourceIndexCanceledError" ||
      error.message === "RESOURCE_INDEX_CANCELED")
  );
}
