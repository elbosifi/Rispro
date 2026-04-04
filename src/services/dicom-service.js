// @ts-check

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeDateValue } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import {
  APPOINTMENT_ACTIVE_WORKLIST_STATUSES,
  APPOINTMENT_STATUS_ARRIVED,
  APPOINTMENT_STATUS_COMPLETED,
  APPOINTMENT_STATUS_DISCONTINUED,
  APPOINTMENT_STATUS_IN_PROGRESS,
  APPOINTMENT_STATUS_WAITING
} from "../constants/appointment-statuses.js";

/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */
/** @typedef {import("../types/settings.js").CategorySettings} CategorySettings */
/** @typedef {import("../types/settings.js").SettingsMap} SettingsMap */
/** @typedef {import("../types/http.js").UserId} UserId */
/** @typedef {import("../types/db.js").DbNumeric} DbNumeric */
/** @typedef {import("../types/domain.js").AppointmentStatus} AppointmentStatus */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

const ACTIVE_WORKLIST_STATUSES = new Set(APPOINTMENT_ACTIVE_WORKLIST_STATUSES);
const MPPS_STATUSES = new Set(["IN PROGRESS", "COMPLETED", "DISCONTINUED"]);

/**
 * @typedef DicomSettingRow
 * @property {string} category
 * @property {string} setting_key
 * @property {{ value?: unknown } | null} [setting_value]
 */

/**
 * @typedef GatewaySettingsMap
 * @property {CategorySettings} [dicom_gateway]
 * @property {CategorySettings} [pacs_connection]
 */

/**
 * @typedef DicomDeviceRow
 * @property {number} id
 * @property {number} modality_id
 * @property {string} device_name
 * @property {string} modality_ae_title
 * @property {string} scheduled_station_ae_title
 * @property {string} station_name
 * @property {string} station_location
 * @property {string | null} source_ip
 */

/**
 * @typedef DicomDeviceListRow
 * @property {number} id
 * @property {number} modality_id
 * @property {string} device_name
 * @property {string} modality_ae_title
 * @property {string} scheduled_station_ae_title
 * @property {string | null} station_name
 * @property {string | null} station_location
 * @property {string | null} source_ip
 * @property {boolean} mwl_enabled
 * @property {boolean} mpps_enabled
 * @property {boolean} is_active
 * @property {string} modality_code
 * @property {string} modality_name_ar
 * @property {string} modality_name_en
 */

/**
 * @typedef WorklistAppointmentRow
 * @property {number} id
 * @property {number} patient_id
 * @property {number} modality_id
 * @property {string} accession_number
 * @property {string} appointment_date
 * @property {AppointmentStatus} status
 * @property {string | null} exam_name_ar
 * @property {string | null} exam_name_en
 * @property {string} modality_name_ar
 * @property {string} modality_name_en
 * @property {string} modality_code
 * @property {string | null} mrn
 * @property {string | null} national_id
 * @property {string} arabic_full_name
 * @property {string | null} english_full_name
 * @property {string | null} estimated_date_of_birth
 * @property {string | null} sex
 */

/**
 * @typedef MppsAppointmentRow
 * @property {number} id
 * @property {AppointmentStatus} status
 * @property {string | null} completed_at
 * @property {string | null} mpps_sop_instance_uid
 */

/**
 * @typedef DicomMessageLogRow
 * @property {number} id
 * @property {string} processing_status
 * @property {number | null} appointment_id
 * @property {number | null} device_id
 */

/**
 * @typedef DicomLogSummaryRow
 * @property {DbNumeric} processed_count
 * @property {DbNumeric} failed_count
 * @property {DbNumeric} total_count
 */

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

function normalizeOptionalText(value) {
  return String(value || "").trim();
}

function normalizeBooleanFlag(value, fieldName) {
  const raw = String(value || "").trim().toLowerCase();

  if (!raw) {
    return false;
  }

  if (["true", "1", "yes", "enabled", "on"].includes(raw)) {
    return true;
  }

  if (["false", "0", "no", "disabled", "off"].includes(raw)) {
    return false;
  }

  throw new HttpError(400, `${fieldName} must be enabled or disabled.`);
}

function normalizeIpAddress(value, fieldName) {
  const raw = normalizeOptionalText(value);

  if (!raw) {
    return null;
  }

  if (/^[\d.:a-fA-F]+$/.test(raw)) {
    return raw;
  }

  throw new HttpError(400, `${fieldName} must be a valid IP address format.`);
}

function normalizeDateForDicom(value) {
  const cleanValue = normalizeDateValue(value);
  return cleanValue ? cleanValue.replaceAll("-", "") : "";
}

function normalizeTimeForDicom(value, fallback = "080000") {
  const raw = String(value || "").trim();

  if (!raw) {
    return fallback;
  }

  if (/^\d{6}(\.\d+)?$/.test(raw)) {
    return raw;
  }

  const match = raw.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return `${match[1]}${match[2]}${match[3] || "00"}`;
  }

  return fallback;
}

