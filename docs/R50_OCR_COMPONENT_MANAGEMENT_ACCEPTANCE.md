# R50 可选 OCR 组件安装、校验、修复与移除验收

R50 补齐交接文档第一阶段中可选 OCR sidecar 的本地组件管理：用户可以从本地选择完整组件目录，应用会在受控目录中原子安装并检测固定文件；同一入口可重新安装修复或移除组件。组件仍不进入主安装包，不联网下载，PDF 阅读、文字层索引和人工题目管理不依赖 OCR。

当前状态：实现完成；定向自动验证和完整 Release 自动门禁通过；桌面人工验收待项目负责人执行。本文不宣称 OCR 组件桌面验收或整体 v0.1.0 发布门禁已经通过。

## 1. 冻结的行为边界

- 组件来源必须是用户主动选择的本地文件夹；取消选择不产生写入；
- 安装前检查 `kystudy-ocr-worker.exe`、RapidOCR 三个模型文件和 ONNX Runtime 文件是否存在且为普通文件；
- 安装写入应用管理的 `components/ocr/kystudy-ocr-worker`，先复制到临时目录，再原子替换旧组件；失败时保留旧组件；
- 组件状态只返回 `missing`、`incomplete` 或 `available`、引擎标识、模型是否随组件提供和目录大小，不返回绝对路径；
- Release 构建只读取应用管理目录，不读取仓库内 Debug 开发 sidecar；因此 Release 验收可以真实进入“未安装”状态；
- “习题册”主页面顶部提供独立的“OCR 组件”入口；不需要先打开浏览题目索引，也不依赖旧版题目详情页面；
- “浏览题目索引”窗口的题目卡片下方已恢复“本地文字识别”面板；每个已保存题目区域可直接识别，结果支持确认或丢弃；
- “修复组件”复用安装流程，可以用同版本完整目录替换现有组件；
- “移除组件”只删除应用管理的组件目录，不删除 PDF、题目、OCR 历史草稿或已确认文本；
- OCR 正在运行时，安装、修复和移除被稳定错误 `OCR_OPERATION_CONFLICT` 阻止；
- 组件操作不执行网络请求，不向 WebView 暴露源路径、目标路径或文件清单内部路径。

## 2. 自动验证证据

本批修改范围：

- `src-tauri/src/application/ocr.rs`；
- `src-tauri/src/infrastructure/ocr_worker.rs`；
- `src-tauri/src/commands/mod.rs`；
- `src-tauri/src/bootstrap/mod.rs`；
- `src-tauri/src/lib.rs`；
- `src/shared/tauri/ocrClient.ts`；
- `src/shared/tauri/ocrClient.test.ts`；
- `src/features/workbook/QuestionOcrPanel.tsx`。
- `src/features/workbook/OcrComponentManagementDialog.tsx`；
- `src/features/workbook/QuestionBankPanel.tsx`。
- `src/features/workbook/QuestionIndexDialogs.tsx`；
- `src/features/review/QuestionRegionCard.tsx`。

已执行：

```powershell
pnpm check:target -- src/shared/tauri/ocrClient.ts src/shared/tauri/ocrClient.test.ts src/features/workbook/QuestionOcrPanel.tsx
cargo check --locked --manifest-path src-tauri\\Cargo.toml --lib
cargo fmt --all --manifest-path src-tauri\\Cargo.toml -- --check
cargo clippy --locked --manifest-path src-tauri\\Cargo.toml --lib --tests -- -D warnings
cargo test --locked --manifest-path src-tauri\\Cargo.toml infrastructure::ocr_worker::tests --lib
```

结果：前端定向检查通过，相关 Vitest 通过 7 项测试；Rust `cargo check`、格式检查和 Clippy 通过；OCR worker 定向测试通过 5 项，覆盖完整目录安装、原子替换、不完整来源拒绝和移除清理。

完整交付门禁已在本批准备交付时执行：`pnpm check` 通过（59 个测试文件、373 项测试），`cargo fmt --all -- --check` 通过，`cargo test --locked` 通过（287 项测试），`cargo clippy --locked --all-targets -- -D warnings` 通过，`pnpm tauri build --no-bundle` 通过。

本批桌面验收应运行最新 Release 文件：

```text
F:\\develop\\KyStudy\\src-tauri\\target\\release\\kystudy.exe
```

构建后只读核对：文件大小 `25,804,800` bytes，UTC 修改时间 `2026-08-13 12:45:23`，SHA-256：

```text
786A85DE58004CE2DC2012F9548AA4A7002BC8323904481639DC4E434CDA1220
```

构建完成后未启动 EXE，当前没有残留 `kystudy` 进程。复制或移动 EXE 后验收前请重新计算 SHA-256。

