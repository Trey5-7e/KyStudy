# R47 周期计划保存 CAS 验收

R47 为周期计划创建与编辑建立明确的聚合版本契约，避免两个窗口基于不同 dashboard 保存时由较旧草稿覆盖最新计划、事项状态、排程或撤销能力。本文记录 application、repository、SQLite、Tauri DTO 与前端错误处理边界，以及实现完成后的自动验证证据。

状态：功能实现、定向验证、交叉审查和完整自动门禁已通过；未启动 Release EXE，桌面人工验收待用户执行。

## 1. 用户目标与范围

- 新建周期计划不需要并发版本，因为目标 plan ID 尚不存在；
- 编辑已有计划必须携带用户开始编辑时看到的 `expectedUpdatedAt`；
- 如果计划或其事项已在另一窗口发生变化，本次保存必须整体拒绝，不能覆盖最新状态；
- 保存冲突后编辑窗口保持打开，所有草稿字段原样保留，用户可以核对最新计划后再决定如何调整；
- 成功保存继续按既有规则保留已完成历史、重排未完成事项并返回最新 dashboard；
- 本轮不新增 skip 状态、skip 命令或 `cycle_plan_item` schema 变更。显式“跳过本次”作为 R48 后续批次单独设计和验收。

R47 只收紧周期计划聚合的并发写入契约，不改变 R44 shift undo 的五秒有效期、R46 preview token 或 R45 缩量完整性规则。

## 2. 保存请求与稳定 DTO

冻结后的请求形状为：

```ts
interface SaveCyclePlanInput {
  planId?: string;
  expectedUpdatedAt?: number;
  name: string;
  totalUnits: number;
  unitLabel: string;
  startDate: string;
  deadline: string;
  studyDaysPerUnit: number;
  scheduleMode: "rhythm" | "even";
  calendarVisible: boolean;
}
```

组合规则必须在 TypeScript、Tauri DTO 和 application 输入层一致：

- `planId` 与 `expectedUpdatedAt` 都不存在：创建；
- `planId` 与正整数 `expectedUpdatedAt` 同时存在：更新；
- 只提供其中一个、版本不是安全正整数或携带未知字段：`CYCLE_PLAN_INPUT_INVALID`；
- 前端不得从当前全局 dashboard 临时猜测版本，编辑草稿在打开时固定保存对应 plan 的 `updatedAt`；
- 保存失败重试仍使用原版本，直到用户明确重新加载最新计划并重新建立草稿基线。

## 3. 聚合 revision

`cycle_plan.updated_at` 继续作为周期计划聚合 revision，不新增列或迁移。它不只是计划表单的修改时间：任何改变该计划可观察状态或使旧保存草稿失效的成功事务，都必须将 revision 严格递增，包括：

- 编辑保存和重新排程；
- 事项完成、恢复和对应撤销；
- 顺延确认与顺延撤销；
- 归档；
- 因全局休息日刷新而重建该计划排程。

一次事务对同一聚合只产生一个新 revision。新 revision 使用 checked `max(current_utc_millis, current_revision + 1)`，必须严格大于事务内读取的当前 revision；整数溢出返回安全错误并整笔回滚。

事项自己的 `updatedAt` 继续承担逐事项 CAS。聚合 revision 与事项版本用途不同，不能用 dashboard 中某个事项的最大版本替代 plan revision，也不能因系统时间处于同一毫秒而复用旧 revision。

## 4. SQLite 保存事务

更新保存的权威判断必须位于同一个 `BEGIN IMMEDIATE` transaction 内：

1. 获取当前 workspace；
2. 按 plan ID 和 workspace 读取未归档计划及当前 aggregate revision；
3. 计划不存在或已归档时返回 `CYCLE_PLAN_NOT_FOUND`；
4. 当前 revision 与 `expectedUpdatedAt` 不相等时返回 `CYCLE_PLAN_SAVE_STALE`；
5. 完成 R45 最高已完成序号守卫及全部输入不变量检查；
6. 计算严格递增的新 aggregate revision；
7. 以 `WHERE id = ? AND workspace_id = ? AND archived_at IS NULL AND updated_at = ?` 执行 plan CAS，影响行数必须恰好为 `1`；
8. 只在 CAS 成功后失效该计划的 shift undo、删除越界 pending 项并重排允许更新的事项；
9. 任一事项写入、约束或持久化失败时回滚 plan、items、revision 和 undo；
10. commit 后返回包含新 revision 的 dashboard。

