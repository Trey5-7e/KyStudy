# R65 思维导图节点搜索层级修复验收

R65 修复了节点搜索结果被 MindElixir 预览画布覆盖、文字看似没有背景板的问题。

## 1. 修复内容

- 阅读器建立独立层叠上下文，并将搜索栏与结果列表放入独立容器，避免 MindElixir 的变换画布影响搜索结果层级。
- 结果列表改为搜索栏下方的正常文档流卡片；搜索时会推开画布，不再依赖绝对定位或浮层覆盖。
- 结果面板使用不透明背景，搜索结果文字不会与导图节点、连线或工具栏混排。
- 画布继续保持原有拖拽平移、滚轮缩放和只读预览行为。

## 2. 桌面验收（由用户执行）

1. 使用本批最新 Release 进入“资料 → 思维导图”。
2. 在“搜索节点”输入一个能匹配多个节点的关键词。
3. 确认结果列表显示为完整背景板，结果文字和按钮不被导图节点、连线或 MindElixir 工具栏覆盖。
4. 点击结果项，确认仍能定位节点；清空搜索后确认画布拖拽、滚轮缩放和“返回父节点”仍可用。

本轮不启动 Release EXE，也不替代桌面人工验收。

## 3. 自动化与产物

本批完整门禁结果：

| 门禁                                                                                       | 结果                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `pnpm check`                                                                               | 通过：61 个测试文件、396 项测试；前端构建通过 |
| `cargo fmt --all --manifest-path src-tauri\\Cargo.toml -- --check`                         | 通过                                          |
| `cargo test --locked --manifest-path src-tauri\\Cargo.toml`                                | 通过：291 项测试                              |
| `cargo clippy --locked --all-targets --manifest-path src-tauri\\Cargo.toml -- -D warnings` | 通过                                          |
| `pnpm tauri build --no-bundle`                                                             | 通过：2026-08-14 10:20:21 生成 Release EXE    |

验收前请使用这里记录的最新产物：

- [kystudy.exe](../../../src-tauri/target/release/kystudy.exe)：26,096,128 bytes，SHA-256 `E6886C1D822B408D30790BAFEACF4D968DF85C7EE8B10E480A8F6FE62592CC59`
- `kystudy.pdb`：13,815,808 bytes，SHA-256 `8FC429D71B442D028C358FEECCE6183034A789807D611141D9F2EB22B0872B58`
