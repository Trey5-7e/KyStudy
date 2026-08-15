import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "text";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      type = "button",
      variant = "secondary",
      size = "md",
      block = false,
      className,
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        className={[
          "ui-button",
          `ui-button-${variant}`,
          `ui-button-${size}`,
          block ? "ui-button-block" : undefined,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
      />
    );
  },
);
