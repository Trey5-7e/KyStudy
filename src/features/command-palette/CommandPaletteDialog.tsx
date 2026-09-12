import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { filterCommands, type CommandItem } from "./commandPaletteModel";
import "./command-palette.css";

export function CommandPaletteDialog({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: readonly CommandItem[];
  onClose(): void;
}) {
  if (!open) return null;
  return <CommandPaletteModal commands={commands} onClose={onClose} />;
}

function CommandPaletteModal({
  commands,
  onClose,
}: {
  commands: readonly CommandItem[];
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchId = useId();

  const filtered = useMemo(
    () => filterCommands(commands, query),
    [commands, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep selected item visible in list
  useEffect(() => {
    const activeElement = listRef.current?.children[activeIndex] as HTMLElement;
    if (activeElement && typeof activeElement.scrollIntoView === "function") {
      activeElement.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    setActiveIndex(0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filtered.length > 0) {
        setActiveIndex(
          (prev) => (prev - 1 + filtered.length) % filtered.length,
        );
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = filtered[activeIndex];
      if (selected) {
        onClose();
        selected.perform();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const handleSelect = (item: CommandItem) => {
    onClose();
    item.perform();
  };

  // Group commands by category
  const actionItems = filtered.filter((item) => item.category === "action");
  const navigationItems = filtered.filter(
    (item) => item.category === "navigation",
  );

  return (
    <div
      className="command-palette-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={searchId}
    >
      <div className="command-palette-modal">
        <div className="command-palette-search-wrapper">
          <span
            className="material-symbols-rounded command-palette-search-icon"
            aria-hidden="true"
          >
            search
          </span>
          <input
            id={searchId}
            ref={inputRef}
            type="text"
            className="command-palette-search-input"
            placeholder="搜索高频学习功能或页面导航… (Esc 退出)"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="command-palette-search-clear"
              aria-label="清空搜索"
              onClick={() => {
                handleQueryChange("");
                inputRef.current?.focus();
              }}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                close
              </span>
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="command-palette-empty">
            <span className="material-symbols-rounded" aria-hidden="true">
              search_off
            </span>
            <p>未找到匹配的快捷操作或页面导航</p>
          </div>
        ) : (
          <ul
            ref={listRef}
            className="command-palette-list"
            role="listbox"
            tabIndex={-1}
          >
            {renderGroup(
              "高频学习动作",
              actionItems,
              filtered,
              activeIndex,
              handleSelect,
              setActiveIndex,
            )}
            {renderGroup(
              "页面快速导航",
              navigationItems,
              filtered,
              activeIndex,
              handleSelect,
              setActiveIndex,
            )}
          </ul>
        )}

        <footer className="command-palette-footer">
          <div className="command-palette-footer-hints">
            <span className="command-palette-footer-hint">
              <kbd>↑</kbd> <kbd>↓</kbd> 切换
            </span>
            <span className="command-palette-footer-hint">
              <kbd>Enter</kbd> 确认执行
            </span>
            <span className="command-palette-footer-hint">
              <kbd>Esc</kbd> 关闭
            </span>
          </div>
          <span>KyStudy 快捷直达</span>
        </footer>
      </div>
    </div>
  );
}

function renderGroup(
  groupTitle: string,
  groupItems: CommandItem[],
  allItems: CommandItem[],
  activeIndex: number,
  onSelect: (item: CommandItem) => void,
  onHover: (index: number) => void,
) {
  if (groupItems.length === 0) return null;

  return (
    <>
      <li className="command-palette-category-title" aria-hidden="true">
        {groupTitle}
      </li>
      {groupItems.map((item) => {
        const overallIndex = allItems.indexOf(item);
        const isActive = overallIndex === activeIndex;

        return (
          <li
            key={item.id}
            role="option"
            aria-selected={isActive}
            className={`command-palette-item ${isActive ? "is-active" : ""}`}
            onClick={() => onSelect(item)}
            onMouseEnter={() => onHover(overallIndex)}
          >
            <span
              className="material-symbols-rounded command-palette-item-icon"
              aria-hidden="true"
            >
              {item.icon}
            </span>
            <div className="command-palette-item-content">
              <span className="command-palette-item-title">{item.title}</span>
              <span className="command-palette-item-desc">
                {item.description}
              </span>
            </div>
            {item.shortcutHint && (
              <div className="command-palette-item-hint">
                <kbd>{item.shortcutHint}</kbd>
              </div>
            )}
          </li>
        );
      })}
    </>
  );
}
