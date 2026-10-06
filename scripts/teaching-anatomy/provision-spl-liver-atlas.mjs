#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { install } from "./install-spl-liver-atlas.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const defaultLockPath = path.join(scriptDirectory, "spl-liver-atlas.lock.json");
const defaultTemplatePath = path.join(repositoryRoot, "src/modules/teaching/anatomy/liver-manifest.template.json");
const lfsPointerPrefix = Buffer.from("version https://git-lfs.github.com/spec/v1", "utf8");
const allowedDownloadHosts = new Set(["media.githubusercontent.com", "raw.githubusercontent.com", "objects.githubusercontent.com"]);
const maximumAssetBytes = 80 * 1024 * 1024;
const maximumRedirects = 3;

function assertRecord(value, name) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function safeRelativePath(value, name) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || value.includes("\\")) {
    throw new Error(`${name} must be a non-empty POSIX relative path.`);
  }
  const components = value.split("/");
  if (components.some((component) => component.length === 0 || component === "." || component === "..")) {
    throw new Error(`${name} contains an unsafe path component.`);
  }
  return value;
}

function resolveInside(root, relativePath, name) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, ...relativePath.split("/"));
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error(`${name} resolves outside its expected directory.`);
  return target;
}

function directMediaUrl(commit, relativePath) {
  return `https://media.githubusercontent.com/media/lorensen/SPLLiverAtlas/${commit}/${relativePath}`;
}

function directAssetUrl(commit, relativePath) {
  if (relativePath === "Atlas/SPLLiverAtlasColors.ctbl") {
    return `https://raw.githubusercontent.com/lorensen/SPLLiverAtlas/${commit}/${relativePath}`;
  }
  return directMediaUrl(commit, relativePath);
}

function buildAssetPlan(template) {
  const manifest = assertRecord(template, "Atlas manifest template");
  const assets = assertRecord(manifest.assets, "Atlas manifest assets");
  const volumes = assertRecord(manifest.volumes, "Atlas manifest volumes");
  const ct = assertRecord(volumes.ct, "Atlas CT volume");
  const segmentation = assertRecord(volumes.segmentation, "Atlas segmentation volume");
  const entryFor = (key) => assertRecord(assets[key], `Atlas asset ${key}`);
  const plan = [
    { path: `Atlas/${safeRelativePath(ct.file, "Atlas CT filename")}`, targetFile: safeRelativePath(entryFor(ct.assetKey).file, "Atlas CT target filename") },
    { path: `Atlas/${safeRelativePath(segmentation.file, "Atlas label filename")}`, targetFile: safeRelativePath(entryFor(segmentation.assetKey).file, "Atlas label target filename") },
    { path: `Atlas/${safeRelativePath(entryFor("colors").file, "Atlas color-table filename")}`, targetFile: safeRelativePath(entryFor("colors").file, "Atlas color-table target filename") },
  ];
  if (!Array.isArray(manifest.structures) || manifest.structures.length === 0) throw new Error("Atlas manifest template contains no structures.");
  for (const structure of manifest.structures) {
    const item = assertRecord(structure, "Atlas structure");
    const meshAsset = item.meshAsset;
    const mesh = entryFor(meshAsset);
    plan.push({
      path: `Models/STL/${safeRelativePath(mesh.sourceFile, `Source STL for ${String(item.id ?? "structure")}`)}`,
      targetFile: safeRelativePath(mesh.file, `Installed STL for ${String(item.id ?? "structure")}`),
    });
  }
  const seen = new Set();
  for (const asset of plan) {
    if (seen.has(asset.path)) throw new Error(`Atlas manifest template duplicates ${asset.path}.`);
    seen.add(asset.path);
  }
  return plan;
}

