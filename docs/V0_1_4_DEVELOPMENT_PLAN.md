# KyStudy v0.1.4 开发方案

> 状态：开发基线草案（2026-08-18）  
> 版本约定：仓库使用 `v0.1.4`，产品界面可显示为“1.4”

### 当前实施进度

- M1 已完成：`ai-chat` 与 `ai-settings` 已接入主导航、路由和懒加载页面；
- AI 页面已复用现有规划对话能力，并补充模型状态栏、资料引用跳转和页面化布局；
- 模型/API 页面已提供页面内 Provider 卡片入口和题库/PDF 分析能力说明；
- M1 的前端完整门禁、Rust 测试、Clippy 和无捆绑 Tauri 构建已通过；
- M2 已完成第一段：`ai_conversation.conversation_kind`、通用 `chat` 类型、`general_chat` 调用目的、规划会话隔离查询和前后端 `kind` DTO 已落地；
- M2 迁移已覆盖旧工作区数据保留、外键完整性和通用调用写入测试；
- 本轮门禁结果：前端 75 个测试文件 / 488 个测试通过，Rust 332 个测试通过，Clippy、格式检查和无捆绑 Tauri 构建通过；
- M3 已完成基础契约段：v28 增加对话模型覆盖、模型能力默认状态和附件引用表；前端已加入能力/附件安全解析器，规划对话继续兼容旧记录；
- AI 对话启动已增加 AI 配置就绪门控：先完成本地 AI 初始化，再读取对话列表；初始化失败时提供显式重试，避免并发启动造成通用错误提示；规划对话同时兼容旧记录返回的 `modelProfileId: null`；
- M3 第一段已完成：v28 附件引用表、Rust 仓储、Tauri 命令和对话页“＋添加本地资料”选择器已经接通；每个对话最多绑定 6 份、单份不超过 100 MiB，绑定会校验资料未删除且 Blob 完整性为 `ok`，重复绑定同一资料保持幂等；当前仅保存本地引用，不会把原文件自动外发；
- M3 第二段已完成本地索引预检：请求携带 `attachmentIds`，预览输出 `local_text` 传输模式、索引页数和阻断原因；只有可用本地文本会进入提示词，未索引资料在预览与确认执行两侧均被阻断。
- M3 能力校准段已完成：Provider 配置页可分别保存图片、文件和 PDF 的“支持 / 不支持 / 未知”状态，Rust 后端统一写回 `manual` 能力来源；附件传输决策可据此稳定降级到本地文本索引。
- M3 上传反馈段已完成：对话资料窗口复用现有本地资源导入事件流，展示导入百分比、取消、失败原因和重新选择；已绑定资料显示就绪、处理中、过期和失败状态，切换或删除对话时会取消未完成的导入任务。
- M3 对话索引闭环已补齐：从资料库选择或上传电脑 PDF 资料时，会先复用现有 PDF 文字索引器完成索引，再绑定到当前对话；索引取消或失败时不会留下不可发送的附件引用。
- M5 OCR 回退首段已完成：通用 PDF 文字索引与 AI 附件索引会在文字层稀疏时按需调用本地 OCR，OCR 组件缺失或单页失败时保留文字层降级，取消操作不会写入半成品页索引。
- M5 OCR 优化段进行中：按 4.2 建立可替换 `OcrBackend` 边界，RapidOCR Worker 已加入方向纠正、低分辨率放大、暗底反相、对比度/锐化预处理、结果排序和低置信度索引治理；PDF OCR 渲染长边已从 1800 提升到 3000；PaddleOCR 的 PP-DocLayout-S + PP-FormulaNet-S 已完成独立 CPU 对比，公式结构有明显增益但暂不作为默认桌面依赖。
- M5 分析诊断段已完成第一步：每个做题本分段结果记录 profile ID、OCR 页数、待复核警告、未识别题号页数和跨页题数；导入确认界面以诊断卡片展示这些指标，便于两本目标做题本的人工核对。
- M5 固定基线段已完成：导入确认界面可导出 schema v1 的 JSON 基线，包含源文件 SHA-256、页数、profile、科目/题型/题目统计、OCR 页面、警告、未识别题号和跨页题目；报告不包含题目正文、本地路径或密钥。
- M5 900 题本分层规则已补齐：`A 类`、`B 类`、`C 类` 分别映射为基础、综合、拓展篇章，避免题目落入“其他”篇章。
- M4/M5 交界的原生文件传输首段已完成：临时附件在 Rust 网关侧再次校验大小与 SHA-256；仅显式校准为支持文件/PDF 的 OpenAI Responses Provider 使用纯 Base64 `input_file` 传输，原生请求单文件上限为 24 MiB，其他协议在本地预览阶段解释性阻断；预览指纹和 Token 预算包含文件元数据。
- M4 深度体验优化段已完成：原生 SSE 流式传输（`execute_ai_chat_stream`）、打字机渲染、思考链（CoT）推理隔离、彻底去除人为 Token 输出上限约束（自然输出）、剪贴板图片粘贴（`Ctrl + V`）、拖拽/上传、输入框内图片缩略条预览与多模态图文混排发送已全链路接通；
- M4/M5/M6 整合与收口已完成：模型与 Provider 错误映射、预算警告/阻断机制、过期预览与会话隔离均已完成自动化测试覆盖；两本目标做题本已建立稳定 Profile、诊断与基线报告导出；发布说明与文档导航已同步更新。
- M5 1000 题与 900 线代概率适配段已完成：新增 660 线概、900 线代概率、1000 题高数/线概四个 profile；解析器增加子章节上下文（`强化部分 - 子专题`）、`基础/强化篇第N章` 前缀章节、`测试卷N` 子章节、书签主题叶节点章节回退；题号 `0` 全风格拒绝，并加入同上下文题号递增序列检查以剔除换行碎片幻影；题号风格判定改为只采信左侧内容边界证据。八册真实样本审计全部达到 0 组内重复、0 号幻影和 0 未解释问题，880 高数保持 658 题基线不变。
- M5 660 线概深修段已完成：定位三处历史性整页漏检根因并修复——重复水印判定不再吞并跨页同位置的短中文题干起始词；题号风格证据优先级改为 decimal > parenthesized > plain 并逐页持久化，同时新增 `plainBeforeParenthesized` profile 开关（660 线概启用），使答题区 `(1)` 空格标签不再压制真实题号；同线数字簇（答题区编号行）不再判为题目。660 线概识别数从 189 提升到 278（全局连续题号 362–660 覆盖约 93%），章节全部按主题正确命名，八册审计保持 0 重复、0 幻影，880 高数 658 基线不变。
- 分段回收站删除能力已补齐：新增 `delete_workbook_segment` 与 `delete_all_trashed_workbook_segments` 命令，回收站界面提供“彻底删除”与“一键清空”（均带确认与过期前置校验），题目随外键级联清理区域、作答、复习与 AI 分析记录；用于安全重建错误导入的数据。
- 做题本 PDF 适配桌面验收已通过：用户在 Release EXE 中确认六册目标做题本章节、题号与数量识别符合预期（含 660 线概章节修复后的重建导入）。
- 完整门禁状态：前端 `pnpm check`（83 文件 / 570 测试）、CSS 审计、`cargo fmt`、`cargo clippy`（0 warnings）、`cargo test`（357 测试）以及 `pnpm tauri build --no-bundle` 无捆绑 Release 构建均一次性通过，进入桌面用户验收阶段。

