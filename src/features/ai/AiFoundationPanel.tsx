import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  activateAiProvider,
  createAiProvider,
  deleteAiProvider,
  deleteAiSecret,
  executeAiCall,
  getAiOverview,
  normalizeAiError,
  previewAiCall,
  saveAiBudget,
  saveAiSecret,
  updateAiProvider,
  type AiCallPreview,
  type AiCallResult,
  type AiCommandError,
  type AiLimitMode,
  type AiOverview,
  type AiProviderConfig,
  type AiProviderType,
  type SaveAiProviderRequest,
} from "../../shared/tauri/aiClient";
import { EditorDialog } from "../../shared/components/EditorDialog";
import "./ai.css";

interface ProviderDraft {
  providerType: AiProviderType;
  displayName: string;
  baseUrl: string;
  modelName: string;
  contextLimit: string;
  maxOutputTokens: string;
}

interface BudgetDraft {
  singleCallLimit: string;
  dailyTokenLimit: string;
  monthlyTokenLimit: string;
  limitMode: AiLimitMode;
}

type AiDialogMode =
  "providers" | "provider-form" | "budget" | "connection" | "history";

const EMPTY_PROVIDER: ProviderDraft = {
  providerType: "openai_responses",
  displayName: "",
  baseUrl: "https://api.openai.com/v1",
  modelName: "",
  contextLimit: "128000",
  maxOutputTokens: "800",
};

const INITIAL_BUDGET: BudgetDraft = {
  singleCallLimit: "8000",
  dailyTokenLimit: "50000",
  monthlyTokenLimit: "1000000",
  limitMode: "block",
};

const WARNING_COPY: Record<AiCallPreview["warnings"][number], string> = {
  single_call: "超过单次 Token 上限",
  daily: "预计超过今日 Token 上限",
  monthly: "预计超过本月 Token 上限",
};

function draftFromProvider(provider: AiProviderConfig): ProviderDraft {
  return {
    providerType: provider.providerType,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl ?? "https://api.openai.com/v1",
    modelName: provider.modelName,
    contextLimit: String(provider.contextLimit),
    maxOutputTokens: String(provider.maxOutputTokens),
  };
}

function providerRequest(draft: ProviderDraft): SaveAiProviderRequest {
  return {
    providerType: draft.providerType,
    displayName: draft.displayName,
    baseUrl:
      draft.providerType === "openai_responses" ? draft.baseUrl : undefined,
    modelName: draft.modelName,
    contextLimit: Number(draft.contextLimit),
    maxOutputTokens: Number(draft.maxOutputTokens),
  };
}

function providerDestination(provider: AiProviderConfig): string {
  if (provider.providerType === "offline_test") {
    return "本机离线";
  }
  try {
    return new URL(provider.baseUrl ?? "").host;
  } catch {
    return "已配置的 HTTPS 地址";
  }
}

function isUserVisibleProvider(provider: AiProviderConfig): boolean {
  // The offline provider remains available to backend tests and migrations,
  // but it must not appear in a production user's configuration workflow.
  return provider.providerType !== "offline_test";
}

