import { useEffect, useRef, useState, type FormEvent } from "react";

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
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { Input } from "../../shared/ui/Input";
import { SectionHeader } from "../../shared/ui/SectionHeader";
import { StatusBanner } from "../../shared/ui/StatusBanner";
import { ResourceIndexManager } from "./ResourceIndexManager";
import { ResourceSearchResults } from "./ResourceSearchResults";
import { createLocalPdfPageRecognizer } from "./pdf/pdfOcr";
import {
  isCanceledResourceIndexError,
  replaceResourceIndexStatus,
  type ActiveResourceIndex,
} from "./resourceIndexModel";
import { formatResourceCount } from "./resourceListModel";

interface ResourceSearchPanelProps {
  resources: ResourceDocument[];
  onOpen(documentId: string, page?: number): void;
}

export function ResourceSearchPanel({
  resources,
  onOpen,
}: ResourceSearchPanelProps) {
  const [statuses, setStatuses] = useState<ResourceIndexStatus[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResourceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState<ActiveResourceIndex>();
  const [clearingId, setClearingId] = useState<string>();
  const [confirmClearId, setConfirmClearId] = useState<string>();
  const [error, setError] = useState<ResourceSearchCommandError>();
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const searchRequestRef = useRef(0);

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
      searchRequestRef.current += 1;
    };
  }, []);

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
      let recognizePage;
      try {
        recognizePage = await createLocalPdfPageRecognizer();
      } catch {
        recognizePage = undefined;
      }
      await indexer.indexPdfText(
        descriptor,
        force,
        controller.signal,
        (status) => {
          setStatuses((current) => replaceResourceIndexStatus(current, status));
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
        { recognizePage },
      );
    } catch (indexError: unknown) {
      if (
        !controller.signal.aborted &&
        !isCanceledResourceIndexError(indexError)
      ) {
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
      setStatuses((current) => replaceResourceIndexStatus(current, cleared));
      setConfirmClearId(undefined);
    } catch (clearError: unknown) {
      setError(normalizeResourceSearchError(clearError));
    } finally {
      setClearingId(undefined);
    }
  };

  const submitSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const searchQuery = query.trim();
    if (searchQuery === "") {
      return;
    }
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    setSearching(true);
    setError(undefined);
    try {
      const nextResults = await searchResources(searchQuery);
      if (requestId !== searchRequestRef.current) {
        return;
      }
      setResults(nextResults);
      setSearched(true);
    } catch (searchError: unknown) {
      if (requestId === searchRequestRef.current) {
        setError(normalizeResourceSearchError(searchError));
      }
    } finally {
      if (requestId === searchRequestRef.current) {
        setSearching(false);
      }
    }
  };

  return (
    <section
      className="resource-search"
      aria-labelledby="resource-search-title"
    >
      <SectionHeader
        id="resource-search-title"
        title="搜索资料原文并回到 PDF 页码"
        description="全文搜索与资料浏览分开，搜索结果仍可直接跳回阅读器。"
        actions={
          <span className="resource-search-count" aria-live="polite">
            {formatResourceCount(
              statuses.filter((status) => status.state === "ready").length,
            )}{" "}
            份可搜索
          </span>
        }
      />

      {error === undefined ? null : (
        <StatusBanner tone="error" title={error.message}>
          <p>{error.action}</p>
        </StatusBanner>
      )}

      <form className="resource-search-form" onSubmit={submitSearch}>
        <Field
          label="搜索词"
          htmlFor="resource-search-query"
          description="支持标题和已建立文字索引的 PDF 正文。"
        >
          <Input
            id="resource-search-query"
            name="resource-search-query"
            type="search"
            required
            maxLength={100}
            autoComplete="off"
            placeholder="例如：操作系统强化阶段…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          type="submit"
          disabled={searching || query.trim() === ""}
        >
          {searching ? "正在搜索…" : "搜索本地资料"}
        </Button>
      </form>

      <ResourceSearchResults
        results={results}
        searching={searching}
        searched={searched}
        onOpen={onOpen}
      />

      <ResourceIndexManager
        resources={resources}
        statuses={statuses}
        activeIndex={activeIndex}
        clearingId={clearingId}
        confirmClearId={confirmClearId}
        onStart={startIndex}
        onCancel={cancelIndex}
        onClear={clearIndex}
        onCancelClear={() => setConfirmClearId(undefined)}
      />
    </section>
  );
}
