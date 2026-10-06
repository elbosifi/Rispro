#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import yauzl from "yauzl";
import { ensureSplLiverAtlas } from "./provision-spl-liver-atlas.mjs";
import { installOpenAnatomyAtlas, verifyInstalledOpenAtlas } from "./install-open-anatomy-atlas.mjs";
import { installBodyParts3d, verifyInstalledBodyParts3d } from "./install-bodyparts3d.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const lockPath = path.join(scriptDirectory, "open-atlas-sources.lock.json");
const allowedHosts = new Set(["www.openanatomy.org", "openanatomy.org", "dbarchive.biosciencedbc.jp"]);
const maximumRedirects = 4;

export function safeEntryName(value) {
  if (typeof value !== "string" || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) throw new Error("Archive contains an unsafe path.");
  const normalized = value.replace(/\/$/, "");
  const parts = normalized.split("/");
  if (!normalized || parts.some((part) => !part || part === "." || part === "..")) throw new Error("Archive contains an unsafe path component.");
  return normalized;
}

function verifyUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) throw new Error(`Pinned anatomy source has an untrusted URL: ${url.protocol}//${url.hostname}.`);
  return url;
}

export async function downloadPinned({ name, url, sizeBytes, sha256, destination, fetchImpl = globalThis.fetch, log = () => undefined }) {
  if (typeof fetchImpl !== "function" || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || !/^[a-f0-9]{64}$/i.test(sha256)) {
    throw new Error(`${name} download lock is invalid or HTTPS fetch is unavailable.`);
  }
  let current = verifyUrl(url);
  let response;
  for (let redirect = 0; redirect <= maximumRedirects; redirect += 1) {
    response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(600_000),
      headers: { "user-agent": "RISpro-Teaching-Anatomy-Provisioner/1.0" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || redirect === maximumRedirects) throw new Error(`${name} download exceeded the redirect limit.`);
    current = verifyUrl(new URL(location, current).toString());
  }
  if (!response?.ok || !response.body) throw new Error(`${name} download failed with HTTP ${response?.status ?? "no response"}.`);
  const advertised = response.headers.get("content-length");
  if (advertised && !response.headers.get("content-encoding") && (!/^\d+$/.test(advertised) || Number(advertised) !== sizeBytes)) {
    throw new Error(`${name} response size does not match the pinned source lock.`);
  }
  const hash = createHash("sha256");
  const chunks = destination ? null : [];
  const output = destination ? await open(destination, "wx", 0o600) : null;
  let received = 0;
  let nextReport = 8 * 1024 * 1024;
  try { for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk); received += bytes.length;
    if (received > sizeBytes) throw new Error(`${name} download exceeded the pinned byte size.`);
    hash.update(bytes); if (output) await output.writeFile(bytes); else chunks.push(bytes);
    if (received >= nextReport) { log(`[progress] ${name}: downloaded ${received}/${sizeBytes} bytes.`); nextReport += 8 * 1024 * 1024; }
  } } finally { await output?.close(); }
  if (received !== sizeBytes || hash.digest("hex") !== sha256.toLowerCase()) throw new Error(`${name} size or SHA-256 does not match its pinned source lock.`);
  log(`[progress] ${name}: verified ${received} bytes and SHA-256.`);
  return destination ?? Buffer.concat(chunks, received);
}

