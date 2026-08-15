# R29 分段回收站、显式恢复与范围浏览验收

本轮补齐 R27 分段软删除之后缺少可发现入口和显式恢复操作的问题，并继续遵守 R28 的跨练习册 exact identity 冲突边界。用户可以在题库中打开独立的“分段回收站”，核对被移除分段的 PDF、科目、练习册、页码、删除时间和可恢复题数，再通过带删除时间前置条件的原位恢复操作安全恢复原分段。同时，题库树按当前快照中的 live 题目决定“浏览本段”或“继续索引”，避免陈旧的持久化计数扩大浏览范围。

本文记录 schema 20 默认数据库只读证据、跨层接口、事务语义、前端竞态保护、定向自动检查和桌面验收。R29 的定向检查和本轮完整自动门禁已于 2026-08-03 完成；Release WebView 桌面人工验收也已由用户在本轮明确确认通过。

## 1. 目标与非目标

R29 的目标是：

- 让 soft-deleted PDF 分段通过独立回收站重新可发现；
- 显式恢复原 segment ID、原 workbook 归属和该次分段删除实际触及的题目；
- 使用 `expectedDeletedAt` 防止陈旧列表覆盖后续状态；
- 在恢复前拒绝 exact identity 已由另一个 active workbook 占用的情况；
- 保留题目区域、作答记录和复习历史，并保持单题独立删除边界；
- 恢复成功后以完整 `QuestionBankSnapshot` 刷新活动题库；
- 在题库树中按 segment 范围浏览或继续索引，显示 live 题数而不是信任可能滞后的持久化计数。

本轮明确不做：

- 不提供永久删除或清空分段回收站；
- 不提供跨练习册 reassign/move，也不静默更改原 workbook；
- 不增加 `force`、`allowDuplicate` 或冲突覆盖入口；
- 不新增 schema migration，继续使用 schema 20 的 `deleted_at` 和 `workbook_segment_question_trash`；
- 不删除 PDF、Blob、题目区域、作答历史或复习历史；
- 不把分段恢复并入通用单题回收站；
- 不在本轮自动修改真实默认数据库。

若用户需要更正练习册归类，仍应明确处理当前 active 冲突后再重新分析；R29 只恢复原分段，不把恢复解释为重新归类。

## 2. 默认数据库只读证据

### 2.1 查询边界

证据来自 2026-08-03 对默认工作区 SQLite 的只读核验。数据库以只读方式打开，仅执行 `PRAGMA`、`SELECT` 和只读元数据查询；未执行迁移、`INSERT`、`UPDATE`、`DELETE`、备份恢复、Tauri 命令或桌面操作。

- schema：`user_version = 20`；
- `PRAGMA integrity_check`：`ok`；
- `workbook_document_segment`：9 行，其中 active 6、trashed 3；
- `workbook_segment_question_trash`：1109 行，关联 3 个 trashed segment；
- exact identity 重复键：3 个，均为 active 880 + trashed 1000 题；
- active exact identity 重复键：0 个。

exact identity 使用：

```text
(document_id, subject_id, page_start, page_end)
```

`workbook_id` 是归属，不属于 identity；`subject_id` 必须参与比较，以允许混合 PDF 中不同科目使用相同页码范围。

### 2.2 三组历史 exact identity

| 科目 | PDF 页码 | active 记录 | trashed 记录 | tombstone 题目 |
| --- | ---: | --- | --- | ---: |
| 高数 | 3～98 | 880 | 1000 题 | 649 |
| 线性代数 | 3～46 | 880 | 1000 题 | 258 |
| 概率论 | 47～82 | 880 | 1000 题 | 202 |
| **合计** |  | **3 active** | **3 trashed** | **1109** |

这 3 个重复键是 schema 20 的合法历史状态，不是 active 重复。它们证明恢复必须再次检查 active 归属：被删除的 1000 题旧段不能遮蔽当前 active 880，也不能因为出现在回收站就直接复活。

## 3. DTO、命令与稳定错误

### 3.1 回收站 DTO

后端新增 `TrashedWorkbookDocumentSegment`。它保留活动分段的原元信息，并增加：

- `deletedAt`：正整数毫秒时间戳，也是恢复的乐观并发 token；
- `restorableQuestionCount`：同时满足当前 segment tombstone、tombstone 时间等于 segment 删除时间、题目当前 `deleted_at` 仍等于该删除时间的题目数量。

