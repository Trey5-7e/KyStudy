import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import {
  normalizeQuestionBankError,
  recordBulkQuestionAttempts,
  type IndexedQuestion,
  type QuestionBankSnapshot,
} from "../../shared/tauri/questionBankClient";
import { localDateForTimezone } from "../../shared/tauri/scheduleClient";
import type { AttemptResult } from "../../shared/tauri/questionClient";
import {
  parseQuestionNumberSelection,
  questionsInScope,
  type QuestionScope,
} from "./questionBankModel";
import { completeScope, QuestionScopeFilters } from "./QuestionIndexDialogs";

type MatrixMode = AttemptResult;
type MatrixAction = MatrixMode | "clear";

interface QuickRecordFields {
  completed: string;
  incorrect: string;
  partial: string;
}

const MATRIX_MODE_OPTIONS: ReadonlyArray<{
  value: MatrixMode;
  label: string;
}> = [
  { value: "correct", label: "做对" },
  { value: "incorrect", label: "做错" },
  { value: "uncertain", label: "不全对" },
];

function parseMatrixNumbers(value: string): Set<string> {
  try {
    return new Set(parseQuestionNumberSelection(value));
  } catch {
    return new Set();
  }
}

function formatMatrixNumbers(numbers: Set<string>): string {
  return [...numbers]
    .sort((left, right) => Number(left) - Number(right))
    .join(",");
}

function updateMatrixFields(
  fields: QuickRecordFields,
  questionNumber: string,
  action: MatrixAction,
): QuickRecordFields {
  const next = {
    completed: parseMatrixNumbers(fields.completed),
    incorrect: parseMatrixNumbers(fields.incorrect),
    partial: parseMatrixNumbers(fields.partial),
  };
  next.completed.delete(questionNumber);
  next.incorrect.delete(questionNumber);
  next.partial.delete(questionNumber);
  if (action !== "clear") {
    const target =
      action === "correct"
        ? next.completed
        : action === "incorrect"
          ? next.incorrect
          : next.partial;
    target.add(questionNumber);
  }
  return {
    completed: formatMatrixNumbers(next.completed),
    incorrect: formatMatrixNumbers(next.incorrect),
    partial: formatMatrixNumbers(next.partial),
  };
}

function matrixStatusByNumber(
  fields: QuickRecordFields,
): ReadonlyMap<string, AttemptResult> {
  const next = new Map<string, AttemptResult>();
  for (const number of parseMatrixNumbers(fields.completed))
    next.set(number, "correct");
  for (const number of parseMatrixNumbers(fields.partial))
    next.set(number, "uncertain");
  for (const number of parseMatrixNumbers(fields.incorrect))
    next.set(number, "incorrect");
  return next;
}

function compareMatrixQuestions(
  left: IndexedQuestion,
  right: IndexedQuestion,
): number {
  const leftNumber = Number(left.questionNumber.trim());
  const rightNumber = Number(right.questionNumber.trim());
  const leftNumeric = Number.isSafeInteger(leftNumber);
  const rightNumeric = Number.isSafeInteger(rightNumber);
  if (leftNumeric && rightNumeric && leftNumber !== rightNumber)
    return leftNumber - rightNumber;
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.questionNumber.localeCompare(right.questionNumber, "zh-CN");
}

