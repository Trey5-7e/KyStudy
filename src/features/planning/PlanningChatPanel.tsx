import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import type { AiCommandError } from "../../shared/tauri/aiClient";
import {
  createAiChatConversation,
  cancelAiChatOperation,
  deleteAiChatConversation,
  executeAiChat,
  executeAiChatStream,
  listAiChatConversations,
  normalizeAiChatError,
  previewAiChat,
  renameAiChatConversation,
} from "../../shared/tauri/aiChatClient";
import {
  attachResourceToAiConversation,
  listAiAttachments,
  removeAiAttachment,
  retryAiAttachment,
} from "../../shared/tauri/aiAttachmentClient";
import type { AiAttachmentRef } from "../../shared/tauri/aiConversationContract";
import {
  createPlanningConversation,
  deletePlanningConversation,
  executePlanningChat,
  executePlanningChatStream,
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
  listenToImportEvents,
  listResources,
  normalizeResourceCommandError,
  cancelResourceImport,
  getResourceReaderDescriptor,
  startResourceImport,
  type ImportEvent,
  type ResourceDocument,
} from "../../shared/tauri/resourceClient";
import { normalizeResourceSearchError } from "../../shared/tauri/resourceSearchClient";
import { createLocalPdfPageRecognizer } from "../library/pdf/pdfOcr";
import {
  buildPlanningChatRequest,
  confirmedPromptMatches,
  isCurrentPlanningRequest,
  planningPreviewFingerprint,
} from "./planningChatModel";
import { AssistantChatComposer } from "./planning-chat/AssistantChatComposer";
import { AssistantChatRuntime } from "./planning-chat/AssistantChatRuntime";
import { AssistantChatThread } from "./planning-chat/AssistantChatThread";
import { ConversationRail } from "./planning-chat/ConversationRail";
import { DraftAction } from "./planning-chat/DraftAction";
import { PreviewDialog } from "./planning-chat/PreviewDialog";
import { ResourceContextDialog } from "./planning-chat/ResourceContextDialog";
import {
  getQuestionBank,
  type IndexedQuestion,
  type QuestionBankSnapshot,
} from "../../shared/tauri/questionBankClient";
import { summarizeQuestionBankForPrompt } from "./planning-chat/aiPaperProposalModel";
import type { LocalComposerFile } from "./planning-chat/localFileExtract";
import "./planning-chat.css";
import "./planning-chat/assistant-chat-ui.css";

interface PlanningChatPanelProps {
  onOpenReference(documentId: string, page: number): void;
  onDraftCreated(planId: string): Promise<void>;
  onStartPaper?(questions: IndexedQuestion[], title?: string): void;
  standalone?: boolean;
  initialQuestionContext?: PlanningQuestionContext;
  conversationKind?: "planning" | "chat";
  headerAction?: ReactNode;
}

const BUSY_COPY: Record<string, string> = {
  conversations: "正在读取本地规划对话…",
  create: "正在新建对话…",
  preview: "正在生成完整外发预览…",
  execute: "正在发送并保存 AI 回复…",
  draft: "正在保存规划草案…",
  rename: "正在重命名对话…",
  delete: "正在删除对话…",
  attachments: "正在读取对话资料…",
  resources: "正在读取本地资料库…",
  attachment: "正在更新对话资料…",
  upload: "正在导入电脑资料…",
  "attachment-index": "正在建立资料文字索引…",
  "upload-cancel": "正在取消资料导入…",
};

