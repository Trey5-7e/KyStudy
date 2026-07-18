# TV-04：PDF 阅读、受控 Blob 加载与区域坐标

| 项目     | 内容                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 状态     | completed                                                                        |
| 结论     | passed                                                                           |
| 日期     | 2026-07-18                                                                       |
| 负责人   | KyStudy 项目                                                                     |
| 关联 ADR | [ADR-001](../adr/001-desktop-runtime.md)、[ADR-003](../adr/003-pdf-rendering.md) |

## 要回答的问题

Tauri 2 + React + PDF.js 能否在不向前端暴露任意路径、不传递整本 Base64 的前提下，从 TV-03 内容寻址 Blob 按范围加载大型 PDF，并让题目区域在缩放、旋转、HiDPI、窗口变化和重启后仍稳定覆盖原内容？

## 不在范围内

- 不实现正式 PDF 阅读器、缩略图栏、批注系统和题目录入页面；
- 不实现 OCR、AI 识题、全文索引、云同步或 DRM；
- 不承诺所有损坏 PDF 都能修复，只验证稳定错误与降级；
- 不把实验代码直接复制到正式工程；
- 不主动操控桌面完成验收；先执行 Rust、TypeScript、Vitest、无头 Edge 和构建自动验证，确有必要时再提供人工步骤。

## 环境

| 项目             | 值                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------- |
| 操作系统         | Windows 11 专业版 10.0.26100                                                                  |
| CPU / GPU / 内存 | AMD Ryzen 7 5800H；NVIDIA RTX 3060 Laptop GPU；15.86 GiB 内存                                 |
| WebView / 浏览器 | Edge WebView2 / Microsoft Edge 150.0.4078.65                                                  |
| Node / pnpm      | Node.js 22.18.0；pnpm 11.9.0                                                                  |
| Rust             | 1.97.1 stable MSVC                                                                            |
| 锁定依赖         | Tauri 2.11.5、React 19.2.7、PDF.js 6.1.200、Vite 8.1.5、Vitest 4.1.10、Playwright Core 1.61.1 |
| 构建模式         | 行为测试为 debug；浏览器测量与 Tauri 构建为 production/release                                |

## 样本

全部样本由脚本确定性生成，不包含版权资料或个人数据：

- 文字与搜索样本：中文、英文、页码和稳定定位短语；
- 复杂排版样本：双栏、线框、向量图形和公式占位符；
- 旋转样本：0°、90°、180°、270° 页面；
- 扫描降级样本：只有栅格/图形内容，没有可搜索文字层；
- 大型样本：至少 360 页，用于跳页、连续渲染、取消和内存测量；
- 损坏样本：截断副本与不存在的 document ID。

生成物保存在实验目录的 `generated/` 或 `public/fixtures/`，可由脚本重建；大体积临时副本和浏览器 profile 位于 F 盘并在测量结束后清理。

| 样本                      | 页数/用途                                          |             大小 | SHA-256                                                            |
| ------------------------- | -------------------------------------------------- | ---------------: | ------------------------------------------------------------------ |
| `mixed-samples.pdf`       | 6 页；中文、英文、复杂排版、四种旋转、无文字层页   |  1,106,030 bytes | `eea92035be6ab34b5fc9076a1b1d3f2418190feaa06becdaa6460f834a56e427` |
| `large-360-pages.pdf`     | 360 页；含未访问的 24 MiB 不可压缩附件以验证 Range | 25,582,761 bytes | `ef7c941745ef88a82c70ed1e4c0a8c3d470064958136981e8324a07c754ded42` |
| `corrupted-truncated.pdf` | 截断错误样本                                       |      2,048 bytes | `217ebda1bf444e6944c096870ee64cd7077d0a11f44dc0fabc06b95659ed52f1` |

## 候选方案

1. Tauri 自定义协议 + `document_id` + Rust 单范围读取 + PDF.js URL/Worker；
2. Tauri asset protocol 直接向前端暴露工作区 Blob 绝对路径；
3. Tauri Command 把整本 PDF 读成字节数组或 Base64 返回前端；
4. 启动本地 HTTP 服务并把端口暴露给前端。

优先验证方案 1。方案 2 扩大前端可见路径和 scope，方案 3 会复制整本文件并增加 IPC/内存压力，方案 4 引入端口生命周期、防火墙和额外鉴权边界。

## 坐标约定

正式区域保存为 PDF 页面坐标系中的归一化矩形，而不是 Canvas/CSS 像素：

```text
NormalizedPdfRegion
  pageNumber: 1-based integer
  xMin / yMin / xMax / yMax: 0..1
  sourcePageWidth / sourcePageHeight: 诊断信息，不参与缩放
  coordinateVersion: 1
```

