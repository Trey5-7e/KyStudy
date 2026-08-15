# KyStudy 前端 UI / UX 深度整改执行文档

> 适用对象：Codex / AI Coding Agent
> 项目：KyStudy
> 技术栈：React 19 + TypeScript + Vite + Tauri 2
> 文档用途：作为本轮 UI / UX、前端架构与交互一致性整改的总执行规范
> 核心要求：**在保留现有业务能力和 KyStudy 视觉识别的前提下，进行系统性重构，而不是做表面换皮。**

---

## 0. Codex 执行总则

你正在整改的是一个已经具有较完整业务能力的学习工作台，而不是从零搭建 Demo。

本次工作的目标不是“把界面改成 shadcn 风格”，也不是“大量引入第三方 UI 库”，而是：

1. 建立稳定、统一、可维护的 KyStudy UI 系统；
2. 清理当前 `app.css` 的级联债务和大量硬编码样式；
3. 减少“Card Everywhere（卡片套卡片）”；
4. 对超大型功能组件进行结构性拆分；
5. 让 Today、Planning、Question Bank、Library、Review 等核心页面形成清晰的信息层级；
6. 改善桌面端高密度使用场景；
7. 保持键盘、焦点、无障碍和 reduced-motion 行为；
8. 保持 Tauri 桌面端和 320px 窄屏的可用性；
9. 不破坏 PDF、OCR、索引、计划、错题、AI 等已有业务流程；
10. 所有整改必须以“可维护性 + 一致性 + 学习效率”为第一目标。

### 0.1 强制工作方式

不要一次性重写整个前端。

必须分阶段进行：

```text
Phase 0  建立基线、记录现状、确保测试通过
Phase 1  Design Tokens + UI Primitives
Phase 2  CSS 架构清理
Phase 3  App Shell / 页面骨架统一
Phase 4  Today
Phase 5  Planning / Planning Chat
Phase 6  Question Bank
Phase 7  Library / PDF Workspace
Phase 8  Review / Settings / 其它页面
Phase 9  Accessibility / Performance / Polish
Phase 10 最终回归与删除遗留样式
```

每个阶段完成后都要运行：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:css
pnpm build
```

如果某个命令因为项目现状本身存在历史问题无法通过，不允许直接忽略。必须：

1. 记录原始问题；
2. 区分“整改前已有”还是“本次引入”；
3. 本次引入的问题必须修复；
4. 不得以删除测试、放宽类型、添加 `any`、禁用 lint 等方式掩盖问题。

---

# 1. 当前前端基线

当前 KyStudy 已经具备较好的工程基础，但 UI 层开始出现明显的规模化维护问题。

## 1.1 技术栈

当前主要依赖：

```text
React 19
React DOM 19
TypeScript
Vite 8
Tauri 2
Mind Elixir
pdfjs-dist
Vitest
pnpm
```

当前没有：

```text
Tailwind CSS
大型 UI Component Library
React Router
完整 Design System
```

### 决策

**不要为了 UI 整改迁移 Tailwind。**

现有 CSS 体系已经形成自己的视觉语言，引入 Tailwind 会制造第二套样式系统，并显著增加迁移范围。

如果确实需要第三方无样式基础组件，优先级：

```text
Base UI
↓
Radix Primitives
↓
React Aria
```

这些库应只用于：

- Popover
- Dropdown Menu
- Select
- Combobox
- Tooltip
- Tabs
- Accessible primitive behaviors

不得因为使用这些库而替换 KyStudy 自己的视觉语言。

---

# 2. KyStudy 的目标视觉方向

本项目的设计方向定义为：

# Calm Study Workspace

关键词：

```text
Calm
Focused
Academic
Dense but readable
Quiet
Reliable
Local-first
Desktop productivity
```

不要做成：

```text
通用 SaaS Dashboard
Notion 克隆
shadcn 默认主题
企业后台
大面积渐变
玻璃拟态
高饱和 AI 产品
移动 App 放大版
```

---

# 3. 必须保留的视觉识别

当前项目已有比较明确的视觉基础：

```css
--app-bg: #f4f1e8;
--ink: #17231d;
--muted: #657269;
--primary: #1e5b42;
--accent: #d08a35;
```

整体视觉是：

```text
暖米色背景
+
深绿色主色
+
琥珀色强调
+
低饱和、阅读友好的学习环境
```

这是 KyStudy 的识别特征。

### 严禁

不要：

- 改成纯白 + 黑灰；
- 改成蓝紫 AI 风格；
- 全面替换为 shadcn 默认色；
- 到处加入渐变；
- 到处加入阴影；
- 每个区域都使用圆角卡片；
- 引入新的高饱和颜色体系。

---

# 4. Design Token 整改

当前 `app.css` 已经存在变量，但覆盖率不足，大量颜色仍然直接硬编码。

当前审计结果：

```text
app.css ≈ 8999 行
约 577 个 class
约 627 次十六进制颜色声明
约 249 个唯一 hex 色值
CSS variable 使用数量明显偏低
存在大量重复 media query
存在多处 selector 重复定义
存在 R34 / R38 等后期 cascade lock
```

这说明现在 CSS 已经产生明显级联债务。

---

## 4.1 建立 Token 层

建议建立：

```text
src/styles/
  tokens.css
  reset.css
  primitives.css
  utilities.css
```

或者与现有结构兼容的等价目录。

### tokens.css

至少包含：

```css
:root {
  /* Background */
  --color-bg-app: ...;
  --color-bg-surface: ...;
  --color-bg-subtle: ...;
  --color-bg-hover: ...;
  --color-bg-selected: ...;

  /* Text */
  --color-text-primary: ...;
  --color-text-secondary: ...;
  --color-text-muted: ...;
  --color-text-inverse: ...;

  /* Semantic */
  --color-primary: ...;
  --color-primary-hover: ...;
  --color-primary-soft: ...;

  --color-accent: ...;
  --color-accent-soft: ...;

  --color-success: ...;
  --color-warning: ...;
  --color-danger: ...;
  --color-info: ...;

  /* Border */
  --color-border-subtle: ...;
  --color-border-default: ...;
  --color-border-strong: ...;

  /* Radius */
  --radius-xs: ...;
  --radius-sm: ...;
  --radius-md: ...;
  --radius-lg: ...;

  /* Spacing */
  --space-1: ...;
  --space-2: ...;
  --space-3: ...;
  --space-4: ...;
  --space-5: ...;
  --space-6: ...;
  --space-8: ...;

  /* Typography */
  --font-size-xs: ...;
  --font-size-sm: ...;
  --font-size-md: ...;
  --font-size-lg: ...;
  --font-size-xl: ...;

  /* Elevation */
  --shadow-popup: ...;
  --shadow-dialog: ...;

  /* Layout */
  --sidebar-width: ...;
  --content-width-default: ...;
  --content-width-wide: ...;
}
```

### 规则

整改后：

> 新增 UI 不允许直接写新的 hex / rgb 颜色。

除特殊 SVG / canvas / PDF overlay 外，所有 UI 色彩通过 token。

---

# 5. UI Primitive 系统

项目已经存在：

```text
PageHeader
PageSurface
PageStatus
PageEmpty
EditorDialog
```

这些不是要删除，而是作为 KyStudy UI Kit 的起点。

建议扩展：

```text
src/shared/ui/
  Button.tsx
  IconButton.tsx
  Badge.tsx
  Chip.tsx
  Field.tsx
  Input.tsx
  Textarea.tsx
  Select.tsx
  Toolbar.tsx
  Tabs.tsx
  SegmentedControl.tsx
  PageHeader.tsx
  Surface.tsx
  StatusBanner.tsx
  EmptyState.tsx
  SectionHeader.tsx
  Divider.tsx
  Dialog.tsx
```

不要求一次全部建立。

先做当前高频组件。

---

# 6. Button 系统必须优先整改

当前全局 CSS 对：

```css
button { ... }
```

直接施加了明显的 primary button 外观。

结果是：

> 原生 button 默认就变成高权重绿色按钮。

这会导致页面中：

- 普通操作
- 次要操作
- toolbar
- icon action
- dialog action

全部产生视觉权重混乱。

---

## 6.1 新 Button API

至少支持：

```tsx
<Button variant="primary" />
<Button variant="secondary" />
<Button variant="ghost" />
<Button variant="danger" />
<Button variant="text" />
```

以及：

```tsx
<IconButton />
```

尺寸：

```text
sm
md
lg
```

### 约束

Primary button 每个视觉区域原则上只允许一个。

典型层级：

```text
primary
  当前最重要动作

