import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { normalizeOptionalText } from "../utils/normalize.js";
import { loadSettingsMap } from "./settings-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

export const SANTE_HL7_CATEGORY = "sante_worklist_hl7";

export type SanteWorklistMode = "disabled" | "shadow" | "primary_with_internal_fallback" | "sante_only";
export type SanteSuccessBehavior = "auto_detect" | "deleted" | "don";
export type SanteDeliveryMethod = "file_drop" | "mllp";

export interface ResolvedSanteWorklistSettings {
  enabled: boolean;
  mode: SanteWorklistMode;
  keepInternalMwlActive: boolean;
  deliveryMethod: SanteDeliveryMethod;
  outputFolderPath: string;
  fileExtension: ".hl7" | ".txt";
  successBehavior: SanteSuccessBehavior;
  errorExtensions: string[];
  mllpHost: string;
  mllpPort: number;
  mllpTimeoutSeconds: number;
  mllpExpectAck: boolean;
  scheduledStationAeTitleDefault: string;
  retryMaxAttempts: number;
  retryInitialDelaySeconds: number;
  retryMaxDelaySeconds: number;
  pendingImportTimeoutSeconds: number;
  orderControlCreate: "NW";
  orderControlUpdate: "XO";
  orderControlCancel: "CA";
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication: string;
  receivingFacility: string;
  hl7Version: string;
  charset: string;
  patientIdField: "identifier_value" | "mrn" | "national_id" | "patient_id";
  patientNameField: "english_full_name" | "arabic_full_name";
  allowedBasePaths: string[];
  hostOutboxHint: string;
  windowsShareSourceHint: string;
}

export const SANTE_HL7_DEFAULTS: Record<string, string> = {
  enabled: "false",
  mode: "disabled",
  keep_internal_mwl_active: "true",
  delivery_method: "file_drop",
  output_folder_path: "",
  file_extension: ".hl7",
  success_behavior: "auto_detect",
  error_extensions: ".ERR,.err",
  mllp_host: "",
  mllp_port: "",
  mllp_timeout_seconds: "10",
  mllp_expect_ack: "true",
  scheduled_station_ae_title_default: "",
  retry_max_attempts: "5",
  retry_initial_delay_seconds: "30",
  retry_max_delay_seconds: "300",
  pending_import_timeout_seconds: "900",
  order_control_create: "NW",
  order_control_update: "XO",
  order_control_cancel: "CA",
  sending_application: "RISPRO",
  sending_facility: "RISPRO",
  receiving_application: "SANTE_WORKLIST",
  receiving_facility: "SANTE",
  hl7_version: "2.3.1",
  charset: "UNICODE UTF-8",
  patient_id_field: "identifier_value",
  patient_name_field: "english_full_name",
};

const ALLOWED_KEYS = new Set(Object.keys(SANTE_HL7_DEFAULTS));

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["true", "1", "yes", "enabled", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "disabled", "off"].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function extractSettingString(value: unknown): string {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>).value ?? "").trim();
  }
  return String(value ?? "").trim();
}

function resolvePathForBackend(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(rootDir, raw));
}

function splitPaths(raw: string): string[] {
  return raw
    .split(/[;,]/)
    .map((value) => resolvePathForBackend(value))
    .filter(Boolean);
}

function ensureUnderAllowedBase(targetPath: string, allowedBasePaths: string[]): void {
  if (!targetPath) return;
  const resolvedTarget = resolvePathForBackend(targetPath);
  const allowed = allowedBasePaths.some((basePath) => {
    const resolvedBase = resolvePathForBackend(basePath);
    const relative = path.relative(resolvedBase, resolvedTarget);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });

  if (!allowed) {
    throw new HttpError(
      400,
      "Sante output folder must be inside an allowed backend-visible base path."
    );
  }
}

function normalizeFileExtension(raw: string): ".hl7" | ".txt" {
  const value = raw.trim().toLowerCase();
  if (value === ".txt" || value === "txt") return ".txt";
  return ".hl7";
}

function normalizeMode(raw: string): SanteWorklistMode {
  if (raw === "shadow" || raw === "primary_with_internal_fallback" || raw === "sante_only") return raw;
  return "disabled";
}

function normalizeSuccessBehavior(raw: string): SanteSuccessBehavior {
  if (raw === "deleted" || raw === "don") return raw;
  return "auto_detect";
}

