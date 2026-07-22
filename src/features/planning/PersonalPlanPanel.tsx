import { useEffect, useState, type FormEvent } from "react";

import {
  addPlanReference,
  deletePlanReference,
  deletePlanStage,
  listStudyPlans,
  normalizePlanningError,
  savePlanStage,
  saveStudyPlan,
  setStudyPlanStatus,
  type PlanStage,
  type StudyPlanBundle,
} from "../../shared/tauri/planningClient";
import {
  listResources,
  type ResourceCommandError,
  type ResourceDocument,
} from "../../shared/tauri/resourceClient";
import {
  listSubjects,
  type StudySubject,
} from "../../shared/tauri/scheduleClient";
import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";
import { PlanProgressPanel } from "./PlanProgressPanel";
import { PlanSchedulePanel } from "./PlanSchedulePanel";
import { PlanningChatPanel } from "./PlanningChatPanel";

interface PersonalPlanPanelProps {
  onOpenReference(documentId: string, page: number): void;
  onOpenSchedule(): void;
}

interface PlanForm {
  title: string;
  targetExam: string;
  examDate: string;
  overview: string;
}

interface StageForm {
  id?: string;
  title: string;
  startDate: string;
  endDate: string;
  focus: string;
}

const EMPTY_PLAN: PlanForm = {
  title: "",
  targetExam: "",
  examDate: "",
  overview: "",
};

const EMPTY_STAGE: StageForm = {
  title: "",
  startDate: "",
  endDate: "",
  focus: "",
};

