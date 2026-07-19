import { describe, expect, it } from "vitest";

import {
  parseKnowledgeMapBundle,
  parseMindMapImportDraft,
} from "./knowledgeClient";

const VALID_BUNDLE = {
  map: {
    id: "019f7328-4b66-7613-9729-e3570fc41525",
    subjectId: null,
    title: "408 数据结构",
    rootNodeId: "019f7328-4b66-7613-9729-e3570fc41526",
    currentRevision: 2,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_001,
    workspacePath: "C:/private/workspace",
  },
  nodes: [
    {
      id: "019f7328-4b66-7613-9729-e3570fc41526",
      mapId: "019f7328-4b66-7613-9729-e3570fc41525",
      subjectId: null,
      parentId: null,
      title: "数据结构",
      noteMarkdown: null,
      masteryState: "learning",
      importance: 5,
      sortOrder: 0,
      collapsed: false,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_001,
      snapshotJson: '{"private":true}',
    },
  ],
  resources: [
    {
      id: "019f7328-4b66-7613-9729-e3570fc41527",
      nodeId: "019f7328-4b66-7613-9729-e3570fc41526",
      documentId: "019f7328-4b66-7613-9729-e3570fc41528",
      documentTitle: "王道数据结构",
      pageStart: 10,
      pageEnd: 12,
      note: "线性表错题",
      createdAt: 1_700_000_000_001,
      storageKey: "blobs/private.pdf",
    },
  ],
  canUndo: true,
  canRedo: false,
};

describe("parseKnowledgeMapBundle", () => {
  it("returns the typed formal map without internal fields", () => {
    const parsed = parseKnowledgeMapBundle(VALID_BUNDLE);
    const serialized = JSON.stringify(parsed);

    expect(parsed.nodes[0]?.masteryState).toBe("learning");
    expect(parsed.resources[0]?.pageEnd).toBe(12);
    expect(serialized).not.toContain("workspacePath");
    expect(serialized).not.toContain("snapshotJson");
    expect(serialized).not.toContain("storageKey");
  });

  it("rejects an invalid importance and reversed page range", () => {
    expect(() =>
      parseKnowledgeMapBundle({
        ...VALID_BUNDLE,
        nodes: [{ ...VALID_BUNDLE.nodes[0], importance: 6 }],
      }),
    ).toThrowError("KNOWLEDGE_NODE_INVALID");
    expect(() =>
      parseKnowledgeMapBundle({
        ...VALID_BUNDLE,
        resources: [
          { ...VALID_BUNDLE.resources[0], pageStart: 12, pageEnd: 10 },
        ],
      }),
    ).toThrowError("KNOWLEDGE_NODE_RESOURCE_INVALID");
  });
});

describe("parseMindMapImportDraft", () => {
  it("accepts a bounded typed preview tree", () => {
    const parsed = parseMindMapImportDraft({
      id: "draft-id",
      sourceResourceId: "source-id",
      sourceFormat: "opml",
      title: "408 大纲",
      tree: {
        title: "408",
        noteMarkdown: null,
        children: [{ title: "数据结构", noteMarkdown: null, children: [] }],
      },
      warnings: [],
      nodeCount: 2,
      state: "generated",
      acceptedMapId: null,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(parsed.tree.children[0]?.title).toBe("数据结构");
  });

  it("rejects a dishonest node count", () => {
    expect(() =>
      parseMindMapImportDraft({
        id: "draft-id",
        sourceResourceId: "source-id",
        sourceFormat: "freemind",
        title: "网络",
        tree: { title: "网络", children: [] },
        warnings: [],
        nodeCount: 2,
        state: "generated",
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toThrowError("MINDMAP_DRAFT_INVALID");
  });
});
