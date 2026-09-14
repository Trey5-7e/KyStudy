import { useState } from "react";
import { EditorDialog } from "../../shared/components/EditorDialog";
import { Button } from "../../shared/ui/Button";
import { PRESET_MISTAKE_TAGS, getMistakeTagTone } from "./mistakeTagModel";

export interface BatchTagDialogProps {
  isOpen: boolean;
  selectedQuestionsCount: number;
  allKnownTags: readonly string[];
  onClose(): void;
  onApply(tags: string[], mode: "add" | "remove"): void;
}

export function BatchTagDialog({
  isOpen,
  selectedQuestionsCount,
  allKnownTags,
  onClose,
  onApply,
}: BatchTagDialogProps) {
  const [selectedTags, setSelectedTags] = useState<Set<string>>(
    () => new Set(),
  );
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [customInput, setCustomInput] = useState("");

  if (!isOpen) return null;

  const presetLabels = new Set(PRESET_MISTAKE_TAGS.map((p) => p.label));
  const customTags = allKnownTags.filter((t) => !presetLabels.has(t));

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  };

  const handleAddCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customInput.trim();
    if (!trimmed) return;
    setSelectedTags((prev) => new Set(prev).add(trimmed));
    setCustomInput("");
  };

  const handleConfirm = () => {
    if (selectedTags.size === 0) return;
    onApply(Array.from(selectedTags), mode);
    setSelectedTags(new Set());
    onClose();
  };

  return (
    <EditorDialog
      title={`批量打标签 (${selectedQuestionsCount} 道错题)`}
      dirty={false}
      onRequestClose={onClose}
    >
      <div className="batch-tag-dialog-content">
        {/* 操作模式切换 */}
        <div className="batch-tag-mode-toggle" role="radiogroup">
          <button
            type="button"
            className={`batch-tag-mode-btn ${mode === "add" ? "is-active" : ""}`}
            onClick={() => setMode("add")}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              add_circle
            </span>
            <span>为选中题目添加标签</span>
          </button>
          <button
            type="button"
            className={`batch-tag-mode-btn ${mode === "remove" ? "is-active" : ""}`}
            onClick={() => setMode("remove")}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              remove_circle
            </span>
            <span>从选中题目移除标签</span>
          </button>
        </div>

        {/* 预设归因标签 */}
        <div className="batch-tag-section">
          <div className="batch-tag-section-title">
            <span>常见失分归因预设</span>
            <span className="batch-tag-section-hint">点击选中/取消</span>
          </div>
          <div className="batch-tag-chips-grid">
            {PRESET_MISTAKE_TAGS.map((preset) => {
              const isChecked = selectedTags.has(preset.label);
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`mistake-tag-toggle-chip tone-${preset.tone} ${isChecked ? "is-selected" : ""}`}
                  onClick={() => toggleTag(preset.label)}
                  title={preset.description}
                  aria-pressed={isChecked}
                >
                  <span
                    className="material-symbols-rounded tag-chip-icon"
                    aria-hidden="true"
                  >
                    {isChecked ? "check" : "add"}
                  </span>
                  <span>{preset.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 现有自定义考点标签 */}
        {customTags.length > 0 ? (
          <div className="batch-tag-section">
            <div className="batch-tag-section-title">
              <span>已有自定义标签库</span>
            </div>
            <div className="batch-tag-chips-grid">
              {customTags.map((tag) => {
                const isChecked = selectedTags.has(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`mistake-tag-toggle-chip tone-${getMistakeTagTone(tag)} ${isChecked ? "is-selected" : ""}`}
                    onClick={() => toggleTag(tag)}
                    aria-pressed={isChecked}
                  >
                    <span
                      className="material-symbols-rounded tag-chip-icon"
                      aria-hidden="true"
                    >
                      {isChecked ? "check" : "add"}
                    </span>
                    <span>{tag}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* 添加新自定义考点 */}
        <div className="batch-tag-section">
          <div className="batch-tag-section-title">
            <span>新建考点标签</span>
          </div>
          <form className="batch-tag-input-form" onSubmit={handleAddCustom}>
            <input
              type="text"
              className="mistake-custom-tag-input"
              placeholder="输入新标签名并回车，直接加入本次勾选…"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              maxLength={25}
            />
            <Button
              variant="secondary"
              size="sm"
              type="submit"
              disabled={!customInput.trim()}
            >
              加入本次选择
            </Button>
          </form>
        </div>

        {/* 待应用标签预览 */}
        <div className="batch-tag-summary">
          <span>
            准备{mode === "add" ? "添加" : "移除"}的标签（
            {selectedTags.size} 个）：
          </span>
          {selectedTags.size > 0 ? (
            <div className="batch-tag-summary-chips">
              {Array.from(selectedTags).map((tag) => (
                <span
                  key={tag}
                  className={`mistake-tag-chip tone-${getMistakeTagTone(tag)}`}
                >
                  {tag}
                  <button
                    type="button"
                    className="tag-remove-btn"
                    onClick={() => toggleTag(tag)}
                    aria-label={`移除本次所选 ${tag}`}
                  >
                    <span
                      className="material-symbols-rounded"
                      aria-hidden="true"
                    >
                      close
                    </span>
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="batch-tag-summary-empty">
              请在上方点击选择或输入标签
            </span>
          )}
        </div>

        {/* 底部确认操作按钮 */}
        <div className="batch-tag-actions">
          <Button variant="ghost" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={selectedTags.size === 0}
            onClick={handleConfirm}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              check
            </span>
            <span>
              确认{mode === "add" ? "批量添加" : "批量移除"} (
              {selectedTags.size})
            </span>
          </Button>
        </div>
      </div>
    </EditorDialog>
  );
}
