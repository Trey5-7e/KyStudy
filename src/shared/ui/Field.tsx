import { createContext, useContext, useId, type ReactNode } from "react";

interface FieldControlContextValue {
  controlId?: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldControlContext = createContext<FieldControlContextValue>({
  invalid: false,
});

export function useFieldControl(): FieldControlContextValue {
  return useContext(FieldControlContext);
}

export interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({
  label,
  htmlFor,
  description,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const generatedId = useId();
  const controlId = htmlFor ?? `${generatedId}-control`;
  const descriptionId = `${generatedId}-description`;
  const errorId = `${generatedId}-error`;
  const describedBy = [
    description === undefined ? undefined : descriptionId,
    error === undefined ? undefined : errorId,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={["ui-field", className].filter(Boolean).join(" ")}>
      <label className="ui-field-label" htmlFor={controlId}>
        {label}
        {required ? (
          <span className="ui-field-required" aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
      </label>
      <FieldControlContext.Provider
        value={{
          controlId,
          describedBy: describedBy === "" ? undefined : describedBy,
          invalid: error !== undefined,
        }}
      >
        {children}
      </FieldControlContext.Provider>
      {description === undefined ? null : (
        <p id={descriptionId} className="ui-field-description">
          {description}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className="ui-field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
