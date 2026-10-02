import { open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { env } from "../../../config/env.js";
import { anatomyAssetPath, parseAnatomyAtlasManifest, type AnatomyAtlasManifest } from "./anatomy-atlas.js";

const atlasDirectoryName = "spl-liver";

export function teachingAnatomyAtlasDirectory(configuredRoot = env.teachingAnatomyAssetRoot): string {
  return path.resolve(configuredRoot, atlasDirectoryName);
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

async function verifyDeclaredAssets(directory: string, manifest: AnatomyAtlasManifest): Promise<void> {
  const root = await realpath(directory);
  for (const [assetKey] of Object.entries(manifest.assets)) {
    const filePath = anatomyAssetPath(directory, manifest, assetKey);
    const actualPath = await realpath(filePath);
    if (path.dirname(actualPath) !== root) throw new Error(`Anatomy asset ${assetKey} resolves outside the installed atlas directory.`);
    const fileStat = await stat(actualPath);
    if (!fileStat.isFile() || fileStat.size === 0) throw new Error(`Anatomy asset ${assetKey} is missing or empty.`);
    if (await beginsWithLfsPointer(actualPath)) throw new Error(`Anatomy asset ${assetKey} is a Git LFS pointer, not the installed binary file.`);
  }
}

export async function readTeachingAnatomyManifest(): Promise<AnatomyAtlasManifest | null> {
  const directory = teachingAnatomyAtlasDirectory();
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
  await verifyDeclaredAssets(directory, manifest);
  return manifest;
}

export async function resolveTeachingAnatomyAsset(assetKey: string): Promise<{ filePath: string; mediaType: string } | null> {
  const manifest = await readTeachingAnatomyManifest();
  if (!manifest) return null;
  const filePath = anatomyAssetPath(teachingAnatomyAtlasDirectory(), manifest, assetKey);
  return { filePath, mediaType: manifest.assets[assetKey]!.mediaType };
}