secondary
  普通操作

ghost
  toolbar / navigation / inline action

danger
  删除等破坏性操作
```

---

# 7. Form Control 系统

当前：

```css
input,
select,
textarea
```

也存在比较强的全局视觉样式。

整改为：

```text
Field
Input
Select
Textarea
Checkbox
```

建议：

```tsx
<Field
  label="..."
  description="..."
  error="..."
>
  <Input />
</Field>
```

必须统一：

```text
height
border
focus ring
disabled
error state
placeholder
label spacing
description text
```

不得每个 feature 自己重新设计输入框。

---

# 8. Card Everywhere 问题

当前后期 CSS 已经开始通过特殊规则：

```text
flatten nested cards
remove double borders
remove repeated surfaces
```

这说明页面已经出现：

```text
PageSurface
  Card
    Card
      Card
```

这种结构。

新的设计原则：

# One Main Surface

页面默认：

```text
App Background
└─ Main Page Surface
   ├─ Header
   ├─ Toolbar
   ├─ Section
   ├─ Divider
   ├─ Section
   └─ Section
```

只有真正独立的实体才使用 Card。

例如：

```text
任务
错题
资源
AI 对话
统计实体
```

而不是：

```text
任何 section 都变成 card
```

---

# 9. 页面骨架统一

建议统一页面结构：

```tsx
<PageLayout>
  <PageHeader />

  <PageToolbar />

  <PageBody>
    ...
  </PageBody>
</PageLayout>
```

页面宽度分成：

```text
default
wide
full
```

当前 Workbook / Review 已经存在 wide view 逻辑，可以保留并统一。

---

# 10. App Shell

当前 App.tsx 的顶层视图：

```text
Today
Schedule
Planning
Library
Workbook
Review
Settings
```

当前自定义 hash navigation 对这个规模是足够的。

### 本轮不要优先迁移 React Router

除非后续明确需要：

```text
deep link
nested routes
URL-driven state
browser-style navigation
```

否则不要为了技术“先进”引入额外复杂度。

---

# 11. Sidebar

当前 sidebar 信息架构总体合理。

优化重点不是大改导航，而是：

1. 强化 active state；
2. 减少视觉噪音；
3. 图标 / 文字 / 描述统一；
4. 设置与主要学习流程保持层级差异；
5. 宽度保持稳定；
6. 不要过多动画；
7. 窄屏下折叠逻辑必须稳定。

主导航顺序继续保持学习流程导向：

```text
今日
计划
习题册
错题
资料
```

设置放底部。

---

# 12. Today 页面整改

Today 不应该继续走 Dashboard 思路。

它应该成为：

# Focus View

用户打开应用后最重要的问题是：

> 我现在应该学什么？

而不是：

> 我有多少个统计卡片？

---

## 12.1 建议信息层级

```text
今日

8 月 11 日
距考试 X 天

┌──────────────────────────────┐
│ 下一项                        │
│ 数学 · 高数强化               │
│ 45 min                        │
│                 [开始学习]    │
└──────────────────────────────┘

今日进度
██████████░░░░

接下来
□ 英语阅读
□ 数学错题
□ 专业课

错题待复习
12

今日剩余
3h 20m
```

重点：

```text
下一行动 > 今日进度 > 待办 > 辅助统计
```

不要让所有模块等权。

---

# 13. Planning 页面整改

Planning 是一个长期规划工作区。

设计参考可以借鉴 Plane 的：

```text
Cycle
Work Item
Progress
Filter
View
Hierarchy
```

但只借鉴信息架构，不复制其视觉系统。

规划页面应突出：

```text
当前周期
当前阶段
目标
任务
进度
时间
```

---

# 14. PlanningChatPanel 深度整改

当前 PlanningChatPanel 功能很多：

```text
会话
历史消息
资源搜索
上下文选择
Prompt
Token limit
Prompt preview
确认
执行
引用来源
保存到计划
```

当前问题不是功能不足，而是：

> 所有步骤垂直堆叠在一个页面中。

这导致界面越来越长。

---

## 14.1 推荐桌面布局

```text
┌──────────────┬────────────────────────┬─────────────────────┐
│ Conversations│ Thread                 │ Context             │
│              │                        │                     │
│ + New        │ User                   │ Search resources    │
│ Chat A       │ Assistant              │ Selected context    │
│ Chat B       │ Assistant              │ Sources             │
│              │                        │                     │
│              │                        │                     │
├──────────────┴────────────────────────┴─────────────────────┤
│ Selected context chips                                    │
│ Ask AI...                                      [Send]      │
└────────────────────────────────────────────────────────────┘
```

窄屏：

```text
Thread
+
Context Drawer
```

---

## 14.2 Composer

Composer 固定在 thread 底部。

选中的 context：

```text
[数学.pdf p.12 ×]
[计划.md ×]
```

以 Chip 形式显示。

不要重复占据大面积区域。

---

## 14.3 Prompt Preview

当前完整 prompt preview 不应一直占据主页面高度。

改为：

```text
发送
↓
Preview / Confirmation Sheet
↓
显示：
  Destination
  Token estimate
  Context
  Prompt preview
  Explicit confirmation
↓
Confirm
```

可以使用 Dialog / Drawer / Expandable Panel。

---

## 14.4 AI UI 参考

可研究：

```text
assistant-ui
```

重点借鉴：

```text
Thread
Message
Composer
ThreadList
ActionBar
Source display
Retry
Streaming state
Autoscroll
Keyboard interactions
```

不要求整体迁移。

优先抽象自己项目已有业务需要。

---

# 15. QuestionBankPanel：最高优先级结构重构

当前 QuestionBankPanel 超过 3000 行，并且包含大量状态。

现状大致同时负责：

```text
bank snapshot
subjects
resources
timezone
loading
refresh
request lifecycle
dialogs
window state
trash
restore
segment manager
import
indexing
manual indexing
PDF
OCR
generated paper
practice attempts
focus restoration
```

这是一个：

# Feature Application

而不是普通 React Component。

---

## 15.1 必须拆分

建议目录：

```text
src/features/workbook/question-bank/
  QuestionBankPage.tsx

  components/
    QuestionBankToolbar.tsx
    QuestionBankHome.tsx
    SubjectSection.tsx
    WorkbookSection.tsx
    QuestionList.tsx
    QuestionCard.tsx
    GeneratedPaper.tsx

  trash/
    QuestionTrashPanel.tsx

  indexing/
    IndexingPanel.tsx
    ManualIndexDialog.tsx

  import/
    ImportDialog.tsx

  hooks/
    useQuestionBank.ts
    useQuestionBankWindow.ts
    useQuestionBankRefresh.ts
    useQuestionSelection.ts

  state/
    questionBankReducer.ts

  question-bank.css
