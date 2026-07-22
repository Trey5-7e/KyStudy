const CJK_CHARACTER = /[\u3400-\u9fff\uf900-\ufaff]/;
const CLOSING_PUNCTUATION = /[，。！？；：、,.!?;:）】》]/;
const OPENING_PUNCTUATION = /[（【《]/;

export function joinPdfTextItems(items: readonly unknown[]): string {
  let result = "";
  let previousCharacter = "";
  for (const value of items) {
    if (!isTextItem(value) || value.str === "") {
      continue;
    }
    const firstCharacter = value.str[0] ?? "";
    if (
      result !== "" &&
      !result.endsWith("\n") &&
      needsSpace(previousCharacter, firstCharacter)
    ) {
      result += " ";
    }
    result += value.str;
    previousCharacter = value.str.at(-1) ?? previousCharacter;
    if (value.hasEOL) {
      result += "\n";
      previousCharacter = "";
    }
  }
  return result.trim();
}

function isTextItem(value: unknown): value is { str: string; hasEOL: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "str" in value &&
    typeof value.str === "string" &&
    "hasEOL" in value &&
    typeof value.hasEOL === "boolean"
  );
}

function needsSpace(previous: string, current: string): boolean {
  if (previous === "" || current === "") {
    return false;
  }
  if (
    (CJK_CHARACTER.test(previous) && CJK_CHARACTER.test(current)) ||
    CLOSING_PUNCTUATION.test(current) ||
    OPENING_PUNCTUATION.test(previous)
  ) {
    return false;
  }
  return true;
}
