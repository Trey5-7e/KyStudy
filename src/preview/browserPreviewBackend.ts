type PreviewInvoke = (
  command: string,
  args?: Record<string, unknown>,
  options?: unknown,
) => Promise<unknown>;

interface BrowserTauriInternals {
  invoke: PreviewInvoke;
  convertFileSrc: (filePath: string, protocol?: string) => string;
  transformCallback: (
    callback: (payload: unknown) => void,
    once?: boolean,
  ) => number;
  unregisterCallback: (callbackId: number) => void;
  metadata: {
    currentWindow: { label: string };
    currentWebview: { label: string };
  };
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: BrowserTauriInternals;
  }
}

const PREVIEW_TIME = Date.UTC(2026, 7, 14);
const PREVIEW_SHA256 = "A".repeat(64);
const QUESTION_COUNT = 2_343;
const WORKBOOK_ID = "preview-workbook-1000";
const WORKBOOK_DOCUMENT_ID = "preview-document-1000";
const SUBJECT_ID = "preview-subject-math";
const MINDMAP_RESOURCE_ID = "preview-mindmap-cache";
const MINDMAP_MAP_ID = "preview-map-cache";
const MINDMAP_ROOT_ID = "preview-map-cache-root";
const AI_CHAT_CONVERSATION_ID = "preview-ai-chat-1";
const OCR_PREVIEW_QUESTION_ID = "preview-question-2";
const OCR_PREVIEW_REGION_ID = "preview-question-2-region-1";
const OCR_PREVIEW_RECOGNITION_ID = "preview-ocr-recognition-2";
const PREVIEW_CODE_TICK = String.fromCharCode(96);

function previewResource(
  id: string,
  title: string,
  kind: "pdf" | "mindmap_source",
  role: "workbook" | "reference",
  sizeBytes: number,
  pageCount?: number,
) {
  return {
    id,
    title,
    kind,
    mimeType: kind === "pdf" ? "application/pdf" : "application/xmind",
    sizeBytes,
    sha256: PREVIEW_SHA256,
    reusedExistingBlob: false,
    role,
    ...(pageCount === undefined ? {} : { pageCount, lastPage: 1 }),
    createdAt: PREVIEW_TIME,
  };
}

const PREVIEW_RESOURCES = [
  previewResource(
    WORKBOOK_DOCUMENT_ID,
    "【A4基础强化合集】1000题数学篇",
    "pdf",
    "workbook",
    38_400_000,
    296,
  ),
  previewResource(
    MINDMAP_RESOURCE_ID,
    "主存储器与 CPU 间加入 Cache（演示导图）",
    "mindmap_source",
    "reference",
    8_400_000,
  ),
];

const PREVIEW_AI_OVERVIEW = {
  providers: [
    {
      id: "preview-provider-local",
      providerType: "offline_test",
      displayName: "KyStudy 本地演示模型",
      baseUrl: "http://browser-preview.invalid",
      modelName: "kystudy-preview-1.4",
      contextLimit: 32_000,
      maxOutputTokens: 131_072,
      capabilities: {
        supportsImage: true,
        supportsFile: true,
        supportsPdf: true,
        capabilitySource: "tested",
      },
      hasSecret: false,
      active: true,
    },
  ],
  activeProviderId: "preview-provider-local",
  budget: {
    singleCallLimit: 100_000,
    dailyTokenLimit: 20_000,
    monthlyTokenLimit: 300_000,
    limitMode: "warn",
  },
  usage: { todayTokens: 1_240, monthTokens: 8_420 },
  calls: [
    {
      id: "preview-ai-call-1",
      providerName: "KyStudy 本地演示模型",
      modelName: "kystudy-preview-1.4",
      state: "succeeded",
      cacheHit: true,
      inputTokens: 420,
      outputTokens: 760,
      startedAt: PREVIEW_TIME - 10 * 60_000,
      finishedAt: PREVIEW_TIME - 9 * 60_000,
    },
  ],
};

