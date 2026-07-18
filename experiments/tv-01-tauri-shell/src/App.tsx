import { useEffect, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "./App.css";
import {
  cancelProgressDemo,
  getEnvironmentStatus,
  isDesktopRuntime,
  normalizeAppError,
  probeUntrustedPath,
  selectFileFingerprint,
  startProgressDemo,
  triggerExpectedFailure,
  type AppError,
  type EnvironmentStatus,
  type FileFingerprint,
  type ProgressEvent,
} from "./tauriClient";

const FRONTEND_VERSION = "0.1.0";
const DEFAULT_UNTRUSTED_PATH = "C:\\Windows\\System32\\drivers\\etc\\hosts";
const DESKTOP_RUNTIME = isDesktopRuntime();

function App() {
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(
    null,
  );
  const [fingerprint, setFingerprint] = useState<FileFingerprint | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [candidatePath, setCandidatePath] = useState(DEFAULT_UNTRUSTED_PATH);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [activeOperationId, setActiveOperationId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!DESKTOP_RUNTIME) {
      return;
    }

    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<ProgressEvent>("tv01-progress", ({ payload }) => {
      setProgress(payload);
      if (payload.done) {
        setActiveOperationId(null);
      }
    })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch((caught: unknown) => {
        if (!disposed) {
          setError(normalizeAppError(caught));
        }
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function runAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(normalizeAppError(caught));
    } finally {
      setBusy(null);
    }
  }

  const loadEnvironment = () =>
    runAction("environment", async () => {
      setEnvironment(await getEnvironmentStatus());
    });

  const pickFile = () =>
    runAction("file", async () => {
      setFingerprint(await selectFileFingerprint());
    });

  const rejectPath = () =>
    runAction("path", async () => {
      await probeUntrustedPath(candidatePath);
    });

  const showExpectedFailure = () =>
    runAction("failure", async () => {
      await triggerExpectedFailure();
    });

  const startProgress = () =>
    runAction("progress", async () => {
      setProgress(null);
      const started = await startProgressDemo();
      setActiveOperationId(started.operationId);
    });

  const cancelProgress = () => {
    if (!activeOperationId) {
      return;
    }
    void runAction("cancel", () => cancelProgressDemo(activeOperationId));
  };

  return (
    <>
      <a className="skip-link" href="#tv01-main">
        跳到主要内容
      </a>
      <main className="shell" id="tv01-main">
        <header className="hero">
          <div>
            <p className="eyebrow">KyStudy · Technical Validation 01</p>
            <h1>Tauri 边界诊断壳</h1>
            <p className="subtitle">
              只验证桌面运行时、类型化
              Command、受控错误、文件授权和事件清理，不代表最终产品界面。
            </p>
          </div>
          <span
            className={`runtime-badge ${DESKTOP_RUNTIME ? "ready" : "browser"}`}
          >
            {DESKTOP_RUNTIME ? "Tauri 已连接" : "浏览器预览"}
          </span>
        </header>

        <section className="status-strip" aria-label="版本状态">
          <span>前端 v{FRONTEND_VERSION}</span>
          <span>React 19</span>
          <span>
            {environment ? `应用 v${environment.appVersion}` : "应用版本待读取"}
          </span>
        </section>

        {!DESKTOP_RUNTIME ? (
          <div className="notice" role="status">
            当前是浏览器预览，Rust Command 按钮仅在 Tauri 窗口中可用。
          </div>
        ) : null}

        <div className="grid">
          <section className="card">
            <div className="card-heading">
              <div>
                <p className="step">01 · Command</p>
                <h2>环境状态</h2>
              </div>
              <button
                type="button"
                disabled={!DESKTOP_RUNTIME || busy !== null}
                onClick={loadEnvironment}
              >
                {busy === "environment" ? "读取中…" : "读取状态"}
              </button>
            </div>
            {environment ? (
              <dl className="facts" aria-live="polite">
                <div>
                  <dt>平台</dt>
                  <dd>
                    {environment.platform} / {environment.arch}
                  </dd>
                </div>
                <div>
                  <dt>应用数据目录</dt>
                  <dd>{environment.appDataReady ? "可用" : "不可用"}</dd>
                </div>
                <div>
                  <dt>操作编号</dt>
                  <dd className="mono">{environment.operationId}</dd>
                </div>
              </dl>
            ) : (
              <p className="empty">尚未调用 Rust。</p>
            )}
          </section>

          <section className="card">
            <div className="card-heading">
              <div>
                <p className="step">02 · Native selection</p>
                <h2>文件指纹</h2>
              </div>
              <button
                type="button"
                disabled={!DESKTOP_RUNTIME || busy !== null}
                onClick={pickFile}
              >
                {busy === "file" ? "计算中…" : "选择文本文件"}
              </button>
            </div>
            <p className="hint">
              原生选择器把路径留在 Rust；前端只接收文件名、大小与 SHA-256。
            </p>
            {fingerprint ? (
              <dl className="facts" aria-live="polite">
                <div>
                  <dt>文件名</dt>
                  <dd>{fingerprint.fileName}</dd>
                </div>
                <div>
                  <dt>大小</dt>
                  <dd>{fingerprint.sizeBytes.toLocaleString()} bytes</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd className="mono hash">{fingerprint.sha256}</dd>
                </div>
              </dl>
            ) : null}
          </section>

          <section className="card">
            <div className="card-heading">
              <div>
                <p className="step">03 · Permission</p>
                <h2>未授权路径</h2>
              </div>
            </div>
            <label htmlFor="candidate-path">模拟前端传入路径</label>
            <input
              id="candidate-path"
              name="candidatePath"
              autoComplete="off"
              spellCheck={false}
              value={candidatePath}
              maxLength={4097}
              onChange={(event) => setCandidatePath(event.currentTarget.value)}
            />
            <button
              type="button"
              className="secondary"
              disabled={!DESKTOP_RUNTIME || busy !== null}
              onClick={rejectPath}
            >
              验证拒绝
            </button>
          </section>

          <section className="card">
            <div className="card-heading">
              <div>
                <p className="step">04 · Event lifecycle</p>
                <h2>可取消进度</h2>
              </div>
            </div>
            <progress
              max="100"
              value={progress?.percent ?? 0}
              aria-label="实验进度"
            />
            <div className="progress-meta" aria-live="polite">
              <span>{progress?.stage ?? "尚未开始"}</span>
              <span>{progress?.percent ?? 0}%</span>
            </div>
            <div className="button-row">
              <button
                type="button"
                disabled={
                  !DESKTOP_RUNTIME ||
                  busy !== null ||
                  activeOperationId !== null
                }
                onClick={startProgress}
              >
                开始任务
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!activeOperationId || busy !== null}
                onClick={cancelProgress}
              >
                取消任务
              </button>
            </div>
          </section>
        </div>

        <section className="error-panel" aria-live="polite">
          <div className="error-heading">
            <div>
              <p className="step">稳定错误 DTO</p>
              <h2>{error ? error.code : "等待错误样本"}</h2>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={!DESKTOP_RUNTIME || busy !== null}
              onClick={showExpectedFailure}
            >
              触发预期失败
            </button>
          </div>
          {error ? (
            <div className="error-body">
              <p>{error.message}</p>
              {error.action ? (
                <p className="hint">建议：{error.action}</p>
              ) : null}
              <p className="mono">operation_id: {error.operationId}</p>
            </div>
          ) : (
            <p className="empty">
              所有内部细节都应留在 Rust 诊断日志中，UI 只展示稳定字段。
            </p>
          )}
        </section>
      </main>
    </>
  );
}

export default App;
