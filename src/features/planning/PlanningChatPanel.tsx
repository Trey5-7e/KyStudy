import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AiCommandError } from "../../shared/tauri/aiClient";
import {
  createPlanningConversation,
  deletePlanningConversation,
  executePlanningChat,
  listPlanningConversations,
  renamePlanningConversation,
  normalizePlanningChatError,
  previewPlanningChat,
  savePlanningReplyAsDraft,
  type PlanningChatPreview,
  type PlanningChatRequest,
  type PlanningConversation,
  type PlanningMessage,
  type PlanningQuestionContext,
} from "../../shared/tauri/planningChatClient";
import {
  normalizeResourceSearchError,
  searchResources,
  type ResourceSearchResult,
} from "../../shared/tauri/resourceSearchClient";
import {
  buildPlanningChatRequest,
  confirmedPromptMatches,
  isCurrentPlanningRequest,
  planningPreviewFingerprint,
  togglePlanningContext,
  type SelectedPlanningContext,
} from "./planningChatModel";
import { Composer } from "./planning-chat/Composer";
import { ContextPanel } from "./planning-chat/ContextPanel";
import { ConversationRail } from "./planning-chat/ConversationRail";
import { DraftAction } from "./planning-chat/DraftAction";
import { PreviewDialog } from "./planning-chat/PreviewDialog";
import { Thread } from "./planning-chat/Thread";
import "./planning-chat.css";

interface PlanningChatPanelProps {
  onOpenReference(documentId: string, page: number): void;
  onDraftCreated(planId: string): Promise<void>;
  standalone?: boolean;
  initialQuestionContext?: PlanningQuestionContext;
}

const BUSY_COPY: Record<string, string> = {
  conversations: "正在读取本地规划对话…",
  create: "正在新建对话…",
  search: "正在搜索资料页…",
  preview: "正在生成完整外发预览…",
  execute: "正在发送并保存 AI 回复…",
  draft: "正在保存规划草案…",
  rename: "正在重命名对话…",
  delete: "正在删除对话…",
};

