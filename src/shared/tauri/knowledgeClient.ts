import { invoke } from "@tauri-apps/api/core";

import {
  normalizeResourceCommandError,
  type ResourceCommandError,
} from "./resourceClient";

export type MasteryState = "unknown" | "learning" | "weak" | "stable";

export interface KnowledgeMap {
  id: string;
  subjectId?: string;
  title: string;
  rootNodeId: string;
  currentRevision: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeNode {
  id: string;
  mapId: string;
  subjectId?: string;
  parentId?: string;
  title: string;
  noteMarkdown?: string;
  masteryState: MasteryState;
  importance: number;
  sortOrder: number;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeNodeResource {
  id: string;
  nodeId: string;
  documentId: string;
  documentTitle: string;
  pageStart?: number;
  pageEnd?: number;
  note?: string;
  createdAt: number;
}

export interface KnowledgeMapBundle {
  map: KnowledgeMap;
  nodes: KnowledgeNode[];
  resources: KnowledgeNodeResource[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface MindMapDraftNode {
  title: string;
  noteMarkdown?: string;
  children: MindMapDraftNode[];
}

export interface MindMapImportDraft {
  id: string;
  sourceResourceId: string;
  sourceFormat: "opml" | "freemind";
  title: string;
  tree: MindMapDraftNode;
  warnings: string[];
  nodeCount: number;
  state: "generated" | "accepted" | "rejected";
  acceptedMapId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateKnowledgeMapInput {
  title: string;
  subjectId?: string;
}

export interface UpdateKnowledgeMapInput {
  mapId: string;
  title: string;
  subjectId?: string;
}

export interface UpdateKnowledgeNodeInput {
  nodeId: string;
  title: string;
  noteMarkdown?: string;
  masteryState: MasteryState;
  importance: number;
  subjectId?: string;
}

export interface MoveKnowledgeNodeInput {
  nodeId: string;
  newParentId: string;
  position: number;
}

export interface AddKnowledgeNodeResourceInput {
  nodeId: string;
  documentId: string;
  pageStart?: number;
  pageEnd?: number;
  note?: string;
}

const MAX_DRAFT_NODES = 2_000;
const MAX_DRAFT_DEPTH = 32;
const MASTERY_STATES = new Set<MasteryState>([
  "unknown",
  "learning",
  "weak",
  "stable",
]);
const DRAFT_STATES = new Set<MindMapImportDraft["state"]>([
  "generated",
  "accepted",
  "rejected",
]);
const SOURCE_FORMATS = new Set<MindMapImportDraft["sourceFormat"]>([
  "opml",
  "freemind",
]);

const KNOWLEDGE_ERROR_COPY: Record<
  string,
  { message: string; action: string }
> = {
  KNOWLEDGE_MAP_NOT_FOUND: {
    message: "找不到这张思维导图。",
    action: "刷新导图列表后重新选择。",
  },
  KNOWLEDGE_NODE_NOT_FOUND: {
    message: "找不到这个知识节点。",
    action: "刷新导图后重新选择节点。",
  },
  KNOWLEDGE_INPUT_INVALID: {
    message: "导图内容不完整或格式无效。",
    action: "检查标题、掌握状态、重要度和科目后重试。",
  },
  KNOWLEDGE_ROOT_PROTECTED: {
    message: "根节点不能移动或删除。",
    action: "可以编辑根节点，或操作它下面的子节点。",
  },
  KNOWLEDGE_CYCLE_DETECTED: {
    message: "这次移动会形成循环层级。",
    action: "请选择当前节点子树之外的父节点。",
  },
  KNOWLEDGE_NODE_LIMIT_REACHED: {
    message: "这张导图已达到 2000 个节点的上限。",
    action: "拆分为多张导图后继续整理。",
  },
  KNOWLEDGE_RESOURCE_INVALID: {
    message: "节点关联的资料或页码范围无效。",
    action: "选择已导入资料，并检查 PDF 起止页码。",
  },
  MINDMAP_DRAFT_NOT_FOUND: {
    message: "找不到可处理的导入草案。",
    action: "刷新草案列表，或重新从源文件生成。",
  },
  MINDMAP_FORMAT_UNSUPPORTED: {
    message: "当前不能直接解析这种思维导图格式。",
    action: "XMind 请先导出为 OPML；也可以使用 FreeMind .mm。",
  },
  MINDMAP_SOURCE_INVALID: {
    message: "源文件结构无效或包含不安全声明。",
    action: "重新导出为标准 OPML 或 FreeMind .mm 后再试。",
  },
  MINDMAP_IMPORT_LIMIT_REACHED: {
    message: "导入内容超过节点数或层级安全上限。",
    action: "拆分到每张 2000 个节点、32 层以内后重试。",
  },
};

export async function listKnowledgeMaps(): Promise<KnowledgeMapBundle[]> {
  const value: unknown = await invoke("list_knowledge_maps");
  if (!Array.isArray(value)) {
    throw new Error("KNOWLEDGE_MAP_LIST_INVALID");
  }
  return value.map(parseKnowledgeMapBundle);
}

export async function createKnowledgeMap(
  request: CreateKnowledgeMapInput,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("create_knowledge_map", { request }),
  );
}

export async function updateKnowledgeMap(
  request: UpdateKnowledgeMapInput,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("update_knowledge_map", { request }),
  );
}

export async function duplicateKnowledgeMap(
  mapId: string,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("duplicate_knowledge_map", { mapId }),
  );
}

export async function trashKnowledgeMap(mapId: string): Promise<void> {
  await invoke("trash_knowledge_map", { mapId });
}

export async function createKnowledgeNode(
  mapId: string,
  parentId: string,
  title: string,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("create_knowledge_node", { mapId, parentId, title }),
  );
}

export async function updateKnowledgeNode(
  request: UpdateKnowledgeNodeInput,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("update_knowledge_node", { request }),
  );
}

