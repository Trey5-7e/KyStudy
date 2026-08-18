# KyStudy 精简开发流程

本流程用于减少重复文件读取、重复测试和无效上下文，同时保留最终 Release 的完整证据。它从 R35 开始作为默认开发方式。

## 1. 一次定位

先用窄查询确定改动边界：

```powershell
rg --files src src-tauri | rg "QuestionBank|question_bank"
rg -n "目标符号或文案" src\features\workbook src-tauri\src
```

只读取实现文件、相邻测试和直接契约。大文件按相关行段读取；修改后查看 diff 或修改行段，不重新整文件读取。已经在本轮确认的事实不重复搜索。

## 2. 小步实现与目标验证

前端改动把实际修改文件传给统一脚本：

```powershell
pnpm check:target -- src/features/workbook/QuestionBankPanel.tsx src/features/workbook/questionBankModel.ts
```

脚本按文件类型执行：

- 所有目标文件：Prettier；
- JavaScript/TypeScript：ESLint；
- TypeScript：一次 typecheck；
- 测试文件：直接运行该测试；
- 非测试 TypeScript：运行 Vitest related；无关联测试时正常通过。

纯 Markdown 或 CSS 改动不会触发 typecheck 和 Vitest。需要只跑关联测试时也可直接使用：

```powershell
pnpm exec vitest related --run --passWithNoTests src/features/workbook/questionBankModel.ts
```

维护大型样式表时先运行只读审计，避免人工遍历全部 CSS：

```powershell
pnpm audit:css
```

该命令按源码 class token 和模板字符串动态前缀识别引用，默认只输出前 40 个零引用候选和前 20 个多选择器 class，避免把长报告灌入上下文；需要完整列表时显式追加 `--all`。结果只用于缩小审查范围；第三方组件 DOM 仍需人工确认，脚本不会自动删除。

前端 UI 改动还必须遵守 [Codex 内置浏览器 UI 自检闭环](CODEX_IN_APP_BROWSER_UI_WORKFLOW.md)：先明确布局和状态，再实现，使用 Codex 内置浏览器渲染多个视口和状态，修复发现的问题后再次渲染。浏览器预览只证明前端布局与交互，不替代真实桌面数据和 Tauri 能力的验收。

Rust 改动优先运行模块级验证：

```powershell
cargo check --locked --manifest-path src-tauri\Cargo.toml --lib
cargo test --locked --manifest-path src-tauri\Cargo.toml module_name::tests --lib
cargo clippy --locked --manifest-path src-tauri\Cargo.toml --lib --tests -- -D warnings
```

只有涉及迁移、事务或跨层契约时才扩大到对应集成测试。不要在每个小修复后运行完整 Rust 测试或 Tauri build。

## 3. 审查边界

实现完成后只做一次交叉审查：

- 审查者读取 diff、调用方和测试，不重复实现者的仓库探索；
- 问题按 P0–P2 报告，包含文件和最小修复建议；
- 修复后仅重跑受影响的目标检查；
- 没有新代码或新证据时，不再进行第二轮同范围审计。

## 4. 唯一完整门禁

批次准备交付后，严格按顺序各执行一次：

```powershell
pnpm check
cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri\Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings
pnpm tauri build --no-bundle
```

任一命令失败就停止。修改失败原因后，重新开始的范围由失败影响决定；不得只为获得更好日志无修改重跑。Release 构建成功后只读检查产物和残留进程，不自动启动 EXE。

## 5. Token 与文件 I/O 预算

- 进度消息只在范围确认、发现阻塞、实现完成、门禁完成时发送。
- 工具输出先用路径、行号和短摘要过滤；避免输出完整日志、完整 Git 状态或大文件全文。
- 同一批次只维护一个简短计划；完成项不反复复述。
- 普通维护不新增逐轮长验收文档。只有用户可见流程、数据语义、迁移或 Release 边界变化时才新增验收文档。
- 最终报告只包含结果、关键验证、产物和需要用户执行的验收。

## 6. R35 落地结果

R35 新增根目录 `AGENTS.md`、`pnpm check:target` 和本文档。后续批次以目标验证作为开发循环，以一次完整门禁作为交付证据。

本次验证覆盖：

- 文档、JSON 与脚本混合目标：Prettier 和脚本 ESLint 通过；
- TypeScript 源文件：Prettier、ESLint、typecheck、Vitest related 通过（1 file / 2 tests）；
- TypeScript 测试文件：Prettier、ESLint、typecheck、指定 Vitest 通过（1 file / 2 tests）；
- 无效路径和空参数由脚本在执行检查前拒绝。

R35 没有修改应用运行时代码、Rust、数据库或 Tauri 配置。R34 完整 Release 门禁刚刚通过，因此本轮不重复执行完整 Rust 测试和 Tauri build；这是本流程减少无效工作的第一个实际应用。
