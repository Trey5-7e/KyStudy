# R34 统一页面框架与状态体验验收

R34 收敛一级页面重复标题、主操作层级和异步状态表达。应用壳不再在每个正常页面上方重复渲染全局标题；各功能页面使用同一组页面 primitives，保证 loading、missing、error、empty 和 ready 路径都有唯一、清晰的 `h1`，并把用户下一步操作放在稳定位置。

本文记录 R34 已实现的前端契约、定向验证和本次完整自动门禁证据。R34 的根前端检查、Rust 门禁和无安装包 Tauri Release 构建均已通过；用户随后明确回复“验收通过，继续推进”，因此 R34 Release WebView 桌面人工验收与 R34 范围验收均已通过。

前置状态：R33 的完整自动门禁和 Release WebView 桌面人工验收均已通过；用户在 R33 最终结果之后明确回复“验收通过，继续推进”。该结论是 R34 的历史基线，不替代 R34 修改后的新门禁与桌面回归。

相关产品边界见 [PRD](../../PRD.md)、[信息架构](../../INFORMATION_ARCHITECTURE.md)、[R32 验收](R32_QUESTION_BANK_HOME_AND_DIALOG_REFINEMENT_ACCEPTANCE.md) 和 [R33 验收](R33_FULLSCREEN_QUESTION_IMAGE_VIEWER_ACCEPTANCE.md)。

## 1. 目标与非目标

R34 的用户可见目标是：

- 每个页面只显示一个页级 `h1`，不再叠加 App 全局标题和功能内部宣传标题；
- 页面标题、说明、主操作、返回操作和次级操作使用一致布局；
- loading、信息、成功、警告、错误和空状态具有一致语义与恢复动作；
- “今日”的开始/继续/查看今日错题成为明确主 CTA，计划与刷新降为次级操作；
- “计划”在读取失败时不把错误伪装为空月历；
- 资料、设置和已有日程的 tab 使用完整 ARIA 映射、roving tabindex 和键盘导航；
- 窄窗口、安全区和 320px 最小宽度下仍能阅读标题、状态和操作。

R34 不改变：

- 周期计划、错题队列、题库、资料、设置或旧日程的数据模型与后端命令；
- 计划排程、复习间隔、题目索引、PDF 渲染和资源去重算法；
- 一级导航数量、hash 路由、工作区 schema 或迁移；
- R33 fullscreen viewer 的窗口栈、键盘、图片 URL 和 PDF session 生命周期；
- Cycle 计划卡片既有管理按钮的业务流程；次级操作进一步下沉可在后续独立批次完成；
- 全站旧 CSS 的机械删除。R34 使用后置覆盖保证迁移安全，重复或失效旧规则留待后续清理。

## 2. 共享页面 primitives

`src/shared/components/PagePrimitives.tsx` 提供四个共享组件：

| 组件          | 主要契约                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------- |
| `PageHeader`  | 输出页面唯一 `h1`；支持 eyebrow、说明、actions 和 backAction；长标题允许换行                      |
| `PageSurface` | 提供 default/muted 页面表面，可用 section 或 div；通过 labelledBy 关联标题                        |
| `PageStatus`  | 支持 loading、info、success、warning、error；错误使用 alert，其余动态状态礼貌播报；可提供恢复动作 |
| `PageEmpty`   | 提供稳定空状态标题、说明和可选动作；默认不制造多余 live announcement                              |

共享组件不持有业务状态，不推断按钮语义，也不替页面执行导航。调用方继续使用真实 `<button>` 或链接作为 action，从而保留 disabled、busy、修饰键和焦点语义。

### 2.1 App 与 Suspense

`App` 的正常内容区不再常驻渲染一份全局 page header。页面自己的 `PageHeader` 成为标题事实来源。

懒加载期间使用 `page-loading-shell`，其中包含与目标页面一致的 `PageHeader` 和 loading `PageStatus`。因此模块下载过程中仍有可读标题，模块完成后由页面标题替换，不会同时存在两个 `h1`。

