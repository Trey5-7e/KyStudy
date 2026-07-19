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
  createQuestion,
  deleteQuestionRegion,
  listTrashedQuestions,
  listWorkbookQuestions,
  normalizeQuestionError,
  restoreQuestion,
  trashQuestion,
  updateQuestion,
  type AttemptResult,
  type CreateQuestionInput,
  type QuestionBundle,
  type QuestionRegion,
  type QuestionRegionInput,
  type UpdateQuestionInput,
} from "../../shared/tauri/questionClient";
import {
  getResourceReaderDescriptor,
  listResources,
  saveResourceReadingProgress,
  type ResourceCommandError,
  type ResourceDocument,
  type ResourceReaderDescriptor,
} from "../../shared/tauri/resourceClient";
import type { PdfRegionOverlay } from "../library/pdf/PdfReader";

const PdfReader = lazy(() =>
  import("../library/pdf/PdfReader").then((module) => ({
    default: module.PdfReader,
  })),
);

interface KnowledgeOption {
  nodeId: string;
  label: string;
}

interface QuestionCreateFormProps {
  documentId: string;
  region: QuestionRegionInput;
  knowledgeOptions: KnowledgeOption[];
  busy: boolean;
  onSave(input: CreateQuestionInput): Promise<boolean>;
  onCancel(): void;
}

interface QuestionEditorProps {
  bundle: QuestionBundle;
  knowledgeOptions: KnowledgeOption[];
  busy: boolean;
  onSave(input: UpdateQuestionInput): Promise<boolean>;
  onOpenRegion(region: QuestionRegion): void;
  onDeleteRegion(regionId: string): void;
  onAddAttempt(
    result: AttemptResult,
    durationSeconds: number | undefined,
    answerNote: string | undefined,
  ): Promise<boolean>;
  onTrash(): void;
}

export function WorkbookPanel() {
  const [resources, setResources] = useState<ResourceDocument[]>([]);
  const [questions, setQuestions] = useState<QuestionBundle[]>([]);
  const [trashed, setTrashed] = useState<QuestionBundle[]>([]);
  const [knowledgeOptions, setKnowledgeOptions] = useState<KnowledgeOption[]>(
    [],
  );
  const [selectedWorkbookId, setSelectedWorkbookId] = useState<string>();
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>();
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
    ]).then(
      ([loadedResources, maps, loadedTrashed]) => {
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
    ]).then(
      ([descriptor, loadedQuestions]) => {
        if (active) {
          setReader(descriptor);
          setQuestions(loadedQuestions);
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
      const [loadedResources, maps, loadedTrashed] = await Promise.all([
        listResources(),
        listKnowledgeMaps(),
        listTrashedQuestions(),
      ]);
      const nextWorkbooks = loadedResources.filter(
        (resource) => resource.kind === "pdf" && resource.role === "workbook",
      );
      const nextWorkbookId = nextWorkbooks.some(
        (workbook) => workbook.id === effectiveWorkbookId,
      )
        ? effectiveWorkbookId
        : nextWorkbooks[0]?.id;
      const [descriptor, loadedQuestions] =
        nextWorkbookId === undefined
          ? [undefined, []]
          : await Promise.all([
              getResourceReaderDescriptor(nextWorkbookId),
              listWorkbookQuestions(nextWorkbookId),
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
      setSelectedWorkbookId(nextWorkbookId);
      setReader(descriptor);
      setQuestions(loadedQuestions);
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
          <p className="section-label">M5 · PDF 习题册</p>
          <h2 id="workbook-title">手动框选题目与作答记录</h2>
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
                value={effectiveWorkbookId}
                disabled={busy}
                onChange={(event) => {
                  setLoading(true);
                  setSelectedWorkbookId(event.target.value);
                  setReader(undefined);
                  setQuestions([]);
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
              框选后
              <select
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
            <QuestionCreateForm
              documentId={effectiveWorkbookId}
              region={pendingRegion}
              knowledgeOptions={knowledgeOptions}
              busy={busy}
              onSave={(input) => runQuestion(() => createQuestion(input))}
              onCancel={() => setPendingRegion(undefined)}
            />
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
                      {bundle.regions.length} 个区域 · {bundle.attempts.length}{" "}
                      次作答 · 难度 {bundle.question.difficulty}
                    </span>
                  </button>
                ))
              )}
            </div>

            {selectedQuestion === undefined ? null : (
              <QuestionEditor
                key={`${selectedQuestion.question.id}:${selectedQuestion.question.updatedAt}`}
                bundle={selectedQuestion}
                knowledgeOptions={knowledgeOptions}
                busy={busy}
                onSave={(input) => runQuestion(() => updateQuestion(input))}
                onOpenRegion={openRegion}
                onDeleteRegion={(regionId) =>
                  void runQuestion(() => deleteQuestionRegion(regionId))
                }
                onAddAttempt={(result, durationSeconds, answerNote) =>
                  runQuestion(() =>
                    addQuestionAttempt({
                      questionId: selectedQuestion.question.id,
                      result,
                      durationSeconds,
                      answerNote,
                    }),
                  )
                }
                onTrash={() => void removeQuestion()}
              />
            )}
          </div>
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
  busy,
  onSave,
  onCancel,
}: QuestionCreateFormProps) {
  const [title, setTitle] = useState(`第 ${region.pageNumber} 页题目`);
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
      <h3>保存刚才框选的区域</h3>
      <QuestionFields
        title={title}
        chapter={chapter}
        questionNumber={questionNumber}
        difficulty={difficulty}
        analysisMarkdown={analysisMarkdown}
        knowledgeNodeId={knowledgeNodeId}
        knowledgeOptions={knowledgeOptions}
        onTitle={setTitle}
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
        <button type="button" className="secondary-button" onClick={onCancel}>
          放弃框选
        </button>
      </div>
    </form>
  );
}

