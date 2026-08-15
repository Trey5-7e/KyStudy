import { useState, type FormEvent } from "react";

import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { Input } from "../../shared/ui/Input";
import { StatusBanner } from "../../shared/ui/StatusBanner";
import type { ResourceCommandError } from "../../shared/tauri/resourceClient";
import {
  normalizePlanningError,
  saveStudyPlan,
  setStudyPlanStatus,
  type StudyPlanBundle,
} from "../../shared/tauri/planningClient";

interface TodayExamEditorDialogProps {
  activePlan?: StudyPlanBundle;
  today: string;
  onClose(): void;
  onSaveStart(): void;
  onSaved(activePlan: StudyPlanBundle): void;
}

export function TodayExamEditorDialog({
  activePlan,
  today,
  onClose,
  onSaveStart,
  onSaved,
}: TodayExamEditorDialogProps) {
  const initialName =
    activePlan?.plan.targetExam ??
    (activePlan?.plan.examDate === undefined ? "" : activePlan.plan.title);
  const initialDate = activePlan?.plan.examDate ?? "";
  const [examName, setExamName] = useState(initialName);
  const [examDate, setExamDate] = useState(initialDate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ResourceCommandError>();
  const dirty = examName !== initialName || examDate !== initialDate;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = examName.trim();
    if (normalizedName === "" || examDate < today) return;
    onSaveStart();
    setSaving(true);
    setError(undefined);
    let activated: StudyPlanBundle;
    try {
      const saved = await saveStudyPlan({
        id: activePlan?.plan.id,
        expectedRevision: activePlan?.plan.revision,
        title: activePlan?.plan.title ?? normalizedName,
        targetExam: normalizedName,
        examDate,
        overview: activePlan?.plan.overview,
      });
      activated =
        saved.plan.status === "active"
          ? saved
          : await setStudyPlanStatus(
              saved.plan.id,
              saved.plan.revision,
              "active",
            );
    } catch (saveError: unknown) {
      setError(normalizePlanningError(saveError));
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved(activated);
  };

  return (
    <EditorDialog
      title={activePlan === undefined ? "设置最近考试" : "编辑最近考试"}
      description="考试名称和日期会显示在今日页，并用于计算倒计时。"
      dirty={dirty}
      closeDisabled={saving}
      onRequestClose={onClose}
    >
      <form className="editor-form" onSubmit={(event) => void submit(event)}>
        <Field label="考试名称" htmlFor="today-exam-name" required>
          <Input
            id="today-exam-name"
            name="today-exam-name"
            autoComplete="off"
            required
            maxLength={120}
            placeholder="例如：2027 计算机考研"
            value={examName}
            onChange={(event) => setExamName(event.target.value)}
          />
        </Field>
        <Field label="考试日期" htmlFor="today-exam-date" required>
          <Input
            id="today-exam-date"
            name="today-exam-date"
            type="date"
            required
            min={today}
            value={examDate}
            onChange={(event) => setExamDate(event.target.value)}
          />
        </Field>
        {error === undefined ? null : (
          <StatusBanner tone="error" title={error.message}>
            {error.action}
          </StatusBanner>
        )}
        <EditorDialogFooter>
          <EditorDialogCloseButton
            className="ui-button ui-button-secondary ui-button-md"
            disabled={saving}
          >
            取消
          </EditorDialogCloseButton>
          <Button
            type="submit"
            variant="primary"
            disabled={saving || examName.trim() === "" || examDate < today}
          >
            {saving ? "正在保存…" : "保存考试"}
          </Button>
        </EditorDialogFooter>
      </form>
    </EditorDialog>
  );
}