export function validateAtlasLock(lock, template) {
  const candidate = assertRecord(lock, "SPL atlas lock");
  if (candidate.schemaVersion !== "1.0" || candidate.atlasId !== "spl-liver" || typeof candidate.managedVersion !== "string" || !candidate.managedVersion) {
    throw new Error("SPL atlas lock has an unsupported schema, atlas ID, or managed version.");
  }
  const upstream = assertRecord(candidate.upstream, "SPL atlas lock upstream");
  if (upstream.repository !== "https://github.com/lorensen/SPLLiverAtlas" || typeof upstream.commit !== "string" || !/^[0-9a-f]{40}$/i.test(upstream.commit)) {
    throw new Error("SPL atlas lock must pin the expected upstream repository and full commit SHA.");
  }
  const commit = upstream.commit.toLowerCase();
  if (upstream.mediaBaseUrl !== directMediaUrl(commit, "").replace(/\/$/, "")) {
    throw new Error("SPL atlas lock has an unexpected media base URL.");
  }
  if (!Array.isArray(candidate.assets)) throw new Error("SPL atlas lock assets must be an array.");
  const plan = buildAssetPlan(template);
  if (candidate.assets.length !== plan.length) throw new Error("SPL atlas lock does not contain exactly the required assets.");
  const assetsByPath = new Map();
  for (const rawAsset of candidate.assets) {
    const asset = assertRecord(rawAsset, "SPL atlas lock asset");
    const relativePath = safeRelativePath(asset.path, "SPL atlas lock asset path");
    if (assetsByPath.has(relativePath) || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > maximumAssetBytes
      || typeof asset.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(asset.sha256)
      || asset.url !== directAssetUrl(commit, relativePath)) {
      throw new Error(`SPL atlas lock asset is invalid: ${relativePath}.`);
    }
    const url = new URL(asset.url);
    if (url.protocol !== "https:" || (url.hostname !== "media.githubusercontent.com" && url.hostname !== "raw.githubusercontent.com")) {
      throw new Error(`SPL atlas lock asset has an untrusted download host: ${relativePath}.`);
    }
    assetsByPath.set(relativePath, { path: relativePath, size: asset.size, sha256: asset.sha256.toLowerCase(), url: asset.url });
  }
  const plannedPaths = new Set(plan.map((asset) => asset.path));
  if (assetsByPath.size !== plannedPaths.size || [...plannedPaths].some((assetPath) => !assetsByPath.has(assetPath))) {
    throw new Error("SPL atlas lock assets do not match the required Teaching Liver atlas files.");
  }
  return {
    atlasId: candidate.atlasId,
    managedVersion: candidate.managedVersion,
    upstream: { repository: upstream.repository, commit, mediaBaseUrl: upstream.mediaBaseUrl },
    assets: plan.map((planned) => ({ ...assetsByPath.get(planned.path), targetFile: planned.targetFile })),
  };
}

function isLfsPointerPrefix(bytes) {
  return bytes.length >= lfsPointerPrefix.length && bytes.subarray(0, lfsPointerPrefix.length).equals(lfsPointerPrefix);
}

async function hashFile(filePath, expectedSize) {
  const fileInfo = await stat(filePath);
  if (!fileInfo.isFile() || fileInfo.size !== expectedSize) throw new Error(`Unexpected installed asset size for ${path.basename(filePath)}.`);
  const hash = createHash("sha256");
  let prefix = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath)) {
    const bytes = Buffer.from(chunk);
    hash.update(bytes);
    if (prefix.length < lfsPointerPrefix.length) prefix = Buffer.concat([prefix, bytes]).subarray(0, lfsPointerPrefix.length);
  }
  if (isLfsPointerPrefix(prefix)) throw new Error(`Installed asset ${path.basename(filePath)} is a Git LFS pointer.`);
  return hash.digest("hex");
}

function sameMetadata(metadata, lock) {
  return metadata && ["1.0", "1.1"].includes(metadata.schemaVersion) && metadata.atlasId === lock.atlasId
    && metadata.managedVersion === lock.managedVersion && metadata.upstreamCommit === lock.upstream.commit
    && Array.isArray(metadata.assets) && metadata.assets.length === lock.assets.length
    && lock.assets.every((asset) => metadata.assets.some((stored) => stored.path === asset.path && stored.size === asset.size && stored.sha256 === asset.sha256));
}

