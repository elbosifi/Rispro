import type { DirectPrintErrorCode } from "@/types/printing";

export type DirectPrintFailureAction = "OPEN_SETTINGS" | "BROWSER_PRINT" | "NONE";

const SETTINGS_ERRORS = new Set<DirectPrintErrorCode>(["PRINTER_NOT_CONFIGURED", "PRINTER_NOT_FOUND", "PRINTER_SETTINGS_INVALID", "PAGE_SIZE_MISMATCH"]);
const QZ_ERRORS = new Set<DirectPrintErrorCode>(["QZ_NOT_INSTALLED", "QZ_NOT_RUNNING", "QZ_CONNECTION_FAILED", "PRINTER_DISCOVERY_FAILED", "QZ_CSP_BLOCKED", "LOCAL_NETWORK_PERMISSION_DENIED", "CERTIFICATE_REJECTED", "SIGNATURE_FAILED", "SIGNING_PAYLOAD_TOO_LARGE"]);
const SAFE_BROWSER_ERRORS = new Set<DirectPrintErrorCode>([...QZ_ERRORS, "DOCUMENT_GENERATION_FAILED", "INVALID_PDF", "PRINT_FAILED", "PRINT_TIMEOUT"]);

export function resolveDirectPrintFailureAction(code: DirectPrintErrorCode, browserFallbackAvailable: boolean, browserFallbackEnabled: boolean): DirectPrintFailureAction {
  if (code === "PRINT_STATUS_UNKNOWN" || code === "DUPLICATE_PRINT") return "NONE";
  if (SETTINGS_ERRORS.has(code)) return "OPEN_SETTINGS";
  if (browserFallbackAvailable && browserFallbackEnabled && SAFE_BROWSER_ERRORS.has(code)) return "BROWSER_PRINT";
  if (QZ_ERRORS.has(code)) return "OPEN_SETTINGS";
  return "NONE";
}
