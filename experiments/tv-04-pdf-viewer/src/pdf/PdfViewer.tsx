import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from "pdfjs-dist";

import {
  normalizeViewportRegion,
  restoreViewportRegion,
  type PdfPageBox,
  type ViewportRectangle,
} from "./coordinates";
import { diagnosticCode } from "./diagnostics";
import { openPdf, type PdfSession } from "./pdfEngine";
import type { PdfRangeSource } from "./rangeSource";
import { RenderCoordinator } from "./renderCoordinator";
import {
  clearSavedSelection,
  loadSavedSelection,
  saveSelection,
  type SavedPdfSelection,
} from "./selectionPersistence";

interface PdfViewerProps {
  readonly sourceFactory: () => Promise<PdfRangeSource>;
}

export function PdfViewer({ sourceFactory }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageStageRef = useRef<HTMLDivElement>(null);
  const selectionPreviewRef = useRef<HTMLDivElement>(null);
  const renderCoordinatorRef = useRef(new RenderCoordinator());
  const viewportRef = useRef<PageViewport | undefined>(undefined);
  const pageBoxRef = useRef<PdfPageBox | undefined>(undefined);
  const dragStartRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const savedRegionRef = useRef<SavedPdfSelection | undefined>(
    loadSavedSelection(),
  );
  const [session, setSession] = useState<PdfSession>();
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [rotation, setRotation] = useState(0);
  const [status, setStatus] = useState("正在按范围加载 PDF…");

  useEffect(() => {
    let disposed = false;
    let activeSession: PdfSession | undefined;
    void sourceFactory()
      .then(openPdf)
      .then((opened) => {
        activeSession = opened;
        if (disposed) {
          return opened.destroy();
        }
        setSession(opened);
        setStatus(`已加载 ${opened.document.numPages} 页`);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setStatus(`加载失败：${diagnosticCode(error)}`);
        }
      });

    return () => {
      disposed = true;
      void renderCoordinatorRef.current.cancel();
      if (activeSession !== undefined) {
        void activeSession.destroy();
      }
    };
  }, [sourceFactory]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || session === undefined) {
      return;
    }
    if (savedRegionRef.current?.pageNumber !== pageNumber) {
      drawSelection(selectionPreviewRef.current, undefined);
    }
    let disposed = false;
    let page: PDFPageProxy | undefined;
    void renderPage(
      session.document,
      pageNumber,
      scale,
      rotation,
      canvas,
      renderCoordinatorRef.current,
      (loadedPage) => {
        page = loadedPage;
      },
      (loadedPage, viewport) => {
        viewportRef.current = viewport;
        pageBoxRef.current = toPageBox(loadedPage.view);
        if (pageStageRef.current !== null) {
          pageStageRef.current.style.width = `${Math.floor(viewport.width)}px`;
          pageStageRef.current.style.height = `${Math.floor(viewport.height)}px`;
        }
        const saved = savedRegionRef.current;
        const rectangle =
          saved?.pageNumber === pageNumber
            ? restoreViewportRegion(saved.region, viewport, pageBoxRef.current)
            : undefined;
        drawSelection(selectionPreviewRef.current, rectangle);
      },
    )
      .then((rendered) => {
        if (!disposed && rendered) {
          setStatus(`第 ${pageNumber}/${session.document.numPages} 页`);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setStatus(`渲染失败：${diagnosticCode(error)}`);
        }
      });

    return () => {
      disposed = true;
      page?.cleanup();
    };
  }, [pageNumber, rotation, scale, session]);

  const startSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (viewportRef.current === undefined || pageBoxRef.current === undefined) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointerPoint(event);
    dragStartRef.current = point;
    drawSelection(selectionPreviewRef.current, {
      ...point,
      width: 1,
      height: 1,
    });
  };

  const moveSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (start === undefined) {
      return;
    }
    drawSelection(
      selectionPreviewRef.current,
      rectangleBetween(start, pointerPoint(event)),
    );
  };

  const finishSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    const viewport = viewportRef.current;
    const pageBox = pageBoxRef.current;
    dragStartRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (
      start === undefined ||
      viewport === undefined ||
      pageBox === undefined
    ) {
      return;
    }
    const rectangle = rectangleBetween(start, pointerPoint(event));
    if (rectangle.width < 4 || rectangle.height < 4) {
      drawSelection(selectionPreviewRef.current, undefined);
      setStatus("框选区域过小，未保存");
      return;
    }
    const region = normalizeViewportRegion(rectangle, viewport, pageBox);
    savedRegionRef.current = { pageNumber, region };
    saveSelection(savedRegionRef.current);
    drawSelection(
      selectionPreviewRef.current,
      restoreViewportRegion(region, viewport, pageBox),
    );
    setStatus(
      `第 ${pageNumber} 页区域：${region.xMin.toFixed(3)}, ${region.yMin.toFixed(3)} → ${region.xMax.toFixed(3)}, ${region.yMax.toFixed(3)}`,
    );
  };

  const cancelSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const saved = savedRegionRef.current;
    const viewport = viewportRef.current;
    const pageBox = pageBoxRef.current;
    drawSelection(
      selectionPreviewRef.current,
      saved?.pageNumber === pageNumber &&
        viewport !== undefined &&
        pageBox !== undefined
        ? restoreViewportRegion(saved.region, viewport, pageBox)
        : undefined,
    );
  };

  const clearSelection = () => {
    savedRegionRef.current = undefined;
    clearSavedSelection();
    drawSelection(selectionPreviewRef.current, undefined);
    setStatus("已清除实验框选");
  };

  const pageCount = session?.document.numPages ?? 1;
  return (
    <section className="viewer-card" aria-label="PDF 技术实验查看器">
      <div className="viewer-toolbar">
        <button
          type="button"
          onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
          disabled={pageNumber <= 1}
        >
          上一页
        </button>
        <button
          type="button"
          onClick={() =>
            setPageNumber((value) => Math.min(pageCount, value + 1))
          }
          disabled={pageNumber >= pageCount}
        >
          下一页
        </button>
        <button
          type="button"
          onClick={() => setScale((value) => Math.max(0.5, value - 0.1))}
        >
          缩小
        </button>
        <button
          type="button"
          onClick={() => setScale((value) => Math.min(3, value + 0.1))}
        >
          放大
        </button>
        <button
          type="button"
          onClick={() => setRotation((value) => (value + 90) % 360)}
        >
          旋转
        </button>
        <button type="button" onClick={clearSelection}>
          清除框选
        </button>
        <span role="status">{status}</span>
      </div>
      <div className="canvas-shell">
        <div ref={pageStageRef} className="page-stage">
          <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} />
          <div
            className="selection-layer"
            aria-label="拖动以框选 PDF 区域"
            onPointerDown={startSelection}
            onPointerMove={moveSelection}
            onPointerUp={finishSelection}
            onPointerCancel={cancelSelection}
          >
            <div ref={selectionPreviewRef} className="selection-preview" />
          </div>
        </div>
      </div>
    </section>
  );
}