const PREVIEW_QUESTION_AI_HISTORY = [
  {
    sourceFingerprint: "preview-question-ai-source-1",
    result: {
      callId: "preview-question-ai-call-1",
      responseText: [
        "法向量为：",
        "\\vec n_1=(1,-1,0),\\quad \\vec n_2=(0,2,1)",
        "",
        "3.交线方向向量为",
        "\\vec v_2=\\vec n_1\\times\\vec n_2=(1,1,-2)",
        "",
        "所以",
        "\\theta=\\frac{\\pi}{3}",
      ].join("\n"),
      inputTokens: 420,
      outputTokens: 760,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      usageSource: "estimated",
      cacheHit: false,
      finishedAt: PREVIEW_TIME - 9 * 60_000,
    },
  },
  {
    sourceFingerprint: "preview-question-ai-source-2",
    result: {
      callId: "preview-question-ai-call-2",
      responseText:
        "\\[\\begin{aligned}\n f(x)&=\\frac{1}{x}\\\\\n g(x)&=\\sqrt{x}\n\\end{aligned}\\]",
      inputTokens: 380,
      outputTokens: 510,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      usageSource: "provider",
      cacheHit: false,
      finishedAt: PREVIEW_TIME - 2 * 24 * 60 * 60_000,
    },
  },
  {
    sourceFingerprint: "preview-question-ai-source-3",
    result: {
      callId: "preview-question-ai-call-3",
      responseText: String.raw`答案：C

解题思路：利用偶函数在对称区间上的积分性质，把从 -∞ 到 0 的积分看成总积分的一半。

关键步骤：

1. 因为 ${PREVIEW_CODE_TICK}f(x)${PREVIEW_CODE_TICK} 为偶函数，且  
   \[
   \int_{-\infty}^{+\infty} f(x)\,dx=a
   \]
   所以
   \[
   \int_{-\infty}^{0} f(x)\,dx=\frac a2
   \]

2. 由定义
   \[
   F(-x_0)=\int_{-\infty}^{-x_0} f(t)\,dt
   \]

3. 拆分为
   \[
   F(-x_0)=\int_{-\infty}^{0}f(t)\,dt+\int_{0}^{-x_0}f(t)\,dt
   \]

4. 第一项为 ${PREVIEW_CODE_TICK}a/2${PREVIEW_CODE_TICK}；第二项利用偶函数性质：
   \[
   \int_{0}^{-x_0}f(t)\,dt=-\int_{0}^{x_0}f(t)\,dt
   \]

所以
\[
F(-x_0)=\frac a2-\int_0^{x_0}f(x)\,dx
\]

最终结论：

\[
\boxed{F(-x_0)=\frac a2-\int_0^{x_0}f(x)\,dx}
\]

选 C。

易错点：不要误以为偶函数直接推出 ${PREVIEW_CODE_TICK}F(-x_0)=F(x_0)${PREVIEW_CODE_TICK}。这里 ${PREVIEW_CODE_TICK}F(x)${PREVIEW_CODE_TICK} 是从 ${PREVIEW_CODE_TICK}-∞${PREVIEW_CODE_TICK} 到 ${PREVIEW_CODE_TICK}x${PREVIEW_CODE_TICK} 的变上限积分，它本身一般不是偶函数。`,
      inputTokens: 610,
      outputTokens: 920,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      usageSource: "provider",
      cacheHit: false,
      finishedAt: PREVIEW_TIME - 3 * 24 * 60 * 60_000,
    },
  },
];

