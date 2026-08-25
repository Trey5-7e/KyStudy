import { useEffect, useMemo, useRef, useState } from "react";

import { EditorDialog } from "../../shared/components/EditorDialog";
import {
  getQuestionGapAcknowledgements,
  normalizeQuestionBankError,
  practiceStatus,
  setQuestionGapAcknowledgement,
  trashIndexedQuestion,
  updateIndexedQuestion,
  type IndexedQuestion,
  type PracticeStatus,
  type QuestionBankSnapshot,
  type SectionPart,
} from "../../shared/tauri/questionBankClient";
import type {
  QuestionRegionInput,
  QuestionType,
} from "../../shared/tauri/questionClient";
import {
  captureQuestionRegionPng,
  QuestionRegionCard,
} from "../review/QuestionRegionCard";
import { QuestionOcrPanel } from "./QuestionOcrPanel";
import type { PdfRegionOverlay } from "../library/pdf/PdfReader";
import { questionsInScope, type QuestionScope } from "./questionBankModel";
import {
  diagnoseQuestionGaps,
  type MissingQuestionIssue,
  type QuestionGapIssue,
} from "./questionGapDiagnosis";

export type {
  ManualIndexDialogComponent,
  ManualIndexDialogProps,
} from "./ManualIndexDialog";
import type { ManualIndexDialogComponent } from "./ManualIndexDialog";

export const PART_OPTIONS: ReadonlyArray<{
  value: SectionPart;
  label: string;
}> = [
  { value: "basic", label: "基础题" },
  { value: "comprehensive", label: "综合题" },
  { value: "extended", label: "拓展题" },
  { value: "other", label: "其他" },
];
export const TYPE_OPTIONS: ReadonlyArray<{
  value: QuestionType;
  label: string;
}> = [
  { value: "choice", label: "选择题" },
  { value: "blank", label: "填空题" },
  { value: "solution", label: "解答题" },
  { value: "other", label: "其他" },
];
export const STATUS_OPTIONS: ReadonlyArray<{
  value: PracticeStatus;
  label: string;
}> = [
  { value: "unattempted", label: "未做" },
  { value: "correct", label: "做对" },
  { value: "uncertain", label: "不全对" },
  { value: "incorrect", label: "做错" },
];

export const QUESTION_BROWSER_EDITING_NAVIGATION_STATUS = "先保存或取消编辑";

export function questionBrowserNavigationDisabled(editing: boolean): boolean {
  return editing;
}

export function questionBrowserNavigationIndex(
  selectedIndex: number,
  key: string,
  questionCount: number,
): number | undefined {
  if (key === "ArrowLeft" && selectedIndex > 0) return selectedIndex - 1;
  if (key === "ArrowRight" && selectedIndex + 1 < questionCount) {
    return selectedIndex + 1;
  }
  return undefined;
}

export interface RelativeQuestionInsert {
  anchorQuestion: IndexedQuestion;
  placement: "before" | "after";
  suggestedQuestionNumber?: string;
}

export interface QuestionIndexBrowserDialogProps {
  snapshot: QuestionBankSnapshot;
  initialSegmentId?: string;
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onChanged(snapshot: QuestionBankSnapshot): void;
  manualIndexDialog: ManualIndexDialogComponent;
}

const EMPTY_ACKNOWLEDGEMENTS: ReadonlySet<string> = new Set();

function questionBankErrorMessage(error: unknown): string {
  const normalized = normalizeQuestionBankError(error);
  return `${normalized.message} ${normalized.action}`.trim();
}

