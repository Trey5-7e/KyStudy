import { useMemo, useRef, useState } from "react";

import { EditorDialog } from "../../shared/components/EditorDialog";
import {
  normalizeQuestionBankError,
  reassignWorkbookSegment,
  trashWorkbookSegment,
  type QuestionBankSnapshot,
  type TrashedWorkbookDocumentSegment,
  type WorkbookDocumentSegment,
} from "../../shared/tauri/questionBankClient";
import {
  countQuestionsInSegment,
  findSegmentReassignConflicts,
  getSegmentReassignOptions,
  questionSegmentVisibility,
  segmentDeletionSummary,
  type SegmentReassignWorkbookOption,
} from "./questionBankModel";

type SegmentManagerMode = "overview" | "reassign" | "remove" | "stale";

export function SegmentManagerDialog({
  snapshot,
  segment,
  trashedSegments,
  notice,
  onClose,
  onRequestBack,
  backLabel,
  onChanged,
  onRefresh,
  onBrowse,
  onContinueIndex,
}: {
  snapshot: QuestionBankSnapshot;
  segment: WorkbookDocumentSegment;
  trashedSegments: readonly TrashedWorkbookDocumentSegment[];
  notice: string;
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onChanged(snapshot: QuestionBankSnapshot, notice?: string): void;
  onRefresh(): Promise<QuestionBankSnapshot | undefined>;
  onBrowse(): void;
  onContinueIndex(): void;
}) {
  const [mode, setMode] = useState<SegmentManagerMode>("overview");
  const [targetWorkbookId, setTargetWorkbookId] = useState(segment.workbookId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [removeMessage, setRemoveMessage] = useState("");
  const overviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const reassignHeadingRef = useRef<HTMLHeadingElement>(null);
  const removeHeadingRef = useRef<HTMLHeadingElement>(null);
  const staleHeadingRef = useRef<HTMLHeadingElement>(null);
  const currentSegment =
    snapshot.segments.find((item) => item.id === segment.id) ?? segment;
  const liveQuestionCount = countQuestionsInSegment(
    snapshot.questions,
    currentSegment.id,
  );
  const visibility = questionSegmentVisibility(
    currentSegment,
    snapshot.questions,
  );
  const reassignOptions = useMemo(
    () => getSegmentReassignOptions(snapshot, trashedSegments, currentSegment),
    [currentSegment, snapshot, trashedSegments],
  );
  const selectedAssessment = findSegmentReassignConflicts(
    snapshot,
    trashedSegments,
    currentSegment,
    targetWorkbookId,
  );
  const deletionSummary = segmentDeletionSummary(
    currentSegment,
    snapshot.questions,
  );
  const title = `${currentSegment.subjectName} / ${currentSegment.workbookName}`;
  const statusLabel = segmentVisibilityLabel(
    visibility,
    liveQuestionCount,
    currentSegment.indexState,
  );
  const blockedOptions = reassignOptions.filter(
    (option) => !option.canReassign && !option.sameTarget,
  );
  const dirty =
    mode === "reassign" && targetWorkbookId !== currentSegment.workbookId;

  const focusMode = (nextMode: SegmentManagerMode) => {
    requestAnimationFrame(() => {
      const target = {
        overview: overviewHeadingRef.current,
        reassign: reassignHeadingRef.current,
        remove: removeHeadingRef.current,
        stale: staleHeadingRef.current,
      }[nextMode];
      target?.focus({ preventScroll: true });
    });
  };

  const changeMode = (nextMode: SegmentManagerMode) => {
    if (busy || mode === "stale") return;
    setMode(nextMode);
    focusMode(nextMode);
  };

  const refreshStaleToken = async (): Promise<boolean> => {
    const refreshed = await onRefresh();
    const refreshedSegment = refreshed?.segments.find(
      (item) => item.id === currentSegment.id,
    );
    if (
      refreshedSegment !== undefined &&
      refreshedSegment.updatedAt !== currentSegment.updatedAt
    ) {
      return true;
    }
    setMode("stale");
    setMessage(
      refreshed === undefined
        ? "重新加载失败。当前分段操作保持锁定，请重试或关闭窗口。"
        : refreshedSegment === undefined
          ? "当前分段已不在活动题库中。请关闭窗口并刷新题库。"
          : "重新加载后分段状态仍未更新。当前操作保持锁定，请重试或关闭窗口。",
    );
    focusMode("stale");
    return false;
  };

  const retryStaleRefresh = async () => {
    if (busy || mode !== "stale") return;
    setBusy(true);
    setMessage("正在重新加载分段状态…");
    try {
      await refreshStaleToken();
    } finally {
      setBusy(false);
    }
  };

  const saveAssignment = async () => {
    if (
      busy ||
      mode !== "reassign" ||
      targetWorkbookId === currentSegment.workbookId ||
      selectedAssessment.canReassign === false
    ) {
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const next = await reassignWorkbookSegment(
        currentSegment.id,
        targetWorkbookId,
        currentSegment.updatedAt,
      );
      setMode("overview");
      focusMode("overview");
      onChanged(next, "归类已更新。");
    } catch (error: unknown) {
      const normalized = normalizeQuestionBankError(error);
      if (normalized.code === "QUESTION_BANK_SEGMENT_REASSIGN_STALE") {
        setMode("stale");
        setMessage("分段状态已经变化，正在重新加载…");
        focusMode("stale");
        await refreshStaleToken();
      } else {
        setMessage(`${normalized.message} ${normalized.action}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const removeSegment = async () => {
    if (busy) return;
    setBusy(true);
    setRemoveMessage("");
    try {
      const next = await trashWorkbookSegment(currentSegment.id);
      onChanged(next);
      onClose();
    } catch (error: unknown) {
      const normalized = normalizeQuestionBankError(error);
      setRemoveMessage(`${normalized.message} ${normalized.action}`);
    } finally {
      setBusy(false);
    }
  };

  const primaryAction = () => {
    if (busy) return;
    if (visibility === "browsable") {
      onBrowse();
    } else {
      onContinueIndex();
    }
  };

  return (
    <EditorDialog
      title="管理 PDF 分段"
      description={`${title} · ${currentSegment.sourceHeading} · PDF 第 ${currentSegment.pageStart}–${currentSegment.pageEnd} 页`}
      dirty={dirty}
      closeDisabled={busy}
      initialFocusRef={overviewHeadingRef}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      size={mode === "overview" ? "large" : "medium"}
    >
      <div className="segment-manager-dialog">
        <header className="segment-manager-summary">
          <div>
            <span className="eyebrow">当前分段</span>
            <h3
              ref={overviewHeadingRef}
              tabIndex={-1}
              className="question-bank-long-text"
            >
              {currentSegment.sourceHeading}
            </h3>
            <p className="question-bank-long-text">
              {currentSegment.documentTitle} · {currentSegment.subjectName} ·{" "}
              {currentSegment.workbookName}
            </p>
          </div>
          <span
            className="segment-manager-status"
            role="status"
            aria-live="polite"
          >
            {liveQuestionCount} 道题 · {statusLabel}
          </span>
        </header>

        {mode === "overview" ? (
          <>
            <dl className="segment-manager-details">
              <div>
                <dt>PDF 页码</dt>
                <dd>
                  第 {currentSegment.pageStart}–{currentSegment.pageEnd} 页
                </dd>
              </div>
              <div>
                <dt>索引状态</dt>
                <dd>{statusLabel}</dd>
              </div>
              <div>
                <dt>当前题数</dt>
                <dd>{liveQuestionCount}</dd>
              </div>
              <div>
                <dt>分段更新时间</dt>
                <dd>{formatTimestamp(currentSegment.updatedAt)}</dd>
              </div>
            </dl>
            {notice === "" && message === "" ? null : (
              <p className="segment-manager-success" role="status">
                {notice || message}
              </p>
            )}
            <div className="segment-manager-actions">
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={primaryAction}
              >
                {visibility === "browsable" ? "浏览题目" : "继续索引"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setMessage("");
                  setTargetWorkbookId(currentSegment.workbookId);
                  changeMode("reassign");
                }}
              >
                更正归类
              </button>
              <button
                type="button"
                className="danger-text-button"
                disabled={busy}
                onClick={() => {
                  setRemoveMessage("");
                  changeMode("remove");
                }}
              >
                移除分段
              </button>
            </div>
          </>
        ) : null}

        {mode === "reassign" ? (
          <section
            className="segment-manager-mode"
            aria-labelledby="segment-manager-reassign-title"
          >
            <div className="segment-manager-mode-heading">
              <div>
                <h3
                  ref={reassignHeadingRef}
                  id="segment-manager-reassign-title"
                  tabIndex={-1}
                >
                  更正归类
                </h3>
                <p>只更换练习册，科目和 PDF 页码保持不变。</p>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => changeMode("overview")}
              >
                返回概览
              </button>
            </div>
            <label className="segment-manager-field">
              目标练习册
              <select
                name="segment-target-workbook"
                autoComplete="off"
                value={targetWorkbookId}
                disabled={busy}
                onChange={(event) => {
                  setTargetWorkbookId(event.target.value);
                  setMessage("");
                }}
              >
                {reassignOptions.map((option) => (
                  <option
                    key={option.workbook.id}
                    value={option.workbook.id}
                    disabled={!option.canReassign && !option.sameTarget}
                  >
                    {reassignOptionLabel(option)}
                  </option>
                ))}
              </select>
            </label>
            {blockedOptions.length === 0 ? null : (
              <BlockedWorkbookOptions options={blockedOptions} />
            )}
            {selectedAssessment.sameTarget ? null : (
              <ReassignConflictNotice assessment={selectedAssessment} />
            )}
            {message === "" ? null : (
              <p className="segment-manager-error" role="alert">
                {message}
              </p>
            )}
            <p className="form-hint" id="segment-manager-reassign-reason">
              {busy
                ? "正在保存归类…"
                : targetWorkbookId === currentSegment.workbookId
                  ? "请选择不同的练习册后再保存。"
                  : selectedAssessment.canReassign
                    ? "保存后只更换练习册。"
                    : "当前目标练习册不可用，请先处理冲突。"}
            </p>
            <div className="editor-actions segment-manager-footer">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => changeMode("overview")}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={
                  busy ||
                  targetWorkbookId === currentSegment.workbookId ||
                  !selectedAssessment.canReassign
                }
                aria-describedby="segment-manager-reassign-reason"
                onClick={() => void saveAssignment()}
              >
                {busy ? "正在保存…" : "保存归类"}
              </button>
            </div>
          </section>
        ) : null}

        {mode === "remove" ? (
          <section
            className="segment-manager-mode destructive-confirmation"
            aria-labelledby="segment-manager-remove-title"
          >
            <div>
              <h3
                ref={removeHeadingRef}
                id="segment-manager-remove-title"
                tabIndex={-1}
              >
                移除这个分段？
              </h3>
              <p>
                分段会从题库树、题目浏览和拼卷中移除；原 PDF
                不删，题目区域、作答记录和复习历史保留。
              </p>
            </div>
            <dl className="segment-manager-details">
              <div>
                <dt>科目 / 练习册</dt>
                <dd>
                  {currentSegment.subjectName} / {currentSegment.workbookName}
                </dd>
              </div>
              <div>
                <dt>题目数</dt>
                <dd>{deletionSummary.liveQuestionCount}</dd>
              </div>
              <div>
                <dt>有作答题数 / 作答总次数</dt>
                <dd>
                  {deletionSummary.attemptedQuestionCount} /{" "}
                  {deletionSummary.totalAttemptCount}
                </dd>
              </div>
            </dl>
            {removeMessage === "" ? null : (
              <p className="segment-manager-error" role="alert">
                {removeMessage}
              </p>
            )}
            <div className="editor-actions segment-manager-footer">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => changeMode("overview")}
              >
                取消
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={() => void removeSegment()}
              >
                {busy ? "正在移除…" : "确认移除分段"}
              </button>
            </div>
          </section>
        ) : null}

        {mode === "stale" ? (
          <section
            className="segment-manager-mode segment-manager-error"
            role="alert"
            aria-labelledby="segment-manager-stale-title"
          >
            <div>
              <h3
                ref={staleHeadingRef}
                id="segment-manager-stale-title"
                tabIndex={-1}
              >
                分段状态需要重新加载
              </h3>
              <p>{message}</p>
            </div>
            <div className="editor-actions segment-manager-footer">
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void retryStaleRefresh()}
              >
                {busy ? "正在重新加载…" : "重新加载"}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </EditorDialog>
  );
}

function BlockedWorkbookOptions({
  options,
}: {
  options: readonly SegmentReassignWorkbookOption[];
}) {
  return (
    <section
      className="segment-manager-blocked-targets"
      aria-labelledby="segment-manager-blocked-targets-title"
    >
      <h4 id="segment-manager-blocked-targets-title">暂不可用的练习册</h4>
      <ul>
        {options.map((option) => (
          <li key={option.workbook.id}>
            <strong>{option.workbook.name}</strong>
            {option.disabledReason === "active-sibling" ? (
              <>
                {option.activeSiblings.map((item) => (
                  <span key={item.segmentId}>
                    相同 PDF 范围已有活动归类：{item.subjectName} /{" "}
                    {item.workbookName}，第 {item.pageStart}–{item.pageEnd} 页，
                    {item.questionCount} 道题。
                  </span>
                ))}
                <span>请先在对应分段管理中移除错误归类。</span>
              </>
            ) : option.disabledReason === "trashed-target" ? (
              <>
                {option.trashedTargets.map((item) => (
                  <span key={`${item.id}:${item.deletedAt}`}>
                    分段回收站已有 {item.sourceHeading}，第 {item.pageStart}–
                    {item.pageEnd} 页，可恢复 {item.restorableQuestionCount}{" "}
                    道题。
                  </span>
                ))}
                <span>请先在分段回收站恢复或处理该记录。</span>
              </>
            ) : (
              <span>当前分段已变化；请刷新题库后重新打开分段管理。</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReassignConflictNotice({
  assessment,
}: {
  assessment: ReturnType<typeof findSegmentReassignConflicts>;
}) {
  if (assessment.canReassign) return null;
  if (assessment.disabledReason === "active-sibling") {
    return (
      <div className="segment-manager-conflict" role="alert">
        <strong>目标练习册已有相同 PDF 分段。</strong>
        {assessment.activeSiblings.map((item) => (
          <p key={item.segmentId}>
            当前归类：{item.subjectName} / {item.workbookName}，已有{" "}
            {item.questionCount} 道题。
          </p>
        ))}
        <p>请先移除错误分段，再重新分析并归类。</p>
      </div>
    );
  }
  if (assessment.disabledReason === "trashed-target") {
    return (
      <div className="segment-manager-conflict" role="alert">
        <strong>目标练习册已有同一 PDF 分段的回收站记录。</strong>
        <p>请先从分段回收站处理该记录，再重试归类。</p>
      </div>
    );
  }
  return (
    <div className="segment-manager-conflict" role="alert">
      <strong>当前分段已不在活动题库中。</strong>
      <p>请关闭窗口并刷新题库。</p>
    </div>
  );
}

function reassignOptionLabel(option: SegmentReassignWorkbookOption): string {
  if (option.sameTarget) return `${option.workbook.name}（当前）`;
  if (option.disabledReason === "active-sibling") {
    return `${option.workbook.name}（已有活动分段）`;
  }
  if (option.disabledReason === "trashed-target") {
    return `${option.workbook.name}（回收站占用）`;
  }
  if (option.disabledReason === "source-not-found") {
    return `${option.workbook.name}（当前分段已变化）`;
  }
  return option.workbook.name;
}

function segmentVisibilityLabel(
  visibility: "pending" | "browsable",
  liveQuestionCount: number,
  indexState: WorkbookDocumentSegment["indexState"],
): string {
  if (visibility === "pending") {
    return liveQuestionCount === 0 ? "待建立索引" : "待继续索引";
  }
  return indexState === "needs_review" ? "有少量待校对" : "可浏览";
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
