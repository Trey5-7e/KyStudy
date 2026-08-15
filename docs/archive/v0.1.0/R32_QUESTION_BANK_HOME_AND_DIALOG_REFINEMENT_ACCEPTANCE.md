# R32 题库主页与对话框细节优化验收

R32 在 R30 的 active-only 题库语义和 R31 的单一窗口导航之上，收敛题库主页的信息密度，并统一编辑窗口、导入流程、题目图片查看和窄窗口行为。本轮不新增题库数据模型，不改变题目 ID、PDF 区域、作答历史、复习状态或 R30 的重新归类事务。

本文记录当前实现的交互契约、可复核的前端定向证据、完整自动门禁实绩和仍待用户执行的桌面人工验收。定向证据来自本轮已有的 focused 验证；完整自动门禁已按一次性顺序执行，本次整理不重新执行测试、完整 `pnpm check`、Rust 门禁或 Tauri 构建，也不启动桌面应用。

相关边界见 [PRD](../../PRD.md)、[信息架构](../../INFORMATION_ARCHITECTURE.md)、[R30 验收](R30_SEGMENT_REASSIGN_AND_WINDOWED_UI_ACCEPTANCE.md) 和 [R31 验收](R31_TOOL_CENTER_AND_WINDOW_NAVIGATION_ACCEPTANCE.md)。

## 1. 本轮范围与不变边界

R32 的用户可见目标是：

- 题库主页由明确的加载、可用、刷新中、陈旧和错误状态驱动，不用空白或过期数字伪装成功；
- 主页按活动分段建立“科目 → 练习册 → 分段”的浏览树，默认折叠细节，只保留下一步需要的摘要和操作；
- 导入流程先选择并分析 PDF，再确认每个检测分段的科目与练习册；
- 所有编辑窗口使用统一 `EditorDialog` shell、footer、dirty/busy 规则和焦点恢复；
- 题目浏览编辑时锁定会改变当前题目的导航；题目图片放大使用窗口内 viewer，不再嵌套第二个 modal；
- 题库工具中心在宽屏和窄屏之间切换可理解的 tab orientation；应用壳使用 safe-area、`dvh` 和不劫持修饰键的导航。

以下内容不属于 R32：

- schema、migration、SQLite 表关系和 Rust 事务语义；
- PDF 解析算法、题号识别准确率或 OCR 模型效果的重新定义；
- 复习算法、作答历史、题目区域坐标和跨 workbook active-only reassign 规则；
- Release 产物、完整 Tauri 门禁或桌面 WebView 通过结论。

## 2. 题库主页：状态驱动而不是空白占位

`QuestionBankPanel` 将题库快照与辅助资料分开加载，并用 `QuestionBankLoadState` 驱动页面。快照请求使用 request/lifecycle ID，卸载或过期响应不得覆盖较新的状态。

| 状态         | 主页表现                                        | 可执行动作                                           |
| ------------ | ----------------------------------------------- | ---------------------------------------------------- |
| `loading`    | 摘要显示“正在读取题库…”，不渲染未经确认的题库树 | 可等待；工具卡片以读取中状态禁用                     |
| `ready`      | 显示科目、练习册、已索引和已做统计；渲染活动树  | 可导入、打开工具或回收站                             |
| `refreshing` | 保留上一次快照，同时显示“正在刷新题库…”         | 禁止依赖旧状态的重复刷新；完成后用完整 snapshot 更新 |
| `stale`      | 保留上一次可浏览快照，说明刷新失败并提供重试    | 可重试；不把陈旧快照当作最新写入依据                 |
| `error`      | 用 `role="alert"` 展示可行动错误和“重试”        | 不渲染不可证明的树和统计                             |

快照刷新成功后，主页统计从同一份完整 snapshot 计算：活动科目数、练习册数、已索引题数和已做题数。错误文案只解释下一步，不泄露 SQL、路径、Blob 或内部堆栈。

### 2.1 空状态与唯一主 CTA

主页 header 固定保留三个入口：

