# R57 周期计划 AI 预览边界回归

## 批次结论

R57 补齐周期计划 AI 辅助规划的模型级回归覆盖，确认旧预览不会跨输入变化继续执行，AI 草案数量和字段边界在进入编辑器前保持受控。本批次只增加测试，不改变外发预览、用户确认、执行调用或正式计划保存行为。

## 覆盖范围

- 当前表单、用户要求、引用资料或上一轮草案变化后，完整 prompt 指纹发生变化，旧预览不可继续确认；
- AI 返回草案最多保留 5 张；
- 草案数量、学习日和日期等字段在解析阶段执行既有边界校验，越界结果不会进入“采用这张草案”；
- 既有路径安全测试继续确认 prompt 不包含本地资源 ID、绝对路径或未选择的资料内容。

## 实现文件

- `src/features/planning/CyclePlanAiAssistant.test.ts`
  - 新增上一轮草案变化导致预览失效的测试；
  - 新增最多 5 张草案截断和越界数字拒绝测试。

## 自动化验证

```powershell
pnpm check:target -- src/features/planning/CyclePlanAiAssistant.test.ts
```

结果：Prettier、ESLint、TypeScript 和定向 Vitest 通过，1 个测试文件、14 项测试通过。

本批次不启动 Release EXE，也不代替用户执行桌面验收。桌面验收继续沿用 R40/R42 中的 AI 外发预览、取消、确认、离线 Provider 和正式计划保存步骤。