export async function verifyInstalledAtlas({ assetRoot, lock, template }) {
  const atlasDirectory = path.join(path.resolve(assetRoot), "spl-liver");
  try {
    const [metadataText, manifestText] = await Promise.all([
      readFile(path.join(atlasDirectory, "installed-atlas.json"), "utf8"),
      readFile(path.join(atlasDirectory, "manifest.json"), "utf8"),
    ]);
    const metadata = JSON.parse(metadataText);
    const manifest = JSON.parse(manifestText);
    if (!sameMetadata(metadata, lock) || manifest.atlasId !== lock.atlasId || manifest.spatialValidation?.status !== "passed") return false;
    const templatePlan = buildAssetPlan(template);
    if (templatePlan.length !== lock.assets.length) return false;
    for (const asset of lock.assets) {
      const target = resolveInside(atlasDirectory, asset.targetFile, `Installed asset ${asset.path}`);
      if (await hashFile(target, asset.size) !== asset.sha256) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function assertRedirectUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !allowedDownloadHosts.has(url.hostname)) {
    throw new Error(`Atlas download redirect uses an unexpected protocol or host: ${url.protocol}//${url.hostname}.`);
  }
  return url;
}

async function fetchPinnedAsset(url, fetchImpl) {
  let current = assertRedirectUrl(url);
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
      headers: { "user-agent": "RISpro-Teaching-Anatomy-Provisioner/1.0" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount === maximumRedirects) throw new Error("Atlas download exceeded the redirect limit.");
      current = assertRedirectUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`Atlas download failed with HTTP ${response.status}.`);
    return response;
  }
  throw new Error("Atlas download exceeded the redirect limit.");
}

async function downloadAsset(asset, sourceDirectory, fetchImpl) {
  const target = resolveInside(sourceDirectory, asset.path, `Download target ${asset.path}`);
  await mkdir(path.dirname(target), { recursive: true });
  const response = await fetchPinnedAsset(asset.url, fetchImpl);
  const advertisedSize = response.headers.get("content-length");
  if (advertisedSize && !response.headers.get("content-encoding") && (!/^\d+$/.test(advertisedSize) || Number(advertisedSize) !== asset.size)) {
    throw new Error(`Atlas download content length does not match the lock for ${asset.path}.`);
  }
  const output = createWriteStream(target, { flags: "wx", mode: 0o600 });
  const hash = createHash("sha256");
  let received = 0;
  let prefix = Buffer.alloc(0);
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      received += bytes.length;
      if (received > asset.size || received > maximumAssetBytes) throw new Error(`Atlas download exceeds the locked size for ${asset.path}.`);
      hash.update(bytes);
      if (prefix.length < lfsPointerPrefix.length) prefix = Buffer.concat([prefix, bytes]).subarray(0, lfsPointerPrefix.length);
      if (!output.write(bytes)) {
        await new Promise((resolve, reject) => {
          const onDrain = () => { output.off("error", onError); resolve(); };
          const onError = (error) => { output.off("drain", onDrain); reject(error); };
          output.once("drain", onDrain);
          output.once("error", onError);
        });
      }
    }
    output.end();
    await finished(output);
  } catch (error) {
    output.destroy();
    await rm(target, { force: true });
    throw error;
  }
  if (isLfsPointerPrefix(prefix)) throw new Error(`Atlas download returned a Git LFS pointer instead of ${asset.path}.`);
  const digest = hash.digest("hex");
  if (received !== asset.size || digest !== asset.sha256) throw new Error(`Atlas checksum validation failed for ${asset.path}.`);
}