```

目录名称可以根据项目实际结构调整，但职责拆分原则必须保留。

---

## 15.2 状态管理

不要因为状态很多就直接引入 Redux。

第一步：

```text
useState
↓
grouped useReducer
↓
domain hooks
```

例如：

```ts
type QuestionBankUiState = {
  activeWindow: ...
  selectedQuestionId: ...
  selectedSubjectId: ...
  dialog: ...
  filter: ...
}
```

---

## 15.3 XState 的使用边界

XState 可以考虑用于真正的 workflow：

```text
idle
→ selecting
→ preview
→ confirmed
→ executing
→ success / error
```

例如：

```text
OCR
Import
AI confirmation
Index generation
Multi-step creation
```

但不要：

```text
把整个 App 全部迁移到 XState
```

---

# 16. Question Bank UI

题库不是 Dashboard。

适合：

# Master / Detail Workspace

示例：

```text
┌──────────────────────────────────────────────────────┐
│ 题库    [Subject ▼] [Filter]          [Import] [+]  │
├──────────────────┬───────────────────────────────────┤
│ Questions        │ Question Detail                   │
│                  │                                   │
│ 001 极限          │ #001                              │
│ 002 微分          │ Question / PDF Region             │
│ 003 积分          │                                   │
│                  │ Tags                              │
│                  │ Practice                          │
│                  │ Review history                    │
└──────────────────┴───────────────────────────────────┘
```

避免：

```text
一个题目 = 一个大 Card
每个属性 = 一个 Card
每个操作 = 一个 Card
```

---

# 17. 大列表性能

题库、资源、计划、错题等列表如果数量可能达到数百或数千：

建议引入：

```text
TanStack Virtual
```

适合：

```text
Question list
Resource list
Review history
Long conversation
```

不要过早虚拟化：

```text
只有十几个元素的小列表
```

---

# 18. Library 页面

Library 不应该只是文件管理器。

KyStudy 的 Library 本质是：

# Learning Knowledge Workspace

它包含：

```text
PDF
Image
Mind Map
Indexed content
Search
AI Context
```

可以参考：

```text
AFFiNE
AppFlowy
```

主要借鉴：

```text
workspace information architecture
document hierarchy
quick switch
resource metadata
split view
context actions
```

不借鉴其技术栈。

---

# 19. Library 推荐结构

```text
┌─────────────────────────────────────────────────────┐
│ 资料   [Search...]                 [Import Resource]│
├─────────────────┬───────────────────────────────────┤
│ Resource list   │ Preview / Metadata                │
│                 │                                   │
│ PDF             │ title                             │
│ Images          │ tags                              │
│ Mind Maps       │ index status                      │
│                 │ related content                   │
│                 │ open / search / use as context    │
└─────────────────┴───────────────────────────────────┘
```

---

# 20. PDF Reader

当前项目 PDF Reader 已经有比较深的定制：

```text
pdfjs
range source
render coordinator
region selection
region capture
zoom
rotation
pointer selection
drag / resize
keyboard adjustment
overlay
progress
```

因此：

# 不要替换成 react-pdf

因为这很可能破坏：

```text
range loading
custom selection
capture
region coordinate
render control
```

---

## 20.1 可以参考

研究：

```text
react-pdf-highlighter-extended
```

重点借鉴：

```text
highlight architecture
viewport coordinate
scaled coordinate
annotation overlay
selection UX
context-based highlight rendering
```

只借鉴架构与交互模式。

---

# 21. Review 页面

Review 的核心应该是：

```text
当前需要复习的题
↓
题目
↓
自己的回答 / 错误
↓
AI 分析
↓
再练
```

而不是展示大量独立统计 Card。

推荐层级：

```text
Review Queue
↓
Current Question
↓
Evidence / Original Region
↓
AI Analysis
↓
Actions
```

---

# 22. Settings 页面

SettingsPanel 当前 Tabs 的键盘处理已经比较完整。

不要为了统一而破坏已有：

```text
role="tablist"
role="tab"
aria-controls
ArrowLeft / ArrowRight
Home / End
focus handling
```

整改重点：

```text
视觉统一
section spacing
field system
status banner
减少 card nesting
```

而不是重写交互逻辑。

---

# 23. Dialog 系统

现有 `EditorDialog.tsx` 已经处理：

```text
native dialog
scroll lock
dirty confirmation
focus restore
initial focus
backdrop
cancel
inert
```

这是一个相对成熟的基础设施。

不要为了使用 Radix / Base UI 就直接删除。

原则：

```text
现有 EditorDialog
→ 保留

新出现的复杂：
Popover
Combobox
Menu
Tooltip
Select
→ 可以考虑 Base UI / Radix
```

---

# 24. CSS 文件拆分

当前 8999 行单文件 `app.css` 已经不适合继续增长。

目标不是机械地每个组件一个 CSS。

建议：

```text
src/styles/
  tokens.css
  reset.css
  app-shell.css
  primitives.css

src/features/today/
  today.css

src/features/planning/
  planning.css

src/features/workbook/
  workbook.css

src/features/review/
  review.css

src/features/library/
  library.css

src/features/settings/
  settings.css
```

---

## 24.1 迁移策略

不要：

```text
一次性把 9000 行全部搬完
```

要：

```text
修改某 feature
↓
同步迁移该 feature 的 CSS
↓
删除 app.css 对应旧 selector
```

最终让 `app.css` 逐步缩小。

---

# 25. CSS Cascade Debt 清理

当前存在多个重复 selector 和后期 cascade lock。

整改时：

1. 找到 selector 首次定义；
2. 找到所有后续 override；
3. 确认最终实际效果；
4. 合并成唯一来源；
5. 删除历史 override；
6. 重新运行 `audit:css`。

目标：

```text
同一个组件的核心 selector
应该只存在一个主要定义位置
```

媒体查询 override 除外。

---

# 26. Responsive 策略

当前存在大量：

```text
max-width: 640px
680px
900px
320px
```

等重复断点。

统一断点 token 或约定：

```text
small
medium
large
```

例如：

```css
@custom-media --screen-sm (max-width: 640px);
```

如果当前工具链不适合 custom media，就至少写进 CSS 规范：

```text
320
640
900
```

减少任意 breakpoint。

---

# 27. Accessibility 不允许回退

项目已经存在：

```text
skip link
focus-visible
ARIA
reduced motion
dialog focus management
keyboard tabs
```

这些必须保留。

---

## 27.1 所有新组件检查

Button：

```text
keyboard
focus-visible
disabled
aria-label for icon-only
```

Dialog：

```text
focus trap / native modal semantics
restore focus
ESC
backdrop
```

Tabs：

```text
arrow keys
aria-selected
aria-controls
```

List：

```text
keyboard reachable actions
selected state
```

---

# 28. prefers-reduced-motion

当前项目已经支持 reduced-motion。

所有新动画必须：

```css
@media (prefers-reduced-motion: reduce) {
  ...
}
```

原则：

```text
动画用于状态理解
不是装饰
```

避免：

```text
页面进入飞入
大面积 scale
持续呼吸
无意义 shimmer
```

---

# 29. 动效标准

允许：

```text
hover 100–150ms
popover 120–180ms
dialog fade
selected state transition
```

避免：

```text
300ms+
复杂 spring
大幅位移
```

学习工具需要安静。

---

# 30. Typography

当前字体：

```text
Inter
Noto Sans SC
Microsoft YaHei
system
```

保持。

建立统一 typography scale。

例如：

```text
Page Title
Section Title
Body
Secondary
Caption
Label
```

不要 feature 自己写：

```text
font-size: 0.93rem
0.91rem
0.89rem
0.87rem
```

形成随机字号。

---

# 31. Density

KyStudy 是桌面学习生产力工具。

因此：

# 不要做成大尺寸移动 UI

建议：

```text
默认 control 高度：32–36px
主要 CTA：36–40px
toolbar：紧凑
列表 row：36–48px
```

而不是：

```text
48–56px 到处都是
```

---

# 32. 状态反馈

统一状态：

```text
loading
empty
error
warning
success
offline / stale
```

现有 `PageStatus` 可以继续扩展。

原则：

```text
页面级错误 → StatusBanner
局部字段错误 → Field error
后台 refresh → subtle indicator
空数据 → EmptyState
```

不要所有状态都变 toast。

---

# 33. Toast 的使用

只有：

```text
操作成功
短暂确认
异步操作完成
```

使用 toast。

不要：

```text
长错误说明
需要用户操作的问题
危险确认
```

这些必须留在 UI 内。

---

# 34. Loading

优先：

```text
保留布局
inline loading
progress
skeleton only where useful
```

避免：

```text
整个页面不断 spinner
```

---

# 35. 数据密集型 UI

可以参考 Twenty 的数据密集型界面。

主要借鉴：

```text
dense row
toolbar
filter
column hierarchy
inline action
progressive disclosure
```

不需要引入其技术栈。

---

# 36. 第三方开源项目采用策略

## 推荐直接考虑采用

### Base UI

用途：

```text
Popover
Menu
Select
Combobox
Tooltip
Tabs
```

优点：

```text
unstyled
accessible
React-native design-system friendly
```

非常适合 KyStudy。

---

### TanStack Virtual

用途：

```text
大列表
```

---

## 推荐参考 / 局部采用

### assistant-ui

用于：

```text
Planning Chat
AI Thread
Composer
Sources
Action bar
```

---

### react-pdf-highlighter-extended

用于：

```text
PDF annotation / selection architecture
```

---

### XState

用于：

```text
复杂 workflow
```

---

## 主要作为设计参考

```text
Plane
AFFiNE
AppFlowy
Twenty
LobeHub
Open WebUI
shadcn/ui
```

---

# 37. shadcn/ui 使用原则

可以：

```text
研究 Button API
研究 Form pattern
研究 Dialog hierarchy
研究 Command palette
研究 empty state
```

不要：

```text
复制默认主题
复制 Tailwind
全项目迁移
把 KyStudy 做成 shadcn demo
```

---

# 38. 代码层重构优先级

根据当前文件规模：

```text
QuestionBankPanel.tsx    ≈ 3456 lines
CyclePlanPanel.tsx       ≈ 1869
ReviewPanel.tsx          ≈ 1376
WorkbookPanel.tsx        ≈ 1361
QuestionIndexDialogs.tsx ≈ 1217
AiFoundationPanel.tsx    ≈ 1211
TodayOverviewPanel.tsx   ≈ 871
```

这些都需要逐步拆分。

---

# 39. Component Size Rule

不是强制行数限制，但作为 warning：

```text
> 400 lines
检查是否职责过多