async function renderPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  scale: number,
  rotation: number,
  canvas: HTMLCanvasElement,
  coordinator: RenderCoordinator,
  onPage: (page: PDFPageProxy) => void,
  onViewport: (page: PDFPageProxy, viewport: PageViewport) => void,
) {
  const page = await document.getPage(pageNumber);
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
  onViewport(page, viewport);

  return coordinator.render(() =>
    page.render({
      canvas,
      viewport,
      transform:
        outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
    }),
  );
}

function pointerPoint(event: ReactPointerEvent<HTMLDivElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function rectangleBetween(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): ViewportRectangle {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function drawSelection(
  element: HTMLDivElement | null,
  rectangle: ViewportRectangle | undefined,
) {
  if (element === null) {
    return;
  }
  if (rectangle === undefined) {
    element.hidden = true;
    return;
  }
  element.hidden = false;
  element.style.transform = `translate(${rectangle.x}px, ${rectangle.y}px)`;
  element.style.width = `${rectangle.width}px`;
  element.style.height = `${rectangle.height}px`;
}

function toPageBox(view: readonly number[]): PdfPageBox {
  if (view.length < 4) {
    throw new Error("PDF_PAGE_BOX_INVALID");
  }
  return { xMin: view[0], yMin: view[1], xMax: view[2], yMax: view[3] };
}
