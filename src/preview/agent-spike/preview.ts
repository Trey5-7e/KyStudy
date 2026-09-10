import "./preview.css";
import pdfUrl from "./fixtures/two-pages.pdf?url";
import { openPdf } from "../../features/library/pdf/pdfEngine";
import { MemoryRangeSource } from "../../features/library/pdf/rangeSource";
import { FixtureRenderHost, validateJob, type RenderJob } from "./renderJob";

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const receipt = document.querySelector<HTMLParagraphElement>("#receipt")!;
const output = document.querySelector<HTMLElement>("#output")!;
const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
// Session and host belong to this entry, not the currently displayed result container.
const host = new FixtureRenderHost();
const session = fetch(pdfUrl)
  .then((response) => response.arrayBuffer())
  .then((bytes) =>
    openPdf(
      new MemoryRangeSource("synthetic-two-pages.pdf", new Uint8Array(bytes)),
    ),
  );
let displayPage = 1;

async function render(
  pageNumber: number,
  region = false,
  mode = "normal",
): Promise<void> {
  buttons.forEach((button) => {
    if (button.id !== "navigate") button.disabled = true;
  });
  status.textContent = "加载并渲染合成样本…";
  const started = performance.now();
  try {
    const job =
      mode === "rust"
        ? await requestRustJob(pageNumber, region)
        : host.issue(pageNumber, Date.now(), region);
    if (mode === "large") job.width = 3001;
    validateJob(job, mode === "rust" ? job.epoch : host.epoch, Date.now());
    const { document: pdf } = await session;
    const page = await pdf.getPage(job.page);
    validateJob(job, mode === "rust" ? job.epoch : host.epoch, Date.now());
    const canvas = document.createElement("canvas");
    canvas.width = job.width;
    canvas.height = job.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("Canvas unavailable");
    const viewport = page.getViewport({ scale: 1 });
    await page.render({
      canvasContext: context,
      canvas,
      viewport,
      transform: region ? [1, 0, 0, 1, -60, -140] : undefined,
    }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob === null
            ? reject(new Error("PNG encode failed"))
            : resolve(blob),
        "image/png",
      ),
    );
    const bitmap = await createImageBitmap(blob);
    if (bitmap.width !== job.width || bitmap.height !== job.height)
      throw new Error("Decoded size mismatch");
    bitmap.close();
    if (mode === "restart") host.restart();
    const hash =
      mode === "rust"
        ? await acceptRustReply(job, blob)
        : await host.accept(
            {
              job,
              mime: blob.type,
              bytes: new Uint8Array(await blob.arrayBuffer()),
            },
            mode === "stale" ? job.deadline : Date.now(),
          );
    output.replaceChildren(canvas);
    receipt.textContent = `host=${mode === "rust" ? "Rust PNG decoder" : "TS simulator"} job=${job.id} page=${job.page} region=${region} revision=${job.revision} pixels=${job.width}×${job.height} bytes=${blob.size} sha256=${hash}`;
    status.textContent = `完成 · ${(performance.now() - started).toFixed(1)} ms · 当前显示页 ${displayPage} 不改变任务来源`;
  } catch (error) {
    status.textContent = `已阻止：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

document.querySelector("#page1")!.addEventListener("click", () => {
  void render(1);
});
document.querySelector("#page2")!.addEventListener("click", () => {
  void render(2);
});
document.querySelector("#region")!.addEventListener("click", () => {
  void render(1, true);
});
document.querySelector("#stale")!.addEventListener("click", () => {
  void render(1, false, "stale");
});
document.querySelector("#restart")!.addEventListener("click", () => {
  void render(1, false, "restart");
});
document.querySelector("#large")!.addEventListener("click", () => {
  void render(1, false, "large");
});
document.querySelector("#navigate")!.addEventListener("click", () => {
  displayPage = displayPage === 1 ? 2 : 1;
  status.textContent = `显示页切换为 ${displayPage}；活动 RenderJob 仍绑定原始页码`;
});

async function requestRustJob(
  page: number,
  region: boolean,
): Promise<RenderJob> {
  const response = await fetch(
    `http://127.0.0.1:1431/job/${region ? "region" : page === 1 ? "page1" : "page2"}`,
  );
  if (!response.ok) throw new Error("Rust Host 拒绝分配任务");
  return (await response.json()) as RenderJob;
}

async function acceptRustReply(job: RenderJob, blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("PNG encoding failed"));
    reader.readAsDataURL(blob);
  });
  const response = await fetch("http://127.0.0.1:1431/reply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job,
      mime: blob.type,
      base64: dataUrl.split(",")[1],
    }),
  });
  const result = (await response.json()) as { sha256?: string; code?: string };
  if (!response.ok || result.sha256 === undefined)
    throw new Error(result.code ?? "Rust Host 拒绝图片");
  return result.sha256;
}

document.querySelector("#rust1")!.addEventListener("click", () => {
  void render(1, false, "rust");
});
document.querySelector("#rust2")!.addEventListener("click", () => {
  void render(2, false, "rust");
});
document.querySelector("#rust-region")!.addEventListener("click", () => {
  void render(1, true, "rust");
});
