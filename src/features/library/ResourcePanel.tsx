import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import "./library.css";

import {
  cancelResourceImport,
  buildResourceProtocolUrl,
  getResourceReaderDescriptor,
  listenToImportEvents,
  listResources,
  normalizeResourceCommandError,
  saveResourceReadingProgress,
  startResourceImport,
  trashResource,
  updateResourceRole,
  type ImportEvent,
  type ResourceCommandError,
  type ResourceDocument,
  type ResourceReaderDescriptor,
} from "../../shared/tauri/resourceClient";
import { EditorDialog } from "../../shared/components/EditorDialog";
import {
  PageEmpty,
  PageHeader,
  PageStatus,
  PageSurface,
} from "../../shared/components/PagePrimitives";
import { Button } from "../../shared/ui/Button";
import { SectionHeader } from "../../shared/ui/SectionHeader";
import { StatusBanner } from "../../shared/ui/StatusBanner";
import { Toolbar, ToolbarSpacer } from "../../shared/ui/Toolbar";
import { ResourceSearchPanel } from "./ResourceSearchPanel";
import { ResourceTable } from "./ResourceTable";
import {
  formatResourceBytes,
  formatResourceCount,
  nextResourceFileView,
  nextResourceTab,
  RESOURCE_FILE_VIEWS,
  RESOURCE_TABS,
  type ResourceFileView,
  type ResourceTab,
} from "./resourceListModel";

const PdfReader = lazy(() =>
  import("./pdf/PdfReader").then((module) => ({ default: module.PdfReader })),
);
const MindMapPanel = lazy(() =>
  import("../mindmap/MindMapPanel").then((module) => ({
    default: module.MindMapPanel,
  })),
);

export interface ResourceOpenRequest {
  documentId: string;
  page?: number;
  nonce: number;
}

interface ResourcePanelProps {
  openRequest?: ResourceOpenRequest;
}

interface ActiveImport {
  operationId: string;
  copiedBytes: number;
  totalBytes: number;
  canceling: boolean;
}

