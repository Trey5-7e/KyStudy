import { useEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

import { openPdf, type PdfSession } from "../library/pdf/pdfEngine";
import { MemoryRangeSource } from "../library/pdf/rangeSource";
import { RenderCoordinator } from "../library/pdf/renderCoordinator";
import "../library/pdf/pdf-reader.css";

export function PaperPdfPreview({ bytes }: { bytes: Uint8Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordinatorRef = useRef(new RenderCoordinator());
  const [session, setSession] = useState<PdfSession>();
  const [pageCount, setPageCount] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1.1);
  const [status, setStatus] = useState("正在加载 PDF 预览…");

  useEffect(() => {
    let disposed = false;
    let activeSession: PdfSession | undefined;
    const coordinator = coordinatorRef.current;
    const source = new MemoryRangeSource("paper-preview.pdf", bytes);
    void openPdf(source).then(
      (opened) => {
        activeSession = opened;
        if (disposed) {
          void opened.destroy();
          return;
        }
        setSession(opened);
        setPageCount(opened.document.numPages);
        setStatus(`共 ${opened.document.numPages} 页`);
      },
      () => {
        if (!disposed) {
          setStatus("PDF 预览加载失败，请返回设置后重新生成。");
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
  }, [bytes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || session === undefined || pageCount === 0) {
      return;
    }
    let disposed = false;
    const coordinator = coordinatorRef.current;
    setStatus(`正在渲染第 ${pageNumber}/${pageCount} 页…`);
    void renderPreviewPage(
      session,
      pageNumber,
      scale,
      canvas,
      coordinator,
    ).then(
      (rendered) => {
        if (!disposed && rendered) {
          setStatus(`第 ${pageNumber}/${pageCount} 页`);
        }
      },
      () => {
        if (!disposed) {
          setStatus("这一页渲染失败，请尝试其他页。");
        }
      },
    );
    return () => {
      disposed = true;
      void coordinator.cancel();
    };
  }, [pageCount, pageNumber, scale, session]);

  const goToPage = () => {
    const parsed = Number(pageInput);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > pageCount) {
      setPageInput(String(pageNumber));
      return;
    }
    setPageNumber(parsed);
  };

  return (
    <section className="paper-pdf-preview" aria-label="练习卷 PDF 预览">
      <div
        className="reader-toolbar"
        role="toolbar"
        aria-label="练习卷 PDF 预览控制"
      >
        <div className="reader-toolbar-group reader-nav-group">
          <button
            type="button"
            className="reader-btn"
            disabled={pageNumber <= 1 || pageCount === 0}
            title="上一页"
            aria-label="上一页"
            onClick={() => {
              const next = Math.max(1, pageNumber - 1);
              setPageNumber(next);
              setPageInput(String(next));
            }}
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              navigate_before
            </span>
            <span>上一页</span>
          </button>

          <div className="reader-page-indicator">
            <span>第</span>
            <input
              type="number"
              min={1}
              max={Math.max(pageCount, 1)}
              value={pageInput}
              aria-label="输入目标页码"
              onChange={(event) => setPageInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") goToPage();
              }}
            />
            <span className="reader-page-count">/ {pageCount} 页</span>
            <button
              type="button"
              className="reader-btn reader-btn-ghost reader-btn-compact"
              disabled={pageCount === 0}
              title="跳转到指定页"
              onClick={goToPage}
            >
              跳转
            </button>
          </div>

          <button
            type="button"
            className="reader-btn"
            disabled={pageNumber >= pageCount || pageCount === 0}
            title="下一页"
            aria-label="下一页"
            onClick={() => {
              const next = Math.min(pageCount, pageNumber + 1);
              setPageNumber(next);
              setPageInput(String(next));
            }}
          >
            <span>下一页</span>
            <span className="material-symbols-rounded" aria-hidden="true">
              navigate_next
            </span>
          </button>
        </div>

        <div className="reader-toolbar-group reader-zoom-group">
          <button
            type="button"
            className="reader-btn reader-btn-icon"
            disabled={scale <= 0.7}
            title="缩小"
            aria-label="缩小"
            onClick={() =>
              setScale((current) =>
                Math.max(0.7, Math.round((current - 0.1) * 10) / 10),
              )
            }
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              zoom_out
            </span>
          </button>

          <button
            type="button"
            className="reader-btn reader-btn-subtle reader-scale-badge"
            title="重置缩放为 100%"
            aria-label="重置缩放为 100%"
            onClick={() => setScale(1.0)}
          >
            {Math.round(scale * 100)}%
          </button>

          <button
            type="button"
            className="reader-btn reader-btn-icon"
            disabled={scale >= 2}
            title="放大"
            aria-label="放大"
            onClick={() =>
              setScale((current) =>
                Math.min(2, Math.round((current + 0.1) * 10) / 10),
              )
            }
          >
            <span className="material-symbols-rounded" aria-hidden="true">
              zoom_in
            </span>
          </button>
        </div>

        <div className="reader-toolbar-status">
          <span role="status" className="reader-status-text">
            {status}
          </span>
        </div>
      </div>
      <div className="pdf-canvas-shell paper-pdf-preview-canvas">
        <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} />
      </div>
    </section>
  );
}

async function renderPreviewPage(
  session: PdfSession,
  pageNumber: number,
  scale: number,
  canvas: HTMLCanvasElement,
  coordinator: RenderCoordinator,
): Promise<boolean> {
  let page: PDFPageProxy | undefined;
  try {
    page = await session.document.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    return coordinator.render(() =>
      page!.render({
        canvas,
        viewport,
        transform:
          outputScale === 1
            ? undefined
            : [outputScale, 0, 0, outputScale, 0, 0],
      }),
    );
  } finally {
    page?.cleanup();
  }
}