const PREVIEW_AI_CHAT_CONVERSATIONS = [
  {
    id: AI_CHAT_CONVERSATION_ID,
    title: "考研数学强化计划：函数与极限",
    kind: "chat",
    modelProfileId: "preview-provider-local",
    messages: [
      {
        id: "preview-ai-message-user-1",
        role: "user",
        content:
          "请结合已导入的 A4 基础强化合集，帮我梳理函数与极限的复习重点。",
        sources: [],
        createdAt: PREVIEW_TIME - 7 * 60_000,
      },
      {
        id: "preview-ai-message-assistant-1",
        role: "assistant",
        content:
          "可以。建议先按 **定义—判定—计算—综合题** 四层复习：\n\n1. 先用第 12 页的例题复习极限的 ε-N 语言；\n2. 再做第 18 页的等价无穷小与夹逼准则；\n3. 最后用错题回放检查连续性与可导性的边界。\n\n如果你愿意，我可以继续把这套顺序拆成每天 30 分钟的任务。",
        sources: [
          {
            documentId: WORKBOOK_DOCUMENT_ID,
            documentTitle: "A4 基础强化合集·数学试卷",
            pageNumber: 12,
            citationLabel: "资料 1",
          },
          {
            documentId: WORKBOOK_DOCUMENT_ID,
            documentTitle: "A4 基础强化合集·数学试卷",
            pageNumber: 18,
            citationLabel: "资料 2",
          },
        ],
        createdAt: PREVIEW_TIME - 6 * 60_000,
      },
      {
        id: "preview-ai-message-assistant-formula",
        role: "assistant",
        content:
          "Formula rendering regression fixture:\n\n**Final conclusion:** $\\theta=\\frac{\\pi}{3}$\n\n$$\\vec v_1=(1,-2,1)$$",
        sources: [],
        createdAt: PREVIEW_TIME - 5 * 60_000,
      },
      {
        id: "preview-ai-message-assistant-integral",
        role: "assistant",
        content: String.raw`答案：C

解题思路：利用偶函数在对称区间上的积分性质，把从 -∞ 到 0 的积分看成总积分的一半。

关键步骤：

1. 因为 ${PREVIEW_CODE_TICK}f(x)${PREVIEW_CODE_TICK} 为偶函数，且  
   \[
   \int_{-\infty}^{+\infty} f(x)\,dx=a
   \]
   所以
   \[
   \int_{-\infty}^{0} f(x)\,dx=\frac{a}{2}
   \]

2. 由定义
   \[
   F(-x_0)=\int_{-\infty}^{-x_0} f(t)\,dt
   \]

3. 拆分为
   \[
   F(-x_0)=\int_{-\infty}^{0}f(t)\,dt+\int_{0}^{-x_0}f(t)\,dt
   \]

4. 第一项为 ${PREVIEW_CODE_TICK}a/2${PREVIEW_CODE_TICK}；第二项利用偶函数性质：
   \[
   \int_{0}^{-x_0}f(t)\,dt=-\int_{0}^{x_0}f(t)\,dt
   \]

所以
\[
F(-x_0)=\frac{a}{2}-\int_{0}^{x_0}f(x)\,dx
\]

最终结论：

\[
\boxed{F(-x_0)=\frac{a}{2}-\int_{0}^{x_0}f(x)\,dx}
\]

选 C。易错点：不要误以为偶函数直接推出 ${PREVIEW_CODE_TICK}F(-x_0)=F(x_0)${PREVIEW_CODE_TICK}。`,
        sources: [],
        createdAt: PREVIEW_TIME - 4 * 60_000,
      },
    ],
    createdAt: PREVIEW_TIME - 7 * 60_000,
    updatedAt: PREVIEW_TIME - 6 * 60_000,
  },
  {
    id: "preview-ai-chat-2",
    title:
      "一条用于检查窄屏布局的超长对话标题：PDF 资料、图片题目与模型能力说明",
    kind: "chat",
    modelProfileId: "preview-provider-local",
    messages: [],
    createdAt: PREVIEW_TIME - 2 * 24 * 60 * 60_000,
    updatedAt: PREVIEW_TIME - 2 * 24 * 60 * 60_000,
  },
];

const PREVIEW_AI_ATTACHMENTS = [
  {
    id: "preview-ai-attachment-1",
    conversationId: AI_CHAT_CONVERSATION_ID,
    source: "resource",
    documentId: WORKBOOK_DOCUMENT_ID,
    fileName: "A4 基础强化合集·数学试卷.pdf",
    mimeType: "application/pdf",
    sizeBytes: 38_400_000,
    sha256: PREVIEW_SHA256,
    status: "ready",
    createdAt: PREVIEW_TIME - 6 * 60_000,
    updatedAt: PREVIEW_TIME - 6 * 60_000,
  },
];

