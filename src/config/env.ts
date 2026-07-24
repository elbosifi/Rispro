import dotenv from "dotenv";
import { readRequestScanMaxConcurrency } from "./request-scan-concurrency.js";

// E2E is deliberately isolated from a developer's .env so its guard can never
// be redirected to a local or deployed database by dotenv's override behavior.
dotenv.config({ override: process.env.RISPRO_E2E !== "1" });

function requireEnv(name: string, fallback = ""): string {
  const value = process.env[name] ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readPositiveInteger(name: string, fallback: number): number {
  const rawValue = process.env[name];

  if (rawValue == null || rawValue === "") {
    return fallback;
  }

  const parsedValue = Number(rawValue);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsedValue;
}

function readBoolean(name: string, fallback = false): boolean {
  const rawValue = process.env[name];

  if (rawValue == null || rawValue === "") {
    return fallback;
  }

  if (["true", "1", "yes"].includes(String(rawValue).toLowerCase())) {
    return true;
  }

  if (["false", "0", "no"].includes(String(rawValue).toLowerCase())) {
    return false;
  }

  throw new Error(`${name} must be true or false.`);
}

function readSameSite(name: string, fallback: "lax" | "strict" | "none" = "lax"): "lax" | "strict" | "none" {
  const value = (process.env[name] || fallback).toLowerCase();

  if (!["lax", "strict", "none"].includes(value)) {
    throw new Error(`${name} must be lax, strict, or none.`);
  }

  return value as "lax" | "strict" | "none";
}

function readTrustProxy(): boolean | number | string {
  const rawValue = process.env.TRUST_PROXY;

  if (!rawValue) {
    return false;
  }

  if (["true", "false"].includes(rawValue.toLowerCase())) {
    return rawValue.toLowerCase() === "true";
  }

  const parsedValue = Number(rawValue);

  if (Number.isInteger(parsedValue) && parsedValue >= 0) {
    return parsedValue;
  }

  return rawValue;
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

export interface EnvConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  risproDbMode: "internal" | "external";
  risproDicomMode: "embedded" | "orthanc_internal" | "orthanc_external";
  risproMppsMode: "disabled" | "internal_bridge";
  databaseUrl: string;
  databaseSsl: boolean;
  databaseSslRejectUnauthorized: boolean;
  dbPoolMax: number;
  jwtSecret: string;
  cookieName: string;
  reauthCookieName: string;
  cookieSecure: boolean;
  cookieSameSite: "lax" | "strict" | "none";
  sessionHours: number;
  supervisorReauthMinutes: number;
  requestBodyLimit: string;
  trustProxy: boolean | number | string;
  uploadsDir: string;
  dicomRemapStagingDir: string;
  scanSessionTokenSecret: string;
  naps2WebscanEnabled: boolean;
  naps2WebscanEndpoint: string;
  seedSupervisorUsername: string;
  seedSupervisorPassword: string;
  seedSupervisorFullName: string;
  seedSuperAdminUsername: string;
  seedSuperAdminPassword: string;
  seedSuperAdminFullName: string;
  orthancAuthEnabled: boolean;
  orthancMwlEnabled: boolean;
  orthancMwlShadowMode: boolean;
  orthancBaseUrl: string;
  orthancUsername: string;
  orthancPassword: string;
  orthancTimeoutSeconds: number;
  orthancVerifyTls: boolean;
  orthancWorklistTarget: string;
  santeHl7Enabled: boolean;
  santeHl7OutputFolderPath: string;
  santeHl7AllowedBasePaths: string;
  santeHl7HostOutboxHint: string;
  santeHl7WindowsShareSourceHint: string;
  mppsBridgePort: number;
  mppsBridgeAeTitle: string;
  mppsAuthEnabled: boolean;
  mppsUsername: string;
  mppsPassword: string;
  webPushEnabled: boolean;
  webPushVapidPublicKey: string;
  webPushVapidPrivateKey: string;
  webPushVapidSubject: string;
  webPushReminderHours: number;
  webPushWorkerIntervalSeconds: number;
  webPushDeliveryMaxAttempts: number;
  webPushReportReadyScanIntervalSeconds: number;
  webPushReportReadyLookbackDays: number;
  webPushReportReadyMaxChecksPerRun: number;
  doctorPortalEnabled: boolean;
  doctorPortalAutoRedirect: boolean;
  ohifEnabled: boolean;
  ohifPublicBaseUrl: string;
  ohifDicomWebProxyPath: string;
  ohifContainerUrl: string;
  ohifSessionCookieName: string;
  ohifLaunchTokenTtlSeconds: number;
  ohifRetrievalWorkerIntervalMs: number;
  ohifCacheCleanupEnabled: boolean;
  requestScanWorkerProcessEnabled: boolean;
  requestScanMaxConcurrency: 1 | 2;
}

function readDeploymentEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const rawValue = String(process.env[name] || fallback).trim() as T;

  if (!allowed.includes(rawValue)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }

  return rawValue;
}

