import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";

import {
  EditorDialog,
  EditorDialogFooter,
  useEditorDialogNavigation,
} from "../../shared/components/EditorDialog";
import {
  importQuestionIndex,
  insertIndexedQuestion,
  normalizeQuestionBankError,
  replaceIndexedQuestionRegions,
  type IndexedQuestion,
  type QuestionBankSnapshot,
  type SectionPart,
} from "../../shared/tauri/questionBankClient";
import { type QuestionType } from "../../shared/tauri/questionClient";
import { getResourceReaderDescriptor } from "../../shared/tauri/resourceClient";
import type { PdfRegionOverlay } from "../library/pdf/PdfReader";

import {
  PART_OPTIONS,
  regionSignature,
  toRegionInput,
  toRegionOverlay,
  TYPE_OPTIONS,
  type RelativeQuestionInsert,
} from "./QuestionIndexDialogs";
import { manualIndexDialogInitialSegmentId } from "./manualIndexDialogModel";

const PdfReader = lazy(() =>
  import("../library/pdf/PdfReader").then((module) => ({
    default: module.PdfReader,
  })),
);

export interface ManualIndexDialogProps {
  snapshot: QuestionBankSnapshot;
  existingQuestion?: IndexedQuestion;
  relativeInsert?: RelativeQuestionInsert;
  initialSegmentId?: string;
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onSaved(snapshot: QuestionBankSnapshot): void;
}

export type ManualIndexDialogComponent = ComponentType<ManualIndexDialogProps>;

function ManualIndexCancelButton({
  useBack,
  disabled,
}: {
  useBack: boolean;
  disabled: boolean;
}) {
  const { requestClose, requestBack } = useEditorDialogNavigation();
  return (
    <button
      type="button"
      className="secondary-button"
      disabled={disabled}
      onClick={useBack ? requestBack : requestClose}
    >
      取消
    </button>
  );
}

