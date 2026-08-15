import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

import type { QuestionRegion } from "../../shared/tauri/questionClient";
import {
  buildResourceProtocolUrl,
  getResourceReaderDescriptor,
} from "../../shared/tauri/resourceClient";
import {
  capturePdfRegionPng,
  type PdfRegionOverlay,
} from "../library/pdf/PdfReader";
import { openPdf } from "../library/pdf/pdfEngine";
import { HttpRangeSource } from "../library/pdf/rangeSource";

interface RenderedRegion {
  id: string;
  pageNumber: number;
  url: string;
  width: number;
  height: number;
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
}

type QuestionRegionNavigationDirection = "previous" | "next";
type QuestionRegionFocusDirection = "forward" | "backward";

let questionRegionViewerScrollLockCount = 0;

export function questionRegionActiveIndex(
  activeIndex: number,
  imageCount: number,
): number {
  if (imageCount <= 0) return 0;
  return Math.min(Math.max(0, activeIndex), imageCount - 1);
}

export function questionRegionNavigateIndex(
  activeIndex: number,
  direction: QuestionRegionNavigationDirection,
  imageCount: number,
): number {
  if (imageCount <= 0) return 0;
  const safeIndex = questionRegionActiveIndex(activeIndex, imageCount);
  if (direction === "next") {
    return (safeIndex + 1) % imageCount;
  }
  return (safeIndex - 1 + imageCount) % imageCount;
}

export function questionRegionViewerFocusIndex(
  currentIndex: number,
  direction: QuestionRegionFocusDirection,
  focusableCount: number,
): number {
  if (focusableCount <= 0) return -1;
  if (currentIndex < 0) {
    return direction === "forward" ? 0 : focusableCount - 1;
  }
  const safeIndex = Math.min(Math.max(0, currentIndex), focusableCount - 1);
  if (direction === "forward") {
    return (safeIndex + 1) % focusableCount;
  }
  return (safeIndex - 1 + focusableCount) % focusableCount;
}

export function questionRegionShouldCloseOnKey(key: string): boolean {
  return key === "Escape";
}