function normalizeSexForDicom(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (["M", "F", "O"].includes(raw)) {
    return raw;
  }

  const fallbackMap = {
    male: "M",
    female: "F",
    other: "O"
  };

  return fallbackMap[raw.toLowerCase()] || "";
}

function normalizeQrOrAccession(scanValue) {
  const raw = String(scanValue || "").trim();

  if (!raw) {
    throw new HttpError(400, "scanValue is required.");
  }

  const directMatch = raw.match(/\b\d{8}-\d{3,}\b/);
  if (directMatch) {
    return directMatch[0];
  }

  try {
    const url = new URL(raw);
    const candidate =
      url.searchParams.get("accession") ||
      url.searchParams.get("accessionNumber") ||
      url.searchParams.get("acc") ||
      "";
    const candidateMatch = candidate.match(/\b\d{8}-\d{3,}\b/);
    if (candidateMatch) {
      return candidateMatch[0];
    }
  } catch {
    // Not a URL, continue to fallback parsing.
  }

  const kvMatch = raw.match(/(?:accession|accessionNumber|acc)\s*[:=]\s*(\d{8}-\d{3,})/i);
  if (kvMatch) {
    return kvMatch[1];
  }

  throw new HttpError(400, "scanValue must contain a valid accession number.");
}

function toAbsolutePath(value, fallback) {
  const raw = normalizeOptionalText(value) || fallback;

  if (path.isAbsolute(raw)) {
    return raw;
  }

  return path.join(rootDir, raw);
}

