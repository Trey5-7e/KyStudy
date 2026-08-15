import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";

import { EditorDialog } from "../../shared/components/EditorDialog";
import type {
  QuestionBankTool,
  QuestionBankToolsSection,
} from "./questionBankWindowModel";

export type {
  QuestionBankTool,
  QuestionBankToolsSection,
} from "./questionBankWindowModel";

export interface QuestionBankToolCounts {
  subjects?: number;
  workbooks?: number;
  pdfs?: number;
  segments?: number;
  questions?: number;
}

/**
 * Availability is deliberately UI-facing. The Panel can pass the fixed R31
 * count names, while the optional aliases keep this dialog easy to migrate
 * from the pre-R31 `hasSegments`/`hasQuestions` props.
 */
export interface QuestionBankToolAvailability {
  loading?: boolean;
  subjectCount?: number;
  workbookCount?: number;
  pdfCount?: number;
  segmentCount?: number;
  questionCount?: number;
  counts?: QuestionBankToolCounts;
  hasSegments?: boolean;
  hasQuestions?: boolean;
}

export type QuestionBankToolsStatusTone =
  "info" | "success" | "warning" | "error";

export type QuestionBankToolsStatus =
  | string
  | {
      message: string;
      tone?: QuestionBankToolsStatusTone;
    };

type ToolDefinition = {
  id: QuestionBankTool;
  section: QuestionBankToolsSection;
  title: string;
  description: string;
  actionLabel: string;
  icon: ToolIconKind;
};

type ToolIconKind =
  | "subject"
  | "workbook"
  | "manual"
  | "browse"
  | "record"
  | "paper"
  | "refresh"
  | "ocr";

type ToolsTabOrientation = "horizontal" | "vertical";

const TOOLS_HORIZONTAL_MEDIA_QUERY = "(max-width: 900px)";

const TOOL_SECTIONS: ReadonlyArray<{
  id: QuestionBankToolsSection;
  label: string;
  description: string;
}> = [
  {
    id: "category",
    label: "分类",
    description: "建立科目和练习册",
  },
  {
    id: "index",
    label: "索引",
    description: "补题、校对和浏览",
  },
  {
    id: "practice",
    label: "做题",
    description: "登记结果或生成练习卷",
  },
  {
    id: "maintenance",
    label: "维护",
    description: "刷新题库快照与 OCR 组件",
  },
];

const TOOL_DEFINITIONS: ReadonlyArray<ToolDefinition> = [
  {
    id: "subject",
    section: "category",
    title: "新建科目",
    description: "建立题库根节点，例如高等数学或线性代数。",
    actionLabel: "创建科目",
    icon: "subject",
  },
  {
    id: "workbook",
    section: "category",
    title: "新建练习册",
    description: "为 PDF 资料建立可复用的练习册分类。",
    actionLabel: "创建练习册",
    icon: "workbook",
  },
  {
    id: "manual",
    section: "index",
    title: "手动补题与校对",
    description: "在已有 PDF 分段中框选遗漏题目并修正索引。",
    actionLabel: "继续补题",
    icon: "manual",
  },
  {
    id: "browse",
    section: "index",
    title: "浏览题目索引",
    description: "按分段和筛选条件查看、编辑题目卡片。",
    actionLabel: "打开索引",
    icon: "browse",
  },
  {
    id: "record",
    section: "practice",
    title: "快速登记做题",
    description: "输入题号，批量保存本次做对、做错或不全对。",
    actionLabel: "登记结果",
    icon: "record",
  },
  {
    id: "paper",
    section: "practice",
    title: "智能拼卷",
    description: "按范围和状态在本地加权生成一张练习卷。",
    actionLabel: "开始拼卷",
    icon: "paper",
  },
  {
    id: "refresh",
    section: "maintenance",
    title: "刷新题库",
    description: "重新读取题库快照，让导入或恢复的结果立即可见。",
    actionLabel: "刷新快照",
    icon: "refresh",
  },
  {
    id: "ocr",
    section: "maintenance",
    title: "OCR 组件",
    description: "安装、修复或移除可选的本地文字识别组件。",
    actionLabel: "管理 OCR 组件",
    icon: "ocr",
  },
];

