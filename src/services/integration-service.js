import crypto from "crypto";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";

function normalizePositiveInteger(value, fieldName, { required = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new HttpError(400, `${fieldName} is required.`);
    }

    return null;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, `${fieldName} must be a positive whole number.`);
  }

  return parsed;
}

async function loadSettingsMap(categories) {
  const { rows } = await pool.query(
    `
      select category, setting_key, setting_value
      from system_settings
      where category = any($1::text[])
    `,
    [categories]
  );

  return rows.reduce((accumulator, row) => {
    if (!accumulator[row.category]) {
      accumulator[row.category] = {};
    }

    accumulator[row.category][row.setting_key] = row.setting_value?.value ?? "";
    return accumulator;
  }, {});
}

function parseEnabled(value) {
  return String(value || "").trim() === "enabled";
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function getAppointmentSummary(appointmentId) {
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

  if (!rows[0]) {
    throw new HttpError(404, "Appointment not found.");
  }

  return rows[0];
}

export async function getIntegrationStatus() {
  const settings = await loadSettingsMap(["printing_and_labels", "documents_and_uploads"]);
  const printSettings = settings.printing_and_labels || {};
  const documentSettings = settings.documents_and_uploads || {};
  const rawScannerMode = documentSettings.scanner_bridge_mode || "";
  const scannerBridgeMode = rawScannerMode === "future_local_bridge" ? "manual_browser_upload" : rawScannerMode || "manual_browser_upload";

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
    }
  };
}

export async function preparePrintJob(payload, currentUserId) {
  const appointment = await getAppointmentSummary(payload.appointmentId);
  const outputType = String(payload.outputType || "").trim();

  if (!["slip", "label"].includes(outputType)) {
    throw new HttpError(400, "outputType must be slip or label.");
  }

  const status = await getIntegrationStatus();
  const printerProfile =
    outputType === "label" ? status.printer.labelPrinterProfile : status.printer.slipPrinterProfile;
  const mode =
    outputType === "label" ? status.printer.labelOutputMode || "browser_print" : "browser_print";

  const preparation = {
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

export async function prepareScanSession(payload, currentUserId) {
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

  const preparation = {
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
