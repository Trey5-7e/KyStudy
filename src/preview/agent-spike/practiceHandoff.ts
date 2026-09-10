import {
  LEGACY_PAPER_DRAFT_STORAGE_KEY,
  PAPER_DRAFT_STORAGE_KEY,
  savePaperDraft,
  loadPaperDraft,
  type SavedPaperDraft,
} from "../../features/workbook/paperSetupPreferences";

export class IsolatedStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const RECEIPT_KEY = "m0.isolated-handoff-receipt";

interface Receipt {
  id: string;
  expectedRaw: string;
  acknowledged: boolean;
}

function parseReceipt(raw: string): Receipt {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "id" in value &&
      typeof value.id === "string" &&
      "expectedRaw" in value &&
      typeof value.expectedRaw === "string" &&
      "acknowledged" in value &&
      typeof value.acknowledged === "boolean"
    )
      return value as Receipt;
  } catch {
    /* Invalid receipts cannot authorize a write. */
  }
  throw new Error("AGENT_HANDOFF_CONFLICT");
}

// M0 only: caller always supplies isolated storage; there is no browserStorage fallback.
export function deliverDraft(
  id: string,
  draft: SavedPaperDraft,
  storage: Storage,
  crashAfterSave = false,
): "saved" | "reconciled" {
  if (id.length === 0 || id.length > 128)
    throw new Error("AGENT_HANDOFF_CONFLICT");
  const normalized = new IsolatedStorage();
  if (!savePaperDraft(draft, normalized))
    throw new Error("AGENT_HANDOFF_SAVE_FAILED");
  const expectedRaw = normalized.getItem(PAPER_DRAFT_STORAGE_KEY)!;
  if (
    expectedRaw.length > 128 * 1024 ||
    loadPaperDraft(normalized) === undefined
  )
    throw new Error("AGENT_HANDOFF_SAVE_FAILED");
  const oldReceipt = storage.getItem(RECEIPT_KEY);
  const current = storage.getItem(PAPER_DRAFT_STORAGE_KEY);
  if (
    current === null &&
    storage.getItem(LEGACY_PAPER_DRAFT_STORAGE_KEY) !== null
  )
    throw new Error("AGENT_HANDOFF_CONFLICT");
  if (oldReceipt !== null) {
    const receipt = parseReceipt(oldReceipt);
    if (receipt.id !== id || receipt.expectedRaw !== expectedRaw)
      throw new Error("AGENT_HANDOFF_CONFLICT");
    if (current === expectedRaw) return "reconciled";
    if (current !== null || receipt.acknowledged)
      throw new Error("AGENT_HANDOFF_CONFLICT");
  } else if (
    current !== null ||
    storage.getItem(LEGACY_PAPER_DRAFT_STORAGE_KEY) !== null
  ) {
    // Even an unreadable old draft must not be treated as empty and overwritten.
    throw new Error("AGENT_HANDOFF_CONFLICT");
  }
  const receipt: Receipt = { id, expectedRaw, acknowledged: false };
  storage.setItem(RECEIPT_KEY, JSON.stringify(receipt));
  if (!savePaperDraft(draft, storage))
    throw new Error("AGENT_HANDOFF_SAVE_FAILED");
  if (storage.getItem(PAPER_DRAFT_STORAGE_KEY) !== expectedRaw)
    throw new Error("AGENT_HANDOFF_SAVE_FAILED");
  if (crashAfterSave) throw new Error("M0_CRASH_AFTER_SAVE_BEFORE_ACK");
  return "saved";
}

export function acknowledgeDraft(id: string, storage: Storage): void {
  const raw = storage.getItem(RECEIPT_KEY);
  if (raw === null) throw new Error("AGENT_HANDOFF_CONFLICT");
  const receipt = parseReceipt(raw);
  if (
    receipt.id !== id ||
    storage.getItem(PAPER_DRAFT_STORAGE_KEY) !== receipt.expectedRaw
  )
    throw new Error("AGENT_HANDOFF_CONFLICT");
  storage.setItem(
    RECEIPT_KEY,
    JSON.stringify({ ...receipt, acknowledged: true }),
  );
}
