# R48 周期计划事项显式跳过验收

R48 为周期计划事项增加明确的“跳过本次”状态。跳过表示用户决定不执行这一期事项，不等同于完成，也不应被后续顺延、保存或休息日刷新重新变成待完成。本文先冻结三态语义、CAS 与撤销、双页面交互、v22 增量迁移和备份兼容边界。

状态：契约已冻结；功能实现、定向验证、交叉审查、完整自动门禁和 Release 桌面验收均待完成。本文不宣称源码已经满足契约，也不宣称任何门禁已经通过。

> Status update (2026-08-12): implementation, targeted review, full automated gates, and Release build have passed. Desktop acceptance remains pending user execution.

## 1. 三态与进度语义

`CyclePlanItemState` 固定为三种状态：

```text
pending | completed | skipped
```

- `pending`：尚未完成且未跳过，仍可完成、跳过和参与后续顺延；
- `completed`：用户完成本事项，`completedAt` 必须存在；
- `skipped`：用户明确跳过本次，`completedAt` 必须为 `null`；
- `completed` 与 `skipped` 都是 terminal 状态，用于保护历史事项不被重新排程，但只有 `completed` 计入完成进度；
- `completedCount`、`progressPercent` 和完成率只统计 completed；新增 `skippedCount` 单独展示 skipped 数量；
- skipped 不伪装成完成，不增加完成百分比，不生成完成时间，也不改变原计划日期和 `shiftCount`；
- dashboard、月历、计划详情和今日事项必须保留并解析三态，不能把未知状态默认为 pending。

计划 overview 至少继续返回 `completedCount`，并新增非负整数 `skippedCount`。对任一计划必须满足：

```text
completedCount + skippedCount <= totalUnits
```

## 2. 允许的状态转换

普通操作只允许 pending 与某个 terminal 状态之间转换：

```text
pending → completed
pending → skipped
completed → pending
skipped → pending
```

禁止直接执行 `completed → skipped` 或 `skipped → completed`。用户若要改变 terminal 类型，必须先恢复为 pending，再选择完成或跳过，避免一次操作同时伪造完成历史和 skip 历史。

所有转换必须携带事项的 `expectedUpdatedAt`，在 SQLite immediate transaction 内以 item ID、当前 state 和版本执行 CAS。成功版本使用 checked monotonic bump，并在同一事务内 bump R47 aggregate revision、失效相关 R44 shift undo；stale 必须返回 `CYCLE_PLAN_ITEM_STATE_STALE` 且零覆盖。

`completedAt` 不由客户端任意指定：pending → completed 使用服务端写入版本对应的时间；其他普通转换写入 `null`。精确撤销可以恢复服务端保存的原状态和原 `completedAt`，但客户端不得构造新的历史时间。

## 3. 双页面按钮与五秒撤销

显式 skip 同时进入：

- 计划页月历事项/计划详情操作卡；
- 今日页周期计划事项。

pending 事项提供“完成”和“跳过本次”；completed 或 skipped 事项提供“恢复为未完成”。按钮文案、状态标签和成功播报必须明确区分完成、跳过和恢复，不只依赖颜色或删除线。

每次成功转换都提供五秒精确撤销：

- pending → completed 的撤销恢复 pending；
- pending → skipped 的撤销恢复 pending；
- completed → pending 的撤销恢复 completed 及原 `completedAt`；
- skipped → pending 的撤销恢复 skipped，且 `completedAt` 仍为 `null`。

撤销沿用 R43 的 server mutation token、expected version 和 latest-only 页面动作，不从随后返回的 dashboard 推断写入版本。到期边界、焦点回退、跨页面 action 替换和另一窗口 CAS 冲突继续使用既有规则。撤销 stale 时不允许部分恢复。

## 4. 顺延、保存与刷新不变量

