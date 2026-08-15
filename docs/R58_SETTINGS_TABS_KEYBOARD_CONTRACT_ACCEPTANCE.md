# R58 设置页标签键盘与可访问性契约验收

R58 收口设置页四个二级分类标签的自动化回归证据。运行时代码保持不变：本轮验证并固定既有的方向键循环、Home/End 边界、roving `tabIndex`、稳定 `tabpanel` 目标、标签描述关联和切换后的焦点恢复。

## 1. 用户可见范围

- 设置页的“学习与考试 / AI / 数据 / 应用”四个分类保持固定顺序。
- `ArrowRight` / `ArrowDown` 前进，`ArrowLeft` / `ArrowUp` 后退，首尾循环。
- `Home` 和 `End` 跳转到首个或最后一个分类；其他按键不改变选择。
- 只有当前标签进入自然 Tab 顺序，其余标签使用 `tabIndex=-1`。
- 每个标签通过 `aria-controls` 指向同一个稳定的 `settings-panel`；面板通过 `aria-labelledby` 回指当前标签，并保留每个标签的描述关联。
- 分类切换后焦点回到新标签，懒加载内容仍在同一面板内呈现。

## 2. 定向验证

| 范围                                          | 结果                     |
| --------------------------------------------- | ------------------------ |
| `src/features/settings/SettingsPanel.test.ts` | 通过：7 个测试           |
| Prettier                                      | 通过                     |
| ESLint（零警告）                              | 通过                     |
| TypeScript typecheck                          | 通过                     |
| Vitest 定向运行                               | 通过：1 个文件、7 个测试 |

新增测试同时覆盖导航模型和 `SettingsPanel.tsx` 的 DOM 契约源码标记，防止后续重构时丢失无障碍关系或焦点行为。

## 3. 桌面验收（由用户执行）

自动化门禁通过后，请在最新 Release WebView 中打开“设置”：

1. 使用鼠标切换四个分类，确认标题和内容仍在同一设置窗口内更新。
2. 聚焦分类标签后测试四个方向键、`Home`、`End`；确认焦点随分类移动且首尾循环。
3. 使用 `Tab` 离开并再次进入标签组，确认只有当前标签被选中；确认内容面板可获得焦点。
4. 在 AI、数据等懒加载分类间来回切换，确认 loading、错误和返回页面行为没有回归。

本轮不启动 Release EXE，也不替代桌面人工验收。

## 4. 全量门禁与产物

最终门禁按项目固定顺序执行，每条命令均 exit 0；未启动 Release EXE，也未将自动检查替代桌面验收。历史 R39 及此前验收记录保持不变。

| 门禁                                                                                       | 实绩                                                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 根 `pnpm check`                                                                            | 通过：60 个 Vitest 文件、386 个测试；Prettier、ESLint、TypeScript 和 Vite production build 均通过 |
| `cargo fmt --all -- --check`                                                               | 通过                                                                                              |
| `cargo test --locked --manifest-path src-tauri\\Cargo.toml`                                | 通过：288 passed、0 failed、0 ignored                                                             |
| `cargo clippy --locked --all-targets --manifest-path src-tauri\\Cargo.toml -- -D warnings` | 通过：无警告                                                                                      |
| 根 `pnpm tauri build --no-bundle`                                                          | 通过；Release 构建完成于 `2026-08-13T23:20:48+08:00`                                              |

本批最新 Release 产物如下，验收前请使用此版本：

| 产物                                   | size / mtime / SHA-256                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/target/release/kystudy.exe` | `25,927,168` B / `2026-08-13T23:20:48.7744203+08:00` / `3D5266EAFC0B7EE784AE9E829B97BF6A451C7AAC3130FC3BFF4C24723428165E` |
| `src-tauri/target/release/kystudy.pdb` | `13,766,656` B / `2026-08-13T23:20:48.7875367+08:00` / `C7978207D3ABB58F0FC88B3A038FCCC3399166A1C573E81DA502F1284AE34765` |
