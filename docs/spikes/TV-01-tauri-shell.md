# TV-01：Tauri 基础壳、Command 与权限

| 项目     | 内容                                     |
| -------- | ---------------------------------------- |
| 状态     | completed                                |
| 结论     | 有条件通过                               |
| 日期     | 2026-07-18                               |
| 负责人   | KyStudy 项目维护者                       |
| 关联 ADR | [ADR-001](../adr/001-desktop-runtime.md) |

## 要回答的问题

Tauri 2 能否在 KyStudy 的 Windows 目标环境中提供稳定的 React/Rust 调用、受限文件访问、开发构建和 Release 构建，并形成可维护的前后端边界？

## 不在范围内

- 不实现正式 KyStudy 页面；
- 不创建完整数据模型；
- 不接入 PDF.js、SQLite、OCR 和真实 AI；
- 不设计最终视觉系统；
- 不实现插件、自动更新、代码签名和安装器品牌；
- 不把实验代码直接视为正式工程。

## 当前环境

| 项目                  | 当前值                                                                  |
| --------------------- | ----------------------------------------------------------------------- |
| 操作系统              | Windows 11 专业版 `10.0.26100`（build `26100`）                         |
| Node.js               | `v22.18.0`                                                              |
| npm                   | `10.9.3`                                                                |
| pnpm                  | `11.9.0`                                                                |
| Git                   | `2.50.1.windows.1`                                                      |
| Rust / Cargo          | `rustc 1.97.1` / `cargo 1.97.1`，stable `x86_64-pc-windows-msvc`        |
| Rust 质量工具         | `rustfmt 1.9.0-stable` / `clippy 0.1.97`                                |
| MSVC C++ Build Tools  | Visual Studio Build Tools 2026 `18.8.12009.203`；MSVC `19.51.36248` x64 |
| Windows SDK           | `10.0.26100`                                                            |
| Edge WebView2 Runtime | `150.0.4078.65`                                                         |
| CPU / GPU / 内存      | AMD Ryzen 7 5800H；NVIDIA RTX 3060 Laptop GPU；15.9 GB                  |
| 工具与缓存位置        | Rust、Build Tools、npm/pnpm 缓存均位于 `F:\DevTools`                    |
| 构建模式              | Debug 与 Release 均验证                                                 |

## 前置动作

开始实验前需要单独确认并完成：

- [x] 安装或确认 Microsoft C++ Build Tools；
- [x] 安装 Rustup 与 stable MSVC toolchain；
- [x] 确认 WebView2 Runtime；
- [x] 确认 Node、pnpm 与 Git；
- [x] 记录完整版本并直接验证 `cl.exe`；
- [x] 确认实验目录和正式文档无覆盖风险。

项目维护者已于 2026-07-18 明确授权安装项目依赖。Rustup、Cargo、MSVC Build Tools、Windows SDK 及包管理器缓存均优先放在 F 盘；少量 Windows 共享运行库和 Visual Studio Installer 引擎仍由系统安装到 C 盘。

## 实验位置

建议在以下临时目录中创建：

```text
experiments/tv-01-tauri-shell/
```

它与未来正式 `src/`、`src-tauri/` 分离。实验结束后保留报告和必要的最小复现，是否保留完整代码由 ADR 结论决定。

## 候选初始化方式

### A. 官方 React + TypeScript 模板

优先验证官方 `create-tauri-app` 的 React/TypeScript/pnpm 组合，因为它最接近预期正式栈。

### B. 手动 Vite + Tauri Init

仅当官方模板无法满足现有仓库结构或产生不必要内容时验证。正式项目已包含 README 与 docs，不能在仓库根目录运行可能覆盖文档的脚手架。

## 最小实验功能

只实现一个诊断窗口：

1. 显示前端版本和 Tauri 可用状态；
2. 调用 `get_environment_status` Command；
3. Rust 返回带类型 DTO：应用版本、平台、应用数据目录是否可用；
4. 触发一个预期失败的 Command，验证稳定错误码；
5. 用户通过文件选择器选择一个公开测试文本文件；
6. Rust 只读取该授权文件的大小和哈希，不返回文件正文；
7. 尝试访问一个未授权路径，确认请求被权限边界拒绝；
8. 显示一次 Rust → 前端进度事件；
9. 完成 Debug 与 Release 构建。