export function ManualIndexDialog({
  snapshot,
  existingQuestion,
  relativeInsert,
  initialSegmentId: requestedSegmentId,
  onClose,
  onRequestBack,
  backLabel,
  onSaved,
}: {
  snapshot: QuestionBankSnapshot;
  existingQuestion?: IndexedQuestion;
  relativeInsert?: RelativeQuestionInsert;
  initialSegmentId?: string;
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onSaved(snapshot: QuestionBankSnapshot): void;
}) {
  const anchorQuestion = relativeInsert?.anchorQuestion;
  const initialSegmentId = manualIndexDialogInitialSegmentId(
    snapshot,
    requestedSegmentId,
    existingQuestion,
    relativeInsert,
  );
  const [segmentId, setSegmentId] = useState(initialSegmentId);
  const segment = snapshot.segments.find((item) => item.id === segmentId);
  const initialChapter =
    existingQuestion?.chapter ??
    anchorQuestion?.chapter ??
    segment?.sourceHeading ??
    "";
  const initialSectionPart =
    existingQuestion?.sectionPart ?? anchorQuestion?.sectionPart ?? "basic";
  const initialQuestionType =
    existingQuestion?.questionType ?? anchorQuestion?.questionType ?? "choice";
  const [descriptor, setDescriptor] =
    useState<Awaited<ReturnType<typeof getResourceReaderDescriptor>>>();
  const [workingRegions, setWorkingRegions] = useState<PdfRegionOverlay[]>(
    () => existingQuestion?.regions.map(toRegionOverlay) ?? [],
  );
  const [chapter, setChapter] = useState(initialChapter);
  const [sectionPart, setSectionPart] =
    useState<SectionPart>(initialSectionPart);
  const [questionType, setQuestionType] =
    useState<QuestionType>(initialQuestionType);
  const [questionNumber, setQuestionNumber] = useState(
    existingQuestion?.questionNumber ??
      relativeInsert?.suggestedQuestionNumber ??
      "",
  );
  const [title, setTitle] = useState(
    existingQuestion?.title ??
      (relativeInsert?.suggestedQuestionNumber === undefined
        ? ""
        : `第 ${relativeInsert.suggestedQuestionNumber} 题`),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const originalRegionSignature = regionSignature(
    existingQuestion?.regions.map(toRegionOverlay) ?? [],
  );
  const regionDirty =
    regionSignature(workingRegions) !== originalRegionSignature;
  const metadataDirty =
    chapter !== initialChapter ||
    sectionPart !== initialSectionPart ||
    questionType !== initialQuestionType;

  useEffect(() => {
    if (segment === undefined) return;
    let active = true;
    void getResourceReaderDescriptor(segment.documentId).then(
      (next) => {
        if (active) setDescriptor(next);
      },
      (loadError: unknown) => {
        if (active) {
          const normalized = normalizeQuestionBankError(loadError);
          setMessage(`${normalized.message} ${normalized.action}`.trim());
        }
      },
    );
    return () => {
      active = false;
    };
  }, [segment]);

  const save = async () => {
    if (segment === undefined || workingRegions.length === 0) return;
    setBusy(true);
    setMessage("");
    try {
      if (existingQuestion !== undefined) {
        const originalIds = new Set(
          existingQuestion.regions.map((region) => region.id),
        );
        onSaved(
          await replaceIndexedQuestionRegions(
            existingQuestion.id,
            workingRegions.map((region) => ({
              ...(originalIds.has(region.id) ? { regionId: region.id } : {}),
              ...toRegionInput(region),
            })),
          ),
        );
      } else if (relativeInsert !== undefined) {
        onSaved(
          await insertIndexedQuestion({
            anchorQuestionId: relativeInsert.anchorQuestion.id,
            placement: relativeInsert.placement,
            title,
            chapter,
            sectionPart,
            questionType,
            questionNumber,
            regions: workingRegions.map(toRegionInput),
          }),
        );
      } else {
        onSaved(
          await importQuestionIndex(segment.id, [
            {
              sourceKey: `manual|${crypto.randomUUID()}`,
              title,
              chapter,
              sectionPart,
              questionType,
              questionNumber,
              indexConfidence: 1,
              regions: workingRegions.map(toRegionInput),
            },
          ]),
        );
      }
    } catch (saveError: unknown) {
      const normalized = normalizeQuestionBankError(saveError);
      setMessage(`${normalized.message} ${normalized.action}`.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorDialog
      title={
        existingQuestion !== undefined
          ? "调整题目区域"
          : relativeInsert === undefined
            ? "手动补题与校对"
            : relativeInsert.placement === "before"
              ? "在当前题前补题"
              : "在当前题后补题"
      }
      description={
        relativeInsert !== undefined
          ? "已经定位到当前题所在的 PDF 和页面，并继承分类；框选遗漏题目后填写题号即可插入。"
          : existingQuestion === undefined
            ? "选择半自动索引中的 PDF 分段，框选遗漏题目并直接写入当前题库。"
            : "拖动橙色框体可移动，拖动四角可缩放；也可以补充或移除区域。"
      }
      dirty={
        regionDirty ||
        metadataDirty ||
        segmentId !== initialSegmentId ||
        (existingQuestion === undefined &&
          (questionNumber.trim() !== "" || title.trim() !== ""))
      }
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      closeDisabled={busy}
      size="review"
    >
      <div className="manual-index-dialog">
        <div className="manual-index-sidebar">
          {existingQuestion === undefined && relativeInsert === undefined ? (
            <label>
              归属分段
              <select
                name="segmentId"
                autoComplete="off"
                value={segmentId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  const next = snapshot.segments.find(
                    (item) => item.id === nextId,
                  );
                  setSegmentId(nextId);
                  setDescriptor(undefined);
                  setChapter(next?.sourceHeading ?? "");
                  setWorkingRegions([]);
                }}
              >
                {snapshot.segments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.subjectName} / {item.workbookName} /{" "}
                    {item.sourceHeading}
                  </option>
                ))}
              </select>
            </label>
          ) : existingQuestion !== undefined ? (
            <div className="manual-index-target">
              <strong>第 {existingQuestion.questionNumber} 题</strong>
              <span>
                {existingQuestion.subjectName} / {existingQuestion.workbookName}{" "}
                / {existingQuestion.chapter}
              </span>
            </div>
          ) : relativeInsert !== undefined ? (
            <div className="manual-index-target manual-index-insert-target">
              <strong>
                将插入到第 {relativeInsert.anchorQuestion.questionNumber} 题
                {relativeInsert.placement === "before" ? "之前" : "之后"}
              </strong>
              <span>
                {relativeInsert.anchorQuestion.subjectName} /{" "}
                {relativeInsert.anchorQuestion.workbookName} /{" "}
                {relativeInsert.anchorQuestion.chapter}
              </span>
              <small>PDF 已自动定位，只需框选漏题，不用重新寻找分段。</small>
            </div>
          ) : null}
          {existingQuestion === undefined ? (
            <>
              <label>
                章节
                <input
                  name="manualChapter"
                  autoComplete="off"
                  required
                  value={chapter}
                  maxLength={120}
                  onChange={(event) => setChapter(event.target.value)}
                />
              </label>
              <div className="form-grid two-columns">
                <label>
                  篇章
                  <select
                    name="manualSectionPart"
                    autoComplete="off"
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
                    name="manualQuestionType"
                    autoComplete="off"
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
                题号
                <input
                  name="manualQuestionNumber"
                  autoComplete="off"
                  required
                  value={questionNumber}
                  maxLength={60}
                  onChange={(event) => {
                    const nextNumber = event.target.value;
                    setTitle((current) =>
                      current.trim() === "" ||
                      current === `第 ${questionNumber} 题`
                        ? `第 ${nextNumber} 题`
                        : current,
                    );
                    setQuestionNumber(nextNumber);
                  }}
                />
              </label>
              <label>
                卡片标题
                <input
                  name="manualTitle"
                  autoComplete="off"
                  required
                  placeholder="例如：第 3 题…"
                  value={title}
                  maxLength={200}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
            </>
          ) : null}
          <div className="manual-region-list" aria-live="polite">
            <strong>当前保留 {workingRegions.length} 个区域</strong>
            <p>可直接拖动框体或四角；方向键也能微调，按住 Shift 加速。</p>
            {workingRegions.map((region, index) => (
              <div key={region.id}>
                <span>
                  第 {region.pageNumber} 页 · 区域 {index + 1}
                  {existingQuestion?.regions.some(
                    (item) => item.id === region.id,
                  )
                    ? ""
                    : "（新）"}
                </span>
                <button
                  type="button"
                  className="text-button"
                  disabled={workingRegions.length <= 1}
                  onClick={() =>
                    setWorkingRegions((current) =>
                      current.filter((item) => item.id !== region.id),
                    )
                  }
                >
                  移除
                </button>
              </div>
            ))}
          </div>
          {message === "" ? null : (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
          <p className="form-hint" id="manual-index-save-reason">
            {workingRegions.length === 0
              ? "至少框选一个 PDF 区域后才能保存。"
              : existingQuestion !== undefined && !regionDirty
                ? "尚未调整区域。"
                : "填写题号、章节和标题后保存。"}
          </p>
          <EditorDialogFooter className="editor-actions question-bank-dialog-footer manual-index-footer">
            <ManualIndexCancelButton
              useBack={onRequestBack !== undefined}
              disabled={busy}
            />
            <button
              type="button"
              className="primary-button"
              aria-describedby="manual-index-save-reason"
              disabled={
                busy ||
                workingRegions.length === 0 ||
                (existingQuestion !== undefined && !regionDirty) ||
                (existingQuestion === undefined &&
                  (chapter.trim() === "" ||
                    questionNumber.trim() === "" ||
                    title.trim() === ""))
              }
              onClick={() => void save()}
            >
              {busy
                ? "正在保存…"
                : existingQuestion === undefined
                  ? relativeInsert === undefined
                    ? "创建题目卡片"
                    : "插入题目卡片"
                  : "保存区域调整"}
            </button>
          </EditorDialogFooter>
        </div>
        <div className="manual-index-reader">
          {descriptor === undefined ? (
            <p className="empty-state" role="status">
              正在加载 PDF…
            </p>
          ) : (
            <Suspense
              fallback={
                <p className="empty-state" role="status">
                  正在加载 PDF 阅读器…
                </p>
              }
            >
              <PdfReader
                descriptor={descriptor}
                requestedPage={
                  existingQuestion?.regions[0]?.pageNumber ??
                  (relativeInsert?.placement === "after"
                    ? relativeInsert.anchorQuestion.regions.at(-1)?.pageNumber
                    : relativeInsert?.anchorQuestion.regions[0]?.pageNumber) ??
                  segment?.pageStart
                }
                onProgress={() => undefined}
                regions={workingRegions}
                captureMode
                editableRegions
                onRegionCapture={(region) =>
                  setWorkingRegions((current) => [
                    ...current,
                    { id: `pending-${crypto.randomUUID()}`, ...region },
                  ])
                }
                onRegionChange={(region) =>
                  setWorkingRegions((current) =>
                    current.map((item) =>
                      item.id === region.id ? region : item,
                    ),
                  )
                }
              />
            </Suspense>
          )}
        </div>
      </div>
    </EditorDialog>
  );
}