> 700 lines
强烈考虑拆分

> 1000 lines
原则上必须说明为什么不能拆
```

---

# 40. Hook / State Rule

如果出现：

```text
10+
15+
20+
```

大量独立 `useState`：

必须检查：

```text
是否可以 reducer
是否可以 domain hook
是否存在 workflow state
是否可以 derived state
```

不要机械把 state 移到另一个文件。

目标是：

```text
业务职责分离
```

不是：

```text
代码搬家
```

---

# 41. Feature Component 标准结构

理想结构：

```tsx
function FeaturePage() {
  const model = useFeatureModel();

  return (
    <PageLayout>
      <FeatureHeader />
      <FeatureToolbar />
      <FeatureContent model={model} />
    </PageLayout>
  );
}
```

而不是：

```tsx
function FeaturePage() {
  // 60 useState
  // 20 effects
  // 40 handlers
  // 2000 lines JSX
}
```

---

# 42. 不要过度抽象

整改中禁止制造：

```text
UniversalPanel
GenericWidget
SmartContainer
ConfigurableCard
```

这种为了复用而复用的抽象。

优先：

```text
清晰
稳定
显式
```

只有真实重复出现 3 次以上的 UI 行为再抽象。

---

# 43. 命名规范

禁止：

```text
box1
wrapper2
section-new
final-card
fixed-panel
r38-layout
```

推荐：

```text
question-bank-toolbar
planning-chat-thread
resource-metadata-panel
today-next-action
```

CSS 名称表达语义。

---

# 44. CSS Specificity

避免：

```css
.app .page .panel .card .button span
```

尽量：

```css
.question-bank-toolbar {}
```

CSS 不允许靠不断增加 specificity 修 bug。

---

# 45. `!important`

新代码原则上禁止 `!important`。

如果必须使用：

必须写注释说明：

```text
为什么无法通过正常层级解决
```

最终整改目标应尽量减少已有 `!important`。

---

# 46. Performance

当前已有：

```text
lazy views
Suspense
content-visibility
```

继续保持。

重点检查：

```text
大 list re-render
PDF re-render
mindmap rerender
AI message rerender
question bank state mutation
```

---

# 47. React 性能原则

不要无脑：

```text
useMemo everything
useCallback everything
```

优先：

```text
正确 state boundary
component split
stable domain model
list virtualization
```

再考虑 memo。

---

# 48. AI 功能视觉规范

AI 不要成为全局视觉主角。

不要：

```text
紫色
渐变
闪烁
AI glow
```

AI 应该是学习流程中的工具。

例如：

```text
Ask AI
Explain
Analyze
Generate Plan
```

视觉权重依赖动作本身，而不是“AI 品牌”。

---

# 49. Destructive Action

删除：

```text
默认不要红色大按钮
```

只在真正危险操作中使用 danger。

Trash / Restore 要区分。

批量删除必须明确：

```text
selection count
scope
confirmation
```

---

# 50. Empty State

统一：

```tsx
<PageEmpty
  title="还没有错题"
  description="完成练习后，错误题目会出现在这里。"
/>
```

避免：

```text
单纯“暂无数据”
```

---

# 51. Toolbar

高密度页面优先使用 Toolbar：

```text
Title
Filter
Search
Sort
View
Primary Action
```

而不是：

```text
上面一排 Card
下面一排 Button
```

---

# 52. Search

搜索框：

```text
放在用户正在浏览的对象附近
```

例如：

```text
Question list → question search
Library → resource search
Planning chat context → resource search
```

不要所有搜索都放 page header。

---

# 53. Progressive Disclosure

复杂能力隐藏到：

```text
More
Advanced
Context
Details
```

不要初始全部展开。

尤其：

```text
AI prompt preview
token limit
manual indexing
advanced PDF operations
debug/status
```

---

# 54. Phase 0：建立基线

Codex 首先执行：

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:css
pnpm build
```

记录结果。

创建：

```text
docs/ui-refactor-baseline.md
```

内容：

```text
tests baseline
known issues
CSS audit baseline
largest components
current screenshots if available
```

---

# 55. Phase 1：Design Tokens + Primitives

优先完成：

```text
tokens
Button
IconButton
Field
Input
Textarea
Badge
Chip
Toolbar
SectionHeader
StatusBanner
```

然后选 1–2 个低风险页面迁移验证。

建议：

```text
Settings
Today
```

---

# 56. Phase 2：CSS 清理

开始：

```text
app.css
↓
styles/
features/
```

先清：

```text
global button
global input
duplicate selectors
hardcoded colors
```

---

# 57. Phase 3：App Shell

统一：

```text
PageLayout
PageHeader
PageToolbar
PageBody
Page width
Spacing
```

避免各 feature 自定义 page margin。

---

# 58. Phase 4：Today

目标：

```text
Focus View
```

验收：

- 第一屏可以立即知道下一项学习任务；
- 主要 CTA 唯一；
- 今日进度清楚；
- 辅助统计降权；
- 不出现多层 Card；
- 320px 无横向滚动。

---

# 59. Phase 5：Planning

拆：

```text
CyclePlan
PersonalPlan
Progress
Schedule
AI
```

但保持统一 planning workspace。

---

# 60. Phase 5.1：Planning Chat

实现：

```text
conversation rail
thread
context panel / drawer
sticky composer
context chips
preview confirmation dialog
```

保证所有原业务能力完整。

---

# 61. Phase 6：Question Bank

这是最重要的一轮。

第一目标不是改颜色。

第一目标：

```text
拆职责
减少状态混乱
建立 master-detail UI
统一 toolbar/list/detail
```

---

# 62. Phase 7：Library

建立：

```text
resource list
preview
metadata
actions
search
index state
```

---

# 63. Phase 7.1：PDF

保持底层 engine。

只调整：

```text
toolbar
region interaction
annotation UI
progress
metadata
empty/error
```

---

# 64. Phase 8：Review

整理：

```text
queue
current question
region
analysis
actions
```

降低其它统计信息权重。

---

# 65. Phase 8.1：Settings

统一 UI primitives。

保留现有 accessibility 行为。

---

# 66. Phase 9：全局 Accessibility Audit

检查：

```text
keyboard-only navigation
focus
dialog
tabs
menus
combobox
icon buttons
screen reader labels
reduced motion
contrast
```

---

# 67. Phase 9.1：Performance

测试：

```text
500 questions
1000 resources
long AI conversation
PDF 100+ pages
review queue
```

根据真实瓶颈决定是否虚拟化。

---

# 68. Phase 10：Final CSS Cleanup

目标：

```text
app.css 显著缩小
重复 selector 大幅下降
hardcoded colors 大幅下降
cascade lock 删除
feature CSS 可定位
```

运行：

```bash
pnpm audit:css
```

并与 Phase 0 对比。

---

# 69. Definition of Done

本轮 UI 深度整改完成时，至少满足：

## Design

- [ ] 保留 KyStudy 暖米色 + 深绿色 + 琥珀色身份
- [ ] 全局视觉层级一致
- [ ] 卡片嵌套明显减少
- [ ] Page / Section / Card 有明确边界
- [ ] 主要动作层级明确
- [ ] Typography 统一
- [ ] Spacing 统一

## Components

