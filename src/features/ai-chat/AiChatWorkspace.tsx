import { useEffect, useState } from "react";

import { PageHeader, PageStatus } from "../../shared/components/PagePrimitives";
import { Button } from "../../shared/ui/Button";
import {
  getAiOverview,
  listAiModels,
  normalizeAiError,
  updateAiProvider,
  type AiCommandError,
  type AiModelOption,
  type AiOverview,
  type AiProviderConfig,
} from "../../shared/tauri/aiClient";
import type { IndexedQuestion } from "../../shared/tauri/questionBankClient";
import { AiChatPanel } from "./AiChatPanel";
import "./ai-workspace.css";

export interface AiChatWorkspaceProps {
  onOpenReference(documentId: string, page: number): void;
  onOpenSettings(): void;
  onStartPaper?(questions: IndexedQuestion[], title?: string): void;
}

function activeProviderFromOverview(
  overview: AiOverview | undefined,
): AiProviderConfig | undefined {
  return overview?.providers.find(
    (provider) => provider.id === overview.activeProviderId,
  );
}

function withCurrentModel(
  modelName: string,
  models: AiModelOption[],
): AiModelOption[] {
  const seen = new Set<string>();
  const options: AiModelOption[] = [];
  for (const model of [{ id: modelName }, ...models]) {
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    options.push(model);
  }
  return options;
}

export function AiChatWorkspace({
  onOpenReference,
  onStartPaper,
}: AiChatWorkspaceProps) {
  const [overview, setOverview] = useState<AiOverview>();
  const [error, setError] = useState<AiCommandError>();
  const [overviewRequest, setOverviewRequest] = useState(0);
  const [modelOptions, setModelOptions] = useState<AiModelOption[]>([]);
  const [modelOptionsProviderId, setModelOptionsProviderId] =
    useState<string>();
  const [modelUpdating, setModelUpdating] = useState(false);

  useEffect(() => {
    let active = true;
    void getAiOverview().then(
      (next) => {
        if (active) {
          setOverview(next);
          setError(undefined);
        }
      },
      (reason: unknown) => {
        if (active) {
          setError(normalizeAiError(reason));
        }
      },
    );
    return () => {
      active = false;
    };
  }, [overviewRequest]);

  useEffect(() => {
    let active = true;
    const provider = activeProviderFromOverview(overview);
    if (
      provider === undefined ||
      provider.providerType === "offline_test" ||
      provider.baseUrl === undefined ||
      provider.baseUrl.trim() === "" ||
      !provider.hasSecret
    ) {
      return () => {
        active = false;
      };
    }

    void listAiModels({
      providerId: provider.id,
      providerType: provider.providerType,
      baseUrl: provider.baseUrl,
    }).then(
      (models) => {
        if (active) {
          setModelOptionsProviderId(provider.id);
          setModelOptions(withCurrentModel(provider.modelName, models));
        }
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [overview]);

  const retryOverview = () => {
    setOverview(undefined);
    setModelOptions([]);
    setModelOptionsProviderId(undefined);
    setError(undefined);
    setOverviewRequest((current) => current + 1);
  };

  const changeModel = (modelName: string) => {
    const provider = activeProviderFromOverview(overview);
    if (
      provider === undefined ||
      provider.providerType === "offline_test" ||
      modelName === provider.modelName
    ) {
      return;
    }
    setModelUpdating(true);
    setError(undefined);
    void updateAiProvider(provider.id, {
      providerType: provider.providerType,
      displayName: provider.displayName,
      baseUrl: provider.baseUrl,
      modelName,
      contextLimit: provider.contextLimit,
      maxOutputTokens: provider.maxOutputTokens,
    })
      .then(
        (next) => {
          setOverview(next);
          setModelOptionsProviderId(undefined);
          setModelOptions(
            withCurrentModel(
              next.providers.find((item) => item.id === next.activeProviderId)
                ?.modelName ?? modelName,
              modelOptions,
            ),
          );
        },
        (reason: unknown) => {
          setError(normalizeAiError(reason));
        },
      )
      .finally(() => {
        setModelUpdating(false);
      });
  };

  const activeProvider = activeProviderFromOverview(overview);
  const displayedModelOptions =
    activeProvider === undefined
      ? []
      : modelOptionsProviderId === activeProvider.id
        ? modelOptions
        : withCurrentModel(activeProvider.modelName, []);

  const modelPicker = (
    <label className="ai-chat-model-picker">
      <span>当前模型</span>
      <select
        aria-label="当前模型"
        value={activeProvider?.modelName ?? ""}
        disabled={activeProvider === undefined || modelUpdating}
        onChange={(event) => changeModel(event.target.value)}
      >
        {activeProvider === undefined ? (
          <option value="">尚未配置模型</option>
        ) : (
          displayedModelOptions.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id}
            </option>
          ))
        )}
      </select>
    </label>
  );

  return (
    <div className="ai-chat-page">
      <PageHeader title="AI 学习助手" />

      {error === undefined ? null : (
        <PageStatus
          tone="warning"
          title="当前模型信息暂时不可用"
          action={
            <Button variant="secondary" onClick={retryOverview}>
              重试初始化
            </Button>
          }
        >
          {error.message} {error.action}
        </PageStatus>
      )}

      <section className="ai-chat-surface" aria-label="AI 对话工作区">
        {overview === undefined ? (
          <PageStatus
            tone={error === undefined ? "loading" : "info"}
            title={
              error === undefined ? "正在初始化 AI 对话" : "AI 对话等待初始化"
            }
          >
            {error === undefined
              ? "正在准备本地 AI 配置和对话存储，请稍候。"
              : "初始化失败后不会加载对话列表，修复配置后可以重试。"}
          </PageStatus>
        ) : (
          <AiChatPanel
            headerAction={modelPicker}
            onOpenReference={onOpenReference}
            onStartPaper={onStartPaper}
          />
        )}
      </section>
    </div>
  );
}