export function PersonalPlanPanel({
  onOpenReference,
  onOpenSchedule,
}: PersonalPlanPanelProps) {
  const [plans, setPlans] = useState<StudyPlanBundle[]>([]);
  const [pdfResources, setPdfResources] = useState<ResourceDocument[]>([]);
  const [subjects, setSubjects] = useState<StudySubject[]>([]);
  const [workspaceTimezone, setWorkspaceTimezone] = useState("Asia/Shanghai");
  const [progressRefreshToken, setProgressRefreshToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [planForm, setPlanForm] = useState<PlanForm>(EMPTY_PLAN);
  const [stageForm, setStageForm] = useState<StageForm>(EMPTY_STAGE);
  const [referenceDocumentId, setReferenceDocumentId] = useState("");
  const [pageStart, setPageStart] = useState("1");
  const [pageEnd, setPageEnd] = useState("1");
  const [referenceNote, setReferenceNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ResourceCommandError | null>(null);

  const selected = plans.find((bundle) => bundle.plan.id === selectedId);

  useEffect(() => {
    let active = true;
    void Promise.all([
      listStudyPlans(),
      listResources(),
      listSubjects(),
      getWorkspaceStatus(),
    ]).then(
      ([loadedPlans, resources, loadedSubjects, workspace]) => {
        if (!active) {
          return;
        }
        setPlans(loadedPlans);
        setPdfResources(
          resources.filter((resource) => resource.kind === "pdf"),
        );
        setSubjects(loadedSubjects);
        setWorkspaceTimezone(workspace?.timezone ?? "Asia/Shanghai");
        const initial = loadedPlans[0];
        if (initial !== undefined) {
          selectBundle(initial, setSelectedId, setPlanForm);
        }
        const firstPdf = resources.find((resource) => resource.kind === "pdf");
        setReferenceDocumentId(firstPdf?.id ?? "");
        setLoading(false);
      },
      (loadError: unknown) => {
        if (active) {
          setError(normalizePlanningError(loadError));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const choosePlan = (bundle: StudyPlanBundle) => {
    selectBundle(bundle, setSelectedId, setPlanForm);
    setStageForm(EMPTY_STAGE);
    setError(null);
  };

  const newPlan = () => {
    setSelectedId(undefined);
    setPlanForm(EMPTY_PLAN);
    setStageForm(EMPTY_STAGE);
    setError(null);
  };

  const submitPlan = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const saved = await saveStudyPlan({
        id: selectedId,
        title: planForm.title,
        targetExam: planForm.targetExam || undefined,
        examDate: planForm.examDate || undefined,
        overview: planForm.overview || undefined,
      });
      setPlans((current) => upsertBundle(current, saved));
      choosePlan(saved);
    } catch (saveError: unknown) {
      setError(normalizePlanningError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (status: "draft" | "active" | "archived") => {
    if (selected === undefined) {
      return;
    }
    setSaving(true);
    try {
      const updated = await setStudyPlanStatus(selected.plan.id, status);
      const refreshed = await listStudyPlans();
      setPlans(refreshed);
      choosePlan(updated);
      setError(null);
    } catch (statusError: unknown) {
      setError(normalizePlanningError(statusError));
    } finally {
      setSaving(false);
    }
  };

  const submitStage = async (event: FormEvent) => {
    event.preventDefault();
    if (selected === undefined) {
      return;
    }
    setSaving(true);
    try {
      await savePlanStage({
        id: stageForm.id,
        planId: selected.plan.id,
        title: stageForm.title,
        startDate: stageForm.startDate,
        endDate: stageForm.endDate,
        focus: stageForm.focus || undefined,
        sortOrder:
          stageForm.id === undefined
            ? selected.stages.length
            : (selected.stages.find((stage) => stage.id === stageForm.id)
                ?.sortOrder ?? 0),
      });
      await reloadSelected(selected.plan.id);
      setStageForm(EMPTY_STAGE);
      setError(null);
    } catch (stageError: unknown) {
      setError(normalizePlanningError(stageError));
    } finally {
      setSaving(false);
    }
  };

  const removeStage = async (stageId: string) => {
    if (selected === undefined) {
      return;
    }
    try {
      await deletePlanStage(stageId);
      await reloadSelected(selected.plan.id);
      setStageForm(EMPTY_STAGE);
    } catch (stageError: unknown) {
      setError(normalizePlanningError(stageError));
    }
  };

  const submitReference = async (event: FormEvent) => {
    event.preventDefault();
    if (selected === undefined) {
      return;
    }
    try {
      await addPlanReference({
        planId: selected.plan.id,
        documentId: referenceDocumentId,
        pageStart: Number(pageStart),
        pageEnd: Number(pageEnd),
        note: referenceNote || undefined,
      });
      await reloadSelected(selected.plan.id);
      setReferenceNote("");
      setError(null);
    } catch (referenceError: unknown) {
      setError(normalizePlanningError(referenceError));
    }
  };

  const removeReference = async (referenceId: string) => {
    if (selected === undefined) {
      return;
    }
    try {
      await deletePlanReference(referenceId);
      await reloadSelected(selected.plan.id);
    } catch (referenceError: unknown) {
      setError(normalizePlanningError(referenceError));
    }
  };

  const reloadSelected = async (planId: string) => {
    try {
      const refreshed = await listStudyPlans();
      setPlans(refreshed);
      const match = refreshed.find((bundle) => bundle.plan.id === planId);
      if (match !== undefined) {
        selectBundle(match, setSelectedId, setPlanForm);
      }
    } catch (reloadError: unknown) {
      setError(normalizePlanningError(reloadError));
    }
  };

  return (
    <section
      className="personal-plan-card"
      aria-labelledby="personal-plan-title"
    >
      <PlanningChatPanel
        onOpenReference={onOpenReference}
        onDraftCreated={reloadSelected}
      />
      <div className="personal-plan-heading">
        <div>
          <p className="section-label">资料驱动的手动草案</p>
          <h2 id="personal-plan-title">个人备考规划</h2>
          <p>
            先由你决定目标、阶段和资料依据。确认计划只改变计划状态，不会自动改写日程。
          </p>
        </div>
        <button type="button" onClick={newPlan}>
          新建草案
        </button>
      </div>

      {error === null ? null : (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
        </div>
      )}

      {loading ? (
        <p className="empty-state">正在读取个人计划…</p>
      ) : (
        <div className="personal-plan-layout">
          <nav className="plan-list" aria-label="个人计划列表">
            {plans.length === 0 ? <p>还没有计划草案。</p> : null}
            {plans.map((bundle) => (
              <button
                key={bundle.plan.id}
                type="button"
                className={
                  bundle.plan.id === selectedId ? "plan-list-active" : undefined
                }
                onClick={() => choosePlan(bundle)}
              >
                <strong>{bundle.plan.title}</strong>
                <span>
                  {statusLabel(bundle.plan.status)} · v{bundle.plan.revision}
                </span>
              </button>
            ))}
          </nav>

          <div className="plan-editor">
            <form onSubmit={(event) => void submitPlan(event)}>
              <div className="plan-form-grid">
                <label>
                  计划标题
                  <input
                    required
                    maxLength={120}
                    value={planForm.title}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  目标考试
                  <input
                    maxLength={120}
                    placeholder="例如：2027 计算机考研"
                    value={planForm.targetExam}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        targetExam: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  考试日期
                  <input
                    type="date"
                    value={planForm.examDate}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        examDate: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="plan-overview-field">
                  总体思路
                  <textarea
                    rows={5}
                    maxLength={8000}
                    value={planForm.overview}
                    onChange={(event) =>
                      setPlanForm((current) => ({
                        ...current,
                        overview: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              <div className="plan-form-actions">
                <button type="submit" disabled={saving}>
                  {selected === undefined ? "保存草案" : "保存修改"}
                </button>
                {selected === undefined ? null : (
                  <>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || selected.plan.status === "active"}
                      onClick={() => void changeStatus("active")}
                    >
                      确认为当前计划
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={saving || selected.plan.status === "archived"}
                      onClick={() => void changeStatus("archived")}
                    >
                      归档
                    </button>
                  </>
                )}
              </div>
            </form>

            {selected === undefined ? (
              <p className="planning-note">
                先保存计划主体，再添加阶段和资料引用。
              </p>
            ) : (
              <>
                <section
                  className="plan-subsection"
                  aria-labelledby="plan-stage-title"
                >
                  <h3 id="plan-stage-title">阶段安排</h3>
                  <ul className="plan-stage-list">
                    {selected.stages.map((stage) => (
                      <li key={stage.id}>
                        <div>
                          <strong>{stage.title}</strong>
                          <span>
                            {stage.startDate} 至 {stage.endDate}
                          </span>
                          {stage.focus === undefined ? null : (
                            <p>{stage.focus}</p>
                          )}
                        </div>
                        <div className="plan-item-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => setStageForm(stageToForm(stage))}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => void removeStage(stage.id)}
                          >
                            删除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <form
                    className="stage-form"
                    onSubmit={(event) => void submitStage(event)}
                  >
                    <label>
                      阶段名称
                      <input
                        required
                        maxLength={120}
                        value={stageForm.title}
                        onChange={(event) =>
                          setStageForm((current) => ({
                            ...current,
                            title: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      开始日期
                      <input
                        required
                        type="date"
                        value={stageForm.startDate}
                        onChange={(event) =>
                          setStageForm((current) => ({
                            ...current,
                            startDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      结束日期
                      <input
                        required
                        type="date"
                        value={stageForm.endDate}
                        onChange={(event) =>
                          setStageForm((current) => ({
                            ...current,
                            endDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="stage-focus-field">
                      阶段重点
                      <textarea
                        rows={3}
                        maxLength={4000}
                        value={stageForm.focus}
                        onChange={(event) =>
                          setStageForm((current) => ({
                            ...current,
                            focus: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="plan-form-actions">
                      <button type="submit" disabled={saving}>
                        {stageForm.id === undefined ? "添加阶段" : "保存阶段"}
                      </button>
                      {stageForm.id === undefined ? null : (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => setStageForm(EMPTY_STAGE)}
                        >
                          取消编辑
                        </button>
                      )}
                    </div>
                  </form>
                </section>

                <PlanProgressPanel
                  planId={selected.plan.id}
                  timezone={workspaceTimezone}
                  scopeVersion={selected.stages
                    .map((stage) => `${stage.id}:${stage.updatedAt}`)
                    .join(",")}
                  refreshToken={progressRefreshToken}
                  onOpenSchedule={onOpenSchedule}
                />

                <PlanSchedulePanel
                  key={`${selected.plan.id}:${selected.plan.status}:${selected.stages
                    .map((stage) => `${stage.id}:${stage.updatedAt}`)
                    .join(",")}`}
                  plan={selected.plan}
                  stages={selected.stages}
                  subjects={subjects}
                  onOpenSchedule={onOpenSchedule}
                  onTasksCreated={() =>
                    setProgressRefreshToken((current) => current + 1)
                  }
                />

                <section
                  className="plan-subsection"
                  aria-labelledby="plan-reference-title"
                >
                  <h3 id="plan-reference-title">资料页码引用</h3>
                  {selected.references.length === 0 ? (
                    <p className="planning-note">
                      还没有引用，可把规划经验或习题册页码作为依据。
                    </p>
                  ) : (
                    <ul className="plan-reference-list">
                      {selected.references.map((reference) => (
                        <li key={reference.id}>
                          <button
                            type="button"
                            className="reference-open-button"
                            onClick={() =>
                              onOpenReference(
                                reference.documentId,
                                reference.pageStart,
                              )
                            }
                          >
                            <strong>{reference.documentTitle}</strong>
                            <span>
                              第 {reference.pageStart}
                              {reference.pageEnd === reference.pageStart
                                ? ""
                                : `-${reference.pageEnd}`}{" "}
                              页
                            </span>
                          </button>
                          {reference.note === undefined ? null : (
                            <p>{reference.note}</p>
                          )}
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => void removeReference(reference.id)}
                          >
                            删除引用
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form
                    className="reference-form"
                    onSubmit={(event) => void submitReference(event)}
                  >
                    <label>
                      PDF 资料
                      <select
                        required
                        value={referenceDocumentId}
                        onChange={(event) =>
                          setReferenceDocumentId(event.target.value)
                        }
                      >
                        {pdfResources.length === 0 ? (
                          <option value="">请先导入 PDF</option>
                        ) : null}
                        {pdfResources.map((resource) => (
                          <option key={resource.id} value={resource.id}>
                            {resource.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      起始页
                      <input
                        required
                        type="number"
                        min={1}
                        value={pageStart}
                        onChange={(event) => setPageStart(event.target.value)}
                      />
                    </label>
                    <label>
                      结束页
                      <input
                        required
                        type="number"
                        min={1}
                        value={pageEnd}
                        onChange={(event) => setPageEnd(event.target.value)}
                      />
                    </label>
                    <label className="reference-note-field">
                      引用说明
                      <input
                        maxLength={1000}
                        placeholder="例如：参考阶段划分，需结合自己的数学基础调整"
                        value={referenceNote}
                        onChange={(event) =>
                          setReferenceNote(event.target.value)
                        }
                      />
                    </label>
                    <button type="submit" disabled={referenceDocumentId === ""}>
                      添加引用
                    </button>
                  </form>
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function selectBundle(
  bundle: StudyPlanBundle,
  setSelectedId: (value: string) => void,
  setPlanForm: (value: PlanForm) => void,
): void {
  setSelectedId(bundle.plan.id);
  setPlanForm({
    title: bundle.plan.title,
    targetExam: bundle.plan.targetExam ?? "",
    examDate: bundle.plan.examDate ?? "",
    overview: bundle.plan.overview ?? "",
  });
}

function upsertBundle(
  bundles: StudyPlanBundle[],
  saved: StudyPlanBundle,
): StudyPlanBundle[] {
  return [
    saved,
    ...bundles.filter((bundle) => bundle.plan.id !== saved.plan.id),
  ];
}

function stageToForm(stage: PlanStage): StageForm {
  return {
    id: stage.id,
    title: stage.title,
    startDate: stage.startDate,
    endDate: stage.endDate,
    focus: stage.focus ?? "",
  };
}

function statusLabel(status: "draft" | "active" | "archived"): string {
  return { draft: "草案", active: "当前计划", archived: "已归档" }[status];
}
