# R28 题库导入归类防误分段验收

本轮针对同一份 PDF 的同一科目、同一页码范围已经正确归入 880，却在重新分析时再次归入 1000 的风险。目标是在不破坏混合 PDF 多科目归类、分段回收站恢复和已有题目历史的前提下，让后端拒绝活动分段的跨练习册重复归类。

本文件记录后端 guard 的目标、事务语义、前端提示边界和验证结果。定向 Rust 检查与 2026-08-03 的完整前端/全量 Rust 自动门禁已完成；历史上唯一一次 Tauri 构建未通过（详见 4.1），该结果保留且未重跑。2026-08-03 本轮用户已明确通过 Release WebView 桌面人工验收，因此桌面人工门禁已通过；自动构建与人工验收状态分别记录。

## 1. 目标与验收边界

本轮必须保证：

- 同一 `(document_id, subject_id, page_start, page_end)` 的活动分段只能属于一个练习册；
- 已经归入 880 的活动分段再次提交到 1000 时，返回稳定的 typed conflict，不产生新分段、题目或部分快照；
- 同一练习册的活动分段重复保存保持幂等；
- 同一练习册的 trashed 分段重新保存继续使用既有 tombstone 恢复语义；
- 只有另一个练习册的 trashed 旧段时，新的目标练习册可以建立分段；
- 混合 PDF 中不同 `subject_id` 的相同页码范围不被误判为冲突；
- 取消、失败和冲突不删除 PDF、Blob、题目区域、作答历史或复习历史。

本轮不提供静默覆盖、`force`/`allowDuplicate` 开关、自动选择另一个练习册或自动删除历史分段。需要更正归类时，用户必须先明确处理已有分段，再重试导入。

## 2. 精确身份与后端决策

### 2.1 分段身份

分段冲突只使用以下四个字段：

```text
(document_id, subject_id, page_start, page_end)
```

`workbook_id` 是归属而不是身份的一部分；`source_heading`、文档标题和题目数量也不参与身份比较。`subject_id` 必须参与比较，以允许同一混合 PDF 中不同科目使用相同页码范围。非完全相同的重叠范围不在本轮自动冲突范围内。

### 2.2 活动与回收站决策表

| exact 身份下的现有记录 | 本次请求练习册 | 后端结果 |
| --- | --- | --- |
| active，且 workbook 相同 | 相同 workbook | 允许幂等保存，更新分段元数据，不新增身份 |
| active，且 workbook 不同 | 任意新 workbook | 硬阻止，返回 `QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT` |
| trashed，且 workbook 相同 | 相同 workbook | 允许恢复原分段，并按既有 tombstone 边界恢复题目 |
| 只有其他 workbook 的 trashed 记录 | 新 workbook | 允许建立新的活动目标，不复活旧 workbook 分段 |
| active 记录属于 880，同时存在 trashed 的 1000 记录 | 请求 1000 | 仍硬阻止；trashed 目标行不能遮蔽 active 880 冲突 |
| active 记录属于 880，同时存在 trashed 的 1000 记录 | 请求 880 | 允许 880 幂等保存，保持现有题目和历史 |
| 同文档、同页码但 `subject_id` 不同 | 任意合法 workbook | 允许，不产生混合 PDF 跨科目误报 |

### 2.3 事务与错误

`save_workbook_segments` 在现有 SQLite `Immediate` 事务中执行：

1. 先验证本批所有文档、科目、练习册和页码链接；
2. 在任何恢复或插入前，扫描整批 exact 身份的 active 记录；
3. 发现任一不同 workbook 后，返回整批 typed conflict，事务回滚且不产生部分写入；
4. 无 active 冲突时，继续现有幂等、恢复、插入和 contained-segment 处理。

应用层错误类型为 `SegmentAssignmentConflict`，稳定错误码为 `QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT`。冲突载荷包含文档、科目、页码范围、请求 workbook、现有 segment ID 和现有 workbook ID；命令层只返回稳定的非敏感错误信息，不暴露路径、SQL 或 Blob 位置。

本轮不新增 schema migration。现有 schema 20 的历史数据库可能同时存在 active 880 与 trashed 1000 的旧记录，因此 guard 必须在应用事务中兼容这些记录，不能通过迁移自动猜测保留哪一个练习册。

## 3. UI 默认、冲突提示与剩余重试

- 自动分析仍使用当前检测到的科目和用户选择的练习册默认值；发生冲突时不得静默改选另一个练习册。
- 冲突提示应明确保留已有归类，并提供可执行动作：`请保留已有归类；如需更正，请先移除错误分段，再重新分析并重试。`
- 一次保存若包含多个科目，后端冲突拒绝本次分段写入；此前已经完成并发布的科目快照继续保留。
- `completedSubjectKeys` 之外的科目仍可在解决冲突后重试；同 workbook 的已完成分段幂等保存，不得重复建立 segment、题目或作答历史。
- 重试提示继续采用“已完成 n/m，失败科目可重试”的语义；冲突解决前不得把失败科目标记为已完成。
- 混合 PDF 的不同科目即使页码相同，也不得显示为跨练习册冲突；冲突信息必须指向 exact identity 和已有 workbook。

