# R41 今日考试倒计时与规划上下文边界验收

R41 补回“今日”页最近考试倒计时，并把规划对话上下文的资料资格校验下沉到 SQLite 查询边界。两项改动分别关闭首屏信息缺口与外发资料范围仅依赖前端状态的问题。

状态：`accepted`（2026-08-10 用户桌面验收通过）

## 1. 用户与数据契约

- “今日”与周期计划、错题并行读取有效个人计划，展示最近且未过期的考试名称、日期和剩余天数；考试当天显示“今天考试”。
- 倒计时卡片提供“设置考试”或“编辑考试”快捷操作，在统一窗口内维护考试名称和日期；没有有效计划时，保存会创建并启用一份最小考试计划。
- 考试信息读取失败只影响倒计时卡片，不阻断今日计划或错题入口。
- 倒计时按工作区时区生成的本地日期计算，不经过浏览器本地时区换日。
- 规划对话只解析未回收且角色仍为 `planning` 的资料片段；`reference`、`workbook` 和已回收资料返回上下文不存在。
- 资料资格不额外限制为 PDF，保留 PRD 对图片和其他规划资料的扩展边界。

## 2. 定向验证

- 前端定向门禁：`pnpm check:target -- src/features/today/TodayOverviewPanel.tsx src/features/today/todayCountdownModel.ts src/features/today/todayCountdownModel.test.ts`
  - 6 项测试通过；Prettier、ESLint 和 TypeScript 通过。
  - 覆盖最近考试、非法或过期日期、非有效计划、考试当天、日期差、考试接口失败隔离和快捷编辑目标选择。
- Rust 定向门禁：
  - `cargo check --locked --manifest-path src-tauri/Cargo.toml --lib`
  - `cargo test --locked --manifest-path src-tauri/Cargo.toml infrastructure::sqlite_planning_chat::tests --lib`
  - `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`
  - 规划对话模块 4 项测试通过，格式与库检查通过。

## 3. 完整门禁

- 前端：`pnpm check` 通过；42 个测试文件、261 项测试通过，Prettier、ESLint、TypeScript 与生产构建通过。
- Rust：`cargo fmt --all -- --check`、`cargo test --locked`（248 项测试）与 `cargo clippy --locked --all-targets -- -D warnings` 通过。
- Tauri：`pnpm tauri build --no-bundle` 通过，产物为 `F:/develop/KyStudy/src-tauri/target/release/kystudy.exe`。
- 未启动 Release EXE，也未代替用户执行桌面验收。

## 4. 桌面验收点

1. 在“今日”的考试倒计时卡片点击“设置考试”，确认窗口可填写考试名称和未来日期；保存后卡片立即显示名称、日期和剩余天数。
2. 再次点击“编辑考试”，确认窗口回填当前信息；修改后保存，原计划的其他内容保持不变。
3. 把考试日期设置为当天，确认倒计时显示“今天考试”；过期、草稿或已归档计划不显示为待考考试。
4. 在周期计划和错题正常可用时模拟个人计划读取失败，确认两个核心卡片仍可使用，倒计时卡片显示错误且快捷按钮改为“重新读取”。
5. 将规划资料改为“参考资料”或“习题册”，或移入回收站后，确认旧选择不能继续作为规划对话上下文发送。

## 5. 用户桌面验收结果（2026-08-10）

用户于 2026-08-10 在 Release WebView 中完成上述桌面验收点并确认通过。该结果补充人工验收证据；第 2、3 节的定向与完整自动门禁记录保持原样。
