import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import type { KnowledgeMapBundle } from "../../shared/tauri/knowledgeClient";
import { toMindElixirData } from "./MindElixirCanvas";

const CANVAS_SOURCE = readFileSync(
  new URL("./MindElixirCanvas.tsx", import.meta.url),
  "utf8",
);
const CANVAS_STYLE = readFileSync(
  new URL("./mindmap.css", import.meta.url),
  "utf8",
);

describe("toMindElixirData", () => {
  it("keeps ids, sibling order, collapse state and titles", () => {
    const bundle = {
      map: { id: "map", rootNodeId: "root" },
      nodes: [
        {
          id: "child-b",
          parentId: "root",
          sortOrder: 1,
          title: "B",
          collapsed: true,
          masteryState: "weak",
        },
        {
          id: "root",
          sortOrder: 0,
          title: "408",
          collapsed: false,
          masteryState: "unknown",
        },
        {
          id: "child-a",
          parentId: "root",
          sortOrder: 0,
          title: "A",
          collapsed: false,
          masteryState: "stable",
        },
      ],
    } as KnowledgeMapBundle;

    const result = toMindElixirData(bundle);

    expect(result.nodeData.id).toBe("root");
    expect(result.nodeData.children?.map((node) => node.id)).toEqual([
      "child-a",
      "child-b",
    ]);
    expect(result.nodeData.children?.[1]?.expanded).toBe(false);
    expect(result.nodeData.children?.[0]?.tags).toEqual(["稳定"]);
  });
});

describe("mind-map preview gestures", () => {
  it("keeps the read-only canvas gesture handlers enabled", () => {
    expect(CANVAS_SOURCE).toContain("editable: false");
    expect(CANVAS_SOURCE).toContain("overflowHidden: false");
    expect(CANVAS_SOURCE).toContain("handleWheel: (event)");
    expect(CANVAS_SOURCE).toContain("event.preventDefault()");
    expect(CANVAS_SOURCE).toContain(
      "instance.scale(instance.scaleVal + scaleDelta",
    );
    expect(CANVAS_SOURCE).toContain("拖动空白区域平移 · 滚轮缩放");
    expect(CANVAS_SOURCE).toContain("instance.scrollIntoView(topic, true)");
    expect(CANVAS_SOURCE).not.toContain("instance.focusNode(topic)");
    expect(CANVAS_SOURCE).toContain("返回父节点");
  });

  it("shows a grab cursor and reserves the host for pointer gestures", () => {
    expect(CANVAS_STYLE).toContain("cursor: grab");
    expect(CANVAS_STYLE).toContain("touch-action: none");
    expect(CANVAS_STYLE).toContain("cursor: grabbing");
  });

  it("keeps node search results above the transformed preview canvas", () => {
    expect(CANVAS_STYLE).toContain("--tool-card: var(--color-bg-surface)");
    expect(CANVAS_STYLE).toContain(
      "--tool-border: var(--color-border-default)",
    );
    expect(CANVAS_STYLE).toContain("isolation: isolate");
    expect(CANVAS_STYLE).toContain(".mind-elixir-search-shell");
    expect(CANVAS_STYLE).toContain(".mind-elixir-results");
    expect(CANVAS_STYLE).toContain("position: relative");
    expect(CANVAS_STYLE).toContain("width: calc(100% - 1.5rem)");
    expect(CANVAS_STYLE).toContain("margin: 0.5rem 0.75rem");
    expect(CANVAS_STYLE).toContain("z-index: 1");
    expect(CANVAS_STYLE).toContain("opacity: 1");
    expect(CANVAS_STYLE).toContain(".mind-elixir-host");
    expect(CANVAS_STYLE).toContain("z-index: 0");
  });
});