- [ ] Button primitive
- [ ] Field primitive
- [ ] Toolbar
- [ ] Chip / Badge
- [ ] Status / Empty
- [ ] Dialog 规范
- [ ] Tabs 规范

## CSS

- [ ] 不再依赖全局 button 作为 primary
- [ ] 不再依赖全局 input 负责所有 feature 视觉
- [ ] 新 UI 不写随机 hex
- [ ] duplicate selector 减少
- [ ] cascade lock 减少
- [ ] `app.css` 被拆分

## Architecture

- [ ] QuestionBankPanel 明显拆分
- [ ] CyclePlanPanel 明显拆分
- [ ] 超大组件状态职责减少
- [ ] domain hook / reducer 合理使用
- [ ] 不引入无必要的 Redux
- [ ] 不全局迁移 XState

## UX

- [ ] Today 是 Focus View
- [ ] PlanningChat 是 workspace，而不是长表单
- [ ] QuestionBank 是 master/detail workspace
- [ ] Library 是 knowledge workspace
- [ ] PDF 原有高级能力不回退
- [ ] Review 流程清楚

## Accessibility

- [ ] keyboard navigation
- [ ] focus-visible
- [ ] focus restore
- [ ] ARIA
- [ ] reduced-motion
- [ ] icon button labels

## Quality

- [ ] pnpm typecheck
- [ ] pnpm lint
- [ ] pnpm test
- [ ] pnpm audit:css
- [ ] pnpm build

---

# 70. 禁止事项

Codex 在整改过程中不得：

1. 一次性重写整个前端；
2. 删除业务功能以简化 UI；
3. 删除测试来让 CI 通过；
4. 使用 `any` 大面积绕过类型问题；
5. 全项目迁移 Tailwind；
6. 全项目迁移 shadcn；
7. 全项目迁移 Radix；
8. 替换现有 PDF engine；
9. 替换 Mind Elixir，除非存在明确 bug；
10. 为了 UI 重构改动后端协议；
11. 为了“现代化”引入无必要 Router；
12. 把所有状态迁移 Redux；
13. 把所有状态迁移 XState；
14. 删除现有 keyboard / accessibility 行为；
15. 引入新的随机颜色；
16. 大量增加阴影、渐变、动画；
17. 创建大量 Generic / Universal 抽象；
18. 在旧 CSS 后面继续追加“final fix”覆盖层。

---

# 71. Codex 决策原则

遇到不确定设计时：

优先顺序：

```text
1. Preserve functionality
2. Preserve accessibility
3. Preserve KyStudy identity
4. Improve hierarchy
5. Reduce complexity
6. Improve consistency
7. Improve visual polish
```

视觉“好看”不能排在功能与结构之前。

---

# 72. 推荐创建项目级 UI Skill

建议在 Codex 中创建：

```text
kystudy-ui/
  SKILL.md
  references/
    design-tokens.md
    component-guidelines.md
    accessibility.md
    layout-patterns.md
    feature-ui-map.md
  scripts/
    audit-ui.mjs
```

---

# 73. SKILL.md 应包含的规则

至少写入：

```text
Preserve KyStudy green / beige / amber identity.

Never introduce a new visual language without explicit reason.

Prefer existing KyStudy UI primitives.

Do not add hardcoded UI colors.

Avoid card-inside-card layouts.

Prefer workspace layouts for dense features.

Use explicit Button variants.

Preserve keyboard navigation.

Preserve focus behavior.

Respect prefers-reduced-motion.

Desktop-first but 320px-safe.

Do not rewrite PDF engine.

Refactor oversized feature components before adding more UI complexity.

After UI changes run:
pnpm typecheck
pnpm lint
pnpm test
pnpm audit:css
pnpm build
```

---

# 74. AGENTS.md 建议

项目根目录可以添加 / 修改：

```text
AGENTS.md
```

明确告诉 Codex：

```text
Before modifying UI:
1. Read kystudy-ui/SKILL.md
2. Follow project design tokens
3. Reuse shared primitives
4. Do not append cascade patches to app.css
5. Preserve accessibility
6. Run full validation
```

---

# 75. Codex 每个阶段输出格式

每完成一个 Phase，Codex 必须输出：

```text
## Changed

文件列表
+
核心变化

## Architecture

为什么这样拆分

## UX

用户体验改变

## Compatibility

哪些现有行为保持不变

## Validation

typecheck
lint
test
audit:css
build

## Remaining Debt

仍未处理的问题
```

---

# 76. 第一次执行时不要直接大改

第一次给 Codex 本文档后，要求它先：

```text
1. 阅读整个前端代码
2. 对照本文档验证每一条现状
3. 创建 ui-refactor-baseline
4. 给出 Phase 1–10 的实际文件级执行计划
5. 然后再开始 Phase 1
```

如果代码事实和本文档描述有出入：

> 以当前仓库实际代码为准。

但不得因此忽略本文档的设计原则。

---

# 77. 建议 Codex 首轮具体任务

第一轮只做：

```text
A. CSS / token baseline
B. Button primitive
C. Field primitive
D. Toolbar / SectionHeader
E. Page primitives 整理
F. Settings 页面迁移
G. Today 页面迁移
```

不要第一轮就进入 QuestionBank。

原因：

需要先验证：

```text
token
component API
spacing
visual hierarchy
responsive
```

确定 UI Kit 稳定后，再处理复杂模块。

---

# 78. 第二轮

```text
Planning
Planning Chat
Cycle Plan
Personal Plan
```

---

# 79. 第三轮

```text
Question Bank
Workbook
Indexing
OCR
Question dialogs
```

这是最大整改阶段。

---

# 80. 第四轮

```text
Library
PDF
Mind Map
Review
```

---

# 81. 第五轮

```text
CSS final cleanup
accessibility
performance
responsive
visual polish
```

---

# 82. 最终目标

KyStudy 最终应该呈现为：

```text
一个安静、高密度、结构清晰的个人学习工作台
```

而不是：

```text
由很多独立卡片拼成的 Dashboard
```

核心体验应该是：

```text
Today
→ 告诉我现在做什么

Planning
→ 告诉我未来怎么安排

Workbook
→ 让我高效做题

Review
→ 让我高效复盘

Library
→ 管理并调用我的学习资料

AI
→ 在正确的上下文中辅助，而不是抢占界面
```

---

# 83. 给 Codex 的最终指令

下面这段可以直接作为执行提示：

```text
你现在负责对 KyStudy 前端进行深度 UI / UX 和前端结构整改。

请先完整阅读《KyStudy 前端 UI / UX 深度整改执行文档》，然后阅读当前前端仓库。

不要立即进行全量修改。

第一步：
验证文档中描述的代码现状，并建立整改 baseline。

第二步：
给出实际仓库文件级的 Phase 1–10 执行计划。

第三步：
按照阶段逐步实施。

整个过程中必须满足：

- 不删除现有业务功能；
- 不改变后端协议；
- 不迁移 Tailwind；
- 不整体迁移 shadcn；
- 保留现有 KyStudy 暖米色、深绿色、琥珀色视觉语言；
- 优先清理 Design Token、UI Primitive、CSS cascade debt；
- 避免 card-inside-card；
- 优先 workspace UI；
- 保留 keyboard、focus、ARIA、reduced-motion；
- 不替换现有 PDF engine；
- 对 QuestionBankPanel、CyclePlanPanel 等超大型组件进行职责拆分；
- 不使用大量 any、lint disable 或删除测试来逃避问题。

每完成一个 Phase 都必须运行：

pnpm typecheck
pnpm lint
pnpm test
pnpm audit:css
pnpm build

并输出：
Changed / Architecture / UX / Compatibility / Validation / Remaining Debt。

如果本文档与当前代码存在冲突，以实际仓库代码事实为准，但必须遵循本文档的设计原则。

最终目标：
将 KyStudy 重构为一个 Calm Study Workspace：
安静、专注、高密度但易读、学术感、可靠、桌面生产力导向。
```

---

# 84. 结束标准

不要以：

```text
“所有页面看起来更现代了”
```

作为完成标准。

真正完成的标准是：

```text
视觉系统更统一
+
代码更容易继续开发
+
状态职责更明确
+
CSS 更可维护
+
复杂页面更容易理解
+
核心学习动作更突出
+
已有功能无回退
```

这才是本次整改的最终目标。
---