export async function extractLockedArchive(archive, destination, { expectedRoot, kind, maximumUncompressedBytes, log = () => undefined }) {
  const rootPrefix = `${expectedRoot}/`;
  let totalBytes = 0;
  let extracted = 0;
  const base = path.resolve(destination);
  await mkdir(base, { recursive: true, mode: 0o700 });
  return await new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) { reject(openError ?? new Error("Pinned ZIP could not be opened.")); return; }
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(error);
      };
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        void (async () => {
          const isDirectory = entry.fileName.endsWith("/");
          const entryName = safeEntryName(entry.fileName);
          const fileType = (entry.externalFileAttributes >>> 16) & 0o170000;
          if (fileType && fileType !== 0o100000 && fileType !== 0o040000) throw new Error(`Archive entry ${entryName} has an unexpected file type.`);
          if (entryName !== expectedRoot && !entryName.startsWith(rootPrefix)) throw new Error(`Archive entry ${entryName} is outside its pinned package root.`);
          if (entryName === expectedRoot && !isDirectory) throw new Error("Archive package root is not a directory.");
          if (isDirectory) return;
          if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1) throw new Error(`Archive entry ${entryName} has an invalid declared size.`);
          totalBytes += entry.uncompressedSize;
          if (totalBytes > maximumUncompressedBytes) throw new Error("Archive exceeds the allowed uncompressed size.");
          const extension = path.extname(entryName).toLowerCase();
          if (kind === "bodyparts3d" && (!/^partof_BP3D_4\.0_obj_99\/FJ\d+M?\.obj$/i.test(entryName) || extension !== ".obj")) {
            throw new Error(`BodyParts3D archive includes an unexpected file: ${entryName}.`);
          }
          const supportedOpenExtension = [".vtk", ".nrrd", ".json", ".md", ".txt", ".ctbl"].includes(extension);
          if (kind === "open-anatomy" && !supportedOpenExtension) return;
          const target = path.resolve(base, ...entryName.split("/"));
          if (!target.startsWith(`${base}${path.sep}`)) throw new Error(`Archive entry ${entryName} resolves outside the extraction directory.`);
          await mkdir(path.dirname(target), { recursive: true });
          const readStream = await new Promise((resolveStream, rejectStream) => zip.openReadStream(entry, (streamError, stream) => streamError ? rejectStream(streamError) : resolveStream(stream)));
          let actualBytes = 0;
          const { Transform } = await import("node:stream");
          const sizeGuard = new Transform({ transform(chunk, _encoding, callback) {
            actualBytes += chunk.length;
            if (actualBytes > entry.uncompressedSize || actualBytes > maximumUncompressedBytes) callback(new Error(`Archive entry ${entryName} expanded beyond its declared size.`));
            else callback(null, chunk);
          } });
          await pipeline(readStream, sizeGuard, createWriteStream(target, { flags: "wx", mode: 0o600 }));
          if (actualBytes !== entry.uncompressedSize) throw new Error(`Archive entry ${entryName} did not extract to its declared size.`);
          extracted += 1;
          if (kind === "bodyparts3d" && extracted % 100 === 0) log(`[progress] BodyParts3D: unpacked ${extracted} OBJ surfaces.`);
        })().then(() => { if (!settled) zip.readEntry(); }).catch(fail);
      });
      zip.on("end", () => {
        if (settled) return;
        settled = true;
        zip.close();
        if (extracted === 0) reject(new Error("Pinned archive contains no installable source assets."));
        else {
          log(`[progress] Extracted ${extracted} verified archive files (${totalBytes} uncompressed bytes).`);
          resolve({ extracted, uncompressedBytes: totalBytes });
        }
      });
      zip.readEntry();
    });
  });
}