export async function moveKnowledgeNode(
  request: MoveKnowledgeNodeInput,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("move_knowledge_node", { request }),
  );
}

export async function deleteKnowledgeSubtree(
  nodeId: string,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("delete_knowledge_subtree", { nodeId }),
  );
}

export async function setKnowledgeNodeCollapsed(
  nodeId: string,
  collapsed: boolean,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("set_knowledge_node_collapsed", { nodeId, collapsed }),
  );
}

export async function addKnowledgeNodeResource(
  request: AddKnowledgeNodeResourceInput,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("add_knowledge_node_resource", { request }),
  );
}

export async function deleteKnowledgeNodeResource(
  resourceId: string,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("delete_knowledge_node_resource", { resourceId }),
  );
}

export async function undoKnowledgeMap(
  mapId: string,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(await invoke("undo_knowledge_map", { mapId }));
}

export async function redoKnowledgeMap(
  mapId: string,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(await invoke("redo_knowledge_map", { mapId }));
}

export async function listMindMapImportDrafts(): Promise<MindMapImportDraft[]> {
  const value: unknown = await invoke("list_mindmap_import_drafts");
  if (!Array.isArray(value)) {
    throw new Error("MINDMAP_DRAFT_LIST_INVALID");
  }
  return value.map(parseMindMapImportDraft);
}

export async function createMindMapImportDraft(
  documentId: string,
): Promise<MindMapImportDraft> {
  return parseMindMapImportDraft(
    await invoke("create_mindmap_import_draft", { documentId }),
  );
}

export async function acceptMindMapImportDraft(
  draftId: string,
): Promise<KnowledgeMapBundle> {
  return parseKnowledgeMapBundle(
    await invoke("accept_mindmap_import_draft", { draftId }),
  );
}

export async function rejectMindMapImportDraft(
  draftId: string,
): Promise<MindMapImportDraft> {
  return parseMindMapImportDraft(
    await invoke("reject_mindmap_import_draft", { draftId }),
  );
}

