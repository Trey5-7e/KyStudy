import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import {
  getResourceReaderDescriptor,
  type ResourceDocument,
} from "../../shared/tauri/resourceClient";
import {
  importQuestionIndex,
  normalizeQuestionBankError,
  saveWorkbookSegments,
  type IndexedQuestion,
  type QuestionBankSnapshot,
  type WorkbookCategory,
  type WorkbookDocumentSegment,
} from "../../shared/tauri/questionBankClient";
import type { StudySubject } from "../../shared/tauri/scheduleClient";
import {
  analyzeWorkbookPdf,
  WorkbookPdfAnalyzeCanceledError,
  type DetectedPdfSubject,
} from "./pdfQuestionIndexer";
import {
  cancelOcr,
  getOcrStatus,
  normalizeOcrError,
  recognizePdfPage,
  type OcrComponentStatus,
} from "../../shared/tauri/ocrClient";
import {
  findMatchingSegments,
  segmentAssignmentConflict,
} from "./questionBankModel";
import { resolveWorkbookPdfProfile } from "./workbookPdfProfiles";
import {
  buildWorkbookPdfBaseline,
  serializeWorkbookPdfBaseline,
  workbookPdfBaselineFileName,
} from "./workbookPdfBaseline";

function bestSubjectMatch(
  subjects: StudySubject[],
  suggestedName: string,
): StudySubject | undefined {
  const normalized = suggestedName.trim().toLowerCase();
  return subjects.find(
    (subject) => subject.name.trim().toLowerCase() === normalized,
  );
}
interface SubjectAssignment {
  subjectId: string;
  workbookId: string;
}

type ImportIndexStep = "source" | "assign";