function previewAiChatPreview() {
  return {
    preview: {
      providerName: "KyStudy 本地演示模型",
      providerType: "offline_test",
      modelName: "kystudy-preview-1.4",
      destination: "本地预览（不会访问外部 Provider）",
      prompt:
        "请结合已绑定的 PDF 资料，给出函数与极限的复习重点，并把建议拆成可执行的学习步骤。",
      inputTokenEstimate: 620,
      outputTokenLimit: 800,
      projectedTokens: 1_420,
      todayTokens: 1_240,
      monthTokens: 8_420,
      allowed: true,
      warnings: [],
      requestFingerprint: "preview-ai-chat-request-fingerprint",
    },
    sources: [
      {
        documentId: WORKBOOK_DOCUMENT_ID,
        documentTitle: "A4 基础强化合集·数学试卷",
        pageNumber: 12,
        citationLabel: "资料 1",
      },
    ],
    transport: "local_text",
    attachments: [
      {
        id: "preview-ai-attachment-1",
        fileName: "A4 基础强化合集·数学试卷.pdf",
        transport: "local_text",
        indexedPages: 296,
      },
    ],
  };
}

const PREVIEW_SUBJECTS = [
  {
    id: SUBJECT_ID,
    name: "高数",
    colorKey: "blue",
    sortOrder: 0,
    createdAt: PREVIEW_TIME,
    updatedAt: PREVIEW_TIME,
  },
  {
    id: "preview-subject-linear",
    name: "线性代数",
    colorKey: "purple",
    sortOrder: 1,
    createdAt: PREVIEW_TIME,
    updatedAt: PREVIEW_TIME,
  },
  {
    id: "preview-subject-probability",
    name: "概率论",
    colorKey: "green",
    sortOrder: 2,
    createdAt: PREVIEW_TIME,
    updatedAt: PREVIEW_TIME,
  },
];

const PREVIEW_WORKBOOKS = [
  {
    id: WORKBOOK_ID,
    name: "1000题",
    createdAt: PREVIEW_TIME,
    updatedAt: PREVIEW_TIME,
  },
  {
    id: "preview-workbook-880",
    name: "880",
    createdAt: PREVIEW_TIME,
    updatedAt: PREVIEW_TIME,
  },
];

const PREVIEW_SEGMENTS = [
  {
    id: "preview-segment-1",
    documentId: WORKBOOK_DOCUMENT_ID,
    documentTitle: "【A4基础强化合集】1000题数学篇",
    subjectId: SUBJECT_ID,
    subjectName: "高数",
    workbookId: WORKBOOK_ID,
    workbookName: "1000题",
    sourceHeading: "第0章 零基础",
    pageStart: 3,
    pageEnd: 296,
    indexState: "needs_review",
    questionCount: 1_200,
    createdAt: PREVIEW_TIME,
    updatedAt: PREVIEW_TIME,
  },
  {
    id: "preview-segment-2",
    documentId: WORKBOOK_DOCUMENT_ID,
    documentTitle: "【A4基础强化合集】1000题数学篇",
    subjectId: SUBJECT_ID,
    subjectName: "高数",
    workbookId: WORKBOOK_ID,
    workbookName: "1000题",
    sourceHeading: "第1章 函数与极限",
    pageStart: 297,
    pageEnd: 412,
    indexState: "ready",
    questionCount: 800,
    createdAt: PREVIEW_TIME,
    updatedAt: PREVIEW_TIME,
  },
  {
    id: "preview-segment-3",
    documentId: WORKBOOK_DOCUMENT_ID,
    documentTitle: "【A4基础强化合集】1000题数学篇",
    subjectId: SUBJECT_ID,
    subjectName: "高数",
    workbookId: WORKBOOK_ID,
    workbookName: "1000题",
    sourceHeading: "第2章 导数与微分",
    pageStart: 413,
    pageEnd: 520,
    indexState: "ready",
    questionCount: 343,
    createdAt: PREVIEW_TIME,
    updatedAt: PREVIEW_TIME,
  },
];