## 3. 页面迁移

### 3.1 今日

`TodayOverviewPanel` 的 loading、缺少工作区、全局错误和 ready 路径均渲染 `PageHeader`：

- ready 状态使用工作区日期作为 eyebrow；
- 有启用方案时，主 CTA 根据队列状态显示“开始今日错题”“继续今日错题”或“查看今日错题”；
- 没有可复习错题时，主 CTA 指向习题册；错题读取失败时改为重新读取，不把失败误判为无错题；
- “打开计划”和“刷新今日”保留为次级操作；
- 原 hero 中重复的“今天只处理需要完成的内容”和计划卡中的重复“查看计划”已移除；
- 今日计划和今日错题分别使用 `PageSurface`，局部失败使用 `PageStatus`，稳定空内容使用 `PageEmpty`。

### 3.2 计划

`CyclePlanPanel` 的 loading、fatal error 和 ready 路径均保留 `h1=计划`：

- 只有 dashboard ready 时显示“新建周期计划”主 CTA；loading/error 不展示不可用的 disabled CTA；
- fatal load error 显示带“重新读取”的 error `PageStatus`，不会继续渲染空月历、空统计或伪空计划；
- 写入操作的错误和成功通知使用共享 status；
- 空计划使用 `PageEmpty`，主 CTA 仍由 header 提供；
- 新建、编辑、dirty/busy 和既有 `EditorDialog` 写入路径保持不变。

### 3.3 已有日程

`ScheduleOverviewPanel` 新增显式返回计划动作，并删除“M2”工程里程碑文案。默认仍显示周日程；学习记录、统计和回收站保留为次级 tab。

tab 契约包括：

- tablist、tab 和 tabpanel 角色；
- 稳定的 tab/panel id、`aria-controls`、`aria-labelledby` 和 `aria-selected`；
- active tab 为 `tabIndex=0`，其余为 `-1`；
- Left、Right、Up、Down 循环移动，Home/End 跳到首尾；
- 切换后焦点进入新 active tab；默认 active tab 为“周日程与逾期”。

### 3.4 错题、题库、资料与设置

- `ReviewPanel` 的 loading、missing、error 和 ready 路径共用 PageHeader、PageStatus、PageEmpty 和 PageSurface；外层 surface 只承担布局，不叠加第二层大卡片边框。
- `QuestionBankPanel` 使用统一标题、题库加载/刷新/陈旧/错误状态和 onboarding empty；题库内部卡片、R31/R32 窗口和 R33 viewer 契约不变。
- `ResourcePanel` 使用“资料”PageHeader、唯一导入主操作、页面 surface、统一加载/错误/空状态；资料与导图 tab 使用完整 ARIA 与 roving focus。
- `SettingsPanel` 使用“设置”PageHeader 和单一页面 surface；学习、AI、数据、应用四组 tab 使用完整 ARIA 与 roving focus。内部 status/boundary 区域降为分隔 section，避免 PageSurface 内再次出现重复卡面。

## 4. 状态层级与主操作

页面状态遵循以下约束：

| 状态                 | 呈现                                 | 动作                                   |
| -------------------- | ------------------------------------ | -------------------------------------- |
| loading              | 标题保持可见，`PageStatus` 礼貌播报  | 不展示误导性的可用主 CTA               |
| missing prerequisite | `PageEmpty` 解释缺少内容             | 指向设置、习题册或创建入口             |
| fatal error          | error `PageStatus`，说明问题与下一步 | 提供重新读取等恢复动作，不渲染伪空内容 |
| partial error        | 保留仍可信内容，局部 error status    | 只重试受影响范围                       |
| empty                | `PageEmpty`，不显示空图表            | 页面 header 保留唯一主 CTA             |
| success/info/warning | 对应 tone，使用文字而非只靠颜色      | 需要时提供明确后续动作                 |

