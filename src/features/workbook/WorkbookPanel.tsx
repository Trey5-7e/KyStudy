import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { listKnowledgeMaps } from "../../shared/tauri/knowledgeClient";
import {
  addQuestionAttempt,
  addQuestionRegion,
  batchClassifyQuestions,
  createQuestion,
  deleteQuestionRegion,
  getWorkbookProfile,
  listTrashedQuestions,
  listWorkbookQuestions,
  normalizeQuestionError,
  restoreQuestion,
  setWorkbookDefaultSubject,
  trashQuestion,
  updateQuestion,
  type AttemptResult,
  type CreateQuestionInput,
  type QuestionBundle,
  type QuestionRegion,
  type QuestionRegionInput,
  type QuestionType,
  type UpdateQuestionInput,
  type WorkbookProfile,
} from "../../shared/tauri/questionClient";
import {
  getResourceReaderDescriptor,
  listResources,
  saveResourceReadingProgress,
  type ResourceCommandError,
  type ResourceDocument,
  type ResourceReaderDescriptor,
} from "../../shared/tauri/resourceClient";
import type {
  PdfReaderHandle,
  PdfRegionOverlay,
} from "../library/pdf/PdfReader";
import {
  listSubjects,
  localDateForTimezone,
  type StudySubject,
} from "../../shared/tauri/scheduleClient";
import { getWorkspaceStatus } from "../../shared/tauri/workspaceClient";
import {
  normalizeReviewError,
  setQuestionReview,
} from "../../shared/tauri/reviewClient";
import { QuestionOcrPanel } from "./QuestionOcrPanel";
import { EditorDialog } from "../../shared/components/EditorDialog";
import { QuestionBankPanel } from "./QuestionBankPanel";
import type { QuestionBankOpenRequest } from "./questionBankWindowModel";

const PdfReader = lazy(() =>
  import("../library/pdf/PdfReader").then((module) => ({
    default: module.PdfReader,
  })),
);

const QUESTION_TYPE_OPTIONS: ReadonlyArray<{
  value: QuestionType;
  label: string;
}> = [
  { value: "choice", label: "选择题" },
  { value: "blank", label: "填空题" },
  { value: "solution", label: "解答题" },
  { value: "other", label: "其他" },
];

interface KnowledgeOption {
  nodeId: string;
  label: string;
}

interface QuestionCreateFormProps {
  documentId: string;
  region: QuestionRegionInput;
  knowledgeOptions: KnowledgeOption[];
  subjects: StudySubject[];
  busy: boolean;
  onSave(input: CreateQuestionInput): Promise<boolean>;
  onCancel(): void;
}

interface QuestionEditorProps {
  bundle: QuestionBundle;
  knowledgeOptions: KnowledgeOption[];
  subjects: StudySubject[];
  busy: boolean;
  onSave(input: UpdateQuestionInput): Promise<boolean>;
  onOpenRegion(region: QuestionRegion): void;
  onDeleteRegion(regionId: string): void;
  onAddAttempt(
    result: AttemptResult,
    durationSeconds: number | undefined,
    answerNote: string | undefined,
  ): Promise<boolean>;
  onActivateReview(userPriority: number): Promise<boolean>;
  onCaptureRegion(region: QuestionRegion): Promise<Uint8Array>;
  onTrash(): void;
  onDirtyChange(dirty: boolean): void;
}

export function WorkbookPanel({
  openRequest,
}: {
  openRequest?: QuestionBankOpenRequest;
}) {
  return <QuestionBankPanel openRequest={openRequest} />;
}

