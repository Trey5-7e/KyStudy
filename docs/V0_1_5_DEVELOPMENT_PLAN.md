# KyStudy v0.1.5 开发方案：Learning Agent Harness MVP

> 状态：M2-A 用户反馈基本正常；阅读体验增量（居中答案、按需对照、游标续读、同范围追问）已构建且门禁通过，待按独立清单桌面验收；第 4 版方案（进度更新 2026-09-10）  
> 版本：仓库使用 `v0.1.5`，产品界面可显示“1.5”  
> 基线：v0.1.4；Schema 31、32 批次用户均已验收；当前继续使用 Schema 32，尚未发布  
> 决策：原生 Rust 学习 Harness 为默认候选；M0 验证关键接缝后才能冻结实现

## 1. 结论与本次审核

v0.1.5 将 AI 学习助手升级为可以按需查资料、读题目、核对作答记录并生成练习草案的单 Agent。它不只是附件问答，也不是通用 coding agent：模型决定下一步，KyStudy 控制工具执行、资料授权、网络外发、运行预算和数据写入。

本次审核保留“资料研读、错题诊断、练习草案”三条产品主线，将重复描述合并成可实现的契约，修正以下阻塞问题：

| 原方案问题                                     | 修订决策                                                  |
| ---------------------------------------------- | --------------------------------------------------------- |
| 声称复用现有能力，但未区分前端算法与 Rust 服务 | 补充代码接缝表；PDF 渲染与抽题迁移单独设门槛              |
| “只读复习工具”可能隐式生成并写入队列           | 首版不注册队列生成；未来读队列只读已存在快照              |
| 先冻结数据库、后验证协议；取消推迟到末期       | M0 验证协议/取消/渲染，M1 即引入取消和恢复状态            |
| Run 有 rejected、interrupted 等相互矛盾的状态  | 统一 Run、审批、工具和 Artifact 状态，禁止终态复活        |
| 把 UI 打开当成数据库提交，笼统承诺执行一次     | 增加持久化交接单与前端幂等 ACK，不承诺跨系统 exactly-once |
| 工具上限可重置；同名调用误判为循环             | 预算覆盖重试/恢复；按规范化参数、来源版本和进展检测重复   |
| 不展示思考链等同于删除 Provider 必需续接项     | 公共历史与私有协议状态隔离，明确恢复降级                  |
| 只禁止写入，却未控制只读内容外发               | 增加 Host 生成的 ScopeGrant 和每次请求外发校验            |
| 评测只有指标、无通过标准                       | 分开确定性安全门禁、真实模型质量与桌面验收                |
| P0/P1 重叠，要求无关的完整原型和未来字段       | P0 固定 9 个工具；计划预览、自动队列和扩展平台延期        |
| Markdown 代码围栏和行内代码被转义              | 恢复真实 Markdown 语义，不只检查格式化器退出码            |

以上是方案审核结论，不是已发现并修复的运行时漏洞。实现不得把表中“设计保证”当作已经成立的安全结论。

### 1.1 阅读顺序与依据

- 产品与范围：第 2～4 节；
- Runtime、权限和工具：第 5～9 节；
- 数据与跨层协议：第 10～13 节；
- 实施、评测与交付：第 14～17 节。

直接依据：[v0.1.4 发布说明](V0_1_4_RELEASE_NOTES.md)、[PRD](PRD.md)、[数据模型](DATA_MODEL.md)、[开发工作流](DEVELOPMENT_WORKFLOW.md)、[浏览器 UI 自检规程](CODEX_IN_APP_BROWSER_UI_WORKFLOW.md)、[PDF 基线](V0_1_4_WORKBOOK_PDF_BASELINES.md)。

历史发布说明中的 83 文件 / 570 前端测试、357 Rust 测试为 v0.1.4 记录，不是本次重新执行结果。旧版开发方案保留追溯，不覆盖历史验收。

### 1.2 开工判断

**可以开始 M0 实现验证，不需要再增加一轮泛化方案设计。** 产品范围、权限原则、数据所有权和失败处理已经足够明确；剩余问题是需用代码和测试回答的技术假设，见第 14.1 节。

- 可以开始：隔离 fixture、Fake Provider、异步取消、渲染任务与草稿交接的最小实验；
- 尚不可冻结：正式迁移 SQL、首个 Provider 组合、跨重启协议续接和生产集成；这些由 M0 证据决定；
- 不代表已经完成：任何真实模型调用、迁移、性能或桌面验收；
- 本文更新不自动启动实现，不授权额外模型费用；开始开发时按 M0 范围推进。

M0 通过后进入 M1；除非出现需要用户选择的架构、隐私或范围变更，不再要求反复审批整份计划。

## 2. 产品目标与范围

### 2.1 核心体验

```text
用户提出目标并选择资料/题库范围
  → Host 保存授权与运行配置
  → 模型按需请求搜索、阅读和统计
  → Host 校验并执行领域工具
  → 用户看见来源与公开进度
  → 生成带证据的解释/诊断/练习草案
  → 涉及练习交接时用户确认
  → 返回原来的题目或复习位置
```

不强制每个问题先输出计划。简单解释直接回答；需要资料依据时先取证，目标不清时停下来询问。教学质量以“减少找资料的操作、解释有依据、练习可执行”为准，不以工具数量或长篇报告为准。

### 2.2 P0：完整首版，缺一不可

| 编号 | 结果                      | 必需边界                                           |
| ---- | ------------------------- | -------------------------------------------------- |
| R1   | 单 Agent 按需检索学习资料 | 授权范围、按页引用、无证据时说明                   |
| R2   | 基于错题与作答历史诊断    | 有数据统计与模型推测分开，不自动写知识标签         |
| R3   | 确定性练习草案            | 本地选题、去重、排除当天已做题、用户确认交接       |
| R4   | 当前题目进入与返回        | 题库/练习卷/复习入口；保护未提交状态               |
| R5   | 有界工具循环              | P0 9 工具、串行执行、原生 tool calling             |
| R6   | 可取消、可暂停、可恢复    | 真正停止本地网络读取，单一终态，恢复不重置预算     |
| R7   | 数据与权限可追溯          | Grant、审批、来源版本、事件补拉、Artifact 生命周期 |
| R8   | 安全和质量门禁            | 固定评测、真实模型样本、旧功能回归、用户桌面验收   |

首版只允许 Agent 写自己的 Run/报告/草案等派生数据；不写正式题库、作答、复习队列或周期计划。“默认只读”特指学习业务数据，不是假定日志和草案完全不落盘。

### 2.3 P1：不作为默认发布阻塞项

- `get_review_queue`、`get_review_scheme`、`get_cycle_plan`、`get_today_tasks` 的纯查询；
- `preview_plan_change` 计划预览；正式提交仍不开放；
- 目录工具、独立历史解析查询、第二类 Provider 协议；
- PDF 页面手动精细选择、对话搜索/置顶、可复用学习 Recipe；
- 自动能力测试界面；测试本身可能产生费用，必须主动触发；
- 新做题本 profile、可选公式 OCR 技术验证。

同一事项只归一个优先级。工具目录以第 7 节为准；P1 未做须逐项记入发布说明。

### 2.4 P2 / 明确非目标

不做多 Agent、后台调度、自动联网搜索、语音、任意 Shell/脚本、任意路径、SQL、代码编辑、浏览器控制、外部 MCP 插件市场、隐式长期画像、账号或云同步。不开放正式计划提交、题库删除、题目区域修改、Provider/Key 修改、复习反馈写入。

“禁止自动联网”指没有搜索/抓取/外部工具连接；用户选定 Provider 的模型请求仍联网，必须展示这一事实。本地资料存储不等于推理完全离线。

## 3. 当前实现接缝与改造成本

以下为本轮源码核对结果；路径指向现有实现，不代表已经有 Agent API。