`restorableQuestionCount` 不是 segment 历史总题数，也不包含在分段删除之前已经由用户单独放入题目回收站的题目。

前端 parser 严格校验活动分段字段、页码范围、索引状态、非负计数、时间戳和 `restorableQuestionCount`；非法 DTO 不进入 UI 状态。

### 3.2 Tauri API

新增命令：

```text
list_trashed_workbook_segments()
restore_workbook_segment(input)
```

恢复调用的跨层 payload 固定为：

```json
{
  "input": {
    "segmentId": "<uuid>",
    "expectedDeletedAt": 1785730236432
  }
}
```

`list_trashed_workbook_segments` 返回稳定排序的 DTO 数组。排序顺序为科目 `sort_order`、科目名称、练习册名称、起止页码和 segment ID，不能依赖 SQLite 未指定顺序。

`restore_workbook_segment` 返回恢复后的完整 active `QuestionBankSnapshot`。命令层不返回数据库路径、SQL、Blob 位置或内部冲突结构。

### 3.3 稳定错误码

| 场景 | 稳定错误码 | 前端动作 |
| --- | --- | --- |
| segment 不存在 | `QUESTION_BANK_SEGMENT_NOT_FOUND` | 刷新回收站 |
| segment 已经 active | `QUESTION_BANK_SEGMENT_NOT_TRASHED` | 刷新并确认当前状态 |
| `expectedDeletedAt` 已过期 | `QUESTION_BANK_SEGMENT_RESTORE_STALE` | 自动刷新回收站后重试 |
| PDF 已不可用 | `QUESTION_BANK_DOCUMENT_NOT_FOUND` | 保留回收记录，先处理资料状态 |
| 科目已归档/不可用 | `QUESTION_BANK_SUBJECT_NOT_FOUND` | 保留回收记录，先处理科目状态 |
| 练习册已归档/不可用 | `WORKBOOK_CATEGORY_NOT_FOUND` | 保留回收记录，先处理练习册状态 |
| exact identity 已属于另一 active workbook | `QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT` | 禁止恢复，保留已有活动归类 |

Rust application code、Tauri command 映射和 TypeScript `ERROR_COPY` 使用同一组 stable code。前端以 code 规范化文案；原始错误细节不直接显示。

## 4. 显式恢复事务语义

恢复在一个 SQLite `Immediate` 事务中完成。以下检查全部发生在第一次写入之前：

1. 按 segment ID 读取记录；不存在时返回 `SEGMENT_NOT_FOUND`；
2. 确认 segment 仍为 trashed；已经 active 时返回 `SEGMENT_NOT_TRASHED`；
3. 比较当前 `deleted_at` 与 `expectedDeletedAt`；不一致时返回 `SEGMENT_RESTORE_STALE`；
4. 确认原 PDF 仍存在、为 PDF 且未被删除，并确认页码仍合法；
5. 确认原 subject 和 workbook 仍可用；
6. 按 `(document_id, subject_id, page_start, page_end)` 查询 active segment；若另一个 workbook 已占用 exact identity，复用 `QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT`；
7. 只有全部检查通过后才恢复题目、segment 和派生状态。

写入阶段遵循：

1. 只把该 segment tombstone 中、tombstone 时间等于本次 `expectedDeletedAt`、且 `question.deleted_at` 仍等于该时间的题目恢复为 active；
2. 删除该 segment 已消费的 tombstone；
3. 将原 segment 的 `deleted_at` 清空，保留 segment ID、document、subject 和 workbook；
4. 按恢复后的 active 题目重新计算 `question_count`；
5. active 题数为 0 时设为 `pending`，存在低于 0.75 的索引置信度时设为 `needs_review`，否则设为 `ready`；
6. 提交后返回完整 active snapshot。

任一校验或写入失败都会回滚整个事务。冲突、陈旧 token、不可用关系和重复恢复不会产生题目已恢复但 segment 仍删除的中间状态。

## 5. UI 回收站与竞态防护

### 5.1 分段回收站

题库页提供独立的“分段回收站”按钮，并在列表加载后显示数量。对话框展示：

- 分段标题和 PDF 标题；
- 科目、练习册和页码；
- `restorableQuestionCount`；
- 格式化后的删除时间；
- 空列表、加载状态、刷新入口和 `role="alert"` 错误提示。

说明文字必须明确：题目区域、作答记录和复习历史随可恢复题目保留；分段回收站不包含单独移除的题目。