function normalizeDeliveryMethod(raw: string): SanteDeliveryMethod {
  return raw === "mllp" ? "mllp" : "file_drop";
}

export function getSanteAllowedBasePaths(): string[] {
  const configured = splitPaths(env.santeHl7AllowedBasePaths);
  return configured.length > 0 ? configured : [path.join(rootDir, "storage", "sante-hl7-output")];
}

export function validateSanteSettingsEntries(entries: Array<{ key: string; value?: unknown }>): void {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new HttpError(400, `${SANTE_HL7_CATEGORY} entries must be a non-empty array.`);
  }

  const incoming = new Map<string, string>();
  for (const entry of entries) {
    const key = String(entry.key || "").trim();
    if (!key) throw new HttpError(400, `Each ${SANTE_HL7_CATEGORY} entry must include a key.`);
    if (!ALLOWED_KEYS.has(key)) throw new HttpError(400, `Unsupported ${SANTE_HL7_CATEGORY} key: ${key}`);
    incoming.set(key, extractSettingString(entry.value));
  }

  const mode = normalizeMode(incoming.get("mode") || SANTE_HL7_DEFAULTS.mode);
  const enabled = parseBoolean(incoming.get("enabled"), false);
  const deliveryMethod = normalizeDeliveryMethod(incoming.get("delivery_method") || SANTE_HL7_DEFAULTS.delivery_method);
  const outputFolderPath = incoming.get("output_folder_path") || "";

  if (incoming.has("delivery_method") && !["file_drop", "mllp"].includes(incoming.get("delivery_method") || "")) {
    throw new HttpError(400, `${SANTE_HL7_CATEGORY}.delivery_method must be file_drop or mllp.`);
  }

  if (incoming.has("file_extension")) {
    const ext = incoming.get("file_extension") || "";
    if (![".hl7", "hl7", ".txt", "txt"].includes(ext.toLowerCase())) {
      throw new HttpError(400, `${SANTE_HL7_CATEGORY}.file_extension must be .hl7 or .txt.`);
    }
  }

  if (incoming.has("success_behavior")) {
    const behavior = incoming.get("success_behavior") || "";
    if (!["auto_detect", "deleted", "don"].includes(behavior)) {
      throw new HttpError(400, `${SANTE_HL7_CATEGORY}.success_behavior is invalid.`);
    }
  }

  for (const key of ["retry_max_attempts", "retry_initial_delay_seconds", "retry_max_delay_seconds", "pending_import_timeout_seconds", "mllp_timeout_seconds"]) {
    if (incoming.has(key) && parsePositiveInteger(incoming.get(key), 0) <= 0) {
      throw new HttpError(400, `${SANTE_HL7_CATEGORY}.${key} must be a positive integer.`);
    }
  }

  if (incoming.has("mllp_port") && parsePositiveInteger(incoming.get("mllp_port"), 0) <= 0) {
    throw new HttpError(400, `${SANTE_HL7_CATEGORY}.mllp_port must be a positive integer.`);
  }

  if ((enabled || mode !== "disabled") && deliveryMethod === "file_drop" && !outputFolderPath.trim()) {
    throw new HttpError(400, "Sante output folder path is required when Sante HL7 is enabled.");
  }

  if ((enabled || mode !== "disabled") && deliveryMethod === "mllp") {
    if (!normalizeOptionalText(incoming.get("mllp_host"))) {
      throw new HttpError(400, "Sante MLLP host is required when Sante HL7 MLLP is enabled.");
    }
    if (parsePositiveInteger(incoming.get("mllp_port"), 0) <= 0) {
      throw new HttpError(400, "Sante MLLP port is required when Sante HL7 MLLP is enabled.");
    }
  }

  if (outputFolderPath.trim()) {
    ensureUnderAllowedBase(outputFolderPath, getSanteAllowedBasePaths());
  }
}