const PREVIEW_QUESTIONS = Array.from({ length: QUESTION_COUNT }, (_, index) => {
  const segment = (
    index < 1_200
      ? PREVIEW_SEGMENTS[0]
      : index < 2_000
        ? PREVIEW_SEGMENTS[1]
        : PREVIEW_SEGMENTS[2]
  )!;
  const number = index + 1;
  return {
    id: `preview-question-${number}`,
    documentId: WORKBOOK_DOCUMENT_ID,
    documentTitle: "【A4基础强化合集】1000题数学篇",
    subjectId: SUBJECT_ID,
    subjectName: "高数",
    workbookId: segment.workbookId,
    workbookName: segment.workbookName,
    segmentId: segment.id,
    chapter: segment.sourceHeading,
    sectionPart: index % 4 === 0 ? "basic" : "comprehensive",
    questionType:
      index % 3 === 0 ? "choice" : index % 3 === 1 ? "solution" : "blank",
    questionNumber: String(number),
    title:
      index % 5 === 0
        ? `若函数 f(x) 在区间内连续，求第 ${number} 题的极限与变化趋势。`
        : `第 ${number} 题：函数、极限与导数综合练习`,
    indexConfidence: index % 17 === 0 ? 0.82 : 0.98,
    sortOrder: index,
    currentResult: index % 29 === 0 ? "incorrect" : null,
    attemptCount: index % 29 === 0 ? 2 : 0,
    incorrectCount: index % 29 === 0 ? 1 : 0,
    partialCount: 0,
    regions:
      number === 2
        ? [
            {
              id: OCR_PREVIEW_REGION_ID,
              questionId: OCR_PREVIEW_QUESTION_ID,
              documentId: WORKBOOK_DOCUMENT_ID,
              pageNumber: 4,
              x: 0.08,
              y: 0.2,
              width: 0.84,
              height: 0.3,
              coordinateVersion: 1,
              sortOrder: 0,
              createdAt: PREVIEW_TIME,
            },
          ]
        : [],
  };
});

const PREVIEW_OCR_RECOGNITION = {
  id: OCR_PREVIEW_RECOGNITION_ID,
  questionId: OCR_PREVIEW_QUESTION_ID,
  regionId: OCR_PREVIEW_REGION_ID,
  pageNumber: 4,
  engine: "rapidocr-3.9.2-ppocrv6-small-onnx-cpu",
  recognizedText: String.raw`2 设 \lim_{x\to0}\left(1+x+\frac{f(x)}{x}\right)^{\frac{1}{x}}=\mathrm{e}^3，则\lim_{x\to0}\left(1+\frac{f(x)}{x}\right)^{\frac{1}{x}}=_____`,
  meanConfidence: 0.9,
  state: "draft",
  lines: [
    {
      id: "preview-ocr-line-2",
      recognitionId: OCR_PREVIEW_RECOGNITION_ID,
      text: "2 设 高数公式 OCR 草稿",
      confidence: 0.9,
      x: 0,
      y: 0,
      width: 1,
      height: 0.2,
      sortOrder: 0,
    },
  ],
  createdAt: PREVIEW_TIME,
  updatedAt: PREVIEW_TIME,
};

const PREVIEW_QUESTION_BANK = {
  workbooks: PREVIEW_WORKBOOKS,
  segments: PREVIEW_SEGMENTS,
  questions: PREVIEW_QUESTIONS,
};

const PREVIEW_CYCLE_PLAN = {
  restWeekdays: [6],
  plans: [
    {
      plan: {
        id: "preview-cycle-plan",
        name: "考研数学基础强化",
        totalUnits: 20,
        unitLabel: "章",
        startDate: "2026-08-01",
        deadline: "2026-12-24",
        studyDaysPerUnit: 2,
        scheduleMode: "rhythm",
        calendarVisible: true,
        createdAt: PREVIEW_TIME,
        updatedAt: PREVIEW_TIME,
      },
      items: Array.from({ length: 12 }, (_, index) => ({
        id: `preview-cycle-item-${index + 1}`,
        planId: "preview-cycle-plan",
        unitIndex: index + 1,
        plannedStartDate: `2026-08-${String(index * 2 + 1).padStart(2, "0")}`,
        plannedEndDate: `2026-08-${String(index * 2 + 2).padStart(2, "0")}`,
        originalStartDate: `2026-08-${String(index * 2 + 1).padStart(2, "0")}`,
        originalEndDate: `2026-08-${String(index * 2 + 2).padStart(2, "0")}`,
        state: index < 3 ? "completed" : "pending",
        completedAt: index < 3 ? PREVIEW_TIME : null,
        skippedAt: null,
        shiftCount: 0,
        updatedAt: PREVIEW_TIME + index,
      })),
      completedCount: 3,
      skippedCount: 0,
      progressPercent: 15,
      estimatedEndDate: "2026-09-10",
      exceedsDeadline: false,
      recommendedStudyDaysPerUnit: null,
      recommendedTotalUnits: null,
    },
  ],
};

