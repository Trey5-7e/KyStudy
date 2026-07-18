# M1 Blob 导入与任务恢复

| 项目 | 内容 |
| --- | --- |
| 工作项 | M1-011 |
| 日期 | 2026-07-18 |
| 状态 | completed |
| 依据 | [ADR-004](adr/004-file-storage.md)、[TV-03](spikes/TV-03-blob-store.md) |

## 实现范围

- v2 迁移新增 `blob`、`resource_document` 和 `processing_job`，既有 v1 工作区可以原地升级；
- 导入使用固定 1 MiB 堆缓冲区，文件正文不经过 IPC、JSON 或 Base64；
- Rust 原生文件选择器只接受本地文件路径，WebView 不传入也不接收来源路径；
- 流式计算 SHA-256，正式文件使用 `blobs/AB/CD/<SHA256>.blob` 内容寻址布局；
- 相同内容允许创建多条资料记录，但只保留一个物理 Blob；
- 导入先写同工作区 staging，完整写入和校验后再无覆盖提交；
- `processing_job` 持久化 `running → committing → succeeded/failed/canceled/interrupted`；
- 每写入最多 16 MiB 持久化一次进度，取消标志每个流式块检查一次；
- 启动时清理 `running` staging，并继续完成可验证的 `committing` Job；
- 最小资料库 UI 提供原生选择、进度、取消、稳定错误和资料列表。

## 安全与一致性边界

- Command DTO 不包含绝对路径、相对 storage key、原始文件名、SQL 或数据库行；
- Tauri capability 仍只有 `core:default`，前端没有 Dialog 或任意文件系统权限；
- 来源位于受管工作区内部时拒绝导入，受管路径经过固定格式校验；
- 已存在的正式 Blob 会重新校验大小与 SHA-256，不会被同名 staging 静默覆盖；
- 数据库提交失败时保留 `committing` Job，供下次启动重试，不把已落盘文件误标为普通失败；
- UI 只信任已知错误码，任意后端异常文本不会直接显示。

## 自动证据

- 14 个 TypeScript/Vitest 契约测试通过；
- 34 个 Rust 测试通过；
- Blob 集成测试覆盖成功导入、物理去重、取消清理、`running` 中断、`committing` 恢复、工作区内部来源拒绝、源长度变化和损坏 Blob 无覆盖；
- Rust 与 TypeScript 两侧均验证 Resource DTO 不包含路径、storage key 或原始文件名；
- Prettier、ESLint、TypeScript、production build、Rustfmt 和全目标/全特性 Clippy 零警告；
- Windows Tauri Release 构建成功。

Release EXE：

```text
F:\develop\KyStudy\src-tauri\target\release\kystudy.exe
大小：11,297,280 bytes
SHA-256：A4AAEB0761CC64E2A3A2F688FD44E9129803521D03D2DA970A04BDDFA9B2D944
```

## 人工 Smoke

项目维护者已于 2026-07-18 使用上述正式 Windows Release 完成 M1-011 人工 Smoke，全部通过：

- 既有工作区原地升级并显示数据库 Schema `v2`；
- Windows 原生文件选择器可以正常打开和取消；
- PDF 可以导入本地资料库，列表显示标题、类型、大小和 SHA-256 前缀；
- 关闭并重启后资料记录正常恢复；
- 相同内容重复导入正常，未产生文件冲突；
- 导入取消和任务结束状态符合预期；
- 界面未显示绝对路径、storage key、数据库路径或内部错误文本。

人工验收截图显示工作区时区 `Asia/Shanghai`、每日错题 `5 道`、Schema `v2`，以及已持久化的一条 PDF 资料记录。M1-011 至此完成，工程进入 M1-012。

## 暂缓项

- PDF 渲染、页数与文字层解析；
- OCR、题目区域识别、资料标签和搜索；
- 正式资料的全库完整性扫描与修复 UI；
- 删除、回收站和无引用 Blob 清理；
- 完整备份、Manifest 和跨目录恢复。

这些能力分别进入 M1-012、PDF/习题册里程碑或后续资料库迭代。
