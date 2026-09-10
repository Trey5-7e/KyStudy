import { invoke } from "@tauri-apps/api/core";
import { listAiChatConversations } from "./aiChatClient";
import { listResources } from "./resourceClient";
import { listResourceIndexStatuses } from "./resourceSearchClient";
import {
  type AgentBudget,
  type AgentGrant,
  type AgentRunSnapshot,
  type AgentRunState,
  type AgentTokenPolicy,
} from "./agentContract";

export interface AgentStartInput {
  conversationId: string;
  providerId: string;
  goal: string;
  previousRunId?: string;
  pages: Array<{ documentId: string; pages: number[] }>;
  budget: AgentBudget;
  tokenPolicy: AgentTokenPolicy;
}
export type AgentResult =
  | {
      kind: "tool";
      call: { id: string; tool: string; documentId: string; page: number };
    }
  | { kind: "tool_result"; call_id: string; source_id: string; text: string }
  | { kind: "final"; message: string; source_ids: string[] }
  | { kind: "needs_input"; question: string };
export interface AgentDetail {
  run: AgentRunSnapshot;
  goal: string;
  grant: AgentGrant;
  results: AgentResult[];
}
export interface AgentCatalog {
  conversations: Array<{ id: string; title: string }>;
  documents: Array<{ id: string; title: string; pageCount: number }>;
}
export interface AgentStudyApi {
  catalog(): Promise<AgentCatalog>;
  latest(conversationId: string): Promise<AgentRunSnapshot | null>;
  start(input: AgentStartInput): Promise<AgentRunSnapshot>;
  detail(runId: string): Promise<AgentDetail>;
  cancel(runId: string): Promise<AgentRunSnapshot>;
  source(
    runId: string,
    sourceId: string,
  ): Promise<{ documentId: string; page: number }>;
}

const states = new Set<AgentRunState>([
  "queued",
  "running",
  "waiting_for_input",
  "waiting_for_approval",
  "waiting_for_handoff",
  "interrupted",
  "completed",
  "failed",
  "canceled",
]);
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("AGENT_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 16384): string {
  if (typeof value !== "string" || value.length > max)
    throw new Error("AGENT_RESPONSE_INVALID");
  return value;
}
function number(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 4294967295
  )
    throw new Error("AGENT_RESPONSE_INVALID");
  return value;
}
function budget(value: unknown): AgentBudget {
  const b = record(value);
  return {
    models: number(b.models),
    tools: number(b.tools),
    input: number(b.input),
    output: number(b.output),
    activeMs: number(b.activeMs),
  };
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("AGENT_RESPONSE_INVALID");
  return value;
}
export function parseAgentRun(value: unknown): AgentRunSnapshot {
  const r = record(value);
  const state = text(r.state) as AgentRunState;
  const tokenPolicy = text(r.tokenPolicy) as AgentTokenPolicy;
  if (
    !states.has(state) ||
    !["observe", "warn", "enforce"].includes(tokenPolicy) ||
    typeof r.cancelRequested !== "boolean"
  )
    throw new Error("AGENT_RESPONSE_INVALID");
  return {
    id: text(r.id, 128),
    state,
    tokenPolicy,
    revision: number(r.revision),
    ownerEpoch: number(r.ownerEpoch),
    limit: budget(r.limit),
    used: budget(r.used),
    eventSequence: number(r.eventSequence),
    cancelRequested: r.cancelRequested,
    errorCode: r.errorCode === null ? null : text(r.errorCode, 128),
  };
}
function result(value: unknown): AgentResult {
  const r = record(value);
  if (r.kind === "tool") {
    const c = record(r.call);
    return {
      kind: "tool",
      call: {
        id: text(c.id, 128),
        tool: text(c.tool, 80),
        documentId: text(c.documentId, 128),
        page: number(c.page),
      },
    };
  }
  if (r.kind === "tool_result")
    return {
      kind: "tool_result",
      call_id: text(r.call_id, 128),
      source_id: text(r.source_id, 512),
      text: text(r.text),
    };
  if (r.kind === "final")
    return {
      kind: "final",
      message: text(r.message),
      source_ids: list(r.source_ids, 100).map((v) => text(v, 512)),
    };
  if (r.kind === "needs_input")
    return { kind: "needs_input", question: text(r.question, 1024) };
  throw new Error("AGENT_RESPONSE_INVALID");
}
export function parseAgentDetail(value: unknown): AgentDetail {
  const d = record(value);
  const g = record(d.grant);
  return {
    run: parseAgentRun(d.run),
    goal: text(d.goal),
    grant: {
      providerId: text(g.providerId, 256),
      providerRevision: text(g.providerRevision, 256),
      model: text(g.model, 256),
      pages: list(g.pages, 100).map((v) => {
        const p = record(v);
        return {
          documentId: text(p.documentId, 128),
          revision: text(p.revision, 128),
          pages: list(p.pages, 24).map(number),
        };
      }),
    },
    results: list(d.results, 32).map(result),
  };
}

