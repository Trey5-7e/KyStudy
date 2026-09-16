import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import { Button } from "../../shared/ui/Button";
import {
  clearQuestionAttempts,
  normalizeQuestionBankError,
  recordBulkQuestionAttempts,
  type BulkQuestionAttempt,
  type IndexedQuestion,
  type QuestionBankSnapshot,
  type SectionPart,
} from "../../shared/tauri/questionBankClient";
import { localDateForTimezone } from "../../shared/tauri/scheduleClient";
import { questionsInScope, type QuestionScope } from "./questionBankModel";
import type { QuestionType } from "../../shared/tauri/questionClient";
import { completeScope, QuestionScopeFilters } from "./QuestionIndexDialogs";
import {
  compareMatrixQuestions,
  groupQuestionsByPartAndType,
  markAllQuestionsInGroup,
  matrixCellStatus,
  setQuestionStagedResult,
  setQuestionTag,
  toggleQuestionStagedResult,
  toggleQuestionTag,
  ATTEMPT_MODE_OPTIONS,
  TAG_MODE_OPTIONS,
  type AttemptMode,
  type MatrixAction,
  type MatrixMode,
  type StagedAttempts,
} from "./quickRecordModel";
import {
  loadAllQuestionTags,
  saveAllQuestionTags,
  MISTAKE_TAGS_CHANGED_EVENT,
} from "../review/mistakeTagModel";

export interface QuickRecordSaveOptions {
  close?: boolean;
}

