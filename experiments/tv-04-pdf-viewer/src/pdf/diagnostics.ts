import { RangeSourceError } from "./rangeSource";

const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,80}$/;

export function diagnosticCode(error: unknown) {
  if (error instanceof RangeSourceError) {
    return error.code;
  }
  if (
    isRecord(error) &&
    typeof error.code === "string" &&
    STABLE_CODE.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error) {
    return STABLE_CODE.test(error.message) ? error.message : error.name;
  }
  return "UNKNOWN_ERROR";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
