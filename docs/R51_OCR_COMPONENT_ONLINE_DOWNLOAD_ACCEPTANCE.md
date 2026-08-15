# R51 OCR 组件在线下载批次

## 当前结论

R51 已接入在线下载的安全协议与界面入口，同时保留本地文件夹安装作为兜底。当前版本不会访问未发布或不可信的地址：仓库尚未发布包含固定 SHA-256 摘要的 OCR Release 资产，因此界面会显示“在线下载资产尚未发布”，在线按钮保持禁用。

这不是桌面验收通过声明；桌面验收由用户执行。当前批次的可验收范围是协议、错误边界和本地兜底不受影响。

## 已实现范围

- 只允许 HTTPS 下载，并限制重定向次数。
- 下载压缩包限制为 512 MiB；响应没有 `Content-Length` 时仍按实际读取量限制。
- 下载完成后执行 SHA-256 校验，摘要不匹配时不安装、不替换已有组件。
- Zip 解压拒绝路径穿越、Unix 软链接和超过 1 GiB 的解压总量。
- 压缩包必须包含 `kystudy-ocr-worker/` 根目录及现有必需文件；解压目录位于应用缓存目录，安装后清理。
- 安装继续复用现有临时目录 + 重命名的原子替换流程；失败时保留旧组件。
- 下载复用 OCR 操作协调器，与识别互斥；支持进度事件和取消。
- 前端只接收状态、进度和稳定错误码，不暴露本地路径或第三方异常。

## 发布前置条件

发布在线资产前必须补齐 `src-tauri/src/infrastructure/ocr_worker.rs` 中的：

```rust
const OCR_DOWNLOAD_URL: Option<&str> = Some("https://...");
const OCR_DOWNLOAD_SHA256: Option<&str> = Some("64 位十六进制 SHA-256");
```

资产应为 ZIP，根目录固定为 `kystudy-ocr-worker/`，并与当前 `REQUIRED_COMPONENT_FILES` 完全匹配。发布后需要重新构建 Release，并在不联网环境继续验证本地安装、移除和 PDF 阅读。

## 验收建议

1. 未发布资产时打开“题库 → OCR 组件”：确认在线按钮禁用，提示本地安装仍可用。
2. 使用本地完整组件安装、重新检测、移除；确认 OCR 识别和 PDF 阅读不受影响。
3. 资产发布后，重新编译最新 Release；在线下载时确认进度、取消、失败重试和校验失败均不替换旧组件。
4. 断网或代理阻断时，确认显示稳定错误，不影响手动安装入口。

## 机器验证记录

- `cargo check --locked --manifest-path src-tauri/Cargo.toml`：通过。
- OCR Rust 单元测试：通过（组件安装与 OCR 页级边界测试）。
- `pnpm exec vitest run src/shared/tauri/ocrClient.test.ts`：9 项通过。
- `pnpm exec tsc --noEmit`：通过。
- 前端 ESLint（本批修改文件）：通过。

完整项目门禁与最新 Release 构建应在本批改动冻结后按 `docs/DEVELOPMENT_WORKFLOW.md` 执行；不要把当前旧 EXE 当作 R51 验收版本。