- R46 顺延 preview 与 confirm 只选择 state 为 pending 且日期符合条件的事项；completed 和 skipped 都不参与投影或写入；
- 事项被 skip、恢复或完成后，旧 preview token 必须 stale；
- plan save 与全局休息日 refresh 只重建 pending 事项；completed 和 skipped 的 ID、state、`completedAt`、计划日期、原始日期、`shiftCount`、创建时间及事项版本全部保持；
- 保存或刷新不得把 skipped upsert 为 pending，不得删除越界 skipped 后静默降低 `skippedCount`；
- R45 缩量守卫扩展为 terminal 守卫：新 `totalUnits` 不得小于 completed 或 skipped 中的最高 `unitIndex`；
- terminal 集合允许稀疏，例如 completed `{2}`、skipped `{5}` 时缩到 `5` 合法，缩到 `4` 必须整体拒绝；
- terminal 缩量冲突保持稳定安全错误和零写入，不能消费现有 shift undo；
- skip/恢复成功必须 bump 父 plan revision，使其他窗口的旧 R47 plan save token stale。

## 5. v22 增量迁移

R48 通过新的 v22 migration 扩展 `cycle_plan_item.state` CHECK，不修改已发布的 v16 或 v21 SQL。新表继续使用 `STRICT`，并约束：

```text
pending   => completed_at IS NULL
completed => completed_at IS NOT NULL
skipped   => completed_at IS NULL
```

迁移必须保留所有既有 item ID 和逐字段数据。v21 的 `cycle_plan_shift_undo_item.item_id` 外键引用 `cycle_plan_item(id)`；安全重建顺序固定为：

1. 在 migration engine 已开启 foreign keys 的 immediate transaction 中执行；
2. 显式删除 `cycle_plan_shift_undo` headers，通过级联清空五秒 undo snapshots；升级时这些短时 token 统一失效；
3. 创建 `cycle_plan_item_new`，包含三态 CHECK、原有外键、唯一约束和时间约束；
4. `INSERT ... SELECT` 复制全部旧行，保留 ID、plan ID、序号、日期、state、`completedAt`、`shiftCount`、`createdAt` 和 `updatedAt`；
5. 核对复制行数及关键字段后，删除原 `cycle_plan_item`；
6. 将 `cycle_plan_item_new` 重命名为 `cycle_plan_item`；
7. 重建 `idx_cycle_plan_item_calendar`；
8. 记录 migration 22 与 checksum，提交后执行 schema、数据和 foreign-key 验证。

现有 v21 数据只有 pending/completed，迁移不得自行产生 skipped。新建数据库连续应用历史 migrations 和 v22 后必须得到同一 schema。

## 6. 迁移禁止事项

- 禁止修改 v16 `cycle_plan_item` 或 v21 shift undo migration 及其历史 checksum；
- 禁止先把旧 `cycle_plan_item` rename 为 old：SQLite 会把 v21 undo-item FK 一并改指向 old 表；
- 禁止在 migration transaction 内依赖 `PRAGMA foreign_keys = OFF`，该设置不会安全解决当前事务的外键重建；
- 禁止在复制时生成新 item ID、使用 `INSERT OR REPLACE` 或丢弃 terminal 行；
- 禁止先 drop parent 而未明确处理 R44 undo snapshots；
- 禁止留下 undo header 无 snapshot、FK 指向临时/已删除表或旧日历索引；
- 禁止只用空数据库验证升级，或只跑 `quick_check` 而不跑 `foreign_key_check`；
- 禁止为了 v22 接受被修改的 v16/v21 checksum；未知历史 checksum 仍必须拒绝。

## 7. 备份、恢复与 FK 门槛

迁移与备份验收至少满足：

- populated v21 → v22：pending/completed item 的 ID 和全部字段逐项不变；
- v21 数据库存在有效 R44 undo header/snapshot 时仍可升级；undo 按迁移策略完整失效，不留下孤立行；
- `PRAGMA foreign_key_check` 返回零行；
- `PRAGMA foreign_key_list(cycle_plan_shift_undo_item)` 中 `item_id` 明确指向新的 `cycle_plan_item(id)`；
- item 日历索引存在且覆盖新三态；schema SQL 仍包含 `STRICT`、三态 CHECK 和 `completedAt` 一致性 CHECK；
- 人为制造 migration 中途失败时，item、undo、schema history 和 `user_version` 全部回滚到 v21；
- 当前 v22 backup round trip 精确保留 skipped；
- verified v21 backup 可以恢复并升级到 v22；v2/v3 历史 backup fixtures 删除新 migration history 后仍能升级到 latest；
- backup manifest 升级后的 schema version、数据库 hash 和大小按真实 v22 文件重写；
- 新建工作区和从所有受支持历史版本升级均到达 `LATEST_SCHEMA_VERSION = 22`。

