import type { KnowledgeNode } from "../../shared/tauri/knowledgeClient";

const ROOT_KEY = "__root__";

export interface KnowledgeTreeIndex {
  nodeById: Map<string, KnowledgeNode>;
  childrenByParent: Map<string, KnowledgeNode[]>;
}

export function buildKnowledgeTreeIndex(
  nodes: KnowledgeNode[],
): KnowledgeTreeIndex {
  const nodeById = new Map<string, KnowledgeNode>();
  const childrenByParent = new Map<string, KnowledgeNode[]>();

  for (const node of nodes) {
    nodeById.set(node.id, node);
    const parentKey = node.parentId ?? ROOT_KEY;
    const siblings = childrenByParent.get(parentKey);
    if (siblings === undefined) {
      childrenByParent.set(parentKey, [node]);
    } else {
      siblings.push(node);
    }
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    );
  }

  return { nodeById, childrenByParent };
}

export function childrenOf(
  index: KnowledgeTreeIndex,
  parentId: string,
): KnowledgeNode[] {
  return index.childrenByParent.get(parentId) ?? [];
}

export function rootNodes(index: KnowledgeTreeIndex): KnowledgeNode[] {
  return index.childrenByParent.get(ROOT_KEY) ?? [];
}

export function collectDescendantIds(
  index: KnowledgeTreeIndex,
  nodeId: string,
): Set<string> {
  const descendants = new Set<string>();
  const pending = [...childrenOf(index, nodeId)];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || descendants.has(current.id)) {
      continue;
    }
    descendants.add(current.id);
    pending.push(...childrenOf(index, current.id));
  }
  return descendants;
}