| 入口         | 作用                               |
| ------------ | ---------------------------------- |
| `导入 PDF`   | 唯一主 CTA，从主页直接进入导入流程 |
| `题库工具`   | 次级入口，进入 R31 工具中心        |
| `分段回收站` | 次级入口，进入显式恢复流程         |

活动题库为空时，页面根据回收站读取结果区分：

- 首次读取仍在进行：显示“创建分类 → 导入 PDF → 确认归类”的三步引导；
- 回收站已确认为空：提示先创建分类，再从主页导入并确认；
- 活动为空但回收站有记录：说明活动索引为空，提醒通过显式回收站恢复，不把已删除分段伪装成活动题库。

这些空状态仍保留主 CTA，不把导入重复塞进工具卡片，也不把回收站数据混入主页树。

## 3. 活动题库树：科目优先、分段折叠、active-only

`groupQuestionBankSnapshot` 以 `snapshot.segments` 为可见性来源，按首次出现顺序建立科目和练习册组，再把题目挂到其活动分段对应的组。没有活动分段的题目不会生成孤立树行；trashed segment 不进入主页树。

主页树的层级和状态如下：

```text
科目（默认展开第一项，其余可折叠）
└─ 练习册（已做 / 总题数、进度条）
   └─ 分段（默认折叠，页码、题数、待建立/待校对状态）
      └─ 管理（每个分段唯一入口）
```

- 科目摘要显示练习册数、题数，以及待建立/待校对分段数；
- 练习册摘要显示 `completed / total`，题数为零时不伪造百分比；
- 分段状态由索引状态和当前活动题数共同决定：没有题或仍 pending 为“待建立”，有题但需要复核为“待校对”，其余可浏览；
- 科目与分段使用原生 `<details>` 折叠，展开状态仅为页面状态，不写入用户数据；
- 每个分段只显示一个“管理”按钮，浏览、继续索引、重新归类和移除从分段管理窗口继续；
- 长名称在窄窗口换行或截断，不以横向溢出破坏主操作。

R32 只改变呈现与渐进展开，不改变 R29/R30 的 active-only 约束：主页不会恢复、迁移或隐藏回收站记录，也不会从前端拼接局部 snapshot 覆盖后端结果。

## 4. 导入流程：source → assign

`ImportIndexDialog` 在一个 `EditorDialog` shell 内维护两个明确步骤：

```text
1. 选择并分析 PDF
   → 本地读取书签、文字坐标，必要时按需使用本地 OCR
2. 确认归类并建立索引
   → 为每个检测分段选择科目与练习册，再写入题目索引
```

### 4.1 source 步骤

- PDF 选择器只列出当前资料库中仍可用的 PDF；列表为空时给出“先到资料页面上传”的动作；
- 分析期间显示进度，支持取消；取消会终止前端 AbortController 和正在进行的 OCR 操作，且不写入题库；
- 分析不调用 AI、不消耗 Token；文字层不足时明确说明本地 OCR 是否可用；
- 分析完成后保留检测结果，`继续确认归类` 不重复读取 PDF；
- source 步骤 footer 使用统一的 `EditorDialogFooter`，取消遵循 dirty/busy 规则。

### 4.2 assign 步骤

每个检测到的科目/分段是可折叠的 assignment row，显示建议名称、来源 heading、页码、题数、OCR 页数和待复核数量。每行提供：

- `归入科目` 选择器；
- `归入练习册` 选择器；
- 已完成、重复分段和待人工复核的可读状态。

默认归类只用于减少重复选择：优先匹配同名科目和同页码范围的既有练习册；检测到多个 exact match 时不自动覆盖，要求用户核对。保存前必须满足：

- 每个未完成分段都有科目和练习册；
- 未完成分段至少识别到一道题；
- `segmentAssignmentConflict` 未发现同一 PDF、科目和页码范围的活动/历史冲突；
- 当前 PDF 仍存在，且不是过期的选择结果。

冲突和空索引会禁用保存按钮，并通过说明文本关联到对应选择器；后端最终校验仍是权威。逐科目写入显示完成进度，失败时保留已完成行并提示失败科目可重试，不把半完成状态伪装成全部成功。