export function ImportIndexDialog({
  resources,
  subjects,
  workbooks,
  segments,
  questions,
  onClose,
  onRequestBack,
  backLabel,
  returnFocusRef,
  fallbackFocusRef,
  onImported,
}: {
  resources: ResourceDocument[];
  subjects: StudySubject[];
  workbooks: WorkbookCategory[];
  segments: WorkbookDocumentSegment[];
  questions: IndexedQuestion[];
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onImported(snapshot: QuestionBankSnapshot): void;
}) {
  const [documentId, setDocumentId] = useState(resources[0]?.id ?? "");
  const firstResourceId = resources[0]?.id ?? "";
  const documentIdIsAvailable = resources.some(
    (resource) => resource.id === documentId,
  );
  const effectiveDocumentId = documentIdIsAvailable
    ? documentId
    : firstResourceId;
  const [step, setStep] = useState<ImportIndexStep>("source");
  const [detected, setDetected] = useState<DetectedPdfSubject[]>([]);
  const [assignments, setAssignments] = useState<
    Record<string, SubjectAssignment>
  >({});
  const [progress, setProgress] = useState("");
  const [busy, setBusy] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState("");
  const [completedSubjectKeys, setCompletedSubjectKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [ocrStatus, setOcrStatus] = useState<OcrComponentStatus>();
  const [expandedDetectedKeys, setExpandedDetectedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const abortRef = useRef<AbortController | undefined>(undefined);
  const activeOcrOperationRef = useRef<string | undefined>(undefined);
  const runRef = useRef(0);
  const detectedQuestionCount = detected.reduce(
    (sum, value) => sum + value.questions.length,
    0,
  );
  const remainingDetected = useMemo(
    () => detected.filter((value) => !completedSubjectKeys.has(value.key)),
    [completedSubjectKeys, detected],
  );
  const remainingQuestionCount = remainingDetected.reduce(
    (sum, value) => sum + value.questions.length,
    0,
  );
  const allDetectedCompleted =
    detected.length > 0 && remainingDetected.length === 0;
  const hasEmptyRemainingSubject = remainingDetected.some(
    (value) => value.questions.length === 0,
  );
  const assignmentConflicts = useMemo(() => {
    const conflicts = new Map<
      string,
      NonNullable<ReturnType<typeof segmentAssignmentConflict>>
    >();
    for (const value of remainingDetected) {
      const assignment = assignments[value.key];
      if (
        assignment?.subjectId === undefined ||
        assignment.subjectId === "" ||
        assignment.workbookId === undefined ||
        assignment.workbookId === ""
      ) {
        continue;
      }
      const conflict = segmentAssignmentConflict(
        { segments, questions },
        {
          documentId: effectiveDocumentId,
          subjectId: assignment.subjectId,
          workbookId: assignment.workbookId,
          pageStart: value.pageStart,
          pageEnd: value.pageEnd,
        },
      );
      if (conflict !== undefined) conflicts.set(value.key, conflict);
    }
    return conflicts;
  }, [
    assignments,
    effectiveDocumentId,
    questions,
    remainingDetected,
    segments,
  ]);
  const hasAssignmentConflicts = assignmentConflicts.size > 0;
  const selectedResource = resources.find(
    (resource) => resource.id === effectiveDocumentId,
  );
  const cancelCurrentAnalysis = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    const operationId = activeOcrOperationRef.current;
    activeOcrOperationRef.current = undefined;
    if (operationId !== undefined) {
      void cancelOcr(operationId).catch(() => undefined);
    }
    setAnalyzing(false);
  }, []);

  useEffect(() => {
    if (
      documentIdIsAvailable ||
      (documentId === "" && firstResourceId === "")
    ) {
      return;
    }
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      cancelCurrentAnalysis();
      setDocumentId(firstResourceId);
      setStep("source");
      setDetected([]);
      setAssignments({});
      setCompletedSubjectKeys(new Set());
      setExpandedDetectedKeys(new Set());
      setOcrStatus(undefined);
      setProgress("");
      setMessage("");
    });
    return () => {
      active = false;
    };
  }, [
    cancelCurrentAnalysis,
    documentId,
    documentIdIsAvailable,
    firstResourceId,
  ]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      const operationId = activeOcrOperationRef.current;
      activeOcrOperationRef.current = undefined;
      if (operationId !== undefined) {
        void cancelOcr(operationId).catch(() => undefined);
      }
    },
    [],
  );

  const analyze = async () => {
    if (effectiveDocumentId === "") {
      setMessage("请选择可用的 PDF；如果列表为空，请先到“资料”页面导入 PDF。");
      return;
    }
    const analysisDocumentId = effectiveDocumentId;
    cancelCurrentAnalysis();
    const runId = runRef.current + 1;
    runRef.current = runId;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setAnalyzing(true);
    setMessage("");
    setDetected([]);
    setStep("source");
    setCompletedSubjectKeys(new Set());
    setExpandedDetectedKeys(new Set());
    setProgress("");
    try {
      const descriptor = await getResourceReaderDescriptor(analysisDocumentId);
      let status: OcrComponentStatus | undefined;
      try {
        status = await getOcrStatus();
      } catch (statusError: unknown) {
        if (runRef.current !== runId || controller.signal.aborted) return;
        const normalized = normalizeOcrError(statusError);
        setMessage(`${normalized.message} ${normalized.action}`.trim());
      }
      if (runRef.current !== runId || controller.signal.aborted) return;
      setOcrStatus(status);
      const profile = resolveWorkbookPdfProfile(descriptor.title);
      const recognizePage =
        status?.state === "available"
          ? async (pageNumber: number, imageBytes: Uint8Array) => {
              const operationId = crypto.randomUUID();
              activeOcrOperationRef.current = operationId;
              try {
                return await recognizePdfPage(
                  operationId,
                  pageNumber,
                  imageBytes,
                );
              } finally {
                if (activeOcrOperationRef.current === operationId) {
                  activeOcrOperationRef.current = undefined;
                }
              }
            }
          : undefined;
      const result = await analyzeWorkbookPdf(descriptor, setProgress, {
        signal: controller.signal,
        recognizePage,
        profile,
        onProgress: (next) => {
          if (runRef.current !== runId) return;
          if (next.phase === "ocr" && next.page !== undefined) {
            setProgress(
              `正在 OCR 第 ${next.page}/${next.pageEnd ?? descriptor.pageCount ?? "?"} 页…`,
            );
          }
        },
      });
      if (runRef.current !== runId || controller.signal.aborted) return;
      const nextAssignments = Object.fromEntries(
        result.map((value) => [
          value.key,
          (() => {
            const subjectId =
              bestSubjectMatch(subjects, value.suggestedName)?.id ??
              subjects[0]?.id ??
              "";
            const matching = findMatchingSegments(segments, {
              documentId: analysisDocumentId,
              subjectId,
              pageStart: value.pageStart,
              pageEnd: value.pageEnd,
            });
            return {
              subjectId,
              workbookId: matching.defaultWorkbookId ?? "",
            };
          })(),
        ]),
      );
      setDetected(result);
      setAssignments(nextAssignments);
      setExpandedDetectedKeys(
        new Set(result[0] === undefined ? [] : [result[0].key]),
      );
      setStep("assign");
      setProgress(
        `解析完成：${result.length} 个科目，共 ${result.reduce((sum, value) => sum + value.questions.length, 0)} 道题。`,
      );
      if (result.every((value) => value.questions.length === 0)) {
        setMessage(
          status?.state === "available"
            ? "已识别到科目目录，但没有识别到题号。当前结果不会写入题库，请检查扫描质量后重试。"
            : "未发现可用文字层或题号。请安装并启用本地 OCR 组件后重试；当前结果不会写入题库。",
        );
      }
    } catch (error: unknown) {
      if (runRef.current !== runId) return;
      if (
        controller.signal.aborted ||
        error instanceof WorkbookPdfAnalyzeCanceledError
      ) {
        setMessage("PDF 分析已取消，未写入题库。");
      } else {
        const normalized = normalizeOcrError(error);
        setMessage(`${normalized.message} ${normalized.action}`);
      }
    } finally {
      if (runRef.current === runId) {
        abortRef.current = undefined;
        setAnalyzing(false);
        setBusy(false);
      }
    }
  };

  const save = async () => {
    if (detected.length === 0) return;
    if (effectiveDocumentId === "") {
      setMessage("当前 PDF 已不可用，请返回选择仍存在的 PDF 后重新分析。");
      return;
    }
    const saveDocumentId = effectiveDocumentId;
    const completedKeys = new Set(completedSubjectKeys);
    const remaining = remainingDetected;
    if (remaining.length === 0) {
      onClose();
      return;
    }
    if (
      remaining.reduce((sum, value) => sum + value.questions.length, 0) === 0 ||
      remaining.some((value) => value.questions.length === 0)
    ) {
      setMessage("至少有一个科目没有识别到题目，已停止写入，避免建立空索引。");
      return;
    }
    if (
      remaining.some(
        (value) =>
          !assignments[value.key]?.subjectId ||
          !assignments[value.key]?.workbookId,
      )
    ) {
      setMessage("请为每个检测到的科目选择科目根节点和练习册。");
      return;
    }
    if (remaining.some((value) => assignmentConflicts.has(value.key))) {
      setMessage(
        "存在相同 PDF 分段，已停止写入；请选择已有练习册或修改科目/页码范围。",
      );
      return;
    }

    setBusy(true);
    setMessage("");
    let completedCount = completedKeys.size;
    let activeSubjectName = remaining[0]?.suggestedName ?? "当前科目";
    try {
      setProgress("正在保存 PDF 科目分段…");
      const segments = await saveWorkbookSegments(
        remaining.map((value) => ({
          documentId: saveDocumentId,
          subjectId: assignments[value.key]!.subjectId,
          workbookId: assignments[value.key]!.workbookId,
          sourceHeading: value.sourceHeading,
          pageStart: value.pageStart,
          pageEnd: value.pageEnd,
        })),
      );
      for (const value of remaining) {
        activeSubjectName = value.suggestedName;
        const assignment = assignments[value.key]!;
        const segment = segments.find(
          (candidate) =>
            candidate.documentId === saveDocumentId &&
            candidate.subjectId === assignment.subjectId &&
            candidate.workbookId === assignment.workbookId &&
            candidate.pageStart === value.pageStart &&
            candidate.pageEnd === value.pageEnd,
        );
        if (segment === undefined) throw new Error("SEGMENT_MAPPING_FAILED");
        setProgress(
          `正在写入 ${value.suggestedName} 题目索引（${completedCount + 1}/${detected.length}）…`,
        );
        const next = await importQuestionIndex(segment.id, value.questions);
        completedKeys.add(value.key);
        completedCount += 1;
        setCompletedSubjectKeys(new Set(completedKeys));
        onImported(next);
      }
      setProgress(`已完成 ${completedCount}/${detected.length} 个科目索引。`);
      onClose();
    } catch (error: unknown) {
      const normalized = normalizeQuestionBankError(error);
      setMessage(
        `已完成 ${completedCount}/${detected.length}，失败科目可重试：${activeSubjectName}。${normalized.message}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const exportBaseline = () => {
    if (detected.length === 0 || selectedResource === undefined) return;
    const report = buildWorkbookPdfBaseline({
      title: selectedResource.title,
      sha256: selectedResource.sha256,
      pageCount: selectedResource.pageCount,
      subjects: detected,
    });
    const blob = new Blob([serializeWorkbookPdfBaseline(report)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = workbookPdfBaselineFileName(selectedResource.title);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(
      "已导出本次 PDF 分析基线 JSON。报告不包含题目正文、本地路径或密钥。",
    );
  };

  const requestClose = () => {
    cancelCurrentAnalysis();
    onClose();
  };

  const requestBack = () => {
    if (step === "assign") {
      setStep("source");
      return;
    }
    onRequestBack?.();
  };

  const hasBackAction = step === "assign" || onRequestBack !== undefined;

  return (
    <EditorDialog
      title="自动解析 PDF"
      description="本地读取书签和文字坐标，不调用 AI、不消耗 Token。"
      dirty={step === "assign" && detected.length > 0}
      onRequestClose={requestClose}
      onRequestBack={hasBackAction ? requestBack : undefined}
      backLabel={step === "assign" ? "返回选择 PDF" : backLabel}
      backRequiresConfirmation={step === "assign" ? false : undefined}
      closeDisabled={busy}
      returnFocusRef={returnFocusRef}
      fallbackFocusRef={fallbackFocusRef}
      size="large"
    >
      <div className="pdf-index-dialog">
        <nav className="question-bank-import-steps" aria-label="导入步骤">
          <span
            className={`question-bank-import-step${step === "source" ? " question-bank-import-step-active" : ""}`}
            aria-current={step === "source" ? "step" : undefined}
          >
            1. 选择并分析 PDF
          </span>
          <span
            className={`question-bank-import-step${step === "assign" ? " question-bank-import-step-active" : ""}`}
            aria-current={step === "assign" ? "step" : undefined}
          >
            2. 确认归类并建立索引
          </span>
        </nav>
        {step === "source" ? (
          resources.length === 0 ? (
            <p className="empty-state">
              资料库中还没有 PDF，请先到“资料”页面上传。
            </p>
          ) : (
            <>
              <label>
                选择 PDF
                <select
                  name="documentId"
                  autoComplete="off"
                  value={effectiveDocumentId}
                  disabled={busy}
                  onChange={(event) => {
                    cancelCurrentAnalysis();
                    setDocumentId(event.target.value);
                    setDetected([]);
                    setAssignments({});
                    setExpandedDetectedKeys(new Set());
                    setCompletedSubjectKeys(new Set());
                    setProgress("");
                  }}
                >
                  {resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={
                  busy || subjects.length === 0 || workbooks.length === 0
                }
                aria-describedby={
                  subjects.length === 0 || workbooks.length === 0
                    ? "question-bank-analyze-reason"
                    : undefined
                }
                onClick={() => void analyze()}
              >
                {busy && detected.length === 0 ? "正在分析…" : "分析目录和题目"}
              </button>
              {detected.length === 0 ? null : (
                <>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => setStep("assign")}
                  >
                    继续确认归类
                  </button>
                  <p className="form-hint" role="status">
                    已保留上次分析结果；继续确认归类不会重新读取 PDF。
                  </p>
                </>
              )}
              {analyzing ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={cancelCurrentAnalysis}
                >
                  取消分析
                </button>
              ) : null}
              {ocrStatus === undefined ? null : (
                <p className="form-hint" role="status">
                  {ocrStatus.state === "available"
                    ? "本地 OCR 已启用；仅对文字层不足的页面按需识别。"
                    : "本地 OCR 组件不可用，将仅使用 PDF 文字层。"}
                </p>
              )}
              {subjects.length === 0 || workbooks.length === 0 ? (
                <p className="form-hint" id="question-bank-analyze-reason">
                  请先关闭弹窗并创建至少一个科目和一个练习册。
                </p>
              ) : null}
            </>
          )
        ) : null}
        {step === "source" ? (
          <EditorDialogFooter className="editor-actions question-bank-import-footer">
            <EditorDialogCloseButton
              className="secondary-button"
              disabled={busy}
            >
              取消
            </EditorDialogCloseButton>
          </EditorDialogFooter>
        ) : null}
        {progress === "" ? null : (
          <p className="pdf-index-progress" role="status">
            {progress}
          </p>
        )}
        {message === "" ? null : (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        {step === "assign" ? (
          <>
            <div className="question-bank-import-assignment-heading">
              <div>
                <strong>确认科目与练习册</strong>
                <span>
                  {detected.length} 个 PDF 分段 · 共 {detectedQuestionCount}{" "}
                  道题
                </span>
              </div>
              <div className="question-bank-import-assignment-actions">
                <button
                  type="button"
                  className="text-button question-bank-import-export"
                  disabled={busy || selectedResource === undefined}
                  onClick={exportBaseline}
                >
                  导出诊断 JSON
                </button>
                <button
                  type="button"
                  className="text-button question-bank-import-back"
                  disabled={busy}
                  onClick={() => setStep("source")}
                >
                  返回选择 PDF
                </button>
              </div>
            </div>
            <div className="pdf-detected-subject-list">
              {detected.map((value) => {
                const completed = completedSubjectKeys.has(value.key);
                const conflict = assignmentConflicts.get(value.key);
                const assignment = assignments[value.key];
                const matching =
                  assignment?.subjectId === undefined ||
                  assignment.subjectId === ""
                    ? undefined
                    : findMatchingSegments(segments, {
                        documentId: effectiveDocumentId,
                        subjectId: assignment.subjectId,
                        pageStart: value.pageStart,
                        pageEnd: value.pageEnd,
                      });
                const hasMultipleExactMatches =
                  matching !== undefined &&
                  matching.exact.length > 1 &&
                  assignment?.workbookId === "";
                const conflictId = `pdf-assignment-conflict-${value.key}`;
                const completedId = `pdf-import-completed-${value.key}`;
                const subjectHeadingId = `pdf-detected-subject-${value.key}`;
                return (
                  <section
                    key={value.key}
                    className={`pdf-detected-subject${completed ? " pdf-detected-subject-completed" : ""}`}
                    data-import-completed={completed ? "true" : "false"}
                    aria-labelledby={subjectHeadingId}
                  >
                    <details
                      open={expandedDetectedKeys.has(value.key)}
                      onToggle={(event) => {
                        const nextOpen = event.currentTarget.open;
                        setExpandedDetectedKeys((current) => {
                          const next = new Set(current);
                          if (nextOpen) next.add(value.key);
                          else next.delete(value.key);
                          return next;
                        });
                      }}
                    >
                      <summary className="pdf-detected-subject-summary">
                        <strong>{value.suggestedName}</strong>
                        <span>
                          PDF {value.pageStart}～{value.pageEnd} 页 ·{" "}
                          {value.questions.length} 道
                          {completed ? " · 已完成" : ""}
                          {conflict === undefined ? "" : " · 有冲突"}
                          {value.warningCount === 0
                            ? ""
                            : ` · ${value.warningCount} 待复核`}
                          {value.unresolvedMarkerCount === 0
                            ? ""
                            : ` · ${value.unresolvedMarkerCount} 页未识别题号`}
                        </span>
                      </summary>
                      <header>
                        <div>
                          <h3 id={subjectHeadingId}>{value.suggestedName}</h3>
                          <span>{value.sourceHeading}</span>
                        </div>
                        <span>
                          PDF {value.pageStart}～{value.pageEnd} 页 ·{" "}
                          {value.questions.length} 道 · OCR {value.ocrPageCount}{" "}
                          页 · 解析规则 {value.profileId}
                        </span>
                      </header>
                      <dl className="pdf-diagnostics" aria-label="PDF 分析诊断">
                        <div>
                          <dt>跨页题目</dt>
                          <dd>{value.crossPageQuestionCount}</dd>
                        </div>
                        <div>
                          <dt>未识别题号</dt>
                          <dd>{value.unresolvedMarkerCount}</dd>
                        </div>
                        <div>
                          <dt>待复核警告</dt>
                          <dd>{value.warningCount}</dd>
                        </div>
                        <div>
                          <dt>OCR 页面</dt>
                          <dd>{value.ocrPageCount}</dd>
                        </div>
                      </dl>
                      <div className="pdf-subject-assignment">
                        <label>
                          归入科目
                          <select
                            name={`assignmentSubject-${value.key}`}
                            autoComplete="off"
                            value={assignments[value.key]?.subjectId ?? ""}
                            disabled={busy || completed}
                            onChange={(event) => {
                              const subjectId = event.target.value;
                              const matching = findMatchingSegments(segments, {
                                documentId: effectiveDocumentId,
                                subjectId,
                                pageStart: value.pageStart,
                                pageEnd: value.pageEnd,
                              });
                              setAssignments((current) => ({
                                ...current,
                                [value.key]: {
                                  subjectId,
                                  workbookId: matching.defaultWorkbookId ?? "",
                                },
                              }));
                              setMessage("");
                            }}
                          >
                            {subjects.map((subject) => (
                              <option key={subject.id} value={subject.id}>
                                {subject.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          归入练习册
                          <select
                            name={`assignmentWorkbook-${value.key}`}
                            autoComplete="off"
                            value={assignments[value.key]?.workbookId ?? ""}
                            disabled={busy || completed}
                            aria-describedby={
                              [
                                conflict === undefined ? undefined : conflictId,
                                completed ? completedId : undefined,
                              ]
                                .filter(
                                  (item): item is string => item !== undefined,
                                )
                                .join(" ") || undefined
                            }
                            onChange={(event) => {
                              setAssignments((current) => ({
                                ...current,
                                [value.key]: {
                                  subjectId:
                                    current[value.key]?.subjectId ?? "",
                                  workbookId: event.target.value,
                                },
                              }));
                              setMessage("");
                            }}
                          >
                            <option value="">请选择练习册</option>
                            {workbooks.map((workbook) => (
                              <option key={workbook.id} value={workbook.id}>
                                {workbook.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        {hasMultipleExactMatches ? (
                          <p
                            className="form-hint pdf-multiple-match-hint"
                            role="status"
                          >
                            检测到多个相同 PDF
                            页码分段，未自动选择；请核对已有分段，系统不会覆盖其它分段。
                          </p>
                        ) : null}
                      </div>
                      {completed ? (
                        <p
                          className="pdf-import-completed"
                          id={completedId}
                          role="status"
                        >
                          已完成；重试时跳过此行
                        </p>
                      ) : null}
                      {conflict === undefined ? null : (
                        <div
                          id={conflictId}
                          className="pdf-assignment-conflict"
                          role="alert"
                        >
                          <strong>
                            已禁止保存，请先移除/更正错误分段后重试。
                          </strong>
                          {conflict.existing.map((existing) => (
                            <p key={existing.segmentId}>
                              PDF：{existing.documentTitle} · 第{" "}
                              {existing.pageStart}～{existing.pageEnd} 页 · 已有{" "}
                              {existing.subjectName} / {existing.workbookName} ·
                              实际题数 {existing.questionCount}
                            </p>
                          ))}
                        </div>
                      )}
                      {value.warningCount === 0 ? null : (
                        <p className="pdf-index-warning">
                          有 {value.warningCount}{" "}
                          个页面或题号需要人工复核，未自动写入；后续可人工补充。
                        </p>
                      )}
                    </details>
                  </section>
                );
              })}
              <p className="form-hint" id="question-bank-import-save-reason">
                {detected.length === 0
                  ? "先分析 PDF，确认每个科目和练习册后才能建立索引。"
                  : allDetectedCompleted
                    ? "所有检测到的科目都已完成，可关闭导入窗口。"
                    : effectiveDocumentId === ""
                      ? "当前 PDF 已不可用，请返回选择仍存在的 PDF 后重新分析。"
                      : hasEmptyRemainingSubject
                        ? "每个尚未完成的科目都需要至少识别到一道题。"
                        : hasAssignmentConflicts
                          ? "请先处理重复 PDF 分段冲突。"
                          : "确认归类后建立索引。"}
              </p>
              <EditorDialogFooter className="editor-actions question-bank-import-footer">
                <EditorDialogCloseButton
                  className="secondary-button"
                  disabled={busy}
                >
                  取消
                </EditorDialogCloseButton>
                <button
                  type="button"
                  className="primary-button"
                  aria-describedby="question-bank-import-save-reason"
                  disabled={
                    busy ||
                    detected.length === 0 ||
                    (!allDetectedCompleted &&
                      (effectiveDocumentId === "" ||
                        remainingQuestionCount === 0 ||
                        hasEmptyRemainingSubject ||
                        hasAssignmentConflicts))
                  }
                  onClick={() => void save()}
                >
                  {busy && detected.length > 0
                    ? "正在建立索引…"
                    : allDetectedCompleted
                      ? "完成并关闭"
                      : "确认归类并建立索引"}
                </button>
              </EditorDialogFooter>
            </div>
          </>
        ) : null}
      </div>
    </EditorDialog>
  );
}
