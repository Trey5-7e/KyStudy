import { useCallback, useEffect, useRef, useState } from "react";

import {
  executeAiCall,
  normalizeAiError,
  previewAiCall,
  type AiCallPreview,
} from "../../shared/tauri/aiClient";
import type { CycleScheduleMode } from "../../shared/tauri/cyclePlanClient";
import {
  listResources,
  type ResourceDocument,
} from "../../shared/tauri/resourceClient";
import {
  normalizeResourceSearchError,
  searchResources,
  type ResourceSearchResult,
} from "../../shared/tauri/resourceSearchClient";

export interface CyclePlanAiDraft {
  name: string;
  totalUnits: string;
  unitLabel: string;
  startDate: string;
  deadline: string;
  studyDaysPerUnit: string;
  scheduleMode: CycleScheduleMode;
}

export function CyclePlanAiAssistant({
  current,
  onAccept,
}: {
  current: CyclePlanAiDraft;
  onAccept(value: CyclePlanAiDraft): void;
}) {
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<AiCallPreview>();
  const [prompt, setPrompt] = useState("");
  const [cards, setCards] = useState<CyclePlanAiDraft[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ResourceSearchResult[]>(
    [],
  );
  const [planningResources, setPlanningResources] = useState<
    ResourceDocument[]
  >([]);
  const [selectedResources, setSelectedResources] = useState<
    ResourceDocument[]
  >([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourcesError, setResourcesError] = useState("");
  const [searchAttempted, setSearchAttempted] = useState(false);
  const [selectedContexts, setSelectedContexts] = useState<
    ResourceSearchResult[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const resourceRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const previewRequestRef = useRef(0);

  const loadPlanningResources = useCallback(async () => {
    const requestId = ++resourceRequestRef.current;
    setResourcesLoading(true);
    setResourcesError("");
    try {
      const resources = filterPlanningResources(await listResources());
      if (
        !isCurrentCyclePlanRequest(
          requestId,
          resourceRequestRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setPlanningResources(resources);
    } catch {
      if (
        !isCurrentCyclePlanRequest(
          requestId,
          resourceRequestRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setResourcesError(
        "规划资料列表暂时无法读取。你仍可直接输入关键词建立计划，或稍后重试。",
      );
    } finally {
      if (
        isCurrentCyclePlanRequest(
          requestId,
          resourceRequestRef.current,
          mountedRef.current,
        )
      ) {
        setResourcesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++resourceRequestRef.current;
    let active = true;
    void listResources().then(
      (resources) => {
        if (
          active &&
          isCurrentCyclePlanRequest(
            requestId,
            resourceRequestRef.current,
            mountedRef.current,
          )
        ) {
          setPlanningResources(filterPlanningResources(resources));
          setResourcesError("");
          setResourcesLoading(false);
        }
      },
      () => {
        if (
          active &&
          isCurrentCyclePlanRequest(
            requestId,
            resourceRequestRef.current,
            mountedRef.current,
          )
        ) {
          setResourcesError(
            "规划资料列表暂时无法读取。你仍可直接输入关键词建立计划，或稍后重试。",
          );
          setResourcesLoading(false);
        }
      },
    );
    return () => {
      active = false;
      mountedRef.current = false;
      resourceRequestRef.current += 1;
      searchRequestRef.current += 1;
      previewRequestRef.current += 1;
    };
  }, []);

  const prepare = async () => {
    const instructionSnapshot = instruction.trim();
    if (instructionSnapshot === "" || busy) return;
    const requestId = ++previewRequestRef.current;
    const nextPrompt = buildCyclePlanPrompt(
      instructionSnapshot,
      current,
      selectedContexts,
      cards,
    );
    setBusy(true);
    setError("");
    try {
      const nextPreview = await previewAiCall({
        prompt: nextPrompt,
        maxOutputTokens: 700,
      });
      if (
        !isCurrentCyclePlanRequest(
          requestId,
          previewRequestRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setPrompt(nextPrompt);
      setPreview(nextPreview);
    } catch (operationError: unknown) {
      if (
        !isCurrentCyclePlanRequest(
          requestId,
          previewRequestRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      const normalized = normalizeAiError(operationError);
      setError(`${normalized.message}${normalized.action}`);
    } finally {
      if (
        isCurrentCyclePlanRequest(
          requestId,
          previewRequestRef.current,
          mountedRef.current,
        )
      ) {
        setBusy(false);
      }
    }
  };

  const search = async () => {
    const query = searchQuery.trim();
    if (query === "" || busy) return;
    const requestId = ++searchRequestRef.current;
    const scope = selectedResources;
    setBusy(true);
    setError("");
    setSearchResults([]);
    setSearchAttempted(true);
    try {
      const results = await searchResources(query, 20);
      if (
        !isCurrentCyclePlanRequest(
          requestId,
          searchRequestRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setSearchResults(filterSearchResultsByResources(results, scope));
    } catch (operationError: unknown) {
      if (
        !isCurrentCyclePlanRequest(
          requestId,
          searchRequestRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      const normalized = normalizeResourceSearchError(operationError);
      setError(`${normalized.message}${normalized.action}`);
    } finally {
      if (
        isCurrentCyclePlanRequest(
          requestId,
          searchRequestRef.current,
          mountedRef.current,
        )
      ) {
        setBusy(false);
      }
    }
  };

  const toggleResource = (resource: ResourceDocument) => {
    if (busy) return;
    const nextResources = togglePlanningResourceSelection(
      selectedResources,
      resource,
    );
    setSelectedResources(nextResources);
    setSelectedContexts((contexts) =>
      filterContextsAfterResourceToggle(contexts, nextResources, resource.id),
    );
    searchRequestRef.current += 1;
    const resetSearch = resetCyclePlanSearchState();
    setSearchResults(resetSearch.results);
    setSearchAttempted(resetSearch.attempted);
    setError("");
    previewRequestRef.current += 1;
    setPreview(undefined);
  };

  const toggleContext = (result: ResourceSearchResult) => {
    if (busy) return;
    const key = contextKey(result);
    setSelectedContexts((currentContexts) => {
      const selected = currentContexts.some((item) => contextKey(item) === key);
      if (selected) {
        return currentContexts.filter((item) => contextKey(item) !== key);
      }
      return currentContexts.length >= 6
        ? currentContexts
        : [...currentContexts, result];
    });
    previewRequestRef.current += 1;
    setPreview(undefined);
  };

  const execute = async () => {
    if (preview === undefined || !preview.allowed || busy) return;
    const currentPrompt = buildCyclePlanPrompt(
      instruction.trim(),
      current,
      selectedContexts,
      cards,
    );
    if (!isCyclePlanPreviewCurrent(prompt, currentPrompt)) {
      previewRequestRef.current += 1;
      setPreview(undefined);
      setPrompt("");
      return;
    }
    const requestId = ++previewRequestRef.current;
    setBusy(true);
    setError("");
    try {
      const result = await executeAiCall({ prompt, maxOutputTokens: 700 });
      if (
        !isCurrentCyclePlanRequest(
          requestId,
          previewRequestRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setCards(parseCyclePlanCards(result.responseText));
      setPreview(undefined);
    } catch (operationError: unknown) {
      if (
        !isCurrentCyclePlanRequest(
          requestId,
          previewRequestRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      if (
        operationError instanceof Error &&
        operationError.message === "AI_PLAN_CARDS_INVALID"
      ) {
        setError(
          "AI 没有返回可用的计划卡片。请换一种更明确的说法后重试，正式计划未发生变化。",
        );
        return;
      }
      const normalized = normalizeAiError(operationError);
      setError(`${normalized.message}${normalized.action}`);
    } finally {
      if (
        isCurrentCyclePlanRequest(
          requestId,
          previewRequestRef.current,
          mountedRef.current,
        )
      ) {
        setBusy(false);
      }
    }
  };

  return (
    <details className="cycle-ai-assistant">
      <summary>
        <span>
          <strong>AI 辅助规划（可选）</strong>
          <small>一句话或结合本地资料生成周期计划卡片</small>
        </span>
      </summary>
      <p>
        只有你选择的资料页片段和下方输入内容会进入外发预览；AI
        结果需采用后再手动保存。
      </p>

      <section
        className="cycle-ai-context"
        aria-labelledby="cycle-ai-context-title"
      >
        <div className="cycle-ai-section-heading">
          <strong id="cycle-ai-context-title">1. 引用资料（可跳过）</strong>
          <span>{selectedContexts.length} / 6 页</span>
        </div>
        <div className="cycle-ai-resource-picker">
          <div className="cycle-ai-section-heading">
            <strong>已导入的规划资料</strong>
            <span>{selectedResources.length} 个已选</span>
          </div>
          {resourcesLoading ? (
            <p className="form-hint" role="status">
              正在读取规划资料…
            </p>
          ) : resourcesError !== "" ? (
            <div className="cycle-ai-resource-status" role="alert">
              <p>{resourcesError}</p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || resourcesLoading}
                onClick={() => void loadPlanningResources()}
              >
                重试
              </button>
            </div>
          ) : planningResources.length === 0 ? (
            <p className="form-hint" role="status">
              暂无标记为“规划资料”的已导入文件；你仍可使用下方关键词搜索。
            </p>
          ) : (
            <ul className="cycle-ai-context-results cycle-ai-resource-results">
              {planningResources.map((resource) => {
                const selected = selectedResources.some(
                  (item) => item.id === resource.id,
                );
                return (
                  <li key={resource.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={busy}
                        onChange={() => toggleResource(resource)}
                      />
                      <span>
                        <strong>{resource.title}</strong>
                        <small>
                          {resource.kind === "pdf" ? "PDF" : "本地资料"}
                          {resource.pageCount === undefined
                            ? ""
                            : ` · ${resource.pageCount} 页`}
                        </small>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="cycle-ai-search-row">
          <label>
            <span className="sr-only">搜索已索引的规划资料</span>
            <input
              name="cycle-ai-resource-search"
              type="search"
              autoComplete="off"
              maxLength={100}
              placeholder="搜索资料内容，例如：强化阶段安排…"
              disabled={busy}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || searchQuery.trim() === ""}
            onClick={() => void search()}
          >
            搜索页码
          </button>
        </div>
        <p className="form-hint cycle-ai-search-scope">
          {selectedResources.length === 0
            ? "未选择资料时，将在全部已索引资料中搜索。"
            : `当前仅搜索已选的 ${selectedResources.length} 个规划资料。`}
        </p>
        {searchAttempted && searchResults.length === 0 ? (
          <p className="form-hint" role="status">
            {selectedResources.length === 0
              ? "没有找到可引用的页片段，请换一个关键词。"
              : "已选规划资料中没有找到匹配页片段，请换关键词或取消资料筛选。"}
          </p>
        ) : searchResults.length === 0 ? null : (
          <ul className="cycle-ai-context-results">
            {searchResults.map((result) => {
              const selected = selectedContexts.some(
                (item) => contextKey(item) === contextKey(result),
              );
              return (
                <li key={contextKey(result)}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={
                        busy || (!selected && selectedContexts.length >= 6)
                      }
                      onChange={() => toggleContext(result)}
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
      </section>

      <div className="cycle-ai-section-heading">
        <strong>2. 描述目标或继续调整</strong>
        <span>最多生成 5 张草案</span>
      </div>
      <div className="cycle-ai-input-row">
        <label>
          <span className="sr-only">用一句话描述计划</span>
          <textarea
            name="cycle-ai-instruction"
            autoComplete="off"
            rows={2}
            maxLength={1_000}
            disabled={busy}
            placeholder="例如：参考所选资料，从今天到 12 月 21 日刷 20 套卷，两天一套…"
            value={instruction}
            onChange={(event) => {
              setInstruction(event.target.value);
              previewRequestRef.current += 1;
              setPreview(undefined);
            }}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={busy || instruction.trim() === ""}
          onClick={() => void prepare()}
        >
          生成外发预览
        </button>
      </div>
      {preview === undefined ||
      !isCyclePlanPreviewCurrent(
        prompt,
        buildCyclePlanPrompt(
          instruction.trim(),
          current,
          selectedContexts,
          cards,
        ),
      ) ? null : (
        <section
          className="cycle-ai-preview"
          aria-labelledby="cycle-ai-preview-title"
        >
          <div className="cycle-ai-preview-summary">
            <h4 id="cycle-ai-preview-title">确认本次外发内容</h4>
            <dl>
              <div>
                <dt>目标</dt>
                <dd>{preview.destination}</dd>
              </div>
              <div>
                <dt>Token 上限</dt>
                <dd>{preview.projectedTokens}</dd>
              </div>
              <div>
                <dt>引用上下文</dt>
                <dd>{selectedContexts.length} 页</dd>
              </div>
            </dl>
          </div>
          {selectedContexts.length === 0 ? null : (
            <ul className="cycle-ai-preview-contexts" aria-label="引用上下文">
              {selectedContexts.map((context) => (
                <li key={contextKey(context)}>
                  {context.documentTitle} · 第 {context.pageNumber} 页
                </li>
              ))}
            </ul>
          )}
          <details className="cycle-ai-prompt-preview">
            <summary>查看完整外发文本</summary>
            <pre>{prompt}</pre>
          </details>
          <div className="cycle-ai-preview-actions">
            <button
              type="button"
              disabled={busy || !preview.allowed}
              onClick={() => void execute()}
            >
              确认发送
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                previewRequestRef.current += 1;
                setPreview(undefined);
                setPrompt("");
              }}
            >
              取消
            </button>
          </div>
        </section>
      )}
      {cards.length === 0 ? null : (
        <div className="cycle-ai-card-list">
          {cards.map((card, index) => (
            <article key={`${card.name}-${index}`}>
              <label>
                名称
                <input
                  name={`cycle-ai-card-${index}-name`}
                  autoComplete="off"
                  disabled={busy}
                  value={card.name}
                  onChange={(event) =>
                    setCards(
                      updateCard(cards, index, { name: event.target.value }),
                    )
                  }
                />
              </label>
              <div>
                <label>
                  数量
                  <input
                    name={`cycle-ai-card-${index}-total`}
                    autoComplete="off"
                    disabled={busy}
                    type="number"
                    min="1"
                    max="500"
                    value={card.totalUnits}
                    onChange={(event) =>
                      setCards(
                        updateCard(cards, index, {
                          totalUnits: event.target.value,
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  单位
                  <input
                    name={`cycle-ai-card-${index}-unit`}
                    autoComplete="off"
                    disabled={busy}
                    maxLength={20}
                    value={card.unitLabel}
                    onChange={(event) =>
                      setCards(
                        updateCard(cards, index, {
                          unitLabel: event.target.value,
                        }),
                      )
                    }
                  />
                </label>
                <label>
                  每单位学习日
                  <input
                    name={`cycle-ai-card-${index}-study-days`}
                    autoComplete="off"
                    disabled={busy}
                    type="number"
                    min="1"
                    max="30"
                    value={card.studyDaysPerUnit}
                    onChange={(event) =>
                      setCards(
                        updateCard(cards, index, {
                          studyDaysPerUnit: event.target.value,
                        }),
                      )
                    }
                  />
                </label>
              </div>
              <p>
                {card.startDate} 至 {card.deadline} ·{" "}
                {card.scheduleMode === "rhythm" ? "保持节奏" : "均匀分布"}
              </p>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAccept(card)}
                >
                  采用这张草案
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    setCards(
                      cards.filter((_, cardIndex) => cardIndex !== index),
                    )
                  }
                >
                  忽略
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {error === "" ? null : (
        <p className="mindmap-form-error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}

export function parseCyclePlanCards(value: string): CyclePlanAiDraft[] {
  const match = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source =
    match?.[1] ?? value.slice(value.indexOf("["), value.lastIndexOf("]") + 1);
  let decoded: unknown;
  try {
    decoded = JSON.parse(source);
  } catch {
    throw new Error("AI_PLAN_CARDS_INVALID");
  }
  if (!Array.isArray(decoded)) throw new Error("AI_PLAN_CARDS_INVALID");
  const cards = decoded.slice(0, 5).map(parseCard);
  if (cards.length === 0) throw new Error("AI_PLAN_CARDS_INVALID");
  return cards;
}

function parseCard(value: unknown): CyclePlanAiDraft {
  if (typeof value !== "object" || value === null)
    throw new Error("AI_PLAN_CARDS_INVALID");
  const item = value as Record<string, unknown>;
  const strings = ["name", "unitLabel", "startDate", "deadline"] as const;
  if (
    !strings.every((key) => typeof item[key] === "string") ||
    !positiveInteger(item.totalUnits) ||
    item.totalUnits > 500 ||
    !positiveInteger(item.studyDaysPerUnit) ||
    item.studyDaysPerUnit > 30 ||
    !["rhythm", "even"].includes(String(item.scheduleMode))
  ) {
    throw new Error("AI_PLAN_CARDS_INVALID");
  }
  const startDate = String(item.startDate);
  const deadline = String(item.deadline);
  if (
    !ISO_DATE.test(startDate) ||
    !ISO_DATE.test(deadline) ||
    deadline < startDate
  ) {
    throw new Error("AI_PLAN_CARDS_INVALID");
  }
  return {
    name: String(item.name).slice(0, 120),
    totalUnits: String(item.totalUnits),
    unitLabel: String(item.unitLabel).slice(0, 20),
    startDate,
    deadline,
    studyDaysPerUnit: String(item.studyDaysPerUnit),
    scheduleMode: item.scheduleMode as CycleScheduleMode,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function updateCard(
  cards: CyclePlanAiDraft[],
  index: number,
  patch: Partial<CyclePlanAiDraft>,
): CyclePlanAiDraft[] {
  return cards.map((card, cardIndex) =>
    cardIndex === index ? { ...card, ...patch } : card,
  );
}

export function buildCyclePlanPrompt(
  instruction: string,
  current: CyclePlanAiDraft,
  contexts: ResourceSearchResult[],
  previousCards: CyclePlanAiDraft[],
): string {
  const sources = contexts.map((context, index) => {
    const sourceTitle =
      context.documentTitle.trim().replaceAll("\\", "/").split("/").pop() ||
      "未命名资料";
    return `[资料${index + 1}] ${sourceTitle} 第 ${context.pageNumber} 页\n${context.excerpt.slice(0, 1_000)}`;
  });
  return [
    "把用户的考研周期学习目标转换为 1 到 3 个简洁方案。只返回 JSON 数组，不要 Markdown 和解释。",
    '每项字段固定为：{"name":"计划名","totalUnits":20,"unitLabel":"套","startDate":"YYYY-MM-DD","deadline":"YYYY-MM-DD","studyDaysPerUnit":2,"scheduleMode":"rhythm或even"}。',
    "不要生成逐日任务；日期缺失时参考当前表单；rhythm 表示按固定节奏，even 表示均匀铺到截止日。",
    "资料只作为参考，不要照抄与用户目标无关的内容；资料不足时仍按用户明确要求生成。",
    `当前表单参考：${JSON.stringify(current)}`,
    previousCards.length === 0
      ? "当前没有上一轮草案。"
      : `上一轮草案（用户可能要求调整）：${JSON.stringify(previousCards)}`,
    sources.length === 0
      ? "本轮未选择资料。"
      : `本轮明确选择的资料：\n${sources.join("\n\n")}`,
    `用户要求：${instruction.trim()}`,
  ].join("\n");
}

export function isCyclePlanPreviewCurrent(
  preparedPrompt: string,
  currentPrompt: string,
): boolean {
  return preparedPrompt !== "" && preparedPrompt === currentPrompt;
}

function contextKey(result: ResourceSearchResult): string {
  return `${result.documentId}:${result.pageNumber ?? 0}`;
}

export function filterPlanningResources(
  resources: ResourceDocument[],
): ResourceDocument[] {
  return resources.filter((resource) => resource.role === "planning");
}

export function filterSearchResultsByResources(
  results: ResourceSearchResult[],
  selectedResources: ResourceDocument[],
): ResourceSearchResult[] {
  const selectedIds = new Set(selectedResources.map((resource) => resource.id));
  return results.filter(
    (result) =>
      result.matchKind === "page_text" &&
      result.pageNumber !== undefined &&
      (selectedIds.size === 0 || selectedIds.has(result.documentId)),
  );
}

export function togglePlanningResourceSelection(
  selectedResources: ResourceDocument[],
  resource: ResourceDocument,
): ResourceDocument[] {
  return selectedResources.some((item) => item.id === resource.id)
    ? selectedResources.filter((item) => item.id !== resource.id)
    : [...selectedResources, resource];
}

export function filterContextsAfterResourceToggle(
  contexts: ResourceSearchResult[],
  nextResources: ResourceDocument[],
  removedResourceId?: string,
): ResourceSearchResult[] {
  if (nextResources.length === 0) {
    return removedResourceId === undefined
      ? contexts
      : contexts.filter((context) => context.documentId !== removedResourceId);
  }
  const nextResourceIds = new Set(nextResources.map((resource) => resource.id));
  return contexts.filter((context) => nextResourceIds.has(context.documentId));
}

export function resetCyclePlanSearchState(): {
  results: ResourceSearchResult[];
  attempted: boolean;
} {
  return { results: [], attempted: false };
}

export function isCurrentCyclePlanRequest(
  requestId: number,
  currentRequestId: number,
  mounted: boolean,
): boolean {
  return mounted && requestId === currentRequestId;
}
