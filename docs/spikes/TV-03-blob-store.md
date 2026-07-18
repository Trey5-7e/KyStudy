# TV-03：Blob 文件库与工作区备份

| 项目     | 内容                                  |
| -------- | ------------------------------------- |
| 状态     | completed                             |
| 结论     | passed                                |
| 日期     | 2026-07-18                            |
| 负责人   | KyStudy 项目                          |
| 关联 ADR | [ADR-004](../adr/004-file-storage.md) |

## 要回答的问题

在 Windows 本地工作区中，KyStudy 能否用固定内存流式导入 1 GB 文件，并在重复导入、取消、空间不足、进程异常退出、数据库提交失败、Blob 损坏和备份损坏时保持“正式文件、SQLite 记录与可恢复 Job”一致？

## 不在范围内

- 不实现 PDF 解析、OCR、AI 上传、缩略图、全文索引或云同步；
- 不实现压缩包和加密备份，TV-03 使用版本化目录格式；
- 不实现多工作区并发写入或通用后台线程池；
- 不把实验代码直接复制到正式工程；
- 不主动操控桌面应用，验证全部由 Rust 自动测试和 release 测量完成。

## 环境

| 项目       | 值                                                    |
| ---------- | ----------------------------------------------------- |
| 操作系统   | Windows 11 专业版 10.0.26100                          |
| CPU / 内存 | AMD Ryzen 7 5800H，16 逻辑处理器；15.86 GiB 内存      |
| Rust       | 1.97.1                                                |
| SQLite     | `rusqlite 0.40.1 + bundled + backup`，沿用 TV-02 结论 |
| 文件能力   | Rust `std::fs`、`tempfile 3.27.0`、`fs4 1.1.0`        |
| 构建模式   | 自动测试为 debug；大文件测量为 release                |

## 样本

- 小型行为测试使用程序生成的 1–12 MiB 文件；
- release 测量使用程序生成的 10 MiB、300 MiB 和 1 GiB 文件；
- 内容采用确定性重复块，不含版权资料和个人数据；
- 样本、工作区、备份和恢复目录均位于 F 盘临时目录并在正常结束时删除；
- 损坏样本通过修改临时 Blob 或备份副本生成。

## 候选方案

1. 同盘 staging + SHA-256 内容寻址 + SQLite 元数据 + 持久化恢复 Job；
2. 直接把原文件路径登记到数据库，不复制文件；
3. 把文件内容保存为 SQLite BLOB；
4. 每次导入使用随机文件名，数据库承担唯一定位。

优先验证方案 1。方案 2 无法保证原文件长期存在，方案 3 会放大大文件数据库与备份压力，方案 4 不利于物理去重和完整性检查。

## 通过标准

- [x] 10 MiB、300 MiB 和 1 GiB 文件均使用固定 1 MiB 缓冲区流式导入；
- [x] 导入过程同时计算 SHA-256，正式路径只由哈希生成且数据库只保存相对键；
- [x] 同一内容重复导入只产生一个正式 Blob，但可以创建多个 ResourceDocument；
- [x] 导入前检查可用空间并预分配，空间不足返回稳定错误且无 Job/临时文件；
- [x] 取消或普通 I/O 失败不留下正式 Blob、正式业务记录或 staging 残片；
- [x] 流式导入中异常退出后，启动恢复能清理 staging 并标记 Job；
- [x] 文件已提交但数据库事务失败时，`committing` Job 能在重启后继续完成；
- [x] 缺失和损坏 Blob 可被扫描、分类并回写完整性状态；
- [x] 工作区锁阻止第二个写进程同时打开同一工作区；
- [x] 备份包含 SQLite 一致快照、全部正式 Blob、Manifest、格式版本和 schema 版本；
- [x] staging、缓存、日志、锁文件和密钥不进入备份；
- [x] 恢复先在临时目录校验数据库、Manifest、大小和 SHA-256，再切换到不存在的新目录；
- [x] 恢复到不同绝对路径后可以通过 ResourceDocument 打开相同内容；
- [x] 损坏或路径异常的备份不会创建/覆盖正式恢复目标；
- [x] 公开 API 不提供任意 storage key、任意目标路径写入或任意 SQL；
- [x] `fmt`、测试和全目标/全特性 Clippy 零警告通过。

## 实验步骤

1. 创建独立 Rust crate 和最小 SQLite schema；
2. 实现工作区锁、授权来源、磁盘空间检查和固定缓冲区复制；
3. 实现 staging、哈希路径、无覆盖提交、Blob/Document 去重事务；
4. 持久化 `running` / `committing` Job 并实现启动恢复；
5. 实现缺失、损坏和未登记正式文件扫描；
6. 实现版本化目录备份、Manifest 和临时目录恢复；
7. 增加取消、空间不足、数据库失败、异常退出和损坏测试；
8. 在 release 下生成并导入 10 MiB、300 MiB、1 GiB 样本；
9. 运行质量门槛并回填 ADR 与路线图。

