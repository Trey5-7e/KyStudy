# ADR-001：桌面运行时与前后端边界

| 项目        | 内容                          |
| ----------- | ----------------------------- |
| 状态        | accepted                      |
| 日期        | 2026-07-18                    |
| 决策者      | KyStudy 项目维护者            |
| 相关需求    | LOCAL-001～005、DATA-001～005 |
| 相关 Spike  | TV-01、TV-04                  |
| 替代/被替代 | 无                            |

## 上下文

KyStudy 需要作为本地桌面软件运行，管理 SQLite、PDF、图片、密钥、后台任务和备份，同时使用 Web 技术构建复杂界面。目标平台先以 Windows 为主，但不希望从架构上放弃 macOS 和 Linux。

桌面运行时会影响：

- 安装体积与内存；
- 文件和密钥安全边界；
- PDF.js、React Flow 等前端能力；
- SQLite、后台任务和 OCR 的集成方式；
- 发布、签名、自动更新和跨平台成本；
- 项目维护者需要掌握的语言和工具链。

当前机器已具备 Node、pnpm、Git、WebView2、Rust stable MSVC toolchain 和 Visual Studio C++ Build Tools。工具链版本、安装位置与构建结果记录在 TV-01 报告中。

## 决策驱动因素

1. 本地优先和最小文件权限；
2. PDF.js 与 React 生态兼容；
3. SQLite、流式文件 I/O 和安全密钥能力；
4. Windows 首发与未来跨平台；
5. 资源占用和安装体积；
6. 前后端边界可测试；
7. 开源许可证与长期维护；
8. 工具链学习和打包复杂度。

## 候选方案

### 方案 A：Tauri 2 + React/TypeScript + Rust 核心

前端使用系统 WebView，Rust 负责本地数据、文件、AI、预算和后台任务。

优点：

- 与 React、PDF.js 和节点编辑器兼容；
- Tauri 提供权限 Capability、文件系统和安全存储机制；
- Rust 适合实现可靠的文件、数据库和并发边界；
- 跨平台方向与本地软件目标一致；
- 不必随应用打包完整 Chromium 和 Node Runtime。

代价：

- 需要 Rust、MSVC 和 Tauri 工具链；
- WebView 在不同系统上的行为需要验证；
- React/Rust DTO 与异步任务边界增加工程复杂度；
- OCR 等重型依赖可能需要 sidecar 或额外本地部署方案。

### 方案 B：Electron + React/TypeScript

使用 Chromium 与 Node.js 运行完整桌面应用。

优点：

- TypeScript 技术栈统一；
- PDF 和 Node 生态成熟；
- 开发、调试和跨平台 UI 行为相对一致；
- 集成本地 JavaScript/Node 依赖直接。

代价：

- 安装体积和运行资源通常更高；
- 主进程、渲染进程、Preload 和 IPC 仍需要严格安全隔离；
- 本地文件与密钥能力如果边界设计不当，渲染层权限过大；
- 仍需要为原生 SQLite、OCR 和打包处理平台问题。

### 方案 C：Windows 原生 .NET 桌面应用

使用 WinUI、WPF 或其他 Windows 原生 UI 技术。

优点：

- Windows 集成和系统能力直接；
- .NET 工具链与本地数据生态成熟；
- 无需 Rust/WebView IPC 作为所有业务边界。

代价：

- 跨平台目标显著变弱；
- PDF.js、React Flow 和现有 Web 原型不能直接复用；
- 复杂导图和 Web 风格编辑器需要重新选型；
- 前期产品文档所基于的 React 方向需要较大调整。

## 当前推荐

推荐方案 A：**Tauri 2 + React/TypeScript + Rust 核心**。

运行时边界建议为：

- React/TypeScript：页面、PDF 显示层、思维导图画布和交互状态；
- Rust：用例、领域规则、SQLite、Blob、备份、密钥、AI 与后台任务；
- Tauri Command：稳定 DTO 边界；
- OCR：通过 Port 接入，部署方式后续单独决定。

该方案已经由 TV-01 与 TV-04 的自动验证和真实 Windows Release WebView 验收共同支持，现接受为正式工程基础。