function previewKnowledgeMap() {
  const nodes = [
    {
      id: MINDMAP_ROOT_ID,
      mapId: MINDMAP_MAP_ID,
      parentId: null,
      subjectId: SUBJECT_ID,
      title: "主存储器与 CPU 的连接",
      noteMarkdown: "浏览器预览 fixture：用于检查导图拖拽、缩放和搜索层。",
      masteryState: "learning",
      importance: 5,
      sortOrder: 0,
      collapsed: false,
      createdAt: PREVIEW_TIME,
      updatedAt: PREVIEW_TIME,
    },
    ...[
      "Cache 的基本访存过程",
      "Cache 和主存之间的映射方式",
      "Cache 替换算法",
      "Cache 写策略与一致性",
      "地址映射与标记字段",
      "命中率与平均访问时间",
    ].flatMap((title, branchIndex) => {
      const branchId = `preview-map-cache-${branchIndex + 1}`;
      return [
        {
          id: branchId,
          mapId: MINDMAP_MAP_ID,
          parentId: MINDMAP_ROOT_ID,
          subjectId: SUBJECT_ID,
          title,
          noteMarkdown: undefined,
          masteryState: branchIndex < 2 ? "weak" : "unknown",
          importance: 4,
          sortOrder: branchIndex,
          collapsed: false,
          createdAt: PREVIEW_TIME,
          updatedAt: PREVIEW_TIME,
        },
        ...Array.from({ length: 4 }, (_, childIndex) => ({
          id: `${branchId}-${childIndex + 1}`,
          mapId: MINDMAP_MAP_ID,
          parentId: branchId,
          subjectId: SUBJECT_ID,
          title: `${title} · 细节 ${childIndex + 1}`,
          noteMarkdown: undefined,
          masteryState: "unknown",
          importance: 2,
          sortOrder: childIndex,
          collapsed: false,
          createdAt: PREVIEW_TIME,
          updatedAt: PREVIEW_TIME,
        })),
      ];
    }),
  ];
  return {
    map: {
      id: MINDMAP_MAP_ID,
      subjectId: SUBJECT_ID,
      title: "主存储器与 CPU 间加入 Cache",
      rootNodeId: MINDMAP_ROOT_ID,
      currentRevision: 1,
      createdAt: PREVIEW_TIME,
      updatedAt: PREVIEW_TIME,
    },
    nodes,
    resources: [
      {
        id: "preview-map-resource",
        nodeId: MINDMAP_ROOT_ID,
        documentId: MINDMAP_RESOURCE_ID,
        documentTitle: "主存储器与 CPU 间加入 Cache（演示导图）",
        pageStart: 1,
        pageEnd: 1,
        note: "fixture",
        createdAt: PREVIEW_TIME,
      },
    ],
    canUndo: false,
    canRedo: false,
  };
}

const PREVIEW_KNOWLEDGE_MAP = previewKnowledgeMap();

function previewReviewSchemeDashboard() {
  return { restWeekdays: [6], schemes: [] };
}

function previewStudyPlans() {
  return [];
}

function previewReaderDescriptor(documentId: string) {
  const resource = PREVIEW_RESOURCES.find((item) => item.id === documentId);
  if (resource === undefined || resource.kind !== "pdf") {
    throw { code: "RESOURCE_READER_UNSUPPORTED" };
  }
  return {
    documentId: resource.id,
    title: resource.title,
    kind: "pdf",
    mimeType: resource.mimeType,
    sizeBytes: resource.sizeBytes,
    pageCount: resource.pageCount,
    lastPage: resource.lastPage,
  };
}

