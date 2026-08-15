# R33 全屏题目图片查看器验收

R33 针对用户截图反馈的题目图片查看体验进行收敛：原来的 inline viewer 会挤压题目浏览卡，导致题干、操作和图片区域同时争抢卡片空间。本轮将查看器改为题目浏览窗口内的应用内全屏 fixed overlay，保持当前复习上下文，同时不扩大窗口栈。

本文记录 R33 的交互契约、无障碍与资源生命周期边界、focused 验证证据、完整自动门禁和桌面人工验收。完整自动门禁已通过；用户在 R33 最终结果之后明确回复“验收通过，继续推进”，因此 R33 Release WebView 桌面人工验收与 R33 范围验收均已通过。R32 文档的历史状态不因 R33 反馈而改变。

相关边界见 [R32 验收](R32_QUESTION_BANK_HOME_AND_DIALOG_REFINEMENT_ACCEPTANCE.md)、[R31 验收](R31_TOOL_CENTER_AND_WINDOW_NAVIGATION_ACCEPTANCE.md) 和 [PDF 渲染 ADR](../../adr/003-pdf-rendering.md)。

## 1. 范围与不变边界

R33 只调整题目图片查看器的呈现层、键盘隔离、焦点和资源清理：

- 不改变题目、`QuestionRegion`、PDF 区域坐标、作答历史或复习队列数据；
- 不调用系统 Fullscreen API，不新增原生 `<dialog>` 或其他 native dialog；
- 不把图片查看器提升为全局窗口，也不改变 R31/R32 的单一窗口导航语义；
- 保留题目卡片中的缩略图作为进入全屏查看器的唯一入口。

## 2. 应用内全屏 fixed overlay

点击题目区域缩略图后，查看器在当前复习窗口内渲染为 `section[role="dialog"]`，由 CSS fixed overlay 覆盖可视区域：

- `position: fixed; inset: 0`，使用 `100dvh` 和独立的图片滚动区域，不再把查看器内容撑开或挤压题目浏览卡；
- 遮罩点击关闭，但点击工具栏和图片内容不会误触关闭；
- 视口安全区通过 `safe-area-inset-*` 作为工具栏和图片区域的 padding 下限；
- overlay 内部使用独立滚动与 `overscroll-behavior: contain`，背景题目浏览窗口不会跟随滚动。

查看器工具栏固定提供：

| 控件            | 契约                                                                             |
| --------------- | -------------------------------------------------------------------------------- |
| 标题与区域位置  | 显示“题目大图”、当前区域 `N/M` 及 PDF 页码，并通过 `aria-live="polite"` 更新位置 |
| 上一个 / 下一个 | 在多个区域之间循环切换；只有一个区域时禁用                                       |
| 缩放            | 通过 range 控件在 0.5×–3× 间调整；切换区域时重置为 1×                            |
| 拖动            | 指针拖拽平移图片；切换区域或关闭时清理拖动状态与偏移                             |
| 关闭            | 明确标注“关闭题目大图”；遮罩点击和 Escape 均可关闭                               |

关闭查看器后恢复题目卡原布局，不跳转完整 PDF，也不叠加第二个 modal。

## 3. 焦点、遮罩与滚动锁

打开和关闭遵循可恢复的键盘路径：

- 打开时焦点进入关闭按钮；关闭时焦点返回触发缩略图，触发器失效时由现有窗口焦点策略兜底；
- overlay 使用 `role="dialog"`、`aria-modal="true"` 和可读的 `aria-label`，背景题目卡在查看期间设置 `inert` 与 `aria-hidden`；
- Tab/Shift+Tab 仅在查看器工具栏和可操作控件之间循环，焦点不会穿透到题目浏览窗口或应用壳；
- Escape 只处理查看器关闭，并停止事件冒泡，避免同时触发 Review 窗口或其他快捷键；
- body 滚动锁采用引用计数：多个生命周期重入时只在计数归零后移除锁，卸载与异常关闭不会遗留 `review-region-viewer-open`。

## 4. 生成试卷与 Review 快捷键隔离

题目卡仍使用 `content-visibility: auto` 进行长试卷性能优化；当某题打开全屏查看器时，对 `.generated-paper-question:has(.review-region-expanded)` 覆盖为 `content-visibility: visible` 并移除 containment，确保 fixed overlay 的尺寸、焦点和图片布局不受父级跳过渲染影响。

查看器在捕获阶段隔离 Escape、Tab 和遮罩点击；Review 窗口的方向键、评分或提交快捷键不会因查看器打开而误触发。关闭后，Review 原有的快捷键和当前题目上下文恢复。

## 5. 图片 URL、PDF session 与卸载清理

- 区域 PNG 通过 object URL 提供给缩略图和全屏图片；组件卸载时逐一 `URL.revokeObjectURL`，过期渲染结果也会立即回收；
- 部分区域渲染失败时，已经生成的 object URL 全部回收，不把半成品图片留在卡片或查看器中；
- 区域渲染创建的 PDF reader session 在成功、失败和取消路径均执行 `session.destroy()`；
- document 或 regions 改变时清空旧图片、区域索引、缩放、平移和拖动状态，避免旧 URL 或旧区域继续显示；
- 无区域、PDF 不可读和渲染失败均显示可读状态，不保留失效图片或悬挂的全屏层。

