import { Fragment, useMemo, useState, type FormEvent } from "react";

import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import {
  normalizeQuestionBankError,
  recordBulkQuestionAttempts,
  updateIndexedQuestion,
  type IndexedQuestion,
  type PracticeStatus,
  type QuestionBankSnapshot,
  type SectionPart,
} from "../../shared/tauri/questionBankClient";
import type {
  AttemptResult,
  QuestionType,
} from "../../shared/tauri/questionClient";
import { localDateForTimezone } from "../../shared/tauri/scheduleClient";
import { QuestionRegionCard } from "../review/QuestionRegionCard";
import {
  generateWeightedPaper,
  paperChapterKey,
  questionsInPaperScopeGroups,
  questionsInPaperScope,
  type PaperTypeQuotas,
  type PaperScopeGroup,
} from "./questionBankModel";
import {
  IndexedQuestionEditForm,
  partLabel,
  PART_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  typeLabel,
  type ManualIndexDialogComponent,
} from "./QuestionIndexDialogs";
import {
  createPaperDraftRecipe,
  clearPaperDraft,
  loadPaperDraft,
  loadPaperTypeQuotas,
  paperSpecFromDraftRecipe,
  savePaperDraft,
  savePaperTypeQuotas,
  type PaperDraftRecipe,
} from "./paperSetupPreferences";

