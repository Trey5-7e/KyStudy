# M1 后续批次：Schema 32 人工验收

状态：用户于 2026-09-08 确认“全部通过”。本清单保留为该构建的历史验收记录，结论不扩展到后续产物。

上一份 [Schema 31 清单](V0_1_5_M1_MANUAL_ACCEPTANCE.md) 已由用户确认全部通过，本清单只覆盖新增迁移边界，不要求重复模型连接或完整功能测试。此次迁移替换 Agent 运行表的约束；真实模型启动、Agent UI 及配置选择器尚未接入，不需要寻找新按钮。

## 1. 保留已通过的副本

1. 保留上次生成并校验通过的完整备份。正常退出所有 KyStudy 窗口，确认没有后台导入、OCR 或 AI 请求。
2. 把**已验收的整个数据目录**再复制一份到新位置，例如 `F:\develop\KyStudy\artifacts\manual-acceptance\schema32-20260908\data`。以你上次实际使用的路径为源，不猜测正式数据位置。不要覆盖 Schema 31 副本或正式数据；目标存在则换一个新名称。
3. 新目录内应包含 `workspaces\default\kystudy.sqlite3` 和完整资料子目录，不只复制 SQLite 文件。保留原副本作为回退，不用旧程序打开升级后的新副本。

## 2. 指定构建与隔离启动

| 项目     | 本次构建                                                           |
| -------- | ------------------------------------------------------------------ |
| 程序     | `F:\develop\KyStudy\src-tauri\target\release\kystudy.exe`          |
| 构建时间 | 2026-09-08 12:43:53 +08:00                                         |
| 大小     | 31,717,376 字节                                                    |
| SHA-256  | `e42350c41864e1755b40a7e618d7ebe9579902b85495d40410874885205ef76d` |
| 版本显示 | 仍为开发基线 0.1.4；数据库为 Schema 32，不是正式发布包             |
| 自动门禁 | 前端 589 项、Rust 425 项测试，fmt、全目标 Clippy、无捆绑构建均通过 |

完成副本复制后，手动在 PowerShell 执行下列代码；若使用其他新目录，仅修改 `$acceptanceData`。每次重开均使用此命令，不直接双击 EXE，以免使用默认数据目录。命令不设置永久环境变量，也不代替备份。

```powershell
$acceptanceData = 'F:\develop\KyStudy\artifacts\manual-acceptance\schema32-20260908\data'
$acceptanceExe = 'F:\develop\KyStudy\src-tauri\target\release\kystudy.exe'
$previousDataOverride = $env:KYSTUDY_APP_DATA_DIR
if (-not (Test-Path -LiteralPath "$acceptanceData\workspaces\default\kystudy.sqlite3" -PathType Leaf)) {
    throw '未找到新副本数据库，请先完成复制。'
}
if ((Get-FileHash -LiteralPath $acceptanceExe -Algorithm SHA256).Hash -ne 'e42350c41864e1755b40a7e618d7ebe9579902b85495d40410874885205ef76d') {
    throw '构建已变化，请索取对应验收文档。'
}
try {
    $env:KYSTUDY_APP_DATA_DIR = $acceptanceData
    Start-Process -FilePath $acceptanceExe -Wait
} finally {
    $env:KYSTUDY_APP_DATA_DIR = $previousDataOverride
}
```

## 3. 精简检查

| 编号 | 操作                                                                  | 预期                                                          | 结果            |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------- | --------------- |
| B1   | 隔离启动后进入“设置 → 数据”，检查数据目录，再打开“导出诊断摘要”的预览 | 数据目录为新副本；`workspace.schemaVersion` 为 32；无迁移错误 | ☐ 通过 / ☐ 失败 |
| B2   | 查看上次验收的会话、PDF、题目作答历史及“M1验收-可删除”任务            | 原数据仍在，PDF 可以打开，任务状态保留；无需发新 AI 消息      | ☐ 通过 / ☐ 失败 |
| B3   | 完全退出，使用相同隔离启动命令重开                                    | 正常进入同一副本，版本仍为 32，B2 数据未变化                  | ☐ 通过 / ☐ 失败 |
| B4   | 在新副本创建完整备份，然后“验证并生成恢复副本”，分别使用新的输出目录  | 两步均提示校验通过；当前工作区没有被替换，旧备份没有被覆盖    | ☐ 通过 / ☐ 失败 |

缺少样本时写“不适用及原因”，不算作通过。普通 Token 模式选择、Host 句柄所有权和取消监听方退出场景由本批自动化测试覆盖，不要求通过不存在的界面手工验证。

## 4. 失败与回传

任何一步失败就停止，保留新副本与错误截图/操作编号，不删表、不修改 schema 版本、不反复用旧版尝试打开。继续使用原本未改动的程序/数据；若无法确认旧程序和原数据匹配，先反馈，不覆盖恢复。不要上传数据库、备份或密钥；诊断摘要先预览脱敏。

```text
Schema 32 验收：B1 / B2 / B3 / B4（全部通过，或逐项结果）
确认使用新副本：是 / 否
错误文案、操作编号、截图（如有）：
```

通过仅代表本构建的数据迁移与既有功能回归通过，不代表完整 v0.1.5 已完成。代理未启动 EXE，未执行用户数据库升级。
