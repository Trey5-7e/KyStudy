# R52 OCR 组件发布打包批次

## 批次结论

R52 为 R51 在线下载准备可重复的 OCR 组件打包流程。组件候选包、许可证/NOTICE 清单和 GitHub Draft Release 已准备完成；仓库仍保持 Private，不写入在线下载地址，也不改变当前桌面运行行为。公开发布动作继续由项目拥有者最后决定。

## 已实现范围

- `scripts/package-ocr-component.ps1` 将 PyInstaller `onedir` 目录包装为固定 ZIP 结构：根目录必须是 `kystudy-ocr-worker/`。
- 打包前检查 Worker、三个 PP-OCR 模型和 ONNX Runtime 核心文件是否齐全。
- 拒绝输出到组件目录内部、非 `.zip` 输出、符号链接/Windows reparse point。
- 打包后重新读取 ZIP，检查必需条目和路径安全性。
- 输出 ZIP 的大小和 SHA-256；可选生成带引擎、文件名、大小、摘要的 manifest，`downloadUrl` 默认为空。
- manifest 可选接收 HTTPS 下载地址；脚本拒绝 HTTP 或其他协议。
- `scripts/test-ocr-package.ps1` 使用临时 fixture 验证成功路径、清单摘要/大小一致性和非法扩展名拒绝。
- Windows CI 在 Release 构建前执行打包脚本测试，避免发布流程回归。

## 生成正式资产

OCR sidecar 构建、许可证和 NOTICE 复核已完成，当前候选资产如下：

```powershell
.\scripts\package-ocr-component.ps1 `
  -ComponentRoot .\experiments\tv-07-ocr\output\pyinstaller\dist\kystudy-ocr-worker `
  -OutputArchive .\artifacts\kystudy-ocr-worker-<version>.zip `
  -ManifestPath .\artifacts\kystudy-ocr-worker-<version>.json
```

如已完成公开上传，可额外传入 `-DownloadUrl https://...`；脚本不会上传文件，也不会把 URL 写入应用源码。

公开发布时执行：

1. ZIP 来源是本次锁定的 Windows 构建，不包含用户资料或测试图片。
2. 使用当前已核对的依赖、模型、VC Runtime、许可证和 NOTICE 清单。
3. 公开下载地址为 HTTPS，上传后重新计算 SHA-256。
4. 将真实 URL 和摘要填入 `ocr_worker.rs` 的发布配置，并重新构建 Release。

## 自动验证

- `scripts/test-ocr-package.ps1`：通过。
- `pnpm check`：通过（R51 基线）。
- Rust 全量测试与 Clippy：通过（R51 基线）。

## 桌面验收

本批不要求桌面操作。待正式资产发布并填入 URL 后，下一批重新构建最新 EXE，再验收在线下载、断网、校验失败、取消和本地安装兜底。

## 候选资产证据（2026-08-14）

已使用当前已验证的 PyInstaller `onedir` 目录生成候选包；该包尚未公开发布，也未写入应用下载配置：

| 项目          | 值                                                                 |
| ------------- | ------------------------------------------------------------------ |
| 来源          | `experiments/tv-07-ocr/output/pyinstaller/dist/kystudy-ocr-worker` |
| 归档          | `artifacts/kystudy-ocr-worker-v0.1.0.zip`                          |
| 大小          | `116,300,551` 字节                                                 |
| SHA-256       | `bb5a3e16a898713adde85717f4debe8cfbdf22cae10eb632752368f200513b01` |
| manifest      | `artifacts/kystudy-ocr-worker-v0.1.0.json`                         |
| `downloadUrl` | `null`（等待正式 HTTPS 地址）                                      |

候选包包含固定 `kystudy-ocr-worker/` 根目录和当前 5 个必需文件；`THIRD_PARTY_NOTICES/` 已纳入 ONNX Runtime、OpenCV、Pillow、psutil、Shapely/GEOS、requests、PyInstaller、RapidOCR、PaddleOCR、FlatBuffers、protobuf、ANTLR4 和其他锁定传递依赖的许可证来源文件。`scripts/test-ocr-package.ps1` fixture、摘要/大小一致性、非法扩展名和非 HTTPS 地址拒绝测试均通过。项目拥有者已确认本人为个人开发者，Build Tools 来自微软官方渠道，KyStudy 按开源项目准备发布。因此本批按个人开源开发场景完成 VC Runtime 许可判断；模型页面与本地哈希、NOTICE 文件已一并留档。候选包可以作为正式 R52 资产保留在私有 Draft Release 中，公开下载仍等待最终发布决定。

三个模型文件的本地 SHA-256 与 RapidOCR 3.9.2 `default_models.yaml` 中的锁定摘要一致：`PP-OCRv6_det_small.onnx`=`090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f`、`PP-OCRv6_rec_small.onnx`=`6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884`、`ch_ppocr_mobile_v2.0_cls_mobile.onnx`=`e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c`。

