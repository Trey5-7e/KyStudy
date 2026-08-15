import { useEffect, useState, type FormEvent } from "react";

import {
  acceptMindMapImportDraft,
  addKnowledgeNodeResource,
  createKnowledgeMap,
  createKnowledgeNode,
  createMindMapImportDraft,
  deleteKnowledgeNodeResource,
  deleteKnowledgeSubtree,
  duplicateKnowledgeMap,
  listKnowledgeMaps,
  listMindMapImportDrafts,
  moveKnowledgeNode,
  normalizeKnowledgeError,
  redoKnowledgeMap,
  rejectMindMapImportDraft,
  setKnowledgeNodeCollapsed,
  trashKnowledgeMap,
  undoKnowledgeMap,
  updateKnowledgeMap,
  updateKnowledgeNode,
  type AddKnowledgeNodeResourceInput,
  type KnowledgeMapBundle,
  type UpdateKnowledgeMapInput,
  type UpdateKnowledgeNodeInput,
  type MindMapImportDraft,
} from "../../shared/tauri/knowledgeClient";
import {
  listResources,
  type ResourceCommandError,
  type ResourceDocument,
} from "../../shared/tauri/resourceClient";
import {
  listSubjects,
  type StudySubject,
} from "../../shared/tauri/scheduleClient";
import { EditorDialog } from "../../shared/components/EditorDialog";
import { MindMapNodeEditor, MindMapSettings } from "./MindMapDetails";
import { MindElixirCanvas } from "./MindElixirCanvas";
import "./mindmap.css";
import { MindMapImportPanel } from "./MindMapImportPanel";
import {
  buildKnowledgeTreeIndex,
  childrenOf,
  collectDescendantIds,
} from "./mindMapTreeModel";

interface MindMapPanelProps {
  onOpenResource(documentId: string, page?: number): void;
}

type BundlePreference =
  string | ((bundle: KnowledgeMapBundle) => string | undefined);

