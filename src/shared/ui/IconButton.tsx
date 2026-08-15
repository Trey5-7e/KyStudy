import { forwardRef } from "react";

import { Button, type ButtonProps } from "./Button";

export type IconButtonProps = ButtonProps & { "aria-label": string };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ className, ...props }, ref) {
    return (
      <Button
        {...props}
        ref={ref}
        className={["ui-icon-button", className].filter(Boolean).join(" ")}
      />
    );
  },
);
