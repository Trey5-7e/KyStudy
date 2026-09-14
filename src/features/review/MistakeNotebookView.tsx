import { useCallback, useEffect, useMemo, useState } from "react";
import {
  recordBulkQuestionAttempts,
  type IndexedQuestion,
  type QuestionBankSnapshot,
} from "../../shared/tauri/questionBankClient";
import type { StudySubject } from "../../shared/tauri/scheduleClient";
import type {
  AttemptResult,
  QuestionType,
} from "../../shared/tauri/questionClient";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { EditorDialog } from "../../shared/components/EditorDialog";
import { QuestionRegionCard } from "./QuestionRegionCard";
import { QuestionAiAnalysis } from "./QuestionAiAnalysis";
import { QuestionAttemptTimeline } from "./QuestionAttemptTimeline";
import { QuestionMistakeTagEditor } from "./QuestionMistakeTagEditor";
import { BatchTagDialog } from "./BatchTagDialog";
import { PaperExportDialog } from "../workbook/PaperExportDialog";
import {
  calculateForgettingMeta,
  createBatchAttempts,
  filterMistakeNotebook,
  isMistakeMastered,
  isMistakePending,
  summarizeMistakes,
  type MistakeFrequencyFilter,
  type MistakeNotebookFilter,
  type MistakeSortOption,
  type MistakeStatusFilter,
} from "./mistakeNotebookModel";
import {
  batchAddTagsToQuestions,
  batchRemoveTagsFromQuestions,
  getAllAvailableTags,
  getMistakeTagTone,
  loadAllQuestionTags,
  loadCustomTags,
  subscribeMistakeTagsChanged,
} from "./mistakeTagModel";

