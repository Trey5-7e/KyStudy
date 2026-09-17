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

前端 UI 改动建议遵循浏览器 UI 预览自检流程：先明确布局和状态，再实现，在浏览器中预览渲染多个视口和状态，修复发现的问题后再次验证。浏览器预览只证明前端布局与交互，不替代真实桌面数据和 Tauri 能力的验收。

Rust 改动优先运行模块级验证：

```powershell
cargo check --locked --manifest-path src-tauri\Cargo.toml --lib
cargo test --locked --manifest-path src-tauri\Cargo.toml module_name::tests --lib
cargo clippy --locked --manifest-path src-tauri\Cargo.toml --lib --tests -- -D warnings
```

只有涉及迁移、事务或跨层契约时才扩大到对应集成测试。不要在每个小修复后运行完整 Rust 测试或 Tauri build。

## 3. 审查边界

按改动风险审查 diff、调用方和测试。默认由当前 Agent 自查；仅在用户要求委派时使用独立审查者，不为例行修改强制启动第二个 Agent：

- 审查者读取 diff、调用方和测试，不重复实现者的仓库探索；
- 问题按 P0–P2 报告，包含文件和最小修复建议；
- 修复后仅重跑受影响的目标检查；
- 没有新代码或新证据时，不再进行第二轮同范围审计。

## 4. 发布与桌面交付门禁

仅在发布、跨层集成或交付新的桌面验收构建时执行以下完整门禁。纯文档、代理规则和技能元数据修改只需格式、引用和配置有效性检查；普通代码修复先执行受影响检查，不默认重编桌面程序。

完整门禁按以下顺序执行：

```powershell
pnpm check
cargo fmt --all --manifest-path src-tauri\Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri\Cargo.toml
cargo clippy --locked --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings
pnpm tauri build --no-bundle
```

门禁失败时暂停后续门禁，诊断并修复本次改动造成的问题，再重跑受影响检查；不要把第一次失败当作任务终点。对已有故障或环境限制报告证据，不擅自扩展修复范围。仅在代码、环境或诊断依据变化时重试。Release 构建成功后报告实际可执行文件的绝对路径和对应验收清单，不自动启动 EXE。

## 5. Git 提交与分支协作规范

- 写入前确认当前分支和工作区状态。目录名不代表分支。
- 保留已有改动。仅在用户要求或本任务明确授权时提交，使用 Conventional Commits，并只暂存本任务文件；不以“工作区必须干净”为理由提交无关代码。
- 长期功能适合独立分支，但不要为规范名称擅自切换分支或重置工作区。需要新分支时先确认任务范围。
- 跨工作区或分支同步须在请求范围内，先比较目标文件，只同步明确的设置或补丁；不连带合并业务代码、缓存、凭据或构建产物。

## 6. Token 与文件 I/O 预算

- 在范围确认、关键发现和验证完成时简短更新；长时间操作中说明进展，不输出逐命令流水账。
- 工具输出先用路径、行号和短摘要过滤；避免输出完整日志、完整 Git 状态或大文件全文。
- 同一批次只维护一个简短计划；完成项不反复复述。
- 普通维护不新增逐轮长验收文档。
- 最终报告只包含结果、关键验证、产物和需要用户执行的验收。
