import { useEffect, useMemo, useState } from "react";

import {
  resolveHashView,
  resolveStoredView,
  storedViewFor,
  type AppView,
} from "./navigation";
import { AppShell } from "./AppShell";
import type { QuestionBankOpenRequest } from "../features/workbook/questionBankWindowModel";
import type { ResourceOpenRequest } from "../features/library/ResourcePanel";
import type { ReviewOpenRequest } from "../features/review/ReviewPanel";
import { AI_CHAT_OPEN_EVENT } from "../features/ai-chat/aiChatContext";
import { CommandPaletteDialog } from "../features/command-palette/CommandPaletteDialog";
import type { CommandItem } from "../features/command-palette/commandPaletteModel";

const VIEW_STORAGE_KEY = "kystudy:last-view:v1";

function loadInitialView(): AppView {
  const hashView = resolveHashView(window.location.hash);
  if (hashView !== undefined) {
    return hashView;
  }
  try {
    return resolveStoredView(window.localStorage.getItem(VIEW_STORAGE_KEY));
  } catch {
    return "today";
  }
}

function storeView(view: AppView) {
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, storedViewFor(view));
  } catch {
    // Navigation remains usable when WebView storage is disabled.
  }
}

export function App() {
  const [activeView, setActiveView] = useState<AppView>(loadInitialView);
  const [reviewOpenRequest, setReviewOpenRequest] =
    useState<ReviewOpenRequest>();
  const [workbookOpenRequest, setWorkbookOpenRequest] =
    useState<QuestionBankOpenRequest>();
  const [resourceOpenRequest, setResourceOpenRequest] =
    useState<ResourceOpenRequest>();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (window.location.hash !== `#${activeView}`) {
      window.history.replaceState(null, "", `#${activeView}`);
    }
  }, [activeView]);

  useEffect(() => {
    const syncFromLocation = () => {
      const view = resolveHashView(window.location.hash);
      if (view !== undefined) {
        if (view !== "review") {
          setReviewOpenRequest(undefined);
        }
        if (view !== "workbook") {
          setWorkbookOpenRequest(undefined);
        }
        if (view !== "library") {
          setResourceOpenRequest(undefined);
        }
        setActiveView(view);
        storeView(view);
      }
    };

    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("hashchange", syncFromLocation);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("hashchange", syncFromLocation);
    };
  }, []);

  useEffect(() => {
    const openAiChat = () => {
      setReviewOpenRequest(undefined);
      setWorkbookOpenRequest(undefined);
      setResourceOpenRequest(undefined);
      setActiveView("ai-chat");
      storeView("ai-chat");
      if (window.location.hash !== "#ai-chat") {
        window.history.pushState(null, "", "#ai-chat");
      }
    };

    window.addEventListener(AI_CHAT_OPEN_EVENT, openAiChat);
    return () => window.removeEventListener(AI_CHAT_OPEN_EVENT, openAiChat);
  }, []);

  const navigate = (view: AppView) => {
    if (view !== "review") {
      setReviewOpenRequest(undefined);
    }
    if (view !== "workbook") {
      setWorkbookOpenRequest(undefined);
    }
    if (view !== "library") {
      setResourceOpenRequest(undefined);
    }
    setActiveView(view);
    storeView(view);
    const nextHash = `#${view}`;
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const commands = useMemo<CommandItem[]>(
    () => [
      {
        id: "action-instant-drill",
        title: "立即刷错题",
        description: "自选错题数量或科目，即刻按照错题优先级算法推送刷题",
        category: "action",
        icon: "bolt",
        shortcutHint: "Ctrl+K",
        keywords: ["cuoti", "shuati", "lijishuacuoti", "drill", "chongci"],
        perform: () => {
          setReviewOpenRequest({ kind: "instant-mistake", nonce: Date.now() });
          navigate("review");
        },
      },
      {
        id: "action-quick-record",
        title: "快速登记做题",
        description: "打开习题册矩阵打标，快速录入近期练习正确/错误结果",
        category: "action",
        icon: "edit_note",
        keywords: ["dengji", "luru", "kuaisudengji", "record", "matrix"],
        perform: () => {
          setWorkbookOpenRequest({
            kind: "open-quick-record",
            nonce: Date.now(),
          });
          navigate("workbook");
        },
      },
      {
        id: "action-smart-paper",
        title: "智能组卷练习",
        description: "从习题册自选或恢复草稿，按题型与分段开启模拟卷",
        category: "action",
        icon: "assignment",
        keywords: ["zujuan", "ceshi", "lianxi", "paper", "exam"],
        perform: () => {
          setWorkbookOpenRequest({
            kind: "resume-or-create-paper",
            nonce: Date.now(),
          });
          navigate("workbook");
        },
      },
      {
        id: "action-today-review",
        title: "开始今日连续复习",
        description: "进入错题复习队列，按顺延算法与记忆曲线连续答题",
        category: "action",
        icon: "rate_review",
        keywords: ["fuxi", "jinrifuxi", "lianxufuxi", "review", "queue"],
        perform: () => {
          setReviewOpenRequest({ kind: "continuous", nonce: Date.now() });
          navigate("review");
        },
      },
      {
        id: "nav-today",
        title: "今日概览",
        description: "查看今天学习任务、倒计时与复习进度",
        category: "navigation",
        icon: "wb_sunny",
        keywords: ["jinri", "today", "focus", "gailan"],
        perform: () => navigate("today"),
      },
      {
        id: "nav-planning",
        title: "周期计划",
        description: "查看阶段备考计划、里程碑与复习日程",
        category: "navigation",
        icon: "calendar_month",
        keywords: ["jihua", "zhouqi", "planning", "schedule"],
        perform: () => navigate("planning"),
      },
      {
        id: "nav-workbook",
        title: "习题册与题库",
        description: "浏览教材教辅、题目分段、作答状态与试题矩阵",
        category: "navigation",
        icon: "menu_book",
        keywords: ["xitice", "tiku", "shiti", "workbook"],
        perform: () => navigate("workbook"),
      },
      {
        id: "nav-review",
        title: "错题方案与队列",
        description: "管理各科目错题集、推送规则与每周休息日",
        category: "navigation",
        icon: "rate_review",
        keywords: ["cuoti", "fuxi", "fang'an", "review"],
        perform: () => navigate("review"),
      },
      {
        id: "nav-library",
        title: "参考资料库",
        description: "查阅本地讲义、PDF 资料、导图与参考文档",
        category: "navigation",
        icon: "local_library",
        keywords: ["ziliao", "cankao", "library", "pdf"],
        perform: () => navigate("library"),
      },
      {
        id: "nav-ai-chat",
        title: "AI 学习助手",
        description: "与 AI 助教讨论知识点、试题解析与备考策略",
        category: "navigation",
        icon: "psychology",
        keywords: ["ai", "zhushou", "duihua", "chat"],
        perform: () => navigate("ai-chat"),
      },
      {
        id: "nav-ai-settings",
        title: "AI 模型与 API 设置",
        description: "配置大模型 Provider、API Key、Token 预算与参数",
        category: "navigation",
        icon: "tune",
        keywords: ["moxing", "ai-settings", "apikey", "provider", "token"],
        perform: () => navigate("ai-settings"),
      },
      {
        id: "nav-settings",
        title: "系统设置",
        description: "偏好设置、工作区路径、本地数据备份与导出",
        category: "navigation",
        icon: "settings",
        keywords: ["shezhi", "xitong", "settings", "backup"],
        perform: () => navigate("settings"),
      },
    ],
    [],
  );

  return (
    <>
      <AppShell
        activeView={activeView}
        reviewOpenRequest={reviewOpenRequest}
        workbookOpenRequest={workbookOpenRequest}
        resourceOpenRequest={resourceOpenRequest}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        onOpenInstantMistake={() => {
          setReviewOpenRequest({ kind: "instant-mistake", nonce: Date.now() });
          navigate("review");
        }}
        onOpenReviewWindow={() =>
          setReviewOpenRequest({ kind: "continuous", nonce: Date.now() })
        }
        onOpenPaperShortcut={() => {
          setWorkbookOpenRequest({
            kind: "resume-or-create-paper",
            nonce: Date.now(),
          });
          navigate("workbook");
        }}
        onOpenSettings={() => navigate("settings")}
        onBackToPlanning={() => navigate("planning")}
        onOpenReference={(documentId, page) => {
          setResourceOpenRequest({ documentId, page, nonce: Date.now() });
          navigate("library");
        }}
        onStartPaper={(questions, title) => {
          setWorkbookOpenRequest({
            kind: "start-custom-paper",
            questionIds: questions.map((q) => q.id),
            title,
            nonce: Date.now(),
          });
          navigate("workbook");
        }}
        onNavigate={navigate}
      />
      <CommandPaletteDialog
        open={paletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </>
  );
}