## 8. DTO 与稳定错误

前后端三态 DTO 必须严格对齐：

```ts
type CyclePlanItemState = "pending" | "completed" | "skipped";
```

`CyclePlanOverview` 新增 `skippedCount`。parser 拒绝未知 state、负数或不安全的 count、completed 状态缺少 `completedAt`，以及 pending/skipped 携带 `completedAt`。

状态转换继续区分 item not found 与 stale。Rust `CyclePlanError`、Tauri safe DTO 和 TypeScript `ERROR_COPY` 对既有 `CYCLE_PLAN_ITEM_NOT_FOUND`、`CYCLE_PLAN_ITEM_STATE_STALE` 使用相同稳定码和可执行文案，不泄露 SQL、路径、内部旧状态、版本或 undo payload。

## 9. 必须覆盖的自动测试

Domain/application 至少覆盖：

- 三态 parse/as-str 与 `completedAt` 不变量；
- 四条允许转换、两条禁止的 terminal-to-terminal 转换；
- skipped 不增加 completed count/progress，并正确增加 `skippedCount`；
- skip/恢复严格 bump item 与 aggregate revision；
- stale expected version 零覆盖，not found 与 stale 分离；
- 四类状态转换的五秒精确撤销，包括 completed 原时间恢复和 skipped 精确恢复；
- 同毫秒、到期边界和跨窗口改变后的撤销拒绝。

Repository/migration 至少覆盖：

- v21 populated/undo 数据升级、失败回滚、FK target、foreign-key check 和索引；
- v22 backup round trip、verified v21 restore、v2/v3 fixtures；
- shift preview/confirm 排除 skipped，skip 后旧 preview stale；
- save/refresh 逐字段保留 completed 与 skipped；
- completed/skipped 稀疏 terminal 缩量边界及冲突零写入/undo 保留；
- skip、恢复和撤销任一 CAS 冲突时 plan/item/undo 整体回滚。

前端至少覆盖：

- client parser 三态、`skippedCount` 和 exact invoke payload；
- 计划页与今日页 pending 的完成/跳过按钮、terminal 恢复按钮及状态标签；
- skip 不增加完成进度，dashboard 刷新后仍显示 skipped；
- 四类 latest-only undo、五秒 timer、焦点回退与错误状态；
- 两个页面不会从 dashboard 猜测 mutation token 或旧 `completedAt`；
- 跨窗口 stale、归档/刷新导航清理和键盘操作。

## 10. 自动门禁与桌面验收状态

自动门禁已于 2026-08-12 完成，以下状态依据实际输出回填：

| 门禁                                                 | 当前状态                          |
| ---------------------------------------------------- | --------------------------------- |
| owned `pnpm check:target`                            | 通过（相关前端定向测试）          |
| Rust 定向测试                                        | 通过（34 项）                     |
| migration/backup/FK 定向测试                         | 通过                              |
| `pnpm check`                                         | 通过（58 个测试文件、362 项测试） |
| `cargo fmt --all -- --check`                         | 通过                              |
| `cargo test --locked`                                | 通过（280 项）                    |
| `cargo clippy --locked --all-targets -- -D warnings` | 通过                              |
| `pnpm tauri build --no-bundle`                       | 通过（Release 构建）              |

Release 桌面验收尚未执行。实现完成后由用户验证：在计划页和今日页分别跳过 pending 事项，确认完成数不增加、`skippedCount` 增加、顺延排除 skipped；五秒内撤销精确恢复，超过边界不能撤销；恢复 skipped 后可重新完成或跳过；保存、休息日刷新和应用重启后 skipped 保持；双窗口 stale 不覆盖；terminal 缩量被正确阻止；旧工作区与备份升级后历史事项、FK 和基础流程正常。本文当前不宣称桌面验收通过。

## 11. 后续用户验收证据（2026-08-14）

项目维护者已完成本文件所列计划事项跳过、撤销恢复、持久化、双窗口 stale 与升级兼容桌面验收步骤，结果为全部通过。本节仅补充后续用户验收证据，不改写前文自动门禁与历史说明。
