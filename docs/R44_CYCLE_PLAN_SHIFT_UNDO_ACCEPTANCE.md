# R44 周期计划顺延撤销验收

R44 为周期计划的“从选中日期后顺延”增加服务端授权的单次撤销能力。顺延与完成状态撤销共用页面上的一个 latest-only 操作入口；撤销只携带服务端返回的 opaque token，不把客户端保存的旧日期或旧排程作为恢复依据。

状态：实现已完成，定向门禁和完整自动门禁已通过；未启动 Release EXE，桌面人工验收待用户执行。

## 1. 用户目标与边界

- 对选中日期后的未完成事项顺延一个学习日，成功后在状态条显示“撤销顺延”；
- 撤销窗口为服务端返回的五秒有效期，窗口到期后按钮自动消失；
- 同一页面只保留最新一项可撤销操作：新的事项完成/恢复、顺延、保存、月历显示切换、归档或刷新都会替换或清除旧撤销；
- 关闭计划窗口、打开新建计划或切换到另一份计划时也会清除旧撤销，避免事项或顺延动作跨窗口、跨计划残留；
- 没有符合条件的未完成事项时，顺延仍可返回最新计划，但不显示撤销入口；
- 顺延沿用既有筛选语义：已完成事项不参与顺延，不改变其完成状态、完成时间或日期；本轮没有新增 skip 功能，仅处理状态为 `pending` 且计划结束日期不早于选中日期的事项。

本轮不把顺延撤销接入“今日”页。今日页当前只有单项完成状态切换，没有顺延入口；其现有单项撤销保持不变。

## 2. 前后端契约

前端 `src/shared/tauri/cyclePlanClient.ts` 对应如下 DTO：

```ts
interface CyclePlanShiftUndo {
  planId: string;
  undoToken: string;
  expiresAt: number;
}

interface CyclePlanShiftMutation {
  dashboard: CyclePlanDashboard;
  shiftedItemCount: number;
  undo: CyclePlanShiftUndo | null;
}

interface ShiftCyclePlanRequest {
  planId: string;
  fromDate: string;
  studyDays: number;
}

interface UndoCyclePlanShiftRequest {
  planId: string;
  undoToken: string;
}
```

`shiftCyclePlan` 调用 `shift_cycle_plan` 并解析完整 mutation；`undoCyclePlanShift` 调用 `undo_shift_cycle_plan`，请求只包含 `planId` 与 `undoToken`，响应为最新 `CyclePlanDashboard`。`undoToken` 只按非空 opaque 字符串校验，不在前端解析 UUID 或推导旧日期。

## 3. 服务端快照与并发保护

- migration `0021_cycle_plan_shift_undo.sql` 建立顺延操作表和逐事项快照表；服务端保存旧的开始日、结束日、`shiftCount`、版本，以及顺延后的字段和版本；
- 顺延写入与快照保存位于同一 SQLite immediate transaction；同一计划的新顺延先删除旧 token，因此旧 token 不能重复撤销；
- 无事项顺延会清理该计划已有 token，并返回 `shiftedItemCount: 0` 与 `undo: null`；
- 撤销先检查计划、token、有效期和快照数量，再逐项以顺延后的日期、`shiftCount`、`updatedAt` 做 CAS 更新；任何一个事项在另一窗口发生变化都会返回 `CYCLE_PLAN_SHIFT_UNDO_STALE`，整次事务回滚，不发生部分恢复；
- 成功撤销会为恢复后的事项生成更新版本并消费 token；再次使用返回 `CYCLE_PLAN_SHIFT_UNDO_UNAVAILABLE`；完成状态变更、恢复、保存或归档也会清理受影响计划的顺延 token。

## 4. 前端交互与无障碍

`src/features/planning/CyclePlanPanel.tsx` 将现有撤销状态扩展为 `item | shift` 两种 action：

