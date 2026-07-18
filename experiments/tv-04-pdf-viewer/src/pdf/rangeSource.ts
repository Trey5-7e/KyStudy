export interface RangeMetrics {
  readonly requestCount: number;
  readonly transferredBytes: number;
  readonly largestRequestBytes: number;
}

export interface PdfRangeSource {
  readonly length: number;
  readonly name: string;
  read(begin: number, end: number, signal: AbortSignal): Promise<Uint8Array>;
  metrics(): RangeMetrics;
}

export class HttpRangeSource implements PdfRangeSource {
  private requestCount = 0;
  private transferredBytes = 0;
  private largestRequestBytes = 0;

  private constructor(
    readonly name: string,
    readonly length: number,
    private readonly url: string,
  ) {}

  static async open(url: string, name = "document.pdf") {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      throw new RangeSourceError("PDF_METADATA_FAILED", response.status);
    }
    const rawLength = response.headers.get("content-length");
    const length = rawLength === null ? Number.NaN : Number(rawLength);
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new RangeSourceError("PDF_LENGTH_INVALID", response.status);
    }
    return new HttpRangeSource(name, length, url);
  }

  async read(begin: number, end: number, signal: AbortSignal) {
    validateRange(begin, end, this.length);
    const response = await fetch(this.url, {
      headers: { Range: `bytes=${begin}-${end - 1}` },
      signal,
    });
    if (response.status !== 206) {
      throw new RangeSourceError("PDF_RANGE_STATUS_INVALID", response.status);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== end - begin) {
      throw new RangeSourceError("PDF_RANGE_LENGTH_INVALID", response.status);
    }
    this.requestCount += 1;
    this.transferredBytes += bytes.length;
    this.largestRequestBytes = Math.max(this.largestRequestBytes, bytes.length);
    return bytes;
  }

  metrics(): RangeMetrics {
    return {
      requestCount: this.requestCount,
      transferredBytes: this.transferredBytes,
      largestRequestBytes: this.largestRequestBytes,
    };
  }
}

export class RangeSourceError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(status === undefined ? code : `${code} (${status})`);
    this.name = "RangeSourceError";
  }
}

function validateRange(begin: number, end: number, length: number) {
  if (
    !Number.isSafeInteger(begin) ||
    !Number.isSafeInteger(end) ||
    begin < 0 ||
    end <= begin ||
    end > length
  ) {
    throw new RangeSourceError("PDF_RANGE_INVALID");
  }
}
