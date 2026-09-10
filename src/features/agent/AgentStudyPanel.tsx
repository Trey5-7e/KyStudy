import { useEffect, useRef, useState } from "react";
import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import { MarkdownRenderer } from "../../shared/components/MarkdownRenderer";
import { PageStatus } from "../../shared/components/PagePrimitives";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { Input } from "../../shared/ui/Input";
import { Select } from "../../shared/ui/Select";
import { StatusBanner } from "../../shared/ui/StatusBanner";
import { Textarea } from "../../shared/ui/Textarea";
import {
  agentStudyApi,
  agentErrorText,
  type AgentStudyApi,
  type AgentCatalog,
  type AgentDetail,
} from "../../shared/tauri/agentClient";
import {
  DEFAULT_AGENT_BUDGET,
  isAgentTerminal,
  hasAgentTokenWarning,
  type AgentRunSnapshot,
  type AgentTokenPolicy,
} from "../../shared/tauri/agentContract";
import type { AiProviderConfig } from "../../shared/tauri/aiClient";
import {
  AGENT_STATE_TEXT,
  isStudyActive,
  parseStudyPages,
  studySourceText,
  hasPartialStudySource,
  studyQuestion,
} from "./agentStudyModel";
import "./agent-study.css";

interface Props {
  provider?: AiProviderConfig;
  onOpenReference(documentId: string, page: number): void;
  api?: AgentStudyApi;
}

interface StudyFormFieldsProps {
  catalog: AgentCatalog;
  conversation: string;
  setConversation: (val: string) => void;
  document: string;
  setDocument: (val: string) => void;
  pageInput: string;
  setPageInput: (val: string) => void;
  goal: string;
  setGoal: (val: string) => void;
  policy: AgentTokenPolicy;
  setPolicy: (val: AgentTokenPolicy) => void;
  inputThreshold: number;
  setInputThreshold: (val: number) => void;
  outputThreshold: number;
  setOutputThreshold: (val: number) => void;
  pages: number[];
  busy: boolean;
  provider?: AiProviderConfig;
  setLocating: (val: boolean) => void;
  setRun: (val: AgentRunSnapshot | undefined) => void;
  setDetail: (val: AgentDetail | undefined) => void;
}

