import { forwardRef, type InputHTMLAttributes } from "react";

import { useFieldControl } from "./Field";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...props },
  ref,
) {
  const field = useFieldControl();
  const describedBy = [props["aria-describedby"], field.describedBy]
    .filter(Boolean)
    .join(" ");
  return (
    <input
      {...props}
      ref={ref}
      id={field.controlId ?? props.id}
      aria-describedby={describedBy === "" ? undefined : describedBy}
      aria-invalid={(props["aria-invalid"] ?? field.invalid) || undefined}
      className={["ui-control", "ui-input", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
});