export function normalizeKnowledgeError(error: unknown): ResourceCommandError {
  if (isRecord(error) && typeof error.code === "string") {
    const copy = KNOWLEDGE_ERROR_COPY[error.code];
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

export function parseKnowledgeMapBundle(value: unknown): KnowledgeMapBundle {
  if (
    !isRecord(value) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.resources) ||
    typeof value.canUndo !== "boolean" ||
    typeof value.canRedo !== "boolean"
  ) {
    throw new Error("KNOWLEDGE_MAP_BUNDLE_INVALID");
  }
  return {
    map: parseKnowledgeMap(value.map),
    nodes: value.nodes.map(parseKnowledgeNode),
    resources: value.resources.map(parseKnowledgeNodeResource),
    canUndo: value.canUndo,
    canRedo: value.canRedo,
  };
}

export function parseMindMapImportDraft(value: unknown): MindMapImportDraft {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sourceResourceId !== "string" ||
    !SOURCE_FORMATS.has(
      value.sourceFormat as MindMapImportDraft["sourceFormat"],
    ) ||
    typeof value.title !== "string" ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning) => typeof warning === "string") ||
    !isPositiveInteger(value.nodeCount) ||
    value.nodeCount > MAX_DRAFT_NODES ||
    !DRAFT_STATES.has(value.state as MindMapImportDraft["state"]) ||
    !isOptionalString(value.acceptedMapId) ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("MINDMAP_DRAFT_INVALID");
  }
  const budget = { count: 0 };
  const tree = parseMindMapDraftNode(value.tree, 1, budget);
  if (budget.count !== value.nodeCount) {
    throw new Error("MINDMAP_DRAFT_INVALID");
  }
  return {
    id: value.id,
    sourceResourceId: value.sourceResourceId,
    sourceFormat: value.sourceFormat as MindMapImportDraft["sourceFormat"],
    title: value.title,
    tree,
    warnings: [...value.warnings],
    nodeCount: value.nodeCount,
    state: value.state as MindMapImportDraft["state"],
    acceptedMapId: optionalString(value.acceptedMapId),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseKnowledgeMap(value: unknown): KnowledgeMap {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isOptionalString(value.subjectId) ||
    typeof value.title !== "string" ||
    typeof value.rootNodeId !== "string" ||
    !isPositiveInteger(value.currentRevision) ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("KNOWLEDGE_MAP_INVALID");
  }
  return {
    id: value.id,
    subjectId: optionalString(value.subjectId),
    title: value.title,
    rootNodeId: value.rootNodeId,
    currentRevision: value.currentRevision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseKnowledgeNode(value: unknown): KnowledgeNode {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.mapId !== "string" ||
    !isOptionalString(value.subjectId) ||
    !isOptionalString(value.parentId) ||
    typeof value.title !== "string" ||
    !isOptionalString(value.noteMarkdown) ||
    !MASTERY_STATES.has(value.masteryState as MasteryState) ||
    !isPositiveInteger(value.importance) ||
    value.importance > 5 ||
    !isNonNegativeInteger(value.sortOrder) ||
    typeof value.collapsed !== "boolean" ||
    !isNonNegativeInteger(value.createdAt) ||
    !isNonNegativeInteger(value.updatedAt)
  ) {
    throw new Error("KNOWLEDGE_NODE_INVALID");
  }
  return {
    id: value.id,
    mapId: value.mapId,
    subjectId: optionalString(value.subjectId),
    parentId: optionalString(value.parentId),
    title: value.title,
    noteMarkdown: optionalString(value.noteMarkdown),
    masteryState: value.masteryState as MasteryState,
    importance: value.importance,
    sortOrder: value.sortOrder,
    collapsed: value.collapsed,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function parseKnowledgeNodeResource(value: unknown): KnowledgeNodeResource {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.nodeId !== "string" ||
    typeof value.documentId !== "string" ||
    typeof value.documentTitle !== "string" ||
    !isOptionalPositiveInteger(value.pageStart) ||
    !isOptionalPositiveInteger(value.pageEnd) ||
    (typeof value.pageStart === "number") !==
      (typeof value.pageEnd === "number") ||
    (typeof value.pageStart === "number" &&
      typeof value.pageEnd === "number" &&
      value.pageEnd < value.pageStart) ||
    !isOptionalString(value.note) ||
    !isNonNegativeInteger(value.createdAt)
  ) {
    throw new Error("KNOWLEDGE_NODE_RESOURCE_INVALID");
  }
  return {
    id: value.id,
    nodeId: value.nodeId,
    documentId: value.documentId,
    documentTitle: value.documentTitle,
    pageStart:
      typeof value.pageStart === "number" ? value.pageStart : undefined,
    pageEnd: typeof value.pageEnd === "number" ? value.pageEnd : undefined,
    note: optionalString(value.note),
    createdAt: value.createdAt,
  };
}

function parseMindMapDraftNode(
  value: unknown,
  depth: number,
  budget: { count: number },
): MindMapDraftNode {
  if (
    depth > MAX_DRAFT_DEPTH ||
    budget.count >= MAX_DRAFT_NODES ||
    !isRecord(value) ||
    typeof value.title !== "string" ||
    !isOptionalString(value.noteMarkdown) ||
    !Array.isArray(value.children)
  ) {
    throw new Error("MINDMAP_DRAFT_TREE_INVALID");
  }
  budget.count += 1;
  return {
    title: value.title,
    noteMarkdown: optionalString(value.noteMarkdown),
    children: value.children.map((child) =>
      parseMindMapDraftNode(child, depth + 1, budget),
    ),
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
  return value === undefined || value === null || isPositiveInteger(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
