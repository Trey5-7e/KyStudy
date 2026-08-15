import { useEffect, useState } from "react";

import type { ResourceOpenRequest } from "../features/library/ResourcePanel";
import {
  resolveHashView,
  resolveStoredView,
  storedViewFor,
  type AppView,
} from "./navigation";
import { AppShell } from "./AppShell";
import type { QuestionBankOpenRequest } from "../features/workbook/questionBankWindowModel";

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
  const [resourceOpenRequest, setResourceOpenRequest] =
    useState<ResourceOpenRequest>();
  const [reviewOpenRequest, setReviewOpenRequest] = useState<number>();
  const [workbookOpenRequest, setWorkbookOpenRequest] =
    useState<QuestionBankOpenRequest>();

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

  const navigate = (view: AppView) => {
    if (view !== "review") {
      setReviewOpenRequest(undefined);
    }
    if (view !== "workbook") {
      setWorkbookOpenRequest(undefined);
    }
    setActiveView(view);
    storeView(view);
    const nextHash = `#${view}`;
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash);
    }
  };

  const openResource = (documentId: string, page: number) => {
    setResourceOpenRequest({ documentId, page, nonce: Date.now() });
    navigate("library");
  };

  return (
    <AppShell
      activeView={activeView}
      resourceOpenRequest={resourceOpenRequest}
      reviewOpenRequest={reviewOpenRequest}
      workbookOpenRequest={workbookOpenRequest}
      onOpenResource={openResource}
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
      onNavigate={navigate}
    />
  );
}
