// M0-only Host/renderer contract simulator. No Tauri commands or user storage.
export interface RenderJob {
  id: string;
  runId: string;
  grantId: string;
  documentId: string;
  revision: string;
  epoch: number;
  page: number;
  region?: readonly [number, number, number, number];
  width: number;
  height: number;
  deadline: number;
}

export interface RenderReply {
  job: RenderJob;
  mime: string;
  bytes: Uint8Array;
}

export function validateJob(job: RenderJob, epoch: number, now: number): void {
  if (
    job.runId !== "run-fixture" ||
    job.grantId !== "grant-fixture" ||
    job.documentId !== "two-pages" ||
    job.revision !== "v1" ||
    job.epoch !== epoch ||
    !Number.isSafeInteger(job.page) ||
    job.page < 1 ||
    job.page > 2 ||
    !Number.isFinite(job.deadline) ||
    job.deadline <= now
  ) {
    throw new Error("AGENT_RENDER_STALE");
  }
  if (
    !Number.isSafeInteger(job.width) ||
    !Number.isSafeInteger(job.height) ||
    job.width < 1 ||
    job.height < 1 ||
    job.width > 3000 ||
    job.height > 3000 ||
    job.width * job.height > 9_000_000
  ) {
    throw new Error("AGENT_RENDER_TOO_LARGE");
  }
  if (job.region !== undefined) {
    const [x, y, width, height] = job.region;
    if (
      job.page !== 1 ||
      ![x, y, width, height].every(Number.isFinite) ||
      x !== 0.1 ||
      y !== 0.175 ||
      width !== 0.8 ||
      height !== 0.225
    ) {
      throw new Error("AGENT_SCOPE_DENIED");
    }
  }
}

export class FixtureRenderHost {
  constructor(private readonly decodePng = decodeBrowserPng) {}
  epoch = 1;
  private serial = 0;
  private pending = new Map<string, RenderJob>();
  private cacheBytes = 0;

  issue(page: number, now: number, region = false): RenderJob {
    if (this.serial >= 8) throw new Error("AGENT_BUDGET_EXHAUSTED");
    const job: RenderJob = {
      id: `render-${++this.serial}`,
      runId: "run-fixture",
      grantId: "grant-fixture",
      documentId: "two-pages",
      revision: "v1",
      epoch: this.epoch,
      page,
      region: region ? [0.1, 0.175, 0.8, 0.225] : undefined,
      width: region ? 480 : 600,
      height: region ? 180 : 800,
      deadline: now + 30_000,
    };
    validateJob(job, this.epoch, now);
    this.pending.set(job.id, structuredClone(job));
    return job;
  }

  restart(): void {
    this.epoch += 1;
    this.pending.clear();
  }

  async accept(reply: RenderReply, now: number): Promise<string> {
    const original = this.pending.get(reply.job.id);
    if (
      original === undefined ||
      JSON.stringify(original) !== JSON.stringify(reply.job)
    )
      throw new Error("AGENT_RENDER_STALE");
    validateJob(original, this.epoch, now);
    if (
      reply.mime !== "image/png" ||
      reply.bytes.length > 4 * 1024 * 1024 ||
      reply.bytes.length < 24 ||
      this.cacheBytes + reply.bytes.length > 32 * 1024 * 1024
    )
      throw new Error("AGENT_RENDER_INVALID_IMAGE");
    const header = reply.bytes;
    if (
      [137, 80, 78, 71, 13, 10, 26, 10].some(
        (value, index) => header[index] !== value,
      )
    )
      throw new Error("AGENT_RENDER_INVALID_IMAGE");
    const view = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength,
    );
    if (
      view.getUint32(16) !== original.width ||
      view.getUint32(20) !== original.height
    )
      throw new Error("AGENT_RENDER_INVALID_IMAGE");
    // Claim before await, so simultaneous ACKs cannot both accept this job.
    this.pending.delete(original.id);
    const bytes = new Uint8Array(reply.bytes);
    const decoded = await this.decodePng(bytes);
    if (decoded.width !== original.width || decoded.height !== original.height)
      throw new Error("AGENT_RENDER_INVALID_IMAGE");
    const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
    if (original.epoch !== this.epoch) throw new Error("AGENT_RENDER_STALE");
    this.cacheBytes += reply.bytes.length;
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
}

async function decodeBrowserPng(
  bytes: Uint8Array,
): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(bytes).buffer], { type: "image/png" }),
  );
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}