export function MindMapPanel({ onOpenResource }: MindMapPanelProps) {
  const [maps, setMaps] = useState<KnowledgeMapBundle[]>([]);
  const [drafts, setDrafts] = useState<MindMapImportDraft[]>([]);
  const [resources, setResources] = useState<ResourceDocument[]>([]);
  const [subjects, setSubjects] = useState<StudySubject[]>([]);
  const [selectedMapId, setSelectedMapId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ResourceCommandError>();
  const [newMapTitle, setNewMapTitle] = useState("");
  const [newMapSubjectId, setNewMapSubjectId] = useState("");
  const [addParentId, setAddParentId] = useState<string>();
  const [newNodeTitle, setNewNodeTitle] = useState("");
  const [trashConfirmation, setTrashConfirmation] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);
  const [nodeEditorOpen, setNodeEditorOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [mapEditorDirty, setMapEditorDirty] = useState(false);
  const [nodeEditorDirty, setNodeEditorDirty] = useState(false);

  useEffect(() => {
    let active = true;
    void loadMindMapData().then(
      ([loadedMaps, loadedDrafts, loadedResources, loadedSubjects]) => {
        if (!active) {
          return;
        }
        setMaps(loadedMaps);
        setDrafts(loadedDrafts);
        setResources(loadedResources);
        setSubjects(
          loadedSubjects.filter((subject) => subject.archivedAt === undefined),
        );
        setSelectedMapId(loadedMaps[0]?.map.id);
        setSelectedNodeId(loadedMaps[0]?.map.rootNodeId);
        setLoading(false);
      },
      (loadError: unknown) => {
        if (active) {
          setError(normalizeKnowledgeError(loadError));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const selectedBundle =
    maps.find((bundle) => bundle.map.id === selectedMapId) ?? maps[0];
  const selectedNode =
    selectedBundle?.nodes.find((node) => node.id === selectedNodeId) ??
    selectedBundle?.nodes.find(
      (node) => node.id === selectedBundle.map.rootNodeId,
    );
  const selectedLinks =
    selectedNode === undefined || selectedBundle === undefined
      ? []
      : selectedBundle.resources.filter(
          (resource) => resource.nodeId === selectedNode.id,
        );
  const addParent = selectedBundle?.nodes.find(
    (node) => node.id === addParentId,
  );

  const applyBundle = (
    bundle: KnowledgeMapBundle,
    preference?: BundlePreference,
  ) => {
    setMaps((current) => [
      bundle,
      ...current.filter((item) => item.map.id !== bundle.map.id),
    ]);
    setSelectedMapId(bundle.map.id);
    const preferredId =
      typeof preference === "function" ? preference(bundle) : preference;
    setSelectedNodeId((current) => {
      if (
        preferredId !== undefined &&
        bundle.nodes.some((node) => node.id === preferredId)
      ) {
        return preferredId;
      }
      if (
        current !== undefined &&
        bundle.nodes.some((node) => node.id === current)
      ) {
        return current;
      }
      return bundle.map.rootNodeId;
    });
  };

  const runBundle = async (
    operation: () => Promise<KnowledgeMapBundle>,
    preference?: BundlePreference,
  ): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      applyBundle(await operation(), preference);
      return true;
    } catch (operationError: unknown) {
      setError(normalizeKnowledgeError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const refreshAll = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const [loadedMaps, loadedDrafts, loadedResources, loadedSubjects] =
        await loadMindMapData();
      setMaps(loadedMaps);
      setDrafts(loadedDrafts);
      setResources(loadedResources);
      setSubjects(
        loadedSubjects.filter((subject) => subject.archivedAt === undefined),
      );
      setSelectedMapId((current) =>
        loadedMaps.some((bundle) => bundle.map.id === current)
          ? current
          : loadedMaps[0]?.map.id,
      );
      setSelectedNodeId((current) =>
        loadedMaps.some((bundle) =>
          bundle.nodes.some((node) => node.id === current),
        )
          ? current
          : loadedMaps[0]?.map.rootNodeId,
      );
    } catch (refreshError: unknown) {
      setError(normalizeKnowledgeError(refreshError));
    } finally {
      setBusy(false);
    }
  };

  const submitMap = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await runBundle(
      () =>
        createKnowledgeMap({
          title: newMapTitle,
          subjectId: newMapSubjectId === "" ? undefined : newMapSubjectId,
        }),
      (bundle) => bundle.map.rootNodeId,
    );
    if (saved) {
      setNewMapTitle("");
      setCreateOpen(false);
    }
  };

  const submitNode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedBundle === undefined || addParent === undefined) {
      return;
    }
    const existingIds = new Set(selectedBundle.nodes.map((node) => node.id));
    const saved = await runBundle(
      () =>
        createKnowledgeNode(selectedBundle.map.id, addParent.id, newNodeTitle),
      (bundle) => bundle.nodes.find((node) => !existingIds.has(node.id))?.id,
    );
    if (saved) {
      setNewNodeTitle("");
      setAddParentId(undefined);
    }
  };

  const removeCurrentMap = async () => {
    if (selectedBundle === undefined) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await trashKnowledgeMap(selectedBundle.map.id);
      const refreshed = await listKnowledgeMaps();
      setMaps(refreshed);
      setSelectedMapId(refreshed[0]?.map.id);
      setSelectedNodeId(refreshed[0]?.map.rootNodeId);
      setTrashConfirmation(undefined);
    } catch (trashError: unknown) {
      setError(normalizeKnowledgeError(trashError));
    } finally {
      setBusy(false);
    }
  };

  const createDraft = async (documentId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const draft = await createMindMapImportDraft(documentId);
      setDrafts((current) => [
        draft,
        ...current.filter((item) => item.id !== draft.id),
      ]);
    } catch (draftError: unknown) {
      setError(normalizeKnowledgeError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const acceptDraft = async (draftId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const bundle = await acceptMindMapImportDraft(draftId);
      const refreshedDrafts = await listMindMapImportDrafts();
      applyBundle(bundle, bundle.map.rootNodeId);
      setDrafts(refreshedDrafts);
    } catch (draftError: unknown) {
      setError(normalizeKnowledgeError(draftError));
    } finally {
      setBusy(false);
    }
  };

  const rejectDraft = async (draftId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const rejected = await rejectMindMapImportDraft(draftId);
      setDrafts((current) =>
        current.map((draft) => (draft.id === rejected.id ? rejected : draft)),
      );
    } catch (draftError: unknown) {
      setError(normalizeKnowledgeError(draftError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mindmap-card" aria-labelledby="mindmap-title">
      <div className="mindmap-heading">
        <div>
          <p className="section-label">知识导图</p>
          <h2 id="mindmap-title">导入、浏览，需要时简单改一下</h2>
          <p>
            成熟画布负责阅读、搜索和折叠；KyStudy
            只保留基础节点修改与本地资料关联。
          </p>
        </div>
        <div className="mindmap-heading-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setImportOpen(true)}
          >
            导入导图
          </button>
          <button type="button" onClick={() => setCreateOpen(true)}>
            新建空白导图
          </button>
        </div>
      </div>

      {createOpen ? (
        <EditorDialog
          title="新建空白导图"
          description="更推荐导入已有导图；这里只创建一个可简单修改的本地副本。"
          dirty={newMapTitle.trim() !== "" || newMapSubjectId !== ""}
          onRequestClose={() => setCreateOpen(false)}
        >
          <form
            className="mindmap-create-form"
            onSubmit={(event) => void submitMap(event)}
          >
            <label>
              名称
              <input
                name="mindmap-create-title"
                autoComplete="off"
                required
                autoFocus
                maxLength={120}
                placeholder="例如：408 数据结构…"
                value={newMapTitle}
                onChange={(event) => setNewMapTitle(event.target.value)}
              />
            </label>
            <label>
              科目
              <select
                name="mindmap-create-subject"
                autoComplete="off"
                value={newMapSubjectId}
                onChange={(event) => setNewMapSubjectId(event.target.value)}
              >
                <option value="">未分类</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy}>
              创建导图
            </button>
          </form>
        </EditorDialog>
      ) : null}

      {importOpen ? (
        <EditorDialog
          title="导入已有思维导图"
          description="原文件保持不变，确认后生成可简单修改的本地副本。"
          dirty={false}
          onRequestClose={() => setImportOpen(false)}
          size="large"
        >
          <MindMapImportPanel
            resources={resources}
            drafts={drafts}
            busy={busy}
            onRefresh={() => void refreshAll()}
            onCreateDraft={(documentId) => void createDraft(documentId)}
            onAcceptDraft={(draftId) => void acceptDraft(draftId)}
            onRejectDraft={(draftId) => void rejectDraft(draftId)}
          />
        </EditorDialog>
      ) : null}

      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
          {error.operationId === undefined ? null : (
            <span className="operation-id">操作编号：{error.operationId}</span>
          )}
        </div>
      )}

      {loading ? (
        <p className="mindmap-empty" role="status">
          正在读取本地导图…
        </p>
      ) : (
        <div className="mindmap-workspace">
          <aside className="mindmap-sidebar" aria-label="思维导图列表">
            <div className="mindmap-list">
              {maps.length === 0 ? (
                <p className="mindmap-empty">还没有正式导图。</p>
              ) : (
                maps.map((bundle) => (
                  <button
                    key={bundle.map.id}
                    type="button"
                    className={
                      bundle.map.id === selectedBundle?.map.id
                        ? "mindmap-list-active"
                        : undefined
                    }
                    onClick={() => {
                      setSelectedMapId(bundle.map.id);
                      setSelectedNodeId(bundle.map.rootNodeId);
                      setAddParentId(undefined);
                    }}
                  >
                    <strong>{bundle.map.title}</strong>
                    <span>
                      {bundle.nodes.length} 个节点 · 修订{" "}
                      {bundle.map.currentRevision}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          {selectedBundle === undefined ? (
            <div className="mindmap-no-selection">
              <h3>从一张空白导图开始</h3>
              <p>先在左侧填写名称；也可以在下方从 OPML 或 .mm 生成草案。</p>
            </div>
          ) : (
            <div className="mindmap-main">
              <div className="mindmap-toolbar" aria-label="导图工具栏">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !selectedBundle.canUndo}
                  onClick={() =>
                    void runBundle(() =>
                      undoKnowledgeMap(selectedBundle.map.id),
                    )
                  }
                >
                  撤销
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !selectedBundle.canRedo}
                  onClick={() =>
                    void runBundle(() =>
                      redoKnowledgeMap(selectedBundle.map.id),
                    )
                  }
                >
                  重做
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setMapEditorDirty(false);
                    setMapSettingsOpen(true);
                  }}
                >
                  编辑导图信息
                </button>
                <span className="mindmap-toolbar-spacer" />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void runBundle(
                      () => duplicateKnowledgeMap(selectedBundle.map.id),
                      (bundle) => bundle.map.rootNodeId,
                    )
                  }
                >
                  复制导图
                </button>
                {trashConfirmation === selectedBundle.map.id ? (
                  <>
                    <button
                      type="button"
                      className="danger-button"
                      disabled={busy}
                      onClick={() => void removeCurrentMap()}
                    >
                      确认移入回收状态
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setTrashConfirmation(undefined)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="danger-button"
                    disabled={busy}
                    onClick={() => setTrashConfirmation(selectedBundle.map.id)}
                  >
                    删除导图
                  </button>
                )}
              </div>

              {addParent === undefined ? null : (
                <EditorDialog
                  title={`在“${addParent.title}”下添加子节点`}
                  description="只填写节点名称即可，详细信息以后需要时再补。"
                  dirty={newNodeTitle.trim() !== ""}
                  onRequestClose={() => setAddParentId(undefined)}
                >
                  <form
                    className="mindmap-add-node-form"
                    onSubmit={(event) => void submitNode(event)}
                  >
                    <label>
                      节点名称
                      <input
                        name="mindmap-child-title"
                        autoComplete="off"
                        autoFocus
                        required
                        maxLength={200}
                        value={newNodeTitle}
                        onChange={(event) =>
                          setNewNodeTitle(event.target.value)
                        }
                      />
                    </label>
                    <button type="submit" disabled={busy}>
                      添加节点
                    </button>
                  </form>
                </EditorDialog>
              )}

              {mapSettingsOpen ? (
                <EditorDialog
                  title="编辑导图信息"
                  dirty={mapEditorDirty}
                  onRequestClose={() => {
                    setMapSettingsOpen(false);
                    setMapEditorDirty(false);
                  }}
                >
                  <MindMapSettings
                    key={`${selectedBundle.map.id}-${selectedBundle.map.updatedAt}`}
                    map={selectedBundle.map}
                    subjects={subjects}
                    busy={busy}
                    onDirtyChange={setMapEditorDirty}
                    onSave={async (input: UpdateKnowledgeMapInput) => {
                      const saved = await runBundle(() =>
                        updateKnowledgeMap(input),
                      );
                      if (saved) setMapSettingsOpen(false);
                      return saved;
                    }}
                  />
                </EditorDialog>
              ) : null}

              {nodeEditorOpen && selectedNode !== undefined ? (
                <EditorDialog
                  title={`编辑节点：${selectedNode.title}`}
                  dirty={nodeEditorDirty}
                  onRequestClose={() => {
                    setNodeEditorOpen(false);
                    setNodeEditorDirty(false);
                  }}
                  size="large"
                >
                  <MindMapNodeEditor
                    key={`${selectedNode.id}-${selectedNode.updatedAt}-${selectedBundle.map.currentRevision}`}
                    node={selectedNode}
                    isRoot={selectedNode.id === selectedBundle.map.rootNodeId}
                    subjects={subjects}
                    resources={resources}
                    links={selectedLinks}
                    moveTargets={moveTargets(selectedBundle, selectedNode.id)}
                    busy={busy}
                    onDirtyChange={setNodeEditorDirty}
                    onSave={async (input: UpdateKnowledgeNodeInput) => {
                      const saved = await runBundle(
                        () => updateKnowledgeNode(input),
                        input.nodeId,
                      );
                      if (saved) setNodeEditorOpen(false);
                      return saved;
                    }}
                    onDelete={() => {
                      const parentId = selectedNode.parentId;
                      void runBundle(
                        () => deleteKnowledgeSubtree(selectedNode.id),
                        parentId,
                      ).then((saved) => {
                        if (saved) setNodeEditorOpen(false);
                      });
                    }}
                    onMove={async (newParentId) => {
                      const position = childrenOf(
                        buildKnowledgeTreeIndex(selectedBundle.nodes),
                        newParentId,
                      ).length;
                      const saved = await runBundle(
                        () =>
                          moveKnowledgeNode({
                            nodeId: selectedNode.id,
                            newParentId,
                            position,
                          }),
                        selectedNode.id,
                      );
                      if (saved) setNodeEditorOpen(false);
                      return saved;
                    }}
                    onAddResource={(input: AddKnowledgeNodeResourceInput) =>
                      runBundle(
                        () => addKnowledgeNodeResource(input),
                        input.nodeId,
                      )
                    }
                    onDeleteResource={(resourceId) =>
                      void runBundle(
                        () => deleteKnowledgeNodeResource(resourceId),
                        selectedNode.id,
                      )
                    }
                    onOpenResource={onOpenResource}
                  />
                </EditorDialog>
              ) : null}

              <div className="mindmap-editor-layout">
                <MindElixirCanvas
                  bundle={selectedBundle}
                  selectedNodeId={selectedNode?.id}
                  onSelect={setSelectedNodeId}
                />

                <aside
                  className="mindmap-inspector"
                  aria-label="选中节点快捷操作"
                >
                  {selectedNode === undefined ? (
                    <p>在画布中选择一个节点。</p>
                  ) : (
                    <>
                      <p className="section-label">当前节点</p>
                      <h3>{selectedNode.title}</h3>
                      {selectedNode.noteMarkdown === undefined ? (
                        <p>没有附加笔记。</p>
                      ) : (
                        <p>{selectedNode.noteMarkdown}</p>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setNodeEditorDirty(false);
                          setNodeEditorOpen(true);
                        }}
                      >
                        编辑节点
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => {
                          setAddParentId(selectedNode.id);
                          setNewNodeTitle("");
                        }}
                      >
                        添加子节点
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() =>
                          void runBundle(
                            () =>
                              setKnowledgeNodeCollapsed(
                                selectedNode.id,
                                !selectedNode.collapsed,
                              ),
                            selectedNode.id,
                          )
                        }
                      >
                        {selectedNode.collapsed ? "展开子节点" : "折叠子节点"}
                      </button>
                      <section
                        className="mindmap-inspector-resources"
                        aria-labelledby="mindmap-inspector-resources-title"
                      >
                        <h4 id="mindmap-inspector-resources-title">关联资料</h4>
                        {selectedLinks.length === 0 ? (
                          <p className="mindmap-empty">还没有关联资料。</p>
                        ) : (
                          <ul>
                            {selectedLinks.map((link) => {
                              const resource = resources.find(
                                (item) => item.id === link.documentId,
                              );
                              const canOpen =
                                resource?.kind === "pdf" ||
                                resource?.kind === "image";
                              return (
                                <li key={link.id}>
                                  <div>
                                    <strong>{link.documentTitle}</strong>
                                    {link.pageStart === undefined ? null : (
                                      <span>
                                        第 {link.pageStart}
                                        {link.pageEnd === link.pageStart
                                          ? ""
                                          : `-${link.pageEnd}`}{" "}
                                        页
                                      </span>
                                    )}
                                  </div>
                                  {canOpen ? (
                                    <button
                                      type="button"
                                      className="secondary-button"
                                      onClick={() =>
                                        onOpenResource(
                                          link.documentId,
                                          link.pageStart,
                                        )
                                      }
                                    >
                                      打开
                                    </button>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </section>
                    </>
                  )}
                </aside>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function loadMindMapData() {
  return Promise.all([
    listKnowledgeMaps(),
    listMindMapImportDrafts(),
    listResources(),
    listSubjects(),
  ]);
}

function moveTargets(
  bundle: KnowledgeMapBundle,
  nodeId: string,
): KnowledgeMapBundle["nodes"] {
  const index = buildKnowledgeTreeIndex(bundle.nodes);
  const excluded = collectDescendantIds(index, nodeId);
  excluded.add(nodeId);
  return bundle.nodes.filter((node) => !excluded.has(node.id));
}