export function LegacyManualWorkbookPanel() {
  const [resources, setResources] = useState<ResourceDocument[]>([]);
  const [questions, setQuestions] = useState<QuestionBundle[]>([]);
  const [trashed, setTrashed] = useState<QuestionBundle[]>([]);
  const [knowledgeOptions, setKnowledgeOptions] = useState<KnowledgeOption[]>(
    [],
  );
  const [subjects, setSubjects] = useState<StudySubject[]>([]);
  const [workbookProfile, setWorkbookProfile] = useState<WorkbookProfile>();
  const [timezone, setTimezone] = useState("Asia/Shanghai");
  const [selectedWorkbookId, setSelectedWorkbookId] = useState<string>();
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>();
  const [questionEditorOpen, setQuestionEditorOpen] = useState(false);
  const [questionEditorDirty, setQuestionEditorDirty] = useState(false);
  const [reader, setReader] = useState<ResourceReaderDescriptor>();
  const [requestedPage, setRequestedPage] = useState<number>();
  const [readerNonce, setReaderNonce] = useState(0);
  const [captureMode, setCaptureMode] = useState(false);
  const [captureTarget, setCaptureTarget] = useState("new");
  const [pendingRegion, setPendingRegion] = useState<QuestionRegionInput>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ResourceCommandError>();
  const lastSavedProgress = useRef<string | undefined>(undefined);
  const pdfReaderRef = useRef<PdfReaderHandle>(null);

  const workbooks = resources.filter(
    (resource) => resource.kind === "pdf" && resource.role === "workbook",
  );
  const effectiveWorkbookId = workbooks.some(
    (workbook) => workbook.id === selectedWorkbookId,
  )
    ? selectedWorkbookId
    : workbooks[0]?.id;
  const selectedQuestion =
    questions.find((bundle) => bundle.question.id === selectedQuestionId) ??
    questions[0];
  const regionOverlays: PdfRegionOverlay[] = questions.flatMap((bundle) =>
    bundle.regions.map((region) => ({
      id: region.id,
      pageNumber: region.pageNumber,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    })),
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      listResources(),
      listKnowledgeMaps(),
      listTrashedQuestions(),
      getWorkspaceStatus(),
      listSubjects(),
    ]).then(
      ([loadedResources, maps, loadedTrashed, workspace, loadedSubjects]) => {
        if (!active) {
          return;
        }
        setResources(loadedResources);
        setKnowledgeOptions(
          maps.flatMap((bundle) =>
            bundle.nodes.map((node) => ({
              nodeId: node.id,
              label: `${bundle.map.title} / ${node.title}`,
            })),
          ),
        );
        setTrashed(loadedTrashed);
        setTimezone(workspace?.timezone ?? "Asia/Shanghai");
        setSubjects(
          loadedSubjects.filter((subject) => subject.archivedAt === undefined),
        );
        setSelectedWorkbookId(
          loadedResources.find(
            (resource) =>
              resource.kind === "pdf" && resource.role === "workbook",
          )?.id,
        );
      },
      (loadError: unknown) => {
        if (active) {
          setError(normalizeQuestionError(loadError));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (effectiveWorkbookId === undefined) {
      return;
    }
    let active = true;
    void Promise.all([
      getResourceReaderDescriptor(effectiveWorkbookId),
      listWorkbookQuestions(effectiveWorkbookId),
      getWorkbookProfile(effectiveWorkbookId),
    ]).then(
      ([descriptor, loadedQuestions, profile]) => {
        if (active) {
          setReader(descriptor);
          setQuestions(loadedQuestions);
          setWorkbookProfile(profile);
          setSelectedQuestionId((current) =>
            loadedQuestions.some((bundle) => bundle.question.id === current)
              ? current
              : loadedQuestions[0]?.question.id,
          );
          setLoading(false);
        }
      },
      (loadError: unknown) => {
        if (active) {
          setError(normalizeQuestionError(loadError));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [effectiveWorkbookId]);

  const refresh = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const [loadedResources, maps, loadedTrashed, workspace, loadedSubjects] =
        await Promise.all([
          listResources(),
          listKnowledgeMaps(),
          listTrashedQuestions(),
          getWorkspaceStatus(),
          listSubjects(),
        ]);
      const nextWorkbooks = loadedResources.filter(
        (resource) => resource.kind === "pdf" && resource.role === "workbook",
      );
      const nextWorkbookId = nextWorkbooks.some(
        (workbook) => workbook.id === effectiveWorkbookId,
      )
        ? effectiveWorkbookId
        : nextWorkbooks[0]?.id;
      const [descriptor, loadedQuestions, profile] =
        nextWorkbookId === undefined
          ? [undefined, [], undefined]
          : await Promise.all([
              getResourceReaderDescriptor(nextWorkbookId),
              listWorkbookQuestions(nextWorkbookId),
              getWorkbookProfile(nextWorkbookId),
            ]);
      setResources(loadedResources);
      setKnowledgeOptions(
        maps.flatMap((bundle) =>
          bundle.nodes.map((node) => ({
            nodeId: node.id,
            label: `${bundle.map.title} / ${node.title}`,
          })),
        ),
      );
      setTrashed(loadedTrashed);
      setTimezone(workspace?.timezone ?? "Asia/Shanghai");
      setSubjects(
        loadedSubjects.filter((subject) => subject.archivedAt === undefined),
      );
      setSelectedWorkbookId(nextWorkbookId);
      setReader(descriptor);
      setQuestions(loadedQuestions);
      setWorkbookProfile(profile);
      setSelectedQuestionId(loadedQuestions[0]?.question.id);
      setCaptureTarget("new");
    } catch (refreshError: unknown) {
      setError(normalizeQuestionError(refreshError));
    } finally {
      setBusy(false);
    }
  };

  const upsertQuestion = (saved: QuestionBundle) => {
    setQuestions((current) => [
      saved,
      ...current.filter((bundle) => bundle.question.id !== saved.question.id),
    ]);
    setSelectedQuestionId(saved.question.id);
  };

  const runQuestion = async (
    operation: () => Promise<QuestionBundle>,
  ): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      upsertQuestion(await operation());
      return true;
    } catch (operationError: unknown) {
      setError(normalizeQuestionError(operationError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveWorkbookSubject = async (subjectId: string) => {
    if (effectiveWorkbookId === undefined) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const profile = await setWorkbookDefaultSubject({
        documentId: effectiveWorkbookId,
        ...(subjectId === "" ? {} : { subjectId }),
      });
      const loadedQuestions = await listWorkbookQuestions(effectiveWorkbookId);
      setWorkbookProfile(profile);
      setQuestions(loadedQuestions);
    } catch (subjectError: unknown) {
      setError(normalizeQuestionError(subjectError));
    } finally {
      setBusy(false);
    }
  };

  const classifyPendingQuestions = async (questionType: QuestionType) => {
    if (effectiveWorkbookId === undefined) {
      return;
    }
    const questionIds = questions
      .filter((bundle) => bundle.question.questionType === undefined)
      .map((bundle) => bundle.question.id);
    if (questionIds.length === 0) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const changed = await batchClassifyQuestions({
        documentId: effectiveWorkbookId,
        questionIds,
        questionType,
      });
      const changedById = new Map(
        changed.map((bundle) => [bundle.question.id, bundle]),
      );
      setQuestions((current) =>
        current.map((bundle) => changedById.get(bundle.question.id) ?? bundle),
      );
      setWorkbookProfile((current) =>
        current === undefined
          ? current
          : { ...current, pendingClassificationCount: 0 },
      );
    } catch (classificationError: unknown) {
      setError(normalizeQuestionError(classificationError));
    } finally {
      setBusy(false);
    }
  };

  const captureRegion = (region: Omit<PdfRegionOverlay, "id">) => {
    const input: QuestionRegionInput = region;
    if (captureTarget === "new") {
      setPendingRegion(input);
      setCaptureMode(false);
      return;
    }
    void runQuestion(() => addQuestionRegion(captureTarget, input)).then(
      (saved) => {
        if (saved) {
          setCaptureMode(false);
        }
      },
    );
  };

  const openRegion = (region: QuestionRegion) => {
    setRequestedPage(region.pageNumber);
    setReaderNonce((current) => current + 1);
    document
      .getElementById("workbook-reader-title")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const readerDocumentId = reader?.documentId;
  const persistProgress = useCallback(
    (pageCount: number, lastPage: number) => {
      if (readerDocumentId === undefined) {
        return;
      }
      const key = `${readerDocumentId}:${pageCount}:${lastPage}`;
      if (lastSavedProgress.current === key) {
        return;
      }
      lastSavedProgress.current = key;
      void saveResourceReadingProgress(
        readerDocumentId,
        pageCount,
        lastPage,
      ).catch((progressError: unknown) => {
        lastSavedProgress.current = undefined;
        setError(normalizeQuestionError(progressError));
      });
    },
    [readerDocumentId],
  );

  const captureOcrRegion = useCallback(
    (region: QuestionRegion): Promise<Uint8Array> => {
      const currentReader = pdfReaderRef.current;
      if (currentReader === null) {
        return Promise.reject(new Error("PDF_READER_NOT_READY"));
      }
      return currentReader.captureRegionPng(region);
    },
    [],
  );

  const removeQuestion = async () => {
    if (selectedQuestion === undefined) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await trashQuestion(selectedQuestion.question.id);
      const [loadedQuestions, loadedTrashed] = await Promise.all([
        effectiveWorkbookId === undefined
          ? Promise.resolve([])
          : listWorkbookQuestions(effectiveWorkbookId),
        listTrashedQuestions(),
      ]);
      setQuestions(loadedQuestions);
      setTrashed(loadedTrashed);
      setSelectedQuestionId(loadedQuestions[0]?.question.id);
      setCaptureTarget("new");
    } catch (trashError: unknown) {
      setError(normalizeQuestionError(trashError));
    } finally {
      setBusy(false);
    }
  };

  const activateReview = async (
    questionId: string,
    userPriority: number,
  ): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      await setQuestionReview({
        questionId,
        active: true,
        userPriority,
        today: localDateForTimezone(new Date(), timezone),
      });
      return true;
    } catch (reviewError: unknown) {
      setError(normalizeReviewError(reviewError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const restore = async (questionId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      const restored = await restoreQuestion(questionId);
      setTrashed((current) =>
        current.filter((bundle) => bundle.question.id !== questionId),
      );
      if (restored.question.documentId === effectiveWorkbookId) {
        upsertQuestion(restored);
      }
    } catch (restoreError: unknown) {
      setError(normalizeQuestionError(restoreError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="workbook-card" aria-labelledby="workbook-title">
      <div className="workbook-heading">
        <div>
          <h2 id="workbook-title">PDF 习题册与题目</h2>
          <p>
            从原 PDF
            页面直接保存题目区域；缩放、旋转和屏幕像素不会进入正式数据。
          </p>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          刷新习题册与导图
        </button>
      </div>

      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
        </div>
      )}

      {workbooks.length === 0 ? (
        <p className="empty-state">
          资料库中还没有“习题册”用途的 PDF。先导入 PDF
          并修改用途，然后点击刷新。
        </p>
      ) : (
        <>
          <div className="workbook-toolbar">
            <label>
              当前习题册
              <select
                name="current-workbook"
                autoComplete="off"
                value={effectiveWorkbookId}
                disabled={busy}
                onChange={(event) => {
                  setLoading(true);
                  setSelectedWorkbookId(event.target.value);
                  setReader(undefined);
                  setQuestions([]);
                  setWorkbookProfile(undefined);
                  setSelectedQuestionId(undefined);
                  setRequestedPage(undefined);
                  setPendingRegion(undefined);
                  setCaptureMode(false);
                  setCaptureTarget("new");
                }}
              >
                {workbooks.map((workbook) => (
                  <option key={workbook.id} value={workbook.id}>
                    {workbook.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              默认科目
              <select
                name="workbook-default-subject"
                autoComplete="off"
                value={workbookProfile?.defaultSubjectId ?? ""}
                disabled={busy}
                onChange={(event) =>
                  void saveWorkbookSubject(event.target.value)
                }
              >
                <option value="">未设置</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              框选后
              <select
                name="question-capture-target"
                autoComplete="off"
                value={captureTarget}
                onChange={(event) => setCaptureTarget(event.target.value)}
              >
                <option value="new">创建新题目</option>
                {questions.map((bundle) => (
                  <option key={bundle.question.id} value={bundle.question.id}>
                    追加到：{bundle.question.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || reader === undefined}
              onClick={() => {
                setCaptureMode((current) => !current);
                setPendingRegion(undefined);
              }}
            >
              {captureMode ? "退出框选" : "开始框选题目"}
            </button>
            {captureMode ? (
              <span role="status">请在 PDF 页面上按住鼠标拖出矩形。</span>
            ) : null}
          </div>

          {workbookProfile?.pendingClassificationCount === 0 ? null : (
            <section
              className="workbook-classification-bar"
              aria-labelledby="pending-classification-title"
            >
              <div>
                <strong id="pending-classification-title">
                  {workbookProfile?.pendingClassificationCount ?? 0}{" "}
                  道旧题待分类
                </strong>
                <span>可一次把当前未分类题设为同一题型。</span>
              </div>
              <div className="question-type-actions">
                {QUESTION_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => void classifyPendingQuestions(option.value)}
                  >
                    全部设为{option.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {reader === undefined ? (
            <p className="empty-state">正在打开习题册…</p>
          ) : (
            <section
              className="workbook-reader"
              aria-labelledby="workbook-reader-title"
            >
              <h3 id="workbook-reader-title">{reader.title}</h3>
              <Suspense
                fallback={<p className="empty-state">正在加载 PDF 阅读器…</p>}
              >
                <PdfReader
                  ref={pdfReaderRef}
                  key={`${reader.documentId}:${readerNonce}`}
                  descriptor={reader}
                  requestedPage={requestedPage}
                  onProgress={persistProgress}
                  regions={regionOverlays}
                  captureMode={captureMode}
                  onRegionCapture={captureRegion}
                />
              </Suspense>
            </section>
          )}

          {pendingRegion === undefined ||
          effectiveWorkbookId === undefined ? null : (
            <EditorDialog
              title="新建题目"
              description={`保存第 ${pendingRegion.pageNumber} 页刚刚框选的题目区域。`}
              dirty
              onRequestClose={() => setPendingRegion(undefined)}
              size="large"
            >
              <QuestionCreateForm
                documentId={effectiveWorkbookId}
                region={pendingRegion}
                knowledgeOptions={knowledgeOptions}
                subjects={subjects}
                busy={busy}
                onSave={(input) => runQuestion(() => createQuestion(input))}
                onCancel={() => setPendingRegion(undefined)}
              />
            </EditorDialog>
          )}

          <div className="workbook-question-layout">
            <div className="workbook-question-list" aria-label="习题列表">
              {loading ? (
                <p className="empty-state">正在读取题目…</p>
              ) : questions.length === 0 ? (
                <p className="empty-state">还没有题目，可以先在 PDF 上框选。</p>
              ) : (
                questions.map((bundle) => (
                  <button
                    key={bundle.question.id}
                    type="button"
                    className={
                      bundle.question.id === selectedQuestion?.question.id
                        ? "workbook-question-active"
                        : undefined
                    }
                    onClick={() => setSelectedQuestionId(bundle.question.id)}
                  >
                    <strong>{bundle.question.title}</strong>
                    <span>
                      {questionTypeLabel(bundle.question.questionType)} ·{" "}
                      {bundle.question.subjectName ?? "未设置科目"} ·{" "}
                      {bundle.regions.length} 个区域 · {bundle.attempts.length}{" "}
                      次作答
                    </span>
                  </button>
                ))
              )}
            </div>

            {selectedQuestion === undefined ? null : (
              <article className="question-summary-card">
                <div>
                  <p className="section-label">当前题目</p>
                  <h3>{selectedQuestion.question.title}</h3>
                  <p>
                    {questionTypeLabel(selectedQuestion.question.questionType)}{" "}
                    · {selectedQuestion.question.subjectName ?? "未设置科目"} ·{" "}
                    {selectedQuestion.regions.length} 个区域 ·{" "}
                    {selectedQuestion.attempts.length} 次作答
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setQuestionEditorDirty(false);
                    setQuestionEditorOpen(true);
                  }}
                >
                  编辑题目
                </button>
              </article>
            )}
          </div>

          {selectedQuestion === undefined || !questionEditorOpen ? null : (
            <EditorDialog
              title={`编辑题目：${selectedQuestion.question.title}`}
              description="题目资料、OCR、错题状态和作答记录集中在此弹窗。"
              dirty={questionEditorDirty}
              onRequestClose={() => setQuestionEditorOpen(false)}
              size="large"
            >
              <QuestionEditor
                key={`${selectedQuestion.question.id}:${selectedQuestion.question.updatedAt}`}
                bundle={selectedQuestion}
                knowledgeOptions={knowledgeOptions}
                subjects={subjects}
                busy={busy}
                onSave={(input) => runQuestion(() => updateQuestion(input))}
                onOpenRegion={(region) => {
                  setQuestionEditorOpen(false);
                  openRegion(region);
                }}
                onDeleteRegion={(regionId) =>
                  void runQuestion(() => deleteQuestionRegion(regionId))
                }
                onAddAttempt={(result, durationSeconds, answerNote) =>
                  runQuestion(() =>
                    addQuestionAttempt({
                      questionId: selectedQuestion.question.id,
                      result,
                      attemptedOn: localDateForTimezone(new Date(), timezone),
                      durationSeconds,
                      answerNote,
                    }),
                  )
                }
                onActivateReview={(userPriority) =>
                  activateReview(selectedQuestion.question.id, userPriority)
                }
                onCaptureRegion={captureOcrRegion}
                onTrash={() => {
                  setQuestionEditorOpen(false);
                  void removeQuestion();
                }}
                onDirtyChange={setQuestionEditorDirty}
              />
            </EditorDialog>
          )}
        </>
      )}

      <details className="workbook-trash">
        <summary>题目回收站（{trashed.length}）</summary>
        {trashed.length === 0 ? (
          <p>回收站为空。</p>
        ) : (
          <ul>
            {trashed.map((bundle) => (
              <li key={bundle.question.id}>
                <span>
                  {bundle.question.documentTitle} / {bundle.question.title}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void restore(bundle.question.id)}
                >
                  恢复
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function QuestionCreateForm({
  documentId,
  region,
  knowledgeOptions,
  subjects,
  busy,
  onSave,
  onCancel,
}: QuestionCreateFormProps) {
  const [title, setTitle] = useState(`第 ${region.pageNumber} 页题目`);
  const [subjectId, setSubjectId] = useState("");
  const [questionType, setQuestionType] = useState<QuestionType | "">("");
  const [chapter, setChapter] = useState("");
  const [questionNumber, setQuestionNumber] = useState("");
  const [difficulty, setDifficulty] = useState("3");
  const [analysisMarkdown, setAnalysisMarkdown] = useState("");
  const [knowledgeNodeId, setKnowledgeNodeId] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const saved = await onSave({
      documentId,
      title,
      subjectId: optionalText(subjectId),
      questionType: questionType === "" ? undefined : questionType,
      chapter: optionalText(chapter),
      questionNumber: optionalText(questionNumber),
      difficulty: Number(difficulty),
      analysisMarkdown: optionalText(analysisMarkdown),
      region,
      knowledgeNodeIds: knowledgeNodeId === "" ? [] : [knowledgeNodeId],
    });
    if (saved) {
      onCancel();
    }
  };

  return (
    <form
      className="question-create-form"
      onSubmit={(event) => void submit(event)}
    >
      <QuestionFields
        title={title}
        subjectId={subjectId}
        questionType={questionType}
        chapter={chapter}
        questionNumber={questionNumber}
        difficulty={difficulty}
        analysisMarkdown={analysisMarkdown}
        knowledgeNodeId={knowledgeNodeId}
        knowledgeOptions={knowledgeOptions}
        subjects={subjects}
        onTitle={setTitle}
        onSubjectId={setSubjectId}
        onQuestionType={setQuestionType}
        onChapter={setChapter}
        onQuestionNumber={setQuestionNumber}
        onDifficulty={setDifficulty}
        onAnalysis={setAnalysisMarkdown}
        onKnowledgeNode={setKnowledgeNodeId}
      />
      <div className="question-form-actions">
        <button type="submit" disabled={busy}>
          保存题目
        </button>
      </div>
    </form>
  );
}

function QuestionEditor({
  bundle,
  knowledgeOptions,
  subjects,
  busy,
  onSave,
  onOpenRegion,
  onDeleteRegion,
  onAddAttempt,
  onActivateReview,
  onCaptureRegion,
  onTrash,
  onDirtyChange,
}: QuestionEditorProps) {
  const question = bundle.question;
  const [title, setTitle] = useState(question.title);
  const [subjectId, setSubjectId] = useState(
    question.subjectInherited ? "" : (question.subjectId ?? ""),
  );
  const [questionType, setQuestionType] = useState<QuestionType | "">(
    question.questionType ?? "",
  );
  const [chapter, setChapter] = useState(question.chapter ?? "");
  const [questionNumber, setQuestionNumber] = useState(
    question.questionNumber ?? "",
  );
  const [difficulty, setDifficulty] = useState(String(question.difficulty));
  const [analysisMarkdown, setAnalysisMarkdown] = useState(
    question.analysisMarkdown ?? "",
  );
  const [knowledgeNodeId, setKnowledgeNodeId] = useState(
    bundle.knowledgeLinks[0]?.nodeId ?? "",
  );
  const [attemptResult, setAttemptResult] =
    useState<AttemptResult>("incorrect");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [answerNote, setAnswerNote] = useState("");
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [reviewPriority, setReviewPriority] = useState("3");
  const [reviewActivated, setReviewActivated] = useState(false);

  useEffect(() => {
    const initialSubjectId = question.subjectInherited
      ? ""
      : (question.subjectId ?? "");
    const dirty =
      title !== question.title ||
      subjectId !== initialSubjectId ||
      questionType !== (question.questionType ?? "") ||
      chapter !== (question.chapter ?? "") ||
      questionNumber !== (question.questionNumber ?? "") ||
      difficulty !== String(question.difficulty) ||
      analysisMarkdown !== (question.analysisMarkdown ?? "") ||
      knowledgeNodeId !== (bundle.knowledgeLinks[0]?.nodeId ?? "") ||
      attemptResult !== "incorrect" ||
      durationMinutes !== "" ||
      answerNote !== "" ||
      reviewPriority !== "3";
    onDirtyChange(dirty);
  }, [
    analysisMarkdown,
    answerNote,
    attemptResult,
    bundle.knowledgeLinks,
    chapter,
    difficulty,
    durationMinutes,
    knowledgeNodeId,
    onDirtyChange,
    question,
    questionNumber,
    questionType,
    reviewPriority,
    subjectId,
    title,
  ]);

  const submitDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({
      questionId: question.id,
      title,
      subjectId: optionalText(subjectId),
      questionType: questionType === "" ? undefined : questionType,
      chapter: optionalText(chapter),
      questionNumber: optionalText(questionNumber),
      difficulty: Number(difficulty),
      analysisMarkdown: optionalText(analysisMarkdown),
      knowledgeNodeIds: knowledgeNodeId === "" ? [] : [knowledgeNodeId],
    });
  };

  const submitAttempt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const minutes =
      durationMinutes === "" ? undefined : Number(durationMinutes);
    const saved = await onAddAttempt(
      attemptResult,
      minutes === undefined ? undefined : Math.round(minutes * 60),
      optionalText(answerNote),
    );
    if (saved) {
      setAttemptResult("incorrect");
      setDurationMinutes("");
      setAnswerNote("");
    }
  };

  return (
    <article className="question-editor">
      <form onSubmit={(event) => void submitDetails(event)}>
        <QuestionFields
          title={title}
          subjectId={subjectId}
          questionType={questionType}
          chapter={chapter}
          questionNumber={questionNumber}
          difficulty={difficulty}
          analysisMarkdown={analysisMarkdown}
          knowledgeNodeId={knowledgeNodeId}
          knowledgeOptions={knowledgeOptions}
          subjects={subjects}
          onTitle={setTitle}
          onSubjectId={setSubjectId}
          onQuestionType={setQuestionType}
          onChapter={setChapter}
          onQuestionNumber={setQuestionNumber}
          onDifficulty={setDifficulty}
          onAnalysis={setAnalysisMarkdown}
          onKnowledgeNode={setKnowledgeNodeId}
        />
        <div className="question-form-actions">
          <button type="submit" disabled={busy}>
            保存修改
          </button>
          {confirmTrash ? (
            <>
              <button
                type="button"
                className="danger-button"
                disabled={busy}
                onClick={onTrash}
              >
                确认移入回收站
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmTrash(false)}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() => setConfirmTrash(true)}
            >
              删除题目
            </button>
          )}
        </div>
      </form>

      <section className="question-review-entry">
        <div>
          <h4>错题复习</h4>
          <p>错误作答会自动加入；也可以不新增错误记录，直接手动加入复习。</p>
        </div>
        <label>
          重要度
          <select
            name="question-review-priority"
            autoComplete="off"
            value={reviewPriority}
            onChange={(event) => setReviewPriority(event.target.value)}
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            void onActivateReview(Number(reviewPriority)).then((saved) => {
              setReviewActivated(saved);
              if (saved) {
                setReviewPriority("3");
              }
            });
          }}
        >
          加入或更新错题复习
        </button>
        {reviewActivated ? <span role="status">已加入错题复习</span> : null}
      </section>

      <QuestionOcrPanel
        questionId={question.id}
        regions={bundle.regions}
        captureRegion={onCaptureRegion}
      />

      <section
        className="question-regions"
        aria-labelledby="question-regions-title"
      >
        <h4 id="question-regions-title">来源区域</h4>
        <ul>
          {bundle.regions.map((region) => (
            <li key={region.id}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => onOpenRegion(region)}
              >
                第 {region.pageNumber} 页 · 区域 {region.sortOrder + 1}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={busy || bundle.regions.length === 1}
                onClick={() => onDeleteRegion(region.id)}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="question-attempts"
        aria-labelledby="question-attempt-title"
      >
        <h4 id="question-attempt-title">追加作答</h4>
        <form onSubmit={(event) => void submitAttempt(event)}>
          <label>
            结果
            <select
              name="question-attempt-result"
              autoComplete="off"
              value={attemptResult}
              onChange={(event) =>
                setAttemptResult(event.target.value as AttemptResult)
              }
            >
              <option value="incorrect">错误</option>
              <option value="uncertain">不确定</option>
              <option value="correct">正确</option>
            </select>
          </label>
          <label>
            耗时（分钟，可选）
            <input
              name="question-attempt-duration"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              min="0.1"
              max="1440"
              step="0.1"
              value={durationMinutes}
              onChange={(event) => setDurationMinutes(event.target.value)}
            />
          </label>
          <label className="question-wide-field">
            本次答案与复盘
            <textarea
              name="question-attempt-note"
              autoComplete="off"
              rows={3}
              maxLength={10_000}
              value={answerNote}
              onChange={(event) => setAnswerNote(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            记录本次作答
          </button>
        </form>

        {bundle.attempts.length === 0 ? (
          <p className="empty-state">还没有作答记录。</p>
        ) : (
          <ol>
            {bundle.attempts.map((attempt) => (
              <li key={attempt.id}>
                <strong>{attemptResultLabel(attempt.result)}</strong>
                <time>{new Date(attempt.attemptedAt).toLocaleString()}</time>
                {attempt.durationSeconds === undefined ? null : (
                  <span>耗时 {formatDuration(attempt.durationSeconds)}</span>
                )}
                {attempt.answerNote === undefined ? null : (
                  <p>{attempt.answerNote}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  );
}

interface QuestionFieldsProps {
  title: string;
  subjectId: string;
  questionType: QuestionType | "";
  chapter: string;
  questionNumber: string;
  difficulty: string;
  analysisMarkdown: string;
  knowledgeNodeId: string;
  knowledgeOptions: KnowledgeOption[];
  subjects: StudySubject[];
  onTitle(value: string): void;
  onSubjectId(value: string): void;
  onQuestionType(value: QuestionType | ""): void;
  onChapter(value: string): void;
  onQuestionNumber(value: string): void;
  onDifficulty(value: string): void;
  onAnalysis(value: string): void;
  onKnowledgeNode(value: string): void;
}

function QuestionFields(props: QuestionFieldsProps) {
  return (
    <div className="question-fields">
      <label className="question-wide-field">
        题目名称
        <input
          name="question-title"
          autoComplete="off"
          required
          maxLength={200}
          value={props.title}
          onChange={(event) => props.onTitle(event.target.value)}
        />
      </label>
      <label>
        科目
        <select
          name="question-subject"
          autoComplete="off"
          value={props.subjectId}
          onChange={(event) => props.onSubjectId(event.target.value)}
        >
          <option value="">继承习题册</option>
          {props.subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="question-type-field question-wide-field">
        <legend>题型</legend>
        <div className="question-type-actions">
          <button
            type="button"
            aria-pressed={props.questionType === ""}
            onClick={() => props.onQuestionType("")}
          >
            自动识别
          </button>
          {QUESTION_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={props.questionType === option.value}
              onClick={() => props.onQuestionType(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <small>自动识别置信度不足时会标记为“待分类”，不会进入每日队列。</small>
      </fieldset>
      <label>
        章节
        <input
          name="question-chapter"
          autoComplete="off"
          maxLength={120}
          value={props.chapter}
          onChange={(event) => props.onChapter(event.target.value)}
        />
      </label>
      <label>
        题号
        <input
          name="question-number"
          autoComplete="off"
          maxLength={60}
          value={props.questionNumber}
          onChange={(event) => props.onQuestionNumber(event.target.value)}
        />
      </label>
      <label>
        难度
        <select
          name="question-difficulty"
          autoComplete="off"
          value={props.difficulty}
          onChange={(event) => props.onDifficulty(event.target.value)}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        知识节点（可选）
        <select
          name="question-knowledge-node"
          autoComplete="off"
          value={props.knowledgeNodeId}
          onChange={(event) => props.onKnowledgeNode(event.target.value)}
        >
          <option value="">未关联</option>
          {props.knowledgeOptions.map((option) => (
            <option key={option.nodeId} value={option.nodeId}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="question-wide-field">
        个人解析
        <textarea
          name="question-analysis"
          autoComplete="off"
          rows={5}
          maxLength={20_000}
          value={props.analysisMarkdown}
          onChange={(event) => props.onAnalysis(event.target.value)}
        />
      </label>
    </div>
  );
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function questionTypeLabel(value: QuestionType | undefined): string {
  return (
    QUESTION_TYPE_OPTIONS.find((option) => option.value === value)?.label ??
    "待分类"
  );
}

function attemptResultLabel(result: AttemptResult): string {
  return { correct: "正确", incorrect: "错误", uncertain: "不确定" }[result];
}

function formatDuration(seconds: number): string {
  return seconds < 60 ? `${seconds} 秒` : `${(seconds / 60).toFixed(1)} 分钟`;
}