# 85. 基于当前桌面端截图的视觉审计

本节基于当前实际桌面端界面截图补充，不再只依据代码结构推断。

截图覆盖：

```text
今日
计划 / 月历
计划详情 Dialog
习题册
自动解析 PDF Dialog
题库工具 Dialog
错题
连续复习 Dialog
资料文件
思维导图
设置 / 学习与考试
设置 / AI
```

这些截图表明：

> KyStudy 已经具备相对统一、克制且辨识度不错的视觉基础，本轮整改不应推翻视觉语言，而应重点解决信息架构、页面密度、卡片层级、工作区布局和操作层级。

---

# 86. 截图确认的优点：必须保留

## 86.1 品牌色已经成立

当前：

```text
暖米色背景
深绿色主动作
低饱和浅绿色 sidebar
琥珀色 active accent
白色工作面
```

整体稳定、安静，适合长期学习。

Codex 不允许将其改成：

```text
纯白后台
蓝紫 SaaS
黑灰极简
高饱和 AI 风
```

---

## 86.2 Sidebar 是目前比较成熟的区域

截图中的 sidebar：

```text
固定宽度
导航顺序稳定
active item 明确
主导航 + 底部设置分离
品牌区简洁
```

本轮 sidebar 只做：

```text
间距统一
active state 精修
文字层级统一
窄屏行为
```

不要重做信息架构。

---

## 86.3 Dialog 遮罩和整体视觉已经比较克制

当前 Dialog：

```text
背景 dim
白色主体
较大圆角
边界清晰
视觉不会跳出当前设计语言
```

因此 Dialog 的目标是：

```text
减少内部套卡片
改善 footer
减少重复关闭动作
提高 workflow 清晰度
```

而不是更换风格。

---

# 87. 当前最明显的全局问题：White Box Density

截图里最频繁出现的元素不是内容，而是：

```text
白色
圆角
1px border
轻微 shadow
```

它们被大量用于：

```text
页面容器
统计项
section
列表项
详情块
dialog 内部 section
工具入口
```

结果形成：

# White Box Density

即：

> 页面看起来干净，但内容层级主要依赖一个又一个白色圆角矩形来表达。

这会导致多个不同语义的东西看起来权重相同。

---

# 88. 新视觉层级

必须将视觉容器重新分成：

```text
Level 0
App Background

Level 1
Workspace / Page Surface

Level 2
Section

Level 3
Entity / Selected Item

Level 4
Interactive Overlay
```

对应：

```text
Page Surface
不一定需要边框

Section
通常使用 spacing + divider

Entity
题目 / 文件 / 任务等真正独立对象才使用 card / row

Overlay
Dialog / Popover
```

避免：

```text
Page Card
  Section Card
    Stat Card
      Action Card
```

---

# 89. 当前存在“空间很多，但仍显得拥挤”的矛盾

截图可以看到：

```text
页面底部存在大量空白
同时首屏中的内容又被很多 box 分割
```

这是典型的：

# Macro sparse / Micro crowded

即：

```text
宏观布局过稀
微观组件过碎
```

整改目标不是简单增加内容密度。

而是：

```text
减少容器数量
↓
让内容自然铺开
↓
将相关信息组成连续结构
```

---

# 90. 页面标题过强

多个页面：

```text
今日
计划
习题册
错题
资料
设置
```

标题字号较大且粗。

它们作为桌面工具页面，每次导航都占据明显首屏高度。

建议：

```text
Page Title:
约 32–36px 桌面

不要继续放大到展示型 Hero Title
```

Today 可以略特殊。

其余生产力页面应该更紧凑。

---

# 91. Page Header 高度

统一：

```text
eyebrow（可选）
title
description
page actions
divider
```

整体尽量控制在：

```text
80–110px
```

不要让 header 占据太多首屏。

---

# 92. Button 层级从截图进一步确认

当前 screenshot 中存在：

```text
绿色 filled
绿色 outline
纯文字
浅红 destructive
```

但在不同页面的权重仍不完全一致。

例如：

```text
继续今日错题
打开计划
刷新今日
新建周期计划
导入 PDF
题库工具
管理复习方案
刷新
```

视觉强度有时与动作重要性不一致。

新规则：

```text
一个 page header 最多一个 Primary。

同一个 Dialog Footer 最多一个 Primary。

刷新 / 管理 / 打开辅助界面：
通常 secondary / ghost。

删除：
danger，但不应成为常驻高视觉权重按钮。
```

---

# 93. 今日页：截图后的具体整改

当前截图：

```text
顶部：
今日 + 3 个操作按钮

第一行：
今日计划 Card
今日错题 Card

第二行：
考试倒计时 Card
右侧为空
```

问题：

1. 两个完成数字卡片权重过高；
2. “1/1 项已完成”占据大量面积，但当前已经没有下一任务；
3. “0/5 道已完成”和“继续今日错题”事实上才是当前可执行任务；
4. 倒计时与今日行动割裂；
5. 2+1 Card 布局造成右下明显空洞；
6. 页面更像 dashboard，不像行动页面。

---

# 94. 今日页目标布局

根据当前真实业务，建议：

```text
今日
8 月 11 日 · 距考试 135 天

┌────────────────────────────────────────────────────┐
│ 下一步                                              │
│ 今日计划已完成                                      │
│ 还有 5 道高数错题待复习              [继续复习]     │
└────────────────────────────────────────────────────┘

今日
计划 1/1    错题 0/5    学习完成度 ...

─────────────────────────────────────────────────────

已完成
✓ 英语阅读 · 第 23 套

接下来 / 待复习
高数错题 · 5 道

考试
27考研 · 2026/12/24 · 还有 135 天
```

重点：

> Today 必须由“下一步动作”驱动。

当计划已全部完成时，系统自动将错题复习提升为第一 CTA。

---

# 95. 今日页禁止继续使用的结构

避免：

```text
今日计划一个大 Card
今日错题一个大 Card
倒计时一个大 Card
未来再加统计又一个大 Card
```

否则页面会不断横向增加 dashboard widget。

---

# 96. 计划页：当前优点

月历页面整体已经是当前项目较成熟的工作区之一：

```text
月历主体明确
右侧 selected-date inspector
顶部新建计划
周期计划继续向下延伸
```

这种：

```text
Main workspace + Inspector
```

应成为其它复杂页面的重要参考。

---

# 97. 计划页：需要整改的问题

当前月历：

```text
每一天
+
任务 pill
```

信息可读，但：

1. 日历区域非常高；
2. 周期计划内容被推到首屏以下；
3. 当前日期、选中日期和有任务日期的状态层级略接近；
4. pill 文本比较小；
5. 右侧 inspector 是好设计，但与下方周期计划之间关系不够明显；
6. 页面顶部和月历之间留白仍可压缩。

---

# 98. 计划页建议

保持：

```text
Calendar + Inspector
```

但：

```text
减少 Calendar vertical padding
压缩 header
selected date 使用明显但克制的 selected surface
today 用独立的小 indicator
task status 使用语义颜色/weight，而不是增加更多 border
```

并让周期计划通过：

```text
sticky / collapsible summary
```

或更紧凑布局尽量在一屏内露出一部分。

---

# 99. 计划详情 Dialog

当前 Dialog 结构：

```text
Header

计划摘要 Card
  progress
  计划日期 Card
  节奏 Card
  下一项 Card
  月历可见性 row

Footer buttons
```

这是典型的 Card-in-Card。

---

# 100. 计划详情新结构

建议：

```text
英语阅读 · 计划详情                 19%

13 / 68 套
██████████░░░░░░

日期             6/20 – 12/1
节奏             每 2 个学习日 1 套
下一项           第 1 套 · 6/21

────────────────────────────

月历可见性
当前：显示在月历                    [隐藏]

────────────────────────────

[编辑规则] [从 8/11 后顺延 1 个学习日]

                              [归档计划]
```

使用：

```text
description list
divider
toolbar/footer
```

替代多个小 Card。

---

# 101. 计划详情中的危险操作

截图中的：

```text
归档计划
```

使用浅红按钮，视觉位置与普通操作并列。

建议：

```text
普通 footer actions
...
More / danger zone
```

除非归档是日常高频动作，否则不应该与编辑和顺延等权。

---

# 102. 习题册页：截图确认这是最高整改优先级之一

