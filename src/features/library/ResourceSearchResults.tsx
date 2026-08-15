import { useDeferredValue } from "react";

import { PageEmpty, PageStatus } from "../../shared/components/PagePrimitives";
import { Button } from "../../shared/ui/Button";
import type { ResourceSearchResult } from "../../shared/tauri/resourceSearchClient";

interface ResourceSearchResultsProps {
  results: ResourceSearchResult[];
  searching: boolean;
  searched: boolean;
  onOpen(documentId: string, page?: number): void;
}

/** Renders the asynchronous search state without coupling it to index controls. */
export function ResourceSearchResults({
  results,
  searching,
  searched,
  onOpen,
}: ResourceSearchResultsProps) {
  const deferredResults = useDeferredValue(results);

  const showEmpty = searched && deferredResults.length === 0 && !searching;

  return (
    <>
      {searching ? <PageStatus tone="loading" title="正在搜索资料…" /> : null}
      {showEmpty ? (
        <PageEmpty
          headingLevel={3}
          title="没有找到匹配内容"
          description="可以换一个关键词。"
        />
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
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onOpen(result.documentId, result.pageNumber)}
                >
                  {result.pageNumber === undefined
                    ? "打开资料"
                    : `打开第 ${result.pageNumber} 页`}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
