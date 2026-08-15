# R53 OCR 在线下载发布配置批次

## 批次结论

R53 将 R51 的在线下载地址和 SHA-256 从源码常量提升为 Release 构建时配置。默认构建仍没有在线资产，因此在线下载继续显示“暂未发布”；只有同时提供合法 HTTPS URL 和 64 位十六进制 SHA-256 时，构建才会启用下载入口。

## 实现范围

- 使用 `KYSTUDY_OCR_DOWNLOAD_URL` 和 `KYSTUDY_OCR_DOWNLOAD_SHA256` 两个构建环境变量。
- Cargo 构建脚本监听这两个变量变化，避免配置变更后复用错误产物。
- URL 必须解析成功且 scheme 为 `https`；摘要必须是 64 位 ASCII 十六进制。
- 下载客户端增加 10 秒连接超时和 30 秒整体请求超时，仍保留 512 MiB、重定向、校验和安全解压限制。
- R52 打包脚本支持可选 `-DownloadUrl`，并拒绝非 HTTPS 地址。

## 构建示例

```powershell
$env:KYSTUDY_OCR_DOWNLOAD_URL = 'https://downloads.example.com/kystudy-ocr-worker-v0.1.0.zip'
$env:KYSTUDY_OCR_DOWNLOAD_SHA256 = '<64 位 SHA-256>'
pnpm tauri build --no-bundle
```

未配置变量时不要填写占位地址；应用会安全地保持在线下载禁用。

## 验收建议

1. 默认构建：确认在线资产状态为不可用，本地安装仍可用。
2. 使用测试 HTTPS URL 和合法摘要构建：确认下载入口启用；不要在桌面验收中使用未发布或不可信资产。
3. 使用 HTTP、非法 URL、短摘要或非十六进制摘要构建：确认入口保持禁用。
4. 真实资产发布后，重新构建最新 Release，再验收下载进度、超时、取消、校验失败和本地组件保留。

## 自动验证

- OCR Worker 配置验证单元测试：通过。
- OCR 打包脚本 fixture 与 HTTPS 参数拒绝测试：通过。
- R51/R52 全量前端与 Rust 门禁继续作为交付前置条件。

本批不发布资产、不启动 EXE，不替代用户执行的桌面验收。

## 真实资产配置与构建记录（2026-08-15）

OCR 资产已公开发布后，使用以下构建时环境变量生成在线下载版本：

```powershell
$env:KYSTUDY_OCR_DOWNLOAD_URL = 'https://github.com/Trey5-7e/KyStudy/releases/download/ocr-v0.1.0/kystudy-ocr-worker-v0.1.0.zip'
$env:KYSTUDY_OCR_DOWNLOAD_SHA256 = 'bb5a3e16a898713adde85717f4debe8cfbdf22ca10eb632752368f200513b01'
pnpm tauri build --no-bundle
Remove-Item Env:KYSTUDY_OCR_DOWNLOAD_URL, Env:KYSTUDY_OCR_DOWNLOAD_SHA256
```

公开 URL 已通过不带 GitHub 登录态的 HTTP 头请求验证可返回 `200 OK` 和 `116300551` 字节。最终 EXE 为 `src-tauri/target/release/kystudy.exe`，大小 `26,371,584` 字节，SHA-256 `876EB2551647DAAA4049AF2AFE171531175B0C08954972FE839ECED87B81D8A6`；构建后未启动桌面程序。
