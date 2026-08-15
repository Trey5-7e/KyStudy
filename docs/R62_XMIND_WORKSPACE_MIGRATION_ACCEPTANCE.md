# R62 XMind 草案工作区迁移修复验收

R62 修复 R60 XMind 直接导入在已有工作区中保存草案时报“本地工作区暂时无法打开”的问题。

## 1. 根因与修复

R60 已经在前端和 Rust 解析层支持 `xmind`，但历史工作区的 `map_import_draft` 表仍由 v6 migration 创建，`source_format` CHECK 约束只允许 `opml` 和 `freemind`。保存 XMind 草案时触发 SQLite 约束失败，后端以 `DATABASE_ERROR` 安全文案返回。

本轮新增 v23 migration：

- 重建 `map_import_draft`，保留已有草案、ID、树 JSON、状态和时间字段；
- 将 `source_format` 扩展为 `opml`、`freemind`、`xmind`；
- 保留严格字段约束、外键和查询索引；
- 新建工作区与 v22 及更早工作区都会自动到达 schema v23。

不删除、不覆盖用户资料和已存在的导入草案；R60 的 XMind 解析边界（导入层级和标题，不导入样式、关系和附件）保持不变。

## 2. 自动化验收

| 范围                         | 结果                                                |
| ---------------------------- | --------------------------------------------------- |
| v22 → v23 工作区迁移         | 通过：历史 OPML 草案保留，迁移后可写入 XMind 草案   |
| 迁移历史校验                 | 通过：未知历史 checksum 仍拒绝，v23 checksum 受保护 |
| Rust `sqlite_workspace` 测试 | 通过：18 项                                         |
| XMind 解析回归               | 通过：`content.json` 与 `content.xml` 测试          |

## 3. 桌面验收（由用户执行）

1. 使用本批最新 Release 启动应用，等待首次启动完成自动迁移。
2. 进入“资料 → 思维导图”，选择已有 `.xmind` 资料并生成导入草案。
3. 确认不再出现“本地工作区暂时无法打开”；草案应显示为 XMind，并可继续确认导入。
4. 确认 R60 中已有 OPML、FreeMind 草案和正式思维导图仍可浏览。
5. 如仍失败，请记录完整提示、操作编号和“设置 → 数据 → 运行诊断”的脱敏摘要；不要删除或手动修改工作区文件。

本轮不启动 Release EXE，也不替代桌面人工验收。

## 5. 全量门禁与产物

| 门禁                                                                                       | 结果                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `pnpm check`                                                                               | 通过：61 个文件、393 个测试；前端构建通过  |
| `cargo fmt --all --manifest-path src-tauri\\Cargo.toml -- --check`                         | 通过                                       |
| `cargo test --locked --manifest-path src-tauri\\Cargo.toml`                                | 通过：291 个测试                           |
| `cargo clippy --locked --all-targets --manifest-path src-tauri\\Cargo.toml -- -D warnings` | 通过                                       |
| `pnpm tauri build --no-bundle`                                                             | 通过：2026-08-14 00:46:42 生成 Release EXE |

本批产物：

- [kystudy.exe](../src-tauri/target/release/kystudy.exe)：26,092,032 bytes，SHA-256 `F07F0E6F1AB0D0E542A6785E0A327FF163B716A5D6828CB385D05F64994B9E20`
- `kystudy.pdb`：13,815,808 bytes，SHA-256 `F4C9DBEFCA6D34CBF8BB392792AD7DB8EB0FF57654E3999B2B6C2B7DE2B20989`

验收前请使用本批最新 Release 产物。历史 R60、R61 文档保持不变。
