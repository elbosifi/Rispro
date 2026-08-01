import { describe, expect, it } from "vitest";
import { resolveDirectPrintFailureAction } from "./direct-print-failure-action";

describe("direct print failure actions", () => {
  it("never offers browser fallback for unresolved or duplicate submissions", () => {
    expect(resolveDirectPrintFailureAction("PRINT_STATUS_UNKNOWN", true, true)).toBe("NONE");
    expect(resolveDirectPrintFailureAction("DUPLICATE_PRINT", true, true)).toBe("NONE");
  });

  it("opens workstation settings for missing and invalid printer mappings", () => {
    expect(resolveDirectPrintFailureAction("PRINTER_NOT_CONFIGURED", true, true)).toBe("OPEN_SETTINGS");
    expect(resolveDirectPrintFailureAction("PRINTER_NOT_FOUND", true, true)).toBe("OPEN_SETTINGS");
    expect(resolveDirectPrintFailureAction("PRINTER_SETTINGS_INVALID", true, true)).toBe("OPEN_SETTINGS");
    expect(resolveDirectPrintFailureAction("PAGE_SIZE_MISMATCH", true, true)).toBe("OPEN_SETTINGS");
  });

  it("offers QZ browser fallback only when a valid fallback exists and is enabled", () => {
    expect(resolveDirectPrintFailureAction("QZ_NOT_RUNNING", true, true)).toBe("BROWSER_PRINT");
    expect(resolveDirectPrintFailureAction("PRINTER_DISCOVERY_FAILED", true, true)).toBe("BROWSER_PRINT");
    expect(resolveDirectPrintFailureAction("PRINTER_DISCOVERY_FAILED", false, true)).toBe("OPEN_SETTINGS");
    expect(resolveDirectPrintFailureAction("QZ_NOT_RUNNING", true, false)).toBe("OPEN_SETTINGS");
    expect(resolveDirectPrintFailureAction("QZ_NOT_RUNNING", false, true)).toBe("OPEN_SETTINGS");
    expect(resolveDirectPrintFailureAction("DOCUMENT_GENERATION_FAILED", false, true)).toBe("NONE");
  });
});