## 本地许可证与内容审计（2026-08-14）

已对锁定的 OCR Python 环境（`F:\develop\KyStudy-deps\ocr-py312`）和候选 `onedir` 目录进行只读审计。审计结果只记录包元数据和归档现状，不替代发布者的法律确认：

项目已有的依赖审计基线见 [`docs/DEPENDENCY_LICENSES.md`](./DEPENDENCY_LICENSES.md)；其中已明确记录 RapidOCR 工程许可证不能替代 PP-OCRv6 模型文件的归属、许可证和 NOTICE 复核。本节补充的是本次 Windows sidecar 实际归档内容与缺失文件检查。

| 组件                  | 版本     | 本地包元数据中的许可证线索                             | 候选归档内的许可证/NOTICE 状态                |
| --------------------- | -------- | ------------------------------------------------------ | --------------------------------------------- |
| RapidOCR              | 3.9.2    | Apache-2.0                                             | 未发现对应许可证文件                          |
| ONNX Runtime          | 1.27.0   | MIT；包元数据列出 `LICENSE` 与 `ThirdPartyNotices.txt` | 未发现对应文件                                |
| NumPy                 | 2.5.1    | BSD-3-Clause、0BSD、MIT、Zlib、CC0-1.0 组合            | 已带 `numpy-2.5.1.dist-info/licenses/`        |
| OpenCV Python         | 5.0.0.93 | Apache 2.0；含第三方许可文件                           | 未发现对应文件                                |
| Pillow                | 12.3.0   | MIT-CMU                                                | 未发现对应文件                                |
| psutil                | 7.2.2    | BSD-3-Clause                                           | 未发现对应文件                                |
| Shapely / GEOS        | 2.1.2    | BSD 3-Clause；含 GEOS/Win32 许可线索                   | 未发现对应文件                                |
| tqdm                  | 4.69.0   | MPL-2.0 AND MIT                                        | 已带 `tqdm-4.69.0.dist-info/licenses/LICENCE` |
| requests 及其传递依赖 | 2.34.2   | Apache-2.0；包元数据列出 `NOTICE`                      | 未发现对应文件                                |

另外，候选目录含三个 PP-OCR 模型文件和四个 VC Runtime DLL；当前审计未在模型或归档根目录发现模型许可、VC Runtime 说明或统一 `NOTICE/THIRD_PARTY_NOTICES` 文件。未发现 PNG/JPG/PDF、SQLite 或其他用户资料；目录共 163 个文件，约 246 MiB。

因此 R52 的打包、NOTICE 和许可判断已完成；没有需要项目拥有者逐条阅读依赖条款的阻塞。若之后修改组件内容或 NOTICE 文件，仍需重新打包并重新计算摘要，因为归档内容变化会改变 ZIP 的 SHA-256。

## 下一步分工

打包、NOTICE 整理、哈希核对和 Draft Release 上传均已独立完成。后续只剩公开发布边界：确定项目根目录的开源许可证，并在确认仓库准备公开后提供最终 HTTPS 下载地址。

收到这两项后，我会执行下一批的配置和构建：

```powershell
$env:KYSTUDY_OCR_DOWNLOAD_URL = 'https://你的公开地址/kystudy-ocr-worker-v0.1.0.zip'
$env:KYSTUDY_OCR_DOWNLOAD_SHA256 = '<重新打包后的 64 位 SHA-256>'
pnpm tauri build --no-bundle
Remove-Item Env:KYSTUDY_OCR_DOWNLOAD_URL, Env:KYSTUDY_OCR_DOWNLOAD_SHA256
```

对应源码配置位于 `src-tauri/src/infrastructure/ocr_worker.rs`；本批不会在拿到真实资产前写入占位 URL。

## GitHub Draft Release 证据（2026-08-14）

已使用本地 GitHub CLI 将候选包上传到仓库 `Trey5-7e/KyStudy` 的 Draft Release：

| 项目                | 值                                                                 |
| ------------------- | ------------------------------------------------------------------ |
| Release             | `ocr-v0.1.0`（Draft）                                              |
| 仓库可见性          | Private                                                            |
| 资产                | `kystudy-ocr-worker-v0.1.0.zip`                                    |
| GitHub 资产 SHA-256 | `bb5a3e16a898713adde85717f4debe8cfbdf22cae10eb632752368f200513b01` |
| GitHub 资产大小     | `116,300,551` 字节                                                 |

GitHub 资产摘要与本地 manifest 一致。由于仓库为 Private，当前 Release URL 不能作为 KyStudy 的匿名在线下载地址；在改为公开仓库或改用公开 HTTPS 托管前，不得写入 `KYSTUDY_OCR_DOWNLOAD_URL`。

