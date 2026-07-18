import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import { decryptBackupV3Secret, encryptBackupV3Secret } from "./backup-v3-secret-service.js";
import { getProjectRootDir } from "./document-storage-path.js";
import { validateBackupV3WebDavConfig } from "./backup-v3-webdav-destination.js";
import { validateBackupV3SftpConfig } from "./backup-v3-sftp-destination.js";
import { validateBackupV3SmbConfig } from "./backup-v3-smb-destination.js";
import { testBackupV3LocalDestination } from "./backup-v3-local-destination.js";
import { testBackupV3WebDavDestination } from "./backup-v3-webdav-destination.js";
import { testBackupV3SftpDestination } from "./backup-v3-sftp-destination.js";
import { testBackupV3SmbDestination } from "./backup-v3-smb-destination.js";
import { nextBackupV3ScheduleRun } from "./backup-v3-scheduling.js";
import type { NullableUserId } from "../types/http.js";

export type BackupDestinationType = "local" | "smb" | "sftp" | "nextcloud" | "onedrive";
export type BackupJobStatus = "queued" | "generating" | "generated" | "copying" | "verifying" | "completed" | "failed" | "cancelled";
export type BackupScheduleFrequency = "daily" | "weekdays" | "weekly" | "monthly";

export interface BackupDestinationProfileInput {
  name?: unknown;
  destinationType?: unknown;
  enabled?: unknown;
  config?: unknown;
  credentials?: unknown;
}

export interface BackupScheduleInput {
  name?: unknown;
  frequency?: unknown;
  timeOfDay?: unknown;
  timezone?: unknown;
  selectedWeekdays?: unknown;
  selectedDayOfMonth?: unknown;
  destinationIds?: unknown;
  retentionPolicy?: unknown;
  restoreVerificationFrequency?: unknown;
  enabled?: unknown;
}

const destinationTypes = new Set<BackupDestinationType>(["local", "smb", "sftp", "nextcloud", "onedrive"]);
const scheduleFrequencies = new Set<BackupScheduleFrequency>(["daily", "weekdays", "weekly", "monthly"]);
const verificationFrequencies = new Set(["disabled", "weekly", "monthly"]);

function cleanText(value: unknown, field: string, max = 120): string {
  const text = String(value || "").trim();
  if (!text || text.length > max) throw new HttpError(400, `${field} is required and must be at most ${max} characters.`);
  return text;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, `${field} must be an object.`);
  return value as Record<string, unknown>;
}

function asOptionalRecord(value: unknown, field: string): Record<string, unknown> {
  if (value == null) return {};
  return asRecord(value, field);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return value == null ? fallback : value === true;
}

function safeUuidArray(value: unknown, field: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !/^[0-9a-f-]{36}$/i.test(item))) {
    throw new HttpError(400, `${field} must be an array of identifiers.`);
  }
  return [...new Set(value)];
}

function ensureTimezone(timezone: string): string {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new HttpError(400, "timezone must be an IANA timezone.");
  }
  return timezone;
}

