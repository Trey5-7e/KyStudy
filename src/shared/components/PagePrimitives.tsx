import type { ReactNode } from "react";

type PageHeaderProps = {
  id?: string;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  backAction?: ReactNode;
};

export function PageHeader({
  id,
  eyebrow,
  title,
  description,
  actions,
  backAction,
}: PageHeaderProps) {
  const hasActions = actions !== undefined || backAction !== undefined;

  return (
    <header className="page-header">
      <div className="page-header-content">
        {eyebrow === undefined ? null : (
          <p className="page-header-eyebrow eyebrow">{eyebrow}</p>
        )}
        <h1 id={id} className="page-header-title">
          {title}
        </h1>
        {description === undefined ? null : (
          <p className="page-header-description">{description}</p>
        )}
      </div>
      {hasActions ? (
        <div className="page-header-actions">
          {actions}
          {backAction === undefined ? null : (
            <div className="page-header-back-action">{backAction}</div>
          )}
        </div>
      ) : null}
    </header>
  );
}

type PageSurfaceProps = {
  as?: "section" | "div";
  labelledBy?: string;
  variant?: "default" | "muted";
  className?: string;
  children: ReactNode;
};

export function PageSurface({
  as = "section",
  labelledBy,
  variant = "default",
  className,
  children,
}: PageSurfaceProps) {
  const surfaceClassName = [
    "page-surface",
    `page-surface-${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const labelledByProps =
    labelledBy === undefined ? {} : { "aria-labelledby": labelledBy };

  if (as === "div") {
    return (
      <div className={surfaceClassName} {...labelledByProps}>
        {children}
      </div>
    );
  }

  return (
    <section className={surfaceClassName} {...labelledByProps}>
      {children}
    </section>
  );
}

type PageStatusTone = "loading" | "info" | "success" | "warning" | "error";
type PageStatusLive = "polite" | "assertive" | "off";

type PageStatusProps = {
  tone: PageStatusTone;
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  live?: PageStatusLive;
};

export function PageStatus({
  tone,
  title,
  action,
  children,
  live,
}: PageStatusProps) {
  const liveValue =
    live ??
    (tone === "error" ? undefined : tone === "loading" ? "polite" : "polite");
  const role =
    tone === "error" ? "alert" : liveValue === "off" ? undefined : "status";

  return (
    <div
      className={`status-banner page-status page-status-${tone}`}
      data-tone={tone}
      role={role}
      aria-live={liveValue === "off" ? undefined : liveValue}
    >
      {title === undefined ? null : <strong>{title}</strong>}
      {children === undefined ? null : <p>{children}</p>}
      {action === undefined ? null : (
        <div className="status-banner-action">{action}</div>
      )}
    </div>
  );
}

type PageEmptyProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
  announce?: boolean;
};

export function PageEmpty({
  title,
  description,
  action,
  className,
  headingLevel = 2,
  announce = false,
}: PageEmptyProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const emptyClassName = ["empty-state", "page-empty", className]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={emptyClassName}
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
    >
      <Heading>{title}</Heading>
      {description === undefined ? null : <p>{description}</p>}
      {action === undefined ? null : (
        <div className="page-empty-action">{action}</div>
      )}
    </section>
  );
}

export type {
  PageEmptyProps,
  PageHeaderProps,
  PageStatusLive,
  PageStatusProps,
  PageStatusTone,
  PageSurfaceProps,
};