export function QuickRecordDialog({
  questions,
  initialScope,
  timezone,
  onClose,
  onRequestBack,
  backLabel,
  onSaved,
}: {
  questions: IndexedQuestion[];
  initialScope?: Partial<QuestionScope>;
  timezone: string;
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onSaved(
    snapshot: QuestionBankSnapshot,
    options?: QuickRecordSaveOptions,
  ): void;
}) {
  const [scope, setScope] = useState<QuestionScope>(() =>
    completeScope(questions, initialScope ?? {}, {
      requirePartsAndTypes: false,
    }),
  );
  const [stagedAttempts, setStagedAttempts] = useState<StagedAttempts>({});
  const [matrixMode, setMatrixMode] = useState<MatrixMode>("correct");
  const [tagsMap, setTagsMap] = useState<Record<string, string[]>>(() =>
    loadAllQuestionTags(),
  );
  const [message, setMessage] = useState("");
  const [successNotice, setSuccessNotice] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const draggingRef = useRef(false);
  const draggingActionRef = useRef<MatrixAction | null>(null);
  const draggingTagActionRef = useRef<boolean | null>(null);

  useEffect(() => {
    const handleTagsChanged = () => {
      setTagsMap(loadAllQuestionTags());
    };
    window.addEventListener(MISTAKE_TAGS_CHANGED_EVENT, handleTagsChanged);
    return () => {
      window.removeEventListener(MISTAKE_TAGS_CHANGED_EVENT, handleTagsChanged);
    };
  }, []);

  const workbookQuestions = useMemo(
    () =>
      questions.filter(
        (q) =>
          (scope.subjectId === undefined || q.subjectId === scope.subjectId) &&
          (scope.workbookId === undefined || q.workbookId === scope.workbookId),
      ),
    [questions, scope.subjectId, scope.workbookId],
  );

  const chapters = useMemo(
    () => [...new Set(workbookQuestions.map((q) => q.chapter))],
    [workbookQuestions],
  );

  const chapterIndex = useMemo(
    () => (scope.chapter ? chapters.indexOf(scope.chapter) : -1),
    [chapters, scope.chapter],
  );

  const prevChapter = chapterIndex > 0 ? chapters[chapterIndex - 1] : undefined;
  const nextChapter =
    chapterIndex >= 0 && chapterIndex < chapters.length - 1
      ? chapters[chapterIndex + 1]
      : undefined;

  const chapterQuestions = useMemo(
    () => workbookQuestions.filter((q) => q.chapter === scope.chapter),
    [workbookQuestions, scope.chapter],
  );

  const chapterGroups = useMemo(
    () => groupQuestionsByPartAndType(chapterQuestions),
    [chapterQuestions],
  );

  const isWholeChapter =
    scope.sectionPart === undefined && scope.questionType === undefined;

  const currentGroupIndex = useMemo(() => {
    if (isWholeChapter) return -1;
    return chapterGroups.findIndex(
      (g) =>
        (scope.sectionPart === undefined ||
          g.sectionPart === scope.sectionPart) &&
        (scope.questionType === undefined ||
          g.questionType === scope.questionType),
    );
  }, [chapterGroups, isWholeChapter, scope.questionType, scope.sectionPart]);

  const currentGroup =
    currentGroupIndex >= 0 ? chapterGroups[currentGroupIndex] : undefined;
  const prevGroup =
    currentGroupIndex > 0 ? chapterGroups[currentGroupIndex - 1] : undefined;
  const nextGroup =
    currentGroupIndex >= 0 && currentGroupIndex < chapterGroups.length - 1
      ? chapterGroups[currentGroupIndex + 1]
      : undefined;

  const scoped = useMemo(
    () => questionsInScope(questions, scope),
    [questions, scope],
  );

  const matrixQuestions = useMemo(
    () => [...scoped].sort(compareMatrixQuestions),
    [scoped],
  );

  const stagedCount = Object.keys(stagedAttempts).length;
  const hasUnsavedChanges = stagedCount > 0;

  const savedCountInScope = useMemo(
    () => matrixQuestions.filter((q) => q.currentResult !== undefined).length,
    [matrixQuestions],
  );

  const stagedCountInScope = useMemo(
    () =>
      matrixQuestions.filter((q) => stagedAttempts[q.id] !== undefined).length,
    [matrixQuestions, stagedAttempts],
  );

  useEffect(() => {
    const stopDragging = () => {
      draggingRef.current = false;
      draggingActionRef.current = null;
      draggingTagActionRef.current = null;
    };
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  const applyMatrixAction = (
    question: IndexedQuestion,
    action: MatrixAction,
  ) => {
    setSuccessNotice("");
    setMessage("");
    setStagedAttempts((current) => {
      if (action === "clear" || action === "unattempted") {
        return question.currentResult !== undefined
          ? setQuestionStagedResult(current, question.id, "unattempted")
          : setQuestionStagedResult(current, question.id, "clear");
      }
      return setQuestionStagedResult(current, question.id, action);
    });
  };

  const toggleMatrixSelection = (question: IndexedQuestion) => {
    setSuccessNotice("");
    setMessage("");
    if (matrixMode === "must_do" || matrixMode === "optional_do") {
      const tagLabel = matrixMode === "must_do" ? "必做" : "选做";
      const nextTagsMap = toggleQuestionTag(tagsMap, question.id, tagLabel);
      setTagsMap(nextTagsMap);
      saveAllQuestionTags(nextTagsMap);
      return;
    }
    setStagedAttempts((current) =>
      toggleQuestionStagedResult(current, question, matrixMode as AttemptMode),
    );
  };

  const handleMatrixPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    question: IndexedQuestion,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingRef.current = true;

    if (matrixMode === "must_do" || matrixMode === "optional_do") {
      const tagLabel = matrixMode === "must_do" ? "必做" : "选做";
      const hasTag = (tagsMap[question.id] ?? []).includes(tagLabel);
      const targetAdd = !hasTag;
      draggingTagActionRef.current = targetAdd;
      const nextTagsMap = setQuestionTag(
        tagsMap,
        question.id,
        tagLabel,
        targetAdd,
      );
      setTagsMap(nextTagsMap);
      saveAllQuestionTags(nextTagsMap);
      return;
    }

    const { effectiveStatus } = matrixCellStatus(
      question,
      stagedAttempts[question.id],
    );
    let action: MatrixAction;
    if (matrixMode === "unattempted") {
      action = "unattempted";
    } else if (effectiveStatus === matrixMode) {
      action = "unattempted";
    } else {
      action = matrixMode;
    }
    draggingActionRef.current = action;
    applyMatrixAction(question, action);
  };

  const handleMarkGroup = (
    groupQuestions: readonly IndexedQuestion[],
    action: MatrixAction,
  ) => {
    setSuccessNotice("");
    setMessage("");
    setStagedAttempts((current) => {
      let next = { ...current };
      if (action === "clear") {
        for (const q of groupQuestions) {
          delete next[q.id];
        }
      } else if (action === "unattempted") {
        for (const q of groupQuestions) {
          if (q.currentResult !== undefined) {
            next[q.id] = "unattempted";
          } else {
            delete next[q.id];
          }
        }
      } else {
        next = markAllQuestionsInGroup(next, groupQuestions, action);
      }
      return next;
    });
  };

  const handleSwitchChapter = (targetChapter: string) => {
    if (hasUnsavedChanges) {
      setMessage(
        `当前章节有未保存的标记（共 ${stagedCount} 题），请先保存再切换章节。`,
      );
      return;
    }
    setScope((prev) => ({
      ...prev,
      chapter: targetChapter,
      sectionPart: undefined,
      questionType: undefined,
    }));
    setSuccessNotice("");
    setMessage("");
  };

  const handleSwitchGroup = (part?: SectionPart, qType?: QuestionType) => {
    const nextScope: QuestionScope = {
      ...scope,
      sectionPart: part,
      questionType: qType,
    };
    setScope(nextScope);
    setSuccessNotice("");
    setMessage("");
  };

  const executeSave = async (
    target: "exit" | "continue" | "next-group" | "next-chapter",
  ) => {
    setMessage("");
    setSuccessNotice("");
    try {
      const attemptsToRecord: BulkQuestionAttempt[] = [];
      const questionsToClear: string[] = [];

      for (const [questionId, result] of Object.entries(stagedAttempts)) {
        if (result === "unattempted") {
          questionsToClear.push(questionId);
        } else {
          attemptsToRecord.push({ questionId, result });
        }
      }

      if (attemptsToRecord.length === 0 && questionsToClear.length === 0) {
        setMessage("至少标记一道题号（点击或拖动题号矩阵）。");
        return;
      }

      setBusy(true);
      let nextSnapshot: QuestionBankSnapshot | undefined;

      if (attemptsToRecord.length > 0) {
        nextSnapshot = await recordBulkQuestionAttempts(
          localDateForTimezone(new Date(), timezone),
          attemptsToRecord,
        );
      }
      if (questionsToClear.length > 0) {
        nextSnapshot = await clearQuestionAttempts(questionsToClear);
      }

      const totalCount = attemptsToRecord.length + questionsToClear.length;
      setSavedCount((prev) => prev + totalCount);
      setStagedAttempts({});

      if (!nextSnapshot) return;

      if (target === "exit") {
        onSaved(nextSnapshot, { close: true });
      } else if (target === "continue") {
        onSaved(nextSnapshot, { close: false });
        setSuccessNotice(
          `已成功保存 ${totalCount} 道题的练习记录！可继续选择题号或切换范围继续登记。`,
        );
      } else if (target === "next-group" && nextGroup) {
        onSaved(nextSnapshot, { close: false });
        setScope((prev) => ({
          ...prev,
          sectionPart: nextGroup.sectionPart,
          questionType: nextGroup.questionType,
        }));
        setSuccessNotice(
          `已成功保存 ${totalCount} 道题，已自动进入下一组：${nextGroup.label}`,
        );
      } else if (target === "next-chapter" && nextChapter) {
        onSaved(nextSnapshot, { close: false });
        setScope((prev) => ({
          ...prev,
          chapter: nextChapter,
          sectionPart: undefined,
          questionType: undefined,
        }));
        setSuccessNotice(
          `已成功保存本章 ${totalCount} 道题，已自动进入下一章：${nextChapter}`,
        );
      } else {
        onSaved(nextSnapshot, { close: false });
        setSuccessNotice(`已成功保存 ${totalCount} 道题的练习记录！`);
      }
    } catch (error: unknown) {
      const normalized = normalizeQuestionBankError(error);
      setMessage(`${normalized.message} ${normalized.action}`.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorDialog
      title="快速登记做题"
      description="点击或拖动题号矩阵快速登记作答结果，或切换至重点标签为题目打标。"
      dirty={hasUnsavedChanges}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      closeDisabled={busy}
      size="large"
    >
      <form
        className="editor-form quick-record-form"
        onSubmit={(event) => {
          event.preventDefault();
          void executeSave("exit");
        }}
      >
        <QuestionScopeFilters
          questions={questions}
          value={scope}
          onChange={(value) => {
            const nextScope = completeScope(questions, value, {
              requirePartsAndTypes: false,
            });
            setScope(nextScope);
            setSuccessNotice("");
            setMessage("");
          }}
          allowAll="parts-and-types"
        />
        {chapters.length > 1 && scope.chapter ? (
          <div className="quick-record-chapter-nav">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!prevChapter}
              onClick={() => prevChapter && handleSwitchChapter(prevChapter)}
              title={prevChapter ? `上一章：${prevChapter}` : "已是第一章"}
            >
              ◀ 上一章
            </Button>
            <span className="quick-record-chapter-nav-title">
              {scope.chapter}（第 {chapterIndex + 1} / {chapters.length} 章）
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!nextChapter}
              onClick={() => nextChapter && handleSwitchChapter(nextChapter)}
              title={nextChapter ? `下一章：${nextChapter}` : "已是最后一章"}
            >
              下一章 ▶
            </Button>
          </div>
        ) : null}
        <p className="form-hint" id="quick-record-save-reason">
          {isWholeChapter
            ? `当前整章共找到 ${scoped.length} 道题（包含 ${chapterGroups.length} 个题型分组）。可在下方整章矩阵直接点击或滑动登记，点击已标记题号可重置为未做。`
            : `当前分组找到 ${scoped.length} 道题。可点击或滑动题号标记，也可切换重点题标签。`}
        </p>

        {chapterGroups.length > 1 ? (
          <div className="quick-record-nav-bar">
            <div className="quick-record-group-tabs-scroll">
              <div
                className="quick-record-group-tabs"
                role="tablist"
                aria-label="题号分组"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isWholeChapter}
                  className={
                    "quick-record-group-tab" +
                    (isWholeChapter ? " is-active" : "")
                  }
                  onClick={() => handleSwitchGroup(undefined, undefined)}
                >
                  📋 整章总览 ({chapterQuestions.length})
                </button>
                {chapterGroups.map((group) => {
                  const isCurrent =
                    scope.sectionPart === group.sectionPart &&
                    scope.questionType === group.questionType;
                  return (
                    <button
                      key={group.key}
                      type="button"
                      role="tab"
                      aria-selected={isCurrent}
                      className={
                        "quick-record-group-tab" +
                        (isCurrent ? " is-active" : "")
                      }
                      onClick={() =>
                        handleSwitchGroup(group.sectionPart, group.questionType)
                      }
                    >
                      {group.label} ({group.questions.length})
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="quick-record-page-buttons">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!prevGroup && !isWholeChapter}
                onClick={() => {
                  if (isWholeChapter) {
                    const last = chapterGroups[chapterGroups.length - 1];
                    if (last)
                      handleSwitchGroup(last.sectionPart, last.questionType);
                  } else if (prevGroup) {
                    handleSwitchGroup(
                      prevGroup.sectionPart,
                      prevGroup.questionType,
                    );
                  }
                }}
                title={prevGroup ? `上一组：${prevGroup.label}` : "上一组"}
              >
                ◀ 上一组
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={
                  !nextGroup && (!isWholeChapter || chapterGroups.length === 0)
                }
                onClick={() => {
                  if (isWholeChapter) {
                    const first = chapterGroups[0];
                    if (first)
                      handleSwitchGroup(first.sectionPart, first.questionType);
                  } else if (nextGroup) {
                    handleSwitchGroup(
                      nextGroup.sectionPart,
                      nextGroup.questionType,
                    );
                  }
                }}
                title={nextGroup ? `下一组：${nextGroup.label}` : "下一组"}
              >
                下一组 ▶
              </Button>
            </div>
          </div>
        ) : null}

        {scoped.length === 0 ? null : (
          <section
            className="quick-record-matrix"
            aria-labelledby="quick-record-matrix-title"
          >
            <div className="quick-record-matrix-toolbar">
              <div>
                <h3 id="quick-record-matrix-title">
                  {isWholeChapter ? "整章题号矩阵" : "题号矩阵"}
                </h3>
                <p aria-live="polite">
                  本次标记 {stagedCount} 题
                  {savedCountInScope > 0
                    ? `（范围已有记录 ${savedCountInScope} / ${scoped.length} 题）`
                    : `（共 ${scoped.length} 题）`}
                  。选择标记后，可点击或拖动批量标记；点击已标记题号可直接重置为未做。
                </p>
              </div>
              <div
                className="quick-record-matrix-modes"
                role="group"
                aria-label="题号标记与标签"
              >
                <div
                  className="quick-record-mode-group"
                  role="group"
                  aria-label="作答标记"
                >
                  {ATTEMPT_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={
                        "quick-record-matrix-mode quick-record-matrix-mode-" +
                        option.value +
                        (matrixMode === option.value ? " is-active" : "")
                      }
                      aria-pressed={matrixMode === option.value}
                      onClick={() => setMatrixMode(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="quick-record-mode-divider" aria-hidden="true" />
                <div
                  className="quick-record-mode-group"
                  role="group"
                  aria-label="重点标签"
                >
                  {TAG_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={
                        "quick-record-matrix-mode quick-record-matrix-mode-" +
                        option.value +
                        (matrixMode === option.value ? " is-active" : "")
                      }
                      aria-pressed={matrixMode === option.value}
                      onClick={() => setMatrixMode(option.value)}
                      title={`批量为题目打上或取消【${option.tagLabel}】标签`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {isWholeChapter && chapterGroups.length > 1 ? (
              <div className="quick-record-groups-container">
                {chapterGroups.map((group) => {
                  const groupSaved = group.questions.filter(
                    (q) => q.currentResult !== undefined,
                  ).length;
                  const groupStaged = group.questions.filter(
                    (q) => stagedAttempts[q.id] !== undefined,
                  ).length;
                  return (
                    <section
                      key={group.key}
                      className="quick-record-group-section"
                      aria-label={group.label}
                    >
                      <div className="quick-record-group-header">
                        <div className="quick-record-group-title-wrap">
                          <h4 className="quick-record-group-title">
                            {group.label}
                          </h4>
                          <span className="quick-record-group-badge">
                            共 {group.questions.length} 题
                            {groupSaved > 0 ? ` · 已记录 ${groupSaved} 题` : ""}
                            {groupStaged > 0
                              ? ` · 本次标记 ${groupStaged} 题`
                              : ""}
                          </span>
                        </div>
                        <div className="quick-record-group-actions">
                          <button
                            type="button"
                            className="quick-record-group-btn"
                            onClick={() =>
                              handleMarkGroup(group.questions, "correct")
                            }
                            title="将本组所有题号标记为做对"
                          >
                            本组全对
                          </button>
                          <button
                            type="button"
                            className="quick-record-group-btn quick-record-group-btn-clear"
                            onClick={() =>
                              handleMarkGroup(group.questions, "clear")
                            }
                            title="清除本组本次的所有标记"
                          >
                            清除本组
                          </button>
                        </div>
                      </div>
                      <div
                        className="quick-record-number-grid"
                        role="group"
                        aria-label={group.label}
                      >
                        {group.questions.map((question) => {
                          const {
                            effectiveStatus,
                            isStaged,
                            hasSavedStatus,
                            label,
                          } = matrixCellStatus(
                            question,
                            stagedAttempts[question.id],
                          );
                          const qTags = tagsMap[question.id] ?? [];
                          const hasMustDo = qTags.includes("必做");
                          const hasOptionalDo = qTags.includes("选做");
                          const cellTitle = `${label}${hasMustDo ? " · 【必做】" : hasOptionalDo ? " · 【选做】" : ""}`;
                          return (
                            <button
                              key={question.id}
                              type="button"
                              className={
                                "quick-record-number-cell" +
                                (effectiveStatus === undefined
                                  ? ""
                                  : " is-" + effectiveStatus) +
                                (isStaged ? " is-staged" : "") +
                                (hasSavedStatus && !isStaged
                                  ? " has-saved-status"
                                  : "")
                              }
                              aria-pressed={isStaged}
                              aria-label={cellTitle}
                              title={cellTitle}
                              onPointerDown={(event) =>
                                handleMatrixPointerDown(event, question)
                              }
                              onPointerEnter={() => {
                                if (!draggingRef.current) return;
                                if (
                                  matrixMode === "must_do" ||
                                  matrixMode === "optional_do"
                                ) {
                                  if (draggingTagActionRef.current !== null) {
                                    const tagLabel =
                                      matrixMode === "must_do"
                                        ? "必做"
                                        : "选做";
                                    const nextTagsMap = setQuestionTag(
                                      tagsMap,
                                      question.id,
                                      tagLabel,
                                      draggingTagActionRef.current,
                                    );
                                    setTagsMap(nextTagsMap);
                                    saveAllQuestionTags(nextTagsMap);
                                  }
                                  return;
                                }
                                if (draggingActionRef.current)
                                  applyMatrixAction(
                                    question,
                                    draggingActionRef.current,
                                  );
                              }}
                              onClick={(event) => {
                                if (event.detail === 0)
                                  toggleMatrixSelection(question);
                              }}
                            >
                              {hasMustDo ? (
                                <span
                                  className="quick-record-cell-badge quick-record-cell-badge-must_do"
                                  title="重点必做题"
                                >
                                  必
                                </span>
                              ) : hasOptionalDo ? (
                                <span
                                  className="quick-record-cell-badge quick-record-cell-badge-optional_do"
                                  title="拓展选做题"
                                >
                                  选
                                </span>
                              ) : null}
                              {question.questionNumber}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            ) : (
              <div className="quick-record-single-group-container">
                <div className="quick-record-group-header">
                  <div className="quick-record-group-title-wrap">
                    <h4 className="quick-record-group-title">
                      {currentGroup
                        ? currentGroup.label
                        : `${scope.chapter ?? "当前范围"}`}
                    </h4>
                    <span className="quick-record-group-badge">
                      共 {matrixQuestions.length} 题
                      {savedCountInScope > 0
                        ? ` · 已记录 ${savedCountInScope} 题`
                        : ""}
                      {stagedCountInScope > 0
                        ? ` · 本次标记 ${stagedCountInScope} 题`
                        : ""}
                    </span>
                  </div>
                  <div className="quick-record-group-actions">
                    <button
                      type="button"
                      className="quick-record-group-btn"
                      onClick={() =>
                        handleMarkGroup(matrixQuestions, "correct")
                      }
                      title="将本组所有题号标记为做对"
                    >
                      本组全对
                    </button>
                    <button
                      type="button"
                      className="quick-record-group-btn quick-record-group-btn-clear"
                      onClick={() => handleMarkGroup(matrixQuestions, "clear")}
                      title="清除本组本次的所有标记"
                    >
                      清除本组
                    </button>
                  </div>
                </div>
                <div
                  className="quick-record-number-grid"
                  role="group"
                  aria-label="可登记题号"
                >
                  {matrixQuestions.map((question) => {
                    const { effectiveStatus, isStaged, hasSavedStatus, label } =
                      matrixCellStatus(question, stagedAttempts[question.id]);
                    const qTags = tagsMap[question.id] ?? [];
                    const hasMustDo = qTags.includes("必做");
                    const hasOptionalDo = qTags.includes("选做");
                    const cellTitle = `${label}${hasMustDo ? " · 【必做】" : hasOptionalDo ? " · 【选做】" : ""}`;
                    return (
                      <button
                        key={question.id}
                        type="button"
                        className={
                          "quick-record-number-cell" +
                          (effectiveStatus === undefined
                            ? ""
                            : " is-" + effectiveStatus) +
                          (isStaged ? " is-staged" : "") +
                          (hasSavedStatus && !isStaged
                            ? " has-saved-status"
                            : "")
                        }
                        aria-pressed={isStaged}
                        aria-label={cellTitle}
                        title={cellTitle}
                        onPointerDown={(event) =>
                          handleMatrixPointerDown(event, question)
                        }
                        onPointerEnter={() => {
                          if (!draggingRef.current) return;
                          if (
                            matrixMode === "must_do" ||
                            matrixMode === "optional_do"
                          ) {
                            if (draggingTagActionRef.current !== null) {
                              const tagLabel =
                                matrixMode === "must_do" ? "必做" : "选做";
                              const nextTagsMap = setQuestionTag(
                                tagsMap,
                                question.id,
                                tagLabel,
                                draggingTagActionRef.current,
                              );
                              setTagsMap(nextTagsMap);
                              saveAllQuestionTags(nextTagsMap);
                            }
                            return;
                          }
                          if (draggingActionRef.current)
                            applyMatrixAction(
                              question,
                              draggingActionRef.current,
                            );
                        }}
                        onClick={(event) => {
                          if (event.detail === 0)
                            toggleMatrixSelection(question);
                        }}
                      >
                        {hasMustDo ? (
                          <span
                            className="quick-record-cell-badge quick-record-cell-badge-must_do"
                            title="重点必做题"
                          >
                            必
                          </span>
                        ) : hasOptionalDo ? (
                          <span
                            className="quick-record-cell-badge quick-record-cell-badge-optional_do"
                            title="拓展选做题"
                          >
                            选
                          </span>
                        ) : null}
                        {question.questionNumber}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <p className="quick-record-matrix-hint">
              未做题目显示灰色，已有做题记录显示对应状态。右上角红标表示“必做”，蓝标表示“选做”。点击或按住鼠标左键可批量拖选；再次点击同一题号可重置为未做。
            </p>
          </section>
        )}
        {message === "" ? null : (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        {successNotice === "" ? null : (
          <p className="form-success" role="status">
            {successNotice}
          </p>
        )}
        <EditorDialogFooter className="editor-actions question-bank-dialog-footer">
          <EditorDialogCloseButton className="secondary-button" disabled={busy}>
            {savedCount > 0 && !hasUnsavedChanges ? "完成" : "取消"}
          </EditorDialogCloseButton>
          {!isWholeChapter && nextGroup ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !hasUnsavedChanges}
              onClick={() => void executeSave("next-group")}
              title={`保存当前标记并自动切换至下一组：${nextGroup.label}`}
            >
              {busy ? "正在保存…" : "保存并进入下一组 ▶"}
            </Button>
          ) : nextChapter ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !hasUnsavedChanges}
              onClick={() => void executeSave("next-chapter")}
              title={`保存当前标记并自动切换至下一章：${nextChapter}`}
            >
              {busy ? "正在保存…" : "保存并进入下一章 ▶"}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            disabled={busy || scoped.length === 0 || !hasUnsavedChanges}
            onClick={() => void executeSave("continue")}
          >
            {busy ? "正在保存…" : "保存并继续登记"}
          </Button>
          <Button
            type="submit"
            variant="primary"
            aria-describedby="quick-record-save-reason"
            disabled={busy || scoped.length === 0 || !hasUnsavedChanges}
          >
            {busy ? "正在保存…" : "保存并退出"}
          </Button>
        </EditorDialogFooter>
      </form>
    </EditorDialog>
  );
}