### M3 第二段（本轮已完成）

- 附件状态恢复段已完成：资源附件处于 `expired` 或 `failed` 时，可通过重试命令重新校验资料与 Blob 完整性并恢复为 `ready`；临时附件不走该恢复路径。
- 附件状态诊断已补齐：读取对话附件列表时会重新校验资源是否被删除以及 Blob 完整性；失效资源显示为 `failed` 并带有稳定错误码，恢复资料后仍需用户显式重试。

- Provider 能力字段已经从 v28 数据库读取并安全映射到 AI Overview，旧工作区缺省为 `unknown`，更新 Provider 时保留能力状态。
- Provider 配置页已增加折叠式“资料能力”校准区，支持图片、文件和 PDF 三项独立选择；保存时通过 `save_ai_provider_capabilities` 写回模型能力并标记来源为 `manual`。
- “上传电脑资料”复用资源库的 `start_resource_import` 与导入事件，不新增第二套文件复制逻辑；资料窗口提供进度条、取消、失败提示和重新选择入口。
- 对话资料 chip 补充附件状态标签；切换、新建或删除对话会使旧导入请求失效，避免导入完成后错误绑定到新对话。
- 规划对话请求新增 `attachmentIds`；预览会按绑定资料生成 `local_text` 传输计划，展示文件名、索引页数、降级说明和阻断原因。
- 仅当资源存在可用本地文本索引时才会把有限文本加入提示词；原始文件路径、Blob 内容和 API Key 不进入 WebView 或外发请求。未索引资料会使预览 `allowed=false`，确认执行再次阻断。
- 临时附件生命周期已落地第一段：Rust 原生文件选择器只接收工作区外的本地文件，流式计算 SHA-256 后复制到受控临时目录；数据库只保存元数据和状态，复制失败会回收目录，删除对话或附件会同步清理文件。
- 临时附件重启边界已补齐：应用启动时会将未完成或仍处于可用状态的临时附件统一标记为 `expired`，同时清理临时正文并保留对话历史和资源库附件不变；前端暂不增加第三个入口，现有“上传电脑资料”仍走资料库导入。
- 原生临时附件命令和客户端契约已接入真实发送边界：文件路径只在 Rust 内部流转，Responses Provider 生成带文件名的纯 Base64 `input_file` 数据，发现文件丢失、篡改或超过 24 MiB 时不会外发；能力自动探测暂不伪装为已测试，仍由用户明确校准。

### M4 第一段（本轮已完成）

