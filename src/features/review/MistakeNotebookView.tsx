import { useMemo, useState } from "react";
import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import type { StudySubject } from "../../shared/tauri/scheduleClient";
import type { QuestionType } from "../../shared/tauri/questionClient";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { QuestionRegionCard } from "./QuestionRegionCard";
import {
  filterMistakeNotebook,
  isMistakeMastered,
  isMistakePending,
  summarizeMistakes,
  type MistakeNotebookFilter,
  type MistakeStatusFilter,
} from "./mistakeNotebookModel";

export interface MistakeNotebookViewProps {
  questions: readonly IndexedQuestion[];
  subjects: readonly StudySubject[];
  workbooks?: readonly { id: string; name?: string; title?: string }[];
  busy?: boolean;
  onStartDrill(
    questions: IndexedQuestion[],
    count: number,
    subjectId?: string,
  ): void;
}

export function MistakeNotebookView({
  questions,
  subjects,
  workbooks,
  busy,
  onStartDrill,
}: MistakeNotebookViewProps) {
  const [filter, setFilter] = useState<MistakeNotebookFilter>({
    subjectId: undefined,
    workbookId: undefined,
    questionType: "all",
    status: "all",
    query: "",
  });

  const [expandedQuestionId, setExpandedQuestionId] = useState<string>();

  const subjectsById = useMemo(
    () => new Map(subjects.map((s) => [s.id, s.name])),
    [subjects],
  );

  const workbooksById = useMemo(
    () =>
      new Map((workbooks ?? []).map((w) => [w.id, w.name ?? w.title ?? w.id])),
    [workbooks],
  );

  const summary = useMemo(() => summarizeMistakes(questions), [questions]);

  const filteredQuestions = useMemo(
    () => filterMistakeNotebook(questions, filter),
    [questions, filter],
  );

  const handleStatusChange = (status: MistakeStatusFilter) => {
    setFilter((prev) => ({ ...prev, status }));
  };

  const handleResetFilter = () => {
    setFilter({
      subjectId: undefined,
      workbookId: undefined,
      questionType: "all",
      status: "all",
      query: "",
    });
  };

  return (
    <div className="mistake-notebook">
      {/* 概览数据统计卡 */}
      <section className="mistake-notebook-summary" aria-label="错题统计指标">
        <div className="mistake-notebook-summary-metric">
          <span className="mistake-metric-label">累计错题</span>
          <strong className="mistake-metric-value">
            {summary.totalCount}
            <small className="mistake-metric-unit">题</small>
          </strong>
        </div>
        <div className="mistake-notebook-summary-metric">
          <span className="mistake-metric-label">待攻克</span>
          <strong className="mistake-metric-value is-pending">
            {summary.pendingCount}
            <small className="mistake-metric-unit">题</small>
          </strong>
        </div>
        <div className="mistake-notebook-summary-metric">
          <span className="mistake-metric-label">已攻克</span>
          <strong className="mistake-metric-value is-mastered">
            {summary.masteredCount}
            <small className="mistake-metric-unit">题</small>
          </strong>
        </div>
        <div className="mistake-notebook-summary-metric">
          <span className="mistake-metric-label">攻克掌握率</span>
          <strong className="mistake-metric-value">
            {summary.masteryRate}
            <small className="mistake-metric-unit">%</small>
          </strong>
        </div>

        <div className="mistake-notebook-summary-actions">
          {filteredQuestions.length > 0 ? (
            <Button
              variant="primary"
              size="sm"
              disabled={busy}
              onClick={() =>
                onStartDrill(
                  filteredQuestions,
                  filteredQuestions.length,
                  filter.subjectId,
                )
              }
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                bolt
              </span>
              <span>特训当前筛选错题（{filteredQuestions.length} 题）</span>
            </Button>
          ) : null}
        </div>
      </section>

      {/* 多维筛选工具条 */}
      <div className="mistake-notebook-toolbar">
        <div className="mistake-notebook-toolbar-group">
          {/* 科目筛选 */}
          <select
            className="mistake-notebook-select"
            value={filter.subjectId ?? ""}
            aria-label="筛选科目"
            onChange={(e) =>
              setFilter((prev) => ({
                ...prev,
                subjectId: e.target.value ? e.target.value : undefined,
              }))
            }
          >
            <option value="">全部科目</option>
            {subjects.map((sub) => (
              <option key={sub.id} value={sub.id}>
                {sub.name}
              </option>
            ))}
          </select>

          {/* 掌握状态分段切换 */}
          <div className="mistake-status-pills" role="radiogroup">
            <button
              type="button"
              className={`mistake-status-pill ${filter.status === "all" ? "is-active" : ""}`}
              onClick={() => handleStatusChange("all")}
            >
              全部 ({summary.totalCount})
            </button>
            <button
              type="button"
              className={`mistake-status-pill ${filter.status === "pending" ? "is-active" : ""}`}
              onClick={() => handleStatusChange("pending")}
            >
              待攻克 ({summary.pendingCount})
            </button>
            <button
              type="button"
              className={`mistake-status-pill ${filter.status === "mastered" ? "is-active" : ""}`}
              onClick={() => handleStatusChange("mastered")}
            >
              已攻克 ({summary.masteredCount})
            </button>
          </div>

          {/* 题型筛选 */}
          <select
            className="mistake-notebook-select"
            value={filter.questionType ?? "all"}
            aria-label="筛选题型"
            onChange={(e) =>
              setFilter((prev) => ({
                ...prev,
                questionType: e.target.value as QuestionType | "all",
              }))
            }
          >
            <option value="all">全部题型</option>
            <option value="choice">选择题</option>
            <option value="blank">填空题</option>
            <option value="solution">解答题</option>
          </select>
        </div>

        {/* 关键词搜索框 */}
        <div className="mistake-notebook-search">
          <span
            className="material-symbols-rounded mistake-search-icon"
            aria-hidden="true"
          >
            search
          </span>
          <input
            type="text"
            className="mistake-search-input"
            placeholder="搜索题号、标题、章节、习题册或备注…"
            value={filter.query}
            onChange={(e) =>
              setFilter((prev) => ({ ...prev, query: e.target.value }))
            }
          />
          {filter.query.length > 0 ? (
            <button
              type="button"
              className="mistake-search-clear"
              aria-label="清空输入"
              onClick={() => setFilter((prev) => ({ ...prev, query: "" }))}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                close
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {/* 错题列表展示 */}
      {summary.totalCount === 0 ? (
        <div className="mistake-notebook-empty">
          <span
            className="material-symbols-rounded mistake-empty-icon"
            aria-hidden="true"
          >
            verified
          </span>
          <h3>题库中暂无错题记录</h3>
          <p>在习题册完成做题或快速登记后，做错与模糊题目将自动归档至此。</p>
        </div>
      ) : filteredQuestions.length === 0 ? (
        <div className="mistake-notebook-empty">
          <span
            className="material-symbols-rounded mistake-empty-icon"
            aria-hidden="true"
          >
            search_off
          </span>
          <h3>未找到匹配条件的错题</h3>
          <p>请尝试更换科目、掌握状态或调整搜索关键词。</p>
          <Button variant="secondary" size="sm" onClick={handleResetFilter}>
            重置筛选条件
          </Button>
        </div>
      ) : (
        <div className="mistake-notebook-list">
          {filteredQuestions.map((q, index) => {
            const isPending = isMistakePending(q);
            const isMastered = isMistakeMastered(q);
            const isExpanded = expandedQuestionId === q.id;
            const subjectName =
              subjectsById.get(q.subjectId) ??
              workbooksById.get(q.workbookId) ??
              "未归类科目";

            const typeLabel =
              q.questionType === "choice"
                ? "选择题"
                : q.questionType === "blank"
                  ? "填空题"
                  : "解答题";

            return (
              <article key={q.id} className="mistake-question-card">
                <header className="mistake-card-header">
                  <div className="mistake-card-meta">
                    <span className="mistake-meta-tag">{subjectName}</span>
                    <span className="mistake-meta-tag is-secondary">
                      {q.documentTitle}
                    </span>
                    {q.chapter ? (
                      <span className="mistake-meta-chapter">{q.chapter}</span>
                    ) : null}
                    <span className="mistake-meta-type">{typeLabel}</span>
                  </div>
                  <div className="mistake-card-badge">
                    {isPending ? (
                      q.currentResult === "incorrect" ? (
                        <Badge tone="danger">做错</Badge>
                      ) : (
                        <Badge tone="warning">模糊</Badge>
                      )
                    ) : isMastered ? (
                      <Badge tone="success">已攻克</Badge>
                    ) : (
                      <Badge tone="neutral">未做</Badge>
                    )}
                  </div>
                </header>

                <div className="mistake-card-body">
                  <h4 className="mistake-card-title">
                    第 {index + 1} 题 · {q.title}
                  </h4>
                  <div className="mistake-card-stats">
                    <span>
                      累计错误 <strong>{q.incorrectCount}</strong> 次
                    </span>
                    <span>
                      模糊 <strong>{q.partialCount}</strong> 次
                    </span>
                    <span>
                      正确{" "}
                      <strong>
                        {Math.max(
                          0,
                          q.attemptCount - q.incorrectCount - q.partialCount,
                        )}
                      </strong>{" "}
                      次
                    </span>
                  </div>
                </div>

                <footer className="mistake-card-footer">
                  <div className="mistake-card-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => onStartDrill([q], 1, q.subjectId)}
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        bolt
                      </span>
                      <span>特训此题</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpandedQuestionId(isExpanded ? undefined : q.id)
                      }
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        {isExpanded ? "expand_less" : "expand_more"}
                      </span>
                      <span>{isExpanded ? "收起题目" : "查看题目切片"}</span>
                    </Button>
                  </div>
                </footer>

                {isExpanded ? (
                  <div className="mistake-card-preview-drawer">
                    <QuestionRegionCard
                      documentId={q.documentId}
                      regions={q.regions}
                      title={q.title}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
