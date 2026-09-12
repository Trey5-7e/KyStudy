import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "../../shared/components/EditorDialog";
import {
  PageEmpty,
  PageHeader,
  PageStatus,
  PageSurface,
} from "../../shared/components/PagePrimitives";
import { Button } from "../../shared/ui/Button";
import {
  archiveReviewScheme,
  generateReviewSchemeQueue,
  normalizeReviewSchemeError,
  prepareReviewSchemeQueues,
  saveReviewScheme,
  setReviewRestWeekdays,
  submitReviewSchemeResult,
  undoReviewSchemeResult,
  type ReviewSchemeCommandError,
  type ReviewSchemeDashboard,
} from "../../shared/tauri/reviewSchemeClient";
import {
  getQuestionBank,
  type IndexedQuestion,
  type QuestionBankSnapshot,
} from "../../shared/tauri/questionBankClient";
import { buildContinuousReviewSession } from "./continuousReview";
import { ContinuousReviewPanel } from "./ContinuousReviewPanel";
import { InstantMistakeDialog } from "./InstantMistakeDialog";
import { InstantMistakeDrillDialog } from "./InstantMistakeDrillDialog";
import { MistakeNotebookView } from "./MistakeNotebookView";
import {
  RestDaySettings,
  SchemeCard,
  SchemeForm,
  EMPTY_DRAFT,
  draftFromScheme,
} from "./ReviewSchemeManagement";
import {
  loadReviewPage,
  sameSchemeDraft,
  toSaveInput,
  type PageState,
  type SchemeDraft,
} from "./reviewViewModel";
import "./review.css";

export type ReviewTab = "queue" | "notebook" | "schemes";

export type ReviewOpenRequest =
  | {
      kind: "continuous" | "instant-mistake";
      nonce: number;
    }
  | number;

