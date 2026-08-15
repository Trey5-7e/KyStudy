import type { HTMLAttributes, ReactNode } from "react";

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  children: ReactNode;
}

export function Toolbar({
  label,
  className,
  children,
  ...props
}: ToolbarProps) {
  return (
    <div
      {...props}
      className={["ui-toolbar", className].filter(Boolean).join(" ")}
      role="toolbar"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function ToolbarSpacer() {
  return <span className="ui-toolbar-spacer" aria-hidden="true" />;
}
