import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpRangeSource, RangeSourceError } from "./rangeSource";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP range source", () => {
  it("requests only the inclusive HTTP range corresponding to the PDF.js interval", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { "content-length": "1000" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(100), {
          status: 206,
          headers: { "content-range": "bytes 100-199/1000" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const source = await HttpRangeSource.open("/fixture.pdf");

    const bytes = await source.read(100, 200, new AbortController().signal);

    expect(bytes).toHaveLength(100);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Range: "bytes=100-199" },
    });
    expect(source.metrics()).toEqual({
      requestCount: 1,
      transferredBytes: 100,
      largestRequestBytes: 100,
    });
  });

  it("rejects a server that ignores the Range header", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { "content-length": "1000" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(new Uint8Array(1000), { status: 200 }),
        ),
    );
    const source = await HttpRangeSource.open("/fixture.pdf");

    await expect(
      source.read(0, 100, new AbortController().signal),
    ).rejects.toEqual(new RangeSourceError("PDF_RANGE_STATUS_INVALID", 200));
  });

  it("rejects an interval outside the declared document length", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { "content-length": "1000" },
          }),
        ),
    );
    const source = await HttpRangeSource.open("/fixture.pdf");

    await expect(
      source.read(950, 1050, new AbortController().signal),
    ).rejects.toEqual(new RangeSourceError("PDF_RANGE_INVALID"));
  });
});