function QuestionEditor({
  bundle,
  knowledgeOptions,
  busy,
  onSave,
  onOpenRegion,
  onDeleteRegion,
  onAddAttempt,
  onTrash,
}: QuestionEditorProps) {
  const question = bundle.question;
  const [title, setTitle] = useState(question.title);
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

  const submitDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSave({
      questionId: question.id,
      title,
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
      setDurationMinutes("");
      setAnswerNote("");
    }
  };

  return (
    <article className="question-editor">
      <form onSubmit={(event) => void submitDetails(event)}>
        <h3>题目详情</h3>
        <QuestionFields
          title={title}
          chapter={chapter}
          questionNumber={questionNumber}
          difficulty={difficulty}
          analysisMarkdown={analysisMarkdown}
          knowledgeNodeId={knowledgeNodeId}
          knowledgeOptions={knowledgeOptions}
          onTitle={setTitle}
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
              type="number"
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
  chapter: string;
  questionNumber: string;
  difficulty: string;
  analysisMarkdown: string;
  knowledgeNodeId: string;
  knowledgeOptions: KnowledgeOption[];
  onTitle(value: string): void;
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
          required
          maxLength={200}
          value={props.title}
          onChange={(event) => props.onTitle(event.target.value)}
        />
      </label>
      <label>
        章节
        <input
          maxLength={120}
          value={props.chapter}
          onChange={(event) => props.onChapter(event.target.value)}
        />
      </label>
      <label>
        题号
        <input
          maxLength={60}
          value={props.questionNumber}
          onChange={(event) => props.onQuestionNumber(event.target.value)}
        />
      </label>
      <label>
        难度
        <select
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

function attemptResultLabel(result: AttemptResult): string {
  return { correct: "正确", incorrect: "错误", uncertain: "不确定" }[result];
}

function formatDuration(seconds: number): string {
  return seconds < 60 ? `${seconds} 秒` : `${(seconds / 60).toFixed(1)} 分钟`;
}