## 3. 桌面验收步骤

### A. 缺失组件与版本/完整性状态

准备“没有应用管理 OCR 组件”的环境（推荐）：

1. 使用本文记录的最新 Release EXE 启动应用；Release 不会读取仓库内开发 sidecar。
2. 在“习题册”主页面顶部点击“OCR 组件”。
3. 如果当前用户数据中已经安装过组件，在管理窗口点击“移除组件”并确认，再点击“重新检测”。移除操作只处理应用管理的 OCR 目录，不要删除整个应用数据目录。
4. 确认管理窗口显示“OCR 组件未安装 · 可选离线组件”，并提供“安装 OCR 组件”。
5. 确认管理窗口不显示绝对路径、内部 storage key 或临时目录。

### F. 题目区域文字识别

1. 关闭“OCR 组件管理”窗口，打开“浏览题目索引”。
2. 在左侧题目列表选择一道题；题目卡片下方应显示“本地文字识别”。
3. 对已有题目图片区域点击“识别区域”。
4. 确认识别结果以草稿形式出现，可编辑后点击“确认文本”，或点击“丢弃草稿”。
5. 组件未安装时，确认识别按钮不可用，但题目浏览、PDF 阅读和题目区域管理仍可用。

预期：OCR 缺失只阻止 OCR 操作，不阻止 PDF 阅读、题目浏览和人工录入。

### B. 安装完整组件

1. 使用公开的 OCR sidecar 输出目录 `kystudy-ocr-worker` 作为测试来源；不要选择其父目录。
2. 点击“安装 OCR 组件”，选择完整组件文件夹。
3. 等待安装完成后点击“重新检测”。
4. 确认状态变为“OCR 组件可用”，显示引擎版本标识 `rapidocr-3.9.2-ppocrv6-small-onnx-cpu`、完全离线和目录大小。
5. 点击“识别区域”，确认现有 OCR 流程仍可启动；取消或完成识别后，题目原图和索引仍可用。

预期：安装完成后只在应用管理目录生成组件副本；页面不显示来源路径或管理目录路径。

### C. 不完整来源、修复和失败保护

1. 准备一个只含 `kystudy-ocr-worker.exe`、缺少模型文件的目录。
2. 点击“修复组件”或“安装 OCR 组件”，选择该不完整目录。
3. 确认显示稳定错误“所选文件夹不是完整的 KyStudy OCR 组件”，并保留此前可用组件。
4. 再选择完整目录执行“修复组件”。
5. 点击“重新检测”，确认组件恢复为 `available`。

预期：不完整来源不会覆盖旧组件，不留下半条安装结果，不改变题目、PDF 或 OCR 历史。

### D. 移除与保留数据

1. 在组件可用状态点击“移除组件”。
2. 确认二次提示后继续；取消提示则不产生变化。
3. 点击“重新检测”，确认 Release 构建状态回到 `missing`；仅 Debug 开发环境在仓库内存在受控开发 sidecar 时，才可能继续显示该开发组件可用。
4. 打开同一道题，确认已有 OCR 草稿/确认文本、题目区域和 PDF 阅读仍然存在；OCR 识别按钮在组件缺失时不可用。

预期：移除只影响可选 OCR 组件，不删除业务数据；重新安装后历史 OCR 数据仍可读取。

### E. 并发与响应式

1. 启动一次 OCR 识别，在进程尚未结束时尝试修复或移除。
2. 确认操作被禁用或返回“已有 OCR 操作仍在运行”，不会破坏正在使用的组件。
3. 在约 `640px`、`360px` 窄窗口检查按钮、长引擎标识和错误文案，确认无整体横向溢出。

## 4. 结果记录

请项目负责人执行后补充：

```text
构建来源/版本：
操作系统与架构：
OCR sidecar 来源：
执行日期：
A. 缺失组件与状态：通过 / 失败
B. 安装完整组件：通过 / 失败
C. 不完整来源、修复和失败保护：通过 / 失败
D. 移除与数据保留：通过 / 失败
E. 并发与响应式：通过 / 失败
失败步骤、截图或稳定错误码：
备注：
```

当前记录状态：桌面人工验收待执行。P0/P1 缺陷未在自动验证中发现；本批完整门禁和最新 Release 构建证据已记录于本文“自动化验证证据”一节。

## 5. 2026-08-15 桌面人工验收追加记录

项目负责人已确认 R50 本地 OCR 组件管理验收通过，覆盖本文件列出的缺失组件、完整安装、修复与失败保护、移除与数据保留、并发与响应式场景。该确认作为桌面人工验收结果记录；OCR 组件管理不再是 v0.1.0 的待验收项。