export function ResourcePanel({ openRequest }: ResourcePanelProps) {
  const [sectionView, setSectionView] = useState<ResourceTab>("files");
  const [fileView, setFileView] = useState<ResourceFileView>("browse");
  const [resources, setResources] = useState<ResourceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [listenerReady, setListenerReady] = useState(false);
  const [activeImport, setActiveImport] = useState<ActiveImport | null>(null);
  const [error, setError] = useState<ResourceCommandError | null>(null);
  const [reader, setReader] = useState<ResourceReaderDescriptor | null>(null);
  const [requestedPage, setRequestedPage] = useState<number>();
  const [readerLoading, setReaderLoading] = useState(false);
  const [trashTarget, setTrashTarget] = useState<ResourceDocument>();
  const [trashBusy, setTrashBusy] = useState(false);
  const terminalOperations = useRef(new Set<string>());
  const lastSavedProgress = useRef<string | undefined>(undefined);
  const readerRequestRef = useRef(0);
  const handledOpenRequestRef = useRef<string | undefined>(undefined);
  const sectionTabRefs = useRef<Record<ResourceTab, HTMLButtonElement | null>>({
    files: null,
    mindmaps: null,
  });
  const fileViewRefs = useRef<
    Record<ResourceFileView, HTMLButtonElement | null>
  >({ browse: null, search: null });
  const refreshResources = useCallback(async () => {
    setLoading(true);
    try {
      const documents = await listResources();
      setResources(documents);
      setError(null);
    } catch (listError: unknown) {
      setError(normalizeResourceCommandError(listError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;
    let unlisten: (() => void) | undefined;

    const handleImportEvent = (event: ImportEvent) => {
      if (!isActive) {
        return;
      }
      if (event.state === "running") {
        setActiveImport({
          operationId: event.operationId,
          copiedBytes: event.copiedBytes,
          totalBytes: event.totalBytes,
          canceling: false,
        });
        return;
      }

      terminalOperations.current.add(event.operationId);
      setActiveImport((current) =>
        current?.operationId === event.operationId ? null : current,
      );
      if (event.state === "succeeded" && event.resource !== undefined) {
        setResources((current) => [
          event.resource as ResourceDocument,
          ...current.filter((resource) => resource.id !== event.resource?.id),
        ]);
        setError(null);
      } else if (event.error !== undefined) {
        setError(event.error);
      }
    };

    void listenToImportEvents(handleImportEvent).then(
      (dispose) => {
        if (isActive) {
          unlisten = dispose;
          setListenerReady(true);
        } else {
          dispose();
        }
      },
      (listenError: unknown) => {
        if (isActive) {
          setError(normalizeResourceCommandError(listenError));
        }
      },
    );

    void Promise.resolve().then(() => {
      if (isActive) {
        void refreshResources();
      }
    });

    return () => {
      isActive = false;
      unlisten?.();
    };
  }, [refreshResources]);

  const openReader = useCallback(async (documentId: string, page?: number) => {
    const requestId = readerRequestRef.current + 1;
    readerRequestRef.current = requestId;
    try {
      const descriptor = await getResourceReaderDescriptor(documentId);
      if (requestId !== readerRequestRef.current) {
        return;
      }
      setRequestedPage(page);
      setReader(descriptor);
      lastSavedProgress.current = undefined;
    } catch (readerError: unknown) {
      if (requestId === readerRequestRef.current) {
        setError(normalizeResourceCommandError(readerError));
      }
    } finally {
      if (requestId === readerRequestRef.current) {
        setReaderLoading(false);
      }
    }
  }, []);

  const requestReader = useCallback(
    (documentId: string, page?: number) => {
      setReaderLoading(true);
      setError(null);
      void openReader(documentId, page);
    },
    [openReader],
  );

  const closeReader = () => {
    readerRequestRef.current += 1;
    setReader(null);
    setRequestedPage(undefined);
  };

  const removeResource = async () => {
    if (trashTarget === undefined) return;
    setTrashBusy(true);
    setError(null);
    try {
      await trashResource(trashTarget.id);
      setResources((current) =>
        current.filter((resource) => resource.id !== trashTarget.id),
      );
      if (reader?.documentId === trashTarget.id) setReader(null);
      setTrashTarget(undefined);
    } catch (trashError: unknown) {
      setError(normalizeResourceCommandError(trashError));
    } finally {
      setTrashBusy(false);
    }
  };

  const requestedDocumentId = openRequest?.documentId;
  const requestedReferencePage = openRequest?.page;
  const requestNonce = openRequest?.nonce;
  useEffect(() => {
    if (requestedDocumentId === undefined) {
      return;
    }
    const requestKey = `${requestNonce ?? ""}:${requestedDocumentId}:${requestedReferencePage ?? ""}`;
    if (handledOpenRequestRef.current === requestKey) {
      return;
    }
    handledOpenRequestRef.current = requestKey;
    void Promise.resolve().then(() => {
      requestReader(requestedDocumentId, requestedReferencePage);
    });
  }, [
    requestNonce,
    requestedDocumentId,
    requestedReferencePage,
    requestReader,
  ]);

  const beginImport = async () => {
    setError(null);
    try {
      const operation = await startResourceImport();
      if (
        operation !== null &&
        !terminalOperations.current.has(operation.operationId)
      ) {
        setActiveImport({
          operationId: operation.operationId,
          copiedBytes: 0,
          totalBytes: 0,
          canceling: false,
        });
      }
    } catch (importError: unknown) {
      setError(normalizeResourceCommandError(importError));
    }
  };

  const cancelImport = async () => {
    if (activeImport === null) {
      return;
    }
    try {
      const accepted = await cancelResourceImport(activeImport.operationId);
      if (accepted) {
        setActiveImport((current) =>
          current === null ? null : { ...current, canceling: true },
        );
      }
    } catch (cancelError: unknown) {
      setError(normalizeResourceCommandError(cancelError));
    }
  };

  const changeRole = async (
    documentId: string,
    role: ResourceDocument["role"],
  ) => {
    try {
      const updated = await updateResourceRole(documentId, role);
      setResources((current) =>
        current.map((resource) =>
          resource.id === updated.id ? updated : resource,
        ),
      );
      setError(null);
    } catch (roleError: unknown) {
      setError(normalizeResourceCommandError(roleError));
    }
  };

  const readerDocumentId = reader?.documentId;
  const persistReadingProgress = useCallback(
    (pageCount: number, lastPage: number) => {
      if (readerDocumentId === undefined) {
        return;
      }
      const progressKey = `${readerDocumentId}:${pageCount}:${lastPage}`;
      if (lastSavedProgress.current === progressKey) {
        return;
      }
      lastSavedProgress.current = progressKey;
      void saveResourceReadingProgress(
        readerDocumentId,
        pageCount,
        lastPage,
      ).then(
        (updated) => {
          setReader(updated);
          setResources((current) =>
            current.map((resource) =>
              resource.id === updated.documentId
                ? {
                    ...resource,
                    pageCount: updated.pageCount,
                    lastPage: updated.lastPage,
                    lastOpenedAt: Date.now(),
                  }
                : resource,
            ),
          );
        },
        (progressError: unknown) => {
          lastSavedProgress.current = undefined;
          setError(normalizeResourceCommandError(progressError));
        },
      );
    },
    [readerDocumentId],
  );

  const progress =
    activeImport === null || activeImport.totalBytes === 0
      ? 0
      : Math.min(
          100,
          Math.round(
            (activeImport.copiedBytes / activeImport.totalBytes) * 100,
          ),
        );

  const selectSectionTab = (next: ResourceTab) => {
    setSectionView(next);
    requestAnimationFrame(() => sectionTabRefs.current[next]?.focus());
  };

  const handleSectionTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: ResourceTab,
  ) => {
    const next = nextResourceTab(current, event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    selectSectionTab(next);
  };

  const selectFileView = (next: ResourceFileView) => {
    setFileView(next);
    requestAnimationFrame(() => fileViewRefs.current[next]?.focus());
  };

  const handleFileViewKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: ResourceFileView,
  ) => {
    const next = nextResourceFileView(current, event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    selectFileView(next);
  };

  return (
    <div className="library-page">
      <PageHeader
        id="library-title"
        title="资料"
        description="资料保存在本机工作区，并自动去重。"
        actions={
          <Button
            variant="primary"
            disabled={!listenerReady || activeImport !== null}
            onClick={() => void beginImport()}
          >
            {listenerReady ? "选择并导入资料" : "正在准备导入…"}
          </Button>
        }
      />

      <PageSurface as="div" className="library-card">
        {activeImport === null ? null : (
          <div className="import-progress" aria-live="polite">
            <div className="progress-copy">
              <span>
                {activeImport.canceling
                  ? "正在取消导入…"
                  : activeImport.totalBytes === 0
                    ? "正在准备导入…"
                    : `正在导入 ${progress}%`}
              </span>
              <span>
                {formatResourceBytes(activeImport.copiedBytes)} /{" "}
                {formatResourceBytes(activeImport.totalBytes)}
              </span>
            </div>
            <progress value={progress} max={100} aria-label="资料导入进度" />
            <Button
              variant="secondary"
              size="sm"
              disabled={activeImport.canceling}
              onClick={() => void cancelImport()}
            >
              取消导入
            </Button>
          </div>
        )}

        {error === null ? null : (
          <StatusBanner
            tone="error"
            title={error.message}
            actions={
              <Button
                variant="secondary"
                size="sm"
                disabled={loading}
                onClick={() => void refreshResources()}
              >
                {loading ? "正在重新读取资料…" : "重试读取资料"}
              </Button>
            }
          >
            <p>{error.action}</p>
            {error.operationId === undefined ? null : (
              <span className="operation-id">
                操作编号：{error.operationId}
              </span>
            )}
          </StatusBanner>
        )}

        <div
          className="library-view-switch"
          role="tablist"
          aria-label="资料功能切换"
        >
          {RESOURCE_TABS.map((tab) => (
            <Button
              key={tab.id}
              ref={(node) => {
                sectionTabRefs.current[tab.id] = node;
              }}
              variant={sectionView === tab.id ? "primary" : "ghost"}
              size="sm"
              id={`resource-tab-${tab.id}`}
              role="tab"
              aria-controls={`resource-panel-${tab.id}`}
              aria-selected={sectionView === tab.id}
              tabIndex={sectionView === tab.id ? 0 : -1}
              onClick={() => selectSectionTab(tab.id)}
              onKeyDown={(event) => handleSectionTabKeyDown(event, tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        <div
          id={`resource-panel-${sectionView}`}
          role="tabpanel"
          aria-labelledby={`resource-tab-${sectionView}`}
          tabIndex={0}
        >
          {sectionView === "mindmaps" ? (
            <Suspense
              fallback={
                <PageStatus tone="loading" title="正在加载导图阅读器…" />
              }
            >
              <MindMapPanel
                onOpenResource={(documentId, page) => {
                  selectSectionTab("files");
                  requestReader(documentId, page);
                }}
              />
            </Suspense>
          ) : (
            <>
              <Toolbar
                label="资料浏览与搜索视图"
                className="resource-file-toolbar"
              >
                {RESOURCE_FILE_VIEWS.map((view) => (
                  <Button
                    key={view.id}
                    ref={(node) => {
                      fileViewRefs.current[view.id] = node;
                    }}
                    variant={fileView === view.id ? "primary" : "ghost"}
                    size="sm"
                    aria-pressed={fileView === view.id}
                    onClick={() => selectFileView(view.id)}
                    onKeyDown={(event) => handleFileViewKeyDown(event, view.id)}
                  >
                    {view.label}
                  </Button>
                ))}
                <ToolbarSpacer />
                <span className="resource-count" aria-live="polite">
                  {formatResourceCount(resources.length)} 份资料
                </span>
              </Toolbar>

              {fileView === "search" ? (
                <div id="resource-file-panel-search" aria-label="全文搜索">
                  <ResourceSearchPanel
                    resources={resources}
                    onOpen={requestReader}
                  />
                </div>
              ) : (
                <section
                  id="resource-file-panel-browse"
                  className="resource-browser"
                  aria-label="浏览资料"
                >
                  <SectionHeader
                    title="资料文件"
                    actions={
                      <span className="resource-browser-hint">
                        {resources.length === 0 ? "暂无资料" : "列表视图"}
                      </span>
                    }
                  />

                  {loading ? (
                    <PageStatus tone="loading" title="正在读取本地资料…" />
                  ) : resources.length === 0 ? (
                    <PageEmpty
                      title="还没有资料"
                      description="可以先导入一份 PDF 或图片。"
                    />
                  ) : (
                    <ResourceTable
                      resources={resources}
                      readerLoading={readerLoading}
                      onOpen={requestReader}
                      onChangeRole={(documentId, role) =>
                        void changeRole(documentId, role)
                      }
                      onRequestDelete={setTrashTarget}
                    />
                  )}
                </section>
              )}

              {reader === null ? null : (
                <EditorDialog
                  title={reader.title}
                  description="受控本地阅读，支持翻页、缩放、旋转和阅读进度保存。"
                  dirty={false}
                  size="review"
                  className="resource-reader-dialog"
                  onRequestClose={closeReader}
                >
                  {reader.kind === "pdf" ? (
                    <Suspense
                      fallback={
                        <PageStatus
                          tone="loading"
                          title="正在加载 PDF 阅读器…"
                        />
                      }
                    >
                      <PdfReader
                        key={`${reader.documentId}:${requestedPage ?? "resume"}`}
                        descriptor={reader}
                        requestedPage={requestedPage}
                        onProgress={persistReadingProgress}
                      />
                    </Suspense>
                  ) : (
                    <div className="image-reader">
                      <img
                        src={buildResourceProtocolUrl(
                          reader.documentId,
                          "image",
                        )}
                        alt={reader.title}
                        width={1600}
                        height={1200}
                      />
                    </div>
                  )}
                </EditorDialog>
              )}
              {trashTarget === undefined ? null : (
                <EditorDialog
                  title="删除资料"
                  description="资料会从资料库列表移除；为保证已建立的题目卡片仍可查看，原文件会安全保留在 KyStudy 工作区中。"
                  dirty={false}
                  onRequestClose={() => setTrashTarget(undefined)}
                >
                  <div className="destructive-confirmation">
                    <strong>{trashTarget.title}</strong>
                    <p>此操作不会删除已经建立的题目索引和错题记录。</p>
                    <div className="editor-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setTrashTarget(undefined)}
                      >
                        取消
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={trashBusy}
                        onClick={() => void removeResource()}
                      >
                        {trashBusy ? "正在删除…" : "确认删除资料"}
                      </Button>
                    </div>
                  </div>
                </EditorDialog>
              )}
            </>
          )}
        </div>
      </PageSurface>
    </div>
  );
}