export interface MistakeNotebookViewProps {
  questions: readonly IndexedQuestion[];
  subjects: readonly StudySubject[];
  workbooks?: readonly { id: string; name?: string; title?: string }[];
  busy?: boolean;
  today?: string;
  onSnapshotUpdated?(snapshot: QuestionBankSnapshot): void;
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
  today,
  onSnapshotUpdated,
  onStartDrill,
}: MistakeNotebookViewProps) {
  const [filter, setFilter] = useState<MistakeNotebookFilter>({
    subjectId: undefined,
    workbookId: undefined,
    questionType: "all",
    status: "all",
    errorThreshold: "all",
    tag: undefined,
    query: "",
    sortBy: "priority",
  });

  const [tagsMap, setTagsMap] = useState<Record<string, string[]>>(() =>
    loadAllQuestionTags(),
  );
  const [customTags, setCustomTags] = useState<string[]>(() =>
    loadCustomTags(),
  );
  const [batchTagDialogOpen, setBatchTagDialogOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeMistakeTagsChanged(() => {
      setTagsMap(loadAllQuestionTags());
      setCustomTags(loadCustomTags());
    });
    return unsubscribe;
  }, []);

  const allKnownTags = useMemo(
    () => getAllAvailableTags(customTags),
    [customTags],
  );

  const [viewMode, setViewMode] = useState<"list" | "split">(() => {
    try {
      const saved = localStorage.getItem("kystudy.mistake_notebook.view_mode");
      if (saved === "list" || saved === "split") return saved;
    } catch {
      // ignore
    }
    return "split";
  });

  const handleViewModeChange = (mode: "list" | "split") => {
    setViewMode(mode);
    try {
      localStorage.setItem("kystudy.mistake_notebook.view_mode", mode);
    } catch {
      // ignore
    }
  };

  const [activeSplitQuestionId, setActiveSplitQuestionId] = useState<string>();
  const [previewQuestionId, setPreviewQuestionId] = useState<string>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportTarget, setExportTarget] = useState<"all" | "selected">("all");
  const [exportNotice, setExportNotice] = useState<string>();
  const [markingId, setMarkingId] = useState<string>();
  const [batchMarking, setBatchMarking] = useState(false);

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
    () => filterMistakeNotebook(questions, filter, tagsMap, today),
    [questions, filter, tagsMap, today],
  );

  const selectedQuestions = useMemo(
    () => filteredQuestions.filter((q) => selectedIds.has(q.id)),
    [filteredQuestions, selectedIds],
  );

  const effectiveActiveSplitId = useMemo(() => {
    if (
      activeSplitQuestionId &&
      filteredQuestions.some((q) => q.id === activeSplitQuestionId)
    ) {
      return activeSplitQuestionId;
    }
    return filteredQuestions[0]?.id;
  }, [activeSplitQuestionId, filteredQuestions]);

  const activeSplitIndex = useMemo(
    () =>
      effectiveActiveSplitId === undefined
        ? -1
        : filteredQuestions.findIndex((q) => q.id === effectiveActiveSplitId),
    [filteredQuestions, effectiveActiveSplitId],
  );

  const activeSplitQuestion = useMemo(
    () =>
      activeSplitIndex >= 0 ? filteredQuestions[activeSplitIndex] : undefined,
    [filteredQuestions, activeSplitIndex],
  );

  const previewIndex = useMemo(
    () =>
      previewQuestionId === undefined
        ? -1
        : filteredQuestions.findIndex((q) => q.id === previewQuestionId),
    [filteredQuestions, previewQuestionId],
  );

  const previewQuestion = useMemo(
    () =>
      previewIndex >= 0
        ? filteredQuestions[previewIndex]
        : previewQuestionId === undefined
          ? undefined
          : questions.find((q) => q.id === previewQuestionId),
    [filteredQuestions, previewIndex, previewQuestionId, questions],
  );

  const toggleSelect = useCallback((questionId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      // Dialog navigation
      if (previewQuestionId) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          if (previewIndex > 0) {
            const prev = filteredQuestions[previewIndex - 1];
            if (prev) setPreviewQuestionId(prev.id);
          }
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          if (
            previewIndex >= 0 &&
            previewIndex < filteredQuestions.length - 1
          ) {
            const next = filteredQuestions[previewIndex + 1];
            if (next) setPreviewQuestionId(next.id);
          }
        }
        return;
      }

      // Split view keyboard navigation
      if (viewMode === "split" && filteredQuestions.length > 0) {
        if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
          e.preventDefault();
          if (activeSplitIndex > 0) {
            const target = filteredQuestions[activeSplitIndex - 1];
            if (target) {
              setActiveSplitQuestionId(target.id);
              document
                .getElementById(`mistake-split-card-${target.id}`)
                ?.scrollIntoView({
                  block: "nearest",
                  behavior: "smooth",
                });
            }
          }
        } else if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
          e.preventDefault();
          if (
            activeSplitIndex >= 0 &&
            activeSplitIndex < filteredQuestions.length - 1
          ) {
            const target = filteredQuestions[activeSplitIndex + 1];
            if (target) {
              setActiveSplitQuestionId(target.id);
              document
                .getElementById(`mistake-split-card-${target.id}`)
                ?.scrollIntoView({
                  block: "nearest",
                  behavior: "smooth",
                });
            }
          }
        } else if (e.key === "x" || e.key === "X") {
          if (activeSplitQuestion) {
            e.preventDefault();
            toggleSelect(activeSplitQuestion.id);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    previewQuestionId,
    previewIndex,
    viewMode,
    activeSplitIndex,
    activeSplitQuestion,
    filteredQuestions,
    toggleSelect,
  ]);

  const handleStatusChange = (status: MistakeStatusFilter) => {
    setFilter((prev) => ({ ...prev, status }));
  };

  const handleResetFilter = () => {
    setFilter({
      subjectId: undefined,
      workbookId: undefined,
      questionType: "all",
      status: "all",
      errorThreshold: "all",
      tag: undefined,
      query: "",
      sortBy: "priority",
    });
    setSelectedIds(new Set());
  };

  const handleBatchTagApply = (tags: string[], mode: "add" | "remove") => {
    if (selectedQuestions.length === 0 || tags.length === 0) return;
    const qids = selectedQuestions.map((q) => q.id);
    if (mode === "add") {
      const updated = batchAddTagsToQuestions(qids, tags);
      setTagsMap(updated);
      setExportNotice(`已为 ${qids.length} 道错题成功添加标签`);
    } else {
      const updated = batchRemoveTagsFromQuestions(qids, tags);
      setTagsMap(updated);
      setExportNotice(`已从 ${qids.length} 道错题中成功移除标签`);
    }
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(filteredQuestions.map((q) => q.id)));
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBatchDrill = () => {
    if (selectedQuestions.length === 0) return;
    onStartDrill(selectedQuestions, selectedQuestions.length, filter.subjectId);
  };

  const handleBatchExport = () => {
    if (selectedQuestions.length === 0) return;
    setExportTarget("selected");
    setExportDialogOpen(true);
  };

  const handleBatchMark = async (result: AttemptResult) => {
    if (busy || batchMarking || selectedQuestions.length === 0) return;
    const targetDate = today ?? new Date().toISOString().slice(0, 10);
    setBatchMarking(true);
    try {
      const attempts = createBatchAttempts(
        selectedQuestions.map((q) => q.id),
        result,
      );
      const updated = await recordBulkQuestionAttempts(targetDate, attempts);
      onSnapshotUpdated?.(updated);
      setExportNotice(
        result === "correct"
          ? `已成功将 ${selectedQuestions.length} 道错题标为已攻克掌握！`
          : `已成功将 ${selectedQuestions.length} 道错题移回待攻克列表。`,
      );
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Failed to batch update question status:", err);
    } finally {
      setBatchMarking(false);
    }
  };

  const handleQuickMark = async (questionId: string, result: AttemptResult) => {
    if (busy || markingId !== undefined) return;
    const targetDate = today ?? new Date().toISOString().slice(0, 10);
    setMarkingId(questionId);
    try {
      const updated = await recordBulkQuestionAttempts(targetDate, [
        { questionId, result },
      ]);
      onSnapshotUpdated?.(updated);
    } catch (err) {
      console.error("Failed to update question status:", err);
    } finally {
      setMarkingId(undefined);
    }
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
            <>
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
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setExportTarget("all");
                  setExportDialogOpen(true);
                }}
              >
                <span className="material-symbols-rounded" aria-hidden="true">
                  print
                </span>
                <span>导出错题卷 (PDF)</span>
              </Button>
            </>
          ) : null}
        </div>
      </section>

      {exportNotice ? (
        <div className="mistake-notebook-notice" role="status">
          <span className="material-symbols-rounded" aria-hidden="true">
            check_circle
          </span>
          <span>{exportNotice}</span>
          <button
            type="button"
            className="mistake-notice-close"
            onClick={() => setExportNotice(undefined)}
            aria-label="关闭提示"
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              close
            </span>
          </button>
        </div>
      ) : null}

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

          {/* 错误频次过滤 */}
          <select
            className="mistake-notebook-select"
            value={filter.errorThreshold ?? "all"}
            aria-label="筛选错误频次"
            onChange={(e) =>
              setFilter((prev) => ({
                ...prev,
                errorThreshold: e.target.value as MistakeFrequencyFilter,
              }))
            }
          >
            <option value="all">全部频次</option>
            <option value="gte2">反复失分 (≥ 2次)</option>
            <option value="gte3">顽固错题 (≥ 3次)</option>
          </select>

          {/* 标签过滤 */}
          <select
            className="mistake-notebook-select"
            value={filter.tag ?? "all"}
            aria-label="筛选错题标签"
            onChange={(e) =>
              setFilter((prev) => ({
                ...prev,
                tag: e.target.value === "all" ? undefined : e.target.value,
              }))
            }
          >
            <option value="all">全部标签</option>
            {allKnownTags.map((tag) => (
              <option key={tag} value={tag}>
                🏷️ {tag}
              </option>
            ))}
          </select>

          {/* 排序方式 */}
          <select
            className="mistake-notebook-select"
            value={filter.sortBy ?? "priority"}
            aria-label="错题排序方式"
            onChange={(e) =>
              setFilter((prev) => ({
                ...prev,
                sortBy: e.target.value as MistakeSortOption,
              }))
            }
          >
            <option value="priority">综合优先级排序</option>
            <option value="forgetting_curve">🧠 遗忘曲线 (最急需复习)</option>
            <option value="frequency">错误频次最高</option>
            <option value="natural">原书题号顺序</option>
          </select>
        </div>

        {/* 视图模式切换 */}
        <div
          className="mistake-view-pills"
          role="radiogroup"
          aria-label="错题本视图模式"
        >
          <button
            type="button"
            className={`mistake-view-pill ${viewMode === "split" ? "is-active" : ""}`}
            onClick={() => handleViewModeChange("split")}
            title="双栏沉浸式复盘视图"
            aria-checked={viewMode === "split"}
            role="radio"
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              vertical_split
            </span>
            <span>双栏复盘</span>
          </button>
          <button
            type="button"
            className={`mistake-view-pill ${viewMode === "list" ? "is-active" : ""}`}
            onClick={() => handleViewModeChange("list")}
            title="单列列表视图"
            aria-checked={viewMode === "list"}
            role="radio"
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              view_agenda
            </span>
            <span>单列列表</span>
          </button>
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

      {/* 批量操作工具条 */}
      {selectedQuestions.length > 0 ? (
        <div
          className="mistake-batch-bar"
          role="region"
          aria-label="错题批量操作工具栏"
        >
          <div className="mistake-batch-info">
            <span className="material-symbols-rounded" aria-hidden="true">
              check_box
            </span>
            <span>
              已选择 <strong>{selectedQuestions.length}</strong> /{" "}
              {filteredQuestions.length} 道错题
            </span>
            <button
              type="button"
              className="mistake-batch-link"
              onClick={
                selectedQuestions.length === filteredQuestions.length
                  ? handleClearSelection
                  : handleSelectAll
              }
            >
              {selectedQuestions.length === filteredQuestions.length
                ? "取消全选"
                : "全选当前"}
            </button>
            <button
              type="button"
              className="mistake-batch-link"
              onClick={handleClearSelection}
            >
              清空
            </button>
          </div>

          <div className="mistake-batch-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={busy || batchMarking}
              onClick={handleBatchDrill}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                bolt
              </span>
              <span>特训选中（{selectedQuestions.length}）</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || batchMarking}
              onClick={handleBatchExport}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                print
              </span>
              <span>导出选中（{selectedQuestions.length}）</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy || batchMarking}
              onClick={() => setBatchTagDialogOpen(true)}
              title="批量为选中的错题添加或移除标签"
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                label
              </span>
              <span>批量打标签</span>
            </Button>
            {onSnapshotUpdated !== undefined ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || batchMarking}
                  onClick={() => void handleBatchMark("correct")}
                  title="将选中的错题全部标为已攻克"
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    check_circle
                  </span>
                  <span>批量标为已攻克</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || batchMarking}
                  onClick={() => void handleBatchMark("incorrect")}
                  title="将选中的错题全部移回待攻克"
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    restart_alt
                  </span>
                  <span>批量移回待攻克</span>
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

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
      ) : viewMode === "list" ? (
        <div className="mistake-notebook-list">
          {filteredQuestions.map((q, index) => {
            const isPending = isMistakePending(q);
            const isMastered = isMistakeMastered(q);
            const qTags = tagsMap[q.id] ?? [];
            const forgettingMeta = calculateForgettingMeta(q, today);
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
              <article
                key={q.id}
                className={`mistake-question-card ${selectedIds.has(q.id) ? "is-selected" : ""}`}
              >
                <header className="mistake-card-header">
                  <div className="mistake-card-header-left">
                    <input
                      type="checkbox"
                      id={`mistake-select-${q.id}`}
                      className="mistake-card-checkbox"
                      checked={selectedIds.has(q.id)}
                      onChange={() => toggleSelect(q.id)}
                      aria-label={`选择第 ${index + 1} 题 ${q.title}`}
                    />
                    <div className="mistake-card-meta">
                      <span className="mistake-meta-tag">{subjectName}</span>
                      <span className="mistake-meta-tag is-secondary">
                        {q.documentTitle}
                      </span>
                      {q.chapter ? (
                        <span className="mistake-meta-chapter">
                          {q.chapter}
                        </span>
                      ) : null}
                      <span className="mistake-meta-type">{typeLabel}</span>
                    </div>
                  </div>
                  <div className="mistake-card-badge">
                    <Badge tone={forgettingMeta.tone}>
                      {forgettingMeta.label}
                    </Badge>
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
                  {qTags.length > 0 ? (
                    <div className="mistake-card-tags">
                      {qTags.map((tag) => (
                        <span
                          key={tag}
                          className={`mistake-tag-chip tone-${getMistakeTagTone(tag)}`}
                        >
                          🏷️ {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
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
                    {onSnapshotUpdated !== undefined ? (
                      isPending ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || markingId === q.id}
                          onClick={() => void handleQuickMark(q.id, "correct")}
                          title="将本题标记为已攻克掌握"
                        >
                          <span
                            className="material-symbols-rounded"
                            aria-hidden="true"
                          >
                            check_circle
                          </span>
                          <span>标为已攻克</span>
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy || markingId === q.id}
                          onClick={() =>
                            void handleQuickMark(q.id, "incorrect")
                          }
                          title="将本题移回待攻克列表"
                        >
                          <span
                            className="material-symbols-rounded"
                            aria-hidden="true"
                          >
                            restart_alt
                          </span>
                          <span>移回待攻克</span>
                        </Button>
                      )
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewQuestionId(q.id)}
                      title="查看做题轨迹与时间线"
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        timeline
                      </span>
                      <span>轨迹</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewQuestionId(q.id)}
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        visibility
                      </span>
                      <span>题目切片</span>
                    </Button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mistake-notebook-split-container">
          {/* 左侧 Master 紧凑导航列表 */}
          <aside className="mistake-split-master" aria-label="错题导航列表">
            <div className="mistake-split-master-header">
              <span className="mistake-split-master-count">
                共 <strong>{filteredQuestions.length}</strong> 道错题
              </span>
              <span className="mistake-split-master-hint">
                按 J/K 或 ↑/↓ 切换
              </span>
            </div>
            <div className="mistake-split-master-list">
              {filteredQuestions.map((q, index) => {
                const isActive = q.id === effectiveActiveSplitId;
                const isPending = isMistakePending(q);
                const isMastered = isMistakeMastered(q);
                const qTags = tagsMap[q.id] ?? [];
                const forgettingMeta = calculateForgettingMeta(q, today);
                const subjectName =
                  subjectsById.get(q.subjectId) ??
                  workbooksById.get(q.workbookId) ??
                  "未归类科目";

                const typeLabel =
                  q.questionType === "choice"
                    ? "选择"
                    : q.questionType === "blank"
                      ? "填空"
                      : "解答";

                return (
                  <div
                    key={q.id}
                    id={`mistake-split-card-${q.id}`}
                    className={`mistake-compact-card ${isActive ? "is-active" : ""} ${selectedIds.has(q.id) ? "is-selected" : ""}`}
                    onClick={() => setActiveSplitQuestionId(q.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setActiveSplitQuestionId(q.id);
                      }
                    }}
                  >
                    <div className="mistake-compact-card-header">
                      <div className="mistake-compact-card-meta">
                        <input
                          type="checkbox"
                          id={`mistake-compact-select-${q.id}`}
                          className="mistake-card-checkbox"
                          checked={selectedIds.has(q.id)}
                          onChange={() => toggleSelect(q.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`选择第 ${index + 1} 题`}
                        />
                        <span className="mistake-meta-tag">{subjectName}</span>
                        <span className="mistake-meta-type">{typeLabel}</span>
                      </div>
                      <div className="mistake-compact-card-badge">
                        <Badge tone={forgettingMeta.tone}>
                          {forgettingMeta.label}
                        </Badge>
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
                    </div>

                    <div className="mistake-compact-card-body">
                      <h4 className="mistake-compact-card-title">
                        第 {index + 1} 题 · {q.title}
                      </h4>
                      {qTags.length > 0 ? (
                        <div className="mistake-compact-card-tags">
                          {qTags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className={`mistake-tag-chip is-compact tone-${getMistakeTagTone(tag)}`}
                            >
                              {tag}
                            </span>
                          ))}
                          {qTags.length > 3 ? (
                            <span className="mistake-tag-more">
                              +{qTags.length - 3}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {q.chapter ? (
                        <div className="mistake-compact-card-chapter">
                          {q.chapter}
                        </div>
                      ) : null}
                    </div>

                    <div className="mistake-compact-card-footer">
                      <span className="mistake-compact-stats">
                        错 <strong>{q.incorrectCount}</strong> · 模{" "}
                        <strong>{q.partialCount}</strong> · 正{" "}
                        <strong>
                          {Math.max(
                            0,
                            q.attemptCount - q.incorrectCount - q.partialCount,
                          )}
                        </strong>
                      </span>
                      {isActive ? (
                        <span className="mistake-compact-active-indicator">
                          <span
                            className="material-symbols-rounded"
                            aria-hidden="true"
                          >
                            arrow_right
                          </span>
                          <span>查看中</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>

          {/* 右侧 Detail 联动复盘面板 */}
          <main
            className="mistake-split-detail"
            aria-label="错题详情与做题轨迹"
          >
            {activeSplitQuestion ? (
              <div className="mistake-split-detail-content">
                <div className="mistake-split-detail-toolbar">
                  <div className="mistake-split-detail-nav">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={activeSplitIndex <= 0}
                      onClick={() => {
                        if (activeSplitIndex > 0) {
                          const prev = filteredQuestions[activeSplitIndex - 1];
                          if (prev) {
                            setActiveSplitQuestionId(prev.id);
                            document
                              .getElementById(`mistake-split-card-${prev.id}`)
                              ?.scrollIntoView({
                                block: "nearest",
                                behavior: "smooth",
                              });
                          }
                        }
                      }}
                      title="上一题 (快捷键: K 或 ↑)"
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        navigate_before
                      </span>
                      <span>上一题</span>
                    </Button>
                    <strong className="mistake-split-nav-index">
                      {activeSplitIndex >= 0 ? activeSplitIndex + 1 : 1} /{" "}
                      {filteredQuestions.length}
                    </strong>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={
                        activeSplitIndex < 0 ||
                        activeSplitIndex >= filteredQuestions.length - 1
                      }
                      onClick={() => {
                        if (
                          activeSplitIndex >= 0 &&
                          activeSplitIndex < filteredQuestions.length - 1
                        ) {
                          const next = filteredQuestions[activeSplitIndex + 1];
                          if (next) {
                            setActiveSplitQuestionId(next.id);
                            document
                              .getElementById(`mistake-split-card-${next.id}`)
                              ?.scrollIntoView({
                                block: "nearest",
                                behavior: "smooth",
                              });
                          }
                        }
                      }}
                      title="下一题 (快捷键: J 或 ↓)"
                    >
                      <span>下一题</span>
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        navigate_next
                      </span>
                    </Button>
                  </div>

                  <div className="mistake-split-detail-actions">
                    <Button
                      variant={
                        selectedIds.has(activeSplitQuestion.id)
                          ? "secondary"
                          : "ghost"
                      }
                      size="sm"
                      onClick={() => toggleSelect(activeSplitQuestion.id)}
                      title={
                        selectedIds.has(activeSplitQuestion.id)
                          ? "从批量勾选中取消"
                          : "加入批量勾选 (快捷键: X)"
                      }
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        {selectedIds.has(activeSplitQuestion.id)
                          ? "check_box"
                          : "check_box_outline_blank"}
                      </span>
                      <span>
                        {selectedIds.has(activeSplitQuestion.id)
                          ? "已勾选"
                          : "勾选此题"}
                      </span>
                    </Button>

                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        onStartDrill(
                          [activeSplitQuestion],
                          1,
                          activeSplitQuestion.subjectId,
                        )
                      }
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        bolt
                      </span>
                      <span>特训此题</span>
                    </Button>

                    {onSnapshotUpdated !== undefined ? (
                      isMistakePending(activeSplitQuestion) ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={
                            busy || markingId === activeSplitQuestion.id
                          }
                          onClick={() =>
                            void handleQuickMark(
                              activeSplitQuestion.id,
                              "correct",
                            )
                          }
                          title="将本题标记为已攻克"
                        >
                          <span
                            className="material-symbols-rounded"
                            aria-hidden="true"
                          >
                            check_circle
                          </span>
                          <span>标为已攻克</span>
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={
                            busy || markingId === activeSplitQuestion.id
                          }
                          onClick={() =>
                            void handleQuickMark(
                              activeSplitQuestion.id,
                              "incorrect",
                            )
                          }
                          title="将本题移回待攻克列表"
                        >
                          <span
                            className="material-symbols-rounded"
                            aria-hidden="true"
                          >
                            restart_alt
                          </span>
                          <span>移回待攻克</span>
                        </Button>
                      )
                    ) : null}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPreviewQuestionId(activeSplitQuestion.id)
                      }
                      title="打开弹窗全屏查看"
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        open_in_full
                      </span>
                      <span>全屏</span>
                    </Button>
                  </div>
                </div>

                <div
                  key={activeSplitQuestion.id}
                  className="mistake-split-detail-body"
                >
                  <div className="mistake-preview-stats">
                    <span className="mistake-preview-stat-item">
                      <strong>当前状态：</strong>
                      {isMistakePending(activeSplitQuestion) ? (
                        activeSplitQuestion.currentResult === "incorrect" ? (
                          <Badge tone="danger">做错</Badge>
                        ) : (
                          <Badge tone="warning">模糊</Badge>
                        )
                      ) : isMistakeMastered(activeSplitQuestion) ? (
                        <Badge tone="success">已攻克</Badge>
                      ) : (
                        <Badge tone="neutral">未做</Badge>
                      )}
                    </span>
                    <span className="mistake-preview-stat-item">
                      <strong>遗忘复习：</strong>
                      {(() => {
                        const meta = calculateForgettingMeta(
                          activeSplitQuestion,
                          today,
                        );
                        return <Badge tone={meta.tone}>{meta.label}</Badge>;
                      })()}
                    </span>
                    <span className="mistake-preview-stat-item">
                      累计做过{" "}
                      <strong>{activeSplitQuestion.attemptCount}</strong> 次
                    </span>
                    <span className="mistake-preview-stat-item">
                      做错 <strong>{activeSplitQuestion.incorrectCount}</strong>{" "}
                      次
                    </span>
                    <span className="mistake-preview-stat-item">
                      模糊 <strong>{activeSplitQuestion.partialCount}</strong>{" "}
                      次
                    </span>
                    <span className="mistake-preview-stat-item">
                      正确{" "}
                      <strong>
                        {Math.max(
                          0,
                          activeSplitQuestion.attemptCount -
                            activeSplitQuestion.incorrectCount -
                            activeSplitQuestion.partialCount,
                        )}
                      </strong>{" "}
                      次
                    </span>
                  </div>

                  <QuestionRegionCard
                    key={`split-region-${activeSplitQuestion.id}`}
                    documentId={activeSplitQuestion.documentId}
                    regions={activeSplitQuestion.regions}
                    title={activeSplitQuestion.title}
                  />

                  <QuestionMistakeTagEditor
                    key={`split-tags-${activeSplitQuestion.id}`}
                    questionId={activeSplitQuestion.id}
                    tags={tagsMap[activeSplitQuestion.id] ?? []}
                    disabled={busy}
                  />

                  <QuestionAttemptTimeline
                    key={`split-timeline-${activeSplitQuestion.id}`}
                    questionId={activeSplitQuestion.id}
                  />

                  <QuestionAiAnalysis
                    key={`split-ai-${activeSplitQuestion.id}`}
                    question={activeSplitQuestion}
                    regions={activeSplitQuestion.regions}
                  />
                </div>
              </div>
            ) : (
              <div className="mistake-split-empty">
                <span className="material-symbols-rounded" aria-hidden="true">
                  touch_app
                </span>
                <p>请从左侧选择一道错题以进行复盘</p>
              </div>
            )}
          </main>
        </div>
      )}
      {exportDialogOpen ? (
        <PaperExportDialog
          questions={
            exportTarget === "selected" && selectedQuestions.length > 0
              ? selectedQuestions
              : filteredQuestions
          }
          onClose={() => setExportDialogOpen(false)}
          onSaved={(msg) => {
            setExportDialogOpen(false);
            setExportNotice(msg);
          }}
        />
      ) : null}
      {previewQuestion !== undefined ? (
        <EditorDialog
          title={`题目切片与解析 · 第 ${previewIndex >= 0 ? previewIndex + 1 : 1} 题`}
          description={`${previewQuestion.title} · ${subjectsById.get(previewQuestion.subjectId) ?? previewQuestion.subjectName ?? "通用科目"} / ${workbooksById.get(previewQuestion.workbookId) ?? previewQuestion.workbookName ?? "习题册"} · 累计做错 ${previewQuestion.incorrectCount} 次`}
          dirty={false}
          onRequestClose={() => setPreviewQuestionId(undefined)}
          size="review"
        >
          <div className="mistake-preview-dialog-body">
            <div className="mistake-preview-dialog-toolbar">
              <div className="mistake-preview-dialog-nav">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={previewIndex <= 0}
                  onClick={() => {
                    if (previewIndex > 0) {
                      const prev = filteredQuestions[previewIndex - 1];
                      if (prev) setPreviewQuestionId(prev.id);
                    }
                  }}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    navigate_before
                  </span>
                  <span>上一题</span>
                </Button>
                <strong>
                  {previewIndex >= 0 ? previewIndex + 1 : 1} /{" "}
                  {filteredQuestions.length}
                </strong>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={
                    previewIndex < 0 ||
                    previewIndex >= filteredQuestions.length - 1
                  }
                  onClick={() => {
                    if (
                      previewIndex >= 0 &&
                      previewIndex < filteredQuestions.length - 1
                    ) {
                      const next = filteredQuestions[previewIndex + 1];
                      if (next) setPreviewQuestionId(next.id);
                    }
                  }}
                >
                  <span>下一题</span>
                  <span className="material-symbols-rounded" aria-hidden="true">
                    navigate_next
                  </span>
                </Button>
              </div>

              <div className="mistake-preview-dialog-actions">
                <Button
                  variant={
                    selectedIds.has(previewQuestion.id) ? "secondary" : "ghost"
                  }
                  size="sm"
                  onClick={() => toggleSelect(previewQuestion.id)}
                  title={
                    selectedIds.has(previewQuestion.id)
                      ? "从批量选择中移除"
                      : "加入批量选择"
                  }
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    {selectedIds.has(previewQuestion.id)
                      ? "check_box"
                      : "check_box_outline_blank"}
                  </span>
                  <span>
                    {selectedIds.has(previewQuestion.id)
                      ? "已选中"
                      : "勾选此题"}
                  </span>
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    onStartDrill(
                      [previewQuestion],
                      1,
                      previewQuestion.subjectId,
                    );
                    setPreviewQuestionId(undefined);
                  }}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    bolt
                  </span>
                  <span>特训此题</span>
                </Button>
                {onSnapshotUpdated !== undefined ? (
                  isMistakePending(previewQuestion) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy || markingId === previewQuestion.id}
                      onClick={() =>
                        void handleQuickMark(previewQuestion.id, "correct")
                      }
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        check_circle
                      </span>
                      <span>标为已攻克</span>
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy || markingId === previewQuestion.id}
                      onClick={() =>
                        void handleQuickMark(previewQuestion.id, "incorrect")
                      }
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        restart_alt
                      </span>
                      <span>移回待攻克</span>
                    </Button>
                  )
                ) : null}
              </div>
            </div>

            <div
              key={previewQuestion.id}
              className="mistake-preview-dialog-content"
            >
              <div className="mistake-preview-stats">
                <span className="mistake-preview-stat-item">
                  <strong>最新状态：</strong>
                  {isMistakePending(previewQuestion) ? (
                    previewQuestion.currentResult === "incorrect" ? (
                      <Badge tone="danger">做错</Badge>
                    ) : (
                      <Badge tone="warning">模糊</Badge>
                    )
                  ) : isMistakeMastered(previewQuestion) ? (
                    <Badge tone="success">已攻克</Badge>
                  ) : (
                    <Badge tone="neutral">未做</Badge>
                  )}
                </span>
                <span className="mistake-preview-stat-item">
                  <strong>遗忘复习：</strong>
                  {(() => {
                    const meta = calculateForgettingMeta(
                      previewQuestion,
                      today,
                    );
                    return <Badge tone={meta.tone}>{meta.label}</Badge>;
                  })()}
                </span>
                <span className="mistake-preview-stat-item">
                  累计做过 <strong>{previewQuestion.attemptCount}</strong> 次
                </span>
                <span className="mistake-preview-stat-item">
                  做错 <strong>{previewQuestion.incorrectCount}</strong> 次
                </span>
                <span className="mistake-preview-stat-item">
                  模糊 <strong>{previewQuestion.partialCount}</strong> 次
                </span>
                <span className="mistake-preview-stat-item">
                  正确{" "}
                  <strong>
                    {Math.max(
                      0,
                      previewQuestion.attemptCount -
                        previewQuestion.incorrectCount -
                        previewQuestion.partialCount,
                    )}
                  </strong>{" "}
                  次
                </span>
              </div>
              <QuestionRegionCard
                key={`preview-region-${previewQuestion.id}`}
                documentId={previewQuestion.documentId}
                regions={previewQuestion.regions}
                title={previewQuestion.title}
              />
              <QuestionMistakeTagEditor
                key={`preview-tags-${previewQuestion.id}`}
                questionId={previewQuestion.id}
                tags={tagsMap[previewQuestion.id] ?? []}
                disabled={busy}
              />
              <QuestionAttemptTimeline
                key={`preview-timeline-${previewQuestion.id}`}
                questionId={previewQuestion.id}
              />
              <QuestionAiAnalysis
                key={`preview-ai-${previewQuestion.id}`}
                question={previewQuestion}
                regions={previewQuestion.regions}
              />
            </div>
          </div>
        </EditorDialog>
      ) : null}

      <BatchTagDialog
        isOpen={batchTagDialogOpen}
        selectedQuestionsCount={selectedQuestions.length}
        allKnownTags={allKnownTags}
        onClose={() => setBatchTagDialogOpen(false)}
        onApply={handleBatchTagApply}
      />
    </div>
  );
}
