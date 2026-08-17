import type {
  PaperExportLayout,
  PaperLayoutElement,
} from "./paperExportLayout";

export interface PaperPdfImage {
  id: string;
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Small, dependency-free PDF writer for the fixed A4 export format. */
export class PdfWriterAdapter {
  write(
    layout: PaperExportLayout,
    images: readonly PaperPdfImage[],
  ): Uint8Array {
    const objects: string[] = [];
    const binaryObjects: Array<Uint8Array | undefined> = [];
    const addObject = (body: string, binary?: Uint8Array): number => {
      objects.push(body);
      binaryObjects.push(binary);
      return objects.length;
    };
    const imageRefs = new Map<string, number>();
    for (const image of images) {
      imageRefs.set(
        image.id,
        addObject(
          `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>`,
          image.bytes,
        ),
      );
    }
    const pageRefs: number[] = [];
    const contentRefs: number[] = [];
    for (const page of layout.pages) {
      const imageNames = new Map<string, string>();
      let imageIndex = 0;
      for (const element of page.elements) {
        if (element.kind === "image" && !imageNames.has(element.imageId)) {
          if (!imageRefs.has(element.imageId)) {
            throw new Error("PAPER_EXPORT_IMAGE_MISSING");
          }
          imageIndex += 1;
          imageNames.set(element.imageId, `Im${imageIndex}`);
        }
      }
      const stream = renderPageContent(page.elements, imageNames);
      contentRefs.push(addObject(`<< /Length ${stream.length} >>`, stream));
      const xObject = [...imageNames.entries()]
        .map(([id, name]) => {
          const ref = imageRefs.get(id);
          return ref === undefined ? "" : `/${name} ${ref} 0 R`;
        })
        .filter(Boolean)
        .join(" ");
      pageRefs.push(
        addObject(
          `<< /Type /Page /MediaBox [0 0 ${layout.pageWidth} ${layout.pageHeight}] /Resources << /XObject << ${xObject} >> >> /Contents ${contentRefs[contentRefs.length - 1]} 0 R >>`,
        ),
      );
    }
    const pagesObject = addObject(
      `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] >>`,
    );
    const catalogObject = addObject(
      `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`,
    );
    return serializePdf(objects, binaryObjects, catalogObject);
  }
}

export function createPaperPdf(
  layout: PaperExportLayout,
  images: readonly PaperPdfImage[],
): Uint8Array {
  return new PdfWriterAdapter().write(layout, images);
}

function renderPageContent(
  elements: readonly PaperLayoutElement[],
  imageNames: ReadonlyMap<string, string>,
): Uint8Array {
  const commands: string[] = [];
  for (const element of elements) {
    if (element.kind === "text") {
      throw new Error("PAPER_EXPORT_UNEXPECTED_TEXT");
    }
    if (element.kind === "line") {
      const y1 = 841.89 - element.y1;
      const y2 = 841.89 - element.y2;
      commands.push(
        `${element.x1.toFixed(2)} ${y1.toFixed(2)} m ${element.x2.toFixed(2)} ${y2.toFixed(2)} l S`,
      );
    } else {
      const name = imageNames.get(element.imageId);
      if (name !== undefined) {
        const y = 841.89 - element.y - element.height;
        commands.push(
          `q ${element.width.toFixed(2)} 0 0 ${element.height.toFixed(2)} ${element.x.toFixed(2)} ${y.toFixed(2)} cm /${name} Do Q`,
        );
      }
    }
  }
  return new TextEncoder().encode(`${commands.join("\n")}\n`);
}

function serializePdf(
  objects: readonly string[],
  binaryObjects: readonly (Uint8Array | undefined)[],
  rootObject: number,
): Uint8Array {
  const chunks: Uint8Array[] = [
    new TextEncoder().encode("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"),
  ];
  const offsets = [0];
  let offset = chunks[0]!.length;
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(offset);
    const binary = binaryObjects[index];
    const header = new TextEncoder().encode(
      `${index + 1} 0 obj\n${objects[index]!}\nstream\n`,
    );
    const footer = new TextEncoder().encode("\nendstream\nendobj\n");
    const objectBytes =
      binary === undefined
        ? new TextEncoder().encode(
            `${index + 1} 0 obj\n${objects[index]!}\nendobj\n`,
          )
        : concatBytes([header, binary, footer]);
    chunks.push(objectBytes);
    offset += objectBytes.length;
  }
  const xrefOffset = offset;
  const xref = [`xref`, `0 ${objects.length + 1}`, `0000000000 65535 f `];
  for (let index = 1; index <= objects.length; index += 1) {
    xref.push(`${String(offsets[index]).padStart(10, "0")} 00000 n `);
  }
  xref.push(
    `trailer << /Size ${objects.length + 1} /Root ${rootObject} 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
  );
  chunks.push(new TextEncoder().encode(`${xref.join("\n")}\n`));
  return concatBytes(chunks);
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
