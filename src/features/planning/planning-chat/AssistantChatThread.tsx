import { MessagePrimitive, ThreadPrimitive } from "@assistant-ui/react";
import { LobeHub } from "@lobehub/icons";
import { useMemo } from "react";

import { MarkdownRenderer } from "../../../shared/components/MarkdownRenderer";
import type {
  PlanningConversation,
  PlanningMessage,
} from "../../../shared/tauri/planningChatClient";

import type { IndexedQuestion } from "../../../shared/tauri/questionBankClient";

interface AssistantChatThreadProps {
  conversation?: PlanningConversation;
  questionBankQuestions?: IndexedQuestion[];
  onStartPaper?(questions: IndexedQuestion[], title?: string): void;
  onOpenReference(documentId: string, page: number): void;
  onCopyMessage(message: PlanningMessage, format?: "markdown" | "text"): void;
  onRetryMessage(message: PlanningMessage): void;
}

export function AssistantChatThread({
  conversation,
  questionBankQuestions,
  onStartPaper,
  onOpenReference,
  onCopyMessage,
  onRetryMessage,
}: AssistantChatThreadProps) {
  const messageById = useMemo(
    () =>
      new Map(
        (conversation?.messages ?? []).map((message) => [message.id, message]),
      ),
    [conversation?.messages],
  );

  return (
    <ThreadPrimitive.Root className="aui-chat-thread-root">
      <ThreadPrimitive.Viewport className="aui-chat-thread-viewport">
        {conversation === undefined ? (
          <div className="aui-chat-empty-state">
            <span className="aui-chat-empty-icon" aria-hidden="true">
              ✦
            </span>
            <strong>新建一段对话，开始规划</strong>
            <span>从左侧选择历史对话，或在下方输入问题。</span>
          </div>
        ) : conversation.messages.length === 0 ? (
          <div className="aui-chat-empty-state">
            <span className="aui-chat-empty-icon" aria-hidden="true">
              ✦
            </span>
            <strong>随时提出你的学习规划或题库问题</strong>
            <span>支持从题库挑选题目组卷、上传本地资料或探讨复习策略。</span>
          </div>
        ) : null}
        <ThreadPrimitive.Messages>
          {({ message }) => {
            const item = messageById.get(message.id);
            if (item === undefined) return null;
            const isUser = item.role === "user";
            return (
              <MessagePrimitive.Root
                className={`aui-chat-message aui-chat-message-${item.role}`}
              >
                <div className="aui-chat-message-avatar" aria-hidden="true">
                  {isUser ? "你" : <LobeHub size={18} />}
                </div>
                <div className="aui-chat-message-body">
                  <div className="aui-chat-message-meta">
                    <strong>{isUser ? "你" : "AI 建议"}</strong>
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {formatTime(item.createdAt)}
                    </time>
                  </div>
                  <div className="aui-chat-message-content">
                    {item.content.length > 0 ? (
                      <MarkdownRenderer
                        source={item.content}
                        sources={item.sources}
                        onOpenReference={onOpenReference}
                        questionBankQuestions={questionBankQuestions}
                        onStartPaper={onStartPaper}
                      />
                    ) : (
                      <span
                        className="aui-chat-streaming-dot"
                        aria-label="AI 正在思考生成中..."
                      />
                    )}
                  </div>
                  <div className="aui-chat-message-actions">
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onCopyMessage(item, "markdown")}
                    >
                      复制 Markdown
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onCopyMessage(item, "text")}
                    >
                      复制纯文本
                    </button>
                    {isUser ? null : (
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onRetryMessage(item)}
                      >
                        重新生成
                      </button>
                    )}
                  </div>
                  {item.sources.length === 0 ? null : (
                    <details className="aui-chat-sources">
                      <summary>查看 {item.sources.length} 个引用来源</summary>
                      <div>
                        {item.sources.map((source) => (
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
                            {source.citationLabel} · {source.documentTitle} · 第
                            {source.pageNumber} 页
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </MessagePrimitive.Root>
            );
          }}
        </ThreadPrimitive.Messages>
        <ThreadPrimitive.ViewportFooter className="aui-chat-thread-footer">
          <ThreadPrimitive.ScrollToBottom className="aui-chat-scroll-bottom">
            回到底部
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}
