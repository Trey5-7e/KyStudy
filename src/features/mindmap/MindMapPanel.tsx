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
  type MoveKnowledgeNodeInput,
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
import { MindMapNodeEditor, MindMapSettings } from "./MindMapDetails";
import { MindMapImportPanel } from "./MindMapImportPanel";
import { MindMapTree } from "./MindMapTree";

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
  const [zoom, setZoom] = useState(1);
  const [trashConfirmation, setTrashConfirmation] = useState<string>();

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

  const moveNode = (input: MoveKnowledgeNodeInput) => {
    void runBundle(() => moveKnowledgeNode(input), input.nodeId);
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
          <p className="section-label">M4 · 本地知识结构</p>
          <h2 id="mindmap-title">可编辑思维导图</h2>
          <p>
            手动维护知识层级、掌握状态和资料依据；所有正式修改都可持久化撤销与重做。
          </p>
        </div>
        <span className="mindmap-local-badge">本地运行 · 无 AI 消耗</span>
      </div>

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
            <form
              className="mindmap-create-form"
              onSubmit={(event) => void submitMap(event)}
            >
              <h3>新建导图</h3>
              <label>
                名称
                <input
                  required
                  maxLength={120}
                  placeholder="例如：408 数据结构"
                  value={newMapTitle}
                  onChange={(event) => setNewMapTitle(event.target.value)}
                />
              </label>
              <label>
                科目
                <select
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
                <span
                  className="mindmap-toolbar-separator"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="缩小导图"
                  disabled={zoom <= 0.6}
                  onClick={() =>
                    setZoom((current) => Math.max(0.6, current - 0.1))
                  }
                >
                  −
                </button>
                <span>{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="放大导图"
                  disabled={zoom >= 1.5}
                  onClick={() =>
                    setZoom((current) => Math.min(1.5, current + 0.1))
                  }
                >
                  +
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setZoom(1)}
                >
                  重置缩放
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
                <form
                  className="mindmap-add-node-form"
                  onSubmit={(event) => void submitNode(event)}
                >
                  <label>
                    在“{addParent.title}”下添加子节点
                    <input
                      autoFocus
                      required
                      maxLength={200}
                      value={newNodeTitle}
                      onChange={(event) => setNewNodeTitle(event.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={busy}>
                    添加
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setAddParentId(undefined)}
                  >
                    取消
                  </button>
                </form>
              )}

              <div className="mindmap-editor-layout">
                <MindMapTree
                  bundle={selectedBundle}
                  selectedNodeId={selectedNode?.id}
                  zoom={zoom}
                  busy={busy}
                  onSelect={setSelectedNodeId}
                  onToggle={(nodeId, collapsed) =>
                    void runBundle(
                      () => setKnowledgeNodeCollapsed(nodeId, collapsed),
                      nodeId,
                    )
                  }
                  onAddChild={(parentId) => {
                    setAddParentId(parentId);
                    setNewNodeTitle("");
                  }}
                  onMove={(nodeId, parentId, position) =>
                    moveNode({
                      nodeId,
                      newParentId: parentId,
                      position,
                    })
                  }
                />

                <aside
                  className="mindmap-inspector"
                  aria-label="导图与节点详情"
                >
                  <MindMapSettings
                    key={`${selectedBundle.map.id}-${selectedBundle.map.updatedAt}`}
                    map={selectedBundle.map}
                    subjects={subjects}
                    busy={busy}
                    onSave={(input: UpdateKnowledgeMapInput) =>
                      runBundle(() => updateKnowledgeMap(input))
                    }
                  />
                  {selectedNode === undefined ? null : (
                    <MindMapNodeEditor
                      key={`${selectedNode.id}-${selectedNode.updatedAt}-${selectedBundle.map.currentRevision}`}
                      node={selectedNode}
                      isRoot={selectedNode.id === selectedBundle.map.rootNodeId}
                      subjects={subjects}
                      resources={resources}
                      links={selectedLinks}
                      busy={busy}
                      onSave={(input: UpdateKnowledgeNodeInput) =>
                        runBundle(
                          () => updateKnowledgeNode(input),
                          input.nodeId,
                        )
                      }
                      onDelete={() => {
                        const parentId = selectedNode.parentId;
                        void runBundle(
                          () => deleteKnowledgeSubtree(selectedNode.id),
                          parentId,
                        );
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
                  )}
                </aside>
              </div>
            </div>
          )}
        </div>
      )}

      <MindMapImportPanel
        resources={resources}
        drafts={drafts}
        busy={busy}
        onRefresh={() => void refreshAll()}
        onCreateDraft={(documentId) => void createDraft(documentId)}
        onAcceptDraft={(draftId) => void acceptDraft(draftId)}
        onRejectDraft={(draftId) => void rejectDraft(draftId)}
      />
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
