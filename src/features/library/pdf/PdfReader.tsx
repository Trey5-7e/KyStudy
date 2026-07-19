import { useEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

import {
  buildResourceProtocolUrl,
  type ResourceReaderDescriptor,
} from "../../../shared/tauri/resourceClient";
import { openPdf, type PdfSession } from "./pdfEngine";
import { HttpRangeSource } from "./rangeSource";
import { RenderCoordinator } from "./renderCoordinator";

interface PdfReaderProps {
  descriptor: ResourceReaderDescriptor;
  requestedPage?: number;
  onProgress(pageCount: number, lastPage: number): void;
}

export function PdfReader({
  descriptor,
  requestedPage,
  onProgress,
}: PdfReaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordinatorRef = useRef(new RenderCoordinator());
  const [session, setSession] = useState<PdfSession>();
  const [pageNumber, setPageNumber] = useState(
    requestedPage ?? descriptor.lastPage ?? 1,
  );
  const [pageInput, setPageInput] = useState(String(pageNumber));
  const [scale, setScale] = useState(1.1);
  const [rotation, setRotation] = useState(0);
  const [status, setStatus] = useState("正在按范围加载 PDF…");

  useEffect(() => {
    let disposed = false;
    let activeSession: PdfSession | undefined;
    const coordinator = coordinatorRef.current;
    const source = new HttpRangeSource(
      descriptor.title,
      descriptor.sizeBytes,
      buildResourceProtocolUrl(descriptor.documentId, "pdf"),
    );
    void openPdf(source).then(
      (opened) => {
        activeSession = opened;
        if (disposed) {
          void opened.destroy();
          return;
        }
        const initialPage = Math.min(
          opened.document.numPages,
          Math.max(1, requestedPage ?? descriptor.lastPage ?? 1),
        );
        setPageNumber(initialPage);
        setPageInput(String(initialPage));
        setSession(opened);
      },
      () => {
        if (!disposed) {
          setStatus("PDF 加载失败，请确认文件完整后重试。");
        }
      },
    );
    return () => {
      disposed = true;
      void coordinator.cancel();
      if (activeSession !== undefined) {
        void activeSession.destroy();
      }
    };
  }, [
    descriptor.documentId,
    descriptor.lastPage,
    descriptor.sizeBytes,
    descriptor.title,
    requestedPage,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || session === undefined) {
      return;
    }
    let disposed = false;
    let page: PDFPageProxy | undefined;
    void renderPage(
      session,
      pageNumber,
      scale,
      rotation,
      canvas,
      coordinatorRef.current,
      (loaded) => {
        page = loaded;
      },
    ).then(
      (rendered) => {
        if (!disposed && rendered) {
          setStatus(`第 ${pageNumber}/${session.document.numPages} 页`);
          onProgress(session.document.numPages, pageNumber);
        }
      },
      () => {
        if (!disposed) {
          setStatus("这一页渲染失败，请尝试其他页或重新打开资料。");
        }
      },
    );
    return () => {
      disposed = true;
      page?.cleanup();
    };
  }, [onProgress, pageNumber, rotation, scale, session]);

  const pageCount = session?.document.numPages ?? descriptor.pageCount ?? 1;
  const goToPage = () => {
    const parsed = Number(pageInput);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > pageCount) {
      setPageInput(String(pageNumber));
      setStatus(`请输入 1 到 ${pageCount} 之间的页码`);
      return;
    }
    setPageNumber(parsed);
  };

  return (
    <div className="pdf-reader">
      <div className="reader-toolbar">
        <button
          type="button"
          disabled={pageNumber <= 1}
          onClick={() => {
            setPageNumber((current) => Math.max(1, current - 1));
            setPageInput(String(Math.max(1, pageNumber - 1)));
          }}
        >
          上一页
        </button>
        <button
          type="button"
          disabled={pageNumber >= pageCount}
          onClick={() => {
            setPageNumber((current) => Math.min(pageCount, current + 1));
            setPageInput(String(Math.min(pageCount, pageNumber + 1)));
          }}
        >
          下一页
        </button>
        <label>
          页码
          <input
            type="number"
            min={1}
            max={pageCount}
            value={pageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                goToPage();
              }
            }}
          />
        </label>
        <button type="button" onClick={goToPage}>
          跳转
        </button>
        <button
          type="button"
          onClick={() => setScale((current) => Math.max(0.5, current - 0.1))}
        >
          缩小
        </button>
        <button
          type="button"
          onClick={() => setScale((current) => Math.min(3, current + 0.1))}
        >
          放大
        </button>
        <button
          type="button"
          onClick={() => setRotation((current) => (current + 90) % 360)}
        >
          旋转
        </button>
        <span role="status">{status}</span>
      </div>
      <div className="pdf-canvas-shell">
        <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} />
      </div>
    </div>
  );
}

async function renderPage(
  session: PdfSession,
  pageNumber: number,
  scale: number,
  rotation: number,
  canvas: HTMLCanvasElement,
  coordinator: RenderCoordinator,
  onPage: (page: PDFPageProxy) => void,
): Promise<boolean> {
  const page = await session.document.getPage(pageNumber);
  onPage(page);
  const viewport = page.getViewport({
    scale,
    rotation: page.rotate + rotation,
  });
  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  return coordinator.render(() =>
    page.render({
      canvas,
      viewport,
      transform:
        outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    }),
  );
}
