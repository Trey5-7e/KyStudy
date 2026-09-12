import type { MouseEvent } from "react";

import kystudyIcon from "../assets/kystudy-icon.png";
import {
  primaryViewFor,
  shouldInterceptNavigationClick,
  type AppView,
  type PrimaryAppView,
} from "./navigation";

export const PRIMARY_NAVIGATION: ReadonlyArray<{
  id: PrimaryAppView;
  label: string;
  caption: string;
  icon: string;
}> = [
  {
    id: "today",
    label: "今日",
    caption: "今天需要完成的内容",
    icon: "wb_sunny",
  },
  {
    id: "planning",
    label: "计划",
    caption: "周期计划与未来安排",
    icon: "calendar_month",
  },
  {
    id: "workbook",
    label: "习题册",
    caption: "PDF 题目与作答",
    icon: "menu_book",
  },
  { id: "review", label: "错题", caption: "每日复习队列", icon: "rate_review" },
  {
    id: "library",
    label: "资料",
    caption: "PDF、图片与导图",
    icon: "local_library",
  },
  {
    id: "ai-chat",
    label: "AI 学习助手",
    caption: "对话、资料与题目讨论",
    icon: "psychology",
  },
  {
    id: "ai-settings",
    label: "模型与 API",
    caption: "Provider、模型与预算",
    icon: "tune",
  },
];

export interface AppNavigationProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onOpenCommandPalette?: () => void;
}

function AppBrand() {
  return (
    <div className="app-brand" translate="no">
      <img
        className="app-brand-icon"
        src={kystudyIcon}
        alt=""
        aria-hidden="true"
      />
      <div>
        <strong>KyStudy</strong>
        <small>简化备考步骤</small>
      </div>
    </div>
  );
}

function handleNavigationClick(
  event: MouseEvent<HTMLAnchorElement>,
  view: AppView,
  onNavigate: (view: AppView) => void,
) {
  if (!shouldInterceptNavigationClick(event)) {
    return;
  }
  event.preventDefault();
  onNavigate(view);
}

function SettingsLink({ activeView, onNavigate }: AppNavigationProps) {
  const isActive = activeView === "settings";
  return (
    <a
      href="#settings"
      className={
        isActive
          ? "app-settings-link app-settings-link-active"
          : "app-settings-link"
      }
      aria-current={isActive ? "page" : undefined}
      onClick={(event) => handleNavigationClick(event, "settings", onNavigate)}
    >
      <span
        className="material-symbols-rounded app-nav-icon"
        aria-hidden="true"
      >
        settings
      </span>
      <strong>设置</strong>
      <small className="app-nav-caption">学习偏好、隐私与数据</small>
    </a>
  );
}

export function AppNavigation({
  activeView,
  onNavigate,
  onOpenCommandPalette,
}: AppNavigationProps) {
  const activePrimaryView = primaryViewFor(activeView);
  return (
    <aside className="app-sidebar">
      <AppBrand />

      {onOpenCommandPalette && (
        <button
          type="button"
          className="command-palette-trigger"
          onClick={onOpenCommandPalette}
          aria-label="打开快捷动作面板 (Ctrl+K)"
        >
          <span className="command-palette-trigger-left">
            <span className="material-symbols-rounded" aria-hidden="true">
              search
            </span>
            <span>快捷命令…</span>
          </span>
          <kbd>Ctrl K</kbd>
        </button>
      )}

      <nav className="app-navigation" aria-label="主菜单">
        {PRIMARY_NAVIGATION.map((item) => {
          const isActive = item.id === activePrimaryView;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={isActive ? "app-nav-active" : undefined}
              aria-current={isActive ? "page" : undefined}
              onClick={(event) =>
                handleNavigationClick(event, item.id, onNavigate)
              }
            >
              <span
                className="material-symbols-rounded app-nav-icon"
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <strong>{item.label}</strong>
              <small className="app-nav-caption">{item.caption}</small>
            </a>
          );
        })}
      </nav>

      <SettingsLink activeView={activeView} onNavigate={onNavigate} />
    </aside>
  );
}
