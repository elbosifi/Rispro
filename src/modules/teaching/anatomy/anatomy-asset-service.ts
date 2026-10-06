import { open, readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../config/env.js";
import { findTeachingAnatomyAtlas, TEACHING_ANATOMY_CATALOG, type TeachingAnatomyAtlasCatalogEntry } from "./anatomy-catalog.js";
import { anatomyAssetPath, isSafeAnatomyAtlasId, parseAnatomyAtlasManifest, type AnatomyAtlasManifest } from "./anatomy-atlas.js";

export function teachingAnatomyAtlasDirectory(atlasId = "spl-liver", configuredRoot = env.teachingAnatomyAssetRoot): string {
  if (!isSafeAnatomyAtlasId(atlasId) || !findTeachingAnatomyAtlas(atlasId)) throw new Error("Unknown Teaching anatomy atlas ID.");
  return path.resolve(configuredRoot, atlasId);
}

async function beginsWithLfsPointer(filePath: string): Promise<boolean> {
  const file = await open(filePath, "r");
  try {
    const bytes = Buffer.alloc(256);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead).toString("utf8").startsWith("version https://git-lfs.github.com/spec/v1");
  } finally {
    await file.close();
  }
}

export interface ResolvedTeachingAnatomyAsset { filePath: string; mediaType: string; sizeBytes: number; etag: string; versioned: boolean }

export function teachingAnatomyIfNoneMatchMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const candidates = header.match(/(?:W\/)?"[^"]*"|\*/g) ?? [];
  const weakComparable = (value: string) => value.startsWith("W/") ? value.slice(2) : value;
  return candidates.some((candidate) => candidate === "*" || weakComparable(candidate) === weakComparable(etag));
}

export function teachingAnatomyAssetCacheControl(versioned: boolean, etag: string, requestedVersion: string | undefined): string {
  const immutable = versioned && requestedVersion?.toLowerCase() === etag.slice(1, -1);
  return immutable ? "private, max-age=31536000, immutable" : "private, max-age=0, must-revalidate";
}

const manifestCache = new Map<string, { mtimeMs: number; size: number; manifest: AnatomyAtlasManifest }>();
let radiologyNotesCache: { mtimeMs: number; size: number; notes: Record<string, Record<string, string>> } | null = null;
const radiologyNotesPath = fileURLToPath(new URL("./radiology-notes.json", import.meta.url));

