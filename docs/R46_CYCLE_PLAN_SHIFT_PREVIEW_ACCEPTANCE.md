# R46 周期计划顺延预览与确认验收

R46 将周期计划“顺延后续”从单次直接写入调整为“服务端预览 → 用户确认 → 服务端原子写入”。本文记录冻结后的产品、DTO、安全和并发契约，以及实现完成后的自动验证证据。

状态：功能实现、定向验证、交叉审查和完整自动门禁已通过；未启动 Release EXE，桌面人工验收待用户执行。

## 1. 用户目标与产品边界

- 用户点击“顺延后续”后先进入同一计划管理窗口内的预览 modal，不立即写入计划；
- 预览显示受影响事项数量、当前与顺延后的预计完成日期、截止日期、跳过的每周休息日，以及超过截止日期的天数；
- 用户明确点击确认后才允许写入；取消或关闭预览必须零写入；
- 超过截止日期属于可确认的 warning，不是阻止条件。界面明确显示超期天数，并继续提供既有的加快频率或减少次数入口；
- 没有符合条件的未完成事项时仍可展示零事项说明，但不提供可用的确认动作；
- 已完成事项不进入顺延，不改写其日期、状态或完成历史；
- 确认成功后继续提供 R44 的五秒“撤销顺延”。撤销入口必须在 modal 流程内可达，不能因确认后关闭或切换视图而立即丢失；
- R46 不新增迁移或持久化 preview 表，不改变既有 shift undo 表及其备份兼容边界。

该流程落实 PRD 中“顺延和重新规划必须预览后确认”以及“写入前显示新的预计完成日期”的要求。预览不是客户端写入授权，后端仍是计划状态与正式排程的唯一权威。

## 2. Tauri DTO 与命令

新增两个命令，移除旧的直接写入命令 `shift_cycle_plan` 及其前端调用入口：

```text
preview_cycle_plan_shift
confirm_cycle_plan_shift
```

冻结后的 TypeScript 形状如下：

```ts
interface CyclePlanShiftIntent {
  planId: string;
  fromDate: string;
  studyDays: number;
}

interface CyclePlanShiftPreview {
  planId: string;
  fromDate: string;
  studyDays: number;
  affectedItemCount: number;
  currentEstimatedEndDate: string;
  newEstimatedEndDate: string;
  deadline: string;
  exceedsDeadlineByDays: number;
  restWeekdays: number[];
  previewToken: string | null;
}

interface ConfirmCyclePlanShiftRequest extends CyclePlanShiftIntent {
  previewToken: string;
}
```

`preview_cycle_plan_shift` 接收 `CyclePlanShiftIntent` 并返回 `CyclePlanShiftPreview`。`confirm_cycle_plan_shift` 只接收同一 intent 与 `previewToken`，成功响应继续使用包含 dashboard、`shiftedItemCount` 和可选 undo 的 mutation wrapper。

`fromDate` 和 `studyDays` 属于用户 intent。确认请求不得携带任何事项 ID 列表、事项当前/新日期、预计完成日期、休息日、行版本或客户端计算结果。预览响应也不返回逐事项 `items`；所有正式写入值必须由服务端重新生成。

当 `affectedItemCount` 为 `0` 时，`previewToken` 必须为 `null`，前端不得构造确认请求。非零预览返回非空 opaque token；前端不解析、截断或自行生成 token。

## 3. Canonical 状态指纹

`previewToken` 是确定性 canonical 状态的 SHA 指纹，用于证明确认时的计划状态仍与预览一致。它不是鉴权凭据或需要保密的秘密，不使用 HMAC、持久密钥、随机 nonce、preview 表或 `expiresAt`。

canonical 编码必须有固定版本和 domain separator，使用无歧义的字段编码与固定排序，至少覆盖：

- 当前工作区与计划 ID、用户 intent；
- 计划是否 active、计划规则、截止日期和 `updatedAt`；
- 排序且去重后的 `restWeekdays`；
- 按稳定顺序排列的全部计划事项状态，包括会影响资格或结果的 ID、序号、state、计划日期、`shiftCount` 和 `updatedAt`；
- 服务端计算出的受影响数量、当前/新预计完成日期和超期天数；
- 排程算法版本。

不能只哈希符合条件的事项：新增符合项、另一事项完成、计划保存或休息日变化都必须使旧预览失效。不能只依赖 `updatedAt`：即使两个动作落在同一毫秒，日期、状态或规则字段变化也必须改变指纹。

