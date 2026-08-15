import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {
  EditorDialog,
  EditorDialogCloseButton,
  EditorDialogFooter,
} from "../../shared/components/EditorDialog";
import type { WorkbookCategory } from "../../shared/tauri/questionBankClient";
import type { StudySubject } from "../../shared/tauri/scheduleClient";

type RenameTarget =
  | { kind: "subject"; category: StudySubject }
  | { kind: "workbook"; category: WorkbookCategory };

export function QuestionBankCategoryOverview({
  subjects,
  workbooks,
  busyId,
  error,
  onDeleteSubject,
  onDeleteWorkbook,
  onRenameSubject,
  onRenameWorkbook,
}: {
  subjects: StudySubject[];
  workbooks: WorkbookCategory[];
  busyId?: string;
  error?: string;
  onDeleteSubject(subject: StudySubject): void;
  onDeleteWorkbook(workbook: WorkbookCategory): void;
  onRenameSubject(
    subject: StudySubject,
    name: string,
  ): Promise<string | undefined>;
  onRenameWorkbook(
    workbook: WorkbookCategory,
    name: string,
  ): Promise<string | undefined>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>();
  const [renameName, setRenameName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState("");

  if (subjects.length === 0 && workbooks.length === 0 && error === undefined) {
    return null;
  }

  const openRename = (target: RenameTarget) => {
    setRenameTarget(target);
    setRenameName(target.category.name);
    setRenameError("");
  };

  const closeRename = () => {
    if (!renameBusy) setRenameTarget(undefined);
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (renameTarget === undefined) return;
    const name = renameName.trim();
    if (name === "") {
      setRenameError("名称不能为空。");
      return;
    }
    setRenameBusy(true);
    setRenameError("");
    try {
      const message =
        renameTarget.kind === "subject"
          ? await onRenameSubject(renameTarget.category, name)
          : await onRenameWorkbook(renameTarget.category, name);
      if (message === undefined) {
        setRenameTarget(undefined);
      } else {
        setRenameError(message);
      }
    } catch {
      setRenameError("重命名失败，请稍后重试。");
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <>
      <section
        className="question-bank-category-overview"
        aria-labelledby="question-bank-category-overview-title"
      >
        <details
          className="question-bank-category-overview-disclosure"
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary className="question-bank-category-overview-heading">
            <div>
              <h2 id="question-bank-category-overview-title">分类</h2>
              <p>已创建的科目和练习册会实时显示在这里。</p>
            </div>
            <span>
              {subjects.length} 个科目 · {workbooks.length} 个练习册
            </span>
          </summary>

          <div className="question-bank-category-overview-body">
            {error === undefined ? null : (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <div className="question-bank-category-columns">
              <CategoryList
                label="科目"
                emptyLabel="还没有科目"
                items={subjects.map((subject) => ({
                  id: subject.id,
                  name: subject.name,
                  onDelete: () => onDeleteSubject(subject),
                  onRename: () =>
                    openRename({ kind: "subject", category: subject }),
                }))}
                busyId={busyId}
              />
              <CategoryList
                label="练习册"
                emptyLabel="还没有练习册"
                items={workbooks.map((workbook) => ({
                  id: workbook.id,
                  name: workbook.name,
                  onDelete: () => onDeleteWorkbook(workbook),
                  onRename: () =>
                    openRename({ kind: "workbook", category: workbook }),
                }))}
                busyId={busyId}
              />
            </div>
          </div>
        </details>
      </section>

      {renameTarget === undefined ? null : (
        <EditorDialog
          title={
            renameTarget.kind === "subject" ? "重命名科目" : "重命名练习册"
          }
          description="名称修改会立即同步到题库和相关选择器。"
          dirty={renameName !== renameTarget.category.name}
          onRequestClose={closeRename}
          closeDisabled={renameBusy}
        >
          <form
            className="editor-form compact-entity-form"
            onSubmit={(event) => void submitRename(event)}
          >
            <label>
              {renameTarget.kind === "subject" ? "科目名称" : "练习册名称"}
              <input
                autoFocus
                name="categoryName"
                autoComplete="off"
                required
                maxLength={renameTarget.kind === "subject" ? 40 : 120}
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
              />
            </label>
            {renameError === "" ? null : (
              <p className="form-error" role="alert">
                {renameError}
              </p>
            )}
            <EditorDialogFooter className="editor-actions question-bank-dialog-footer">
              <EditorDialogCloseButton
                className="secondary-button"
                disabled={renameBusy}
              >
                取消
              </EditorDialogCloseButton>
              <button
                type="submit"
                className="primary-button"
                disabled={renameBusy}
              >
                {renameBusy ? "正在保存…" : "保存名称"}
              </button>
            </EditorDialogFooter>
          </form>
        </EditorDialog>
      )}
    </>
  );
}

function CategoryList({
  label,
  emptyLabel,
  items,
  busyId,
}: {
  label: string;
  emptyLabel: string;
  items: Array<{
    id: string;
    name: string;
    onDelete(): void;
    onRename(): void;
  }>;
  busyId?: string;
}) {
  return (
    <section
      className="question-bank-category-list"
      aria-labelledby={`question-bank-category-${label}`}
    >
      <header>
        <h3 id={`question-bank-category-${label}`}>{label}</h3>
        <span>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="question-bank-category-empty">{emptyLabel}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <CategoryItemRow
              key={item.id}
              item={item}
              busy={busyId === item.id}
              disabled={busyId !== undefined}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CategoryItemRow({
  item,
  busy,
  disabled,
}: {
  item: {
    id: string;
    name: string;
    onDelete(): void;
    onRename(): void;
  };
  busy: boolean;
  disabled: boolean;
}) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const closeMenu = useCallback(() => {
    menuRef.current?.removeAttribute("open");
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closeMenu, menuOpen]);

  return (
    <li>
      <span title={item.name}>{item.name}</span>
      <details
        ref={menuRef}
        className="question-bank-category-row-menu"
        onToggle={() => setMenuOpen(menuRef.current?.open ?? false)}
      >
        <summary aria-label={`${item.name} 的更多操作`}>
          <span aria-hidden="true">⋯</span>
        </summary>
        <div className="question-bank-category-row-menu-popover" role="menu">
          <button
            type="button"
            role="menuitem"
            className="question-bank-category-menu-item"
            disabled={disabled}
            onClick={() => {
              closeMenu();
              item.onRename();
            }}
          >
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            className="question-bank-category-menu-item question-bank-category-menu-danger"
            disabled={disabled}
            onClick={() => {
              closeMenu();
              item.onDelete();
            }}
          >
            {busy ? "删除中…" : "删除"}
          </button>
        </div>
      </details>
    </li>
  );
}