async function readLockedSources() {
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock.schemaVersion !== "1.0" || !Array.isArray(lock.openAnatomy) || !lock.bodyParts3d) throw new Error("Teaching Anatomy source lock has an unsupported schema.");
  for (const entry of lock.openAnatomy) {
    verifyUrl(entry.url);
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(entry.atlasId) || !Number.isSafeInteger(entry.sizeBytes) || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Open Anatomy source lock is invalid for ${entry.atlasId}.`);
  }
  verifyUrl(lock.bodyParts3d.archive.url);
  for (const metadata of lock.bodyParts3d.metadata) verifyUrl(metadata.url);
  return lock;
}

export async function ensureOpenAnatomyAtlas({ atlasId, assetRoot, fetchImpl = globalThis.fetch, now = () => new Date(), log = () => undefined }) {
  let workingDirectory;
  try {
    const lock = await readLockedSources();
    const entry = lock.openAnatomy.find((candidate) => candidate.atlasId === atlasId);
    if (!entry) throw new Error(`No pinned Open Anatomy archive is configured for ${atlasId}.`);
    if (verifyInstalledOpenAtlas && await verifyInstalledOpenAtlas(assetRoot, entry)) return { status: "already-current", atlasId };
    workingDirectory = await mkdtemp(path.join(os.tmpdir(), `rispro-${atlasId}-`));
    const zip = await downloadPinned({ name: atlasId, url: entry.url, sizeBytes: entry.sizeBytes, sha256: entry.sha256, destination: path.join(workingDirectory, "source.zip"), fetchImpl, log });
    const sourceDirectory = path.join(workingDirectory, "source");
    await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
    await extractLockedArchive(zip, sourceDirectory, { expectedRoot: entry.archiveRoot, kind: "open-anatomy", maximumUncompressedBytes: 300 * 1024 * 1024, log });
    const result = await installOpenAnatomyAtlas({ atlasId, sourceDirectory, targetRoot: assetRoot, sourceSha256: entry.sha256, now, log });
    return { status: "ready", ...result };
  } catch (error) {
    return { status: "unavailable", atlasId, error: error instanceof Error ? error.message : "Unknown Open Anatomy provisioning failure." };
  } finally {
    if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
  }
}

export async function ensureBodyParts3d({ assetRoot, fetchImpl = globalThis.fetch, now = () => new Date(), log = () => undefined }) {
  let workingDirectory;
  try {
    const lock = await readLockedSources();
    const source = lock.bodyParts3d;
    if (source.expectedModelCount !== 1258 || source.attribution !== "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International") {
      throw new Error("BodyParts3D source lock does not preserve the official model count and attribution.");
    }
    if (verifyInstalledBodyParts3d && await verifyInstalledBodyParts3d(assetRoot, source)) return { status: "already-current", atlasId: source.atlasId };
    workingDirectory = await mkdtemp(path.join(os.tmpdir(), "rispro-bodyparts3d-"));
    const archive = await downloadPinned({ name: "BodyParts3D OBJ archive", ...source.archive, destination: path.join(workingDirectory, "bodyparts3d.zip"), fetchImpl, log });
    const sourceDirectory = path.join(workingDirectory, "source");
    await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
    await extractLockedArchive(archive, sourceDirectory, { expectedRoot: "partof_BP3D_4.0_obj_99", kind: "bodyparts3d", maximumUncompressedBytes: 300 * 1024 * 1024, log });
    const modelDirectory = path.join(sourceDirectory, "partof_BP3D_4.0_obj_99");
    const files = await readdir(modelDirectory);
    if (files.length !== source.expectedModelCount) throw new Error(`BodyParts3D contains ${files.length} models; expected ${source.expectedModelCount}.`);
    for (const metadata of source.metadata) {
      await downloadPinned({ name: `BodyParts3D ${metadata.name}`, ...metadata, destination: path.join(sourceDirectory, metadata.name), fetchImpl, log });
    }
    const result = await installBodyParts3d({ sourceDirectory, targetRoot: assetRoot, sourceSha256: source.archive.sha256, now, log });
    return { status: "ready", ...result };
  } catch (error) {
    return { status: "unavailable", atlasId: "bodyparts3d", error: error instanceof Error ? error.message : "Unknown BodyParts3D provisioning failure." };
  } finally {
    if (workingDirectory) await rm(workingDirectory, { recursive: true, force: true });
  }
}

export async function ensureTeachingAnatomyAtlases({
  assetRoot = process.env.TEACHING_ANATOMY_ASSET_ROOT || path.join(process.env.UPLOADS_DIR || "storage/uploads", "teaching", "anatomy"),
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
  log = (message) => process.stdout.write(`${message}\n`),
  ensureLiver = ensureSplLiverAtlas,
} = {}) {
  const results = [];
  const atlasActions = [
    ["spl-liver", () => ensureLiver({ assetRoot, fetchImpl, now })],
    ...["spl-abdomen", "spl-head-neck", "spl-knee"].map((atlasId) => [atlasId, () => ensureOpenAnatomyAtlas({ atlasId, assetRoot, fetchImpl, now, log })]),
    ["bodyparts3d", () => ensureBodyParts3d({ assetRoot, fetchImpl, now, log })],
  ];
  for (const [atlasId, action] of atlasActions) {
    log(`[start] Teaching Anatomy atlas ${atlasId}.`);
    let result;
    try { result = await action(); }
    catch (error) { result = { status: "unavailable", atlasId, error: error instanceof Error ? error.message : "Unknown provisioning failure." }; }
    if (!result.atlasId) result.atlasId = atlasId;
    results.push(result);
    log(`[${result.status === "ready" || result.status === "already-current" ? "ok" : "warn"}] ${atlasId}: ${result.status}${result.error ? ` - ${result.error}` : ""}.`);
    log(`RISPRO_TEACHING_ANATOMY_ATLAS_${atlasId.toUpperCase().replaceAll("-", "_")}=${result.status}`);
  }
  const ready = results.filter(({ status }) => status === "ready" || status === "already-current").length;
  const unavailable = results.length - ready;
  log(`[summary] Teaching Anatomy: ${ready}/${results.length} atlas packages ready; ${unavailable} unavailable or pending.`);
  log(`RISPRO_TEACHING_ANATOMY_STATUS=${unavailable === 0 ? "ready" : ready > 0 ? "partial" : "unavailable"}`);
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await ensureTeachingAnatomyAtlases();
}