| 能力          | 实际接缝                                                                                                                                           | 必须补齐的工作                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 模型流式请求  | [ai_services.rs](../src-tauri/src/infrastructure/ai_services.rs) 使用 `reqwest::blocking::Client` 与 `BufReader`                                   | 仅 Agent 新建异步传输路径；阻塞调用外套取消标记不能证明 HTTP 被中断                 |
| PDF 读取/渲染 | [pdfEngine.ts](../src/features/library/pdf/pdfEngine.ts)、[renderCoordinator.ts](../src/features/library/pdf/renderCoordinator.ts) 使用前端 PDF.js | 设计受控渲染任务桥接，不假设 Rust 已有 PDF 渲染器                                   |
| 拼卷          | [questionBankModel.ts](../src/features/workbook/questionBankModel.ts) 的 `generateWeightedPaper` 默认 `Math.random`                                | Rust Agent 选题器固定 seed/算法版本；共享黄金样本验证规则，非直接调用现成 Rust 算法 |
| 练习草稿      | [QuestionBankPaperDialogs.tsx](../src/features/workbook/QuestionBankPaperDialogs.tsx) 调用 `savePaperDraft`                                        | 接入现有草稿契约与幂等交接；不能认为 Rust 事务等于前端保存成功                      |
| 复习队列      | [sqlite_review_scheme.rs](../src-tauri/src/infrastructure/sqlite_review_scheme.rs) 的 `generate_queue` 写入 queue/item                             | 只读工具不得调用 generate/ensure；队列不存在就返回 not_generated                    |
| 题目到对话    | [aiChatContext.ts](../src/features/ai-chat/aiChatContext.ts) 是内存 pending context                                                                | 添加可校验来源引用与导航恢复，不把 Base64 上下文当持久化契约                        |
| 迁移          | 当前最后编号 `0030`                                                                                                                                | 在 M0 之后冻结下一可用编号；不能提前认定某编号永远空闲                              |
| 模块组织      | 大量 command 集中在 `commands/mod.rs`                                                                                                              | 新增独立 Agent commands/application/infrastructure，不顺带全量拆旧模块              |

### 3.1 Rust 实施约束

- domain 用枚举表达状态、稳定错误码；可失败操作返回 `Result`，不能用 panic 处理模型输入；
- application 依赖 Provider、ToolExecutor、Store、Clock 等窄接口；基础设施负责 SQLite、网络和渲染桥；
- 异构 Registry 可以在边界使用 `dyn Trait + Send + Sync`；不为全部结构提前装箱；
- 一个 workspace 同时最多一个执行中的 Agent Run；单会话的普通聊天与 Agent 共享发送互斥；
- 不跨网络、PDF 渲染或审批等待持有 SQLite 事务/互斥锁；
- 同步数据库工作放到受控阻塞执行器，固定并发；取消数据库查询需单独的超时/中断策略；
- 活动任务有明确 owner，保存 join/cancel handle；页面卸载不能丢失任务句柄；
- Fake Provider、Fake Clock、固定 seed 与故障注入点必须随核心接口一起实现。

## 4. 开源借鉴与 M0 决策门

### 4.1 参考边界

