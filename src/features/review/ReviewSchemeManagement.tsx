import { useState, type FormEvent } from "react";
import type { ResourceDocument } from "../../shared/tauri/resourceClient";
import type { StudySubject } from "../../shared/tauri/scheduleClient";
import type {
  ReviewSchemeRating,
  ReviewSchemeQueueItem,
  ReviewSchemeToday,
} from "../../shared/tauri/reviewSchemeClient";
import {
  EMPTY_DRAFT,
  QUESTION_TYPES,
  WEEKDAYS,
  type SchemeDraft,
  draftFromScheme,
  quotaSummary,
} from "./reviewViewModel";

export function RestDaySettings({
  restWeekdays,
  busy,
  onSave,
}: {
  restWeekdays: number[];
  busy: boolean;
  onSave(v: number[]): Promise<boolean>;
}) {
  const [values, setValues] = useState(restWeekdays);
  return (
    <section className="review-rest-days">
      <h3>每周休息日</h3>
      <fieldset>
        {WEEKDAYS.map((label, i) => (
          <label key={i}>
            <input
              type="checkbox"
              checked={values.includes(i)}
              onChange={(e) =>
                setValues((v) =>
                  e.target.checked ? [...v, i] : v.filter((x) => x !== i),
                )
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <button type="button" disabled={busy} onClick={() => void onSave(values)}>
        保存休息日
      </button>
    </section>
  );
}
export function SchemeForm({
  draft,
  subjects,
  workbooks,
  busy,
  onChange,
  onSave,
}: {
  draft: SchemeDraft;
  subjects: StudySubject[];
  workbooks: ResourceDocument[];
  busy: boolean;
  onChange(v: SchemeDraft): void;
  onSave(v: SchemeDraft): Promise<void>;
}) {
  const total = QUESTION_TYPES.reduce(
    (s, i) => s + Number(draft.quotas[i.value] || 0),
    0,
  );
  const dailyQuota = Number(draft.dailyQuota);
  const dailyQuotaValid = Number.isSafeInteger(dailyQuota) && dailyQuota > 0;
  const quotasValid = QUESTION_TYPES.every((item) => {
    const quota = Number(draft.quotas[item.value]);
    return Number.isSafeInteger(quota) && quota >= 0;
  });
  const valid =
    !!draft.name.trim() &&
    !!draft.subjectId &&
    dailyQuotaValid &&
    quotasValid &&
    total === dailyQuota &&
    (draft.allSubjectWorkbooks || draft.documentIds.length > 0);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (valid) await onSave(draft);
  };
  return (
    <form className="review-scheme-form" onSubmit={(e) => void submit(e)}>
      <div className="review-scheme-field-grid">
        <label
          className="review-scheme-field review-scheme-field-wide"
          htmlFor="review-scheme-name"
        >
          <span>方案名称</span>
          <input
            id="review-scheme-name"
            name="name"
            autoComplete="off"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
          />
        </label>
        <label className="review-scheme-field" htmlFor="review-scheme-subject">
          <span>科目</span>
          <select
            id="review-scheme-subject"
            name="subjectId"
            autoComplete="off"
            value={draft.subjectId}
            onChange={(e) => onChange({ ...draft, subjectId: e.target.value })}
          >
            <option value="">请选择</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className="review-scheme-field"
          htmlFor="review-scheme-daily-quota"
        >
          <span>每日总量</span>
          <input
            id="review-scheme-daily-quota"
            name="dailyQuota"
            autoComplete="off"
            type="number"
            min="1"
            inputMode="numeric"
            value={draft.dailyQuota}
            onChange={(e) => onChange({ ...draft, dailyQuota: e.target.value })}
          />
        </label>
      </div>
      <fieldset className="review-scheme-fieldset">
        <legend>习题册范围</legend>
        <div className="review-scheme-workbook-options">
          <label className="review-scheme-checkbox">
            <input
              name="allSubjectWorkbooks"
              type="checkbox"
              checked={draft.allSubjectWorkbooks}
              onChange={(e) =>
                onChange({ ...draft, allSubjectWorkbooks: e.target.checked })
              }
            />
            <span>本科目全部习题册</span>
          </label>
          {!draft.allSubjectWorkbooks &&
            workbooks.map((w) => (
              <label key={w.id} className="review-scheme-checkbox">
                <input
                  type="checkbox"
                  name={`workbook-${w.id}`}
                  checked={draft.documentIds.includes(w.id)}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      documentIds: e.target.checked
                        ? [...draft.documentIds, w.id]
                        : draft.documentIds.filter((id) => id !== w.id),
                    })
                  }
                />
                <span>{w.title}</span>
              </label>
            ))}
          {draft.allSubjectWorkbooks || workbooks.length > 0 ? null : (
            <p className="review-scheme-empty-hint">当前科目暂无可用习题册。</p>
          )}
        </div>
      </fieldset>
      <fieldset className="review-scheme-fieldset">
        <legend>每日题型数量</legend>
        <div className="review-scheme-quota-grid">
          {QUESTION_TYPES.map((i) => (
            <label
              key={i.value}
              className="review-scheme-quota-field"
              htmlFor={`review-scheme-quota-${i.value}`}
            >
              <span>{i.label}</span>
              <input
                id={`review-scheme-quota-${i.value}`}
                name={`quota-${i.value}`}
                type="number"
                min="0"
                inputMode="numeric"
                value={draft.quotas[i.value]}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    quotas: { ...draft.quotas, [i.value]: e.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
        <p className="review-scheme-form-hint">
          每日总量应与各题型数量之和一致。
        </p>
      </fieldset>
      <div className="review-scheme-form-actions">
        <p className="review-scheme-total">
          已设置 <strong>{total}</strong> 题 / 每日{" "}
          <strong>{dailyQuota || 0}</strong> 题
        </p>
        <button
          type="submit"
          className="primary-button"
          disabled={busy || !valid}
        >
          保存复习方案
        </button>
      </div>
    </form>
  );
}
export function SchemeCard({
  value,
  busy,
  onEdit,
  onToggle,
  onArchive,
  onGenerate,
  onFeedback,
  onUndo,
}: {
  value: ReviewSchemeToday;
  busy: boolean;
  onEdit(): void;
  onToggle(): Promise<boolean>;
  onArchive(): Promise<boolean>;
  onGenerate(id: string): Promise<boolean>;
  onFeedback(
    q: string,
    question: string,
    r: ReviewSchemeRating,
  ): Promise<boolean>;
  onUndo(q: string): Promise<boolean>;
}) {
  const [review, setReview] = useState(false);
  const s = value.scheme;
  const q = value.queue;
  const pending = q?.items.find((i) => i.state === "pending");
  return (
    <article className="review-scheme-card">
      <h3>{s.name}</h3>
      <p>
        {quotaSummary(s.typeQuotas)} / 每日 {s.dailyQuota}
      </p>
      <p>
        今日到期 {value.dueCount}，进度 {q?.completedCount ?? 0}/
        {q?.quota ?? s.dailyQuota}
      </p>
      {q === undefined ? (
        <button
          type="button"
          disabled={busy || !s.enabled}
          onClick={() => void onGenerate("").then(setReview)}
        >
          开始今天的复习
        </button>
      ) : pending ? (
        <button type="button" disabled={busy} onClick={() => setReview(true)}>
          继续复习
        </button>
      ) : (
        <strong>今日已完成</strong>
      )}
      <footer>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={onEdit}
        >
          编辑
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void onToggle()}
        >
          {s.enabled ? "暂停" : "启用"}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => void onArchive()}
        >
          归档
        </button>
      </footer>
      {review && pending ? (
        <div className="review-inline">
          <QuestionReview
            item={pending}
            queueId={q?.id ?? ""}
            busy={busy}
            onFeedback={onFeedback}
            onUndo={onUndo}
          />
        </div>
      ) : null}
    </article>
  );
}
function QuestionReview({
  item,
  queueId,
  busy,
  onFeedback,
  onUndo,
}: {
  item: ReviewSchemeQueueItem;
  queueId: string;
  busy: boolean;
  onFeedback(
    queueId: string,
    questionId: string,
    rating: ReviewSchemeRating,
  ): Promise<boolean>;
  onUndo(queueId: string): Promise<boolean>;
}) {
  return (
    <div>
      <h4>{item.question.question.title}</h4>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void onFeedback(queueId, item.question.question.id, "mastered")
        }
      >
        掌握
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void onFeedback(queueId, item.question.question.id, "uncertain")
        }
      >
        模糊
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void onFeedback(queueId, item.question.question.id, "failed")
        }
      >
        不会
      </button>
      <button
        type="button"
        className="text-button"
        disabled={busy || !queueId}
        onClick={() => void onUndo(queueId)}
      >
        撤销
      </button>
    </div>
  );
}
export { EMPTY_DRAFT, draftFromScheme };
