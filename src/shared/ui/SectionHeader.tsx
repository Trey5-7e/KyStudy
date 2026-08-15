import type { ReactNode } from "react";

export interface SectionHeaderProps {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}

export function SectionHeader({
  id,
  title,
  description,
  actions,
  level = 2,
  className,
}: SectionHeaderProps) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <header
      className={["ui-section-header", className].filter(Boolean).join(" ")}
    >
      <div>
        <Heading id={id}>{title}</Heading>
        {description === undefined ? null : <p>{description}</p>}
      </div>
      {actions === undefined ? null : (
        <div className="ui-section-header-actions">{actions}</div>
      )}
    </header>
  );
}
