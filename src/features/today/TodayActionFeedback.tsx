import type { RefObject } from "react";

import { Button } from "../../shared/ui/Button";
import { StatusBanner } from "../../shared/ui/StatusBanner";
import type { CyclePlanCommandError } from "../../shared/tauri/cyclePlanClient";
import type { ReviewSchemeCommandError } from "../../shared/tauri/reviewSchemeClient";

interface TodayActionFeedbackProps {
  actionError?: CyclePlanCommandError | ReviewSchemeCommandError;
  notice?: string;
  undo?: { itemLabel: string };
  undoButtonRef: RefObject<HTMLButtonElement | null>;
  busyTaskId?: string;
  onUndo(): void;
}

export function TodayActionFeedback({
  actionError,
  notice,
  undo,
  undoButtonRef,
  busyTaskId,
  onUndo,
}: TodayActionFeedbackProps) {
  return (
    <>
      {actionError === undefined ? null : (
        <StatusBanner tone="error" title={actionError.message}>
          {actionError.action}
        </StatusBanner>
      )}
      {notice === undefined ? null : (
        <StatusBanner
          tone="success"
          actions={
            undo === undefined ? undefined : (
              <Button
                ref={undoButtonRef}
                variant="secondary"
                size="sm"
                disabled={busyTaskId !== undefined}
                aria-label={`撤销${undo.itemLabel}`}
                onClick={onUndo}
              >
                撤销
              </Button>
            )
          }
        >
          {notice}
        </StatusBanner>
      )}
    </>
  );
}