export function QuickRecordDialog({
  questions,
  timezone,
  onClose,
  onRequestBack,
  backLabel,
  onSaved,
}: {
  questions: IndexedQuestion[];
  timezone: string;
  onClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  onSaved(snapshot: QuestionBankSnapshot): void;
}) {
  const [scope, setScope] = useState<QuestionScope>(() =>
    completeScope(questions, {}),
  );
  const [recordFields, setRecordFields] = useState<QuickRecordFields>({
    completed: "",
    incorrect: "",
    partial: "",
  });
  const [matrixMode, setMatrixMode] = useState<MatrixMode>("correct");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const draggingRef = useRef(false);
  const draggingActionRef = useRef<MatrixAction | null>(null);
  const scoped = questionsInScope(questions, scope);
  const { completed, incorrect, partial } = recordFields;
  const matrixQuestions = useMemo(
    () => [...scoped].sort(compareMatrixQuestions),
    [scoped],
  );
  const matrixStatus = useMemo(
    () => matrixStatusByNumber(recordFields),
    [recordFields],
  );

  useEffect(() => {
    const stopDragging = () => {
      draggingRef.current = false;
      draggingActionRef.current = null;
    };
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
    return () => {
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
    };
  }, []);

  const applyMatrixAction = (questionNumber: string, action: MatrixAction) => {
    setRecordFields((current) =>
      updateMatrixFields(current, questionNumber, action),
    );
  };

  const toggleMatrixSelection = (questionNumber: string) => {
    setRecordFields((current) => {
      const currentStatus = matrixStatusByNumber(current).get(questionNumber);
      const action: MatrixAction =
        currentStatus === matrixMode ? "clear" : matrixMode;
      return updateMatrixFields(current, questionNumber, action);
    });
  };

  const handleMatrixPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    questionNumber: string,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    draggingRef.current = true;
    const currentStatus = matrixStatus.get(questionNumber);
    const action: MatrixAction =
      currentStatus === matrixMode ? "clear" : matrixMode;
    draggingActionRef.current = action;
    applyMatrixAction(questionNumber, action);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      const completedNumbers = parseQuestionNumberSelection(completed);
      const incorrectNumbers = parseQuestionNumberSelection(incorrect);
      const partialNumbers = parseQuestionNumberSelection(partial);
      const done = new Set([
        ...completedNumbers,
        ...incorrectNumbers,
        ...partialNumbers,
      ]);
      if (done.size === 0) {
        setMessage("至少填写一道本次完成、做错或不全对的题号。");
        return;
      }
      const questionByNumber = new Map(
        scoped.map((question) => [question.questionNumber, question]),
      );
      const missing = [...done].filter(
        (number) => !questionByNumber.has(number),
      );
      if (missing.length > 0) {
        setMessage(`当前范围中找不到题号：${missing.join("、")}`);
        return;
      }
      const resultByNumber = new Map<string, AttemptResult>();
      for (const number of completedNumbers)
        resultByNumber.set(number, "correct");
      for (const number of partialNumbers)
        resultByNumber.set(number, "uncertain");
      for (const number of incorrectNumbers)
        resultByNumber.set(number, "incorrect");
      setBusy(true);
      const next = await recordBulkQuestionAttempts(
        localDateForTimezone(new Date(), timezone),
        [...resultByNumber].map(([number, result]) => ({
          questionId: questionByNumber.get(number)!.id,
          result,
        })),
      );
      onSaved(next);
    } catch (error: unknown) {
      setMessage(
        error instanceof Error &&
          error.message === "QUESTION_NUMBER_RANGE_INVALID"
          ? "题号格式无效，请使用 1,3,5-8 这样的格式。"
          : (() => {
              const normalized = normalizeQuestionBankError(error);
              return `${normalized.message} ${normalized.action}`.trim();
            })(),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <EditorDialog
      title="快速登记做题"
      description="只输入少量题号；“本次完成”中未列为做错或不全对的题会记为做对。"
      dirty={completed !== "" || incorrect !== "" || partial !== ""}
      onRequestClose={onClose}
      onRequestBack={onRequestBack}
      backLabel={backLabel}
      closeDisabled={busy}
      size="large"
    >
      <form
        className="editor-form quick-record-form"
        onSubmit={(event) => void submit(event)}
      >
        <QuestionScopeFilters
          questions={questions}
          value={scope}
          onChange={(value) => setScope(completeScope(questions, value))}
          requireExact
        />
        <p className="form-hint" id="quick-record-save-reason">
          当前范围找到 {scoped.length}{" "}
          道题。请确保题型已经选到最具体一级，避免题号重复。
        </p>
        {matrixQuestions.length === 0 ? null : (
          <section
            className="quick-record-matrix"
            aria-labelledby="quick-record-matrix-title"
          >
            <div className="quick-record-matrix-toolbar">
              <div>
                <h3 id="quick-record-matrix-title">题号矩阵</h3>
                <p aria-live="polite">
                  已标记 {matrixStatus.size} / {matrixQuestions.length}{" "}
                  题。选择标记后，可点击或按住鼠标左键拖动；再次点击同一题号可清除。
                </p>
              </div>
              <div
                className="quick-record-matrix-modes"
                role="group"
                aria-label="题号标记"
              >
                {MATRIX_MODE_OPTIONS.map((option) => (
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
            </div>
            <div
              className="quick-record-number-grid"
              role="group"
              aria-label="可登记题号"
            >
              {matrixQuestions.map((question) => {
                const status = matrixStatus.get(question.questionNumber);
                return (
                  <button
                    key={question.id}
                    type="button"
                    className={
                      "quick-record-number-cell" +
                      (status === undefined ? "" : " is-" + status)
                    }
                    aria-pressed={status !== undefined}
                    aria-label={
                      question.questionNumber +
                      "题" +
                      (status === undefined
                        ? "未标记"
                        : status === "correct"
                          ? "做对"
                          : status === "incorrect"
                            ? "做错"
                            : "不全对")
                    }
                    onPointerDown={(event) =>
                      handleMatrixPointerDown(event, question.questionNumber)
                    }
                    onPointerEnter={() => {
                      if (draggingRef.current && draggingActionRef.current)
                        applyMatrixAction(
                          question.questionNumber,
                          draggingActionRef.current,
                        );
                    }}
                    onClick={(event) => {
                      if (event.detail === 0)
                        toggleMatrixSelection(question.questionNumber);
                    }}
                  >
                    {question.questionNumber}
                  </button>
                );
              })}
            </div>
            <p className="quick-record-matrix-hint">
              选择一种标记后点击题号即可登记，再次点击同一题号即可清除标记；按住鼠标左键可批量选择。
            </p>
          </section>
        )}
        <label>
          本次完成
          <input
            autoFocus
            name="completedQuestionNumbers"
            autoComplete="off"
            placeholder="例如：1-20"
            value={completed}
            onChange={(event) =>
              setRecordFields((current) => ({
                ...current,
                completed: event.target.value,
              }))
            }
          />
          <small>这些题默认记为做对，下面两栏会覆盖对应题号。</small>
        </label>
        <div className="quick-record-results">
          <label>
            做错
            <input
              name="incorrectQuestionNumbers"
              autoComplete="off"
              placeholder="例如：2,7,15"
              value={incorrect}
              onChange={(event) =>
                setRecordFields((current) => ({
                  ...current,
                  incorrect: event.target.value,
                }))
              }
            />
          </label>
          <label>
            不全对{" "}
            <input
              name="partialQuestionNumbers"
              autoComplete="off"
              placeholder="例如：4,11"
              value={partial}
              onChange={(event) =>
                setRecordFields((current) => ({
                  ...current,
                  partial: event.target.value,
                }))
              }
            />
          </label>
        </div>
        {message === "" ? null : (
          <p className="form-error" role="alert">
            {message}
          </p>
        )}
        <EditorDialogFooter className="editor-actions question-bank-dialog-footer">
          <EditorDialogCloseButton className="secondary-button" disabled={busy}>
            取消
          </EditorDialogCloseButton>
          <button
            type="submit"
            className="primary-button"
            aria-describedby="quick-record-save-reason"
            disabled={busy || scoped.length === 0}
          >
            {busy ? "正在保存…" : "保存本次练习"}
          </button>
        </EditorDialogFooter>
      </form>
    </EditorDialog>
  );
}