## 6. 已有 focused 验证证据

本轮已有 6 个 focused tests 通过，另有 TypeScript、ESLint 和 Prettier 定向检查通过：

| 范围                                                                           | 文件                                                        |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 图片区域索引、循环切换、焦点循环、Escape 关闭、部分 URL 回收与 session destroy | `src/features/review/QuestionRegionCard.test.ts`（6 tests） |

结果摘要：上述 focused 6 tests 通过；`pnpm typecheck`、R33 相关 ESLint 和 Prettier check 通过，0 warning。完整自动门禁结果记录在第 9 节；桌面 Release WebView 已由用户明确验收通过。

## 7. 桌面人工验收结果（用户确认通过）

用户在 R33 最终结果之后明确回复“验收通过，继续推进”，确认本节 Release WebView 场景通过。验收基线保留如下，供后续回归：

1. 从题目缩略图打开查看器，确认题目浏览卡不被挤压，overlay 真正覆盖整个应用视口，未弹出系统全屏提示或原生对话框。
2. 在多区域题目中验证 `N/M`、上一个/下一个循环、缩放和指针拖动；单区域时确认导航按钮禁用。
3. 点击遮罩、关闭按钮和 Escape，确认查看器关闭、背景滚动恢复、焦点回到原缩略图，且 Review 快捷键没有误触发。
4. 在窄屏、安全区和动态地址栏环境检查 toolbar、图片区域、关闭按钮和底部 padding；打开/关闭多次后确认没有滚动锁或 object URL 残留。
5. 在长 generated paper 中打开靠后的题目，确认 `content-visibility` override 后图片完整可见，关闭后长列表性能样式恢复。

## 8. 集成边界与剩余风险

- R33 的自动门禁（完整 `pnpm check`、Rust 检查、Tauri no-bundle 构建及 Release 产物核查）和桌面 Release WebView 人工验收均已通过。
- viewer 继续属于 Review/题目浏览窗口内部组件；后续改动不得恢复 inline 挤压布局、系统 Fullscreen API 或嵌套 native dialog。
- 若调整 `QuestionRegionCard`、Review 键盘处理、generated paper containment 或应用壳 safe-area/dvh 规则，应重新执行本节 focused 验证和桌面回归，并按新结果更新本文件状态。

## 9. 最终自动门禁实绩（2026-08-10）

本轮按固定顺序各执行一次，所有命令退出码均为 0；未启动 exe 或桌面窗口：

| 门禁           | 实绩                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| 预检版本       | Node `v22.18.0`；pnpm `11.16.0`；rustc/cargo `1.97.1`；tauri-cli `2.11.4`                                           |
| Cargo 元数据   | `src-tauri/cargo metadata --locked --no-deps` 通过（仅提示显式 `--format-version` 的兼容性 warning）                |
| 根前端门禁     | `pnpm check` 通过；39 个 test files、243 tests 全部通过，Prettier、ESLint、TypeScript 与 Vite production build 通过 |
| Rust 格式      | `src-tauri/cargo fmt --all -- --check` 通过                                                                         |
| Rust 单测      | `src-tauri/cargo test --locked`：245 passed、0 failed                                                               |
| Rust Clippy    | `src-tauri/cargo clippy --locked --all-targets -- -D warnings` 通过                                                 |
| Tauri 构建     | `pnpm tauri build --no-bundle` 通过；构建起始时间 `2026-08-10T15:09:28.4321647+08:00`                               |
| 构建后进程核查 | 未发现 `kystudy`、Tauri、Cargo/Rust、Vite/Node/pnpm、MSBuild 或 WebView 残留进程                                    |

Release 产物均为非零且 mtime 晚于构建起始时间：

| 产物                                   | 构建前 size / mtime / SHA-256                                                                                           | 构建后 size / mtime / SHA-256                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/target/release/kystudy.exe` | 25,273,856 B / `2026-08-09T11:36:49.9267208+08:00` / `FF1CDECD0DD55E55927D07480A7E2446E86DBACC08369DF2143C04CC5DE9549F` | 25,273,856 B / `2026-08-10T15:13:03.8778206+08:00` / `D8FE643AAF1A9017E966B66919FBEA79E1DD74DAF7DBCC88F7FB0C62D10006B`  |
| `src-tauri/target/release/kystudy.pdb` | 13,537,280 B / `2026-08-09T11:36:49.9409938+08:00` / `83C66400E6B6DF861F7F01C435B3D060BC241F2390CA6EBACB7AA054D74678A7` | 13,537,280 B / `2026-08-10T15:13:03.8940877+08:00` / `732AC5E601555353D24704DF1D68C5038FB967E2288B8A4B8311D4F1040AB11B` |

以上记录 R33 自动门禁与产物完整性；第 7 节记录用户明确确认通过的 Release WebView 桌面人工验收。两类证据共同构成 R33 范围验收通过结论。
