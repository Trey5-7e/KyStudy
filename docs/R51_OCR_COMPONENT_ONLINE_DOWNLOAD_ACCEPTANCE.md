# R51 OCR 组件在线下载批次

## 当前结论

R51 已接入在线下载的安全协议与界面入口，同时保留本地文件夹安装作为兜底。v0.1.1 已发布包含固定 SHA-256 摘要的 OCR Release 资产，正式构建会将下载地址和摘要注入应用，在线按钮可用；本地安装仍可在离线或下载失败时使用。

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

## 发布配置

发布工作流在构建前生成 OCR ZIP，并通过以下环境变量注入正式构建：

```text
KYSTUDY_OCR_DOWNLOAD_URL=https://github.com/Trey5-7e/KyStudy/releases/download/<tag>/kystudy-ocr-worker-<tag>.zip
KYSTUDY_OCR_DOWNLOAD_SHA256=<64 位十六进制 SHA-256>
```

资产应为 ZIP，根目录固定为 `kystudy-ocr-worker/`，并与当前 `REQUIRED_COMPONENT_FILES` 完全匹配。v0.1.1 的正式资产已按该规则生成并上传；后续版本继续由发布工作流自动重建和上传。

## 验收建议

1. 打开“题库 → OCR 组件”：确认已发布资产时在线按钮可用，仍保留本地安装入口。
2. 使用本地完整组件安装、重新检测、移除；确认 OCR 识别和 PDF 阅读不受影响。
3. 在线下载时确认进度、取消、失败重试和校验失败均不替换旧组件。
4. 断网或代理阻断时，确认显示稳定错误，不影响手动安装入口。

## 机器验证记录

- `cargo check --locked --manifest-path src-tauri/Cargo.toml`：通过。
- OCR Rust 单元测试：通过（组件安装与 OCR 页级边界测试）。
- `pnpm exec vitest run src/shared/tauri/ocrClient.test.ts`：9 项通过。
- `pnpm exec tsc --noEmit`：通过。
- 前端 ESLint（本批修改文件）：通过。

v0.1.1 已完成完整发布工作流：OCR 组件构建、归档校验、Tauri 签名构建和 Release 资产上传均通过；桌面在线下载验收仍由用户执行。