export const env: EnvConfig = {
  nodeEnv,
  isProduction,
  port: readPositiveInteger("PORT", 3000),
  risproDbMode: readDeploymentEnum("RISPRO_DB_MODE", ["internal", "external"], "external"),
  risproDicomMode: readDeploymentEnum(
    "RISPRO_DICOM_MODE",
    ["embedded", "orthanc_internal", "orthanc_external"],
    "embedded"
  ),
  risproMppsMode: readDeploymentEnum("RISPRO_MPPS_MODE", ["disabled", "internal_bridge"], "disabled"),
  databaseUrl: requireEnv("DATABASE_URL"),
  databaseSsl: readBoolean("DATABASE_SSL", isProduction),
  databaseSslRejectUnauthorized: readBoolean("DATABASE_SSL_REJECT_UNAUTHORIZED", false),
  dbPoolMax: readPositiveInteger("DB_POOL_MAX", 10),
  jwtSecret: requireEnv("JWT_SECRET"),
  cookieName: process.env.COOKIE_NAME || "rispro_session",
  reauthCookieName: process.env.REAUTH_COOKIE_NAME || "rispro_supervisor_reauth",
  cookieSecure: readBoolean("COOKIE_SECURE", isProduction),
  cookieSameSite: readSameSite("COOKIE_SAME_SITE", "lax"),
  sessionHours: readPositiveInteger("SESSION_HOURS", 8),
  supervisorReauthMinutes: readPositiveInteger("SUPERVISOR_REAUTH_MINUTES", 10),
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "75mb",
  trustProxy: readTrustProxy(),
  uploadsDir: process.env.UPLOADS_DIR || "storage/uploads",
  dicomRemapStagingDir: String(process.env.DICOM_REMAP_STAGING_DIR || "storage/dicom/remap-staging").trim(),
  scanSessionTokenSecret: process.env.SCAN_SESSION_TOKEN_SECRET || process.env.JWT_SECRET || "",
  naps2WebscanEnabled: readBoolean("NAPS2_WEBSCAN_ENABLED", false),
  naps2WebscanEndpoint: String(process.env.NAPS2_WEBSCAN_ENDPOINT || "").trim(),
  seedSupervisorUsername: process.env.SEED_SUPERVISOR_USERNAME || "admin",
  seedSupervisorPassword: process.env.SEED_SUPERVISOR_PASSWORD || "ChangeMe123!",
  seedSupervisorFullName: process.env.SEED_SUPERVISOR_FULL_NAME || "Supervisor",
  seedSuperAdminUsername: process.env.SEED_SUPER_ADMIN_USERNAME || "superadmin",
  seedSuperAdminPassword: process.env.SEED_SUPER_ADMIN_PASSWORD || "superadmin",
  seedSuperAdminFullName: process.env.SEED_SUPER_ADMIN_FULL_NAME || "Super Administrator",
  orthancAuthEnabled: readBoolean("ORTHANC_AUTH_ENABLED", false),
  orthancMwlEnabled: readBoolean("ORTHANC_MWL_ENABLED", false),
  orthancMwlShadowMode: readBoolean("ORTHANC_MWL_SHADOW_MODE", false),
  orthancBaseUrl: String(process.env.ORTHANC_BASE_URL || "").trim(),
  orthancUsername: String(process.env.ORTHANC_USERNAME || "").trim(),
  orthancPassword: String(process.env.ORTHANC_PASSWORD || ""),
  orthancTimeoutSeconds: readPositiveInteger("ORTHANC_TIMEOUT_SECONDS", 10),
  orthancVerifyTls: readBoolean("ORTHANC_VERIFY_TLS", true),
  orthancWorklistTarget: String(process.env.ORTHANC_WORKLIST_TARGET || "").trim(),
  santeHl7Enabled: readBoolean("SANTE_HL7_ENABLED", false),
  santeHl7OutputFolderPath: String(process.env.SANTE_HL7_OUTPUT_FOLDER_PATH || "").trim(),
  santeHl7AllowedBasePaths: String(process.env.SANTE_HL7_ALLOWED_BASE_PATHS || "storage/sante-hl7-output").trim(),
  santeHl7HostOutboxHint: String(process.env.SANTE_HL7_HOST_OUTBOX_HINT || "").trim(),
  santeHl7WindowsShareSourceHint: String(process.env.SANTE_HL7_WINDOWS_SHARE_SOURCE_HINT || "").trim(),
  mppsBridgePort: readPositiveInteger("MPPS_BRIDGE_PORT", 11113),
  mppsBridgeAeTitle: String(process.env.MPPS_BRIDGE_AE_TITLE || "RISPRO_MPPS").trim(),
  mppsAuthEnabled: readBoolean("MPPS_AUTH_ENABLED", false),
  mppsUsername: String(process.env.MPPS_USERNAME || "").trim(),
  mppsPassword: String(process.env.MPPS_PASSWORD || ""),
  webPushEnabled: readBoolean("WEB_PUSH_ENABLED", false),
  webPushVapidPublicKey: String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim(),
  webPushVapidPrivateKey: String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim(),
  webPushVapidSubject: String(process.env.WEB_PUSH_VAPID_SUBJECT || "").trim(),
  webPushReminderHours: readPositiveInteger("WEB_PUSH_REMINDER_HOURS", 24),
  webPushWorkerIntervalSeconds: readPositiveInteger("WEB_PUSH_WORKER_INTERVAL_SECONDS", 60),
  webPushDeliveryMaxAttempts: readPositiveInteger("WEB_PUSH_DELIVERY_MAX_ATTEMPTS", 5),
  webPushReportReadyScanIntervalSeconds: readPositiveInteger("WEB_PUSH_REPORT_READY_SCAN_INTERVAL_SECONDS", 300),
  webPushReportReadyLookbackDays: readPositiveInteger("WEB_PUSH_REPORT_READY_LOOKBACK_DAYS", 14),
  webPushReportReadyMaxChecksPerRun: readPositiveInteger("WEB_PUSH_REPORT_READY_MAX_CHECKS_PER_RUN", 25),
  doctorPortalEnabled: readBoolean("DOCTOR_PORTAL_ENABLED", true),
  doctorPortalAutoRedirect: readBoolean("DOCTOR_PORTAL_AUTO_REDIRECT", true),
  ohifEnabled: readBoolean("OHIF_ENABLED", false),
  ohifPublicBaseUrl: String(process.env.OHIF_PUBLIC_BASE_URL || "/ohif").trim(),
  ohifDicomWebProxyPath: String(process.env.OHIF_DICOMWEB_PROXY_PATH || "/ohif-dicomweb").trim(),
  ohifContainerUrl: String(process.env.OHIF_CONTAINER_URL || "http://ohif:80").trim(),
  ohifSessionCookieName: String(process.env.OHIF_SESSION_COOKIE_NAME || "rispro_ohif_session").trim(),
  ohifLaunchTokenTtlSeconds: readPositiveInteger("OHIF_LAUNCH_TOKEN_TTL_SECONDS", 600),
  ohifRetrievalWorkerIntervalMs: readPositiveInteger("OHIF_RETRIEVAL_WORKER_INTERVAL_MS", 5000),
  ohifCacheCleanupEnabled: readBoolean("OHIF_CACHE_CLEANUP_ENABLED", false),
  // Missing values preserve the original in-process Request Scan behavior.
  requestScanWorkerProcessEnabled: readBoolean("REQUEST_SCAN_WORKER_PROCESS_ENABLED", true),
  requestScanMaxConcurrency: readRequestScanMaxConcurrency(process.env.REQUEST_SCAN_MAX_CONCURRENCY),
};

