import { forwardRef, type TextareaHTMLAttributes } from "react";

import { useFieldControl } from "./Field";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...props }, ref) {
    const field = useFieldControl();
    const describedBy = [props["aria-describedby"], field.describedBy]
      .filter(Boolean)
      .join(" ");
    return (
      <textarea
        {...props}
        ref={ref}
        id={field.controlId ?? props.id}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={(props["aria-invalid"] ?? field.invalid) || undefined}
        className={["ui-control", "ui-textarea", className]
          .filter(Boolean)
          .join(" ")}
      />
    );
  },
);
