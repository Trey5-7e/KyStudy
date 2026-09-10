# v0.1.5 核心功能开发与 UI 对接

## 2026-09-10：请求上下文证据去重

对应开发计划 8.3、9.3。仅修改 Rust DeepSeek 请求构造，不修改 UI、Tauri DTO、数据库或迁移。

- 在每个待发送请求内部，对工具种类、文档、版本、页码、query、offset 及完整回执逐项匹配。只规范化调用 ID 和等价的未填/零起始位置，不归并不同查询空白或不同页段。
- 首份证据完整保留，完全重复且引用更短时，后续工具消息使用 `source_id + duplicateOfCallId + note`。引用直接指向同一请求中的第一份完整证据，绝不指向另一个引用或上一请求。
- 所有原生 assistant/tool 消息与 call ID 配对仍保留，必要私有续接不变。公开 Run、工具回执、来源核验和备份均保持原样。派发前已有授权、版本及取消校验不变。
- 输入预估使用实际压缩后的请求体；不增加模型请求、不执行摘要模型、不改变用户用量策略。不删除不同内容来强行适配限制。
- 对残缺调用、错配回执、重复 call ID、来源不匹配或缺失私有续接返回稳定错误，不猜测恢复。

验证：13 项 DeepSeek 目标测试通过；重复中文长回执 fixture 的工具 content 字节下降超过 45%，唯一证据完整保留。此指标不是整段请求或供应商账单节省比例，也不代表真实教学质量已经验收。完整门禁：`pnpm check` 88 文件 / 614 项、Rust fmt、415 库 + 38 集成 = 453 项测试、全目标 Clippy、无捆绑构建通过（Release 2m36s）。

### UI agent 对接

本批无 UI 接口变更。前端继续读取原始完整 `AgentDetail.results`，不要将 `duplicateOfCallId` 当作新的公开结果类型，也无需添加开关或压缩提示。UI agent 拥有界面文件；核心开发不调整布局、样式或交互。

### 后续核心工作

M2 尚待完成授权范围内的跨页排名检索和受控视觉渲染。视觉桥接需要先冻结 RenderJob/完成回执/取消与错误的后端契约，再交给 UI agent 对接现有 PDF.js；本批没有注册视觉工具或声称图片研读可用。先前阅读体验构建的桌面验收仍待用户反馈，不能因继续开发而视为已通过。

## 本批构建与人工回归

本批未启动 Release EXE、未读取用户数据、未发起付费模型请求。Schema 仍为 32，界面版本仍为开发基线 0.1.4。

| 项目    | 核心增量构建                                                       |
| ------- | ------------------------------------------------------------------ |
| 路径    | `F:\develop\KyStudy\src-tauri\target\release\kystudy.exe`          |
| 时间    | 2026-09-10 13:38:24 +08:00                                         |
| 大小    | 32,723,456 字节                                                    |
| SHA-256 | `c25e1c36ad0e83b00c56e5a52c6b4f27e4eada04e570f9db60dc0f106d9c8d85` |

这是新的核心增量构建，不覆盖 2026-09-09 阅读体验构建的历史门禁或验收结果。开发 EXE 路径已更新，旧清单的哈希保护会拒绝当前 EXE；使用下方对应命令。

保留原始完整备份。在旧程序中创建并校验备份后正常退出所有 KyStudy 窗口，把完整数据目录复制到新的 `F:\develop\KyStudy\artifacts\manual-acceptance\m2-core-20260910\data`，包括数据库和 Blob/资料目录。目标存在则换新路径，不覆盖正式数据、原备份或已验收副本。以下命令由用户主动执行；在“设置 → 数据”确认实际目录是该副本。

```powershell
$acceptanceData = 'F:\develop\KyStudy\artifacts\manual-acceptance\m2-core-20260910\data'
$acceptanceExe = 'F:\develop\KyStudy\src-tauri\target\release\kystudy.exe'
$previousDataOverride = $env:KYSTUDY_APP_DATA_DIR
if (-not (Test-Path -LiteralPath "$acceptanceData\workspaces\default\kystudy.sqlite3" -PathType Leaf)) {
    throw '请先准备完整的隔离副本。'
}
if ((Get-FileHash -LiteralPath $acceptanceExe -Algorithm SHA256).Hash -ne 'c25e1c36ad0e83b00c56e5a52c6b4f27e4eada04e570f9db60dc0f106d9c8d85') {
    throw '构建不匹配，请索取对应验收说明。'
}
try {
    $env:KYSTUDY_APP_DATA_DIR = $acceptanceData
    Start-Process -FilePath $acceptanceExe -Wait
} finally {
    $env:KYSTUDY_APP_DATA_DIR = $previousDataOverride
}
```

回归项：

- 选择允许发送到现有 DeepSeek Provider 的非敏感、已索引页面，要求解释并核对两个事实。预期回答和来源正常，过程没有协议错误。
- 对上一条回答追问一个需要再次核对页面的问题。预期引用仍可打开，回答不把“重复引用提示”当作教材原文。不要求模型强行重复调用；精确重复分支由确定性测试覆盖，实际未触发可注明。
- 检查完成记录与来源对照仍包含完整已读片段；取消后普通对话仍可用。若尚未执行上一版的阅读体验 R1–R8，可用本构建和本节隔离命令执行那些用例，但应注明实际哈希，不追认旧构建已通过。

失败时取消任务，保留副本和脱敏截图；不要上传 Key、数据库或私有续接。工作区占用时正常退出重复实例，不删除锁文件；不要把失败副本覆盖回正式目录。

```text
核心证据去重回归：
实际构建 SHA-256：
隔离副本已确认：是 / 否
回答事实 / 来源 / 追问 / 取消：
重复调用：已观察 / 未触发
失败文案及脱敏截图：
```
