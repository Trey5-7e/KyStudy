# R30 分段重新归类与窗口化题库界面验收

R30 处理两个互相约束的问题：题库分段需要支持用户明确发起的 active-only 练习册重新归类；题库首页同时需要收敛入口，避免每个分段暴露重复操作。本文件记录用户界面原则、R30 交付后的入口结构、跨层数据契约、schema 20 兼容性、默认数据库只读证据、定向验证、交叉复审、自动门禁和用户桌面验收。

本轮只记录已经完成的定向实现与审计结果，不新增 schema migration，也不在文档整理批次执行测试、构建或桌面操作。后续若执行 Tauri 构建，只允许一次、预算 600 秒；自动门禁结果保留在第 9 节，用户已明确确认 R30 桌面验收通过。

## 1. 用户界面原则与收敛目标

### 1.1 审计基线

交付前的题库首页有 9 个固定按钮；每个页面上可见的分段有两个直接操作入口，若有 `N` 个分段则会形成 `2N` 个分段操作。入口重复使用户难以判断“浏览、继续索引、纠正归类和移除”之间的关系，也容易在弹窗之间形成嵌套。

### 1.2 R30 交付后的原则

- 题库首页固定入口收敛为 3 个：`导入 PDF`、`题库工具`、`分段回收站`。
- 题库摘要使用单行 stats，主页不再为同一能力重复摆放快捷按钮。
- 科目、练习册和分段树保持浏览优先；分段明细默认折叠。
- 每个分段行只保留一个 `管理` 入口。浏览、继续索引、更正归类和移除均从分段管理窗口进入。
- `QuestionBankToolsDialog` 负责创建分类、索引、做题和维护工具；选择工具后先关闭工具窗口，再打开目标窗口。
- `SegmentManagerDialog` 使用一个 `EditorDialog` shell，在概览、重新归类和移除确认之间切换；不在其内部再打开第二个 modal。
- busy 操作禁用重复提交、Esc、关闭按钮和遮罩关闭；操作结束后焦点回到原入口或可用的页面标题。
- UI 预检只负责即时解释，后端事务和 CAS 始终是最终权威；任何陈旧快照都不能静默覆盖新的归类。

### 1.3 交付结构核对

| 位置 | R30 交付后的结构 |
| --- | --- |
| 题库首页 header | 3 个固定入口：导入、工具、分段回收站 |
| 题库摘要 | 单行 stats |
| 题库树 | 分段明细默认折叠 |
| 分段行 | 每段 1 个管理按钮，共 `N` 个分段即 `N` 个管理入口 |
| 工具选择 | `QuestionBankToolsDialog` 单 shell |
| 分段操作 | `SegmentManagerDialog` 单 shell，内部模式切换，不嵌套 modal |

## 2. 分段重新归类边界

### 2.1 active-only 语义

R30 的重新归类只接受当前 active 的 `workbook_document_segment`。用户可以把 active 分段移动到另一个仍可用的 active workbook，但不会自动恢复、改写或迁移回收站记录。原 segment ID、题目 ID、PDF 区域、作答记录和复习历史均保持不变。

同一 workbook 的目标是幂等 no-op；UI 将当前目标标记为“当前”并禁用保存。不同 subject 即使使用同一 PDF 页码范围，也不属于本轮冲突。

### 2.2 exact identity 与目标冲突

重新归类使用以下 exact identity：

```text
(document_id, subject_id, page_start, page_end)
```

`workbook_id` 是待改变的归属，不属于 identity；`source_heading`、PDF 标题和题目数量也不参与 identity。

| 目标状态 | 前端表现 | 后端结果 |
| --- | --- | --- |
| 当前 source workbook | 标记“当前”，保存禁用 | 幂等 no-op |
| 目标 workbook 无 exact active/trashed 冲突 | 可选、可保存 | 允许 active reassign |
| 目标 workbook 已有 exact active sibling | 标记不可用并说明已有归类 | 返回 `QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT`，零写入 |
| 目标 workbook 已有 exact trashed segment | 标记不可用并说明回收站记录 | 返回 assignment conflict，旧 tombstone 不迁移 |
| source segment 已不在 active snapshot | 不能保存 | 返回 not-found/not-active 或 stale，不能覆盖新状态 |
| 目标 workbook 不存在、已归档或不属于当前 workspace | 不能保存 | 返回 `WORKBOOK_CATEGORY_NOT_FOUND`，零写入 |

