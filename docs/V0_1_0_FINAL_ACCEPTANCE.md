# KyStudy v0.1.0 最终验收记录

验收日期：2026-08-14；发布候选追加：2026-08-15
当前版本：`0.1.0`
验收边界：自动门禁、当前版本 Release 产物和已完成的用户桌面证据；不代替项目维护者执行桌面操作，也不宣称正式公开发布已经完成。

## 1. 自动门禁结果

| 门禁                                                                                       | 结果                                                                           |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `pnpm check`                                                                               | 通过；63 个测试文件，406 个测试全部通过；格式、Lint、TypeScript、Vite 构建通过 |
| `cargo fmt --all --manifest-path src-tauri\\Cargo.toml -- --check`                         | 通过                                                                           |
| `cargo test --locked --manifest-path src-tauri\\Cargo.toml`                                | 通过；291 passed，0 failed                                                     |
| `cargo clippy --locked --all-targets --manifest-path src-tauri\\Cargo.toml -- -D warnings` | 通过                                                                           |
| `pnpm tauri build --no-bundle`                                                             | 通过；未启动桌面程序                                                           |

## 2. 最新 Release 产物

| 项目     | 值                                                                 |
| -------- | ------------------------------------------------------------------ |
| 文件     | `src-tauri/target/release/kystudy.exe`                             |
| 大小     | 26,104,320 字节                                                    |
| 编译时间 | 2026-08-14 21:39:50                                                |
| SHA-256  | `C0F07E0D667B60D4207F8E5DA56DAD15B83202EAAC02F14A6374F3E77EDA36D7` |
| 运行状态 | 编译后未启动                                                       |

## 3. 已有用户验收证据

以下记录已追加后续用户验收证据，结果为通过：

- [M13 计划执行进度](M13_ACCEPTANCE.md)
- [R40 资料驱动计划窗口](POST_REDESIGN_REVIEW.md)
- [R23 题目缺漏确认](R23_QUESTION_GAP_ACKNOWLEDGEMENTS_ACCEPTANCE.md)
- [R25 扫描练习册 OCR](R25_SCANNED_WORKBOOK_OCR_ACCEPTANCE.md)
- [R26 1000 题导入与诊断](R26_1000_QUESTION_IMPORT_AND_DIAGNOSIS_ACCEPTANCE.md)
- [R32 题库主页与工具窗口](R32_QUESTION_BANK_HOME_AND_DIALOG_REFINEMENT_ACCEPTANCE.md)
- [R39 页面表面与 AI 设置窗口](R39_PAGE_SURFACE_AND_AI_SETTINGS_WINDOW_ACCEPTANCE.md)
- [R48 周期计划事项跳过](R48_CYCLE_PLAN_ITEM_SKIP_ACCEPTANCE.md)
- 最新资料行菜单行为：点击菜单外区域自动关闭，已由项目维护者验收通过。

## 3.1 2026-08-15 发布候选产物追加记录

以下记录只证明构建和打包成功，不代替项目维护者执行桌面安装、启动和交互验收：

| 产物                                                               |            大小 | SHA-256                                                            |
| ------------------------------------------------------------------ | --------------: | ------------------------------------------------------------------ |
| `src-tauri/target/release/kystudy.exe`                             | 26,104,832 字节 | `7FAC726AE2224319C641177620014BC7857A42EAA4A3A32C5BF22E90165FE1C1` |
| `src-tauri/target/release/bundle/nsis/KyStudy_0.1.0_x64-setup.exe` |  6,633,912 字节 | `1E2C2F6A5BC1819F38D7A025AC8FBED723270B627129097C3AF2DF6D5DFDF3B9` |
| `artifacts/kystudy-windows-x64-portable.zip`                       |  8,911,033 字节 | `9933B9F1F18F3AABF35E75A48AAEECFAEF6ACD0EFC60A06E93CE3550D125662D` |

- `pnpm tauri build`：通过，生成 NSIS 安装包；未启动桌面程序。
- `pnpm package:windows-portable`：通过，ZIP 包含 `kystudy.exe`、`LICENSE` 和 `README.txt`。
- OCR 组件打包脚本测试：通过；便携包与 Smoke 脚本 PowerShell 语法解析通过。
- 敏感信息扫描：未发现本机绝对用户路径或常见密钥标记。

## 3.2 透明项目图标接入追加记录

- 使用透明 PNG 生成并替换 src-tauri/icons/icon.ico；ICO 包含 16、24、32、48、64、128、256 像素尺寸。
- 每个 ICO 尺寸均验证为 RGBA，四角透明。
- pnpm tauri build：通过，重新生成 NSIS 安装包；未启动桌面程序。
- pnpm package:windows-portable：通过，便携版已使用新图标对应的 Release EXE 重新生成。

| 产物                                                             |            大小 | SHA-256                                                          |
| ---------------------------------------------------------------- | --------------: | ---------------------------------------------------------------- |
| src-tauri/target/release/kystudy.exe                             | 26,104,832 字节 | CD4BFFD118855D4DDDA02E4D34E218BFECDD563D5FA8A5671B3A217A5E6742C9 |
| src-tauri/target/release/bundle/nsis/KyStudy_0.1.0_x64-setup.exe |  6,642,143 字节 | 7CD3C90D7EE82102FC86CA8FC53A79228434C5E279E53BC44BBED70417629CE7 |
| artifacts/kystudy-windows-x64-portable.zip                       |  8,911,210 字节 | 011259914F2BA6359F4264831899F17D57100A69D9EC4DF3C3FFC1972B78E502 |