## 结果

### 测量数据

| 场景               |     用时 | 结果                                                  |
| ------------------ | -------: | ----------------------------------------------------- |
| 10 MiB 首次导入    |    31 ms | 312.97 MiB/s，创建 1 个 Blob 和 1 个 ResourceDocument |
| 300 MiB 首次导入   |   488 ms | 613.52 MiB/s，固定缓冲区流式复制与哈希                |
| 1 GiB 首次导入     | 1,352 ms | 757.11 MiB/s，未整文件载入内存                        |
| 1 GiB 重复导入     | 2,161 ms | 完整校验后复用原 Blob，只新增 ResourceDocument        |
| 完整工作区备份     | 3,916 ms | 生成 1,398,846,402 bytes 的版本化目录备份             |
| 恢复到不同绝对路径 | 3,874 ms | 校验后恢复，ResourceDocument 可打开原内容             |

测量进程峰值工作集为 7.46 MiB，峰值分页内存为 2.12 MiB；结果表明 1 GiB 样本没有导致内存随文件大小线性增长。以上是本机单次 release 实测，用于确认数量级，不作为跨设备性能承诺。

复现命令：

```powershell
$env:KYSTUDY_TV03_BENCH_ROOT = 'F:\DevTools\tmp'
cargo run --release --locked --manifest-path experiments/tv-03-blob-store/Cargo.toml --bin tv03-benchmark
```

### 成功样本

- 5 个单元测试验证 storage key、路径穿越、固定缓冲区哈希、空间不足稳定错误和 `committing` Job 恢复；
- 11 个跨模块测试验证去重、取消、来源变化、工作区锁、进程异常退出、完整性扫描、完整备份恢复和授权边界；
- 同内容导入两次后只有一个物理 Blob，同时存在两个 ResourceDocument；
- 完整备份不含 staging 与锁文件，恢复到不同绝对路径后读取的内容、大小和哈希一致。

### 失败与边界样本

- 空间不足在创建 Job 和 staging 前返回稳定错误；取消、来源大小变化和普通失败均清理 staging，且不产生正式业务记录；
- 独立崩溃进程在复制中强制退出后，重启恢复会清理残片并把 `running` Job 标为中断；
- 模拟文件已移动但 SQLite 事务失败后，`committing` Job 可在重启时继续提交；
- 缺失 Blob 与内容损坏 Blob 会被分别识别并回写完整性状态，不自动删除用户数据；
- 损坏的备份 Blob、Manifest 路径穿越和已存在的恢复目标均在正式切换前被拒绝；
- 工作区内部路径不能被重新授权为外部导入来源，第二个写进程也不能同时取得工作区锁。

### 恢复与降级

- `running` Job 表示 staging 尚未形成可信完整文件，启动后清理并标记中断；
- `committing` Job 已记录哈希、大小和相对 storage key，可以从 staging 或正式路径恢复提交；
- 完整性异常不自动删除用户文件，只更新状态并返回诊断；
- 恢复目标必须不存在，失败时临时恢复目录自动清理。

## 结论

`passed`。16 项通过标准全部满足；5 个单元测试、11 个跨模块测试、`cargo fmt --check`、`cargo test --locked` 和全目标/全特性 Clippy 零警告均通过。

本机 release 实测证明 1 GiB 文件可以在 7.46 MiB 峰值工作集下完成流式导入，且内容寻址去重、异常恢复、完整性扫描与可移植完整备份可以共同工作。该结论验证的是存储协议和数量级，不代表正式产品实现已经完成。

## 建议决策

接受“同盘 staging → SHA-256 内容寻址 Blob → SQLite 引用”的方案，并用持久化 `running` / `committing` Job 解决文件系统与数据库无法共享事务的问题。完整备份采用“Manifest + SQLite Online Backup 一致快照 + Blob 树”的版本化目录格式；压缩、分卷和加密作为未来外层格式，不改变内部哈希和相对路径。ADR-004 据此改为 `accepted`。

## 后续行动

- [x] 完成实验实现与行为测试；
- [x] 完成 10 MiB、300 MiB、1 GiB release 测量；
- [x] 回填备份恢复、峰值内存边界和失败样本；
- [x] 根据结论接受 ADR-004；
- [x] TV-04 使用已验证 Blob 打开接口加载 PDF。

## 参考资料

- [Rust `std::fs`](https://doc.rust-lang.org/std/fs/)
- [Rust `fs::rename`](https://doc.rust-lang.org/std/fs/fn.rename.html)
- [tempfile](https://docs.rs/tempfile/3.27.0/tempfile/)
- [fs4](https://github.com/al8n/fs4)
- [SQLite Online Backup API](https://www.sqlite.org/backup.html)
