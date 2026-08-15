# R42 周期计划月历排程预览验收

R42 在新建和编辑周期计划时增加本地排程预览。预览复用 Rust 周期计划生成规则，在用户明确点击确认前只展示草稿日期，不写入正式计划。本文记录本轮目标、稳定契约、定向证据、交叉审查结论和桌面验收结果；完整门禁和用户桌面验收均已记录。

状态：`accepted`（2026-08-10 用户桌面验收通过）

## 1. 用户目标与范围

- 用户填写计划名称、数量、单位、开始日期、截止日期、每单位学习日和排程方式后，立即看到单位日期范围与预计完成日期；
- `rhythm` 保持单位之间的学习日节奏，允许预计超出截止日期并明确提示；`even` 将单位端点均匀分布到截止日期；
- 全局每周休息日由计划页设置继承，排程预览和正式生成都跳过这些日期；
- 只有点击“确认排程并保存”才调用 `save_cycle_plan`。取消、关闭或放弃草稿不会创建或更新计划；
- 新建、编辑、月历可见性、完成进度、顺延、归档和后端数据模型边界保持不变。

## 2. 排程模型契约

实现文件为 `src/features/planning/cycleCalendar.ts`，正式生成契约为 `src-tauri/src/application/cycle_plan.rs`。

- 日期必须是严格的公历 `YYYY-MM-DD`，年份不能为 `0000`；截止日期不能早于开始日期，日期跨度限制为 `0..=1095` 天；
- 总单位数限制为 `1..=500`，每单位学习日限制为 `1..=30`；排程方式只接受 `rhythm` 或 `even`；
- 休息日使用周一为 `0`、周日为 `6` 的编号，列表必须唯一且少于 7 项；
- `rhythm` 从第一个可学习日开始，按学习日偏移生成每个单位的开始和结束日期，允许结束日期超过截止日期；
- `even` 使用开始日至截止日之间的可学习日列表，并按 Rust 相同的整数四舍五入端点公式生成结束日期，再向前回溯单位所需学习日；单位不足时允许重复端点；
- 每个单位的日期范围为闭区间，`estimatedEndDate` 是所有单位结束日期的最大值，`exceedsDeadline` 表示该日期是否晚于截止日期；
- 无效草稿或无法生成排程时预览返回 `undefined`，保存按钮保持禁用。预览不是持久化锁，后端保存时仍重新校验并以正式生成结果为准。

## 3. 模型定向测试

`src/features/planning/cycleCalendar.test.ts` 共 8 项测试通过，覆盖：

1. 周一开始的六周月历；
2. 五周月份不渲染空的第六行；
3. 多日计划项的闭区间占用判断；
4. `rhythm` 跳过休息日并报告超期；
5. `even` 与 Rust 兼容的四舍五入端点；
6. 单单位 `even` 的确定性端点；
7. 学习容量不足时保留重复端点；
8. malformed 日期、越界数量/学习日、未知模式、重复或全量休息日及无可学习日输入均被拒绝。

## 4. UI 定向门禁与交叉审查

本轮目标检查范围为：

```text
pnpm check:target -- docs/R42_CYCLE_PLAN_CALENDAR_PREVIEW_ACCEPTANCE.md src/features/planning/cycleCalendar.ts src/features/planning/cycleCalendar.test.ts src/features/planning/CyclePlanPanel.tsx src/app/app.css
```

结果：通过。Prettier、ESLint、TypeScript 和相关 Vitest 均通过；`cycleCalendar.test.ts` 1 个测试文件、8 项测试通过，`vitest related` 复用该 8 项测试通过。

交叉审查已完成，未发现 P0、P1 或 P2 实现回归：

- TypeScript 预览模型与 Rust 的日期解析、跨度/数量边界、休息日校验以及 `rhythm`/`even` 端点行为一致；
- `CyclePlanPanel.tsx` 只有在草稿有效且预览成功时启用确认按钮，没有绕过显式保存确认的路径；
- `.cycle-plan-preview` 及列表规则提供内部滚动、换行和 `420px` 以下的单列列表布局，未见已确认的横向溢出或明显无障碍回归；
- 当前没有 `CyclePlanPanel` 的 DOM 级测试。后续应补充无效草稿禁用、字段变更后的预览重算、确认调用保存和 dirty 放弃确认等场景；这属于覆盖缺口，不是本轮已证实的运行时缺陷。

## 5. 完整门禁状态

本批次集成后的完整门禁已按 `docs/DEVELOPMENT_WORKFLOW.md` 顺序通过：

```text
pnpm check
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri build --no-bundle
```

- 前端 `pnpm check` 通过：42 个 Vitest 文件、266 项测试通过，Prettier、ESLint、TypeScript 和 Vite production build 均通过；
- Rust `cargo fmt --all -- --check`、`cargo test --locked`（248 项测试通过）和 `cargo clippy --locked --all-targets -- -D warnings` 均通过；
- `pnpm tauri build --no-bundle` 通过，产物为 `F:/develop/KyStudy/src-tauri/target/release/kystudy.exe`；
- 未启动 Release EXE，也未代替用户执行桌面验收，桌面验收仍待用户完成。

## 6. 桌面人工验收点

1. 新建周期计划并逐项修改数量、单位、日期、学习日和排程方式，确认预览立即更新，显示单位日期范围、预计完成日期和截止冲突提示；
2. 设置一个或多个每周休息日，确认预览日期跳过休息日；切换 `even` 后确认最后一个单位落在截止日期或在无可学习日时明确不可保存；
3. 输入缺失、非法或超出边界的草稿，确认预览提示可操作、确认按钮禁用，且没有计划被写入；
4. 点击确认后确认计划和月历才出现；编辑已有计划时修改字段、关闭窗口或返回摘要，确认 dirty 弃置确认仍生效；
5. 在 `1280px`、`680px`、`420px` 和 `320px` 宽度检查预览标题、单位日期列表、状态文字和确认按钮不重叠或横向溢出；
6. 使用键盘完成字段编辑、预览滚动、保存、关闭和弃置确认，确认状态播报、焦点回收和按钮禁用状态清晰可达。

## 7. 用户桌面验收结果（2026-08-10）

用户于 2026-08-10 在 Release WebView 中完成第 6 节列出的周期计划排程预览、休息日与 `even` 边界、无效草稿禁用/不写入、确认保存与编辑 dirty 弃置、响应式宽度和键盘可达性场景，并确认全部通过。该结果补充独立的人工验收证据；第 4、5 节既有定向与完整自动门禁记录保持原样。
