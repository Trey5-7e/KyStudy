import type { FormEvent, RefObject } from "react";

interface ComposerProps {
  question: string;
  busy: boolean;
  attachmentCount?: number;
  attachmentsOpen?: boolean;
  onToggleAttachments?(): void;
  submitButtonRef?: RefObject<HTMLButtonElement | null>;
  onQuestionChange(value: string): void;
  onPrepare(event: FormEvent): void;
}

export function Composer({
  question,
  busy,
  attachmentCount = 0,
  attachmentsOpen = false,
  onToggleAttachments,
  submitButtonRef,
  onQuestionChange,
  onPrepare,
}: ComposerProps) {
  return (
    <form className="planning-chat-composer" onSubmit={onPrepare}>
      <label>
        规划问题
        <textarea
          rows={4}
          maxLength={4000}
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="描述你想完善的下一步规划。"
          required
        />
      </label>
      {onToggleAttachments === undefined ? null : (
        <button
          type="button"
          className="planning-chat-attachment-trigger"
          aria-expanded={attachmentsOpen}
          aria-controls="planning-chat-attachments"
          onClick={onToggleAttachments}
          disabled={busy}
        >
          <span aria-hidden="true">＋</span>
          <span>资料 {attachmentCount > 0 ? `(${attachmentCount})` : ""}</span>
        </button>
      )}
      <button ref={submitButtonRef} type="submit" disabled={busy}>
        生成外发预览
      </button>
    </form>
  );
}
