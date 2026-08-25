import type { ReactNode } from "react";

import type { IndexedQuestion } from "../shared/tauri/questionBankClient";
import type { QuestionBankOpenRequest } from "../features/workbook/questionBankWindowModel";
import type { ResourceOpenRequest } from "../features/library/ResourcePanel";
import { shouldInterceptNavigationClick, type AppView } from "./navigation";
import { AppNavigation } from "./AppNavigation";
import { AppPageContent } from "./AppPageContent";

export interface AppShellProps {
  activeView: AppView;
  reviewOpenRequest?: number;
  workbookOpenRequest?: QuestionBankOpenRequest;
  resourceOpenRequest?: ResourceOpenRequest;
  onOpenReviewWindow: () => void;
  onOpenPaperShortcut: () => void;
  onOpenSettings: () => void;
  onBackToPlanning: () => void;
  onOpenReference: (documentId: string, page: number) => void;
  onStartPaper?: (questions: IndexedQuestion[], title?: string) => void;
  onNavigate: (view: AppView) => void;
}

function BackToPlanningAction({
  onNavigate,
}: {
  onNavigate: (view: AppView) => void;
}) {
  return (
    <a
      href="#planning"
      onClick={(event) => {
        if (!shouldInterceptNavigationClick(event)) {
          return;
        }
        event.preventDefault();
        onNavigate("planning");
      }}
    >
      返回计划
    </a>
  );
}

export function AppShell({
  activeView,
  reviewOpenRequest,
  workbookOpenRequest,
  resourceOpenRequest,
  onOpenReviewWindow,
  onOpenPaperShortcut,
  onOpenSettings,
  onBackToPlanning,
  onOpenReference,
  onStartPaper,
  onNavigate,
}: AppShellProps) {
  const isWideContentView =
    activeView === "workbook" ||
    activeView === "review" ||
    activeView === "ai-chat" ||
    activeView === "ai-settings";
  const backAction: ReactNode =
    activeView === "schedule" ? (
      <BackToPlanningAction onNavigate={onNavigate} />
    ) : undefined;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>

      <AppNavigation activeView={activeView} onNavigate={onNavigate} />

      <main
        id="main-content"
        className={`app-content${isWideContentView ? " app-content-wide-view" : ""}`}
        tabIndex={-1}
      >
        <AppPageContent
          activeView={activeView}
          reviewOpenRequest={reviewOpenRequest}
          workbookOpenRequest={workbookOpenRequest}
          resourceOpenRequest={resourceOpenRequest}
          backAction={backAction}
          onOpenReviewWindow={onOpenReviewWindow}
          onOpenPaperShortcut={onOpenPaperShortcut}
          onOpenSettings={onOpenSettings}
          onBackToPlanning={onBackToPlanning}
          onOpenReference={onOpenReference}
          onStartPaper={onStartPaper}
          onNavigate={onNavigate}
        />
      </main>
    </div>
  );
}
