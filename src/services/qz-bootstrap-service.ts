import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../config/env.js";
import { getQzCertificate, getQzRootCertificate, loadValidatedQzIdentity } from "./qz-signing-service.js";

export const QZ_BOOTSTRAP_VERSION = "2.2.6";
export const QZ_INSTALLER_SHA256 = "aeb93a601c27f5fa6bb464f63471e7acd43052ba384fef49dceec8290d4f7587";
export const QZ_INSTALLER_NAME = "qz-tray-2.2.6-x86_64.exe";
export const QZ_SECURE_PORTS = [8181, 8282, 8383, 8484] as const;
let installerValidationCache: { path: string; size: number; modifiedMs: number; expected: string } | null = null;

function sha256(value: Buffer | string): string { return createHash("sha256").update(value).digest("hex"); }

export function qzPublicOrigin(): string {
  const configured = String(process.env.PUBLIC_APP_BASE_URL || "").trim();
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error("PUBLIC_APP_BASE_URL is not a valid absolute URL."); }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("PUBLIC_APP_BASE_URL must contain only an origin.");
  if (url.protocol !== "https:" && (env.isProduction || url.protocol !== "http:")) throw new Error("PUBLIC_APP_BASE_URL must use HTTPS.");
  return url.origin;
}

export function qzInstallerPath(): string { return resolve(env.qzInstallerFile); }

function validateInstaller(path: string, expected: string): void {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error("The pinned QZ Tray 2.2.6 installer cache is missing or invalid.");
  if (installerValidationCache?.path === path && installerValidationCache.size === stat.size && installerValidationCache.modifiedMs === stat.mtimeMs && installerValidationCache.expected === expected) return;
  if (sha256(readFileSync(path)) !== expected) throw new Error("The pinned QZ Tray 2.2.6 installer cache is missing or invalid.");
  installerValidationCache = { path, size: stat.size, modifiedMs: stat.mtimeMs, expected };
}

export function getQzBootstrapManifest(options: { installerPath?: string; expectedInstallerSha256?: string } = {}): Record<string, unknown> {
  try {
    if (env.qzTrustMode !== "internal_ca") throw new Error("The workstation bootstrap requires QZ_TRUST_MODE=internal_ca.");
    const identity = loadValidatedQzIdentity();
    const origin = qzPublicOrigin();
    const installerPath = options.installerPath || qzInstallerPath();
    const expectedInstallerSha256 = options.expectedInstallerSha256 || QZ_INSTALLER_SHA256;
    validateInstaller(installerPath, expectedInstallerSha256);
    const root = getQzRootCertificate();
    const signing = getQzCertificate();
    return {
      schemaVersion: 1,
      ready: true,
      trustMode: identity.trustMode,
      risproOrigin: origin,
      printingSettingsUrl: `${origin}/workstation/printing`,
      qzVersion: QZ_BOOTSTRAP_VERSION,
      qzInstallerUrl: `${origin}/api/public/printing-bootstrap/qz-installer`,
      qzInstallerSha256: expectedInstallerSha256,
      qzInstallerArchitecture: "x86_64",
      rootCertificateUrl: `${origin}/api/public/printing-bootstrap/root-certificate`,
      rootCertificateSha256: sha256(root),
      rootCertificateFingerprint: identity.root!.fingerprint256,
      signingCertificateUrl: `${origin}/api/public/printing-bootstrap/signing-certificate`,
      signingCertificateSha256: sha256(signing),
      signingCertificateFingerprint: identity.signing.fingerprint256,
      securePorts: [...QZ_SECURE_PORTS],
    };
  } catch (error) {
    return { schemaVersion: 1, ready: false, reason: error instanceof Error ? error.message : "QZ printing bootstrap is unavailable." };
  }
}

export function renderQzWindowsScript(): string {
  const origin = qzPublicOrigin().replace(/'/g, "''");
  return readFileSync(resolve(env.qzWindowsScriptFile), "utf8").replace("__RISPRO_BASE_URL__", origin);
}

export const __qzBootstrapTestables = { resetInstallerValidationCache: () => { installerValidationCache = null; } };
