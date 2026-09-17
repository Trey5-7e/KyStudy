# ADR-007：Learning Agent Harness 候选运行时

| 项目       | 内容                                               |
| ---------- | -------------------------------------------------- |
| 状态       | accepted（原生内核与首个协议组合；非产品验收）     |
| 日期       | 2026-09-06 提议；2026-09-07 接受                   |
| 相关需求   | v0.1.5 R1～R8                                      |
| 相关验证   | TV-08（Learning Agent 运行时验证）                 |

## 上下文与候选

学习 Agent 需要本地范围授权、有界工具执行、真正可取消的模型传输、受控 PDF.js 视觉及现有草稿交接。原生 Rust Harness 为当前候选；外部 Harness 嵌入仅作为备选，改变运行时须用户确认。

## 当前决定

采用原生 Rust 单 Agent Harness；首个组合为现有 DeepSeek Provider 的 `deepseek_chat` 协议与 `deepseek-v4-flash-vision-exp`。首轮独立实验不注册命令或修改数据库；后续 M1 已加入 Schema 31、持久化状态与异步任务内核，尚未接入生产命令或改变普通聊天。M0 同步实现不作为生产 Runtime。

## 证据与限制

TV-08 已有本地工具闭环、授权拦截、次数/时间预算、异步传输释放、两协议 fixture 比较、私有续接保留、Rust/PDF.js 跨进程 PNG 验收、跨语言固定 seed 及隔离草稿/SQLite 收据实验。当前推荐原生 Rust，真实准入先测试 Chat Completions 函数协议；独立 loopback 渲染服务器仅为实验，不是生产 Sidecar。

用户已授权现有 Provider、上述模型和总计 80,000 Token 测试上限。真实工具调用/结果续接、两次合成 PNG 识别及流式请求取消释放已通过；累计保守预留 35,624 Token。首轮强制 tool_choice 被拒，改为省略该字段后通过；私有 reasoning_content 只在内存中原样续接。完整记录见 TV-08。这不证明通用教学质量、重启后的私有协议恢复、真实 WebView/Tauri IPC 或生产跨存储幂等。固定 Codex/Goose commit 和采用代码清单见 TV-08；未复制外部 Harness 代码。

## 后续与复审条件

M1/M4 把已验证窄接口接入正式命令、事件和交接；真实 Adapter、私有协议 checkpoint、普通聊天互斥及 UI 仍待接入。Schema 31 尚未在用户数据库执行；开发构建需备份后由用户进行桌面验收。关键接缝失败时报告具体假设及备选；不得静默降低 P0、扩大外发范围或超出测试 Token 上限。
