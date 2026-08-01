import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "../config/env.js";
import { getQzCertificate, getQzRootCertificate, loadValidatedQzIdentity } from "./qz-signing-service.js";

export const QZ_BOOTSTRAP_VERSION = "2.2.6";
export const QZ_INSTALLER_SHA256 = "aeb93a601c27f5fa6bb464f63471e7acd43052ba384fef49dceec8290d4f7587";
export const QZ_INSTALLER_NAME = "qz-tray-2.2.6-x86_64.exe";
export const QZ_SECURE_PORTS = [8181, 8282, 8383, 8484] as const;

export type QzInstallerSnapshot = { path: string; size: number; modifiedMs: number; expected: string };
type HashFile = (path: string) => Promise<string>;
let installerValidationCache: QzInstallerSnapshot | null = null;
let installerValidationInFlight: { key: string; promise: Promise<QzInstallerSnapshot> } | null = null;

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

export async function hashFileSha256(path: string): Promise<string> {
  return await new Promise<string>((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function snapshotKey(snapshot: QzInstallerSnapshot): string {
  return `${snapshot.path}\0${snapshot.size}\0${snapshot.modifiedMs}\0${snapshot.expected}`;
}

export async function validateQzInstaller(options: { installerPath?: string; expectedInstallerSha256?: string; hashFile?: HashFile } = {}): Promise<QzInstallerSnapshot> {
  const path = resolve(options.installerPath || qzInstallerPath());
  const expected = options.expectedInstallerSha256 || QZ_INSTALLER_SHA256;
  const file = await stat(path);
  if (!file.isFile()) throw new Error("The pinned QZ Tray 2.2.6 installer cache is missing or invalid.");
  const snapshot = { path, size: file.size, modifiedMs: file.mtimeMs, expected };
  const key = snapshotKey(snapshot);
  if (installerValidationCache && snapshotKey(installerValidationCache) === key) return installerValidationCache;
  if (installerValidationInFlight?.key === key) return await installerValidationInFlight.promise;

  const promise = (async () => {
    if (await (options.hashFile || hashFileSha256)(path) !== expected) throw new Error("The pinned QZ Tray 2.2.6 installer cache is missing or invalid.");
    installerValidationCache = snapshot;
    return snapshot;
  })();
  installerValidationInFlight = { key, promise };
  try { return await promise; } finally { if (installerValidationInFlight?.promise === promise) installerValidationInFlight = null; }
}

export function renderQzWindowsScript(): string {
  const origin = qzPublicOrigin().replace(/'/g, "''");
  return readFileSync(resolve(env.qzWindowsScriptFile), "utf8").replaceAll("__RISPRO_BASE_URL__", origin);
}

export function qzWindowsScriptSha256(): string { return sha256(Buffer.from(renderQzWindowsScript(), "utf8")); }

export function renderQzWindowsLauncher(): string {
  const origin = qzPublicOrigin();
  const scriptUrl = `${origin}/api/public/printing-bootstrap/windows-script`;
  const scriptHash = qzWindowsScriptSha256();
  return `@echo off\r
setlocal EnableExtensions DisableDelayedExpansion\r
set "RISPRO_ORIGIN=${origin}"\r
set "RISPRO_SCRIPT_URL=${scriptUrl}"\r
set "RISPRO_SCRIPT_SHA256=${scriptHash}"\r
set "RISPRO_SCRIPT_FILE="\r
for /f "delims=" %%I in ('powershell.exe -NoProfile -Command "[IO.Path]::Combine([IO.Path]::GetTempPath(), 'RISpro-Printing-' + [guid]::NewGuid().ToString('N') + '.ps1')"') do set "RISPRO_SCRIPT_FILE=%%I"\r
if not defined RISPRO_SCRIPT_FILE exit /b 20\r
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; $u=[Uri]$env:RISPRO_SCRIPT_URL; $o=[Uri]$env:RISPRO_ORIGIN; if($u.Scheme -ne 'https' -or $u.GetLeftPart([UriPartial]::Authority) -ne $o.AbsoluteUri.TrimEnd('/') -or $u.AbsoluteUri -ne ($o.AbsoluteUri.TrimEnd('/') + '/api/public/printing-bootstrap/windows-script')){exit 21}; Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Uri $u.AbsoluteUri -OutFile $env:RISPRO_SCRIPT_FILE; if((Get-Item -LiteralPath $env:RISPRO_SCRIPT_FILE).Length -le 0){exit 22}; if((Get-FileHash -LiteralPath $env:RISPRO_SCRIPT_FILE -Algorithm SHA256).Hash.ToLowerInvariant() -ne $env:RISPRO_SCRIPT_SHA256){exit 23}"\r
if errorlevel 1 (set "RISPRO_EXIT=%ERRORLEVEL%" & goto cleanup)\r
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%RISPRO_SCRIPT_FILE%" -RisproBaseUrl "%RISPRO_ORIGIN%"\r
set "RISPRO_EXIT=%ERRORLEVEL%"\r
:cleanup\r
if defined RISPRO_SCRIPT_FILE del /f /q "%RISPRO_SCRIPT_FILE%" >nul 2>&1\r
exit /b %RISPRO_EXIT%\r
`;
}

export async function getQzBootstrapManifest(options: { installerPath?: string; expectedInstallerSha256?: string; hashFile?: HashFile } = {}): Promise<Record<string, unknown>> {
  try {
    if (env.qzTrustMode !== "internal_ca") throw new Error("The workstation bootstrap requires QZ_TRUST_MODE=internal_ca.");
    const identity = loadValidatedQzIdentity();
    const origin = qzPublicOrigin();
    const expectedInstallerSha256 = options.expectedInstallerSha256 || QZ_INSTALLER_SHA256;
    await validateQzInstaller({ ...options, expectedInstallerSha256 });
    const root = getQzRootCertificate();
    const signing = getQzCertificate();
    return {
      schemaVersion: 1, ready: true, trustMode: identity.trustMode, risproOrigin: origin,
      printingSettingsUrl: `${origin}/workstation/printing`, qzVersion: QZ_BOOTSTRAP_VERSION,
      qzInstallerUrl: `${origin}/api/public/printing-bootstrap/qz-installer`, qzInstallerSha256: expectedInstallerSha256,
      qzInstallerArchitecture: "x86_64", rootCertificateUrl: `${origin}/api/public/printing-bootstrap/root-certificate`,
      rootCertificateSha256: sha256(root), rootCertificateFingerprint: identity.root!.fingerprint256,
      signingCertificateUrl: `${origin}/api/public/printing-bootstrap/signing-certificate`, signingCertificateSha256: sha256(signing),
      signingCertificateFingerprint: identity.signing.fingerprint256,
      windowsScriptUrl: `${origin}/api/public/printing-bootstrap/windows-script`, windowsScriptSha256: qzWindowsScriptSha256(),
      windowsLauncherUrl: `${origin}/api/public/printing-bootstrap/windows-launcher`, securePorts: [...QZ_SECURE_PORTS],
    };
  } catch (error) {
    return { schemaVersion: 1, ready: false, reason: error instanceof Error ? error.message : "QZ printing bootstrap is unavailable." };
  }
}

export const __qzBootstrapTestables = {
  resetInstallerValidationCache: () => { installerValidationCache = null; installerValidationInFlight = null; },
};
