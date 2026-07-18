import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sha256File } from "./backup-v3-checksums.js";
import { copyBackupV3ToWebDavDestination, deleteBackupV3WebDavDestinationCopy, testBackupV3WebDavDestination, validateBackupV3WebDavConfig } from "./backup-v3-webdav-destination.js";

function inMemoryWebDav(options: { corruptReadBack?: boolean } = {}) {
  const files = new Map<string, Buffer>();
  const calls: Array<{ method: string; url: string }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method || "GET";
    calls.push({ method, url });
    if (method === "MKCOL") return new Response(null, { status: 201 });
    if (method === "PUT") {
      const body = init?.body;
      const content = Buffer.isBuffer(body) ? body : Buffer.from(body instanceof Uint8Array ? body : String(body || ""));
      files.set(url, content);
      return new Response(null, { status: 201 });
    }
    if (method === "GET") {
      const content = files.get(url);
      return content ? new Response(new Uint8Array(options.corruptReadBack ? Buffer.from("changed") : content), { status: 200 }) : new Response(null, { status: 404 });
    }
    if (method === "MOVE") {
      const destination = String((init?.headers as Record<string, string>)?.Destination || "");
      const content = files.get(url);
      if (!content || !destination) return new Response(null, { status: 404 });
      files.delete(url);
      files.set(destination, content);
      return new Response(null, { status: 201 });
    }
    if (method === "DELETE") { files.delete(url); return new Response(null, { status: 204 }); }
    return new Response(null, { status: 405 });
  };
  return { fetcher: fetcher as typeof fetch, files, calls };
}

const config = { serverUrl: "https://nextcloud.example/nextcloud", username: "backup-user", remoteDirectory: "RISpro/automated" };

test("Nextcloud WebDAV uploads through a temporary file and verifies read-back before promotion", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-webdav-"));
  const source = path.join(tempDir, "backup.rispro.zip");
  await fs.writeFile(source, "encrypted backup");
  const digest = await sha256File(source);
  const remote = inMemoryWebDav();
  try {
    const result = await copyBackupV3ToWebDavDestination({ sourcePath: source, archiveName: "backup.rispro.zip", expectedSha256: digest.sha256, expectedByteSize: digest.byteSize, config, credentials: { appPassword: "app-password" }, fetcher: remote.fetcher });
    assert.equal(result.sha256, digest.sha256);
    assert.match(result.remotePath, /remote\.php\/dav\/files\/backup-user\/RISpro\/automated\/backup\.rispro\.zip$/);
    assert.equal(remote.files.size, 1);
    assert.ok(remote.calls.some((call) => call.method === "GET"));
    assert.ok(remote.calls.some((call) => call.method === "MOVE"));
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("Nextcloud WebDAV rejects changed read-back data and cleans the temporary upload", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-webdav-"));
  const source = path.join(tempDir, "backup.rispro.zip");
  await fs.writeFile(source, "encrypted backup");
  const digest = await sha256File(source);
  const remote = inMemoryWebDav({ corruptReadBack: true });
  try {
    await assert.rejects(() => copyBackupV3ToWebDavDestination({ sourcePath: source, archiveName: "backup.rispro.zip", expectedSha256: digest.sha256, expectedByteSize: digest.byteSize, config, credentials: { appPassword: "app-password" }, fetcher: remote.fetcher }), /verification failed/);
    assert.equal(remote.files.size, 0);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("Nextcloud WebDAV requires HTTPS and rejects remote path traversal", async () => {
  assert.throws(() => validateBackupV3WebDavConfig({ ...config, serverUrl: "http://nextcloud.example" }), /HTTPS/);
  assert.throws(() => validateBackupV3WebDavConfig({ ...config, remoteDirectory: "RISpro/../outside" }), /unsafe/);
  const remote = inMemoryWebDav();
  await testBackupV3WebDavDestination(config, { appPassword: "app-password" }, remote.fetcher);
  assert.ok(remote.calls.some((call) => call.method === "PUT"));
  assert.ok(remote.calls.some((call) => call.method === "DELETE"));
});

test("Nextcloud retention deletion accepts only RISpro archive names below the configured folder", async () => {
  const remote = inMemoryWebDav();
  const url = "https://nextcloud.example/nextcloud/remote.php/dav/files/backup-user/RISpro/automated/backup.rispro.zip";
  remote.files.set(url, Buffer.from("archive"));
  await deleteBackupV3WebDavDestinationCopy({ remotePath: new URL(url).pathname, config, credentials: { appPassword: "app-password" }, fetcher: remote.fetcher });
  assert.equal(remote.files.size, 0);
  await assert.rejects(() => deleteBackupV3WebDavDestinationCopy({ remotePath: "/other/not-a-backup.txt", config, credentials: { appPassword: "app-password" }, fetcher: remote.fetcher }), /unsafe/);
});
