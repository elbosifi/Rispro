import dotenv from "dotenv";

dotenv.config({ override: true });

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
  seedSupervisorUsername: string;
  seedSupervisorPassword: string;
  seedSupervisorFullName: string;
  orthancMwlEnabled: boolean;
  orthancMwlShadowMode: boolean;
  orthancBaseUrl: string;
  orthancUsername: string;
  orthancPassword: string;
  orthancTimeoutSeconds: number;
  orthancVerifyTls: boolean;
  orthancWorklistTarget: string;
}

export const env: EnvConfig = {
  nodeEnv,
  isProduction,
  port: readPositiveInteger("PORT", 3000),
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
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || "8mb",
  trustProxy: readTrustProxy(),
  uploadsDir: process.env.UPLOADS_DIR || "storage/uploads",
  seedSupervisorUsername: process.env.SEED_SUPERVISOR_USERNAME || "admin",
  seedSupervisorPassword: process.env.SEED_SUPERVISOR_PASSWORD || "ChangeMe123!",
  seedSupervisorFullName: process.env.SEED_SUPERVISOR_FULL_NAME || "Supervisor",
  orthancMwlEnabled: readBoolean("ORTHANC_MWL_ENABLED", false),
  orthancMwlShadowMode: readBoolean("ORTHANC_MWL_SHADOW_MODE", false),
  orthancBaseUrl: String(process.env.ORTHANC_BASE_URL || "").trim(),
  orthancUsername: String(process.env.ORTHANC_USERNAME || "").trim(),
  orthancPassword: String(process.env.ORTHANC_PASSWORD || ""),
  orthancTimeoutSeconds: readPositiveInteger("ORTHANC_TIMEOUT_SECONDS", 10),
  orthancVerifyTls: readBoolean("ORTHANC_VERIFY_TLS", true),
  orthancWorklistTarget: String(process.env.ORTHANC_WORKLIST_TARGET || "").trim()
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