active sibling 和 trashed target 的判断只用于解释和禁用选项，后端仍必须在事务内重复检查。回收站中的旧 segment 不会因为用户选择新 workbook 而被静默恢复、删除或改 workbook。

## 3. 跨层 DTO、CAS 与稳定错误

### 3.1 Tauri 命令和 payload

前端调用 `reassign_workbook_segment`，固定传入：

```json
{
  "input": {
    "segmentId": "<uuid>",
    "targetWorkbookId": "<uuid>",
    "expectedUpdatedAt": 1785730236432,
    "expectedDeletedAt": null
  }
}
```

`expectedUpdatedAt` 是 active 分段的乐观并发 token；`expectedDeletedAt: null` 明确声明本次只允许 active segment。命令成功返回完整 `QuestionBankSnapshot`，TypeScript 通过严格 parser 更新页面，而不是拼接局部行状态。

### 3.2 stable code

Rust application、Tauri command 和 TypeScript client 使用同一组稳定错误码：

| 场景 | 稳定错误码 | UI 动作 |
| --- | --- | --- |
| segment 不存在 | `QUESTION_BANK_SEGMENT_NOT_FOUND` | 刷新题库后重新打开管理 |
| segment 已移入回收站 | `QUESTION_BANK_SEGMENT_NOT_ACTIVE` | 刷新题库，不能迁移 trashed segment |
| `updated_at` 或删除前置条件陈旧 | `QUESTION_BANK_SEGMENT_REASSIGN_STALE` | 提示刷新题库、重新打开管理并重新确认目标 |
| exact active/trashed 目标冲突 | `QUESTION_BANK_SEGMENT_ASSIGNMENT_CONFLICT` | 保留已有归类，处理冲突后重试 |
| workbook 不存在或不可用 | `WORKBOOK_CATEGORY_NOT_FOUND` | 刷新练习册列表或选择仍可用的目标 |
| DTO、关系或页码无效 | `QUESTION_BANK_INPUT_INVALID` | 不写入，按错误动作修正输入 |

原始错误不向 UI 暴露路径、SQL、Blob 位置或内部堆栈；前端按 stable code 规范化可行动文案。

## 4. Immediate 事务、CAS 与元数据同步

R30 不依赖前端预检保证一致性。repository 在 SQLite `Immediate` 事务中执行：

1. 校验 workspace、segment、source workbook、target workbook、PDF 关系和 active 状态；
2. 比较 `expectedUpdatedAt` 与当前 `updated_at`，并确认 `expectedDeletedAt` 仍为 `NULL`；
3. 扫描 exact identity 下的 active sibling 和目标 trashed row；发现任一冲突时在第一次写入前返回 stable conflict；
4. 以 CAS 条件更新 `workbook_document_segment.workbook_id`、`updated_at` 和相关分段元数据；
5. 在同一事务中同步该 segment 所有关联 `question_index_metadata.workbook_id` 行，保证 segment 与所有题目索引元数据一致；
6. 提交后返回完整 snapshot；任一写入、约束或关系错误都回滚整笔事务。

重新归类不会改变：

- segment ID、question ID、document/blob ID；
- question regions 及其 OCR/坐标数据；
- `question_attempt`、review state、复习历史和作答次数；
- 回收站 tombstone、独立题目回收站状态和历史时间戳。

本轮没有新增 migration，继续兼容 schema 20 的 active 与 trashed 历史行。任何 trashed segment 都只能由显式回收站恢复流程处理，不能借由 reassign 搬迁。

## 5. 默认数据库只读证据

### 5.1 查询边界

证据来自 2026-08-03 对默认工作区 SQLite 的只读核验：

```text
%APPDATA%\io.github.kystudy.desktop\workspaces\default\kystudy.sqlite3
```

仅执行 `PRAGMA`、`SELECT` 和只读元数据查询；未执行迁移、Tauri 命令、INSERT、UPDATE、DELETE、备份恢复或桌面操作。

