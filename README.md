<a id="readme-top"></a>

<div align="center">
  <img src="docs/branding/kystudy-icon-concept-v4-transparent-tight.png" alt="KyStudy project icon concept" width="120" height="120">
  <h1>KyStudy</h1>
  <p>面向中国考研学生的本地优先学习规划、习题管理与错题复习桌面应用。</p>
  <p>
    <a href="https://github.com/Trey5-7e/KyStudy/releases">下载 v0.1.0</a>
    ·
    <a href="https://github.com/Trey5-7e/KyStudy/issues">反馈问题</a>
    ·
    <a href="docs/V0_1_0_DEVELOPMENT_HANDOFF.md">开发交接文档</a>
  </p>
</div>

<p align="center">
  <a href="https://github.com/Trey5-7e/KyStudy/actions/workflows/windows-ci.yml">
    <img src="https://github.com/Trey5-7e/KyStudy/actions/workflows/windows-ci.yml/badge.svg" alt="Windows CI">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-GPL--3.0--only-blue.svg" alt="GPL-3.0-only license">
  </a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D4.svg" alt="Windows 10 and 11 x64">
  <img src="https://img.shields.io/badge/status-v0.1.0%20release%20candidate-orange.svg" alt="v0.1.0 release candidate">
</p>

> 当前首版目标是 Windows 10/11 x64 的 v0.1.0。自动门禁、干净提交和 OCR 组件公开 Release 已完成；完整桌面安装验收与应用发行包 Release 仍由项目维护者最后确认。

## 目录

