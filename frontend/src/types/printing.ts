export const PRINTER_DOCUMENT_TYPES = [
  "A4_DOCUMENT",
  "A5_DOCUMENT",
  "ACCESSION_LABEL",
  "RECEIPT",
] as const;

export type PrinterDocumentType = (typeof PRINTER_DOCUMENT_TYPES)[number];

export interface PrinterProfile {
  id: string;
  documentType: PrinterDocumentType;
  printerName: string;
  paperWidthMm: number;
  paperHeightMm: number;
  orientation: "portrait" | "landscape";
  copies: number;
  scaleContent: boolean;
  marginsMm?: { top: number; right: number; bottom: number; left: number };
  printerTray?: string;
  customPaperSize: boolean;
  rasterize: boolean;
  enabled: boolean;
}

export interface QzPrinterSettings {
  version: 1;
  workstationId: string;
  browserPrintFallbackEnabled: boolean;
  profiles: PrinterProfile[];
  updatedAt: string;
}

export interface DirectPrintRequest {
  documentType: PrinterDocumentType;
  documentId?: string;
  appointmentId?: string | number;
  accessionNumber?: string;
  copies?: number;
  appointmentSnapshot?: import("@/lib/mappers").AppointmentWithDetails;
}

export type DirectPrintErrorCode =
  | "QZ_NOT_INSTALLED"
  | "QZ_CONNECTION_FAILED"
  | "PRINTER_DISCOVERY_FAILED"
  | "QZ_NOT_RUNNING"
  | "QZ_CSP_BLOCKED"
  | "LOCAL_NETWORK_PERMISSION_DENIED"
  | "PRINTER_NOT_CONFIGURED"
  | "PRINTER_NOT_FOUND"
  | "PRINTER_SETTINGS_INVALID"
  | "DOCUMENT_GENERATION_FAILED"
  | "PAGE_SIZE_MISMATCH"
  | "INVALID_PDF"
  | "DUPLICATE_PRINT"
  | "PRINT_TIMEOUT"
  | "PRINT_STATUS_UNKNOWN"
  | "CERTIFICATE_REJECTED"
  | "SIGNATURE_FAILED"
  | "SIGNING_PAYLOAD_TOO_LARGE"
  | "PRINT_FAILED";

export type DirectPrintResult =
  | { success: true; printerName: string; jobName: string }
  | { success: false; errorCode: DirectPrintErrorCode; message: string };

export type DirectPrintJobState = "preparing" | "submitting" | "submitted" | "failed" | "status_unknown";
