import { lazy, Suspense, type ComponentType, type ReactNode } from "react";

import type { ResourceOpenRequest } from "../features/library/ResourcePanel";
import { PageHeader, PageStatus } from "../shared/components/PagePrimitives";
import type { AppView } from "./navigation";
import type { QuestionBankOpenRequest } from "../features/workbook/questionBankWindowModel";

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
  settings: { label: "设置", caption: "学习偏好、AI 与本地数据" },
};

export interface AppPageContentProps {
  activeView: AppView;
  resourceOpenRequest?: ResourceOpenRequest;
  reviewOpenRequest?: number;
  workbookOpenRequest?: QuestionBankOpenRequest;
  backAction?: ReactNode;
  onOpenResource: (documentId: string, page: number) => void;
  onOpenReviewWindow: () => void;
  onOpenPaperShortcut: () => void;
  onOpenSettings: () => void;
  onBackToPlanning: () => void;
  onNavigate: (view: AppView) => void;
}

function PageContent({
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
    case "settings":
      return (
        <SettingsPanel
          onOpenReference={onOpenResource}
          onOpenSchedule={() => onNavigate("schedule")}
        />
      );
  }
}

export function AppPageContent({
  activeView,
  resourceOpenRequest,
  reviewOpenRequest,
  workbookOpenRequest,
  backAction,
  onOpenResource,
  onOpenReviewWindow,
  onOpenPaperShortcut,
  onOpenSettings,
  onBackToPlanning,
  onNavigate,
}: AppPageContentProps) {
  const currentPage = PAGE_META[activeView];
  return (
    <Suspense
      fallback={
        <div className="page-loading-shell">
          <PageHeader
            eyebrow="本地学习辅助"
            title={currentPage.label}
            description={currentPage.caption}
            backAction={backAction}
          />
          <PageStatus tone="loading" title="正在加载页面…" />
        </div>
      }
    >
      <PageContent
        activeView={activeView}
        resourceOpenRequest={resourceOpenRequest}
        reviewOpenRequest={reviewOpenRequest}
        workbookOpenRequest={workbookOpenRequest}
        onOpenResource={onOpenResource}
        onOpenReviewWindow={onOpenReviewWindow}
        onOpenPaperShortcut={onOpenPaperShortcut}
        onOpenSettings={onOpenSettings}
        onBackToPlanning={onBackToPlanning}
        onNavigate={onNavigate}
      />
    </Suspense>
  );
}
