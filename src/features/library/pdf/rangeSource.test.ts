import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpRangeSource, MemoryRangeSource } from "./rangeSource";

describe("HttpRangeSource", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests exactly one closed HTTP byte range", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([2, 3, 4]), {
        status: 206,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const source = new HttpRangeSource("sample.pdf", 10, "kystudy-pdf://id");

    const bytes = await source.read(2, 5, new AbortController().signal);

    expect([...bytes]).toEqual([2, 3, 4]);
    expect(fetchMock).toHaveBeenCalledWith("kystudy-pdf://id", {
      headers: { Range: "bytes=2-4" },
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects an out-of-bounds request before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const source = new HttpRangeSource("sample.pdf", 10, "kystudy-pdf://id");

    await expect(
      source.read(8, 11, new AbortController().signal),
    ).rejects.toThrow("PDF_RANGE_INVALID");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("MemoryRangeSource", () => {
  it("returns a copied byte range without exposing the source buffer", async () => {
    const sourceBytes = new Uint8Array([1, 2, 3, 4]);
    const source = new MemoryRangeSource("preview.pdf", sourceBytes);

    const bytes = await source.read(1, 3, new AbortController().signal);
    bytes[0] = 99;

    expect([...bytes]).toEqual([99, 3]);
    expect([...sourceBytes]).toEqual([1, 2, 3, 4]);
    expect(source.length).toBe(4);
  });

  it("rejects an aborted read", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = new MemoryRangeSource("preview.pdf", new Uint8Array([1]));

    await expect(source.read(0, 1, controller.signal)).rejects.toThrow(
      "PDF_RANGE_ABORTED",
    );
  });
});
