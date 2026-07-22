import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent,
  type Ref,
} from "react";
import type { PDFPageProxy } from "pdfjs-dist";

import {
  buildResourceProtocolUrl,
  type ResourceReaderDescriptor,
} from "../../../shared/tauri/resourceClient";
import { openPdf, type PdfSession } from "./pdfEngine";
import { HttpRangeSource } from "./rangeSource";
import { RenderCoordinator } from "./renderCoordinator";
import {
  buildOcrRegionRenderSpec,
  normalizePdfSelection,
  projectNormalizedRegion,
  type PdfPageView,
} from "./pdfRegions";

export interface PdfRegionOverlay {
  id: string;
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfReaderHandle {
  captureRegionPng(region: PdfRegionOverlay): Promise<Uint8Array>;
}

interface PdfReaderProps {
  ref?: Ref<PdfReaderHandle>;
  descriptor: ResourceReaderDescriptor;
  requestedPage?: number;
  onProgress(pageCount: number, lastPage: number): void;
  regions?: PdfRegionOverlay[];
  captureMode?: boolean;
  onRegionCapture?(region: Omit<PdfRegionOverlay, "id">): void;
}

interface RenderedPage {
  pageNumber: number;
  pageView: PdfPageView;
  viewport: ReturnType<PDFPageProxy["getViewport"]>;
}

interface PointerSelection {
  start: readonly [number, number];
  current: readonly [number, number];
}

export function PdfReader({
  ref,
  descriptor,
  requestedPage,
  onProgress,
  regions = [],
  captureMode = false,
  onRegionCapture,
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
  const [renderedPage, setRenderedPage] = useState<RenderedPage>();
  const [selection, setSelection] = useState<PointerSelection>();

  useImperativeHandle(
    ref,
    () => ({
      async captureRegionPng(region) {
        if (session === undefined) {
          throw new Error("PDF_READER_NOT_READY");
        }
        return captureRegionPng(session, region);
      },
    }),
    [session],
  );

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
      (loadedPage, viewport) => {
        setRenderedPage({
          pageNumber,
          pageView: toPdfPageView(loadedPage.view),
          viewport,
        });
        setSelection(undefined);
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

  const pointerPosition = (
    event: PointerEvent<HTMLDivElement>,
  ): readonly [number, number] => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return [event.clientX - bounds.left, event.clientY - bounds.top];
  };

  const finishSelection = (event: PointerEvent<HTMLDivElement>) => {
    if (
      selection === undefined ||
      renderedPage === undefined ||
      onRegionCapture === undefined
    ) {
      setSelection(undefined);
      return;
    }
    const current = pointerPosition(event);
    const pixelWidth = Math.abs(current[0] - selection.start[0]);
    const pixelHeight = Math.abs(current[1] - selection.start[1]);
    if (pixelWidth < 6 || pixelHeight < 6) {
      setStatus("框选范围太小，请拖出完整题目区域");
      setSelection(undefined);
      return;
    }
    const region = normalizePdfSelection(
      renderedPage.pageNumber,
      renderedPage.pageView,
      renderedPage.viewport,
      selection.start,
      current,
    );
    onRegionCapture(region);
    setSelection(undefined);
    setStatus(`已框选第 ${renderedPage.pageNumber} 页区域，等待保存`);
  };

  const visibleRegions =
    renderedPage === undefined
      ? []
      : regions.filter(
          (region) => region.pageNumber === renderedPage.pageNumber,
        );
  const selectionStyle =
    selection === undefined
      ? undefined
      : rectangleFromPoints(selection.start, selection.current);

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
        <div className="pdf-page-stage">
          <canvas ref={canvasRef} aria-label={`PDF 第 ${pageNumber} 页`} />
          <div
            className={`pdf-region-layer${captureMode ? " pdf-region-capture" : ""}`}
            aria-label={captureMode ? "拖动框选题目区域" : "已保存题目区域"}
            onPointerDown={(event) => {
              if (!captureMode || renderedPage === undefined) {
                return;
              }
              event.currentTarget.setPointerCapture(event.pointerId);
              const point = pointerPosition(event);
              setSelection({ start: point, current: point });
            }}
            onPointerMove={(event) => {
              if (selection !== undefined && captureMode) {
                const point = pointerPosition(event);
                setSelection((current) =>
                  current === undefined
                    ? undefined
                    : { ...current, current: point },
                );
              }
            }}
            onPointerUp={finishSelection}
            onPointerCancel={() => setSelection(undefined)}
          >
            {renderedPage === undefined
              ? null
              : visibleRegions.map((region) => {
                  const rectangle = projectNormalizedRegion(
                    renderedPage.pageView,
                    renderedPage.viewport,
                    region,
                  );
                  return (
                    <span
                      key={region.id}
                      className="pdf-saved-region"
                      title="已保存题目区域"
                      style={rectangle}
                    />
                  );
                })}
            {selectionStyle === undefined ? null : (
              <span className="pdf-pending-region" style={selectionStyle} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

async function captureRegionPng(
  session: PdfSession,
  region: PdfRegionOverlay,
): Promise<Uint8Array> {
  if (
    !Number.isInteger(region.pageNumber) ||
    region.pageNumber < 1 ||
    region.pageNumber > session.document.numPages
  ) {
    throw new Error("PDF_OCR_REGION_INVALID");
  }
  const page = await session.document.getPage(region.pageNumber);
  try {
    const pageView = toPdfPageView(page.view);
    const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const renderSpec = buildOcrRegionRenderSpec(pageView, baseViewport, region);
    const viewport = page.getViewport({
      scale: renderSpec.scale,
      rotation: page.rotate,
    });
    const rectangle = projectNormalizedRegion(pageView, viewport, region);
    const canvas = document.createElement("canvas");
    canvas.width = renderSpec.width;
    canvas.height = renderSpec.height;
    await page.render({
      canvas,
      viewport,
      transform: [1, 0, 0, 1, -rectangle.left, -rectangle.top],
      background: "#ffffff",
    }).promise;
    const blob = await canvasToPng(canvas);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    page.cleanup();
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error("PDF_OCR_CAPTURE_FAILED"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

async function renderPage(
  session: PdfSession,
  pageNumber: number,
  scale: number,
  rotation: number,
  canvas: HTMLCanvasElement,
  coordinator: RenderCoordinator,
  onPage: (page: PDFPageProxy) => void,
  onViewport: (
    page: PDFPageProxy,
    viewport: ReturnType<PDFPageProxy["getViewport"]>,
  ) => void,
): Promise<boolean> {
  const page = await session.document.getPage(pageNumber);
  onPage(page);
  const viewport = page.getViewport({
    scale,
    rotation: page.rotate + rotation,
  });
  const outputScale = window.devicePixelRatio || 1;
  onViewport(page, viewport);
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

function rectangleFromPoints(
  start: readonly [number, number],
  end: readonly [number, number],
) {
  return {
    left: Math.min(start[0], end[0]),
    top: Math.min(start[1], end[1]),
    width: Math.abs(end[0] - start[0]),
    height: Math.abs(end[1] - start[1]),
  };
}

function toPdfPageView(view: number[]): PdfPageView {
  if (view.length < 4) {
    throw new Error("PDF_PAGE_VIEW_INVALID");
  }
  return [view[0] ?? 0, view[1] ?? 0, view[2] ?? 0, view[3] ?? 0];
}
