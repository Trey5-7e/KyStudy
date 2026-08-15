import type { ReactNode } from "react";

import type { ResourceOpenRequest } from "../features/library/ResourcePanel";
import type { QuestionBankOpenRequest } from "../features/workbook/questionBankWindowModel";
import { shouldInterceptNavigationClick, type AppView } from "./navigation";
import { AppNavigation } from "./AppNavigation";
import { AppPageContent } from "./AppPageContent";

export interface AppShellProps {
  activeView: AppView;
  resourceOpenRequest?: ResourceOpenRequest;
  reviewOpenRequest?: number;
  workbookOpenRequest?: QuestionBankOpenRequest;
  onOpenResource: (documentId: string, page: number) => void;
  onOpenReviewWindow: () => void;
  onOpenPaperShortcut: () => void;
  onOpenSettings: () => void;
  onBackToPlanning: () => void;
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
  resourceOpenRequest,
  reviewOpenRequest,
  workbookOpenRequest,
  onOpenResource,
  onOpenReviewWindow,
  onOpenPaperShortcut,
  onOpenSettings,
  onBackToPlanning,
  onNavigate,
}: AppShellProps) {
  const isWideContentView =
    activeView === "workbook" || activeView === "review";
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
          resourceOpenRequest={resourceOpenRequest}
          reviewOpenRequest={reviewOpenRequest}
          workbookOpenRequest={workbookOpenRequest}
          backAction={backAction}
          onOpenResource={onOpenResource}
          onOpenReviewWindow={onOpenReviewWindow}
          onOpenPaperShortcut={onOpenPaperShortcut}
          onOpenSettings={onOpenSettings}
          onBackToPlanning={onBackToPlanning}
          onNavigate={onNavigate}
        />
      </main>
    </div>
  );
}
