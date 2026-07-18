import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const experimentRoot = resolve(scriptDirectory, "..");
const fixtureDirectory = resolve(experimentRoot, "public", "fixtures");
const require = createRequire(import.meta.url);
const fontPackage = dirname(
  require.resolve("@fontsource/noto-sans-sc/package.json"),
);
const chineseFontPath = resolve(
  fontPackage,
  "files",
  "noto-sans-sc-chinese-simplified-400-normal.woff2",
);

await mkdir(fixtureDirectory, { recursive: true });
const chineseFontBytes = await readFile(chineseFontPath);

const mixedBytes = await createMixedFixture(chineseFontBytes);
const largeBytes = await createLargeFixture();
const corruptedBytes = mixedBytes.subarray(
  0,
  Math.min(2_048, mixedBytes.length),
);

const fixtures = [
  ["mixed-samples.pdf", mixedBytes],
  ["large-360-pages.pdf", largeBytes],
  ["corrupted-truncated.pdf", corruptedBytes],
];

const manifest = [];
for (const [name, bytes] of fixtures) {
  await writeFile(resolve(fixtureDirectory, name), bytes);
  manifest.push({
    name,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

await writeFile(
  resolve(fixtureDirectory, "manifest.json"),
  `${JSON.stringify({ generatedAt: "deterministic", fixtures: manifest }, null, 2)}\n`,
  "utf8",
);

async function createMixedFixture(fontBytes) {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const chineseFont = await document.embedFont(fontBytes, { subset: true });
  const latinFont = await document.embedFont(StandardFonts.Helvetica);
  const rotations = [0, 90, 180, 270];

  for (const [index, rotation] of rotations.entries()) {
    const page = document.addPage([612, 792]);
    page.setRotation(degrees(rotation));
    page.drawText(`KyStudy TV-04 stable phrase page ${index + 1}`, {
      x: 54,
      y: 720,
      size: 18,
      font: latinFont,
      color: rgb(0.08, 0.17, 0.3),
    });
    page.drawText("计算机考研：数据结构、操作系统、计算机网络", {
      x: 54,
      y: 680,
      size: 15,
      font: chineseFont,
      color: rgb(0.14, 0.35, 0.26),
    });
    page.drawRectangle({
      x: 96,
      y: 360,
      width: 280,
      height: 150,
      borderWidth: 3,
      borderColor: rgb(0.77, 0.22, 0.18),
      color: rgb(0.97, 0.91, 0.86),
      opacity: 0.75,
    });
    page.drawText(`REGION-${rotation}`, {
      x: 118,
      y: 425,
      size: 24,
      font: latinFont,
      color: rgb(0.55, 0.12, 0.1),
    });
  }

  const complex = document.addPage([792, 612]);
  complex.drawText("Complex two-column and formula placeholder", {
    x: 42,
    y: 566,
    size: 17,
    font: latinFont,
  });
  for (let row = 0; row < 18; row += 1) {
    const y = 530 - row * 25;
    complex.drawText(
      `Left column ${String(row + 1).padStart(2, "0")}  T(n)=2T(n/2)+n`,
      {
        x: 44,
        y,
        size: 10,
        font: latinFont,
      },
    );
    complex.drawText(
      `Right column ${String(row + 1).padStart(2, "0")}  O(n log n)`,
      {
        x: 420,
        y,
        size: 10,
        font: latinFont,
      },
    );
    complex.drawLine({
      start: { x: 390, y: y - 4 },
      end: { x: 390, y: y + 16 },
      thickness: 0.5,
      color: rgb(0.55, 0.58, 0.63),
    });
  }

  const scanLike = document.addPage([612, 792]);
  for (let row = 0; row < 28; row += 1) {
    const shade = 0.18 + (row % 5) * 0.06;
    scanLike.drawRectangle({
      x: 52 + (row % 3) * 8,
      y: 730 - row * 23,
      width: 430 - (row % 4) * 25,
      height: 7,
      color: rgb(shade, shade, shade),
      opacity: 0.85,
    });
  }
  scanLike.drawRectangle({
    x: 86,
    y: 120,
    width: 410,
    height: 140,
    borderWidth: 2,
    borderColor: rgb(0.2, 0.25, 0.3),
    color: rgb(0.91, 0.92, 0.94),
  });

  document.setTitle("KyStudy TV-04 deterministic mixed sample");
  document.setProducer("KyStudy TV-04 fixture generator");
  document.setCreationDate(new Date("2026-07-18T00:00:00.000Z"));
  document.setModificationDate(new Date("2026-07-18T00:00:00.000Z"));
  return document.save({ useObjectStreams: false });
}

async function createLargeFixture() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);

  for (let pageNumber = 1; pageNumber <= 360; pageNumber += 1) {
    const page = document.addPage([612, 792]);
    page.drawText(`KyStudy TV-04 large sample page ${pageNumber}`, {
      x: 42,
      y: 746,
      size: 15,
      font: bold,
      color: rgb(0.08, 0.15, 0.28),
    });
    page.drawText(`SEARCH-TARGET-${String(pageNumber).padStart(3, "0")}`, {
      x: 42,
      y: 716,
      size: 11,
      font,
    });
    for (let row = 0; row < 24; row += 1) {
      const y = 680 - row * 25;
      const columnOffset = row % 2 === 0 ? 0 : 270;
      page.drawText(
        `row ${String(row + 1).padStart(2, "0")}  page ${String(pageNumber).padStart(3, "0")}  deterministic content`,
        { x: 42 + columnOffset, y, size: 8, font },
      );
      page.drawLine({
        start: { x: 38, y: y - 5 },
        end: { x: 574, y: y - 5 },
        thickness: 0.35,
        color: rgb(0.78, 0.8, 0.83),
      });
    }
    page.drawRectangle({
      x: 92 + (pageNumber % 17),
      y: 70 + (pageNumber % 11),
      width: 360,
      height: 78,
      borderWidth: 1,
      borderColor: rgb(0.2, 0.42, 0.56),
      color: rgb(0.89, 0.95, 0.98),
      opacity: 0.8,
    });
  }

  const unusedPayload = deterministicBytes(24 * 1024 * 1024);
  await document.attach(unusedPayload, "unopened-deterministic-payload.bin", {
    mimeType: "application/octet-stream",
    description:
      "TV-04 range-loading proof payload; the viewer never opens this attachment.",
    creationDate: new Date("2026-07-18T00:00:00.000Z"),
    modificationDate: new Date("2026-07-18T00:00:00.000Z"),
  });

  document.setTitle("KyStudy TV-04 deterministic 360 page sample");
  document.setProducer("KyStudy TV-04 fixture generator");
  document.setCreationDate(new Date("2026-07-18T00:00:00.000Z"));
  document.setModificationDate(new Date("2026-07-18T00:00:00.000Z"));
  return document.save({ useObjectStreams: true });
}

function deterministicBytes(length) {
  const bytes = new Uint8Array(length);
  let state = 0x4b595354;
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}
