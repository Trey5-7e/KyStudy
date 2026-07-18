import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

import { chromium } from "playwright-core";

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(scriptDirectory, "..");
const viteBin = resolve(
  experimentRoot,
  "node_modules",
  "vite",
  "bin",
  "vite.js",
);
const edgePath =
  process.env.KYSTUDY_TV04_EDGE_PATH ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const temporaryRoot =
  process.env.KYSTUDY_TV04_BENCH_ROOT ?? resolve(experimentRoot, ".tmp");
await mkdir(temporaryRoot, { recursive: true });
const profileDirectory = await mkdtemp(join(temporaryRoot, "edge-profile-"));
const server = spawn(
  process.execPath,
  [viteBin, "preview", "--host", "127.0.0.1", "--port", "4174"],
  {
    cwd: experimentRoot,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);

let context;
try {
  await waitForServer("http://127.0.0.1:4174/");
  context = await chromium.launchPersistentContext(profileDirectory, {
    executablePath: edgePath,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    args: ["--js-flags=--expose-gc", "--disable-background-timer-throttling"],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("http://127.0.0.1:4174/?benchmark=1", {
    waitUntil: "domcontentloaded",
  });

  let baselineWorkingSetBytes = null;
  let peakWorkingSetBytes = 0;
  let finalWorkingSetBytes = null;
  let report;
  for (let poll = 0; poll < 1200; poll += 1) {
    const state = await page.evaluate(() => ({
      result: window.__TV04_BENCHMARK_RESULT__,
      error: window.__TV04_BENCHMARK_ERROR__,
    }));
    const workingSetBytes = await edgeWorkingSet(profileDirectory);
    if (workingSetBytes > 0) {
      baselineWorkingSetBytes ??= workingSetBytes;
      peakWorkingSetBytes = Math.max(peakWorkingSetBytes, workingSetBytes);
      finalWorkingSetBytes = workingSetBytes;
    }
    if (state.error !== undefined) {
      throw new Error(state.error);
    }
    if (state.result !== undefined) {
      await delay(250);
      finalWorkingSetBytes = await edgeWorkingSet(profileDirectory);
      peakWorkingSetBytes = Math.max(peakWorkingSetBytes, finalWorkingSetBytes);
      report = {
        ...state.result,
        browserWorkingSet: {
          baselineBytes: baselineWorkingSetBytes,
          peakBytes: peakWorkingSetBytes,
          finalBytes: finalWorkingSetBytes,
        },
      };
      break;
    }
    await delay(100);
  }
  if (report === undefined) {
    throw new Error("TV04_BROWSER_BENCHMARK_TIMEOUT");
  }
  report = { ...report, viewerSmoke: await runViewerSmoke(page) };

  const outputDirectory = resolve(experimentRoot, "output");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, "browser-benchmark.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await context?.close();
  server.kill();
  await rm(profileDirectory, { recursive: true, force: true });
}

async function runViewerSmoke(page) {
  await page.goto("http://127.0.0.1:4174/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "加载 PDF 实验" }).click();
  await page.getByRole("status").waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    document
      .querySelector('[role="status"]')
      ?.textContent?.includes("第 1/6 页"),
  );
  const layer = page.locator(".selection-layer");
  const layerBox = await layer.boundingBox();
  if (layerBox === null) {
    throw new Error("TV04_SELECTION_LAYER_MISSING");
  }
  await page.mouse.move(
    layerBox.x + layerBox.width * 0.2,
    layerBox.y + layerBox.height * 0.25,
  );
  await page.mouse.down();
  await page.mouse.move(
    layerBox.x + layerBox.width * 0.66,
    layerBox.y + layerBox.height * 0.7,
  );
  await page.mouse.up();
  const normalizedStatus = await page.getByRole("status").textContent();
  if (!normalizedStatus?.includes("区域")) {
    throw new Error("TV04_SELECTION_NOT_SAVED");
  }

  const beforeRotation = await layer.boundingBox();
  await page.getByRole("button", { name: "旋转" }).click();
  await page.waitForTimeout(250);
  const afterRotation = await layer.boundingBox();
  await page.getByRole("button", { name: "放大" }).click();
  await page.waitForTimeout(250);
  const preview = page.locator(".selection-preview");
  const previewBox = await preview.boundingBox();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "加载 PDF 实验" }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[role="status"]')
      ?.textContent?.includes("第 1/6 页"),
  );
  const reloadedPreviewBox = await page
    .locator(".selection-preview")
    .boundingBox();

  return {
    selectionStatus: normalizedStatus,
    rotationChangedViewport:
      beforeRotation !== null &&
      afterRotation !== null &&
      Math.abs(beforeRotation.width - afterRotation.width) > 1,
    overlayRestoredAfterRotationAndZoom:
      previewBox !== null && previewBox.width > 4 && previewBox.height > 4,
    overlayRestoredAfterReload:
      reloadedPreviewBox !== null &&
      reloadedPreviewBox.width > 4 &&
      reloadedPreviewBox.height > 4,
  };
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await delay(100);
  }
  throw new Error("TV04_PREVIEW_SERVER_START_TIMEOUT");
}

async function edgeWorkingSet(profileMarker) {
  const command = [
    "$marker = $env:KYSTUDY_TV04_PROFILE_MARKER",
    "$sum = (Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedge.exe' -and $_.CommandLine -like \"*$marker*\" } | Measure-Object -Property WorkingSetSize -Sum).Sum",
    "if ($null -eq $sum) { '0' } else { [string]$sum }",
  ].join("; ");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    {
      env: { ...process.env, KYSTUDY_TV04_PROFILE_MARKER: profileMarker },
      windowsHide: true,
    },
  );
  const value = Number(stdout.trim());
  return Number.isFinite(value) ? value : 0;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
