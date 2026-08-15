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
}> = [
  { id: "today", label: "今日", caption: "今天需要完成的内容" },
  { id: "planning", label: "计划", caption: "周期计划与未来安排" },
  { id: "workbook", label: "习题册", caption: "PDF 题目与作答" },
  { id: "review", label: "错题", caption: "每日复习队列" },
  { id: "library", label: "资料", caption: "PDF、图片与导图" },
];

export interface AppNavigationProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
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
      <span aria-hidden="true">⚙</span>
      <span>
        <strong>设置</strong>
        <small>学习偏好、AI 与数据</small>
      </span>
    </a>
  );
}

export function AppNavigation({ activeView, onNavigate }: AppNavigationProps) {
  const activePrimaryView = primaryViewFor(activeView);
  return (
    <aside className="app-sidebar">
      <AppBrand />

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
              <strong>{item.label}</strong>
              <span>{item.caption}</span>
            </a>
          );
        })}
      </nav>

      <SettingsLink activeView={activeView} onNavigate={onNavigate} />
    </aside>
  );
}