export function questionBankToolsSectionIndexAfterKey(
  currentIndex: number,
  key: string,
  sectionCount = TOOL_SECTIONS.length,
): number | undefined {
  if (sectionCount <= 0) return undefined;
  if (key === "Home") return 0;
  if (key === "End") return sectionCount - 1;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return (currentIndex + 1 + sectionCount) % sectionCount;
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return (currentIndex - 1 + sectionCount) % sectionCount;
  }
  return undefined;
}

export function questionBankToolsOrientation(
  narrow: boolean,
): ToolsTabOrientation {
  return narrow ? "horizontal" : "vertical";
}

const NUMBER_FORMATTER = new Intl.NumberFormat("zh-CN");

function formatCount(value: number): string {
  return NUMBER_FORMATTER.format(Math.max(0, value));
}

function readCount(
  availability: QuestionBankToolAvailability | undefined,
  key: keyof QuestionBankToolCounts,
  fixedKey:
    | "subjectCount"
    | "workbookCount"
    | "pdfCount"
    | "segmentCount"
    | "questionCount",
): number {
  const fixedValue = availability?.[fixedKey];
  if (typeof fixedValue === "number") return fixedValue;
  const nestedValue = availability?.counts?.[key];
  return typeof nestedValue === "number" ? nestedValue : 0;
}

