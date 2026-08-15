import { useEffect, useRef, useState } from "react";
import { EditorDialog } from "../../shared/components/EditorDialog";
import {
  PageEmpty,
  PageHeader,
  PageStatus,
  PageSurface,
} from "../../shared/components/PagePrimitives";
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
import { buildContinuousReviewSession } from "./continuousReview";
import { ContinuousReviewPanel } from "./ContinuousReviewPanel";
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

export function ReviewPanel({
  openRequest,
  onOpenSettings,
}: {
  openRequest?: number;
  onOpenSettings(): void;
}) {
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReviewSchemeCommandError>();
  const [notice, setNotice] = useState("");
  const [managementOpen, setManagementOpen] = useState(false);
  const [dismissedReviewRequest, setDismissedReviewRequest] =
    useState<number>();
  const [draft, setDraft] = useState<SchemeDraft>();
  const [initial, setInitial] = useState<SchemeDraft>();
  const version = useRef(0);
  const refresh = async () => {
    const v = ++version.current;
    setState({ kind: "loading" });
    const next = await loadReviewPage();
    if (v === version.current) setState(next);
  };
  useEffect(() => {
    const v = ++version.current;
    void loadReviewPage().then((next) => {
      if (v === version.current) setState(next);
    });
  }, []);
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
      eyebrow="每日复习队列"
      title="错题"
      description="设置一次，之后只做系统推送的题；未完成题自动顺延。"
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
            <button type="button" onClick={onOpenSettings}>
              前往设置
            </button>
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
            <button type="button" onClick={() => void refresh()}>
              重新读取
            </button>
          }
        >
          {state.error.action}
        </PageStatus>
      </PageSurface>
    );
  const { today, dashboard, subjects, workbooks } = state.value;
  const session = buildContinuousReviewSession(dashboard.schemes);
  const showManagement = managementOpen || dashboard.schemes.length === 0;
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
          <button
            type="button"
            onClick={() =>
              showManagement
                ? open({ ...EMPTY_DRAFT, quotas: { ...EMPTY_DRAFT.quotas } })
                : setManagementOpen(true)
            }
          >
            {showManagement ? "新建复习方案" : "管理复习方案"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void refresh()}
          >
            刷新
          </button>
        </>,
      )}
      {error && (
        <PageStatus tone="error" title={error.message}>
          {error.action}
        </PageStatus>
      )}
      {notice && <p className="review-scheme-notice">{notice}</p>}
      {showManagement ? (
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
      ) : (
        <ContinuousReviewPanel
          session={session}
          openRequest={
            openRequest !== undefined && openRequest !== dismissedReviewRequest
              ? openRequest
              : undefined
          }
          onClose={() => {
            if (openRequest !== undefined) {
              setDismissedReviewRequest(openRequest);
            }
          }}
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
          onManage={() => setManagementOpen(true)}
        />
      )}
    </PageSurface>
  );
}