- 通用 `chat` 会话已经使用独立的 SQLite 仓储实例和 Tauri 命令，不再读取或写入 `planning` 历史；AI 调用目的写入 `general_chat`。
- AI 学习助手页面已切换到通用 `chat` 链路；普通对话直接发送并保存回复，不显示外发确认或 Token 预览；规划对话继续保留预览、明确确认、重试、协作式取消和附件索引阻断。
- 对话输入支持 Enter 发送、Shift+Enter 换行；消息支持 Markdown 与纯文本复制；输入框左下角增加“＋资料”入口，展开后可绑定已导入资料。
- SenseNova 直连适配验收未通过：本地 Provider Router 不再扩展更多供应商协议；现有实现仅保留为不可见 Spike，不纳入 1.4 交付验收。API 管理层改为参考并逐步移植成熟的 CC-Switch 供应商配置与模型映射能力，不在本项目内重新发明一套供应商协议。

## 1. 文档结论

本方案参考：

- [v0.1.2 开发方案](V0_1_2_DEVELOPMENT_PLAN.md)：沿用 P0/P1/P2 分级、技术方案、实施批次、自动化测试、人工验收和发布门禁结构；
- [v0.1.3 开发方案](V0_1_3_DEVELOPMENT_PLAN.md)：承接已延期的独立 AI 对话、Provider 管理、AI 内容渲染和 PDF 相关基础设施。

v0.1.4 聚焦两个主线：

1. 完成真正可用的 AI 对话工作区，并重构模型/API 设置界面；
2. 继续适配用户后续提供的做题本 PDF，提升 PDF 扫描、文字提取、OCR 和题目切分的稳定性。

本版本只适配“做题本 PDF”，不适配整本教材、教师用书或包含答案解析的完整习题册。

本版必须达到以下结果：

1. 主导航提供独立的“AI 学习助手”页面；
2. AI 页面具备历史对话、模型切换、资料导入、普通对话直接发送、规划对话确认、重试、复制和协作式取消；
3. “模型与 API”从弹窗升级为独立工作区，支持 Provider 卡片和多模型管理；
4. API Key 始终由 Rust 后端和 Windows 凭据存储管理；
5. 做题本 PDF 采用文字层优先、稀疏页面按需 OCR 的导入链路；
6. 每一本用户提供的 PDF 都有可复现的样本基线、回归 fixture 和人工验收清单；
7. 任何解析失败、OCR 缺失或取消操作都不得写入半成品题目。

## 2. 范围与非目标

### 2.1 P0：v0.1.4 必须完成

| 能力        | 交付边界                                                                           |
| ----------- | ---------------------------------------------------------------------------------- |
| AI 独立入口 | `ai-chat` 作为主导航页面，支持新建、切换、重命名、删除和恢复对话                   |
| 对话工作区  | 历史栏、消息线程、模型选择、空状态、错误状态和响应式布局                           |
| 资料导入    | `＋` 菜单只保留从资料库选择、上传电脑资料两个动作                                  |
| 附件粒度    | 只支持整个文件，不提供页码选择器；附件可移除、重试和显示过期状态                   |
| 安全发送    | 规划对话经过本地预览和明确确认后发送；普通对话直接发送，仍由后端执行预算与附件校验 |
| AI 响应     | 完整响应、Markdown/LaTeX 渲染、复制、重试和失败恢复；不伪装成流式输出              |
| 协作式取消  | 取消后不追加消息、不保存成功结果；不要求强制中断底层 HTTP                          |
| API 工作区  | Provider 卡片、启停、编辑、连接测试、模型发现、默认模型和能力状态                  |
| 多模型      | 同一 Provider 可保存多个模型，单个对话可覆盖工作区默认模型                         |
| API 安全    | API Key 不进入 WebView、localStorage、日志、对话正文或错误文本                     |
| PDF 适配    | 以用户提供的做题本 PDF 建立 profile，完成文字层、OCR、题号和章节规则适配           |
| PDF 可靠性  | 取消、OCR 不可用、页码异常、缺图和分析失败均可安全降级或重试                       |
| 验收证据    | 固定样本基线、回归 fixture、人工验收矩阵和版本门禁记录完整                         |

### 2.2 P1：资源允许时完成

- AI 对话窄窗口布局和可折叠历史栏；
- 附件上传进度、失败重试和过期提示；
- Provider 能力诊断和请求传输方式说明；
- PDF 分析诊断面板，可查看 OCR 页数、未识别题号、跨页题数和警告列表；
- 固定样本基线报告导出；
- 对话中显示资料来源和本地索引页引用。

P1 未完成时必须在发布说明中逐项记录，不得使用“后续优化”等模糊描述隐藏延期项。

### 2.3 P2：后续版本评估

- 流式响应和真正的 HTTP Abort；
- 工具调用、联网搜索、语音输入和语音输出；
- 页面级附件选择、区域裁剪和多文件批量处理；
- 整本教材、答案册、教师用书和答案解析 PDF；
- 云端同步、多人协作和账号体系；
- 复杂 Agent 工作流和自动修改正式题库；
- 在线 PDF 解析服务。

