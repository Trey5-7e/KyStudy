import { forwardRef, type SelectHTMLAttributes } from "react";

import { useFieldControl } from "./Field";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, ...props }, ref) {
    const field = useFieldControl();
    const describedBy = [props["aria-describedby"], field.describedBy]
      .filter(Boolean)
      .join(" ");
    return (
      <select
        {...props}
        ref={ref}
        id={field.controlId ?? props.id}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={(props["aria-invalid"] ?? field.invalid) || undefined}
        className={["ui-control", "ui-select", className]
          .filter(Boolean)
          .join(" ")}
      />
    );
  },
);
