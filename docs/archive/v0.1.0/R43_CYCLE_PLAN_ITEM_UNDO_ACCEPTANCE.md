# R43 周期计划事项撤销验收

R43 为周期计划事项状态变更增加 latest-only 五秒撤销。计划页和“今日”页
在事项完成或重新打开后均提供撤销。本记录包含行为契约、定向验证、交叉审查
结果以及集成和 Release WebView 桌面验收状态。

状态：`accepted`（2026-08-10 用户在 Release WebView 中确认桌面验收通过）；定向检查和完整自动门禁已通过。

## 1. 行为契约

- 完成或重新打开事项后创建一个五秒撤销动作。新的事项变更会替换旧动作，始终
  只保留 latest-only 撤销。
- `CyclePlanPanel` 和 `TodayOverviewPanel` 均支持撤销，并恢复变更前的完整事项
  状态。
- 撤销在五秒边界到达时过期。计时器带有动作身份校验，旧计时器不能移除新的撤销
  动作。
- 其他操作、刷新、导航操作或新的事项变更都会使待撤销动作失效。
- 撤销控件过期时若仍拥有焦点，且最后一次事项触发器仍连接到文档，焦点会返回
  该触发器。

## 2. 持久化与 DTO 契约

- `set_cycle_plan_item_state` 返回包含 `dashboard`、`itemId` 和本次写入产生的权威
  `itemUpdatedAt` 的包装结果。撤销模型使用这个 token，而不信任提交后读取的
  dashboard 中同一事项行。提交后读取的 dashboard 可能已经包含更晚的同事项变更，
  但不会改变本次 mutation token 的权威性。
- 事项版本通过 checked `expectedUpdatedAt + 1` 与当前 UTC 毫秒值生成，确保每次
  状态变更得到严格更新且不会整数溢出。
- SQLite 状态写入对 `id` 和 `updated_at` 使用 compare-and-swap。事项已被改变时
  返回 `CYCLE_PLAN_ITEM_STATE_STALE`，不会被过期撤销覆盖；事项不存在时仍返回
  可区分的 not-found 错误。
- 只有原状态为 completed 时，恢复请求才携带 `completedAt`。后端校验状态与时间戳
  的配对关系，并精确写回原完成时间，包括恢复到此前的 completed 状态。
- Rust DTO 使用 camelCase 字段（`itemUpdatedAt`、`expectedUpdatedAt`、
  `completedAt`），与 TypeScript 客户端和解析器一致。

## 3. 定向验证与完整门禁

- TypeScript 直接测试：13 项通过。
- TypeScript 关联测试：19 项通过。
- UI 关联测试：6 项通过。
- Rust `cycle_plan` 测试：10 项通过。
- 最终只读交叉审查：未发现可行动问题。

批次集成后的完整门禁已按 `docs/DEVELOPMENT_WORKFLOW.md` 要求顺序通过：

```text
pnpm check
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
pnpm tauri build --no-bundle
```

结果：

- `pnpm check` 通过：检查 43 个文件，277 项测试通过；Prettier、ESLint、TypeScript
  和 Vite 生产构建均通过。
- `cargo fmt --all -- --check` 通过。
- `cargo test --locked` 通过：254 项 Rust 测试。
- `cargo clippy --locked --all-targets -- -D warnings` 通过。
- `pnpm tauri build --no-bundle` 通过。产物：
  `F:/develop/KyStudy/src-tauri/target/release/kystudy.exe`。
- 自动门禁执行期间未启动 Release EXE；当时桌面验收尚待用户验证，后续用户结果见第 6 节。

## 4. 明确延后

shift 行为、skip 行为和日历可见性行为均从 R43 延后。这些内容不属于本次撤销
mutation 契约，也不属于本验收记录。

## 5. Release WebView 桌面验收点

集成批次可用后，请用户在桌面应用中验证以下流程：

1. 在计划页完成事项并撤销；再将已完成事项重新打开并撤销。
2. 在“今日”页重复上述两个方向。
3. 确认五秒后撤销动作消失，之后不能再执行撤销。
4. 在另一窗口先变更同一事项再点击撤销，确认 stale 撤销被拒绝且不会覆盖较新的
   状态。
5. 撤销控件过期时保持焦点，确认焦点返回事项触发器；再重复键盘操作流程。
6. 在 `320px` 宽度检查计划页和“今日”页，确认文字可读、控件不重叠且没有水平
   溢出。

## 6. Release WebView 用户桌面验收结果（2026-08-10）

用户于 2026-08-10 在 Release WebView 中完成第 5 节列出的全部场景，并确认通过：

| 验收场景                                                           | Release WebView 结果 |
| ------------------------------------------------------------------ | -------------------- |
| 计划页完成事项后撤销；再将已完成事项重新打开并撤销                 | 通过                 |
| “今日”页重复完成和重新打开两种撤销流程                             | 通过                 |
| 等待五秒后撤销动作消失，之后不能再执行撤销                         | 通过                 |
| 另一窗口先变更同一事项后点击撤销，stale 撤销被拒绝且不覆盖较新状态 | 通过                 |
| 撤销控件过期时焦点返回事项触发器，并重复键盘操作流程               | 通过                 |
| `320px` 宽度下计划页和“今日”页文字可读、控件不重叠且无水平溢出     | 通过                 |

该结果补充独立的 Release WebView 人工验收证据；第 3 节既有定向验证、交叉审查和完整自动门禁记录保持原样。