export function AiFoundationPanel() {
  const modeHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousDialogModeRef = useRef<AiDialogMode | undefined>(undefined);
  const [overview, setOverview] = useState<AiOverview>();
  const [budget, setBudget] = useState<BudgetDraft>(INITIAL_BUDGET);
  const [initialBudget, setInitialBudget] =
    useState<BudgetDraft>(INITIAL_BUDGET);
  const [dialogMode, setDialogMode] = useState<AiDialogMode>();
  const [editingProviderId, setEditingProviderId] = useState<string>();
  const [providerDraft, setProviderDraft] =
    useState<ProviderDraft>(EMPTY_PROVIDER);
  const [initialProviderDraft, setInitialProviderDraft] =
    useState<ProviderDraft>(EMPTY_PROVIDER);
  const [secret, setSecret] = useState("");
  const [secretDeleteConfirmation, setSecretDeleteConfirmation] =
    useState(false);
  const [deleteConfirmationId, setDeleteConfirmationId] = useState<string>();
  const [prompt, setPrompt] = useState("请用一句话说明你收到的测试内容。");
  const [outputLimit, setOutputLimit] = useState("300");
  const [preview, setPreview] = useState<AiCallPreview>();
  const [result, setResult] = useState<AiCallResult>();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<AiCommandError>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>();

  const applyOverview = (next: AiOverview) => {
    setOverview(next);
    const nextBudget = {
      singleCallLimit: String(next.budget.singleCallLimit),
      dailyTokenLimit: String(next.budget.dailyTokenLimit),
      monthlyTokenLimit: String(next.budget.monthlyTokenLimit),
      limitMode: next.budget.limitMode,
    };
    setBudget(nextBudget);
    setInitialBudget(nextBudget);
  };

  useEffect(() => {
    let active = true;
    void getAiOverview().then(
      (next) => {
        if (active) {
          applyOverview(next);
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
  }, []);

  useEffect(() => {
    const previousMode = previousDialogModeRef.current;
    previousDialogModeRef.current = dialogMode;
    if (
      dialogMode === undefined ||
      previousMode === undefined ||
      previousMode === dialogMode
    ) {
      return;
    }
    requestAnimationFrame(() => {
      modeHeadingRef.current?.focus({ preventScroll: true });
    });
  }, [dialogMode]);

  const configuredActiveProvider = overview?.providers.find(
    (provider) => provider.id === overview.activeProviderId,
  );
  const visibleProviders =
    overview?.providers.filter(isUserVisibleProvider) ?? [];
  const activeProvider =
    configuredActiveProvider !== undefined &&
    isUserVisibleProvider(configuredActiveProvider)
      ? configuredActiveProvider
      : undefined;
  const editingProvider = visibleProviders.find(
    (provider) => provider.id === editingProviderId,
  );

  const invalidatePreview = () => {
    setPreview(undefined);
    setConfirmed(false);
    setResult(undefined);
  };

  const run = async (label: string, operation: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    setNotice("");
    try {
      await operation();
    } catch (reason: unknown) {
      setError(normalizeAiError(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const openCreate = () => {
    setEditingProviderId(undefined);
    const next = { ...EMPTY_PROVIDER };
    setProviderDraft(next);
    setInitialProviderDraft(next);
    setSecret("");
    setSecretDeleteConfirmation(false);
    setDialogMode("provider-form");
    setDeleteConfirmationId(undefined);
  };

  const openEdit = (provider: AiProviderConfig) => {
    setEditingProviderId(provider.id);
    const next = draftFromProvider(provider);
    setProviderDraft(next);
    setInitialProviderDraft(next);
    setSecret("");
    setSecretDeleteConfirmation(false);
    setDialogMode("provider-form");
    setDeleteConfirmationId(undefined);
  };

  const openManagement = () => {
    setSecretDeleteConfirmation(false);
    setDeleteConfirmationId(undefined);
    setDialogMode("providers");
  };

  const openBudgetEditor = () => {
    setDialogMode("budget");
  };

  const closeDialog = (resetBudget = true) => {
    setDialogMode(undefined);
    if (resetBudget) {
      setBudget(initialBudget);
    }
    setEditingProviderId(undefined);
    setSecret("");
    setSecretDeleteConfirmation(false);
    setDeleteConfirmationId(undefined);
  };

  const closeProviderForm = () => {
    setDialogMode("providers");
    setEditingProviderId(undefined);
    setSecret("");
    setSecretDeleteConfirmation(false);
    setDeleteConfirmationId(undefined);
  };

  const closeBudgetEditor = () => {
    setBudget(initialBudget);
    setDialogMode("providers");
  };

  const handleDialogBack = () => {
    if (dialogMode === "provider-form") {
      closeProviderForm();
    } else if (dialogMode === "budget") {
      closeBudgetEditor();
    } else if (dialogMode === "connection" || dialogMode === "history") {
      setDialogMode("providers");
    }
  };

  const submitProvider = (event: FormEvent) => {
    event.preventDefault();
    void run("provider", async () => {
      const request = providerRequest(providerDraft);
      const creating = editingProviderId === undefined;
      let next: AiOverview;
      let providerId = editingProviderId;
      if (creating) {
        const previousIds = new Set(
          overview?.providers.map((provider) => provider.id) ?? [],
        );
        next = await createAiProvider(request);
        providerId = next.providers.find(
          (provider) => !previousIds.has(provider.id),
        )?.id;
      } else if (editingProviderId !== undefined) {
        next = await updateAiProvider(editingProviderId, request);
      } else {
        return;
      }
      if (
        providerDraft.providerType === "openai_responses" &&
        secret.trim() !== ""
      ) {
        if (providerId === undefined) {
          throw new Error("AI_PROVIDER_CREATE_RESULT_INVALID");
        }
        next = await saveAiSecret(providerId, secret);
      }
      applyOverview(next);
      closeDialog(false);
      invalidatePreview();
      setNotice(
        creating ? "API 配置已新增，可在列表中设为当前。" : "API 配置已更新。",
      );
    });
  };

  const activateProvider = (providerId: string, focusTest = false) => {
    void run("activate", async () => {
      applyOverview(await activateAiProvider(providerId));
      invalidatePreview();
      setNotice("当前 Provider 已切换。已有学习数据不受影响。");
      if (focusTest) {
        setDialogMode("connection");
      }
    });
  };

  const confirmDeleteProvider = (providerId: string) => {
    void run("delete", async () => {
      applyOverview(await deleteAiProvider(providerId));
      setDeleteConfirmationId(undefined);
      if (editingProviderId === providerId) {
        closeDialog(false);
      }
      invalidatePreview();
      setNotice("Provider 已删除；关联调用历史仍保留。系统密钥已移除。");
    });
  };

  const removeSecret = () => {
    if (editingProviderId === undefined) {
      return;
    }
    void run("secret", async () => {
      applyOverview(await deleteAiSecret(editingProviderId));
      setSecret("");
      setSecretDeleteConfirmation(false);
      setNotice("API Key 已从 Windows 凭据管理器删除。");
    });
  };

  const submitBudget = (event: FormEvent) => {
    event.preventDefault();
    void run("budget", async () => {
      applyOverview(
        await saveAiBudget({
          singleCallLimit: Number(budget.singleCallLimit),
          dailyTokenLimit: Number(budget.dailyTokenLimit),
          monthlyTokenLimit: Number(budget.monthlyTokenLimit),
          limitMode: budget.limitMode,
        }),
      );
      invalidatePreview();
      setNotice("Token 预算已保存。");
      closeDialog(false);
    });
  };

  const preparePreview = (event: FormEvent) => {
    event.preventDefault();
    if (activeProvider === undefined) {
      setNotice("请先配置一个 Responses API Provider，再进行连接测试。");
      return;
    }
    void run("preview", async () => {
      setPreview(
        await previewAiCall({
          prompt,
          maxOutputTokens: Number(outputLimit),
        }),
      );
      setConfirmed(false);
      setResult(undefined);
    });
  };

  const executePreview = () => {
    if (
      !confirmed ||
      preview === undefined ||
      !preview.allowed ||
      preview.providerType !== "openai_responses"
    ) {
      return;
    }
    void run("execute", async () => {
      setResult(
        await executeAiCall({
          prompt: preview.prompt,
          maxOutputTokens: preview.outputTokenLimit,
        }),
      );
      setConfirmed(false);
      applyOverview(await getAiOverview());
    });
  };

  const dialogDirty =
    dialogMode === "provider-form"
      ? JSON.stringify(providerDraft) !==
          JSON.stringify(initialProviderDraft) || secret !== ""
      : dialogMode === "budget"
        ? JSON.stringify(budget) !== JSON.stringify(initialBudget)
        : false;

  return (
    <section className="ai-card" aria-labelledby="ai-title">
      <div className="ai-heading">
        <div>
          <p className="section-label">AI 设置</p>
          <h2 id="ai-title">Provider 与调用控制</h2>
        </div>
        <div className="ai-usage" aria-label="Token 用量">
          <span>今日 {overview?.usage.todayTokens ?? 0}</span>
          <span>本月 {overview?.usage.monthTokens ?? 0}</span>
        </div>
      </div>

      {dialogMode === undefined && error !== undefined ? (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <span>{error.action}</span>
        </div>
      ) : null}
      {dialogMode === undefined && notice !== "" ? (
        <p className="ai-notice" role="status">
          {notice}
        </p>
      ) : null}

      <section
        className="ai-provider-summary"
        aria-labelledby="ai-provider-summary-title"
      >
        <div className="ai-provider-summary-heading">
          <div>
            <h3 id="ai-provider-summary-title">当前 Provider</h3>
            <span>{visibleProviders.length} / 20 个配置</span>
          </div>
          <button
            type="button"
            onClick={openManagement}
            disabled={busy !== undefined}
          >
            管理 AI 配置
          </button>
        </div>
        {overview === undefined ? (
          <p className="ai-provider-summary-empty">正在加载 Provider 配置…</p>
        ) : activeProvider === undefined ? (
          <p className="ai-provider-summary-empty">
            尚未配置可用的 AI Provider，请先添加一个 Responses API 配置。
          </p>
        ) : (
          <div className="ai-provider-summary-main">
            <div className="ai-provider-summary-copy">
              <div>
                <strong>{activeProvider.displayName}</strong>
                <span className="ai-active-tag">当前使用</span>
              </div>
              <p>{activeProvider.modelName}</p>
              <small>
                Responses API
                {" · "}
                {providerDestination(activeProvider)}
                {activeProvider.providerType === "openai_responses"
                  ? activeProvider.hasSecret
                    ? " · 密钥已保存"
                    : " · 未保存密钥"
                  : ""}
              </small>
            </div>
          </div>
        )}
        <div className="ai-budget-summary ai-budget-summary-compact">
          <div>
            <h3>Token 预算</h3>
            <span>
              单次 {overview?.budget.singleCallLimit ?? 0} · 每日{" "}
              {overview?.budget.dailyTokenLimit ?? 0} · 每月{" "}
              {overview?.budget.monthlyTokenLimit ?? 0}
            </span>
          </div>
          <small>
            {overview === undefined
              ? "预算加载中"
              : overview.budget.limitMode === "warn"
                ? "超限仅警告"
                : "超限硬阻止"}
          </small>
        </div>
      </section>

      {dialogMode !== undefined ? (
        <EditorDialog
          title={
            dialogMode === "provider-form"
              ? editingProviderId === undefined
                ? "新增 API Provider"
                : "编辑 API Provider"
              : dialogMode === "budget"
                ? "编辑 Token 预算"
                : dialogMode === "connection"
                  ? "连接与外发测试"
                  : dialogMode === "history"
                    ? "最近调用记录"
                    : "管理 AI 配置"
          }
          description={
            dialogMode === "provider-form"
              ? "配置接口、模型与本机安全密钥。"
              : dialogMode === "budget"
                ? "限制单次、每日和每月 Token 消耗。"
                : dialogMode === "connection"
                  ? "先生成预览，再确认是否发送完整测试文本。"
                  : dialogMode === "history"
                    ? "查看最近的 Provider 调用结果。"
                    : "按需管理 Provider、预算、连接测试和历史记录。"
          }
          dirty={dialogDirty}
          closeDisabled={busy !== undefined}
          onRequestClose={closeDialog}
          onRequestBack={
            dialogMode === "providers" ? undefined : handleDialogBack
          }
          backLabel="返回配置"
          size="large"
        >
          {error !== undefined ? (
            <div className="error-detail" role="alert">
              <strong>{error.message}</strong>
              <span>{error.action}</span>
            </div>
          ) : null}
          {notice !== "" ? (
            <p className="ai-notice" role="status">
              {notice}
            </p>
          ) : null}

          {dialogMode === "providers" ? (
            <section
              id="ai-dialog-panel-providers"
              className="ai-dialog-panel ai-provider-manager"
              aria-labelledby="provider-list-title"
              role="tabpanel"
              tabIndex={0}
            >
              <div
                className="ai-dialog-tabs"
                role="tablist"
                aria-label="AI 配置区段"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected="true"
                  aria-controls="ai-dialog-panel-providers"
                  onClick={() => setDialogMode("providers")}
                  disabled={busy !== undefined}
                >
                  Provider
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected="false"
                  aria-controls="ai-dialog-panel-budget"
                  onClick={openBudgetEditor}
                  disabled={busy !== undefined}
                >
                  Token 预算
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected="false"
                  aria-controls="ai-dialog-panel-connection"
                  onClick={() => setDialogMode("connection")}
                  disabled={busy !== undefined || activeProvider === undefined}
                >
                  连接测试
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected="false"
                  aria-controls="ai-dialog-panel-history"
                  onClick={() => setDialogMode("history")}
                  disabled={busy !== undefined}
                >
                  调用历史
                </button>
              </div>
              <div className="ai-provider-toolbar">
                <div>
                  <h3
                    ref={modeHeadingRef}
                    id="provider-list-title"
                    tabIndex={-1}
                  >
                    API Provider
                  </h3>
                  <span>{visibleProviders.length} / 20 个配置</span>
                </div>
                <button
                  type="button"
                  onClick={openCreate}
                  disabled={busy !== undefined}
                >
                  新增 Provider
                </button>
              </div>

              <ul className="ai-provider-list">
                {visibleProviders.map((provider) => (
                  <li
                    key={provider.id}
                    className={
                      provider.active ? "ai-provider-active" : undefined
                    }
                  >
                    <div className="ai-provider-main">
                      <div>
                        <strong>{provider.displayName}</strong>
                        {provider.active ? (
                          <span className="ai-active-tag">当前使用</span>
                        ) : null}
                      </div>
                      <p>{provider.modelName}</p>
                      <small>
                        Responses API
                        {" · "}
                        {providerDestination(provider)}
                        {provider.providerType === "openai_responses"
                          ? provider.hasSecret
                            ? " · 密钥已保存"
                            : " · 未保存密钥"
                          : ""}
                      </small>
                    </div>
                    <div className="ai-provider-actions">
                      {!provider.active ? (
                        <button
                          type="button"
                          onClick={() => activateProvider(provider.id)}
                          disabled={busy !== undefined}
                        >
                          设为当前
                        </button>
                      ) : null}
                      {provider.active ? (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => activateProvider(provider.id, true)}
                          disabled={busy !== undefined}
                        >
                          测试连接
                        </button>
                      ) : null}
                      <details className="ai-provider-more">
                        <summary>更多操作</summary>
                        <div className="ai-provider-secondary-actions">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => openEdit(provider)}
                            disabled={busy !== undefined}
                          >
                            编辑
                          </button>
                          {deleteConfirmationId === provider.id ? (
                            <div className="ai-delete-confirmation">
                              <span>删除配置和系统密钥？</span>
                              <button
                                type="button"
                                onClick={() =>
                                  confirmDeleteProvider(provider.id)
                                }
                                disabled={busy !== undefined}
                              >
                                确认删除
                              </button>
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() =>
                                  setDeleteConfirmationId(undefined)
                                }
                                disabled={busy !== undefined}
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                setDeleteConfirmationId(provider.id)
                              }
                              disabled={busy !== undefined}
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </details>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {dialogMode === "provider-form" ? (
            <form
              className="ai-settings ai-dialog-panel"
              onSubmit={submitProvider}
            >
              <h3 ref={modeHeadingRef} tabIndex={-1}>
                Provider 基础配置
              </h3>
              <label>
                协议
                <select
                  name="ai-provider-type"
                  autoComplete="off"
                  value={providerDraft.providerType}
                  disabled={busy !== undefined}
                  onChange={(event) => {
                    const providerType = event.target.value as AiProviderType;
                    setSecretDeleteConfirmation(false);
                    setProviderDraft((current) => ({
                      ...current,
                      providerType,
                    }));
                  }}
                >
                  <option value="openai_responses">Responses API</option>
                </select>
              </label>
              <label>
                显示名称
                <input
                  name="ai-provider-name"
                  autoComplete="off"
                  value={providerDraft.displayName}
                  maxLength={80}
                  disabled={busy !== undefined}
                  onChange={(event) =>
                    setProviderDraft((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              {providerDraft.providerType === "openai_responses" ? (
                <label className="ai-wide-field">
                  API 基础地址
                  <input
                    name="ai-provider-base-url"
                    type="url"
                    value={providerDraft.baseUrl}
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy !== undefined}
                    onChange={(event) =>
                      setProviderDraft((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
              ) : null}
              <label className="ai-wide-field">
                模型 ID
                <input
                  name="ai-provider-model"
                  autoComplete="off"
                  spellCheck={false}
                  value={providerDraft.modelName}
                  maxLength={120}
                  disabled={busy !== undefined}
                  onChange={(event) =>
                    setProviderDraft((current) => ({
                      ...current,
                      modelName: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              {providerDraft.providerType === "openai_responses" ? (
                <div className="ai-key-field ai-wide-field">
                  <label>
                    API Key
                    <input
                      name="ai-provider-secret"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={secret}
                      maxLength={4096}
                      disabled={busy !== undefined}
                      placeholder={
                        editingProvider?.hasSecret === true
                          ? "已安全保存；留空表示不修改…"
                          : "输入 API Key…"
                      }
                      onChange={(event) => setSecret(event.target.value)}
                    />
                  </label>
                  <span>
                    {editingProvider?.hasSecret === true
                      ? "密钥已保存在 Windows 凭据管理器"
                      : "保存配置时写入 Windows 凭据管理器"}
                  </span>
                  {editingProvider?.hasSecret === true &&
                  !secretDeleteConfirmation ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => setSecretDeleteConfirmation(true)}
                      disabled={busy !== undefined}
                    >
                      删除已保存密钥
                    </button>
                  ) : null}
                  {editingProvider?.hasSecret === true &&
                  secretDeleteConfirmation ? (
                    <div className="ai-secret-delete-confirmation">
                      <span>删除已保存的 API Key？</span>
                      <button
                        type="button"
                        onClick={removeSecret}
                        disabled={busy !== undefined}
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setSecretDeleteConfirmation(false)}
                        disabled={busy !== undefined}
                      >
                        取消
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <details className="ai-provider-advanced ai-wide-field">
                <summary
                  aria-disabled={busy !== undefined}
                  onClick={(event) => {
                    if (busy !== undefined) {
                      event.preventDefault();
                    }
                  }}
                >
                  高级限制
                </summary>
                <div>
                  <label>
                    上下文上限
                    <input
                      name="ai-provider-context-limit"
                      type="number"
                      inputMode="numeric"
                      autoComplete="off"
                      min={1024}
                      max={2000000}
                      value={providerDraft.contextLimit}
                      disabled={busy !== undefined}
                      onChange={(event) =>
                        setProviderDraft((current) => ({
                          ...current,
                          contextLimit: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label>
                    单次最大输出
                    <input
                      name="ai-provider-output-limit"
                      type="number"
                      inputMode="numeric"
                      autoComplete="off"
                      min={1}
                      max={131072}
                      value={providerDraft.maxOutputTokens}
                      disabled={busy !== undefined}
                      onChange={(event) =>
                        setProviderDraft((current) => ({
                          ...current,
                          maxOutputTokens: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                </div>
              </details>
              <button type="submit" disabled={busy !== undefined}>
                {editingProviderId === undefined ? "保存 API 配置" : "保存修改"}
              </button>
            </form>
          ) : null}

          {dialogMode === "budget" ? (
            <form
              id="ai-dialog-panel-budget"
              className="ai-budget-form ai-dialog-panel"
              aria-labelledby="ai-budget-dialog-title"
              role="tabpanel"
              onSubmit={submitBudget}
            >
              <h3
                ref={modeHeadingRef}
                id="ai-budget-dialog-title"
                tabIndex={-1}
              >
                Token 预算
              </h3>
              <label>
                单次上限
                <input
                  name="ai-budget-single-call"
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  min={1}
                  max={2000000}
                  value={budget.singleCallLimit}
                  disabled={busy !== undefined}
                  onChange={(event) =>
                    setBudget((current) => ({
                      ...current,
                      singleCallLimit: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                每日上限
                <input
                  name="ai-budget-daily"
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  min={1}
                  max={100000000}
                  value={budget.dailyTokenLimit}
                  disabled={busy !== undefined}
                  onChange={(event) =>
                    setBudget((current) => ({
                      ...current,
                      dailyTokenLimit: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                每月上限
                <input
                  name="ai-budget-monthly"
                  type="number"
                  inputMode="numeric"
                  autoComplete="off"
                  min={1}
                  max={1000000000}
                  value={budget.monthlyTokenLimit}
                  disabled={busy !== undefined}
                  onChange={(event) =>
                    setBudget((current) => ({
                      ...current,
                      monthlyTokenLimit: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                超限方式
                <select
                  name="ai-budget-mode"
                  autoComplete="off"
                  value={budget.limitMode}
                  disabled={busy !== undefined}
                  onChange={(event) =>
                    setBudget((current) => ({
                      ...current,
                      limitMode: event.target.value as AiLimitMode,
                    }))
                  }
                >
                  <option value="block">硬阻止</option>
                  <option value="warn">仅警告</option>
                </select>
              </label>
              <button type="submit" disabled={busy !== undefined}>
                保存预算
              </button>
            </form>
          ) : null}

          {dialogMode === "connection" ? (
            <section
              id="ai-dialog-panel-connection"
              className="ai-dialog-panel ai-connection-tools ai-connection-tools-dialog"
              aria-labelledby="ai-connection-dialog-title"
              role="tabpanel"
              tabIndex={0}
            >
              <form className="ai-preview-form" onSubmit={preparePreview}>
                <div>
                  <h3
                    ref={modeHeadingRef}
                    id="ai-connection-dialog-title"
                    tabIndex={-1}
                  >
                    连接与外发测试
                  </h3>
                  <span>
                    当前：{activeProvider?.displayName ?? "尚未配置"} ·
                    确认后联网
                  </span>
                </div>
                <label>
                  测试文本
                  <textarea
                    id="ai-preview-input"
                    name="ai-connection-test-prompt"
                    autoComplete="off"
                    rows={4}
                    maxLength={20000}
                    value={prompt}
                    disabled={
                      busy !== undefined || activeProvider === undefined
                    }
                    onChange={(event) => {
                      setPrompt(event.target.value);
                      invalidatePreview();
                    }}
                    required
                  />
                </label>
                <label>
                  输出 Token 上限
                  <input
                    name="ai-connection-test-output-limit"
                    type="number"
                    inputMode="numeric"
                    autoComplete="off"
                    min={1}
                    max={activeProvider?.maxOutputTokens ?? 800}
                    value={outputLimit}
                    disabled={
                      busy !== undefined || activeProvider === undefined
                    }
                    onChange={(event) => {
                      setOutputLimit(event.target.value);
                      invalidatePreview();
                    }}
                    required
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy !== undefined || activeProvider === undefined}
                >
                  生成测试预览
                </button>
              </form>

              {preview !== undefined ? (
                <section
                  className="ai-preview"
                  aria-labelledby="ai-preview-title"
                >
                  <div className="ai-preview-heading">
                    <div>
                      <h3 id="ai-preview-title">本次将发送的内容</h3>
                      <span>
                        {preview.destination} · {preview.modelName}
                      </span>
                    </div>
                    <strong
                      className={preview.allowed ? "ai-allowed" : "ai-blocked"}
                    >
                      {preview.allowed ? "预算允许" : "预算阻止"}
                    </strong>
                  </div>
                  <pre>{preview.prompt}</pre>
                  <dl className="ai-token-grid">
                    <div>
                      <dt>输入预估</dt>
                      <dd>{preview.inputTokenEstimate}</dd>
                    </div>
                    <div>
                      <dt>输出上限</dt>
                      <dd>{preview.outputTokenLimit}</dd>
                    </div>
                    <div>
                      <dt>本次最坏值</dt>
                      <dd>{preview.projectedTokens}</dd>
                    </div>
                    <div>
                      <dt>今日已用</dt>
                      <dd>{preview.todayTokens}</dd>
                    </div>
                    <div>
                      <dt>本月已用</dt>
                      <dd>{preview.monthTokens}</dd>
                    </div>
                  </dl>
                  {preview.warnings.length > 0 ? (
                    <ul className="ai-warnings">
                      {preview.warnings.map((warning) => (
                        <li key={warning}>{WARNING_COPY[warning]}</li>
                      ))}
                    </ul>
                  ) : null}
                  <label className="ai-confirm">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      disabled={!preview.allowed || busy !== undefined}
                    />
                    我确认发送上方完整文本
                  </label>
                  <button
                    type="button"
                    onClick={executePreview}
                    disabled={
                      !confirmed || !preview.allowed || busy !== undefined
                    }
                  >
                    确认并测试连接
                  </button>
                </section>
              ) : null}

              {result !== undefined ? (
                <section
                  className="ai-result"
                  aria-labelledby="ai-result-title"
                >
                  <div>
                    <h3 id="ai-result-title">测试结果</h3>
                    <span>
                      {result.cacheHit
                        ? "命中本地缓存，新增 Token 为 0"
                        : `${result.inputTokens} 输入 · ${result.outputTokens} 输出`}
                    </span>
                  </div>
                  <p>{result.responseText}</p>
                </section>
              ) : null}
            </section>
          ) : null}

          {dialogMode === "history" ? (
            <section
              id="ai-dialog-panel-history"
              className="ai-dialog-panel ai-history"
              aria-labelledby="ai-history-dialog-title"
              role="tabpanel"
              tabIndex={0}
            >
              <h3
                ref={modeHeadingRef}
                id="ai-history-dialog-title"
                tabIndex={-1}
              >
                最近调用记录（{overview?.calls.length ?? 0}）
              </h3>
              {overview?.calls.length === 0 ? (
                <p>尚无调用记录。</p>
              ) : (
                <ol>
                  {overview?.calls.map((call) => (
                    <li key={call.id}>
                      <div>
                        <strong>
                          {call.providerName} · {call.modelName}
                        </strong>
                        <time>
                          {new Date(call.startedAt).toLocaleString("zh-CN")}
                        </time>
                      </div>
                      <span>
                        {call.state === "succeeded"
                          ? "成功"
                          : call.state === "failed"
                            ? "失败"
                            : "处理中"}
                      </span>
                      <small>
                        {call.cacheHit
                          ? "本地缓存"
                          : `${call.inputTokens + call.outputTokens} Token`}
                      </small>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ) : null}
        </EditorDialog>
      ) : null}
    </section>
  );
}