- 两种 action 共用一个 `PageStatus` 成功条和一个撤销按钮，新的操作总是替换旧 action；
- item action 继续使用 `cyclePlanUndo.ts` 的本地五秒窗口；shift action 使用服务端 `expiresAt`，并通过 `cyclePlanShiftUndo.ts` 校验计划、opaque token 和有效期；
- 撤销按钮失效时，焦点返回触发该撤销的事项按钮或顺延按钮；timer 回调以 action identity 比较，避免旧 timer 清除新 action；
- 顺延成功的状态条按服务端 `shiftedItemCount` 播报，零事项结果不渲染撤销动作；冲突错误使用稳定文案并清除当前 action。

## 5. 定向验证证据

本轮 owned target：

```text
pnpm check:target -- \
  src/shared/tauri/cyclePlanClient.ts \
  src/shared/tauri/cyclePlanClient.test.ts \
  src/features/planning/cyclePlanShiftUndo.ts \
  src/features/planning/cyclePlanShiftUndo.test.ts \
  src/features/planning/CyclePlanPanel.tsx \
  src/features/planning/CyclePlanPanel.test.ts \
  src/features/planning/cyclePlanUndo.ts \
  src/shared/tauri/cyclePlanClient.ts \
  docs/R44_CYCLE_PLAN_SHIFT_UNDO_ACCEPTANCE.md
```

结果：通过。Prettier、ESLint、TypeScript 通过；导航清理修复后的直接测试 7 passed，related 测试 29 passed。

前端定向测试覆盖：

- mutation wrapper、opaque token、`undo: null` 和命令 invoke 请求形状；
- 计划不一致、空 token、服务端过期时间、identity、边界过期和请求创建；
- item/shift 最新 action 替换、顺延成功/no-op/撤销按钮和 timer/focus 相关代码路径。

后端定向证据已落在以下测试中：

- `shift_undo_restores_the_backend_snapshot_and_consumes_the_token`；
- `latest_shift_supersedes_the_previous_undo_token`；
- `zero_item_shift_clears_the_previous_undo_token`；
- `expired_shift_undo_is_rejected_without_restoring_rows`；
- `cross_window_row_conflict_rolls_back_the_entire_shift_undo`；
- `shift_cycle_plan_result_exposes_only_backend_undo_token` 与 `shift_undo_errors_use_stable_cycle_plan_codes`。

## 6. 交叉审查修复记录

- 统一前端 invoke、直接测试和文档中的撤销命令名为后端注册名 `undo_shift_cycle_plan`；
- 保持撤销请求只携带服务端 opaque token，不从 dashboard 推导旧日期或版本；
- 补齐 v2/v3/v7 fixture 覆盖，统一 expiry equality 在到期边界判定为已过期；
- 导航到关闭窗口、新建计划或其他计划时清理 item/shift latest action，并清空焦点来源；
- 对 Rust clippy 提示完成 helper 重构，保留原行为和 CAS 保护。

## 7. 完整门禁与人工验收

本批次完整自动门禁结果如下；本轮不重复执行。

| 门禁                                                 | 结果                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm check`                                         | 通过；45 个 test files、289 个 tests，production build 通过 |
| `cargo fmt --all -- --check`                         | 通过                                                        |
| `cargo test --locked`                                | 通过；262 passed                                            |
| `cargo clippy --locked --all-targets -- -D warnings` | 通过                                                        |
| `pnpm tauri build --no-bundle`                       | 通过；Release 编译耗时 2m03s，产物路径可写                  |
| 桌面人工验收                                         | 待用户执行；未启动 Release EXE                              |

本批次没有启动 Release EXE，也没有宣称桌面验收通过；产物路径可写不等于桌面行为已验收。

### 7.1 后续桌面人工验收

2026-08-11，用户完成桌面人工验收并确认通过。本记录是完整自动门禁之后补充的人工证据，不改写上表所记录的历史门禁结果与当时状态。