function approvedLocalRoots(): string[] {
  const configured = String(process.env.BACKUP_V3_LOCAL_ROOTS || "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([path.join(getProjectRootDir(), "storage", "backups"), ...configured].map((value) => path.resolve(value)))];
}

function safeLocalConfig(config: Record<string, unknown>): Record<string, unknown> {
  const root = cleanText(config.rootPath, "Local backup path", 1_000);
  const resolved = path.resolve(root);
  if (!approvedLocalRoots().includes(resolved)) {
    throw new HttpError(400, "Local backup path is not an administrator-approved backup root.");
  }
  return { rootPath: resolved };
}

function publicDestinationRow(row: Record<string, unknown>) {
  const { encrypted_credentials: _secret, ...publicRow } = row;
  return { ...publicRow, credentialsConfigured: Boolean(_secret) };
}

export async function listBackupDestinationProfiles() {
  const { rows } = await pool.query("select destination_id,name,destination_type,enabled,config,encrypted_credentials,last_connection_at,last_connection_status,last_failure_message,created_at,updated_at from backup_destination_profiles order by name asc");
  return rows.map((row) => publicDestinationRow(row as Record<string, unknown>));
}

export async function createBackupDestinationProfile(input: BackupDestinationProfileInput, userId: NullableUserId) {
  const name = cleanText(input.name, "Destination name");
  const destinationType = cleanText(input.destinationType, "Destination type", 30) as BackupDestinationType;
  if (!destinationTypes.has(destinationType)) throw new HttpError(400, "Unsupported backup destination type.");
  const rawConfig = asOptionalRecord(input.config, "Destination configuration");
  const config = destinationType === "local"
    ? safeLocalConfig(rawConfig)
    : destinationType === "nextcloud"
      ? validateBackupV3WebDavConfig(rawConfig)
      : destinationType === "sftp"
        ? validateBackupV3SftpConfig(rawConfig)
        : destinationType === "smb"
          ? validateBackupV3SmbConfig(rawConfig)
        : rawConfig;
  const credentials = input.credentials == null ? null : JSON.stringify(asRecord(input.credentials, "Destination credentials"));
  const destinationId = crypto.randomUUID();
  const { rows } = await pool.query(
    `insert into backup_destination_profiles (destination_id,name,destination_type,enabled,config,encrypted_credentials,created_by_user_id)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7)
     returning destination_id,name,destination_type,enabled,config,encrypted_credentials,last_connection_at,last_connection_status,last_failure_message,created_at,updated_at`,
    [destinationId, name, destinationType, asBoolean(input.enabled, true), JSON.stringify(config), credentials ? encryptBackupV3Secret(credentials) : null, userId]
  );
  await logAuditEntry({ entityType: "backup_destination", entityId: null, actionType: "backup_destination_created", newValues: { destinationId, destinationType, enabled: asBoolean(input.enabled, true), credentialsConfigured: Boolean(credentials) }, changedByUserId: userId });
  return publicDestinationRow(rows[0] as Record<string, unknown>);
}

export async function updateBackupDestinationProfile(destinationId: string, input: BackupDestinationProfileInput, userId: NullableUserId) {
  const id = backupDestinationId(destinationId);
  const existingResult = await pool.query<{ name: string; destination_type: BackupDestinationType; enabled: boolean; config: Record<string, unknown>; encrypted_credentials: string | null }>("select name,destination_type,enabled,config,encrypted_credentials from backup_destination_profiles where destination_id=$1::uuid", [id]);
  const existing = existingResult.rows[0];
  if (!existing) throw new HttpError(404, "Backup destination was not found.");
  const destinationType = input.destinationType == null ? existing.destination_type : cleanText(input.destinationType, "Destination type", 30) as BackupDestinationType;
  if (!destinationTypes.has(destinationType)) throw new HttpError(400, "Unsupported backup destination type.");
  const rawConfig = input.config == null ? existing.config : asOptionalRecord(input.config, "Destination configuration");
  const config = destinationType === "local"
    ? safeLocalConfig(rawConfig)
    : destinationType === "nextcloud"
      ? validateBackupV3WebDavConfig(rawConfig)
      : destinationType === "sftp"
        ? validateBackupV3SftpConfig(rawConfig)
        : destinationType === "smb"
          ? validateBackupV3SmbConfig(rawConfig)
          : rawConfig;
  const suppliedCredentials = input.credentials !== undefined;
  const encryptedCredentials = !suppliedCredentials
    ? existing.encrypted_credentials
    : input.credentials == null
      ? null
      : encryptBackupV3Secret(JSON.stringify(asRecord(input.credentials, "Destination credentials")));
  const { rows } = await pool.query(
    `update backup_destination_profiles set name=$2,destination_type=$3,enabled=$4,config=$5::jsonb,encrypted_credentials=$6,updated_at=now()
     where destination_id=$1::uuid
     returning destination_id,name,destination_type,enabled,config,encrypted_credentials,last_connection_at,last_connection_status,last_failure_message,created_at,updated_at`,
    [id, input.name == null ? existing.name : cleanText(input.name, "Destination name"), destinationType, input.enabled == null ? existing.enabled : asBoolean(input.enabled, existing.enabled), JSON.stringify(config), encryptedCredentials]
  );
  await logAuditEntry({ entityType: "backup_destination", entityId: null, actionType: "backup_destination_updated", newValues: { destinationId: id, destinationType, credentialsChanged: suppliedCredentials, enabled: rows[0]?.enabled }, changedByUserId: userId });
  return publicDestinationRow(rows[0] as Record<string, unknown>);
}

export async function updateBackupArchivePassphrase(passphrase: unknown, userId: NullableUserId): Promise<void> {
  const value = cleanText(passphrase, "Backup encryption passphrase", 4_096);
  if (value.length < 8) throw new HttpError(400, "Backup encryption passphrase must be at least 8 characters.");
  await pool.query(
    `insert into backup_control_secrets (secret_name,encrypted_value,updated_by_user_id)
     values ('archive_passphrase',$1,$2)
     on conflict (secret_name) do update set encrypted_value=excluded.encrypted_value,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()`,
    [encryptBackupV3Secret(value), userId]
  );
  await logAuditEntry({ entityType: "backup_configuration", actionType: "backup_encryption_passphrase_updated", newValues: { configured: true }, changedByUserId: userId });
}

export async function getBackupArchivePassphrase(): Promise<string> {
  const { rows } = await pool.query<{ encrypted_value: string }>("select encrypted_value from backup_control_secrets where secret_name='archive_passphrase'");
  if (!rows[0]?.encrypted_value) throw new HttpError(503, "Automated backups require a configured backup encryption passphrase.");
  return decryptBackupV3Secret(rows[0].encrypted_value);
}

/** Worker-only access. No route or list response may return this value. */
export async function getBackupDestinationCredentials(destinationId: string): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<{ encrypted_credentials: string | null }>("select encrypted_credentials from backup_destination_profiles where destination_id=$1::uuid", [destinationId]);
  const encrypted = rows[0]?.encrypted_credentials;
  if (!encrypted) return {};
  try {
    const parsed = JSON.parse(decryptBackupV3Secret(encrypted)) as unknown;
    return asRecord(parsed, "Stored destination credentials");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "Stored backup destination credentials are invalid.");
  }
}