- `PRAGMA user_version`：20；
- `PRAGMA integrity_check`：`ok`；
- `workbook_document_segment`：9 行，其中 active 6、trashed 3；
- 3 组 exact identity 为 active 880 + trashed 1000 的历史组合；active exact duplicate 为 0；
- `workbook_segment_question_trash`：1109 行，均属于 3 个 trashed segment；
- 受影响题目没有 attempts、review state、regions 丢失证据，题目区域和历史仍可按原 ID 追溯。

### 5.2 历史 exact identity

| 科目 | PDF 页码 | active | trashed | segment tombstone 题目 |
| --- | ---: | --- | --- | ---: |
| 高数 | 3～98 | 880 | 1000 题 | 649 |
| 线性代数 | 3～46 | 880 | 1000 题 | 258 |
| 概率论 | 47～82 | 880 | 1000 题 | 202 |
| **合计** |  | **3** | **3** | **1109** |

这组事实要求 reassign 保持 active-only：旧 1000 trashed row 不能遮蔽 active 880，也不能被当作目标自动迁移；用户必须通过明确的恢复或分段管理流程处理它。

## 6. 定向验证记录

以下是 R30 实现阶段已完成的定向结果；本次文档整理不重跑这些命令。

| 层级 | 定向范围 | 结果 |
| --- | --- | ---: |
| Rust SQLite question-bank infrastructure | reassign transaction、CAS、active/trashed conflict、metadata rollback | **29 passed** |
| Rust command mapping | DTO、camelCase payload、stable error code、命令注册 | **24 passed** |
| Rust application | active-only、输入与 stale precondition | **6 passed** |
| TypeScript question-bank client/model | invoke payload、snapshot parser、error copy、reassign options/conflicts | **42 passed** |
| Rust static checks | `cargo fmt --all -- --check`、`cargo check --locked --lib`、`cargo clippy --locked --lib --tests -- -D warnings` | 通过 |
| Frontend static checks | `pnpm typecheck`、R30 相关 ESLint、Prettier check | 通过 |

覆盖重点包括：同目标幂等、跨 workbook active sibling、目标 trashed、不同 subject 相同页码、stale CAS 零写入、segment 与所有 metadata 同步、ID/history/regions 保留，以及错误 code 到 UI 文案的规范化。

## 7. 交叉复审与修复收口

Rust domain/application/repository/commands/lib 与 TypeScript client/parser/model/UI 已完成只读跨层复审，并对以下契约完成收口：

- Rust DTO 字段与 TypeScript invoke payload 对齐，`expectedUpdatedAt`、`expectedDeletedAt: null` 和 `QUESTION_BANK_SEGMENT_REASSIGN_STALE` 对齐；
- 前端 exact identity 与后端 active/trashed conflict 判定对齐，`subject_id` 不会被页码相同的混合 PDF 误判；
- success 使用后端完整 snapshot，delete/restore 使用 mounted、request ID 和 focus restoration 保护；
- 首页入口、单行 stats、默认折叠、单分段管理入口、工具单 shell 和分段管理单 shell 已按 UI 原则收敛；
- reassign 预检、保存按钮 disabled、same-target 文案、active sibling/trashed target 解释与后端最终校验形成闭环。

交叉复审未发现 P0 或 P1 数据一致性阻塞。仍记录以下不影响后端数据安全的低优先级 UI 后续项，供后续窗口继续收口：

- reassign stale 返回时当前 UI 主要显示刷新/重开动作，未自动拉取新 snapshot；
- disabled target option 的详细冲突说明在正常选择路径中不一定展开；
- overview/reassign/remove 模式切换与首次加载和手动 refresh 的焦点/请求序列仍可进一步收紧；
- rAF 过渡窗口理论上可被极快的第二个入口事件打断，后续可增加显式 modal transition guard。

这些项不会改变 active-only、CAS、冲突零写入、ID/history 保留或 schema 20 数据结论。

## 8. 桌面人工验收步骤与用户结论（已通过）

应在隔离工作区或可恢复备份上执行，不直接试写唯一生产数据库。

下列步骤是本轮桌面验收基线。用户已明确确认 R30 验收通过；本次文档整理不重新启动 EXE，也不把这项用户确认写成新的自动测试结果。

