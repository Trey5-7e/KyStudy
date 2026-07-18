# M1 完整备份与恢复副本

| 项目 | 内容 |
| --- | --- |
| 工作项 | M1-012 |
| 日期 | 2026-07-18 |
| 状态 | completed |
| 依据 | [ADR-004](adr/004-file-storage.md)、[TV-03](spikes/TV-03-blob-store.md) |

## 实现范围

- 完整备份采用版本化目录格式：`manifest.json`、SQLite Online Backup 一致快照和正式 `blobs/` 树；
- Manifest 记录格式版本、schema 版本、生产者、创建时间、工作区 ID、数据库哈希及全部 Blob 的 SHA-256、大小和相对 storage key；
- 数据库快照通过 application ID、schema 版本、迁移历史哈希、`quick_check` 和外键检查；
- 数据库与 Blob 均使用固定 1 MiB 堆缓冲区进行哈希或复制，目标文件预分配并在完成后同步；
- 备份和恢复在开始复制前检查目标磁盘空间，并保留 64 MiB 安全余量；
- 备份只复制数据库和已登记正式 Blob，不扫描复制整个工作区目录；
- 恢复先验证来源备份，再在目标父目录的临时兄弟目录重建并复验，最后通过一次目录重命名提交；
- 备份和恢复目标必须不存在，不覆盖任何既有目录；
- M1-012 恢复生成独立工作区副本，不替换当前默认工作区。

## 安全与并发边界

- Windows 原生目录选择器只在 Rust 后端返回路径，WebView 不传入也不接收绝对路径；
- Command DTO 只返回目录名称、Blob 数量、总大小和创建时间；
- Manifest 使用严格字段反序列化并限制为 16 MiB，storage key 必须与 SHA-256 内容寻址布局完全一致；
- 数据库快照以只读模式打开并设置 `trusted_schema=OFF`；
- 符号链接、路径穿越、损坏 Blob、Manifest/数据库不一致和未来格式版本均在正式提交前拒绝；
- staging、日志、缓存、锁文件、密钥和其他未管理文件不会进入备份；
- 导入、备份与恢复共享后端操作门，不会在导入提交中间产生不一致快照；
- 临时目录由 RAII 清理，重命名失败后也只清理本次创建的精确临时目标。

## 自动证据

- 18 个 TypeScript/Vitest 契约测试通过；
- 43 个 Rust 测试通过；
- 备份集成测试覆盖完整备份、跨绝对目录恢复、正式适配器重新打开、staging/未管理文件排除、损坏 Blob、Manifest 路径穿越、目标无覆盖、缺失正式 Blob 和无当前工作区恢复；
- Rust 与 TypeScript 两侧验证备份 DTO 不包含绝对路径或目标路径；
- Prettier、ESLint、TypeScript、production build、Rustfmt 和全目标/全特性 Clippy 零警告；
- Windows Tauri Release 构建成功。

Release EXE：

```text
F:\develop\KyStudy\src-tauri\target\release\kystudy.exe
大小：11,528,704 bytes
SHA-256：5512A77700998273034DE71D5AE3A4E973B008C56549A822E2CE9BB3FE8CF9C6
```

## 人工 Smoke

项目维护者已于 2026-07-18 使用上述正式 Windows Release 完成 M1-012 人工 Smoke，全部通过：

- 原生目录选择器可以正常打开和取消；
- 当前工作区成功创建完整备份并通过校验；
- 备份目录包含 Manifest、SQLite 数据库和正式 Blob，未包含 staging；
- 备份成功在另一个目标位置生成经过验证的独立恢复副本；
- 恢复操作未替换或改变当前工作区；
- 关闭并重启后当前工作区和资料正常恢复；
- UI 未显示绝对路径、数据库路径或 storage key。

M1-012 至此完成，工程进入 M1-013。

## 暂缓项

- 用恢复副本替换或切换当前工作区；
- 多工作区列表和激活流程；
- 压缩包、分卷、增量和加密备份；
- 自动备份计划、保留策略和旧备份清理；
- 云盘同步与远程备份。

这些能力不会改变当前内部目录格式，可在后续恢复体验、同步或安全里程碑叠加。