export function QuestionRegionCard({
  documentId,
  title,
  regions,
}: {
  documentId: string;
  title: string;
  regions: QuestionRegion[];
}) {
  const expandedCloseRef = useRef<HTMLButtonElement>(null);
  const expandedViewerRef = useRef<HTMLElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [images, setImages] = useState<RenderedRegion[]>([]);
  const [status, setStatus] = useState("正在加载题目图片…");
  const [activeIndex, setActiveIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<DragState>();
  useEffect(() => {
    let disposed = false;
    const urls: string[] = [];
    queueMicrotask(() => {
      if (disposed) return;
      lastTriggerRef.current = null;
      setImages([]);
      setStatus("正在加载题目图片…");
      setActiveIndex(0);
      setExpanded(false);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setDrag(undefined);
    });
    void renderRegions(documentId, regions).then(
      (rendered) => {
        if (disposed) {
          for (const image of rendered) {
            URL.revokeObjectURL(image.url);
          }
          return;
        }
        urls.push(...rendered.map((image) => image.url));
        setImages(rendered);
        setStatus(rendered.length === 0 ? "这道题还没有保存图片区域。" : "");
      },
      () => {
        if (!disposed) {
          setStatus("题目图片加载失败，请确认原 PDF 仍然可用。");
        }
      },
    );
    return () => {
      disposed = true;
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [documentId, regions]);

  const closeExpanded = useCallback(() => {
    setExpanded(false);
    setDrag(undefined);
  }, []);
  const safeActiveIndex = questionRegionActiveIndex(activeIndex, images.length);
  const active = images[safeActiveIndex];
  const viewerExpanded = expanded && active !== undefined;

  const navigateExpanded = useCallback(
    (direction: QuestionRegionNavigationDirection) => {
      setActiveIndex((currentIndex) =>
        questionRegionNavigateIndex(currentIndex, direction, images.length),
      );
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setDrag(undefined);
    },
    [images.length],
  );

  useEffect(() => {
    if (viewerExpanded) {
      requestAnimationFrame(() => expandedCloseRef.current?.focus());
      return;
    }
    requestAnimationFrame(() => {
      if (lastTriggerRef.current?.isConnected) {
        lastTriggerRef.current.focus({ preventScroll: true });
      }
    });
  }, [viewerExpanded]);

  useEffect(() => {
    if (!viewerExpanded) return;
    const unlockDocumentScroll = lockQuestionRegionViewerScroll();
    const handleViewerKeyDown = (event: globalThis.KeyboardEvent) => {
      const viewer = expandedViewerRef.current;
      if (viewer === null) return;
      if (questionRegionShouldCloseOnKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        closeExpanded();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements =
        getQuestionRegionViewerFocusableElements(viewer);
      if (focusableElements.length === 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const currentIndex =
        activeElement === null ? -1 : focusableElements.indexOf(activeElement);
      const nextIndex = questionRegionViewerFocusIndex(
        currentIndex,
        event.shiftKey ? "backward" : "forward",
        focusableElements.length,
      );
      event.preventDefault();
      event.stopPropagation();
      focusableElements[nextIndex]?.focus({ preventScroll: true });
    };

    document.addEventListener("keydown", handleViewerKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleViewerKeyDown, true);
      unlockDocumentScroll();
    };
  }, [closeExpanded, viewerExpanded]);

  const openImage = (index: number, trigger: HTMLButtonElement) => {
    lastTriggerRef.current = trigger;
    setActiveIndex(index);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setExpanded(true);
  };
  return (
    <div className="review-region-card">
      <div
        className="review-region-card-content"
        inert={viewerExpanded ? true : undefined}
        aria-hidden={viewerExpanded ? true : undefined}
      >
        {status === "" ? null : (
          <p className="review-region-status" role="status">
            {status}
          </p>
        )}
        {images.map((image, index) => (
          <button
            key={image.id}
            type="button"
            className="review-region-preview"
            onClick={(event) => openImage(index, event.currentTarget)}
          >
            <img
              src={image.url}
              alt={`${title}，第 ${image.pageNumber} 页题目区域 ${index + 1}`}
              width={image.width}
              height={image.height}
              loading={index === 0 ? "eager" : "lazy"}
            />
            <span>点击放大 · 区域 {index + 1}</span>
          </button>
        ))}
      </div>

      {viewerExpanded ? (
        <section
          ref={expandedViewerRef}
          className="review-region-expanded"
          role="dialog"
          aria-modal="true"
          aria-label={`${title}，区域 ${safeActiveIndex + 1}/${images.length}，第 ${active.pageNumber} 页`}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeExpanded();
            }
          }}
        >
          <div className="review-region-expanded-toolbar">
            <strong>题目大图</strong>
            <span
              className="review-region-expanded-position"
              aria-live="polite"
            >
              区域 {safeActiveIndex + 1}/{images.length} · 第{" "}
              {active.pageNumber} 页
            </span>
            <div className="review-region-expanded-navigation">
              <button
                type="button"
                className="review-region-expanded-nav-button"
                disabled={images.length <= 1}
                aria-label="上一个题目区域"
                onClick={() => navigateExpanded("previous")}
              >
                上一个
              </button>
              <button
                type="button"
                className="review-region-expanded-nav-button"
                disabled={images.length <= 1}
                aria-label="下一个题目区域"
                onClick={() => navigateExpanded("next")}
              >
                下一个
              </button>
            </div>
            <label>
              缩放
              <input
                name="review-image-zoom"
                type="range"
                autoComplete="off"
                min="0.5"
                max="3"
                step="0.1"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <button
              ref={expandedCloseRef}
              type="button"
              className="editor-dialog-close-button review-region-expanded-close-button"
              aria-label="关闭题目大图"
              title="关闭题目大图"
              onClick={closeExpanded}
            >
              <span className="editor-dialog-close-icon" aria-hidden="true">
                ×
              </span>
            </button>
          </div>
          <div
            className="review-region-expanded-pan"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                closeExpanded();
              }
            }}
            onPointerDown={(event) => beginDrag(event, setDrag)}
            onPointerMove={(event) =>
              moveDrag(event, drag, offset, setDrag, setOffset)
            }
            onPointerUp={(event) => endDrag(event, setDrag)}
            onPointerCancel={() => setDrag(undefined)}
          >
            <img
              src={active.url}
              alt={`${title}大图`}
              width={active.width}
              height={active.height}
              draggable={false}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              }}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function getQuestionRegionViewerFocusableElements(
  viewer: HTMLElement,
): HTMLElement[] {
  const selector =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
  return Array.from(viewer.querySelectorAll<HTMLElement>(selector)).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" && element.tabIndex >= 0,
  );
}

function lockQuestionRegionViewerScroll(): () => void {
  if (questionRegionViewerScrollLockCount === 0) {
    document.body.classList.add("review-region-viewer-open");
  }
  questionRegionViewerScrollLockCount += 1;
  let unlocked = false;
  return () => {
    if (unlocked) return;
    unlocked = true;
    questionRegionViewerScrollLockCount = Math.max(
      0,
      questionRegionViewerScrollLockCount - 1,
    );
    if (questionRegionViewerScrollLockCount === 0) {
      document.body.classList.remove("review-region-viewer-open");
    }
  };
}

