import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import {
  getRuntimeStatus,
  normalizeCommandError,
} from "../../shared/tauri/runtimeClient";
import {
  getWorkspaceStatus,
  normalizeWorkspaceCommandError,
} from "../../shared/tauri/workspaceClient";
import { PageHeader } from "../../shared/components/PagePrimitives";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { SectionHeader } from "../../shared/ui/SectionHeader";
import { StatusBanner } from "../../shared/ui/StatusBanner";
import {
  buildDiagnosticReport,
  diagnosticFileName,
  serializeDiagnosticReport,
  type DiagnosticReport,
} from "./diagnosticReport";

import "./settings.css";

const WorkspacePanel = lazy(() =>
  import("../workspace/WorkspacePanel").then((module) => ({
    default: module.WorkspacePanel,
  })),
);
const AiFoundationPanel = lazy(() =>
  import("../ai/AiFoundationPanel").then((module) => ({
    default: module.AiFoundationPanel,
  })),
);
const BackupPanel = lazy(() =>
  import("../backup/BackupPanel").then((module) => ({
    default: module.BackupPanel,
  })),
);
const AboutSettings = lazy(() =>
  import("./AboutSettings").then((module) => ({
    default: module.AboutSettings,
  })),
);

type SettingsTab = "study" | "ai" | "data" | "application" | "about";

/**
 * Keep one stable tabpanel target even while the active feature is lazy-loaded.
 * Inactive tabs must not point at DOM ids that do not exist in the document.
 */
export const SETTINGS_PANEL_ID = "settings-panel";

type DiagnosticState =
  | { kind: "loading" }
  | { kind: "ready"; report: DiagnosticReport }
  | { kind: "error"; message: string };

export const SETTINGS_TABS: ReadonlyArray<{
  id: SettingsTab;
  label: string;
  description: string;
}> = [
  { id: "study", label: "学习与考试", description: "本地工作区和学习偏好" },
  { id: "ai", label: "AI", description: "Provider、API Key 与预算" },
  { id: "data", label: "数据", description: "备份、恢复与问题排查" },
  { id: "application", label: "隐私与行为", description: "本地优先与外发确认" },
  { id: "about", label: "关于", description: "版本、更新与开源仓库" },
];

export function nextSettingsTab(
  current: SettingsTab,
  key: string,
): SettingsTab | null {
  const index = SETTINGS_TABS.findIndex((tab) => tab.id === current);
  if (index < 0) return null;
  if (key === "Home") return SETTINGS_TABS[0]!.id;
  if (key === "End") return SETTINGS_TABS[SETTINGS_TABS.length - 1]!.id;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return SETTINGS_TABS[(index + 1) % SETTINGS_TABS.length]!.id;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return SETTINGS_TABS[
      (index - 1 + SETTINGS_TABS.length) % SETTINGS_TABS.length
    ]!.id;
  }
  return null;
}

const CURRENT_BOUNDARIES = [
  "学习页面不会直接展示数据库和本地文件路径",
  "资料文件默认只在本地工作区内读取",
  "AI 调用前必须预览，并由你明确确认是否外发",
  "API Key 只保存到 Windows 凭据管理器",
] as const;

