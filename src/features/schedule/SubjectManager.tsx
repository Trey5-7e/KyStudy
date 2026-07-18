import { useState } from "react";

import {
  normalizeScheduleCommandError,
  type CreateSubjectInput,
  type ScheduleCommandError,
  type StudySubject,
  type SubjectColor,
} from "../../shared/tauri/scheduleClient";

const COLOR_OPTIONS: ReadonlyArray<{
  value: SubjectColor;
  label: string;
}> = [
  { value: "blue", label: "蓝色" },
  { value: "green", label: "绿色" },
  { value: "purple", label: "紫色" },
  { value: "orange", label: "橙色" },
  { value: "cyan", label: "青色" },
  { value: "amber", label: "琥珀" },
  { value: "rose", label: "玫红" },
  { value: "slate", label: "灰色" },
];

interface SubjectManagerProps {
  subjects: StudySubject[];
  onCreate: (request: CreateSubjectInput) => Promise<void>;
  onArchive: (subjectId: string) => Promise<void>;
}

export function SubjectManager({
  subjects,
  onCreate,
  onArchive,
}: SubjectManagerProps) {
  const [name, setName] = useState("");
  const [colorKey, setColorKey] = useState<SubjectColor>("blue");
  const [isCreating, setIsCreating] = useState(false);
  const [archivingId, setArchivingId] = useState<string>();
  const [confirmArchiveId, setConfirmArchiveId] = useState<string>();
  const [error, setError] = useState<ScheduleCommandError>();
  const activeSubjects = subjects.filter(
    (subject) => subject.archivedAt === undefined,
  );
  const archivedSubjects = subjects.filter(
    (subject) => subject.archivedAt !== undefined,
  );

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (normalizedName === "") {
      return;
    }
    const nextSortOrder =
      subjects.reduce(
        (maximum, subject) => Math.max(maximum, subject.sortOrder),
        -1,
      ) + 1;
    setIsCreating(true);
    setError(undefined);
    try {
      await onCreate({
        name: normalizedName,
        colorKey,
        sortOrder: nextSortOrder,
      });
      setName("");
      setColorKey("blue");
    } catch (reason: unknown) {
      setError(normalizeScheduleCommandError(reason));
    } finally {
      setIsCreating(false);
    }
  };

  const handleArchive = async (subjectId: string) => {
    setArchivingId(subjectId);
    setError(undefined);
    try {
      await onArchive(subjectId);
      setConfirmArchiveId(undefined);
    } catch (reason: unknown) {
      setError(normalizeScheduleCommandError(reason));
    } finally {
      setArchivingId(undefined);
    }
  };

  return (
    <section className="subject-manager" aria-labelledby="subject-title">
      <div className="subject-heading">
        <div>
          <p className="section-label">科目管理</p>
          <h3 id="subject-title">给任务一个稳定的归属</h3>
        </div>
        <p>归档不会删除任务，只会让该科目退出新的任务选择。</p>
      </div>

      <form
        className="subject-form"
        onSubmit={(event) => void handleCreate(event)}
      >
        <label>
          科目名称
          <input
            type="text"
            maxLength={40}
            required
            disabled={isCreating}
            value={name}
            placeholder="例如：408、英语、高等数学"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          标记颜色
          <select
            value={colorKey}
            disabled={isCreating}
            onChange={(event) =>
              setColorKey(event.target.value as SubjectColor)
            }
          >
            {COLOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={isCreating || name.trim() === ""}>
          {isCreating ? "正在创建…" : "创建科目"}
        </button>
      </form>

      {error === undefined ? null : (
        <div className="error-detail" role="alert">
          <p>{error.message}</p>
          <p>{error.action}</p>
        </div>
      )}

      {activeSubjects.length === 0 ? (
        <p className="subject-empty">还没有有效科目，任务仍可使用“未分类”。</p>
      ) : (
        <ul className="subject-list">
          {activeSubjects.map((subject) => {
            const isConfirming = confirmArchiveId === subject.id;
            return (
              <li key={subject.id}>
                <div className="subject-copy">
                  <span
                    className={`subject-dot subject-color-${subject.colorKey}`}
                    aria-hidden="true"
                  />
                  <strong>{subject.name}</strong>
                  <span>有效</span>
                </div>
                <div className="subject-actions">
                  {isConfirming ? (
                    <>
                      <button
                        type="button"
                        className="danger-button"
                        disabled={archivingId === subject.id}
                        onClick={() => void handleArchive(subject.id)}
                      >
                        {archivingId === subject.id ? "正在归档…" : "确认归档"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={archivingId === subject.id}
                        onClick={() => setConfirmArchiveId(undefined)}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setConfirmArchiveId(subject.id)}
                    >
                      归档
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {archivedSubjects.length === 0 ? null : (
        <details className="archived-subjects">
          <summary>已归档科目（{archivedSubjects.length}）</summary>
          <ul>
            {archivedSubjects.map((subject) => (
              <li key={subject.id}>
                <span
                  className={`subject-dot subject-color-${subject.colorKey}`}
                  aria-hidden="true"
                />
                <span>{subject.name}</span>
                <small>只保留在已有任务中</small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
