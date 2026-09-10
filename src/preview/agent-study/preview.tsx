import { createRoot } from "react-dom/client";
import { AgentStudyPanel } from "../../features/agent/AgentStudyPanel";
import { DEFAULT_AGENT_BUDGET } from "../../shared/tauri/agentContract";
import type {
  AgentStudyApi,
  AgentDetail,
} from "../../shared/tauri/agentClient";
import type { AiProviderConfig } from "../../shared/tauri/aiClient";
import "../../styles/tokens.css";
import "../../styles/reset.css";
import "../../styles/primitives.css";
import "../../app/app.css";
import "./preview.css";
const state = new URLSearchParams(location.search).get("state") ?? "ready";
const provider: AiProviderConfig = {
  id: "fixture-provider",
  providerType: "deepseek_chat",
  displayName: "DeepSeek",
  modelName: "deepseek-v4-flash-vision-exp",
  baseUrl: "https://api.deepseek.com",
  contextLimit: 262144,
  maxOutputTokens: 8192,
  hasSecret: true,
  active: true,
  capabilities: {
    supportsImage: "unknown",
    supportsFile: "unknown",
    supportsPdf: "unknown",
    capabilitySource: "tested",
  },
};
const detail: AgentDetail = {
  run: {
    id: "fixture-run",
    state:
      state === "running"
        ? "running"
        : state === "error"
          ? "failed"
          : "completed",
    revision: 4,
    ownerEpoch: 1,
    limit: DEFAULT_AGENT_BUDGET,
    used: { models: 2, tools: 1, input: 1820, output: 8192, activeMs: 5000 },
    tokenPolicy: "observe",
    eventSequence: 4,
    cancelRequested: false,
    errorCode: state === "error" ? "AGENT_SOURCE_STALE" : null,
  },
  goal: "为什么相似矩阵拥有相同的特征值？",
  grant: {
    providerId: provider.id,
    providerRevision: "fixture",
    model: provider.modelName,
    pages: [{ documentId: "fixture-doc", revision: "v1", pages: [1] }],
  },
  results: [
    {
      kind: "tool",
      call: {
        id: "call",
        tool: "read_resource_pages",
        documentId: "fixture-doc",
        page: 1,
      },
    },
    {
      kind: "tool_result",
      call_id: "call",
      source_id: "fixture-doc:v1:1",
      text: JSON.stringify({
        text: "相似矩阵满足 B=P⁻¹AP，因此具有相同的特征多项式。",
        offset: 0,
        endOffset: 32,
        totalCharacters: state === "partial" ? 3000 : 32,
        nextOffset: state === "partial" ? 32 : null,
      }),
    },
    ...(state === "running" || state === "error"
      ? []
      : [
          {
            kind: "final" as const,
            message:
              state === "long"
                ? "合成的长文本回答用于验证换行与滚动，不代表真实模型输出。\n".repeat(
                    35,
                  )
                : "## 核心结论\n\n相似矩阵表示同一个线性变换在不同基下的形式，因此具有**相同的特征值**。\n\n### 为什么成立\n\n- 从 $B=P^{-1}AP$ 出发。\n- 两者的特征多项式相同。\n\n$$\n\\det(\\lambda I-B)=\\det(\\lambda I-A)\n$$\n\n这是固定预览内容，不是一次模型请求。",
            source_ids: ["fixture-doc:v1:1"],
          },
        ]),
  ],
};
const blocked = () => Promise.reject(new Error("BROWSER_PREVIEW_UNSUPPORTED"));
const api: AgentStudyApi = {
  catalog: () =>
    state === "loading"
      ? new Promise(() => {})
      : Promise.resolve({
          conversations:
            state === "empty"
              ? []
              : [{ id: "fixture-chat", title: "线性代数研读" }],
          documents:
            state === "empty"
              ? []
              : [
                  {
                    id: "fixture-doc",
                    title:
                      state === "long"
                        ? "高等代数教材中的相似矩阵、线性变换与特征值的长文件名示例".repeat(
                            6,
                          )
                        : "线性代数 · 相似矩阵（合成资料）",
                    pageCount: 12,
                  },
                ],
        }),
  latest: async () =>
    ["running", "completed", "long", "error", "partial"].includes(state)
      ? detail.run
      : null,
  detail: async () => detail,
  start: blocked,
  cancel: blocked,
  source: async () => ({ documentId: "fixture-doc", page: 1 }),
};
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <main className="agent-preview-shell">
      <p className="agent-preview-notice">
        确定性 UI 预览 · 不读取用户存储 · 不执行 AI 或写入
      </p>
      <nav aria-label="预览状态">
        {[
          "ready",
          "loading",
          "empty",
          "running",
          "completed",
          "error",
          "long",
          "partial",
        ].map((name) => (
          <a key={name} href={`?state=${name}`}>
            {name}
          </a>
        ))}
      </nav>
      <AgentStudyPanel
        provider={provider}
        api={api}
        onOpenReference={() => {}}
      />
    </main>,
  );