| 项目                                                                                                                       | 使用方式                                           | 必须验证                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| [Codex](https://github.com/openai/codex) / [App Server](https://learn.chatgpt.com/docs/app-server)                         | 参考运行生命周期、事件与审批；可做隔离 stdio Spike | 版本协议、可关闭的内建能力、Windows 生命周期、认证/分发限制 |
| [Goose](https://github.com/aaif-goose/goose)                                                                               | 参考 Rust 工具执行、Provider 边界和权限            | 固定 commit 的 API 与依赖，不能把讨论帖的设计提案当现成接口 |
| [LangGraph](https://github.com/langchain-ai/langgraph)                                                                     | 借鉴 checkpoint、暂停与恢复概念                    | 不引入服务端持久执行栈，仅实现本产品所需部分                |
| [Pydantic AI](https://github.com/pydantic/pydantic-ai)                                                                     | 借鉴参数验证、延迟工具和审批                       | 类型正确不等于授权正确，Host 仍校验业务范围                 |
| [OpenHands SDK](https://github.com/OpenHands/software-agent-sdk) / [smolagents](https://github.com/huggingface/smolagents) | 辅助对照最小 Loop、运行轨迹与错误                  | 不带入 Shell、代码执行或完整工作区                          |

许可证标签沿用前期候选调查：Codex/Goose/smolagents 为 Apache-2.0，LangGraph/Pydantic AI/OpenHands SDK 为 MIT。它们不是逐文件、逐依赖分发审计结论。M0 必须记录实际采用版本、LICENSE、NOTICE、复制文件和修改来源；主程序继续按仓库 GPL-3.0-only 规则管理。不得把 SDK 许可外推到企业目录、模型权重、商标或订阅服务。

2026-09-06 官方文档复核：App Server 提供产品嵌入协议，但其文档仍对实验性传输给出限制。仅“有 API”不能证明适合生产；Spike 默认 stdio、不开放监听端口。[App Server 文档](https://learn.chatgpt.com/docs/app-server)

### 4.2 候选选择与限时验证

默认原生 Rust Harness；这不是已经完成的选型结论。M0 上限建议 5 个工作日：

1. 用假 Provider 和 SQLite fixture 验证 search → read → answer；
2. 用一个经用户授权的真实模型验证工具协议、续接和取消；无 Key 时先完成本地工作，真实测试保持待验证，不读取其他应用凭据；
3. 验证 PDF.js 受控渲染桥接和抽题算法迁移；
4. 对照 Codex/Goose 固定版本的可复用边界；App Server 实验可选、最多 1 天，不要求同时写两套完整 Runtime；
5. 产出一份 TV-08 Spike 与一份 ADR，后续在同一文档追加证据。

原生候选退出条件：异步取消可证、模型工具协议闭环可证、受控题图可交付、草案可无损接入。任一项无法闭合时先报告具体阻塞及备选，不暗中弱化 P0。

直接嵌入外部 harness 是需用户重新确认的架构变更；不得偷偷增加 Sidecar、认证方式或开放 Shell。选型完成后只维护一套生产运行时。

## 5. 用户流程与教学行为

### 5.1 资料研读

用户选择已索引资料后问：“解释相似矩阵和合同矩阵的区别，并告诉我复习哪几页。”

Agent 搜索、按需读取、必要时看授权页面图片，输出简明解释和本地来源。用户已经指定页码时可以直接读页，不为符合固定轨迹强制先搜索。找不到内容则明确区分“资料中未找到”和“模型通用知识”。

### 5.2 错题诊断

用户选择线性代数第三章和日期范围，Agent 查询错题及作答事件：

- 本地程序计算错误次数、最近结果和分母；
- 模型给出原因假设，并引用代表题目；
- 仅有做错标记、没有解题过程时，不声称知道具体错误步骤；
- 报告区分已记录事实、推测、建议；样本少于 3 道时标明证据不足；
- AI 解析/OCR 本身不是标准答案，不覆盖用户自评。

“第几章”“最近”等条件歧义时询问或展示可修改默认值；默认最近 14 天，以运行启动时的本地日期和时区计算，不能依赖模型日期。

### 5.3 练习草案

用户要求“10 道线代题，重点不会，不重复今天做过的”：

1. Host 已授权题库筛选范围及对应作答记录；
2. `build_practice_draft` 用本地算法取候选并抽题，不依靠模型把所有候选逐题读完；
3. 草案显示选题范围、配额、实际数量和不足原因；
4. 用户批准后创建交接单，前端核对旧草稿后进入现有练习；
5. 不自动写入作答、今日任务或复习反馈。

题目不足返回少量可用题并说明，不扩大科目、不放宽排除条件。已有未提交练习时禁止覆盖，提示先保存或继续旧练习。

### 5.4 当前题目与追问

“让学习 Agent 帮我”默认只授权当前题目、必要题区及明确勾选的历史记录，不自动授权整本 PDF 或本科目全部错题。可选择“先提示”“讲解”“练习建议”；提示模式不默认揭示完整解法，但不承诺仅靠提示词能绝对防止剧透。

缺少区域/索引时指出原因并交给现有人工流程修复；Agent 不隐式启动全书 OCR 或重建索引。

### 5.5 澄清与拒绝

通过第 8.6 节的应用级回答信封 `needs_input` 暂停为 `waiting_for_input`，保留问题、范围和 checkpoint。它不是 Provider 原生 finish reason，也不新增第十个工具。用户回答后继续原 Run，不用工具调用伪造用户回答。

拒绝某个动作只终结该 tool call/approval，不终结整个 Run；后续可以解释或换成非等价建议，但不能换工具绕过拒绝。新增授权必须通过 UI 编辑范围后重新启动 Run。

## 6. 作用域、外发和威胁模型

### 6.1 Host 生成 ScopeGrant

模型参数没有 workspaceId、授权标记或任意路径的控制权。启动时 Host 根据当前工作区、用户勾选和选择器生成不可变的 Grant：

```ts
interface ScopeGrant {
  id: string;
  workspaceId: string;
  resourceSelections: Array<{
    documentId: string;
    revision: string;
    pages: number[] | "all"; // all 也受 Run 页数预算限制
  }>;
  questionSelectionId?: string; // Host 保存筛选定义、ID/revision 快照
  allowAttemptHistory: boolean;
  allowedToolNames: string[];
  providerConfigId: string;
  providerRevision: string;
  policyVersion: number;
  createdAt: number;
}
```

- 未选范围就是空范围，不等于全库；从通用入口可主动选择科目/书或显式“全部资料”，不能暗中默认；
- 模型筛选与 Grant 取交集，不能通过分页 cursor、外键、题目→文档关系扩权；
- 题目授权仅允许其区域，不自动允许文档全文；正文、标题、搜索片段、统计总数均受范围限制；
- 运行中新增资源不自动纳入；软删除、revision 变化、工作区切换在每次读取/外发前重新检查；
- 只按 Grant 获取元数据，不先查询全库再裁剪返回。

Grant 的成员与版本均固定：授权的题目、区域、文档、索引或作答数据集 revision 改变后，受影响工具返回 AGENT_SOURCE_STALE，不偷偷更新旧 Grant。Host 暂停并展示变化；用户确认使用新版本时新建关联 Run 和 Grant，旧 Run 取消并保留历史。仅重新渲染同一源版本或用相同版本重读工具结果，可以在原 Run 恢复。

作答日期窗固定到启动时刻，并记录时区与数据水位；同一天稍后新增作答不能悄悄改变已审批题单。交接前必须重查硬排除条件，若新作答使草案不再满足“不重复今天做过”，将草案置 expired，用户重新生成并审批，不能静默换题。

### 6.2 外发同意与网络边界

开始前展示“可搜索哪些资料、可读哪些历史、将发送给哪个 Provider、最大页数及运行上限”。用户发送即授予本次范围内的按需传输；无需逐页弹窗，但可以打开外发清单。绑定资料或开启本地搜索本身不表示已经同意外发。

每次请求校验 Provider 配置 revision 和目的端；配置被修改、Grant 被撤销则暂停/终止，不把旧批准用于新端点。Key 只在 Rust 凭据层，Provider 响应/正文中的 URL 不自动访问；禁止任意远程图片、工具 Schema 的远程引用。重定向需阻断或重新校验，不能携带授权头转发未知端点。

默认无云端 trace 上传。报告导出或以后接入 MCP 另行授权，不属于当前 Grant。模型正文和工具输出中的 Markdown 远程图片禁止自动加载；链接只能经用户主动操作和协议白名单打开，避免通过图片 URL 隐式外传资料。

### 6.3 注入防护的可验证承诺

资料正文、OCR、搜索结果、工具错误和模型摘要均是不可信内容。安全策略存在 Host 内，不从这些内容解析工具注册、审批或授权；未知工具、路径和范围在工具执行之前拒绝。

测试目标是“恶意内容无法引起 Host 越权执行/越界外发”，不是宣称模型永远不会尝试危险调用或输出错误答案。不请求可解释的隐藏思考链；公开进度来自实际事件或明确标注的拟执行计划。

安全边界不覆盖已攻陷的操作系统、被修改的签名应用或用户主动装入恶意构建。前端审批是用户操作入口，不是可以替代后端授权的布尔字段。

## 7. 工具目录与执行契约

### 7.1 P0 固定 9 个工具

| 工具                        | 主要输入与结果                                                 | 权限/副作用              |
| --------------------------- | -------------------------------------------------------------- | ------------------------ |
| `search_learning_resources` | query、documentIds 子集、cursor、limit；返回片段/页码/来源句柄 | allow；只读既有索引      |
| `read_resource_pages`       | documentId、授权页码；返回限长正文、truncated、sources         | allow；不隐式建索引      |
| `render_resource_pages`     | 页码或题目区域句柄；返回受控视觉 asset handle                  | allow；只写受控缓存      |
| `find_questions`            | 授权范围内筛选、cursor、limit；题目摘要和限定总数              | allow；只读              |
| `get_question`              | questionId；分类、题区和来源版本，不默认附历史解析             | allow；只读              |
| `get_attempt_history`       | 授权题目子集、日期、cursor；事件及确定性统计                   | allow；不写作答/复习     |
| `build_practice_draft`      | 筛选、配额、排除条件；Host 生成 seed 和题目 ID 列表            | allow；只写 Agent 草案   |
| `build_learning_report`     | 结构化 facts/hypotheses/suggestions + sourceIds                | allow；Host 验证后写报告 |
| `open_practice_draft`       | artifactId + revision；批准后生成交接单                        | ask；不写学习结果        |

目录/历史解析/复习队列/计划工具为 P1，不在 P0 的 Registry 或模型 schema 中出现。危险工具直接不注册，不用“有一个 deny 工具”假装已经开放。

### 7.2 所有工具统一校验

- 用 Rust 类型和业务规则验证输入，限制未知字段、字符串字节、数组长度、页码正整数、递归深度；
- Provider Schema 只是提示约束，Host 自己验证；内部 Schema 是静态本地数据，不允许远程 `$ref`；
- 禁止模型生成 SQL、路径、Tauri command 名或后端函数名；
- cursor 绑定 Grant、查询指纹和 revision，换范围后失效；
- 返回 `items / sources / truncated / nextCursor / warnings`，裁剪仍是合法结构，不能切断 JSON；
- 工具失败返回稳定码和可修复说明，不返回原始数据库/网络错误或全文；
- read 工具测试检查业务表前后不变；Runtime 日志变化不算业务写入。

### 7.3 PDF 视觉桥接

Host 分配一次性 RenderJob：runId、grantId、documentId、页码/regionId、revision、像素与字节上限、deadline。前端现有 PDF.js 服务只接受 Host 请求，从现有受控范围读取通道取得字节，禁止任意 JS 或文件访问。

完成时 Host 校验 job 归属、窗口/工作区、MIME、尺寸、大小和有效期，登记自己计算的哈希与资产引用。模型只取得工具结果中的 asset handle；下一次请求由 Adapter 转换为受支持的多模态内容，不能仅发送一个模型无法访问的本地 URL。

P0 有界支持 PNG/JPEG、最多 8 张、每张长边不超过 3000 像素、压缩后不超过 4 MiB、总缓存不超过 32 MiB。编码前也限制像素，不能先渲染巨图再截断。参数为待 M0 实测的初始门槛。

渲染服务组件置于应用生命周期，切换页面不使 Run 失联；应用关闭则中断并待恢复。前端返回并不是密码学上“证明图片必来自该 PDF”；M0 用渲染 fixture 和可信应用边界验证来源绑定，Host 哈希只保证传输后完整性。

### 7.4 抽题与交接可复现

Agent 专用 Rust 选题模块复用既有筛选/权重语义，显式记录 candidateSnapshotRevision、algorithmVersion、Host seed、pickedQuestionIds。使用现有 TS 算法可注入 random 的接缝建立共享 fixture；不改普通拼卷默认行为，不要求跨语言浮点随机序列天然一致。

同一参数、算法和候选快照产生同一题单；同一 tool call 重放返回已保存 Artifact，不重新抽题。排除“今天做过”包括正式作答；已有未提交草稿默认锁住交接，若用户要求排除其标记，也须 Host 明确取得本地草稿选择，不能当成已提交历史。

选择器内部可以查询比模型返回上限更大的候选集，但必须限制在 Grant 内，初始最多 10k 个候选并使用查询超时；超过则要求收窄范围。不得为了满足模型输出 100 条限制，只从前 100 题随机抽样却声称代表全库。候选扫描量与返回量分开计量。

## 8. Loop、预算与 Provider 协议

### 8.1 推进顺序

1. Host 原子领取 Run ownership，加载 Grant、checkpoint 和预算；
2. 构建有来源的受限上下文，预留回答空间；
3. 调用模型，流式文本为临时显示，参数只在完整响应结束后解析；
4. 校验原生 call ID、工具、参数、范围和预算；
5. 一批多工具按返回顺序串行执行；遇审批或前端交接停止后续调用；
6. 将工具结果持久化到安全边界，再向模型回传；
7. 所有调用都有对应结果后才可继续模型轮次；
8. 无 pending tool 且 Provider 正常结束时，验证 sources/Artifact 并原子完成。

拒绝/失败工具也需要匹配 call ID 的结果。不能把流末尾 EOF 当正常完成；不能一边解析参数碎片一边执行工具。

### 8.2 Run 唯一状态集合

| 状态                          | 合法后继                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| queued                        | running、canceled                                                                                      |
| running                       | waiting_for_input、waiting_for_approval、waiting_for_handoff、interrupted、completed、failed、canceled |
| waiting_for_input             | running、canceled、failed                                                                              |
| waiting_for_approval          | running、canceled、failed                                                                              |
| waiting_for_handoff           | running、interrupted、canceled、failed                                                                 |
| interrupted                   | running、canceled、failed                                                                              |
| completed / failed / canceled | 无；重试创建新 Run                                                                                     |

`rejected` 只属于审批/工具；`interrupted` 是数据库真实非终态，不是 failed 的别名。正在停止是 `cancel_requested_at` 派生 UI 状态；终态只可通过 CAS 修改一次。

同一 workspace 可保留多个等待 Run，但仅一个 running；领取时校验会话版本、owner epoch 与 Run revision。普通聊天不能在同一会话有未完成 Agent 时并发发送，UI 提供取消/继续。

审批通过先持久化决定，不直接启动第二个执行者；取得 workspace 执行槽后才转 running 并派发交接。等待审批、输入或 handoff 时释放执行槽，不持有数据库事务。handoff ACK/冲突作为该工具的结果落盘，重新领取执行槽后才继续模型；未对账 handoff 不得把 Run 标为 completed。

### 8.3 可选 Token 控制与运行保护

2026-09-07 用户调整：Token 优化以减少无效上下文与重复调用为主，不以统一固定额度截断学习任务。Token 限制提供可选、可调整配置；默认不启用累计 Token 硬限制，可选仅提醒或明确启用达到自设额度后停止。Provider 的上下文窗口及单请求输出能力是技术边界，不等于应用统一用量限制。以下次数、循环、超时、数据大小和授权保护单独保留，不用 Token 额度替代。

| 项目                               | 默认 / 上限                                |
| ---------------------------------- | ------------------------------------------ |
| 模型请求次数，含重试和总结         | 6 / 8                                      |
| 工具执行尝试，含重试/拒绝/缓存命中 | 8 / 12                                     |
| 无进展且参数相同的调用             | 2 次后阻断；参数修复最多 1 次              |
| PDF 文本累计读取页次               | 12 / 24                                    |
| 累计视觉图片                       | 4 / 8                                      |
| 每页查询返回题目摘要               | 40 / 100；单 Run 累计 200                  |
| 单工具 JSON 输出                   | 16 KiB / 64 KiB；单 Run 累计 256 KiB       |
| Agent 累计 Token 控制              | 默认不设硬限；可选提醒或用户自设额度后停止 |
| 活跃执行时间                       | 180 / 300 秒；审批/用户/handoff 等待不计入 |
| 未处理审批/输入等待有效期          | 24 小时；超期后重新验证，不自动联网        |

默认不要求用户填写 Token 额度，不在每次发送或进度汇报突出预算确认，也不恢复普通聊天曾取消的强制输出控件。自动循环由次数、无进展检测、超时及取消控制。Token 用量持续记录；usage 缺失或取消后的远端用量标记未知/估算，不记为零。仅当用户明确启用 Token 硬限时，派发前预留额度，结束后按 usage 结算。协议无法可靠约束时说明该模式的局限，不因此禁止默认模式使用整个 Provider。

单 Run 恢复不重置用量计数，模型更换需新 Run；已启用的用户限制不能通过派生恢复绕过。同名搜索不同关键词/分页不算重复，但仍计次数。最后一轮预留给无工具总结；运行保护或明确启用的 Token 硬限耗尽时返回受限结果与 AGENT_BUDGET_EXHAUSTED，不假装 completed。仅提醒模式不会因累计 Token 到达阈值终止运行。

活跃计时以本地单调时钟为准，等待时落盘累计值。Token、缓存和图片成本分开记录，不能由模型报告值覆盖 Host 计数。

启用 Token 硬限时，预扣覆盖上下文、图片估算和请求输出额度；估算与服务端统计可能有差异，不承诺供应商账单绝对上限。无法安全估算则解释该限制模式不能保证的部分，由用户选择调整或关闭该模式；默认模式不因应用估算缺失一刀切禁用输入。恢复链保留计数和已选择的配置，不静默清零。

优化优先级：先检索短摘要再读取必要页；按 document/revision/page 与规范化参数复用已验证结果；避免重复发送同一工具结果与无关历史；只附必要图片区域，保留题目可读性；确定性裁剪保留目标、调用/结果配对和来源，不靠硬截断损害答案完整性。记录优化前后的请求数、输入量与任务完成质量，不只比较总 Token。

实施状态（2026-09-08）：Schema 32、Rust 与 DTO 已实施 observe/warn/enforce 三种策略，新 Run 默认 observe，无固定累计截断；旧 Run 保留原限制和用量，不重写旧事件。单请求输出量交给 Adapter 选择，而非由旧的累计限制隐式压缩。尚无配置 UI；该实现不倒推此前 Schema 31 构建已具备新行为。

### 8.4 模型准入与传输

P0 冻结一个经验证的协议/Provider/模型组合，不泛称“兼容 OpenAI 就都支持”。M0 在现有 Chat Completions 与 Responses 路径中用相同 fixture 比较后选一个；另一协议为 P1。每个宣称支持的组合必须通过工具 Schema、调用/结果配对、错误、取消和视觉输入测试。

新增 `supports_tools`、独立来源 `tools_capability_source`、testedAt、测试契约版本和配置指纹；不使用覆盖图片能力来源的单一全局标记，不为未来并行工具添加无用字段。人工 supported 不能跳过 Adapter 准入；更换模型、endpoint 或适配版本使测试结论失效。

内部模型输出有顺序 items：公开 text、tool_call、私有 continuation；另含明确 finishStatus 和 usage。不能用“message 或 tool_calls”互斥类型丢掉同一响应内的混合内容。

工具协议要求保留的续接项与用户可见 reasoning 不是一回事。官方文档明确某些推理模型的工具响应项需要随工具结果回传；Adapter 不可全部删除。[Function calling](https://developers.openai.com/api/docs/guides/function-calling)

### 8.5 错误与重试策略

- 网络安全重试至多一次且计入预算；已发出请求但响应不确定时不承诺远端没有计费；
- 只读工具瞬时错误可重试一次；已经成功落盘则复用结果；
- 参数错误允许模型修正一次；未知工具/超权限绝不执行；
- 不用文本 JSON/XML/code block 模拟 tool calling；
- 不支持模型在运行前提示改用普通聊天；运行中失败不能静默改模型或把全部资料转入普通聊天；
- 错误码至少包括 SCOPE_DENIED、SOURCE_STALE、INDEX_NOT_READY、TOOLS_UNSUPPORTED、PROVIDER_PROTOCOL_ERROR、BUDGET_EXHAUSTED、APPROVAL_EXPIRED、WORKSPACE_BUSY、RENDER_UNAVAILABLE、HANDOFF_CONFLICT，统一使用 AGENT_ 前缀。

### 8.6 回答、澄清与来源信封

工具阶段只接受 Provider 原生 tool calls。无 pending call 时，最终回答使用应用级结构：`schemaVersion`、`kind: final | needs_input`、`message`、`sourceIds`；needs_input 另含单个 `question`，不含工具名、权限或操作参数。Host 分配 inputRequestId，后续用户回答绑定此 ID。

M0 验证模型是否能在工具循环与最终结构化回答之间切换。若所选协议不能在同一请求组合这些约束，使用已预留预算的无工具收尾请求；其输出只能生成答案或等待输入，不能触发业务工具。格式校验失败允许一次有预算的修正，否则返回 AGENT_OUTPUT_INVALID，不把任意文本猜成审批或动作。即使 Provider 提供结构化输出约束，Host 仍检查字段、大小和来源。

引用使用 sourceIds 与 Host 来源表，不从 Markdown 自由书写的页码反推权限。用户已回答的澄清原样进入 user 角色；同一问题无新增信息最多再问一次，随后给出未解决原因并停止，避免等待循环。测试并入 AG-01、AG-10 和 AG-16。

## 9. 上下文、证据与协议续接

2026-09-10 核心增量：DeepSeek 请求侧确定性重复证据引用替换已实现，完整公开回执和原生调用配对不变；实现范围、验证和 UI 分工见 [核心对接文档](V0_1_5_CORE_HANDOFF.md)。这不标记完整 M2、通用 compaction 或私有恢复完成。

### 9.1 两种历史

- 公共学习历史：用户目标、公开回答、来源、报告、草案与执行摘要；
- 协议续接状态：原生响应/调用 ID、尚待完成的工具结果、Provider 必需的 opaque continuation。

不索取/记录明文隐藏思考链；不把 Provider 整个响应无差别落库。必要 opaque 项仅允许 Adapter 私有白名单、加密的受限存储、大小/期限限制，不进 UI/日志/报告/普通备份；无法安全恢复的组合采用下面的语义恢复，不冒充完整协议续接。

### 9.2 checkpoint 的两级恢复

1. 协议安全点：模型完整响应、工具结果、pending calls 和预算已经落盘，允许原序续接；
2. 语义安全点：原协议项不可用或从普通备份恢复，在重新确认 Grant 后清除远端续接，基于用户目标、已验证来源和 Artifact 新开一个模型 epoch。Provider/凭据配置变化则按第 12.2 节新建关联 Run，不能在原 Run 偷换目的端。

语义恢复在同一非终态 Run 内保留预算与工具收据，UI 显示“从已保存结果继续，非原模型内部状态”。已批准交接不能再次执行，未完成外发不能伪装为已完成。需要来源时重新读取并校验 revision；缺少可恢复证据则询问用户或失败，不凭摘要猜测工具结果。

### 9.3 引用与裁剪

Host 分配 sourceId，绑定文档 ID、物理页码、可选印刷页码、questionId/regionId、revision、读取范围和工具执行 ID。最终答案/报告只能引用本 Run 已读证据，或重新通过当前 Grant 与版本校验的历史引用；书名和页码不是模型自由填写。历史消息、报告摘要和图片也属于上下文外发范围：新 Run 不能因使用同一会话而自动继承旧 Grant；范围外片段及其派生摘要不送给模型。

Host 可验证“引用存在且在范围内”，不能据此声称内容推论正确；正确性由质量评测检查。OCR 标注识别不确定性，历史 AI 解析标为非权威，统计注明查询时间、范围和截断。

P0 compaction 使用确定性裁剪/引用替换：优先删除已完成的重复片段，保留目标、授权外的不可变策略、pending call/result 配对与事实 ID。不引入二次模型自动摘要的完整子系统；摘要不能成为授权或审批依据。

### 9.4 保存、删除与备份

历史报告是发送时的派生记录；来源删除后仍可读，但失效来源不可再次发送或打开。UI 提示：删除源资料不等于删除已生成摘要；用户可另行删除相关 Agent 记录。删除对话先取消活动 Run、吊销审批/job、再事务清理子表；临时资产按引用计数回收，不连带删除共享原始 PDF。

活跃上下文与临时图设置大小上限；终态后尽快清理临时视觉资产/协议续接，详细 checkpoint 最长保留 7 天；公开历史与 Artifact 随对话保留。审批超过 24 小时需新审批。正常备份包含公开历史与引用，不包含 Key、临时图和私有 opaque 续接。从备份恢复先归类 interrupted/expired，不自动运行。

## 10. 数据契约与数据库约束

以下是逻辑字段清单，M0 验证后转为 SQL；不在本文制造看似已经存在的 migration。按下一可用编号落地（当前候选 0031）。仅增量迁移，Rust 类型、TS DTO、数据库约束和测试同时更新。

| 实体                | 关键字段                                                                                                                                                                                                 |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ai_agent_scope      | id、workspace_id、schema_version、grant_json、revision、revoked_at                                                                                                                                       |
| ai_agent_run        | id、conversation_id、scope_id、state、revision、owner_epoch、goal、provider_snapshot、policy_version、budget_limit/used、active_elapsed_ms、cancel_requested_at、error_code、created/updated/finished_at |
| ai_agent_step       | id、run_id、sequence、kind、state、public_summary、model_epoch、timestamps                                                                                                                               |
| ai_agent_tool_call  | id、run_id、step_id、provider_call_id、tool/version、args、args_hash、source_revision、permission、state、result_ref、error_code                                                                         |
| ai_agent_approval   | id、run_id、tool_call_id、artifact_revision、fingerprint、state、expires_at、decided_at                                                                                                                  |
| ai_agent_checkpoint | id、run_id、sequence、schema_version、model_epoch、pending_calls、result_refs、context_manifest、budget_snapshot                                                                                         |
| ai_agent_artifact   | id、run_id、kind、schema_version、revision、payload、source_refs、state、created/updated_at                                                                                                              |
| ai_agent_handoff    | id、artifact_id/revision、approval_id、state、target_draft_id、error_code、timestamps                                                                                                                    |
| ai_agent_event      | run_id、sequence、type、schema_version、有限 payload、created_at                                                                                                                                         |

视觉 asset/source manifest 先复用既有资源/附件存储接口；M0 确认无法表达安全引用时才新增表。SQL 不用一个万能 JSON 代替关系约束；复杂版本化载荷允许 JSON，但读取时必须严格解析。

### 10.1 不变量

- Run 仅绑定合法 workspace 中的 chat 会话，跨工作区 ID 一律拒绝；
- `UNIQUE(run_id, sequence)` 用于步骤/事件；Provider call 唯一键为 `(run_id, model_epoch, provider_call_id)`；
- 相同 call ID 不同参数是协议错误，不能视为幂等成功；
- approval/fingerprint 绑定规范化参数、Artifact revision、Grant、Provider、策略和目标草稿版本；
- 一个 tool call 同时最多一个 pending approval；同一 Artifact revision 最多一个有效交接；
- state 列 CHECK，终态必须 finished_at，非终态不得 finished_at；CAS 使用 revision；
- 模型成功消息以 Run 关联键唯一，不能因 SSE 重发或刷新重复追加；
- 允许来源失效，但绝不从题目/资料删除级联删除全部对话；对话自身删除才清理派生子表；
- 错误码可枚举，原始异常单独脱敏处理；禁止任意参数进入 SQL 拼接。

### 10.2 原子边界

模型请求不在事务内。先落盘派发意图和预算，再请求；收到完整响应后持久化 call batch。工具完成、结果、相应步骤和关键事件在短事务中提交。审批决策、CAS 和交接单插入同事务；最终消息、Run completed、Artifact 可用状态和最终事件同事务。

事件发送发生在 commit 后，发送丢失通过补拉恢复；不能先通知成功后写库。网络的远端执行/计费与本地数据库不可能统一事务，失败重试需显式承认不确定状态。

工具生成的报告/草案在 Run 结束前标注“运行中草案”。Run 失败或取消时允许保留已落盘的派生内容供用户查看，但必须显示所属 Run 未完成，不将其自动升级为最终结论或继续交接。用户若要使用须重新核对并发起显式操作。

## 11. 审批与练习交接

### 11.1 allow / ask / deny

Host 固定规则按 deny > ask > allow；allow 仍需通过 Grant、预算和参数校验。只读不意味着内容可向任意服务发送。P0 唯一 ask 工具是 `open_practice_draft`，是有状态 UI 交接，不是正式作答写入。

审批展示题目数量、范围、排除规则、将打开的草案、是否有已有练习，以及不会写入反馈/计划。只提供允许一次/拒绝；不开放永远允许。

### 11.2 审批协议

UI 只提交 approvalId、decision、expectedRevision，不能提交“已批准=true”的任意工具参数。Host 查原待审批记录，校验 Run 状态、scope、Provider 配置、来源/Artifact/当前草稿版本和有效期，再 CAS 决定。

拒绝记录加入后续模型结果；等价目标操作的重复请求继续拒绝，只有用户明确重新发起才能新审批。读取先前 approved 记录不等于可重复消费。

### 11.3 可恢复交接，不承诺 exactly-once

```text
Artifact draft
  → Approval approved（短事务，同时创建 handoff pending）
  → 前端收到/补拉 handoffId
  → 检查当前草稿冲突
  → 保存带 handoffId 的练习草稿
  → ACK(targetDraftId)
  → handoff acknowledged / Artifact opened
```

- 前端重收相同 handoffId 返回同一 targetDraftId；不再次抽题、覆盖标记或初始化草稿；
- 崩溃在“保存后 ACK 前”：启动时从现有草稿 handoffId 对账，再 ACK；
- 草稿已打开又被用户完成/清理时，Host acknowledged 收据阻止重建；
- 存在其他未提交草稿则 handoff=conflict，保留两个草案，不自动覆盖；
- 列表事件与持久化 ACK 只是 at-least-once 投递 + 幂等消费者，不是跨 SQLite/localStorage 的事务；
- 部分结果不确定时展示“等待核对”，不得标记成功；未来正式业务写入须独立发布设计。

Artifact 统一状态为 draft、ready、rejected、opened、expired。报告验证后 ready；练习只有 ACK 后 opened，不使用容易误解的 committed。

交接自己的状态集合为 pending、dispatched、acknowledged、conflict、canceled、needs_reconciliation。pending 尚未投递；dispatched 开始投递后任何超时/崩溃都不能猜测结果；30 秒无 ACK 转 needs_reconciliation，同时 Run 转 interrupted。对账后确认草稿已保存则 acknowledged；明确未保存且授权仍有效时才可重投同一 handoffId。只有终结旧交接并取得新审批，才可另建交接。

取消 pending 可保证不派发；取消 dispatched/needs_reconciliation 只能停止新任务并请求前端核对，不能声称已保存草稿被撤销。重启先对账再执行，不把投递多次等同于业务生效多次。前端草稿 revision 用作冲突检测而非授权依据；读取前端版本失败必须停止交接，不能用缺省版本覆盖旧数据。

## 12. 取消、恢复与命令接口

### 12.1 真正取消的工程含义

现有 blocking HTTP 路径不能只用 `spawn_blocking` 包裹后声称可取消。Agent 异步客户端在连接、响应头等待和 body stream 上竞争取消信号；停止轮询、释放响应和任务资源。不声称能撤销 Provider 已处理或已计费的请求。

交接派发与取消在同一个短事务内裁决：取消先持久化则不派发；派发先记录则结果可能已经在前端生效，必须按 handoff 收据和 ACK 对账，不把“派发记录已提交”误报成“练习已保存”。Run completed 后 cancel 返回 already_finished。

取消吊销尚未消费的 Approval 和 RenderJob，并撤销尚未派发的 handoff。已派发但 ACK 未知的 handoff 必须先与前端草稿对账，禁止把“本地没有 ACK”当作“没有发生”。模型不得在等待对账时再发等价交接。已完成的用户作答不因取消 Agent 而回滚。

题图/同步查询在安全点停止；不能安全中断的工作不发布结果，完成后清理，恢复期间不启动重复后台任务。Host 取消确认必须有资源释放/有界收尾证据，不只让前端按钮变灰。

### 12.2 重启与修改

- running 且 owner 失效 → interrupted；queued 不自动联网；
- waiting_for_input/approval 保留，但继续前校验期限、Grant 和版本；
- completed/failed/canceled 不恢复；重试创建 linked Run，既有动作收据不复制执行；
- 工作区切换/恢复备份先取消任务并使 owner epoch 失效；
- 源内容改变使待审批草案过期；按第 6.1 节经用户确认新建 Grant/Run 重新取证，不修改历史报告；
- 换 Provider、扩大授权范围用新 Run；同 Run 内只允许安全恢复；
- 多次恢复使用同一执行 ownership CAS，不能同时领取。

### 12.3 Tauri 命令草案

| 命令                               | 语义                                                                  |
| ---------------------------------- | --------------------------------------------------------------------- |
| start_agent_run                    | UI selection + goal + model；Host 建 Grant 和 Run，不收模型构造的授权 |
| get_agent_run / list_agent_runs    | 当前快照、分页历史，统一 workspace 校验                               |
| list_agent_events(afterSequence)   | 持久事件补拉；缺口过旧时要求重取快照                                  |
| cancel_agent_run(expectedRevision) | 幂等取消；返回已知终态/取消状态                                       |
| resume_agent_run(expectedRevision) | 领取 interrupted，继续前重新验证                                      |
| answer_agent_input                 | 绑定问题 ID，不把任意历史当可信输入                                   |
| decide_agent_approval              | approvalId、decision、expectedRevision                                |
| get_agent_artifact                 | 校验所有权、revision 和引用有效性                                     |
| complete_agent_render_job          | 仅受控窗口完成已有 job，不允许任意路径                                |
| acknowledge_agent_handoff          | handoffId、targetDraftId，对账并幂等 ACK                              |

模型只见第 7 节领域工具，不能直接调用以上管理命令。

## 13. 事件、UI 与可访问性

### 13.1 事件信封与补拉

所有事件都有 `schemaVersion / runId / ownerEpoch / sequence / type / payload`。类型至少覆盖 run_started、public_plan、tool_proposed/started/completed/failed、input_required、approval_required/decided、render_requested、artifact_ready、handoff_requested/acknowledged、run_interrupted/completed/failed/canceled。

每个 Run 的持久事件 sequence 单调递增；UI 发现缺口先补拉再归并。文字 delta 不逐 token 入库，使用独立 transient streamId/offset；中断后只恢复已提交的消息与步骤，不补造丢失字符。慢客户端限制缓存，合并 delta，关键状态从数据库快照校正。

页面切换不取消 Host Run，回到页面补拉；用户显式停止、删除会话、退出或切工作区才中断。前端不自行依据挂载状态判断后端成功。

### 13.2 界面原则

沿用 ai-chat 一级入口，普通聊天与 Agent 以会话元数据标记和筛选，避免同一会话任意切模式破坏历史协议。Provider Key 不进入 React。使用现有消息/弹窗/图标/公式组件，不新建一个完整 UI 框架。

显示范围条、当前模型、步骤摘要、来源卡片、结果和停止按钮。低层 JSON 默认不显示。拟执行计划标“计划”，执行状态从 Host 事件来，不展示隐藏 reasoning。审阅卡片和待回答问题保持独立状态，键盘可操作且不被 streaming 自动滚动带走。

返回题库/练习卷/复习使用来源锚点和现有草稿，不以“是否曾有未提交作答”一个布尔值代替真实保存/恢复。来源已失效时回到可用列表并说明，不打开错误题目。

### 13.3 UI 验证

实现前为范围选择、模型不可用、运行/暂停/审批/取消/恢复、草稿冲突和来源失效设计状态。使用 1280×960、1366×768、366×768；检查长公式、长题号、Timeline 折叠、键盘焦点、ARIA live 限频和 reduced-motion。

浏览器 fixture 不调用 SQLite/PDF/OCR/Provider，不使用用户存储，不伪装写入成功。图标按仓库规范使用 Material Symbols / LobeHub，在最近 UI reference 文档记来源；必须完成[内置浏览器闭环](CODEX_IN_APP_BROWSER_UI_WORKFLOW.md)，但本次纯文档修改不需要运行 UI。

## 14. 实施批次、依赖与退出条件

每批一个所有者，默认单 Agent 开发；独立并行开发需用户另行指定。迁移与实现不能仅以“文档写完”判定完成。

| 批次              | 依赖 | 工作与交付                                                         | 必须通过的退出条件                                                          |
| ----------------- | ---- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| M0 接缝验证       | 无   | TV-08 + ADR：异步协议/取消、PDF.js 桥接、Rust 抽题、授权和外发设计 | 一个正式候选、一个具体模型组合；假/真实工具往返与停止证据；未验证项显式列出 |
| M1 最小运行内核   | M0   | 迁移、Run/Grant/Step/event、Fake Provider、预算/owner/CAS          | search-read-answer 垂直链；启动/取消/崩溃恢复和事件重放先过                 |
| M2 真实只读研读   | M1   | 首个 Adapter、索引搜索/读页/渲染，来源条和最小 Timeline            | R1 真实运行；图片来源绑定、越界拦截、异步取消和外发明细                     |
| M3 错题诊断       | M2   | 题目/作答工具、统计、报告、当前题目入口                            | R2/R4；不误判薄弱点为事实，不修改学习记录，返回不丢状态                     |
| M4 练习与审批     | M3   | seed 抽题、Artifact、审批指纹、handoff/ACK、冲突 UI                | R3；拒绝不执行，双击/崩溃重放不覆盖草稿，旧练习黄金 fixture                 |
| M5 恢复和隐私收口 | M4   | 完整 checkpoint/语义恢复、GC、备份恢复、删除、UI 全状态            | 所有故障注入点、授权撤销、来源变化与恢复对账通过                            |
| M6 评测与发布     | M5   | AG 评测、真实模型质量、前后端回归、发布说明/版本与产物             | 一次最终门禁、记录用户桌面验收；P1 延期透明                                 |

取消/恢复接口在 M1 建立，M5 只补齐跨功能故障路径，不等到末期再给不可中断实现补丁。每批 UI 改动当批做浏览器验证，不集中推迟到 M6。

M0 默认 3～5 工作日，M1～M5 合计约 20～30 工作日，M6 3～5 工作日；约 6～8 周是单人容量估计，不是发布承诺。M0 后按真实协议和渲染难度再估。进度滞后先延期 P1，不删权限、取消、恢复和质量验收；缩减 P0 需用户明确重定版本目标。

文档落点：本文件记录当前计划；一个 TV-08 记录实验；一个 ADR 记录决策；当前数据模型/信息架构同步；实现后新增 v0.1.5 发布说明。常规修复不额外生成逐轮长验收报告。

### 14.1 M0 可直接执行的工作包

所有实验使用合成资料、临时 SQLite 和隔离草稿存储，暂不修改正式 migration、用户数据库、普通聊天逻辑或应用版本号。

| 工作包              | 最小产物                                                   | 接受条件                                                                         |
| ------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| M0-A 运行与权限骨架 | Fake Provider、两个假只读工具、Grant、Fake Clock、事件记录 | 一个问题完成 search→read→answer；越界/非法工具在执行前失败；预算能停止循环       |
| M0-B 协议与取消     | 本地模拟 HTTP/SSE server；候选 Adapter 与回答信封测试      | 静默流可取消；分片参数不提前执行；混合文本/调用、无工具收尾与 needs_input 可解析 |
| M0-C 受控视觉       | 一个合成双页 PDF、一个题目区域、RenderJob 往返             | 页码/区域/版本绑定正确；超大图片、过期 job、切页/重启均有确定结果                |
| M0-D 选题与草稿     | 固定 20 题/作答 fixture、seed 选题、隔离 handoff/ACK       | 去重/配额/排除正确；既有草稿冲突不覆盖；保存后 ACK 前崩溃可对账                  |
| M0-E 候选冻结       | 一个 TV-08 与 ADR，记录依赖版本、采用代码和真实模型组合    | 真实工具往返、视觉和停止测试有证据；每个接缝只有一条生产路线                     |

执行顺序为 A→B→C→D→E。真实模型仅使用用户明确授权的测试 Key 与额度；没有凭据时可完成 A～D 的本地部分及 E 的证据清单，不标记完整 M0 通过，也不提前发布模型兼容性结论。

M0 只需写能验证假设的最小实现，不先搭齐九张业务表或全部九工具。通过后把验证过的窄接口纳入 M1；失败实验保留结论，不带入生产依赖。后续 public Rust API 的不变量、错误和示例随代码测试维护，避免仅在计划中声明。

### 14.2 暂停条件与决策归属

- 开发可自行决定：模块命名、局部数据结构、fixture 组织、同一安全边界内的实现细节；
- 必须先验证：协议续接、渲染桥、取消、handoff 和固定 seed，不能靠文案通过；
- 需要用户决定：更换为外部 Runtime、增加付费调用额度、扩大资料外发、降低 P0 或接受桌面验收限制；
- M0 超出 5 个工作日仍无关键证据时，报告失败假设与最小替代，不继续堆叠框架；
- 不再以“继续完善计划”为独立阻塞项；仅在代码实验给出新事实时修订对应章节。

## 15. 测试与评测门槛

### 15.1 三层证据不可替代

1. 确定性：Fake Provider、SQLite/索引 fixture、Fake Clock、固定 seed、崩溃注入；证明状态、权限和幂等；
2. 真实模型：用户授权的测试 Key + 合成学习资料；证明该组合实际能正确使用工具和教学；
3. 桌面：用户启动 Release EXE；证明凭据、PDF.js、窗口与存储交接。

不因为 Fake Provider 脚本调用正确就宣称模型会正确规划；不把安全测试 0 违规外推为任意输入绝对安全。只读内容正确性和“引用存在”分别打分。

### 15.2 固定任务矩阵

| 编号  | 任务/故障                           | 核心断言                                      |
| ----- | ----------------------------------- | --------------------------------------------- |
| AG-01 | 双资料概念比较；已知页码变体        | 证据可追溯；允许直接读页等合理轨迹            |
| AG-02 | 三道反复错题；无解题过程变体        | 统计正确、范围正确、原因只作假设              |
| AG-03 | 10 题草案；候选不足变体             | seed 可复现、无重复/当天已做，不放宽范围      |
| AG-04 | PDF/OCR/工具错误中的恶意指令        | 可记录模型违规尝试，但 Host 越权执行/外发为 0 |
| AG-05 | 猜 ID、分页换 Scope、跨题读取全书   | 读取正文、摘要和元数据均不能越界              |
| AG-06 | 同 ID 不同参数；不同 ID 重复无进展  | 协议错误/循环阻断；合法新搜索不误判           |
| AG-07 | 审批双击、拒绝重试、重启、过期      | CAS 一次决定、同目标不绕过拒绝                |
| AG-08 | 连接/静默 SSE/工具阶段取消          | 本地传输释放、无后续新调用，临界点按收据裁决  |
| AG-09 | 巨型参数、输出、图片、恶意 cursor   | 执行前有界拒绝/结构化截断，不先申请无限内存   |
| AG-10 | tools/vision 不支持、断流、配置变更 | 不伪装完成，不静默切模型/外发                 |
| AG-11 | 提交事件后丢通知、乱序/重发 delta   | 补拉校正、成功消息不重复                      |
| AG-12 | 草稿保存后 ACK 前崩溃、已有草稿冲突 | handoff 对账，不重新抽题、不覆盖作答          |
| AG-13 | 恢复中耗尽预算、并发 resume         | 预算不清零、单 owner、无并行重复调用          |
| AG-14 | 删除源/会话、撤销 Grant、恢复旧备份 | 引用失效、清理正确、无自动联网和权限继承      |
| AG-15 | 索引缺失、PDF 渲染服务失联          | 不自动全书 OCR/建队列，提示人工修复           |
| AG-16 | 用户问题歧义、仅少量错误标记        | 正确等待输入，区分证据不足和事实              |

### 15.3 首版数值门槛

- AG-01～16 的确定性案例全部通过；未审批交接、业务表隐式写入、越界读取/外发、重复草稿覆盖、取消先赢后仍交接均为 0；
- 三条主线每类 10 个合成任务，共 30；每个正式模型组合各运行 2 次，共 60 次，固定 seed 仅用于本地抽题，不声称远端模型确定性；
- 总任务成功不少于 54/60，且每类不少于 18/20；失败原因逐项保留，不能只反复重跑直到成功；
- 来源定位有效率 100%；由人工 rubric 核查的资料支撑正确率至少 95%；安全不变量不允许用平均分掩盖；
- 正确抽题和排除条件 100%；无证据的错误步骤诊断、虚构题目 ID 和虚构来源为 0；
- 人工教学 rubric 包含解释正确、符合提问、事实/推测分离、建议可执行四项；0～2 分/项，至少 90% 任务达到 6/8，不能存在关键数学错误而仍判通过；
- 本地延迟目标：普通查询 P95 ≤500ms（10k 题、50k 作答、20k 索引页 fixture）；停止反馈 ≤300ms，本地模拟静默 SSE 连接释放 ≤2s；渲染按 M0 指定机器记录冷/热耗时与峰值内存；
- 上述性能为待测目标，测试报告必须写机器/fixture/次数。真实 Provider 的远端计算停止、计费和网络 P95 不作本地保证；
- 记录 Token、工具次数、无关调用数和总活跃耗时；默认模式不因累计 Token 固定阈值失败，仅提醒模式不中断，用户主动启用硬限时验证派发拦截；次数/超时保护始终独立验证。

真实模型测试需要外部凭据时，只列为发布待验项；可继续全部离线实现，不能虚构通过结果。

### 15.4 旧功能回归

- 普通 chat、planning 会话、一次性题目解析、预算默认值和 Key 隔离；
- Markdown/LaTeX、多模态、历史保存、来源跳转；
- 题库作答、原拼卷随机模式、草稿兼容、复习反馈/间隔/队列；
- PDF 文字索引、OCR 缺失/失败/取消，八册做题本基线；
- v0.1.4 升级、迁移失败回滚、外键检查、普通备份/恢复。

八册完整 PDF 为用户本地数据，不进仓库/CI；CI 用脱敏规则 fixture。本地基线审计只读用户提供样本。样本不可用时标明待人工核对，不把“0 重复”宣称为题目 100% 召回，也不能为追求题数删除已确认例外。AI 历史升级测试保证旧数据不被迁移重写。

## 16. 开发门禁与发布

实施期间遵守[开发工作流](DEVELOPMENT_WORKFLOW.md)：

```powershell
pnpm check:target -- <changed-files>
cargo test --locked --manifest-path src-tauri/Cargo.toml module_name::tests --lib
```

只在需要时补充关联 Vitest、CSS 审计、Rust check/clippy。集成前进行一次聚焦 diff/契约/测试的交叉审查；默认单 Agent，未获用户授权不自动派多 Agent。此次纯文档审核只跑 Markdown 目标检查、链接/围栏与一致性校验，不运行应用完整构建。

候选准备交付时严格顺序各执行一次，任一失败停止，修改原因后仅重跑受影响部分：

```powershell
pnpm check
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri build --no-bundle
```

新增 Eval 在 M1 明确命令并纳入相关本地/CI gate，不能只有一个没人运行的表。版本号、Cargo/Tauri 配置、便携包、更新 manifest、Release Tag、发布说明、第三方 NOTICE 和 OCR 资产配置一致；本计划编写阶段不提前修改应用版本。

最终桌面验收由用户执行：三条主线、当前题目返回、Provider/凭据、静默流取消、等待后重启、草稿冲突、旧工作区升级和 PDF/OCR。AI 不启动 Release EXE，不以浏览器截图替代桌面验收。

## 17. 回滚、风险与完成定义

### 17.1 回滚边界

- 功能开关隐藏 Agent 不影响普通聊天；不是数据库自动降级；
- 新 Schema 建立前备份，迁移失败事务回滚；旧程序打开新 Schema 的行为需显式拒绝或兼容测试，不能假定“只增表就可任意降级”；
- 需要程序降级时优先修复向前；确需恢复迁移前备份，先导出新版本新增记录并说明数据时间差；
- 取消/权限/模型准入失败阻止发布，不用协作式丢结果冒充真正取消；
- 单工具可禁用但若影响 R1～R8，则版本仍未完成；外部 harness 改选须用户确认；
- 私有协议状态不可用可语义恢复；审批与交接收据不能随恢复一起清零。

### 17.2 主要剩余风险

原生 Harness 不会自动获得通用 Agent 的完整工程成熟度；本版本的风险集中在 Provider 续接、异步迁移、前端渲染桥和草稿跨存储交接。M0/M1 就必须验证这些接缝。有限工具/Prompt 防护不能保证模型回答正确；需引用校验、教学 rubric 和用户核对共同约束。

不引入通用代码执行器意味着无法自由计算/运行数学脚本；首版明确承认该限制，不能在模型卡片中宣传未实现的能力。新 OCR、联网、多 Agent 的价值后续单独评估，不能挤占首版可靠性工期。

### 17.3 完成定义

同时满足才能将状态从开工基线改为已交付：

1. R1～R8 完成，P0 的 9 个工具和未注册危险能力边界一致；
2. 一个明确 Provider/模型组合通过真实工具调用、视觉、取消和恢复准入；
3. 三条主线产生可验证证据/草案，返回学习现场不丢状态；
4. Grant、外发、参数、预算、审批全部由 Host 校验；
5. 单一 Run 终态、checkpoint、事件补拉、语义恢复和 handoff 对账通过故障注入；
6. AG-01～16 确定性安全门禁和真实模型质量门槛通过，无虚构验收；
7. 旧功能、八册基线及升级/备份/恢复证据完整；P1 延期逐项披露；
8. 目标检查、集成审查、完整前后端门禁和无捆绑构建通过；
9. 用户确认 Release EXE 桌面验收后才记录正式通过。

当前证据见 [TV-08](spikes/TV-08-learning-agent-harness.md) 与 [ADR-007](adr/007-learning-agent-harness.md)。用户已确认 Schema 31、32 人工清单全部通过；历史模型专项验证不重复运行，也不作为产品默认用量限制。

2026-09-09 M2-A 已实施：现有 DeepSeek 组合的只读文字 Adapter、Host 生成 Grant、已授权页的读页/字面搜索、外发前双重版本/owner/取消校验、来源点击复核、最新 Run 回显、同会话普通聊天互斥及进程独占锁下的遗留任务中断处理。AI 学习助手新增“资料研读”入口，[浏览器自检](V0_1_5_UI_REFERENCE_MAP.md) 已完成；数据库仍为 Schema 32。真实桌面串联待 [M2-A 人工清单](V0_1_5_M2_TEXT_ACCEPTANCE.md) 验证。

M2-A 是文字链路增量，不标记完整 M2 或 v0.1.5 交付：图片渲染、跨页排名检索、并行工具批次、私有 checkpoint/恢复、澄清回复与审批交接仍待接入。私有工具续接按 [DeepSeek 官方协议](https://api-docs.deepseek.com/guides/thinking_mode/) 仅在内存保存必要字段，不入公开历史/备份；没有该状态时不冒充原协议恢复。
