import { describe, expect, it } from "vitest";
import { FixtureRenderHost, validateJob, type RenderJob } from "./renderJob";

function header(job: RenderJob): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, job.width);
  view.setUint32(20, job.height);
  return bytes;
}

function fixtureHost(): FixtureRenderHost {
  return new FixtureRenderHost(async (bytes) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  });
}

describe("M0 RenderJob contract (header-only unit fixture)", () => {
  it("decoder rejection cannot create an asset receipt", async () => {
    const host = new FixtureRenderHost(async () => {
      throw new Error("invalid PNG");
    });
    const job = host.issue(1, 0);
    await expect(
      host.accept({ job, mime: "image/png", bytes: header(job) }, 1),
    ).rejects.toThrow("invalid PNG");
  });
  it("restart while decoding prevents a late accepted result", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const host = new FixtureRenderHost(async () => {
      await wait;
      return { width: 600, height: 800 };
    });
    const job = host.issue(1, 0);
    const acceptance = host.accept(
      { job, mime: "image/png", bytes: header(job) },
      1,
    );
    host.restart();
    release();
    await expect(acceptance).rejects.toThrow("STALE");
  });
  it("binds page, region, source and revision before allocation", () => {
    const host = fixtureHost();
    const job = host.issue(1, 0, true);
    expect(() => validateJob(job, 1, 1)).not.toThrow();
    for (const patch of [
      { page: 2 },
      { revision: "v2" },
      { documentId: "other" },
      { grantId: "other" },
      { region: [0, 0, 1, 1] as const },
    ])
      expect(() => validateJob({ ...job, ...patch }, 1, 1)).toThrow();
  });
  it("rejects oversized or invalid geometry before canvas allocation", () => {
    const job = new FixtureRenderHost().issue(1, 0);
    for (const patch of [
      { width: 3001 },
      { height: 0 },
      { width: NaN },
      { page: 0 },
      { deadline: NaN },
    ])
      expect(() => validateJob({ ...job, ...patch }, 1, 1)).toThrow();
  });
  it("accepts once and hashes host-received bytes", async () => {
    const host = fixtureHost();
    const job = host.issue(1, 0);
    const reply = { job, mime: "image/png", bytes: header(job) };
    expect(await host.accept(reply, 1)).toMatch(/^[0-9a-f]{64}$/);
    await expect(host.accept(reply, 1)).rejects.toThrow("STALE");
  });
  it("rejects mutated, expired and pre-restart jobs", async () => {
    const host = fixtureHost();
    const job = host.issue(1, 0);
    await expect(
      host.accept(
        { job: { ...job, page: 2 }, mime: "image/png", bytes: header(job) },
        1,
      ),
    ).rejects.toThrow("STALE");
    await expect(
      host.accept({ job, mime: "image/png", bytes: header(job) }, 30_000),
    ).rejects.toThrow("STALE");
    host.restart();
    await expect(
      host.accept({ job, mime: "image/png", bytes: header(job) }, 1),
    ).rejects.toThrow("STALE");
  });
  it("rejects unsupported, oversized and wrong-dimension images", async () => {
    const host = fixtureHost();
    const job = host.issue(1, 0);
    for (const [mime, bytes] of [
      ["image/svg+xml", header(job)],
      ["image/png", new Uint8Array(4 * 1024 * 1024 + 1)],
      ["image/png", header({ ...job, width: 1 })],
    ] as const)
      await expect(host.accept({ job, mime, bytes }, 1)).rejects.toThrow(
        "INVALID_IMAGE",
      );
  });
  it("keeps run image budget across renderer restart", () => {
    const host = fixtureHost();
    for (let i = 0; i < 8; i++) host.issue(1, 0);
    host.restart();
    expect(() => host.issue(1, 0)).toThrow("BUDGET");
  });
});
