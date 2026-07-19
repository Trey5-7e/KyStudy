import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  cancelResourceImport,
  buildResourceProtocolUrl,
  getResourceReaderDescriptor,
  listenToImportEvents,
  listResources,
  normalizeResourceCommandError,
  saveResourceReadingProgress,
  startResourceImport,
  updateResourceRole,
  type ImportEvent,
  type ResourceCommandError,
  type ResourceDocument,
  type ResourceReaderDescriptor,
} from "../../shared/tauri/resourceClient";

const PdfReader = lazy(() =>
  import("./pdf/PdfReader").then((module) => ({ default: module.PdfReader })),
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

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KiB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const ROLE_LABELS: Record<ResourceDocument["role"], string> = {
  planning: "规划资料",
  reference: "参考资料",
  workbook: "习题册",
  other: "未分类",
};

export function ResourcePanel({ openRequest }: ResourcePanelProps) {
  const [resources, setResources] = useState<ResourceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [listenerReady, setListenerReady] = useState(false);
  const [activeImport, setActiveImport] = useState<ActiveImport | null>(null);
  const [error, setError] = useState<ResourceCommandError | null>(null);
  const [reader, setReader] = useState<ResourceReaderDescriptor | null>(null);
  const [requestedPage, setRequestedPage] = useState<number>();
  const [readerLoading, setReaderLoading] = useState(false);
  const terminalOperations = useRef(new Set<string>());
  const lastSavedProgress = useRef<string | undefined>(undefined);

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

    void listResources().then(
      (documents) => {
        if (isActive) {
          setResources(documents);
          setLoading(false);
        }
      },
      (listError: unknown) => {
        if (isActive) {
          setError(normalizeResourceCommandError(listError));
          setLoading(false);
        }
      },
    );

    return () => {
      isActive = false;
      unlisten?.();
    };
  }, []);

  const openReader = useCallback(async (documentId: string, page?: number) => {
    try {
      const descriptor = await getResourceReaderDescriptor(documentId);
      setRequestedPage(page);
      setReader(descriptor);
      lastSavedProgress.current = undefined;
      window.setTimeout(() => {
        document
          .getElementById("resource-reader-title")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    } catch (readerError: unknown) {
      setError(normalizeResourceCommandError(readerError));
    } finally {
      setReaderLoading(false);
    }
  }, []);

  const requestReader = (documentId: string, page?: number) => {
    setReaderLoading(true);
    setError(null);
    void openReader(documentId, page);
  };

  const requestedDocumentId = openRequest?.documentId;
  const requestedReferencePage = openRequest?.page;
  const requestNonce = openRequest?.nonce;
  useEffect(() => {
    if (requestedDocumentId === undefined) {
      return;
    }
    let active = true;
    void getResourceReaderDescriptor(requestedDocumentId).then(
      (descriptor) => {
        if (active) {
          setRequestedPage(requestedReferencePage);
          setReader(descriptor);
          lastSavedProgress.current = undefined;
          window.setTimeout(() => {
            document
              .getElementById("resource-reader-title")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 0);
        }
      },
      (readerError: unknown) => {
        if (active) {
          setError(normalizeResourceCommandError(readerError));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [requestNonce, requestedDocumentId, requestedReferencePage]);

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

  return (
    <section className="library-card" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <p className="section-label">本地资料库</p>
          <h2 id="library-title">学习资料</h2>
          <p className="library-description">
            PDF、图片和思维导图源文件会复制到本地工作区；相同内容只保存一份。
          </p>
        </div>
        <button
          type="button"
          disabled={!listenerReady || activeImport !== null}
          onClick={() => void beginImport()}
        >
          选择并导入资料
        </button>
      </div>

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
              {formatBytes(activeImport.copiedBytes)} /{" "}
              {formatBytes(activeImport.totalBytes)}
            </span>
          </div>
          <progress value={progress} max={100} aria-label="资料导入进度" />
          <button
            type="button"
            className="secondary-button"
            disabled={activeImport.canceling}
            onClick={() => void cancelImport()}
          >
            取消导入
          </button>
        </div>
      )}

      {error === null ? null : (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
          {error.operationId === undefined ? null : (
            <p className="operation-id">操作编号：{error.operationId}</p>
          )}
        </div>
      )}

      {loading ? (
        <p className="empty-state">正在读取本地资料…</p>
      ) : resources.length === 0 ? (
        <p className="empty-state">还没有资料，可以先导入一份 PDF 或图片。</p>
      ) : (
        <ul className="resource-list">
          {resources.map((resource) => (
            <li key={resource.id}>
              <div>
                <strong>{resource.title}</strong>
                <span>
                  {resource.kind} · {formatBytes(resource.sizeBytes)}
                </span>
                {resource.lastPage === undefined ? null : (
                  <span>
                    上次读到第 {resource.lastPage}
                    {resource.pageCount === undefined
                      ? " 页"
                      : `/${resource.pageCount} 页`}
                  </span>
                )}
              </div>
              <div className="resource-actions">
                <label>
                  用途
                  <select
                    value={resource.role}
                    onChange={(event) =>
                      void changeRole(
                        resource.id,
                        event.target.value as ResourceDocument["role"],
                      )
                    }
                  >
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {resource.kind === "pdf" || resource.kind === "image" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={readerLoading}
                    onClick={() => requestReader(resource.id)}
                  >
                    打开阅读
                  </button>
                ) : null}
                <code title="SHA-256 内容指纹">
                  {resource.sha256.slice(0, 12)}…
                </code>
              </div>
            </li>
          ))}
        </ul>
      )}

      {reader === null ? null : (
        <section
          className="resource-reader"
          aria-labelledby="resource-reader-title"
        >
          <div className="resource-reader-heading">
            <div>
              <p className="section-label">受控本地阅读</p>
              <h3 id="resource-reader-title">{reader.title}</h3>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setReader(null)}
            >
              关闭阅读器
            </button>
          </div>
          {reader.kind === "pdf" ? (
            <Suspense
              fallback={<p className="empty-state">正在加载 PDF 阅读器…</p>}
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
                src={buildResourceProtocolUrl(reader.documentId, "image")}
                alt={reader.title}
              />
            </div>
          )}
        </section>
      )}
    </section>
  );
}
