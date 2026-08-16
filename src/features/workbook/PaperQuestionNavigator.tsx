import type {
  AttemptResult,
  QuestionType,
} from "../../shared/tauri/questionClient";
import type {
  PaperQuestionFilter,
  PaperViewMode,
} from "./paperNavigationModel";

export interface PaperQuestionNavigatorProps {
  mode: PaperViewMode;
  selectedQuestionType: PaperQuestionFilter;
  counts: Readonly<Record<PaperQuestionFilter, number>>;
  filteredIndex?: number;
  filteredTotal: number;
  paperIndex?: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  questionOverview: readonly PaperQuestionOverviewItem[];
  onModeChange(mode: PaperViewMode): void;
  onFilterChange(filter: PaperQuestionFilter): void;
  onPrevious(): void;
  onNext(): void;
  onQuestionSelect(questionId: string): void;
  onNextUnanswered(): void;
}

export interface PaperQuestionOverviewItem {
  id: string;
  label: string;
  result?: AttemptResult;
  active: boolean;
}

const FILTERS: readonly { value: PaperQuestionFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "choice", label: "选择题" },
  { value: "blank", label: "填空题" },
  { value: "solution", label: "解答题" },
  { value: "other", label: "其他" },
];

export function PaperQuestionNavigator({
  mode,
  selectedQuestionType,
  counts,
  filteredIndex,
  filteredTotal,
  paperIndex,
  canGoPrevious,
  canGoNext,
  questionOverview,
  onModeChange,
  onFilterChange,
  onPrevious,
  onNext,
  onQuestionSelect,
  onNextUnanswered,
}: PaperQuestionNavigatorProps) {
  return (
    <>
      <div className="generated-paper-mode-row">
        <span>浏览模式</span>
        {(["continuous", "single"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={mode === value ? "is-active" : "secondary-button"}
            aria-pressed={mode === value}
            onClick={() => onModeChange(value)}
          >
            {value === "continuous" ? "连续浏览" : "单题浏览"}
          </button>
        ))}
        {mode === "single" ? (
          <div className="generated-paper-question-navigation">
            <button
              type="button"
              className="secondary-button"
              disabled={!canGoPrevious}
              onClick={onPrevious}
            >
              ← 上一题
            </button>
            <span aria-live="polite">
              筛选内 {filteredIndex === undefined ? 0 : filteredIndex + 1}/
              {filteredTotal} · 全卷第{" "}
              {paperIndex === undefined ? 0 : paperIndex + 1} 题
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={!canGoNext}
              onClick={onNext}
            >
              下一题 →
            </button>
          </div>
        ) : null}
      </div>
      <nav className="generated-paper-nav" aria-label="练习卷题型筛选">
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={
              selectedQuestionType === filter.value ? "is-active" : undefined
            }
            aria-pressed={selectedQuestionType === filter.value}
            onClick={() => onFilterChange(filter.value)}
          >
            {filter.label}
            <span>{counts[filter.value]}</span>
          </button>
        ))}
      </nav>
      <details className="generated-paper-overview">
        <summary>题号总览（{questionOverview.length} 题）</summary>
        <div className="generated-paper-overview-actions">
          <button
            type="button"
            className="text-button"
            onClick={onNextUnanswered}
          >
            跳到下一道未作答题
          </button>
        </div>
        <div className="generated-paper-overview-grid" role="list">
          {questionOverview.map((question) => (
            <div key={question.id} role="listitem">
              <button
                type="button"
                className={question.active ? "is-active" : undefined}
                aria-current={question.active ? "step" : undefined}
                onClick={() => onQuestionSelect(question.id)}
              >
                <span>{question.label}</span>
                <small>
                  {question.result === undefined
                    ? "未作答"
                    : question.result === "correct"
                      ? "做对"
                      : question.result === "uncertain"
                        ? "不全对"
                        : "做错"}
                </small>
              </button>
            </div>
          ))}
        </div>
      </details>
    </>
  );
}

export type PaperQuestionTypeCount = Record<"all" | QuestionType, number>;