export function PlanningChatPanel({
  onOpenReference,
  onDraftCreated,
  standalone = false,
  initialQuestionContext,
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
  const [selectedContexts, setSelectedContexts] = useState<
    SelectedPlanningContext[]
  >([]);
  const [questionContext, setQuestionContext] = useState<
    PlanningQuestionContext | undefined
  >(initialQuestionContext);
  const [question, setQuestion] = useState("");
  const [outputLimit, setOutputLimit] = useState("800");
  const [preview, setPreview] = useState<PlanningChatPreview>();
  const [preparedRequest, setPreparedRequest] = useState<PlanningChatRequest>();
  const [previewFingerprint, setPreviewFingerprint] = useState<string>();
  const [confirmedPrompt, setConfirmedPrompt] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const [busy, setBusy] = useState<string | undefined>("conversations");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<AiCommandError>();

  const searchRequestIdRef = useRef(0);
  const previewRequestIdRef = useRef(0);
  const executeRequestIdRef = useRef(0);
  const conversationRequestIdRef = useRef(0);
  const draftRequestIdRef = useRef(0);
  const activeButtonRef = useRef<HTMLButtonElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    void listPlanningConversations().then(
      (loaded) => {
        if (!active) return;
        setConversations(loaded);
        setActiveId(loaded[0]?.id);
        setDraftTitle(
          loaded[0] === undefined ? "" : `${loaded[0].title} AI 草案`,
        );
        setBusy(undefined);
      },
      (reason: unknown) => {
        if (active) {
          setError(normalizePlanningChatError(reason));
          setBusy(undefined);
        }
      },
    );
    return () => {
      active = false;
      mountedRef.current = false;
      conversationRequestIdRef.current += 1;
      searchRequestIdRef.current += 1;
      previewRequestIdRef.current += 1;
      executeRequestIdRef.current += 1;
      draftRequestIdRef.current += 1;
    };
  }, []);

  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeId,
  );
  const lastAssistantMessage = [...(activeConversation?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant");

  const invalidatePreview = () => {
    previewRequestIdRef.current += 1;
    setPreview(undefined);
    setPreparedRequest(undefined);
    setPreviewFingerprint(undefined);
    setConfirmedPrompt(undefined);
  };

  const resetTurnState = () => {
    searchRequestIdRef.current += 1;
    executeRequestIdRef.current += 1;
    setQuestion("");
    setSearchQuery("");
    setSearchResults([]);
    setSelectedContexts([]);
    invalidatePreview();
    setNotice("");
    setError(undefined);
  };

  const run = async (label: string, operation: () => Promise<void>) => {
    if (!mountedRef.current) return;
    setBusy(label);
    setError(undefined);
    setNotice("");
    try {
      await operation();
    } catch (reason: unknown) {
      if (mountedRef.current) {
        setError(normalizePlanningChatError(reason));
      }
    } finally {
      if (mountedRef.current) {
        setBusy(undefined);
      }
    }
  };

  const focusActiveConversation = () => {
    requestAnimationFrame(() => activeButtonRef.current?.focus());
  };

  const createConversation = (event: FormEvent) => {
    event.preventDefault();
    const requestId = ++conversationRequestIdRef.current;
    void run("create", async () => {
      const created = await createPlanningConversation(newTitle.trim());
      if (
        !isCurrentPlanningRequest(
          requestId,
          conversationRequestIdRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setConversations((current) => [created, ...current]);
      setActiveId(created.id);
      setDraftTitle(`${created.title} AI 草案`);
      resetTurnState();
      focusActiveConversation();
    });
  };

  const chooseConversation = (conversation: PlanningConversation) => {
    conversationRequestIdRef.current += 1;
    setActiveId(conversation.id);
    setDraftTitle(`${conversation.title} AI 草案`);
    resetTurnState();
    focusActiveConversation();
  };

  const renameConversation = (conversation: PlanningConversation) => {
    const title = window.prompt("新的对话标题", conversation.title)?.trim();
    if (title === undefined || title === "" || title === conversation.title)
      return;
    const requestId = ++conversationRequestIdRef.current;
    void run("rename", async () => {
      const renamed = await renamePlanningConversation(conversation.id, title);
      if (
        !isCurrentPlanningRequest(
          requestId,
          conversationRequestIdRef.current,
          mountedRef.current,
        )
      )
        return;
      setConversations((current) =>
        current.map((item) => (item.id === renamed.id ? renamed : item)),
      );
      setDraftTitle(`${renamed.title} AI 草案`);
    });
  };

  const deleteConversation = (conversation: PlanningConversation) => {
    if (!window.confirm(`删除“${conversation.title}”及其本地消息？`)) return;
    const requestId = ++conversationRequestIdRef.current;
    void run("delete", async () => {
      await deletePlanningConversation(conversation.id);
      if (
        !isCurrentPlanningRequest(
          requestId,
          conversationRequestIdRef.current,
          mountedRef.current,
        )
      )
        return;
      const remaining = conversations.filter(
        (item) => item.id !== conversation.id,
      );
      setConversations(remaining);
      if (activeId === conversation.id) {
        const next = remaining[0];
        setActiveId(next?.id);
        setDraftTitle(next === undefined ? "" : `${next.title} AI 草案`);
        resetTurnState();
      }
    });
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const requestId = ++searchRequestIdRef.current;
    void run("search", async () => {
      try {
        const results = await searchResources(searchQuery, 30);
        if (
          !isCurrentPlanningRequest(
            requestId,
            searchRequestIdRef.current,
            mountedRef.current,
          )
        ) {
          return;
        }
        setSearchResults(
          results.filter(
            (result) =>
              result.matchKind === "page_text" &&
              result.pageNumber !== undefined,
          ),
        );
      } catch (reason: unknown) {
        if (
          isCurrentPlanningRequest(
            requestId,
            searchRequestIdRef.current,
            mountedRef.current,
          )
        ) {
          setError(normalizeResourceSearchError(reason));
        }
      }
    });
  };

  const toggleContext = (result: ResourceSearchResult) => {
    if (result.pageNumber === undefined) return;
    setSelectedContexts((current) =>
      togglePlanningContext(current, result, searchQuery),
    );
    invalidatePreview();
  };

  const changeQuestion = (value: string) => {
    setQuestion(value);
    invalidatePreview();
  };

  const changeOutputLimit = (value: string) => {
    setOutputLimit(value);
    invalidatePreview();
  };

  const prepareQuestion = (nextQuestion: string) => {
    const request = buildPlanningChatRequest(
      activeId,
      nextQuestion,
      selectedContexts,
      outputLimit,
      questionContext,
    );
    if (request === undefined) return;
    const requestId = ++previewRequestIdRef.current;
    void run("preview", async () => {
      const nextPreview = await previewPlanningChat(request);
      if (
        !isCurrentPlanningRequest(
          requestId,
          previewRequestIdRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setPreview(nextPreview);
      setPreparedRequest(request);
      setPreviewFingerprint(planningPreviewFingerprint(request, nextPreview));
      setConfirmedPrompt(undefined);
    });
  };

  const prepare = (event: FormEvent) => {
    event.preventDefault();
    prepareQuestion(question);
  };

  const execute = () => {
    if (
      preview === undefined ||
      preparedRequest === undefined ||
      previewFingerprint === undefined ||
      confirmedPrompt === undefined ||
      !preview.preview.allowed ||
      planningPreviewFingerprint(preparedRequest, preview) !==
        previewFingerprint ||
      !confirmedPromptMatches(preview, confirmedPrompt)
    ) {
      return;
    }
    const requestId = ++executeRequestIdRef.current;
    void run("execute", async () => {
      const reply = await executePlanningChat({
        ...preparedRequest,
        confirmedPrompt,
        confirmedRequestFingerprint: preview.preview.requestFingerprint,
      });
      if (
        !isCurrentPlanningRequest(
          requestId,
          executeRequestIdRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setConversations((current) => [
        reply.conversation,
        ...current.filter(
          (conversation) => conversation.id !== reply.conversation.id,
        ),
      ]);
      setActiveId(reply.conversation.id);
      setQuestion("");
      setSelectedContexts([]);
      setSearchResults([]);
      invalidatePreview();
      setDraftTitle(`${reply.conversation.title} AI 草案`);
      setNotice(
        reply.result.cacheHit
          ? "已从本地缓存读取回复，没有新增 Token 消耗。"
          : "回复已保存到本地对话，尚未成为正式计划。",
      );
    });
  };

  const saveDraft = () => {
    if (lastAssistantMessage === undefined) return;
    const requestId = ++draftRequestIdRef.current;
    void run("draft", async () => {
      const planId = await savePlanningReplyAsDraft(
        lastAssistantMessage.id,
        draftTitle.trim(),
      );
      if (
        !isCurrentPlanningRequest(
          requestId,
          draftRequestIdRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      await onDraftCreated(planId);
      if (
        isCurrentPlanningRequest(
          requestId,
          draftRequestIdRef.current,
          mountedRef.current,
        )
      ) {
        setNotice("AI 回复已复制为待复核草案。");
      }
    });
  };

  const copyMessage = (message: PlanningMessage) => {
    if (!navigator.clipboard) {
      setNotice("当前环境不支持自动复制，请手动选择消息文本复制。");
      return;
    }
    void navigator.clipboard.writeText(message.content).then(
      () => setNotice("消息 Markdown 已复制。"),
      () => setNotice("复制失败，请手动选择消息文本复制。"),
    );
  };

  const retryMessage = (message: PlanningMessage) => {
    if (activeConversation === undefined) return;
    const messageIndex = activeConversation.messages.findIndex(
      (item) => item.id === message.id,
    );
    const previousUserMessage =
      messageIndex > 0
        ? activeConversation.messages
            .slice(0, messageIndex)
            .reverse()
            .find((item) => item.role === "user")
        : undefined;
    if (previousUserMessage === undefined) return;
    setQuestion(previousUserMessage.content);
    invalidatePreview();
    setNotice("正在重新生成这条问题的外发预览，请确认后发送。");
    prepareQuestion(previousUserMessage.content);
  };

  const cancelCurrentRequest = () => {
    searchRequestIdRef.current += 1;
    previewRequestIdRef.current += 1;
    executeRequestIdRef.current += 1;
    conversationRequestIdRef.current += 1;
    draftRequestIdRef.current += 1;
    setBusy(undefined);
    invalidatePreview();
    setNotice("已取消当前本地操作；如果请求已经发出，回复不会写入当前界面。 ");
  };

  return (
    <section
      className="planning-chat-card"
      aria-labelledby="planning-chat-title"
      aria-busy={busy !== undefined}
    >
      <header className="planning-chat-heading">
        <div>
          <p className="section-label">
            {standalone ? "独立 AI 对话" : "资料辅助 AI 规划"}
          </p>
          <h2 id="planning-chat-title">
            {standalone ? "与 AI 多轮讨论学习问题" : "结合本地资料完善规划"}
          </h2>
          <p>
            {standalone
              ? "可引用本地资料，也可以从题目解析带入题目上下文；只有明确确认的完整预览会被外发。"
              : "最多选择 6 个已索引页；只有明确确认的完整预览会被外发。"}
          </p>
        </div>
        <span>{conversations.length} 段本地对话</span>
      </header>
      {busy === undefined ? null : (
        <div className="planning-chat-busy" role="status" aria-live="polite">
          <span>{BUSY_COPY[busy] ?? "正在处理…"}</span>
          <button
            type="button"
            className="text-button"
            onClick={cancelCurrentRequest}
          >
            取消当前操作
          </button>
        </div>
      )}
      {error === undefined ? null : (
        <div className="error-detail" role="alert" aria-live="assertive">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
        </div>
      )}
      {notice === "" ? null : (
        <p className="ai-notice" role="status" aria-live="polite">
          {notice}
        </p>
      )}
      <div className="planning-chat-layout">
        <ConversationRail
          conversations={conversations}
          activeId={activeId}
          newTitle={newTitle}
          busy={busy !== undefined}
          activeButtonRef={activeButtonRef}
          onTitleChange={setNewTitle}
          onCreate={createConversation}
          onSelect={chooseConversation}
          onRename={renameConversation}
          onDelete={deleteConversation}
        />
        <div className="planning-chat-workspace">
          <Thread
            conversation={activeConversation}
            onOpenReference={onOpenReference}
            onCopyMessage={copyMessage}
            onRetryMessage={retryMessage}
          />
          {activeConversation === undefined ? null : (
            <>
              {questionContext === undefined ? null : (
                <section
                  className="planning-question-context"
                  aria-label="当前题目上下文"
                >
                  <div>
                    <strong>已附加当前题目上下文</strong>
                    <span>
                      {questionContext.title} ·{" "}
                      {questionContext.imageDataUrls.length} 张题图
                    </span>
                  </div>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy !== undefined}
                    onClick={() => setQuestionContext(undefined)}
                  >
                    移除
                  </button>
                </section>
              )}
              <ContextPanel
                searchQuery={searchQuery}
                searchResults={searchResults}
                selectedContexts={selectedContexts}
                busy={busy !== undefined}
                onSearchQueryChange={setSearchQuery}
                onSearch={submitSearch}
                onToggle={toggleContext}
              />
              <Composer
                question={question}
                outputLimit={outputLimit}
                busy={busy !== undefined}
                submitButtonRef={previewTriggerRef}
                onQuestionChange={changeQuestion}
                onOutputLimitChange={changeOutputLimit}
                onPrepare={prepare}
              />
              <PreviewDialog
                preview={preview}
                contextCount={selectedContexts.length}
                confirmed={
                  preview !== undefined &&
                  confirmedPromptMatches(preview, confirmedPrompt ?? "")
                }
                busy={busy === "execute"}
                headingRef={previewHeadingRef}
                returnFocusRef={previewTriggerRef}
                onConfirmed={(value) =>
                  setConfirmedPrompt(
                    value ? preview?.preview.prompt : undefined,
                  )
                }
                onExecute={execute}
                onClose={invalidatePreview}
                onOpenReference={onOpenReference}
              />
              {standalone || lastAssistantMessage === undefined ? null : (
                <DraftAction
                  title={draftTitle}
                  busy={busy !== undefined}
                  onTitleChange={setDraftTitle}
                  onSave={saveDraft}
                />
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
