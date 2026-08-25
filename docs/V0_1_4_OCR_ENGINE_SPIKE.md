# v0.1.4 OCR 引擎 Spike 与优化基线

本记录按开发方案 4.2 建立统一 OCR 适配边界。主程序只依赖稳定的
`schemaVersion=1` 页面结果（文本、置信度、归一化框），后续替换 RapidOCR、
接入 PaddleOCR 或 Docling 时不需要修改 Tauri 命令和 PDF 索引器。

## 当前实现

- 默认后端：RapidOCR 3.9.2 + PP-OCRv6 small + ONNX Runtime CPU。
- Worker 内部新增统一 `OcrBackend` 适配协议。
- 图像进入引擎前执行：EXIF 方向纠正、低分辨率等比放大、暗底反相、灰度化、自动对比度和轻度锐化。
- OCR 结果按页面从上到下、从左到右排序；保留原始归一化坐标。
- PDF 搜索和题库切分优先使用置信度不低于 `0.35` 的文本行；整页均低于阈值时保留降级结果，避免扫描页完全失去可搜索文本。
- 原始题目图片始终保留，公式、矩阵和复杂表格不把 OCR 文本当作可靠结构化答案。

## 当前脱敏基线

基于仓库已有四张无版权 fixture，使用 Python 3.12.8、RapidOCR 3.9.2、ONNX Runtime 1.27.0、CPU，单次迭代重新测得：

| 样本                |   CER | 关键词召回 |   平均耗时 | 平均置信度 | 结论                 |
| ------------------- | ----: | ---------: | ---------: | ---------: | -------------------- |
| clean_chinese       | 0.00% |       100% | 约 1027 ms |     0.9871 | 可用于搜索/上下文    |
| tilted_phone        | 0.00% |       100% |  约 905 ms |     0.9996 | 方向分类与预处理可用 |
| low_resolution_scan | 0.00% |       100% |  约 729 ms |     0.9997 | 放大后可用           |
| formula_table       | 0.00% |       100% |  约 975 ms |     0.9694 | 仍需保留原图人工核对 |

这组数据只能证明工程回归和脱敏样本改进，不能代表真实教材、双栏排版、复杂公式或手写内容的最终准确率。

## PaddleOCR / Docling 对比状态

本轮已在仓库外的 `F:\develop\KyStudy-deps\ocr-paddle-py312` 完成 PaddleOCR CPU 验证：

- `paddlepaddle==3.3.0`、`paddleocr==3.7.0`，Python 3.12，Windows CPU；
- 使用官方 `PP-DocLayout-S` 做公式区域检测，使用 `PP-FormulaNet-S` 输出 LaTeX；
- 660 高数篇第 2 页以 3000 像素长边输入时，RapidOCR 能稳定召回题号和正文，公式仍是碎片；Paddle 组合链路可以识别出两个公式区域，并输出包含上下标、根式、分式和极限下标的 LaTeX 结构；
- 公式模型缓存约 238 MB，布局模型缓存约 5 MB。Windows CPU 需要关闭 oneDNN 才能稳定运行 `PP-DocLayout-S`，单页冷启动和推理成本明显高于当前 RapidOCR Worker。

因此本版本先不把 PaddleOCR 重依赖直接塞进默认桌面组件：它已证明能改善公式结构，但会显著增加 Worker 包体、内存和离线安装风险。当前正式链路已把 PDF OCR 渲染长边从 1800 提升到 3000，继续使用 RapidOCR 作为稳定文字/题号后端；`OcrBackend` 保留给后续独立公式组件接入。下一轮必须补充 Paddle 公式 Worker 的 PyInstaller 体积、峰值 RSS、冷启动和逐页耗时门槛，再决定是否作为可选增强组件发布。

Docling 仍作为 PDF 阅读顺序、版面和结构化输出候选，不直接替换单页 OCR Worker；MinerU 仅作为离线批处理对比对象，接入前继续进行许可证和包体审计。

替换门槛：真实做题本样本的 CER/题号召回、复杂公式降级行为、CPU 峰值内存、冷启动耗时、Windows 离线打包和许可证均优于当前 RapidOCR，且不破坏取消/降级链路。
