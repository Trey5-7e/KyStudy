import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  PageEmpty,
  PageHeader,
  PageStatus,
  PageSurface,
} from "../../shared/components/PagePrimitives";
import {
  archiveWorkbookCategory,
  deleteAllTrashedWorkbookSegments,
  deleteTrashedWorkbookSegment,
  getQuestionBank,
  listTrashedWorkbookSegments,
  normalizeQuestionBankError,
  practiceStatus,
  renameWorkbookCategory,
  restoreWorkbookSegment,
  type QuestionBankSnapshot,
  type TrashedWorkbookDocumentSegment,
  type WorkbookCategory,
  type WorkbookDocumentSegment,
} from "../../shared/tauri/questionBankClient";
import {
  listResources,
  type ResourceCommandError,
  type ResourceDocument,
} from "../../shared/tauri/resourceClient";
import {
  archiveSubject,
  listSubjects,
  normalizeScheduleCommandError,
  renameSubject,
  type StudySubject,
} from "../../shared/tauri/scheduleClient";
import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";
import { type QuestionBankToolsStatus } from "./QuestionBankToolsDialog";
import {
  managerDialogWindow,
  paperWindow,
  ROOT_WINDOW_ORIGIN,
  questionBankBackTarget,
  questionBankCloseTarget,
  questionBankWindowSegmentId,
  toolDialogWindow,
  toolWindow,
  type DialogKind,
  type QuestionBankTool,
  type QuestionBankToolsSection,
  type QuestionBankWindow,
} from "./questionBankWindowModel";

import { QuestionBankTree } from "./QuestionBankTree";
import { QuestionBankCategoryOverview } from "./QuestionBankCategoryOverview";
import { QuestionBankWindowPresenter } from "./QuestionBankWindowPresenter";
import {
  SEGMENT_TRASH_PURGE_BUSY_ID,
  segmentTrashDeleteBusyId,
} from "./QuestionBankSetupDialogs";
import { ManualIndexDialog } from "./ManualIndexDialog";
import { findSegmentRestoreConflicts } from "./questionBankModel";
import { loadPaperDraft, type PaperDraftRecipe } from "./paperSetupPreferences";
import type { QuestionBankOpenRequest } from "./questionBankWindowModel";

type QuestionBankLoadState =
  "loading" | "ready" | "refreshing" | "stale" | "error";