### 2.4 明确不做

- 不把 LibreChat、Open WebUI 等完整桌面应用直接嵌入项目；
- 不让前端直接请求 OpenAI、DeepSeek、智谱、通义或其他 Provider；
- 不把 AI 回复自动写成标准答案；
- 不让 AI 对话自动修改题库、错题状态或复习算法；
- 不将用户提供的完整版权 PDF 直接提交到仓库；
- 不在 v0.1.4 强制引入流式协议、工具调用、语音能力或联网搜索；
- 不在没有用户确认的情况下覆盖已有资料或数据库；
- 不在实现过程中启动 Release EXE，也不代替用户声明桌面验收通过。

## 3. 当前实现与缺口

### 3.1 已有基础

- `PlanningChatPanel` 已具备对话列表、消息线程、上下文搜索、题目上下文、预览、执行、重试和复制 Markdown；
- `ai_conversation`、`ai_message`、`ai_call`、`ai_context_ref` 已提供对话和调用持久化基础；
- `ProviderRouter` 已支持 Offline、OpenAI Responses、豆包 Responses、智谱、千问和 DeepSeek 等既有协议；供应商扩展暂不继续在项目内自研。
- API Key 已通过 Rust 凭据层处理，前端不直接保存密钥；
- `resourceClient` 已支持 PDF/图片 Blob 导入、资源列表和受控阅读描述；
- `pdfQuestionIndexer` 已支持文字层、题号识别、章节/题型推断、跨页区域和稀疏页面 OCR；
- `QuestionBankImportDialog` 已具备分析、预览、确认保存、取消和错误提示流程；
- Markdown/LaTeX 统一渲染基础已在 v0.1.3 建立。

### 3.2 直接缺口

1. `AppView` 当前没有 `ai-chat` 或独立的模型/API 工作区，已有 `AiChatPanel` 尚未接入主导航；
2. 规划对话与通用对话尚未通过对话类型隔离；
3. Provider 当前更接近单一激活配置，模型配置不适合截图所示的多 Provider、多模型工作区；
4. `PlanningChatRequest` 主要支持页级文本上下文和题目图片，不支持整文件附件和 Provider 能力协商；
5. 当前 AI 网关以完整响应为主，前端取消只丢弃 UI 结果，缺少后端协作式取消和临时文件清理契约；
6. 当前 PDF 分析规则仍以通用题号启发式为主，需要根据用户提供的每本做题本建立 profile 和基线；
7. 当前 OCR 组件、PDF 阅读器和题目索引之间缺少统一的能力诊断和传输说明。

## 4. 开源项目参考与选型结论

### 4.1 AI 对话 UI

