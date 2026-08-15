import type { FormEvent, RefObject } from "react";

interface ComposerProps {
  question: string;
  outputLimit: string;
  busy: boolean;
  submitButtonRef?: RefObject<HTMLButtonElement | null>;
  onQuestionChange(value: string): void;
  onOutputLimitChange(value: string): void;
  onPrepare(event: FormEvent): void;
}

export function Composer({
  question,
  outputLimit,
  busy,
  submitButtonRef,
  onQuestionChange,
  onOutputLimitChange,
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
          placeholder="描述你想完善的下一步规划。"
          required
        />
      </label>
      <label>
        输出 Token 上限
        <input
          type="number"
          min={1}
          max={1800}
          value={outputLimit}
          onChange={(event) => onOutputLimitChange(event.target.value)}
          required
        />
      </label>
      <button ref={submitButtonRef} type="submit" disabled={busy}>
        生成外发预览
      </button>
    </form>
  );
}