export function PaperSetupDialog({
  questions,
  onClose,
  onRequestBack,
  backLabel,
  onGenerated,
}: {
  questions: IndexedQuestion[];
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onGenerated(
    questions: IndexedQuestion[],
    recipe: PaperDraftRecipe,
    results?: Record<string, AttemptResult>,
    recordedResults?: Record<string, AttemptResult>,
  ): void;
}) {
  const subjects = useMemo(
    () => uniqueBy(questions, (question) => question.subjectId),
    [questions],
  );
  const [lastDraft] = useState(() => loadPaperDraft());
  const [initialSetup] = useState(() => {
    const rememberedQuotas = loadPaperTypeQuotas();
    const rememberedSpec =
      lastDraft === undefined
        ? undefined
        : paperSpecFromDraftRecipe(lastDraft.recipe);
    const availableSubjectIds = new Set(
      subjects.map((subject) => subject.subjectId),
    );
    const rememberedSubjectIds = new Set(
      rememberedSpec === undefined
        ? []
        : [...(rememberedSpec.subjectIds ?? [])].filter((subjectId) =>
            availableSubjectIds.has(subjectId),
          ),
    );
    const subjectIds =
      rememberedSubjectIds.size > 0
        ? rememberedSubjectIds
        : availableSubjectIds;
    const rememberedSubjectQuotas =
      rememberedSpec?.subjectQuotas ?? rememberedQuotas;
    return {
      subjectIds,
      scopeGroups:
        rememberedSpec === undefined
          ? [createPaperScopeGroup(1)]
          : clonePaperScopeGroups(rememberedSpec.scopeGroups ?? []),
      subjectQuotas: new Map<string, PaperTypeQuotas>(
        subjects.map((subject) => [
          subject.subjectId,
          rememberedSubjectQuotas.get(subject.subjectId) ??
            defaultPaperTypeQuotas(),
        ]),
      ),
      statuses:
        rememberedSpec === undefined
          ? new Set(STATUS_OPTIONS.map((value) => value.value))
          : new Set(rememberedSpec.statuses),
    };
  });
  const [subjectIds, setSubjectIds] = useState<Set<string>>(
    () => new Set(initialSetup.subjectIds),
  );
  const [scopeGroups, setScopeGroups] = useState<PaperScopeGroup[]>(() =>
    clonePaperScopeGroups(initialSetup.scopeGroups),
  );
  const [subjectQuotas, setSubjectQuotas] = useState<
    Map<string, PaperTypeQuotas>
  >(() => cloneSubjectQuotas(initialSetup.subjectQuotas));
  const [statuses, setStatuses] = useState<Set<PracticeStatus>>(
    () => new Set(initialSetup.statuses),
  );
  const [message, setMessage] = useState("");
  const eligibleQuestions = useMemo(
    () => questions.filter((question) => subjectIds.has(question.subjectId)),
    [questions, subjectIds],
  );
  const scopedQuestionCount = useMemo(
    () => questionsInPaperScopeGroups(eligibleQuestions, scopeGroups).length,
    [eligibleQuestions, scopeGroups],
  );
  const requestedCount = useMemo(
    () =>
      [...subjectIds].reduce(
        (total, subjectId) =>
          total + paperTypeQuotaTotal(subjectQuotas.get(subjectId)),
        0,
      ),
    [subjectIds, subjectQuotas],
  );
  const rememberedQuestions = useMemo(() => {
    if (lastDraft === undefined) return [];
    const questionsById = new Map(
      questions.map((question) => [question.id, question]),
    );
    return lastDraft.questionIds.flatMap((questionId) => {
      const question = questionsById.get(questionId);
      return question === undefined ? [] : [question];
    });
  }, [lastDraft, questions]);
  const setupDirty =
    !setsEqual(subjectIds, initialSetup.subjectIds) ||
    !paperScopeGroupsEqual(scopeGroups, initialSetup.scopeGroups) ||
    !subjectQuotasEqual(subjectQuotas, initialSetup.subjectQuotas) ||
    !setsEqual(statuses, initialSetup.statuses);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const generated = generateWeightedPaper(questions, {
      subjectIds,
      scopeGroups,
      subjectQuotas,
      statuses,
      choiceCount: 0,
      blankCount: 0,
      solutionCount: 0,
    });
    const requested = requestedCount;
    if (generated.length === 0) {
      setMessage("当前范围和状态下没有可用题目。");
      return;
    }
    if (generated.length < requested)
      setMessage(`符合条件的题目不足，只能生成 ${generated.length} 道。`);
    const recipe = createPaperDraftRecipe({
      subjectIds,
      scopeGroups,
      subjectQuotas,
      statuses,
    });
    savePaperDraft({
      questionIds: generated.map((question) => question.id),
      recipe,
      savedAt: Date.now(),
    });
    savePaperTypeQuotas(subjectQuotas);
    onGenerated(generated, recipe);
  };
  const restoreLastDraft = () => {
    if (lastDraft === undefined || rememberedQuestions.length === 0) return;
    onGenerated(
      rememberedQuestions,
      lastDraft.recipe,
      lastDraft.results,
      lastDraft.recordedResults,
    );
  };
  return (
    <EditorDialog
      title="智能拼卷"
      description="先按范围和题目状态筛选，再按历史错题权重随机抽取；不会调用 AI。"
      dirty={setupDirty}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      size="large"
    >
      <form className="editor-form paper-setup-form" onSubmit={submit}>
        <fieldset>
          <legend>可拼入的科目</legend>
          <p className="paper-subject-intro">
            勾选要参与组卷的科目，再分别设置每个科目的题型数量。
          </p>
          <div className="paper-subject-options">
            {subjects.map((subject) => {
              const selected = subjectIds.has(subject.subjectId);
              const quota =
                subjectQuotas.get(subject.subjectId) ??
                defaultPaperTypeQuotas();
              return (
                <div
                  key={subject.subjectId}
                  className={`paper-subject-option${selected ? " is-selected" : ""}`}
                >
                  <label className="paper-subject-toggle">
                    <input
                      className="paper-subject-input"
                      type="checkbox"
                      name="paperSubject"
                      value={subject.subjectId}
                      checked={selected}
                      onChange={(event) => {
                        setSubjectIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(subject.subjectId);
                          else next.delete(subject.subjectId);
                          return next;
                        });
                        setScopeGroups([createPaperScopeGroup(1)]);
                      }}
                    />
                    <span className="paper-subject-check" aria-hidden="true">
                      {selected ? "✓" : ""}
                    </span>
                    <span className="paper-subject-name">
                      {subject.subjectName}
                    </span>
                    <span className="paper-subject-state">
                      {selected ? "已选" : "未选"}
                    </span>
                  </label>
                  <div className="paper-subject-quota-heading">题型数量</div>
                  <div className="paper-subject-quota-grid">
                    {(["choice", "blank", "solution"] as const).map((type) => (
                      <label key={type}>
                        <span>{typeLabel(type)}</span>
                        <input
                          name={`paperQuota-${subject.subjectId}-${type}`}
                          type="number"
                          min="0"
                          max="50"
                          step="1"
                          inputMode="numeric"
                          value={quota[type]}
                          disabled={!selected}
                          aria-label={`${subject.subjectName}${typeLabel(type)}数量`}
                          onChange={(event) =>
                            setSubjectQuotas((current) => {
                              const next = new Map(current);
                              const value = Number(event.target.value);
                              next.set(subject.subjectId, {
                                ...(next.get(subject.subjectId) ??
                                  defaultPaperTypeQuotas()),
                                [type]: Number.isFinite(value)
                                  ? Math.min(50, Math.max(0, Math.round(value)))
                                  : 0,
                              });
                              return next;
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
        <PaperScopeFilters
          questions={eligibleQuestions}
          value={scopeGroups}
          onChange={setScopeGroups}
        />
        <fieldset>
          <legend>允许抽取的题目状态</legend>
          <div className="paper-status-options">
            {STATUS_OPTIONS.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  name="paperStatus"
                  value={option.value}
                  checked={statuses.has(option.value)}
                  onChange={(event) =>
                    setStatuses((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(option.value);
                      else next.delete(option.value);
                      return next;
                    })
                  }
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        {message === "" ? null : (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <p className="form-hint" id="paper-generate-reason">
          {subjectIds.size === 0
            ? "至少选择一个科目。"
            : statuses.size === 0
              ? "至少选择一种题目状态。"
              : scopeGroups.length > 0 &&
                  scopeGroups.every((group) => !group.enabled)
                ? "至少启用一个范围组。"
                : requestedCount === 0
                  ? "至少为一个已选科目设置题型数量。"
                  : `当前范围合并后有 ${scopedQuestionCount} 道题，按科目配额共请求 ${requestedCount} 道。`}
        </p>
        <EditorDialogFooter className="editor-actions question-bank-dialog-footer">
          <EditorDialogCloseButton className="secondary-button">
            取消
          </EditorDialogCloseButton>
          {rememberedQuestions.length === 0 ? null : (
            <button
              type="button"
              className="secondary-button"
              onClick={restoreLastDraft}
            >
              打开上次组卷（{rememberedQuestions.length} 道）
            </button>
          )}
          <button
            type="submit"
            className="primary-button"
            aria-describedby="paper-generate-reason"
            disabled={
              statuses.size === 0 ||
              subjectIds.size === 0 ||
              requestedCount === 0 ||
              (scopeGroups.length > 0 &&
                scopeGroups.every((group) => !group.enabled))
            }
          >
            生成练习卷
          </button>
        </EditorDialogFooter>
      </form>
    </EditorDialog>
  );
}

export function PaperDialog({
  questions,
  snapshot,
  timezone,
  manualIndexDialog: ManualIndexDialog,
  recipe,
  initialResults,
  initialRecordedResults,
  onClose,
  onRequestBack,
  backLabel,
  onSnapshotChanged,
  onSaved,
}: {
  questions: IndexedQuestion[];
  snapshot: QuestionBankSnapshot;
  timezone: string;
  manualIndexDialog: ManualIndexDialogComponent;
  recipe?: PaperDraftRecipe;
  initialResults?: Record<string, AttemptResult>;
  initialRecordedResults?: Record<string, AttemptResult>;
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onSnapshotChanged(snapshot: QuestionBankSnapshot): void;
  onSaved(snapshot: QuestionBankSnapshot): void;
}) {
  const [paperQuestions, setPaperQuestions] = useState(questions);
  const [results, setResults] = useState<Record<string, AttemptResult>>(() => ({
    ...initialResults,
  }));
  const [recordedResults, setRecordedResults] = useState<
    Record<string, AttemptResult>
  >(() => ({ ...initialRecordedResults }));
  const [selectedQuestionType, setSelectedQuestionType] =
    useState<PaperQuestionFilter>("all");
  const [adjustingQuestionId, setAdjustingQuestionId] = useState<string>();
  const [editingQuestionId, setEditingQuestionId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const applySnapshot = (next: QuestionBankSnapshot) => {
    onSnapshotChanged(next);
    setPaperQuestions((current) =>
      current.flatMap((question) => {
        const updated = next.questions.find((item) => item.id === question.id);
        return updated === undefined ? [] : [updated];
      }),
    );
  };
  const adjustingQuestion = paperQuestions.find(
    (question) => question.id === adjustingQuestionId,
  );
  const editingQuestion = paperQuestions.find(
    (question) => question.id === editingQuestionId,
  );
  const questionTypeCounts = useMemo(() => {
    const counts: Record<PaperQuestionFilter, number> = {
      all: paperQuestions.length,
      choice: 0,
      blank: 0,
      solution: 0,
      other: 0,
    };
    for (const question of paperQuestions) counts[question.questionType] += 1;
    return counts;
  }, [paperQuestions]);
  const visiblePaperQuestions = useMemo(
    () =>
      selectedQuestionType === "all"
        ? paperQuestions
        : paperQuestions.filter(
            (question) => question.questionType === selectedQuestionType,
          ),
    [paperQuestions, selectedQuestionType],
  );

  if (adjustingQuestion !== undefined) {
    return (
      <ManualIndexDialog
        snapshot={snapshot}
        existingQuestion={adjustingQuestion}
        onClose={() => setAdjustingQuestionId(undefined)}
        onRequestBack={() => setAdjustingQuestionId(undefined)}
        backLabel="返回练习卷"
        onSaved={(next) => {
          applySnapshot(next);
          setAdjustingQuestionId(undefined);
        }}
      />
    );
  }
  if (editingQuestion !== undefined) {
    return (
      <EditorDialog
        title="编辑练习卷题目"
        description="校正题号、章节、篇章、题型或卡片标题；保存后会立即更新本张练习卷。"
        dirty
        onRequestClose={() => setEditingQuestionId(undefined)}
        onRequestBack={() => setEditingQuestionId(undefined)}
        backLabel="返回练习卷"
        closeDisabled={busy}
      >
        <IndexedQuestionEditForm
          question={editingQuestion}
          busy={busy}
          message={message}
          onCancel={() => {
            setEditingQuestionId(undefined);
            setMessage("");
          }}
          onSave={async (request) => {
            setBusy(true);
            setMessage("");
            try {
              applySnapshot(await updateIndexedQuestion(request));
              setEditingQuestionId(undefined);
            } catch (saveError: unknown) {
              const normalized = normalizeQuestionBankError(saveError);
              setMessage(`${normalized.message} ${normalized.action}`.trim());
            } finally {
              setBusy(false);
            }
          }}
        />
      </EditorDialog>
    );
  }
  const pendingEntries = paperResultEntries(results, recordedResults);
  const persistCurrentDraft = (
    nextResults = results,
    nextRecordedResults = recordedResults,
  ): boolean => {
    if (recipe === undefined) {
      setMessage("当前练习卷没有可恢复的组卷规则。");
      return false;
    }
    savePaperDraft({
      questionIds: paperQuestions.map((question) => question.id),
      recipe,
      results: nextResults,
      recordedResults: nextRecordedResults,
      savedAt: Date.now(),
    });
    return true;
  };
  const persistPaperDraft = () => {
    if (!persistCurrentDraft()) return;
    setMessage("本卷和当前作答标记已暂存，下次可以继续。");
  };
  const saveProgress = async () => {
    if (Object.keys(results).length === 0) {
      setMessage("至少为一道题选择做对、不全对或做错。");
      return;
    }
    if (pendingEntries.length === 0) {
      persistCurrentDraft();
      setMessage("当前做题记录已经保存。");
      return;
    }
    setBusy(true);
    try {
      const nextSnapshot = await recordBulkQuestionAttempts(
        localDateForTimezone(new Date(), timezone),
        pendingEntries,
      );
      onSnapshotChanged(nextSnapshot);
      const nextRecordedResults = { ...results };
      setRecordedResults(nextRecordedResults);
      persistCurrentDraft(results, nextRecordedResults);
      setMessage(
        `已保存 ${Object.keys(results).length} 道题的做题记录，可继续做题。`,
      );
    } catch (error: unknown) {
      const normalized = normalizeQuestionBankError(error);
      setMessage(`${normalized.message} ${normalized.action}`.trim());
    } finally {
      setBusy(false);
    }
  };
  const submitPaper = async () => {
    const resultCount = Object.keys(results).length;
    if (resultCount === 0) {
      setMessage("至少为一道题选择做对、不全对或做错。");
      return;
    }
    if (resultCount < paperQuestions.length) {
      setMessage(
        `还有 ${paperQuestions.length - resultCount} 道题未登记，完成整卷后再提交。`,
      );
      return;
    }
    setBusy(true);
    try {
      const nextSnapshot =
        pendingEntries.length === 0
          ? snapshot
          : await recordBulkQuestionAttempts(
              localDateForTimezone(new Date(), timezone),
              pendingEntries,
            );
      clearPaperDraft();
      onSaved(nextSnapshot);
    } catch (error: unknown) {
      const normalized = normalizeQuestionBankError(error);
      setMessage(`${normalized.message} ${normalized.action}`.trim());
    } finally {
      setBusy(false);
    }
  };
  const refreshGeneratedPaper = () => {
    if (recipe === undefined) {
      setMessage("当前练习卷没有可刷新的组卷规则。");
      return;
    }
    if (Object.keys(results).length > 0) {
      setMessage("本卷已有作答结果，请先保存结果后再刷新组卷。");
      return;
    }
    const refreshed = generateWeightedPaper(
      snapshot.questions,
      paperSpecFromDraftRecipe(recipe),
    );
    if (refreshed.length === 0) {
      setMessage("当前题库和原组卷条件下没有可用题目，暂未刷新。");
      return;
    }
    setPaperQuestions(refreshed);
    setResults({});
    setRecordedResults({});
    setSelectedQuestionType("all");
    savePaperDraft({
      questionIds: refreshed.map((question) => question.id),
      recipe,
      savedAt: Date.now(),
    });
    setMessage("已按上次组卷规则刷新题目。");
  };
  return (
    <EditorDialog
      title="本次练习卷"
      description={`${paperQuestions.length} 道题；做题时可以直接校正卡片，保存结果后会更新题库状态和错题队列。`}
      dirty={!paperResultsEqual(results, recordedResults)}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      closeDisabled={busy}
      size="review"
    >
      <div className="generated-paper">
        <div className="generated-paper-toolbar">
          <div>
            <strong>本卷已自动暂存</strong>
            <span>
              已登记 {Object.keys(results).length} / {paperQuestions.length}{" "}
              道；保存记录可继续，提交组卷后结束
            </span>
          </div>
          <div className="generated-paper-toolbar-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={persistPaperDraft}
            >
              暂存本卷
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={recipe === undefined}
              onClick={refreshGeneratedPaper}
            >
              刷新组卷
            </button>
          </div>
        </div>
        <nav className="generated-paper-nav" aria-label="练习卷题型导航">
          {PAPER_TYPE_NAV.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={
                selectedQuestionType === filter.value ? "is-active" : undefined
              }
              role="tab"
              aria-selected={selectedQuestionType === filter.value}
              aria-controls="generated-paper-list"
              onClick={() => setSelectedQuestionType(filter.value)}
            >
              {filter.label}
              <span>{questionTypeCounts[filter.value]}</span>
            </button>
          ))}
        </nav>
        <div
          id="generated-paper-list"
          role="tabpanel"
          aria-label={
            selectedQuestionType === "all"
              ? "全部题目"
              : typeLabel(selectedQuestionType)
          }
        >
          {visiblePaperQuestions.length === 0 ? (
            <div className="generated-paper-empty">当前题型暂无题目。</div>
          ) : (
            renderPaperQuestions(
              visiblePaperQuestions,
              results,
              (questionId, result) =>
                setResults((current) => ({
                  ...current,
                  [questionId]: result,
                })),
              setAdjustingQuestionId,
              setEditingQuestionId,
            )
          )}
        </div>
        {message === "" ? null : (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <EditorDialogFooter className="editor-actions question-bank-dialog-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void saveProgress()}
          >
            {busy ? "正在保存…" : "保存记录"}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void submitPaper()}
          >
            {busy ? "正在提交…" : "提交组卷"}
          </button>
        </EditorDialogFooter>
      </div>
    </EditorDialog>
  );
}

function renderPaperQuestions(
  paperQuestions: readonly IndexedQuestion[],
  results: Readonly<Record<string, AttemptResult>>,
  onResult: (questionId: string, result: AttemptResult) => void,
  onAdjust: (questionId: string) => void,
  onEdit: (questionId: string) => void,
) {
  let previousQuestionType: QuestionType | undefined;
  return paperQuestions.map((question, index) => {
    const startsSection = question.questionType !== previousQuestionType;
    previousQuestionType = question.questionType;
    return (
      <Fragment key={question.id}>
        {startsSection ? (
          <div className="generated-paper-section-heading">
            <h3>{paperSectionHeading(question.questionType)}</h3>
          </div>
        ) : null}
        <article className="generated-paper-question question-bank-paper-card">
          <header>
            <div>
              <span>第 {index + 1} 题</span>
              <h3>
                {question.subjectName} · {question.chapter}
              </h3>
            </div>
            <div className="generated-paper-question-tools">
              <small>
                {question.workbookName} / {partLabel(question.sectionPart)} /{" "}
                {typeLabel(question.questionType)} / 原题号{" "}
                {question.questionNumber}
              </small>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onAdjust(question.id)}
                >
                  校正区域
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onEdit(question.id)}
                >
                  编辑题目
                </button>
              </div>
            </div>
          </header>
          <QuestionRegionCard
            documentId={question.documentId}
            title={question.title}
            regions={question.regions}
          />
          <div
            className="paper-result-buttons"
            role="group"
            aria-label={`第 ${index + 1} 题结果`}
          >
            {PAPER_RESULT_OPTIONS.map((result) => (
              <button
                key={result}
                type="button"
                className={
                  results[question.id] === result
                    ? `paper-result-${result} paper-result-active`
                    : `paper-result-${result}`
                }
                aria-pressed={results[question.id] === result}
                onClick={() => onResult(question.id, result)}
              >
                {attemptLabel(result)}
              </button>
            ))}
          </div>
        </article>
      </Fragment>
    );
  });
}

function paperResultEntries(
  results: Readonly<Record<string, AttemptResult>>,
  recordedResults: Readonly<Record<string, AttemptResult>>,
): Array<{ questionId: string; result: AttemptResult }> {
  return Object.entries(results).flatMap(([questionId, result]) =>
    recordedResults[questionId] === result ? [] : [{ questionId, result }],
  );
}

function paperResultsEqual(
  left: Readonly<Record<string, AttemptResult>>,
  right: Readonly<Record<string, AttemptResult>>,
): boolean {
  const leftEntries = Object.entries(left);
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([questionId, result]) => right[questionId] === result)
  );
}

const PAPER_RESULT_OPTIONS: readonly AttemptResult[] = [
  "correct",
  "uncertain",
  "incorrect",
];

type PaperQuestionFilter = "all" | QuestionType;

const PAPER_TYPE_NAV: readonly {
  value: PaperQuestionFilter;
  label: string;
}[] = [
  { value: "all", label: "全部" },
  { value: "choice", label: "选择题" },
  { value: "blank", label: "填空题" },
  { value: "solution", label: "解答题" },
];

function paperSectionHeading(questionType: QuestionType): string {
  const ordinal: Record<QuestionType, string> = {
    choice: "一",
    blank: "二",
    solution: "三",
    other: "四",
  };
  return `${ordinal[questionType]}、${typeLabel(questionType)}`;
}

const MAX_PAPER_SCOPE_GROUPS = 5;

function defaultPaperTypeQuotas(): PaperTypeQuotas {
  return { choice: 10, blank: 6, solution: 6 };
}

function cloneSubjectQuotas(
  quotas: ReadonlyMap<string, PaperTypeQuotas>,
): Map<string, PaperTypeQuotas> {
  return new Map(
    [...quotas].map(([subjectId, quota]) => [subjectId, { ...quota }]),
  );
}

function subjectQuotasEqual(
  left: ReadonlyMap<string, PaperTypeQuotas>,
  right: ReadonlyMap<string, PaperTypeQuotas>,
): boolean {
  return (
    left.size === right.size &&
    [...left].every(([subjectId, quota]) => {
      const other = right.get(subjectId);
      return (
        other !== undefined &&
        quota.choice === other.choice &&
        quota.blank === other.blank &&
        quota.solution === other.solution
      );
    })
  );
}

function paperTypeQuotaTotal(quota: PaperTypeQuotas | undefined): number {
  if (quota === undefined) return 0;
  return (
    Math.max(0, quota.choice) +
    Math.max(0, quota.blank) +
    Math.max(0, quota.solution)
  );
}

function createPaperScopeGroup(index: number): PaperScopeGroup {
  return {
    id: `paper-scope-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: `范围 ${index}`,
    enabled: true,
    mode: "include",
    workbookIds: new Set(),
    chapterKeys: new Set(),
    sectionParts: new Set(),
    questionTypes: new Set(),
  };
}

function clonePaperScopeGroups(
  groups: readonly PaperScopeGroup[],
): PaperScopeGroup[] {
  return groups.map((group) => ({
    ...group,
    workbookIds: new Set(group.workbookIds),
    chapterKeys: new Set(group.chapterKeys),
    sectionParts: new Set(group.sectionParts),
    questionTypes: new Set(group.questionTypes),
  }));
}

function paperScopeGroupsEqual(
  left: readonly PaperScopeGroup[],
  right: readonly PaperScopeGroup[],
): boolean {
  return (
    left.length === right.length &&
    left.every((group, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        group.id === other.id &&
        group.name === other.name &&
        group.enabled === other.enabled &&
        group.mode === other.mode &&
        setsEqual(group.workbookIds, other.workbookIds) &&
        setsEqual(group.chapterKeys, other.chapterKeys) &&
        setsEqual(group.sectionParts, other.sectionParts) &&
        setsEqual(group.questionTypes, other.questionTypes)
      );
    })
  );
}

export function PaperScopeFilters({
  questions,
  value,
  onChange,
}: {
  questions: readonly IndexedQuestion[];
  value: readonly PaperScopeGroup[];
  onChange(value: PaperScopeGroup[]): void;
}) {
  const updateGroup = (id: string, patch: Partial<PaperScopeGroup>) =>
    onChange(
      value.map((group) => (group.id === id ? { ...group, ...patch } : group)),
    );
  const addGroup = () => {
    if (value.length >= MAX_PAPER_SCOPE_GROUPS) return;
    onChange([...value, createPaperScopeGroup(value.length + 1)]);
  };
  const duplicateGroup = (source: PaperScopeGroup) => {
    if (value.length >= MAX_PAPER_SCOPE_GROUPS) return;
    const copy = createPaperScopeGroup(value.length + 1);
    onChange([
      ...value,
      {
        ...copy,
        name: `${source.name} 副本`,
        enabled: source.enabled,
        mode: source.mode,
        workbookIds: new Set(source.workbookIds),
        chapterKeys: new Set(source.chapterKeys),
        sectionParts: new Set(source.sectionParts),
        questionTypes: new Set(source.questionTypes),
      },
    ]);
  };
  const removeGroup = (id: string) =>
    onChange(value.filter((group) => group.id !== id));
  const scopedCount = questionsInPaperScopeGroups(questions, value).length;

  return (
    <section
      className="paper-scope-filters"
      aria-labelledby="paper-scope-title"
    >
      <div className="paper-scope-heading">
        <div>
          <h3 id="paper-scope-title">组卷范围</h3>
          <p>
            组内条件取交集，包含组间取并集，排除组优先；每个字段选择“全部”表示不限制。
          </p>
        </div>
        <div className="paper-scope-summary" role="status" aria-live="polite">
          {value.length === 0
            ? `全部科目 · ${scopedCount} 道题`
            : `${value.length}/${MAX_PAPER_SCOPE_GROUPS} 个范围组 · 合并 ${scopedCount} 道题`}
        </div>
      </div>
      {value.length === 0 ? (
        <div className="paper-scope-empty">
          未设置范围组，将从已选科目的全部题目中抽取。
        </div>
      ) : (
        <div className="paper-scope-group-list">
          {value.map((group, index) => {
            const groupCount = questionsInPaperScope(questions, group).length;
            const workbookOptions = paperScopeOptions(
              questions,
              group,
              "workbookIds",
            );
            const chapterOptions = paperScopeOptions(
              questions,
              group,
              "chapterKeys",
            );
            const sectionPartOptions = paperScopeOptions(
              questions,
              group,
              "sectionParts",
            );
            const questionTypeOptions = paperScopeOptions(
              questions,
              group,
              "questionTypes",
            );
            return (
              <fieldset
                className={`paper-scope-group${group.enabled ? "" : " is-disabled"}`}
                key={group.id}
              >
                <legend className="sr-only">范围 {index + 1}</legend>
                <div className="paper-scope-group-heading">
                  <label className="paper-scope-group-name">
                    <span>范围 {index + 1}</span>
                    <input
                      value={group.name}
                      maxLength={30}
                      onChange={(event) =>
                        updateGroup(group.id, { name: event.target.value })
                      }
                    />
                  </label>
                  <div className="paper-scope-group-actions">
                    <label className="paper-scope-mode">
                      <span>操作</span>
                      <select
                        value={group.mode}
                        onChange={(event) =>
                          updateGroup(group.id, {
                            mode: event.target.value as PaperScopeGroup["mode"],
                          })
                        }
                      >
                        <option value="include">包含</option>
                        <option value="exclude">排除</option>
                      </select>
                    </label>
                    <label className="paper-scope-enabled">
                      <input
                        type="checkbox"
                        checked={group.enabled}
                        onChange={(event) =>
                          updateGroup(group.id, {
                            enabled: event.target.checked,
                          })
                        }
                      />
                      启用
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={value.length >= MAX_PAPER_SCOPE_GROUPS}
                      onClick={() => duplicateGroup(group)}
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => removeGroup(group.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
                <div className="paper-scope-group-options">
                  <PaperScopeMultiChoice
                    label="练习册"
                    options={workbookOptions}
                    selected={group.workbookIds}
                    disabled={!group.enabled}
                    onChange={(next) =>
                      updateGroup(group.id, { workbookIds: next })
                    }
                  />
                  <PaperScopeMultiChoice
                    label="章节"
                    singleColumn
                    options={chapterOptions}
                    selected={group.chapterKeys}
                    disabled={!group.enabled}
                    onChange={(next) =>
                      updateGroup(group.id, { chapterKeys: next })
                    }
                  />
                  <PaperScopeMultiChoice
                    label="篇章"
                    options={sectionPartOptions}
                    selected={group.sectionParts}
                    disabled={!group.enabled}
                    onChange={(next) =>
                      updateGroup(group.id, {
                        sectionParts: next as Set<SectionPart>,
                      })
                    }
                  />
                  <PaperScopeMultiChoice
                    label="题型"
                    options={questionTypeOptions}
                    selected={group.questionTypes}
                    disabled={!group.enabled}
                    onChange={(next) =>
                      updateGroup(group.id, {
                        questionTypes: next as Set<QuestionType>,
                      })
                    }
                  />
                </div>
                <p className="paper-scope-group-count">
                  {group.mode === "exclude" ? "将排除 " : "当前范围匹配 "}
                  {groupCount} 道题
                </p>
              </fieldset>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="secondary-button paper-scope-add"
        disabled={value.length >= MAX_PAPER_SCOPE_GROUPS}
        onClick={addGroup}
      >
        添加范围组
      </button>
    </section>
  );
}

type PaperScopeOptionField =
  "workbookIds" | "chapterKeys" | "sectionParts" | "questionTypes";

function paperScopeOptions(
  questions: readonly IndexedQuestion[],
  group: PaperScopeGroup,
  field: PaperScopeOptionField,
): Array<{ value: string; label: string; stale?: boolean }> {
  const matchingQuestions = questions.filter((question) =>
    matchesPaperScopeExcept(question, group, field),
  );
  const allOptions = paperScopeOptionsFromQuestions(questions, field);
  const availableOptions = paperScopeOptionsFromQuestions(
    matchingQuestions,
    field,
  );
  const availableValues = new Set(
    availableOptions.map((option) => option.value),
  );
  const selectedValues = group[field];
  const staleOptions = [...selectedValues]
    .filter((value) => !availableValues.has(value))
    .map((value) => ({
      value,
      label:
        allOptions.find((option) => option.value === value)?.label ??
        `${value}（当前选择但无匹配）`,
      stale: true,
    }));
  return [...availableOptions, ...staleOptions];
}

function matchesPaperScopeExcept(
  question: IndexedQuestion,
  group: PaperScopeGroup,
  excludedField: PaperScopeOptionField,
): boolean {
  const chapterKey = paperChapterKey(question.workbookId, question.chapter);
  return (
    (excludedField === "workbookIds" ||
      group.workbookIds.size === 0 ||
      group.workbookIds.has(question.workbookId)) &&
    (excludedField === "chapterKeys" ||
      group.chapterKeys.size === 0 ||
      group.chapterKeys.has(chapterKey)) &&
    (excludedField === "sectionParts" ||
      group.sectionParts.size === 0 ||
      group.sectionParts.has(question.sectionPart)) &&
    (excludedField === "questionTypes" ||
      group.questionTypes.size === 0 ||
      group.questionTypes.has(question.questionType))
  );
}

function paperScopeOptionsFromQuestions(
  questions: readonly IndexedQuestion[],
  field: PaperScopeOptionField,
): Array<{ value: string; label: string }> {
  if (field === "workbookIds") {
    return uniqueBy(questions, (question) => question.workbookId).map(
      (question) => ({
        value: question.workbookId,
        label: question.workbookName,
      }),
    );
  }
  if (field === "chapterKeys") {
    return uniqueBy(questions, (question) =>
      paperChapterKey(question.workbookId, question.chapter),
    ).map((question) => ({
      value: paperChapterKey(question.workbookId, question.chapter),
      label: `${question.workbookName} · ${question.chapter}`,
    }));
  }
  if (field === "sectionParts") {
    const available = new Set(
      questions.map((question) => question.sectionPart),
    );
    return PART_OPTIONS.filter((option) => available.has(option.value));
  }
  const available = new Set(questions.map((question) => question.questionType));
  return TYPE_OPTIONS.filter((option) => available.has(option.value));
}

function PaperScopeMultiChoice({
  label,
  singleColumn = false,
  options,
  selected,
  disabled,
  onChange,
}: {
  label: string;
  singleColumn?: boolean;
  options: ReadonlyArray<{
    value: string;
    label: string;
    stale?: boolean;
  }>;
  selected: ReadonlySet<string>;
  disabled: boolean;
  onChange(value: Set<string>): void;
}) {
  return (
    <div className="paper-scope-choice" aria-disabled={disabled}>
      <strong>{label}</strong>
      <label className="paper-scope-all">
        <input
          type="checkbox"
          checked={selected.size === 0}
          disabled={disabled}
          onChange={(event) => {
            if (event.target.checked) onChange(new Set());
          }}
        />
        全部
      </label>
      <div
        className={`paper-scope-options${singleColumn ? " is-single-column" : ""}`}
      >
        {options.length === 0 ? (
          <span className="paper-scope-no-options">暂无可选项</span>
        ) : (
          options.map((option) => (
            <label
              key={option.value}
              className={`paper-scope-option${option.stale ? " is-stale" : ""}`}
            >
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.has(option.value)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (selected.size === 0 && event.target.checked) {
                    next.add(option.value);
                  } else if (event.target.checked) {
                    next.add(option.value);
                  } else {
                    next.delete(option.value);
                  }
                  onChange(next);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))
        )}
      </div>
    </div>
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

function setsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function attemptLabel(value: AttemptResult): string {
  return { correct: "做对", uncertain: "不全对", incorrect: "做错" }[value];
}