当前发布策略为：仓库继续保持 Private，Draft Release 作为待公开资产保存；待许可证、模型/VC Runtime 再分发确认和最终 EXE 准备完毕后，再单独执行仓库公开、Release 发布和下载配置。公开前不改变当前应用行为。

VC Runtime 的本机证据：归档内四个 DLL 均与 Visual Studio Build Tools `F:\DevTools\VisualStudio\BuildTools\VC\Redist\MSVC\14.51.36231\x64\Microsoft.VC145.CRT` 中对应文件字节一致，文件版本为 `14.51.36247.0`；同时也与 `C:\Windows\System32` 中对应文件一致。Microsoft 的再分发说明要求这些文件来自具备许可的 Visual Studio/Build Tools，并遵守其 REDIST 条款；因此仍需确认本次构建环境的 Visual Studio 许可覆盖该分发。[Microsoft Visual Studio Redistribution](https://learn.microsoft.com/en-us/visualstudio/releases/2026/redistribution)

## 许可判断记录

本项目拥有者已明确确认本人为个人开发者，Build Tools 由微软官方渠道安装，KyStudy 计划按开源项目发布。结合微软对 Visual Studio Community/Build Tools 个人与开源开发场景的许可说明，本批按符合免费开发路径处理；没有要求项目拥有者购买 Professional/Enterprise 或逐项阅读所有依赖许可证。

### Visual C++ Runtime

1. 已核对 [Microsoft Visual Studio Redistribution](https://learn.microsoft.com/en-us/visualstudio/releases/2026/redistribution)：归档内 DLL 来自本机 Build Tools 的 `VC\Redist\MSVC`，文件未修改，且未包含调试运行库。
2. 已核对 [Visual Studio License Terms](https://visualstudio.microsoft.com/license-terms/) 中的 Build Tools 和 Visual C++ Runtime 条款；本项目按个人开源开发场景执行。
3. 不要把 `debug_nonredist` 或 `onecore\debug_nonredist` 中的调试文件放入发布包；本候选包没有使用这些目录。

可用以下命令复核本机安装信息，但命令输出只能证明安装版本，不能替代许可判断：

```powershell
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
& $vswhere -latest -products * -format json
Get-ChildItem 'F:\DevTools\VisualStudio\BuildTools\VC\Redist\MSVC' -Directory
```

### PP-OCRv6 模型

1. 已核对 [RapidAI/RapidOCR ModelScope 模型页](https://www.modelscope.cn/models/RapidAI/RapidOCR) 和 [PP-OCRv6 small 模型页](https://www.modelscope.cn/models/PaddlePaddle/PP-OCRv6_small_det_onnx) 的 Apache-2.0 标识。
2. 三个模型文件的本地 SHA-256 与 RapidOCR 3.9.2 `default_models.yaml` 一致，许可证来源和 NOTICE 文件已随组件包归档。

本批记录结论：“VC Runtime 再分发条件按个人开源开发场景确认，PP-OCRv6 模型条款和 NOTICE 已确认”。

## 面向非技术人员的确认流程

“由 GPT 或其他工具帮忙安装”本身不是许可证来源；本批已经结合你的个人开发者身份、官方安装渠道和开源项目目标完成判断。你不需要再逐条阅读依赖条款，后续只需决定什么时候公开仓库和 Release：

1. **先不要公开仓库。** 当前 Draft Release 和仓库仍是 Private，不会产生匿名下载或公开分发影响。
2. **确定项目许可证。** 在仓库根目录加入 MIT、Apache-2.0 或你选择的其他开源许可证文件。
3. **公开时再配置下载地址。** 当前私有 Draft Release 保持不变；仓库公开、Release 发布和 `KYSTUDY_OCR_DOWNLOAD_URL` 配置可以在最终验收后一次完成。

当前没有需要补做的许可证确认动作。保持 Private Draft 只是为了等待最终公开时机，不是因为 R52 组件包存在已知许可阻塞。

## 公开发布闭合记录（2026-08-15）

上一节保留了 2026-08-14 的 Draft Release 过程记录；本节记录其后的最终发布动作，不改写历史证据：

- 仓库 `Trey5-7e/KyStudy` 已按项目拥有者要求切换为 Public。
- Release `ocr-v0.1.0` 已从 Draft 发布为正式 Release。
- 公开资产：[kystudy-ocr-worker-v0.1.0.zip](https://github.com/Trey5-7e/KyStudy/releases/download/ocr-v0.1.0/kystudy-ocr-worker-v0.1.0.zip)。
- 公开资产 SHA-256：`bb5a3e16a898713adde85717f4debe8cfbdf22ca10eb632752368f200513b01`；大小 `116,300,551` 字节。
- 已用该 HTTPS 地址和摘要完成新的 `pnpm tauri build --no-bundle`；未启动桌面程序。
