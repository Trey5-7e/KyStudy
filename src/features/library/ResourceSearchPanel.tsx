import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  getResourceReaderDescriptor,
  type ResourceDocument,
} from "../../shared/tauri/resourceClient";
import {
  clearResourceIndex,
  listResourceIndexStatuses,
  normalizeResourceSearchError,
  searchResources,
  type ResourceIndexStatus,
  type ResourceSearchCommandError,
  type ResourceSearchResult,
} from "../../shared/tauri/resourceSearchClient";

interface ResourceSearchPanelProps {
  resources: ResourceDocument[];
  onOpen(documentId: string, page?: number): void;
}

interface ActiveIndex {
  documentId: string;
  indexedPages: number;
  totalPages: number;
  canceling: boolean;
}

export function ResourceSearchPanel({
  resources,
  onOpen,
}: ResourceSearchPanelProps) {
  const [statuses, setStatuses] = useState<ResourceIndexStatus[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResourceSearchResult[]>([]);
  const deferredResults = useDeferredValue(results);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState<ActiveIndex>();
  const [clearingId, setClearingId] = useState<string>();
  const [confirmClearId, setConfirmClearId] = useState<string>();
  const [error, setError] = useState<ResourceSearchCommandError>();
  const controllerRef = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void listResourceIndexStatuses().then(
      (loaded) => {
        if (active) {
          setStatuses(loaded);
        }
      },
      (loadError: unknown) => {
        if (active) {
          setError(normalizeResourceSearchError(loadError));
        }
      },
    );
    return () => {
      active = false;
      controllerRef.current?.abort();
    };
  }, []);

  const pdfs = resources.filter((resource) => resource.kind === "pdf");
  const statusByDocument = new Map(
    statuses.map((status) => [status.documentId, status]),
  );

  const refreshStatuses = async () => {
    const loaded = await listResourceIndexStatuses();
    setStatuses(loaded);
  };

  const startIndex = async (resource: ResourceDocument, force: boolean) => {
    if (activeIndex !== undefined) {
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(undefined);
    setConfirmClearId(undefined);
    setActiveIndex({
      documentId: resource.id,
      indexedPages: 0,
      totalPages: resource.pageCount ?? 0,
      canceling: false,
    });
    try {
      const [descriptor, indexer] = await Promise.all([
        getResourceReaderDescriptor(resource.id),
        import("./pdf/pdfTextIndexer"),
      ]);
      await indexer.indexPdfText(
        descriptor,
        force,
        controller.signal,
        (status) => {
          setStatuses((current) => replaceStatus(current, status));
          setActiveIndex((current) =>
            current?.documentId === status.documentId
              ? {
                  ...current,
                  indexedPages: status.indexedPages,
                  totalPages: status.totalPages ?? current.totalPages,
                }
              : current,
          );
        },
      );
    } catch (indexError: unknown) {
      if (!controller.signal.aborted && !isCanceledIndexError(indexError)) {
        setError(normalizeResourceSearchError(indexError));
      }
    } finally {
      controllerRef.current = undefined;
      setActiveIndex(undefined);
      try {
        await refreshStatuses();
      } catch (refreshError: unknown) {
        setError(normalizeResourceSearchError(refreshError));
      }
    }
  };

  const cancelIndex = () => {
    controllerRef.current?.abort();
    setActiveIndex((current) =>
      current === undefined ? undefined : { ...current, canceling: true },
    );
  };

  const clearIndex = async (documentId: string) => {
    if (confirmClearId !== documentId) {
      setConfirmClearId(documentId);
      return;
    }
    setClearingId(documentId);
    setError(undefined);
    try {
      const cleared = await clearResourceIndex(documentId);
      setStatuses((current) => replaceStatus(current, cleared));
      setConfirmClearId(undefined);
    } catch (clearError: unknown) {
      setError(normalizeResourceSearchError(clearError));
    } finally {
      setClearingId(undefined);
    }
  };

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearching(true);
    setError(undefined);
    try {
      setResults(await searchResources(query));
      setSearched(true);
    } catch (searchError: unknown) {
      setError(normalizeResourceSearchError(searchError));
    } finally {
      setSearching(false);
    }
  };

  return (
    <section
      className="resource-search"
      aria-labelledby="resource-search-title"
    >
      <div className="resource-search-heading">
        <div>
          <p className="section-label">M7 · 本地文字索引</p>
          <h3 id="resource-search-title">搜索资料原文并回到 PDF 页码</h3>
        </div>
        <span>
          {statuses.filter((status) => status.state === "ready").length}{" "}
          份可搜索
        </span>
      </div>

      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
        </div>
      )}

      <form className="resource-search-form" onSubmit={submitSearch}>
        <label>
          搜索词
          <input
            type="search"
            required
            maxLength={100}
            placeholder="例如：操作系统强化阶段"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" disabled={searching || query.trim() === ""}>
          {searching ? "正在搜索…" : "搜索本地资料"}
        </button>
      </form>

      {searched && deferredResults.length === 0 && !searching ? (
        <p className="empty-state">没有找到匹配内容，可以换一个关键词。</p>
      ) : deferredResults.length === 0 ? null : (
        <ol
          className="resource-search-results"
          aria-label="资料搜索结果"
          aria-busy={results !== deferredResults}
        >
          {deferredResults.map((result, index) => (
            <li
              key={`${result.documentId}:${result.pageNumber ?? "title"}:${index}`}
            >
              <div>
                <strong>{result.documentTitle}</strong>
                <span>
                  {result.matchKind === "page_text"
                    ? `正文匹配 · 第 ${result.pageNumber} 页`
                    : "资料标题匹配"}
                </span>
                <p>{result.excerpt}</p>
              </div>
              {result.documentKind === "pdf" ||
              result.documentKind === "image" ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onOpen(result.documentId, result.pageNumber)}
                >
                  {result.pageNumber === undefined
                    ? "打开资料"
                    : `打开第 ${result.pageNumber} 页`}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      <details className="resource-index-manager">
        <summary>管理 PDF 文字索引（{pdfs.length}）</summary>
        {pdfs.length === 0 ? (
          <p className="empty-state">导入 PDF 后可以在这里建立文字索引。</p>
        ) : (
          <ul>
            {pdfs.map((resource) => {
              const status =
                statusByDocument.get(resource.id) ?? notIndexedStatus(resource);
              const indexing = activeIndex?.documentId === resource.id;
              return (
                <li key={resource.id} className="resource-index-item">
                  <div>
                    <strong>{resource.title}</strong>
                    <span>{indexStatusText(status)}</span>
                    {indexing ? (
                      <progress
                        aria-label={`${resource.title} 索引进度`}
                        max={Math.max(1, activeIndex.totalPages)}
                        value={activeIndex.indexedPages}
                      />
                    ) : null}
                  </div>
                  <div className="resource-index-actions">
                    {indexing ? (
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={activeIndex.canceling}
                        onClick={cancelIndex}
                      >
                        {activeIndex.canceling ? "正在取消…" : "取消索引"}
                      </button>
                    ) : (
                      <IndexActions
                        resource={resource}
                        status={status}
                        disabled={
                          activeIndex !== undefined || clearingId !== undefined
                        }
                        confirmClear={confirmClearId === resource.id}
                        onStart={startIndex}
                        onClear={clearIndex}
                        onCancelClear={() => setConfirmClearId(undefined)}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </section>
  );
}

function IndexActions({
  resource,
  status,
  disabled,
  confirmClear,
  onStart,
  onClear,
  onCancelClear,
}: {
  resource: ResourceDocument;
  status: ResourceIndexStatus;
  disabled: boolean;
  confirmClear: boolean;
  onStart(resource: ResourceDocument, force: boolean): Promise<void>;
  onClear(documentId: string): Promise<void>;
  onCancelClear(): void;
}) {
  if (status.state === "not_indexed") {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => void onStart(resource, false)}
      >
        建立文字索引
      </button>
    );
  }
  if (confirmClear) {
    return (
      <>
        <button
          type="button"
          className="danger-button"
          disabled={disabled}
          onClick={() => void onClear(resource.id)}
        >
          确认清除索引
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onCancelClear}
        >
          取消
        </button>
      </>
    );
  }
  const resumable = status.state === "interrupted" || status.state === "failed";
  return (
    <>
      {resumable ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => void onStart(resource, false)}
        >
          继续索引
        </button>
      ) : null}
      <button
        type="button"
        className="secondary-button"
        disabled={disabled}
        onClick={() => void onStart(resource, true)}
      >
        重新建立
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={disabled}
        onClick={() => void onClear(resource.id)}
      >
        清除索引
      </button>
    </>
  );
}

function replaceStatus(
  statuses: ResourceIndexStatus[],
  next: ResourceIndexStatus,
): ResourceIndexStatus[] {
  const found = statuses.some(
    (status) => status.documentId === next.documentId,
  );
  return found
    ? statuses.map((status) =>
        status.documentId === next.documentId ? next : status,
      )
    : [...statuses, next];
}

function notIndexedStatus(resource: ResourceDocument): ResourceIndexStatus {
  return {
    documentId: resource.id,
    state: "not_indexed",
    totalPages: resource.pageCount,
    indexedPages: 0,
    textPages: 0,
    chunkCount: 0,
  };
}

function indexStatusText(status: ResourceIndexStatus): string {
  const progress =
    status.totalPages === undefined
      ? ""
      : ` · ${status.indexedPages}/${status.totalPages} 页`;
  const detail =
    status.textPages === 0
      ? ""
      : ` · ${status.textPages} 页有文字 · ${status.chunkCount} 个片段`;
  return `${
    {
      not_indexed: "尚未索引",
      running: "正在索引",
      interrupted: "上次索引已中断",
      failed: "索引失败",
      ready: "可以搜索",
      empty: "未检测到文字层",
    }[status.state]
  }${progress}${detail}`;
}

function isCanceledIndexError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ResourceIndexCanceledError" ||
      error.message === "RESOURCE_INDEX_CANCELED")
  );
}
