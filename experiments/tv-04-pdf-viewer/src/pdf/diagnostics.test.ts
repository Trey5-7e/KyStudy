import { describe, expect, it } from "vitest";

import { diagnosticCode } from "./diagnostics";
import { RangeSourceError } from "./rangeSource";

describe("non-sensitive PDF diagnostics", () => {
  it("keeps a stable RangeSource code", () => {
    expect(
      diagnosticCode(new RangeSourceError("PDF_RANGE_STATUS_INVALID", 404)),
    ).toBe("PDF_RANGE_STATUS_INVALID");
  });

  it("keeps a serialized Rust command code", () => {
    expect(
      diagnosticCode({
        code: "PDF_DOCUMENT_NOT_FOUND",
        message: "local message",
      }),
    ).toBe("PDF_DOCUMENT_NOT_FOUND");
  });

  it("does not expose an arbitrary exception message", () => {
    expect(diagnosticCode(new Error("C:\\private\\secret.pdf"))).toBe("Error");
  });
});
