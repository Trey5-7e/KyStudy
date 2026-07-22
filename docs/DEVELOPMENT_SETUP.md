# KyStudy 开发环境与依赖说明

| 项目     | 内容                |
| -------- | ------------------- |
| 文档版本 | 0.1                 |
| 更新日期 | 2026-07-22          |
| 当前阶段 | M12 已验收；进入 M13 计划执行进度 |
| 目标平台 | Windows 11 x64 优先 |

## 1. 当前原则

- 正式 KyStudy 工程已经初始化在仓库根目录；`experiments/` 继续作为可丢弃、可复现的技术证据，不直接并入正式代码。
- 依赖按里程碑和技术实验引入，不一次性安装未来可能使用的全部 SDK、模型和运行时。
- 开发工具、包缓存和构建工具优先放在 F 盘，避免持续占用系统盘。
- 锁文件是可复现构建的一部分；不长期依赖未锁定的 `latest`。
- 包安装脚本默认不全局放开，只批准经过检查的必要包。
- 已进入人工验收构建的数据库迁移视为不可变历史，不得原地改写 SQL；若必须兼容已分发但结构等价的历史，只能添加精确校验和白名单和正反向升级测试。

## 2. 已验证工具链

| 工具                      | 版本                      | 位置或说明                                 |
| ------------------------- | ------------------------- | ------------------------------------------ |
| Node.js                   | `v22.18.0`                | 系统已有                                   |
| npm                       | `10.9.3`                  | 缓存位于 `F:\DevTools\cache\npm`           |
| pnpm                      | `11.9.0`                  | store 位于 `F:\DevTools\cache\pnpm-store`  |
| Git                       | `2.50.1.windows.1`        | 系统已有                                   |
| rustup                    | `1.29.0`                  | `F:\DevTools\cargo` / `F:\DevTools\rustup` |
| rustc / cargo             | `1.97.1`                  | stable `x86_64-pc-windows-msvc`            |
| rustfmt / clippy          | `1.9.0-stable` / `0.1.97` | rustup component                           |
| Visual Studio Build Tools | 2026 `18.8.12009.203`     | `F:\DevTools\VisualStudio\BuildTools`      |
| MSVC                      | `19.51.36248` x64         | VC Tools `14.51.36231`                     |
| Windows SDK               | `10.0.26100`              | 由 Build Tools 管理                        |
| Edge WebView2 Runtime     | `150.0.4078.65`           | 系统已有                                   |

安装器保留在 `F:\DevTools\installers`。本次下载记录：

| 文件                | SHA-256                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `rustup-init.exe`   | `86478E53F769379D7F0EBFA7C9AA97CB76CA92233F79AA2CC0DBEE2EFAAC73C7` |
| `vs_buildtools.exe` | `2FC8D62937E67AD744AA5EC6125E9D936FC305EEE41175BBA0836792407A9014` |

Visual Studio Installer 引擎、VC++ 共享运行库等系统组件仍由 Windows 安装到系统位置；无法也不应强制把所有共享组件迁移到 F 盘。

## 3. 新终端的环境

安装过程已经写入当前用户环境变量：

```text
RUSTUP_HOME=F:\DevTools\rustup
CARGO_HOME=F:\DevTools\cargo
PNPM_HOME=F:\DevTools\pnpm
```

用户 `PATH` 已包含：

```text
F:\DevTools\cargo\bin
F:\DevTools\pnpm
F:\DevTools\pnpm\bin
```

新开的 PowerShell 应能直接执行：

```powershell
rustc --version
cargo --version
pnpm --version
pnpm config get store-dir --global
```

最后一条应返回 `F:\DevTools\cache\pnpm-store`。如果当前终端早于安装过程打开，可重新打开终端，或只在该终端临时设置上述变量。

## 4. 正式工程锁定依赖

| 层         | 依赖                        | 版本                |
| ---------- | --------------------------- | ------------------- |
| 桌面运行时 | `tauri` / `@tauri-apps/cli` | `2.11.5` / `2.11.4` |
| Tauri API  | `@tauri-apps/api`           | `2.11.1`            |
| UI         | `react` / `react-dom`       | `19.2.7`            |
| 构建       | `vite` / `typescript`       | `8.1.5` / `6.0.3`   |
| 测试       | `vitest`                    | `4.1.10`            |
| 质量       | `eslint` / `prettier`       | `10.7.0` / `3.9.5`  |
| SQLite     | `rusqlite` / bundled SQLite | `0.40.1` / `3.53.2` |
| PDF        | `pdfjs-dist`                | `6.1.200`           |
| 本地 OCR   | RapidOCR / ONNX Runtime     | `3.9.2` / `1.27.0`  |

TypeScript 使用 6.0.3，而不是实验中的 7.0.2，因为当前 `typescript-eslint 8.64.0` 明确支持 `<6.1.0`；正式锁文件不保留 peer dependency 警告。前端和 Rust 锁文件分别为根目录 `pnpm-lock.yaml` 与 `src-tauri/Cargo.lock`。

Rust 工具链由根目录 `rust-toolchain.toml` 固定为 `1.97.1`，同时声明 `rustfmt`、`clippy` 和 `x86_64-pc-windows-msvc` 目标。进入仓库后，rustup 会使用这一版本，而不是随开发者机器的默认 stable 漂移。