async function readRadiologyNoteOverlay(): Promise<Record<string, Record<string, string>>> {
  try {
    const info = await stat(radiologyNotesPath);
    if (radiologyNotesCache && radiologyNotesCache.mtimeMs === info.mtimeMs && radiologyNotesCache.size === info.size) return radiologyNotesCache.notes;
    const value = JSON.parse(await readFile(radiologyNotesPath, "utf8")) as { schemaVersion?: unknown; atlases?: unknown };
    if (value.schemaVersion !== "1.0" || typeof value.atlases !== "object" || value.atlases === null || Array.isArray(value.atlases)) throw new Error("Teaching radiology note overlay has an unsupported schema.");
    const notes: Record<string, Record<string, string>> = {};
    for (const [atlasId, entries] of Object.entries(value.atlases)) {
      if (!isSafeAnatomyAtlasId(atlasId) || typeof entries !== "object" || entries === null || Array.isArray(entries)) throw new Error("Teaching radiology note overlay contains an invalid atlas entry.");
      notes[atlasId] = {};
      for (const [structureId, note] of Object.entries(entries)) {
        if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(structureId) || typeof note !== "string" || !note.trim()) throw new Error("Teaching radiology note overlay contains an invalid note.");
        notes[atlasId][structureId] = note.trim();
      }
    }
    radiologyNotesCache = { mtimeMs: info.mtimeMs, size: info.size, notes };
    return notes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function verifyAssetFile(directory: string, manifest: AnatomyAtlasManifest, assetKey: string, root?: string, verifyIntegrity = false): Promise<{ sizeBytes: number; mtimeMs: number }> {
  const filePath = anatomyAssetPath(directory, manifest, assetKey);
  const actualPath = await realpath(filePath);
  const resolvedRoot = root ?? await realpath(directory);
  if (path.dirname(actualPath) !== resolvedRoot) throw new Error(`Anatomy asset ${assetKey} resolves outside the installed atlas directory.`);
  const fileStat = await stat(actualPath);
  if (!fileStat.isFile() || fileStat.size === 0) throw new Error(`Anatomy asset ${assetKey} is missing or empty.`);
  const expectedIntegrity = manifest.assets[assetKey]?.integrity;
  if (expectedIntegrity) {
    if (fileStat.size !== expectedIntegrity.sizeBytes) throw new Error(`Anatomy asset ${assetKey} does not match its declared size.`);
    if (verifyIntegrity) {
      const digest = createHash("sha256").update(await readFile(actualPath)).digest("hex");
      if (digest !== expectedIntegrity.sha256) throw new Error(`Anatomy asset ${assetKey} does not match its declared SHA-256 digest.`);
    }
  }
  if (await beginsWithLfsPointer(actualPath)) throw new Error(`Anatomy asset ${assetKey} is a Git LFS pointer, not the installed binary file.`);
  return { sizeBytes: fileStat.size, mtimeMs: fileStat.mtimeMs };
}

async function verifyDeclaredAssets(directory: string, manifest: AnatomyAtlasManifest, verifyIntegrity: boolean): Promise<void> {
  const root = await realpath(directory);
  const keys = Object.keys(manifest.assets);
  for (let offset = 0; offset < keys.length; offset += 32) {
    await Promise.all(keys.slice(offset, offset + 32).map((assetKey) => verifyAssetFile(directory, manifest, assetKey, root, verifyIntegrity)));
  }
}

export async function readTeachingAnatomyManifest(atlasId = "spl-liver", configuredRoot = env.teachingAnatomyAssetRoot, verifyAssets: boolean | "presence" = true): Promise<AnatomyAtlasManifest | null> {
  const directory = teachingAnatomyAtlasDirectory(atlasId, configuredRoot);
  const manifestPath = path.join(directory, "manifest.json");
  let manifest: AnatomyAtlasManifest;
  try {
    const info = await stat(manifestPath);
    const cached = manifestCache.get(manifestPath);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) manifest = cached.manifest;
    else {
      const contents = await readFile(manifestPath, "utf8");
      let parsed: unknown;
      try { parsed = JSON.parse(contents); }
      catch { throw new Error("The installed Teaching anatomy manifest is not valid JSON."); }
      manifest = parseAnatomyAtlasManifest(parsed);
      if (manifest.atlasId !== atlasId) throw new Error("The installed anatomy manifest does not match its catalog atlas ID.");
      manifestCache.set(manifestPath, { mtimeMs: info.mtimeMs, size: info.size, manifest });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  if (verifyAssets) await verifyDeclaredAssets(directory, manifest, verifyAssets === true);
  const radiologyNotes = (await readRadiologyNoteOverlay())[atlasId] ?? {};
  if (!Object.keys(radiologyNotes).length) return manifest;
  return { ...manifest, structures: manifest.structures.map((structure) => radiologyNotes[structure.id] ? { ...structure, radiologyNote: radiologyNotes[structure.id] } : structure) };
}

export async function readTeachingAnatomyCatalog(configuredRoot = env.teachingAnatomyAssetRoot): Promise<TeachingAnatomyAtlasCatalogEntry[]> {
  return Promise.all(TEACHING_ANATOMY_CATALOG.map(async (entry) => {
    try {
      const directory = teachingAnatomyAtlasDirectory(entry.atlasId, configuredRoot);
      // Readiness is an O(1) activation-record check. Per-asset checks happen only
      // when that asset is served; a landing-page request must not stat 1,258 meshes.
      const activation = JSON.parse(await readFile(path.join(directory, "installed-atlas.json"), "utf8")) as {
        schemaVersion?: unknown; atlasId?: unknown; managedVersion?: unknown; sourceSha256?: unknown; manifestSha256?: unknown;
        validationStatus?: unknown; installedAt?: unknown; assetCount?: unknown;
      };
      const managedVersionValid = typeof activation.managedVersion === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(activation.managedVersion);
      const legacyActivation = activation.schemaVersion === "1.0" && managedVersionValid;
      const currentActivation = activation.schemaVersion === "1.1" && managedVersionValid
        && activation.validationStatus === "passed"
        && typeof activation.sourceSha256 === "string" && /^[a-f0-9]{64}$/i.test(activation.sourceSha256)
        && typeof activation.manifestSha256 === "string" && /^[a-f0-9]{64}$/i.test(activation.manifestSha256)
        && typeof activation.installedAt === "string" && Number.isFinite(Date.parse(activation.installedAt))
        && Number.isSafeInteger(activation.assetCount) && Number(activation.assetCount) > 0;
      if (activation.atlasId !== entry.atlasId || (!currentActivation && !legacyActivation)) return { ...entry, status: "unavailable" as const };
      if (currentActivation && typeof activation.manifestSha256 === "string") {
        const manifestText = await readFile(path.join(directory, "manifest.json"));
        if (createHash("sha256").update(manifestText).digest("hex") !== activation.manifestSha256) return { ...entry, status: "unavailable" as const };
      }
      const manifest = await readTeachingAnatomyManifest(entry.atlasId, configuredRoot, false);
      if (!manifest) return { ...entry };
      if (currentActivation && Number(activation.assetCount) !== Object.keys(manifest.assets).length) return { ...entry, status: "unavailable" as const };
      return {
        ...entry,
        title: manifest.title,
        bodyRegion: manifest.bodyRegion,
        organs: manifest.organs.length ? manifest.organs : [...entry.organs],
        systems: manifest.systems.length ? manifest.systems : [...entry.systems],
        modality: manifest.modality,
        crossSectionPlanes: manifest.supportedPlanes,
        correlatedImaging: manifest.correlatedImaging,
        status: "ready" as const,
        structureCount: manifest.structures.length,
        provenance: {
          sourceRepository: manifest.provenance.sourceRepository,
          project: manifest.provenance.project,
          attribution: manifest.provenance.attribution,
          license: manifest.provenance.license,
          licenseUrl: manifest.provenance.licenseUrl,
          use: manifest.provenance.use,
          ...(manifest.provenance.citation ? { citation: manifest.provenance.citation } : {}),
        },
      };
    } catch {
      return { ...entry, status: "unavailable" as const };
    }
  }));
}

export async function resolveTeachingAnatomyAsset(atlasId: string, assetKey: string): Promise<ResolvedTeachingAnatomyAsset | null> {
  const manifest = await readTeachingAnatomyManifest(atlasId, env.teachingAnatomyAssetRoot, false);
  if (!manifest) return null;
  const directory = teachingAnatomyAtlasDirectory(atlasId);
  const filePath = anatomyAssetPath(directory, manifest, assetKey);
  // Installation verifies complete SHA-256 metadata before atomic activation. Runtime
  // validates confinement, declaration, size and LFS state only; it must not reread an
  // 80 MB volume simply to hash it for every authenticated request.
  const file = await verifyAssetFile(directory, manifest, assetKey);
  const integrity = manifest.assets[assetKey]!.integrity;
  const etag = integrity ? `\"${integrity.sha256}\"` : `W/\"${file.sizeBytes.toString(16)}-${Math.floor(file.mtimeMs).toString(16)}\"`;
  return { filePath, mediaType: manifest.assets[assetKey]!.mediaType, sizeBytes: file.sizeBytes, etag, versioned: Boolean(integrity) };
}