`PageStatus` 和 `PageEmpty` 不显示内部 SQL、文件路径、Provider 堆栈或 JSON；业务错误仍由已有 normalize 函数生成用户可行动文案。

## 5. Tabs、焦点与无障碍

资料、设置和已有日程 tab 共享以下交互：

- active 状态同时由 `aria-selected`、roving tabindex 和视觉对比表达；
- tab 与 tabpanel 双向关联，tabpanel 可获得键盘焦点；
- Arrow/Home/End 不依赖鼠标；普通 Tab 只进入当前 active tab；
- focus-visible 使用高对比 outline，不以取消 outline 代替；
- 320px 和窄窗口中，资料/已有日程 tab 可横向滚动，设置四组使用 auto-fit 或单列，不把页面撑宽。

已有日程的纯 helper `scheduleOverviewTabIndexAfterKey` 覆盖双向循环、Home/End、无关按键和空 tablist。

## 6. 响应式与 CSS 边界

R34 在 `src/app/app.css` 使用渐进后置规则：

- PageHeader 在桌面使用内容/操作双栏，`<=640px` 堆叠；长标题和说明允许任意位置换行；
- Today 主 CTA 使用更明确的宽度与阴影，卡片 heading 在窄屏堆叠；
- Settings 在 `<=900px` 改为单列内容，四组 tab 使用 auto-fit；Resource 和已有日程 tab 改为独立横向滚动；
- Resource 搜索、结果和资料列表使用更紧凑的 gap、margin 和 padding；最终 cascade 明确覆盖旧 refinement 规则；
- `641–680px` 的 EditorDialog 使用 `100dvh` 与 safe-area padding；`<=640px` 继续使用现有安全区扣减策略；
- `<=320px` 时 header、status、empty actions 改为单列且宽度不超过容器；
- primary/secondary hover transition 只使用 transform 和 opacity，并在 `prefers-reduced-motion` 下关闭。

`PageSurface` 明确不设置 `transform`、`contain`、`content-visibility` 或 `overflow:hidden`。这条边界用于避免建立 fixed containing block 或裁剪 R33 fullscreen viewer。题库长列表仍可在业务卡片自身使用经过验证的 `content-visibility`，生成试卷打开 viewer 时继续由 R33 的 `:has()` override 解除 containment。

## 7. R34 定向验证证据

R34 实现期间已有以下定向证据：

| 范围                                    | 结果                                                     |
| --------------------------------------- | -------------------------------------------------------- |
| `ScheduleOverviewPanel.test.ts`         | 3 tests passed；覆盖方向键循环、Home/End、无关键与空列表 |
| R34 页面相关目标 ESLint                 | 通过，0 warning                                          |
| R34 TSX/CSS 目标 Prettier check         | 通过                                                     |
| `pnpm exec tsc --noEmit --pretty false` | 通过                                                     |
| `git diff --check`（R34 相关文件）      | 通过                                                     |

上述结果来自实现过程中的定向命令；本次完整门禁结果见下一节。本次文档整理不启动桌面应用。

## 8. R34 完整自动门禁与产物核查

### 8.1 门禁命令

门禁按固定顺序各执行一次，均以退出码 0 完成；任一失败即停止且未重跑：

| 顺序 | 命令                                                             | 实际结果                                                              |
| ---- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1    | 根 `pnpm check`                                                  | 通过；40 个 Vitest 文件、246 个测试通过，并完成 Vite production build |
| 2    | `src-tauri` `cargo fmt --all -- --check`                         | 通过                                                                  |
| 3    | `src-tauri` `cargo test --locked`                                | 通过；245 passed、0 failed                                            |
| 4    | `src-tauri` `cargo clippy --locked --all-targets -- -D warnings` | 通过                                                                  |
| 5    | 根 `pnpm tauri build --no-bundle`（600s timeout）                | 通过；Release `kystudy.exe` 已生成，未启动                            |

