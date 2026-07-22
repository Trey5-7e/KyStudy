import { useEffect, useState } from "react";

import {
  ResourcePanel,
  type ResourceOpenRequest,
} from "../features/library/ResourcePanel";
import { PersonalPlanPanel } from "../features/planning/PersonalPlanPanel";
import { BackupPanel } from "../features/backup/BackupPanel";
import { AiFoundationPanel } from "../features/ai/AiFoundationPanel";
import { MindMapPanel } from "../features/mindmap/MindMapPanel";
import { WorkbookPanel } from "../features/workbook/WorkbookPanel";
import { ReviewPanel } from "../features/review/ReviewPanel";
import { TodayTaskPanel } from "../features/schedule/TodayTaskPanel";
import { ScheduleOverviewPanel } from "../features/schedule/ScheduleOverviewPanel";
import { WorkspacePanel } from "../features/workspace/WorkspacePanel";
import {
  getRuntimeStatus,
  normalizeCommandError,
  type RuntimeStatus,
} from "../shared/tauri/runtimeClient";

type RuntimeState =
  | { kind: "loading" }
  | { kind: "ready"; status: RuntimeStatus }
  | { kind: "error"; message: string };

const CURRENT_BOUNDARIES = [
  "前端只通过类型化 Command DTO 与本地核心通信",
  "SQLite 由 Rust Repository 管理，不向 WebView 暴露路径或 SQL",
  "PDF 只经 document ID 和受控 Range 协议读取，不暴露路径或整本 Base64",
  "OPML 与 FreeMind 只生成待确认草案，XMind 需先导出为 OPML",
  "AI 只在外发预览和明确确认后调用；密钥保存在系统凭据存储",
] as const;

export function App() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({
    kind: "loading",
  });
  const [resourceOpenRequest, setResourceOpenRequest] =
    useState<ResourceOpenRequest>();

  const retryRuntimeStatus = async () => {
    setRuntimeState({ kind: "loading" });

    try {
      const status = await getRuntimeStatus();
      setRuntimeState({ kind: "ready", status });
    } catch (error: unknown) {
      const appError = normalizeCommandError(error);
      setRuntimeState({ kind: "error", message: appError.message });
    }
  };

  useEffect(() => {
    let isActive = true;

    void getRuntimeStatus().then(
      (status) => {
        if (isActive) {
          setRuntimeState({ kind: "ready", status });
        }
      },
      (error: unknown) => {
        if (isActive) {
          const appError = normalizeCommandError(error);
          setRuntimeState({ kind: "error", message: appError.message });
        }
      },
    );

    return () => {
      isActive = false;
    };
  }, []);

  const runtimeStatusText =
    runtimeState.kind === "loading"
      ? "正在检查本地核心…"
      : runtimeState.kind === "ready"
        ? "本地核心已连接"
        : runtimeState.message;

  return (
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow">KyStudy · M8 AI 基础设施</p>
        <h1 id="page-title">先看清发送什么，再决定是否调用</h1>
        <p className="lead">
          本地管理 Provider、系统密钥、Token 预算、请求缓存和调用记录；AI
          输出仍然只是建议，不会自动修改学习数据。
        </p>
      </section>

      <section className="status-card" aria-labelledby="runtime-title">
        <div>
          <p className="section-label">运行状态</p>
          <h2 id="runtime-title" aria-live="polite">
            {runtimeStatusText}
          </h2>
        </div>
        {runtimeState.kind === "error" ? (
          <button type="button" onClick={() => void retryRuntimeStatus()}>
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

      <WorkspacePanel />

      <TodayTaskPanel />

      <ScheduleOverviewPanel />

      <PersonalPlanPanel
        onOpenReference={(documentId, page) =>
          setResourceOpenRequest({ documentId, page, nonce: Date.now() })
        }
      />

      <MindMapPanel
        onOpenResource={(documentId, page) =>
          setResourceOpenRequest({ documentId, page, nonce: Date.now() })
        }
      />

      <WorkbookPanel />

      <ReviewPanel />

      <ResourcePanel openRequest={resourceOpenRequest} />

      <AiFoundationPanel />

      <BackupPanel />

      <section className="boundary-card" aria-labelledby="boundary-title">
        <p className="section-label">已经锁定的边界</p>
        <h2 id="boundary-title">先把基础做稳，再增加功能</h2>
        <ul>
          {CURRENT_BOUNDARIES.map((boundary) => (
            <li key={boundary}>{boundary}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
