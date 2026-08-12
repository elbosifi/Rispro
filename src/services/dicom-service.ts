import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { requireRow } from "../utils/records.js";
import { normalizePositiveInteger, normalizeOptionalText } from "../utils/normalize.js";
import { normalizeDateValue } from "../utils/date.js";
import { logAuditEntry } from "./audit-service.js";
import type { UserId, UnknownRecord } from "../types/http.js";
import type { DbNumeric } from "../types/db.js";
import type { CategorySettings } from "../types/settings.js";
import {
  APPOINTMENT_STATUS_ARRIVED,
  APPOINTMENT_STATUS_WAITING
} from "../constants/appointment-statuses.js";
import { resolveGatewaySettings, ensureDicomDirectoriesExist } from "./dicom-settings-resolver.js";
import { enqueueOrthancSyncForBooking } from "./mwl-sync-service.js";
import { enqueueSanteHl7ForBooking, enqueueSanteHl7ReplacementForBooking } from "./sante-hl7-outbox-service.js";
import { buildCanonicalMwlDataset, renderCanonicalMwlToDump } from "./mwl-dataset-builder.js";
import { formatV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";
import {
  listActiveBookingsAffectedByMwlProtocolPolicy,
  resolveMwlEligibilityForBooking,
  resolveMwlEligibilityForBookings,
  type MwlEligibility,
} from "./mwl-eligibility-service.js";

const V2_ACTIVE_WORKLIST_STATUSES = new Set(["scheduled", "arrived", "waiting"]);

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export interface DicomSettingRow {
  category: string;
  setting_key: string;
  setting_value?: { value?: unknown } | null;
}

export interface GatewaySettingsRow {
  category: string;
  setting_key: string;
  setting_value?: { value?: unknown } | null;
}

export interface GatewaySettingsMap {
  dicom_gateway?: CategorySettings;
  pacs_connection?: CategorySettings;
}

export interface DicomDeviceRow {
  id: number;
  modality_id: number;
  device_name: string;
  modality_ae_title: string;
  scheduled_station_ae_title: string;
  station_name: string;
  station_location: string;
  source_ip: string | null;
}

export interface DicomDeviceListRow {
  id: number;
  modality_id: number;
  device_name: string;
  modality_ae_title: string;
  scheduled_station_ae_title: string;
  station_name: string | null;
  station_location: string | null;
  source_ip: string | null;
  mwl_enabled: boolean;
  is_active: boolean;
  modality_code: string;
  modality_name_ar: string;
  modality_name_en: string;
}

export interface WorklistAppointmentRow {
  id: number;
  patient_id: number;
  patient_primary_id: string | null;
  modality_id: number;
  accession_number: string;
  appointment_date: string;
  status: string;
  booking_time: string | null;
  scheduled_station_ae_title: string | null;
  exam_name_ar: string | null;
  exam_name_en: string | null;
  modality_name_ar: string;
  modality_name_en: string;
  modality_code: string;
  mrn: string | null;
  national_id: string | null;
  arabic_full_name: string;
  english_full_name: string | null;
  estimated_date_of_birth: string | null;
  sex: string | null;
}

export interface DicomMessageLogRow {
  id: number;
  source_type: string;
  source_path: string | null;
  event_type: string;
  source_ip: string | null;
  remote_ae_title: string | null;
  accession_number: string | null;
  payload: Record<string, unknown>;
  processing_status: string;
  appointment_id: number | null;
  device_id: number | null;
  error_message: string | null;
}

export interface DicomLogSummaryRow {
  processed_count: DbNumeric;
  failed_count: DbNumeric;
  total_count: DbNumeric;
}

export interface GatewaySettings {
  enabled: boolean;
  bindHost: string;
  mwlAeTitle: string;
  mwlPort: number;
  worklistOutputDir: string;
  worklistSourceDir: string;
  callbackSecret?: string;
  rebuildBehavior?: string;
  dump2dcmCommand?: string;
  dcmdumpCommand?: string;
}

export interface FindDicomDeviceParams {
  remoteAeTitle?: string;
  performedStationAeTitle?: string;
  sourceIp?: string;
}

export interface WorklistManifestFile {
  manifestPath: string;
  dumpPath: string;
  deviceId: number | null;
}

export interface WorklistSyncResult {
  files: WorklistManifestFile[];
  removedOnly: boolean;
  ok: boolean;
  reason?: string;
}

export interface DicomDeviceCreatePayload {
  modalityId?: unknown;
  deviceName?: unknown;
  modalityAeTitle?: unknown;
  scheduledStationAeTitle?: unknown;
  stationName?: unknown;
  stationLocation?: unknown;
  sourceIp?: unknown;
  mwlEnabled?: unknown;
  isActive?: unknown;
}

export interface DicomDeviceUpdatePayload {
  modalityId?: unknown;
  deviceName?: unknown;
  modalityAeTitle?: unknown;
  scheduledStationAeTitle?: unknown;
  stationName?: unknown;
  stationLocation?: unknown;
  sourceIp?: unknown;
  mwlEnabled?: unknown;
  isActive?: unknown;
}

export interface DicomLogOverviewResult {
  settings: UnknownRecord;
  devices: DicomDeviceListRow[];
  logSummary: DicomLogSummaryRow;
}

interface WorklistDatasetContext {
  deviceId: number | null;
  scheduledStationAeTitle: string;
  stationName: string;
  stationLocation: string;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeBooleanFlag(value: unknown, fieldName: string): boolean {
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

function normalizeIpAddress(value: unknown, fieldName: string): string | null {
  const raw = normalizeOptionalText(value);

  if (!raw) {
    return null;
  }

  if (/^[\d.:a-fA-F]+$/.test(raw)) {
    return raw;
  }

  throw new HttpError(400, `${fieldName} must be a valid IP address format.`);
}

function normalizeQrOrAccession(scanValue: unknown): string {
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

function sanitizeFileToken(value: unknown, fallback = "unknown"): string {
  return String(value || fallback)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || fallback;
}

function normalizeAeTitle(value: unknown): string {
  return normalizeOptionalText(value).toUpperCase();
}

function mapAppointmentToScheduledProcedureStepStatus(status: string): string {
  if (status === APPOINTMENT_STATUS_ARRIVED || status === APPOINTMENT_STATUS_WAITING) {
    return "ARRIVED";
  }

  return "SCHEDULED";
}

// ---------------------------------------------------------------------------
// Settings & device helpers
// ---------------------------------------------------------------------------

async function listDevicesForModality(
  client: Pool | PoolClient,
  modalityId: number | string
): Promise<DicomDeviceRow[]> {
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

  return rows as DicomDeviceRow[];
}

async function getBookingWorklistContext(
  client: Pool | PoolClient,
  bookingId: number | string
): Promise<WorklistAppointmentRow | null> {
  const cleanBookingId = normalizePositiveInteger(bookingId, "bookingId");
  const { rows } = await client.query(
    `
      select
        bookings.id,
        bookings.patient_id,
        patients.identifier_value as patient_primary_id,
        bookings.modality_id,
        ('V2-' || lpad(bookings.id::text, 6, '0')) as accession_number,
        bookings.booking_date::text as appointment_date,
        bookings.status,
        bookings.booking_time::text as booking_time,
        null::text as scheduled_station_ae_title,
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
      from appointments_v2.bookings
      join modalities on modalities.id = bookings.modality_id
      join patients on patients.id = bookings.patient_id
      left join exam_types on exam_types.id = bookings.exam_type_id
      where bookings.id = $1
      limit 1
    `,
    [cleanBookingId]
  );

  return (rows[0] as WorklistAppointmentRow) || null;
}

async function removeMatchingFiles(directory: string, prefix: string): Promise<void> {
  try {
    const files = await fs.readdir(directory);
    await Promise.all(
      files
        .filter((file) => file.startsWith(prefix))
        .map((file) => fs.rm(path.join(directory, file), { force: true }))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Worklist file generation
// ---------------------------------------------------------------------------

export function buildWorklistDump({
  appointment
}: {
  appointment: WorklistAppointmentRow;
}): string {
  const canonicalDataset = buildCanonicalMwlDataset(
    {
      modalityCode: appointment.modality_code,
      appointmentDate: appointment.appointment_date,
      patientPrimaryId: appointment.patient_primary_id,
      patientMrn: appointment.mrn,
      patientNationalId: appointment.national_id,
      patientId: appointment.patient_id,
      patientEnglishFullName: appointment.english_full_name,
      patientArabicFullName: appointment.arabic_full_name,
      patientBirthDate: String(appointment.estimated_date_of_birth || ""),
      patientSex: appointment.sex,
      examNameEn: appointment.exam_name_en,
      examNameAr: appointment.exam_name_ar,
      modalityNameEn: appointment.modality_name_en,
      modalityNameAr: appointment.modality_name_ar,
      accessionNumber: appointment.accession_number || formatV2AccessionNumber(appointment.id)
    },
    { mwlProfile: "minimal" }
  );

  return renderCanonicalMwlToDump(canonicalDataset);
}

function resolveWorklistDatasetContext(
  appointment: WorklistAppointmentRow,
  devices: DicomDeviceRow[],
  gatewaySettings: Pick<GatewaySettings, "mwlAeTitle">
): WorklistDatasetContext {
  const appointmentStationAeTitle = normalizeAeTitle(appointment.scheduled_station_ae_title);
  const scheduledStationAeTitle = appointmentStationAeTitle || normalizeAeTitle(gatewaySettings.mwlAeTitle);
  const matchingDevice = devices.find((device) => normalizeAeTitle(device.scheduled_station_ae_title) === scheduledStationAeTitle) || null;

  return {
    deviceId: matchingDevice?.id ?? null,
    scheduledStationAeTitle,
    stationName: matchingDevice?.station_name || "",
    stationLocation: matchingDevice?.station_location || ""
  };
}

function buildWorklistManifest({
  appointment,
  dataset
}: {
  appointment: WorklistAppointmentRow;
  dataset: WorklistDatasetContext;
}): UnknownRecord {
  return {
    appointmentId: appointment.id,
    accessionNumber: appointment.accession_number,
    modalityId: appointment.modality_id,
    modalityCode: appointment.modality_code || "",
    patientId: appointment.patient_id,
    patientMrn: appointment.mrn || "",
    patientNationalId: appointment.national_id || "",
    patientNameEnglish: appointment.english_full_name || "",
    patientNameArabic: appointment.arabic_full_name,
    appointmentDate: normalizeDateValue(appointment.appointment_date),
    appointmentStatus: appointment.status,
    scheduledProcedureStepStatus: mapAppointmentToScheduledProcedureStepStatus(appointment.status),
    worklist: {
      scheduledStationAeTitle: dataset.scheduledStationAeTitle,
      stationName: dataset.stationName,
      stationLocation: dataset.stationLocation
    },
    device: dataset.deviceId ? { id: dataset.deviceId } : null
  };
}

async function removeMatchingOutputFiles(outputDir: string, prefix: string): Promise<void> {
  try {
    const entries = await fs.readdir(outputDir, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(outputDir, entry.name);

        if (entry.isFile() && entry.name.startsWith(prefix)) {
          await fs.rm(entryPath, { force: true });
          return;
        }

        if (!entry.isDirectory()) {
          return;
        }

        const files = await fs.readdir(entryPath).catch(() => []);
        await Promise.all(
          files
            .filter((file) => file.startsWith(prefix))
            .map((file) => fs.rm(path.join(entryPath, file), { force: true }))
        );
      })
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function writeWorklistSourceFiles(
  appointment: WorklistAppointmentRow,
  devices: DicomDeviceRow[],
  gatewaySettings: Partial<GatewaySettings> & { worklistSourceDir: string; worklistOutputDir: string },
  eligibility: MwlEligibility
): Promise<WorklistSyncResult> {
  const sourceDir = gatewaySettings.worklistSourceDir;
  const outputDir = gatewaySettings.worklistOutputDir;
  const sourcePrefix = `${sanitizeFileToken(appointment.accession_number)}--`;
  const dataset = resolveWorklistDatasetContext(appointment, devices, gatewaySettings as GatewaySettings);

  await ensureDicomGatewayLayout(gatewaySettings as GatewaySettings);
  await removeMatchingFiles(sourceDir, sourcePrefix);
  await removeMatchingOutputFiles(outputDir, sourcePrefix);

  if (!V2_ACTIVE_WORKLIST_STATUSES.has(appointment.status)) {
    return { files: [], removedOnly: true, ok: true };
  }
  if (!eligibility.protocolGateSatisfied) {
    return { files: [], removedOnly: true, ok: true, reason: "waiting_for_protocol" };
  }

  const fileStem = `${sourcePrefix}${sanitizeFileToken(dataset.scheduledStationAeTitle)}`;
  const manifestPath = path.join(sourceDir, `${fileStem}.json`);
  const dumpPath = path.join(sourceDir, `${fileStem}.dump`);
  const manifest = buildWorklistManifest({ appointment, dataset });
  const dump = buildWorklistDump({ appointment });

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(dumpPath, `${dump}\n`, "utf8");

  return { files: [{ manifestPath, dumpPath, deviceId: dataset.deviceId }], removedOnly: false, ok: true };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getDicomGatewaySettings(): Promise<GatewaySettings> {
  const resolved = await resolveGatewaySettings();

  return {
    enabled: resolved.enabled,
    bindHost: resolved.bindHost,
    mwlAeTitle: resolved.mwlAeTitle,
    mwlPort: resolved.mwlPort,
    worklistOutputDir: resolved.worklistOutputDir,
    worklistSourceDir: resolved.worklistSourceDir,
    callbackSecret: resolved.callbackSecret,
    rebuildBehavior: resolved.rebuildBehavior,
    dump2dcmCommand: resolved.dump2dcmCommand,
    dcmdumpCommand: resolved.dcmdumpCommand
  };
}

export async function ensureDicomGatewayLayout(settings: GatewaySettings | null = null): Promise<GatewaySettings> {
  const gatewaySettings = settings || (await getDicomGatewaySettings());
  const resolved = await resolveGatewaySettings();
  await ensureDicomDirectoriesExist(resolved);
  return gatewaySettings;
}

export async function listDicomDevices({ includeInactive = false }: { includeInactive?: boolean } = {}): Promise<DicomDeviceListRow[]> {
  const params: unknown[] = [];
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

  return rows as DicomDeviceListRow[];
}

export async function createDicomDevice(
  payload: UnknownRecord,
  currentUserId: UserId
): Promise<DicomDeviceRow> {
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId");
  const deviceName = normalizeOptionalText(payload.deviceName);
  const modalityAeTitle = normalizeOptionalText(payload.modalityAeTitle).toUpperCase();
  const scheduledStationAeTitle = normalizeOptionalText(payload.scheduledStationAeTitle).toUpperCase();
  const stationName = normalizeOptionalText(payload.stationName);
  const stationLocation = normalizeOptionalText(payload.stationLocation);
  const sourceIp = normalizeIpAddress(payload.sourceIp, "sourceIp");
  const mwlEnabled = normalizeBooleanFlag(payload.mwlEnabled ?? "enabled", "mwlEnabled");
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
          is_active,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, $2, $3, $4, nullif($5, ''), nullif($6, ''), $7, $8, $9, $10, $10)
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
        isActive,
        currentUserId
      ]
    );
    const createdDevice = requireRow(rows[0] as DicomDeviceRow | undefined, "Failed to create DICOM device.");

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
    scheduleV2WorklistRebuild();
    return createdDevice;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateDicomDevice(
  deviceId: number | string,
  payload: UnknownRecord,
  currentUserId: UserId
): Promise<DicomDeviceRow> {
  const cleanDeviceId = normalizePositiveInteger(deviceId, "deviceId");
  const modalityId = normalizePositiveInteger(payload.modalityId, "modalityId");
  const deviceName = normalizeOptionalText(payload.deviceName);
  const modalityAeTitle = normalizeOptionalText(payload.modalityAeTitle).toUpperCase();
  const scheduledStationAeTitle = normalizeOptionalText(payload.scheduledStationAeTitle).toUpperCase();
  const stationName = normalizeOptionalText(payload.stationName);
  const stationLocation = normalizeOptionalText(payload.stationLocation);
  const sourceIp = normalizeIpAddress(payload.sourceIp, "sourceIp");
  const mwlEnabled = normalizeBooleanFlag(payload.mwlEnabled ?? "enabled", "mwlEnabled");
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

    const existing = existingResult.rows[0] as DicomDeviceRow | undefined;

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
          is_active = $10,
          updated_by_user_id = $11,
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
        isActive,
        currentUserId
      ]
    );
    const updatedDevice = requireRow(rows[0] as DicomDeviceRow | undefined, "Failed to update DICOM device.");

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
    scheduleV2WorklistRebuild();
    return updatedDevice;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDicomDevice(
  deviceId: number | string,
  currentUserId: UserId
): Promise<{ ok: boolean }> {
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
    const existing = existingResult.rows[0] as DicomDeviceRow | undefined;

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
    scheduleV2WorklistRebuild();
    return { ok: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function syncBookingWorklistSources(
  bookingId: number | string,
  resolvedEligibility?: MwlEligibility
): Promise<{ ok: boolean; removedOnly?: boolean; files?: WorklistManifestFile[]; reason?: string }> {
  const gatewaySettings = await getDicomGatewaySettings();
  const client = await pool.connect();

  try {
    const appointment = await getBookingWorklistContext(client, bookingId);

    if (!appointment) {
      return { ok: true, removedOnly: true };
    }

    const eligibility = resolvedEligibility ?? await resolveMwlEligibilityForBooking(Number(bookingId), client);
    const devices = await listDevicesForModality(client, appointment.modality_id);
    const result = await writeWorklistSourceFiles(appointment, devices, gatewaySettings, eligibility);
    return result;
  } finally {
    client.release();
  }
}

export async function rebuildAllV2DicomWorklistSources(): Promise<{ ok: boolean; count: number }> {
  const gatewaySettings = await getDicomGatewaySettings();
  const client = await pool.connect();

  try {
    await ensureDicomGatewayLayout(gatewaySettings);
    const { rows } = await client.query(
      `
        select id
        from appointments_v2.bookings
        order by booking_date asc, id asc
      `
    );

    const bookingIds = rows.map((row) => Number(row.id));
    const eligibilityByBookingId = await resolveMwlEligibilityForBookings(bookingIds, client);
    for (const bookingId of bookingIds) {
      await syncBookingWorklistSources(bookingId, eligibilityByBookingId.get(bookingId));
    }

    return { ok: true, count: rows.length };
  } finally {
    client.release();
  }
}

interface ScheduledBookingWorklistSync {
  bookingId: UserId;
  replacement: boolean;
  eligibility?: MwlEligibility;
}

const scheduledBookingWorklistSyncQueue: ScheduledBookingWorklistSync[] = [];
let isDrainingScheduledBookingWorklistSyncs = false;

async function drainScheduledBookingWorklistSyncs(): Promise<void> {
  if (isDrainingScheduledBookingWorklistSyncs) {
    return;
  }

  isDrainingScheduledBookingWorklistSyncs = true;
  try {
    while (scheduledBookingWorklistSyncQueue.length > 0) {
      const item = scheduledBookingWorklistSyncQueue.shift();
      if (!item) {
        continue;
      }

      let eligibility: MwlEligibility;
      try {
        eligibility = item.eligibility ?? await resolveMwlEligibilityForBooking(Number(item.bookingId));
      } catch (error) {
        console.warn(`[MWL] Failed to resolve eligibility for booking ${item.bookingId}.`, error);
        continue;
      }

      await syncBookingWorklistSources(item.bookingId, eligibility).catch((error) => {
        console.warn(
          `[DICOM Worklist] Failed to sync booking ${item.bookingId}. Will retry on next mutation.`,
          error
        );
      });

      await enqueueOrthancSyncForBooking(Number(item.bookingId), eligibility).catch((error) => {
        console.warn(
          `[Orthanc MWL] Failed to enqueue sync job for booking ${item.bookingId}.`,
          error
        );
      });

      const enqueueSante = item.replacement ? enqueueSanteHl7ReplacementForBooking : enqueueSanteHl7ForBooking;
      await enqueueSante(Number(item.bookingId), eligibility).catch((error) => {
        console.warn(
          `[Sante HL7] Failed to enqueue ${item.replacement ? "replacement " : ""}delivery job for booking ${item.bookingId}.`,
          error
        );
      });
    }
  } finally {
    isDrainingScheduledBookingWorklistSyncs = false;
  }
}

export function scheduleBookingWorklistSync(bookingId: UserId): void {
  scheduledBookingWorklistSyncQueue.push({ bookingId, replacement: false });
  void drainScheduledBookingWorklistSyncs();
}

export function scheduleBookingWorklistDetailReplacement(bookingId: UserId): void {
  scheduledBookingWorklistSyncQueue.push({ bookingId, replacement: true });
  void drainScheduledBookingWorklistSyncs();
}

export async function reconcileMwlProtocolPolicyChange(): Promise<number[]> {
  const bookingIds = await listActiveBookingsAffectedByMwlProtocolPolicy();
  const eligibilityByBookingId = await resolveMwlEligibilityForBookings(bookingIds);
  for (const bookingId of bookingIds) {
    const eligibility = eligibilityByBookingId.get(bookingId);
    await syncBookingWorklistSources(bookingId, eligibility);
    await enqueueOrthancSyncForBooking(bookingId, eligibility);
    await enqueueSanteHl7ForBooking(bookingId, eligibility);
  }
  return bookingIds;
}

export function scheduleV2WorklistRebuild(): void {
  Promise.resolve()
    .then(() => rebuildAllV2DicomWorklistSources())
    .catch((error) => {
      console.warn(
        `[DICOM Worklist] Failed to rebuild worklist sources. Manual intervention may be required.`,
        error
      );
    });
}

export async function resolveScanValueToAccession(
  scanValue: unknown,
  accessionNumber: unknown
): Promise<string> {
  if (normalizeOptionalText(accessionNumber)) {
    return normalizeOptionalText(accessionNumber);
  }

  return normalizeQrOrAccession(scanValue);
}

export async function getDicomGatewayOverview(): Promise<DicomLogOverviewResult> {
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

  const summary = logSummary.rows[0] as DicomLogSummaryRow | undefined;

  return {
    settings: settings as unknown as UnknownRecord,
    devices,
    logSummary: summary || {
      processed_count: 0,
      failed_count: 0,
      total_count: 0
    }
  };
}

export function createGatewayCallbackToken(secret: string): string {
  return normalizeOptionalText(secret) || randomUUID();
}
