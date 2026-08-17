import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import logoUrl from "../../assets/kystudy-icon.png";
import {
  getRuntimeStatus,
  normalizeCommandError,
  type RuntimeStatus,
} from "../../shared/tauri/runtimeClient";
import {
  checkForApplicationUpdate,
  normalizeUpdateError,
  type AvailableApplicationUpdate,
  type ApplicationUpdateProgress,
} from "../../shared/tauri/updateClient";
import { shouldRunAutomaticUpdateCheck } from "../../shared/tauri/updatePolicy";
import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { SectionHeader } from "../../shared/ui/SectionHeader";
import { StatusBanner } from "../../shared/ui/StatusBanner";

const GITHUB_REPOSITORY_URL = "https://github.com/Trey5-7e/KyStudy";
const GITHUB_ISSUES_URL = `${GITHUB_REPOSITORY_URL}/issues`;
const AUTO_UPDATE_CHECK_KEY = "kystudy.settings.autoUpdateCheck";
const LAST_UPDATE_CHECK_KEY = "kystudy.settings.lastUpdateCheck";

async function openExternalUrl(
  event: MouseEvent<HTMLAnchorElement>,
  url: string,
) {
  event.preventDefault();
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

type RuntimeState =
  | { kind: "loading" }
  | { kind: "ready"; runtime: RuntimeStatus }
  | { kind: "error"; message: string };

type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "available"; update: AvailableApplicationUpdate }
  | { kind: "downloading"; progress: ApplicationUpdateProgress }
  | { kind: "installed" }
  | { kind: "error"; message: string };

function readAutoCheckPreference(): boolean {
  try {
    return window.localStorage.getItem(AUTO_UPDATE_CHECK_KEY) !== "false";
  } catch {
    return true;
  }
}

