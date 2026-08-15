import { useState, type FormEvent } from "react";

import type { ResourceSearchResult } from "../../../shared/tauri/resourceSearchClient";
import type { SelectedPlanningContext } from "../planningChatModel";

interface ContextPanelProps {
  searchQuery: string;
  searchResults: ResourceSearchResult[];
  selectedContexts: SelectedPlanningContext[];
  busy: boolean;
  onSearchQueryChange(value: string): void;
  onSearch(event: FormEvent): void;
  onToggle(result: ResourceSearchResult): void;
}

export function ContextPanel({
  searchQuery,
  searchResults,
  selectedContexts,
  busy,
  onSearchQueryChange,
  onSearch,
  onToggle,
}: ContextPanelProps) {
  const [open, setOpen] = useState(true);
  return (
    <details
      className="planning-chat-context-drawer"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        资料上下文 <span>{selectedContexts.length} / 6 页</span>
      </summary>
      <section
        className="planning-chat-context-panel"
        aria-labelledby="planning-context-title"
      >
        <h3 id="planning-context-title">资料上下文</h3>
        <form className="planning-context-search" onSubmit={onSearch}>
          <label>
            搜索本地资料
            <input
              type="search"
              maxLength={100}
              value={searchQuery}
              placeholder="例如：强化阶段的每日安排"
              disabled={busy}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            搜索页码
          </button>
        </form>
        {searchResults.length === 0 ? null : (
          <ul className="planning-context-results">
            {searchResults.map((result) => {
              const selected = selectedContexts.some(
                (context) =>
                  context.selection.documentId === result.documentId &&
                  context.selection.pageNumber === result.pageNumber,
              );
              return (
                <li key={`${result.documentId}:${result.pageNumber}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={
                        busy || (!selected && selectedContexts.length >= 6)
                      }
                      onChange={() => onToggle(result)}
                    />
                    <span>
                      <strong>
                        {result.documentTitle} · 第 {result.pageNumber} 页
                      </strong>
                      <small>{result.excerpt}</small>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="planning-selected-contexts" aria-live="polite">
          <strong>已选 {selectedContexts.length} / 6 页</strong>
          {selectedContexts.map((context) => (
            <button
              key={`${context.selection.documentId}:${context.selection.pageNumber}`}
              type="button"
              className="secondary-button"
              disabled={busy}
              aria-label={`移除上下文：${context.title} 第 ${context.selection.pageNumber} 页`}
              onClick={() =>
                onToggle({
                  documentId: context.selection.documentId,
                  documentTitle: context.title,
                  documentKind: "pdf",
                  pageNumber: context.selection.pageNumber,
                  excerpt: context.excerpt,
                  matchKind: "page_text",
                })
              }
            >
              {context.title} · 第 {context.selection.pageNumber} 页 ×
            </button>
          ))}
        </div>
      </section>
    </details>
  );
}
