# v0.1.1 发布跟踪

## 当前状态

- **状态**：候选资产已生成，等待 GitHub 发布确认；
- **当前公开版本**：v0.1.0；
- **v0.1.1 Tag/Release**：尚未创建；
- **发布策略**：不覆盖 v0.1.0，整改完成后创建新的 patch release。

## 已记录的整改项

- 资料库的 PDF/图片阅读器已改为当前窗口内的受控大尺寸弹窗，复用统一模态交互；
- 上述阅读弹窗已由项目维护者验收通过；
- 仓库清理仅移除可再生成的 PDF 实验基准输出，并将实验 `output/` 目录加入忽略规则；实验源码、公开样本与历史验收归档继续保留；
- Release EXE 启动时额外打开命令行窗口：已在 `src-tauri/src/main.rs` 增加 Windows GUI 子系统声明；
- 已完成前端检查、Rust 测试和 Clippy 验证；本批 `pnpm check` 通过（64 个测试文件、409 个测试）；
- Release Rust 编译已通过，PE 子系统已确认是 Windows GUI；
- 完整 `pnpm tauri build --no-bundle` 已重新完成，Release EXE 构建成功；PE 子系统确认是 Windows GUI。
- 设置页已移除旧版“历史详细规划/兼容工具”入口，应用信息区隐藏内部 Schema 字段并改用面向用户的问题排查文案；
- AI 设置页不再展示或创建 `offline_test` Provider，后端类型、历史数据和自动化测试保持不变；
- 在没有正式 Provider 时，连接测试入口和提交控件会禁用，避免旧工作区的离线配置被间接触发；
- 清理设置页下已无实际用途的旧版导航回调，避免正式界面继续暴露遗留入口。
- 本批 Rust 门禁通过：`cargo fmt --check`、297 个 `cargo test --locked` 测试、`cargo clippy --all-targets --all-features --locked -- -D warnings`；
- 本批 `pnpm tauri build --no-bundle` 已完成，Release EXE 构建成功；未启动 EXE，仍待用户进行桌面验收。
- 已确认安装版显示开发资料的原因是开发版与安装版共用当前用户的 `%APPDATA%\\io.github.kystudy.desktop` 工作区；新增 `scripts/start-clean-release-preview.ps1`，可用隔离 AppData 交互查看新用户首启状态，退出后自动清理。
- Debug 构建已改用 `%APPDATA%\\io.github.kystudy.desktop-dev` 和独立凭据服务 `io.github.kystudy.ai-dev`，Release/安装版保持正式目录与凭据服务；新增一次性显式确认的 `scripts/separate-development-workspace.ps1`，用于迁移现有开发数据，迁移后 Debug 需重新录入 API Key。
- 迁移后检查确认原数据仍在 Debug 目录；新增 `scripts/restore-release-workspace.ps1`，支持将原数据安全恢复到 Release 目录并保留当前 Release 目录备份。
- 主页面标题结构已统一：移除习题册“题库”、错题“每日复习队列”和已有日程“历史详细日程”等冗余眉题；删除设置、今日、资料列表等重复副标题，仅保留计划、错题和资料页必要的行为提示。
- 已将应用、Cargo、Tauri 配置和 Windows 便携包脚本版本统一为 `0.1.1`，新增候选发布说明 `docs/V0_1_1_RELEASE_NOTES.md`；当前仍未创建 tag 或 GitHub Release。
- v0.1.1 候选 NSIS/ZIP 已生成并完成静态核验：NSIS `6,921,712` 字节，ZIP `9,182,634` 字节；资产 SHA-256 已记录在发布说明；Release EXE 版本信息为 `0.1.1`，PE subsystem 为 GUI（2）。
- 本轮自动门禁已通过：`pnpm check`（64 个测试文件、409 个测试）、`cargo fmt --check`、`cargo test --locked`（298 个测试）、`cargo clippy --all-targets --all-features --locked -- -D warnings`；OCR 打包 fixture 测试通过，发布/预览 PowerShell 脚本 AST 检查通过。
- 桌面验收补充：Release 读取 `%APPDATA%\\io.github.kystudy.desktop` 属于预期行为；此前执行 `restore-release-workspace.ps1` 后，原开发数据被恢复到该正式目录，因此同一 Windows 用户直接启动安装版会看到个人数据。干净首启必须使用 `scripts/start-clean-release-preview.ps1` 的隔离 AppData，或在备份确认后执行开发工作区分离脚本。
- 已按项目负责人要求恢复双工作区目标状态：当前数据位于 `%APPDATA%\\io.github.kystudy.desktop-dev`（数据库约 10.3 MiB），正式目录 `%APPDATA%\\io.github.kystudy.desktop` 当前不存在，正式版下次启动将初始化空白工作区；最新 Debug EXE 已重新构建到 `src-tauri/target/debug/kystudy.exe`。
- 已修复题库统计不同步：科目数现在包含刚创建但尚未关联题目分段的科目；创建科目或练习册后会重新读取后端快照，页面统计不再停留在 0。
- 题库主页新增分类概览，空科目和空练习册创建后也会实时显示；科目和练习册支持确认后软删除/归档，已有题目与学习记录保留但从活动题库隐藏。
- 新增 `archive_workbook_category` 后端命令，并让已归档科目的题目索引不再出现在活动题库快照中；相关 Rust 归档测试已通过。
- 分类概览改为可折叠大卡片；每个科目和练习册行末统一使用“…”更多菜单，菜单内提供重命名和删除；重命名会同步更新题库与相关选择器。
- 本轮完整门禁通过：`pnpm check`（64 个测试文件、409 个测试）、Rust `cargo test --locked`（302 个测试）、`cargo fmt --check`、Clippy 与 CSS 审计；已重新生成 `src-tauri/target/debug/kystudy.exe` 和 `src-tauri/target/release/kystudy.exe`，仍未创建 tag 或 GitHub Release。
- 修复练习册归档后的名称占用问题：归档记录写入内部墓碑名称，原名称可立即创建新的活动练习册；同时兼容旧版本已归档记录，新增两项回归测试，Rust 全量测试更新为 304 个通过。
- 已按最新验收版本重新生成 v0.1.1 NSIS 安装包、更新签名文件与 Windows x64 便携 ZIP；文件大小和 SHA-256 已同步到 `docs/V0_1_1_RELEASE_NOTES.md`，尚未创建 tag 或 GitHub Release。
- 发布前新增设置页“关于”与签名更新能力：更新端点指向 GitHub `latest.json`，Debug 构建明确禁用检查；发布工作流使用 Tauri updater 签名密钥生成更新资产，密钥只允许配置在 GitHub Actions Secret 中。

## 发布前必须完成

1. 收敛剩余用户反馈和界面/交互整改；
2. 重新运行前端和 Rust 全部质量门禁；
3. 构建 NSIS 安装包和 ZIP 便携版；
4. 在干净环境安装并确认不再出现命令行窗口；
5. 复核版本号、变更记录、校验和、许可证和 Release 说明；
6. 用户确认后再创建 `v0.1.1` tag、GitHub Release 和发布资产。

在上述步骤完成前，不要创建 v0.1.1 tag，也不要修改或替换 v0.1.0 的公开资产。
