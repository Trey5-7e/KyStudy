# KyStudy 文档导航

欢迎查阅 KyStudy 开发者与架构文档库。本目录收录了项目的核心需求、系统架构设计、开发规范及架构决策记录。

## 1. 核心设计与架构

- [产品需求文档 (PRD)](PRD.md)：核心产品理念、考研业务目标、功能边界与非功能要求。
- [系统数据模型](DATA_MODEL.md)：本地 SQLite 数据库架构、表结构设计、实体关系与迁移策略。
- [页面信息架构](INFORMATION_ARCHITECTURE.md)：界面层级结构、视图与导航模型、交互状态定义。
- [架构决策记录 (ADR)](adr/README.md)：系统重大架构决策与技术选型记录（ADR-001 ~ ADR-006）。

## 2. 开发与工作流

- [开发环境与依赖说明](DEVELOPMENT_SETUP.md)：Windows 本地构建依赖（Rust、Node.js、pnpm、MSVC 等）与快速上手指南。
- [开发工作流与质量门禁](DEVELOPMENT_WORKFLOW.md)：Git 分支管理、代码风格规范、测试要求与发布门禁。
- [浏览器 UI 预览工作流](CODEX_IN_APP_BROWSER_UI_WORKFLOW.md)：基于合成 Fixture 的前端页面快速预览与自检流程。
- [README 截图演示工作区](DEMO_SCREENSHOT_WORKSPACE.md)：README 与文档所用合成演示环境规范与截图流程。

## 3. 开源合规与资产

- [依赖许可证审计](DEPENDENCY_LICENSES.md)：全量前端与 Rust 核心依赖的开源许可证说明与合规审计记录。
- [静态资产与品牌](branding/kystudy-icon-concept-v4-transparent-tight.png)：项目官方图标与视觉资源。
- [演示截图](screenshots/demo-workspace/README.md)：公开展示的各模块界面效果图。