1. 打开题库首页，确认只显示 `导入 PDF`、`题库工具`、`分段回收站` 3 个固定入口；摘要为单行 stats，分段明细默认折叠。
2. 展开多个科目和练习册，确认每个分段行只有一个 `管理` 按钮，未出现旧的浏览/继续索引/移除并列入口。
3. 打开 `题库工具`，确认分类、索引、做题和刷新工具在一个工具窗口中；选择工具后旧窗口关闭，不出现嵌套 modal。
4. 打开 `管理 PDF 分段`，验证概览、浏览/继续索引、更正归类和移除确认均在同一个 `SegmentManagerDialog` shell 内；测试 Esc、遮罩、关闭按钮和 busy 状态。
5. 对无冲突 active segment 选择另一个 active workbook，确认保存后 segment ID、question ID、regions、attempt/review history 不变，树、浏览器和拼卷范围立即使用后端 snapshot。
6. 对同一 workbook 选择“当前”，确认保存 disabled 且不会产生重复请求；对不同 subject 的相同页码确认不误报冲突。
7. 构造 active sibling 与目标 trashed exact identity，确认目标选项不可用、已有归类说明可理解；绕过 UI 直接提交时，后端仍返回 assignment conflict 且数据库无部分写入。
8. 保留旧管理窗口后改变 `updated_at`，再用旧 token 保存；确认出现 `QUESTION_BANK_SEGMENT_REASSIGN_STALE`，不覆盖新归类，并按提示刷新题库后重新打开管理。
9. 对 trashed source 尝试 reassign，确认被拒绝；对已有目标 trashed row 确认不会静默迁移或复活回收站记录。
10. 在保存、冲突、陈旧和删除路径中重复点击、切换窗口并关闭，确认无重复请求、无嵌套 modal、无失焦到页面顶部；操作完成后焦点回到原管理入口或题库标题。

## 9. 完整门禁与构建状态（R30 最终自动门禁已完成）

2026-08-09（Asia/Shanghai）执行了唯一一次 R30 最终自动门禁。执行前只读 `cargo metadata --locked --no-deps` 成功；随后按顺序执行以下命令，每条仅执行一次。未运行桌面应用。

| 门禁 | 状态与真实结果 |
| --- | --- |
| `pnpm check` | **通过（exit 0）**；34 个测试文件、218 个测试通过，Prettier/ESLint/typecheck/Vite build 均通过（命令耗时约 56.9 s） |
| `cargo fmt --all -- --check`（全量门禁） | **通过（exit 0）** |
| `cargo test --locked` | **通过（exit 0）**；245 passed、0 failed（测试运行 10.10 s，命令耗时约 89.7 s） |
| `cargo clippy --locked --all-targets -- -D warnings` | **通过（exit 0）**；无 warning（检查约 7.15 s） |
| `pnpm tauri build --no-bundle` | **通过（exit 0，唯一一次）**；build 起始 `2026-08-09T00:54:45.005Z`，命令耗时约 159.3 s；release 产物见下表 |
| Release WebView 桌面人工验收 | **通过（用户明确确认）**；本轮不启动 EXE |

Release 产物与只读 postcheck：

| 产物 | size | UTC mtime | SHA256 |
| --- | ---: | --- | --- |
| `src-tauri/target/release/kystudy.exe` | 25,265,664 bytes | 2026-08-09T00:57:20.526Z（晚于 build 起始） | `622B909E58E4B02EBCCAF051C9C12E537847E923DB316B0E2262F3A985406BF5` |
| `src-tauri/target/release/kystudy.pdb` | 13,537,280 bytes | 2026-08-09T00:57:20.540Z | `2F84EBC5127D80FA9F2F6327876CCFEADC6D691B4C355B76F659F215CD277DA4` |

EXE/PDB 均为非零文件；postcheck 未发现残留构建或 `kystudy` 进程。EXE size 与门禁前相同但 SHA256 已更新（旧值 `E41BD5D6DA732832995B21A2307E08EB24851221CEFE4F5DFCD40AA889CE0345`）。本仓库 Rust 源文件计数为 59，Rust `#[test]` 属性计数为 245。文档更新后已执行严格 UTF-8 静态检查。

R30 自动门禁状态为“通过”；Release WebView 桌面人工验收及用户验收状态均为“通过”。自动门禁的命令、次数、耗时和产物记录保持不变；用户确认不等同于本轮文档整理重新执行门禁。