function StudyFormFields({
  catalog,
  conversation,
  setConversation,
  document,
  setDocument,
  pageInput,
  setPageInput,
  goal,
  setGoal,
  policy,
  setPolicy,
  inputThreshold,
  setInputThreshold,
  outputThreshold,
  setOutputThreshold,
  pages,
  busy,
  provider,
  setLocating,
  setRun,
  setDetail,
}: StudyFormFieldsProps) {
  return (
    <fieldset className="agent-study-fieldset" disabled={busy}>
      <div className="agent-study-form-row">
        <Field label="保存到会话" htmlFor="agent-study-conversation">
          <Select
            id="agent-study-conversation"
            value={conversation}
            onChange={(e) => {
              setLocating(e.target.value !== "");
              setRun(undefined);
              setDetail(undefined);
              setConversation(e.target.value);
            }}
          >
            <option value="">请选择会话</option>
            {catalog.conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="已索引 PDF 资料" htmlFor="agent-study-document">
          <Select
            id="agent-study-document"
            value={document}
            onChange={(e) => {
              setDocument(e.target.value);
              setPageInput("");
            }}
          >
            <option value="">请选择资料</option>
            {catalog.documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · {d.pageCount} 页
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="物理页码范围"
        htmlFor="agent-study-page-input"
        description="使用 PDF 物理页码，每次最多选择 24 页。"
      >
        <Input
          id="agent-study-page-input"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          placeholder="例如 1-3, 5"
        />
      </Field>

      <div className="agent-study-page-hint-row">
        <span>
          {pageInput && pages.length === 0
            ? "页码格式无效或已超出资料范围。"
            : pages.length > 0
              ? `已解析选定：${pages.join("、")} 页。`
              : "研读遵循最小权限原则，不会默认授权整本资料。"}
        </span>
        {pages.length > 0 ? (
          <span className="agent-study-page-pill">
            <span className="material-symbols-rounded" aria-hidden="true">
              check_circle
            </span>
            已选 {pages.length} 页
          </span>
        ) : null}
      </div>

      <Field label="这次想弄清楚什么？" htmlFor="agent-study-goal">
        <Textarea
          id="agent-study-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="例如：解释这一页的定理，并指出它依赖的条件。"
        />
      </Field>

      <details className="agent-study-advanced-details">
        <summary className="agent-study-advanced-summary">
          <span className="agent-study-advanced-summary-left">
            <span className="material-symbols-rounded" aria-hidden="true">
              tune
            </span>
            高级选项：累计用量与限额策略
          </span>
          <span
            className="material-symbols-rounded agent-study-advanced-arrow"
            aria-hidden="true"
          >
            expand_more
          </span>
        </summary>
        <div className="agent-study-advanced-body">
          <Field label="累计用量策略" htmlFor="agent-study-policy">
            <Select
              id="agent-study-policy"
              value={policy}
              onChange={(e) => setPolicy(e.target.value as AgentTokenPolicy)}
            >
              <option value="observe">只显示用量（默认）</option>
              <option value="warn">达到自设值时提醒</option>
              <option value="enforce">达到自设值时停止</option>
            </Select>
          </Field>

          {policy !== "observe" ? (
            <div className="agent-study-thresholds">
              <Field
                label="输入提醒/限额"
                htmlFor="agent-study-input-threshold"
              >
                <Input
                  id="agent-study-input-threshold"
                  type="number"
                  min={1}
                  value={inputThreshold}
                  onChange={(e) => setInputThreshold(e.target.valueAsNumber)}
                />
              </Field>
              <Field
                label="输出提醒/限额"
                htmlFor="agent-study-output-threshold"
              >
                <Input
                  id="agent-study-output-threshold"
                  type="number"
                  min={1}
                  value={outputThreshold}
                  onChange={(e) => setOutputThreshold(e.target.valueAsNumber)}
                />
              </Field>
            </div>
          ) : null}
        </div>
      </details>

      <div className="agent-study-privacy-note">
        <span
          className="material-symbols-rounded agent-study-privacy-icon"
          aria-hidden="true"
        >
          security
        </span>
        <span>
          点击开始后，仅将本次问题、所选页码与按需读取的文字发送至{" "}
          <strong>{provider?.displayName ?? "已选 Provider"}</strong>
          （api.deepseek.com）。不发送其他聊天历史或页面图片。
        </span>
      </div>
    </fieldset>
  );
}
export function AgentStudyPanel({
  provider,
  onOpenReference,
  api = agentStudyApi,
}: Props) {
  const [catalog, setCatalog] = useState<AgentCatalog>();
  const [conversation, setConversation] = useState("");
  const [document, setDocument] = useState("");
  const [pageInput, setPageInput] = useState("");
  const [goal, setGoal] = useState("");
  const [policy, setPolicy] = useState<AgentTokenPolicy>("observe");
  const [inputThreshold, setInputThreshold] = useState(48000);
  const [outputThreshold, setOutputThreshold] = useState(8000);
  const [run, setRun] = useState<AgentRunSnapshot>();
  const [detail, setDetail] = useState<AgentDetail>();
  const [posting, setPosting] = useState(false);
  const [locating, setLocating] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [followup, setFollowup] = useState("");
  const [comparison, setComparison] = useState<{
    runId: string;
    sourceId: string;
    documentId: string;
    page: number;
  }>();
  const hydrated = useRef("");
  const sourceTrigger = useRef<HTMLButtonElement | null>(null);
  const currentRun = useRef<string | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void api.catalog().then(
      (next) => {
        if (live) {
          setCatalog(next);
          if (next.conversations.length === 0) setLocating(false);
          setConversation((old) => old || next.conversations[0]?.id || "");
        }
      },
      (e) => {
        if (live) setError(agentErrorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [api, refresh]);
  useEffect(() => {
    if (!conversation) return;
    let live = true;
    void api.latest(conversation).then(
      (next) => {
        if (live) {
          setRun(next ?? undefined);
          setLocating(false);
        }
      },
      (e) => {
        if (live) {
          setError(agentErrorText(e));
          setLocating(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [api, conversation, refresh]);
  const runId = run?.id;
  useEffect(() => {
    currentRun.current = runId;
    if (!runId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const next = await api.detail(runId);
        if (!live) return;
        if (hydrated.current !== next.run.id) {
          hydrated.current = next.run.id;
          const selection = next.grant.pages[0];
          setDocument(selection?.documentId ?? "");
          setPageInput(selection?.pages.join(", ") ?? "");
          setGoal(studyQuestion(next.goal));
          setPolicy(next.run.tokenPolicy);
          if (next.run.tokenPolicy !== "observe") {
            setInputThreshold(next.run.limit.input);
            setOutputThreshold(next.run.limit.output);
          }
        }
        setDetail((old) =>
          old?.run.id === next.run.id && old.run.revision > next.run.revision
            ? old
            : next,
        );
        setRun((old) =>
          old?.id === next.run.id && old.revision > next.run.revision
            ? old
            : next.run,
        );
        if (isStudyActive(next.run.state))
          timer = setTimeout(() => void poll(), 1200);
      } catch (e) {
        if (live) setError(agentErrorText(e));
      }
    };
    void poll();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, runId, refresh]);

  const selected = catalog?.documents.find((item) => item.id === document);
  const pages = parseStudyPages(pageInput, selected?.pageCount ?? 0);
  const supported =
    provider?.providerType === "deepseek_chat" &&
    provider.modelName === "deepseek-v4-flash-vision-exp" &&
    provider.hasSecret;
  const active = run !== undefined && !isAgentTerminal(run.state);
  const busy = posting || locating || active;
  const thresholdValid =
    policy === "observe" ||
    [inputThreshold, outputThreshold].every(
      (n) => Number.isSafeInteger(n) && n > 0 && n <= 4294967295,
    );
  const canStart =
    supported &&
    conversation !== "" &&
    pages.length > 0 &&
    goal.trim() !== "" &&
    thresholdValid &&
    !busy;
  const start = async (asFollowup = false) => {
    if (
      !provider ||
      (asFollowup
        ? busy ||
          !supported ||
          !followup.trim() ||
          run?.state !== "completed" ||
          !detail
        : !canStart)
    )
      return;
    setPosting(true);
    setError("");
    try {
      const next = await api.start({
        conversationId: conversation,
        providerId: provider.id,
        goal: asFollowup ? followup.trim() : goal.trim(),
        ...(asFollowup ? { previousRunId: run?.id } : {}),
        pages:
          asFollowup && detail
            ? detail.grant.pages.map((p) => ({
                documentId: p.documentId,
                pages: p.pages,
              }))
            : [{ documentId: document, pages }],
        tokenPolicy: asFollowup && detail ? detail.run.tokenPolicy : policy,
        budget:
          asFollowup && detail
            ? detail.run.limit
            : {
                ...DEFAULT_AGENT_BUDGET,
                input: policy === "observe" ? 0 : inputThreshold,
                output: policy === "observe" ? 0 : outputThreshold,
              },
      });
      setDetail(undefined);
      setEditing(false);
      setComparison(undefined);
      setFollowup("");
      setRun(next);
    } catch (e) {
      setError(agentErrorText(e));
    } finally {
      setPosting(false);
    }
  };
  const cancel = async () => {
    if (!run || posting) return;
    setPosting(true);
    setError("");
    try {
      const next = await api.cancel(run.id);
      setRun(next);
      setDetail((old) => (old ? { ...old, run: next } : old));
    } catch (e) {
      setError(agentErrorText(e));
    } finally {
      setPosting(false);
    }
  };
  const openSource = async (sourceId: string) => {
    if (!run) return;
    try {
      const source = await api.source(run.id, sourceId);
      if (currentRun.current === run.id)
        setComparison({ ...source, runId: run.id, sourceId });
    } catch (e) {
      setError(agentErrorText(e));
    }
  };
  const answer =
    run?.state === "completed"
      ? detail?.results.find((item) => item.kind === "final")
      : undefined;
  const question =
    run?.state === "waiting_for_input"
      ? detail?.results.find((item) => item.kind === "needs_input")
      : undefined;
  return (
    <section className="agent-study" aria-labelledby="agent-study-title">
      <header className="agent-study-heading">
        <div className="agent-study-title-group">
          <span
            className="material-symbols-rounded agent-study-header-icon"
            aria-hidden="true"
          >
            auto_stories
          </span>
          <div>
            <h2 id="agent-study-title" className="agent-study-title">
              资料研读
            </h2>
            <p className="agent-study-subtitle">
              选定资料与物理页码，按需核对原文证据，生成有溯源出处的深度回答。
            </p>
          </div>
        </div>
        <Badge tone="neutral">只读文字研读</Badge>
      </header>

      {error ? (
        <StatusBanner
          tone="error"
          title="研读出错"
          className="agent-study-alert"
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setError("");
                setLocating(true);
                setRun(undefined);
                setDetail(undefined);
                setRefresh((v) => v + 1);
              }}
            >
              刷新状态
            </Button>
          }
        >
          {error}
        </StatusBanner>
      ) : null}

      {!catalog ? (
        <PageStatus tone="loading" title="正在准备研读环境">
          正在加载本地会话与已索引资料列表，请稍候…
        </PageStatus>
      ) : (
        <>
          {!supported ? (
            <StatusBanner
              tone="warning"
              title="模型配置未就绪"
              className="agent-study-alert"
            >
              请先在 AI 设置中选择已验证的 DeepSeek 模型，并配置凭据。当前模型：
              {provider?.modelName ?? "未配置"}。
            </StatusBanner>
          ) : null}

          {!catalog.conversations.length ? (
            <StatusBanner
              tone="info"
              title="暂无可用会话"
              className="agent-study-alert"
            >
              暂无可用会话，请先切换到“普通对话”新建一个会话。
            </StatusBanner>
          ) : null}

          {!catalog.documents.length ? (
            <StatusBanner
              tone="info"
              title="暂无已索引资料"
              className="agent-study-alert"
            >
              暂无已索引 PDF。请先在资料页导入 PDF
              并完成文字索引；扫描页的视觉研读尚未接入。
            </StatusBanner>
          ) : null}

          {/* 初始状态表单：尚未创建/加载运行任务时在主区域展示配置卡片 */}
          {!run && !locating ? (
            <div className="agent-study-card agent-study-form-card">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void start();
                }}
              >
                <StudyFormFields
                  catalog={catalog}
                  conversation={conversation}
                  setConversation={setConversation}
                  document={document}
                  setDocument={setDocument}
                  pageInput={pageInput}
                  setPageInput={setPageInput}
                  goal={goal}
                  setGoal={setGoal}
                  policy={policy}
                  setPolicy={setPolicy}
                  inputThreshold={inputThreshold}
                  setInputThreshold={setInputThreshold}
                  outputThreshold={outputThreshold}
                  setOutputThreshold={setOutputThreshold}
                  pages={pages}
                  busy={busy}
                  provider={provider}
                  setLocating={setLocating}
                  setRun={setRun}
                  setDetail={setDetail}
                />
                <div style={{ marginTop: "var(--space-4)" }}>
                  <Button
                    variant="primary"
                    size="lg"
                    block
                    type="submit"
                    disabled={!canStart}
                  >
                    {posting && !active ? "正在启动…" : "开始研读"}
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          {/* 研读主工作区：纯粹阅读体验，不堆叠辅助内容 */}
          {run || locating ? (
            <div className="agent-study-workspace">
              {/* 工具栏 */}
              <div className="agent-study-toolbar">
                <div className="agent-study-toolbar-left">
                  <span
                    className="material-symbols-rounded agent-study-toolbar-session-icon"
                    aria-hidden="true"
                  >
                    forum
                  </span>
                  <span>
                    会话：
                    {catalog.conversations.find((c) => c.id === conversation)
                      ?.title ?? "研读会话"}
                  </span>
                  <Badge
                    tone={
                      active
                        ? "info"
                        : run?.state === "completed"
                          ? "success"
                          : run?.state === "failed"
                            ? "danger"
                            : "neutral"
                    }
                  >
                    {run
                      ? AGENT_STATE_TEXT[run.state]
                      : locating
                        ? "读取状态…"
                        : "等待提问"}
                  </Badge>
                </div>

                <div className="agent-study-toolbar-right">
                  {run ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDiagnostics(true)}
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        analytics
                      </span>
                      运行详情 ({run.used.tools}次调用)
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || !detail}
                    onClick={() => setEditing(true)}
                  >
                    <span
                      className="material-symbols-rounded"
                      aria-hidden="true"
                    >
                      edit_note
                    </span>
                    调整范围 / 新问题
                  </Button>
                  {active ? (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={posting}
                      onClick={() => void cancel()}
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        stop_circle
                      </span>
                      {posting ? "正在停止…" : "取消研读"}
                    </Button>
                  ) : null}
                </div>
              </div>

              {/* 运行中动态横幅 */}
              {active ? (
                <div className="agent-study-running-banner" role="status">
                  <span
                    className="material-symbols-rounded agent-study-running-spinner"
                    aria-hidden="true"
                  >
                    progress_activity
                  </span>
                  <div className="agent-study-running-text">
                    已执行 {run?.used.tools ?? 0}{" "}
                    次工具调用，正在按需核对所选页面的原文证据。离开页面不会丢失后台任务。
                  </div>
                </div>
              ) : null}

              {/* 错误代码提示 */}
              {run?.errorCode ? (
                <StatusBanner tone="error">
                  {agentErrorText({ code: run.errorCode })}
                </StatusBanner>
              ) : null}

              {/* Token 警戒提醒 */}
              {run && hasAgentTokenWarning(run) ? (
                <StatusBanner tone="warning">
                  已达到你设置的提醒值；本轮仍可继续。
                </StatusBanner>
              ) : null}

              {/* 等待补充输入 */}
              {question?.kind === "needs_input" ? (
                <StatusBanner tone="warning" title="需要进一步说明">
                  <p>{question.question}</p>
                  <p>可取消本轮后，把补充信息写入问题重新开始。</p>
                </StatusBanner>
              ) : null}

              {/* 研读问题与授权范围概览 */}
              {detail ? (
                <div className="agent-study-question-card">
                  <div className="agent-study-question-header">
                    <span>本轮研读目标</span>
                  </div>
                  <h3 className="agent-study-question-title">
                    {studyQuestion(detail.goal)}
                  </h3>
                  <div className="agent-study-scope-tags">
                    {detail.grant.pages.map((p) => (
                      <span
                        key={p.documentId}
                        className="agent-study-scope-tag"
                      >
                        <span
                          className="material-symbols-rounded"
                          aria-hidden="true"
                        >
                          menu_book
                        </span>
                        {catalog.documents.find((d) => d.id === p.documentId)
                          ?.title ?? "所选资料"}{" "}
                        · 第 {p.pages.join("、")} 页
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 回答正文与文献引用 */}
              {answer?.kind === "final" ? (
                <div className="agent-study-card agent-study-answer-card">
                  {hasPartialStudySource(detail!.results, answer.source_ids) ? (
                    <StatusBanner tone="warning">
                      本回答基于部分原文片段，尚未完整覆盖引用页面。可打开来源核对，或明确要求继续研读未覆盖内容。
                    </StatusBanner>
                  ) : null}

                  <MarkdownRenderer
                    readOnly
                    className="agent-study-answer"
                    source={answer.message}
                  />

                  {/* 引用来源列表 */}
                  <div
                    className="agent-study-sources-section"
                    aria-label="回答来源"
                  >
                    <span className="agent-study-sources-label">
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        bookmark
                      </span>
                      引用来源（点击打开叠加窗口查看原文证据）
                    </span>
                    <div className="agent-study-sources">
                      {answer.source_ids.map((sourceId) => {
                        const selection = detail!.grant.pages.find((p) =>
                          sourceId.startsWith(`${p.documentId}:${p.revision}:`),
                        );
                        const page = sourceId.split(":").at(-1);
                        return (
                          <button
                            type="button"
                            key={sourceId}
                            className="agent-study-source-chip"
                            onClick={(event) => {
                              sourceTrigger.current = event.currentTarget;
                              void openSource(sourceId);
                            }}
                          >
                            <span
                              className="material-symbols-rounded agent-study-source-chip-icon"
                              aria-hidden="true"
                            >
                              description
                            </span>
                            <span>
                              {catalog.documents.find(
                                (d) => d.id === selection?.documentId,
                              )?.title ?? "原始资料"}
                            </span>
                            <Badge tone="neutral">第 {page} 页</Badge>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* 追问输入区 */}
              {answer?.kind === "final" ? (
                <form
                  className="agent-study-followup"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void start(true);
                  }}
                >
                  <div className="agent-study-followup-header">
                    <span>继续追问</span>
                  </div>
                  <Textarea
                    rows={2}
                    maxLength={1000}
                    value={followup}
                    onChange={(e) => setFollowup(e.target.value)}
                    placeholder="例如：把第二步展开讲讲，或者结合公式进一步解释。"
                    disabled={busy}
                  />
                  <div className="agent-study-followup-footer">
                    <p className="agent-study-followup-hint">
                      沿用本轮授权页与上下文摘录至已选
                      Provider。新问题将自动重新核对证据。
                    </p>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={busy || !supported || !followup.trim()}
                    >
                      <span
                        className="material-symbols-rounded"
                        aria-hidden="true"
                      >
                        send
                      </span>
                      发送追问
                    </Button>
                  </div>
                </form>
              ) : null}
            </div>
          ) : null}

          {/* 叠加窗口 1: 调整范围与新问题 Modal */}
          {editing ? (
            <EditorDialog
              title="调整研读范围与问题"
              description="重新选定资料、物理页码或提问，将基于新范围开始研读。"
              dirty={false}
              onRequestClose={() => setEditing(false)}
              size="large"
            >
              <form
                className="agent-study-dialog-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void start();
                }}
              >
                <StudyFormFields
                  catalog={catalog}
                  conversation={conversation}
                  setConversation={setConversation}
                  document={document}
                  setDocument={setDocument}
                  pageInput={pageInput}
                  setPageInput={setPageInput}
                  goal={goal}
                  setGoal={setGoal}
                  policy={policy}
                  setPolicy={setPolicy}
                  inputThreshold={inputThreshold}
                  setInputThreshold={setInputThreshold}
                  outputThreshold={outputThreshold}
                  setOutputThreshold={setOutputThreshold}
                  pages={pages}
                  busy={busy}
                  provider={provider}
                  setLocating={setLocating}
                  setRun={setRun}
                  setDetail={setDetail}
                />
                <EditorDialogFooter>
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => setEditing(false)}
                  >
                    取消
                  </Button>
                  <Button variant="primary" type="submit" disabled={!canStart}>
                    {posting && !active ? "正在启动…" : "开始新研读"}
                  </Button>
                </EditorDialogFooter>
              </form>
            </EditorDialog>
          ) : null}

          {/* 叠加窗口 2: 原文对照 Modal */}
          {comparison && detail ? (
            <EditorDialog
              title={`原文对照 · 第 ${comparison.page} 页`}
              description={
                catalog.documents.find((d) => d.id === comparison.documentId)
                  ?.title ?? "已选资料"
              }
              dirty={false}
              onRequestClose={() => {
                setComparison(undefined);
                sourceTrigger.current?.focus();
              }}
              size="large"
            >
              <div className="agent-study-comparison-content">
                <StatusBanner tone="info">
                  本轮实际读取的索引文字片段，重复片段已去重；不是完整 PDF
                  页面。
                </StatusBanner>
                <div className="agent-study-comparison-text-box">
                  <pre className="agent-study-comparison-pre">
                    {studySourceText(detail.results, comparison.sourceId)}
                  </pre>
                </div>
              </div>
              <EditorDialogFooter>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void api
                      .source(comparison.runId, comparison.sourceId)
                      .then((source) =>
                        onOpenReference(source.documentId, source.page),
                      )
                      .catch((e) => setError(agentErrorText(e)));
                  }}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">
                    open_in_new
                  </span>
                  在资料库打开 PDF
                </Button>
                <EditorDialogCloseButton>关闭对照</EditorDialogCloseButton>
              </EditorDialogFooter>
            </EditorDialog>
          ) : null}

          {/* 叠加窗口 3: 研读过程与运行记录 Modal */}
          {showDiagnostics && run && detail ? (
            <EditorDialog
              title="研读过程与运行记录"
              description={`模型调用 ${run.used.models} 次 · 工具调用 ${run.used.tools} 次`}
              dirty={false}
              onRequestClose={() => setShowDiagnostics(false)}
              size="medium"
            >
              <div className="agent-study-diagnostics">
                <h3 className="agent-study-diagnostics-heading">
                  工具调用步骤
                </h3>
                <ol className="agent-study-timeline">
                  {detail.results.map((r) =>
                    r.kind === "tool" ? (
                      <li key={r.call.id} className="agent-study-timeline-item">
                        <span
                          className="material-symbols-rounded agent-study-timeline-icon"
                          aria-hidden="true"
                        >
                          {r.call.tool === "search_learning_resources"
                            ? "travel_explore"
                            : "menu_book"}
                        </span>
                        <div className="agent-study-timeline-content">
                          <strong>
                            {r.call.tool === "search_learning_resources"
                              ? "检索页面片段"
                              : "读取页面文字"}
                          </strong>
                          <span>第 {r.call.page} 页</span>
                        </div>
                      </li>
                    ) : null,
                  )}
                </ol>

                <h3 className="agent-study-diagnostics-heading">
                  模型与用量估算
                </h3>
                <div className="agent-study-metrics-grid">
                  <div className="agent-study-metric-card">
                    <span className="agent-study-metric-label">模型</span>
                    <span className="agent-study-metric-value">
                      {detail.grant.model}
                    </span>
                  </div>
                  <div className="agent-study-metric-card">
                    <span className="agent-study-metric-label">模型请求</span>
                    <span className="agent-study-metric-value">
                      {run.used.models} 次
                    </span>
                  </div>
                  <div className="agent-study-metric-card">
                    <span className="agent-study-metric-label">工具调用</span>
                    <span className="agent-study-metric-value">
                      {run.used.tools} 次
                    </span>
                  </div>
                  <div className="agent-study-metric-card">
                    <span className="agent-study-metric-label">
                      预留输入估算
                    </span>
                    <span className="agent-study-metric-value">
                      {run.used.input}
                    </span>
                  </div>
                  <div className="agent-study-metric-card">
                    <span className="agent-study-metric-label">
                      预留输出估算
                    </span>
                    <span className="agent-study-metric-value">
                      {run.used.output}
                    </span>
                  </div>
                </div>
                <p className="agent-study-subtitle">
                  注：输入预留与输出预留估算均为预估上限，并非最终计费用量。
                </p>
              </div>
              <EditorDialogFooter>
                <EditorDialogCloseButton>关闭详情</EditorDialogCloseButton>
              </EditorDialogFooter>
            </EditorDialog>
          ) : null}
        </>
      )}
    </section>
  );
}
