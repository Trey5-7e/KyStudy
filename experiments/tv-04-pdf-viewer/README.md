# TV-04 PDF 阅读与区域坐标实验

这是 KyStudy 的可丢弃 Tauri + React + PDF.js 技术实验。它验证：

- PDF.js 与 Worker 按需打包；
- 360 页合成 PDF 的 Range 加载、渲染、跳页、取消和内存数量级；
- PDF 归一化坐标在缩放与四种旋转下往返；
- Rust 自定义协议只接受 document ID 和严格单 Range；
- 协议通过 TV-03 `Workspace::open_document` 读取内容寻址 Blob。

## 自动验证

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --all-features --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
```

## 无头 Edge 测量

```powershell
$env:KYSTUDY_TV04_BENCH_ROOT = 'F:\DevTools\tmp'
pnpm benchmark
```

测量脚本启动本地 production preview 和无头 Edge，不操控用户桌面。结果写入 `output/browser-benchmark.json`，临时浏览器 profile 在结束后删除。
