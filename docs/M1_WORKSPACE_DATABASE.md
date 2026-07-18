# M1 Workspace 与 SQLite 基础

| 项目   | 内容                                                                       |
| ------ | -------------------------------------------------------------------------- |
| 工作项 | M1-010                                                                     |
| 日期   | 2026-07-18                                                                 |
| 状态   | completed                                                                  |
| 依据   | [ADR-001](adr/001-desktop-runtime.md)、[ADR-002](adr/002-sqlite-driver.md) |

> 本文记录 M1-010 完成时的 v1 快照。当前正式工程已由 M1-011 升级到 schema v2；最新 Blob 范围和 Release 信息见 [M1_BLOB_IMPORT.md](M1_BLOB_IMPORT.md)。

## 实现范围

- Rust 从 Tauri 应用数据目录解析 `workspaces/default/`，前端不接收绝对路径；
- 首次由用户点击后创建 UUIDv7 工作区和 `kystudy.sqlite3`；
- 启动时只检查状态，不会因为渲染页面自动创建工作区；
- `get_workspace_status` 和 `initialize_default_workspace` 是唯一新增 Command，不提供任意 SQL；
- 同步 `rusqlite` 操作通过阻塞任务执行，不阻塞 WebView 事件循环；
- v1 迁移只包含 `schema_migration` 与 `workspace`，业务功能表按后续里程碑引入。

## SQLite 约束

- `rusqlite 0.40.1`，启用 `bundled` 与 `backup`；
- 每个连接启用并回读外键，使用 WAL、`synchronous=NORMAL`、`trusted_schema=OFF` 和 2 秒 busy timeout；
- 使用 `application_id=0x4B595354` 区分 KyStudy 与其他 SQLite 文件；
- 同时校验 `user_version`、迁移名称和 SHA-256；
- 迁移在 `IMMEDIATE` 事务中执行，失败时整体回滚；
- 新建数据库失败时只清理本次新建的数据库文件，不删除既有工作区。

## 数据与错误边界

WebView 只获得工作区 ID、名称、时区、每日错题数量、提前补足开关、创建时间和 schema 版本。数据库路径、SQL、SQLite 行、错误源和迁移文本不会进入前端。

后端返回稳定错误码和操作编号；前端根据已知错误码显示固定文案，不信任任意异常消息，因此内部路径不会因异常字符串泄漏。

## 自动证据

- 9 个 TypeScript/Vitest 契约测试通过；
- 19 个 Rust 测试通过；
- 覆盖首次创建、无副作用状态检查、关闭连接后重开 ID 不变、外键启用、非法迁移整体回滚、未来 schema、迁移哈希漂移、损坏数据库和其他应用数据库拒绝；
- Prettier、ESLint、TypeScript、production build、Rustfmt 和全目标/全特性 Clippy 零警告；
- Windows Tauri Release 构建成功。

Release EXE：

```text
F:\develop\KyStudy\src-tauri\target\release\kystudy.exe
大小：10,494,976 bytes
SHA-256：0F7EA48D0501A0BA33AE437AB70C669F34985C7652D9909668AB8CC92BBD2CF7
```

## 人工 Smoke

项目维护者已于 2026-07-18 按以下清单完成正式 Windows Release 验收，首次创建、数据显示和关闭后重启恢复全部通过。

1. 关闭之前打开的 KyStudy 窗口；
2. 双击上述 Release EXE；
3. 确认“运行状态”为“本地核心已连接”，应用版本为 `0.1.0`，Schema 为 `v1`；
4. 首次运行时，Workspace 卡片应显示“尚未创建本地工作区”；
5. 点击“创建本地工作区”，等待卡片显示“我的考研工作区”；
6. 确认时区为 `Asia/Shanghai`、每日错题为 `5 道`、数据库 Schema 为 `v1`；
7. 关闭应用，再次启动同一个 EXE；
8. 确认工作区直接恢复，且不再显示创建按钮；
9. 正常关闭应用。

如果失败，请回复“步骤编号 + 完整界面文字 + 操作编号”。本次测试只创建一个很小的本地 SQLite 工作区，不读取个人 PDF、图片或其他资料。

## 暂缓项

- 自定义工作区名称、考试日期和时区编辑；
- 高风险 v2 迁移前快照；
- Blob、后台导入任务和数据库/文件补偿；
- 完整备份恢复和多工作区切换。

这些分别进入 M1-011、M1-012 或后续产品里程碑，不在 v1 迁移中提前建表。