用户框选时，把 CSS viewport 的四个角通过 PDF.js viewport 逆变换为 PDF 点，再取轴对齐包围盒并归一化；恢复时执行逆过程。Canvas backing store 的 HiDPI 比例只影响绘制分辨率，不进入业务坐标。

## 通过标准

- [x] 脚本可重建文字、复杂排版、旋转、无文字层和 360 页以上样本；
- [x] PDF.js 及 Worker 作为本地依赖打包，不从 CDN 加载；
- [x] PDF 查看器重依赖按需加载，不进入诊断壳首屏主 chunk；
- [x] 前端只持有不透明 `document_id`，不获得 Blob 绝对路径或 storage key；
- [x] Rust 协议只通过 TV-03 `Workspace::open_document` 打开已登记资料；
- [x] 自定义协议支持 PDF.js 所需的 `GET`、单字节范围、`206`、`Content-Range`、`Accept-Ranges`、长度与 MIME；
- [x] 无效 ID、越界 Range、多 Range、非 GET 和损坏文件返回稳定状态/错误，且不会读取任意路径；
- [x] CSP 只允许应用自身、IPC、PDF 协议和本地 Worker，不启用远程脚本、任意文件或 Shell；
- [x] 归一化区域在 0°/90°/180°/270°、不同缩放与 viewport 尺寸间往返误差可量化；
- [x] Canvas HiDPI backing store 变化不改变保存区域；
- [x] 无文字层 PDF 仍可用坐标框选，文字搜索明确返回无结果而不是阻塞；
- [x] 文字层样本可以提取稳定短语并定位页码；
- [x] 快速翻页会取消旧 RenderTask，同一 Canvas 不并发渲染两页；
- [x] 大型样本首次渲染、随机跳页和连续翻阅有 release/production 测量；
- [x] 连续翻阅后清理 Page/Canvas/LoadingTask，内存不会持续无界增长；
- [x] 不使用整本 Base64、任意 SQL、任意前端文件路径或通用本地 HTTP 端口；
- [x] TypeScript、Vitest、production build、Rust fmt/test/Clippy 和 Tauri release build 通过；
- [x] 报告记录依赖版本、样本哈希、首次渲染、翻页、坐标误差、范围请求和峰值内存；
- [x] 在真实 Tauri Release WebView 中人工确认自定义协议、Worker、CSP、框选、缩放与旋转共同工作。

## 实验步骤

1. 创建独立 React/TypeScript/Tauri 实验并锁定依赖；
2. 编写确定性 PDF 样本生成器与哈希清单；
3. 实现纯 TypeScript 坐标转换和 Vitest 边界测试；
4. 实现懒加载 PDF 查看器、Worker、渲染取消、文字提取和资源释放；
5. 实现 Rust `document_id` 协议、严格单 Range 解析和稳定响应；
6. 用路径依赖复用 TV-03 Blob 打开接口，不复制其内部 storage key；
7. 运行无头 Edge 自动渲染、搜索、旋转、跳页和内存测量；
8. 运行前后端质量门槛与 Tauri release 构建；
9. 回填结果，决定 ADR-001，并根据坐标/渲染结论创建 ADR-003。

## 结果

### 测量数据

| 场景                       | 指标                  | 结果                                                       |
| -------------------------- | --------------------- | ---------------------------------------------------------- |
| 25.58 MB / 360 页样本      | 文档初始化 / 首页渲染 | 211.80 ms / 76.90 ms                                       |
| 随机跳页 90、180、270、360 | 单页渲染              | 15.20、14.90、11.80、17.80 ms；均值 14.93 ms               |
| 三轮连续翻阅               | 216 次渲染            | 1,680.00 ms；均值 5.39 ms；最大 13.90 ms                   |
| 旋转、缩放与 HiDPI         | 最大归一化坐标误差    | `2.220446049250313e-16`；DPR 2                             |
| 大型样本 Range             | 请求/传输/最大响应    | 8 次 / 482,473 bytes / 65,536 bytes，只传输文件的 1.89%    |
| JS Heap                    | 基线/峰值/销毁后      | 3.29 / 9.83 / 3.06 MiB                                     |
| 三轮翻阅结束 Heap          | 每轮结束              | 3.16 / 3.24 / 3.51 MiB，销毁后低于基线                     |
| 无头 Edge 全进程工作集     | 基线/峰值/测量结束    | 490.43 / 520.46 / 516.02 MiB；关闭浏览器后进程退出         |
| Tauri Release              | 构建时间/EXE          | 首次 2 分 47 秒，修复版最终增量 52.59 秒；39,089,152 bytes |

Release EXE SHA-256：`47124F86ADB83F1A21E773FF7564B6527018A9A4797CA280AE5CFD959E9EF78F`。