### 5.2 恢复前冲突与后端权威校验

前端基于当前 active snapshot 做 exact identity 预检。发现另一 active workbook 时禁用恢复按钮，展示现有科目、练习册和 live 题数；不同 `subject_id` 的相同页码不是冲突。

前端预检只用于即时提示，不能代替后端事务校验。点击恢复时仍提交 `expectedDeletedAt`；后端是最终权威。若后端返回 stale，前端自动刷新回收站。恢复成功后先应用后端 snapshot、从本地列表移除该项，再异步重新拉取回收站；若刷新失败，提示“恢复操作已完成”，不得把成功恢复误报为失败。

### 5.3 busy、关闭和焦点

- 恢复期间设置单一 `busyId`，禁用全部恢复按钮和刷新按钮；
- `EditorDialog.closeDisabled` 在恢复期间为 true，关闭按钮、Esc 和遮罩关闭路径均不得卸载对话框；
- 组件卸载和列表刷新使用 request ID / mounted guard，陈旧响应不能覆盖较新的回收站状态；
- 操作结束后焦点优先返回原恢复按钮；按钮不存在时回退到其它恢复按钮或对话框标题；
- 从回收站入口关闭时，焦点返回入口按钮或题库标题。

## 6. 范围浏览、继续索引与 live 计数

题库树的分段题数从当前 `snapshot.questions` 按 `segmentId` 实时计算，不直接使用可能滞后的 `segment.questionCount`。

分段操作决策如下：

| 当前状态 | live 题目 | 操作 |
| --- | ---: | --- |
| `pending` | 任意 | “继续索引” |
| `ready` / `needs_review` | 0 | “继续索引” |
| `ready` / `needs_review` | 大于 0 | “浏览本段” |

“浏览本段”和“继续索引”都把当前 `segment.id` 作为 `initialSegmentId` 传入对应对话框。浏览器只打开该分段的题目范围；继续索引默认选中该分段，避免用户再次在整本题库中定位。

恢复后若有可恢复题目，重算后的状态和 live 题目共同决定是否可浏览；没有可恢复题目的 segment 保持 `pending` 并进入“继续索引”。

## 7. 单题回收站边界

- 分段删除只为当时仍 active 的关联题目写入 `workbook_segment_question_trash`；
- 在分段删除之前已单独 trash 的题目不进入本次 segment tombstone；
- 显式恢复只复活 tombstone 时间与 segment 删除时间一致、题目删除时间也仍一致的题目；
- 先前独立删除的题目不会因恢复分段或重新索引而复活；
- 通用 `list_trashed_questions` 继续排除 segment tombstone 题目；
- 通用 `restore_question` 不允许在父 segment 仍 trashed 时单题恢复；
- 分段回收站和单题回收站各自拥有清晰、互不推断的恢复入口。

## 8. 自动检查记录

### 8.1 已执行的定向检查

| 层级 | 命令/范围 | 结果 |
| --- | --- | ---: |
| SQLite question-bank repository | `cargo test --locked infrastructure::sqlite_question_bank::tests --lib` | 20 passed |
| Rust command mapping | `cargo test --locked commands::tests --lib` | 22 passed |
| Rust application validation | `cargo test --locked application::question_bank::tests --lib` | 6 passed |
| TypeScript focused | `questionBankClient.test.ts` 13 项 + `questionBankModel.test.ts` 22 项 | 35 passed |
| Rust 格式 | `cargo fmt --all -- --check` | 通过 |
| Rust 编译检查 | `cargo check --locked --lib` | 通过 |
| Rust lint | `cargo clippy --locked --lib --tests -- -D warnings` | 通过 |
| TypeScript 类型 | `tsc --noEmit` | 通过 |
| Frontend lint | R29 相关文件 ESLint | 通过 |
| Frontend format | R29 相关文件 Prettier check | 通过 |

定向矩阵覆盖：回收站列表隐藏 active segment、稳定排序、正确计算可恢复题数、原 ID 恢复、regions/attempt/history 保留、独立单题不复活、低置信度状态重算、跨练习册冲突零写入、陈旧时间戳零写入、关系不可用零写入、重复恢复、严格 DTO parser、invoke payload、错误码和 live count/scoped browsing helper。

### 8.2 交叉审查

Rust domain/application/repository/commands/lib 与 TypeScript client/parser/invoke/error 已进行跨层只读交叉审查：