function backupDestinationId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, "Invalid backup destination identifier.");
  return value;
}

export async function testBackupDestinationProfile(destinationId: string): Promise<{ ok: true; freeBytes?: number | null }> {
  const id = backupDestinationId(destinationId);
  const { rows } = await pool.query<{ destination_type: BackupDestinationType; config: Record<string, unknown> }>("select destination_type,config from backup_destination_profiles where destination_id=$1::uuid", [id]);
  const destination = rows[0];
  if (!destination) throw new HttpError(404, "Backup destination was not found.");
  try {
    const credentials = await getBackupDestinationCredentials(id);
    let freeBytes: number | null | undefined;
    if (destination.destination_type === "local") {
      const rootPath = typeof destination.config.rootPath === "string" ? destination.config.rootPath : "";
      freeBytes = (await testBackupV3LocalDestination(rootPath)).freeBytes;
    } else if (destination.destination_type === "nextcloud") {
      const appPassword = typeof credentials.appPassword === "string" ? credentials.appPassword : "";
      await testBackupV3WebDavDestination(destination.config, { appPassword });
    } else if (destination.destination_type === "sftp") {
      await testBackupV3SftpDestination(destination.config, {
        ...(typeof credentials.password === "string" ? { password: credentials.password } : {}),
        ...(typeof credentials.privateKey === "string" ? { privateKey: credentials.privateKey } : {}),
        ...(typeof credentials.passphrase === "string" ? { passphrase: credentials.passphrase } : {}),
      });
    } else if (destination.destination_type === "smb") {
      const username = typeof credentials.username === "string" ? credentials.username : "";
      const password = typeof credentials.password === "string" ? credentials.password : "";
      await testBackupV3SmbDestination(destination.config, { username, password });
    } else {
      throw new HttpError(501, "OneDrive destination testing is not available yet.");
    }
    await pool.query("update backup_destination_profiles set last_connection_at=now(),last_connection_status='verified',last_failure_message=null,updated_at=now() where destination_id=$1::uuid", [id]);
    return { ok: true, ...(freeBytes !== undefined ? { freeBytes } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/password|passphrase|token|secret|private key/gi, "credential") : "Backup destination test failed.";
    await pool.query("update backup_destination_profiles set last_connection_status='failed',last_failure_message=$2,updated_at=now() where destination_id=$1::uuid", [id, message.slice(0, 1_000)]).catch(() => undefined);
    throw error;
  }
}

function normalizeBackupScheduleInput(input: BackupScheduleInput) {
  const name = cleanText(input.name, "Schedule name");
  const frequency = cleanText(input.frequency, "Schedule frequency", 20) as BackupScheduleFrequency;
  if (!scheduleFrequencies.has(frequency)) throw new HttpError(400, "Unsupported schedule frequency.");
  const timeOfDay = cleanText(input.timeOfDay, "Backup time", 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeOfDay)) throw new HttpError(400, "Backup time must be HH:MM.");
  const timezone = ensureTimezone(String(input.timezone || "Africa/Tripoli"));
  const selectedWeekdays = input.selectedWeekdays == null ? [] : input.selectedWeekdays;
  if (!Array.isArray(selectedWeekdays) || selectedWeekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new HttpError(400, "selectedWeekdays must contain weekday numbers from 0 through 6.");
  const selectedDayOfMonth = input.selectedDayOfMonth == null ? null : Number(input.selectedDayOfMonth);
  if (selectedDayOfMonth !== null && (!Number.isInteger(selectedDayOfMonth) || selectedDayOfMonth < 1 || selectedDayOfMonth > 31)) throw new HttpError(400, "selectedDayOfMonth must be from 1 through 31.");
  if (frequency === "weekly" && selectedWeekdays.length === 0) throw new HttpError(400, "Select at least one weekday for a weekly backup schedule.");
  if (frequency === "monthly" && selectedDayOfMonth === null) throw new HttpError(400, "Select a day of month for a monthly backup schedule.");
  const destinationIds = safeUuidArray(input.destinationIds, "destinationIds");
  if (!destinationIds.length) throw new HttpError(400, "Select at least one backup destination.");
  const restoreVerificationFrequency = String(input.restoreVerificationFrequency || "disabled");
  if (!verificationFrequencies.has(restoreVerificationFrequency)) throw new HttpError(400, "Unsupported restore-verification frequency.");
  const nextRunAt = nextBackupV3ScheduleRun({ frequency, timeOfDay, timezone, selectedWeekdays, selectedDayOfMonth });
  return { name, frequency, timeOfDay, timezone, selectedWeekdays, selectedDayOfMonth, destinationIds, retentionPolicy: asOptionalRecord(input.retentionPolicy, "retentionPolicy"), restoreVerificationFrequency, enabled: asBoolean(input.enabled, true), nextRunAt };
}

export async function listBackupSchedules() {
  const { rows } = await pool.query("select schedule_id,name,frequency,time_of_day,timezone,selected_weekdays,selected_day_of_month,destination_ids,retention_policy,restore_verification_frequency,enabled,last_run_at,next_run_at,created_at,updated_at from backup_schedules order by name asc");
  return rows;
}

export async function createBackupSchedule(input: BackupScheduleInput, userId: NullableUserId) {
  const normalized = normalizeBackupScheduleInput(input);
  const scheduleId = crypto.randomUUID();
  const { rows } = await pool.query(
    `insert into backup_schedules (schedule_id,name,frequency,time_of_day,timezone,selected_weekdays,selected_day_of_month,destination_ids,retention_policy,restore_verification_frequency,enabled,next_run_at,created_by_user_id)
     values ($1,$2,$3,$4,$5,$6::smallint[],$7,$8::uuid[],$9::jsonb,$10,$11,$12,$13)
     returning *`,
    [scheduleId, normalized.name, normalized.frequency, normalized.timeOfDay, normalized.timezone, normalized.selectedWeekdays, normalized.selectedDayOfMonth, normalized.destinationIds, JSON.stringify(normalized.retentionPolicy), normalized.restoreVerificationFrequency, normalized.enabled, normalized.nextRunAt, userId]
  );
  await logAuditEntry({ entityType: "backup_schedule", actionType: "backup_schedule_created", newValues: { scheduleId, frequency: normalized.frequency, timezone: normalized.timezone, destinationCount: normalized.destinationIds.length }, changedByUserId: userId });
  return rows[0];
}

export async function updateBackupSchedule(scheduleId: string, input: BackupScheduleInput, userId: NullableUserId) {
  const id = backupDestinationId(scheduleId);
  const existingResult = await pool.query<BackupScheduleInput & { enabled: boolean }>("select name,frequency,time_of_day as \"timeOfDay\",timezone,selected_weekdays as \"selectedWeekdays\",selected_day_of_month as \"selectedDayOfMonth\",destination_ids as \"destinationIds\",retention_policy as \"retentionPolicy\",restore_verification_frequency as \"restoreVerificationFrequency\",enabled from backup_schedules where schedule_id=$1::uuid", [id]);
  const existing = existingResult.rows[0];
  if (!existing) throw new HttpError(404, "Backup schedule was not found.");
  const normalized = normalizeBackupScheduleInput({
    name: input.name ?? existing.name,
    frequency: input.frequency ?? existing.frequency,
    timeOfDay: input.timeOfDay ?? existing.timeOfDay,
    timezone: input.timezone ?? existing.timezone,
    selectedWeekdays: input.selectedWeekdays ?? existing.selectedWeekdays,
    selectedDayOfMonth: input.selectedDayOfMonth ?? existing.selectedDayOfMonth,
    destinationIds: input.destinationIds ?? existing.destinationIds,
    retentionPolicy: input.retentionPolicy ?? existing.retentionPolicy,
    restoreVerificationFrequency: input.restoreVerificationFrequency ?? existing.restoreVerificationFrequency,
    enabled: input.enabled ?? existing.enabled,
  });
  const { rows } = await pool.query(
    `update backup_schedules set name=$2,frequency=$3,time_of_day=$4,timezone=$5,selected_weekdays=$6::smallint[],selected_day_of_month=$7,destination_ids=$8::uuid[],retention_policy=$9::jsonb,restore_verification_frequency=$10,enabled=$11,next_run_at=$12,last_scheduled_slot=null,updated_at=now()
     where schedule_id=$1::uuid returning *`,
    [id, normalized.name, normalized.frequency, normalized.timeOfDay, normalized.timezone, normalized.selectedWeekdays, normalized.selectedDayOfMonth, normalized.destinationIds, JSON.stringify(normalized.retentionPolicy), normalized.restoreVerificationFrequency, normalized.enabled, normalized.enabled ? normalized.nextRunAt : null]
  );
  await logAuditEntry({ entityType: "backup_schedule", actionType: "backup_schedule_updated", newValues: { scheduleId: id, enabled: normalized.enabled, frequency: normalized.frequency }, changedByUserId: userId });
  return rows[0];
}

export async function deleteBackupSchedule(scheduleId: string, userId: NullableUserId): Promise<void> {
  const id = backupDestinationId(scheduleId);
  const result = await pool.query("delete from backup_schedules where schedule_id=$1::uuid", [id]);
  if (!result.rowCount) throw new HttpError(404, "Backup schedule was not found.");
  await logAuditEntry({ entityType: "backup_schedule", actionType: "backup_schedule_deleted", newValues: { scheduleId: id }, changedByUserId: userId });
}

export async function deleteBackupDestinationProfile(destinationId: string, userId: NullableUserId): Promise<void> {
  const id = backupDestinationId(destinationId);
  const copies = await pool.query("select 1 from backup_destination_copy_attempts where destination_id=$1::uuid limit 1", [id]);
  if (copies.rowCount) throw new HttpError(409, "A destination with backup-copy history cannot be removed. Pause it instead to preserve audit history.");
  const result = await pool.query("delete from backup_destination_profiles where destination_id=$1::uuid", [id]);
  if (!result.rowCount) throw new HttpError(404, "Backup destination was not found.");
  await logAuditEntry({ entityType: "backup_destination", actionType: "backup_destination_deleted", newValues: { destinationId: id }, changedByUserId: userId });
}

export async function queueBackupJob(input: { initiatedByUserId: NullableUserId; sourceScheduleId?: string | null; destinationIds: string[]; retryOfJobId?: string | null }) {
  const destinationIds = safeUuidArray(input.destinationIds, "destinationIds");
  if (!destinationIds.length) throw new HttpError(400, "Select at least one backup destination.");
  const enabled = await pool.query<{ destination_id: string }>("select destination_id from backup_destination_profiles where enabled=true and destination_id = any($1::uuid[])", [destinationIds]);
  if (enabled.rows.length !== destinationIds.length) throw new HttpError(400, "One or more selected backup destinations are disabled or unavailable.");
  const jobId = crypto.randomUUID();
  const { rows } = await pool.query(
    `insert into backup_jobs (job_id,status,source_schedule_id,initiated_by_user_id,requested_destination_ids,retry_of_job_id)
     values ($1,'queued',$2,$3,$4::uuid[],$5) returning *`,
    [jobId, input.sourceScheduleId || null, input.initiatedByUserId, destinationIds, input.retryOfJobId || null]
  );
  await logAuditEntry({ entityType: "backup_job", actionType: "backup_job_queued", newValues: { jobId, destinationCount: destinationIds.length, sourceScheduleId: input.sourceScheduleId || null }, changedByUserId: input.initiatedByUserId });
  return rows[0];
}

export async function retryBackupJob(jobId: string, input: { initiatedByUserId: NullableUserId; destinationIds?: string[] }): Promise<unknown> {
  const id = backupDestinationId(jobId);
  const { rows } = await pool.query<{ status: BackupJobStatus; requested_destination_ids: string[] }>("select status,requested_destination_ids from backup_jobs where job_id=$1::uuid", [id]);
  const original = rows[0];
  if (!original) throw new HttpError(404, "Backup job was not found.");
  if (original.status !== "failed" && original.status !== "cancelled") throw new HttpError(409, "Only failed or cancelled backup jobs can be retried.");
  const failed = await pool.query<{ destination_id: string }>("select destination_id from backup_destination_copy_attempts where job_id=$1::uuid and status='failed'", [id]);
  const requested = input.destinationIds?.length ? safeUuidArray(input.destinationIds, "destinationIds") : (failed.rows.length ? failed.rows.map((row) => row.destination_id) : original.requested_destination_ids);
  if (requested.some((destinationId) => !original.requested_destination_ids.includes(destinationId))) throw new HttpError(400, "Retry destinations must belong to the original backup job.");
  return queueBackupJob({ initiatedByUserId: input.initiatedByUserId, destinationIds: requested, retryOfJobId: id });
}

export async function cancelQueuedBackupJob(jobId: string, userId: NullableUserId): Promise<void> {
  const id = backupDestinationId(jobId);
  const result = await pool.query("update backup_jobs set status='cancelled',failure_code='cancelled_by_user',failure_message='Cancelled before backup generation started.',completed_at=now(),updated_at=now() where job_id=$1::uuid and status='queued'", [id]);
  if (!result.rowCount) throw new HttpError(409, "Only queued backup jobs can be cancelled safely.");
  await logAuditEntry({ entityType: "backup_job", actionType: "backup_job_cancelled", newValues: { jobId: id }, changedByUserId: userId });
}

export async function getBackupArtifactForDownload(jobId: string): Promise<{ archiveName: string; filePath: string }> {
  const id = backupDestinationId(jobId);
  const { rows } = await pool.query<{ archive_name: string; staging_path: string }>("select archive_name,staging_path from backup_artifacts where job_id=$1::uuid", [id]);
  const artifact = rows[0];
  if (!artifact) throw new HttpError(404, "Backup archive was not found.");
  const artifactRoot = path.resolve(getProjectRootDir(), "storage", "backups", "artifacts");
  const filePath = path.resolve(artifact.staging_path);
  if (!filePath.startsWith(`${artifactRoot}${path.sep}`) || !filePath.endsWith(".rispro.zip")) throw new HttpError(409, "This backup archive is not available for download.");
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new HttpError(404, "The local stored backup archive is no longer available.");
  return { archiveName: artifact.archive_name, filePath };
}

export async function claimNextBackupJob() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(
      `with candidate as (
         select job_id from backup_jobs where job_kind='backup' and status='queued' order by created_at asc for update skip locked limit 1
       ) update backup_jobs job set status='generating',started_at=coalesce(started_at,now()),heartbeat_at=now(),updated_at=now()
       from candidate where job.job_id=candidate.job_id returning job.*`
    );
    await client.query("commit");
    return rows[0] || null;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function updateBackupJobHeartbeat(jobId: string): Promise<void> {
  await pool.query("update backup_jobs set heartbeat_at=now(),updated_at=now() where job_id=$1::uuid and status in ('generating','copying','verifying')", [jobId]);
}

export async function markBackupJobGenerated(input: { jobId: string; archiveName: string; stagingPath: string; byteSize: number; sha256: string; manifest: unknown }) {
  const artifactId = crypto.randomUUID();
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("update backup_jobs set status='generated',archive_name=$2,staging_path=$3,archive_size_bytes=$4,archive_sha256=$5,heartbeat_at=now(),updated_at=now() where job_id=$1::uuid and status='generating'", [input.jobId, input.archiveName, input.stagingPath, input.byteSize, input.sha256]);
    await client.query("insert into backup_artifacts (artifact_id,job_id,archive_name,staging_path,byte_size,sha256,manifest) values ($1,$2::uuid,$3,$4,$5,$6,$7::jsonb)", [artifactId, input.jobId, input.archiveName, input.stagingPath, input.byteSize, input.sha256, JSON.stringify(input.manifest)]);
    await client.query("update backup_jobs set status='copying',updated_at=now() where job_id=$1::uuid", [input.jobId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return artifactId;
}

export async function failBackupJob(jobId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await pool.query("update backup_jobs set status='failed',failure_code='backup_failed',failure_message=$2,completed_at=now(),updated_at=now() where job_id=$1::uuid", [jobId, message.slice(0, 1_000)]);
}

export async function getBackupJobDestinations(jobId: string) {
  const { rows } = await pool.query(
    `select profile.destination_id,profile.destination_type,profile.config,profile.enabled
     from backup_jobs job join backup_destination_profiles profile on profile.destination_id = any(job.requested_destination_ids)
     where job.job_id=$1::uuid order by profile.name asc`,
    [jobId]
  );
  return rows as Array<{ destination_id: string; destination_type: BackupDestinationType; config: Record<string, unknown>; enabled: boolean }>;
}

export async function recordBackupDestinationCopy(input: {
  jobId: string;
  artifactId: string;
  destinationId: string;
  status: "copying" | "verified" | "failed";
  remotePath?: string | null;
  byteSize?: number | null;
  sha256?: string | null;
  failureMessage?: string | null;
}): Promise<void> {
  await pool.query(
    `insert into backup_destination_copy_attempts (copy_attempt_id,job_id,artifact_id,destination_id,status,remote_path,byte_size,sha256,failure_message,started_at,completed_at)
     values ($1,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9,now(),case when $5 in ('verified','failed') then now() else null end)
     on conflict (job_id,destination_id) do update set status=excluded.status,remote_path=excluded.remote_path,byte_size=excluded.byte_size,sha256=excluded.sha256,failure_message=excluded.failure_message,completed_at=excluded.completed_at,updated_at=now()`,
    [crypto.randomUUID(), input.jobId, input.artifactId, input.destinationId, input.status, input.remotePath || null, input.byteSize || null, input.sha256 || null, input.failureMessage?.slice(0, 1_000) || null]
  );
}

export async function completeBackupJobAfterCopies(jobId: string): Promise<"completed" | "failed"> {
  const { rows } = await pool.query<{ failed: number; verified: number; required: number }>(
    `select
       count(*) filter (where copy.status='failed')::int as failed,
       count(*) filter (where copy.status='verified')::int as verified,
       cardinality(job.requested_destination_ids)::int as required
     from backup_jobs job left join backup_destination_copy_attempts copy on copy.job_id=job.job_id
     where job.job_id=$1::uuid group by job.job_id`,
    [jobId]
  );
  const outcome = rows[0];
  if (!outcome || outcome.failed > 0 || outcome.verified !== outcome.required) {
    await pool.query("update backup_jobs set status='failed',failure_code='destination_copy_failed',failure_message='One or more required backup destination copies failed.',completed_at=now(),updated_at=now() where job_id=$1::uuid", [jobId]);
    return "failed";
  }
  await pool.query("update backup_jobs set status='completed',completed_at=now(),heartbeat_at=now(),updated_at=now() where job_id=$1::uuid", [jobId]);
  return "completed";
}

export async function recoverStaleBackupJobs(staleMinutes = 120): Promise<number> {
  const { rowCount } = await pool.query(
    `update backup_jobs set status='failed',failure_code='stale_worker',failure_message='Backup worker heartbeat became stale.',completed_at=now(),updated_at=now()
     where status in ('generating','copying','verifying') and coalesce(heartbeat_at,started_at,created_at) < now() - ($1::text || ' minutes')::interval`,
    [String(Math.max(5, Math.min(staleMinutes, 1440)))]
  );
  return rowCount || 0;
}

export async function recordBackupWorkerHeartbeat(instanceId: string, failureMessage: string | null = null): Promise<void> {
  await pool.query(
    `insert into backup_worker_state (singleton_key,instance_id,heartbeat_at,last_successful_tick_at,last_failure_message)
     values (true,$1,now(),case when $2::text is null then now() else null end,$2::text)
     on conflict (singleton_key) do update set instance_id=excluded.instance_id,heartbeat_at=now(),last_successful_tick_at=case when $2::text is null then now() else backup_worker_state.last_successful_tick_at end,last_failure_message=$2::text,updated_at=now()`,
    [instanceId, failureMessage]
  );
}

export async function listBackupJobs(limit = 50) {
  const { rows } = await pool.query(
    `select job.*, artifact.artifact_id, artifact.created_at as artifact_created_at,
       coalesce(json_agg(json_build_object('destinationId',copy.destination_id,'status',copy.status,'remotePath',copy.remote_path,'failureMessage',copy.failure_message)) filter (where copy.copy_attempt_id is not null), '[]'::json) as destination_copies
     from backup_jobs job left join backup_artifacts artifact on artifact.job_id=job.job_id left join backup_destination_copy_attempts copy on copy.job_id=job.job_id
     group by job.job_id,artifact.artifact_id order by job.created_at desc limit $1`,
    [Math.max(1, Math.min(limit, 200))]
  );
  return rows;
}

export async function getBackupControlCenterSummary() {
  const stagingRoot = path.join(getProjectRootDir(), "storage", "backups", "staging");
  let stagingFreeBytes: number | null = null;
  try {
    await fs.mkdir(stagingRoot, { recursive: true });
    const space = await fs.statfs(stagingRoot);
    stagingFreeBytes = Number(space.bavail) * Number(space.bsize);
  } catch {
    // The worker will provide the actionable failure when staging cannot be inspected.
  }
  const { rows } = await pool.query(
    `select
      (select row_to_json(job) from (select job_id,status,archive_name,started_at,heartbeat_at from backup_jobs where status in ('queued','generating','copying','verifying') order by created_at asc limit 1) job) as active_job,
      (select row_to_json(job) from (select job_id,archive_name,completed_at,archive_size_bytes from backup_jobs where status='completed' order by completed_at desc limit 1) job) as last_successful_backup,
      (select row_to_json(copy) from (select copy.destination_id,destination.name as destination_name,destination.destination_type,copy.remote_path,copy.completed_at,copy.byte_size from backup_destination_copy_attempts copy join backup_destination_profiles destination on destination.destination_id=copy.destination_id where copy.status='verified' order by copy.completed_at desc nulls last,copy.created_at desc limit 1) copy) as last_verified_copy,
      (select row_to_json(verification) from (select status,completed_at,failure_message from backup_restore_verification_jobs where status='completed' order by completed_at desc nulls last limit 1) verification) as last_successful_restore_verification,
      (select row_to_json(schedule) from (select schedule_id,name,next_run_at,last_run_at from backup_schedules where enabled=true order by next_run_at asc nulls last limit 1) schedule) as next_schedule,
      (select count(*)::int from backup_destination_profiles where enabled) as enabled_destinations,
      (select count(*)::int from backup_destination_profiles) as destinations,
      (select count(*)::int from backup_jobs where status='failed' and created_at > now()-interval '7 days') as recent_failures,
      (select count(*)::int from backup_schedules where enabled=true and next_run_at < now()-interval '15 minutes') as overdue_schedules,
      (select row_to_json(state) from (select instance_id,heartbeat_at,last_successful_tick_at,last_failure_message from backup_worker_state where singleton_key=true) state) as worker`
  );
  const summary = rows[0] || {};
  const health = !summary.last_successful_backup || Number(summary.recent_failures || 0) > 0 || Number(summary.overdue_schedules || 0) > 0
    ? (!summary.last_successful_backup || Number(summary.overdue_schedules || 0) > 0 ? "critical" : "warning")
    : "healthy";
  return { ...summary, health, staging_free_bytes: stagingFreeBytes };
}

export async function ensureBackupStagingDirectory(): Promise<string> {
  const root = path.join(getProjectRootDir(), "storage", "backups", "staging");
  await fs.mkdir(root, { recursive: true });
  await fs.access(root, (await import("node:fs")).constants.W_OK);
  const space = await fs.statfs(root);
  const freeBytes = Number(space.bavail) * Number(space.bsize);
  const configuredFloor = Number(process.env.BACKUP_V3_MIN_STAGING_FREE_BYTES || 1_073_741_824);
  const floor = Number.isSafeInteger(configuredFloor) && configuredFloor >= 64 * 1024 * 1024 && configuredFloor <= 100 * 1024 ** 4
    ? configuredFloor
    : 1_073_741_824;
  const { rows } = await pool.query<{ largest_archive_bytes: string | null }>("select max(archive_size_bytes)::text as largest_archive_bytes from backup_jobs where status='completed' and archive_size_bytes is not null");
  const priorLargest = Number(rows[0]?.largest_archive_bytes || 0);
  const requiredBytes = Math.max(floor, Number.isSafeInteger(priorLargest) ? Math.ceil(priorLargest * 1.2) : floor);
  if (freeBytes < requiredBytes) {
    throw new HttpError(503, `Backup staging has insufficient free space (${freeBytes} bytes available; ${requiredBytes} bytes required).`);
  }
  return root;
}

export async function ensureBackupArtifactDirectory(): Promise<string> {
  const root = path.join(getProjectRootDir(), "storage", "backups", "artifacts");
  await fs.mkdir(root, { recursive: true });
  await fs.access(root, (await import("node:fs")).constants.W_OK);
  return root;
}