function DiagnosticPanel() {
  const [state, setState] = useState<DiagnosticState>({ kind: "loading" });
  const [previewOpen, setPreviewOpen] = useState(false);

  const refresh = async () => {
    setState({ kind: "loading" });
    try {
      const [runtime, workspace] = await Promise.all([
        getRuntimeStatus(),
        getWorkspaceStatus(),
      ]);
      setState({
        kind: "ready",
        report: buildDiagnosticReport(runtime, workspace),
      });
    } catch (error: unknown) {
      const normalized =
        error instanceof Error && error.message === "RUNTIME_STATUS_INVALID"
          ? normalizeCommandError(error)
          : normalizeWorkspaceCommandError(error);
      setState({ kind: "error", message: normalized.message });
    }
  };

  useEffect(() => {
    let active = true;
    void Promise.all([getRuntimeStatus(), getWorkspaceStatus()]).then(
      ([runtime, workspace]) => {
        if (active) {
          setState({
            kind: "ready",
            report: buildDiagnosticReport(runtime, workspace),
          });
        }
      },
      (error: unknown) => {
        if (active) {
          const normalized =
            error instanceof Error && error.message === "RUNTIME_STATUS_INVALID"
              ? normalizeCommandError(error)
              : normalizeWorkspaceCommandError(error);
          setState({ kind: "error", message: normalized.message });
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  if (state.kind === "loading") {
    return <StatusBanner tone="info" title="正在读取应用信息…" />;
  }

  if (state.kind === "error") {
    return (
      <StatusBanner
        tone="error"
        title={`暂时无法读取应用信息：${state.message}`}
        actions={
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            重新检查
          </Button>
        }
      />
    );
  }

  return (
    <section
      className="settings-section settings-runtime diagnostic-panel"
      aria-labelledby="diagnostic-title"
    >
      <SectionHeader
        id="diagnostic-title"
        level={3}
        title="应用信息"
        description="查看当前版本和工作区状态；反馈问题时可导出脱敏摘要"
        actions={
          <div className="settings-section-actions">
            <Badge tone="success">摘要已脱敏</Badge>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setPreviewOpen(true)}
            >
              导出诊断摘要
            </Button>
          </div>
        }
      />
      <dl className="settings-description-list">
        <div>
          <dt>应用版本</dt>
          <dd>{state.report.runtime.appVersion}</dd>
        </div>
        <div>
          <dt>平台 / 架构</dt>
          <dd>
            {state.report.runtime.platform} /{" "}
            {state.report.runtime.architecture}
          </dd>
        </div>
        <div>
          <dt>工作区</dt>
          <dd>
            {state.report.workspace.state === "ready"
              ? `已初始化 · ${state.report.workspace.timezone}`
              : "尚未初始化"}
          </dd>
        </div>
      </dl>
      {previewOpen ? (
        <DiagnosticPreview
          report={state.report}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </section>
  );
}

function DiagnosticPreview({
  report,
  onClose,
}: {
  report: DiagnosticReport;
  onClose(): void;
}) {
  const serialized = serializeDiagnosticReport(report);

  const download = () => {
    const blob = new Blob([serialized], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = diagnosticFileName(report.generatedAt);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div
      className="diagnostic-preview"
      role="dialog"
      aria-modal="true"
      aria-labelledby="diagnostic-preview-title"
    >
      <div className="diagnostic-preview-heading">
        <div>
          <h4 id="diagnostic-preview-title">导出前预览</h4>
          <p>确认内容不含学习资料、路径、密钥或 AI 请求正文后再导出。</p>
        </div>
        <button
          type="button"
          className="editor-dialog-close-button"
          aria-label="关闭导出前预览"
          title="关闭导出前预览"
          onClick={onClose}
        >
          <span className="editor-dialog-close-icon" aria-hidden="true">
            ×
          </span>
        </button>
      </div>
      <pre>{serialized}</pre>
      <div className="diagnostic-preview-actions">
        <Button variant="secondary" onClick={onClose}>
          取消
        </Button>
        <Button onClick={download}>导出 JSON</Button>
      </div>
    </div>
  );
}

function DataSettings() {
  return (
    <div className="settings-section-stack">
      <DiagnosticPanel />
      <Suspense
        fallback={<StatusBanner tone="info" title="正在加载备份设置…" />}
      >
        <BackupPanel />
      </Suspense>
    </div>
  );
}

function ApplicationSettings() {
  return (
    <div className="settings-section-stack">
      <section
        className="settings-section settings-boundaries"
        aria-labelledby="boundary-title"
      >
        <SectionHeader
          id="boundary-title"
          level={3}
          title="本地优先与隐私保护"
          description="数据默认保存在本机，外发前由你确认"
        />
        <ul className="settings-boundary-list">
          {CURRENT_BOUNDARIES.map((boundary) => (
            <li key={boundary}>{boundary}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("study");
  const active = SETTINGS_TABS.find((tab) => tab.id === activeTab)!;
  const settingsTabRefs = useRef<Record<SettingsTab, HTMLButtonElement | null>>(
    {
      study: null,
      ai: null,
      data: null,
      application: null,
      about: null,
    },
  );

  const selectSettingsTab = (next: SettingsTab) => {
    setActiveTab(next);
    requestAnimationFrame(() => settingsTabRefs.current[next]?.focus());
  };

  const handleSettingsTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: SettingsTab,
  ) => {
    const next = nextSettingsTab(current, event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    selectSettingsTab(next);
  };

  return (
    <div className="settings-page">
      <PageHeader id="settings-title" title="设置" />

      <div className="settings-surface">
        <div className="settings-layout">
          <div className="settings-tabs" role="tablist" aria-label="设置分类">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                ref={(node) => {
                  settingsTabRefs.current[tab.id] = node;
                }}
                type="button"
                id={`settings-tab-${tab.id}`}
                role="tab"
                aria-controls={SETTINGS_PANEL_ID}
                aria-describedby={`settings-tab-description-${tab.id}`}
                aria-selected={tab.id === activeTab}
                tabIndex={tab.id === activeTab ? 0 : -1}
                className={
                  tab.id === activeTab ? "settings-tab-active" : undefined
                }
                onClick={() => selectSettingsTab(tab.id)}
                onKeyDown={(event) => handleSettingsTabKeyDown(event, tab.id)}
              >
                <strong>{tab.label}</strong>
                <span id={`settings-tab-description-${tab.id}`}>
                  {tab.description}
                </span>
              </button>
            ))}
          </div>

          <section
            id={SETTINGS_PANEL_ID}
            className="settings-content"
            role="tabpanel"
            aria-labelledby={`settings-tab-${activeTab}`}
            tabIndex={0}
          >
            <SectionHeader
              className="settings-content-heading"
              title={active.label}
            />

            {activeTab === "study" ? (
              <Suspense
                fallback={
                  <StatusBanner tone="info" title="正在加载学习设置…" />
                }
              >
                <WorkspacePanel />
              </Suspense>
            ) : activeTab === "ai" ? (
              <Suspense
                fallback={
                  <StatusBanner tone="info" title="正在加载 AI 设置…" />
                }
              >
                <AiFoundationPanel />
              </Suspense>
            ) : activeTab === "data" ? (
              <DataSettings />
            ) : activeTab === "application" ? (
              <ApplicationSettings />
            ) : (
              <Suspense
                fallback={
                  <StatusBanner tone="info" title="正在加载关于设置…" />
                }
              >
                <AboutSettings />
              </Suspense>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
