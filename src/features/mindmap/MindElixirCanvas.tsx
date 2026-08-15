import { useEffect, useMemo, useRef, useState } from "react";
import type { MindElixirInstance, NodeObj } from "mind-elixir";
import "mind-elixir/style.css";

import type {
  KnowledgeMapBundle,
  KnowledgeNode,
} from "../../shared/tauri/knowledgeClient";
import { buildKnowledgeTreeIndex, childrenOf } from "./mindMapTreeModel";

interface MindElixirCanvasProps {
  bundle: KnowledgeMapBundle;
  selectedNodeId?: string;
  onSelect(nodeId: string): void;
}

export function MindElixirCanvas({
  bundle,
  selectedNodeId,
  onSelect,
}: MindElixirCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<MindElixirInstance | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const matches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized === "") {
      return [];
    }
    return bundle.nodes
      .filter((node) => node.title.toLocaleLowerCase().includes(normalized))
      .slice(0, 20);
  }, [bundle.nodes, query]);
  const selectedNode = bundle.nodes.find((node) => node.id === selectedNodeId);
  const parentNode =
    selectedNode?.parentId === undefined
      ? undefined
      : bundle.nodes.find((node) => node.id === selectedNode.parentId);

  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    setReady(false);
    void import("mind-elixir").then(({ default: MindElixir }) => {
      if (disposed) {
        return;
      }
      const instance = new MindElixir({
        el: host,
        direction: MindElixir.SIDE,
        editable: false,
        contextMenu: false,
        toolBar: true,
        keypress: true,
        compact: true,
        // Keep MindElixir's pointer and wheel listeners enabled. The reader
        // is intentionally read-only, so these gestures can be dedicated to
        // moving and zooming the preview without competing with node editing.
        overflowHidden: false,
        scaleMin: 0.35,
        scaleMax: 2.5,
        handleWheel: (event) => {
          event.preventDefault();
          const viewportHeight = host.clientHeight || window.innerHeight;
          const pixelDelta =
            event.deltaMode === WheelEvent.DOM_DELTA_LINE
              ? event.deltaY * 40
              : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                ? event.deltaY * viewportHeight
                : event.deltaY;
          const scaleDelta = Math.max(-0.2, Math.min(0.2, -pixelDelta / 500));
          if (scaleDelta !== 0) {
            instance.scale(instance.scaleVal + scaleDelta, {
              x: event.clientX,
              y: event.clientY,
            });
          }
        },
      });
      instance.init(toMindElixirData(bundle));
      instance.bus.addListener("selectNodes", (nodes) => {
        const selected = nodes.at(-1);
        if (
          selected !== undefined &&
          bundle.nodes.some((node) => node.id === selected.id)
        ) {
          onSelect(selected.id);
        }
      });
      instanceRef.current = instance;
      setReady(true);
      requestAnimationFrame(() => instance.scaleFit());
    });
    return () => {
      disposed = true;
      instanceRef.current?.destroy();
      instanceRef.current = undefined;
      host.replaceChildren();
    };
  }, [bundle, onSelect]);

  useEffect(() => {
    if (!ready || selectedNodeId === undefined) {
      return;
    }
    revealNode(instanceRef.current, selectedNodeId);
  }, [ready, selectedNodeId]);

  const selectMatch = (nodeId: string) => {
    onSelect(nodeId);
    revealNode(instanceRef.current, nodeId);
  };

  const returnToParent = () => {
    if (parentNode === undefined) {
      return;
    }
    onSelect(parentNode.id);
    revealNode(instanceRef.current, parentNode.id);
  };

  return (
    <section className="mind-elixir-reader" aria-label="思维导图阅读器">
      <div className="mind-elixir-search-shell">
        <div className="mind-elixir-search">
          <label>
            <span className="sr-only">搜索导图节点</span>
            <input
              type="search"
              name="mindmap-node-search"
              autoComplete="off"
              placeholder="搜索节点…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span>
            {query.trim() === ""
              ? `${bundle.nodes.length} 个节点`
              : `${matches.length} 个结果`}
          </span>
          <span className="mind-elixir-gesture-hint">
            拖动空白区域平移 · 滚轮缩放
          </span>
          {parentNode === undefined ? null : (
            <button
              type="button"
              className="secondary-button"
              onClick={returnToParent}
            >
              返回父节点
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => instanceRef.current?.scaleFit()}
          >
            适应窗口
          </button>
        </div>
        {query.trim() === "" ? null : (
          <div
            className="mind-elixir-results"
            role="listbox"
            aria-label="节点搜索结果"
          >
            {matches.length === 0 ? (
              <p>没有匹配节点。</p>
            ) : (
              matches.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  role="option"
                  aria-selected={node.id === selectedNodeId}
                  onClick={() => selectMatch(node.id)}
                >
                  {node.title}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div ref={hostRef} className="mind-elixir-host" />
      {ready ? null : (
        <p className="mind-elixir-loading">正在准备离线导图画布…</p>
      )}
    </section>
  );
}

export function toMindElixirData(bundle: KnowledgeMapBundle) {
  const index = buildKnowledgeTreeIndex(bundle.nodes);
  const root = index.nodeById.get(bundle.map.rootNodeId);
  if (root === undefined) {
    throw new Error("KNOWLEDGE_ROOT_MISSING");
  }
  return {
    nodeData: toNodeObject(root, index),
    direction: 2 as const,
    compact: true,
  };
}

function toNodeObject(
  node: KnowledgeNode,
  index: ReturnType<typeof buildKnowledgeTreeIndex>,
): NodeObj {
  const children = childrenOf(index, node.id);
  return {
    id: node.id,
    topic: node.title,
    expanded: !node.collapsed,
    note: node.noteMarkdown,
    tags:
      node.masteryState === "unknown"
        ? undefined
        : [masteryLabel(node.masteryState)],
    children:
      children.length === 0
        ? undefined
        : children.map((child) => toNodeObject(child, index)),
  };
}

function revealNode(instance: MindElixirInstance | undefined, nodeId: string) {
  if (instance === undefined) {
    return;
  }
  try {
    const topic = instance.findEle(nodeId);
    instance.selectNode(topic);
    instance.scrollIntoView(topic, true);
  } catch {
    // A collapsed branch is not rendered by MindElixir. Keep the full reader
    // usable instead of letting its lookup exception blank the application.
  }
}

function masteryLabel(value: KnowledgeNode["masteryState"]): string {
  return {
    unknown: "未评估",
    learning: "学习中",
    weak: "薄弱",
    stable: "稳定",
  }[value];
}
