import type { RefObject } from "react";

import {
  type IndexedQuestion,
  type QuestionBankSnapshot,
  type TrashedWorkbookDocumentSegment,
} from "../../shared/tauri/questionBankClient";
import type {
  ResourceCommandError,
  ResourceDocument,
} from "../../shared/tauri/resourceClient";
import type { StudySubject } from "../../shared/tauri/scheduleClient";
import type { AttemptResult } from "../../shared/tauri/questionClient";
import {
  QuestionBankToolsDialog,
  type QuestionBankToolsStatus,
} from "./QuestionBankToolsDialog";
import { SegmentManagerDialog } from "./SegmentManagerDialog";
import {
  CreateSubjectDialog,
  CreateWorkbookDialog,
  SegmentTrashDialog,
} from "./QuestionBankSetupDialogs";
import { QuickRecordDialog } from "./QuickRecordDialog";
import { PaperDialog, PaperSetupDialog } from "./QuestionBankPaperDialogs";
import type { PaperDraftRecipe } from "./paperSetupPreferences";
import {
  QuestionIndexBrowserDialog,
  type ManualIndexDialogComponent,
} from "./QuestionIndexDialogs";
import { ImportIndexDialog } from "./QuestionBankImportDialog";
import { OcrComponentManagementDialog } from "./OcrComponentManagementDialog";
import {
  type DialogKind,
  type QuestionBankTool,
  type QuestionBankToolsSection,
  type QuestionBankWindow,
} from "./questionBankWindowModel";

export interface QuestionBankWindowPresenterProps {
  activeWindow: QuestionBankWindow | undefined;
  snapshot: QuestionBankSnapshot;
  resources: ResourceDocument[];
  subjects: StudySubject[];
  timezone: string;
  loading: boolean;
  trashedSegments: TrashedWorkbookDocumentSegment[];
  segmentTrashLoading: boolean;
  segmentTrashError?: ResourceCommandError;
  segmentRestoreBusyId?: string;
  segmentRestoreError?: ResourceCommandError;
  segmentManagerNotice: string;
  segmentTrashHeadingRef: RefObject<HTMLHeadingElement | null>;
  segmentRestoreButtonRefs: RefObject<Map<string, HTMLButtonElement>>;
  toolsSection: QuestionBankToolsSection;
  toolsRefreshBusy: boolean;
  toolsRefreshStatus?: QuestionBankToolsStatus;
  toolsTriggerRef: RefObject<HTMLButtonElement | null>;
  importTriggerRef: RefObject<HTMLButtonElement | null>;
  questionBankFocusFallbackRef: RefObject<HTMLHeadingElement | null>;
  manualIndexDialog: ManualIndexDialogComponent;
  onClose: () => void;
  onBack: () => void;
  onCloseDialog: (dialog: DialogKind) => void;
  onSubjectCreated: (subject: StudySubject) => void;
  onWorkbookCreated: (
    workbook: QuestionBankSnapshot["workbooks"][number],
  ) => void;
  onCloseSegmentManager: () => void;
  onCloseSegmentTrash: () => void;
  onSelectTool: (
    tool: QuestionBankTool,
    section?: QuestionBankToolsSection,
  ) => void;
  onSectionChange: (section: QuestionBankToolsSection) => void;
  onRefreshTools: () => Promise<void>;
  onRefreshSegmentTrash: () => void;
  onRestoreSegment: (
    segment: TrashedWorkbookDocumentSegment,
    trigger: HTMLButtonElement,
  ) => void;
  onSegmentChanged: (next: QuestionBankSnapshot, notice?: string) => void;
  onSegmentRefresh: () => Promise<QuestionBankSnapshot | undefined>;
  onBrowseSegment: () => void;
  onContinueIndex: () => void;
  onSnapshotChanged: (next: QuestionBankSnapshot) => void;
  onPaperGenerated: (
    questions: IndexedQuestion[],
    recipe: PaperDraftRecipe,
    results?: Record<string, AttemptResult>,
    recordedResults?: Record<string, AttemptResult>,
  ) => void;
}

