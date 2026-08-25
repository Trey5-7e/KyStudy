import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

import type { IndexedQuestion } from "../shared/tauri/questionBankClient";
import { PageHeader, PageStatus } from "../shared/components/PagePrimitives";
import type { AppView } from "./navigation";
import type { QuestionBankOpenRequest } from "../features/workbook/questionBankWindowModel";
import type { ResourceOpenRequest } from "../features/library/ResourcePanel";

const TodayOverviewPanel = lazy(() =>
  import("../features/today/TodayOverviewPanel").then((module) => ({
    default: module.TodayOverviewPanel,
  })),
);

interface ScheduleOverviewPanelProps {
  onBackToPlanning: () => void;
}

const ScheduleOverviewPanel = lazy<ComponentType<ScheduleOverviewPanelProps>>(
  () =>
    import("../features/schedule/ScheduleOverviewPanel").then((module) => ({
      default:
        module.ScheduleOverviewPanel as ComponentType<ScheduleOverviewPanelProps>,
    })),
);

interface ReviewPanelProps {
  openRequest?: number;
  onOpenSettings: () => void;
}

const CyclePlanPanel = lazy(() =>
  import("../features/planning/CyclePlanPanel").then((module) => ({
    default: module.CyclePlanPanel,
  })),
);
const ResourcePanel = lazy(() =>
  import("../features/library/ResourcePanel").then((module) => ({
    default: module.ResourcePanel,
  })),
);
const WorkbookPanel = lazy(() =>
  import("../features/workbook/WorkbookPanel").then((module) => ({
    default: module.WorkbookPanel,
  })),
);
const ReviewPanel = lazy<ComponentType<ReviewPanelProps>>(() =>
  import("../features/review/ReviewPanel").then((module) => ({
    default: module.ReviewPanel as ComponentType<ReviewPanelProps>,
  })),
);
interface AiChatWorkspaceProps {
  onOpenReference(documentId: string, page: number): void;
  onOpenSettings(): void;
  onStartPaper?: (questions: IndexedQuestion[], title?: string) => void;
}

const AiChatWorkspace = lazy<ComponentType<AiChatWorkspaceProps>>(() =>
  import("../features/ai-chat/AiChatWorkspace").then((module) => ({
    default: module.AiChatWorkspace as ComponentType<AiChatWorkspaceProps>,
  })),
);
interface AiSettingsWorkspaceProps {
  onOpenChat(): void;
}

const AiSettingsWorkspace = lazy<ComponentType<AiSettingsWorkspaceProps>>(() =>
  import("../features/ai/AiSettingsWorkspace").then((module) => ({
    default:
      module.AiSettingsWorkspace as ComponentType<AiSettingsWorkspaceProps>,
  })),
);
const SettingsPanel = lazy(() =>
  import("../features/settings/SettingsPanel").then((module) => ({
    default: module.SettingsPanel,
  })),
);

export interface AppPageMeta {
  label: string;
  caption: string;
}

export const PAGE_META: Readonly<Record<AppView, AppPageMeta>> = {
  today: { label: "今日", caption: "只处理今天需要完成的内容" },
  planning: { label: "计划", caption: "管理周期目标和未来安排" },
  schedule: { label: "已有日程", caption: "查看已生成的历史日程任务" },
  workbook: { label: "习题册", caption: "从 PDF 保存题目并记录作答" },
  review: { label: "错题", caption: "让系统挑选今天应该复习的题" },
  library: { label: "资料", caption: "管理本地 PDF、图片和导图" },
  "ai-chat": { label: "AI 学习助手", caption: "对话、资料与题目讨论" },
  "ai-settings": { label: "模型与 API", caption: "Provider、模型与预算" },
  settings: { label: "设置", caption: "学习偏好、AI 与本地数据" },
};

export interface AppPageContentProps {
  activeView: AppView;
  reviewOpenRequest?: number;
  workbookOpenRequest?: QuestionBankOpenRequest;
  resourceOpenRequest?: ResourceOpenRequest;
  backAction?: ReactNode;
  onOpenReviewWindow: () => void;
  onOpenPaperShortcut: () => void;
  onOpenSettings: () => void;
  onBackToPlanning: () => void;
  onOpenReference: (documentId: string, page: number) => void;
  onStartPaper?: (questions: IndexedQuestion[], title?: string) => void;
  onNavigate: (view: AppView) => void;
}

function PageContent({
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
}: AppPageContentProps) {
  switch (activeView) {
    case "today":
      return (
        <TodayOverviewPanel
          onOpenPlan={() => onNavigate("planning")}
          onOpenReview={(openWindow) => {
            if (openWindow) onOpenReviewWindow();
            onNavigate("review");
          }}
          onOpenSettings={() => onNavigate("settings")}
          onOpenWorkbook={() => onNavigate("workbook")}
          onOpenPaper={onOpenPaperShortcut}
        />
      );
    case "planning":
      return <CyclePlanPanel />;
    case "schedule":
      return <ScheduleOverviewPanel onBackToPlanning={onBackToPlanning} />;
    case "library":
      return <ResourcePanel openRequest={resourceOpenRequest} />;
    case "workbook":
      return <WorkbookPanel openRequest={workbookOpenRequest} />;
    case "review":
      return (
        <ReviewPanel
          openRequest={reviewOpenRequest}
          onOpenSettings={onOpenSettings}
        />
      );
    case "ai-chat":
      return (
        <AiChatWorkspace
          onOpenReference={onOpenReference}
          onOpenSettings={() => onNavigate("ai-settings")}
          onStartPaper={onStartPaper}
        />
      );
    case "ai-settings":
      return <AiSettingsWorkspace onOpenChat={() => onNavigate("ai-chat")} />;
    case "settings":
      return <SettingsPanel />;
  }
}

export function AppPageContent({
  activeView,
  reviewOpenRequest,
  workbookOpenRequest,
  resourceOpenRequest,
  backAction,
  onOpenReviewWindow,
  onOpenPaperShortcut,
  onOpenSettings,
  onBackToPlanning,
  onOpenReference,
  onStartPaper,
  onNavigate,
}: AppPageContentProps) {
  const currentPage = PAGE_META[activeView];
  return (
    <Suspense
      fallback={
        <div className="page-loading-shell">
          <PageHeader title={currentPage.label} backAction={backAction} />
          <PageStatus tone="loading" title="正在加载页面…" />
        </div>
      }
    >
      <PageContent
        activeView={activeView}
        reviewOpenRequest={reviewOpenRequest}
        workbookOpenRequest={workbookOpenRequest}
        resourceOpenRequest={resourceOpenRequest}
        onOpenReviewWindow={onOpenReviewWindow}
        onOpenPaperShortcut={onOpenPaperShortcut}
        onOpenSettings={onOpenSettings}
        onBackToPlanning={onBackToPlanning}
        onOpenReference={onOpenReference}
        onStartPaper={onStartPaper}
        onNavigate={onNavigate}
      />
    </Suspense>
  );
}
