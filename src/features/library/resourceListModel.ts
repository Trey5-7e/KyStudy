import type { ResourceDocument } from "../../shared/tauri/resourceClient";

export const ROLE_LABELS: Record<ResourceDocument["role"], string> = {
  planning: "规划资料",
  reference: "参考资料",
  workbook: "习题册",
  other: "未分类",
};

export const RESOURCE_KIND_LABELS: Record<ResourceDocument["kind"], string> = {
  pdf: "PDF",
  image: "图片",
  document: "文档",
  mindmap_source: "导图源文件",
};

export const RESOURCE_FILE_VIEWS = [
  { id: "browse", label: "浏览资料" },
  { id: "search", label: "全文搜索" },
] as const;

export type ResourceFileView = (typeof RESOURCE_FILE_VIEWS)[number]["id"];

export const RESOURCE_TABS = [
  { id: "files", label: "资料文件" },
  { id: "mindmaps", label: "思维导图" },
] as const;

export type ResourceTab = (typeof RESOURCE_TABS)[number]["id"];

const integerFormatter = new Intl.NumberFormat("zh-CN");
const decimalFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatResourceCount(value: number): string {
  return integerFormatter.format(value);
}

export function formatResourceBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${formatResourceCount(sizeBytes)} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${decimalFormatter.format(sizeBytes / 1024)} KiB`;
  }
  return `${decimalFormatter.format(sizeBytes / (1024 * 1024))} MiB`;
}

export function nextResourceTab(
  current: ResourceTab,
  key: string,
): ResourceTab | null {
  if (key === "Home") return "files";
  if (key === "End") return "mindmaps";
  if (key === "ArrowRight" || key === "ArrowLeft") {
    return current === "files" ? "mindmaps" : "files";
  }
  return null;
}

export function nextResourceFileView(
  current: ResourceFileView,
  key: string,
): ResourceFileView | null {
  if (key === "Home") return "browse";
  if (key === "End") return "search";
  if (
    key === "ArrowRight" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowUp"
  ) {
    return current === "browse" ? "search" : "browse";
  }
  return null;
}

export function canOpenResource(resource: ResourceDocument): boolean {
  return resource.kind === "pdf" || resource.kind === "image";
}

export function resourceProgressLabel(
  resource: Pick<ResourceDocument, "lastPage" | "pageCount">,
): string | null {
  if (resource.lastPage === undefined) {
    return null;
  }
  return resource.pageCount === undefined
    ? `读到第 ${formatResourceCount(resource.lastPage)} 页`
    : `读到第 ${formatResourceCount(resource.lastPage)}/${formatResourceCount(resource.pageCount)} 页`;
}
