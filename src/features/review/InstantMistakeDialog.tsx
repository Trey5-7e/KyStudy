import { useMemo, useState } from "react";
import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import type { StudySubject } from "../../shared/tauri/scheduleClient";
import {
  filterMistakePool,
  selectInstantMistakeQuestions,
} from "./instantMistakeModel";

export function InstantMistakeDialog({
  questions,
  subjects,
  onClose,
  onStartDrill,
}: {
  questions: readonly IndexedQuestion[];
  subjects: readonly StudySubject[];
  onClose(): void;
  onStartDrill(
    selectedQuestions: IndexedQuestion[],
    targetCount: number,
    subjectId?: string,
  ): void;
}) {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>("");
  const [selectedCount, setSelectedCount] = useState<number>(10);
  const [customInput, setCustomInput] = useState<string>("10");

  const mistakePool = useMemo(
    () =>
      filterMistakePool(
        questions,
        selectedSubjectId ? selectedSubjectId : undefined,
      ),
    [questions, selectedSubjectId],
  );

  const poolSize = mistakePool.length;

  const quickCounts = [5, 10, 15, 20];

  const handleSelectCount = (count: number) => {
    const clamped = Math.max(1, Math.min(count, Math.max(1, poolSize)));
    setSelectedCount(clamped);
    setCustomInput(String(clamped));
  };

  const handleCustomInputChange = (value: string) => {
    setCustomInput(value);
    const parsed = parseInt(value, 10);
    if (!isNaN(parsed) && parsed > 0) {
      setSelectedCount(Math.min(parsed, Math.max(1, poolSize)));
    }
  };

  const effectiveCount = Math.min(
    Math.max(1, selectedCount),
    Math.max(1, poolSize),
  );

  const handleConfirm = () => {
    if (poolSize === 0) return;
    const selected = selectInstantMistakeQuestions(questions, {
      count: effectiveCount,
      subjectId: selectedSubjectId ? selectedSubjectId : undefined,
    });
    onStartDrill(
      selected,
      effectiveCount,
      selectedSubjectId ? selectedSubjectId : undefined,
    );
  };

  return (
    <EditorDialog
      title="立即刷错题"
      description="无需等待次日排期，系统将根据错题顽固程度与艾宾浩斯复习算法直接为您推送高优先级错题。"
      dirty={false}
      onRequestClose={onClose}
      size="medium"
    >
      <div className="instant-mistake-dialog-content">
        <section className="instant-mistake-section">
          <label
            className="instant-mistake-label"
            htmlFor="instant-mistake-subject"
          >
            选择科目范围
          </label>
          <select
            id="instant-mistake-subject"
            className="instant-mistake-select"
            value={selectedSubjectId}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
          >
            <option value="">全部科目</option>
            {subjects.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </select>
        </section>

        <section className="instant-mistake-pool-card">
          <div className="instant-mistake-pool-header">
            <span className="instant-mistake-pool-title">错题池容量</span>
            <Badge tone={poolSize > 0 ? "info" : "neutral"}>
              {poolSize > 0 ? `${poolSize} 道待巩固` : "暂无错题"}
            </Badge>
          </div>
          <p className="instant-mistake-pool-desc">
            {poolSize > 0
              ? `当前范围内共有 ${poolSize} 道做错或模糊的题目。算法将优先推送当前未攻克、遗忘率最高与历史错误频次最高的错题。`
              : "当前范围内暂无错题记录。可以在习题册中做题或标记错题后，再来此处随时发起特训。"}
          </p>
        </section>

        <section className="instant-mistake-section">
          <label className="instant-mistake-label">本次刷题数量</label>
          <div className="instant-mistake-pills">
            {quickCounts.map((count) => {
              const disabled = poolSize > 0 && poolSize < count;
              const isSelected = selectedCount === count;
              return (
                <button
                  key={count}
                  type="button"
                  className={`instant-mistake-pill ${isSelected ? "is-selected" : ""}`}
                  disabled={disabled || poolSize === 0}
                  onClick={() => handleSelectCount(count)}
                >
                  {count} 题
                </button>
              );
            })}
            {poolSize > 0 && (
              <button
                type="button"
                className={`instant-mistake-pill ${selectedCount === poolSize ? "is-selected" : ""}`}
                onClick={() => handleSelectCount(poolSize)}
              >
                全部错题（{poolSize} 题）
              </button>
            )}
          </div>

          <div className="instant-mistake-custom-row">
            <span className="instant-mistake-custom-label">自定义题量：</span>
            <input
              type="number"
              className="instant-mistake-number-input"
              min={1}
              max={Math.max(1, poolSize)}
              value={customInput}
              disabled={poolSize === 0}
              onChange={(e) => handleCustomInputChange(e.target.value)}
              onBlur={() => setCustomInput(String(effectiveCount))}
            />
            <span className="instant-mistake-custom-unit">题</span>
            {poolSize > 0 && selectedCount > poolSize && (
              <small className="instant-mistake-custom-hint">
                超过错题池总数，已自动调整为全部 {poolSize} 题
              </small>
            )}
          </div>
        </section>
      </div>
      <EditorDialogFooter>
        <EditorDialogCloseButton>取消</EditorDialogCloseButton>
        <Button
          variant="primary"
          disabled={poolSize === 0}
          onClick={handleConfirm}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            bolt
          </span>
          开始刷题{poolSize > 0 ? `（${effectiveCount} 题）` : ""}
        </Button>
      </EditorDialogFooter>
    </EditorDialog>
  );
}
