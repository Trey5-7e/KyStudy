export interface PdfRangeSource {
  readonly length: number;
  readonly name: string;
  read(begin: number, end: number, signal: AbortSignal): Promise<Uint8Array>;
}

export class MemoryRangeSource implements PdfRangeSource {
  readonly length: number;
  private readonly bytes: Uint8Array;

  constructor(
    readonly name: string,
    bytes: Uint8Array,
  ) {
    this.bytes = bytes.slice();
    this.length = this.bytes.length;
    if (!Number.isSafeInteger(this.length) || this.length <= 0) {
      throw new RangeSourceError("PDF_LENGTH_INVALID");
    }
  }

  async read(
    begin: number,
    end: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    validateRange(begin, end, this.length);
    if (signal.aborted) {
      throw new RangeSourceError("PDF_RANGE_ABORTED");
    }
    return this.bytes.slice(begin, end);
  }
}

export class HttpRangeSource implements PdfRangeSource {
  constructor(
    readonly name: string,
    readonly length: number,
    private readonly url: string,
  ) {
    if (!Number.isSafeInteger(length) || length <= 0) {
      throw new RangeSourceError("PDF_LENGTH_INVALID");
    }
  }

  async read(
    begin: number,
    end: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
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
    return bytes;
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

function validateRange(begin: number, end: number, length: number): void {
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
