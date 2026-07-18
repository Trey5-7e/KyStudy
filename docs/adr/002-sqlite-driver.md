# ADR-002：SQLite 驱动、迁移与 Repository 边界

| 项目        | 内容                                             |
| ----------- | ------------------------------------------------ |
| 状态        | accepted                                         |
| 日期        | 2026-07-18                                       |
| 决策者      | KyStudy 项目                                     |
| 相关需求    | 本地优先、可靠迁移、事务、备份恢复、前端最小权限 |
| 相关 Spike  | [TV-02](../spikes/TV-02-sqlite.md)               |
| 替代/被替代 | 无                                               |

## 上下文

KyStudy 的正式数据、后台任务、错题复习和 AI 用量需要保存在本地 SQLite 中。React 页面不应直接拼接 SQL、依赖数据库行结构或获得绕过业务规则的写入能力。Rust 核心需要负责连接配置、事务、迁移、完整性检查和备份。

当前还需要确定：采用 SQLite 专用的同步驱动，还是引入异步跨数据库工具；迁移是否由正式启动流程统一执行；Repository 边界是否完全保留在 Rust。

## 决策驱动因素

- 本地单机 SQLite 是已知目标，不需要远程数据库兼容；
- 前端只能调用按用户意图设计的稳定 Command；
- 外键、事务、迁移失败和备份恢复必须能做真实故障测试；
- Windows 打包应固定 SQLite 能力和安全修复版本；
- 依赖、编译时间和异步复杂度应与实际需求匹配；
- FTS5 与 Online Backup API 必须可用；
- 依赖应使用适合开源项目的许可证。

## 候选方案

### 方案 A：rusqlite + bundled

`rusqlite` 是 SQLite 专用同步绑定。`bundled` 固定随应用编译的 SQLite，`backup` 特性暴露 Online Backup API。

优点：

- 与本地 SQLite 的同步语义一致，事务边界直接；
- 不需要为数据库访问引入异步运行时或连接池；
- 可以查询编译选项并固定 FTS5、外键与安全修复版本；
- Online Backup API 可用于活动数据库的一致快照。

限制：

- 不提供跨数据库抽象；
- 单个 `Connection` 不应跨线程共享，并发任务需短事务和独立连接；
- SQL 仍需通过测试、约束和 Repository 映射维护。

### 方案 B：SQLx + SQLite

SQLx 提供异步 API、连接池、迁移和可选编译期查询检查，支持多个数据库。

优点：

- 异步任务与连接池能力成熟；
- 迁移和查询宏工具完整；
- 如果未来改用服务端数据库，部分访问模式可能复用。

限制：

- KyStudy 当前没有多数据库需求；
- SQLite 最终仍是单写者，引入异步并不会改变该约束；
- 增加运行时、宏和跨数据库抽象，当前收益不足以抵消复杂度。

### 方案 C：Tauri SQL plugin

官方插件基于 SQLx，支持 SQLite 与事务化迁移，并提供 JavaScript guest bindings。

优点：

- Tauri 集成和权限清单现成；
- 原型页面可以快速查询数据库。

限制：

- 官方 API 以 `select`、`execute` 和连接加载为中心；
- 即使 capability 可限制命令类别，也不能把任意 SQL 转化为稳定业务用例；
- 容易让事务和领域规则分散到页面。

## 决策

采用方案 A：正式工程由 Rust 核心使用 `rusqlite`，启用 `bundled` 和 `backup`。迁移由 Rust 启动流程统一执行；Application 层决定事务边界；Infrastructure Repository 封装 SQL；Tauri Command 只暴露目的明确的 DTO 用例。

不采用 Tauri SQL plugin 的 JavaScript guest API，不向前端授予 `select`、`execute` 或连接加载权限。当前不采用 SQLx；未来只有触发复审条件时再重新评估。

## 理由与证据

- SQLite 外键默认不能假设开启，必须对每个连接显式配置并回读验证；
- WAL 允许读写并行但仍只有一个写者，短事务和 busy timeout 比通用连接池更重要；
- SQLite 官方 Online Backup API 能为活动数据库生成一致快照；
- `rusqlite 0.40.1` 提供 `bundled`、`backup` 和显式事务行为；实测 bundled SQLite 为 3.53.2；
- Tauri SQL plugin 官方接口直接从 JavaScript 执行 SQL，不符合既定 Command 边界；
- TV-02 的 10,000 Task、100,000 Attempt 和 100,000 ReviewEvent 样本写入耗时 1.961 秒；今日任务查询均值 142 µs，到期复习查询均值 10.681 ms，均命中覆盖索引；
- 6 个单元测试和 8 个跨模块测试覆盖迁移整体回滚、快照恢复、业务事务、锁等待与超时、异常退出、损坏备份和不覆盖保护；
- 在线备份 44.41 MiB 数据库耗时 1.597 秒，校验并恢复到新目录耗时 1.091 秒。

## 后果

### 正面

- React 无法绕过用例层执行 SQL；
- SQLite 版本和关键编译能力随发布包固定；
- 迁移、备份与事务可以在不启动 Tauri 的 Rust 测试中验证；
- 正式工程无需仅为 SQLite 引入异步数据库运行时。

### 代价与限制

- 后台线程各自打开并配置连接，不能共享一个可变连接；
- Repository SQL 和 DTO 映射需要显式维护；
- 长查询和长写事务仍需在后续真实负载下持续测量；
- 网络文件系统不支持 WAL，工作区数据库必须位于本机受支持文件系统。

### 后续行动

- 在正式工程中按 TV-02 结论重写最小连接工厂、迁移器与备份适配器，不直接复制实验代码；
- 正式工程封装统一连接工厂，任何新连接都验证外键和 journal mode；
- TV-03 验证数据库事务与 Blob 文件操作的补偿边界；
- 在正式 Release 流程中记录 SQLite 版本与编译选项。

## 复审条件

- 实测 UI/后台任务需要大量并发数据库 I/O，独立同步连接导致无法接受的阻塞；
- 未来明确引入远程数据库或多进程服务端；
- `rusqlite` 维护、许可证、平台支持或所需 SQLite 特性发生重大变化；
- Online Backup API 无法满足包含 Blob 的完整备份一致性设计；
- 移动平台对当前内嵌构建方式存在无法解决的限制。