## 4. 自动测试矩阵

| 层级 | 最小断言 | 当前记录 |
| --- | --- | --- |
| Rust application | 批内唯一键包含 `subject_id`；同文档同页码的不同科目可以进入同一批次 | 定向测试通过 |
| SQLite repository | active 880 → 1000 返回 typed conflict；同 workbook active 幂等；同 workbook trashed 恢复 | 定向测试通过 |
| SQLite repository | 不同 subject 同范围允许；批次包含冲突时整批回滚；仅 trashed mismatch 允许新目标 | 定向测试通过 |
| Command mapping | 冲突错误映射为稳定 code 和可行动文案 | 定向测试通过 |
| 定向 Rust 测试 | `cargo test --locked infrastructure::sqlite_question_bank::tests` | 14 passed |
| 定向 Rust 测试 | `cargo test --locked application::question_bank::tests` | 6 passed |
| 定向 Rust 测试 | `cargo test --locked commands::tests` | 20 passed |
| Rust 静态检查 | `cargo fmt --check`、`cargo check --locked`、`cargo clippy --locked --lib --tests -- -D warnings` | 通过 |
| 完整前端/全量 Rust/Tauri | `pnpm check`、全量 `cargo test`、`pnpm tauri build --no-bundle` | 2026-08-03：前端与全量 Rust 通过；Tauri 构建未通过 |
| 桌面人工验收 | Release WebView、混合 PDF、冲突对话框和剩余重试 | 2026-08-03：用户明确确认通过 |

### 4.1 2026-08-03 最终自动门禁实绩

- `pnpm check`：通过；34 个测试文件、199 个测试通过，Vite build 通过。
- `cargo fmt --all -- --check`：通过。
- `cargo test --locked`：通过；227 个测试通过、0 个失败。
- `cargo clippy --locked --all-targets -- -D warnings`：通过。
- `pnpm tauri build --no-bundle`：本轮唯一一次执行在约 124 秒后被工具超时终止，退出码 `124`；诊断时已无残留构建进程，`target/release/kystudy.exe` 为 0 字节，因此不计为通过，也未重跑。

上述定向命令只验证本轮后端 guard 及其命令映射，不替代完整前端门禁、全量构建或桌面验收。

## 5. 手工验收步骤（用户已通过）

以下步骤已在隔离工作区或可恢复备份上完成，并由用户于 2026-08-03 明确确认通过；该验收不代表直接改写现场用户数据库。

1. 打开包含正确 880 活动段和错误 1000 trashed 段的 schema 20 工作区，确认 PDF、题目区域和历史仍可读取。
2. 对同一 `document_id + subject_id + page_start + page_end` 尝试选择 1000；确认出现稳定冲突提示，880 仍是唯一活动归属，1000 不会被恢复或新建。
3. 重新提交相同 880 分段；确认 segment ID、题目 ID、regions、作答和复习历史不重复，保存表现为幂等。
4. 在测试分段上执行“移除分段”后以相同 workbook 重新分析；确认同 workbook 恢复 tombstone 题目，并且此前单题独立删除的题目不被错误复活。
5. 构造只有其他 workbook trashed 记录的 exact 范围；确认新 workbook 可以建立活动目标，旧 trashed 记录仍留在回收站且不复活。
6. 对混合 PDF 构造两个不同 `subject_id` 的相同页码范围；确认两科目均可保存，不出现跨科目误阻止。
7. 提交“一个合法新段 + 一个 active 冲突段”的批次；确认合法新段也不落库，修正冲突后重试，剩余进度和 `n/m` 提示正确。
8. 在冲突对话框中测试取消、重复点击、刷新和陈旧快照；确认不产生部分写入、重复题目或错误的练习册切换。

## 6. 安全边界与完成条件

- 冲突 preflight 与实际写入必须在同一个 `Immediate` 事务内重复保证，不能只依赖前端预检查。
- 回收站记录是兼容旧数据的事实，不等于可静默覆盖；只有用户明确选择恢复或更正时才改变归属。
- PDF/Blob、题目区域、作答和复习历史不因归类冲突被删除；错误路径只回滚本次分段保存。
- 截至 2026-08-03，前端与全量 Rust 自动门禁已通过；Tauri 构建历史上唯一一次在约 124 秒后超时且未重跑，仍按自动门禁失败记录。桌面人工验收已由用户明确通过；R28 的自动构建门禁与桌面人工门禁不互相覆盖。
