# R61 思维导图错误提示修复验收

R61 修复思维导图页面在工作区或 SQLite 边界失败时显示通用“本地资料库暂时无法使用”的问题。根因是思维导图调用共享资料错误归一化逻辑，而该逻辑遗漏了后端已经定义的数据库和工作区稳定错误码，导致真实原因被 fallback 覆盖。

## 1. 修复范围

- `DATABASE_BUSY`、`WORKSPACE_STORAGE_UNAVAILABLE`、`DATABASE_CONFIGURATION_UNSUPPORTED`、`DATABASE_ERROR`、`SCHEMA_VERSION_UNSUPPORTED`、`MIGRATION_HISTORY_INCONSISTENT`、`MIGRATION_FAILED`、`SYSTEM_TIME_INVALID` 和 `INTERNAL_ERROR` 现在由资料/思维导图错误归一化层保留。
- 思维导图页面会显示可执行的本地化建议，不暴露绝对路径、SQL、堆栈或原始数据库错误正文。
- XMind 的直接导入解析行为不变；本轮只修复错误呈现链路。

## 2. 定向验证

| 范围                                       | 结果                                                     |
| ------------------------------------------ | -------------------------------------------------------- |
| `resourceClient.ts` / `knowledgeClient.ts` | 通过：稳定工作区错误码均有安全文案                       |
| `resourceClient.test.ts`                   | 通过：未知错误仍 fallback；`DATABASE_ERROR` 保留具体提示 |
| `knowledgeClient.test.ts`                  | 通过：思维导图路径保留 `WORKSPACE_STORAGE_UNAVAILABLE`   |
| Prettier / ESLint / TypeScript             | 通过                                                     |
| 定向 Vitest                                | 通过：2 个文件、13 个测试；related 15 个文件、109 个测试 |

## 3. 桌面验收（由用户执行）

1. 使用最新 Release 打开“资料 / 思维导图”。
2. 在工作区可用时进入思维导图并生成 XMind 草案，确认正常流程不受影响。
3. 若本地数据库被占用、工作区目录不可访问或数据库配置异常，确认页面显示对应的具体提示，而不是笼统的“本地资料库暂时无法使用”。
4. 确认提示中不包含绝对路径、SQL、堆栈或原始数据库错误文本。

本轮不启动 Release EXE，也不替代桌面人工验收。

## 4. 全量门禁与产物

最终门禁按项目固定顺序执行，结果如下：

| 门禁                                                                                       | 结果                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `pnpm check`                                                                               | 通过：61 个文件、393 个测试；前端构建通过  |
| `cargo fmt --all --manifest-path src-tauri\\Cargo.toml -- --check`                         | 通过                                       |
| `cargo test --locked --manifest-path src-tauri\\Cargo.toml`                                | 通过：290 个测试                           |
| `cargo clippy --locked --all-targets --manifest-path src-tauri\\Cargo.toml -- -D warnings` | 通过                                       |
| `pnpm tauri build --no-bundle`                                                             | 通过：2026-08-14 00:18:18 生成 Release EXE |

本批产物：

- [kystudy.exe](../src-tauri/target/release/kystudy.exe)：26,092,032 bytes，SHA-256 `9E66CA75841276904307B35E44053D2A6824020E1959CF7BC7DAE16BADA171E`
- `kystudy.pdb`：13,815,808 bytes，SHA-256 `2111F940275360FB96A8F730D40BD1BFDFB934B35E58377C8054B442ACE241DF`

验收前请使用本批最新 Release 产物。历史 R60 文档保持不变。