创建路径同样使用 immediate transaction，但不接受 `expectedUpdatedAt`。生成的新 plan revision 必须满足 `updatedAt >= createdAt`；随机 ID 冲突、名称唯一约束或任何事项生成失败都必须整笔回滚。

application 层可以预先加载计划用于构造排程或改善错误提示，但不能把事务外读取作为 CAS 权威。真正的存在性、active/workspace、revision、缩量和 rowcount 判断全部由 repository transaction 决定。

## 5. Stale 零写入不变量

当 `expectedUpdatedAt` 过期时，必须在任何持久变更前返回 stale：

- plan 字段、aggregate revision 和所有 item 行保持不变；
- 已完成事项及其 `completedAt`、日期和版本保持不变；
- pending 排程不被部分重写或删除；
- 当前 shift undo header、snapshot、token 和 expiry 保持可用；
- R46 preview 所依赖的当前状态不因失败保存发生变化；
- application 不在 stale 后调用第二次无版本保存，也不自动刷新后静默覆盖用户草稿。

如果 CAS `UPDATE` 影响 `0` 行，repository 必须在事务内区分 plan missing/archived 与 revision stale，不能把两者都映射为数据库错误。

## 6. 稳定错误码与安全文案

保存版本冲突使用稳定码：

```text
CYCLE_PLAN_SAVE_STALE
```

规范文案为：

- 提示：`周期计划已在其他窗口发生变化。`
- 操作建议：`刷新计划并重新核对编辑内容后再保存。`

Rust `CyclePlanError`、Tauri `AppErrorDto` 和 TypeScript `ERROR_COPY` 必须使用同一码与同一文案。错误 DTO 不得包含当前/期望 revision、SQL、数据库路径、事项内容或 undo token。

前端收到 stale 后：

- 保持编辑 modal、受控 draft、dirty 状态和用户当前焦点；
- 显示上述稳定提示与操作建议；
- 不关闭窗口、不替换 draft、不清理输入；
- 不自动把 `expectedUpdatedAt` 改成服务器最新值后重试；
- 用户明确关闭并重新打开，或选择专用的重新加载动作后，才建立新的 draft 与版本基线。

## 7. 无迁移边界

R47 复用既有 `cycle_plan.updated_at` 与 `cycle_plan_item.updated_at`，不新增 migration、表、列、trigger 或备份格式变化。历史 migration SQL 与 checksum 保持完全不变，`LATEST_SCHEMA_VERSION` 不因 R47 改动。

任何未来为显式 skip 重建 `cycle_plan_item` 的 schema 工作均属于 R48，不得提前混入 R47，也不得以保存 CAS 为由修改 v16/v21 历史 migration。

## 8. 交叉审查闭环

最终独立交叉审查发现的问题已按冻结边界关闭：

- 全局休息日保存后的周期计划刷新已收敛到后端统一流程；无论从计划页还是错题页修改休息日，受影响周期计划都会重排并严格 bump aggregate revision；
- 计划页不再在保存休息日后自行串联第二次周期刷新，只读取后端统一操作完成后的最新 dashboard，避免计划页与错题页形成不同调用路径；
- update 请求携带 `expectedUpdatedAt` 但目标计划不存在时返回 `CYCLE_PLAN_NOT_FOUND`；只有计划存在且 revision 不匹配时才返回 `CYCLE_PLAN_SAVE_STALE`；
- 定向测试已补充事项 restore 与 plan archive 后旧 save token stale，证明两类 mutation 都会 bump 父 plan revision 并阻止旧草稿覆盖。

休息日保存与周期计划刷新仍是两阶段、非原子边界：休息日事务先提交，随后周期计划按 plan 分别执行刷新事务。如果 refresh 失败，命令会返回错误，但休息日可能已经保存，且部分周期计划可能已经刷新。用户应重试周期计划刷新并重新加载 dashboard；实现和测试不得把错误响应解释为所有数据均已回滚。

定向验证结果：

- 前端实现阶段定向测试 `33 passed`，related 测试 `27 passed`；最终 focused 结果为 `cyclePlanClient` `21 passed`、`CyclePlanPanel` `13 passed`；
- 后端定向测试共 `25 passed`：SQLite repository `19`、application `5`、command DTO `1`；
- 交叉审查 findings 均有对应回归测试，覆盖休息日统一刷新、missing/archived 分类、restore/archive revision bump、stale 零写入与稳定错误文案。

上述修复不新增 migration，也不改变 R44 undo、R45 缩量或 R46 preview 的既有稳定码和数据边界。

## 9. 必须覆盖的自动测试

Application/DTO 至少覆盖：

