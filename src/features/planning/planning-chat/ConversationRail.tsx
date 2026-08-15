import type { FormEvent, RefObject } from "react";

import type { PlanningConversation } from "../../../shared/tauri/planningChatClient";

interface ConversationRailProps {
  conversations: PlanningConversation[];
  activeId?: string;
  newTitle: string;
  busy: boolean;
  activeButtonRef?: RefObject<HTMLButtonElement | null>;
  onTitleChange(value: string): void;
  onCreate(event: FormEvent): void;
  onSelect(conversation: PlanningConversation): void;
}

export function ConversationRail({
  conversations,
  activeId,
  newTitle,
  busy,
  activeButtonRef,
  onTitleChange,
  onCreate,
  onSelect,
}: ConversationRailProps) {
  return (
    <aside className="planning-chat-conversation-rail" aria-label="规划对话">
      <form className="planning-chat-new-conversation" onSubmit={onCreate}>
        <label>
          新对话标题
          <input
            maxLength={120}
            value={newTitle}
            onChange={(event) => onTitleChange(event.target.value)}
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          新建对话
        </button>
      </form>
      <nav aria-label="对话列表">
        <ul className="planning-conversation-items" role="list">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                ref={conversation.id === activeId ? activeButtonRef : undefined}
                type="button"
                disabled={busy}
                aria-current={conversation.id === activeId ? "page" : undefined}
                onClick={() => onSelect(conversation)}
              >
                <strong>{conversation.title}</strong>
                <span>{conversation.messages.length} 条消息</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
