# TV-02 SQLite 实验

这是 KyStudy 的可丢弃技术实验，用于验证 Rust 核心中的 SQLite 连接、迁移、事务、并发写入、完整性检查与备份恢复。

它不是正式应用，也没有向前端暴露 SQL 接口。公开 API 只表达工作区、任务、后台任务、备份和恢复等用例。

## 自动验证

```powershell
cargo fmt --check --manifest-path experiments/tv-02-sqlite/Cargo.toml
cargo test --locked --manifest-path experiments/tv-02-sqlite/Cargo.toml
cargo clippy --all-targets --all-features --locked --manifest-path experiments/tv-02-sqlite/Cargo.toml -- -D warnings
```

## 规模测量

```powershell
cargo run --release --locked --manifest-path experiments/tv-02-sqlite/Cargo.toml --bin tv02-benchmark
```

规模测量在系统临时目录创建并自动删除数据库，不访问真实用户数据。
