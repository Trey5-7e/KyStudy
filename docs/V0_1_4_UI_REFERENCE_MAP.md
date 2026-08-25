# KyStudy 1.4 AI UI 开源参考与闭环记录

> 本文是 `CODEX_IN_APP_BROWSER_UI_WORKFLOW.md` 要求的 UI 设计约束、开源项目映射和浏览器验收记录。实现前先固定参考来源与边界，避免凭感觉手写一套不可复用的聊天界面。

## 1. 参考项目与采用边界

| 项目                                                         | 许可证/定位                                       | 本项目采用                                                                                                                | 本项目不采用                                             |
| ------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [LibreChat](https://github.com/danny-avila/LibreChat)        | MIT；成熟的多模型聊天工作区                       | 左侧会话历史、顶部模型上下文、消息操作、附件与模型切换的信息层级                                                          | 不迁移整站、服务端、Provider 管理代码                    |
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | MIT；可嵌入的 React/TypeScript AI Chat primitives | `ThreadPrimitive`、`MessagePrimitive`、`ComposerPrimitive`、外部状态 runtime；负责滚动、键盘提交、发送/取消状态和可访问性 | 不接管 KyStudy 的 Tauri 命令、确认外发流程或本地数据模型 |
| [Open WebUI](https://github.com/open-webui/open-webui)       | 开源 AI 工作区；当前版本存在品牌条款              | 只参考资源选择、模型工作区和设置页的信息架构                                                                              | 不复制当前版本代码或品牌；不作为白标基座                 |
| [Lobe UI](https://github.com/lobehub/lobe-ui)                | MIT；AIGC React UI 组件库                         | 作为后续设置页/Provider 卡片的候选参考                                                                                    | 1.4 不引入其较重的 antd/motion 依赖                      |

### 1.1 依赖决策

1. 1.4 对话页实际引入 `@assistant-ui/react`（MIT），而不是只复制截图或手写行为。
2. 当前 Provider/API 管理继续遵守 `V0_1_4_API_GATEWAY_SPIKE.md`：在选定成熟 API Gateway 前，不增加新的供应商直连代码。
3. LibreChat/Open WebUI/Lobe UI 只用于交互与信息架构对照；KyStudy 的确认外发、资源绑定、PDF/OCR 能力和 Windows/Tauri 权限仍由现有业务层控制。

## 2. UI 设计约束（先于 JSX/CSS）

- **目标与主操作**：让用户在一个本地对话工作区完成“选择会话 → 绑定资料 → 输入问题 → 预览并确认外发”，主操作是生成外发预览，不是隐式发送。
- **视觉层级**：页面标题/当前模型摘要 → 会话历史 → 消息线程 → 资料/附件上下文 → composer；重要状态使用统一 status/banner，而不是散落在按钮旁。
- **必须覆盖的状态**：初始化 loading、无会话 empty、正常长对话、长标题/长消息、资料为空、资料已绑定、预览确认、取消/失败/禁用。
- **视口**：桌面 1440×900、1280×800、1024×768；窄屏 640；移动 360。窄屏允许会话栏折叠为横向滚动区，线程和 composer 不产生第二个页面级滚动条。
- **交互边界**：会话选择/创建/重命名/删除；Enter 提交、Shift+Enter 换行；资料菜单打开/关闭与外部点击；预览对话框确认、取消、Esc 关闭；消息复制、重试、引用页跳转；生成中可取消。
- **真实 Tauri 与浏览器预览**：浏览器只读 fixture 提供 AI 概览、会话、附件和资源列表；创建/删除/重命名/绑定、PDF/OCR、预览执行等写操作必须返回 `BROWSER_PREVIEW_UNSUPPORTED`，不得伪造成功。

## 3. 组件映射

| 交互               | assistant-ui 能力                                       | KyStudy 业务适配                                                        |
| ------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| 消息列表与自动滚动 | `ThreadPrimitive.Root/Viewport/Messages`                | 仍以 `PlanningConversation.messages` 为唯一数据源                       |
| 消息内容与操作     | `MessagePrimitive.Root/Content` + 现有 MarkdownRenderer | 保留来源引用、复制、重试和打开 PDF 页码                                 |
| 输入与键盘行为     | `ComposerPrimitive.Root/Input/Send/Cancel`              | Send 只触发 `preview_*`；确认后才调用 execute；附件菜单仍走资源绑定命令 |
| 外部持久化状态     | `useExternalStoreRuntime`                               | 不迁移 SQLite/Tauri；runtime 仅作为 UI 状态桥                           |
| API/模型设置       | 现有 KyStudy 页面结构                                   | 1.4 只优化信息架构，Provider 管理等待 Gateway 选型                      |

## 4. 浏览器闭环证据

每次 UI 批次至少记录：

1. 改动前桌面基线截图/DOM 快照；
2. 改动后 1440×900、1024×768、640、360 的截图/DOM 快照；
3. 正常、空状态、长文本、loading、error/unsupported 和预览确认状态；
4. 关键交互的可见结果与控制台错误；
5. `pnpm check`、Rust gate、CSS audit 和 `pnpm tauri build --no-bundle` 结果。

本文件只记录本次 UI 批次的结果，不改写历史验收结论。

## 5. 2026-08-18 本批次闭环结果

### 5.1 浏览器证据

- **基线**：浏览器预览原界面在长标题下出现会话栏内容侵入线程、对话输入区层级不清；同时 AI 概览命令没有预览 fixture，页面只能落到“AI 基础设施暂时不可用”。
- **修复后**：浏览器预览提供只读 AI fixture；assistant-ui runtime 已渲染消息线程、空会话、输入 composer、滚动到底部、资料菜单和预览确认对话框。写操作仍显示/返回 unsupported，不伪造成功。
- **交互**：已在浏览器中验证会话切换、空会话状态、资料菜单展开、Enter 生成预览、确认框关闭/勾选前禁用发送。

### 5.2 视口检查

| 视口     | 结果                                                   |
| -------- | ------------------------------------------------------ |
| 1440×900 | 通过；会话栏与线程分栏，消息线程独立滚动               |
| 1024×768 | 通过；长标题断行，线程/composer 保持在工作区内         |
| 640×900  | 通过；会话栏切换为上下布局，双列历史不产生页面横向溢出 |
| 360×800  | 通过；主内容宽度收缩，线程/composer 无横向溢出         |

浏览器目标地址：`http://127.0.0.1:1420/#ai-chat`。浏览器只读 fixture 不代表桌面 Tauri/真实 Provider 已验收；桌面验收仍由用户执行。

## 6. 2026-08-18 资料入口精简批次

- 资料入口只保留两个动作：`导入软件本地资料` 和 `上传电脑资料`。
- 资料窗口继续复用 assistant-ui Composer 左侧附件入口；窗口内不再展示资料上下文搜索、页码筛选、说明段落或统计 footer。
- 软件本地资料沿用既有 `list_resources`/资源绑定命令；电脑资料沿用既有 `start_resource_import` 导入事件，成功后自动绑定当前对话。
- 浏览器闭环验证：窗口包含两个操作卡片，搜索/上下文文案不存在，1280×720 下窗口宽 544px、高 399px，页面无横向溢出。

## 7. 图标来源约定

- AI 头像使用 `@lobehub/icons` 的官方 LobeHub React 图标；通用关闭、添加、资料库和上传图标使用 Google Fonts Material Symbols Rounded 字体。
- 会话卡片右下角的更多操作使用 Google Fonts Material Symbols Rounded 的 `more_vert` 字形；菜单保留可访问名称，并复用资料列表的浮层定位与外部点击关闭模式。
- 图标按钮保持可访问名称，图形通过 grid/flex 居中；禁止手绘品牌 SVG 或使用未记录来源的图标资源。