- [项目简介](#项目简介)
- [核心能力](#核心能力)
- [技术栈](#技术栈)
- [获取与安装](#获取与安装)
- [从源码运行](#从源码运行)
- [使用流程](#使用流程)
- [数据、隐私与版权](#数据隐私与版权)
- [开发文档](#开发文档)
- [路线图](#路线图)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

## 项目简介

KyStudy 的目标不是记录更多数据，而是减少备考中重复、麻烦、容易拖延的准备工作：

- 把长期目标和节奏整理成可确认的学习计划；
- 从多本习题册和指定范围中挑出今天该复习的题；
- 保存题目区域、作答记录和错题反馈，避免反复翻找 PDF；
- 在需要时使用本地 OCR 或用户主动触发的 AI 辅助整理资料。

产品原则是：**输入目标和节奏，系统自动安排；打开软件，只处理今天。**

## 核心能力

| 模块         | 能力                                                 |
| ------------ | ---------------------------------------------------- |
| 今日与计划   | 今日任务、周期计划、阶段展开、进度与逾期处理         |
| 习题册与组卷 | 导入 PDF、题目区域、题型/章节/习题册范围、拼卷与恢复 |
| 错题复习     | 掌握/模糊/不会反馈、可解释复习队列、未完成题顺延     |
| 资料阅读     | PDF 阅读、页码回跳、全文索引、规划资料引用           |
| OCR          | 可选本地 OCR 组件，按需启动、可取消、结果需人工确认  |
| 思维导图     | XMind、FreeMind、OPML 导入，浏览、搜索和有限编辑     |
| AI 辅助      | 用户主动触发、外发范围预览、Token 预算和本地缓存     |
| 数据安全     | 本地 SQLite、Blob 文件库、完整备份和恢复副本         |

首版不会内置受版权保护的题库、试卷或学习资料，用户需要导入自己有权使用的文件。

## 技术栈

- [Tauri 2](https://tauri.app/) + Rust
- React 19 + TypeScript 6 + Vite 8
- SQLite（本地数据库）
- PDF.js（PDF 阅读与文字层）
- 可选 RapidOCR / ONNX Runtime 本地组件
- Vitest、ESLint、Prettier、Cargo fmt、Clippy

## 获取与安装

### 普通用户

从 [GitHub Releases](https://github.com/Trey5-7e/KyStudy/releases) 下载 Windows x64 发行包：

1. **NSIS 安装包**：推荐使用，默认按当前用户安装，不需要管理员权限；
2. **ZIP 便携版**：解压后运行 kystudy.exe，适合临时使用或手动管理目录。

安装包不包含用户工作区、PDF、题目图片或 API Key。用户数据默认保存在 Windows 应用数据目录，升级前建议先使用应用内备份。

### 首版边界

- 支持：Windows 10/11 x64；
- 许可证：[GPL-3.0-only](LICENSE)；
- 暂不提供：macOS/Linux 包、移动端、自动更新服务、云端账号和多设备同步；
- 在线 OCR 下载已配置为公开 HTTPS Release 资产，并在构建时写入 SHA-256；本地安装仍可作为兜底路径。

## 从源码运行

### 环境要求

| 工具                      | 版本                           |
| ------------------------- | ------------------------------ |
| Windows                   | 10/11 x64                      |
| Node.js                   | 22.18.0 或更高版本             |
| pnpm                      | 11.9.0                         |
| Rust                      | 1.97.1，x86_64-pc-windows-msvc |
| Visual Studio Build Tools | 含 MSVC 与 Windows SDK         |
| Edge WebView2 Runtime     | Windows 桌面运行所需           |

详细环境说明见 [docs/DEVELOPMENT_SETUP.md](docs/DEVELOPMENT_SETUP.md)。

### 安装依赖与开发

```powershell
git clone https://github.com/Trey5-7e/KyStudy.git
cd KyStudy
pnpm install --frozen-lockfile
pnpm dev
```

### 质量检查

```powershell
pnpm check
cargo fmt --check --manifest-path src-tauri\Cargo.toml
cargo test --locked --manifest-path src-tauri\Cargo.toml
cargo clippy --all-targets --all-features --locked --manifest-path src-tauri\Cargo.toml -- -D warnings
```

### 构建 Windows 发布包

```powershell
pnpm tauri build
pnpm package:windows-portable
```

NSIS 安装包输出到 src-tauri\target\release\bundle\nsis\，便携版输出到 artifacts\kystudy-windows-x64-portable.zip。构建与打包不应自动启动桌面程序。

## 使用流程

1. 在“资料”导入规划 PDF、图片或习题册；
2. 在“计划”创建或确认学习阶段和执行节奏；
3. 在“习题册”校对题目区域，按习题册、章节、题型和题号范围组卷；
4. 在“今日”处理当天学习任务和错题队列；
5. 使用掌握反馈、进度统计和备份恢复保持长期可追踪。

AI 只在用户主动触发时调用。规划结果先作为草案展示，确认后才进入正式计划；AI 不直接覆盖用户数据。

## 数据、隐私与版权

- PDF、题目区域、导图、笔记和用户数据默认只保存在本地；
- API Key 存在 Windows 安全凭据存储中，不进入 SQLite、备份、日志或诊断文件；
- AI 调用前展示拟发送的资料片段，未经用户触发不会上传学习资料；
- 开源仓库和示例数据不包含完整试卷、习题册扫描件或个人学习数据；
- Issue、Pull Request、提交记录和截图中不得上传密钥、个人路径或受版权保护的资料。

## 开发文档

- [v0.1.0 开发交接文档](docs/V0_1_0_DEVELOPMENT_HANDOFF.md)
- [v0.1.0 最终验收记录](docs/V0_1_0_FINAL_ACCEPTANCE.md)
- [精简开发流程](docs/DEVELOPMENT_WORKFLOW.md)
- [开发环境与依赖说明](docs/DEVELOPMENT_SETUP.md)
- [产品需求文档](docs/PRD.md)
- [页面信息架构](docs/INFORMATION_ARCHITECTURE.md)
- [依赖许可证审计](docs/DEPENDENCY_LICENSES.md)
- [OCR 组件管理验收](docs/R50_OCR_COMPONENT_MANAGEMENT_ACCEPTANCE.md)
- [OCR 在线下载与发布边界](docs/R52_OCR_COMPONENT_PACKAGING_ACCEPTANCE.md)

历史里程碑与 R1–R65 验收记录继续保留在 docs/，用于追溯行为契约和测试证据。

## 路线图

### v0.1.0 发布闭环

- [x] 当前功能、自动门禁和发布候选构建
- [x] GPL 许可证、Windows NSIS 和 ZIP 便携版配置
- [x] OCR 组件 ZIP 公开 Release、SHA-256 校验和在线下载构建
- [ ] 项目维护者完成隔离环境桌面验收
- [ ] 从干净提交创建 v0.1.0 标签并发布 GitHub Release

### v0.1.0 之后

后续开发按四个严格阶段推进：先稳定与反馈，再围绕真实使用数据优化核心学习闭环，之后才评估扩展能力。首版发布前不新增产品模块。

## 贡献指南

欢迎提交问题、可复现步骤、改进建议和代码贡献：

1. 先搜索已有 [Issues](https://github.com/Trey5-7e/KyStudy/issues)；
2. 不要上传完整教材、试卷、题库、个人数据库或 API Key；
3. 功能改动请同步测试和必要文档；
4. 提交前运行前端与 Rust 质量检查；
5. Pull Request 中说明用户影响、兼容性和验收方式。

## 项目图标

docs/branding/kystudy-icon-concept-v4-transparent-tight.png 是当前裁掉多余留白的透明背景项目图标候选，不代表最终品牌定稿。确认视觉方案后，再将其转换为 Windows 多尺寸 ICO 并接入 Tauri 图标资源。

## 许可证

KyStudy 使用 [GNU General Public License v3.0 only](LICENSE)。任何人都可以免费使用、修改和商用，但分发修改版时必须继续提供对应源码并保留许可证声明。

## 致谢

- README 结构参考 [Best-README-Template](https://github.com/othneildrew/Best-README-Template)；
- 感谢 Tauri、React、Vite、PDF.js、SQLite、Vitest 及其贡献者；
- 感谢所有通过 Issue 和验收反馈帮助改进 KyStudy 的用户。

<p align="right"><a href="#readme-top">返回顶部</a></p>
