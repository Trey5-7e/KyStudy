import { invoke } from "@tauri-apps/api/core";

export interface SavePaperPdfRequest {
  fileName: string;
  bytes: number[];
}

export interface SavePaperPdfResult {
  fileName: string;
}

export async function savePaperPdf(
  request: SavePaperPdfRequest,
): Promise<SavePaperPdfResult | undefined> {
  const value: unknown = await invoke("save_paper_pdf", { request });
  if (value === null || value === undefined) return undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { fileName?: unknown }).fileName !== "string"
  ) {
    throw new Error("PAPER_EXPORT_SAVE_INVALID");
  }
  return { fileName: (value as { fileName: string }).fileName };
}