function installedMetadata(lock, now) {
  return {
    schemaVersion: "1.1",
    atlasId: lock.atlasId,
    managedVersion: lock.managedVersion,
    sourceSha256: createHash("sha256").update(JSON.stringify(lock.assets.map(({ path: assetPath, size, sha256 }) => ({ path: assetPath, size, sha256 })))).digest("hex"),
    upstreamRepository: lock.upstream.repository,
    upstreamCommit: lock.upstream.commit,
    installedAt: now().toISOString(),
    assets: lock.assets.map(({ path: sourcePath, size, sha256, targetFile }) => ({ path: sourcePath, size, sha256, targetFile })),
  };
}

async function writeProvisionedReadme(sourceDirectory, lock) {
  const text = [
    "SPL Liver Atlas educational source metadata",
    `Source repository: ${lock.upstream.repository}`,
    `Pinned commit: ${lock.upstream.commit}`,
    "RISpro downloaded only the Teaching Liver atlas files named in its checked-in asset lock.",
    "The installed atlas manifest, NOTICE.txt, and UPSTREAM-LICENSE.txt preserve attribution and licensing information.",
  ].join("\n") + "\n";
  await writeFile(resolveInside(sourceDirectory, "README.md", "Provisioned source metadata"), text, { encoding: "utf8", mode: 0o600 });
}

export async function ensureSplLiverAtlas({
  assetRoot = process.env.TEACHING_ANATOMY_ASSET_ROOT || path.join(process.env.UPLOADS_DIR || "storage/uploads", "teaching", "anatomy"),
  lockPath = defaultLockPath,
  templatePath = defaultTemplatePath,
  lock: suppliedLock,
  template: suppliedTemplate,
  fetchImpl = globalThis.fetch,
  installAtlas = install,
  now = () => new Date(),
} = {}) {
  let stage;
  try {
    if (typeof fetchImpl !== "function") throw new Error("This Node.js runtime does not provide HTTPS fetch support.");
    const [lockValue, templateValue] = await Promise.all([
      suppliedLock ? Promise.resolve(suppliedLock) : readFile(lockPath, "utf8").then(JSON.parse),
      suppliedTemplate ? Promise.resolve(suppliedTemplate) : readFile(templatePath, "utf8").then(JSON.parse),
    ]);
    const lock = validateAtlasLock(lockValue, templateValue);
    const resolvedRoot = path.resolve(assetRoot);
    if (await verifyInstalledAtlas({ assetRoot: resolvedRoot, lock, template: templateValue })) return { status: "already-current" };

    await mkdir(resolvedRoot, { recursive: true });
    stage = path.join(resolvedRoot, `.spl-liver-provision-${process.pid}-${randomBytes(8).toString("hex")}`);
    const sourceDirectory = path.join(stage, "source");
    await mkdir(sourceDirectory, { recursive: true, mode: 0o700 });
    for (const asset of lock.assets) await downloadAsset(asset, sourceDirectory, fetchImpl);
    await writeProvisionedReadme(sourceDirectory, lock);
    await installAtlas({
      source: sourceDirectory,
      target: resolvedRoot,
      replace: true,
      managedMetadata: installedMetadata(lock, now),
    });
    if (!await verifyInstalledAtlas({ assetRoot: resolvedRoot, lock, template: templateValue })) {
      throw new Error("The installed atlas did not pass its post-activation integrity check.");
    }
    return { status: "ready" };
  } catch (error) {
    return { status: "unavailable", error: error instanceof Error ? error.message : "Unknown anatomy provisioning failure." };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
  }
}

async function main() {
  const result = await ensureSplLiverAtlas();
  if (result.status === "ready") console.log("[OK] Teaching Anatomy: ready.");
  else if (result.status === "already-current") console.log("[OK] Teaching Anatomy: SPL Liver Atlas already installed and valid.");
  else console.error(`[WARN] Teaching Anatomy: unavailable - provisioning failed: ${result.error}`);
  console.log(`RISPRO_TEACHING_ANATOMY_STATUS=${result.status}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