[assistant-ui](https://github.com/assistant-ui/assistant-ui) 提供 Thread、Composer、ThreadList、附件、重试、复制和可访问性等 React 对话 primitives。v0.1.4 优先参考或复用其 MIT 许可下的 UI 结构，但不使用其前端 Runtime 直接连接 Provider。

[LibreChat](https://github.com/danny-avila/LibreChat) 作为多 Provider、模型切换、文件附件和历史对话的交互参考；不直接迁移完整应用。

[Open WebUI](https://github.com/open-webui/open-webui) 只作为功能和信息架构参考；其[当前许可证](https://github.com/open-webui/open-webui/blob/main/LICENSE)和品牌要求需要在依赖审计中单独记录，不直接复制代码。

[Vercel AI SDK](https://github.com/vercel/ai) 可参考 Provider 抽象、消息格式和能力协商，但不在 WebView 中直接使用，以保持当前 Rust 网关和 API Key 安全边界。

若 UI 依赖引入造成 Vite、Tauri 或包体问题，则按相同交互契约在项目内部实现，界面和外部接口保持不变。

### 4.2 OCR 与 PDF

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)：Apache-2.0，重点评估 OCR、版面分析、表格、公式和结构化输出；
- [Docling](https://github.com/docling-project/docling)：MIT，重点评估 PDF 阅读顺序、版面、表格、公式和 OCR 融合；
- [MinerU](https://github.com/opendatalab/MinerU)：作为离线批处理效果对比对象，使用前必须审计其额外开源许可条款；
- [MuPDF](https://github.com/ArtifexSoftware/mupdf)：AGPL/商业许可，不作为 v1.4 默认生产依赖，除非另行完成商业许可决策。

v0.1.4 不直接替换现有 OCR worker。先新增统一适配器和 Spike，对 PaddleOCR、Docling、现有 RapidOCR worker 做准确率、内存、启动耗时、Windows 打包和许可证比较，再决定是否替换底层实现。

## 5. 用户流程与交互设计

### 5.1 AI 学习助手页面

```text
应用导航 | 历史对话栏 | 当前对话线程
          [＋ 新对话]       顶部：当前模型  [模型与 API 设置]
                           中部：消息、来源、错误和重试
                           底部：附件 [＋]、输入框、发送
```

页面要求：

- 历史栏显示标题、更新时间、对话类型和错误状态；
- 新对话默认使用 `chat` 类型，规划入口仍可打开 `planning` 类型；
- 顶部模型选择器显示 Provider 分组和模型名称；
- 模型失效、Provider 停用或凭据缺失时显示阻断提示，不静默切换模型；
- 消息支持 Markdown、LaTeX、表格、代码块、安全链接、复制和重试；
- 长回复在消息区域内部滚动，不能撑出页面横向滚动；
- 窄窗口下历史栏可折叠，输入框和发送按钮始终可到达；
- 所有图标按钮必须有可读名称，状态变化使用 `aria-live="polite"`。

### 5.2 `＋` 附件菜单

```text
＋
├─ 从资料库选择
└─ 上传电脑资料
```

附件以 chip 显示文件名、大小、状态和移除按钮。只支持整个文件，不提供页码选择器。

“从资料库选择”读取已导入并完成完整性校验的资源；“上传电脑资料”继续复用现有 `startResourceImport` 导入 Blob Store，避免在资料窗口增加第三个动作。临时附件是后端为后续原生文件传输保留的生命周期契约，由 Rust 写入受控目录，仅保存元数据，删除对话或附件、导入失败以及应用重启时清理或标记过期。

### 5.3 请求预览与发送

规划对话外发请求先进入紧凑预览面板，显示：

- Provider 和模型；
- 预计输入/输出 Token；
- 附件数量和文件名；
- `原生文件`、`本地索引`或`本地索引 + 页面图片`传输方式；
- 资料是否需要 OCR；
- 警告和阻断原因；
- “取消”和“确认发送”。

规划对话未确认前不得访问外部 Provider。预览之后如果模型、资料、历史或附件变化，执行必须判定为过期并要求重新预览。普通 `chat` 对话不进入该面板，直接发送用户消息；后端仍执行输入、附件、预算和取消校验。

### 5.4 模型与 API 工作区

将当前 `AiFoundationPanel` 拆分为独立页面：

- 顶部：页面说明、“新增 API 配置”按钮和工作区默认模型；
- Provider 卡片：名称、协议、Base URL、启用状态、Key 状态、模型数量和连接测试状态；
- 模型列表：模型 ID、上下文上限、输出上限、图片/PDF/文件能力；
- 操作：编辑、测试连接、刷新模型、设置默认模型、停用、删除；
- 预算卡片：单次、每日、每月 Token 上限和阻断/警告模式，默认仅警告；
- 题库/PDF 分析状态：OCR 组件状态、索引状态、最近一次分析结果和重试入口。

模型能力不得根据名称自动推断；能力来源标记为 `manual`、`tested` 或 `unknown`。

## 6. 技术方案与接口

### 6.1 页面与导航

扩展 `AppView`：

```ts
type AppView =
  | "today"
  | "schedule"
  | "planning"
  | "library"
  | "workbook"
  | "review"
  | "ai-chat"
  | "ai-settings"
  | "settings";
```

新增 `AiChatWorkspace`、`AiSettingsWorkspace`、`AiChatThread`、`AiChatComposer`、`AiAttachmentMenu`、`AiConversationRail`、`AiProviderCard`、`AiModelSelector` 和 `AiRequestPreflight`。

旧的 `ai` 存储视图迁移到 `ai-settings`，避免历史入口失效。

### 6.2 对话类型与消息存储

新增：

```ts
type AiConversationKind = "planning" | "chat";
```

数据库迁移 `0027_ai_conversation_contract.sql`：

- `ai_conversation` 增加 `conversation_kind`；
- `ai_call.purpose` 增加 `general_chat`；
- 规划对话继续保留，历史记录默认归类为 `planning`；
- 通用对话使用 `chat` 类型；
- 不删除既有规划消息、调用记录和上下文引用。

数据库迁移 `0028_ai_capabilities_and_attachments.sql`：

- `ai_conversation.model_profile_id` 支持单个对话覆盖工作区模型；
- `ai_model_profile` 保存图片、文件、PDF 能力及能力来源，默认值为 `unknown`；
- `ai_attachment_ref` 只保存文件元数据、来源、状态和错误码，不保存 API Key 或临时文件正文；
- 附件来源、失败状态、大小、哈希和资源关联均由数据库约束校验。

### 6.3 Provider 与模型

当前模型表需要支持同一 Provider 的多个模型：

- `ai_model_profile` 唯一约束调整为 `(provider_config_id, model_name)`；
- 新增模型能力字段；
- 增加工作区默认模型配置；
- `provider.enabled` 表示可用，不再表示唯一当前 Provider；
- 对话可以保存 `modelProfileId`，为空时使用默认模型；
- 旧的单 Provider 激活记录迁移为默认模型。

供应商接入调整：

- 1.4 不再把 SenseNova 或其他新供应商的直连协议作为交付内容；
- 已完成开源 API 管理项目候选评估，后续采用 CCSwitch 风格的 Provider 预设、API Key 管理和模型映射；不在 KyStudy 内重新扩展供应商私有协议；
- 当前 `litellm_gateway` 仅作为历史兼容字段保留，不作为 1.4 新增 UI 的默认方案；真实网关接入需先完成 CC-Switch 核心能力移植和验收；
- 预设界面参考 [farion1231/cc-switch](https://github.com/farion1231/cc-switch)，不迁移其 Agent 工具配置、代理接管、MCP、Skills 或云同步代码；许可证记录、部署契约、迁移与回滚方案见 `docs/V0_1_4_API_GATEWAY_SPIKE.md`。

能力类型：

```ts
interface AiModelCapabilities {
  supportsImage: boolean | "unknown";
  supportsFile: boolean | "unknown";
  supportsPdf: boolean | "unknown";
  capabilitySource: "manual" | "tested" | "unknown";
}
```

### 6.4 通用对话请求

```ts
interface AiAttachmentRef {
  id: string;
  source: "resource" | "temporary";
  documentId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  status: "ready" | "processing" | "expired" | "failed";
}

interface AiChatRequest {
  conversationId: string;
  kind: "chat" | "planning";
  question: string;
  attachments: AiAttachmentRef[];
  contexts: PlanningContextSelection[];
  questionContext?: PlanningQuestionContext;
  modelProfileId?: string;
  maxOutputTokens: number;
  operationId: string;
}
```

规划对话预览结果：

```ts
interface AiChatPreflight {
  providerName: string;
  modelName: string;
  transport: "native_file" | "local_text" | "local_text_image";
  inputTokenEstimate: number;
  outputTokenLimit: number;
  attachments: Array<{
    fileName: string;
    transport: string;
    indexedPages?: number;
    warning?: string;
  }>;
  requestFingerprint: string;
  allowed: boolean;
  warnings: string[];
}
```

指纹必须包含对话历史、用户问题、Provider、模型、附件 SHA-256、本地索引版本、图片/OCR 输入版本和输出上限。

### 6.5 附件传输策略

采用“能力优先，本地兜底”：

1. Provider 支持 PDF/文件时，由 Rust 网关执行原生文件传输；
2. Provider 不支持原生文件时，读取本地 PDF 文字索引；
3. 需要视觉信息时，在本地索引基础上附加必要页面图片；
4. 三种能力均不可用时，阻断请求并提示建立索引、安装 OCR 或更换模型。

前端只提交资源 ID、临时附件 ID 和用户选择，不提交本地文件路径或 API Key。

### 6.6 协作式取消

新增 `cancel_ai_chat` 命令和操作注册表：

- 取消后前端立即恢复可编辑状态；
- Rust 在网络请求前、请求返回后和写库前检查取消标记；
- 被取消的请求不得创建成功的 `ai_message`；
- `ai_call` 标记为 `AI_CALL_INTERRUPTED`；
- 底层 HTTP 允许继续完成，但结果只能丢弃；
- 应用关闭时清理未完成操作和临时附件。

### 6.7 附件持久化

新增附件引用表，只保存：

- 文件名；
- MIME 类型；
- 文件大小；
- SHA-256；
- 资料库资源 ID；
- 临时附件状态；
- 传输方式；
- 过期时间。

不保存 API Key、临时文件内容、原始 Provider 响应或 Base64 图片。

## 7. 做题本 PDF 适配方案

每一本 PDF 都必须先建立独立 profile：

```ts
interface WorkbookPdfAdaptationProfile {
  profileId: string;
  markerPatterns: string[];
  headingPatterns: string[];
  headerFooterRules: string[];
  continuationRules: string[];
  expectedQuestionTypes: string[];
  ocrPolicy: "text-first-on-demand";
}
```

分析诊断：

```ts
interface WorkbookPdfDiagnostics {
  profileId: string;
  pageCount: number;
  subjectCount: number;
  questionCount: number;
  warningCount: number;
  ocrPageCount: number;
  unresolvedMarkers: number;
  crossPageQuestionCount: number;
  sourceFingerprint: string;
}
```

分析流程：

1. 导入或选择做题本 PDF；
2. 读取文字层和坐标；
3. 根据 profile 识别章节、题型和题号；
4. 仅对稀疏页面触发 OCR；
5. 生成候选科目、题目和警告；
6. 用户确认后写入正式题库；
7. 保存固定样本基线和分析指纹。

识别规则必须覆盖：

- 页眉、页脚和水印过滤；
- 普通题号、括号题号、小数题号和子题号；
- 章节标题、题型标题和科目分段；
- 公式、矩阵和多区域题；
- 跨页题目和跨页区域；
- 空白页面不生成题目；
- 下一页内容不得无条件拼接到上一题。

OCR 不可用时，保留文字层分析和人工校正入口，不让整个导入流程崩溃。OCR 候选继续沿用 R25 的低置信度约束，不直接作为无人工确认的正式题目。

每一本 PDF 的验收基线至少包括：

- PDF SHA-256；
- 页数；
- 科目/章节数量；
- 题目总数；
- 各题型数量；
- OCR 页数；
- 警告数量；
- 跨页题目数量；
- 3–5 个典型页面截图或脱敏 fixture。

用户提供的完整版权 PDF 不提交到仓库；仓库只保留脱敏 fixture、文本/坐标样本、SHA-256 和基线 JSON。

## 8. 实施批次与交付物

### M0：需求、开源和许可证 Spike

- 固定 v0.1.4 范围和非目标；
- 完成 UI、Provider、OCR/PDF 项目的许可证审计；
- 确认 assistant-ui 是否直接引入；
- 建立做题本样本基线模板。

交付物：技术选型记录、许可证记录、数据库迁移草案、PDF 基线模板。

### M1：AI 页面和 API 工作区骨架

- 增加 `ai-chat` 和 `ai-settings` 页面；
- 将当前 AI 设置弹窗迁移为独立工作区；
- 完成历史栏、线程、空状态、模型选择器和 Provider 卡片；
- 完成宽屏、窄窗口、键盘焦点和 reduced-motion 样式。

交付物：可导航的 AI/API 工作区，不接真实发送链路。

### M2：通用对话数据契约

- 完成 `conversation_kind` 和多模型数据库迁移；
- 新增通用 AI Chat 客户端和 Rust 应用层；
- 复用规划对话表、Provider Router、Windows 凭据和错误映射；
- 完成预览指纹、消息历史限制和模型覆盖选择。

交付物：可创建、切换、重命名、删除和恢复通用对话。

### M3：附件与 Provider 能力协商

- 第一段（已完成）：接入已导入资料库选择、附件引用持久化、绑定/移除和本地资料状态提示；
- 能力校准（已完成）：Provider 配置页可写回图片、文件和 PDF 能力状态，并在未知时保持本地文本优先；
- 临时上传后端契约（已完成第一段）：原生选择、哈希校验、受控落盘、失败回收、对话删除清理和重启过期；
- 完成附件 chip、进度、取消、重试和过期状态；
- 完成原生文件、本地文本、本地文本加图片三种传输模式；
- 完成请求预览和能力诊断。

交付物：不发送真实请求也能完整验证附件选择和传输决策。

### M4：真实 AI 对话与协作取消（进行中）

- 接入完整响应发送（已完成）；
- 通用 `chat` 会话隔离、`general_chat` 调用目的和独立 Tauri 命令（已完成）；
- 普通 `chat` 直接发送，不添加规划系统提示词、不显示 Token 预览或确认弹窗；
- 规划对话保持确认后执行；
- 完成重试、复制 Markdown、复制纯文本和消息失败恢复（已完成）；
- 暂停供应商直连扩展，统一参考 CC-Switch 的成熟供应商配置、API Key 管理和模型映射能力，再接入真实网关；
- 协作式取消第一段（已完成）：前端携带 `operationId`，Rust 注册取消标志；取消后底层请求结果只记失败状态，不追加本地消息；
- 完成临时文件清理和真实上传传输边界；
- 验证切换模型、Provider 错误、预算阻断和过期预览。

交付物：AI 对话主流程达到 P0。

### M5：做题本 PDF 适配

- 针对用户提供的第一批 PDF 建立 profile（本轮已完成：李永乐 660 高数篇、李艳芳 900 题数一高数）；
- 扩展题号、题型、章节、跨页和页眉页脚规则；
- 执行 PaddleOCR、Docling、现有 OCR worker 对比；
- 增加诊断面板和固定基线；
- 完成 OCR 不可用、取消、失败和无半成品写入测试。

交付物：第一批做题本 PDF 可稳定导入并生成题库候选。

### M6：整合、验收与发布收口

- 完成 AI、API、资源导入、PDF 分析和题库回归；
- 更新 `docs/README.md`；
- 实现后创建 `V0_1_4_RELEASE_NOTES.md`；
- 执行一次完整验证门禁；
- 由用户执行 Release EXE 桌面验收。

## 9. 测试与验收

### 9.1 前端自动化测试

至少覆盖：

- SQLite Provider 能力字段的默认值、持久化读取和更新保留；
- 附件本地文本索引页数、阻断预览和删除/回收后的不可用状态；

- `aiChatModel.test.ts`：输入校验、消息状态、重试、取消和过期预览；
- `aiAttachmentModel.test.ts`：资料库、保存上传、临时上传、移除、失败和过期；
- `aiProviderCapabilityModel.test.ts`：能力矩阵和传输方式选择；
- `aiConversationModel.test.ts`：新建、切换、重命名、删除和类型筛选；
- `navigation.test.ts`：`ai-chat`、`ai-settings` 和旧 `ai` 视图迁移；
- `planningChatModel.test.ts`：规划对话回归；
- `planningChatClient.test.ts`：本地文本传输预览、附件索引页数、阻断原因和旧响应兼容；
- Markdown/LaTeX 安全渲染回归；
- 资料库附件解析和临时附件状态机；
- `aiAttachmentClient.test.ts`：附件列表解析、资源绑定请求、移除请求和异常数据拒绝。

### 9.2 Rust 自动化测试

至少覆盖：

- `0027` 数据库迁移和旧数据保留；
- 多 Provider、多模型和默认模型选择；
- 预览指纹过期；
- Provider 能力矩阵；
- 原生文件与本地索引回退；
- 取消后不追加消息、不写入成功结果；
- 临时附件清理；
- API Key 不进入日志、错误和数据库；
- 附件引用的幂等绑定、上限、资源完整性校验和移除；
- Provider 的 401、429、5xx、超时和非法 JSON 映射。

### 9.3 PDF 自动化测试

至少覆盖：

- 做题本基线题目数和章节数；
- 题号与子题号；
- 章节标题和题型识别；
- 页眉、页脚、水印过滤；
- 公式、矩阵和多区域题；
- 跨页延续；
- 稀疏页面 OCR；
- OCR 缺失降级；
- 取消不写入半成品；
- 相同输入重复分析结果稳定；
- 不同 profile 不相互污染。

### 9.4 AI 人工验收矩阵

1. 主导航进入 AI 学习助手；
2. 新建、重命名、删除和恢复对话；
3. 切换多个模型和 Provider；
4. 通过 `＋` 菜单选择已有资料或上传电脑资料；
5. 附件仅显示整文件，不出现页码选择器；
6. 发送前检查模型、Token、附件和传输方式；
7. 发送、重试、复制、取消和失败恢复均可完成；
8. 重启后资料库附件仍可用，临时附件显示过期；
9. API Key 不出现在 WebView 网络请求、日志或错误文本中；
10. 在 1280×960、1366×768 和窄窗口下完成完整操作。

### 9.5 PDF 人工验收矩阵

1. 使用每一本样本 PDF 执行分析；
2. 核对页数、章节、题目数、题型数、OCR 页数和警告数；
3. 检查页眉、页脚、水印没有变成题目；
4. 检查公式、矩阵、子题和跨页题；
5. 禁用 OCR 组件后确认文字层流程仍可继续；
6. 分析取消或失败后确认题库没有半成品；
7. 相同 PDF 重复分析结果稳定；
8. 用户确认后才写入正式题库；
9. 整本教材类 PDF 明确提示“当前版本暂不支持”。

## 10. 验证门禁与发布规则

开发期间按改动范围执行：

```powershell
pnpm check:target -- <changed-files>
pnpm exec vitest related --run --passWithNoTests <changed-files>
pnpm audit:css
cargo check --locked --manifest-path src-tauri\Cargo.toml --lib
cargo test --locked --manifest-path src-tauri\Cargo.toml <target>
cargo clippy --locked --manifest-path src-tauri\Cargo.toml --lib --tests -- -D warnings
```

版本候选只执行一次完整门禁：

```powershell
pnpm check
pnpm audit:css
cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri\Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings
pnpm tauri build --no-bundle
```

发布前同步核对：

- `package.json`；
- `src-tauri/Cargo.toml`；
- Tauri 配置；
- Release Tag；
- 安装包文件名；
- 更新 manifest；
- 发布说明；
- OCR 独立组件版本和 SHA-256。

不启动 Release EXE，也不代替用户声明桌面验收通过。

## 11. 风险、回滚与完成定义

### 11.1 主要风险

| 风险                            | 处理方式                                       |
| ------------------------------- | ---------------------------------------------- |
| UI 开源依赖与 Tauri/Vite 不兼容 | M0 做构建 Spike；必要时按相同契约内部实现      |
| Provider 文件能力不一致         | Rust 能力协商；失败时回退本地索引或阻断请求    |
| 临时附件泄漏                    | Rust 临时目录、操作级清理和重启过期标记        |
| 数据库迁移失败                  | 迁移前备份、事务执行、旧表保留和失败回滚       |
| OCR 组件缺失或资源占用过高      | 文字层优先、稀疏页串行 OCR、可选组件和明确诊断 |
| 不同做题本排版差异大            | 每本 PDF 独立 profile、基线和回归 fixture      |
| 用户 PDF 版权风险               | 不提交完整 PDF，只保存脱敏 fixture、摘要和基线 |

### 11.2 完成定义

只有同时满足以下条件，v0.1.4 才可标记为完成：

1. AI 主导航、模型/API 工作区和资料导入流程均可使用；
2. 通用对话和规划对话数据互不污染，历史数据可升级；
3. API Key 未进入前端、日志或数据库非密钥字段；
4. 完整响应、重试、复制、协作式取消和失败恢复通过自动化与人工验收；
5. 每一本目标做题本 PDF 都有固定基线、回归 fixture 和人工验收结果；
6. OCR 缺失、解析失败、取消和数据库升级失败均有安全降级；
7. 目标检查、前端完整检查、Rust 门禁和 `tauri build --no-bundle` 全部通过；
8. 用户完成 Release EXE 桌面验收后，才更新发布说明中的最终验收状态。
