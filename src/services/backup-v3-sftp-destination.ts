import crypto from "node:crypto";
import fs from "node:fs/promises";
import SftpClient from "ssh2-sftp-client";
import { HttpError } from "../utils/http-error.js";
import { sha256Buffer } from "./backup-v3-checksums.js";

export interface BackupV3SftpConfig {
  host: string;
  port: number;
  username: string;
  authenticationType: "password" | "private_key";
  remoteDirectory: string;
  hostKeyFingerprint: string;
  timeoutMs: number;
}

export interface BackupV3SftpCredentials {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface BackupV3SftpClient {
  connect(options: Parameters<SftpClient["connect"]>[0]): Promise<unknown>;
  mkdir(remoteFilePath: string, recursive?: boolean): Promise<string>;
  put(input: string | Buffer, remoteFilePath: string): Promise<string>;
  get(remoteFilePath: string): Promise<string | NodeJS.WritableStream | Buffer>;
  rename(remoteSourcePath: string, remoteDestPath: string): Promise<string>;
  posixRename(remoteSourcePath: string, remoteDestPath: string): Promise<string>;
  delete(remoteFilePath: string, noErrorOK?: boolean): Promise<string>;
  end(): Promise<boolean>;
}

export type BackupV3SftpClientFactory = () => BackupV3SftpClient;

function safeRemoteDirectory(value: string): string {
  const clean = value.trim();
  if (!clean.startsWith("/")) throw new HttpError(400, "SFTP remote backup directory must be absolute.");
  const segments = clean.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))) throw new HttpError(400, "SFTP remote backup directory contains an unsafe path.");
  return `/${segments.join("/")}`;
}

function safeRemoteFile(directory: string, filename: string): string {
  if (!filename || filename !== filename.split("/").pop() || filename.includes("..") || filename.includes("\\")) throw new HttpError(400, "Backup filename is unsafe.");
  return `${directory}/${filename}`;
}

function normalizeFingerprint(value: string): string {
  const clean = value.trim();
  if (!/^SHA256:[A-Za-z0-9+/]+={0,2}$/.test(clean)) throw new HttpError(400, "SFTP host-key fingerprint must use SHA256:base64 format.");
  return `SHA256:${clean.slice("SHA256:".length).replace(/=+$/, "")}`;
}

export function validateBackupV3SftpConfig(value: unknown): BackupV3SftpConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "SFTP configuration must be an object.");
  const config = value as Record<string, unknown>;
  const host = String(config.host || "").trim();
  const username = String(config.username || "").trim();
  const authenticationType = String(config.authenticationType || "") as BackupV3SftpConfig["authenticationType"];
  const port = Number(config.port || 22);
  const timeoutMs = Number(config.timeoutMs || 10_000);
  if (!host || host.length > 255 || /[\s/\\]/.test(host)) throw new HttpError(400, "SFTP host is invalid.");
  if (!username || username.length > 255) throw new HttpError(400, "SFTP username is required.");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new HttpError(400, "SFTP port is invalid.");
  if (authenticationType !== "password" && authenticationType !== "private_key") throw new HttpError(400, "SFTP authentication type is invalid.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) throw new HttpError(400, "SFTP timeout must be between 1000 and 120000 ms.");
  return { host, port, username, authenticationType, remoteDirectory: safeRemoteDirectory(String(config.remoteDirectory || "")), hostKeyFingerprint: normalizeFingerprint(String(config.hostKeyFingerprint || "")), timeoutMs };
}

