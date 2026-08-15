# R10 前端样式维护审计

| 项目   | 内容                                             |
| ------ | ------------------------------------------------ |
| 状态   | completed（2026-07-31）                          |
| Schema | v16，不新增迁移                                  |
| 边界   | 只清理无活动组件引用的 CSS，不改变业务流程和数据 |

## 1. 已清理范围

- 已删除 `TodayTaskPanel` 及其任务详情、改期、拆分和历史子组件的专用样式；
- 已删除旧 `SubjectManager` 的表单、列表和归档样式；
- 已删除旧 `AnalyticsPanel` 的指标卡、柱状图、知识点和复杂统计样式；
- 已删除上述页面对应的窄屏和中等宽度响应式规则；
- 保留周日程、学习记录、回收站和科目统计仍使用的公共规则；
- 保留当前“今日”页的 `today-task-*` 规则以及全局危险操作按钮样式。

## 2. 安全依据

- 先在活动 TypeScript/TSX 入口中检索每组选择器；
- 仅删除活动组件零引用的规则；
- 对包含活动与旧选择器的组合规则只移除旧选择器，不删除整条规则；
- 不删除 Rust Command、SQLite 表、迁移、备份字段或兼容页面；
- `app.css` 从约 110 KB 降至约 97 KB。

## 3. 验证范围

- 前端格式、TypeScript、ESLint、单元测试与生产构建；
- Rust 全量测试与 Clippy；
- Tauri Release 构建；
- 该批次没有新增人工业务验收项，打开 5 个一级页面无样式缺失即可。

## 4. R36 后续清理（2026-08-10）

R36 延续“活动组件零引用才删除”的边界，完成以下维护：

- 删除 R34 后已退出 DOM 的 `app-page-header`、`app-page-context` 和 `app-loading` 规则；
- 删除 R33 已替换的 `review-image-dialog`、`review-image-dialog-toolbar` 和 `review-image-pan` 规则及响应式残留；
- 合并重复的 `page-surface` 基础规则，保留唯一宽度、边框、背景和间距来源；
- 删除无组件引用的旧 `state-banner`、`question-bank-state-banner` 和未开放的 surface variant；
- 保留 `review-region-expanded`、safe-area、`100dvh`、焦点、缩放拖动和 reduced-motion 规则；
- 删除已退出活动源码的旧自研导图树和旧 active-mistake 列表样式；保留当前 Mind Elixir 工具栏与活动导图页面规则；
- 删除 R34 已替换的旧 Today/Cycle/Resource/Settings/QuestionBank 页头规则，以及旧题库浏览器、旧错题队列和旧 workbook mode 样式；
- `app.css` 在当前 R34 基线上合计减少约 1,000 行，现为 8,463 行；不修改 React、Rust、数据库或 Tauri 配置。
- 新增只读 `pnpm audit:css`，以后先生成零引用候选和重复定义摘要，再对候选做精确源码核验；命令不自动删除样式。

R36 使用 `pnpm check:target -- src/app/app.css` 完成目标格式验证，并通过零引用检索确认删除项不再由活动 TS/TSX 使用。收尾时唯一一次 `pnpm check` 通过：40 个测试文件、246 个测试、TypeScript、ESLint、Prettier 与 Vite production build 全部成功。

本轮没有修改 React 运行逻辑、Rust、数据库、Tauri 配置或依赖，因此不重复执行刚在 R34 通过的 Rust 全量测试和 Tauri Release 构建。后续用户可见功能批次仍按完整交付门禁执行。

首次审计识别 610 个 CSS class、102 个零精确引用候选；加入动态 class 前缀和源码 class token 精确识别并完成安全清理后，结果收敛为 548 个 class、0 个零引用候选。默认输出限制为 40 个零引用候选和 20 个多选择器摘要，避免长报告占用终端与模型上下文。

最终 `pnpm build` 通过，Vite 转换 94 个模块；主 CSS 产物由清理前的 `131.50 kB / gzip 24.03 kB` 降至 `120.41 kB / gzip 22.13 kB`。本轮没有生成新的 Tauri Release EXE。

## 5. R37 重复状态色调合并（2026-08-10）

- 删除前置 `.page-status-loading/info/success/warning/error` 重复块（5 组、30 行），保留 `.page-status` 基础块及末端 `.status-banner.page-status-*` 规则。
- `app.css` 由 8,463 行降至 8,433 行；五个 tone class 各仅保留 1 个 selector block。`pnpm audit:css` 实际统计为 548 个 defined classes、0 个 zero-source-reference candidates、33 个同作用域重复 selector prelude、30 个多 selector block class。
- 本轮仅执行 `pnpm check:target -- src/app/app.css docs/R10_FRONTEND_STYLE_MAINTENANCE.md` 与 `pnpm audit:css`；未重复执行全量 check、构建或 Tauri 门禁。

## 6. R55 AI 旧样式清理（2026-08-13）

- 删除已迁移到 `EditorDialog` 和 `src/features/ai/ai.css` 后不再进入 DOM 的 `.ai-provider-editor`、`.ai-secret-form` 和 `.ai-settings-grid` 规则；
- 保留当前 `.ai-settings`、`.ai-provider-advanced`、Provider 卡片和连接测试规则，不改变 React 结构、密钥处理或预算行为；
- `pnpm audit:css` 的 `src/app/app.css` 零引用候选从 3 个降至 0 个，定义 class 从 350 个降至 348 个；
- 本轮先执行 CSS 审计和目标检查，交付前再执行完整前端/Rust 门禁和 Tauri Release 构建。
