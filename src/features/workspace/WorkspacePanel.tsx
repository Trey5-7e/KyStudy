import { useEffect, useState } from "react";

import {
  getWorkspaceStatus,
  initializeDefaultWorkspace,
  normalizeWorkspaceCommandError,
  type WorkspaceCommandError,
  type WorkspaceStatus,
} from "../../shared/tauri/workspaceClient";

type WorkspaceState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "initializing" }
  | { kind: "ready"; workspace: WorkspaceStatus }
  | { kind: "error"; error: WorkspaceCommandError };

export function WorkspacePanel() {
  const [state, setState] = useState<WorkspaceState>({ kind: "loading" });

  useEffect(() => {
    let isActive = true;

    void getWorkspaceStatus().then(
      (workspace) => {
        if (isActive) {
          setState(
            workspace === null
              ? { kind: "missing" }
              : { kind: "ready", workspace },
          );
        }
      },
      (error: unknown) => {
        if (isActive) {
          setState({
            kind: "error",
            error: normalizeWorkspaceCommandError(error),
          });
        }
      },
    );

    return () => {
      isActive = false;
    };
  }, []);

  const initializeWorkspace = async () => {
    setState({ kind: "initializing" });
    try {
      const workspace = await initializeDefaultWorkspace();
      setState({ kind: "ready", workspace });
    } catch (error: unknown) {
      setState({
        kind: "error",
        error: normalizeWorkspaceCommandError(error),
      });
    }
  };

  const title =
    state.kind === "loading"
      ? "正在检查工作区…"
      : state.kind === "missing"
        ? "尚未创建本地工作区"
        : state.kind === "initializing"
          ? "正在创建本地工作区…"
          : state.kind === "ready"
            ? state.workspace.name
            : state.error.message;

  return (
    <section className="workspace-card" aria-labelledby="workspace-title">
      <div>
        <p className="section-label">Workspace + SQLite</p>
        <h2 id="workspace-title" aria-live="polite">
          {title}
        </h2>
      </div>

      {state.kind === "missing" ? (
        <button type="button" onClick={() => void initializeWorkspace()}>
          创建本地工作区
        </button>
      ) : null}

      {state.kind === "ready" ? (
        <dl className="workspace-grid">
          <div>
            <dt>时区</dt>
            <dd>{state.workspace.timezone}</dd>
          </div>
          <div>
            <dt>每日错题</dt>
            <dd>{state.workspace.dailyReviewQuota} 道</dd>
          </div>
          <div>
            <dt>数据库 Schema</dt>
            <dd>v{state.workspace.schemaVersion}</dd>
          </div>
        </dl>
      ) : null}

      {state.kind === "error" ? (
        <div className="error-detail" role="alert">
          <p>{state.error.action}</p>
          {state.error.operationId === undefined ? null : (
            <p className="operation-id">操作编号：{state.error.operationId}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