function sanitizeFileToken(value, fallback = "unknown") {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function formatDicomPersonName(englishName, arabicName) {
  const primary = normalizeOptionalText(englishName) || normalizeOptionalText(arabicName);

  if (!primary) {
    return "UNKNOWN^PATIENT";
  }

  return primary.replace(/\s+/g, "^");
}

function formatDicomString(value, fallback = "") {
  return normalizeOptionalText(value || fallback).replaceAll("\\", "/");
}

function quoteDicomValue(value) {
  return `[${String(value ?? "").replaceAll("]", "\\]")}]`;
}

function buildSequenceDump(tag, lines) {
  return [
    `${tag} SQ (Sequence with undefined length)`,
    "(fffe,e000) na (Item with undefined length)",
    ...lines.map((line) => `  ${line}`),
    "(fffe,e00d) na (ItemDelimitationItem)",
    "(fffe,e0dd) na (SequenceDelimitationItem)"
  ];
}

function mapAppointmentToScheduledProcedureStepStatus(status) {
  if (status === APPOINTMENT_STATUS_ARRIVED || status === APPOINTMENT_STATUS_WAITING) {
    return "ARRIVED";
  }

  if (status === APPOINTMENT_STATUS_IN_PROGRESS) {
    return "STARTED";
  }

  return "SCHEDULED";
}

function parseDicomTimestamp(dateValue, timeValue) {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();

  if (!/^\d{8}$/.test(date)) {
    return null;
  }

  const normalizedTime = time.match(/^(\d{2})(\d{2})(\d{2})?/)
    ? `${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6) || "00"}`
    : "00:00:00";

  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${normalizedTime}`;
}

/**
 * @template T
 * @param {T | undefined} row
 * @param {string} message
 * @returns {T}
 */
function requireRow(row, message) {
  if (!row) {
    throw new HttpError(500, message);
  }

  return row;
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

  const settingRows = /** @type {DicomSettingRow[]} */ (rows);

  return settingRows.reduce((accumulator, row) => {
    if (!accumulator[row.category]) {
      accumulator[row.category] = /** @type {CategorySettings} */ ({});
    }

    accumulator[row.category][row.setting_key] = String(row.setting_value?.value ?? "");
    return accumulator;
  }, /** @type {SettingsMap} */ ({}));
}

async function listDevicesForModality(client, modalityId) {
  const { rows } = await client.query(
    `
      select *
      from dicom_devices
      where modality_id = $1
        and is_active = true
        and mwl_enabled = true
      order by scheduled_station_ae_title asc, modality_ae_title asc
    `,
    [modalityId]
  );

  return /** @type {DicomDeviceRow[]} */ (rows);
}

async function getAppointmentWorklistContext(client, appointmentId) {
  const cleanAppointmentId = normalizePositiveInteger(appointmentId, "appointmentId");
  const { rows } = await client.query(
    `
      select
        appointments.id,
        appointments.patient_id,
        appointments.modality_id,
        appointments.exam_type_id,
        appointments.reporting_priority_id,
        appointments.accession_number,
        appointments.appointment_date,
        appointments.status,
        appointments.notes,
        appointments.arrived_at,
        appointments.scan_started_at,
        appointments.scan_finished_at,
        appointments.cancel_reason,
        appointments.no_show_reason,
        appointments.scheduled_station_ae_title,
        appointments.created_at,
        modalities.code as modality_code,
        modalities.name_ar as modality_name_ar,
        modalities.name_en as modality_name_en,
        exam_types.name_ar as exam_name_ar,
        exam_types.name_en as exam_name_en,
        patients.mrn,
        patients.national_id,
        patients.arabic_full_name,
        patients.english_full_name,
        patients.estimated_date_of_birth,
        patients.sex
      from appointments
      join modalities on modalities.id = appointments.modality_id
      join patients on patients.id = appointments.patient_id
      left join exam_types on exam_types.id = appointments.exam_type_id
      where appointments.id = $1
      limit 1
    `,
    [cleanAppointmentId]
  );

  return /** @type {WorklistAppointmentRow | null} */ (rows[0] || null);
}

async function removeMatchingFiles(directory, prefix) {
  try {
    const files = await fs.readdir(directory);
    await Promise.all(
      files
        .filter((file) => file.startsWith(prefix))
        .map((file) => fs.rm(path.join(directory, file), { force: true }))
    );
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

function buildWorklistDump({ appointment, device }) {
  const startDate = normalizeDateForDicom(appointment.appointment_date);
  const startTime = normalizeTimeForDicom("", "080000");
  const patientName = formatDicomPersonName(appointment.english_full_name, appointment.arabic_full_name);
  const requestedProcedureDescription =
    formatDicomString(appointment.exam_name_en, appointment.exam_name_ar) ||
    formatDicomString(appointment.modality_name_en, appointment.modality_name_ar) ||
    "Scheduled study";
  const requestedProcedureId = appointment.accession_number;
  const scheduledProcedureStepId = `${appointment.accession_number}-${sanitizeFileToken(device.scheduled_station_ae_title)}`;
  const scheduledStatus = mapAppointmentToScheduledProcedureStepStatus(appointment.status);

  const scheduledProcedureStepSequence = buildSequenceDump("(0040,0100)", [
    `(0008,0060) CS ${quoteDicomValue(appointment.modality_code || "")}`,
    `(0040,0001) AE ${quoteDicomValue(device.scheduled_station_ae_title)}`,
    `(0040,0002) DA ${quoteDicomValue(startDate)}`,
    `(0040,0003) TM ${quoteDicomValue(startTime)}`,
    `(0040,0006) PN ${quoteDicomValue("")}`,
    `(0040,0007) LO ${quoteDicomValue(scheduledProcedureStepDescription(appointment))}`,
    `(0040,0009) SH ${quoteDicomValue(scheduledProcedureStepId)}`,
    `(0040,0010) SH ${quoteDicomValue(formatDicomString(device.station_name))}`,
    `(0040,0011) SH ${quoteDicomValue(formatDicomString(device.station_location))}`,
    `(0040,0020) CS ${quoteDicomValue(scheduledStatus)}`
  ]);

  return [
    "# RISpro generated Modality Worklist source file",
    `(0008,0005) CS ${quoteDicomValue("ISO_IR 192")}`,
    `(0008,0050) SH ${quoteDicomValue(appointment.accession_number)}`,
    `(0008,0090) PN ${quoteDicomValue("")}`,
    `(0010,0010) PN ${quoteDicomValue(patientName)}`,
    `(0010,0020) LO ${quoteDicomValue(appointment.mrn || appointment.national_id || appointment.patient_id)}`,
    `(0010,0021) LO ${quoteDicomValue(appointment.mrn || "")}`,
    `(0010,0030) DA ${quoteDicomValue(normalizeDateForDicom(appointment.estimated_date_of_birth))}`,
    `(0010,0040) CS ${quoteDicomValue(normalizeSexForDicom(appointment.sex))}`,
    `(0032,1032) PN ${quoteDicomValue("")}`,
    `(0032,1060) LO ${quoteDicomValue(requestedProcedureDescription)}`,
    `(0040,1001) SH ${quoteDicomValue(requestedProcedureId)}`,
    `(0040,1003) SH ${quoteDicomValue(appointment.accession_number)}`,
    `(0040,1004) LO ${quoteDicomValue(requestedProcedureDescription)}`,
    ...scheduledProcedureStepSequence
  ].join("\n");
}

function scheduledProcedureStepDescription(appointment) {
  return (
    formatDicomString(appointment.exam_name_en, appointment.exam_name_ar) ||
    formatDicomString(appointment.modality_name_en, appointment.modality_name_ar) ||
    "Scheduled procedure step"
  );
}

function buildWorklistManifest({ appointment, device }) {
  return {
    appointmentId: appointment.id,
    accessionNumber: appointment.accession_number,
    modalityId: appointment.modality_id,
    modalityCode: appointment.modality_code,
    patientId: appointment.patient_id,
    patientMrn: appointment.mrn,
    patientNationalId: appointment.national_id,
    patientNameEnglish: appointment.english_full_name,
    patientNameArabic: appointment.arabic_full_name,
    appointmentDate: normalizeDateValue(appointment.appointment_date),
    appointmentStatus: appointment.status,
    scheduledProcedureStepStatus: mapAppointmentToScheduledProcedureStepStatus(appointment.status),
    device: {
      id: device.id,
      name: device.device_name,
      modalityAeTitle: device.modality_ae_title,
      scheduledStationAeTitle: device.scheduled_station_ae_title,
      stationName: device.station_name,
      stationLocation: device.station_location,
      sourceIp: device.source_ip
    }
  };
}

/**
 * @param {WorklistAppointmentRow} appointment
 * @param {DicomDeviceRow[]} devices
 * @param {{ worklistSourceDir: string, worklistOutputDir: string }} gatewaySettings
 */
async function writeWorklistSourceFiles(appointment, devices, gatewaySettings) {
  const sourceDir = gatewaySettings.worklistSourceDir;
  const outputDir = gatewaySettings.worklistOutputDir;
  const sourcePrefix = `${sanitizeFileToken(appointment.accession_number)}--`;

  await ensureDicomGatewayLayout(gatewaySettings);
  await removeMatchingFiles(sourceDir, sourcePrefix);
  await removeMatchingFiles(outputDir, sourcePrefix);

  if (!ACTIVE_WORKLIST_STATUSES.has(appointment.status) || !devices.length) {
    return { files: [], removedOnly: true };
  }

  const writtenFiles = [];

  for (const device of devices) {
    const fileStem = `${sourcePrefix}${sanitizeFileToken(device.scheduled_station_ae_title)}`;
    const manifestPath = path.join(sourceDir, `${fileStem}.json`);
    const dumpPath = path.join(sourceDir, `${fileStem}.dump`);
    const manifest = buildWorklistManifest({ appointment, device });
    const dump = buildWorklistDump({ appointment, device });

    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    await fs.writeFile(dumpPath, `${dump}\n`, "utf8");
    writtenFiles.push({ manifestPath, dumpPath, deviceId: device.id });
  }

  return { files: writtenFiles, removedOnly: false };
}

/**
 * @param {import("pg").PoolClient} client
 * @param {number} appointmentId
 * @param {DicomDeviceRow[]} devices
 */
async function updateAppointmentStationAeTitle(client, appointmentId, devices) {
  const firstDevice = devices[0] || null;
  await client.query(
    `
      update appointments
      set
        scheduled_station_ae_title = $2,
        updated_at = now()
      where id = $1
    `,
    [appointmentId, firstDevice ? firstDevice.scheduled_station_ae_title : null]
  );
}

async function updateDicomMessageLog(client, logId, patch) {
  await client.query(
    `
      update dicom_message_log
      set
        processing_status = $2,
        error_message = $3,
        device_id = coalesce($4, device_id),
        appointment_id = coalesce($5, appointment_id),
        processed_at = now()
      where id = $1
    `,
    [logId, patch.processingStatus, patch.errorMessage || null, patch.deviceId || null, patch.appointmentId || null]
  );
}

async function findDicomDevice(client, { remoteAeTitle, performedStationAeTitle, sourceIp }) {
  const aeCandidates = [performedStationAeTitle, remoteAeTitle]
    .map((value) => normalizeOptionalText(value).toUpperCase())
    .filter(Boolean);

  if (!aeCandidates.length) {
    return null;
  }

  const { rows } = await client.query(
    `
      select *
      from dicom_devices
      where is_active = true
        and mpps_enabled = true
        and (
          upper(modality_ae_title) = any($1::text[])
          or upper(scheduled_station_ae_title) = any($1::text[])
        )
      order by case when source_ip is not null then 0 else 1 end asc, id asc
    `,
    [aeCandidates]
  );

  const devices = /** @type {DicomDeviceRow[]} */ (rows);

  if (!sourceIp) {
    return devices[0] || null;
  }

  return devices.find((row) => !row.source_ip || row.source_ip === sourceIp) || null;
}

async function findAppointmentForMpps(client, { accessionNumber, mppsSopInstanceUid }) {
  if (normalizeOptionalText(accessionNumber)) {
    const { rows } = await client.query(
      `
        select *
        from appointments
        where accession_number = $1
        limit 1
      `,
      [normalizeOptionalText(accessionNumber)]
    );

    const appointmentByAccession = /** @type {MppsAppointmentRow | undefined} */ (rows[0]);
    if (appointmentByAccession) {
      return appointmentByAccession;
    }
  }

  if (normalizeOptionalText(mppsSopInstanceUid)) {
    const { rows } = await client.query(
      `
        select *
        from appointments
        where mpps_sop_instance_uid = $1
        limit 1
      `,
      [normalizeOptionalText(mppsSopInstanceUid)]
    );

    return /** @type {MppsAppointmentRow | null} */ (rows[0] || null);
  }

  return null;
}

async function updateAppointmentFromMpps(client, appointment, device, payload) {
  const mppsStatus = String(payload.mppsStatus || "").trim().toUpperCase();
  const nowIso = new Date().toISOString();
  const startedAt = payload.startedAt || nowIso;
  const finishedAt = payload.finishedAt || nowIso;

  if (mppsStatus === "IN PROGRESS") {
    const currentStatus = appointment.status;
    const nextStatus = currentStatus === APPOINTMENT_STATUS_COMPLETED ? APPOINTMENT_STATUS_COMPLETED : APPOINTMENT_STATUS_IN_PROGRESS;
    const { rows } = await client.query(
      `
        update appointments
        set
          status = $2,
          scan_started_at = coalesce(scan_started_at, $3::timestamptz),
          scheduled_station_ae_title = coalesce(nullif(scheduled_station_ae_title, ''), $4),
          mpps_sop_instance_uid = coalesce(nullif(mpps_sop_instance_uid, ''), $5),
          updated_at = now()
        where id = $1
        returning *
      `,
      [appointment.id, nextStatus, startedAt, device?.scheduled_station_ae_title || null, payload.mppsSopInstanceUid || null]
    );

    await client.query(
      `
        update queue_entries
        set queue_status = 'in-progress', updated_at = now()
        where appointment_id = $1
          and queue_status <> 'removed'
      `,
      [appointment.id]
    );

    if (currentStatus !== nextStatus) {
      await client.query(
        `
          insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
          values ($1, $2, $3, null, $4)
        `,
        [appointment.id, currentStatus, nextStatus, "MPPS IN PROGRESS received from modality"]
      );
    }

    await logAuditEntry(
      {
        entityType: "integration",
        entityId: appointment.id,
        actionType: "mpps_start",
        oldValues: appointment,
        newValues: {
          appointment_status: nextStatus,
          mpps_status: mppsStatus,
          mpps_sop_instance_uid: payload.mppsSopInstanceUid || null
        },
        changedByUserId: null
      },
      client
    );

    return requireRow(/** @type {MppsAppointmentRow | undefined} */ (rows[0]), "Failed to update appointment from MPPS.");
  }

  const nextStatus = mppsStatus === "COMPLETED" ? APPOINTMENT_STATUS_COMPLETED : APPOINTMENT_STATUS_DISCONTINUED;
  const completedAt = mppsStatus === "COMPLETED" ? finishedAt : appointment.completed_at;

  const { rows } = await client.query(
    `
      update appointments
      set
        status = $2,
        completed_at = case when $2 = 'completed' then coalesce(completed_at, $3::timestamptz) else completed_at end,
        scan_finished_at = coalesce(scan_finished_at, $4::timestamptz),
        scheduled_station_ae_title = coalesce(nullif(scheduled_station_ae_title, ''), $5),
        mpps_sop_instance_uid = coalesce(nullif(mpps_sop_instance_uid, ''), $6),
        updated_at = now()
      where id = $1
      returning *
    `,
    [
      appointment.id,
      nextStatus,
      completedAt || nowIso,
      finishedAt,
      device?.scheduled_station_ae_title || null,
      payload.mppsSopInstanceUid || null
    ]
  );

  await client.query(
    `
      update queue_entries
      set queue_status = 'removed', updated_at = now()
      where appointment_id = $1
    `,
    [appointment.id]
  );

  const currentStatus = String(appointment.status || "");

  if (currentStatus !== nextStatus) {
    await client.query(
      `
        insert into appointment_status_history (appointment_id, old_status, new_status, changed_by_user_id, reason)
        values ($1, $2, $3, null, $4)
      `,
      [appointment.id, currentStatus, nextStatus, `MPPS ${mppsStatus} received from modality`]
    );
  }

  await logAuditEntry(
    {
      entityType: "integration",
      entityId: appointment.id,
      actionType: mppsStatus === "COMPLETED" ? "mpps_complete" : "mpps_discontinue",
      oldValues: appointment,
      newValues: {
        appointment_status: nextStatus,
        mpps_status: mppsStatus,
        mpps_sop_instance_uid: payload.mppsSopInstanceUid || null
      },
      changedByUserId: null
    },
    client
  );

  return requireRow(/** @type {MppsAppointmentRow | undefined} */ (rows[0]), "Failed to update appointment timing.");
}

/** @returns {Promise<{ enabled: boolean, bindHost: string, mwlAeTitle: string, mwlPort: number, mppsAeTitle: string, mppsPort: number, worklistOutputDir: string, worklistSourceDir: string, mppsInboxDir: string, mppsProcessedDir: string, mppsFailedDir: string, callbackSecret: string, rebuildBehavior: string, dump2dcmCommand: string, dcmdumpCommand: string }>} */
export async function getDicomGatewaySettings() {
  const settings = await loadSettingsMap(["dicom_gateway"]);
  const gateway = settings.dicom_gateway || {};

  return {
    enabled: String(gateway.enabled || "enabled").trim() !== "disabled",
    bindHost: normalizeOptionalText(gateway.bind_host) || "0.0.0.0",
    mwlAeTitle: normalizeOptionalText(gateway.mwl_ae_title) || "RISPRO_MWL",
    mwlPort: Number(gateway.mwl_port || 11112) || 11112,
    mppsAeTitle: normalizeOptionalText(gateway.mpps_ae_title) || "RISPRO_MPPS",
    mppsPort: Number(gateway.mpps_port || 11113) || 11113,
    worklistOutputDir: toAbsolutePath(gateway.worklist_output_dir, "storage/dicom/worklists"),
    worklistSourceDir: toAbsolutePath(gateway.worklist_source_dir, "storage/dicom/worklist-source"),
    mppsInboxDir: toAbsolutePath(gateway.mpps_inbox_dir, "storage/dicom/mpps/inbox"),
    mppsProcessedDir: toAbsolutePath(gateway.mpps_processed_dir, "storage/dicom/mpps/processed"),
    mppsFailedDir: toAbsolutePath(gateway.mpps_failed_dir, "storage/dicom/mpps/failed"),
    callbackSecret: normalizeOptionalText(gateway.callback_secret || process.env.DICOM_CALLBACK_SECRET) || "change-me-dicom-callback",
    rebuildBehavior: normalizeOptionalText(gateway.rebuild_behavior) || "incremental_on_write",
    dump2dcmCommand: normalizeOptionalText(gateway.dump2dcm_command) || "dump2dcm",
    dcmdumpCommand: normalizeOptionalText(gateway.dcmdump_command) || "dcmdump"
  };
}

/** @returns {Promise<{ enabled: boolean, bindHost: string, mwlAeTitle: string, mwlPort: number, mppsAeTitle: string, mppsPort: number, worklistOutputDir: string, worklistSourceDir: string, mppsInboxDir: string, mppsProcessedDir: string, mppsFailedDir: string, callbackSecret: string, rebuildBehavior: string, dump2dcmCommand: string, dcmdumpCommand: string }>} */
export async function ensureDicomGatewayLayout(settings = null) {
  const gatewaySettings = settings || (await getDicomGatewaySettings());
  const directories = [
    gatewaySettings.worklistOutputDir,
    gatewaySettings.worklistSourceDir,
    gatewaySettings.mppsInboxDir,
    gatewaySettings.mppsProcessedDir,
    gatewaySettings.mppsFailedDir
  ];

  await Promise.all(directories.map((directory) => fs.mkdir(directory, { recursive: true })));
  return gatewaySettings;
}

/** @returns {Promise<DicomDeviceListRow[]>} */
export async function listDicomDevices({ includeInactive = false } = {}) {
  const params = [];
  let inactiveSql = "";

  if (!includeInactive) {
    params.push(true);
    inactiveSql = `where dicom_devices.is_active = $${params.length}`;
  }

  const { rows } = await pool.query(
    `
      select
        dicom_devices.*,
        modalities.code as modality_code,
        modalities.name_ar as modality_name_ar,
        modalities.name_en as modality_name_en
      from dicom_devices
      join modalities on modalities.id = dicom_devices.modality_id
      ${inactiveSql}
      order by modalities.name_en asc, dicom_devices.device_name asc
    `,
    params
  );

  return /** @type {DicomDeviceListRow[]} */ (rows);
}

/** @returns {Promise<DicomDeviceRow>} */
export async function createDicomDevice(payload, currentUserId) {
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId");
  const deviceName = normalizeOptionalText(payload.deviceName);
  const modalityAeTitle = normalizeOptionalText(payload.modalityAeTitle).toUpperCase();
  const scheduledStationAeTitle = normalizeOptionalText(payload.scheduledStationAeTitle).toUpperCase();
  const stationName = normalizeOptionalText(payload.stationName);
  const stationLocation = normalizeOptionalText(payload.stationLocation);
  const sourceIp = normalizeIpAddress(payload.sourceIp, "sourceIp");
  const mwlEnabled = normalizeBooleanFlag(payload.mwlEnabled ?? "enabled", "mwlEnabled");
  const mppsEnabled = normalizeBooleanFlag(payload.mppsEnabled ?? "enabled", "mppsEnabled");
  const isActive = normalizeBooleanFlag(payload.isActive ?? "enabled", "isActive");

  if (!deviceName) {
    throw new HttpError(400, "deviceName is required.");
  }

  if (!modalityAeTitle) {
    throw new HttpError(400, "modalityAeTitle is required.");
  }

  if (!scheduledStationAeTitle) {
    throw new HttpError(400, "scheduledStationAeTitle is required.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    const { rows } = await client.query(
      `
        insert into dicom_devices (
          modality_id,
          device_name,
          modality_ae_title,
          scheduled_station_ae_title,
          station_name,
          station_location,
          source_ip,
          mwl_enabled,
          mpps_enabled,
          is_active,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7, $8, $9, $10, $11, $11)
        returning *
      `,
      [
        modalityId,
        deviceName,
        modalityAeTitle,
        scheduledStationAeTitle,
        stationName,
        stationLocation,
        sourceIp,
        mwlEnabled,
        mppsEnabled,
        isActive,
        currentUserId
      ]
    );
    const createdDevice = requireRow(/** @type {DicomDeviceRow | undefined} */ (rows[0]), "Failed to create DICOM device.");

    await logAuditEntry(
      {
        entityType: "integration",
        entityId: createdDevice.id,
        actionType: "create_dicom_device",
        oldValues: null,
        newValues: createdDevice,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    scheduleWorklistRebuild();
    return createdDevice;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<DicomDeviceRow>} */
export async function updateDicomDevice(deviceId, payload, currentUserId) {
  const cleanDeviceId = normalizePositiveInteger(deviceId, "deviceId");
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId");
  const deviceName = normalizeOptionalText(payload.deviceName);
  const modalityAeTitle = normalizeOptionalText(payload.modalityAeTitle).toUpperCase();
  const scheduledStationAeTitle = normalizeOptionalText(payload.scheduledStationAeTitle).toUpperCase();
  const stationName = normalizeOptionalText(payload.stationName);
  const stationLocation = normalizeOptionalText(payload.stationLocation);
  const sourceIp = normalizeIpAddress(payload.sourceIp, "sourceIp");
  const mwlEnabled = normalizeBooleanFlag(payload.mwlEnabled ?? "enabled", "mwlEnabled");
  const mppsEnabled = normalizeBooleanFlag(payload.mppsEnabled ?? "enabled", "mppsEnabled");
  const isActive = normalizeBooleanFlag(payload.isActive ?? "enabled", "isActive");
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existingResult = await client.query(
      `
        select *
        from dicom_devices
        where id = $1
        limit 1
      `,
      [cleanDeviceId]
    );

    const existing = /** @type {DicomDeviceRow | undefined} */ (existingResult.rows[0]);

    if (!existing) {
      throw new HttpError(404, "DICOM device not found.");
    }

    const { rows } = await client.query(
      `
        update dicom_devices
        set
          modality_id = $2,
          device_name = $3,
          modality_ae_title = $4,
          scheduled_station_ae_title = $5,
          station_name = nullif($6, ''),
          station_location = nullif($7, ''),
          source_ip = $8,
          mwl_enabled = $9,
          mpps_enabled = $10,
          is_active = $11,
          updated_by_user_id = $12,
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        cleanDeviceId,
        modalityId,
        deviceName,
        modalityAeTitle,
        scheduledStationAeTitle,
        stationName,
        stationLocation,
        sourceIp,
        mwlEnabled,
        mppsEnabled,
        isActive,
        currentUserId
      ]
    );
    const updatedDevice = requireRow(/** @type {DicomDeviceRow | undefined} */ (rows[0]), "Failed to update DICOM device.");

    await logAuditEntry(
      {
        entityType: "integration",
        entityId: cleanDeviceId,
        actionType: "update_dicom_device",
        oldValues: existing,
        newValues: updatedDevice,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    scheduleWorklistRebuild();
    return updatedDevice;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<{ ok: true }>} */
export async function deleteDicomDevice(deviceId, currentUserId) {
  const cleanDeviceId = normalizePositiveInteger(deviceId, "deviceId");
  const client = await pool.connect();

  try {
    await client.query("begin");
    const existingResult = await client.query(
      `
        select *
        from dicom_devices
        where id = $1
        limit 1
      `,
      [cleanDeviceId]
    );
    const existing = /** @type {DicomDeviceRow | undefined} */ (existingResult.rows[0]);

    if (!existing) {
      throw new HttpError(404, "DICOM device not found.");
    }

    await client.query("delete from dicom_devices where id = $1", [cleanDeviceId]);

    await logAuditEntry(
      {
        entityType: "integration",
        entityId: cleanDeviceId,
        actionType: "delete_dicom_device",
        oldValues: existing,
        newValues: null,
        changedByUserId: currentUserId
      },
      client
    );

    await client.query("commit");
    scheduleWorklistRebuild();
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<UnknownRecord>} */
export async function syncAppointmentWorklistSources(appointmentId) {
  const gatewaySettings = await getDicomGatewaySettings();
  const client = await pool.connect();

  try {
    const appointment = await getAppointmentWorklistContext(client, appointmentId);

    if (!appointment) {
      return { ok: true, removedOnly: true };
    }

    const devices = await listDevicesForModality(client, appointment.modality_id);
    await updateAppointmentStationAeTitle(client, appointment.id, devices);
    const result = await writeWorklistSourceFiles(appointment, devices, gatewaySettings);
    return { ok: true, ...result };
  } finally {
    client.release();
  }
}

/** @returns {Promise<{ ok: true, count: number }>} */
export async function rebuildAllDicomWorklistSources() {
  const gatewaySettings = await getDicomGatewaySettings();
  const client = await pool.connect();

  try {
    await ensureDicomGatewayLayout(gatewaySettings);
    const { rows } = await client.query(
      `
        select id
        from appointments
        order by appointment_date asc, daily_sequence asc
      `
    );

    for (const row of rows) {
      await syncAppointmentWorklistSources(row.id);
    }

    return { ok: true, count: rows.length };
  } finally {
    client.release();
  }
}

/**
 * @param {UserId} appointmentId
 * @returns {void}
 */
export function scheduleWorklistSync(appointmentId) {
  Promise.resolve()
    .then(() => syncAppointmentWorklistSources(appointmentId))
    .catch((error) => {
      console.error(`Failed to sync DICOM worklist sources for appointment ${appointmentId}.`, error);
    });
}

/** @returns {void} */
export function scheduleWorklistRebuild() {
  Promise.resolve()
    .then(() => rebuildAllDicomWorklistSources())
    .catch((error) => {
      console.error("Failed to rebuild DICOM worklist sources.", error);
    });
}

/** @returns {Promise<string>} */
export async function resolveScanValueToAccession(scanValue, accessionNumber) {
  if (normalizeOptionalText(accessionNumber)) {
    return normalizeOptionalText(accessionNumber);
  }

  return normalizeQrOrAccession(scanValue);
}

/** @returns {Promise<{ ok: boolean, reason?: string, appointment?: MppsAppointmentRow }>} */
export async function ingestMppsEvent(payload) {
  const mppsStatus = String(payload?.mppsStatus || "").trim().toUpperCase();

  if (!MPPS_STATUSES.has(mppsStatus)) {
    throw new HttpError(400, "mppsStatus must be IN PROGRESS, COMPLETED, or DISCONTINUED.");
  }

  const client = await pool.connect();

  try {
    await client.query("begin");
    const { rows: logRows } = await client.query(
      `
        insert into dicom_message_log (
          source_type,
          source_path,
          event_type,
          source_ip,
          remote_ae_title,
          accession_number,
          mpps_sop_instance_uid,
          payload,
          processing_status
        )
        values ('mpps', $1, $2, $3, $4, $5, $6, $7::jsonb, 'received')
        returning *
      `,
      [
        normalizeOptionalText(payload.sourcePath),
        `mpps_${mppsStatus.toLowerCase().replaceAll(" ", "_")}`,
        normalizeOptionalText(payload.sourceIp),
        normalizeOptionalText(payload.remoteAeTitle).toUpperCase(),
        normalizeOptionalText(payload.accessionNumber),
        normalizeOptionalText(payload.mppsSopInstanceUid),
        JSON.stringify(payload || {})
      ]
    );

    const logEntry = /** @type {DicomMessageLogRow} */ (logRows[0]);
    const device = await findDicomDevice(client, {
      remoteAeTitle: payload.remoteAeTitle,
      performedStationAeTitle: payload.performedStationAeTitle,
      sourceIp: payload.sourceIp
    });

    if (!device) {
      await updateDicomMessageLog(client, logEntry.id, {
        processingStatus: "failed",
        errorMessage: "No active DICOM device mapping matched this MPPS event."
      });
      await client.query("commit");
      return { ok: false, reason: "device_not_found" };
    }

    const appointment = await findAppointmentForMpps(client, {
      accessionNumber: payload.accessionNumber,
      mppsSopInstanceUid: payload.mppsSopInstanceUid
    });

    if (!appointment) {
      await updateDicomMessageLog(client, logEntry.id, {
        processingStatus: "failed",
        deviceId: device.id,
        errorMessage: "No appointment matched the accession number or MPPS SOP Instance UID."
      });
      await client.query("commit");
      return { ok: false, reason: "appointment_not_found" };
    }

    const nextAppointment = await updateAppointmentFromMpps(client, appointment, device, {
      ...payload,
      mppsStatus
    });

    await updateDicomMessageLog(client, logEntry.id, {
      processingStatus: "processed",
      deviceId: device.id,
      appointmentId: appointment.id
    });

    await client.query("commit");
    scheduleWorklistSync(appointment.id);
    return { ok: true, appointment: nextAppointment };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** @returns {Promise<{ settings: UnknownRecord, devices: DicomDeviceListRow[], logSummary: DicomLogSummaryRow }>} */
export async function getDicomGatewayOverview() {
  const [settings, devices, logSummary] = await Promise.all([
    getDicomGatewaySettings(),
    listDicomDevices(),
    pool.query(
      `
        select
          count(*) filter (where processing_status = 'processed') as processed_count,
          count(*) filter (where processing_status = 'failed') as failed_count,
          count(*) as total_count
        from dicom_message_log
      `
    )
  ]);

  const summary = /** @type {DicomLogSummaryRow | undefined} */ (logSummary.rows[0]);

  return {
    settings,
    devices,
    logSummary: summary || {
      processed_count: 0,
      failed_count: 0,
      total_count: 0
    }
  };
}

/** @returns {string | null} */
export function parseMppsTimestamp(dateValue, timeValue) {
  return parseDicomTimestamp(dateValue, timeValue);
}

/** @returns {{ sourcePath: string, sourceIp: string, remoteAeTitle: string, performedStationAeTitle: string, accessionNumber: string, mppsSopInstanceUid: string, mppsStatus: string, startedAt: string | null, finishedAt: string | null, raw: UnknownRecord }} */
export function buildMppsEventPayload(input = {}) {
  return {
    sourcePath: normalizeOptionalText(input.sourcePath),
    sourceIp: normalizeOptionalText(input.sourceIp),
    remoteAeTitle: normalizeOptionalText(input.remoteAeTitle).toUpperCase(),
    performedStationAeTitle: normalizeOptionalText(input.performedStationAeTitle).toUpperCase(),
    accessionNumber: normalizeOptionalText(input.accessionNumber),
    mppsSopInstanceUid: normalizeOptionalText(input.mppsSopInstanceUid || input.sopInstanceUid),
    mppsStatus: String(input.mppsStatus || "").trim().toUpperCase(),
    startedAt:
      normalizeOptionalText(input.startedAt) || parseDicomTimestamp(input.startedDate, input.startedTime),
    finishedAt:
      normalizeOptionalText(input.finishedAt) || parseDicomTimestamp(input.finishedDate, input.finishedTime),
    raw: input.raw || {}
  };
}

/** @returns {string} */
export function createGatewayCallbackToken(secret) {
  return normalizeOptionalText(secret) || randomUUID();
}
