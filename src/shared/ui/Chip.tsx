import type { HTMLAttributes } from "react";

export type ChipProps = HTMLAttributes<HTMLSpanElement>;

export function Chip({ className, ...props }: ChipProps) {
  return (
    <span
      {...props}
      className={["ui-chip", className].filter(Boolean).join(" ")}
    />
  );
}