function connectOptions(config: BackupV3SftpConfig, credentials: BackupV3SftpCredentials): Parameters<SftpClient["connect"]>[0] {
  const expected = config.hostKeyFingerprint;
  const hostVerifier = (key: Buffer) => {
    const actual = `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  };
  if (config.authenticationType === "password") {
    if (!credentials.password) throw new HttpError(400, "SFTP password is required.");
    return { host: config.host, port: config.port, username: config.username, password: credentials.password, readyTimeout: config.timeoutMs, hostVerifier };
  }
  if (!credentials.privateKey) throw new HttpError(400, "SFTP private key is required.");
  return { host: config.host, port: config.port, username: config.username, privateKey: credentials.privateKey, passphrase: credentials.passphrase, readyTimeout: config.timeoutMs, hostVerifier };
}

function defaultClientFactory(): BackupV3SftpClient { return new SftpClient(undefined, { error: () => undefined, end: () => undefined, close: () => undefined }); }

async function withSftp<T>(configInput: unknown, credentials: BackupV3SftpCredentials, action: (client: BackupV3SftpClient, config: BackupV3SftpConfig) => Promise<T>, factory: BackupV3SftpClientFactory = defaultClientFactory): Promise<T> {
  const config = validateBackupV3SftpConfig(configInput);
  const client = factory();
  try {
    await client.connect(connectOptions(config, credentials));
    return await action(client, config);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function testBackupV3SftpDestination(config: unknown, credentials: BackupV3SftpCredentials, factory?: BackupV3SftpClientFactory): Promise<void> {
  await withSftp(config, credentials, async (client, parsed) => {
    await client.mkdir(parsed.remoteDirectory, true);
    const testPath = safeRemoteFile(parsed.remoteDirectory, `.rispro-write-test-${crypto.randomUUID()}`);
    await client.put(Buffer.from("RISpro backup destination test"), testPath);
    const content = await client.get(testPath);
    if (!Buffer.isBuffer(content)) throw new HttpError(502, "SFTP destination did not return a readable test file.");
    await client.delete(testPath, true);
  }, factory);
}

export async function copyBackupV3ToSftpDestination(input: {
  sourcePath: string;
  archiveName: string;
  expectedSha256: string;
  expectedByteSize: number;
  config: unknown;
  credentials: BackupV3SftpCredentials;
  factory?: BackupV3SftpClientFactory;
}): Promise<{ remotePath: string; byteSize: number; sha256: string }> {
  return withSftp(input.config, input.credentials, async (client, config) => {
    const archive = await fs.readFile(input.sourcePath);
    if (archive.byteLength !== input.expectedByteSize || sha256Buffer(archive) !== input.expectedSha256) throw new HttpError(500, "Local backup archive changed before upload.");
    await client.mkdir(config.remoteDirectory, true);
    const finalPath = safeRemoteFile(config.remoteDirectory, input.archiveName);
    const temporaryPath = safeRemoteFile(config.remoteDirectory, `.${input.archiveName}.${crypto.randomUUID()}.partial`);
    try {
      await client.put(archive, temporaryPath);
      const readBack = await client.get(temporaryPath);
      if (!Buffer.isBuffer(readBack) || readBack.byteLength !== input.expectedByteSize || sha256Buffer(readBack) !== input.expectedSha256) throw new HttpError(500, "SFTP upload verification failed.");
      await client.posixRename(temporaryPath, finalPath).catch(() => client.rename(temporaryPath, finalPath));
      return { remotePath: finalPath, byteSize: readBack.byteLength, sha256: sha256Buffer(readBack) };
    } catch (error) {
      await client.delete(temporaryPath, true).catch(() => undefined);
      throw error;
    }
  }, input.factory);
}

/** Deletes only a filename under the configured SFTP backup directory. */
export async function deleteBackupV3SftpDestinationCopy(input: { remotePath: string; config: unknown; credentials: BackupV3SftpCredentials; factory?: BackupV3SftpClientFactory }): Promise<void> {
  await withSftp(input.config, input.credentials, async (client, config) => {
    const name = input.remotePath.split("/").filter(Boolean).pop() || "";
    const target = safeRemoteFile(config.remoteDirectory, name);
    if (!target.endsWith(".rispro.zip")) throw new HttpError(400, "Remote backup archive path is unsafe.");
    await client.delete(target, false);
  }, input.factory);
}
