import { lazy, Suspense, useEffect, useState } from "react";

import type { ResourceOpenRequest } from "../features/library/ResourcePanel";
import {
  getRuntimeStatus,
  normalizeCommandError,
  type RuntimeStatus,
} from "../shared/tauri/runtimeClient";
import { resolveStoredView, type AppView } from "./navigation";

const WorkspacePanel = lazy(() =>
  import("../features/workspace/WorkspacePanel").then((module) => ({
    default: module.WorkspacePanel,
  })),
);
const TodayTaskPanel = lazy(() =>
  import("../features/schedule/TodayTaskPanel").then((module) => ({
    default: module.TodayTaskPanel,
  })),
);
const ScheduleOverviewPanel = lazy(() =>
  import("../features/schedule/ScheduleOverviewPanel").then((module) => ({
    default: module.ScheduleOverviewPanel,
  })),
);
const PersonalPlanPanel = lazy(() =>
  import("../features/planning/PersonalPlanPanel").then((module) => ({
    default: module.PersonalPlanPanel,
  })),
);
const ResourcePanel = lazy(() =>
  import("../features/library/ResourcePanel").then((module) => ({
    default: module.ResourcePanel,
  })),
);
const MindMapPanel = lazy(() =>
  import("../features/mindmap/MindMapPanel").then((module) => ({
    default: module.MindMapPanel,
  })),
);
const WorkbookPanel = lazy(() =>
  import("../features/workbook/WorkbookPanel").then((module) => ({
    default: module.WorkbookPanel,
  })),
);
const ReviewPanel = lazy(() =>
  import("../features/review/ReviewPanel").then((module) => ({
    default: module.ReviewPanel,
  })),
);
const AiFoundationPanel = lazy(() =>
  import("../features/ai/AiFoundationPanel").then((module) => ({
    default: module.AiFoundationPanel,
  })),
);
const AnalyticsPanel = lazy(() =>
  import("../features/analytics/AnalyticsPanel").then((module) => ({
    default: module.AnalyticsPanel,
  })),
);
const BackupPanel = lazy(() =>
  import("../features/backup/BackupPanel").then((module) => ({
    default: module.BackupPanel,
  })),
);

type RuntimeState =
  | { kind: "loading" }
  | { kind: "ready"; status: RuntimeStatus }
  | { kind: "error"; message: string };

interface PageContentProps {
  activeView: AppView;
  resourceOpenRequest?: ResourceOpenRequest;
  runtimeState: RuntimeState;
  onOpenResource: (documentId: string, page: number) => void;
  onNavigate: (view: AppView) => void;
  onRetryRuntime: () => void;
}

const VIEW_STORAGE_KEY = "kystudy:last-view:v1";

const NAVIGATION: ReadonlyArray<{
  id: AppView;
  label: string;
  caption: string;
}> = [
  { id: "today", label: "今日", caption: "待办与工作区" },
  { id: "schedule", label: "日程", caption: "周计划与执行" },
  { id: "planning", label: "规划", caption: "个人备考阶段" },
  { id: "library", label: "资料", caption: "PDF、图片与搜索" },
  { id: "mindmap", label: "思维导图", caption: "知识结构" },
  { id: "workbook", label: "习题册", caption: "题目与作答" },
  { id: "review", label: "错题复习", caption: "今日复习队列" },
  { id: "analytics", label: "学习分析", caption: "进度与薄弱点" },
  { id: "ai", label: "AI 设置", caption: "Provider 与预算" },
  { id: "data", label: "数据与备份", caption: "运行状态与恢复" },
];

const CURRENT_BOUNDARIES = [
  "SQLite 与文件路径不向 WebView 暴露",
  "PDF 只通过 document ID 和受控 Range 协议读取",
  "AI 调用前必须预览并由用户明确确认",
  "API Key 只保存到系统安全凭据存储",
] as const;

function loadInitialView(): AppView {
  try {
    return resolveStoredView(window.localStorage.getItem(VIEW_STORAGE_KEY));
  } catch {
    return "today";
  }
}

function storeView(view: AppView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Navigation remains usable when WebView storage is disabled.
  }
}

