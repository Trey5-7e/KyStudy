import type { PlanningConversation } from "../../../shared/tauri/planningChatClient";

interface ThreadProps {
  conversation?: PlanningConversation;
  onOpenReference(documentId: string, page: number): void;
}

export function Thread({ conversation, onOpenReference }: ThreadProps) {
  if (conversation === undefined) {
    return <p className="empty-state">新建一段对话后开始规划。</p>;
  }

  return (
    <div className="planning-chat-thread">
      {conversation.messages.length === 0 ? (
        <p className="empty-state">搜索本地资料，然后提出第一个规划问题。</p>
      ) : null}
      {conversation.messages.map((message) => (
        <article
          key={message.id}
          className={`planning-message planning-message-${message.role}`}
        >
          <strong>{message.role === "user" ? "你" : "AI 建议"}</strong>
          <p>{message.content}</p>
          {message.sources.length === 0 ? null : (
            <details className="planning-message-sources">
              <summary>查看 {message.sources.length} 个引用来源</summary>
              <div>
                {message.sources.map((source) => (
                  <button
                    key={`${source.documentId}:${source.pageNumber}`}
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      onOpenReference(source.documentId, source.pageNumber)
                    }
                  >
                    {source.citationLabel} {source.documentTitle} · 第
                    {source.pageNumber} 页
                  </button>
                ))}
              </div>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}
