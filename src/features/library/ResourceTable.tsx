import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";

import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { Select } from "../../shared/ui/Select";
import type { ResourceDocument } from "../../shared/tauri/resourceClient";
import {
  canOpenResource,
  formatResourceBytes,
  RESOURCE_KIND_LABELS,
  ROLE_LABELS,
  resourceProgressLabel,
} from "./resourceListModel";

interface ResourceTableProps {
  resources: ResourceDocument[];
  readerLoading: boolean;
  onOpen(documentId: string): void;
  onChangeRole(documentId: string, role: ResourceDocument["role"]): void;
  onRequestDelete(resource: ResourceDocument): void;
}

export function ResourceTable({
  resources,
  readerLoading,
  onOpen,
  onChangeRole,
  onRequestDelete,
}: ResourceTableProps) {
  return (
    <div className="resource-table-wrap">
      <table className="resource-list">
        <caption className="sr-only">本地资料列表</caption>
        <thead>
          <tr>
            <th scope="col">名称</th>
            <th scope="col">类型</th>
            <th scope="col">大小 / 阅读进度</th>
            <th scope="col">用途</th>
            <th scope="col" className="resource-action-heading">
              操作
            </th>
            <th scope="col" aria-label="更多操作" />
          </tr>
        </thead>
        <tbody>
          {resources.map((resource) => (
            <ResourceRow
              key={resource.id}
              resource={resource}
              readerLoading={readerLoading}
              onOpen={onOpen}
              onChangeRole={onChangeRole}
              onRequestDelete={onRequestDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ResourceRowProps {
  resource: ResourceDocument;
  readerLoading: boolean;
  onOpen(documentId: string): void;
  onChangeRole(documentId: string, role: ResourceDocument["role"]): void;
  onRequestDelete(resource: ResourceDocument): void;
}

function ResourceRow({
  resource,
  readerLoading,
  onOpen,
  onChangeRole,
  onRequestDelete,
}: ResourceRowProps) {
  const roleSelectRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const progressLabel = resourceProgressLabel(resource);

  const focusRoleEditor = () => {
    menuRef.current?.removeAttribute("open");
    requestAnimationFrame(() => roleSelectRef.current?.focus());
  };

  return (
    <tr>
      <th scope="row">
        <div className="resource-title-cell">
          <strong title={resource.title}>{resource.title}</strong>
          <span>{resource.mimeType}</span>
        </div>
      </th>
      <td>
        <Badge tone="neutral">{RESOURCE_KIND_LABELS[resource.kind]}</Badge>
      </td>
      <td>
        <div className="resource-meta-cell">
          <span>{formatResourceBytes(resource.sizeBytes)}</span>
          {progressLabel === null ? null : <span>{progressLabel}</span>}
        </div>
      </td>
      <ResourceRoleCell
        resource={resource}
        selectRef={roleSelectRef}
        onChangeRole={onChangeRole}
      />
      <ResourceOpenCell
        resource={resource}
        readerLoading={readerLoading}
        onOpen={onOpen}
      />
      <ResourceRowActions
        resource={resource}
        menuRef={menuRef}
        onFocusRoleEditor={focusRoleEditor}
        onRequestDelete={onRequestDelete}
      />
    </tr>
  );
}

interface ResourceRoleCellProps {
  resource: ResourceDocument;
  selectRef: RefObject<HTMLSelectElement | null>;
  onChangeRole(documentId: string, role: ResourceDocument["role"]): void;
}

function ResourceRoleCell({
  resource,
  selectRef,
  onChangeRole,
}: ResourceRoleCellProps) {
  const roleId = `resource-role-${resource.id}`;
  return (
    <td>
      <Field label="用途" htmlFor={roleId} className="resource-role-field">
        <Select
          ref={selectRef}
          id={roleId}
          name={roleId}
          autoComplete="off"
          value={resource.role}
          aria-label={`${resource.title} 的用途`}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            onChangeRole(
              resource.id,
              event.target.value as ResourceDocument["role"],
            )
          }
        >
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
    </td>
  );
}

interface ResourceOpenCellProps {
  resource: ResourceDocument;
  readerLoading: boolean;
  onOpen(documentId: string): void;
}

function ResourceOpenCell({
  resource,
  readerLoading,
  onOpen,
}: ResourceOpenCellProps) {
  return (
    <td className="resource-open-cell">
      {canOpenResource(resource) ? (
        <Button
          variant="primary"
          size="sm"
          className="resource-open-button"
          disabled={readerLoading}
          aria-label={`打开 ${resource.title}`}
          onClick={() => onOpen(resource.id)}
        >
          打开
        </Button>
      ) : (
        <span className="resource-unavailable">暂不支持</span>
      )}
    </td>
  );
}

interface ResourceRowActionsProps {
  resource: ResourceDocument;
  menuRef: RefObject<HTMLDetailsElement | null>;
  onFocusRoleEditor(): void;
  onRequestDelete(resource: ResourceDocument): void;
}

function ResourceRowActions({
  resource,
  menuRef,
  onFocusRoleEditor,
  onRequestDelete,
}: ResourceRowActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const positionMenu = useCallback(() => {
    const summary = summaryRef.current;
    const popover = popoverRef.current;
    if (!summary || !popover) return;
    const anchor = summary.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const gap = 8;
    const viewportPadding = 8;
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - width - viewportPadding,
    );
    const left = Math.min(
      Math.max(viewportPadding, anchor.right - width),
      maxLeft,
    );
    const opensDown =
      anchor.bottom + gap + height <= window.innerHeight - viewportPadding;
    const top = opensDown
      ? anchor.bottom + gap
      : Math.max(viewportPadding, anchor.top - gap - height);
    setMenuPosition({ top, left });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const frame = window.requestAnimationFrame(positionMenu);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [menuOpen, positionMenu]);

  const closeMenu = useCallback(() => {
    menuRef.current?.removeAttribute("open");
    setMenuOpen(false);
    setMenuPosition(null);
  }, [menuRef]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [closeMenu, menuOpen, menuRef]);

  const focusRoleEditor = () => {
    closeMenu();
    onFocusRoleEditor();
  };

  const requestDelete = () => {
    closeMenu();
    onRequestDelete(resource);
  };

  return (
    <td className="resource-menu-cell">
      <details
        ref={menuRef}
        className="resource-row-menu"
        data-resource-menu={resource.id}
        onToggle={() => {
          const open = menuRef.current?.open ?? false;
          setMenuOpen(open);
          if (!open) setMenuPosition(null);
        }}
      >
        <summary ref={summaryRef} aria-label={`${resource.title} 的更多操作`}>
          <span aria-hidden="true">⋯</span>
        </summary>
        <div
          ref={popoverRef}
          className="resource-row-menu-popover"
          style={
            menuPosition === null
              ? { visibility: "hidden" }
              : {
                  top: menuPosition.top,
                  left: menuPosition.left,
                  visibility: "visible",
                }
          }
        >
          <Button variant="ghost" size="sm" onClick={focusRoleEditor}>
            更改用途
          </Button>
          <Button variant="danger" size="sm" onClick={requestDelete}>
            删除资料
          </Button>
        </div>
      </details>
    </td>
  );
}
