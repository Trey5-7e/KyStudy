import {
  createContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useCallback,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
} from "react";

let openEditorDialogCount = 0;
let previousDocumentOverflow = "";

type NavigationIntent = "close" | "back";

export interface EditorDialogNavigation {
  requestClose(): void;
  requestBack(): void;
  hasBack: boolean;
  closeDisabled: boolean;
}

const EditorDialogNavigationContext =
  createContext<EditorDialogNavigation | null>(null);

export function useEditorDialogNavigation(): EditorDialogNavigation {
  const navigation = useContext(EditorDialogNavigationContext);
  if (navigation === null) {
    throw new Error(
      "useEditorDialogNavigation must be used inside an EditorDialog",
    );
  }
  return navigation;
}

export type EditorDialogCloseButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "type" | "onClick" | "disabled"
> & {
  children?: ReactNode;
  disabled?: boolean;
};

/** A footer navigation action that returns to the parent when one exists. */
export function EditorDialogCloseButton({
  children = "关闭",
  className = "text-button",
  disabled = false,
  ...buttonProps
}: EditorDialogCloseButtonProps) {
  const { requestClose, requestBack, hasBack, closeDisabled } =
    useEditorDialogNavigation();
  return (
    <button
      {...buttonProps}
      type="button"
      className={className}
      disabled={disabled || closeDisabled}
      onClick={hasBack ? requestBack : requestClose}
    >
      {children}
    </button>
  );
}

export function EditorDialogFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        className === undefined
          ? "editor-dialog-footer"
          : `editor-dialog-footer ${className}`
      }
    >
      {children}
    </div>
  );
}

function focusIfConnected(target: HTMLElement | null | undefined): boolean {
  if (target?.isConnected !== true) return false;
  target.focus({ preventScroll: true });
  return true;
}

function lockDocumentScroll(): () => void {
  if (openEditorDialogCount === 0) {
    previousDocumentOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
  openEditorDialogCount += 1;
  return () => {
    openEditorDialogCount = Math.max(0, openEditorDialogCount - 1);
    if (openEditorDialogCount === 0) {
      document.documentElement.style.overflow = previousDocumentOverflow;
    }
  };
}

export function EditorDialog({
  title,
  description,
  dirty,
  onRequestClose,
  onRequestBack,
  backLabel = "返回",
  children,
  size = "medium",
  className,
  closeDisabled = false,
  backRequiresConfirmation = true,
  initialFocusRef,
  returnFocusRef,
  fallbackFocusRef,
}: {
  title: string;
  description?: string;
  dirty: boolean;
  onRequestClose(): void;
  onRequestBack?(): void;
  backLabel?: string;
  children: ReactNode;
  size?: "medium" | "large" | "review";
  className?: string;
  closeDisabled?: boolean;
  backRequiresConfirmation?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const openedFromFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const confirmTitleId = useId();
  const confirmDescriptionId = useId();
  const [confirmIntent, setConfirmIntent] = useState<NavigationIntent>();
  const confirmClose = confirmIntent !== undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocusTarget = returnFocusRef?.current;
    const fallbackFocusTarget = fallbackFocusRef?.current;
    openedFromFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const unlockDocumentScroll = lockDocumentScroll();
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
    requestAnimationFrame(() => {
      if (focusIfConnected(initialFocusRef?.current)) return;
      focusIfConnected(titleRef.current);
    });
    return () => {
      if (dialog?.open) {
        dialog.close();
      }
      requestAnimationFrame(() => {
        if (focusIfConnected(returnFocusTarget)) return;
        if (focusIfConnected(openedFromFocusRef.current)) return;
        focusIfConnected(fallbackFocusTarget);
      });
      unlockDocumentScroll();
    };
  }, [fallbackFocusRef, initialFocusRef, returnFocusRef]);

  useEffect(() => {
    if (confirmClose) {
      focusIfConnected(confirmButtonRef.current);
    }
  }, [confirmClose]);

  const requestNavigation = useCallback(
    (intent: NavigationIntent) => {
      if (closeDisabled) return;
      if (intent === "back" && !backRequiresConfirmation) {
        onRequestBack?.();
        return;
      }
      if (dirty) {
        previousFocusRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        setConfirmIntent(intent);
        return;
      }
      if (intent === "back") {
        onRequestBack?.();
      } else {
        onRequestClose();
      }
    },
    [
      backRequiresConfirmation,
      closeDisabled,
      dirty,
      onRequestBack,
      onRequestClose,
    ],
  );

  const requestClose = useCallback(
    () => requestNavigation("close"),
    [requestNavigation],
  );

  const requestBack = useCallback(
    () => requestNavigation("back"),
    [requestNavigation],
  );

  const navigation = useMemo<EditorDialogNavigation>(
    () => ({
      requestClose,
      requestBack,
      hasBack: onRequestBack !== undefined,
      closeDisabled,
    }),
    [closeDisabled, onRequestBack, requestBack, requestClose],
  );

  const discardChanges = () => {
    const intent = confirmIntent;
    setConfirmIntent(undefined);
    if (intent === "back") {
      onRequestBack?.();
      return;
    }
    onRequestClose();
  };

  const continueEditing = () => {
    setConfirmIntent(undefined);
    requestAnimationFrame(() => focusIfConnected(previousFocusRef.current));
  };

  const dialogClassName = ["editor-dialog", `editor-dialog-${size}`, className]
    .filter((value): value is string => value !== undefined && value !== "")
    .join(" ");

  return (
    <dialog
      ref={dialogRef}
      className={dialogClassName}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      aria-busy={closeDisabled ? true : undefined}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <EditorDialogNavigationContext.Provider value={navigation}>
        <div className="editor-dialog-surface">
          <header
            className="editor-dialog-header"
            inert={confirmClose ? true : undefined}
          >
            <div>
              <h2 ref={titleRef} id={titleId} tabIndex={-1}>
                {title}
              </h2>
              {description === undefined ? null : (
                <p id={descriptionId}>{description}</p>
              )}
            </div>
            <div className="editor-dialog-header-actions">
              {onRequestBack === undefined ? null : (
                <button
                  type="button"
                  className="text-button"
                  disabled={closeDisabled}
                  aria-label={`${backLabel}${title}`}
                  onClick={requestBack}
                >
                  {backLabel}
                </button>
              )}
              <button
                type="button"
                className="editor-dialog-close-button"
                disabled={closeDisabled}
                aria-label={`关闭${title}`}
                title={`关闭${title}`}
                onClick={requestClose}
              >
                <span className="editor-dialog-close-icon" aria-hidden="true">
                  ×
                </span>
              </button>
            </div>
          </header>
          <div
            className="editor-dialog-content"
            inert={confirmClose ? true : undefined}
          >
            {children}
          </div>
          {confirmClose ? (
            <div
              className="editor-dialog-confirm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={confirmTitleId}
              aria-describedby={confirmDescriptionId}
            >
              <strong id={confirmTitleId}>放弃未保存的修改？</strong>
              <p id={confirmDescriptionId}>离开后，本次填写的内容不会保留。</p>
              <div>
                <button
                  type="button"
                  className="danger-button"
                  disabled={closeDisabled}
                  onClick={discardChanges}
                >
                  放弃修改
                </button>
                <button
                  ref={confirmButtonRef}
                  type="button"
                  className="secondary-button"
                  onClick={continueEditing}
                >
                  继续编辑
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </EditorDialogNavigationContext.Provider>
    </dialog>
  );
}
