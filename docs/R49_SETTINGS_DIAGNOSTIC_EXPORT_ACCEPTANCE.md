# R49 设置页运行诊断与脱敏导出验收

R49 补齐交接文档第七阶段中“设置、备份恢复、迁移兼容、错误诊断”的设置页入口：运行诊断统一放在“设置 → 数据”，用户可以查看非敏感运行摘要，在确认导出内容后下载 JSON。备份、恢复和历史兼容工具仍保留在同一数据页；本批不改变它们的命令或数据语义。

当前状态：实现完成；定向自动验证、完整 Release 自动门禁和桌面人工验收均已通过。本文不宣称整体 v0.1.0 发布门禁已经通过。

## 1. 验收范围

### 1.1 页面入口

- 打开“设置”后，默认仍进入“学习与考试”；
- 点击“数据”后，运行诊断位于备份与恢复入口之前；
- “应用”页只保留本地行为与边界说明，不再重复显示版本、Schema、平台和架构。

### 1.2 运行摘要

诊断摘要只显示以下信息：

- 应用版本；
- Schema 版本；
- 平台与架构；
- 工作区是否已初始化；
- 已初始化工作区的时区。

工作区尚未初始化时显示“尚未初始化”，不得创建空工作区或伪造工作区信息。

### 1.3 导出内容

点击“预览导出”后，页面显示完整 JSON 内容和“导出 JSON / 取消”操作。导出文件名格式为：

```text
kystudy-diagnostic-YYYYMMDDHHmmss.json
```

报告包含固定的 `formatVersion`、生成时间、运行摘要、工作区摘要和排除项说明。报告不得包含：

- 学习资料、PDF、题图、题目正文；
- API Key、密钥或凭据；
- 绝对路径、SQL、请求正文或 AI 响应；
- 临时文件、日志原文或堆栈。

## 2. 自动验证证据

本批修改文件：

- `src/features/settings/SettingsPanel.tsx`；
- `src/features/settings/settings.css`；
- `src/features/settings/diagnosticReport.ts`；
- `src/features/settings/diagnosticReport.test.ts`。

已执行：

```powershell
pnpm check:target -- src/features/settings/SettingsPanel.tsx src/features/settings/SettingsPanel.test.ts src/features/settings/diagnosticReport.ts src/features/settings/diagnosticReport.test.ts src/features/settings/settings.css
pnpm check:target -- src/features/settings/SettingsPanel.tsx src/features/settings/diagnosticReport.ts
```

结果：两次均通过 Prettier、ESLint、TypeScript；相关 Vitest 共通过 10 项测试。测试覆盖运行摘要字段、工作区未初始化、敏感工作区 ID/名称剥离和安全文件名生成。

本批未修改 Rust、SQLite、迁移、备份格式或 Tauri Command；为保证桌面验收使用最新工作树，仍按交接文档要求执行了完整 Rust 门禁和 Tauri Release 构建。自动验证不能替代以下桌面验收。

## 2.1 当前验收构建证据

为确保桌面验收使用当前工作树的最新代码，已在 `2026-08-13` 按固定顺序完成完整门禁：

| 门禁                                                                                       | 结果                                                  |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `pnpm check`                                                                               | 通过；59 个测试文件、372 项测试通过，前端生产构建通过 |
| `cargo fmt --all --manifest-path src-tauri\\Cargo.toml -- --check`                         | 通过                                                  |
| `cargo test --locked --manifest-path src-tauri\\Cargo.toml`                                | 通过；285 项测试通过                                  |
| `cargo clippy --locked --all-targets --manifest-path src-tauri\\Cargo.toml -- -D warnings` | 通过；无警告                                          |
| `pnpm tauri build --no-bundle`                                                             | 通过；生成 Release EXE                                |

桌面验收应运行以下文件：

```text
F:\\develop\\KyStudy\\src-tauri\\target\\release\\kystudy.exe
```

