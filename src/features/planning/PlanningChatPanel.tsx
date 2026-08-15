import { useEffect, useRef, useState, type FormEvent } from "react";

import type { AiCommandError } from "../../shared/tauri/aiClient";
import {
  createPlanningConversation,
  executePlanningChat,
  listPlanningConversations,
  normalizePlanningChatError,
  previewPlanningChat,
  savePlanningReplyAsDraft,
  type PlanningChatPreview,
  type PlanningChatRequest,
  type PlanningConversation,
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
}

const BUSY_COPY: Record<string, string> = {
  conversations: "正在读取本地规划对话…",
  create: "正在新建对话…",
  search: "正在搜索资料页…",
  preview: "正在生成完整外发预览…",
  execute: "正在发送并保存 AI 回复…",
  draft: "正在保存规划草案…",
};

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
  const [selectedContexts, setSelectedContexts] = useState<
    SelectedPlanningContext[]
  >([]);
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

  const prepare = (event: FormEvent) => {
    event.preventDefault();
    const request = buildPlanningChatRequest(
      activeId,
      question,
      selectedContexts,
      outputLimit,
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

  return (
    <section
      className="planning-chat-card"
      aria-labelledby="planning-chat-title"
      aria-busy={busy !== undefined}
    >
      <header className="planning-chat-heading">
        <div>
          <p className="section-label">资料辅助 AI 规划</p>
          <h2 id="planning-chat-title">结合本地资料完善规划</h2>
          <p>最多选择 6 个已索引页；只有明确确认的完整预览会被外发。</p>
        </div>
        <span>{conversations.length} 段本地对话</span>
      </header>
      {busy === undefined ? null : (
        <p role="status" aria-live="polite">
          {BUSY_COPY[busy] ?? "正在处理…"}
        </p>
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
        />
        <div className="planning-chat-workspace">
          <Thread
            conversation={activeConversation}
            onOpenReference={onOpenReference}
          />
          {activeConversation === undefined ? null : (
            <>
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
              {lastAssistantMessage === undefined ? null : (
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
