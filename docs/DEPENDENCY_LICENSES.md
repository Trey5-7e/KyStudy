# KyStudy 依赖许可证审计

| 项目         | 内容                                                  |
| ------------ | ----------------------------------------------------- |
| 审计日期     | 2026-07-22                                            |
| 对应依赖快照 | `pnpm-lock.yaml`、`src-tauri/Cargo.lock`              |
| 状态         | M8 直接依赖已审计；正式二进制发布清单待发布里程碑生成 |

本文记录 M1-014 时的依赖许可证快照和复核方法。它不是法律意见，也不替代依赖包自带的完整许可证文本。项目自身的许可证由根目录 `LICENSE` 决定；在该文件落地前，本文不会对 KyStudy 源码授予任何权利。

## 生产前端依赖

`pnpm licenses list --prod --json` 根据当前锁文件得到以下会进入前端生产依赖图的包：

| 包                | 锁定版本 | SPDX 许可证         |
| ----------------- | -------- | ------------------- |
| `@tauri-apps/api` | 2.11.1   | `Apache-2.0 OR MIT` |
| `pdfjs-dist`      | 6.1.200  | `Apache-2.0`        |
| `react`           | 19.2.7   | `MIT`               |
| `react-dom`       | 19.2.7   | `MIT`               |
| `scheduler`       | 0.27.0   | `MIT`               |

`pdfjs-dist` 的生产依赖元数据还包含 `@napi-rs/canvas` 及 Windows 平台包（MIT），用于 Node 环境能力；Vite 浏览器产物的 M3 构建只生成 PDF.js 显示层与 Worker 独立 chunk，未把 Node 原生 Canvas 包打入 WebView 资源。

完整 Node 开发依赖图还包含 Apache-2.0、BSD、ISC、MIT、MPL-2.0、CC-BY-4.0、BlueOak-1.0.0 等许可证。它们主要用于编译、Lint 和测试，不应因为出现在开发依赖图中就默认被打入最终安装包。

## Rust 直接依赖

下表版本来自 `cargo metadata --locked` 的实际解析结果，而不是 `Cargo.toml` 的版本范围：

| 包                    | 锁定版本 | 用途   | SPDX 许可证         |
| --------------------- | -------- | ------ | ------------------- |
| `tauri-build`         | 2.6.3    | 构建   | `Apache-2.0 OR MIT` |
| `fs4`                 | 1.1.0    | 运行时 | `MIT OR Apache-2.0` |
| `keyring`             | 4.1.5    | 运行时 | `MIT OR Apache-2.0` |
| `reqwest`             | 0.13.4   | 运行时 | `MIT OR Apache-2.0` |
| `rusqlite`            | 0.40.1   | 运行时 | `MIT`               |
| `quick-xml`           | 0.41.0   | 运行时 | `MIT`               |
| `serde`               | 1.0.228  | 运行时 | `MIT OR Apache-2.0` |
| `serde_json`          | 1.0.150  | 运行时 | `MIT OR Apache-2.0` |
| `sha2`                | 0.10.9   | 运行时 | `MIT OR Apache-2.0` |
| `tauri`               | 2.11.5   | 运行时 | `Apache-2.0 OR MIT` |
| `tauri-plugin-dialog` | 2.7.1    | 运行时 | `Apache-2.0 OR MIT` |
| `tempfile`            | 3.27.0   | 运行时 | `MIT OR Apache-2.0` |
| `thiserror`           | 2.0.18   | 运行时 | `MIT OR Apache-2.0` |
| `uuid`                | 1.24.0   | 运行时 | `Apache-2.0 OR MIT` |

Cargo 全目标解析图包含 535 个非工作区包，当前没有缺失许可证元数据的包。解析图包含不同操作系统的条件依赖，不能直接当作 Windows 二进制的实际分发清单。

## 发布边界

M1 只生成内部验收用的未签名 EXE，不发布正式安装包或 GitHub Release。进入正式分发前必须：

1. 以实际 Windows Release 目标生成精确的第三方组件与许可证文本；
2. 区分编译工具、未链接的条件依赖和实际进入二进制/前端资源的依赖；
3. 保留依赖要求的版权、归属和 NOTICE 内容；
4. 单独复核 MPL-2.0、CC-BY-4.0 等具有额外条件的依赖是否进入分发产物；
5. 把许可证清单随安装包提供，并在“关于”或文档入口中可访问；
6. 依赖或锁文件变化后重新执行审计。

## 复核命令

```powershell
pnpm licenses list --prod --json
pnpm licenses list --json
cargo metadata --locked --format-version 1 --manifest-path src-tauri\Cargo.toml
```

新增依赖时，Pull Request 必须说明用途、锁定版本、许可证、是否进入分发产物及可替代方案。GPL、AGPL、SSPL、来源不明或缺失许可证元数据的依赖不能未经单独决策直接引入。