export function QuestionIndexBrowserDialog({
  snapshot,
  initialSegmentId,
  onClose,
  onRequestBack,
  backLabel,
  onChanged,
  manualIndexDialog: ManualDialog,
}: QuestionIndexBrowserDialogProps) {
  const [segmentScopeId, setSegmentScopeId] = useState(initialSegmentId);
  const initialScopedQuestions =
    initialSegmentId === undefined
      ? snapshot.questions
      : snapshot.questions.filter(
          (question) => question.segmentId === initialSegmentId,
        );
  const [filters, setFilters] = useState<QuestionScope>({});
  const [selectedId, setSelectedId] = useState(
    initialScopedQuestions[0]?.id ?? "",
  );
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [captureQuestion, setCaptureQuestion] = useState<IndexedQuestion>();
  const [relativeInsert, setRelativeInsert] =
    useState<RelativeQuestionInsert>();
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [acknowledgedIssueKeys, setAcknowledgedIssueKeys] = useState<
    ReadonlySet<string>
  >(EMPTY_ACKNOWLEDGEMENTS);
  const [acknowledgementBusyKey, setAcknowledgementBusyKey] = useState<
    string | undefined
  >();
  const [acknowledgementMessage, setAcknowledgementMessage] = useState("");
  const [navigationAnnouncement, setNavigationAnnouncement] = useState("");
  const mountedRef = useRef(true);
  const acknowledgementBusyRef = useRef<string | undefined>(undefined);
  const browserFocusRef = useRef<HTMLDivElement | null>(null);
  const scopedQuestions = useMemo(
    () =>
      segmentScopeId === undefined
        ? snapshot.questions
        : snapshot.questions.filter(
            (question) => question.segmentId === segmentScopeId,
          ),
    [segmentScopeId, snapshot.questions],
  );
  const questions = useMemo(
    () => questionsInScope(scopedQuestions, filters),
    [filters, scopedQuestions],
  );
  const segmentScope = snapshot.segments.find(
    (segment) => segment.id === segmentScopeId,
  );
  const effectiveSelectedId = questions.some((item) => item.id === selectedId)
    ? selectedId
    : (questions[0]?.id ?? "");
  const selectedIndex = Math.max(
    0,
    questions.findIndex((question) => question.id === effectiveSelectedId),
  );
  const question = questions[selectedIndex];
  const diagnosisIssues = useMemo(
    () => diagnoseQuestionGaps(questions, snapshot.questions),
    [questions, snapshot.questions],
  );
  const unresolvedDiagnosisIssues = useMemo(
    () =>
      diagnosisIssues.filter((issue) => !acknowledgedIssueKeys.has(issue.id)),
    [acknowledgedIssueKeys, diagnosisIssues],
  );
  const navigationDisabled = questionBrowserNavigationDisabled(editing);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    void getQuestionGapAcknowledgements()
      .then((keys) => {
        if (disposed || !mountedRef.current) return;
        setAcknowledgedIssueKeys(new Set(keys));
      })
      .catch((error: unknown) => {
        if (disposed || !mountedRef.current) return;
        setAcknowledgementMessage(questionBankErrorMessage(error));
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (
        (target instanceof Element &&
          target.closest(
            "input, select, textarea, [contenteditable='true'], [role='textbox'], [role='combobox']",
          ) !== null) ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        editing ||
        confirmDelete ||
        captureQuestion !== undefined ||
        relativeInsert !== undefined ||
        diagnosisOpen
      ) {
        return;
      }
      const nextIndex = questionBrowserNavigationIndex(
        selectedIndex,
        event.key,
        questions.length,
      );
      const nextQuestion =
        nextIndex === undefined ? undefined : questions[nextIndex];
      if (nextIndex === undefined || nextQuestion === undefined) return;
      event.preventDefault();
      setSelectedId(nextQuestion.id);
      setNavigationAnnouncement(
        `已切换到第 ${nextIndex + 1} / ${questions.length} 题：${nextQuestion.questionNumber}`,
      );
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [
    captureQuestion,
    confirmDelete,
    diagnosisOpen,
    editing,
    questions,
    relativeInsert,
    selectedIndex,
  ]);

  const acknowledgeIssue = async (
    issueKey: string,
    acknowledged: boolean,
  ): Promise<void> => {
    if (!mountedRef.current || acknowledgementBusyRef.current !== undefined) {
      return;
    }
    acknowledgementBusyRef.current = issueKey;
    setAcknowledgementBusyKey(issueKey);
    setAcknowledgementMessage("");
    try {
      const keys = await setQuestionGapAcknowledgement(issueKey, acknowledged);
      if (!mountedRef.current) return;
      setAcknowledgedIssueKeys(new Set(keys));
    } catch (error: unknown) {
      if (!mountedRef.current) return;
      setAcknowledgementMessage(questionBankErrorMessage(error));
    } finally {
      acknowledgementBusyRef.current = undefined;
      if (mountedRef.current) setAcknowledgementBusyKey(undefined);
    }
  };

  if (captureQuestion !== undefined) {
    return (
      <ManualDialog
        snapshot={snapshot}
        existingQuestion={captureQuestion}
        onClose={() => setCaptureQuestion(undefined)}
        onRequestBack={() => setCaptureQuestion(undefined)}
        backLabel="返回题目浏览"
        onSaved={(next) => {
          onChanged(next);
          setCaptureQuestion(undefined);
        }}
      />
    );
  }

  if (relativeInsert !== undefined) {
    return (
      <ManualDialog
        snapshot={snapshot}
        relativeInsert={relativeInsert}
        onClose={() => setRelativeInsert(undefined)}
        onRequestBack={() => setRelativeInsert(undefined)}
        backLabel="返回题目浏览"
        onSaved={(next) => {
          const previousIds = new Set(
            snapshot.questions.map((item) => item.id),
          );
          const inserted = next.questions.find(
            (item) => !previousIds.has(item.id),
          );
          onChanged(next);
          setSelectedId(inserted?.id ?? relativeInsert.anchorQuestion.id);
          setRelativeInsert(undefined);
        }}
      />
    );
  }

  if (diagnosisOpen) {
    return (
      <QuestionGapDiagnosisDialog
        issues={diagnosisIssues}
        acknowledgedIssueKeys={acknowledgedIssueKeys}
        acknowledgementBusyKey={acknowledgementBusyKey}
        acknowledgementMessage={acknowledgementMessage}
        onAcknowledge={(issueKey, acknowledged) => {
          void acknowledgeIssue(issueKey, acknowledged);
        }}
        onClose={() => setDiagnosisOpen(false)}
        onRequestBack={() => setDiagnosisOpen(false)}
        backLabel="返回题目浏览"
        onInsert={(issue) => {
          const anchorQuestion = snapshot.questions.find(
            (item) => item.id === issue.anchorQuestionId,
          );
          if (anchorQuestion === undefined) return;
          setRelativeInsert({
            anchorQuestion,
            placement: issue.placement,
            suggestedQuestionNumber: issue.suggestedQuestionNumber,
          });
          setDiagnosisOpen(false);
        }}
        onLocate={(questionId) => {
          setSelectedId(questionId);
          setDiagnosisOpen(false);
        }}
      />
    );
  }

  const remove = async () => {
    if (question === undefined) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await trashIndexedQuestion(question.id);
      onChanged(next);
      setConfirmDelete(false);
      const remaining = questions.filter((item) => item.id !== question.id);
      setSelectedId(
        remaining[Math.min(selectedIndex, remaining.length - 1)]?.id ?? "",
      );
    } catch (removeError: unknown) {
      setMessage(questionBankErrorMessage(removeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorDialog
      title="浏览题目索引"
      description="筛选题库后在同一窗口连续查看、编辑或删除题目；也可以使用键盘左右方向键切题。"
      dirty={editing}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      closeDisabled={busy}
      initialFocusRef={browserFocusRef}
      size="review"
    >
      <div className="question-browser-dialog">
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {navigationAnnouncement}
        </div>
        {segmentScopeId === undefined ? null : (
          <div className="question-browser-segment-scope" role="status">
            <div>
              <strong>当前分段范围</strong>
              <span>
                {segmentScope === undefined
                  ? `分段 ${segmentScopeId}`
                  : `${segmentScope.documentTitle} / ${segmentScope.subjectName} / ${segmentScope.workbookName} / ${segmentScope.sourceHeading} · PDF 第 ${segmentScope.pageStart}–${segmentScope.pageEnd} 页`}
              </span>
            </div>
            <button
              type="button"
              className="secondary-button"
              disabled={navigationDisabled}
              onClick={() => {
                if (navigationDisabled) return;
                setSegmentScopeId(undefined);
                setFilters({});
                setSelectedId(snapshot.questions[0]?.id ?? "");
              }}
            >
              浏览全部题目
            </button>
          </div>
        )}
        <QuestionScopeFilters
          questions={scopedQuestions}
          value={filters}
          disabled={navigationDisabled}
          onChange={(next) => {
            if (navigationDisabled) return;
            setFilters(next);
            setConfirmDelete(false);
          }}
          allowAll
        />
        {navigationDisabled ? (
          <p className="form-hint" role="status">
            {QUESTION_BROWSER_EDITING_NAVIGATION_STATUS}
          </p>
        ) : null}
        <div className="question-browser-diagnosis-bar">
          <div
            ref={browserFocusRef}
            className="question-browser-count"
            aria-live="polite"
            tabIndex={-1}
          >
            当前筛选 {questions.length} 道
          </div>
          <button
            type="button"
            className="secondary-button question-diagnosis-button"
            disabled={navigationDisabled}
            onClick={() => {
              if (navigationDisabled) return;
              setAcknowledgementMessage("");
              setDiagnosisOpen(true);
            }}
          >
            诊断缺漏
            {unresolvedDiagnosisIssues.length === 0 ? null : (
              <span>{unresolvedDiagnosisIssues.length}</span>
            )}
          </button>
        </div>
        {questions.length === 0 ? (
          <p className="empty-state question-browser-empty">
            当前范围内没有题目，请调整筛选条件。
          </p>
        ) : (
          <div className="question-browser-layout">
            <nav className="question-browser-list" aria-label="题目列表">
              {questions.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === question?.id ? "is-active" : undefined}
                  aria-current={item.id === question?.id ? "true" : undefined}
                  disabled={navigationDisabled}
                  onClick={() => {
                    if (navigationDisabled) return;
                    setSelectedId(item.id);
                    setConfirmDelete(false);
                  }}
                >
                  <span>第 {item.questionNumber} 题</span>
                  <small>
                    {[
                      item.sectionPart !== "other"
                        ? partLabel(item.sectionPart)
                        : undefined,
                      typeLabel(item.questionType),
                      item.chapter,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                  <span
                    className={`question-status question-status-${practiceStatus(item)}`}
                  >
                    {statusLabel(practiceStatus(item))}
                  </span>
                  <span className="sr-only">，第 {index + 1} 项</span>
                </button>
              ))}
            </nav>
            {question === undefined ? null : (
              <section className="question-browser-card" aria-live="polite">
                <div className="question-browser-toolbar">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={selectedIndex === 0 || navigationDisabled}
                    onClick={() => {
                      if (navigationDisabled) return;
                      const previous = questions[selectedIndex - 1];
                      if (previous !== undefined) setSelectedId(previous.id);
                    }}
                  >
                    ← 上一题
                  </button>
                  <strong>
                    {selectedIndex + 1} / {questions.length}
                  </strong>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      selectedIndex + 1 >= questions.length ||
                      navigationDisabled
                    }
                    onClick={() => {
                      if (navigationDisabled) return;
                      const next = questions[selectedIndex + 1];
                      if (next !== undefined) setSelectedId(next.id);
                    }}
                  >
                    下一题 →
                  </button>
                </div>
                {editing ? (
                  <IndexedQuestionEditForm
                    question={question}
                    busy={busy}
                    message={message}
                    onCancel={() => {
                      if (busy) return;
                      setEditing(false);
                      setMessage("");
                    }}
                    onSave={async (request) => {
                      setBusy(true);
                      setMessage("");
                      try {
                        const next = await updateIndexedQuestion(request);
                        onChanged(next);
                        setEditing(false);
                      } catch (saveError: unknown) {
                        setMessage(questionBankErrorMessage(saveError));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                ) : confirmDelete ? (
                  <div className="destructive-confirmation">
                    <strong>删除第 {question.questionNumber} 题？</strong>
                    <p>
                      题目会从索引和后续拼卷范围中移除，已有作答历史不会影响其他题目。
                    </p>
                    {message === "" ? null : (
                      <p className="form-error" role="alert">
                        {message}
                      </p>
                    )}
                    <div className="editor-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setConfirmDelete(false)}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        disabled={busy}
                        onClick={() => void remove()}
                      >
                        {busy ? "正在删除…" : "确认删除题目"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <header className="question-browser-card-heading">
                      <div>
                        <h3>
                          {question.chapter} · 第 {question.questionNumber} 题
                        </h3>
                        <p>
                          {question.subjectName} / {question.workbookName} /{" "}
                          {partLabel(question.sectionPart)} /{" "}
                          {typeLabel(question.questionType)}
                        </p>
                      </div>
                      <div className="question-browser-card-actions">
                        <div
                          className="question-browser-insert-actions"
                          aria-label="相对当前题补题"
                        >
                          <span>补题</span>
                          <button
                            type="button"
                            onClick={() =>
                              setRelativeInsert({
                                anchorQuestion: question,
                                placement: "before",
                              })
                            }
                          >
                            前面插入
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setRelativeInsert({
                                anchorQuestion: question,
                                placement: "after",
                              })
                            }
                          >
                            后面插入
                          </button>
                        </div>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setCaptureQuestion(question)}
                        >
                          调整题目区域
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setEditing(true)}
                        >
                          编辑题目
                        </button>
                        <button
                          type="button"
                          className="danger-text-button"
                          onClick={() => setConfirmDelete(true)}
                        >
                          删除题目
                        </button>
                      </div>
                    </header>
                    <QuestionRegionCard
                      documentId={question.documentId}
                      title={question.title}
                      regions={question.regions}
                    />
                    <QuestionOcrPanel
                      questionId={question.id}
                      regions={question.regions}
                      captureRegion={(region) =>
                        captureQuestionRegionPng(question.documentId, region)
                      }
                    />
                    <div className="question-preview-meta">
                      <span>{statusLabel(practiceStatus(question))}</span>
                      <span>做过 {question.attemptCount} 次</span>
                      <span>做错 {question.incorrectCount} 次</span>
                      <span>不全对 {question.partialCount} 次</span>
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </EditorDialog>
  );
}

export function QuestionGapDiagnosisDialog({
  issues,
  acknowledgedIssueKeys = EMPTY_ACKNOWLEDGEMENTS,
  acknowledgementBusyKey,
  acknowledgementMessage = "",
  onAcknowledge = () => undefined,
  onClose,
  onRequestBack,
  backLabel,
  onInsert,
  onLocate,
}: {
  issues: readonly QuestionGapIssue[];
  acknowledgedIssueKeys?: ReadonlySet<string>;
  acknowledgementBusyKey?: string;
  acknowledgementMessage?: string;
  onAcknowledge?: (issueKey: string, acknowledged: boolean) => void;
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onInsert(issue: MissingQuestionIssue): void;
  onLocate(questionId: string): void;
}) {
  const unresolvedIssues = useMemo(
    () => issues.filter((issue) => !acknowledgedIssueKeys.has(issue.id)),
    [acknowledgedIssueKeys, issues],
  );
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const visibleIssues = useMemo(
    () => (showAcknowledged ? issues : unresolvedIssues),
    [issues, showAcknowledged, unresolvedIssues],
  );
  const missingCount = unresolvedIssues.filter(
    (issue) => issue.kind === "missing",
  ).length;
  const reviewCount = unresolvedIssues.length - missingCount;
  const acknowledgementBusy = acknowledgementBusyKey !== undefined;
  return (
    <EditorDialog
      title="题目缺漏诊断"
      description="按同一 PDF 分段、章节、篇章和题型检查题号连续性；完全本地运行，不调用 AI。"
      dirty={false}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      closeDisabled={acknowledgementBusy}
      size="large"
    >
      <div className="question-gap-diagnosis">
        <div className="question-gap-summary" aria-live="polite">
          <div>
            <span>可能缺题</span>
            <strong>{missingCount}</strong>
          </div>
          <div>
            <span>需要检查</span>
            <strong>{reviewCount}</strong>
          </div>
        </div>
        <label className="question-gap-show-acknowledged">
          <input
            type="checkbox"
            checked={showAcknowledged}
            onChange={(event) => setShowAcknowledged(event.target.checked)}
          />
          显示已确认
        </label>
        {acknowledgementMessage === "" ? null : (
          <p className="form-error" role="alert">
            {acknowledgementMessage}
          </p>
        )}
        {visibleIssues.length === 0 ? (
          <div className="question-gap-empty">
            <strong>
              {issues.length === 0
                ? "当前范围未发现明显缺漏"
                : "当前范围的问题均已确认"}
            </strong>
            <p>
              {issues.length === 0
                ? "题号连续且没有相邻重复项。非纯数字题号仍建议人工抽查。"
                : "勾选“显示已确认”可以查看历史诊断并恢复提示。"}
            </p>
          </div>
        ) : (
          <ol className="question-gap-list">
            {visibleIssues.map((issue) => {
              const acknowledged = acknowledgedIssueKeys.has(issue.id);
              return (
                <li key={issue.id}>
                  <article>
                    <header>
                      <div>
                        <span
                          className={`question-gap-kind question-gap-kind-${issue.kind}`}
                        >
                          {issue.kind === "missing"
                            ? issue.confidence === "high"
                              ? "较高可信"
                              : "建议核对"
                            : issue.kind === "duplicate"
                              ? "重复题号"
                              : issue.kind === "large_jump"
                                ? "异常跳号"
                                : "非数字题号"}
                        </span>
                        {acknowledged ? (
                          <span className="question-gap-acknowledged">
                            已确认
                          </span>
                        ) : null}
                        <strong>
                          {issue.kind === "missing"
                            ? `可能缺少第 ${issue.suggestedQuestionNumber} 题`
                            : issue.kind === "duplicate"
                              ? "相邻题号重复"
                              : issue.kind === "large_jump"
                                ? "题号跨度过大"
                                : "题号需要人工检查"}
                        </strong>
                      </div>
                      {issue.kind === "missing" ? (
                        <button
                          type="button"
                          className="primary-button"
                          disabled={acknowledgementBusy}
                          onClick={() => onInsert(issue)}
                        >
                          补第 {issue.suggestedQuestionNumber} 题
                        </button>
                      ) : (
                        <div className="question-gap-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={acknowledgementBusy}
                            onClick={() => onLocate(issue.questionId)}
                          >
                            定位检查
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={acknowledgementBusy}
                            onClick={() =>
                              onAcknowledge(issue.id, !acknowledged)
                            }
                          >
                            {acknowledgementBusyKey === issue.id
                              ? "正在保存…"
                              : acknowledged
                                ? "恢复提示"
                                : "确认无需处理"}
                          </button>
                        </div>
                      )}
                    </header>
                    <p>{issue.evidence}</p>
                    <small>
                      {issue.subjectName} / {issue.workbookName} /{" "}
                      {issue.chapter} / {partLabel(issue.sectionPart)} /{" "}
                      {typeLabel(issue.questionType)}
                    </small>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
        <div className="question-gap-note">
          诊断依据是题号连续性，不会仅凭页面空白自动创建题目；你确认 PDF
          后再手动框选，能避免误补。
        </div>
      </div>
    </EditorDialog>
  );
}

export function IndexedQuestionEditForm({
  question,
  busy,
  message,
  onCancel,
  onSave,
}: {
  question: IndexedQuestion;
  busy: boolean;
  message: string;
  onCancel(): void;
  onSave(request: Parameters<typeof updateIndexedQuestion>[0]): Promise<void>;
}) {
  const [title, setTitle] = useState(question.title);
  const [chapter, setChapter] = useState(question.chapter);
  const [sectionPart, setSectionPart] = useState(question.sectionPart);
  const [questionType, setQuestionType] = useState(question.questionType);
  const [questionNumber, setQuestionNumber] = useState(question.questionNumber);
  return (
    <form
      className="editor-form indexed-question-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          questionId: question.id,
          title,
          chapter,
          sectionPart,
          questionType,
          questionNumber,
        });
      }}
    >
      <div className="form-grid two-columns">
        <label>
          章节
          <input
            name="chapter"
            autoComplete="off"
            required
            maxLength={120}
            value={chapter}
            onChange={(event) => setChapter(event.target.value)}
          />
        </label>
        <label>
          题号
          <input
            name="questionNumber"
            autoComplete="off"
            required
            maxLength={60}
            value={questionNumber}
            onChange={(event) => setQuestionNumber(event.target.value)}
          />
        </label>
        <label>
          篇章
          <select
            name="sectionPart"
            value={sectionPart}
            onChange={(event) =>
              setSectionPart(event.target.value as SectionPart)
            }
          >
            {PART_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          题型
          <select
            name="questionType"
            value={questionType}
            onChange={(event) =>
              setQuestionType(event.target.value as QuestionType)
            }
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        卡片标题
        <input
          name="title"
          autoComplete="off"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {message === "" ? null : (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      <div className="editor-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "正在保存…" : "保存题目"}
        </button>
      </div>
    </form>
  );
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const current = key(value);
    if (seen.has(current)) return false;
    seen.add(current);
    return true;
  });
}

export function QuestionScopeFilters({
  questions,
  value,
  onChange,
  disabled = false,
  allowAll = false,
  requireExact = false,
  hideSubject = false,
}: {
  questions: readonly IndexedQuestion[];
  value: QuestionScope;
  onChange(value: QuestionScope): void;
  disabled?: boolean;
  allowAll?: boolean;
  requireExact?: boolean;
  hideSubject?: boolean;
}) {
  const subjects = uniqueBy(questions, (question) => question.subjectId);
  const subjectQuestions =
    value.subjectId === undefined
      ? questions
      : questions.filter((question) => question.subjectId === value.subjectId);
  const workbooks = uniqueBy(
    subjectQuestions,
    (question) => question.workbookId,
  );
  const workbookQuestions =
    value.workbookId === undefined
      ? subjectQuestions
      : subjectQuestions.filter(
          (question) => question.workbookId === value.workbookId,
        );
  const chapters = [
    ...new Set(workbookQuestions.map((question) => question.chapter)),
  ];
  const set = (patch: Partial<QuestionScope>) =>
    onChange({ ...value, ...patch });
  const allOption =
    allowAll && !requireExact ? <option value="">全部</option> : null;
  return (
    <div className="question-scope-filters">
      {hideSubject ? null : (
        <label>
          科目
          <select
            name="scopeSubject"
            disabled={disabled}
            value={value.subjectId ?? ""}
            onChange={(event) =>
              set({
                subjectId: empty(event.target.value),
                workbookId: undefined,
                chapter: undefined,
                sectionPart: undefined,
                questionType: undefined,
              })
            }
          >
            {allOption}
            {subjects.map((item) => (
              <option key={item.subjectId} value={item.subjectId}>
                {item.subjectName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        练习册
        <select
          name="scopeWorkbook"
          disabled={disabled}
          value={value.workbookId ?? ""}
          onChange={(event) =>
            set({
              workbookId: empty(event.target.value),
              chapter: undefined,
              sectionPart: undefined,
              questionType: undefined,
            })
          }
        >
          {allOption}
          {workbooks.map((item) => (
            <option key={item.workbookId} value={item.workbookId}>
              {item.workbookName}
            </option>
          ))}
        </select>
      </label>
      <label>
        章节
        <select
          name="scopeChapter"
          disabled={disabled}
          value={value.chapter ?? ""}
          onChange={(event) =>
            set({
              chapter: empty(event.target.value),
              sectionPart: undefined,
              questionType: undefined,
            })
          }
        >
          {allOption}
          {chapters.map((chapter) => (
            <option key={chapter}>{chapter}</option>
          ))}
        </select>
      </label>
      <label>
        篇章
        <select
          name="scopeSectionPart"
          disabled={disabled}
          value={value.sectionPart ?? ""}
          onChange={(event) =>
            set({
              sectionPart: empty(event.target.value) as SectionPart | undefined,
              questionType: undefined,
            })
          }
        >
          {allOption}
          {PART_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        题型
        <select
          name="scopeQuestionType"
          disabled={disabled}
          value={value.questionType ?? ""}
          onChange={(event) =>
            set({
              questionType: empty(event.target.value) as
                QuestionType | undefined,
            })
          }
        >
          {allOption}
          {TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function completeScope(
  questions: readonly IndexedQuestion[],
  scope: QuestionScope,
): QuestionScope {
  const subjectId = scope.subjectId ?? questions[0]?.subjectId;
  const subjectQuestions = questions.filter(
    (question) => question.subjectId === subjectId,
  );
  const workbookId = scope.workbookId ?? subjectQuestions[0]?.workbookId;
  const workbookQuestions = subjectQuestions.filter(
    (question) => question.workbookId === workbookId,
  );
  const chapter = scope.chapter ?? workbookQuestions[0]?.chapter;
  const chapterQuestions = workbookQuestions.filter(
    (question) => question.chapter === chapter,
  );
  const sectionPart = scope.sectionPart ?? chapterQuestions[0]?.sectionPart;
  const partQuestions = chapterQuestions.filter(
    (question) => question.sectionPart === sectionPart,
  );
  const questionType = scope.questionType ?? partQuestions[0]?.questionType;
  return { subjectId, workbookId, chapter, sectionPart, questionType };
}

export function toRegionOverlay(
  region: Pick<
    PdfRegionOverlay,
    "id" | "pageNumber" | "x" | "y" | "width" | "height"
  >,
): PdfRegionOverlay {
  return {
    id: region.id,
    pageNumber: region.pageNumber,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  };
}

export function toRegionInput(region: PdfRegionOverlay): QuestionRegionInput {
  return {
    pageNumber: region.pageNumber,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  };
}

export function regionSignature(regions: readonly PdfRegionOverlay[]): string {
  return regions
    .map(
      (region) =>
        `${region.id}:${region.pageNumber}:${region.x.toFixed(6)}:${region.y.toFixed(6)}:${region.width.toFixed(6)}:${region.height.toFixed(6)}`,
    )
    .join("|");
}

export function empty(value: string): string | undefined {
  return value === "" ? undefined : value;
}
export function partLabel(value: SectionPart): string {
  return PART_OPTIONS.find((option) => option.value === value)?.label ?? "其他";
}
export function typeLabel(value: QuestionType): string {
  return TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "其他";
}
export function statusLabel(value: PracticeStatus): string {
  return (
    STATUS_OPTIONS.find((option) => option.value === value)?.label ?? "未做"
  );
}
