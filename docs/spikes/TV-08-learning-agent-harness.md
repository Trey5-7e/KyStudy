# TV-08：Learning Agent Harness 接缝验证

状态：2026-09-07 已补充授权模型专项验证，原生方案已接受并进入 M1 内核；非 v0.1.5 产品验收。以下早期记录保留当时结论，后续证据见文末。

依据：[v0.1.5 计划 §14.1](../V0_1_5_DEVELOPMENT_PLAN.md)。按 A→B→C→D→E 推进，不冻结正式迁移、Provider 组合或生产接口。

## M0-A 运行与权限骨架

实现：[agent_harness_spike.rs](../../src-tauri/tests/agent_harness_spike.rs)。独立 Cargo 测试目标；仅内存 SQLite 合成三页数据，不访问用户工作区、凭据、网络或普通聊天，不编入生产运行时。

- Fake Provider 收到问题与前轮工具结果，完成 search→read→answer；结果绑定文档、页码、revision 和 call ID。
- 两个实验工具仅允许授权页读取与页内子串搜索；SQL 在读取正文前绑定授权来源，不是生产索引搜索实现。
- Registry 与 Grant 双重检查；拒绝未知字段、非法页码、超长参数、重复 call ID、越界文档和未选页面；空授权不等于全库。
- 模型/工具尝试先记内存计数与事件再派发，失败尝试也计数；Fake Clock 验证请求前及返回后的时间预算；失败/成功终态不可再次执行。
- 检查工具返回内容及 SQLite total_changes，确认闭环没有写业务表。

复现命令：

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --test agent_harness_spike
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --test agent_harness_spike -- -D warnings
rustfmt --edition 2024 --check src-tauri/tests/agent_harness_spike.rs
```

2026-09-06 验证：12 测试通过，0 失败；目标 Clippy（`-D warnings`）通过。聚焦复核发现请求返回后缺少时间预算检查，已补检查及回归。测试覆盖一组 7 种非法/越界参数及两种超时返回，因此测试函数数不等于输入案例数。

## M0-B：传输取消与回答信封（部分完成）

实现：[agent_transport_spike.rs](../../src-tauri/tests/agent_transport_spike.rs)。沿用 reqwest 0.13.4 异步 Client 与 Tauri 2.11.5 的异步运行时，不新增依赖、不修改普通聊天阻塞路径。模拟服务器仅监听 `127.0.0.1` 临时端口，客户端禁用代理和重定向，不携带凭据。

- 请求 owner 持有 JoinHandle，释放时 abort；同时观察 future 析构通知与服务器 TCP EOF/reset，不能仅以本地丢弃结果判定取消成功。
- 等待响应头、静默 SSE、半截 SSE 三种情形均确认本地连接释放；请求有 5 秒超时，取消断言总期限为 2 秒。
- 累计响应字节限定为 16 KiB；这里尚无 Provider 完成事件解析，因此 EOF 一律报协议失败，不伪装完成。
- 独立验证回答信封版本、字段、长度、来源白名单与 pending call；`needs_input` 必须有问题，`final` 不允许问题，额外工具字段被拒绝。此实验不创建正式 inputRequestId，也不转换生产 Run 状态。

2026-09-06，当前 Windows 开发机，debug 构建、单次运行：7 测试通过、0 失败；目标 Clippy（`-D warnings`）和 rustfmt 通过。3 个取消样本的观测区间约 0.15～0.22ms，仅为此次本地 fixture 结果，不是性能基准/P95，不外推真实网络、远端计算停止或计费。首次运行因 Windows 接收 socket 继承非阻塞模式失败，已在夹具中显式恢复带超时的阻塞读取，再运行通过。

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --test agent_transport_spike -- --nocapture
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --test agent_transport_spike -- -D warnings
rustfmt --edition 2024 --check src-tauri/tests/agent_transport_spike.rs
```

聚焦复核：实验服务器与客户端生命周期有 owner/超时；未引入业务工具执行、生产配置或凭据。取消结果尚未接入 Run CAS；不覆盖 DNS/TLS 建连、HTTP/2、正常结束与取消竞态、应用退出及跨重启。