## 理由与证据

- Tauri 官方提供 React/TypeScript 项目模板和手动接入方式；
- Tauri Windows 官方前置要求明确包含 MSVC C++ Build Tools、WebView2 与 Rust；
- Tauri Capability 和文件插件允许限制文件访问范围；
- KyStudy 的 PDF 和导图界面适合继续使用 Web 技术；
- 本地数据与 AI 密钥需要比普通网页更强的后端边界。

TV-01 已于 2026-07-18 得到“有条件通过”结论：

- React 能通过稳定 DTO 调用 Rust Command；
- 任意前端路径不能直接获得文件读取能力；
- Rust 侧原生文件选择与流式 SHA-256 在中文文件名下工作正常；
- Capability 没有 Shell、通用文件系统或 opener 权限；
- Debug、Release EXE、MSI 和 NSIS 均可生成；
- 项目维护者完成环境、错误、文件、进度取消、键盘与窗口布局人工验收。

TV-04 已于 2026-07-18 完成自动验证和真实 Release WebView 验收并得到 `passed` 结论：

- Tauri 2.11.5、React 19.2.7 与 PDF.js 6.1.200 production/release 构建成功；
- 25.58 MB、360 页样本通过本地 Worker 按范围加载，只传输 482,473 bytes；首页为 76.90 ms，216 次连续渲染均值为 5.39 ms；
- 216 次连续页面渲染后 JS Heap 可在销毁 LoadingTask 后回落；
- PDF 归一化区域在四种旋转、多缩放和 DPR 2 下的最大误差约 `2.22e-16`；
- Rust 自定义协议只接收 document ID 和严格单 Range，并通过 TV-03 Blob 打开接口读取；
- 截断 PDF、无文字层页、RenderTask 取消、路径穿越和无效 Range 均有自动样本；
- 第一次真实 WebView 测试发现并修复了 `convertFileSrc` 路由编码问题，项目维护者随后确认 `direct-id-v2` Release 能正常加载 PDF。

这些证据支持采用方案 A，并形成已接受的 [ADR-003](003-pdf-rendering.md)。

官方参考：

- [Tauri 创建项目](https://v2.tauri.app/start/create-project/)
- [Tauri Windows 前置要求](https://v2.tauri.app/start/prerequisites/)
- [Tauri 架构](https://v2.tauri.app/concept/architecture/)
- [Tauri 文件系统权限](https://v2.tauri.app/plugin/file-system/)
- [Tauri Stronghold](https://v2.tauri.app/plugin/stronghold/)

## 后果

### 正面

- UI 与本地核心职责清晰；
- 可以沿用 React、PDF.js 和 React Flow 技术方向；
- SQLite、Blob、AI 预算等规则能够在 Rust 中独立测试；
- 权限和文件访问可以集中控制；
- 保留未来跨平台能力。

### 代价与限制

- 项目维护者需要学习和维护 Rust；
- 每个跨边界功能需要设计 DTO 和错误码；
- WebView 差异必须通过真实平台测试；
- 不应让前端通过官方 SQL 插件直接执行任意 SQL；
- 本地 OCR 的部署可能成为安装体积和构建复杂度的主要来源。

### 后续行动

- TV-01 已有条件通过；保留干净 Windows 安装验证作为发布前任务；
- [x] 完成 TV-04 的 PDF.js、协议、坐标与无头 Edge 自动验证；
- [x] 测量大型 PDF 渲染、Range 和内存数量级并生成 Tauri Release EXE；
- [x] 完成 TV-04 Release WebView 人工验收；
- [x] 把 ADR-001 与 ADR-003 改为 `accepted`；
- 如果失败，优先重新评估 Electron，而不是在失败方案上继续堆补丁。

## 复审条件

出现以下情况时重新审视：

- Tauri 无法稳定加载和标记大型 PDF；
- WebView 权限或自定义协议无法满足本地文件安全要求；
- Rust 工具链显著阻碍项目维护；
- OCR、PDF 或 AI 所需依赖无法合理打包；
- 项目明确改为只支持 Windows；
- Tauri 或关键插件的维护、许可证或平台支持发生重大变化。
