import { useState, type FormEvent, type MutableRefObject } from "react";

import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import {
  createWorkbookCategory,
  normalizeQuestionBankError,
  type QuestionBankSnapshot,
  type TrashedWorkbookDocumentSegment,
  type WorkbookCategory,
} from "../../shared/tauri/questionBankClient";
import type { ResourceCommandError } from "../../shared/tauri/resourceClient";
import {
  createSubject,
  type StudySubject,
} from "../../shared/tauri/scheduleClient";
import { findSegmentRestoreConflicts } from "./questionBankModel";

export function SegmentTrashDialog({
  snapshot,
  segments,
  loading,
  error,
  busyId,
  headingRef,
  restoreButtonRefs,
  onClose,
  onRefresh,
  onRestore,
}: {
  snapshot: QuestionBankSnapshot;
  segments: readonly TrashedWorkbookDocumentSegment[];
  loading: boolean;
  error?: ResourceCommandError;
  busyId?: string;
  headingRef: MutableRefObject<HTMLHeadingElement | null>;
  restoreButtonRefs: MutableRefObject<Map<string, HTMLButtonElement>>;
  onClose(): void;
  onRefresh(): void;
  onRestore(
    segment: TrashedWorkbookDocumentSegment,
    trigger: HTMLButtonElement,
  ): void;
}) {
  return (
    <EditorDialog
      title="分段回收站"
      description="查看被移除的 PDF 分段；恢复会按删除时间校验，避免覆盖新的归类。分段回收站不包含单独移除的题目。"
      dirty={false}
      closeDisabled={busyId !== undefined}
      initialFocusRef={headingRef}
      onRequestClose={onClose}
      size="large"
    >
      <div className="question-bank-segment-trash">
        <header className="question-bank-segment-trash-heading">
          <div>
            <h3 ref={headingRef} tabIndex={-1}>
              已删除的 PDF 分段
            </h3>
            <p>题目区域、作答记录和复习历史会随可恢复题目保留。</p>
          </div>
          <button
            type="button"
            className="secondary-button"
            disabled={loading || busyId !== undefined}
            onClick={onRefresh}
          >
            刷新列表
          </button>
        </header>
        {error === undefined ? null : (
          <div className="question-bank-segment-trash-error" role="alert">
            <strong>{error.message}</strong>
            <p>{error.action}</p>
          </div>
        )}
        {loading ? (
          <p className="empty-state" role="status">
            正在读取分段回收站…
          </p>
        ) : segments.length === 0 ? (
          <p className="empty-state">分段回收站为空。</p>
        ) : (
          <ul className="question-bank-segment-trash-list">
            {segments.map((segment) => {
              const conflict = findSegmentRestoreConflicts(
                { segments: snapshot.segments, questions: snapshot.questions },
                segment,
              );
              const busy = busyId === segment.id;
              return (
                <li key={segment.id}>
                  <article className="question-bank-segment-trash-card">
                    <header>
                      <div>
                        <strong>{segment.sourceHeading}</strong>
                        <span>{segment.documentTitle}</span>
                      </div>
                      <button
                        ref={(button) => {
                          if (button === null) {
                            restoreButtonRefs.current.delete(segment.id);
                          } else {
                            restoreButtonRefs.current.set(segment.id, button);
                          }
                        }}
                        type="button"
                        className="secondary-button"
                        disabled={
                          busy || busyId !== undefined || conflict !== undefined
                        }
                        aria-describedby={
                          conflict === undefined
                            ? undefined
                            : `segment-restore-conflict-${segment.id}`
                        }
                        onClick={(event) =>
                          onRestore(segment, event.currentTarget)
                        }
                      >
                        {busy ? "正在恢复…" : "恢复分段"}
                      </button>
                    </header>
                    <dl className="question-bank-segment-trash-details">
                      <div>
                        <dt>PDF</dt>
                        <dd>{segment.documentTitle}</dd>
                      </div>
                      <div>
                        <dt>科目</dt>
                        <dd>{segment.subjectName}</dd>
                      </div>
                      <div>
                        <dt>练习册</dt>
                        <dd>{segment.workbookName}</dd>
                      </div>
                      <div>
                        <dt>页码</dt>
                        <dd>
                          第 {segment.pageStart}–{segment.pageEnd} 页
                        </dd>
                      </div>
                      <div>
                        <dt>可恢复题数</dt>
                        <dd>{segment.restorableQuestionCount}</dd>
                      </div>
                      <div>
                        <dt>删除时间</dt>
                        <dd>
                          {formatQuestionBankTimestamp(segment.deletedAt)}
                        </dd>
                      </div>
                    </dl>
                    {conflict === undefined ? null : (
                      <div
                        id={`segment-restore-conflict-${segment.id}`}
                        className="question-bank-segment-trash-conflict"
                        role="alert"
                      >
                        <strong>
                          恢复已阻止：相同 PDF 科目和页码已属于其他练习册。
                        </strong>
                        <p>
                          请保留已有归类；如需更正，请先移除错误分段，再重新分析并重试。
                        </p>
                        {conflict.existing.map((existing) => (
                          <p key={existing.segmentId}>
                            当前活动归类：{existing.subjectName} /{" "}
                            {existing.workbookName}，已有{" "}
                            {existing.questionCount} 道题。
                          </p>
                        ))}
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </EditorDialog>
  );
}

export function CreateSubjectDialog({
  subjects,
  onClose,
  onRequestBack,
  backLabel,
  onCreated,
}: {
  subjects: StudySubject[];
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onCreated(subject: StudySubject): void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      onCreated(
        await createSubject({
          name,
          colorKey: "blue",
          sortOrder: subjects.length,
        }),
      );
    } catch {
      setMessage("科目创建失败，请检查名称是否重复。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorDialog
      title="新建科目"
      description="科目是题库的根节点，例如高等数学、线性代数。"
      dirty={name !== ""}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      closeDisabled={busy}
    >
      <form
        className="editor-form compact-entity-form"
        onSubmit={(event) => void submit(event)}
      >
        <label>
          科目名称
          <input
            autoFocus
            name="subjectName"
            autoComplete="off"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {message === "" ? null : (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <EditorDialogFooter className="editor-actions question-bank-dialog-footer">
          <EditorDialogCloseButton className="secondary-button" disabled={busy}>
            取消
          </EditorDialogCloseButton>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "正在保存…" : "创建科目"}
          </button>
        </EditorDialogFooter>
      </form>
    </EditorDialog>
  );
}

export function CreateWorkbookDialog({
  onClose,
  onRequestBack,
  backLabel,
  onCreated,
}: {
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onCreated(value: WorkbookCategory): void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      onCreated(await createWorkbookCategory(name));
    } catch (error: unknown) {
      const normalized = normalizeQuestionBankError(error);
      setMessage(`${normalized.message} ${normalized.action}`.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <EditorDialog
      title="新建练习册"
      description="只填写资料系列名称，例如 880、1000题。"
      dirty={name !== ""}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      closeDisabled={busy}
    >
      <form
        className="editor-form compact-entity-form"
        onSubmit={(event) => void submit(event)}
      >
        <label>
          练习册名称
          <input
            autoFocus
            name="workbookName"
            autoComplete="off"
            required
            maxLength={120}
            placeholder="例如：880…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {message === "" ? null : (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <EditorDialogFooter className="editor-actions question-bank-dialog-footer">
          <EditorDialogCloseButton className="secondary-button" disabled={busy}>
            取消
          </EditorDialogCloseButton>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? "正在保存…" : "创建练习册"}
          </button>
        </EditorDialogFooter>
      </form>
    </EditorDialog>
  );
}

function formatQuestionBankTimestamp(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