## DTO 草案

该结构用于验证边界，不代表最终代码：

```text
EnvironmentStatus
  appVersion: string
  platform: string
  arch: string
  appDataReady: boolean
  operationId: string

AppError
  code: string
  message: string
  action?: string
  operationId: string
```

不返回绝对应用数据路径给普通页面。实验日志可以在本机诊断视图中受控显示。

## 通过标准

### 工具链与构建

- [x] `pnpm tauri dev` 能启动桌面窗口；
- [x] `pnpm tauri build` 能生成 Windows Release 产物；
- [ ] 干净测试环境可以启动 Release 产物；
- [x] 记录 Rust、Node、pnpm、Tauri、WebView2 和 MSVC 版本；
- [x] 记录 Debug/Release 首次构建时间和增量构建时间。

### Command 边界

- [x] React 能调用一个带类型 Rust Command；
- [x] Rust 内部错误转换为稳定 `AppError`；
- [x] UI 不接收 Rust Debug 字符串；
- [x] 事件监听在页面卸载后正确清理；
- [x] Command 输入进行长度与类型校验。

### 文件权限

- [x] 选择器授权文件可以读取元数据并计算哈希；
- [x] 未授权路径不能由前端直接读取；
- [x] Capability 中没有通用磁盘读写和 Shell 权限；
- [x] 日志不记录测试文件正文；
- [x] 路径穿越输入被拒绝。

### 安全与诊断

- [x] CSP 不使用无理由的全局放开配置；
- [x] 前端不能执行任意 Rust 命令；
- [x] 每次操作具有 `operation_id`；
- [x] 失败可以在 UI 中显示恢复建议；
- [x] Release 构建不启用开发工具和调试权限。

## 测量指标

| 场景                       | 指标         | 结果                                    |
| -------------------------- | ------------ | --------------------------------------- |
| Debug 首次依赖检查         | 秒           | 超过 120 秒外层上限；缓存保留后继续成功 |
| Debug 增量检查             | 秒           | `cargo check --locked` 3.45 秒          |
| Debug 增量启动             | 秒           | 约 22 秒到窗口进程创建                  |
| Release 首次构建与双安装包 | 秒           | 204.9 秒                                |
| Release 增量构建与双安装包 | 秒           | 73.4 秒（源文件发生测试变更后）         |
| Release 可执行文件         | MB           | 8.86 MB                                 |
| MSI / NSIS                 | MB           | 2.95 MB / 1.92 MB                       |
| 冷启动到可交互             | 毫秒         | 待测                                    |
| 空闲内存                   | MB           | 待测                                    |
| 100 MB 文件哈希            | 秒、峰值内存 | 待测                                    |

测量值用于比较与发现异常，不在本实验中设定脱离设备环境的绝对性能承诺。

## 人工交互验收

项目维护者于 2026-07-18 使用最新 Release EXE 完成人工验收，以下 9 项全部通过：

1. Release 窗口启动、标题、WebView2 页面与 Tauri 连接状态；
2. `get_environment_status` 返回 Windows/x86_64、可用的数据目录和 UUID 操作编号；
3. 原生文件选择器读取 `fixtures/tv-01/公开 测试.txt`；
4. 文件选择取消返回 `FILE_SELECTION_CANCELLED` 和恢复建议；
5. 前端传入绝对路径与路径穿越输入均返回 `PERMISSION_PATH_NOT_GRANTED`；
6. 受控失败返回 `TV01_EXPECTED_FAILURE`，UI 不显示 Rust Debug 字符串；
7. 进度任务能够正常到达 100% 并恢复按钮状态；
8. 进度任务能够在完成前取消，状态和按钮正确恢复；
9. Tab/Enter 键盘操作、焦点可见性、最大化与窗口布局表现正常。

文件样本实测结果：163 bytes，SHA-256 为 `DDFDF31CDC61F98045FC6A8ABEB682C71503D57723248D7B490709D72B065027`。UI 只显示文件名、大小和哈希，不返回绝对路径或正文。

## 已执行记录

隔离实验由官方 `create-tauri-app 4.6.2` 的 React + TypeScript + pnpm + Tauri 2 模板生成。正式 README 与 `docs/` 未被脚手架覆盖。

已通过：

