import { open, readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
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

async function verifyAssetFile(directory: string, manifest: AnatomyAtlasManifest, assetKey: string, root?: string, verifyIntegrity = true): Promise<void> {
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
  let contents: string;
  try {
    contents = await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("The installed Teaching anatomy manifest is not valid JSON.");
  }
  const manifest = parseAnatomyAtlasManifest(parsed);
  if (manifest.atlasId !== atlasId) throw new Error("The installed anatomy manifest does not match its catalog atlas ID.");
  if (verifyAssets) await verifyDeclaredAssets(directory, manifest, verifyAssets === true);
  return manifest;
}

export async function readTeachingAnatomyCatalog(configuredRoot = env.teachingAnatomyAssetRoot): Promise<TeachingAnatomyAtlasCatalogEntry[]> {
  return Promise.all(TEACHING_ANATOMY_CATALOG.map(async (entry) => {
    try {
      const manifest = await readTeachingAnatomyManifest(entry.atlasId, configuredRoot, "presence");
      if (!manifest) return { ...entry };
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

export async function resolveTeachingAnatomyAsset(atlasId: string, assetKey: string): Promise<{ filePath: string; mediaType: string } | null> {
  const manifest = await readTeachingAnatomyManifest(atlasId, env.teachingAnatomyAssetRoot, false);
  if (!manifest) return null;
  const directory = teachingAnatomyAtlasDirectory(atlasId);
  const filePath = anatomyAssetPath(directory, manifest, assetKey);
  await verifyAssetFile(directory, manifest, assetKey);
  return { filePath, mediaType: manifest.assets[assetKey]!.mediaType };
}
