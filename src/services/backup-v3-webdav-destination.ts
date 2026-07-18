import crypto from "node:crypto";
import fs from "node:fs/promises";
import { HttpError } from "../utils/http-error.js";
import { sha256Buffer } from "./backup-v3-checksums.js";

export interface BackupV3WebDavConfig {
  serverUrl: string;
  username: string;
  remoteDirectory: string;
  verifyTls?: boolean;
}

export interface BackupV3WebDavCredentials {
  appPassword: string;
}

export type BackupV3Fetch = typeof fetch;

function safeRemoteSegments(value: string, label: string): string[] {
  const clean = value.trim().replace(/^\/+|\/+$/g, "");
  const segments = clean ? clean.split("/") : [];
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))) {
    throw new HttpError(400, `${label} contains an unsafe path.`);
  }
  return segments;
}

function acceptable(status: number, allowed: number[]): void {
  if (!allowed.includes(status)) throw new HttpError(502, "Nextcloud WebDAV request failed.");
}

export function validateBackupV3WebDavConfig(value: unknown): BackupV3WebDavConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Nextcloud configuration must be an object.");
  const config = value as Record<string, unknown>;
  const serverUrl = String(config.serverUrl || "").trim();
  const username = String(config.username || "").trim();
  const remoteDirectory = String(config.remoteDirectory || "").trim();
  let parsed: URL;
  try { parsed = new URL(serverUrl); } catch { throw new HttpError(400, "Nextcloud server URL must be absolute."); }
  if (parsed.protocol !== "https:") throw new HttpError(400, "Nextcloud server URL must use HTTPS.");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new HttpError(400, "Nextcloud server URL must not include credentials, query text, or a fragment.");
  if (!username || username.length > 255) throw new HttpError(400, "Nextcloud username is required.");
  safeRemoteSegments(remoteDirectory, "Nextcloud remote directory");
  if (config.verifyTls === false) throw new HttpError(400, "Disabling Nextcloud TLS verification is not supported.");
  return { serverUrl: parsed.toString().replace(/\/$/, ""), username, remoteDirectory, verifyTls: true };
}

function webDavUrl(config: BackupV3WebDavConfig, segments: string[]): URL {
  const base = new URL(config.serverUrl);
  const basePath = base.pathname.replace(/\/$/, "");
  base.pathname = `${basePath}/remote.php/dav/files/${encodeURIComponent(config.username)}/${segments.map(encodeURIComponent).join("/")}`;
  return base;
}

function authorization(config: BackupV3WebDavConfig, credentials: BackupV3WebDavCredentials): string {
  if (!credentials.appPassword) throw new HttpError(400, "Nextcloud app password is required.");
  return `Basic ${Buffer.from(`${config.username}:${credentials.appPassword}`, "utf8").toString("base64")}`;
}

async function request(fetcher: BackupV3Fetch, url: URL, method: string, authorizationHeader: string, options: RequestInit = {}): Promise<Response> {
  return fetcher(url, { ...options, method, headers: { Authorization: authorizationHeader, ...(options.headers || {}) } });
}

async function ensureDirectory(fetcher: BackupV3Fetch, config: BackupV3WebDavConfig, auth: string): Promise<void> {
  const segments = safeRemoteSegments(config.remoteDirectory, "Nextcloud remote directory");
  for (let length = 1; length <= segments.length; length += 1) {
    const response = await request(fetcher, webDavUrl(config, segments.slice(0, length)), "MKCOL", auth);
    acceptable(response.status, [201, 405]);
  }
}

export async function testBackupV3WebDavDestination(configInput: unknown, credentials: BackupV3WebDavCredentials, fetcher: BackupV3Fetch = fetch): Promise<void> {
  const config = validateBackupV3WebDavConfig(configInput);
  const auth = authorization(config, credentials);
  await ensureDirectory(fetcher, config, auth);
  const testName = `.rispro-write-test-${crypto.randomUUID()}`;
  const target = webDavUrl(config, [...safeRemoteSegments(config.remoteDirectory, "Nextcloud remote directory"), testName]);
  const put = await request(fetcher, target, "PUT", auth, { body: "RISpro backup destination test", headers: { "Content-Type": "application/octet-stream" } });
  acceptable(put.status, [201, 204]);
  const remove = await request(fetcher, target, "DELETE", auth);
  acceptable(remove.status, [200, 204]);
}

export async function copyBackupV3ToWebDavDestination(input: {
  sourcePath: string;
  archiveName: string;
  expectedSha256: string;
  expectedByteSize: number;
  config: unknown;
  credentials: BackupV3WebDavCredentials;
  fetcher?: BackupV3Fetch;
}): Promise<{ remotePath: string; byteSize: number; sha256: string }> {
  if (!input.archiveName || input.archiveName !== input.archiveName.split("/").pop() || input.archiveName.includes("..")) throw new HttpError(400, "Backup filename is unsafe.");
  const config = validateBackupV3WebDavConfig(input.config);
  const fetcher = input.fetcher || fetch;
  const auth = authorization(config, input.credentials);
  const directory = safeRemoteSegments(config.remoteDirectory, "Nextcloud remote directory");
  await ensureDirectory(fetcher, config, auth);
  const temporaryName = `.${input.archiveName}.${crypto.randomUUID()}.partial`;
  const temporaryUrl = webDavUrl(config, [...directory, temporaryName]);
  const finalUrl = webDavUrl(config, [...directory, input.archiveName]);
  try {
    const content = await fs.readFile(input.sourcePath);
    if (content.byteLength !== input.expectedByteSize || sha256Buffer(content) !== input.expectedSha256) throw new HttpError(500, "Local backup archive changed before upload.");
    const put = await request(fetcher, temporaryUrl, "PUT", auth, { body: content, headers: { "Content-Type": "application/octet-stream" } });
    acceptable(put.status, [201, 204]);
    const readBack = await request(fetcher, temporaryUrl, "GET", auth);
    acceptable(readBack.status, [200]);
    const readBackContent = Buffer.from(await readBack.arrayBuffer());
    if (readBackContent.byteLength !== input.expectedByteSize || sha256Buffer(readBackContent) !== input.expectedSha256) throw new HttpError(500, "Nextcloud upload verification failed.");
    const move = await request(fetcher, temporaryUrl, "MOVE", auth, { headers: { Destination: finalUrl.toString(), Overwrite: "F" } });
    acceptable(move.status, [201, 204]);
    return { remotePath: finalUrl.pathname, byteSize: readBackContent.byteLength, sha256: sha256Buffer(readBackContent) };
  } catch (error) {
    await request(fetcher, temporaryUrl, "DELETE", auth).catch(() => undefined);
    throw error;
  }
}

/** Deletes only a RISpro archive name under the configured WebDAV directory. */
export async function deleteBackupV3WebDavDestinationCopy(input: { remotePath: string; config: unknown; credentials: BackupV3WebDavCredentials; fetcher?: BackupV3Fetch }): Promise<void> {
  const config = validateBackupV3WebDavConfig(input.config);
  const name = input.remotePath.split("/").filter(Boolean).pop() || "";
  if (!/^[A-Za-z0-9._-]+\.rispro\.zip$/.test(name) || name.includes("..")) throw new HttpError(400, "Remote backup archive path is unsafe.");
  const response = await request(input.fetcher || fetch, webDavUrl(config, [...safeRemoteSegments(config.remoteDirectory, "Nextcloud remote directory"), name]), "DELETE", authorization(config, input.credentials));
  acceptable(response.status, [200, 204, 404]);
}
