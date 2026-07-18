# M1 Windows CI 与 Release Smoke 自动化

| 项目 | 内容 |
| --- | --- |
| 工作项 | M1-013 |
| 日期 | 2026-07-18 |
| 状态 | implementation-complete / awaiting-first-hosted-run |
| 工作流 | `.github/workflows/windows-ci.yml` |

## CI 范围

Windows CI 在 `main` push、Pull Request 和手动 `workflow_dispatch` 时运行，使用固定的 `windows-2025` 标准 GitHub 托管 Runner。单个 Job 依次执行：

1. 以只读权限检出仓库；
2. 安装 Node.js `22.18.0` 和 pnpm `11.9.0`；
3. 根据 `rust-toolchain.toml` 安装 Rust `1.97.1`、Rustfmt 与 Clippy；
4. 使用 `pnpm install --frozen-lockfile` 安装前端依赖；
5. 解析 Release Smoke PowerShell 脚本，拒绝语法错误；
6. 执行 Prettier、ESLint、TypeScript、Vitest 和前端生产构建；
7. 执行 Rustfmt、Rust 测试和全目标/全特性 Clippy；
8. 执行 `pnpm tauri build --no-bundle`；
9. 在隔离 AppData 下运行非交互式 Release 启动 Smoke；
10. 上传 EXE 与 JSON Smoke 报告，保留 14 天。

Job 超时为 45 分钟；同一分支的新提交会取消旧运行。工作流权限只有 `contents: read`，检出后不保留 Git 凭据。

## 供应链与版本边界

- Runner 固定为 `windows-2025`，不使用会随时间切换镜像的 `windows-latest`；
- `actions/checkout`、`actions/setup-node` 和 `actions/upload-artifact` 均固定到官方仓库的完整提交 SHA；
- Node、pnpm 和 Rust 使用精确版本；
- pnpm 与 Cargo 都必须遵守现有锁文件；
- CI 不接收发布密钥、AI Key、个人资料或生产工作区数据；
- M1 只上传未签名测试 EXE，不发布安装包或 GitHub Release。

官方依据：

- [GitHub 托管 Runner 参考](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Tauri Windows 前置条件](https://v2.tauri.app/start/prerequisites/)
- [GitHub 工作流 Artifact](https://docs.github.com/en/actions/tutorials/store-and-share-data)

## Release Smoke 行为

`scripts/test-release-smoke.ps1` 只在 CI 中执行以下检查：

- 在 `RUNNER_TEMP` 下创建唯一临时根目录；
- 将子进程的 `APPDATA` 与 `LOCALAPPDATA` 指向隔离目录；
- 使用隐藏窗口方式启动刚构建的 `kystudy.exe`；
- 20 秒内要求观察到 KyStudy 主窗口句柄；
- 主窗口出现后继续存活至少 2 秒；
- 确认启动过程没有在无用户操作时创建工作区数据库；
- 记录 EXE 大小、SHA-256、Runner 镜像、架构和观察时间；
- 只终止本脚本启动的精确进程 ID；
- 递归清理前再次确认目标严格位于 `RUNNER_TEMP` 内。

Smoke 不点击窗口、不创建工作区、不导入资料，也不读取 Runner 之外的数据。

## 本地证据

M1-013 落盘后已完成：

- 18 个 TypeScript/Vitest 测试通过；
- 43 个 Rust 测试通过；
- Prettier、ESLint、TypeScript、production build、Rustfmt 和 Clippy 零警告；
- PowerShell AST 解析无语法错误；
- GitHub Workflow 通过 Prettier 的 YAML 解析；
- Rust `1.97.1`、Rustfmt 和 Clippy 锁定工具链解析成功；
- Windows Tauri Release 构建成功。

本地 Release：

```text
F:\develop\KyStudy\src-tauri\target\release\kystudy.exe
大小：11,528,704 bytes
SHA-256：63E733031D92C74C913BF97C777FDF7E8A82D8B8B02E28C96E2DDA7A6C2A3E4B
```

按照项目维护者要求，本机不执行自动桌面操控或窗口 Smoke；首次完整通过必须来自 GitHub 托管 Runner。

## 首次托管验收

当前工作区尚不是 Git 仓库，也没有可用的 GitHub Actions 运行上下文，因此 M1-013 还不能标记为 `completed`。代码推送到 GitHub 后：

1. 打开仓库的 **Actions** 页面；
2. 选择 **Windows CI**；
3. 点击 **Run workflow**，选择 `main`；
4. 等待 `Quality, Release, and Smoke` Job 完成；
5. 确认所有步骤为绿色；
6. 下载 `kystudy-windows-x64-<commit>` Artifact；
7. 确认其中包含 `kystudy.exe` 和 `windows-release-smoke.json`；
8. 打开 JSON，确认 `status` 为 `passed`、`mainWindowObserved` 为 `true`、`workspaceDatabaseCreated` 为 `false`。

首次托管运行通过后，将本文档状态改为 `completed`，并进入 M1-014 总走查。