### 4.3 source 返回与关闭

assign 步骤的 Back 显式返回 source，并保留当前分析结果，因此设置 `backRequiresConfirmation={false}`；这不会改变关闭窗口的 dirty 确认。分析结果存在时关闭、Escape、遮罩或 header Close 仍由 `EditorDialog` 显示“放弃未保存的修改？”确认；busy 时这些路径全部锁定。

## 5. 统一 EditorDialog、footer、dirty/busy 与焦点

`EditorDialog` 是 R32 影响的所有编辑窗口共同 shell：

- 默认 `backRequiresConfirmation=true`，Back 与 Close 对 dirty 内容都进入同一确认层；仅导入 source/assign 的步骤返回例外关闭确认；
- `EditorDialogFooter` 提供统一 footer 容器，`EditorDialogCloseButton` 从 context 读取 `requestClose` 与 `closeDisabled`，避免局部按钮绕过 shell 规则；
- 保存、刷新、删除、恢复、索引和 OCR 期间设置 `closeDisabled`，禁用重复提交、header Close、Back、Escape、遮罩关闭和会产生竞态的切换；
- 确认层只允许“放弃修改”或“继续编辑”，继续编辑后焦点回到触发确认的原控件；
- 打开窗口优先聚焦 `initialFocusRef`，否则聚焦标题；关闭优先返回 `returnFocusRef`，触发器失效时使用打开前焦点或 `fallbackFocusRef`；
- 使用原生 `showModal()` 和文档滚动锁，背景页面在窗口打开期间不能滚动；
- 标题、描述、状态和错误通过 `aria-labelledby`、`aria-describedby`、`role="status"`/`role="alert"` 暴露，不依赖颜色传递结果。

这些规则与 R31 的 `activeWindow` 单实例互补：切换 child 时先退出当前可见 shell，不通过叠加 modal 表达历史路径。

## 6. 题目浏览编辑锁

题目索引浏览窗口在 `editing=true` 时使用 `questionBrowserNavigationDisabled` 锁定会改变当前题的路径：

- 分段范围切换、筛选器、缺漏诊断、题目列表选中和上一题/下一题按钮均禁用，并在页面显示“先保存或取消编辑”；
- 左右方向键不会切换题目；编辑输入框、保存和本地取消仍可用；
- 编辑 dirty 状态交由 `EditorDialog` 处理，Back、Close、Escape 和遮罩关闭不会静默丢弃内容；
- 保存成功后以完整 snapshot 更新浏览器，取消后恢复只读浏览，不改变后端数据。

该锁只保护当前窗口的未保存上下文，不改变题目排序、作答记录或服务器端并发校验。

## 7. 题目图片 inline viewer

`QuestionRegionCard` 直接在题目卡片内渲染已保存区域的 PNG 缩略图。点击缩略图后打开同一窗口中的 `section[role="region"]` viewer，而不是新的 `<dialog>`：

- 支持多区域切换、缩放滑杆和指针拖拽平移；
- viewer 关闭按钮有明确 accessible name，Escape 关闭并停止事件冒泡；
- 打开时焦点进入关闭按钮，关闭后返回原缩略图触发器；
- 区域或图片列表变化时收起 viewer、重置缩放/平移并重新校正 active index；
- URL 在组件卸载时回收；无区域或 PDF 读取失败时显示可读状态；
- 不跳转完整 PDF，不在题目浏览或编辑窗口内嵌套第二个 modal。

## 8. 工具中心 orientation 与应用壳边界

### 8.1 Tools orientation

R31 工具中心继续使用四个 tab 分组和单一 `EditorDialog` shell。R32 将 tab orientation 与视口同步：

| 视口           | tablist orientation | 体验                                         |
| -------------- | ------------------- | -------------------------------------------- |
| 宽于约 900px   | `vertical`          | 左侧分组栏，右侧工具面板和卡片网格           |
| 不超过约 900px | `horizontal`        | 分组变为可横向滚动的条，工具面板改为上下布局 |
| 不超过约 640px | `horizontal`        | 卡片单列，footer/sticky 动作保持可见         |

