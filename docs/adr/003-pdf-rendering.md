# ADR-003：PDF.js 显示层、受控 RangeSource 与区域坐标

| 项目        | 内容                                                 |
| ----------- | ---------------------------------------------------- |
| 状态        | accepted                                             |
| 日期        | 2026-07-18                                           |
| 决策者      | KyStudy 项目                                         |
| 相关需求    | 本地 PDF、习题区域、多页题目、缩放、旋转、扫描页降级 |
| 相关 Spike  | [TV-04](../spikes/TV-04-pdf-viewer.md)               |
| 替代/被替代 | 无                                                   |

## 上下文

KyStudy 需要在本地打开用户导入的练习册 PDF，支持文字搜索和题目区域框选。PDF 可能有数百页、旋转页、复杂排版或完全没有文字层。文件由 TV-03 内容寻址 Blob Store 管理，前端不能获得任意绝对路径、storage key 或整本 Base64。

Canvas/CSS 像素会随窗口、缩放、旋转和 DPR 改变，不能直接成为 `QuestionRegion` 的正式坐标。PDF 显示引擎还必须能取消旧渲染、按范围读取并在组件卸载后释放 Worker、Page 和 Canvas 资源。

## 决策驱动因素

- React/Tauri 技术栈兼容性与本地 Worker；
- 数百页 PDF 的按需读取、跳页和内存边界；
- 不扩大前端文件权限；
- 旋转、缩放、HiDPI 和重启后的区域稳定性；
- 有文字层时支持提取，无文字层时仍能手动框选；
- 依赖许可证、维护活跃度和可测试性。

## 候选方案

### 方案 A：PDF.js + document ID RangeSource + PDF 归一化坐标

React 按需加载 PDF.js 显示层和本地 Worker。前端先取得 `document_id` 与长度，再由自定义 `PDFDataRangeTransport` 发起显式单 Range 请求。Rust 通过 Tauri 自定义协议把 document ID 映射到 TV-03 `Workspace::open_document`，只返回最多 1 MiB 的 `206` 响应。

区域保存为 PDF 页面坐标系中的 0–1 归一化矩形。框选时用 PDF.js viewport 把 CSS 四角逆变换为 PDF 点；恢复时再正变换到当前 viewport。Canvas backing store 的 DPR 不进入业务坐标。

### 方案 B：Tauri asset protocol 暴露 Blob 绝对路径

实现较少，但前端必须持有路径且 asset scope 覆盖工作区 Blob 树，扩大了路径泄漏和权限配置风险。

### 方案 C：Command 返回整本 Uint8Array/Base64

接口直观，但大文件会在文件读取、IPC、JavaScript 和 Worker 之间产生整本复制；Base64 还会增加体积，不符合大文件固定边界。

### 方案 D：独立本地 HTTP 服务

Range 和浏览器兼容性成熟，但增加端口、生命周期、防火墙、鉴权和跨进程边界，M1 没有证据证明这些成本必要。

## 当前推荐

采用方案 A。TV-04 的自动证据与真实 Windows Tauri Release WebView 复测均已通过。

约束如下：

- PDF.js 和 Worker 必须本地打包并按需加载，不使用 CDN；
- 前端只使用 `document_id`、显示名、长度和业务页码；
- 自定义协议不接受绝对路径、storage key、SQL 或任意 MIME；
- Range 解析只支持一个 `bytes` 区间，单响应上限 1 MiB；
- `QuestionRegion` 保存 PDF 点归一化矩形与 `coordinate_version=1`，不保存 Canvas 像素；
- 旋转是 viewport 展示状态，不原地改写区域；
- OCR 和文字层都不是手动框选的前置条件；
- 新渲染开始前取消旧 RenderTask，卸载时销毁 LoadingTask 并清理 Page/Canvas。

## 理由与证据

- PDF.js 6.1.200 官方显示层支持 Worker、PageViewport、RenderTask 和自定义 `PDFDataRangeTransport`；
- 25,582,761 bytes、360 页合成样本的初始化为 211.80 ms，首页为 76.90 ms，216 次连续渲染均值为 5.39 ms；
- 大型样本只传输 482,473 bytes（1.89%），8 个 Range 的最大响应为 65,536 bytes，24 MiB 未访问附件未进入前端；
- 四种旋转、多缩放与 DPR 2 的最大归一化误差为 `2.220446049250313e-16`；
- 中文、英文文字层可以提取，无文字层页返回 0 个文字项但仍可渲染和框选；
- 三轮共 216 次渲染结束后的 JS Heap 为 3.16、3.24、3.51 MiB，销毁后为 3.06 MiB，低于 3.29 MiB 基线；
- 截断 PDF、旧 RenderTask 取消、路径穿越、未登记 ID、无效 Range 和非 GET 均有自动失败样本；
- 22 个 TypeScript/Vitest 测试、9 个 Rust 测试、production build、Clippy 零警告和 Tauri Release 构建通过；项目维护者确认 `direct-id-v2` Release 能正常加载 PDF。完整数据见 [TV-04](../spikes/TV-04-pdf-viewer.md)。

## 后果

### 正面

- 大 PDF 不需要作为整本 Base64 或 IPC 字节数组进入前端；
- 文件授权仍集中在 Rust/TV-03 边界；
- 区域不依赖缩放、窗口或 DPR，可跨重启恢复；
- 扫描页可以先框选，OCR 可在后续异步补充；
- PDF.js 不进入应用首屏主 chunk。

### 代价与限制

- Tauri 自定义协议在 Windows 与其他平台有不同 Origin，需要逐平台验证 CORS/CSP；
- PDF.js Worker 约 1.26 MB，显示层压缩前约 0.43 MB；
- 归一化轴对齐矩形不能表达任意多边形，首版跨页题目需要多个 `QuestionRegion`；
- 浏览器/Worker/GPU 的总工作集高于 JS Heap，正式阅读器仍需页面缓存上限和可见页策略；
- 损坏、加密、异常字体和超大图片 PDF 还需要稳定错误与后续样本扩充。

## 后续行动

- [x] 完成 TV-04 Release WebView 人工验收并接受本 ADR；
- 正式工程重新实现受控协议和 RangeSource，不复制实验快捷代码；
- 为页面缓存设置明确上限，只保留当前页和少量邻近页；
- 为多区域/跨页题目保存多个有序 `QuestionRegion`；
- OCR 只补充文字和框，不改写用户确认的 PDF 区域。

## 复审条件

- 真实 WebView 无法在严格 CSP 下稳定运行 PDF.js Worker 或 Range 请求；
- 某平台不支持所需自定义协议/CORS 行为；
- 正式大型扫描 PDF 的内存或渲染延迟不可接受；
- 业务需要非矩形区域、PDF 编辑或完整批注互操作；
- PDF.js 的维护状态、许可证或浏览器支持发生重大变化。