function RuntimeStatusPanel({
  runtimeState,
  onRetry,
}: {
  runtimeState: RuntimeState;
  onRetry: () => void;
}) {
  const statusText =
    runtimeState.kind === "loading"
      ? "正在检查本地核心…"
      : runtimeState.kind === "ready"
        ? "本地核心已连接"
        : runtimeState.message;
  return (
    <section className="status-card" aria-labelledby="runtime-title">
      <div>
        <p className="section-label">运行状态</p>
        <h2 id="runtime-title" aria-live="polite">
          {statusText}
        </h2>
      </div>
      {runtimeState.kind === "error" ? (
        <button type="button" onClick={onRetry}>
          重新检查
        </button>
      ) : null}
      {runtimeState.kind === "ready" ? (
        <dl className="runtime-grid">
          <div>
            <dt>应用版本</dt>
            <dd>{runtimeState.status.appVersion}</dd>
          </div>
          <div>
            <dt>Schema</dt>
            <dd>v{runtimeState.status.schemaVersion}</dd>
          </div>
          <div>
            <dt>平台</dt>
            <dd>{runtimeState.status.platform}</dd>
          </div>
          <div>
            <dt>架构</dt>
            <dd>{runtimeState.status.architecture}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

function PageContent({
  activeView,
  resourceOpenRequest,
  runtimeState,
  onOpenResource,
  onNavigate,
  onRetryRuntime,
}: PageContentProps) {
  switch (activeView) {
    case "today":
      return (
        <>
          <WorkspacePanel />
          <TodayTaskPanel />
        </>
      );
    case "schedule":
      return <ScheduleOverviewPanel />;
    case "planning":
      return <PersonalPlanPanel onOpenReference={onOpenResource} />;
    case "library":
      return <ResourcePanel openRequest={resourceOpenRequest} />;
    case "mindmap":
      return <MindMapPanel onOpenResource={onOpenResource} />;
    case "workbook":
      return <WorkbookPanel />;
    case "review":
      return <ReviewPanel />;
    case "analytics":
      return (
        <AnalyticsPanel
          onOpenSchedule={() => onNavigate("schedule")}
          onOpenReview={() => onNavigate("review")}
          onOpenMindMap={() => onNavigate("mindmap")}
          onOpenAi={() => onNavigate("ai")}
        />
      );
    case "ai":
      return <AiFoundationPanel />;
    case "data":
      return (
        <>
          <RuntimeStatusPanel
            runtimeState={runtimeState}
            onRetry={onRetryRuntime}
          />
          <BackupPanel />
          <section className="boundary-card" aria-labelledby="boundary-title">
            <p className="section-label">数据边界</p>
            <h2 id="boundary-title">本地优先仍是默认行为</h2>
            <ul>
              {CURRENT_BOUNDARIES.map((boundary) => (
                <li key={boundary}>{boundary}</li>
              ))}
            </ul>
          </section>
        </>
      );
  }
}

export function App() {
  const [activeView, setActiveView] = useState<AppView>(loadInitialView);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({
    kind: "loading",
  });
  const [resourceOpenRequest, setResourceOpenRequest] =
    useState<ResourceOpenRequest>();

  const retryRuntimeStatus = async () => {
    setRuntimeState({ kind: "loading" });
    try {
      setRuntimeState({ kind: "ready", status: await getRuntimeStatus() });
    } catch (error: unknown) {
      setRuntimeState({
        kind: "error",
        message: normalizeCommandError(error).message,
      });
    }
  };

  useEffect(() => {
    let active = true;
    void getRuntimeStatus().then(
      (status) => {
        if (active) {
          setRuntimeState({ kind: "ready", status });
        }
      },
      (error: unknown) => {
        if (active) {
          setRuntimeState({
            kind: "error",
            message: normalizeCommandError(error).message,
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const navigate = (view: AppView) => {
    setActiveView(view);
    storeView(view);
  };

  const openResource = (documentId: string, page: number) => {
    setResourceOpenRequest({ documentId, page, nonce: Date.now() });
    navigate("library");
  };

  const currentPage =
    NAVIGATION.find((item) => item.id === activeView) ?? NAVIGATION[0]!;
  const coreStatus =
    runtimeState.kind === "ready"
      ? `Schema v${runtimeState.status.schemaVersion}`
      : runtimeState.kind === "loading"
        ? "正在连接本地核心"
        : "本地核心需要检查";

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span>KY</span>
          <div>
            <strong>KyStudy</strong>
            <small>本地考研工作台</small>
          </div>
        </div>
        <nav className="app-navigation" aria-label="主菜单">
          {NAVIGATION.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === activeView ? "app-nav-active" : undefined}
              aria-current={item.id === activeView ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.caption}</span>
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="app-core-status"
          onClick={() => navigate("data")}
        >
          <span
            className={
              runtimeState.kind === "ready" ? "core-online" : "core-pending"
            }
          />
          {coreStatus}
        </button>
      </aside>

      <main className="app-content">
        <header className="app-page-header">
          <div>
            <p className="eyebrow">KyStudy · M11</p>
            <h1>{currentPage.label}</h1>
          </div>
          <p>{currentPage.caption}</p>
        </header>
        <Suspense
          fallback={
            <p className="app-loading" role="status">
              正在加载页面…
            </p>
          }
        >
          <PageContent
            activeView={activeView}
            resourceOpenRequest={resourceOpenRequest}
            runtimeState={runtimeState}
            onOpenResource={openResource}
            onNavigate={navigate}
            onRetryRuntime={() => void retryRuntimeStatus()}
          />
        </Suspense>
      </main>
    </div>
  );
}
