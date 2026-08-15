import type { ReactNode } from "react";

export type StatusBannerTone = "info" | "success" | "warning" | "error";

export interface StatusBannerProps {
  tone?: StatusBannerTone;
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  live?: "polite" | "assertive" | "off";
  className?: string;
}

export function StatusBanner({
  tone = "info",
  title,
  actions,
  children,
  live,
  className,
}: StatusBannerProps) {
  const liveMode = live ?? (tone === "error" ? "assertive" : "polite");
  return (
    <div
      className={["ui-status-banner", `ui-status-banner-${tone}`, className]
        .filter(Boolean)
        .join(" ")}
      role={
        tone === "error" ? "alert" : liveMode === "off" ? undefined : "status"
      }
      aria-live={liveMode === "off" ? undefined : liveMode}
    >
      {title === undefined ? null : <strong>{title}</strong>}
      {children === undefined ? null : <div>{children}</div>}
      {actions === undefined ? null : (
        <div className="ui-status-banner-actions">{actions}</div>
      )}
    </div>
  );
}