### Chat Completions 协议 fixture（2026-09-06 后续证据）

实现：[agent_protocol_spike.rs](../../src-tauri/tests/agent_protocol_spike.rs)。根据 [OpenAI Function calling](https://developers.openai.com/api/docs/guides/function-calling) 和 [Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events) 的原生字段编写原创合成样本，未复制 SDK 代码、未连接真实模型。

- 字节级 SSE 组装支持 LF/CRLF、注释与多 data 行；UTF-8 完整行解码，逐个可能字节切分点验证中文与 JSON 分片，逐个截断点验证不会提前交付调用。
- 仅在正常 finish_reason 与 `[DONE]` 后通过消费式接口交付整批调用；`stop` 不能携带调用，`tool_calls` 必须有调用。参数在收尾时解析为 JSON object，模型生成的名字和业务参数仍须 Host Registry/Grant 校验。
- 文本和原生工具调用同时保留；多调用按 index 组装，结果按 call ID 唯一匹配，缺失、伪造或重复结果不能生成续接消息。
- 固定 response ID；拒绝异常 finish、refusal/未知 delta、finish 后新增 delta、无效 UTF-8、尾随数据、超大参数与流。错误会污染解析器，不能忽略错误后继续取得成功。
- 初始实验上限：总输入 64 KiB，行/事件 16 KiB，文本 8 KiB，单调用参数 4 KiB，调用数 12。保留 usage 原值，不把它当已校验 Token 结算。

验证：9 个测试函数通过，0 失败（包括遍历切分点和截断点）；目标 Clippy 与 rustfmt 通过。首次负例用字符串替换构造 length 时未命中字段，已修正为精确替换 finish_reason，再通过测试；Clippy 的按值传参提示已改为借用。聚焦复核补充多工具、来源响应 ID 变化、拒绝、收尾后 delta 与独立边界测试。

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml --test agent_protocol_spike
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --test agent_protocol_spike -- -D warnings
rustfmt --edition 2024 --check src-tauri/tests/agent_protocol_spike.rs
```

限制：这是单 choice、函数工具的严格实验子集；不承诺通用 SSE/Provider 兼容性。尚未连接前一传输实验或 M0-A 工具循环；文本聚合不保留 text/call 的完整交错时间线；工具拒绝未形成模型修正往返；回答信封目前仍是独立测试。无工具消息续接、Token 结算和生产错误细分留待集成，不把本测试当九工具授权测试。

下一步仍为 M0-B：使用同一语义 fixture 补 Responses 事件与私有续接，比较两条协议；再将候选解析器、异步传输、Fake 工具与回答信封串为本地闭环。当前不能冻结 Adapter 或声明模型兼容性。官方文档要求部分推理模型的 reasoning items 随工具结果回传，因此不能将公共文本聚合器直接当 Responses 续接实现。

## 初轮实验限制（后续进展见下节）

- M0-A 是同步最小假协议；工具拒绝直接使实验 Run 失败，尚未实现生产协议要求的失败结果回传、批量调用与重试。
- 计数、Grant 和事件仅在内存；尚无持久化预扣、跨重启恢复、owner/CAS、外发复核、Token/输出预算或无进展指纹。不能作为 AG-01～16 全部门禁证据。
- M0-A 的同步 Fake Clock 不证明 HTTP 可取消；M0-B 已补独立异步传输证据，但尚未与工具循环集成。完整参数组装与 Provider 协议续接仍待实现。
- M0-C：合成 PDF/区域与 RenderJob 往返待实现。M0-D：20 题黄金 fixture、seed、handoff/ACK 待实现。
- M0-E：真实模型组合、视觉、停止与续接均待授权测试；未读取其他应用 Key、未产生模型费用。
- 未变更生产代码、迁移、依赖或应用版本；不运行 Release EXE。本批仅隔离目标验证，不作为发布交付，不重复完整应用构建。

## 依赖与采用代码

本实验原创，无外部 Harness 源码复制。沿用仓库 Cargo.lock 的 rusqlite 0.40.1、serde 1.0.228、serde_json 1.0.150、thiserror 2.0.18。初轮将 serde_json 的声明下限 1.0.149 误作锁定版本，此处已核正。后续仅将锁文件已有的 png 0.17.16 增加为 dev-dependency，供独立渲染实验解码图片；不新增生产 Runtime/Sidecar。许可证增量见 [依赖审计](../DEPENDENCY_LICENSES.md)。

## 后续集中实施：B 协议闭环、C 视觉、D 草稿

### M0-B 后续证据

- [responses.rs](../../src-tauri/tests/support/responses.rs) 对照 [官方 Responses 事件契约](https://developers.openai.com/api/reference/resources/responses/streaming-events)，验证递增序号、item/call ID、文本/参数 delta 与 done 一致性、response.completed 与最终输出一致性；超限、异常结束或重复完成一律失败。
- 同一语义 fixture 在两个协议中得到相同公开文本与工具调用。Responses 原始 output items 单独保留，含合成 encrypted_content 的 reasoning item 不进入公开文本，续接原样带回；缺失/伪造工具结果被拒绝。
- [protocol_loop.rs](../../src-tauri/tests/support/protocol_loop.rs) 经真实 loopback HTTP 和 reqwest 异步读取完成 search→read→answer；服务端检查 call ID 和证据返回。[answer.rs](../../src-tauri/tests/support/answer.rs) 同时用于信封单测和闭环收尾，避免两套不同校验。
- 后续协议目标 13 测试、传输目标 7 测试通过。Responses 当前有界缓冲整轮再解析；不提供实时进度，不覆盖全部官方事件，未知事件拒绝，不声称任意 Provider 兼容。普通聊天仍完全未改。

### M0-C 受控视觉

布局先定为独立单页实验：标题/边界说明→操作按钮→状态/长收据→画布；支持空、加载/禁用、正常和拒绝状态，按钮可换行，无新增图标。入口不被生产主页面引用。

- 浏览器入口：`http://127.0.0.1:1420/src/preview/agent-spike/index.html`。数据仅来自仓库合成双页 PDF，复用现有 openPdf/MemoryRangeSource；题区为第 1 页固定矩形，不能被第 2 页替换。
- [agent_render_host.rs](../../src-tauri/examples/agent_render_host.rs) 是独立本地测试服务器，只绑定 `127.0.0.1:1431`，只分配三类合成任务，不允许路径、SQL、用户文件或模型调用。不是生产 Sidecar，不改变正式架构；正式桥接仍应使用 Tauri IPC。
- Rust 生成不可变任务并校验原任务/版本/epoch/期限，检查图片字节、像素与累计预算，用受限 png 解码器解码而非只信 IHDR，计算 SHA-256，一次 ACK。伪 PNG、过期/换页/换版本、重启后旧任务、重复提交和预算不重置有测试。
- TS 模拟 Host 也在验收侧解码 PNG；单测显式注入 header-only 假解码器，不能用这些假字节单测冒充真实图片解码。浏览器→Rust 往返另有真实 PNG 证据。
- 源码集中复核修正了重启清空累计图片预算、等待 PDF session 后未重验过期，以及仅检验图片头的简化边界；没有修改用户数据。

启动实验（只运行 debug example，不启动 Release EXE）：

```powershell
pnpm dev --host 127.0.0.1
cargo run --locked --manifest-path src-tauri/Cargo.toml --example agent_render_host
cargo test --locked --manifest-path src-tauri/Cargo.toml --example agent_render_host
```

内置浏览器实测：1440×900、1280×800、640×800、360×800；检查整页/题区、长哈希换行、错误拦截和窄屏滚动，未见遮挡或横向溢出。未调用真实 Tauri 页面/用户工作区。Rust example 4 测试通过。

| Rust Host 往返 | PNG 尺寸 | 字节  | 本轮耗时 | SHA-256                                                            |
| -------------- | -------- | ----- | -------- | ------------------------------------------------------------------ |
| 第 1 页        | 600×800  | 22664 | 91.9ms   | `30af2070fc33715cc6f49eca4db933d075b0ebb7a97e358f646c68a4c7e1e298` |
| 第 2 页        | 600×800  | 25664 | 52.1ms   | `5ff71e523275936886a2321333b27da6594a4be1f03e902b1c8d93a539518711` |
| 第 1 页题区    | 480×180  | 6769  | 25.0ms   | `0d11172210c993ed9ca30afc17564608910e998213e77079bc92b62e927c6adc` |

以上为当前 Windows 开发机、debug、本轮各一次的观察，不是 P95、冷启动基准或峰值内存测量；峰值内存、真实 WebView 路由/退出和 Tauri IPC 仍待后续集成验证。浏览器范围内的视觉证明不代替桌面验收。

### M0-D 固定选题与交接

- [practice.json](../../src/preview/agent-spike/fixtures/practice.json)：20 题、当天/历史作答、范围和三题型配额；Host seed=42、算法 weighted-xorshift32-v1、快照 synthetic-v1。Rust 与未修改的 TS generateWeightedPaper 使用同一黄金样本，选题为 q01/q06/q03/q07/q11/q09/q13/q17/q18/q14。
- Rust 6 测试覆盖确定性、去重/顺序稳定、当天排除、题量不足不扩权、非法配置、临时 SQLite 收据重开与 ACK CAS；审批拒绝或取消不交接。
- [practiceHandoff.ts](../../src/preview/agent-spike/practiceHandoff.ts) 显式接收隔离 Storage，调用既有 savePaperDraft/loadPaperDraft，不访问 browserStorage；先写交接日志再保存，保存后 ACK 前崩溃重放只对账，不重新抽题，不覆盖旧草稿/新作答。破损草稿/收据、存储失败、同 ID 换题均失败关闭。
- 这不是跨系统 exactly-once：SQLite 收据与前端日志分别验证，正式 Run/Artifact/审批事务、跨窗口 owner 和真实崩溃恢复留在 M1/M4/M5。首版迁移和应用版本仍未改变。

### M0-E 候选与人工介入点

仍推荐原生 Rust 单 Agent；下一真实测试候选先用 Chat Completions 函数工具协议，Responses 保留比较实验，不同时维护两套生产 Runtime。具体 Provider/模型尚未授权，不能冻结组合或标记 M0 通过。

已只读核对外部候选的固定 commit 与许可证，未安装、运行或复制其源码：

- Codex `ac192cd7937b0d73edc6dffe009940ae53782dd4`：[App Server README](https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/codex-rs/app-server/README.md)、[LICENSE](https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/LICENSE)、[NOTICE](https://github.com/openai/codex/blob/ac192cd7937b0d73edc6dffe009940ae53782dd4/NOTICE)。stdio、审批和中断为可参考接口；该版本仍标记 WebSocket 实验性，不据此引入 Sidecar。Apache-2.0，NOTICE 含 Ratatui 的 MIT 派生声明。
- Goose `5e90925962f05acf8e255032de44d16c4a7768a2`：[README](https://github.com/block/goose/blob/5e90925962f05acf8e255032de44d16c4a7768a2/README.md)、[LICENSE](https://github.com/block/goose/blob/5e90925962f05acf8e255032de44d16c4a7768a2/LICENSE)。通用 Provider/MCP 扩展范围大于本版固定学习工具；仅参考边界，不把扩展能力带入 KyStudy。Apache-2.0；未采用文件，未进行逐依赖分发审计。

下一步需要用户指定并授权测试 Provider/模型及费用上限，Key 仅在本机配置，不在聊天粘贴。用合成资料完成真实工具往返、视觉与取消/续接准入后，才能接受 ADR、冻结 M1 迁移。未授权期间不读取其他应用凭据、不运行付费请求，不以 Fake Provider 通过推定模型质量。

## 本批最终门禁

2026-09-06～2026-09-07 本批最终证据（不覆盖前述早期目标结果）：

| 门禁                                                 | 结果                                                 |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `pnpm check`                                         | 通过；85 文件 / 586 前端测试，生产前端构建成功       |
| `cargo fmt --all -- --check`                         | 通过                                                 |
| `cargo test --locked`                                | 通过；356 既有库测试 + 38 新增集成测试 = 394；0 失败 |
| `cargo clippy --locked --all-targets -- -D warnings` | 通过                                                 |
| `pnpm tauri build --no-bundle`                       | 通过；Release 编译 2m18s；未启动 EXE                 |
| 独立渲染 example                                     | 前述 4 测试通过；不重复计入 394                      |

全量 Rust 门禁后，HTTP fixture 补上保留历史消息及显式 tools Schema 的断言；受影响的闭环 1 测试和目标 Clippy 复验通过，再执行无捆绑构建。未以这次测试修正重新跑无关的前端全量检查。最终前端新增 16 测试，Rust 新增 38 集成测试及 4 example 测试，共 58 项实验测试。

构建产物仍为 v0.1.4 基线回归程序，不是 v0.1.5 功能发布：`src-tauri/target/release/kystudy.exe`，31,275,520 字节，2026-09-07 08:27:24 +08:00；SHA-256 `b4ac55e68820a8da58a1e1f460612484b967341c975d45b03a4702b3b4a2612c`。生产前端包未检出实验入口标记，临时 Vite/Rust 渲染服务器已停止；未启动 Release EXE。

本批只交付 M0 实验证据。M0 整体、真实模型准入、生产能力及用户桌面验收仍未通过；当前人工介入点为 M0-E 的 Provider/模型与测试费用授权，不要求用户验收尚不存在的生产 Agent 界面。

## 2026-09-07 后续：授权模型与 M1 内核

以上授权等待及构建记录为历史状态，不覆盖或重写。用户随后确认使用现有 DeepSeek Provider、`deepseek-v4-flash-vision-exp`，80,000 为总测试 Token 上限。只读查询本应用 Provider 配置并通过本应用凭据服务取 Key；未读取学习正文、未迁移用户数据库、未输出 Key。

`agent_model_probe` 仅使用合成资料和两张 32×32 PNG，按请求预扣保守预算，禁止自动门禁调用：

- 首次强制 `tool_choice` 返回 HTTP 400，保守预留 6,967 Token，实际用量未知。依据 [DeepSeek 官方说明](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/oh_my_pi/) 省略该字段，保留仅内存中的私有续接字段。
- 随后四次请求验证原生 `read_resource_pages` 调用、严格 document/revision/page 检查、配对工具结果及带来源回答，以及红/蓝图片识别；均通过。四次完成请求报告合计 1,610 Token；累计保守预留 30,838。
- 最后一次真实流式响应在读取首块后取消：任务 join 确认 canceled，资源释放标记为 true，本地取消耗时 0ms（毫秒精度），不声称远端停止计费。累计保守预留 **35,624 / 80,000**，剩余 **44,376**；失败及取消请求用量未知，不按零计算。无需重复已通过的付费探测。

M1 新增 Schema 31 四表（Scope/Run/Step/Event）、CAS/owner epoch、事务预算预扣与事件、独立串行 SQLite worker、持有取消句柄的异步 AgentTask，以及从已提交结果继续的 Fake Provider search-read-answer 链。19 项内核目标测试覆盖取消释放、超时、越界、并发 CAS、重开恢复、事件事务回滚与等待 Future 退出；另有迁移测试确认旧会话保留和新表为空。DTO 测试独立验证前端契约，不增加 UI。

本批没有生产 Agent 命令、界面或真实 Adapter；私有协议 checkpoint、普通聊天发送互斥及后续审批/交接仍待实现。接受 ADR 仅表示原生架构与首个协议组合有证据支持，不代表 M1 应用集成或 v0.1.5 已完成。新构建包含 Schema 31，不能当作已验收的 v0.1.4 发布包；用户数据库尚未升级，禁止代理启动 Release EXE。

### M1 内核批次门禁与桌面检查边界

2026-09-07 后续门禁：`pnpm check` 通过，86 文件 / 588 测试及前端生产构建；Rust fmt 通过。首次全量 Rust 测试为 373 通过 / 3 失败，原因是旧版备份/复习测试从新库模拟旧库时未删除 Agent 表，残留触发器引用已删除会话表；补齐三个夹具的子表清理后，三个目标测试及完整 Rust 测试通过：376 库测试 + 38 集成测试 = 414，0 失败。全目标 Clippy 首次报告扩展后的 v2 历史夹具超过 100 行；与 v3 夹具一致增加带原因的精确 lint expectation 后通过，未改变生产代码或放宽 SQL 约束。未重跑无关前端门禁。

桌面检查由用户执行：先在旧版本完整备份并退出应用，使用工作区副本测试升级，不直接覆盖唯一正式库。程序支持 `KYSTUDY_APP_DATA_DIR` 指向绝对路径的隔离数据目录（目录层级应包含 `workspaces/default`）。检查启动/重开、既有会话内容、题目与作答记录、备份导出；本批没有新 Agent 入口，不要求验收不存在的界面。旧程序回退应使用迁移前备份，不能打开已升级的 Schema 31 副本。代理未启动 EXE，也未宣称桌面验收通过。

本批 `pnpm tauri build --no-bundle` 成功，Release 编译 2m37s。开发产物 `src-tauri/target/release/kystudy.exe` 为 31,391,744 字节，时间 2026-09-07 20:01:55 +08:00，SHA-256 `ff53487e994bf72bc5aacb69fd193fa0d265f30fc1e586769e3271d095c5092e`。此为后续构建，不覆盖上方 M0 历史产物证据；版本号仍沿用开发基线 0.1.4，数据库已包含 Schema 31，不能作为正式 0.1.4 分发。

## 2026-09-08：用户验收与 Host 生命周期接入

用户确认上述 Schema 31 清单“全部通过”，记录见 [人工验收](../V0_1_5_M1_MANUAL_ACCEPTANCE.md)，不扩展到后续产物。

本批加入 AppState 单例 AgentHost、`get_agent_run` / `list_agent_events` / `cancel_agent_run` 命令；任务不由页面或请求监听方持有，取消清理会继续直到 abort/join 完成。无本 Host 句柄的活动 Run 不伪造取消成功。生产 start/resume、真实 Adapter、普通聊天互斥与 Agent UI 尚未接入。

Schema 32 保留旧 Run/Scope/Step/Event 及其历史策略，为新 Run 提供默认观察、仅提醒与主动限额三种模式。独立循环/时间保护不变；默认模式不因累计 Token 旧阈值停止，单请求输出额度由 Adapter 选择。迁移不改写 v31 文件及旧事件，事务失败回滚并恢复外键设置。

目标验证：26 项内核/Host 测试、2 项带历史数据迁移与回滚测试、2 项命令边界测试、3 项 DTO 测试通过。期间修正了旧 Fake Provider 的固定输出断言，并将迁移夹具改为符合 WAL/UUID 契约的临时文件数据库；未放宽生产约束。聚焦复核确认迁移收据保留、外键恢复、工作区隔离、任务持有与监听方退出清理。本批未调用真实模型、未启动 EXE、未操作用户数据库。

完整门禁：`pnpm check` 通过（86 文件 / 589 测试），Rust fmt、全量 Rust 测试（387 库测试 + 38 集成测试 = 425）、全目标 Clippy 均通过。无捆绑构建成功，Release 编译 2m46s。产物 `src-tauri/target/release/kystudy.exe` 为 31,717,376 字节，2026-09-08 12:43:53 +08:00，SHA-256 `e42350c41864e1755b40a7e618d7ebe9579902b85495d40410874885205ef76d`。旧产物记录保持不变；本构建数据库为 Schema 32，界面版本仍为开发基线 0.1.4，不作正式分发。新增迁移边界的 [人工验收清单](../V0_1_5_M1_SCHEMA32_ACCEPTANCE.md) 待用户执行。
