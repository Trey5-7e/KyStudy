# TV-03 Blob 文件库实验

这是 KyStudy 的可丢弃 Rust 技术实验，用来验证大文件流式导入、内容寻址、去重、取消、异常退出恢复、完整性检查和工作区备份恢复。

实验不会解析 PDF，也不会向前端暴露任意路径。文件必须先由 Rust 边界转换为 `AuthorizedSource`，Blob 的正式路径只由 SHA-256 生成。

## 自动验证

```powershell
cargo fmt --check --manifest-path experiments/tv-03-blob-store/Cargo.toml
cargo test --locked --manifest-path experiments/tv-03-blob-store/Cargo.toml
cargo clippy --all-targets --all-features --locked --manifest-path experiments/tv-03-blob-store/Cargo.toml -- -D warnings
```

## 大文件测量

```powershell
$env:KYSTUDY_TV03_BENCH_ROOT = 'F:\DevTools\tmp'
cargo run --release --locked --manifest-path experiments/tv-03-blob-store/Cargo.toml --bin tv03-benchmark
```

10 MB、300 MB 和 1 GB 样本由程序在 F 盘临时目录流式生成，测量完成后自动删除，不进入仓库。
