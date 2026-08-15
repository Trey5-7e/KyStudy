# R40 新建周期计划资料选择验收

R40 将已导入的规划资料选择收进“新建周期计划”窗口，保留结构化周期计划卡片流程，不恢复旧版独立规划对话入口。

## 1. 目标与契约

- 资料列表复用本地 `listResources`，只展示 `role === "planning"` 的资源；没有规划资料或列表读取失败时，仍可直接输入关键词和手动建立计划。
- 用户可在同一窗口勾选、移除资料；选择资料后，页片段搜索只接受已选资料的 `page_text` 结果。未选择资料时保留全库关键词搜索路径。
- 资料范围变化会清理旧搜索结果，并按当前范围保留或移除已选页片段，避免将旧范围内容继续送入预览。
- 外发 prompt 只包含用户明确勾选的页文本、页码和人类可读来源名；本地路径、资源 ID 不进入 prompt 或预览。AI 请求仍必须先通过显式预览确认。
- 加载、搜索、预览和执行请求采用最新请求优先并支持卸载保护；busy 时锁定会影响 prompt、预览和草案的输入、选择及操作控件。

## 2. 定向验证

`CyclePlanAiAssistant.test.ts` 共 10 项定向测试通过，覆盖：

- 规划角色筛选；
- 资料选择与移除；
- 当前资料范围下的页片段和无资料全库回退；
- 范围变化后的上下文清理与搜索状态重置；
- latest-wins 请求判定；
- prompt 来源名路径清理、资源 ID 隔离和页文本边界；
- 结构化计划卡片解析与无效结果拒绝。

本轮 focused gate 已通过：

```text
pnpm check:target -- src/features/planning/CyclePlanAiAssistant.tsx src/features/planning/CyclePlanAiAssistant.test.ts src/app/app.css
```

该命令覆盖 Prettier、ESLint、TypeScript 和相关 Vitest。本轮完整交付门禁已通过：前端 `pnpm check` 共 41 个测试文件、255 项测试通过；Rust `cargo fmt --all -- --check`、`cargo test --locked`（245 项测试通过）及 `cargo clippy --locked --all-targets -- -D warnings` 均通过；`pnpm tauri build --no-bundle` 构建成功。

## 3a. R40 完整门禁证据

- 前端：41 个测试文件、255 项测试通过；Prettier、ESLint、TypeScript 和生产构建通过。
- Rust：245 项测试通过；格式检查和 Clippy（`-D warnings`）通过。
- Tauri 构建产物：`F:/develop/KyStudy/src-tauri/target/release/kystudy.exe`。
- SHA256：`8C6C91F9AE07251B3CCA07E402FA4FC65AF510034A21B3AAC5829B44E747BD7B`。

## 3. 桌面验收点

用户在 Release WebView 中确认：

1. 打开“新建周期计划”并展开 AI 辅助区，规划资料列表加载、空列表和失败重试均不阻断手动建计划。
2. 勾选一个或多个规划资料后搜索，结果只来自已选资料；移除资料后旧结果消失，可重新搜索；不勾选资料时可搜索全部已索引资料。
3. 仅勾选页片段并生成外发预览，确认预览中的来源为文件名和页码，不出现本地路径或资源 ID；取消预览不会发送请求。
4. 在搜索、预览和执行忙态确认输入、资料/页片段复选框、草案编辑与采用操作均不可修改；窄窗口下内容不横向溢出。

不启动或代替用户验收 Release EXE。
