import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";

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
  onRename(conversation: PlanningConversation): void;
  onDelete(conversation: PlanningConversation): void;
}

interface ConversationItemMenuProps {
  conversation: PlanningConversation;
  disabled: boolean;
  onRename(conversation: PlanningConversation): void;
  onDelete(conversation: PlanningConversation): void;
}

function ConversationItemMenu({
  conversation,
  disabled,
  onRename,
  onDelete,
}: ConversationItemMenuProps) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const positionMenu = useCallback(() => {
    const summary = summaryRef.current;
    const popover = popoverRef.current;
    if (!summary || !popover) return;
    const anchor = summary.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const gap = 8;
    const viewportPadding = 8;
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - width - viewportPadding,
    );
    const left = Math.min(
      Math.max(viewportPadding, anchor.right - width),
      maxLeft,
    );
    const opensDown =
      anchor.bottom + gap + height <= window.innerHeight - viewportPadding;
    const top = opensDown
      ? anchor.bottom + gap
      : Math.max(viewportPadding, anchor.top - gap - height);
    setMenuPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const frame = window.requestAnimationFrame(positionMenu);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [menuOpen, positionMenu]);

  const closeMenu = useCallback(() => {
    menuRef.current?.removeAttribute("open");
    setMenuOpen(false);
    setMenuPosition(null);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [closeMenu, menuOpen]);

  return (
    <details
      ref={menuRef}
      className="planning-conversation-menu"
      onToggle={() => {
        const open = menuRef.current?.open ?? false;
        setMenuOpen(open);
        if (!open) setMenuPosition(null);
      }}
    >
      <summary ref={summaryRef} aria-label={`更多操作 ${conversation.title}`}>
        <span className="material-symbols-rounded" aria-hidden="true">
          more_vert
        </span>
      </summary>
      <div
        ref={popoverRef}
        className="planning-conversation-menu-popover"
        style={
          menuPosition === null
            ? { visibility: "hidden" }
            : {
                top: menuPosition.top,
                left: menuPosition.left,
                visibility: "visible",
              }
        }
      >
        <button
          type="button"
          className="planning-conversation-menu-item"
          disabled={disabled}
          onClick={() => {
            closeMenu();
            onRename(conversation);
          }}
        >
          重命名
        </button>
        <button
          type="button"
          className="planning-conversation-menu-item planning-conversation-menu-danger"
          disabled={disabled}
          onClick={() => {
            closeMenu();
            onDelete(conversation);
          }}
        >
          删除
        </button>
      </div>
    </details>
  );
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
  onRename,
  onDelete,
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
              <div className="planning-conversation-item-actions">
                <ConversationItemMenu
                  conversation={conversation}
                  disabled={busy}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              </div>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
