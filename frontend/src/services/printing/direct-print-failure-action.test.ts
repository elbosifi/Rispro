import { describe, expect, it } from "vitest";
import { resolveDirectPrintFailureAction } from "./direct-print-failure-action";

describe("direct print failure actions", () => {
  it("never offers browser fallback for unresolved or duplicate submissions", () => {
    expect(resolveDirectPrintFailureAction("PRINT_STATUS_UNKNOWN", true, true)).toBe("NONE");
    expect(resolveDirectPrintFailureAction("DUPLICATE_PRINT", true, true)).toBe("NONE");
  });

  const fallbackErrors = [
    "PRINTER_NOT_CONFIGURED", "PRINTER_NOT_FOUND", "PRINTER_SETTINGS_INVALID", "PAGE_SIZE_MISMATCH",
    "QZ_NOT_INSTALLED", "QZ_NOT_RUNNING", "QZ_CONNECTION_FAILED", "PRINTER_DISCOVERY_FAILED", "QZ_CSP_BLOCKED",
    "LOCAL_NETWORK_PERMISSION_DENIED", "CERTIFICATE_REJECTED", "SIGNATURE_FAILED", "SIGNING_PAYLOAD_TOO_LARGE",
    "DOCUMENT_GENERATION_FAILED", "INVALID_PDF", "PRINT_FAILED", "PRINT_TIMEOUT",
  ] as const;

  it.each(fallbackErrors)("offers browser fallback for %s when a callback exists and fallback is enabled", (code) => {
    expect(resolveDirectPrintFailureAction(code, true, true)).toBe("BROWSER_PRINT");
  });

  it.each(fallbackErrors)("opens workstation settings for %s when no browser callback exists", (code) => {
    expect(resolveDirectPrintFailureAction(code, false, true)).toBe("OPEN_SETTINGS");
  });

  it("opens workstation settings when browser fallback is disabled", () => {
    expect(resolveDirectPrintFailureAction("QZ_NOT_RUNNING", true, false)).toBe("OPEN_SETTINGS");
  });
});
