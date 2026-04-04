// @ts-check

import dotenv from "dotenv";

dotenv.config();

/**
 * @param {string} name
 * @param {string} [fallback]
 */
function requireEnv(name, fallback = "") {
  const value = process.env[name] ?? fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/**
 * @param {string} name
 * @param {number} fallback
 */
function readPositiveInteger(name, fallback) {
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

/**
 * @param {string} name
 * @param {boolean} [fallback]
 */
function readBoolean(name, fallback = false) {
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

/**
 * @param {string} name
 * @param {"lax" | "strict" | "none"} [fallback]
 * @returns {"lax" | "strict" | "none"}
 */
function readSameSite(name, fallback = "lax") {
  const value = (process.env[name] || fallback).toLowerCase();

  if (!["lax", "strict", "none"].includes(value)) {
    throw new Error(`${name} must be lax, strict, or none.`);
  }

  return /** @type {"lax" | "strict" | "none"} */ (value);
}

/**
 * @returns {boolean | number | string}
 */
function readTrustProxy() {
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

/**
 * @typedef EnvConfig
 * @property {string} nodeEnv
 * @property {boolean} isProduction
 * @property {number} port
 * @property {string} databaseUrl
 * @property {boolean} databaseSsl
 * @property {boolean} databaseSslRejectUnauthorized
 * @property {number} dbPoolMax
 * @property {string} jwtSecret
 * @property {string} cookieName
 * @property {string} reauthCookieName
 * @property {boolean} cookieSecure
 * @property {"lax" | "strict" | "none"} cookieSameSite
 * @property {number} sessionHours
 * @property {number} supervisorReauthMinutes
 * @property {string} requestBodyLimit
 * @property {boolean | number | string} trustProxy
 * @property {string} uploadsDir
 * @property {string} seedSupervisorUsername
 * @property {string} seedSupervisorPassword
 * @property {string} seedSupervisorFullName
 */

/** @type {EnvConfig} */
export const env = {
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
  seedSupervisorFullName: process.env.SEED_SUPERVISOR_FULL_NAME || "Supervisor"
};

if (env.cookieSameSite === "none" && !env.cookieSecure) {
  throw new Error("COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.");
}

if (isProduction && env.jwtSecret === "change-this-in-production") {
  throw new Error("JWT_SECRET must be changed before production deployment.");
}