## 3.3 品牌图标紧凑裁切与左上角接入追加记录

- 透明图标裁掉多余外边距并保留安全留白，生成 docs/branding/kystudy-icon-concept-v4-transparent-tight.png。
- 前端 AppBrand 改用 src/assets/kystudy-icon.png，左上角不再显示 KY 字母方块。
- src-tauri/icons/icon.ico 由紧凑透明图标重新生成，保留 16、24、32、48、64、128、256 像素尺寸。
- pnpm check：通过；63 个测试文件，406 个测试全部通过。
- pnpm tauri build：通过，重新生成 NSIS 安装包；未启动桌面程序。
- pnpm package:windows-portable：通过，便携版已重新生成。

| 产物                                                             |            大小 | SHA-256                                                          |
| ---------------------------------------------------------------- | --------------: | ---------------------------------------------------------------- |
| src-tauri/target/release/kystudy.exe                             | 26,313,728 字节 | 34F233EA824B53142193254C5EF4CAD08E7AA9C8CB7A426CC3CD5117A7201AC0 |
| src-tauri/target/release/bundle/nsis/KyStudy_0.1.0_x64-setup.exe |  6,846,096 字节 | BC6CC9D2453DA63633FC4E20D7AA05A942979E95303E12EFB7D2570AD5705EE7 |
| artifacts/kystudy-windows-x64-portable.zip                       |  9,120,854 字节 | 537DBD9FFF0232854A029A0B597C7114EB6DF918432C43016DF63BD7189D4071 |

## 4. 本批次最终桌面验收步骤

请使用上表中的最新 EXE，在隔离工作区执行：

1. 打开“习题册 → 题库工具 → 快速登记做题”，选择一种标记后点击题号；再次点击同一题号应清除标记，拖动应保持批量登记/清除行为。
2. 打开“资料 → 资料文件”的任一行菜单；点击页面其他区域，菜单应自动关闭；点击“更改用途”或“删除资料”时不应被外部关闭逻辑误触发。
3. 复核已有题库浏览、资料打开、思维导图预览、组卷恢复/提交和设置窗口主流程没有回归。
4. 若执行 OCR 组件验收，按 [R50 OCR 组件管理验收](R50_OCR_COMPONENT_MANAGEMENT_ACCEPTANCE.md) 的步骤记录本地安装、修复、移除、缺失文件和并发场景结果。

## 5. 当前未闭合的发布条件

- R50 的桌面 OCR 组件管理记录仍需项目维护者补填并确认。
- R52 仍等待正式 OCR ZIP 资产、公开 HTTPS 地址、SHA-256、许可证与 NOTICE 复核；在这些条件完成前，在线下载只能作为已实现但未发布资产的能力，不能宣称正式发布可用。
- NSIS/ZIP 产物已在本机发布候选构建中生成，但尚未从干净提交创建 `v0.1.0` 标签，也尚未上传 GitHub Release。

因此，当前状态为：**自动门禁和当前实现验收通过；等待最后一轮桌面证据与正式发布资产闭合后，才能宣称 v0.1.0 正式发布验收通过。**

## 6. 2026-08-15 OCR 公开发布与在线构建追加记录

本节追加记录最新状态，前文历史验收结论保持不变：

- 已将 `Trey5-7e/KyStudy` 仓库切换为 Public，并将 `ocr-v0.1.0` 从 Draft 发布为正式 OCR Release。
- OCR ZIP：[kystudy-ocr-worker-v0.1.0.zip](https://github.com/Trey5-7e/KyStudy/releases/download/ocr-v0.1.0/kystudy-ocr-worker-v0.1.0.zip)，大小 `116,300,551` 字节，SHA-256 `bb5a3e16a898713adde85717f4debe8cfbdf22ca10eb632752368f200513b01`。
- 已使用公开 URL 和上述摘要完成在线下载配置构建。最新 EXE：`src-tauri/target/release/kystudy.exe`，大小 `26,371,584` 字节，SHA-256 `876EB2551647DAAA4049AF2AFE171531175B0C08954972FE839ECED87B81D8A6`；未启动桌面程序。
- `pnpm check`、`cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`、`cargo test --locked --manifest-path src-tauri/Cargo.toml` 和 `cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings` 均通过。

因此，R52/R53 的 OCR 资产与在线下载构建条件已闭合；完整 v0.1.0 应用发行包的桌面安装验收仍按项目维护者流程执行。

## 7. 2026-08-15 本地迁移历史兼容修复追加记录

部分已有工作区的 v15、v17 迁移记录保留了格式化前的合法 SHA-256；发布候选版本曾因迁移文件换行规范化而误报 `MIGRATION_HISTORY_INCONSISTENT`。本次修复将这两组已知历史摘要加入兼容白名单，未修改任何用户数据库内容，并新增回归测试。

修复版在线 OCR EXE 输出到 `src-tauri/target/release-migration-fix/release/kystudy.exe`，大小 `26,372,096` 字节，SHA-256 `21BF79325517F7C1F67CDFA293A295B707E3C8F175D326DCF1CF0622A1C389EC`。该构建未启动桌面程序；旧 EXE 若仍在运行，需要先正常退出后再替换。
