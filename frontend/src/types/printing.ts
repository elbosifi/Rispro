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
  enabled: boolean;
}

export interface QzPrinterSettings {
  version: 1;
  workstationId: string;
  browserPrintFallbackEnabled: boolean;
  profiles: PrinterProfile[];
  updatedAt: string;
}

export interface QzPrinterDetail {
  name: string;
  trays: string[];
  raw: Record<string, unknown>;
}

export interface DirectPrintRequest {
  documentType: PrinterDocumentType;
  documentId?: string;
  appointmentId?: string | number;
  accessionNumber?: string;
  copies?: number;
}

export type DirectPrintErrorCode =
  | "QZ_NOT_INSTALLED"
  | "QZ_CONNECTION_FAILED"
  | "PRINTER_NOT_CONFIGURED"
  | "PRINTER_NOT_FOUND"
  | "DOCUMENT_GENERATION_FAILED"
  | "PAGE_SIZE_MISMATCH"
  | "INVALID_PDF"
  | "DUPLICATE_PRINT"
  | "PRINT_TIMEOUT"
  | "CERTIFICATE_REJECTED"
  | "SIGNATURE_FAILED"
  | "PRINT_FAILED";

export type DirectPrintResult =
  | { success: true; printerName: string; jobName: string }
  | { success: false; errorCode: DirectPrintErrorCode; message: string };

