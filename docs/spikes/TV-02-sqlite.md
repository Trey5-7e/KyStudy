# TV-02：SQLite、迁移与恢复

| 项目     | 内容                                   |
| -------- | -------------------------------------- |
| 状态     | completed                              |
| 结论     | passed                                 |
| 日期     | 2026-07-18                             |
| 负责人   | KyStudy 项目                           |
| 关联 ADR | [ADR-002](../adr/002-sqlite-driver.md) |

## 要回答的问题

在 Windows 本地桌面场景中，Rust 核心能否使用内嵌 SQLite 完成受控数据访问，并在外键、迁移失败、业务事务失败、并发写入、异常退出和备份损坏时保持可检查、可恢复的一致状态？

## 不在范围内

- 不初始化正式 KyStudy 工程，也不复用 TV-01 的 Tauri 壳；
- 不实现完整产品数据模型，只创建规模与事务验证所需的最少表；
- 不实现 Blob 打包、PDF、OCR、AI、同步和加密备份；
- 不比较中文分词质量，只验证 FTS5 与 `trigram` 能力存在；
- 不向 React 或 Tauri JavaScript 暴露数据库连接和任意 SQL。

## 环境

| 项目       | 值                                                        |
| ---------- | --------------------------------------------------------- |
| 操作系统   | Windows 11 专业版 10.0.26100                              |
| CPU / 内存 | AMD Ryzen 7 5800H，16 逻辑处理器；15.86 GiB 内存          |
| Rust       | 1.97.1                                                    |
| 驱动候选   | rusqlite 0.40.1；sqlx 0.9.0；Tauri SQL plugin             |
| SQLite     | 3.53.2；source id `d6e03d8c...df1a24`；`rusqlite/bundled` |
| 构建模式   | 自动测试为 debug；规模测量为 release                      |

## 样本

- 迁移和事务测试使用独立临时数据库，可随时删除；
- 规模样本使用确定性生成的 10,000 条任务、100,000 条作答和 100,000 条复习事件；
- 损坏样本由测试对临时备份副本翻转字节生成，不使用真实用户文件；
- 异常退出样本由子进程提交一个 `running` 后台任务后，在未提交业务事务期间主动中止生成。

## 候选方案

1. `rusqlite + bundled + backup`：同步、SQLite 专用、依赖面小，直接提供事务与 Online Backup API；
2. `sqlx + sqlite`：提供异步、连接池、迁移和可选编译期查询检查，但引入异步运行时与跨数据库抽象；
3. Tauri SQL plugin：基于 sqlx 且迁移原子化，但官方接口面向 JavaScript 提供 `select`/`execute` 权限，不符合 KyStudy 的用例边界。

本实验优先实现方案 1。方案 2 和 3 只做边界与依赖评估，不各自复制一套完整实验。

## 通过标准

- [x] 每个连接都显式启用外键，非法引用被拒绝；
- [x] WAL 实际启用，SQLite 版本不受已知 WAL-reset 缺陷影响；
- [x] 迁移重复执行无变化，校验和漂移被拒绝；
- [x] 迁移失败不留下半迁移 schema，并保留可验证的迁移前快照；
- [x] 业务事务失败不留下半完成对象；
- [x] 锁竞争在 busy timeout 内等待并成功，超时可返回稳定错误；
- [x] 异常退出后数据库可打开，能识别 `running` 后台任务，未提交业务写入不可见；
- [x] `integrity_check` 和 `foreign_key_check` 均通过，损坏副本可被拒绝；
- [x] 在线备份有 SHA-256，可恢复到新目录，失败恢复不覆盖现有数据库；
- [x] FTS5 `trigram` 探针可创建并查询；
- [x] 10,000 条今日任务与 100,000 条到期复习相关数据查询无明显卡顿，记录 release 实测值和查询计划；
- [x] 库公开 API 不提供任意 SQL 或任意文件访问入口；
- [x] `fmt`、测试和全目标 Clippy 零警告通过。

## 实验步骤

1. 锁定最小依赖，记录 SQLite 运行时版本、源码标识和编译选项；
2. 实现每连接配置、版本化迁移、迁移校验和与高风险迁移前快照；
3. 实现目的明确的 Repository/用例 API 和事务失败测试；
4. 用两个独立连接验证 WAL 与锁等待；
5. 用子进程模拟写入期间异常退出并重新打开；
6. 使用 SQLite Online Backup API 创建一致快照，计算哈希并恢复到临时文件；
7. 验证完整性、外键、损坏备份和不覆盖保护；
8. 生成规模样本，在 release 下记录写入和关键查询耗时；
9. 运行格式、测试和 Clippy，回填结论与 ADR。

## 结果

### 测量数据

