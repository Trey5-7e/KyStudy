# TV-07 本地 OCR 技术验证

这个目录只用于验证 Windows 本地 OCR 的效果、资源占用、离线运行、取消和打包，
不是 KyStudy 的正式 OCR 实现。结论与测量数据见
[TV-07 Spike 报告](../../docs/spikes/TV-07-ocr.md)。

## 方案

- Python 3.12；
- RapidOCR 3.9.2；
- PP-OCRv6 small 检测和识别模型；
- ONNX Runtime 1.27.0 CPU 推理；
- PyInstaller 6.21.0 `onedir` 打包；
- stdin/stdout 上逐行 JSON 协议。

模型随 RapidOCR 包进入可选 Worker，不在首次使用时联网下载。Worker 只返回文本、
置信度、页面尺寸和归一化文字框，不回传输入文件路径。

## 环境

依赖环境应放在项目目录之外。本次使用：

```powershell
py -3.12 -m venv F:\develop\KyStudy-deps\ocr-py312
$OcrPython = 'F:\develop\KyStudy-deps\ocr-py312\Scripts\python.exe'
& $OcrPython -m pip install -r .\requirements.lock.txt
```

锁文件同时包含生成样本、测试、Lint 和打包所需依赖，不代表它们都会进入正式应用。

## 生成样本

样本由代码生成，不包含真实题库或个人资料：

```powershell
$OcrPython = 'F:\develop\KyStudy-deps\ocr-py312\Scripts\python.exe'
& $OcrPython -m tv07_ocr.fixtures --output .\output\fixtures
```

覆盖清晰中文、倾斜手机照片、低分辨率扫描和公式表格页。生成文件位于忽略的
`output/` 目录。

## 质量检查与基准

```powershell
$OcrPython = 'F:\develop\KyStudy-deps\ocr-py312\Scripts\python.exe'
& $OcrPython -m ruff check .
& $OcrPython -m unittest discover -s .\tests -v
& $OcrPython -m tv07_ocr.benchmark `
  --python $OcrPython `
  --fixtures .\output\fixtures `
  --output .\output\benchmark.json `
  --iterations 3
```

基准会检查 CER、关键词召回、文字框、离线运行、取消和完整进程树峰值 RSS。
`output/benchmark.json` 是本机结果，不提交仓库。

## 打包与独立运行

```powershell
$OcrPython = 'F:\develop\KyStudy-deps\ocr-py312\Scripts\python.exe'
.\build_sidecar.ps1 -PythonExecutable $OcrPython

$Worker = '.\output\pyinstaller\dist\kystudy-ocr-worker\kystudy-ocr-worker.exe'
& $Worker once .\output\fixtures\clean_chinese.png
```

Microsoft Store Python 可能向 PyInstaller 产物放入旧版 VC Runtime。构建脚本会比较
系统与产物中的四个 VC Runtime DLL，并只用更新的系统版本替换旧副本。ONNX Runtime
官方要求 Windows 安装 Visual C++ 2019 Runtime，并推荐使用最新版本。

## Worker 协议

`serve` 模式启动后先输出 `ready`。识别请求和关闭请求示例：

```json
{"id":"request-1","image":"<internal-image-path>"}
{"id":"shutdown","command":"shutdown"}
```

每行请求对应一行 JSON 响应。正式集成时，绝对路径只能存在于 Rust 与 Worker 的内部
边界，不能进入 WebView DTO、日志或诊断导出。取消时由父进程终止 Worker；OCR 失败、
取消或组件缺失都不能阻止 PDF 阅读和手动框选。

## 已知边界

- 当前打包目录约 246.18 MiB，不应进入最小安装包；
- 连续 12 次识别峰值 RSS 约 728.88 MiB，不应常驻；
- 合成公式样本识别较好不代表公式语义可靠，公式和复杂表格必须保留原始区域图片；
- 正式接入前仍需用用户有权使用的真实扫描页做人工验收；
- 下一轮体积优化优先评估 headless OpenCV、PyInstaller 排除项和原生 ONNX Runtime。

## 官方资料

- [RapidOCR](https://github.com/RapidAI/RapidOCR)
- [ONNX Runtime 安装要求](https://onnxruntime.ai/docs/install/)
- [PyInstaller 文档](https://pyinstaller.org/en/stable/)
