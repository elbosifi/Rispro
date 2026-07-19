import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type SftpClient from "ssh2-sftp-client";
import { sha256File } from "./backup-v3-checksums.js";
import { copyBackupV3ToSftpDestination, deleteBackupV3SftpDestinationCopy, testBackupV3SftpDestination, validateBackupV3SftpConfig, type BackupV3SftpClient, type BackupV3SftpClientFactory } from "./backup-v3-sftp-destination.js";

const hostKey = Buffer.from("known-sftp-host-key");
const fingerprint = `SHA256:${crypto.createHash("sha256").update(hostKey).digest("base64").replace(/=+$/, "")}`;
const config = { host: "sftp.example", port: 2222, username: "backup", authenticationType: "password", remoteDirectory: "/rispro/backups", hostKeyFingerprint: fingerprint, timeoutMs: 15_000 };

function fakeSftp(): { factory: BackupV3SftpClientFactory; files: Map<string, Buffer>; options: Parameters<SftpClient["connect"]>[0] | null } {
  const files = new Map<string, Buffer>();
  let options: Parameters<SftpClient["connect"]>[0] | null = null;
  const client: BackupV3SftpClient = {
    async connect(value) { options = value; const verifier = value.hostVerifier as ((key: Buffer) => boolean) | undefined; assert.equal(verifier?.(hostKey), true); },
    async mkdir() { return "created"; },
    async put(input, remotePath) {
      const content = Buffer.isBuffer(input) ? input : typeof input === "string" ? await fs.readFile(input) : Buffer.concat(await (async () => { const chunks: Buffer[] = []; for await (const chunk of input) chunks.push(Buffer.from(chunk)); return chunks; })());
      files.set(remotePath, content); return "uploaded";
    },
    async get(remotePath, destination) { const content = files.get(remotePath) || Buffer.alloc(0); if (destination) { destination.end(content); return destination; } return content; },
    async rename(from, to) { const content = files.get(from); if (!content) throw new Error("missing"); files.delete(from); files.set(to, content); return "renamed"; },
    async posixRename(from, to) { return this.rename(from, to); },
    async delete(remotePath) { files.delete(remotePath); return "deleted"; },
    async end() { return true; },
  };
  return { factory: () => client, files, get options() { return options; } };
}

test("SFTP uploads through a host-key-verified connection and checks read-back before rename", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-sftp-"));
  const source = path.join(tempDir, "backup.rispro.zip");
  await fs.writeFile(source, "encrypted archive");
  const digest = await sha256File(source);
  const fake = fakeSftp();
  try {
    const copy = await copyBackupV3ToSftpDestination({ sourcePath: source, archiveName: "backup.rispro.zip", expectedSha256: digest.sha256, expectedByteSize: digest.byteSize, config, credentials: { password: "not-returned" }, factory: fake.factory });
    assert.equal(copy.sha256, digest.sha256);
    assert.equal(fake.options?.password, "not-returned");
    assert.equal(fake.files.size, 1);
    assert.ok([...fake.files.keys()][0]?.endsWith("/backup.rispro.zip"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("SFTP destination test uses a temporary write and removes it", async () => {
  const fake = fakeSftp();
  await testBackupV3SftpDestination(config, { password: "not-returned" }, fake.factory);
  assert.equal(fake.files.size, 0);
});

test("SFTP retention deletion stays inside the configured directory", async () => {
  const fake = fakeSftp();
  fake.files.set("/rispro/backups/backup.rispro.zip", Buffer.from("archive"));
  await deleteBackupV3SftpDestinationCopy({ remotePath: "/rispro/backups/backup.rispro.zip", config, credentials: { password: "not-returned" }, factory: fake.factory });
  assert.equal(fake.files.size, 0);
  await assert.rejects(() => deleteBackupV3SftpDestinationCopy({ remotePath: "/outside/not-a-backup.txt", config, credentials: { password: "not-returned" }, factory: fake.factory }), /unsafe/);
});

test("SFTP rejects an unknown host key, unsafe remote path, and missing private key", async () => {
  const unsafe = { ...config, remoteDirectory: "/rispro/../outside" };
  assert.throws(() => validateBackupV3SftpConfig(unsafe), /unsafe/);
  const fake = fakeSftp();
  await assert.rejects(
    () => testBackupV3SftpDestination({ ...config, hostKeyFingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" }, { password: "not-returned" }, fake.factory),
    /AssertionError/
  );
  await assert.rejects(
    () => testBackupV3SftpDestination({ ...config, authenticationType: "private_key" }, {}, fake.factory),
    /private key is required/
  );
});