export function PlanningChatPanel({
  onOpenReference,
  onDraftCreated,
  onStartPaper,
  standalone = false,
  initialQuestionContext,
  conversationKind = "planning",
  headerAction,
}: PlanningChatPanelProps) {
  const [conversations, setConversations] = useState<PlanningConversation[]>(
    [],
  );
  const [activeId, setActiveId] = useState<string>();
  const [newTitle, setNewTitle] = useState("我的考研规划讨论");
  const [questionContext, setQuestionContext] = useState<
    PlanningQuestionContext | undefined
  >(initialQuestionContext);
  const [preview, setPreview] = useState<PlanningChatPreview>();
  const [preparedRequest, setPreparedRequest] = useState<PlanningChatRequest>();
  const [previewFingerprint, setPreviewFingerprint] = useState<string>();
  const [confirmedPrompt, setConfirmedPrompt] = useState<string>();
  const [draftTitle, setDraftTitle] = useState("");
  const [busy, setBusy] = useState<string | undefined>("conversations");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<AiCommandError>();
  const [attachments, setAttachments] = useState<AiAttachmentRef[]>([]);
  const [resources, setResources] = useState<ResourceDocument[]>([]);
  const [resourcesLoaded, setResourcesLoaded] = useState(false);
  const [importEvent, setImportEvent] = useState<ImportEvent>();
  const [uploadCanceling, setUploadCanceling] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [composerImages, setComposerImages] = useState<string[]>([]);
  const [composerLocalFiles, setComposerLocalFiles] = useState<
    LocalComposerFile[]
  >([]);
  const [questionBankSnapshot, setQuestionBankSnapshot] =
    useState<QuestionBankSnapshot>();

  useEffect(() => {
    let active = true;
    void getQuestionBank().then(
      (snapshot) => {
        if (active) setQuestionBankSnapshot(snapshot);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  const previewRequestIdRef = useRef(0);
  const executeRequestIdRef = useRef(0);
  const activeOperationIdRef = useRef<string | undefined>(undefined);
  const conversationRequestIdRef = useRef(0);
  const draftRequestIdRef = useRef(0);
  const attachmentRequestIdRef = useRef(0);
  const resourceRequestIdRef = useRef(0);
  const importRequestIdRef = useRef(0);
  const importOperationIdRef = useRef<string | undefined>(undefined);
  const resourceIndexControllerRef = useRef<AbortController | undefined>(
    undefined,
  );
  const activeButtonRef = useRef<HTMLButtonElement>(null);
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement>(null);
  const mountedRef = useRef(true);

  const chatApi = useMemo(
    () =>
      conversationKind === "chat"
        ? {
            list: listAiChatConversations,
            create: createAiChatConversation,
            rename: renameAiChatConversation,
            remove: deleteAiChatConversation,
            preview: previewAiChat,
            execute: executeAiChat,
            normalizeError: normalizeAiChatError,
          }
        : {
            list: listPlanningConversations,
            create: createPlanningConversation,
            rename: renamePlanningConversation,
            remove: deletePlanningConversation,
            preview: previewPlanningChat,
            execute: executePlanningChat,
            normalizeError: normalizePlanningChatError,
          },
    [conversationKind],
  );

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    void chatApi.list().then(
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
          setError(chatApi.normalizeError(reason));
          setBusy(undefined);
        }
      },
    );
    return () => {
      active = false;
      mountedRef.current = false;
      conversationRequestIdRef.current += 1;
      previewRequestIdRef.current += 1;
      executeRequestIdRef.current += 1;
      draftRequestIdRef.current += 1;
      attachmentRequestIdRef.current += 1;
      resourceRequestIdRef.current += 1;
      importRequestIdRef.current += 1;
      const importOperationId = importOperationIdRef.current;
      if (importOperationId !== undefined) {
        void cancelResourceImport(importOperationId).catch(() => undefined);
      }
      importOperationIdRef.current = undefined;
      resourceIndexControllerRef.current?.abort();
      resourceIndexControllerRef.current = undefined;
      const operationId = activeOperationIdRef.current;
      if (operationId !== undefined) {
        void cancelAiChatOperation(operationId).catch(() => undefined);
      }
      activeOperationIdRef.current = undefined;
    };
  }, [chatApi]);

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
    executeRequestIdRef.current += 1;
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
        if (
          reason instanceof Error &&
          reason.message === "RESOURCE_INDEX_CANCELED"
        ) {
          setNotice("资料索引已取消，尚未绑定到当前对话。");
          return;
        }
        if (
          reason instanceof Error &&
          reason.message.startsWith("RESOURCE_INDEX_")
        ) {
          setError(normalizeResourceSearchError(reason));
          return;
        }
        const normalized = chatApi.normalizeError(reason);
        if (
          normalized.code === "AI_CALL_INTERRUPTED" ||
          normalized.code === "PLANNING_CHAT_CANCELED"
        ) {
          setNotice("AI 对话已取消，未写入本地对话。");
        } else {
          setError(normalized);
        }
      }
    } finally {
      if (mountedRef.current) {
        setBusy(undefined);
      }
    }
  };

  useEffect(() => {
    const requestId = ++attachmentRequestIdRef.current;
    if (activeId === undefined) {
      return;
    }
    void listAiAttachments(activeId, conversationKind).then(
      (loaded) => {
        if (
          !isCurrentPlanningRequest(
            requestId,
            attachmentRequestIdRef.current,
            mountedRef.current,
          )
        ) {
          return;
        }
        setAttachments(loaded);
      },
      (reason: unknown) => {
        if (
          isCurrentPlanningRequest(
            requestId,
            attachmentRequestIdRef.current,
            mountedRef.current,
          )
        ) {
          setError(chatApi.normalizeError(reason));
        }
      },
    );
    return () => {
      attachmentRequestIdRef.current += 1;
    };
  }, [activeId, chatApi, conversationKind]);

  const focusActiveConversation = () => {
    requestAnimationFrame(() => activeButtonRef.current?.focus());
  };

  const invalidateImport = () => {
    importRequestIdRef.current += 1;
    const operationId = importOperationIdRef.current;
    if (operationId !== undefined) {
      void cancelResourceImport(operationId).catch(() => undefined);
    }
    importOperationIdRef.current = undefined;
    resourceIndexControllerRef.current?.abort();
    resourceIndexControllerRef.current = undefined;
    setImportEvent(undefined);
    setUploadCanceling(false);
  };

  const createConversation = (event: FormEvent) => {
    event.preventDefault();
    const requestId = ++conversationRequestIdRef.current;
    void run("create", async () => {
      const created = await chatApi.create(newTitle.trim());
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
      setAttachments([]);
      invalidateImport();
      setAttachmentsOpen(false);
      setDraftTitle(`${created.title} AI 草案`);
      resetTurnState();
      focusActiveConversation();
    });
  };

  const chooseConversation = (conversation: PlanningConversation) => {
    conversationRequestIdRef.current += 1;
    invalidateImport();
    setActiveId(conversation.id);
    setAttachments([]);
    setAttachmentsOpen(false);
    setDraftTitle(`${conversation.title} AI 草案`);
    resetTurnState();
    focusActiveConversation();
  };

  const loadResources = () => {
    if (resourcesLoaded || busy !== undefined) return;
    const requestId = ++resourceRequestIdRef.current;
    void run("resources", async () => {
      const loaded = await listResources();
      if (
        !isCurrentPlanningRequest(
          requestId,
          resourceRequestIdRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setResources(loaded);
      setResourcesLoaded(true);
    });
  };

  const attachResourceRequest = async (documentId: string) => {
    if (activeId === undefined) return;
    const conversationId = activeId;
    const requestId = ++attachmentRequestIdRef.current;
    const resource = resources.find((item) => item.id === documentId);
    if (resource?.kind === "pdf") {
      await ensureResourceIndexed(documentId);
    }
    const attached = await attachResourceToAiConversation(
      conversationId,
      documentId,
      conversationKind,
    );
    if (
      !isCurrentPlanningRequest(
        requestId,
        attachmentRequestIdRef.current,
        mountedRef.current,
      )
    ) {
      return;
    }
    setAttachments((current) => [
      attached,
      ...current.filter((item) => item.id !== attached.id),
    ]);
    invalidatePreview();
    setNotice(`已将“${attached.fileName}”绑定到当前对话。`);
  };

  const ensureResourceIndexed = async (documentId: string) => {
    const descriptor = await getResourceReaderDescriptor(documentId);
    if (descriptor.kind !== "pdf") return;
    const controller = new AbortController();
    resourceIndexControllerRef.current = controller;
    try {
      const { indexPdfText } = await import("../library/pdf/pdfTextIndexer");
      let recognizePage;
      try {
        recognizePage = await createLocalPdfPageRecognizer();
      } catch {
        recognizePage = undefined;
      }
      await indexPdfText(
        descriptor,
        false,
        controller.signal,
        () => undefined,
        { recognizePage },
      );
    } finally {
      if (resourceIndexControllerRef.current === controller) {
        resourceIndexControllerRef.current = undefined;
      }
    }
  };

  const attachResource = (documentId: string) => {
    void run("attachment-index", () => attachResourceRequest(documentId));
  };

  const waitForResourceImport = async (): Promise<ImportEvent | undefined> => {
    let operationId: string | undefined;
    let dispose: (() => void) | undefined;
    let settled = false;
    const observed = new Map<string, ImportEvent>();

    return new Promise<ImportEvent | undefined>((resolve, reject) => {
      const finish = (event: ImportEvent | undefined) => {
        if (settled) return;
        settled = true;
        dispose?.();
        resolve(event);
      };

      void listenToImportEvents((event) => {
        observed.set(event.operationId, event);
        setImportEvent(event);
        if (operationId !== event.operationId || event.state === "running") {
          return;
        }
        finish(event);
      }).then(
        (unlisten) => {
          dispose = unlisten;
          void startResourceImport().then(
            (operation) => {
              if (operation === null) finish(undefined);
              else {
                operationId = operation.operationId;
                importOperationIdRef.current = operation.operationId;
                const terminal = observed.get(operationId);
                if (terminal !== undefined && terminal.state !== "running") {
                  finish(terminal);
                }
              }
            },
            (reason: unknown) => {
              dispose?.();
              reject(reason);
            },
          );
        },
        (reason: unknown) => reject(reason),
      );
    });
  };

  const uploadComputerResource = () => {
    if (activeId === undefined) return;
    const requestId = ++importRequestIdRef.current;
    setImportEvent(undefined);
    setUploadCanceling(false);
    importOperationIdRef.current = undefined;
    void run("upload", async () => {
      const event = await waitForResourceImport();
      if (
        !isCurrentPlanningRequest(
          requestId,
          importRequestIdRef.current,
          mountedRef.current,
        ) ||
        event === undefined
      ) {
        return;
      }
      if (event.state === "succeeded" && event.resource !== undefined) {
        if (event.resource.kind === "pdf") {
          setBusy("attachment-index");
          await ensureResourceIndexed(event.resource.id);
        }
        await attachResourceRequest(event.resource.id);
        setResources((current) => [
          event.resource as ResourceDocument,
          ...current.filter((resource) => resource.id !== event.resource?.id),
        ]);
        setResourcesLoaded(true);
      } else if (event.error !== undefined) {
        setError(normalizeResourceCommandError(event.error));
      }
      importOperationIdRef.current = undefined;
    });
  };

  const cancelUpload = () => {
    const operationId = importOperationIdRef.current;
    if (operationId === undefined || uploadCanceling) return;
    setUploadCanceling(true);
    setError(undefined);
    void cancelResourceImport(operationId)
      .then(
        (canceled) => {
          if (!canceled) {
            setNotice("资料导入已经完成或结束。");
          }
        },
        (reason: unknown) => {
          setError(normalizeResourceCommandError(reason));
        },
      )
      .finally(() => {
        if (mountedRef.current) {
          setUploadCanceling(false);
        }
      });
  };

  const removeAttachment = (attachmentId: string) => {
    const requestId = ++attachmentRequestIdRef.current;
    void run("attachment", async () => {
      await removeAiAttachment(attachmentId, conversationKind);
      if (
        !isCurrentPlanningRequest(
          requestId,
          attachmentRequestIdRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setAttachments((current) =>
        current.filter((item) => item.id !== attachmentId),
      );
      invalidatePreview();
      setNotice("已从当前对话移除这份资料。");
    });
  };

  const retryAttachment = (attachmentId: string) => {
    const requestId = ++attachmentRequestIdRef.current;
    void run("attachment", async () => {
      const retried = await retryAiAttachment(attachmentId, conversationKind);
      if (retried.source === "resource" && retried.documentId !== undefined) {
        setBusy("attachment-index");
        await ensureResourceIndexed(retried.documentId);
      }
      if (
        !isCurrentPlanningRequest(
          requestId,
          attachmentRequestIdRef.current,
          mountedRef.current,
        )
      ) {
        return;
      }
      setAttachments((current) => [
        retried,
        ...current.filter((item) => item.id !== retried.id),
      ]);
      invalidatePreview();
      setNotice(`已重新校验“${retried.fileName}”，资料恢复为可用状态。`);
    });
  };

  const renameConversation = (conversation: PlanningConversation) => {
    const title = window.prompt("新的对话标题", conversation.title)?.trim();
    if (title === undefined || title === "" || title === conversation.title)
      return;
    const requestId = ++conversationRequestIdRef.current;
    void run("rename", async () => {
      const renamed = await chatApi.rename(conversation.id, title);
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
      await chatApi.remove(conversation.id);
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
        invalidateImport();
        setActiveId(next?.id);
        setAttachments([]);
        setAttachmentsOpen(false);
        setDraftTitle(next === undefined ? "" : `${next.title} AI 草案`);
        resetTurnState();
      }
    });
  };

  const applyReply = (
    reply: Awaited<ReturnType<typeof executePlanningChat>>,
    requestId: number,
  ) => {
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
    invalidatePreview();
    setDraftTitle(`${reply.conversation.title} AI 草案`);
    setNotice(
      reply.result.cacheHit
        ? "已从本地缓存读取回复。"
        : standalone
          ? "回复已保存到本地对话。"
          : "回复已保存到本地对话，尚未成为正式计划。",
    );
  };

  const executeDirect = (request: PlanningChatRequest) => {
    const requestId = ++executeRequestIdRef.current;
    const operationId = crypto.randomUUID();
    activeOperationIdRef.current = operationId;
    const userMsgId = `temp-user-${operationId}`;
    const assistantMsgId = `temp-assistant-${operationId}`;
    const userContent = request.question;
    const userMsg: PlanningMessage = {
      id: userMsgId,
      role: "user",
      content: userContent,
      sources: [],
      createdAt: Date.now(),
    };
    const assistantMsg: PlanningMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      sources: [],
      createdAt: Date.now(),
    };

    setConversations((current) =>
      current.map((c) => {
        if (c.id !== request.conversationId) return c;
        return {
          ...c,
          messages: [...c.messages, userMsg, assistantMsg],
        };
      }),
    );

    void run("execute", async () => {
      try {
        const reply = await executeAiChatStream(
          request,
          (delta) => {
            if (
              !isCurrentPlanningRequest(
                requestId,
                executeRequestIdRef.current,
                mountedRef.current,
              )
            ) {
              return;
            }
            setConversations((current) =>
              current.map((c) => {
                if (c.id !== request.conversationId) return c;
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + delta }
                      : m,
                  ),
                };
              }),
            );
          },
          operationId,
        );
        applyReply(reply, requestId);
      } catch (err) {
        setConversations((current) =>
          current.map((c) => {
            if (c.id !== request.conversationId) return c;
            return {
              ...c,
              messages: c.messages.filter(
                (m) => m.id !== userMsgId && m.id !== assistantMsgId,
              ),
            };
          }),
        );
        throw err;
      } finally {
        if (activeOperationIdRef.current === operationId) {
          activeOperationIdRef.current = undefined;
        }
      }
    });
  };

  const prepareQuestion = (nextQuestion: string) => {
    const localImages = composerLocalFiles.flatMap((f) => f.images ?? []);
    const images = [...composerImages, ...localImages].slice(0, 16);
    let effectiveQuestion = nextQuestion;

    if (composerLocalFiles.length > 0) {
      const localFilesContent = composerLocalFiles
        .map((f) => `【附加本地文件：${f.name}】\n${f.text}`)
        .join("\n\n");
      effectiveQuestion = `${effectiveQuestion}\n\n${localFilesContent}`;
    }

    const isPaperAssemblyRequest =
      /组卷|出卷|套卷|试卷|挑.*题|出.*题|模拟卷|练习卷|测试卷|做题本/.test(
        nextQuestion,
      );
    if (
      isPaperAssemblyRequest &&
      questionBankSnapshot &&
      questionBankSnapshot.questions.length > 0
    ) {
      const bankSummary = summarizeQuestionBankForPrompt(
        questionBankSnapshot.questions,
      );
      effectiveQuestion = `${effectiveQuestion}\n\n${bankSummary}`;
    }

    const request = buildPlanningChatRequest(
      activeId,
      effectiveQuestion,
      [],
      undefined,
      questionContext,
      attachments.map((attachment) => attachment.id),
      images,
    );
    if (request === undefined) return;
    setComposerImages([]);
    setComposerLocalFiles([]);
    if (conversationKind === "chat") {
      executeDirect(request);
      return;
    }
    const requestId = ++previewRequestIdRef.current;
    void run("preview", async () => {
      const nextPreview = await chatApi.preview(request);
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
    const operationId = crypto.randomUUID();
    activeOperationIdRef.current = operationId;
    const userMsgId = `temp-user-${operationId}`;
    const assistantMsgId = `temp-assistant-${operationId}`;
    const userContent = preparedRequest.question;
    const userMsg: PlanningMessage = {
      id: userMsgId,
      role: "user",
      content: userContent,
      sources: [],
      createdAt: Date.now(),
    };
    const assistantMsg: PlanningMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      sources: [],
      createdAt: Date.now(),
    };

    setConversations((current) =>
      current.map((c) => {
        if (c.id !== preparedRequest.conversationId) return c;
        return {
          ...c,
          messages: [...c.messages, userMsg, assistantMsg],
        };
      }),
    );

    void run("execute", async () => {
      try {
        const reply = await executePlanningChatStream(
          {
            ...preparedRequest,
            confirmedPrompt,
            confirmedRequestFingerprint: preview.preview.requestFingerprint,
          },
          (delta) => {
            if (
              !isCurrentPlanningRequest(
                requestId,
                executeRequestIdRef.current,
                mountedRef.current,
              )
            ) {
              return;
            }
            setConversations((current) =>
              current.map((c) => {
                if (c.id !== preparedRequest.conversationId) return c;
                return {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: m.content + delta }
                      : m,
                  ),
                };
              }),
            );
          },
          operationId,
        );
        applyReply(reply, requestId);
      } catch (err) {
        setConversations((current) =>
          current.map((c) => {
            if (c.id !== preparedRequest.conversationId) return c;
            return {
              ...c,
              messages: c.messages.filter(
                (m) => m.id !== userMsgId && m.id !== assistantMsgId,
              ),
            };
          }),
        );
        throw err;
      } finally {
        if (activeOperationIdRef.current === operationId) {
          activeOperationIdRef.current = undefined;
        }
      }
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

  const copyMessage = (
    message: PlanningMessage,
    format: "markdown" | "text" = "markdown",
  ) => {
    if (!navigator.clipboard) {
      setNotice("当前环境不支持自动复制，请手动选择消息文本复制。");
      return;
    }
    const content =
      format === "text"
        ? markdownToPlainText(message.content)
        : message.content;
    void navigator.clipboard.writeText(content).then(
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
    invalidatePreview();
    if (!standalone) {
      setNotice("正在重新生成这条问题的外发预览，请确认后发送。");
    }
    prepareQuestion(previousUserMessage.content);
  };

  const cancelCurrentRequest = () => {
    previewRequestIdRef.current += 1;
    executeRequestIdRef.current += 1;
    conversationRequestIdRef.current += 1;
    draftRequestIdRef.current += 1;
    const operationId = activeOperationIdRef.current;
    if (operationId !== undefined) {
      void cancelAiChatOperation(operationId).catch(() => undefined);
      activeOperationIdRef.current = undefined;
    }
    resourceIndexControllerRef.current?.abort();
    resourceIndexControllerRef.current = undefined;
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
              ? "可直接发送消息，也可以添加本地资料作为上下文。"
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
          {headerAction === undefined ? null : (
            <header className="planning-chat-workspace-header">
              <div className="planning-chat-workspace-header-title">
                {activeConversation?.title ? (
                  <span>{activeConversation.title}</span>
                ) : null}
              </div>
              <div className="planning-chat-workspace-header-actions">
                {headerAction}
              </div>
            </header>
          )}
          <AssistantChatRuntime
            conversation={activeConversation}
            busy={busy !== undefined}
            onPrepare={prepareQuestion}
            onCancel={cancelCurrentRequest}
          >
            <AssistantChatThread
              conversation={activeConversation}
              questionBankQuestions={questionBankSnapshot?.questions ?? []}
              onStartPaper={onStartPaper}
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
                <AssistantChatComposer
                  directMode={standalone}
                  busy={busy !== undefined}
                  attachmentCount={attachments.length}
                  attachmentsOpen={attachmentsOpen}
                  images={composerImages}
                  localFiles={composerLocalFiles}
                  onImagesChange={setComposerImages}
                  onLocalFilesChange={setComposerLocalFiles}
                  onToggleAttachments={() =>
                    setAttachmentsOpen((open) => !open)
                  }
                  submitButtonRef={previewTriggerRef}
                />
                <ResourceContextDialog
                  key={activeId}
                  open={attachmentsOpen}
                  busy={busy !== undefined}
                  attachments={attachments}
                  resources={resources}
                  resourcesLoaded={resourcesLoaded}
                  importEvent={importEvent}
                  uploadCanceling={uploadCanceling}
                  onClose={() => setAttachmentsOpen(false)}
                  onOpenResources={loadResources}
                  onAttach={attachResource}
                  onRetryAttachment={retryAttachment}
                  onRemoveAttachment={removeAttachment}
                  onUploadComputerResource={uploadComputerResource}
                  onCancelUpload={cancelUpload}
                  onRetryUpload={uploadComputerResource}
                />
                {standalone ? null : (
                  <PreviewDialog
                    preview={preview}
                    contextCount={0}
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
                )}
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
          </AssistantChatRuntime>
        </div>
      </div>
    </section>
  );
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?/, "").replace(/```$/, ""),
    )
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