- `deleted_at` ↔ `deletedAt`、`restorable_question_count` ↔ `restorableQuestionCount` 一致；
- restore payload 统一为 `{ input: { segmentId, expectedDeletedAt } }`；
- `SEGMENT_NOT_TRASHED`、`SEGMENT_RESTORE_STALE` 和 assignment conflict 的 stable code 一致；
- DTO parser、命令注册、错误安全边界、列表排序和计数语义一致；
- 所有恢复校验均确认位于首次写入之前；
- `question_count/index_state` 重算与 UI live count、范围浏览行为一致。

交叉审查未发现 P0、P1 或 P2 阻塞问题。发现的非阻塞文案来源差异由前端 stable code 规范化覆盖，不影响恢复结果或错误动作。

## 9. 最终自动门禁结果

本轮按固定顺序执行完整自动门禁；每条命令仅执行一次，前四步全部通过后才执行唯一一次 Tauri 构建，未执行清理、重跑或代码修复。

| 门禁 | 真实结果 |
| --- | --- |
| `pnpm check` | 通过，exit 0，53.820 s；Vitest **34 个测试文件、211 个测试**全部通过 |
| `cargo fmt --all -- --check` | 通过，exit 0，1.651 s |
| `cargo test --locked` | 通过，exit 0，79.932 s；Rust `src\lib.rs` **234 passed / 0 failed**，`src\main.rs` 与 doctest 各 0 tests |
| `cargo clippy --locked --all-targets -- -D warnings` | 通过，exit 0，15.064 s |
| `pnpm tauri build --no-bundle` | 通过，exit 0，167.844 s（2 分 47.844 秒，600 秒预算内） |
| Release WebView 桌面人工验收 | **2026-08-03：用户明确确认通过** |

Tauri 构建开始于 `2026-08-03T16:27:53+08:00`。只读 postcheck：exit 0、cargo/pnpm/rustc/tauri/kystudy 残留进程数为 0，canonical EXE/PDB 均非 0 字节，EXE mtime `2026-08-03T16:30:40+08:00` 晚于构建开始时间；未启动 EXE。产物为 `src-tauri/target/release/kystudy.exe`（25,265,664 bytes，SHA-256 `E41BD5D6DA732832995B21A2307E08EB24851221CEFE4F5DFCD40AA889CE0345`）和同目录 `kystudy.pdb`（13,512,704 bytes）。

## 10. 桌面人工验收步骤（用户已通过）

以下步骤已在可恢复备份或隔离工作区完成，并由用户于 2026-08-03 明确确认通过；不直接试写唯一生产数据库。

1. 打开题库页，确认“分段回收站”数量与列表一致，卡片显示 PDF、科目、练习册、页码、删除时间和可恢复题数。
2. 打开一个无冲突 trashed segment，点击恢复；确认提交期间恢复、刷新、关闭、Esc 和遮罩关闭均被禁用，完成后焦点合理恢复。
3. 确认恢复后 segment ID、workbook、题目 ID、regions、作答历史和复习历史未变化，独立单题 trash 仍留在单题回收站。
4. 确认恢复后活动树使用 live 题数；有 live 题目时显示“浏览本段”，无 live 题目或 `pending` 时显示“继续索引”。
5. 点击“浏览本段”，确认只显示该 segment 的题；点击“继续索引”，确认默认定位到该 segment。
6. 构造 active 880 + trashed 1000 的 exact identity，确认 1000 恢复按钮被禁用且说明当前 active 归类；绕过前端直接提交时后端仍返回 assignment conflict，数据库无部分恢复。
7. 保留旧列表后让同一 segment 状态变化，再用旧 `expectedDeletedAt` 恢复；确认出现 stale 提示并刷新列表，不覆盖新状态。
8. 恢复过程中切换窗口、尝试重复点击和关闭；确认无重复请求、无陈旧列表覆盖、无失焦到页面顶部。
9. 单独 trash 一题后再删除并恢复父 segment，确认该题不被错误复活；通用单题回收站与分段回收站互不混淆。
10. 恢复完成后重新打开题库、拼卷和复习范围，确认只有 active segment + active question 可见，PDF/Blob 和历史记录保持完整。

完整自动门禁（含一次成功的 600 秒预算 Tauri 构建）与上述 Release WebView 桌面人工验收均已通过。R29 状态为“自动门禁与用户桌面验收通过”。