- `pnpm install --frozen-lockfile`；
- `pnpm typecheck` 与 `pnpm build`；
- `cargo fmt --check`；
- `cargo test --locked`：4 个测试通过，覆盖稳定错误、超长输入、路径穿越拒绝、中文文件名和 SHA-256；
- `cargo clippy --all-targets --all-features --locked -- -D warnings`；
- `pnpm tauri dev --no-watch`：Debug 窗口创建且保持响应；
- `pnpm tauri build`：Release EXE、MSI 与 NSIS 均生成；
- 直接启动 Release EXE：窗口标题正确且进程保持响应。

Release 产物记录：

| 产物                                    |    大小 | SHA-256                                                            |
| --------------------------------------- | ------: | ------------------------------------------------------------------ |
| `tv-01-tauri-shell.exe`                 | 8.86 MB | `F844F0F5FA4D670D04C2B3B1B512745E7CA4054B24D9B198F09EF0CEB96DA285` |
| `tv-01-tauri-shell_0.1.0_x64_en-US.msi` | 2.95 MB | `811A43FF9C41843FDE481AB3378DC2CC5446DC3ED2C4FB0A168DB997576BB7AD` |
| `tv-01-tauri-shell_0.1.0_x64-setup.exe` | 1.93 MB | `54079CD35AD7AF6BCDD5E2EFB5A997831503AB2CFB96AE355DA5F8CA0D65CB22` |

当前主要依赖锁定为 Tauri `2.11.5`、Tauri CLI `2.11.4`、React `19.2.7`、Vite `7.3.6` 和 `tauri-plugin-dialog 2.7.1`。Capability 只声明 `core:default`，没有 Shell、通用文件系统或 opener 权限；文件路径由 Rust 侧原生选择器在单次操作内消费，不返回给前端。

## 实验步骤

1. 安装并记录 Windows Tauri 前置工具链；
2. 在隔离实验目录创建官方 React/TypeScript/pnpm 模板；
3. 锁定依赖并记录生成结构；
4. 建立最小 Capability 与 CSP；
5. 实现诊断 Command、稳定错误和前端调用；
6. 增加文件选择、授权读取和未授权访问测试；
7. 增加一个可取消进度事件；
8. 执行格式、Lint、TypeScript 与 Rust 检查；
9. 执行 Debug、Release 和干净环境 Smoke Test；
10. 填写数据、失败样本与结论；
11. 更新 ADR-001 状态或记录替代方案。

## 失败与降级场景

必须主动验证：

- Rust Command 返回受控业务错误；
- 文件在选择后被移动或删除；
- 读取权限被操作系统拒绝；
- 文件名包含中文、空格和较长路径；
- 前端组件在任务运行中卸载；
- 应用数据目录不可写；
- Release 模式与 Debug 模式权限不一致；
- WebView2 缺失或版本异常时的用户提示。

## 结论

`有条件通过`。Tauri 2 的 Windows 工具链、React/Rust 编译边界、最小 Capability、受控错误、流式文件哈希、Debug 启动、Release 双安装包和本机人工交互矩阵均已成立。TV-01 对当前主要问题已经给出正面答案，可以进入 TV-02。

保留条件是：尚未在第二台干净 Windows 环境验证 MSI/NSIS 安装，也未完成文件被移动、应用数据目录不可写、WebView2 缺失以及 100 MB 文件哈希性能测试。这些条件进入发布验证与后续文件 Spike，不阻塞 M1-A 的下一项技术实验。

## 建议决策

当前建议继续验证 Tauri 2；只有 TV-01 的构建、权限与边界通过，并且 TV-04 的大型 PDF 行为可接受后，才把 ADR-001 改为 `accepted`。

## 后续行动

- [x] 获得系统工具链安装授权；
- [x] 安装并记录 Rust/MSVC；
- [x] 创建隔离实验；
- [x] 完成本报告的本机实测部分；
- [x] 把 TV-01 证据同步到 ADR-001。

## 参考资料

- [Tauri Windows 前置要求](https://v2.tauri.app/start/prerequisites/)
- [Tauri 创建项目](https://v2.tauri.app/start/create-project/)
- [Tauri 架构](https://v2.tauri.app/concept/architecture/)
- [Tauri 文件系统插件](https://v2.tauri.app/plugin/file-system/)
- [Tauri Capability 配置](https://v2.tauri.app/learn/security/using-plugin-permissions/)
