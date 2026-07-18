# 架构决策记录（ADR）

ADR 用于记录已经做出的重要技术决策，以及当时的上下文、候选方案和后果。它不替代 PRD、技术验证报告或代码注释。

## 编号规则

- 文件名格式：`NNN-short-title.md`；
- 编号从 `001` 开始，创建后不复用；
- 已被替代的 ADR 不删除，状态改为 `superseded` 并链接新 ADR；
- 讨论中、尚未获得证据的选择保持 `proposed`，不能写成既定架构。

## 状态

- `proposed`：候选决策，仍在验证；
- `accepted`：已接受并约束后续实现；
- `rejected`：明确不采用；
- `superseded`：已被后续 ADR 替代；
- `deprecated`：不再推荐，但尚未完全移除。

创建 ADR 时复制 [模板](000-template.md)，替换编号和标题。

## 当前记录

- [ADR-001：桌面运行时与前后端边界](001-desktop-runtime.md) — `proposed`
- [ADR-002：SQLite 驱动、迁移与 Repository 边界](002-sqlite-driver.md) — `accepted`
- [ADR-003：PDF.js 显示层、受控 RangeSource 与区域坐标](003-pdf-rendering.md) — `proposed`
- [ADR-004：Blob 文件存储、去重与备份格式](004-file-storage.md) — `accepted`