当前页面：

```text
顶部 4 个统计 Card
+
科目大型 section Card
  +
  练习册 Card
+
折叠科目 Card
```

这非常典型地暴露出：

# Entity-as-card everywhere

而题库未来数据量很大。

---

# 103. 顶部 4 个统计 Card 应移除

当前：

```text
科目 3
练习册 2
已索引 2434
已做 22
```

占据整整一行。

它们是信息，不是独立模块。

建议变成：

```text
题库
3 科 · 2 本练习册 · 2434 道已索引 · 22 道已做

[搜索] [筛选]            [导入 PDF] [题库工具]
```

或者放在 toolbar/summary。

---

# 104. 科目结构改为 Navigation / List

当前：

```text
高数
  练习册 1000题
  练习册 880

线性代数
概率论
```

建议：

```text
左：
科目 / Workbook navigation

中：
Questions / Workbook list

右：
Detail
```

最少也应：

```text
Subject row
↓
Workbook rows
```

而不是巨大 section card 包巨大 workbook cards。

---

# 105. 练习册 Row

建议：

```text
1000题
787 题 · 已做 0 · 1 个分段 · 1 待校对
████░░░

[打开]
```

整行 clickable。

不要：

```text
内部再包一个很大的白 Card
```

---

# 106. 自动解析 PDF Dialog

这是截图中结构相对清楚的流程。

保留：

```text
Step 1 / Step 2
PDF Select
```

但需要调整：

1. 当前“分析目录和题目”使用 outline，作为关键下一步不够明确；
2. Cancel 独占左下角，footer 失衡；
3. step indicator 可以更轻；
4. modal 内部纵向留白略多。

推荐：

```text
                           [取消] [分析目录和题目]
```

分析按钮作为 primary。

---

# 107. 题库工具 Dialog：重要整改

当前：

```text
Dialog
├─ 左侧工具分组
└─ 右侧
   ├─ breadcrumb
   ├─ title
   └─ 2 个巨大 Tool Card
```

优点：

```text
工具分组思路正确
```

问题：

1. Dialog 内再使用 Card Grid；
2. 左侧 active item 本身又是 Card；
3. 顶部有“关闭”，底部又有“关闭”；
4. 视觉层级较碎；
5. “分类 / 索引 / 做题 / 维护”其实更适合真正的工具导航。

---

# 108. 题库工具建议

改成：

```text
题库工具

分类
索引
做题
维护
│
└── main pane

分类
建立科目和练习册。

+ 新建科目
  建立题库根节点

+ 新建练习册
  为 PDF 建立可复用练习册分类
```

工具使用：

```text
list / command row
```

而不是巨大 card。

只保留顶部一个 Close。

---

# 109. 错题首页：当前过度空白

当前：

```text
Page Header

一个横向大 Card：
今日连续复习
从第 1 道继续
当前方案...
                           [继续今日错题]
```

然后整页为空。

这不是严重问题，因为错题本身应保持聚焦。

但当前：

> 用一个大 Card 解决一个 CTA，导致视觉上显得“功能很少”。

---

# 110. 错题首页新结构

可以保持简洁，但调整成：

```text
错题

今日复习
5 道待复习

当前方案
高数错题

[继续复习]

────────────────────────

最近
昨日完成 ...
本周 ...
```

如果没有其它有价值信息：

> 宁愿保持简洁，也不要为了填满页面增加无意义统计。

---

# 111. 连续复习界面是当前最值得保留的交互之一

截图中的：

```text
题目主体
来源
AI 解析
掌握 / 模糊 / 不会
数字快捷键 1 / 2 / 3
自动下一题
```

学习流程很清楚。

需要重点保留。

---

# 112. 连续复习不应长期局限于普通 Dialog

这是核心学习 workflow。

当前 Dialog：

```text
几乎占据整个窗口
背后页面完全不可用
```

实际上它已经接近：

# Focus Mode

因此后续建议评估：

```text
Dedicated Fullscreen Workspace
```

或：

```text
full-size dialog
```

而不是普通信息 dialog。

---

# 113. Review Focus Mode 建议

结构：

```text
顶部：
高数错题                   0 / 5      [退出]

题目主体

来源 · 第 23 页
[AI 解析]

底部 sticky：
[掌握 1]   [模糊 2]   [不会 3]

撤销上一题
```

优点：

```text
减少 modal 感
强化学习任务
避免 backdrop 浪费
更适合长时间连续操作
```

---

# 114. 资料页：当前最明显的低效 UI 之一

当前资源文件每条是：

```text
巨大浅米色 Card

文件名
pdf · 大小

             用途 Select
             打开阅读
             删除资料
```

每条资源占据很高的高度。

随着资料达到：

```text
50
100
500
```

会非常低效。

---

# 115. 资料文件必须改为 Dense List

推荐：

```text
名称                                  类型   大小      用途        操作
1000题数一线概篇                      PDF    901KB    未分类      打开  ⋯
1000题高数篇                          PDF    1.1MB    数学        打开  ⋯
880高数篇做题本                       PDF    887KB    练习册      打开  ⋯
```

如果不想使用完整 table：

```text
Resource Row
```

也可以。

关键是：

```text
row height 48–64px
```

而不是当前 130px+。

---

# 116. 资料页危险操作

当前每个资源都常驻：

```text
删除资料
```

并以红色 button 展示。

这是不必要的视觉噪音。

建议：

```text
打开
⋯
```

More Menu：

```text
更改用途
重命名
在题库中使用
删除
```

删除只在 menu 中变 danger。

---

# 117. 资料页搜索区域

当前：

```text
搜索资料原文并回到 PDF 页码
```

这是 KyStudy 很有特点的功能。

应该保留较高权重。

但建议让搜索和资源 list 的关系更明确：

```text
Library Search
→ results

Resources
→ browse
```

不要长期全部混在同一个纵向区域。

可以使用：

```text
tabs / segmented control
```

例如：

```text
[资料] [全文搜索]
```

---

# 118. 思维导图页：已经接近正确的 Workspace

当前：

```text
左：导图列表
中：canvas
右：当前节点 inspector
```

这是整套 KyStudy 中最接近“桌面工作台”的页面之一。

这一模式值得复用到：

```text
Question Bank
Planning Chat
Library
```

---

# 119. 思维导图需要优化的点

1. 左右 pane 可以考虑 resizable；
2. 中央 canvas 的控制器需要视觉统一；
3. 搜索与“适应窗口”属于不同操作层级；
4. 顶部撤销 / 重做 / 编辑信息 / 复制 / 删除可以形成真正 Toolbar；
5. 右侧节点操作中“编辑节点”过于宽重；
6. canvas 应占绝对主视觉。

原则：

```text
Canvas > Inspector > Navigation
```

---

# 120. 设置页：典型 Card-in-Card

当前结构：

```text
Settings page
└─ giant outer white Card
   ├─ left navigation
   └─ right
      └─ inner white Card
         └─ 3 stat cards
```

这是最明显的多层容器之一。

---

# 121. Settings 建议扁平化

改成：

```text
设置

┌───────────────┬─────────────────────────────────────┐
│ 学习与考试     │ 学习与考试                          │
│ AI            │ 本地工作区和学习偏好                │
│ 数据          │                                     │
│ 应用          │ 时区            Asia/Shanghai       │
│               │ 每日错题        5 道                │
│               │ Schema          v21                 │
└───────────────┴─────────────────────────────────────┘
```

使用：

```text
row
description list
divider
```

不要再套 3 个 statistic cards。

---

# 122. Settings 左侧 Tab

当前 active tab 使用：

```text
深绿色整块背景
```

非常明显。

作为设置页面可以稍微降低：

```text
soft background
green text
left indicator
```

让内容区域保持主视觉。

Sidebar 顶级导航已经负责强 active state。

Settings 内二级导航不必同样强。

---

# 123. AI 设置页

当前：

```text
Provider 与调用控制
大 Card
  当前 Provider
  Token budget
```

信息量不大但 Card 很大。

建议：

```text
当前 Provider
离线测试 Provider                   当前使用
kystudy-offline-test-v1

[管理 AI 配置]

────────────────────────

Token 预算

单次        8,000
每日        50,000
每月        1,000,000
超限策略    警告
```

用 row / description list。

---

# 124. 视觉节奏规范：截图后的推荐参数