export async function renderRegions(
  documentId: string,
  regions: QuestionRegion[],
): Promise<RenderedRegion[]> {
  if (regions.length === 0) {
    return [];
  }
  const descriptor = await getResourceReaderDescriptor(documentId);
  const source = new HttpRangeSource(
    descriptor.title,
    descriptor.sizeBytes,
    buildResourceProtocolUrl(documentId, "pdf"),
  );
  const session = await openPdf(source);
  const rendered: RenderedRegion[] = [];
  try {
    for (const region of regions) {
      const bytes = await capturePdfRegionPng(session, toOverlay(region));
      const blob = new Blob([Uint8Array.from(bytes).buffer], {
        type: "image/png",
      });
      const dimensions = await imageDimensions(blob);
      rendered.push({
        id: region.id,
        pageNumber: region.pageNumber,
        url: URL.createObjectURL(blob),
        ...dimensions,
      });
    }
    return rendered;
  } catch (error: unknown) {
    for (const image of rendered) {
      URL.revokeObjectURL(image.url);
    }
    throw error;
  } finally {
    await session.destroy();
  }
}

export async function captureQuestionRegionPng(
  documentId: string,
  region: QuestionRegion,
): Promise<Uint8Array> {
  const descriptor = await getResourceReaderDescriptor(documentId);
  const source = new HttpRangeSource(
    descriptor.title,
    descriptor.sizeBytes,
    buildResourceProtocolUrl(documentId, "pdf"),
  );
  const session = await openPdf(source);
  try {
    return await capturePdfRegionPng(session, toOverlay(region));
  } finally {
    await session.destroy();
  }
}

export async function captureQuestionRegionDataUrls(
  documentId: string,
  regions: QuestionRegion[],
): Promise<string[]> {
  if (regions.length === 0) {
    return [];
  }
  const descriptor = await getResourceReaderDescriptor(documentId);
  const source = new HttpRangeSource(
    descriptor.title,
    descriptor.sizeBytes,
    buildResourceProtocolUrl(documentId, "pdf"),
  );
  const session = await openPdf(source);
  try {
    const dataUrls: string[] = [];
    for (const region of regions) {
      const bytes = await capturePdfRegionPng(session, toOverlay(region));
      const blob = new Blob([Uint8Array.from(bytes).buffer], {
        type: "image/png",
      });
      dataUrls.push(await blobDataUrl(await optimizeQuestionImage(blob)));
    }
    return dataUrls;
  } finally {
    await session.destroy();
  }
}

async function optimizeQuestionImage(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const maximumSide = 1_600;
    const scale = Math.min(
      1,
      maximumSide / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("QUESTION_IMAGE_ENCODING_FAILED");
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (encoded) =>
          encoded === null
            ? reject(new Error("QUESTION_IMAGE_ENCODING_FAILED"))
            : resolve(encoded),
        "image/jpeg",
        0.9,
      ),
    );
  } finally {
    bitmap.close();
  }
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("QUESTION_IMAGE_ENCODING_FAILED")),
    );
    reader.addEventListener("error", () =>
      reject(new Error("QUESTION_IMAGE_ENCODING_FAILED")),
    );
    reader.readAsDataURL(blob);
  });
}

function toOverlay(region: QuestionRegion): PdfRegionOverlay {
  return {
    id: region.id,
    pageNumber: region.pageNumber,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  };
}

async function imageDimensions(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function beginDrag(
  event: PointerEvent<HTMLDivElement>,
  setDrag: (value: DragState) => void,
): void {
  event.currentTarget.setPointerCapture(event.pointerId);
  setDrag({ pointerId: event.pointerId, x: event.clientX, y: event.clientY });
}

function moveDrag(
  event: PointerEvent<HTMLDivElement>,
  drag: DragState | undefined,
  offset: { x: number; y: number },
  setDrag: (value: DragState) => void,
  setOffset: (value: { x: number; y: number }) => void,
): void {
  if (drag === undefined || drag.pointerId !== event.pointerId) {
    return;
  }
  setOffset({
    x: offset.x + event.clientX - drag.x,
    y: offset.y + event.clientY - drag.y,
  });
  setDrag({ pointerId: event.pointerId, x: event.clientX, y: event.clientY });
}

function endDrag(
  event: PointerEvent<HTMLDivElement>,
  setDrag: (value: undefined) => void,
): void {
  event.currentTarget.releasePointerCapture(event.pointerId);
  setDrag(undefined);
}
