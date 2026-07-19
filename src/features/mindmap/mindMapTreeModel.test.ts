import { describe, expect, it } from "vitest";

import type { KnowledgeNode } from "../../shared/tauri/knowledgeClient";
import {
  buildKnowledgeTreeIndex,
  childrenOf,
  collectDescendantIds,
} from "./mindMapTreeModel";

describe("buildKnowledgeTreeIndex", () => {
  it.each([500, 1_000])(
    "indexes and orders %i nodes without repeated scans",
    (nodeCount) => {
      const nodes = makeWideTree(nodeCount);
      const index = buildKnowledgeTreeIndex(nodes);

      expect(index.nodeById.size).toBe(nodeCount);
      expect(childrenOf(index, "node-0")).toHaveLength(nodeCount - 1);
      expect(childrenOf(index, "node-0")[0]?.id).toBe(`node-${nodeCount - 1}`);
      expect(collectDescendantIds(index, "node-0").size).toBe(nodeCount - 1);
    },
  );
});

function makeWideTree(nodeCount: number): KnowledgeNode[] {
  return Array.from({ length: nodeCount }, (_, index) => ({
    id: `node-${index}`,
    mapId: "map-id",
    parentId: index === 0 ? undefined : "node-0",
    title: `节点 ${index}`,
    masteryState: "unknown",
    importance: 3,
    sortOrder: index === 0 ? 0 : nodeCount - index,
    collapsed: false,
    createdAt: index,
    updatedAt: index,
  }));
}
