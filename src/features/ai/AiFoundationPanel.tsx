import { useEffect, useState, type FormEvent } from "react";

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

export function AiFoundationPanel() {
  const [overview, setOverview] = useState<AiOverview>();
  const [budget, setBudget] = useState<BudgetDraft>(INITIAL_BUDGET);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string>();
  const [providerDraft, setProviderDraft] =
    useState<ProviderDraft>(EMPTY_PROVIDER);
  const [secret, setSecret] = useState("");
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
    setBudget({
      singleCallLimit: String(next.budget.singleCallLimit),
      dailyTokenLimit: String(next.budget.dailyTokenLimit),
      monthlyTokenLimit: String(next.budget.monthlyTokenLimit),
      limitMode: next.budget.limitMode,
    });
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

  const activeProvider = overview?.providers.find(
    (provider) => provider.id === overview.activeProviderId,
  );
  const editingProvider = overview?.providers.find(
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
    setProviderDraft({ ...EMPTY_PROVIDER });
    setSecret("");
    setEditorOpen(true);
    setDeleteConfirmationId(undefined);
  };

  const openEdit = (provider: AiProviderConfig) => {
    setEditingProviderId(provider.id);
    setProviderDraft(draftFromProvider(provider));
    setSecret("");
    setEditorOpen(true);
    setDeleteConfirmationId(undefined);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingProviderId(undefined);
    setSecret("");
  };

  const submitProvider = (event: FormEvent) => {
    event.preventDefault();
    void run("provider", async () => {
      const request = providerRequest(providerDraft);
      const next =
        editingProviderId === undefined
          ? await createAiProvider(request)
          : await updateAiProvider(editingProviderId, request);
      applyOverview(next);
      closeEditor();
      invalidatePreview();
      setNotice(
        editingProviderId === undefined
          ? "Provider 已新增，可在列表中设为当前。"
          : "Provider 配置已更新。",
      );
    });
  };

  const activateProvider = (providerId: string, focusTest = false) => {
    void run("activate", async () => {
      applyOverview(await activateAiProvider(providerId));
      invalidatePreview();
      setNotice("当前 Provider 已切换。已有学习数据不受影响。");
      if (focusTest) {
        requestAnimationFrame(() => {
          document.getElementById("ai-preview-input")?.focus();
        });
      }
    });
  };

  const confirmDeleteProvider = (providerId: string) => {
    void run("delete", async () => {
      applyOverview(await deleteAiProvider(providerId));
      setDeleteConfirmationId(undefined);
      if (editingProviderId === providerId) {
        closeEditor();
      }
      invalidatePreview();
      setNotice("Provider 已删除；关联调用历史仍保留。系统密钥已移除。");
    });
  };

  const submitSecret = (event: FormEvent) => {
    event.preventDefault();
    if (editingProviderId === undefined) {
      return;
    }
    void run("secret", async () => {
      applyOverview(await saveAiSecret(editingProviderId, secret));
      setSecret("");
      setNotice("API Key 已保存到 Windows 凭据管理器。");
    });
  };

  const removeSecret = () => {
    if (editingProviderId === undefined) {
      return;
    }
    void run("secret", async () => {
      applyOverview(await deleteAiSecret(editingProviderId));
      setSecret("");
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
    });
  };

  const preparePreview = (event: FormEvent) => {
    event.preventDefault();
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
    if (!confirmed || preview === undefined || !preview.allowed) {
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

      <section
        className="ai-provider-manager"
        aria-labelledby="provider-list-title"
      >
        <div className="ai-provider-toolbar">
          <div>
            <h3 id="provider-list-title">API Provider</h3>
            <span>{overview?.providers.length ?? 0} / 20 个配置</span>
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
          {overview?.providers.map((provider) => (
            <li
              key={provider.id}
              className={provider.active ? "ai-provider-active" : undefined}
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
                  {provider.providerType === "offline_test"
                    ? "离线测试"
                    : "Responses API"}
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
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => openEdit(provider)}
                  disabled={busy !== undefined}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => activateProvider(provider.id, true)}
                  disabled={busy !== undefined}
                >
                  测试
                </button>
                {deleteConfirmationId === provider.id ? (
                  <div className="ai-delete-confirmation">
                    <span>删除配置和系统密钥？</span>
                    <button
                      type="button"
                      onClick={() => confirmDeleteProvider(provider.id)}
                      disabled={busy !== undefined}
                    >
                      确认删除
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setDeleteConfirmationId(undefined)}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setDeleteConfirmationId(provider.id)}
                    disabled={busy !== undefined}
                  >
                    删除
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {editorOpen ? (
        <section
          className="ai-provider-editor"
          aria-labelledby="provider-editor-title"
        >
          <div className="ai-provider-toolbar">
            <h3 id="provider-editor-title">
              {editingProviderId === undefined
                ? "新增 Provider"
                : "编辑 Provider"}
            </h3>
            <button
              type="button"
              className="secondary-button"
              onClick={closeEditor}
            >
              关闭
            </button>
          </div>
          <form className="ai-settings" onSubmit={submitProvider}>
            <label>
              协议
              <select
                value={providerDraft.providerType}
                onChange={(event) => {
                  const providerType = event.target.value as AiProviderType;
                  setProviderDraft((current) => ({
                    ...current,
                    providerType,
                    displayName:
                      providerType === "offline_test" &&
                      current.displayName === ""
                        ? "离线测试 Provider"
                        : current.displayName,
                    modelName:
                      providerType === "offline_test"
                        ? "kystudy-offline-test-v1"
                        : current.modelName === "kystudy-offline-test-v1"
                          ? ""
                          : current.modelName,
                  }));
                }}
              >
                <option value="openai_responses">Responses API</option>
                <option value="offline_test">离线测试</option>
              </select>
            </label>
            <label>
              显示名称
              <input
                value={providerDraft.displayName}
                maxLength={80}
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
                  value={providerDraft.baseUrl}
                  inputMode="url"
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
                value={providerDraft.modelName}
                maxLength={120}
                onChange={(event) =>
                  setProviderDraft((current) => ({
                    ...current,
                    modelName: event.target.value,
                  }))
                }
                required
              />
            </label>
            <label>
              上下文上限
              <input
                type="number"
                min={1024}
                max={2000000}
                value={providerDraft.contextLimit}
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
                type="number"
                min={1}
                max={131072}
                value={providerDraft.maxOutputTokens}
                onChange={(event) =>
                  setProviderDraft((current) => ({
                    ...current,
                    maxOutputTokens: event.target.value,
                  }))
                }
                required
              />
            </label>
            <button type="submit" disabled={busy !== undefined}>
              {editingProviderId === undefined ? "保存新 Provider" : "保存修改"}
            </button>
          </form>

          {editingProviderId !== undefined &&
          providerDraft.providerType === "openai_responses" ? (
            <form className="ai-secret-form" onSubmit={submitSecret}>
              <label>
                API Key
                <input
                  type="password"
                  autoComplete="off"
                  value={secret}
                  maxLength={4096}
                  placeholder={
                    editingProvider?.hasSecret === true
                      ? "已安全保存"
                      : "尚未保存"
                  }
                  onChange={(event) => setSecret(event.target.value)}
                  required
                />
              </label>
              <button
                type="submit"
                disabled={busy !== undefined || secret.trim() === ""}
              >
                保存密钥
              </button>
              {editingProvider?.hasSecret === true ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={removeSecret}
                  disabled={busy !== undefined}
                >
                  删除密钥
                </button>
              ) : null}
              <span>
                {editingProvider?.hasSecret === true
                  ? "Windows 凭据管理器：已保存"
                  : "Windows 凭据管理器：未保存"}
              </span>
            </form>
          ) : null}
        </section>
      ) : null}

      <form className="ai-budget-form" onSubmit={submitBudget}>
        <div>
          <h3>Token 预算</h3>
          <span>当前 Provider 与所有调用共享工作区预算</span>
        </div>
        <label>
          单次上限
          <input
            type="number"
            min={1}
            max={2000000}
            value={budget.singleCallLimit}
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
            type="number"
            min={1}
            max={100000000}
            value={budget.dailyTokenLimit}
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
            type="number"
            min={1}
            max={1000000000}
            value={budget.monthlyTokenLimit}
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
            value={budget.limitMode}
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

      <form className="ai-preview-form" onSubmit={preparePreview}>
        <div>
          <h3>连接与外发测试</h3>
          <span>
            当前：{activeProvider?.displayName ?? "正在加载"} ·{" "}
            {activeProvider?.providerType === "offline_test"
              ? "不会联网"
              : "确认后联网"}
          </span>
        </div>
        <label>
          测试文本
          <textarea
            id="ai-preview-input"
            rows={4}
            maxLength={20000}
            value={prompt}
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
            type="number"
            min={1}
            max={activeProvider?.maxOutputTokens ?? 800}
            value={outputLimit}
            onChange={(event) => {
              setOutputLimit(event.target.value);
              invalidatePreview();
            }}
            required
          />
        </label>
        <button type="submit" disabled={busy !== undefined}>
          生成测试预览
        </button>
      </form>

      {preview !== undefined ? (
        <section className="ai-preview" aria-labelledby="ai-preview-title">
          <div className="ai-preview-heading">
            <div>
              <h3 id="ai-preview-title">本次将发送的内容</h3>
              <span>
                {preview.destination} · {preview.modelName}
              </span>
            </div>
            <strong className={preview.allowed ? "ai-allowed" : "ai-blocked"}>
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
              disabled={!preview.allowed}
            />
            我确认发送上方完整文本
          </label>
          <button
            type="button"
            onClick={executePreview}
            disabled={!confirmed || !preview.allowed || busy !== undefined}
          >
            {preview.providerType === "offline_test"
              ? "运行离线测试"
              : "确认并测试连接"}
          </button>
        </section>
      ) : null}

      {result !== undefined ? (
        <section className="ai-result" aria-labelledby="ai-result-title">
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

      <details className="ai-history">
        <summary>最近调用记录（{overview?.calls.length ?? 0}）</summary>
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
      </details>
    </section>
  );
}
