import crypto from "crypto";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { requireRow } from "../utils/records.js";
import { normalizePositiveInteger } from "../utils/normalize.js";
import { logAuditEntry } from "./audit-service.js";
import { getDicomGatewayOverview } from "./dicom-service.js";
import { loadSettingsMap } from "./settings-service.js";
import type { OptionalUserId, UserId } from "../types/http.js";

interface AppointmentSummaryRow {
  id: number;
  patient_id: number;
  accession_number: string;
  appointment_date: string;
  arabic_full_name: string;
  english_full_name: string;
}

interface PrintPreparePayload {
  appointmentId?: UserId;
  outputType?: "slip" | "label" | string;
}

interface ScanPreparePayload {
  appointmentId?: UserId;
  patientId?: UserId;
  documentType?: string;
}

interface IntegrationStatus {
  printer: {
    appointmentSlipEnabled: boolean;
    patientLabelEnabled: boolean;
    barcodeValueSource: string;
    labelPrinterProfile: string;
    slipPrinterProfile: string;
    labelOutputMode: string;
    directPrintBridgeMode: string;
    browserPrintAvailable: boolean;
    directLabelPrintReady: boolean;
  };
  scanner: {
    referralUploadEnabled: boolean;
    allowedFileTypes: string[];
    documentLinkScope: string;
    scannerBridgeMode: string;
    scannerProfileName: string;
    scannerSource: string;
    scanDpi: string;
    scanColorMode: string;
    scanFileFormat: string;
    bridgeReady: boolean;
  };
  dicomGateway: {
    enabled: boolean;
    mwlAeTitle: string;
    mwlPort: number;
    mppsAeTitle: string;
    mppsPort: number;
    deviceCount: number;
    processedMessageCount: number;
    failedMessageCount: number;
  };
}

interface PrintPreparation {
  outputType: string;
  mode: string;
  printerProfile: string;
  appointmentId: number;
  accessionNumber: string;
  patientId: number;
  patientName: string;
  guidance: string;
}

interface ScanPreparation {
  sessionCode: string;
  mode: string;
  appointmentId: number | null;
  patientId: number | null;
  accessionNumber: string | null;
  documentType: string;
  scannerProfileName: string;
  scannerSource: string;
  scanDpi: string;
  scanColorMode: string;
  scanFileFormat: string;
  allowedFileTypes: string[];
  suggestedFileName: string;
  guidance: string;
}

function parseEnabled(value: unknown): boolean {
  return String(value || "").trim() === "enabled";
}

