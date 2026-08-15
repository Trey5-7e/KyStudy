# R60 XMind 直接导入验收

R60 将 XMind 从“识别后提示导出”升级为直接生成只读导入草案，面向常见 `.xmind` ZIP 包提供 `content.json` 和旧版 `content.xml` 两条解析路径。导图仍遵循“先预览、确认后写正式数据”的边界；样式、关系线和附件不导入，并在草案中提示。

## 1. 用户可见范围

- 资料库上传的 `.xmind` 文件可在思维导图导入窗口中直接选择。
- 生成预览草案会读取 XMind 主题层级和标题，展示树形预览与兼容性提示。
- 点击“确认导入”后才创建正式导图副本；拒绝草案不会写入正式节点。
- XMind 的主题样式、关系线、附件等扩展内容不会伪装成已导入能力。
- OPML 与 FreeMind `.mm` 的既有导入流程保持不变。

## 2. 实现与定向验证

| 范围                                                      | 结果                                  |
| --------------------------------------------------------- | ------------------------------------- |
| Rust `content.json` ZIP 解析                              | 通过：嵌套主题生成 typed draft        |
| Rust `content.xml` ZIP 解析                               | 通过：旧版 XMind 主题生成 typed draft |
| `src/features/mindmap/MindMapInteractionContract.test.ts` | 通过：4 个测试                        |
| `src/shared/tauri/knowledgeClient.test.ts`                | 通过：新增 XMind sourceFormat 测试    |
| Prettier / ESLint / TypeScript                            | 通过                                  |
| 定向 Vitest                                               | 通过：2 个文件、9 个测试              |
| 定向 Rust mindmap_import tests                            | 通过：5 个测试                        |

## 3. 桌面验收（由用户执行）

请使用本文件第 4 节列出的最新 Release：

1. 在资料库导入一个常见 `.xmind` 文件，进入“思维导图 / 导入已有思维导图”。
2. 选择 XMind 文件并点击“生成预览草案”，确认出现树形层级、节点数量和兼容性提示。
3. 确认生成草案时正式导图列表不增加；点击“确认导入”后才出现新的正式导图副本。
4. 重新生成一个草案并点击“拒绝草案”，确认不会创建正式导图。
5. 用包含多个画布的 XMind 文件验证应用能生成草案，并提示多个画布已合并；用包含样式、关系线或附件的文件确认只提示这些扩展未导入。
6. 回归检查 OPML、FreeMind `.mm` 导入和节点 PDF 页码关联行为。

本轮不启动 Release EXE，也不替代桌面人工验收。

## 4. 全量门禁与最新产物

全量门禁按项目固定顺序执行，每条命令均 exit 0；未启动 Release EXE。

| 门禁                                                                                       | 实绩                                                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 根 `pnpm check`                                                                            | 通过：61 个 Vitest 文件、391 个测试；Prettier、ESLint、TypeScript 和 Vite production build 均通过 |
| `cargo fmt --all -- --check`                                                               | 通过                                                                                              |
| `cargo test --locked --manifest-path src-tauri\\Cargo.toml`                                | 通过：290 passed、0 failed、0 ignored                                                             |
| `cargo clippy --locked --all-targets --manifest-path src-tauri\\Cargo.toml -- -D warnings` | 通过：无警告                                                                                      |
| 根 `pnpm tauri build --no-bundle`                                                          | 通过；Release 构建完成于 `2026-08-13T23:59:49+08:00`                                              |

验收前请使用本批最新产物：

| 产物                                   | size / mtime / SHA-256                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/target/release/kystudy.exe` | `26,092,032` B / `2026-08-13T23:59:49.3191615+08:00` / `A9C9DD4D969344FB58446E7F3A00C87426B57F30473B9991844328A13D81FF13` |
| `src-tauri/target/release/kystudy.pdb` | `13,815,808` B / `2026-08-13T23:59:49.3324478+08:00` / `58CFADB8A20B5FBD7DAE92B900C4B3811EE8BBAC2758E739F09B6FC61E7C6276` |
