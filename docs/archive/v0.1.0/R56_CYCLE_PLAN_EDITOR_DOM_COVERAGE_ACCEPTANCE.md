# R56 周期计划编辑器 DOM 回归覆盖

## 批次结论

R56 补齐 R42 留下的周期计划窗口覆盖缺口。新增轻量 DOM 回归测试，不引入浏览器测试依赖，也不改变周期计划业务逻辑、数据库或 Tauri 命令。

## 覆盖范围

- 无效草稿：排程预览提示信息，确认保存按钮保持禁用；
- 有效草稿：渲染预计完成信息和每个单位的日期范围，确认按钮可用；
- 休息日：预览计算继续接收计划页的休息日设置；
- `rhythm` / `even`：两种排程模式都保持可选并进入同一预览区域；
- 编辑器与窗口契约：dirty 状态交给 `EditorDialog`，只有保存成功后才关闭窗口。

## 实现文件

- `src/features/planning/CyclePlanEditor.test.tsx`
  - 使用 `renderToStaticMarkup` 验证编辑器 DOM 文案、disabled 状态、日期列表和模式选择；
- `src/features/planning/CyclePlanPanel.test.ts`
  - 补充编辑器确认按钮、保存成功关闭和 dirty 弃置确认的源码契约断言。

## 自动化验证

```powershell
pnpm check:target -- src/features/planning/CyclePlanPanel.test.ts src/features/planning/CyclePlanEditor.test.tsx
```

结果：Prettier、ESLint、TypeScript 和 2 个相关 Vitest 文件通过，共 23 项测试通过。

本批次不修改 React 运行逻辑、Rust、迁移或数据结构；桌面验收场景沿用 R42 第 6 节，R56 不宣称替代用户的桌面验收。
