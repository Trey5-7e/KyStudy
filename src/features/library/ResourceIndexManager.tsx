import type { ResourceDocument } from "../../shared/tauri/resourceClient";
import type { ResourceIndexStatus } from "../../shared/tauri/resourceSearchClient";
import { PageEmpty } from "../../shared/components/PagePrimitives";
import { Button } from "../../shared/ui/Button";
import {
  formatResourceIndexStatus,
  notIndexedResourceStatus,
  type ActiveResourceIndex,
} from "./resourceIndexModel";
import { formatResourceCount } from "./resourceListModel";

interface ResourceIndexManagerProps {
  resources: ResourceDocument[];
  statuses: ResourceIndexStatus[];
  activeIndex?: ActiveResourceIndex;
  clearingId?: string;
  confirmClearId?: string;
  onStart(resource: ResourceDocument, force: boolean): Promise<void>;
  onCancel(): void;
  onClear(documentId: string): Promise<void>;
  onCancelClear(): void;
}

export function ResourceIndexManager({
  resources,
  statuses,
  activeIndex,
  clearingId,
  confirmClearId,
  onStart,
  onCancel,
  onClear,
  onCancelClear,
}: ResourceIndexManagerProps) {
  const pdfs = resources.filter((resource) => resource.kind === "pdf");
  const statusByDocument = new Map(
    statuses.map((status) => [status.documentId, status]),
  );

  return (
    <details className="resource-index-manager">
      <summary>管理 PDF 文字索引（{formatResourceCount(pdfs.length)}）</summary>
      {pdfs.length === 0 ? (
        <PageEmpty
          headingLevel={3}
          title="还没有可索引的 PDF"
          description="导入 PDF 后可以在这里建立文字索引。"
        />
      ) : (
        <ul>
          {pdfs.map((resource) => {
            const status =
              statusByDocument.get(resource.id) ??
              notIndexedResourceStatus(resource);
            const indexing = activeIndex?.documentId === resource.id;
            return (
              <li key={resource.id} className="resource-index-item">
                <div>
                  <strong>{resource.title}</strong>
                  <span aria-live="polite">
                    {formatResourceIndexStatus(status)}
                  </span>
                  {indexing ? (
                    <progress
                      aria-label={`${resource.title} 索引进度`}
                      max={Math.max(1, activeIndex.totalPages)}
                      value={activeIndex.indexedPages}
                    />
                  ) : null}
                </div>
                <div className="resource-index-actions">
                  {indexing ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={activeIndex.canceling}
                      onClick={onCancel}
                    >
                      {activeIndex.canceling ? "正在取消…" : "取消索引"}
                    </Button>
                  ) : (
                    <IndexActions
                      resource={resource}
                      status={status}
                      disabled={
                        activeIndex !== undefined || clearingId !== undefined
                      }
                      confirmClear={confirmClearId === resource.id}
                      onStart={onStart}
                      onClear={onClear}
                      onCancelClear={onCancelClear}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

interface IndexActionsProps {
  resource: ResourceDocument;
  status: ResourceIndexStatus;
  disabled: boolean;
  confirmClear: boolean;
  onStart(resource: ResourceDocument, force: boolean): Promise<void>;
  onClear(documentId: string): Promise<void>;
  onCancelClear(): void;
}

function IndexActions({
  resource,
  status,
  disabled,
  confirmClear,
  onStart,
  onClear,
  onCancelClear,
}: IndexActionsProps) {
  if (status.state === "not_indexed") {
    return (
      <Button
        variant="primary"
        size="sm"
        disabled={disabled}
        onClick={() => void onStart(resource, false)}
      >
        建立文字索引
      </Button>
    );
  }

  if (confirmClear) {
    return (
      <>
        <Button
          variant="danger"
          size="sm"
          disabled={disabled}
          onClick={() => void onClear(resource.id)}
        >
          确认清除索引
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancelClear}>
          取消
        </Button>
      </>
    );
  }

  const resumable = status.state === "interrupted" || status.state === "failed";
  return (
    <>
      {resumable ? (
        <Button
          variant="primary"
          size="sm"
          disabled={disabled}
          onClick={() => void onStart(resource, false)}
        >
          继续索引
        </Button>
      ) : null}
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => void onStart(resource, true)}
      >
        重新建立
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => void onClear(resource.id)}
      >
        清除索引
      </Button>
    </>
  );
}