export const agentStudyApi: AgentStudyApi = {
  async catalog() {
    const [conversations, documents, indexes] = await Promise.all([
      listAiChatConversations(),
      listResources(),
      listResourceIndexStatuses(),
    ]);
    const ready = new Map(
      indexes
        .filter((i) => i.state === "ready" || i.state === "empty")
        .map((i) => [i.documentId, i.totalPages ?? 0]),
    );
    return {
      conversations: conversations.map(({ id, title }) => ({ id, title })),
      documents: documents
        .filter((d) => d.kind === "pdf" && ready.has(d.id))
        .map((d) => ({
          id: d.id,
          title: d.title,
          pageCount: ready.get(d.id) ?? 0,
        })),
    };
  },
  async latest(conversationId) {
    const value: unknown = await invoke("find_latest_agent_run", {
      conversationId,
    });
    return value === null ? null : parseAgentRun(value);
  },
  async start(request) {
    return parseAgentRun(await invoke("start_agent_run", { request }));
  },
  async detail(runId) {
    return parseAgentDetail(await invoke("get_agent_run_detail", { runId }));
  },
  async cancel(runId) {
    return parseAgentRun(await invoke("cancel_agent_run", { runId }));
  },
  async source(runId, sourceId) {
    const value = record(
      await invoke("resolve_agent_source", { runId, sourceId }),
    );
    return {
      documentId: text(value.documentId, 128),
      page: number(value.page),
    };
  },
};

export function agentErrorText(error: unknown): string {
  const code =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
  const copies: Record<string, string> = {
    AGENT_SOURCE_STALE:
      "资料或模型配置已变化，请通过“调整范围 / 新问题”重新选择；若旧任务仍在运行，请先取消。",
    AGENT_INDEX_NOT_READY: "资料文字索引未就绪，请在资料页完成索引后重试。",
    AGENT_TOOLS_UNSUPPORTED:
      "当前仅支持已验证的 DeepSeek 模型与官方端点，请在 AI 设置中选择。",
    AGENT_SCOPE_DENIED: "所选资料、会话或凭据已不可用，请重新检查。",
    AGENT_WORKSPACE_BUSY:
      "已有任务正在使用该会话或工作区，请先取消或等待完成。",
    AGENT_BUDGET_EXHAUSTED:
      "本轮运行保护已触发，已保存先前结果，可缩小问题后重开。",
    AGENT_PROVIDER_PROTOCOL_ERROR:
      "模型请求或工具协议未完成，请查看已保存步骤后重试。",
    BROWSER_PREVIEW_UNSUPPORTED: "浏览器仅供界面预览，不执行真实研读或写入。",
  };
  return (
    copies[
      code.startsWith("BROWSER_PREVIEW_UNSUPPORTED")
        ? "BROWSER_PREVIEW_UNSUPPORTED"
        : code
    ] ?? "研读操作暂未完成，请刷新状态后重试。"
  );
}