- create 不携带 expected version 并成功；
- update 缺少、非法或多余 expected version 被拒绝；
- camelCase `expectedUpdatedAt` 正确映射，unknown fields 被拒绝；
- `CYCLE_PLAN_SAVE_STALE` 的 Rust/TS code、message、action 完全一致；
- stale 返回后前端 modal 和 draft 保留，成功后才关闭；
- 前端不会在 stale 后无版本重试或静默替换 revision。

Repository/SQLite 至少覆盖：

- 正确 expected revision 更新成功并严格 bump；
- 两次操作处于同一毫秒时 revision 仍严格递增；
- stale expected revision 返回稳定错误且 plan/items/undo 逐字段不变；
- 两窗口从同一 revision 保存，只有第一笔成功；
- 事项完成、恢复、顺延确认、顺延撤销和归档均使旧 plan save stale；
- stale CAS 发生在 undo DELETE、pending DELETE 和 item upsert 之前；
- CAS rowcount `0` 时正确区分 missing、archived 与 stale；
- 缩量冲突与 revision stale 各自返回正确稳定码，并都保持零写入；
- 创建发生名称/ID/事项错误时整笔回滚；
- refresh schedules 为每个成功更新的聚合严格 bump revision。

## 10. 完整自动门禁

本批次完整自动门禁已按集成顺序执行一次：

| 门禁                                                 | 结果                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm check`                                         | 通过；46 个 test files、313 个 tests，production build 通过 |
| `cargo fmt --all -- --check`                         | 通过                                                        |
| `cargo test --locked`                                | 通过；276 passed                                            |
| `cargo clippy --locked --all-targets -- -D warnings` | 通过                                                        |
| `pnpm tauri build --no-bundle`                       | 通过；Release 编译耗时 3m12s                                |

无 bundle 构建产物位于 `src-tauri/target/release/kystudy.exe`。本批次未启动该 EXE；自动门禁通过不代表桌面人工验收通过。

## 11. 待执行桌面验收

桌面验收由用户启动 Release 应用后执行：

1. 打开两个应用窗口 A/B，在两个窗口中打开同一周期计划并进入编辑，分别修改可辨认的字段；
2. 在 A 保存，确认保存成功并显示最新计划；随后在 B 保存，确认返回 `CYCLE_PLAN_SAVE_STALE`，编辑窗口保持打开、B 的全部草稿与 dirty 状态保留，A 的计划字段、事项排程和 undo 均未被覆盖；
3. 在 B 关闭旧编辑并重新加载最新 dashboard，再次进入编辑并保存，确认可以基于新 revision 成功；
4. 再让 B 持有一份未保存草稿，依次在 A 完成一个事项、确认一次顺延、撤销该顺延；每次操作后尝试从 B 保存旧草稿，均应 stale、保留草稿且零覆盖；
5. B 再持有旧草稿时，从 A 修改全局休息日；确认后端刷新周期排程并 bump revision，B 保存继续 stale；
6. 创建一份新周期计划，确认请求不需要 `expectedUpdatedAt` 且创建成功；归档另一份已在 B 打开的计划后，从 B 保存旧窗口，确认返回 `CYCLE_PLAN_NOT_FOUND` 而不是 stale；
7. 若休息日保存后的周期刷新返回错误，按第 8 节非原子边界处理：不要假定休息日已回滚，重试周期刷新并重新加载 dashboard，核对所有计划 revision 和排程后再编辑。

上述桌面验收当前尚未执行，本文不宣称桌面验收通过。

## 12. R48 后续边界

R48 再实现显式“跳过本次”，包括 skip 状态语义、事项 CAS、撤销、排程与进度表现，以及确有需要时的增量 migration。R47 只为所有后续聚合写入建立可靠的 plan-save CAS 基线，不提前创建 skip schema 或 UI。

## 13. 后续桌面验收证据

2026-08-11，用户按第 11 节步骤完成 Release 桌面验收并确认通过：双窗口旧草稿被 `CYCLE_PLAN_SAVE_STALE` 阻止并完整保留，未覆盖另一窗口的新计划、事项或 undo；重新加载后可基于新 revision 保存；事项完成、顺延确认、顺延撤销和休息日修改均使旧保存 token stale；新建计划无需 token；归档后的旧窗口保存返回 not found；休息日刷新错误按两阶段边界重试刷新并重新加载 dashboard。

本节是完整自动门禁之后追加的用户证据，不改写第 10 节已经记录的门禁结果，也不表示本轮重新运行过构建或自动测试。R47 当前状态为：自动门禁通过，2026-08-11 用户桌面验收通过。