因为 token 没有过期时间，只要 intent 与 canonical 状态保持完全一致，预览可以继续确认；任一相关状态改变后必须返回 stale。纯 SHA 指纹不能证明用户实际看过 modal，明确确认由 UI 流程保证；安全性来自确认端不信任客户端结果并在事务内重算，而不是把 token 当作秘密。

## 4. 确认事务与并发不变量

确认必须在同一个 SQLite immediate transaction 内完成以下步骤：

1. 严格校验 plan ID、日期、学习日数量和非空 token；
2. 确认计划属于当前工作区且未归档；
3. 从事务内重新读取计划、全部事项和全局休息日；
4. 使用与预览相同的纯排程函数重新计算符合项、顺延日期、预计完成日期、超期天数与 canonical 指纹；
5. 指纹不一致时返回 `CYCLE_PLAN_SHIFT_PREVIEW_STALE`，整个事务零写入；
6. 重新计算后受影响事项为零时拒绝确认，不生成 undo；
7. 逐事项以当前状态、日期、`shiftCount` 和版本执行 CAS；任一事项冲突时整批回滚，不允许部分顺延；
8. 成功写入使用严格递增的 mutation version，并在同一事务内替换该计划原有 shift undo 快照；
9. 事务提交后才读取并返回最新 dashboard 与服务端 undo token。

跨窗口中，相同状态可以产生相同预览 token。第一个确认成功后，事项日期、`shiftCount` 和版本已经变化，第二个确认必须 stale，不能再次顺延。归档、保存计划、完成或恢复事项、改变休息日、新增符合事项、另一窗口顺延或撤销都必须使旧 token 失效。

重复确认不要求返回第一次相同的成功响应，但必须具备效果幂等性：同一预览最多成功写入一次，重放不得产生第二次顺延。

## 5. 稳定错误与安全 DTO

预览与当前状态不一致时使用稳定码：

```text
CYCLE_PLAN_SHIFT_PREVIEW_STALE
```

规范文案为：

- 提示：`顺延预览已与当前计划不一致。`
- 操作建议：`刷新预览并确认最新排程后重试。`

错误 DTO 不得包含 canonical 原文、内部 fingerprint 输入、工作区内部信息、事项 CAS 版本、undo 快照、SQL 或数据库路径。前端只展示稳定安全文案，并保留用户重新打开预览的明确动作。

## 6. Modal、焦点与撤销

- “顺延后续”触发器打开预览 modal；预览加载期间使用 busy 状态并阻止重复提交；
- modal 标题、说明、warning 和按钮具有可访问名称，超期信息不只依赖颜色；
- `affectedItemCount === 0`、preview 加载失败或 token 缺失时确认按钮不可用；超期 warning 不禁用确认；
- 取消后焦点返回顺延触发器；确认失败时 modal 保持打开并提供刷新预览；
- 确认成功后展示最新 dashboard 和状态播报，并让“撤销顺延”在当前 modal 流程中立即可达；
- 新的事项操作、顺延、保存、归档或刷新继续遵守 latest-only undo 规则。

## 7. 必须覆盖的自动测试

后端至少覆盖：

- preview 零写入且不消费现有 undo；
- canonical 编码对 SQL 返回顺序和休息日输入顺序稳定；
- 预览结果与同状态确认后的日期、数量和超期信息一致；
- 零事项返回 `previewToken: null` 且 confirm 被拒绝；
- plan 归档、休息日变化、计划保存、事项完成/恢复、新增符合项和另一窗口顺延均 stale 且零写入；
- 同毫秒但实际状态或日期变化仍 stale；
- 两窗口相同预览只有首次确认成功，重放不重复写；
- 任一事项 CAS 冲突时计划、所有事项和 undo 全部回滚；
- 超过截止日期的预览仍可确认，并准确返回超过天数；
- DTO 不接受确认请求中的逐事项日期或未知字段，错误 DTO 不泄露内部状态。

前端至少覆盖：

- 点击顺延只调用 preview，不调用 confirm 或旧直写命令；
- modal 展示当前/新预计完成日期、受影响数量、休息日和超期 warning；
- 零事项、空 token 和加载错误不能确认；超期 warning 可以确认；
- confirm invoke 只发送 `planId`、`fromDate`、`studyDays`、`previewToken`；
- stale 后 modal 保持可恢复，并可刷新为新预览；
- 取消、失败、成功和撤销入口的焦点回退正确；
- 确认成功后的 shift undo 在 modal 内可达，并继续遵守 latest-only 规则；
- 源码与命令注册中不存在旧 `shift_cycle_plan` 直写入口。