export function ReviewPanel({
  openRequest,
  onOpenSettings,
}: {
  openRequest?: ReviewOpenRequest;
  onOpenSettings(): void;
}) {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReviewSchemeCommandError>();
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<ReviewTab>();
  const [dismissedReviewRequest, setDismissedReviewRequest] =
    useState<number>();
  const [internalOpenRequest, setInternalOpenRequest] = useState<number>();
  const handledInstantMistakeNonceRef = useRef<number | undefined>(undefined);
  const [draft, setDraft] = useState<SchemeDraft>();
  const [initial, setInitial] = useState<SchemeDraft>();
  const [instantMistakeSetupOpen, setInstantMistakeSetupOpen] = useState(false);
  const [drillSession, setDrillSession] = useState<{
    questions: IndexedQuestion[];
    targetCount: number;
    subjectId?: string;
  }>();
  const [questionBankSnapshot, setQuestionBankSnapshot] =
    useState<QuestionBankSnapshot>();
  const version = useRef(0);
  const refresh = async () => {
    const v = ++version.current;
    setState({ kind: "loading" });
    const [next, snap] = await Promise.all([
      loadReviewPage(),
      getQuestionBank().catch(() => undefined),
    ]);
    if (v === version.current) {
      setState(next);
      if (snap) setQuestionBankSnapshot(snap);
    }
  };
  const openInstantMistake = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const snapshot = await getQuestionBank();
      setQuestionBankSnapshot(snapshot);
      setInstantMistakeSetupOpen(true);
    } catch (e) {
      setError(normalizeReviewSchemeError(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    const v = ++version.current;
    void loadReviewPage().then((next) => {
      if (v === version.current) setState(next);
    });
    void getQuestionBank()
      .then(setQuestionBankSnapshot)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (activeTab === "notebook" && !questionBankSnapshot) {
      void getQuestionBank()
        .then(setQuestionBankSnapshot)
        .catch(() => {});
    }
  }, [activeTab, questionBankSnapshot]);
  useEffect(() => {
    if (openRequest === undefined) return;
    if (
      typeof openRequest === "object" &&
      openRequest.kind === "instant-mistake"
    ) {
      if (handledInstantMistakeNonceRef.current !== openRequest.nonce) {
        handledInstantMistakeNonceRef.current = openRequest.nonce;
        void openInstantMistake();
      }
    }
  }, [openRequest]);
  useEffect(() => {
    if (!draft || !initial || sameSchemeDraft(draft, initial)) return;
  }, [draft, initial]);
  const run = async (
    op: () => Promise<ReviewSchemeDashboard>,
    message: string,
  ) => {
    if (busy) return false;
    setBusy(true);
    setError(undefined);
    try {
      const dashboard = await op();
      setState((s) =>
        s.kind === "ready"
          ? { kind: "ready", value: { ...s.value, dashboard } }
          : s,
      );
      setNotice(message);
      return true;
    } catch (e) {
      setError(normalizeReviewSchemeError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const header = (actions?: React.ReactNode) => (
    <PageHeader
      id="review-title"
      title="错题"
      description="按系统推送复习，未完成题自动顺延。"
      actions={actions}
    />
  );
  if (state.kind === "loading")
    return (
      <PageSurface className="review-scheme-page" labelledBy="review-title">
        {header()}
        <PageStatus tone="loading" title="正在准备错题方案" />
      </PageSurface>
    );
  if (state.kind === "missing-workspace")
    return (
      <PageSurface className="review-scheme-page" labelledBy="review-title">
        {header()}
        <PageEmpty
          title="先创建本地工作区"
          description="工作区创建后才能保存错题和复习方案。"
          action={
            <Button variant="primary" onClick={onOpenSettings}>
              前往设置
            </Button>
          }
        />
      </PageSurface>
    );
  if (state.kind === "error")
    return (
      <PageSurface className="review-scheme-page" labelledBy="review-title">
        {header()}
        <PageStatus
          tone="error"
          title={state.error.message}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
            >
              重新读取
            </Button>
          }
        >
          {state.error.action}
        </PageStatus>
      </PageSurface>
    );
  const { today, dashboard, subjects, workbooks } = state.value;
  const session = buildContinuousReviewSession(dashboard.schemes);
  const currentTab: ReviewTab =
    activeTab ?? (dashboard.schemes.length === 0 ? "schemes" : "queue");
  const open = (d: SchemeDraft) => {
    setDraft(d);
    setInitial(d);
  };
  const close = () => {
    setDraft(undefined);
    setInitial(undefined);
  };
  return (
    <PageSurface className="review-scheme-page" labelledBy="review-title">
      {header(
        <>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void openInstantMistake()}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              bolt
            </span>
            <span>立即刷错题</span>
          </Button>
          {currentTab === "schemes" ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                open({ ...EMPTY_DRAFT, quotas: { ...EMPTY_DRAFT.quotas } })
              }
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                add
              </span>
              <span>新建复习方案</span>
            </Button>
          ) : currentTab === "queue" ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setActiveTab("schemes")}
            >
              <span className="material-symbols-rounded" aria-hidden="true">
                tune
              </span>
              <span>管理复习方案</span>
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              refresh
            </span>
            <span>刷新</span>
          </Button>
        </>,
      )}

      {/* 视图切换器 */}
      <div
        className="review-tab-switcher"
        role="tablist"
        aria-label="错题模块导航"
      >
        <button
          type="button"
          role="tab"
          aria-selected={currentTab === "queue"}
          className={`review-tab-button ${currentTab === "queue" ? "is-active" : ""}`}
          onClick={() => setActiveTab("queue")}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            calendar_today
          </span>
          <span>今日复习</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={currentTab === "notebook"}
          className={`review-tab-button ${currentTab === "notebook" ? "is-active" : ""}`}
          onClick={() => setActiveTab("notebook")}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            menu_book
          </span>
          <span>错题本</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={currentTab === "schemes"}
          className={`review-tab-button ${currentTab === "schemes" ? "is-active" : ""}`}
          onClick={() => setActiveTab("schemes")}
        >
          <span className="material-symbols-rounded" aria-hidden="true">
            tune
          </span>
          <span>复习方案</span>
        </button>
      </div>
      {error && (
        <PageStatus tone="error" title={error.message}>
          {error.action}
        </PageStatus>
      )}
      {notice && <p className="review-scheme-notice">{notice}</p>}
      {currentTab === "schemes" ? (
        <>
          <RestDaySettings
            key={dashboard.restWeekdays.join(",")}
            restWeekdays={dashboard.restWeekdays}
            busy={busy}
            onSave={(v) =>
              run(() => setReviewRestWeekdays(v, today), "每周休息日已保存")
            }
          />
          {draft && initial && (
            <EditorDialog
              title={draft.schemeId ? "编辑复习方案" : "新建复习方案"}
              description="设置科目、习题册范围和每日题型数量。"
              dirty={!sameSchemeDraft(draft, initial)}
              onRequestClose={close}
              size="large"
            >
              <SchemeForm
                draft={draft}
                subjects={subjects}
                workbooks={workbooks}
                busy={busy}
                onChange={setDraft}
                onSave={async (d) => {
                  if (
                    await run(
                      () => saveReviewScheme(toSaveInput(d, today)),
                      "复习方案已保存",
                    )
                  )
                    close();
                }}
              />
            </EditorDialog>
          )}
          <div className="review-scheme-list">
            {dashboard.schemes.map((v) => (
              <SchemeCard
                key={v.scheme.id}
                value={v}
                busy={busy}
                onEdit={() => open(draftFromScheme(v.scheme))}
                onToggle={() =>
                  run(
                    () =>
                      saveReviewScheme({
                        ...toSaveInput(
                          {
                            ...draftFromScheme(v.scheme),
                            enabled: !v.scheme.enabled,
                          },
                          today,
                        ),
                      }),
                    "方案状态已更新",
                  )
                }
                onArchive={() =>
                  run(
                    () => archiveReviewScheme(v.scheme.id, today),
                    "方案已归档",
                  )
                }
                onGenerate={(id) =>
                  run(
                    () =>
                      generateReviewSchemeQueue({
                        schemeId: v.scheme.id,
                        queueDate: today,
                        ...(id ? { temporaryDocumentId: id } : {}),
                      }),
                    "今日错题已排好",
                  )
                }
                onFeedback={(q, qi, r) =>
                  run(
                    () =>
                      submitReviewSchemeResult({
                        queueId: q,
                        questionId: qi,
                        rating: r,
                        today,
                      }),
                    "反馈已保存",
                  )
                }
                onUndo={(q) =>
                  run(
                    () => undoReviewSchemeResult({ queueId: q, today }),
                    "已撤销上一条反馈",
                  )
                }
              />
            ))}
          </div>
        </>
      ) : currentTab === "notebook" ? (
        <MistakeNotebookView
          questions={questionBankSnapshot?.questions ?? []}
          subjects={subjects}
          workbooks={workbooks}
          busy={busy}
          today={today}
          onSnapshotUpdated={(next) => setQuestionBankSnapshot(next)}
          onStartDrill={async (selectedQuestions, count, subjectId) => {
            let snap = questionBankSnapshot;
            if (!snap) {
              snap = await getQuestionBank();
              setQuestionBankSnapshot(snap);
            }
            setDrillSession({
              questions: selectedQuestions,
              targetCount: count,
              subjectId,
            });
          }}
        />
      ) : (
        <ContinuousReviewPanel
          session={session}
          openRequest={(() => {
            const nonce =
              typeof openRequest === "number"
                ? openRequest
                : openRequest?.kind === "continuous"
                  ? openRequest.nonce
                  : undefined;
            return (
              (nonce !== undefined && nonce !== dismissedReviewRequest
                ? nonce
                : undefined) ?? internalOpenRequest
            );
          })()}
          onClose={() => {
            const nonce =
              typeof openRequest === "number"
                ? openRequest
                : openRequest?.kind === "continuous"
                  ? openRequest.nonce
                  : undefined;
            if (nonce !== undefined) {
              setDismissedReviewRequest(nonce);
            }
            setInternalOpenRequest(undefined);
          }}
          onStartReview={() => setInternalOpenRequest(Date.now())}
          busy={busy}
          onPrepare={() =>
            run(
              () => prepareReviewSchemeQueues(today, dashboard),
              "全部方案已准备好",
            )
          }
          onFeedback={(q, qi, r) =>
            run(
              () =>
                submitReviewSchemeResult({
                  queueId: q,
                  questionId: qi,
                  rating: r,
                  today,
                }),
              "反馈已保存",
            )
          }
          onUndo={(q) =>
            run(
              () => undoReviewSchemeResult({ queueId: q, today }),
              "已撤销上一题",
            )
          }
          onManage={() => setActiveTab("schemes")}
          onOpenInstantMistake={() => void openInstantMistake()}
        />
      )}
      {instantMistakeSetupOpen && questionBankSnapshot && (
        <InstantMistakeDialog
          questions={questionBankSnapshot.questions}
          subjects={subjects}
          onClose={() => setInstantMistakeSetupOpen(false)}
          onStartDrill={(selectedQuestions, targetCount, subjectId) => {
            setInstantMistakeSetupOpen(false);
            setDrillSession({
              questions: selectedQuestions,
              targetCount,
              subjectId,
            });
          }}
        />
      )}
      {drillSession && questionBankSnapshot && (
        <InstantMistakeDrillDialog
          questions={drillSession.questions}
          allQuestions={questionBankSnapshot.questions}
          today={today}
          targetCount={drillSession.targetCount}
          subjectId={drillSession.subjectId}
          onSnapshotUpdated={(next) => setQuestionBankSnapshot(next)}
          onClose={() => setDrillSession(undefined)}
          onComplete={() => {
            setDrillSession(undefined);
            void refresh();
          }}
        />
      )}
    </PageSurface>
  );
}