| 场景               | 指标                                                           | 结果                                      |
| ------------------ | -------------------------------------------------------------- | ----------------------------------------- |
| SQLite 运行时      | 版本与能力                                                     | 3.53.2；WAL、外键、FTS5 `trigram` 均可用  |
| 规模样本写入       | 10,000 Task + 100,000 Question/Attempt/ReviewState/ReviewEvent | 1,961 ms                                  |
| 今日任务查询       | 2,500 条结果，500 次均值                                       | 142 µs；命中 `idx_task_today` 覆盖索引    |
| 到期复习查询       | 60,000 条结果，500 次均值                                      | 10,681 µs；命中 `idx_review_due` 覆盖索引 |
| 在线备份           | 46,571,520 bytes（44.41 MiB）                                  | 1,597 ms                                  |
| 校验并恢复到新目录 | SHA-256 + schema + integrity + foreign key                     | 1,091 ms                                  |
| Release 测量程序   | `tv02-benchmark.exe`                                           | 2,004,480 bytes                           |

### 成功样本

- 新数据库应用 v1、v2 后重开不重复执行迁移；
- 每个连接回读确认 `foreign_keys=1`、`journal_mode=wal`；
- 迁移历史校验和一致，FTS5 `trigram` 能查询“线性代数”；
- 两个独立连接竞争写锁时，第二个写者等待约 250 ms 后成功；
- 子进程提交 `running` Job 后以退出码 86 异常结束，重开数据库可识别该 Job；
- 在线备份经结构、外键和 SHA-256 验证后恢复到不同绝对目录。

### 失败与边界样本

- 第二个迁移含非法 SQL 时，v1 和失败迁移同一批次的 schema 全部回滚；
- 已有 v1 数据库执行失败的高风险 v2 时，原库保持 v1，迁移前快照可恢复；
- 修改已应用迁移的校验和后，启动被 `MIGRATION_CHECKSUM_MISMATCH` 拒绝；
- 缺失 Workspace 的 Question 被外键拒绝；
- ReviewEvent ID 冲突时，同一事务内先插入的 Attempt 也回滚；
- 75 ms 写锁等待超时映射为稳定 `DATABASE_BUSY`；
- 修改备份文件头后，即使提供修改后哈希，仍因 SQLite 结构检查失败而拒绝，目标文件不存在；
- 已存在的恢复目标返回 `DESTINATION_EXISTS`，不覆盖原文件。

### 恢复与降级

- 恢复只允许写入不存在的目标数据库；
- 备份先校验期望 SHA-256，再复制到目标目录中的临时文件；
- 临时副本通过 SQLite 完整性、外键和 schema 版本检查后才原子持久化；
- 任一步失败时删除临时副本，保留原目标和源备份。

## 结论

`passed`。13 项通过标准全部满足；6 个单元测试、8 个跨模块测试、格式检查和全目标/全特性 Clippy 均通过。规模样本的两条关键查询都使用覆盖索引，最慢的到期复习计数均值约 10.7 ms，没有出现明显卡顿。

该结论只覆盖本机 SQLite 主数据库。Blob、数据库与文件之间的补偿一致性及完整工作区备份进入 TV-03；FTS5 中文召回质量不由本实验判断。

## 建议决策

接受 ADR-002：Rust 核心使用 `rusqlite 0.40.1` 的 `bundled` 与 `backup` 特性，Repository 和事务留在 Rust application/infrastructure 边界，不启用 Tauri SQL 的前端任意查询接口。

当前 bundled SQLite 为 3.53.2，高于修复 WAL-reset 缺陷的 3.51.3。关键编译选项包括 `ENABLE_FTS5`、`THREADSAFE=1`、`DEFAULT_FOREIGN_KEYS`、`ENABLE_RTREE` 和 `ENABLE_STAT4`。尽管底层编译了 `ENABLE_LOAD_EXTENSION`，本实验没有启用 rusqlite 的 `load_extension` 特性，正式工程也不提供扩展加载入口。

## 后续行动

- [x] 完成实验实现与自动测试；
- [x] 回填 SQLite 版本、编译选项和性能数据；
- [x] 根据结果更新 ADR-002 和 Spike 索引；
- [x] TV-03 复用已验证的数据库事务边界，完成 Blob 与数据库的一致性补偿验证。

## 参考资料

- [SQLite 外键](https://www.sqlite.org/foreignkeys.html)
- [SQLite 事务](https://www.sqlite.org/lang_transaction.html)
- [SQLite WAL](https://www.sqlite.org/wal.html)
- [SQLite Online Backup API](https://www.sqlite.org/backup.html)
- [SQLite PRAGMA](https://www.sqlite.org/pragma.html)
- [rusqlite](https://github.com/rusqlite/rusqlite)
- [SQLx](https://github.com/launchbadge/sqlx)
- [Tauri SQL plugin](https://v2.tauri.app/plugin/sql/)