## 8. 定向验证与交叉审查闭环

定向验证结果：

- 前端顺延预览 client/model 定向测试 `30 passed`，related 测试 `29 passed`；`CyclePlanPanel` 定向测试 `8 passed`；
- 后端定向测试共 `23 passed`：application `5`、SQLite repository `17`、command DTO `1`；
- DTO、canonical 指纹、零事项、跨窗口 stale、事务回滚、R44 undo、modal 状态与焦点路径均包含在上述定向范围内。

最终独立交叉审查发现并关闭两项问题：

- `shiftButtonRef` 已挂到真实的“顺延”按钮，取消预览及撤销到期后的焦点不再误落到“编辑规则”；
- Rust 安全错误 DTO 与 TypeScript `ERROR_COPY` 已对 `CYCLE_PLAN_SHIFT_PREVIEW_STALE` 使用同一文案：`顺延预览已与当前计划不一致。` / `刷新预览并确认最新排程后重试。`。

本轮继续采用无持久表的 canonical SHA 状态指纹。token 是确认写入的并发前置条件，不是鉴权秘密；它没有 `expiresAt`，不新增迁移，也不改变 R44 shift undo 的服务端 token、五秒有效期和 CAS 权威性。

## 9. 完整自动门禁

本批次完整自动门禁已按集成顺序执行一次：

| 门禁                                                 | 结果                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm check`                                         | 通过；46 个 test files、305 个 tests，production build 通过 |
| `cargo fmt --all -- --check`                         | 通过                                                        |
| `cargo test --locked`                                | 通过；273 passed                                            |
| `cargo clippy --locked --all-targets -- -D warnings` | 通过                                                        |
| `pnpm tauri build --no-bundle`                       | 通过；Release 编译耗时 2m35s                                |

无 bundle 构建产物位于 `src-tauri/target/release/kystudy.exe`。本批次未启动该 EXE；自动门禁通过不代表桌面人工验收通过。

## 10. 待执行桌面验收

桌面验收由用户启动 Release 应用后执行：

1. 打开一份存在可顺延未完成事项的周期计划，记录当前排程；点击“顺延”，确认先出现 preview，重新查看数据时正式排程仍未改变；
2. 确认 preview 显示受影响事项数量、当前预计结束日期、顺延后预计结束日期、每周休息日，以及存在超期时的 warning 和超期天数；超期 warning 不应禁用确认；
3. 取消 preview，确认没有写入并且键盘焦点返回真实的“顺延”按钮；
4. 选择一个之后没有未完成事项的起算日，确认显示零事项、没有可用 token 对应的确认能力，且“确认顺延”不可用；
5. 重新打开有效 preview 并确认，确认此时才写入新排程；状态条显示五秒“撤销顺延”，且撤销按钮在当前 modal 内可见、可点击，点击后恢复原排程；
6. 在两个窗口对同一计划生成 preview；在其中一方完成事项、保存计划或确认顺延，再在另一方确认旧 preview，确认显示 `CYCLE_PLAN_SHIFT_PREVIEW_STALE`，不覆盖新状态且不删除当前有效 undo；
7. 在 stale preview 中点击“刷新预览”，核对最新预计日期后重新确认，确认可以成功写入一次且不会重复顺延。

上述桌面验收当前尚未执行，本文不宣称桌面验收通过。

## 11. 后续桌面验收证据

2026-08-11，用户按第 10 节步骤完成 Release 桌面验收并确认通过：顺延先展示 preview 且确认前数据不变；预览正确显示影响数量、当前与新预计结束日期、休息日和可确认的超期 warning；取消后焦点返回顺延按钮；零事项不能确认；确认后才写入，并可在 modal 内使用五秒撤销；跨窗口状态变化使旧 preview stale 且不覆盖新状态；刷新 preview 后可以基于最新排程确认。

本节是完整自动门禁之后追加的用户证据，不改写第 9 节已经记录的门禁结果，也不表示本轮重新运行过构建或自动测试。R46 当前状态为：自动门禁通过，2026-08-11 用户桌面验收通过。
