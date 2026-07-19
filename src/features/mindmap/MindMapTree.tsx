import { useMemo, type DragEvent } from "react";

import type {
  KnowledgeMapBundle,
  KnowledgeNode,
} from "../../shared/tauri/knowledgeClient";
import {
  buildKnowledgeTreeIndex,
  childrenOf,
  collectDescendantIds,
  type KnowledgeTreeIndex,
} from "./mindMapTreeModel";

const DRAG_MIME = "application/x-kystudy-knowledge-node";

const MASTERY_LABELS: Record<KnowledgeNode["masteryState"], string> = {
  unknown: "未评估",
  learning: "学习中",
  weak: "薄弱",
  stable: "稳定",
};

interface MindMapTreeProps {
  bundle: KnowledgeMapBundle;
  selectedNodeId?: string;
  zoom: number;
  busy: boolean;
  onSelect(nodeId: string): void;
  onToggle(nodeId: string, collapsed: boolean): void;
  onAddChild(parentId: string): void;
  onMove(nodeId: string, parentId: string, position: number): void;
}

interface TreeNodeProps {
  node: KnowledgeNode;
  index: KnowledgeTreeIndex;
  rootNodeId: string;
  selectedNodeId?: string;
  busy: boolean;
  onSelect(nodeId: string): void;
  onToggle(nodeId: string, collapsed: boolean): void;
  onAddChild(parentId: string): void;
  onMove(nodeId: string, parentId: string, position: number): void;
}

export function MindMapTree({
  bundle,
  selectedNodeId,
  zoom,
  busy,
  onSelect,
  onToggle,
  onAddChild,
  onMove,
}: MindMapTreeProps) {
  const index = useMemo(
    () => buildKnowledgeTreeIndex(bundle.nodes),
    [bundle.nodes],
  );
  const root = index.nodeById.get(bundle.map.rootNodeId);

  if (root === undefined) {
    return <p className="mindmap-empty">导图根节点缺失，请先保留备份。</p>;
  }

  return (
    <div className="mindmap-canvas" aria-label="思维导图树形画布">
      <div
        className="mindmap-zoom-layer"
        style={{
          transform: `scale(${zoom})`,
          width: `${100 / zoom}%`,
        }}
      >
        <TreeNode
          node={root}
          index={index}
          rootNodeId={bundle.map.rootNodeId}
          selectedNodeId={selectedNodeId}
          busy={busy}
          onSelect={onSelect}
          onToggle={onToggle}
          onAddChild={onAddChild}
          onMove={onMove}
        />
      </div>
    </div>
  );
}

function TreeNode({
  node,
  index,
  rootNodeId,
  selectedNodeId,
  busy,
  onSelect,
  onToggle,
  onAddChild,
  onMove,
}: TreeNodeProps) {
  const children = childrenOf(index, node.id);
  const isRoot = node.id === rootNodeId;
  const siblings =
    node.parentId === undefined ? [] : childrenOf(index, node.parentId);
  const siblingIndex = siblings.findIndex((sibling) => sibling.id === node.id);

  const startDrag = (event: DragEvent<HTMLElement>) => {
    if (isRoot || busy) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DRAG_MIME, node.id);
  };

  const allowDrop = (event: DragEvent<HTMLElement>) => {
    const sourceId = event.dataTransfer.getData(DRAG_MIME);
    if (
      event.dataTransfer.types.includes(DRAG_MIME) &&
      (sourceId === "" ||
        (sourceId !== rootNodeId &&
          sourceId !== node.id &&
          !collectDescendantIds(index, sourceId).has(node.id)))
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  };

  const dropNode = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData(DRAG_MIME);
    if (
      sourceId === "" ||
      sourceId === rootNodeId ||
      sourceId === node.id ||
      collectDescendantIds(index, sourceId).has(node.id)
    ) {
      return;
    }
    onMove(sourceId, node.id, children.length);
  };

  return (
    <div className="mindmap-tree-branch">
      <article
        className={`mindmap-node-card${
          selectedNodeId === node.id ? " mindmap-node-selected" : ""
        }`}
        draggable={!isRoot && !busy}
        onDragStart={startDrag}
        onDragOver={allowDrop}
        onDrop={dropNode}
      >
        <div className="mindmap-node-heading">
          {children.length === 0 ? (
            <span className="mindmap-leaf-marker" aria-hidden="true">
              ·
            </span>
          ) : (
            <button
              type="button"
              className="mindmap-collapse-button"
              aria-label={node.collapsed ? "展开子节点" : "折叠子节点"}
              aria-expanded={!node.collapsed}
              disabled={busy}
              onClick={() => onToggle(node.id, !node.collapsed)}
            >
              {node.collapsed ? "+" : "−"}
            </button>
          )}
          <button
            type="button"
            className="mindmap-node-select"
            aria-pressed={selectedNodeId === node.id}
            onClick={() => onSelect(node.id)}
          >
            <strong>{node.title}</strong>
            <span>
              {MASTERY_LABELS[node.masteryState]} · 重要度 {node.importance}
            </span>
          </button>
        </div>
        <div className="mindmap-node-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => onAddChild(node.id)}
          >
            + 子节点
          </button>
          {isRoot ? null : (
            <>
              <button
                type="button"
                className="secondary-button"
                aria-label={`上移 ${node.title}`}
                disabled={
                  busy || siblingIndex <= 0 || node.parentId === undefined
                }
                onClick={() => {
                  if (node.parentId !== undefined) {
                    onMove(node.id, node.parentId, siblingIndex - 1);
                  }
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="secondary-button"
                aria-label={`下移 ${node.title}`}
                disabled={
                  busy ||
                  siblingIndex < 0 ||
                  siblingIndex >= siblings.length - 1 ||
                  node.parentId === undefined
                }
                onClick={() => {
                  if (node.parentId !== undefined) {
                    onMove(node.id, node.parentId, siblingIndex + 1);
                  }
                }}
              >
                ↓
              </button>
            </>
          )}
        </div>
      </article>

      {node.collapsed || children.length === 0 ? null : (
        <div className="mindmap-tree-children">
          {children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              index={index}
              rootNodeId={rootNodeId}
              selectedNodeId={selectedNodeId}
              busy={busy}
              onSelect={onSelect}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onMove={onMove}
            />
          ))}
        </div>
      )}
    </div>
  );
}