function previewMutationResult(command: string) {
  if (command === "set_cycle_plan_item_state") {
    return {
      dashboard: PREVIEW_CYCLE_PLAN,
      itemId: "preview-cycle-item-4",
      itemUpdatedAt: PREVIEW_TIME + 100,
    };
  }
  return PREVIEW_CYCLE_PLAN;
}

export async function invokeBrowserPreview(
  command: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  switch (command) {
    case "get_ai_overview":
      return PREVIEW_AI_OVERVIEW;
    case "list_ai_chat_conversations":
      return PREVIEW_AI_CHAT_CONVERSATIONS;
    case "list_planning_conversations":
      return [];
    case "list_ai_chat_attachments":
      return PREVIEW_AI_ATTACHMENTS;
    case "list_ai_attachments":
      return [];
    case "list_question_ai_analysis_history":
      return PREVIEW_QUESTION_AI_HISTORY;
    case "preview_ai_chat":
    case "preview_planning_chat":
      return previewAiChatPreview();
    case "get_question_bank":
      return PREVIEW_QUESTION_BANK;
    case "list_trashed_workbook_segments":
      return [];
    case "get_question_gap_acknowledgements":
      return [];
    case "set_question_gap_acknowledgement":
      return [];
    case "list_resources":
      return PREVIEW_RESOURCES;
    case "list_subjects":
      return PREVIEW_SUBJECTS;
    case "get_workspace_status":
      return {
        id: "preview-workspace",
        name: "浏览器 UI 预览工作区",
        timezone: "Asia/Shanghai",
        dailyReviewQuota: 5,
        earlyFillEnabled: true,
        createdAt: PREVIEW_TIME,
        schemaVersion: 1,
      };
    case "get_ocr_status":
      return {
        state: "available",
        engine: "rapidocr-3.9.2-ppocrv6-small-onnx-cpu",
        modelsBundled: true,
        componentSizeBytes: 1_490_000_000,
      };
    case "list_question_ocr":
      return String(args.questionId ?? "") === OCR_PREVIEW_QUESTION_ID
        ? [PREVIEW_OCR_RECOGNITION]
        : [];
    case "get_cycle_plan_dashboard":
      return PREVIEW_CYCLE_PLAN;
    case "get_review_scheme_dashboard":
      return previewReviewSchemeDashboard();
    case "list_study_plans":
      return previewStudyPlans();
    case "list_knowledge_maps":
      return [PREVIEW_KNOWLEDGE_MAP];
    case "list_mindmap_import_drafts":
      return [];
    case "get_resource_reader_descriptor":
      return previewReaderDescriptor(String(args.documentId ?? ""));
    case "set_cycle_plan_item_state":
    case "restore_cycle_plan_item_state":
    case "save_cycle_plan":
    case "refresh_cycle_plan_schedules":
      return previewMutationResult(command);
    case "set_review_rest_weekdays":
      return previewReviewSchemeDashboard();
    case "plugin:event|listen":
      return 1;
    case "plugin:event|unlisten":
      return null;
    default:
      throw new Error(`BROWSER_PREVIEW_UNSUPPORTED:${command}`);
  }
}

export function installBrowserPreviewBackend(): boolean {
  if (!import.meta.env.DEV || window.__TAURI_INTERNALS__ !== undefined) {
    return false;
  }

  const callbacks = new Map<number, (payload: unknown) => void>();
  let nextCallbackId = 1;
  const internals: BrowserTauriInternals = {
    invoke: (command, args) => invokeBrowserPreview(command, args),
    convertFileSrc: (filePath) =>
      `data:text/plain,${encodeURIComponent(filePath)}`,
    transformCallback: (callback, once = false) => {
      const callbackId = nextCallbackId++;
      callbacks.set(callbackId, (payload) => {
        callback(payload);
        if (once) callbacks.delete(callbackId);
      });
      return callbackId;
    },
    unregisterCallback: (callbackId) => {
      callbacks.delete(callbackId);
    },
    metadata: {
      currentWindow: { label: "browser-preview" },
      currentWebview: { label: "browser-preview" },
    },
  };
  window.__TAURI_INTERNALS__ = internals;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => undefined,
  };
  return true;
}