function parseCsvList(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function getAppointmentSummary(appointmentId: UserId): Promise<AppointmentSummaryRow> {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const { rows } = await pool.query(
    `
      select
        appointments.id,
        appointments.patient_id,
        appointments.accession_number,
        appointments.appointment_date,
        patients.arabic_full_name,
        patients.english_full_name
      from appointments
      join patients on patients.id = appointments.patient_id
      where appointments.id = $1
      limit 1
    `,
    [cleanAppointmentId]
  );

  const appointment = (rows[0] as AppointmentSummaryRow | undefined);

  if (!appointment) {
    throw new HttpError(404, "Appointment not found.");
  }

  return requireRow(appointment, "Failed to load appointment summary.");
}

export async function getIntegrationStatus(): Promise<IntegrationStatus> {
  const settings = await loadSettingsMap(["printing_and_labels", "documents_and_uploads"]);
  const printSettings = settings.printing_and_labels || {};
  const documentSettings = settings.documents_and_uploads || {};
  const rawScannerMode = documentSettings.scanner_bridge_mode || "";
  const scannerBridgeMode = rawScannerMode === "future_local_bridge" ? "manual_browser_upload" : rawScannerMode || "manual_browser_upload";
  const dicomGateway = await getDicomGatewayOverview();

  return {
    printer: {
      appointmentSlipEnabled: parseEnabled(printSettings.appointment_slip),
      patientLabelEnabled: parseEnabled(printSettings.patient_label),
      barcodeValueSource: printSettings.barcode_value_source || "accession_number",
      labelPrinterProfile: printSettings.label_printer_profile || "customize_later",
      slipPrinterProfile: printSettings.slip_printer_profile || "browser_default",
      labelOutputMode: printSettings.label_output_mode || "browser_print",
      directPrintBridgeMode: printSettings.direct_print_bridge_mode || "disabled",
      browserPrintAvailable: true,
      directLabelPrintReady: String(printSettings.direct_print_bridge_mode || "disabled") === "local_bridge_ready"
    },
    scanner: {
      referralUploadEnabled: parseEnabled(documentSettings.referral_upload),
      allowedFileTypes: parseCsvList(documentSettings.allowed_file_types || "pdf,jpg,png"),
      documentLinkScope: documentSettings.document_link_scope || "patient_and_appointment",
      scannerBridgeMode,
      scannerProfileName: documentSettings.scanner_profile_name || "default_twain_profile",
      scannerSource: documentSettings.scanner_source || "feeder",
      scanDpi: documentSettings.scan_dpi || "300",
      scanColorMode: documentSettings.scan_color_mode || "grayscale",
      scanFileFormat: documentSettings.scan_file_format || "pdf",
      bridgeReady: String(scannerBridgeMode || "") === "local_bridge_ready"
    },
    dicomGateway: {
      enabled: Boolean(dicomGateway.settings.enabled),
      mwlAeTitle: String(dicomGateway.settings.mwlAeTitle || ""),
      mwlPort: Number(dicomGateway.settings.mwlPort || 0),
      mppsAeTitle: String(dicomGateway.settings.mppsAeTitle || ""),
      mppsPort: Number(dicomGateway.settings.mppsPort || 0),
      deviceCount: dicomGateway.devices.length,
      processedMessageCount: Number(dicomGateway.logSummary.processed_count || 0),
      failedMessageCount: Number(dicomGateway.logSummary.failed_count || 0)
    }
  };
}

export async function preparePrintJob(payload: PrintPreparePayload, currentUserId: OptionalUserId): Promise<PrintPreparation> {
  const appointment = await getAppointmentSummary(payload.appointmentId || "");
  const outputType = String(payload.outputType || "").trim();

  if (!["slip", "label"].includes(outputType)) {
    throw new HttpError(400, "outputType must be slip or label.");
  }

  const status = await getIntegrationStatus();
  const printerProfile =
    outputType === "label" ? status.printer.labelPrinterProfile : status.printer.slipPrinterProfile;
  const mode =
    outputType === "label" ? status.printer.labelOutputMode || "browser_print" : "browser_print";

  const preparation: PrintPreparation = {
    outputType,
    mode,
    printerProfile,
    appointmentId: appointment.id,
    accessionNumber: appointment.accession_number,
    patientId: appointment.patient_id,
    patientName: appointment.english_full_name || appointment.arabic_full_name,
    guidance:
      mode === "browser_print"
        ? "Ready to print through the browser print dialog."
        : "Ready to send to the connected printer bridge profile."
  };

  await logAuditEntry({
    entityType: "integration",
    entityId: appointment.id,
    actionType: "prepare_print",
    oldValues: null,
    newValues: preparation,
    changedByUserId: currentUserId
  });

  return preparation;
}

export async function prepareScanSession(payload: ScanPreparePayload, currentUserId: OptionalUserId): Promise<ScanPreparation> {
  const documentType = String(payload.documentType || "referral_request").trim() || "referral_request";
  const appointment = payload.appointmentId ? await getAppointmentSummary(payload.appointmentId) : null;
  const patientId =
    appointment?.patient_id || normalizePositiveInteger(payload.patientId, "patientId", { required: false });

  if (!appointment && !patientId) {
    throw new HttpError(400, "appointmentId or patientId is required.");
  }

  const status = await getIntegrationStatus();
  const sessionCode = `SCAN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const suggestedFileName = appointment
    ? `${appointment.accession_number}-${documentType}.${status.scanner.scanFileFormat}`
    : `${sessionCode}-${documentType}.${status.scanner.scanFileFormat}`;
  const mode = status.scanner.bridgeReady ? "local_bridge_ready" : "manual_browser_upload";

  const preparation: ScanPreparation = {
    sessionCode,
    mode,
    appointmentId: appointment?.id || null,
    patientId: patientId || null,
    accessionNumber: appointment?.accession_number || null,
    documentType,
    scannerProfileName: status.scanner.scannerProfileName,
    scannerSource: status.scanner.scannerSource,
    scanDpi: status.scanner.scanDpi,
    scanColorMode: status.scanner.scanColorMode,
    scanFileFormat: status.scanner.scanFileFormat,
    allowedFileTypes: status.scanner.allowedFileTypes,
    suggestedFileName,
    guidance:
      mode === "local_bridge_ready"
        ? "Scanner bridge is ready for this workstation session."
        : "Upload the scanned file in this session to attach it immediately."
  };

  await logAuditEntry({
    entityType: "integration",
    entityId: appointment?.id || patientId,
    actionType: "prepare_scan",
    oldValues: null,
    newValues: preparation,
    changedByUserId: currentUserId
  });

  return preparation;
}