分组仍支持 Arrow/Home/End 键盘移动、roving tabindex 和 focus restoration；卡片 loading、无分段、无题目和刷新 busy 状态通过 chip、禁用属性及 `aria-describedby` 同时表达。

### 8.2 app shell

R32 的壳层 CSS 约束集中在 `src/app/app.css`，不改变一级导航信息架构：

- `env(safe-area-inset-*)` 作为 sidebar、header、dialog/footer 和 inline viewer 的边距下限；
- `100dvh` 用于 body、app shell、sidebar 和移动窗口高度，窄屏 dialog 使用 safe-area 扣除后的动态高度；
- 题库摘要、导入 assignment list、题目列表和图片 pan 区使用独立滚动与 `overscroll-behavior`，避免拖动背景页面；
- 约 980px、640px、320px 断点分别收敛列表/摘要列数、dialog 宽高、按钮换行和单列布局；
- `shouldInterceptNavigationClick` 只接管普通主键点击；中键、Cmd/Ctrl、Shift、Alt 点击保留浏览器原生行为，不劫持修饰键导航。

## 9. R32 定向验证证据

下表记录已有的前端 focused 证据；本次文档整理不重跑命令。

| 范围                               | 文件覆盖                                                                                  |                结果 |
| ---------------------------------- | ----------------------------------------------------------------------------------------- | ------------------: |
| 主页分组与 active-only 可见性      | `questionBankHomeModel.test.ts`                                                           |                通过 |
| 单一窗口、origin、Back/Close       | `questionBankWindowModel.test.ts`                                                         |                通过 |
| Tools orientation 与键盘分组       | `QuestionBankToolsDialog.test.ts`                                                         |                通过 |
| 浏览编辑锁与提示                   | `QuestionIndexDialogs.test.ts`                                                            |                通过 |
| inline viewer active index         | `QuestionRegionCard.test.ts`                                                              |                通过 |
| 题库模型、缺漏诊断与 client bridge | `questionBankModel.test.ts`、`questionGapDiagnosis.test.ts`、`questionBankClient.test.ts` |                通过 |
| app modifier-key navigation        | `src/app/navigation.test.ts`                                                              |                通过 |
| focused 合计                       | 以上 9 个 test files                                                                      | **96 tests passed** |

目标前端静态检查已有结果：

- `pnpm typecheck`：通过；
- R32 相关 ESLint：通过，0 warning；
- R32 相关 Prettier check：通过。

以上是定向证据；完整自动门禁已在本轮按固定顺序各执行一次。自动门禁通过不替代 Release WebView 桌面人工验收。

## 10. R32 完整自动门禁实绩与最终状态

门禁执行顺序固定为 `pnpm check` → `cargo fmt` → `cargo test` → `cargo clippy` → `pnpm tauri build --no-bundle`，每项仅运行一次，所有命令均 exit 0：

| 门禁                                                             | 实绩                                                                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 根 `pnpm check`                                                  | **通过**（exit 0；56.9567309 s；Vitest 39 个 test files / 239 tests passed；Prettier、ESLint、typecheck、Vite build 均通过）               |
| `src-tauri` `cargo fmt --all -- --check`                         | **通过**（exit 0；5.3049152 s）                                                                                                            |
| `src-tauri` `cargo test --locked`                                | **通过**（exit 0；32.8890587 s；245 passed，0 failed，0 ignored）                                                                          |
| `src-tauri` `cargo clippy --locked --all-targets -- -D warnings` | **通过**（exit 0；8.5081873 s；无警告）                                                                                                    |
| 根 `pnpm tauri build --no-bundle`                                | **通过**（exit 0；构建开始 `2026-08-09T11:33:46.6128953+08:00`；耗时 183.5351775 s；无残留 `pnpm`/`cargo`/`rustc`/`tauri`/`kystudy` 进程） |