## 5. 正式工程常用命令

```powershell
cd F:\develop\KyStudy
pnpm install --frozen-lockfile
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --locked --manifest-path src-tauri\Cargo.toml
cargo clippy --all-targets --all-features --locked --manifest-path src-tauri\Cargo.toml -- -D warnings
pnpm tauri build --no-bundle
```

`--no-bundle` 当前只生成未签名的 Windows Release EXE，不生成安装包。品牌图标、许可证清单、升级策略和签名完成前，不发布正式安装包。

### 5.1 Windows CI

`.github/workflows/windows-ci.yml` 在固定的 `windows-2025` GitHub 托管 Runner 上重复执行上述质量门槛和 Release 构建。`scripts/test-release-smoke.ps1` 随后在隔离 AppData 下验证主窗口启动、进程稳定性和“启动不自动创建工作区”，并将 EXE 与 JSON 报告上传为短期 Artifact。详细边界与首次验收步骤见 [M1 Windows CI 文档](M1_WINDOWS_CI.md)。

## 6. TV-01 实验依赖

实验目录：`experiments/tv-01-tauri-shell/`。

锁定后的主要依赖：

| 层               | 依赖                  | 已解析版本          |
| ---------------- | --------------------- | ------------------- |
| 桌面运行时       | `tauri`               | `2.11.5`            |
| Tauri CLI        | `@tauri-apps/cli`     | `2.11.4`            |
| Tauri JS API     | `@tauri-apps/api`     | `2.11.1`            |
| 原生文件选择     | `tauri-plugin-dialog` | `2.7.1`             |
| WebView 运行时层 | `wry` / `tao`         | `0.55.1` / `0.35.3` |
| UI               | `react` / `react-dom` | `19.2.7`            |
| 构建             | `vite` / `typescript` | `7.3.6` / `5.8.3`   |
| 哈希与操作编号   | `sha2` / `uuid`       | `0.10.9` / `1.24.0` |

`pnpm-workspace.yaml` 只允许 `esbuild` 执行安装脚本，没有全局允许第三方包脚本。WiX 与 NSIS 使用 Tauri 的 `useLocalToolsDir` 配置，缓存到 `src-tauri/target/.tauri/`，仍位于 F 盘。

## 7. TV-01 常用命令

```powershell
cd F:\develop\KyStudy\experiments\tv-01-tauri-shell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo test --manifest-path src-tauri\Cargo.toml --locked
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets --locked -- -D warnings
pnpm tauri dev --no-watch
pnpm tauri build
```

Release 打包会生成未签名的实验产物。它们只用于技术验证，不应作为正式 KyStudy 安装包发布。

## 8. 项目本地 Agent Skills

以下 Skills 已安装到 `.agents/skills/`，用于后续代码审查和实现约束，不会进入 KyStudy 运行时：

- `rust-best-practices`：Rust API、错误处理、并发和测试实践；
- `react-best-practices`：React 性能与组件实现检查；
- `web-design-guidelines`：界面与可访问性审查。

没有安装来源弱、维护状态不清晰的 Tauri、SQLite 或通用可访问性 Skill。技术事实仍以官方文档、实际 Spike 和锁定依赖为准。

## 9. M10 可选 OCR 组件

正式应用已通过稳定 Port 接入 OCR，但 Python、RapidOCR 和 ONNX Runtime 不链接进 Tauri 主进程。开发构建按以下优先级检测打包组件：

1. `<app-data>/components/ocr/kystudy-ocr-worker`；
2. `experiments/tv-07-ocr/output/pyinstaller/dist/kystudy-ocr-worker`。

如果第二个目录不存在，可使用 F 盘现有 Python 环境重建：

```powershell
cd F:\develop\KyStudy\experiments\tv-07-ocr
$OcrPython = 'F:\develop\KyStudy-deps\ocr-py312\Scripts\python.exe'
& $OcrPython -m ruff check .
& $OcrPython -m unittest discover -s .\tests -v
.\build_sidecar.ps1 -PythonExecutable $OcrPython
```

模型随 `onedir` 组件提供，不在运行时下载。组件目录约 246 MiB，识别批次峰值内存约 729 MiB，因此仍是可选组件且不得常驻。当前尚未实现面向用户的组件下载、更新、移除和许可证页面；这不会阻止 PDF 阅读、文字层索引和手动题目管理。

仍暂缓引入 React Flow、本地嵌入模型、向量数据库和各 AI 提供商 SDK。它们只在实际里程碑需要时依据已接受 ADR 或新的技术验证锁定版本。

## 10. 磁盘占用提示

首次 Debug、测试和 Release 全量编译后，TV-01 的 `src-tauri/target` 约占 7.47 GB，其中包含大量可重建的 Rust 中间产物；WiX/NSIS 本地工具缓存约 123 MB。当前阶段保留这些缓存以加快后续验证，不把 `target/`、`node_modules/` 或安装产物视为项目源码。

如以后需要清理，必须先确认精确目标是该实验的可重建目录，并在项目维护者知情后执行。
