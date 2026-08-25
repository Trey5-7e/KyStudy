import { useEffect, useState } from "react";

import {
  resolveHashView,
  resolveStoredView,
  storedViewFor,
  type AppView,
} from "./navigation";
import { AppShell } from "./AppShell";
import type { QuestionBankOpenRequest } from "../features/workbook/questionBankWindowModel";
import type { ResourceOpenRequest } from "../features/library/ResourcePanel";
import { AI_CHAT_OPEN_EVENT } from "../features/ai-chat/aiChatContext";

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
  const [reviewOpenRequest, setReviewOpenRequest] = useState<number>();
  const [workbookOpenRequest, setWorkbookOpenRequest] =
    useState<QuestionBankOpenRequest>();
  const [resourceOpenRequest, setResourceOpenRequest] =
    useState<ResourceOpenRequest>();

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

  return (
    <AppShell
      activeView={activeView}
      reviewOpenRequest={reviewOpenRequest}
      workbookOpenRequest={workbookOpenRequest}
      resourceOpenRequest={resourceOpenRequest}
      onOpenReviewWindow={() =>
        setReviewOpenRequest((current) => (current ?? 0) + 1)
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
  );
}