if (env.cookieSameSite === "none" && !env.cookieSecure) {
  throw new Error("COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.");
}

if (isProduction && env.jwtSecret === "change-this-in-production") {
  throw new Error("JWT_SECRET must be changed before production deployment.");
}

if (env.orthancMwlEnabled && !env.orthancBaseUrl) {
  throw new Error("ORTHANC_BASE_URL is required when ORTHANC_MWL_ENABLED=true.");
}

if (env.orthancAuthEnabled && (!env.orthancUsername || !env.orthancPassword)) {
  throw new Error("ORTHANC_USERNAME and ORTHANC_PASSWORD are required when ORTHANC_AUTH_ENABLED=true.");
}

if (env.risproMppsMode === "internal_bridge" && !env.mppsBridgeAeTitle) {
  throw new Error("MPPS_BRIDGE_AE_TITLE is required when RISPRO_MPPS_MODE=internal_bridge.");
}

if (env.mppsAuthEnabled && (!env.mppsUsername || !env.mppsPassword)) {
  throw new Error("MPPS_USERNAME and MPPS_PASSWORD are required when MPPS_AUTH_ENABLED=true.");
}

if (env.webPushEnabled) {
  if (!env.webPushVapidPublicKey || !env.webPushVapidPrivateKey || !env.webPushVapidSubject) {
    throw new Error("WEB_PUSH_ENABLED=true requires WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, and WEB_PUSH_VAPID_SUBJECT.");
  }

  if (!/^(mailto:.+@.+|https?:\/\/.+)/i.test(env.webPushVapidSubject)) {
    throw new Error("WEB_PUSH_VAPID_SUBJECT must be a mailto: address or absolute http(s) URL when WEB_PUSH_ENABLED=true.");
  }
}

for (const [name, value] of [["OHIF_PUBLIC_BASE_URL", env.ohifPublicBaseUrl], ["OHIF_DICOMWEB_PROXY_PATH", env.ohifDicomWebProxyPath]] as const) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("..") || value.includes("?") || value.includes("#")) {
    throw new Error(`${name} must be a safe root-relative path.`);
  }
}

if (env.ohifEnabled && !/^https?:\/\//i.test(env.ohifContainerUrl)) {
  throw new Error("OHIF_CONTAINER_URL must be an absolute http(s) URL when OHIF is enabled.");
}