这些不是绝对像素规范，但 Codex 在重构时应以此为目标范围。

## Page

```text
main content max width:
约 1120–1280px

wide workspace:
允许扩展到可用宽度

page horizontal padding:
约 24–40px
```

---

## Vertical spacing

```text
Page header → content:
16–24px

Section → Section:
24–32px

Section title → content:
8–12px

Row:
8–16px
```

避免大面积：

```text
40–64px
```

无语义空白。

---

## Radius

当前圆角整体略多。

建议建立：

```text
small controls     6–8px
normal surfaces    10–12px
dialog             14–16px
```

不要所有东西都 14–18px。

---

# 125. Border 与 Shadow

截图里主要依靠：

```text
border + shadow + white surface
```

建议：

Page Surface：

```text
很轻 border
或无 shadow
```

Entity：

```text
border
通常无 shadow
```

Dialog：

```text
允许 shadow
```

Popup：

```text
允许 shadow
```

不要普通 Card 全部 shadow。

---

# 126. Sidebar 与 Main 的视觉关系

当前 sidebar 浅绿色很好。

可以进一步让它承担：

```text
App chrome
```

而 main area：

```text
暖米色 workspace
```

因此不要再给 main page 每个 section 都塞进白色 box。

主区域应允许更多内容直接存在于背景上。

---

# 127. 当前设计系统真正应该形成的三种 Surface

建议只保留三类主 surface：

```text
Surface / Workspace
用于主要内容区域

Entity
用于独立任务、文件、题目等

Overlay
Dialog / Popover
```

其余优先使用：

```text
section + divider
```

---

# 128. 页面级优先级重新排序

结合代码复杂度和截图视觉问题：

## P0

```text
Design Tokens
Button / Field / Toolbar
CSS cascade cleanup
Settings flatten
Today hierarchy
Resource dense list
```

## P1

```text
QuestionBank architecture + UI
Planning detail flatten
QuestionBank tools
Planning Chat workspace
```

## P2

```text
Review full-screen focus mode
Mindmap toolbar/panes
Calendar density
```

## P3

```text
micro animation
small decorative polish
```

---

# 129. Codex 必须先做 Screenshot Regression Set

当前这些桌面截图应被视为：

```text
Before Refactor Reference
```

建议在项目内建立：

```text
docs/ui/
  before/
  after/
```

如果实际仓库中不适合提交截图，可至少建立：

```text
docs/ui-refactor-visual-checklist.md
```

记录每个页面：

```text
Today
Planning
Question Bank
Review
Library
Mind Map
Settings
Dialogs
```

---

# 130. 每个页面的视觉验收必须回答 5 个问题

Codex 完成页面整改后，需要逐一回答：

```text
1. 用户第一眼看到的最重要信息是什么？
2. 页面唯一主要动作是什么？
3. 哪些区域是独立实体，哪些只是 section？
4. 是否还存在无必要 card-inside-card？
5. 相比整改前，是否在相同窗口尺寸内显示更多有效信息？
```

如果无法回答：

说明该页面还没有整改完成。

---

# 131. Today Screenshot Acceptance

必须做到：

- [ ] 不再是 2+1 独立 dashboard cards；
- [ ] 当前下一步行动占主视觉；
- [ ] 已完成计划降低权重；
- [ ] 待复习错题在有任务时自动提升；
- [ ] 倒计时成为辅助上下文；
- [ ] page header 不再与内容争夺高度；
- [ ] desktop 首屏不出现巨大无意义空洞。

---

# 132. Planning Screenshot Acceptance

必须做到：

- [ ] Calendar 保持主区域；
- [ ] selected-date inspector 保留；
- [ ] calendar 高度更紧凑；
- [ ] today / selected / has-task 三种状态清楚；
- [ ] 周期计划至少在普通桌面窗口下露出有效内容；
- [ ] 计划详情 dialog 删除小卡片套卡片。

---

# 133. Question Bank Screenshot Acceptance

必须做到：

- [ ] 删除顶部四个大型统计 cards；
- [ ] 统计降级为 compact summary；
- [ ] 科目和练习册不再使用巨大 box 堆叠；
- [ ] 高频操作进入 toolbar；
- [ ] destructive action 降噪；
- [ ] 支持未来百/千级题目；
- [ ] QuestionBankPanel 职责显著拆分。

---

# 134. Review Screenshot Acceptance

必须做到：

- [ ] 继续复习是唯一主 CTA；
- [ ] 不通过无意义统计填充空白；
- [ ] Review session 保持 1/2/3 快捷反馈；
- [ ] Question 为主视觉；
- [ ] AI 分析为次级辅助；
- [ ] 考虑 full-screen focus workflow；
- [ ] evaluation buttons 可 sticky。

---

# 135. Library Screenshot Acceptance

必须做到：

- [ ] 文件列表改为 dense row / table；
- [ ] 删除资料不常驻显示；
- [ ] 打开为主要 inline action；
- [ ] 用途/分类可快速编辑；
- [ ] search 与 browse 层级清楚；
- [ ] 100+ 条资源时仍可高效浏览；
- [ ] mindmap 继续采用三栏 workspace。

---

# 136. Settings Screenshot Acceptance

必须做到：

- [ ] outer card + inner card + stat cards 被扁平化；
- [ ] 设置项采用 row / description list；
- [ ] 二级导航 active state 降低强度；
- [ ] AI Provider / Token Budget 不再使用巨大空 Card；
- [ ] 原有 tabs keyboard 行为不回退。

---

# 137. Dialog Screenshot Acceptance

必须做到：

- [ ] 顶部与底部不重复出现相同 Close；
- [ ] Footer action 对齐统一；
- [ ] primary action 明确；
- [ ] dangerous action 不与常规操作等权；
- [ ] 内部少使用嵌套 Card；
- [ ] 大型 workflow 区分普通 Dialog 与 Focus Workspace。

---

# 138. 截图后的核心结论

本轮整改最重要的视觉转变不是：

```text
更圆
更现代
更漂亮
```

而是：

```text
Card UI
↓
Workspace UI
```

具体表现：

```text
更多连续内容
更少 box
更明确 toolbar
更密集列表
更稳定 inspector
更强的主要行动
更少 dashboard widget
```

---

# 139. 给 Codex 增补的截图执行指令

将下面内容加入执行 prompt：

```text
除了代码审计规范外，请以当前 KyStudy 桌面截图作为 UI 基线。

截图表明现有品牌视觉语言是有效的：
暖米色背景、深绿色、浅绿色 sidebar、琥珀 active accent 必须保留。

不要重新设计品牌。

真正需要改变的是页面组织方式。

本轮视觉整改的核心转变是：

Card UI → Workspace UI

具体要求：

1. 减少白色圆角 box 的数量；
2. 用 section + divider 替代没有独立语义的 card；
3. Today 改成 Next Action 驱动的 Focus View；
4. Question Bank 删除顶部大型统计 cards，并逐步改成 master/detail；
5. Resource 文件列表改成 48–64px 左右的 dense rows；
6. Planning 保留 Calendar + Inspector，这是当前正确方向；
7. Planning Detail 删除 summary 内的小 card；
8. Review Session 保留 1/2/3 快捷反馈，并评估 full-screen focus mode；
9. Mind Map 保留三栏 workspace；
10. Settings 删除 outer card + inner card + stat card 的多层嵌套；
11. 普通页面减少 shadow；
12. 删除操作不要长期使用高视觉权重红色按钮；
13. 普通 desktop page title 不要继续使用过大的展示型字号；
14. 相同窗口尺寸下，应比整改前显示更多有效信息，但不能牺牲可读性。

不要将“填满空白”视为目标。
如果页面本来信息就少，应保持安静和简洁。

真正的目标是：
Macro layout 更有效；
Micro layout 更少碎片。
```

---

# 140. 本次截图审计后的最终设计判断

当前 KyStudy 已经有：

```text
可辨识的品牌
稳定的主配色
不错的 sidebar
较完整的桌面功能
优秀的核心学习交互雏形
```

目前欠缺的是：

```text
成熟桌面生产力软件的信息架构和视觉层级
```

因此下一轮 Codex 工作的原则必须是：

> 保留 KyStudy 的样子，改变 KyStudy 组织信息的方式。

而不是：

> 换一套 UI。