构建后只读核对：文件大小 `25,608,192` bytes，UTC 修改时间 `2026-08-13 06:50:26`，SHA-256：

```text
75BE8458C4928CABC11B3C95444C870142FEB5A2E60B1E91FAAE8F0D28C95F05
```

构建完成后未启动 EXE，当前没有残留 `kystudy` 进程。若复制或移动 EXE 后再验收，建议先重新计算 SHA-256，确认与上述值一致。

## 3. 桌面验收步骤

### A. 数据页入口与状态

1. 使用当前 Release/验收构建启动应用。
2. 打开“设置”，确认默认选中“学习与考试”。
3. 点击“数据”。
4. 确认页面顶部出现“运行诊断”，其后仍有“完整本地备份”和历史兼容工具入口。
5. 在已有工作区中核对应用版本、Schema、平台/架构和工作区时区均显示；确认页面没有显示数据库路径、工作区 ID 或其他内部字段。
6. 在无工作区的测试环境中打开“数据”，确认显示“尚未初始化”，且不会自动创建空工作区覆盖现场。

预期：运行诊断只在“数据”页出现；诊断加载失败时显示稳定的用户提示和“重新检查”，不显示 SQL、绝对路径、堆栈或原始内部错误。

### B. 导出前预览

1. 在“运行诊断”中点击“预览导出”。
2. 确认出现“导出前预览”区域，JSON 可滚动查看。
3. 在预览文本中确认包含 `formatVersion`、`generatedAt`、`runtime`、`workspace` 和 `exclusions`。
4. 使用“取消”关闭预览，确认未生成下载文件。
5. 再次打开预览，点击“关闭”，确认回到诊断摘要且页面不跳转。

预期：预览内容与当前页面状态一致；取消、关闭和切换设置页不会修改工作区、备份或其他业务数据。

### C. JSON 导出与敏感信息检查

1. 再次打开“预览导出”，点击“导出 JSON”。
2. 在浏览器/系统下载目录中找到 `kystudy-diagnostic-*.json`。
3. 用文本编辑器打开文件，确认 JSON 可解析且文件名不包含路径分隔符。
4. 搜索以下关键词或内容，确认均不存在：
   - 当前工作区绝对路径；
   - 工作区 ID、工作区名称或 PDF 文件名；
   - `apiKey`、`secret`、`token`、凭据内容；
   - `SELECT`、SQL、Prompt、AI 响应或堆栈。
5. 确认导出文件只包含运行摘要、非敏感工作区摘要和排除项说明。

预期：导出成功，不影响当前工作区；文件内容不包含学习资料、PDF、题图、密钥、路径、SQL、请求正文或 AI 响应。

### D. 响应式与键盘路径

1. 在宽窗口和窄窗口分别打开“数据”页。
2. 将窗口缩窄至约 `640px`、`360px` 和更窄尺寸，确认诊断摘要、预览文本和按钮不横向溢出。
3. 使用键盘在设置页标签之间移动，进入“数据”后聚焦“预览导出”。
4. 使用键盘打开预览，依次聚焦关闭、取消和导出按钮。

预期：长 JSON 自动换行或在局部区域滚动；设置页不出现意外的整体横向滚动条；所有操作按钮可聚焦且有明确可见文案。

## 4. 结果记录

项目负责人已执行并确认：

```text
构建来源/版本：当前 Release 构建，v0.1.0 / Windows x64
工作区前置状态：已有本地工作区
A. 数据页入口与状态：通过
B. 导出前预览：通过
C. JSON 导出与敏感信息检查：通过
D. 响应式与键盘路径：通过
失败步骤、截图或稳定错误码：无
备注：运行诊断摘要、预览和 JSON 导出均符合脱敏边界。
```

当前记录状态：R49 桌面人工验收通过。P0/P1 缺陷未在本批发现；完整 Release 自动门禁已通过。Windows 安装器验收、其余历史链路的当前版本复核和整体 v0.1.0 发布门禁仍需单独记录。
