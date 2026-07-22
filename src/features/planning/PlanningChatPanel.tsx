import { useEffect, useState, type FormEvent } from "react";

import {
  createPlanningConversation,
  executePlanningChat,
  listPlanningConversations,
  normalizePlanningChatError,
  previewPlanningChat,
  savePlanningReplyAsDraft,
  type PlanningChatPreview,
  type PlanningChatRequest,
  type PlanningContextSelection,
  type PlanningConversation,
} from "../../shared/tauri/planningChatClient";
import {
  normalizeResourceSearchError,
  searchResources,
  type ResourceSearchResult,
} from "../../shared/tauri/resourceSearchClient";
import type { AiCommandError } from "../../shared/tauri/aiClient";

interface SelectedContext {
  selection: PlanningContextSelection;
  title: string;
  excerpt: string;
}

interface PlanningChatPanelProps {
  onOpenReference(documentId: string, page: number): void;
  onDraftCreated(planId: string): Promise<void>;
}

export function PlanningChatPanel({
  onOpenReference,
  onDraftCreated,
}: PlanningChatPanelProps) {
  const [conversations, setConversations] = useState<PlanningConversation[]>(
    [],
  );
  const [activeId, setActiveId] = useState<string>();
  const [newTitle, setNewTitle] = useState("我的考研规划讨论");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ResourceSearchResult[]>(
    [],
  );
  const [selectedContexts, setSelectedContexts] = useState<SelectedContext[]>(
    [],
  );
  const [question, setQuestion] = useState("");
  const [outputLimit, setOutputLimit] = useState("800");
  const [preview, setPreview] = useState<PlanningChatPreview>();
  const [preparedRequest, setPreparedRequest] = useState<PlanningChatRequest>();
  const [confirmed, setConfirmed] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<AiCommandError>();

  useEffect(() => {
    let active = true;
    void listPlanningConversations().then(
      (loaded) => {
        if (active) {
          setConversations(loaded);
          setActiveId(loaded[0]?.id);
        }
      },
      (reason: unknown) => {
        if (active) {
          setError(normalizePlanningChatError(reason));
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeId,
  );
  const lastAssistantMessage = [...(activeConversation?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");

  const invalidatePreview = () => {
    setPreview(undefined);
    setPreparedRequest(undefined);
    setConfirmed(false);
  };

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    setNotice("");
    try {
      await operation();
    } catch (reason: unknown) {
      setError(normalizePlanningChatError(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const createConversation = (event: FormEvent) => {
    event.preventDefault();
    void run("create", async () => {
      const created = await createPlanningConversation(newTitle);
      setConversations((current) => [created, ...current]);
      setActiveId(created.id);
      setDraftTitle(`${created.title} · AI 草案`);
      invalidatePreview();
    });
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void run("search", async () => {
      try {
        const results = await searchResources(searchQuery, 30);
        setSearchResults(
          results.filter(
            (result) =>
              result.matchKind === "page_text" &&
              result.pageNumber !== undefined,
          ),
        );
      } catch (reason: unknown) {
        const normalized = normalizeResourceSearchError(reason);
        setError(normalized);
      }
    });
  };

  const toggleContext = (result: ResourceSearchResult) => {
    const pageNumber = result.pageNumber;
    if (pageNumber === undefined) {
      return;
    }
    const key = `${result.documentId}:${pageNumber}`;
    setSelectedContexts((current) => {
      const exists = current.some(
        (context) =>
          `${context.selection.documentId}:${context.selection.pageNumber}` ===
          key,
      );
      if (exists) {
        return current.filter(
          (context) =>
            `${context.selection.documentId}:${context.selection.pageNumber}` !==
            key,
        );
      }
      if (current.length >= 6) {
        return current;
      }
      return [
        ...current,
        {
          selection: {
            documentId: result.documentId,
            pageNumber,
            searchQuery,
          },
          title: result.documentTitle,
          excerpt: result.excerpt,
        },
      ];
    });
    invalidatePreview();
  };

  const prepare = (event: FormEvent) => {
    event.preventDefault();
    if (activeId === undefined) {
      return;
    }
    const request: PlanningChatRequest = {
      conversationId: activeId,
      question,
      contexts: selectedContexts.map((context) => context.selection),
      maxOutputTokens: Number(outputLimit),
    };
    void run("preview", async () => {
      setPreview(await previewPlanningChat(request));
      setPreparedRequest(request);
      setConfirmed(false);
    });
  };

  const execute = () => {
    if (
      preview === undefined ||
      preparedRequest === undefined ||
      !confirmed ||
      !preview.preview.allowed
    ) {
      return;
    }
    void run("execute", async () => {
      const reply = await executePlanningChat({
        ...preparedRequest,
        confirmedPrompt: preview.preview.prompt,
      });
      setConversations((current) => [
        reply.conversation,
        ...current.filter(
          (conversation) => conversation.id !== reply.conversation.id,
        ),
      ]);
      setQuestion("");
      setSelectedContexts([]);
      setSearchResults([]);
      setDraftTitle(`${reply.conversation.title} · AI 草案`);
      invalidatePreview();
      setNotice(
        reply.result.cacheHit
          ? "已从本地缓存生成回复，没有新增 Token。"
          : "AI 回复已保存到本地对话；尚未写入个人计划。",
      );
    });
  };

  const saveDraft = () => {
    if (lastAssistantMessage === undefined) {
      return;
    }
    void run("draft", async () => {
      const planId = await savePlanningReplyAsDraft(
        lastAssistantMessage.id,
        draftTitle,
      );
      await onDraftCreated(planId);
      setNotice("AI 回复已复制为待确认计划草案，原对话保持不变。");
    });
  };

  const chooseConversation = (conversation: PlanningConversation) => {
    setActiveId(conversation.id);
    setDraftTitle(`${conversation.title} · AI 草案`);
    setSelectedContexts([]);
    setSearchResults([]);
    invalidatePreview();
  };

  return (
    <section
      className="planning-chat-card"
      aria-labelledby="planning-chat-title"
    >
      <div className="planning-chat-heading">
        <div>
          <p className="section-label">M9 · 资料驱动的 AI 规划</p>
          <h2 id="planning-chat-title">选择资料，再与 AI 完善规划</h2>
          <p>最多选择 6 个已索引页码；只有外发预览中显示的文字会被发送。</p>
        </div>
        <span>{conversations.length} 段本地对话</span>
      </div>

      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
        </div>
      )}
      {notice === "" ? null : (
        <p className="ai-notice" role="status">
          {notice}
        </p>
      )}

      <div className="planning-chat-layout">
        <aside className="planning-conversation-list">
          <form onSubmit={createConversation}>
            <label>
              新对话标题
              <input
                maxLength={120}
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy !== undefined}>
              新建规划对话
            </button>
          </form>
          <nav aria-label="规划对话列表">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={
                  conversation.id === activeId ? "plan-list-active" : undefined
                }
                onClick={() => chooseConversation(conversation)}
              >
                <strong>{conversation.title}</strong>
                <span>{conversation.messages.length} 条消息</span>
              </button>
            ))}
          </nav>
        </aside>

        <div className="planning-chat-workspace">
          {activeConversation === undefined ? (
            <p className="empty-state">先新建一段规划对话。</p>
          ) : (
            <>
              <div className="planning-message-list" aria-live="polite">
                {activeConversation.messages.length === 0 ? (
                  <p className="empty-state">
                    搜索资料页并提出第一个规划问题。
                  </p>
                ) : null}
                {activeConversation.messages.map((message) => (
                  <article
                    key={message.id}
                    className={`planning-message planning-message-${message.role}`}
                  >
                    <strong>
                      {message.role === "user" ? "你" : "AI 建议"}
                    </strong>
                    <p>{message.content}</p>
                    {message.sources.length === 0 ? null : (
                      <div className="planning-message-sources">
                        {message.sources.map((source) => (
                          <button
                            key={`${source.documentId}:${source.pageNumber}`}
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              onOpenReference(
                                source.documentId,
                                source.pageNumber,
                              )
                            }
                          >
                            {source.citationLabel} {source.documentTitle} · 第{" "}
                            {source.pageNumber} 页
                          </button>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>

              <form className="planning-context-search" onSubmit={submitSearch}>
                <label>
                  搜索本地资料原文
                  <input
                    type="search"
                    maxLength={100}
                    value={searchQuery}
                    placeholder="例如：强化阶段 每日安排"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    required
                  />
                </label>
                <button type="submit" disabled={busy !== undefined}>
                  搜索可引用页码
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
                            disabled={!selected && selectedContexts.length >= 6}
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

              <div className="planning-selected-contexts">
                <strong>本轮已选 {selectedContexts.length} / 6 页</strong>
                {selectedContexts.map((context) => (
                  <button
                    key={`${context.selection.documentId}:${context.selection.pageNumber}`}
                    type="button"
                    className="secondary-button"
                    title={context.excerpt}
                    onClick={() =>
                      toggleContext({
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

              <form className="planning-chat-form" onSubmit={prepare}>
                <label>
                  本轮问题
                  <textarea
                    rows={4}
                    maxLength={4000}
                    value={question}
                    onChange={(event) => {
                      setQuestion(event.target.value);
                      invalidatePreview();
                    }}
                    placeholder="结合我选择的资料，给出适合当前基础的阶段安排。"
                    required
                  />
                </label>
                <label>
                  输出 Token 上限
                  <input
                    type="number"
                    min={1}
                    max={1800}
                    value={outputLimit}
                    onChange={(event) => {
                      setOutputLimit(event.target.value);
                      invalidatePreview();
                    }}
                    required
                  />
                </label>
                <button type="submit" disabled={busy !== undefined}>
                  生成完整外发预览
                </button>
              </form>

              {preview === undefined ? null : (
                <section
                  className="planning-chat-preview"
                  aria-labelledby="planning-preview-title"
                >
                  <h3 id="planning-preview-title">本次将发送的完整文本</h3>
                  <span>
                    {preview.preview.destination} · 预计{" "}
                    {preview.preview.projectedTokens} Token
                  </span>
                  <pre>{preview.preview.prompt}</pre>
                  <label className="ai-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={!preview.preview.allowed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    我已核对上方完整文本和引用页码
                  </label>
                  <button
                    type="button"
                    disabled={
                      !confirmed ||
                      !preview.preview.allowed ||
                      busy !== undefined
                    }
                    onClick={execute}
                  >
                    明确确认并发送
                  </button>
                </section>
              )}

              {lastAssistantMessage === undefined ? null : (
                <div className="planning-draft-action">
                  <label>
                    草案标题
                    <input
                      maxLength={120}
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy !== undefined || draftTitle.trim() === ""}
                    onClick={saveDraft}
                  >
                    把最后一条 AI 回复保存为计划草案
                  </button>
                  <small>
                    只复制为草案；仍需你检查、编辑并手动确认为当前计划。
                  </small>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