function readLastCheckAt(): number {
  try {
    const value = Number(window.localStorage.getItem(LAST_UPDATE_CHECK_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function rememberLastCheckAt() {
  try {
    window.localStorage.setItem(LAST_UPDATE_CHECK_KEY, String(Date.now()));
  } catch {
    // A private browser context may not expose writable local storage.
  }
}

export function AboutSettings() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState>({
    kind: "loading",
  });
  const [autoCheck, setAutoCheck] = useState(readAutoCheckPreference);
  const [updateState, setUpdateState] = useState<UpdateState>({
    kind: "idle",
  });
  const pendingUpdateRef = useRef<AvailableApplicationUpdate | null>(null);

  const runtime = runtimeState.kind === "ready" ? runtimeState.runtime : null;
  const isReleaseBuild = runtime?.buildProfile === "release";

  const closePendingUpdate = useCallback(() => {
    const pending = pendingUpdateRef.current;
    pendingUpdateRef.current = null;
    if (pending !== null) {
      void pending.close();
    }
  }, []);

  const checkForUpdate = useCallback(
    async (automatic = false) => {
      if (!isReleaseBuild) {
        return;
      }

      closePendingUpdate();
      setUpdateState({ kind: "checking" });
      try {
        const update = await checkForApplicationUpdate();
        rememberLastCheckAt();
        if (update === null) {
          setUpdateState({ kind: "none" });
          return;
        }
        pendingUpdateRef.current = update;
        setUpdateState({ kind: "available", update });
      } catch (error: unknown) {
        setUpdateState(
          automatic
            ? { kind: "idle" }
            : { kind: "error", message: normalizeUpdateError(error) },
        );
      }
    },
    [closePendingUpdate, isReleaseBuild],
  );

  useEffect(() => {
    let active = true;
    void getRuntimeStatus().then(
      (nextRuntime) => {
        if (active) {
          setRuntimeState({ kind: "ready", runtime: nextRuntime });
        }
      },
      (error: unknown) => {
        if (active) {
          setRuntimeState({
            kind: "error",
            message: normalizeCommandError(error).message,
          });
        }
      },
    );

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !shouldRunAutomaticUpdateCheck({
        buildProfile: runtime?.buildProfile ?? null,
        enabled: autoCheck,
        lastCheckedAt: readLastCheckAt(),
        now: Date.now(),
      })
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void checkForUpdate(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoCheck, checkForUpdate, isReleaseBuild, runtime?.buildProfile]);

  useEffect(() => closePendingUpdate, [closePendingUpdate]);

  const installUpdate = async () => {
    const update = pendingUpdateRef.current;
    if (update === null) {
      return;
    }

    setUpdateState({
      kind: "downloading",
      progress: { downloadedBytes: 0, contentLength: null, percent: null },
    });
    try {
      await update.install((progress) => {
        setUpdateState({ kind: "downloading", progress });
      });
      pendingUpdateRef.current = null;
      setUpdateState({ kind: "installed" });
    } catch (error: unknown) {
      setUpdateState({
        kind: "error",
        message: normalizeUpdateError(error, "download"),
      });
    }
  };

  const setAutoCheckPreference = (enabled: boolean) => {
    setAutoCheck(enabled);
    try {
      window.localStorage.setItem(AUTO_UPDATE_CHECK_KEY, String(enabled));
    } catch {
      // Keep the in-memory preference when local storage is unavailable.
    }
  };

  const versionLabel =
    runtimeState.kind === "ready"
      ? `v${runtimeState.runtime.appVersion}`
      : "读取中…";

  return (
    <div className="settings-section-stack settings-about">
      <section className="settings-about-hero" aria-labelledby="about-title">
        <img src={logoUrl} alt="KyStudy" className="settings-about-logo" />
        <div className="settings-about-identity">
          <div className="settings-about-title-row">
            <h3 id="about-title">KyStudy</h3>
            <Badge tone="success">{versionLabel}</Badge>
          </div>
          <p>简化备考步骤，把计划、习题与资料留在本机。</p>
          <a
            href={GITHUB_REPOSITORY_URL}
            target="_blank"
            rel="noreferrer"
            className="settings-about-link"
            onClick={(event) =>
              void openExternalUrl(event, GITHUB_REPOSITORY_URL)
            }
          >
            GitHub 开源仓库
          </a>
          <a
            href={GITHUB_ISSUES_URL}
            target="_blank"
            rel="noreferrer"
            className="settings-about-link"
            onClick={(event) => void openExternalUrl(event, GITHUB_ISSUES_URL)}
          >
            意见反馈
          </a>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="update-title">
        <SectionHeader
          id="update-title"
          level={3}
          title="软件更新"
          description="从 GitHub Release 获取经过签名校验的 Windows 更新"
          actions={
            <Button
              size="sm"
              onClick={() => void checkForUpdate(false)}
              disabled={!isReleaseBuild || updateState.kind === "checking"}
            >
              {updateState.kind === "checking" ? "检查中…" : "检查更新"}
            </Button>
          }
        />

        {runtimeState.kind === "error" ? (
          <StatusBanner tone="error" title={runtimeState.message} />
        ) : null}
        {!isReleaseBuild && runtimeState.kind === "ready" ? (
          <StatusBanner tone="info" title="开发构建不参与自动更新">
            发布版会从 GitHub Release 检查更新，开发数据和发布安装版保持隔离。
          </StatusBanner>
        ) : null}
        {updateState.kind === "none" ? (
          <StatusBanner tone="success" title="已是最新版本" />
        ) : null}
        {updateState.kind === "error" ? (
          <StatusBanner tone="error" title={updateState.message} />
        ) : null}
        {updateState.kind === "available" ? (
          <div className="settings-update-card">
            <div>
              <strong>发现新版本 v{updateState.update.version}</strong>
              <p>
                当前版本 {updateState.update.currentVersion}
                {updateState.update.date === null
                  ? ""
                  : ` · ${new Date(updateState.update.date).toLocaleDateString()}`}
              </p>
              {updateState.update.notes ? (
                <p className="settings-update-notes">
                  {updateState.update.notes}
                </p>
              ) : null}
            </div>
            <Button onClick={() => void installUpdate()}>下载并安装</Button>
          </div>
        ) : null}
        {updateState.kind === "downloading" ? (
          <StatusBanner
            tone="info"
            title={
              updateState.progress.percent === null
                ? "正在下载更新…"
                : `正在下载更新… ${updateState.progress.percent}%`
            }
          />
        ) : null}
        {updateState.kind === "installed" ? (
          <StatusBanner tone="success" title="更新已安装">
            Windows 安装程序可能已经关闭应用；如果没有，请手动重新启动 KyStudy。
          </StatusBanner>
        ) : null}

        <label className="settings-toggle-row">
          <input
            type="checkbox"
            checked={autoCheck}
            onChange={(event) => setAutoCheckPreference(event.target.checked)}
            disabled={!isReleaseBuild}
          />
          <span>
            <strong>启动时自动检查更新</strong>
            <small>每 24 小时检查一次，不会静默下载或安装。</small>
          </span>
        </label>
      </section>

      <section
        className="settings-section"
        aria-labelledby="about-details-title"
      >
        <SectionHeader id="about-details-title" level={3} title="应用信息" />
        <dl className="settings-description-list">
          <div>
            <dt>版本</dt>
            <dd>{versionLabel}</dd>
          </div>
          <div>
            <dt>平台</dt>
            <dd>Windows 10/11 · x64</dd>
          </div>
          <div>
            <dt>许可证</dt>
            <dd>GNU GPL-3.0-only</dd>
          </div>
          <div>
            <dt>代码仓库</dt>
            <dd>
              <a
                href={GITHUB_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
                onClick={(event) =>
                  void openExternalUrl(event, GITHUB_REPOSITORY_URL)
                }
              >
                github.com/Trey5-7e/KyStudy
              </a>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
