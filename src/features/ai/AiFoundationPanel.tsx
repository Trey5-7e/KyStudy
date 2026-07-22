import { useEffect, useState, type FormEvent } from "react";

import {
  deleteAiSecret,
  executeAiCall,
  getAiOverview,
  normalizeAiError,
  previewAiCall,
  saveAiBudget,
  saveAiProvider,
  saveAiSecret,
  type AiCallPreview,
  type AiCallResult,
  type AiCommandError,
  type AiLimitMode,
  type AiOverview,
  type AiProviderType,
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

const INITIAL_PROVIDER: ProviderDraft = {
  providerType: "offline_test",
  displayName: "离线测试 Provider",
  baseUrl: "https://api.openai.com/v1",
  modelName: "kystudy-offline-test-v1",
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

export function AiFoundationPanel() {
  const [overview, setOverview] = useState<AiOverview>();
  const [provider, setProvider] = useState<ProviderDraft>(INITIAL_PROVIDER);
  const [budget, setBudget] = useState<BudgetDraft>(INITIAL_BUDGET);
  const [secret, setSecret] = useState("");
  const [prompt, setPrompt] = useState("请用一句话说明你收到的测试内容。 ");
  const [outputLimit, setOutputLimit] = useState("300");
  const [preview, setPreview] = useState<AiCallPreview>();
  const [result, setResult] = useState<AiCallResult>();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<AiCommandError>();
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string>();

  const applyOverview = (next: AiOverview) => {
    setOverview(next);
    setProvider({
      providerType: next.provider.providerType,
      displayName: next.provider.displayName,
      baseUrl: next.provider.baseUrl ?? "https://api.openai.com/v1",
      modelName: next.provider.modelName,
      contextLimit: String(next.provider.contextLimit),
      maxOutputTokens: String(next.provider.maxOutputTokens),
    });
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

  const submitProvider = (event: FormEvent) => {
    event.preventDefault();
    void run("provider", async () => {
      const next = await saveAiProvider({
        providerType: provider.providerType,
        displayName: provider.displayName,
        baseUrl:
          provider.providerType === "openai_responses"
            ? provider.baseUrl
            : undefined,
        modelName: provider.modelName,
        contextLimit: Number(provider.contextLimit),
        maxOutputTokens: Number(provider.maxOutputTokens),
      });
      applyOverview(next);
      invalidatePreview();
      setNotice("Provider 与模型配置已保存。");
    });
  };

  const submitBudget = (event: FormEvent) => {
    event.preventDefault();
    void run("budget", async () => {
      const next = await saveAiBudget({
        singleCallLimit: Number(budget.singleCallLimit),
        dailyTokenLimit: Number(budget.dailyTokenLimit),
        monthlyTokenLimit: Number(budget.monthlyTokenLimit),
        limitMode: budget.limitMode,
      });
      applyOverview(next);
      invalidatePreview();
      setNotice("Token 预算已保存。");
    });
  };

  const submitSecret = (event: FormEvent) => {
    event.preventDefault();
    void run("secret", async () => {
      const next = await saveAiSecret(secret);
      setSecret("");
      applyOverview(next);
      setNotice("API Key 已保存到 Windows 凭据管理器。");
    });
  };

  const removeSecret = () => {
    void run("secret", async () => {
      applyOverview(await deleteAiSecret());
      setSecret("");
      setNotice("API Key 已从 Windows 凭据管理器删除。");
    });
  };

  const preparePreview = (event: FormEvent) => {
    event.preventDefault();
    void run("preview", async () => {
      const next = await previewAiCall({
        prompt,
        maxOutputTokens: Number(outputLimit),
      });
      setPreview(next);
      setConfirmed(false);
      setResult(undefined);
    });
  };

  const executePreview = () => {
    if (!confirmed || preview === undefined || !preview.allowed) {
      return;
    }
    void run("execute", async () => {
      const next = await executeAiCall({
        prompt: preview.prompt,
        maxOutputTokens: preview.outputTokenLimit,
      });
      setResult(next);
      setConfirmed(false);
      applyOverview(await getAiOverview());
    });
  };

  return (
    <section className="ai-card" aria-labelledby="ai-title">
      <div className="ai-heading">
        <div>
          <p className="section-label">M8 · AI 基础设施</p>
          <h2 id="ai-title">Provider、预算与外发控制</h2>
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

      <div className="ai-settings-grid">
        <form className="ai-settings" onSubmit={submitProvider}>
          <h3>Provider 与模型</h3>
          <label>
            通道
            <select
              value={provider.providerType}
              onChange={(event) => {
                const providerType = event.target.value as AiProviderType;
                setProvider((current) => ({
                  ...current,
                  providerType,
                  displayName:
                    providerType === "offline_test"
                      ? "离线测试 Provider"
                      : "OpenAI Responses",
                  modelName:
                    providerType === "offline_test"
                      ? "kystudy-offline-test-v1"
                      : current.modelName === "kystudy-offline-test-v1"
                        ? ""
                        : current.modelName,
                }));
                invalidatePreview();
              }}
            >
              <option value="offline_test">离线测试</option>
              <option value="openai_responses">Responses API</option>
            </select>
          </label>
          <label>
            显示名称
            <input
              value={provider.displayName}
              maxLength={80}
              onChange={(event) =>
                setProvider((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
              required
            />
          </label>
          {provider.providerType === "openai_responses" ? (
            <label className="ai-wide-field">
              API 基础地址
              <input
                value={provider.baseUrl}
                inputMode="url"
                onChange={(event) =>
                  setProvider((current) => ({
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
              value={provider.modelName}
              maxLength={120}
              onChange={(event) =>
                setProvider((current) => ({
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
              value={provider.contextLimit}
              onChange={(event) =>
                setProvider((current) => ({
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
              value={provider.maxOutputTokens}
              onChange={(event) =>
                setProvider((current) => ({
                  ...current,
                  maxOutputTokens: event.target.value,
                }))
              }
              required
            />
          </label>
          <button type="submit" disabled={busy !== undefined}>
            保存 Provider
          </button>
        </form>

        <form className="ai-settings" onSubmit={submitBudget}>
          <h3>Token 预算</h3>
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
      </div>

      {provider.providerType === "openai_responses" ? (
        <form className="ai-secret-form" onSubmit={submitSecret}>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={secret}
              maxLength={4096}
              placeholder={
                overview?.provider.hasSecret === true
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
          {overview?.provider.hasSecret === true ? (
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
            {overview?.provider.hasSecret === true
              ? "Windows 凭据管理器：已保存"
              : "Windows 凭据管理器：未保存"}
          </span>
        </form>
      ) : null}

      <form className="ai-preview-form" onSubmit={preparePreview}>
        <div>
          <h3>外发预览</h3>
          <span>
            {provider.providerType === "offline_test"
              ? "不会联网"
              : "仅在确认后联网"}
          </span>
        </div>
        <label>
          测试文本
          <textarea
            rows={5}
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
            max={overview?.provider.maxOutputTokens ?? 800}
            value={outputLimit}
            onChange={(event) => {
              setOutputLimit(event.target.value);
              invalidatePreview();
            }}
            required
          />
        </label>
        <button type="submit" disabled={busy !== undefined}>
          生成外发预览
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
              : "确认并调用 Provider"}
          </button>
        </section>
      ) : null}

      {result !== undefined ? (
        <section className="ai-result" aria-labelledby="ai-result-title">
          <div>
            <h3 id="ai-result-title">调用结果</h3>
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