function ToolIcon({ kind }: { kind: ToolIconKind }) {
  const paths: Record<ToolIconKind, string> = {
    subject:
      "M12 3.5 20 7v5.5c0 4.1-2.8 7.1-8 8.5-5.2-1.4-8-4.4-8-8.5V7l8-3.5Zm0 4v9m-4.5-4.5h9",
    workbook:
      "M5 5.5h11.5A2.5 2.5 0 0 1 19 8v10.5H7A2 2 0 0 0 5 20.5V5.5Zm0 0v15m2-2h12",
    manual:
      "m5 17.5-.8 3.3 3.3-.8L19 8.5a2.3 2.3 0 0 0-3.3-3.3L5 17.5Zm8.7-10.7 3.3 3.3M5 4.5h5",
    browse: "m16.5 16.5 4 4m-2.5-10a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
    record: "M5 4.5h14v15H5v-15Zm3 3.5h8M8 12h1m3 0h5M8 15.5h1m3 0h5",
    paper:
      "M5 5.5h11a2 2 0 0 1 2 2v11H7a2 2 0 0 1-2-2v-11Zm3 0V3.5h9a2 2 0 0 1 2 2v2M8 10.5h7m-7 3h5",
    refresh: "M19.5 8.5A7.5 7.5 0 1 0 20 14h-3m3-5.5v4h-4",
    ocr: "M4.5 5.5h15v13h-15zM8 9h8M8 12h6M8 15h4",
  };
  return (
    <svg
      className="question-bank-tool-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

function statusMessage(status: QuestionBankToolsStatus | undefined): {
  message: string;
  tone: QuestionBankToolsStatusTone;
} | null {
  if (status === undefined) return null;
  if (typeof status === "string") {
    const message = status.trim();
    return message === "" ? null : { message, tone: "info" };
  }
  const message = status.message.trim();
  return message === "" ? null : { message, tone: status.tone ?? "info" };
}

export function QuestionBankToolsDialog({
  onClose,
  onSelect,
  onSectionChange,
  section: controlledSection,
  initialSection = "category",
  focusTool,
  initialFocusTool,
  availability,
  loading: legacyLoading = false,
  hasSegments,
  hasQuestions,
  onRefresh,
  refreshBusy = false,
  status,
  refreshStatus,
  returnFocusRef,
  fallbackFocusRef,
}: {
  onClose(): void;
  onSelect(
    tool: QuestionBankTool,
    section?: QuestionBankToolsSection,
    trigger?: HTMLButtonElement,
  ): void;
  onSectionChange?(section: QuestionBankToolsSection): void;
  section?: QuestionBankToolsSection;
  initialSection?: QuestionBankToolsSection;
  focusTool?: QuestionBankTool;
  initialFocusTool?: QuestionBankTool;
  availability?: QuestionBankToolAvailability;
  /** @deprecated Pass availability.loading instead. */
  loading?: boolean;
  /** @deprecated Pass availability.hasSegments or segmentCount instead. */
  hasSegments?: boolean;
  /** @deprecated Pass availability.hasQuestions or questionCount instead. */
  hasQuestions?: boolean;
  onRefresh?(trigger?: HTMLButtonElement): Promise<void> | void;
  refreshBusy?: boolean;
  status?: QuestionBankToolsStatus;
  /** @deprecated Alias used by the first R31 Panel wiring. */
  refreshStatus?: QuestionBankToolsStatus;
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [uncontrolledSection, setUncontrolledSection] =
    useState<QuestionBankToolsSection>(initialSection);
  const [selectedTool, setSelectedTool] = useState<QuestionBankTool>();
  const [tabOrientation, setTabOrientation] = useState<ToolsTabOrientation>(
    () =>
      questionBankToolsOrientation(
        typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia(TOOLS_HORIZONTAL_MEDIA_QUERY).matches,
      ),
  );
  const toolButtonRefs = useRef(new Map<QuestionBankTool, HTMLButtonElement>());
  const sectionButtonRefs = useRef(
    new Map<QuestionBankToolsSection, HTMLButtonElement>(),
  );
  const activeSectionButtonRef = useRef<HTMLButtonElement | null>(null);

  const effectiveFocusTool = focusTool ?? initialFocusTool;
  const isLoading = availability?.loading ?? legacyLoading;
  const counts = {
    subjects: readCount(availability, "subjects", "subjectCount"),
    workbooks: readCount(availability, "workbooks", "workbookCount"),
    pdfs: readCount(availability, "pdfs", "pdfCount"),
    segments: readCount(availability, "segments", "segmentCount"),
    questions: readCount(availability, "questions", "questionCount"),
  };
  const hasActiveSegments =
    availability?.hasSegments ?? hasSegments ?? counts.segments > 0;
  const hasIndexedQuestions =
    availability?.hasQuestions ?? hasQuestions ?? counts.questions > 0;
  const hasAvailability =
    availability !== undefined || hasSegments !== undefined;
  const focusToolSection =
    effectiveFocusTool === undefined
      ? undefined
      : TOOL_DEFINITIONS.find((tool) => tool.id === effectiveFocusTool)
          ?.section;

  const activeSection =
    controlledSection ?? focusToolSection ?? uncontrolledSection;

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mediaQuery = window.matchMedia(TOOLS_HORIZONTAL_MEDIA_QUERY);
    const updateOrientation = (event: MediaQueryListEvent) => {
      setTabOrientation(questionBankToolsOrientation(event.matches));
    };
    mediaQuery.addEventListener("change", updateOrientation);
    return () => mediaQuery.removeEventListener("change", updateOrientation);
  }, []);

  useEffect(() => {
    if (focusToolSection === undefined || focusToolSection === activeSection) {
      return;
    }
    onSectionChange?.(focusToolSection);
  }, [activeSection, controlledSection, focusToolSection, onSectionChange]);

  useEffect(() => {
    const tool = effectiveFocusTool;
    if (tool === undefined || focusToolSection !== activeSection) return;
    requestAnimationFrame(() => {
      const target = toolButtonRefs.current.get(tool);
      if (target?.isConnected) target.focus({ preventScroll: true });
    });
  }, [activeSection, effectiveFocusTool, focusToolSection]);

  useEffect(() => {
    if (effectiveFocusTool !== undefined) return;
    requestAnimationFrame(() => {
      if (activeSectionButtonRef.current?.isConnected) {
        activeSectionButtonRef.current.focus({ preventScroll: true });
      }
    });
  }, [effectiveFocusTool]);

  const sectionDefinition =
    TOOL_SECTIONS.find((item) => item.id === activeSection) ??
    TOOL_SECTIONS[0]!;
  const sectionTools = useMemo(
    () => TOOL_DEFINITIONS.filter((tool) => tool.section === activeSection),
    [activeSection],
  );
  const resolvedStatus = statusMessage(status ?? refreshStatus);

  const chooseSection = useCallback(
    (next: QuestionBankToolsSection) => {
      if (controlledSection === undefined) setUncontrolledSection(next);
      setSelectedTool(undefined);
      onSectionChange?.(next);
    },
    [controlledSection, onSectionChange],
  );

  const moveSectionFocus = useCallback(
    (nextIndex: number) => {
      const nextSection = TOOL_SECTIONS[nextIndex];
      if (nextSection === undefined) return;
      chooseSection(nextSection.id);
      requestAnimationFrame(() => {
        sectionButtonRefs.current.get(nextSection.id)?.focus({
          preventScroll: true,
        });
      });
    },
    [chooseSection],
  );

  const handleSectionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    const nextIndex = questionBankToolsSectionIndexAfterKey(
      currentIndex,
      event.key,
    );
    if (nextIndex === undefined) return;
    event.preventDefault();
    moveSectionFocus(nextIndex);
  };

  const selectTool = (
    tool: QuestionBankTool,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    const trigger = event.currentTarget;
    setSelectedTool(tool);
    if (tool === "refresh" && onRefresh !== undefined) {
      void onRefresh(trigger);
      return;
    }
    onSelect(tool, activeSection, trigger);
  };

  const toolState = (tool: ToolDefinition) => {
    if (isLoading) {
      return {
        chip: "正在读取…",
        disabled: true,
        reason: "正在读取题库状态，请稍候。",
      };
    }
    if (tool.id === "refresh") {
      return {
        chip: refreshBusy ? "刷新中" : "本地快照",
        disabled: refreshBusy,
        reason: refreshBusy ? "正在刷新题库快照，请稍候。" : undefined,
      };
    }
    if (tool.id === "ocr") {
      return {
        chip: "可选离线组件",
        disabled: false,
        reason: undefined,
      };
    }
    if (tool.id === "manual") {
      return {
        chip: hasAvailability
          ? `${formatCount(counts.segments)} 个分段`
          : "需要分段",
        disabled: !hasActiveSegments,
        reason: !hasActiveSegments
          ? "请先导入并确认至少 1 个 PDF 分段。"
          : undefined,
      };
    }
    if (tool.id === "browse" || tool.id === "record" || tool.id === "paper") {
      return {
        chip: hasAvailability
          ? `${formatCount(counts.questions)} 道题`
          : "需要题目",
        disabled: !hasIndexedQuestions,
        reason: !hasIndexedQuestions ? "请先建立题目索引。" : undefined,
      };
    }
    if (tool.id === "subject") {
      return {
        chip: hasAvailability
          ? `${formatCount(counts.subjects)} 个科目`
          : "无需前置",
        disabled: false,
        reason: undefined,
      };
    }
    return {
      chip: hasAvailability
        ? `${formatCount(counts.workbooks)} 个练习册`
        : "无需前置",
      disabled: false,
      reason: undefined,
    };
  };

  const statusId = "question-bank-tools-status";

  return (
    <EditorDialog
      title="题库工具"
      description="按分类查找工具；导入 PDF 仍从题库主页的主入口开始。"
      dirty={false}
      onRequestClose={onClose}
      closeDisabled={refreshBusy}
      size="large"
      className="editor-dialog-tools"
      returnFocusRef={returnFocusRef}
      fallbackFocusRef={fallbackFocusRef}
      initialFocusRef={
        effectiveFocusTool === undefined ? activeSectionButtonRef : undefined
      }
    >
      <div className="question-bank-tools-dialog">
        <div className="question-bank-tools-breadcrumb" aria-label="当前位置">
          <span>题库</span>
          <span aria-hidden="true">/</span>
          <strong>工具</strong>
        </div>

        <div className="question-bank-tools-layout">
          <aside className="question-bank-tools-sidebar">
            <div className="question-bank-tools-sidebar-heading">
              <span className="eyebrow">工具分组</span>
              <span>{TOOL_DEFINITIONS.length} 个工具</span>
            </div>
            <nav aria-label="题库工具分组">
              <div role="tablist" aria-orientation={tabOrientation}>
                {TOOL_SECTIONS.map((item) => {
                  const selected = item.id === activeSection;
                  return (
                    <button
                      key={item.id}
                      id={`question-bank-tools-section-${item.id}`}
                      ref={(button) => {
                        if (button === null) {
                          sectionButtonRefs.current.delete(item.id);
                        } else {
                          sectionButtonRefs.current.set(item.id, button);
                        }
                        if (item.id === activeSection) {
                          activeSectionButtonRef.current = button;
                        }
                      }}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      tabIndex={selected ? 0 : -1}
                      aria-controls={
                        selected
                          ? `question-bank-tools-panel-${item.id}`
                          : undefined
                      }
                      className={
                        selected
                          ? "question-bank-tools-section question-bank-tools-section-active"
                          : "question-bank-tools-section"
                      }
                      onClick={() => chooseSection(item.id)}
                      onKeyDown={(event) =>
                        handleSectionKeyDown(
                          event,
                          TOOL_SECTIONS.findIndex(
                            (section) => section.id === item.id,
                          ),
                        )
                      }
                    >
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                      <small>
                        {
                          TOOL_DEFINITIONS.filter(
                            (tool) => tool.section === item.id,
                          ).length
                        }{" "}
                        个工具
                      </small>
                    </button>
                  );
                })}
              </div>
            </nav>
            <p className="question-bank-tools-sidebar-note">
              需要导入 PDF？请关闭此窗口，在题库主页使用“导入 PDF”。
            </p>
          </aside>

          <section
            id={`question-bank-tools-panel-${sectionDefinition.id}`}
            className="question-bank-tools-panel"
            role="tabpanel"
            aria-labelledby={`question-bank-tools-section-${sectionDefinition.id}`}
            tabIndex={-1}
          >
            <header className="question-bank-tools-panel-heading">
              <div>
                <span className="eyebrow">
                  题库 / 工具 / {sectionDefinition.label}
                </span>
                <h3>{sectionDefinition.label}</h3>
                <p>{sectionDefinition.description}。</p>
              </div>
              <span className="question-bank-tools-panel-count">
                {sectionTools.length} 个工具
              </span>
            </header>

            {resolvedStatus === null ? null : (
              <p
                id={statusId}
                className={`question-bank-tools-status question-bank-tools-status-${resolvedStatus.tone}`}
                role={resolvedStatus.tone === "error" ? "alert" : "status"}
                aria-live={
                  resolvedStatus.tone === "error" ? undefined : "polite"
                }
              >
                {resolvedStatus.message}
              </p>
            )}
            {isLoading ? (
              <p
                className="question-bank-tools-loading"
                role="status"
                aria-live="polite"
              >
                正在读取题库状态…
              </p>
            ) : null}

            <div className="question-bank-tools-card-grid">
              {sectionTools.map((tool) => {
                const state = toolState(tool);
                const selected = selectedTool === tool.id;
                const reasonId = `question-bank-tools-disabled-${tool.id}`;
                const describedBy =
                  state.reason === undefined
                    ? resolvedStatus === null
                      ? undefined
                      : statusId
                    : reasonId;
                return (
                  <button
                    key={tool.id}
                    ref={(button) => {
                      if (button === null)
                        toolButtonRefs.current.delete(tool.id);
                      else toolButtonRefs.current.set(tool.id, button);
                    }}
                    type="button"
                    className={
                      selected
                        ? "question-bank-tool-card question-bank-tool-card-selected"
                        : "question-bank-tool-card"
                    }
                    disabled={state.disabled}
                    aria-current={selected ? "step" : undefined}
                    aria-describedby={describedBy}
                    aria-busy={
                      tool.id === "refresh" && refreshBusy ? true : undefined
                    }
                    onClick={(event) => selectTool(tool.id, event)}
                  >
                    <span className="question-bank-tool-card-icon">
                      <ToolIcon kind={tool.icon} />
                    </span>
                    <span className="question-bank-tool-card-body">
                      <span className="question-bank-tool-card-title-row">
                        <strong>{tool.title}</strong>
                        <span className="question-bank-tool-chip">
                          {state.chip}
                        </span>
                      </span>
                      <span className="question-bank-tool-card-description">
                        {tool.description}
                      </span>
                      <span className="question-bank-tool-card-action">
                        {tool.id === "refresh" && refreshBusy
                          ? "正在刷新…"
                          : tool.actionLabel}
                      </span>
                      {state.reason === undefined ? null : (
                        <span
                          id={reasonId}
                          className="question-bank-tool-card-disabled-reason"
                        >
                          {state.reason}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </EditorDialog>
  );
}
