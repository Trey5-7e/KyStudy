const OCR_MIN_TEXT_CHARACTERS = 32;
export const OCR_INDEX_MIN_CONFIDENCE = 0.35;

export interface OcrIndexedLine {
  text: string;
  confidence: number;
}

export function shouldRequestPdfOcr(text: string): boolean {
  return text.replace(/\s+/g, "").trim().length < OCR_MIN_TEXT_CHARACTERS;
}

/**
 * Keep low-confidence OCR from polluting search/index text. If an entire page
 * is low confidence, retain it as a degraded fallback so OCR remains useful
 * for completely scanned pages instead of silently returning nothing.
 */
export function selectOcrLinesForIndex<T extends OcrIndexedLine>(
  lines: readonly T[],
): T[] {
  const nonEmpty = lines.filter((line) => line.text.trim() !== "");
  const reliable = nonEmpty.filter(
    (line) => line.confidence >= OCR_INDEX_MIN_CONFIDENCE,
  );
  return reliable.length > 0 ? reliable : nonEmpty;
}

export function mergeIndexedText(textLayer: string, ocrText: string): string {
  const primary = textLayer.trim();
  const secondary = ocrText.trim();
  if (primary === "") return secondary;
  if (secondary === "") return primary;
  const existing = new Set(
    primary
      .split(/\r?\n/)
      .map((line) => normalizeIndexedLine(line))
      .filter((line) => line !== ""),
  );
  const additions = secondary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const normalized = normalizeIndexedLine(line);
      if (normalized === "" || existing.has(normalized)) return false;
      existing.add(normalized);
      return true;
    });
  return additions.length === 0
    ? primary
    : `${primary}\n${additions.join("\n")}`;
}

function normalizeIndexedLine(value: string): string {
  return value.replace(/\s+/g, "").replace(/[，。、“”‘’]/g, "");
}
