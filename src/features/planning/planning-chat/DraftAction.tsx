interface DraftActionProps {
  title: string;
  busy: boolean;
  onTitleChange(value: string): void;
  onSave(): void;
}

export function DraftAction({
  title,
  busy,
  onTitleChange,
  onSave,
}: DraftActionProps) {
  return (
    <div className="planning-draft-action">
      <label>
        草案标题
        <input
          maxLength={120}
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={busy || title.trim() === ""}
        onClick={onSave}
      >
        将最新 AI 回复保存为草案
      </button>
      <small>这里只创建待复核草案，不会直接发布为正式计划。</small>
    </div>
  );
}