门禁起始时间：`2026-08-10T16:02:48.1781722+08:00`。预检工具版本为 Node `v22.18.0`、pnpm `11.16.0`、rustc/cargo `1.97.1`、tauri-cli `2.11.4`；预检未发现 KyStudy/Tauri 残留进程，F 盘可用空间为 `37,384,388,608` bytes。

### 8.2 Release 产物

构建前后仅对 release exe/pdb 做只读核查；两份产物均非零，mtime 均晚于门禁起始时间，SHA-256 如下：

| 产物                                   | 构建前 size / mtime / SHA-256                                                                                           | 构建后 size / mtime / SHA-256                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/target/release/kystudy.exe` | `25,273,856` / `2026-08-10T15:13:03.8778206+08:00` / `D8FE643AAF1A9017E966B66919FBEA79E1DD74DAF7DBCC88F7FB0C62D10006B6` | `25,277,952` / `2026-08-10T16:08:34.7720077+08:00` / `965BD2384E5AA3348E3FEBFADB4D3E26BE45C2A94AF94E0298733F6D9A1C3AE4` |
| `src-tauri/target/release/kystudy.pdb` | `13,537,280` / `2026-08-10T15:13:03.8940877+08:00` / `732AC5E601555353D24704DF1D68C5038FB967E2288B8A4B8311D4F1040AB11B` | `13,537,280` / `2026-08-10T16:08:34.7843520+08:00` / `24F65795BCBF9A7DA07B72C48AA8B290678B17492B15F0945534498865A0F667` |

构建后只读进程核查为 `NONE`；没有启动 EXE，也没有进行桌面操作。R32/R33 的历史门禁记录不替代上述 R34 实际结果。

## 9. 桌面人工验收（用户确认通过）

用户在 R34 最终结果之后明确回复“验收通过，继续推进”。以下场景作为已通过的回归基线保留：

1. 依次打开今日、计划、习题册、错题、资料、设置和已有日程，确认每页只有一个可见 `h1`，没有 App 标题与页内标题重复。
2. 在慢加载或人为失败环境观察 Suspense、loading、missing、fatal error、partial error 和 empty；确认标题不消失，错误有下一步，失败不伪装为空数据。
3. 在今日验证主 CTA 随无错题、首次开始、继续、完成、休息日和读取失败正确变化；打开计划与刷新保持次级。
4. 在计划页模拟 dashboard 首次读取失败，确认只显示错误和重试；成功后才出现新建 CTA、月历和计划内容。
5. 用 Tab、Shift+Tab、四方向键、Home、End 操作资料、设置和已有日程 tabs，确认视觉焦点、active 状态和 tabpanel 一致。
6. 在 1280px、900px、680px、640px 和 320px 检查长中文标题、四组设置 tab、资料列表、月历、状态动作和 EditorDialog safe-area；页面不得产生非预期横向滚动。
7. 从题库或错题打开 R33 fullscreen viewer，确认 PageSurface 没有裁剪 fixed overlay，Escape、Tab trap、焦点恢复和背景滚动仍正常。
8. 开启系统减少动态效果，确认主次按钮不再位移；键盘 focus-visible 仍清楚可见。

## 10. 集成边界与后续清理

- 页面 primitives 是呈现层，不得吸收业务 fetch、保存或导航状态机。
- App Suspense fallback 与页面 ready 状态不得同时渲染；每个时刻只保留一个 page header。
- R34 保留旧 CSS 供未迁移页面兼容，并通过最终 cascade 保证新页面结果。重复 selector 和确定失效的旧 App/header/card 规则属于后续 P2 清理，不在本批大删。
- 若后续修改 PageSurface containment、App lazy shell、tabs、640px/680px 断点或 R33 viewer，应重新执行第 7 节定向验证和第 9 节相关桌面场景。
- R33 与 R34 的 Release WebView 用户验收均已明确通过；后续修改页面 primitives、全屏查看器或响应式壳时仍需重新执行受影响场景。
