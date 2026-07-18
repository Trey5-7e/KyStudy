import { Suspense, lazy, useCallback, useEffect, useState } from "react";

import { buildPdfProtocolUrl } from "./pdf/protocolUrl";
import {
  HttpRangeSource,
  RangeSourceError,
  type PdfRangeSource,
} from "./pdf/rangeSource";

const PdfViewer = lazy(() =>
  import("./pdf/PdfViewer").then((module) => ({ default: module.PdfViewer })),
);

export function App() {
  const benchmarkMode = new URLSearchParams(window.location.search).has(
    "benchmark",
  );
  const [viewerEnabled, setViewerEnabled] = useState(false);
  const sourceFactory = useCallback(createSource, []);

  useEffect(() => {
    if (!benchmarkMode) {
      return;
    }
    void import("./benchmarkHarness")
      .then((module) => module.runBrowserBenchmark())
      .then((result) => {
        window.__TV04_BENCHMARK_RESULT__ = result;
      })
      .catch((error: unknown) => {
        window.__TV04_BENCHMARK_ERROR__ =
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : "UnknownError";
      });
  }, [benchmarkMode]);

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">KyStudy / Technical Validation 04</p>
        <p className="revision">协议修订：direct-id-v2</p>
        <h1>PDF 范围加载与区域坐标实验</h1>
        <p>
          主页面不包含 PDF.js；只有进入查看器后才加载显示层和
          Worker。浏览器模式读取合成样本， Tauri 模式由 Rust document ID
          协议提供相同 RangeSource。
        </p>
        {!viewerEnabled ? (
          <button
            className="primary"
            type="button"
            onClick={() => setViewerEnabled(true)}
          >
            加载 PDF 实验
          </button>
        ) : null}
      </header>

      {benchmarkMode ? (
        <section className="boundary-card" aria-live="polite">
          <strong>无头浏览器测量正在运行</strong>
          <span>结果将由自动化脚本读取，不需要桌面交互。</span>
        </section>
      ) : viewerEnabled ? (
        <Suspense
          fallback={<p className="loading">正在加载 PDF.js 独立代码块…</p>}
        >
          <PdfViewer sourceFactory={sourceFactory} />
        </Suspense>
      ) : (
        <section className="boundary-card">
          <strong>当前未加载 PDF.js</strong>
          <span>用于验证重依赖不会进入应用首屏。</span>
        </section>
      )}
    </main>
  );
}

async function createSource(): Promise<PdfRangeSource> {
  if ("__TAURI_INTERNALS__" in window) {
    const { convertFileSrc, invoke } = await import("@tauri-apps/api/core");
    const descriptor = await invoke<PdfDescriptor>("get_pdf_descriptor", {
      documentId: "tv04-mixed-document",
    });
    const url = buildPdfProtocolUrl(descriptor.documentId, convertFileSrc);
    return new DescriptorRangeSource(descriptor, url);
  }
  return HttpRangeSource.open(
    "/fixtures/mixed-samples.pdf",
    "mixed-samples.pdf",
  );
}

interface PdfDescriptor {
  readonly documentId: string;
  readonly displayName: string;
  readonly sizeBytes: number;
}

class DescriptorRangeSource implements PdfRangeSource {
  private requestCount = 0;
  private transferredBytes = 0;
  private largestRequestBytes = 0;

  constructor(
    private readonly descriptor: PdfDescriptor,
    private readonly url: string,
  ) {}

  get length() {
    return this.descriptor.sizeBytes;
  }

  get name() {
    return this.descriptor.displayName;
  }

  async read(begin: number, end: number, signal: AbortSignal) {
    const response = await fetch(this.url, {
      headers: { Range: `bytes=${begin}-${end - 1}` },
      signal,
    });
    if (response.status !== 206) {
      throw new RangeSourceError(
        "PDF_PROTOCOL_RANGE_STATUS_INVALID",
        response.status,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== end - begin) {
      throw new RangeSourceError(
        "PDF_PROTOCOL_RANGE_LENGTH_INVALID",
        response.status,
      );
    }
    this.requestCount += 1;
    this.transferredBytes += bytes.length;
    this.largestRequestBytes = Math.max(this.largestRequestBytes, bytes.length);
    return bytes;
  }

  metrics() {
    return {
      requestCount: this.requestCount,
      transferredBytes: this.transferredBytes,
      largestRequestBytes: this.largestRequestBytes,
    };
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TV04_BENCHMARK_RESULT__?: unknown;
    __TV04_BENCHMARK_ERROR__?: string;
  }
}
