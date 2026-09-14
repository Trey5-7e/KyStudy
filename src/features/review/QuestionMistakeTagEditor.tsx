import { useState } from "react";
import {
  PRESET_MISTAKE_TAGS,
  addTagToQuestion,
  getMistakeTagTone,
  removeTagFromQuestion,
} from "./mistakeTagModel";

export interface QuestionMistakeTagEditorProps {
  questionId: string;
  tags: readonly string[];
  disabled?: boolean;
}

export function QuestionMistakeTagEditor({
  questionId,
  tags,
  disabled = false,
}: QuestionMistakeTagEditorProps) {
  const [newTagInput, setNewTagInput] = useState("");

  const presetLabels = new Set(PRESET_MISTAKE_TAGS.map((p) => p.label));
  const customTags = tags.filter((t) => !presetLabels.has(t));

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagInput.trim();
    if (!trimmed) return;
    addTagToQuestion(questionId, trimmed);
    setNewTagInput("");
  };

  return (
    <section
      className="mistake-tag-editor-section"
      aria-label="错题归因与考点标签"
    >
      <div className="mistake-tag-editor-header">
        <div className="mistake-tag-editor-title">
          <span className="material-symbols-rounded" aria-hidden="true">
            sell
          </span>
          <strong>错题归因与考点标签</strong>
          <span className="mistake-tag-editor-hint">
            点击贴上或取消失分原因
          </span>
        </div>
      </div>

      {/* 预设失分原因标签池 */}
      <div
        className="mistake-preset-tags-grid"
        role="group"
        aria-label="预设归因标签"
      >
        {PRESET_MISTAKE_TAGS.map((preset) => {
          const isSelected = tags.includes(preset.label);
          return (
            <button
              key={preset.id}
              type="button"
              className={`mistake-tag-toggle-chip tone-${preset.tone} ${isSelected ? "is-selected" : ""}`}
              title={preset.description}
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => {
                if (isSelected) {
                  removeTagFromQuestion(questionId, preset.label);
                } else {
                  addTagToQuestion(questionId, preset.label);
                }
              }}
            >
              <span
                className="material-symbols-rounded tag-chip-icon"
                aria-hidden="true"
              >
                {isSelected ? "check" : "add"}
              </span>
              <span>{preset.label}</span>
            </button>
          );
        })}
      </div>

      {/* 自定义考点与补充标签 */}
      <div className="mistake-custom-tags-container">
        {customTags.length > 0 ? (
          <div className="mistake-custom-tags-list" aria-label="自定义标签">
            {customTags.map((tag) => (
              <span
                key={tag}
                className={`mistake-tag-chip is-custom tone-${getMistakeTagTone(tag)}`}
              >
                <span
                  className="material-symbols-rounded tag-chip-icon"
                  aria-hidden="true"
                >
                  label
                </span>
                <span>{tag}</span>
                {!disabled && (
                  <button
                    type="button"
                    className="tag-remove-btn"
                    aria-label={`移除标签 ${tag}`}
                    onClick={() => removeTagFromQuestion(questionId, tag)}
                  >
                    <span
                      className="material-symbols-rounded"
                      aria-hidden="true"
                    >
                      close
                    </span>
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : null}

        <form
          className="mistake-custom-tag-form"
          onSubmit={handleAddCustom}
          role="search"
          aria-label="添加自定义标签"
        >
          <input
            type="text"
            className="mistake-custom-tag-input"
            placeholder="+ 自定义考点 (如: 中值定理、反常积分，按 Enter 添加)"
            value={newTagInput}
            disabled={disabled}
            onChange={(e) => setNewTagInput(e.target.value)}
            maxLength={25}
          />
          <button
            type="submit"
            className="mistake-custom-tag-submit"
            disabled={disabled || !newTagInput.trim()}
          >
            添加
          </button>
        </form>
      </div>
    </section>
  );
}