export function QuestionBankWindowPresenter({
  activeWindow,
  snapshot,
  resources,
  subjects,
  timezone,
  loading,
  trashedSegments,
  segmentTrashLoading,
  segmentTrashError,
  segmentRestoreBusyId,
  segmentRestoreError,
  segmentManagerNotice,
  segmentTrashHeadingRef,
  segmentRestoreButtonRefs,
  toolsSection,
  toolsRefreshBusy,
  toolsRefreshStatus,
  toolsTriggerRef,
  importTriggerRef,
  questionBankFocusFallbackRef,
  manualIndexDialog: ManualIndexDialog,
  onClose,
  onBack,
  onCloseDialog,
  onSubjectCreated,
  onWorkbookCreated,
  onCloseSegmentManager,
  onCloseSegmentTrash,
  onSelectTool,
  onSectionChange,
  onRefreshTools,
  onRefreshSegmentTrash,
  onRestoreSegment,
  onSegmentChanged,
  onSegmentRefresh,
  onBrowseSegment,
  onContinueIndex,
  onSnapshotChanged,
  onPaperGenerated,
}: QuestionBankWindowPresenterProps) {
  const toolsOpen = activeWindow?.kind === "tools";
  const segmentTrashOpen = activeWindow?.kind === "segment-trash";
  const segmentManagerTarget =
    activeWindow?.kind === "segment-manager"
      ? snapshot.segments.find(
          (segment) => segment.id === activeWindow.segmentId,
        )
      : undefined;
  const dialog =
    activeWindow?.kind === "dialog" ? activeWindow.dialog : undefined;
  const dialogSegmentId =
    activeWindow?.kind === "dialog"
      ? (activeWindow.segmentId ??
        (activeWindow.origin.kind === "segment-manager"
          ? activeWindow.origin.segmentId
          : undefined))
      : undefined;
  const paper = activeWindow?.kind === "paper" ? activeWindow.questions : [];
  const paperResults =
    activeWindow?.kind === "paper" ? activeWindow.results : undefined;
  const paperRecordedResults =
    activeWindow?.kind === "paper" ? activeWindow.recordedResults : undefined;
  const activeChildOrigin =
    activeWindow?.kind === "dialog" || activeWindow?.kind === "paper"
      ? activeWindow.origin
      : undefined;
  const childBackLabel =
    activeChildOrigin?.kind === "tools"
      ? "返回题库工具"
      : activeChildOrigin?.kind === "segment-manager"
        ? "返回分段管理"
        : undefined;

  return (
    <>
      {toolsOpen ? (
        <QuestionBankToolsDialog
          section={
            activeWindow.kind === "tools" ? activeWindow.section : toolsSection
          }
          onSectionChange={onSectionChange}
          focusTool={
            activeWindow.kind === "tools" ? activeWindow.focusTool : undefined
          }
          onClose={onClose}
          onSelect={onSelectTool}
          availability={{
            loading,
            subjectCount: subjects.length,
            workbookCount: snapshot.workbooks.length,
            pdfCount: resources.filter((resource) => resource.kind === "pdf")
              .length,
            segmentCount: snapshot.segments.length,
            questionCount: snapshot.questions.length,
          }}
          onRefresh={onRefreshTools}
          refreshBusy={toolsRefreshBusy}
          status={toolsRefreshStatus}
          returnFocusRef={toolsTriggerRef}
          fallbackFocusRef={questionBankFocusFallbackRef}
        />
      ) : null}

      {segmentManagerTarget === undefined ? null : (
        <SegmentManagerDialog
          key={`${segmentManagerTarget.id}:${segmentManagerTarget.updatedAt}`}
          snapshot={snapshot}
          segment={segmentManagerTarget}
          trashedSegments={trashedSegments}
          notice={segmentManagerNotice}
          onClose={onCloseSegmentManager}
          onChanged={onSegmentChanged}
          onRefresh={onSegmentRefresh}
          onBrowse={onBrowseSegment}
          onContinueIndex={onContinueIndex}
        />
      )}

      {segmentTrashOpen ? (
        <SegmentTrashDialog
          snapshot={snapshot}
          segments={trashedSegments}
          loading={segmentTrashLoading}
          error={segmentRestoreError ?? segmentTrashError}
          busyId={segmentRestoreBusyId}
          headingRef={segmentTrashHeadingRef}
          restoreButtonRefs={segmentRestoreButtonRefs}
          onClose={onCloseSegmentTrash}
          onRefresh={onRefreshSegmentTrash}
          onRestore={(segment, trigger) => onRestoreSegment(segment, trigger)}
        />
      ) : null}

      {dialog === "subject" ? (
        <CreateSubjectDialog
          subjects={subjects}
          onClose={() => onCloseDialog("subject")}
          onRequestBack={childBackLabel === undefined ? undefined : onBack}
          backLabel={childBackLabel}
          onCreated={(subject) => {
            onSubjectCreated(subject);
            onCloseDialog("subject");
          }}
        />
      ) : null}
      {dialog === "workbook" ? (
        <CreateWorkbookDialog
          onClose={() => onCloseDialog("workbook")}
          onRequestBack={childBackLabel === undefined ? undefined : onBack}
          backLabel={childBackLabel}
          onCreated={(workbook) => {
            onWorkbookCreated(workbook);
            onCloseDialog("workbook");
          }}
        />
      ) : null}
      {dialog === "ocr" ? (
        <OcrComponentManagementDialog
          onClose={() => onCloseDialog("ocr")}
          onRequestBack={childBackLabel === undefined ? undefined : onBack}
          backLabel={childBackLabel}
        />
      ) : null}
      {dialog === "import" ? (
        <ImportIndexDialog
          resources={resources.filter((resource) => resource.kind === "pdf")}
          subjects={subjects}
          workbooks={snapshot.workbooks}
          segments={snapshot.segments}
          questions={snapshot.questions}
          onClose={() => onCloseDialog("import")}
          onRequestBack={childBackLabel === undefined ? undefined : onBack}
          backLabel={childBackLabel}
          returnFocusRef={importTriggerRef}
          fallbackFocusRef={questionBankFocusFallbackRef}
          onImported={onSnapshotChanged}
        />
      ) : null}
      {dialog === "manual" ? (
        <ManualIndexDialog
          key={dialogSegmentId ?? "manual-all"}
          snapshot={snapshot}
          initialSegmentId={dialogSegmentId}
          onClose={() => onCloseDialog("manual")}
          onRequestBack={childBackLabel === undefined ? undefined : onBack}
          backLabel={childBackLabel}
          onSaved={(next) => {
            onSnapshotChanged(next);
            onCloseDialog("manual");
          }}
        />
      ) : null}
      {dialog === "browse" ? (
        <QuestionIndexBrowserDialog
          key={dialogSegmentId ?? "browse-all"}
          snapshot={snapshot}
          initialSegmentId={dialogSegmentId}
          manualIndexDialog={ManualIndexDialog}
          onClose={() => onCloseDialog("browse")}
          onRequestBack={childBackLabel === undefined ? undefined : onBack}
          backLabel={childBackLabel}
          onChanged={onSnapshotChanged}
        />
      ) : null}
      {dialog === "record" ? (
        <QuickRecordDialog
          questions={snapshot.questions}
          timezone={timezone}
          onClose={() => onCloseDialog("record")}
          onRequestBack={childBackLabel === undefined ? undefined : onBack}
          backLabel={childBackLabel}
          onSaved={(next) => {
            onSnapshotChanged(next);
            onCloseDialog("record");
          }}
        />
      ) : null}
      {dialog === "paper" ? (
        <PaperSetupDialog
          questions={snapshot.questions}
          onClose={() => onCloseDialog("paper")}
          onRequestBack={childBackLabel === undefined ? undefined : onBack}
          backLabel={childBackLabel}
          onGenerated={onPaperGenerated}
        />
      ) : null}
      {paper.length === 0 ? null : (
        <PaperDialog
          questions={paper}
          recipe={
            activeWindow?.kind === "paper" ? activeWindow.recipe : undefined
          }
          initialResults={paperResults}
          initialRecordedResults={paperRecordedResults}
          snapshot={snapshot}
          timezone={timezone}
          manualIndexDialog={ManualIndexDialog}
          onClose={onClose}
          onRequestBack={childBackLabel === undefined ? undefined : onBack}
          backLabel={childBackLabel}
          onSnapshotChanged={onSnapshotChanged}
          onSaved={(next) => {
            onSnapshotChanged(next);
            onClose();
          }}
        />
      )}
    </>
  );
}