### 成功样本

- 项目维护者在修复版真实 Windows Tauri Release WebView 中完成复测：窗口显示 `协议修订：direct-id-v2`，点击“加载 PDF 实验”后 PDF 正常加载，未再出现协议错误；
- PDF.js 6.1.200 在本地 Worker 中打开 360 页样本，中英文稳定短语均可从文字层提取；
- 第 6 页没有文字项，但 Canvas 正常渲染；拖动框选后得到 `0.200, 0.300 → 0.660, 0.750`，旋转、放大和页面重载后覆盖框仍恢复；
- 0°、90°、180°、270° 与多缩放组合的坐标往返误差接近浮点机器精度，HiDPI backing store 不进入业务坐标；
- 24 MiB 未访问附件没有被读取：25,582,761 bytes 文件只传输 482,473 bytes；
- PDF.js、查看器和 Worker 均为独立 production chunk；首屏主 JS 为 196.21 kB，Worker 为 1,255.06 kB；
- 22 个 TypeScript/Vitest 测试和 9 个 Rust 测试通过，Tauri Release EXE 构建成功。

### 失败与边界样本

- 第一次真实 Release WebView 人工样本中，窗口正常启动，但点击加载后显示“加载失败：Error”。`convertFileSrc` 把旧参数 `/document/tv04-mixed-document` 整体编码为请求路径 `/%2Fdocument%2Ftv04-mixed-document`，与 Rust 接受的 `/document/...` 路由不一致，首个 Range 请求因此返回 `404`；
- 修复版采用 direct document-ID URL：前端只传递不透明 ID，形成 `http://kystudy-pdf.localhost/tv04-mixed-document`，Rust 只接受根路径下的 document ID。界面以 `协议修订：direct-id-v2` 标识该版本，错误显示改为稳定、非敏感的诊断码；
- 截断 PDF 被 PDF.js 稳定拒绝，失败路径会中止 RangeSource 并销毁 LoadingTask；
- 未登记 ID 和路径穿越不会回退为磁盘路径，返回 `404`；
- 缺少 Range、越界 Range、多 Range 和超过 1 MiB 的响应请求返回 `416`；
- 非 GET 请求返回 `405` 与 `Allow: GET`；协议最大只为一次请求分配 1 MiB；
- 快速发起第二次 Canvas 渲染时，第一次 RenderTask 收到取消并在第二次开始前结束；
- 浏览器专用 profile 已自动清理，F 盘没有遗留 `edge-profile-*` 临时目录。

### 恢复与降级

- 扫描页没有文字层时保留 Canvas 与手动框选能力；
- 新渲染请求开始前取消旧 RenderTask，卸载时销毁 LoadingTask；
- 协议错误只返回稳定状态和非敏感诊断，不返回绝对路径、SQL 或 Rust Debug 字符串；
- GPU/硬件加速不可用时允许 Canvas 软件渲染，但必须记录性能差异。

## 结论

`passed`。18 项自动通过标准和 1 项真实 Release WebView 人工标准全部满足；22 个 TypeScript/Vitest 测试、9 个 Rust 测试、TypeScript 类型检查、production build、Rust fmt、全目标/全特性 Clippy 零警告和 Tauri release build 均通过。

自动证据支持 PDF.js 显示层、受控 RangeSource、TV-03 Blob 打开接口和归一化坐标方案。第一次真实 Release WebView 暴露并促成修复了 `convertFileSrc` 路由编码问题；项目维护者随后确认修复版能够正常加载 PDF，因此 Windows 自定义协议、CSP 与 Worker 的关键组合行为已获得真实平台证据。

## 建议决策

采用“PDF.js 显示层 + Rust document ID 单 Range 协议 + PDF 归一化坐标”的方向；接受 ADR-001 与 ADR-003。

## 后续行动

- [x] 完成实验实现、样本与自动测试；
- [x] 完成 production/release 性能和内存测量；
- [x] 由项目维护者执行最小 Release WebView 人工验收；
- [x] 创建 ADR-003，并把 TV-04 自动证据同步到 ADR-001；
- [x] 人工验收通过后接受 ADR-001 与 ADR-003；
- [ ] 根据已接受的 ADR 初始化正式工程。

## 参考资料

- [PDF.js Getting Started](https://mozilla.github.io/pdf.js/getting_started/)
- [PDF.js Examples](https://mozilla.github.io/pdf.js/examples/)
- [PDF.js API](https://mozilla.github.io/pdf.js/api/)
- [Tauri Content Security Policy](https://v2.tauri.app/security/csp/)
- [Tauri Asset Protocol Scope](https://v2.tauri.app/security/asset-protocol/)
