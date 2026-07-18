import { useEffect, useRef, useState } from "react";

import {
  cancelResourceImport,
  listenToImportEvents,
  listResources,
  normalizeResourceCommandError,
  startResourceImport,
  type ImportEvent,
  type ResourceCommandError,
  type ResourceDocument,
} from "../../shared/tauri/resourceClient";

interface ActiveImport {
  operationId: string;
  copiedBytes: number;
  totalBytes: number;
  canceling: boolean;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KiB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MiB`;
}

export function ResourcePanel() {
  const [resources, setResources] = useState<ResourceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [listenerReady, setListenerReady] = useState(false);
  const [activeImport, setActiveImport] = useState<ActiveImport | null>(null);
  const [error, setError] = useState<ResourceCommandError | null>(null);
  const terminalOperations = useRef(new Set<string>());

  useEffect(() => {
    let isActive = true;
    let unlisten: (() => void) | undefined;

    const handleImportEvent = (event: ImportEvent) => {
      if (!isActive) {
        return;
      }
      if (event.state === "running") {
        setActiveImport({
          operationId: event.operationId,
          copiedBytes: event.copiedBytes,
          totalBytes: event.totalBytes,
          canceling: false,
        });
        return;
      }

      terminalOperations.current.add(event.operationId);
      setActiveImport((current) =>
        current?.operationId === event.operationId ? null : current,
      );
      if (event.state === "succeeded" && event.resource !== undefined) {
        setResources((current) => [
          event.resource as ResourceDocument,
          ...current.filter((resource) => resource.id !== event.resource?.id),
        ]);
        setError(null);
      } else if (event.error !== undefined) {
        setError(event.error);
      }
    };

    void listenToImportEvents(handleImportEvent).then(
      (dispose) => {
        if (isActive) {
          unlisten = dispose;
          setListenerReady(true);
        } else {
          dispose();
        }
      },
      (listenError: unknown) => {
        if (isActive) {
          setError(normalizeResourceCommandError(listenError));
        }
      },
    );

    void listResources().then(
      (documents) => {
        if (isActive) {
          setResources(documents);
          setLoading(false);
        }
      },
      (listError: unknown) => {
        if (isActive) {
          setError(normalizeResourceCommandError(listError));
          setLoading(false);
        }
      },
    );

    return () => {
      isActive = false;
      unlisten?.();
    };
  }, []);

  const beginImport = async () => {
    setError(null);
    try {
      const operation = await startResourceImport();
      if (
        operation !== null &&
        !terminalOperations.current.has(operation.operationId)
      ) {
        setActiveImport({
          operationId: operation.operationId,
          copiedBytes: 0,
          totalBytes: 0,
          canceling: false,
        });
      }
    } catch (importError: unknown) {
      setError(normalizeResourceCommandError(importError));
    }
  };

  const cancelImport = async () => {
    if (activeImport === null) {
      return;
    }
    try {
      const accepted = await cancelResourceImport(activeImport.operationId);
      if (accepted) {
        setActiveImport((current) =>
          current === null ? null : { ...current, canceling: true },
        );
      }
    } catch (cancelError: unknown) {
      setError(normalizeResourceCommandError(cancelError));
    }
  };

  const progress =
    activeImport === null || activeImport.totalBytes === 0
      ? 0
      : Math.min(
          100,
          Math.round(
            (activeImport.copiedBytes / activeImport.totalBytes) * 100,
          ),
        );

  return (
    <section className="library-card" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <p className="section-label">本地资料库</p>
          <h2 id="library-title">学习资料</h2>
          <p className="library-description">
            PDF、图片和思维导图源文件会复制到本地工作区；相同内容只保存一份。
          </p>
        </div>
        <button
          type="button"
          disabled={!listenerReady || activeImport !== null}
          onClick={() => void beginImport()}
        >
          选择并导入资料
        </button>
      </div>

      {activeImport === null ? null : (
        <div className="import-progress" aria-live="polite">
          <div className="progress-copy">
            <span>
              {activeImport.canceling
                ? "正在取消导入…"
                : activeImport.totalBytes === 0
                  ? "正在准备导入…"
                  : `正在导入 ${progress}%`}
            </span>
            <span>
              {formatBytes(activeImport.copiedBytes)} /{" "}
              {formatBytes(activeImport.totalBytes)}
            </span>
          </div>
          <progress value={progress} max={100} aria-label="资料导入进度" />
          <button
            type="button"
            className="secondary-button"
            disabled={activeImport.canceling}
            onClick={() => void cancelImport()}
          >
            取消导入
          </button>
        </div>
      )}

      {error === null ? null : (
        <div className="error-detail" role="alert">
          <strong>{error.message}</strong>
          <p>{error.action}</p>
          {error.operationId === undefined ? null : (
            <p className="operation-id">操作编号：{error.operationId}</p>
          )}
        </div>
      )}

      {loading ? (
        <p className="empty-state">正在读取本地资料…</p>
      ) : resources.length === 0 ? (
        <p className="empty-state">还没有资料，可以先导入一份 PDF 或图片。</p>
      ) : (
        <ul className="resource-list">
          {resources.map((resource) => (
            <li key={resource.id}>
              <div>
                <strong>{resource.title}</strong>
                <span>
                  {resource.kind} · {formatBytes(resource.sizeBytes)}
                </span>
              </div>
              <code title="SHA-256 内容指纹">
                {resource.sha256.slice(0, 12)}…
              </code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