门禁前只读预检记录：pnpm `11.16.0`、Node `v22.18.0`、cargo/rustc `1.97.1`、Tauri CLI `2.11.4`；`src-tauri` 的 `cargo metadata --locked --no-deps` exit 0；F 盘可用空间 `37,386,047,488` bytes。构建前旧产物为 exe `25,269,760` bytes（mtime `2026-08-09T10:15:00.4750031+08:00`，SHA-256 `EE094112E7216916998090D60071387A8C3596BA13B6318B8CFE090E29B6D6E8`）和 pdb `13,537,280` bytes（mtime `2026-08-09T10:15:00.4907017+08:00`，SHA-256 `8A06F973D50D9113FB4C77B0F49809FAE2033B1CA47BEA4D2AE5628E66DBBA82`）。

构建后只读产物核查：`src-tauri/target/release/kystudy.exe` 非零，`25,273,856` bytes，mtime `2026-08-09T11:36:49.9267208+08:00`（晚于构建开始），SHA-256 `FF1CDECD0DD55E55927D07480A7E2446E86DBACC08369DF2143C04CC5DE9549F`；`src-tauri/target/release/kystudy.pdb` 非零，`13,537,280` bytes，mtime `2026-08-09T11:36:49.9409938+08:00`（晚于构建开始），SHA-256 `83C66400E6B6DF861F7F01C435B3D060BC241F2390CA6EBACB7AA054D74678A7`。构建后未启动 EXE/桌面应用。

**最终自动状态：通过。** 完整前端、Rust 和 Tauri 自动门禁均有 exit 0 证据；Release WebView 桌面人工验收仍待用户执行，因此不能据此宣称桌面或整体发布验收通过。

## 11. R32 桌面人工验收基线（待用户最终）

应在隔离工作区或可恢复备份上执行，不直接试写唯一生产数据库。本节只保留待最终核对的桌面基线：

1. 在题库主页观察 loading、ready、refreshing、stale、error 和三类空状态；确认旧 snapshot 在刷新失败时仍可读，错误有重试动作。
2. 展开/折叠多个科目、练习册和分段；确认主页只显示活动分段，孤立题目与回收站记录不会生成树行，每个分段只有一个“管理”。
3. 从主页进入导入，验证 source → assign、检测分段折叠、科目/练习册必选、重复分段冲突、取消分析和失败重试文案。
4. 在 assign 步骤点击 Back，确认回到 source 且保留分析结果；在 dirty/busy 状态测试 Close、Back、Escape、遮罩和 footer 按钮。
5. 打开题目浏览并编辑，确认筛选、分段切换、列表、上一题/下一题和左右键全部锁定；保存或取消后恢复导航。
6. 点击题目缩略图，确认 inline viewer 无嵌套 dialog、缩放/拖拽/关闭/焦点恢复正常，原 PDF 页面不被替换。
7. 将工具中心缩放到约 900px、640px，确认 tab orientation、键盘循环、卡片禁用原因、sticky footer 和独立滚动仍可理解。
8. 在安全区域和动态地址栏环境观察 sidebar、dialog、footer、图片 viewer 的 safe-area/dvh 边距；使用中键、Cmd/Ctrl、Shift、Alt 点击导航，确认原生浏览器行为保留。

## 12. 集成边界与剩余风险

- R32 只改变前端状态呈现、窗口壳和响应式细节；R30 的 active-only reassign、CAS、稳定错误码和 schema 20 数据边界继续有效。
- 主页分组和窗口导航状态不持久化；刷新、恢复和保存后的完整 snapshot 仍是页面唯一数据来源。
- inline viewer 是题目卡片内部 region，不是新的全局窗口栈；任何后续改动都不得恢复嵌套 modal。
- 当前已具备 focused 9 files / 96 tests、完整自动门禁和构建产物证据；Release WebView 桌面人工验收仍待用户执行，不能提前宣称 R32 整体发布通过。
- 若继续修改 `EditorDialog`、题库主页状态机、题目浏览或应用壳断点，应重新执行本节定向验证并同步更新本文件。

## 13. 后续用户验收证据（2026-08-14）

项目维护者已完成本文件所列题库主页、导入流程、题目浏览、工具中心与响应式窗口桌面验收步骤，结果为全部通过。本节仅补充后续用户验收证据，不改写前文自动门禁与历史状态。
