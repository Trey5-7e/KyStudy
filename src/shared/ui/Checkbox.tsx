import { forwardRef, type InputHTMLAttributes } from "react";

import { useFieldControl } from "./Field";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, ...props }, ref) {
    const field = useFieldControl();
    const describedBy = [props["aria-describedby"], field.describedBy]
      .filter(Boolean)
      .join(" ");
    return (
      <input
        {...props}
        ref={ref}
        id={field.controlId ?? props.id}
        type="checkbox"
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={(props["aria-invalid"] ?? field.invalid) || undefined}
        className={["ui-checkbox", className].filter(Boolean).join(" ")}
      />
    );
  },
);