export async function seedSanteWorklistDefaultsIfMissing(): Promise<void> {
  const { rows } = await pool.query(
    `select setting_key from system_settings where category = $1`,
    [SANTE_HL7_CATEGORY]
  );
  const existing = new Set(rows.map((row) => String((row as { setting_key: string }).setting_key)));
  const missing = Object.keys(SANTE_HL7_DEFAULTS).filter((key) => !existing.has(key));
  if (missing.length === 0) return;

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const key of missing) {
      await client.query(
        `
          insert into system_settings (category, setting_key, setting_value)
          values ($1, $2, $3::jsonb)
          on conflict (category, setting_key) do nothing
        `,
        [SANTE_HL7_CATEGORY, key, JSON.stringify({ value: SANTE_HL7_DEFAULTS[key] })]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveSanteWorklistSettings(): Promise<ResolvedSanteWorklistSettings> {
  const map = await loadSettingsMap([SANTE_HL7_CATEGORY]);
  const db = map[SANTE_HL7_CATEGORY] || {};
  const allowedBasePaths = getSanteAllowedBasePaths();
  const outputFolderPath = resolvePathForBackend(
    normalizeOptionalText(db.output_folder_path) || env.santeHl7OutputFolderPath
  );
  if (outputFolderPath) {
    ensureUnderAllowedBase(outputFolderPath, allowedBasePaths);
  }

  const enabled = parseBoolean(db.enabled, env.santeHl7Enabled);
  const mode = enabled ? normalizeMode(db.mode || "shadow") : "disabled";
  const deliveryMethod = normalizeDeliveryMethod(db.delivery_method || "file_drop");

  return {
    enabled: enabled && mode !== "disabled",
    mode,
    keepInternalMwlActive: true,
    deliveryMethod,
    outputFolderPath,
    fileExtension: normalizeFileExtension(db.file_extension || ".hl7"),
    successBehavior: normalizeSuccessBehavior(db.success_behavior || "auto_detect"),
    errorExtensions: (db.error_extensions || ".ERR,.err").split(",").map((value) => value.trim()).filter(Boolean),
    mllpHost: normalizeOptionalText(db.mllp_host),
    mllpPort: parsePositiveInteger(db.mllp_port, 0),
    mllpTimeoutSeconds: parsePositiveInteger(db.mllp_timeout_seconds, 10),
    mllpExpectAck: parseBoolean(db.mllp_expect_ack, true),
    scheduledStationAeTitleDefault: normalizeOptionalText(db.scheduled_station_ae_title_default),
    retryMaxAttempts: parsePositiveInteger(db.retry_max_attempts, 5),
    retryInitialDelaySeconds: parsePositiveInteger(db.retry_initial_delay_seconds, 30),
    retryMaxDelaySeconds: parsePositiveInteger(db.retry_max_delay_seconds, 300),
    pendingImportTimeoutSeconds: parsePositiveInteger(db.pending_import_timeout_seconds, 900),
    orderControlCreate: "NW",
    orderControlUpdate: "XO",
    orderControlCancel: "CA",
    sendingApplication: normalizeOptionalText(db.sending_application) || "RISPRO",
    sendingFacility: normalizeOptionalText(db.sending_facility) || "RISPRO",
    receivingApplication: normalizeOptionalText(db.receiving_application) || "SANTE_WORKLIST",
    receivingFacility: normalizeOptionalText(db.receiving_facility) || "SANTE",
    hl7Version: normalizeOptionalText(db.hl7_version) || "2.3.1",
    charset: normalizeOptionalText(db.charset) || "UNICODE UTF-8",
    patientIdField: ["mrn", "national_id", "patient_id"].includes(db.patient_id_field || "")
      ? db.patient_id_field as ResolvedSanteWorklistSettings["patientIdField"]
      : "identifier_value",
    patientNameField: db.patient_name_field === "arabic_full_name" ? "arabic_full_name" : "english_full_name",
    allowedBasePaths,
    hostOutboxHint: normalizeOptionalText(env.santeHl7HostOutboxHint),
    windowsShareSourceHint: normalizeOptionalText(env.santeHl7WindowsShareSourceHint || env.santeHl7HostOutboxHint),
  };
}

export async function testSanteOutputFolderAccess(folderPath?: string): Promise<{ ok: boolean; path: string; message: string }> {
  const settings = await resolveSanteWorklistSettings();
  const target = resolvePathForBackend(normalizeOptionalText(folderPath) || settings.outputFolderPath);
  if (!target) throw new HttpError(400, "Sante output folder path is required.");
  ensureUnderAllowedBase(target, settings.allowedBasePaths);
  await fs.mkdir(target, { recursive: true });
  await fs.access(target, fs.constants.W_OK);
  return { ok: true, path: target, message: "Folder is backend-visible and writable." };
}