export function QuestionBankPanel({
  openRequest,
}: {
  openRequest?: QuestionBankOpenRequest;
}) {
  const [snapshot, setSnapshot] = useState<QuestionBankSnapshot>({
    workbooks: [],
    segments: [],
    questions: [],
  });
  const [resources, setResources] = useState<ResourceDocument[]>([]);
  const [subjects, setSubjects] = useState<StudySubject[]>([]);
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [activeWindow, setActiveWindow] = useState<QuestionBankWindow>();
  const [toolsSection, setToolsSection] =
    useState<QuestionBankToolsSection>("category");
  const [toolsRefreshBusy, setToolsRefreshBusy] = useState(false);
  const [toolsRefreshStatus, setToolsRefreshStatus] =
    useState<QuestionBankToolsStatus>();
  const [segmentManagerNotice, setSegmentManagerNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ResourceCommandError>();
  const [categoryActionBusyId, setCategoryActionBusyId] = useState<string>();
  const [categoryActionError, setCategoryActionError] = useState<string>();
  const [questionBankLoadState, setQuestionBankLoadState] =
    useState<QuestionBankLoadState>("loading");
  const [questionBankSnapshotError, setQuestionBankSnapshotError] =
    useState<ResourceCommandError>();
  const [trashedSegments, setTrashedSegments] = useState<
    TrashedWorkbookDocumentSegment[]
  >([]);
  const [segmentTrashLoaded, setSegmentTrashLoaded] = useState(false);
  const [segmentTrashLoading, setSegmentTrashLoading] = useState(true);
  const [segmentTrashError, setSegmentTrashError] =
    useState<ResourceCommandError>();
  const [segmentRestoreBusyId, setSegmentRestoreBusyId] = useState<string>();
  const [segmentRestoreError, setSegmentRestoreError] =
    useState<ResourceCommandError>();
  const segmentManagerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const segmentTrashTriggerRef = useRef<HTMLButtonElement | null>(null);
  const importTriggerRef = useRef<HTMLButtonElement | null>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const segmentTrashHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const segmentRestoreButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const segmentRestoreFocusIdRef = useRef<string | undefined>(undefined);
  const segmentPurgeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const snapshotRequestIdRef = useRef(0);
  const auxiliaryRequestIdRef = useRef(0);
  const auxiliaryRefreshSucceededRef = useRef(true);
  const refreshLifecycleIdRef = useRef(0);
  const segmentTrashRequestIdRef = useRef(0);
  const mountedRef = useRef(false);
  const questionBankHasSnapshotRef = useRef(false);
  const questionBankFocusFallbackRef = useRef<HTMLHeadingElement | null>(null);
  const handledOpenRequestRef = useRef<number | undefined>(undefined);

  const applySnapshot = useCallback(
    (next: QuestionBankSnapshot, requestId?: number): boolean => {
      if (!mountedRef.current) return false;
      if (
        requestId !== undefined &&
        requestId !== snapshotRequestIdRef.current
      ) {
        return false;
      }
      if (requestId === undefined) snapshotRequestIdRef.current += 1;
      setSnapshot(next);
      questionBankHasSnapshotRef.current = true;
      setQuestionBankSnapshotError(undefined);
      setQuestionBankLoadState("ready");
      return true;
    },
    [],
  );

  const applySnapshotUpdate = useCallback(
    (update: (current: QuestionBankSnapshot) => QuestionBankSnapshot) => {
      if (!mountedRef.current) return;
      snapshotRequestIdRef.current += 1;
      setSnapshot(update);
      questionBankHasSnapshotRef.current = true;
      setQuestionBankSnapshotError(undefined);
      setQuestionBankLoadState("ready");
    },
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      snapshotRequestIdRef.current += 1;
      auxiliaryRequestIdRef.current += 1;
      refreshLifecycleIdRef.current += 1;
      segmentTrashRequestIdRef.current += 1;
    };
  }, []);

  const refreshSnapshot = useCallback(async (): Promise<
    QuestionBankSnapshot | undefined
  > => {
    if (!mountedRef.current) return;
    const requestId = ++snapshotRequestIdRef.current;
    setQuestionBankSnapshotError(undefined);
    setQuestionBankLoadState(
      questionBankHasSnapshotRef.current ? "refreshing" : "loading",
    );
    try {
      const loadedBank = await getQuestionBank();
      if (
        !mountedRef.current ||
        requestId !== snapshotRequestIdRef.current ||
        !applySnapshot(loadedBank, requestId)
      ) {
        return;
      }
      return loadedBank;
    } catch (loadError: unknown) {
      if (!mountedRef.current || requestId !== snapshotRequestIdRef.current) {
        return;
      }
      const normalized = normalizeQuestionBankError(loadError);
      setQuestionBankSnapshotError(normalized);
      setQuestionBankLoadState(
        questionBankHasSnapshotRef.current ? "stale" : "error",
      );
    }
  }, [applySnapshot]);

  const refreshAuxiliaryData = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    const requestId = ++auxiliaryRequestIdRef.current;
    auxiliaryRefreshSucceededRef.current = true;
    try {
      const [loadedResources, loadedSubjects, workspace] = await Promise.all([
        listResources(),
        listSubjects(),
        getWorkspaceStatus(),
      ]);
      if (!mountedRef.current || requestId !== auxiliaryRequestIdRef.current) {
        return;
      }
      setResources(loadedResources);
      setSubjects(
        loadedSubjects.filter((subject) => subject.archivedAt === undefined),
      );
      setTimezone(workspace?.timezone ?? "Asia/Shanghai");
    } catch (loadError: unknown) {
      auxiliaryRefreshSucceededRef.current = false;
      if (!mountedRef.current || requestId !== auxiliaryRequestIdRef.current) {
        return;
      }
      setError(normalizeQuestionBankError(loadError));
    }
  }, []);

  const refresh = useCallback(async (): Promise<
    QuestionBankSnapshot | undefined
  > => {
    if (!mountedRef.current) return;
    const lifecycleId = ++refreshLifecycleIdRef.current;
    setError(undefined);
    const snapshotPromise = refreshSnapshot();
    const auxiliaryPromise = refreshAuxiliaryData();
    try {
      const [next] = await Promise.all([snapshotPromise, auxiliaryPromise]);
      return next;
    } finally {
      if (mountedRef.current && lifecycleId === refreshLifecycleIdRef.current) {
        setLoading(false);
      }
    }
  }, [refreshAuxiliaryData, refreshSnapshot]);

  const deleteSubject = useCallback(
    async (subject: StudySubject): Promise<void> => {
      if (
        !window.confirm(
          `删除科目“${subject.name}”？它会从整个应用的可选科目和题库中隐藏，但已有题目、任务和学习记录会保留。`,
        )
      ) {
        return;
      }
      setCategoryActionBusyId(subject.id);
      setCategoryActionError(undefined);
      try {
        await archiveSubject(subject.id);
        await refresh();
      } catch (deleteError: unknown) {
        setCategoryActionError(
          normalizeScheduleCommandError(deleteError).message,
        );
      } finally {
        setCategoryActionBusyId(undefined);
      }
    },
    [refresh],
  );

  const deleteWorkbook = useCallback(
    async (workbook: WorkbookCategory): Promise<void> => {
      if (
        !window.confirm(
          `删除练习册“${workbook.name}”？已有题目和学习记录会保留，但该练习册会从题库中隐藏。`,
        )
      ) {
        return;
      }
      setCategoryActionBusyId(workbook.id);
      setCategoryActionError(undefined);
      try {
        await archiveWorkbookCategory(workbook.id);
        await refresh();
      } catch (deleteError: unknown) {
        setCategoryActionError(normalizeQuestionBankError(deleteError).message);
      } finally {
        setCategoryActionBusyId(undefined);
      }
    },
    [refresh],
  );

  const renameSubjectCategory = useCallback(
    async (
      subject: StudySubject,
      name: string,
    ): Promise<string | undefined> => {
      setCategoryActionBusyId(subject.id);
      setCategoryActionError(undefined);
      try {
        await renameSubject(subject.id, name);
        await refresh();
        return undefined;
      } catch (renameError: unknown) {
        const message = normalizeScheduleCommandError(renameError).message;
        setCategoryActionError(message);
        return message;
      } finally {
        setCategoryActionBusyId(undefined);
      }
    },
    [refresh],
  );

  const renameWorkbookCategoryItem = useCallback(
    async (
      workbook: WorkbookCategory,
      name: string,
    ): Promise<string | undefined> => {
      setCategoryActionBusyId(workbook.id);
      setCategoryActionError(undefined);
      try {
        await renameWorkbookCategory(workbook.id, name);
        await refresh();
        return undefined;
      } catch (renameError: unknown) {
        const message = normalizeQuestionBankError(renameError).message;
        setCategoryActionError(message);
        return message;
      } finally {
        setCategoryActionBusyId(undefined);
      }
    },
    [refresh],
  );

  const refreshSegmentTrash = useCallback(
    async (options?: { restoreCompleted?: boolean }): Promise<boolean> => {
      if (!mountedRef.current) return false;
      const requestId = ++segmentTrashRequestIdRef.current;
      setSegmentTrashLoading(true);
      setSegmentTrashError(undefined);
      try {
        const next = await listTrashedWorkbookSegments();
        if (
          !mountedRef.current ||
          requestId !== segmentTrashRequestIdRef.current
        ) {
          return false;
        }
        setTrashedSegments(next);
        setSegmentTrashLoaded(true);
        setSegmentRestoreError(undefined);
        return true;
      } catch (trashError: unknown) {
        if (
          !mountedRef.current ||
          requestId !== segmentTrashRequestIdRef.current
        ) {
          return false;
        }
        const normalized = normalizeQuestionBankError(trashError);
        setSegmentTrashError({
          ...normalized,
          code: "QUESTION_BANK_SEGMENT_TRASH_REFRESH_FAILED",
          message: "分段回收站列表刷新失败。",
          action:
            options?.restoreCompleted === true
              ? "恢复操作已完成；请点击“刷新列表”重试。"
              : "请点击“刷新列表”重试。",
        });
        setSegmentTrashLoaded(true);
        return false;
      } finally {
        if (
          mountedRef.current &&
          requestId === segmentTrashRequestIdRef.current
        ) {
          setSegmentTrashLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void refreshSegmentTrash();
    });
    return () => {
      active = false;
      segmentTrashRequestIdRef.current += 1;
    };
  }, [refreshSegmentTrash]);

  useEffect(() => {
    if (
      openRequest === undefined ||
      loading ||
      handledOpenRequestRef.current === openRequest.nonce
    ) {
      return;
    }
    handledOpenRequestRef.current = openRequest.nonce;
    let active = true;

    if (openRequest.kind === "start-custom-paper") {
      const questionsById = new Map(
        snapshot.questions.map((question) => [question.id, question]),
      );
      const selectedQuestions = openRequest.questionIds.flatMap((id) => {
        const question = questionsById.get(id);
        return question === undefined ? [] : [question];
      });
      if (selectedQuestions.length > 0) {
        const nextWindow = paperWindow(selectedQuestions, ROOT_WINDOW_ORIGIN);
        void Promise.resolve().then(() => {
          if (active) setActiveWindow(nextWindow);
        });
      }
      return () => {
        active = false;
      };
    }

    if (openRequest.kind === "resume-or-create-paper") {
      const draft = loadPaperDraft();
      const questionsById = new Map(
        snapshot.questions.map((question) => [question.id, question]),
      );
      const rememberedQuestions =
        draft?.questionIds.flatMap((questionId) => {
          const question = questionsById.get(questionId);
          return question === undefined ? [] : [question];
        }) ?? [];
      const nextWindow =
        rememberedQuestions.length > 0 && draft !== undefined
          ? paperWindow(
              rememberedQuestions,
              ROOT_WINDOW_ORIGIN,
              draft.recipe,
              draft.results === undefined
                ? undefined
                : Object.fromEntries(
                    [...Object.entries(draft.results)].filter(([id]) =>
                      rememberedQuestions.some(
                        (question) => question.id === id,
                      ),
                    ),
                  ),
              draft.recordedResults === undefined
                ? undefined
                : Object.fromEntries(
                    [...Object.entries(draft.recordedResults)].filter(([id]) =>
                      rememberedQuestions.some(
                        (question) => question.id === id,
                      ),
                    ),
                  ),
              draft.view,
            )
          : {
              kind: "dialog" as const,
              dialog: "paper" as const,
              origin: ROOT_WINDOW_ORIGIN,
            };
      void Promise.resolve().then(() => {
        if (active) setActiveWindow(nextWindow);
      });
      return () => {
        active = false;
      };
    }
  }, [loading, openRequest, snapshot.questions]);

  const attemptedCount = useMemo(
    () =>
      snapshot.questions.filter(
        (question) => practiceStatus(question) !== "unattempted",
      ).length,
    [snapshot.questions],
  );
  const questionBankStats = useMemo(
    () => [
      {
        label: "科目",
        value: Math.max(
          subjects.length,
          new Set(snapshot.segments.map((value) => value.subjectId)).size,
        ),
      },
      { label: "练习册", value: snapshot.workbooks.length },
      { label: "已索引", value: `${snapshot.questions.length} 道` },
      { label: "已做", value: `${attemptedCount} 道` },
    ],
    [
      attemptedCount,
      snapshot.segments,
      snapshot.questions.length,
      snapshot.workbooks.length,
      subjects.length,
    ],
  );
  const availableSegmentIds = useMemo(
    () => new Set(snapshot.segments.map((segment) => segment.id)),
    [snapshot.segments],
  );

  useEffect(() => {
    let active = true;
    if (activeWindow === undefined) return;
    const segmentId = questionBankWindowSegmentId(activeWindow);
    if (segmentId !== undefined && !availableSegmentIds.has(segmentId)) {
      void Promise.resolve().then(() => {
        if (active) {
          setActiveWindow(questionBankCloseTarget());
          focusRootTrigger(activeWindow);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [activeWindow, availableSegmentIds]);

  const openExclusiveWindow = (next: QuestionBankWindow) => {
    setActiveWindow((current) => (current === undefined ? next : current));
  };

  function focusRootTrigger(window: QuestionBankWindow | undefined): void {
    requestAnimationFrame(() => {
      const target =
        window?.kind === "tools"
          ? toolsTriggerRef.current
          : window?.kind === "segment-manager" ||
              (window?.kind === "dialog" &&
                window.origin.kind === "segment-manager") ||
              (window?.kind === "paper" &&
                window.origin.kind === "segment-manager")
            ? segmentManagerTriggerRef.current
            : window?.kind === "dialog" && window.dialog === "import"
              ? importTriggerRef.current
              : window?.kind === "dialog" || window?.kind === "paper"
                ? window.origin.kind === "tools"
                  ? toolsTriggerRef.current
                  : undefined
                : undefined;
      if (target?.isConnected) {
        target.focus({ preventScroll: true });
        return;
      }
      questionBankFocusFallbackRef.current?.focus({ preventScroll: true });
    });
  }

  const closeWindow = () => {
    const current = activeWindow;
    setActiveWindow(questionBankCloseTarget());
    focusRootTrigger(current);
  };

  const backWindow = () => {
    setActiveWindow((current) =>
      current === undefined
        ? current
        : questionBankBackTarget(current, availableSegmentIds),
    );
  };

  const closeDialogWindow = (expected: DialogKind) => {
    if (activeWindow?.kind !== "dialog" || activeWindow.dialog !== expected) {
      return;
    }
    const current = activeWindow;
    setActiveWindow(questionBankCloseTarget());
    focusRootTrigger(current);
  };

  const closeSegmentManager = () => {
    if (activeWindow?.kind !== "segment-manager") return;
    setActiveWindow(questionBankCloseTarget());
    setSegmentManagerNotice("");
    requestAnimationFrame(() => {
      const trigger = segmentManagerTriggerRef.current;
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
        return;
      }
      questionBankFocusFallbackRef.current?.focus({ preventScroll: true });
    });
  };

  const openManagerTool = (kind: "browse" | "manual") => {
    if (activeWindow?.kind !== "segment-manager") return;
    setSegmentManagerNotice("");
    setActiveWindow(managerDialogWindow(kind, activeWindow.segmentId));
  };

  const refreshTools = async (): Promise<void> => {
    setToolsRefreshBusy(true);
    setToolsRefreshStatus({ message: "正在刷新题库…", tone: "info" });
    const [next, trashSucceeded] = await Promise.all([
      refresh(),
      refreshSegmentTrash(),
    ]);
    if (
      next === undefined ||
      !trashSucceeded ||
      !auxiliaryRefreshSucceededRef.current
    ) {
      setToolsRefreshStatus({
        message: "题库刷新失败，请查看错误提示后重试。",
        tone: "error",
      });
    } else {
      setToolsRefreshStatus({ message: "题库已刷新。", tone: "success" });
    }
    setToolsRefreshBusy(false);
  };

  const selectQuestionBankTool = (
    tool: QuestionBankTool,
    section?: QuestionBankToolsSection,
  ) => {
    if (activeWindow?.kind !== "tools") return;
    const selectedSection = section ?? activeWindow.section;
    if (tool === "refresh") {
      void refreshTools();
      return;
    }
    setActiveWindow(toolDialogWindow(tool, selectedSection));
  };

  const openSegmentManager = (
    segment: WorkbookDocumentSegment,
    trigger: HTMLButtonElement,
  ) => {
    if (activeWindow !== undefined) return;
    segmentManagerTriggerRef.current = trigger;
    setSegmentManagerNotice("");
    openExclusiveWindow({ kind: "segment-manager", segmentId: segment.id });
  };

  const restoreSegmentTrashFocus = () => {
    requestAnimationFrame(() => {
      const preferred =
        segmentRestoreFocusIdRef.current === undefined
          ? undefined
          : segmentRestoreButtonRefs.current.get(
              segmentRestoreFocusIdRef.current,
            );
      const fallback = [...segmentRestoreButtonRefs.current.values()].find(
        (button) => button.isConnected,
      );
      (preferred?.isConnected ? preferred : fallback)?.focus({
        preventScroll: true,
      });
      if (preferred?.isConnected || fallback?.isConnected) return;
      segmentTrashHeadingRef.current?.focus({ preventScroll: true });
    });
  };

  const openSegmentTrash = (trigger: HTMLButtonElement) => {
    if (activeWindow !== undefined) return;
    segmentTrashTriggerRef.current = trigger;
    setSegmentTrashError(undefined);
    openExclusiveWindow({ kind: "segment-trash" });
    void refreshSegmentTrash();
  };

  const closeSegmentTrash = () => {
    if (
      segmentRestoreBusyId !== undefined ||
      activeWindow?.kind !== "segment-trash"
    ) {
      return;
    }
    setActiveWindow(undefined);
    setSegmentRestoreError(undefined);
    requestAnimationFrame(() => {
      const trigger = segmentTrashTriggerRef.current;
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
        return;
      }
      questionBankFocusFallbackRef.current?.focus({ preventScroll: true });
    });
  };

  const restoreSegment = async (
    segment: TrashedWorkbookDocumentSegment,
    trigger: HTMLButtonElement,
  ) => {
    if (!mountedRef.current || segmentRestoreBusyId !== undefined) return;
    segmentRestoreFocusIdRef.current = segment.id;
    segmentRestoreButtonRefs.current.set(segment.id, trigger);
    const conflict = findSegmentRestoreConflicts(
      { segments: snapshot.segments, questions: snapshot.questions },
      segment,
    );
    if (conflict !== undefined) {
      setSegmentRestoreError(
        normalizeQuestionBankError({
          code: "QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT",
        }),
      );
      return;
    }
    setSegmentRestoreBusyId(segment.id);
    setSegmentRestoreError(undefined);
    const snapshotRequestId = ++snapshotRequestIdRef.current;
    try {
      const next = await restoreWorkbookSegment(segment.id, segment.deletedAt);
      if (!applySnapshot(next, snapshotRequestId)) return;
      setTrashedSegments((current) =>
        current.filter((item) => item.id !== segment.id),
      );
      setSegmentRestoreError(undefined);
      void refreshSegmentTrash({ restoreCompleted: true });
    } catch (restoreError: unknown) {
      if (!mountedRef.current) return;
      const normalized = normalizeQuestionBankError(restoreError);
      setSegmentRestoreError(normalized);
      if (normalized.code === "QUESTION_BANK_SEGMENT_RESTORE_STALE") {
        await refreshSegmentTrash();
      }
    } finally {
      if (mountedRef.current) {
        setSegmentRestoreBusyId(undefined);
        restoreSegmentTrashFocus();
      }
    }
  };

  const deleteTrashedSegment = async (
    segment: TrashedWorkbookDocumentSegment,
    trigger: HTMLButtonElement,
  ) => {
    if (!mountedRef.current || segmentRestoreBusyId !== undefined) return;
    segmentRestoreFocusIdRef.current = segment.id;
    segmentRestoreButtonRefs.current.set(segment.id, trigger);
    setSegmentRestoreBusyId(segmentTrashDeleteBusyId(segment.id));
    setSegmentRestoreError(undefined);
    const snapshotRequestId = ++snapshotRequestIdRef.current;
    try {
      const next = await deleteTrashedWorkbookSegment(
        segment.id,
        segment.deletedAt,
      );
      if (!applySnapshot(next, snapshotRequestId)) return;
      setTrashedSegments((current) =>
        current.filter((item) => item.id !== segment.id),
      );
      setSegmentRestoreError(undefined);
      void refreshSegmentTrash({ restoreCompleted: true });
    } catch (deleteError: unknown) {
      if (!mountedRef.current) return;
      const normalized = normalizeQuestionBankError(deleteError);
      setSegmentRestoreError(normalized);
      if (normalized.code === "QUESTION_BANK_SEGMENT_RESTORE_STALE") {
        await refreshSegmentTrash();
      }
    } finally {
      if (mountedRef.current) {
        setSegmentRestoreBusyId(undefined);
        restoreSegmentTrashFocus();
      }
    }
  };

  const purgeTrashedSegments = async (trigger: HTMLButtonElement) => {
    if (!mountedRef.current || segmentRestoreBusyId !== undefined) return;
    segmentRestoreFocusIdRef.current = undefined;
    segmentPurgeTriggerRef.current = trigger;
    setSegmentRestoreBusyId(SEGMENT_TRASH_PURGE_BUSY_ID);
    setSegmentRestoreError(undefined);
    const snapshotRequestId = ++snapshotRequestIdRef.current;
    try {
      const next = await deleteAllTrashedWorkbookSegments();
      if (!applySnapshot(next, snapshotRequestId)) return;
      setTrashedSegments([]);
      setSegmentRestoreError(undefined);
      void refreshSegmentTrash({ restoreCompleted: true });
    } catch (purgeError: unknown) {
      if (!mountedRef.current) return;
      const normalized = normalizeQuestionBankError(purgeError);
      setSegmentRestoreError(normalized);
      if (normalized.code === "QUESTION_BANK_SEGMENT_RESTORE_STALE") {
        await refreshSegmentTrash();
      }
    } finally {
      if (mountedRef.current) {
        setSegmentRestoreBusyId(undefined);
        restoreSegmentTrashFocus();
      }
    }
  };

  const initialSnapshotError =
    questionBankLoadState === "error"
      ? (questionBankSnapshotError ?? error)
      : undefined;
  const snapshotCanRender =
    !loading &&
    (questionBankLoadState === "ready" ||
      questionBankLoadState === "refreshing" ||
      questionBankLoadState === "stale");
  const activeSnapshotEmpty =
    snapshotCanRender && snapshot.segments.length === 0;

  const pageActions: ReactNode = (
    <>
      <button
        ref={importTriggerRef}
        type="button"
        className="primary-button"
        onClick={(event) => {
          importTriggerRef.current = event.currentTarget;
          openExclusiveWindow({
            kind: "dialog",
            dialog: "import",
            origin: { kind: "root" },
          });
        }}
      >
        导入 PDF
      </button>
      <button
        ref={toolsTriggerRef}
        type="button"
        className="secondary-button"
        onClick={(event) => {
          toolsTriggerRef.current = event.currentTarget;
          setToolsSection("category");
          setToolsRefreshStatus(undefined);
          openExclusiveWindow(toolWindow("category"));
        }}
      >
        题库工具
      </button>
      <button
        ref={segmentTrashTriggerRef}
        type="button"
        className="text-button question-bank-trash-link"
        aria-haspopup="dialog"
        onClick={(event) => openSegmentTrash(event.currentTarget)}
      >
        分段回收站
        {segmentTrashLoaded ? `（${trashedSegments.length}）` : ""}
      </button>
    </>
  );

  return (
    <PageSurface className="question-bank" labelledBy="question-bank-title">
      <PageHeader
        id="question-bank-title"
        title="习题册"
        actions={pageActions}
      />

      {initialSnapshotError === undefined &&
      questionBankLoadState !== "stale" &&
      error !== undefined ? (
        <PageStatus
          tone="error"
          title={error.message}
          action={
            <button type="button" onClick={() => void refresh()}>
              重试
            </button>
          }
        >
          {error.action}
        </PageStatus>
      ) : null}

      {initialSnapshotError === undefined ? null : (
        <PageStatus
          tone="error"
          title="题库读取失败"
          action={
            <button
              type="button"
              className="secondary-button"
              disabled={questionBankLoadState === "loading"}
              onClick={() => void refresh()}
            >
              重试
            </button>
          }
        >
          <>
            {initialSnapshotError.message}
            <br />
            {initialSnapshotError.action}
          </>
        </PageStatus>
      )}
      {questionBankLoadState === "loading" ? (
        <PageStatus tone="loading" title="正在读取题库…" />
      ) : null}
      {questionBankLoadState === "refreshing" ? (
        <PageStatus tone="loading" title="正在刷新题库…">
          刷新完成前仍显示上次已加载的题库。
        </PageStatus>
      ) : null}
      {questionBankLoadState === "stale" &&
      questionBankSnapshotError !== undefined ? (
        <PageStatus
          tone="warning"
          title="暂时无法刷新题库，仍显示上次快照"
          action={
            <button
              type="button"
              className="secondary-button"
              onClick={() => void refresh()}
            >
              重试
            </button>
          }
        >
          <>
            {questionBankSnapshotError.message}
            <br />
            {questionBankSnapshotError.action}
          </>
        </PageStatus>
      ) : null}

      {questionBankLoadState === "loading" ||
      questionBankLoadState === "error" ? null : (
        <div
          className="question-bank-summary"
          aria-label="题库概览"
          aria-live="polite"
        >
          {questionBankStats.map((stat) => (
            <span key={stat.label}>
              {stat.label} <strong>{stat.value}</strong>
            </span>
          ))}
        </div>
      )}

      <QuestionBankCategoryOverview
        subjects={subjects}
        workbooks={snapshot.workbooks}
        busyId={categoryActionBusyId}
        error={categoryActionError}
        onDeleteSubject={(subject) => void deleteSubject(subject)}
        onDeleteWorkbook={(workbook) => void deleteWorkbook(workbook)}
        onRenameSubject={renameSubjectCategory}
        onRenameWorkbook={renameWorkbookCategoryItem}
      />

      {activeSnapshotEmpty &&
      !segmentTrashLoaded &&
      segmentTrashError === undefined ? (
        <div className="question-bank-onboarding">
          <PageEmpty
            title="还没有建立题目索引"
            description="按下面三步建立第一个活动题库："
            headingLevel={2}
          />
          <ol className="question-bank-import-steps">
            <li className="question-bank-import-step">
              <strong>创建分类</strong>
              <span>在“题库工具”中创建科目和练习册。</span>
            </li>
            <li className="question-bank-import-step">
              <strong>导入 PDF</strong>
              <span>使用主页唯一的“导入 PDF”入口开始分析。</span>
            </li>
            <li className="question-bank-import-step">
              <strong>确认归类</strong>
              <span>确认科目与练习册后，索引进度会显示在这里。</span>
            </li>
          </ol>
          {segmentTrashLoading ? (
            <p className="form-hint" role="status">
              正在读取分段回收站状态…
            </p>
          ) : null}
        </div>
      ) : activeSnapshotEmpty &&
        segmentTrashLoaded &&
        trashedSegments.length === 0 ? (
        <div className="question-bank-onboarding">
          <PageEmpty
            title="还没有建立题目索引"
            description="先在“题库工具”中创建分类，再使用主页的“导入 PDF”入口。"
            headingLevel={2}
          />
          <ol className="question-bank-import-steps">
            <li className="question-bank-import-step">
              <strong>创建分类</strong>
              <span>准备科目和练习册。</span>
            </li>
            <li className="question-bank-import-step">
              <strong>导入并确认</strong>
              <span>分析 PDF 后确认每个分段的归属。</span>
            </li>
          </ol>
        </div>
      ) : activeSnapshotEmpty ? (
        <div className="question-bank-onboarding question-bank-trash-only">
          <PageEmpty
            title="当前没有活动题目索引"
            description={
              segmentTrashError === undefined
                ? "已删除的 PDF 分段仍保留在回收站，可通过显式恢复流程处理。"
                : "活动题库为空，分段回收站状态暂时无法读取。"
            }
            action={
              segmentTrashError === undefined ? (
                <button
                  type="button"
                  className="secondary-button"
                  aria-haspopup="dialog"
                  onClick={(event) => openSegmentTrash(event.currentTarget)}
                >
                  打开分段回收站
                </button>
              ) : undefined
            }
            headingLevel={2}
          />
          {segmentTrashError === undefined ? null : (
            <PageStatus tone="error" title={segmentTrashError.message}>
              {segmentTrashError.action}
            </PageStatus>
          )}
        </div>
      ) : snapshotCanRender ? (
        <QuestionBankTree
          snapshot={snapshot}
          onManageSegment={openSegmentManager}
        />
      ) : null}

      <QuestionBankWindowPresenter
        activeWindow={activeWindow}
        snapshot={snapshot}
        resources={resources}
        subjects={subjects}
        timezone={timezone}
        loading={loading}
        trashedSegments={trashedSegments}
        segmentTrashLoading={segmentTrashLoading}
        segmentTrashError={segmentTrashError}
        segmentRestoreBusyId={segmentRestoreBusyId}
        segmentRestoreError={segmentRestoreError}
        segmentManagerNotice={segmentManagerNotice}
        segmentTrashHeadingRef={segmentTrashHeadingRef}
        segmentRestoreButtonRefs={segmentRestoreButtonRefs}
        toolsSection={toolsSection}
        toolsRefreshBusy={toolsRefreshBusy}
        toolsRefreshStatus={toolsRefreshStatus}
        toolsTriggerRef={toolsTriggerRef}
        importTriggerRef={importTriggerRef}
        questionBankFocusFallbackRef={questionBankFocusFallbackRef}
        manualIndexDialog={ManualIndexDialog}
        onClose={closeWindow}
        onBack={backWindow}
        onCloseDialog={closeDialogWindow}
        onSubjectCreated={(subject) => {
          setCategoryActionError(undefined);
          setSubjects((current) => [...current, subject]);
          void refresh();
        }}
        onWorkbookCreated={(workbook) => {
          setCategoryActionError(undefined);
          applySnapshotUpdate((current) => ({
            ...current,
            workbooks: [...current.workbooks, workbook],
          }));
          void refresh();
        }}
        onCloseSegmentManager={closeSegmentManager}
        onCloseSegmentTrash={closeSegmentTrash}
        onSelectTool={selectQuestionBankTool}
        onSectionChange={(section) => {
          setToolsSection(section);
          setActiveWindow((current) =>
            current?.kind === "tools" ? toolWindow(section) : current,
          );
        }}
        onRefreshTools={refreshTools}
        onRefreshSegmentTrash={() => void refreshSegmentTrash()}
        onRestoreSegment={(segment, trigger) =>
          void restoreSegment(segment, trigger)
        }
        onDeleteSegment={(segment, trigger) =>
          void deleteTrashedSegment(segment, trigger)
        }
        onDeleteAllSegments={(trigger) => void purgeTrashedSegments(trigger)}
        onSegmentChanged={(next, notice) => {
          if (!applySnapshot(next)) return;
          setSegmentManagerNotice(notice ?? "");
          void refreshSegmentTrash();
        }}
        onSegmentRefresh={async () => {
          const current =
            activeWindow?.kind === "segment-manager"
              ? snapshot.segments.find(
                  (segment) => segment.id === activeWindow.segmentId,
                )
              : undefined;
          const previousUpdatedAt = current?.updatedAt;
          const next = await refresh();
          const refreshed =
            activeWindow?.kind === "segment-manager"
              ? next?.segments.find(
                  (segment) => segment.id === activeWindow.segmentId,
                )
              : undefined;
          if (
            refreshed !== undefined &&
            refreshed.updatedAt !== previousUpdatedAt
          ) {
            setSegmentManagerNotice("状态已刷新，请重新确认。");
          }
          return next;
        }}
        onBrowseSegment={() => openManagerTool("browse")}
        onContinueIndex={() => openManagerTool("manual")}
        onSnapshotChanged={applySnapshot}
        onPaperGenerated={(
          questions,
          recipe: PaperDraftRecipe,
          results,
          recordedResults,
        ) => {
          if (
            activeWindow?.kind !== "dialog" ||
            activeWindow.dialog !== "paper"
          )
            return;
          if (questions.length === 0) {
            closeWindow();
            return;
          }
          setActiveWindow(
            paperWindow(
              questions,
              activeWindow.origin,
              recipe,
              results,
              recordedResults,
            ),
          );
        }}
      />
    </PageSurface>
  );
}
