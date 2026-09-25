import Busboy from "busboy";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { createWriteStream } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Request } from "express";
import { env } from "../../../config/env.js";
import { pool } from "../../../db/pool.js";
import { resolveStorageBasePath } from "../../../services/document-storage-path.js";
import { HttpError } from "../../../utils/http-error.js";
import type { TeachingImportIssue } from "./import-schema.js";

export const TEACHING_IMPORT_LIMITS = {
  jsonBytes: 12 * 1024 * 1024,
  zipBytes: 32 * 1024 * 1024,
  imageBytes: 8 * 1024 * 1024,
  zipEntries: 256,
  assets: 250,
  expandedBytes: 100 * 1024 * 1024,
  imagePixels: 40_000_000,
  imageCompressionRatio: 200,
  batchLifetimeMs: 24 * 60 * 60 * 1000,
} as const;

export interface TeachingImportUpload {
  filename: string;
  inputType: "json" | "zip";
  bytes: Buffer;
}

export interface TeachingImageUpload {
  filename: string;
  mimeType: StagedTeachingAsset["mimeType"];
  bytes: Buffer;
}

export interface StagedTeachingAsset {
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sizeBytes: number;
  stagedPath: string;
}

export interface ExtractedTeachingUpload {
  filename: string;
  inputType: "json" | "zip";
  questionsJson: Buffer;
  stagedAssets: StagedTeachingAsset[];
  stagingDirectory: string;
  warnings: TeachingImportIssue[];
}

const STAGING_ROOT = path.join(tmpdir(), "rispro-teaching-imports");

export async function receiveTeachingImportUpload(req: Request): Promise<TeachingImportUpload> {
  const length = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > TEACHING_IMPORT_LIMITS.zipBytes + 128 * 1024) {
    throw new HttpError(413, "Teaching import upload exceeds the maximum file size.");
  }
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "rispro-teaching-upload-"));
  const uploadPath = path.join(tempDirectory, randomUUID());
  const writes: Promise<void>[] = [];
  try {
    const metadata = await new Promise<{ filename: string; mimeType: string }>((resolve, reject) => {
      let fileCount = 0;
      let uploadMetadata: { filename: string; mimeType: string } | null = null;
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      let parser: ReturnType<typeof Busboy>;
      try {
        parser = Busboy({
          headers: req.headers,
          limits: { files: 1, fields: 0, parts: 2, fileSize: TEACHING_IMPORT_LIMITS.zipBytes },
        });
      } catch {
        reject(new HttpError(400, "Expected a multipart upload containing one file."));
        return;
      }
      parser.on("file", (fieldName, file, info) => {
        fileCount += 1;
        if (fieldName !== "file" || fileCount !== 1) {
          file.resume();
          fail(new HttpError(400, "Upload exactly one file using the file field."));
          return;
        }
        const rawName = String(info.filename || "").replaceAll("\\", "/");
        const basename = path.posix.basename(rawName).normalize("NFC");
        if (!basename || basename === "." || basename === ".." || rawName.includes("\0")) {
          file.resume();
          fail(new HttpError(400, "Upload filename is invalid."));
          return;
        }
        uploadMetadata = { filename: basename.slice(0, 255), mimeType: String(info.mimeType || "").toLowerCase() };
        const write = pipeline(file, createWriteStream(uploadPath, { flags: "wx", mode: 0o600 }));
        writes.push(write);
        void write.catch((error: unknown) => fail(error instanceof Error ? error : new Error("Upload stream failed.")));
        file.on("limit", () => fail(new HttpError(413, "Teaching import file exceeds the 32 MB upload limit.")));
      });
      parser.on("filesLimit", () => fail(new HttpError(413, "Only one import file is accepted.")));
      parser.on("fieldsLimit", () => fail(new HttpError(400, "Text fields are not accepted in the import request.")));
      parser.on("partsLimit", () => fail(new HttpError(400, "Only one multipart file part is accepted.")));
      parser.on("error", (error: unknown) => fail(error instanceof Error ? error : new HttpError(400, "Multipart upload could not be parsed.")));
      parser.on("finish", () => {
        void Promise.all(writes).then(() => {
          if (settled) return;
          if (fileCount !== 1 || !uploadMetadata) {
            fail(new HttpError(400, "An import file is required."));
            return;
          }
          settled = true;
          resolve(uploadMetadata);
        }).catch((error: unknown) => fail(error instanceof Error ? error : new Error("Upload stream failed.")));
      });
      req.pipe(parser);
    });
    const extension = path.extname(metadata.filename).toLocaleLowerCase("en-US");
    const inputType = extension === ".json" ? "json" : extension === ".zip" ? "zip" : null;
    if (inputType === null) throw new HttpError(400, "Teaching imports must be a .json or .zip file.");
    const allowedTypes = inputType === "json"
      ? ["application/json", "text/json", "application/octet-stream", ""]
      : ["application/zip", "application/x-zip-compressed", "application/octet-stream", ""];
    if (!allowedTypes.includes(metadata.mimeType)) throw new HttpError(400, `Upload content type does not match .${inputType}.`);
    const bytes = await readFile(uploadPath);
    const maximum = inputType === "json" ? TEACHING_IMPORT_LIMITS.jsonBytes : TEACHING_IMPORT_LIMITS.zipBytes;
    if (bytes.length === 0) throw new HttpError(400, "Import file is empty.");
    if (bytes.length > maximum) throw new HttpError(413, `The ${inputType.toUpperCase()} file exceeds its ${Math.floor(maximum / (1024 * 1024))} MB limit.`);
    return { filename: metadata.filename, inputType, bytes };
  } finally {
    await Promise.allSettled(writes);
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function receiveTeachingImageUpload(req: Request): Promise<TeachingImageUpload> {
  const length = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(length) && length > TEACHING_IMPORT_LIMITS.imageBytes + 128 * 1024) {
    throw new HttpError(413, "Teaching image upload exceeds the 8 MB limit.");
  }
  return new Promise<TeachingImageUpload>((resolve, reject) => {
    let fileCount = 0;
    let settled = false;
    let upload: { filename: string; declaredMimeType: string; raw: Buffer } | null = null;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    let parser: ReturnType<typeof Busboy>;
    try {
      // Busboy emits partsLimit when the configured count is reached. Allow a
      // second part so one file is accepted; the files/fields limits still
      // reject anything beyond that single file.
      parser = Busboy({ headers: req.headers, limits: { files: 1, fields: 0, parts: 2, fileSize: TEACHING_IMPORT_LIMITS.imageBytes } });
    } catch {
      reject(new HttpError(400, "Expected a multipart upload containing one Teaching image."));
      return;
    }
    parser.on("file", (fieldName, file, info) => {
      fileCount += 1;
      const rawName = String(info.filename || "").replaceAll("\\", "/");
      const filename = path.posix.basename(rawName).normalize("NFC");
      if (fieldName !== "file" || fileCount !== 1 || !filename || filename.includes("\0")
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,195}\.(?:jpe?g|png|webp)$/i.test(filename) || filename.includes("..")) {
        file.resume();
        fail(new HttpError(400, "Upload one JPEG, PNG, or WebP image with a safe filename."));
        return;
      }
      const chunks: Buffer[] = [];
      file.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      file.on("limit", () => fail(new HttpError(413, "Teaching image upload exceeds the 8 MB limit.")));
      file.on("end", () => { upload = { filename, declaredMimeType: String(info.mimeType || "").toLowerCase(), raw: Buffer.concat(chunks) }; });
    });
    parser.on("filesLimit", () => fail(new HttpError(413, "Only one Teaching image is accepted.")));
    parser.on("fieldsLimit", () => fail(new HttpError(400, "Text fields are not accepted in the image upload request.")));
    parser.on("partsLimit", () => fail(new HttpError(400, "Only one multipart image file part is accepted.")));
    parser.on("error", (error: unknown) => fail(error instanceof Error ? error : new HttpError(400, "Teaching image upload could not be parsed.")));
    parser.on("finish", () => {
      if (settled) return;
      const received = upload as { filename: string; declaredMimeType: string; raw: Buffer } | null;
      if (fileCount !== 1 || !received || received.raw.length === 0) {
        fail(new HttpError(400, "A Teaching image file is required."));
        return;
      }
      const mimeType = detectImageMime(received.raw);
      const allowedDeclared = new Set(["", "application/octet-stream", mimeType ?? ""]);
      if (!mimeType || !extensionMatchesMime(received.filename, mimeType) || !allowedDeclared.has(received.declaredMimeType)) {
        fail(new HttpError(400, "Teaching image content must match its JPEG, PNG, or WebP filename and type."));
        return;
      }
      void sanitizeTeachingImage(received.raw, mimeType, received.filename).then((bytes) => {
        if (settled) return;
        settled = true;
        resolve({ filename: received.filename, mimeType, bytes });
      }).catch((error: unknown) => fail(error instanceof Error ? error : new HttpError(400, "Teaching image could not be sanitized.")));
    });
    req.pipe(parser);
  });
}

export async function extractTeachingImportUpload(upload: TeachingImportUpload, batchId: string): Promise<ExtractedTeachingUpload> {
  const stagingDirectory = getBatchStagingDirectory(batchId);
  const stagedAssets: StagedTeachingAsset[] = [];
  const warnings: TeachingImportIssue[] = [];
  if (upload.inputType === "json") {
    await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
    return { filename: upload.filename, inputType: upload.inputType, questionsJson: upload.bytes, stagedAssets, stagingDirectory, warnings };
  }
  let entries: AdmZip.IZipEntry[];
  try {
    entries = new AdmZip(upload.bytes).getEntries();
  } catch {
    throw new HttpError(400, "ZIP archive is invalid or cannot be read.");
  }
  if (entries.length === 0 || entries.length > TEACHING_IMPORT_LIMITS.zipEntries) throw new HttpError(413, `ZIP archive must contain at most ${TEACHING_IMPORT_LIMITS.zipEntries} entries.`);
  let expandedBytes = 0;
  let questionFile: Buffer | null = null;
  const normalizedNames = new Set<string>();
  const assetEntries: AdmZip.IZipEntry[] = [];
  for (const entry of entries) {
    const name = entry.entryName.normalize("NFC");
    if (!name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
      throw new HttpError(400, "ZIP contains an absolute or unsafe entry path.");
    }
    const segments = name.split("/");
    if (segments.some((segment) => segment === ".." || segment === "." || segment === "" && name !== "assets/" && !name.endsWith("/"))) {
      throw new HttpError(400, "ZIP contains a path traversal entry.");
    }
    const normalized = name.toLocaleLowerCase("en-US");
    if (normalizedNames.has(normalized)) throw new HttpError(400, `ZIP contains duplicate normalized entry "${name}".`);
    normalizedNames.add(normalized);
    const unixMode = (entry.attr >>> 16) & 0o170000;
    if (unixMode === 0o120000) throw new HttpError(400, "ZIP symbolic links are not supported.");
    if (entry.isDirectory) {
      if (name !== "assets/") throw new HttpError(400, `Unexpected ZIP directory "${name}".`);
      continue;
    }
    const expectedSize = entry.header.size;
    const compressedSize = entry.header.compressedSize;
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 0 || !Number.isSafeInteger(compressedSize) || compressedSize < 0) {
      throw new HttpError(400, `ZIP entry "${name}" has invalid size metadata.`);
    }
    expandedBytes += expectedSize;
    if (expectedSize < 0 || expandedBytes > TEACHING_IMPORT_LIMITS.expandedBytes) throw new HttpError(413, "ZIP expands beyond the 100 MB total limit.");
    if (compressedSize === 0 ? expectedSize > 0 : expectedSize / compressedSize > TEACHING_IMPORT_LIMITS.imageCompressionRatio) {
      throw new HttpError(413, "ZIP entry expansion ratio exceeds the safe limit.");
    }
    if (name === "questions.json") {
      if (expectedSize > TEACHING_IMPORT_LIMITS.jsonBytes) throw new HttpError(413, "questions.json exceeds the 12 MB limit.");
      questionFile = readZipEntryData(entry, name);
      if (questionFile.length !== expectedSize) throw new HttpError(400, "questions.json has an inconsistent expanded size.");
      continue;
    }
    if (!name.startsWith("assets/") || name.slice("assets/".length).includes("/")) throw new HttpError(400, `Unsupported ZIP entry "${name}". Only questions.json and assets/<image> are accepted.`);
    if (assetEntries.length >= TEACHING_IMPORT_LIMITS.assets) throw new HttpError(413, `ZIP archive may contain at most ${TEACHING_IMPORT_LIMITS.assets} image assets.`);
    if (expectedSize > TEACHING_IMPORT_LIMITS.imageBytes) throw new HttpError(413, `ZIP asset "${name}" exceeds the 8 MB image limit.`);
    assetEntries.push(entry);
  }
  if (!questionFile) throw new HttpError(400, "ZIP archive must contain a root questions.json file.");
  await mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
  const filenames = new Set<string>();
  try {
    for (const entry of assetEntries) {
      const filename = entry.entryName.slice("assets/".length).normalize("NFC");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(filename) || filename.includes("..")) {
        throw new HttpError(400, `ZIP asset "${filename}" has an unsafe or unsupported filename.`);
      }
      const key = filename.toLocaleLowerCase("en-US");
      if (filenames.has(key)) throw new HttpError(400, `ZIP contains duplicate image filename "${filename}".`);
      filenames.add(key);
      const raw = readZipEntryData(entry, filename);
      if (raw.length !== entry.header.size || raw.length === 0) throw new HttpError(400, `ZIP asset "${filename}" has an inconsistent or empty payload.`);
      const mimeType = detectImageMime(raw);
      if (!mimeType || !extensionMatchesMime(filename, mimeType)) throw new HttpError(400, `ZIP asset "${filename}" has unsupported image content or a mismatched extension.`);
      const cleanBytes = await sanitizeTeachingImage(raw, mimeType, filename, "ZIP asset");
      const stagedPath = path.join(stagingDirectory, filename);
      await writeFile(stagedPath, cleanBytes, { flag: "wx", mode: 0o600 });
      stagedAssets.push({ filename, mimeType, sizeBytes: cleanBytes.length, stagedPath });
    }
  } catch (error) {
    await cleanupTeachingImportStaging(batchId);
    throw error;
  }
  return { filename: upload.filename, inputType: upload.inputType, questionsJson: questionFile, stagedAssets, stagingDirectory, warnings };
}

function detectImageMime(bytes: Buffer): StagedTeachingAsset["mimeType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function extensionMatchesMime(filename: string, mimeType: StagedTeachingAsset["mimeType"]): boolean {
  const extension = path.extname(filename).toLocaleLowerCase("en-US");
  return mimeType === "image/jpeg" ? extension === ".jpg" || extension === ".jpeg"
    : mimeType === "image/png" ? extension === ".png"
      : extension === ".webp";
}

function readZipEntryData(entry: AdmZip.IZipEntry, filename: string): Buffer {
  try {
    return entry.getData();
  } catch {
    throw new HttpError(400, `ZIP entry "${filename}" could not be decompressed.`);
  }
}

export async function sanitizeTeachingImage(bytes: Buffer, mimeType: StagedTeachingAsset["mimeType"], filename: string, context = "Teaching image"): Promise<Buffer> {
  try {
    const image = sharp(bytes, { limitInputPixels: TEACHING_IMPORT_LIMITS.imagePixels, failOn: "warning" });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > TEACHING_IMPORT_LIMITS.imagePixels || metadata.pages && metadata.pages > 1) {
      throw new HttpError(400, `${context} "${filename}" has unreasonable or animated image dimensions.`);
    }
    const transformer = sharp(bytes, { limitInputPixels: TEACHING_IMPORT_LIMITS.imagePixels, failOn: "warning" }).rotate();
    const clean = mimeType === "image/jpeg" ? await transformer.jpeg({ quality: 90, mozjpeg: true }).toBuffer()
      : mimeType === "image/png" ? await transformer.png({ compressionLevel: 8 }).toBuffer()
        : await transformer.webp({ quality: 90 }).toBuffer();
    if (clean.length > TEACHING_IMPORT_LIMITS.imageBytes) throw new HttpError(413, `Sanitized image "${filename}" exceeds the 8 MB limit.`);
    return clean;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, `${context} "${filename}" is not a decodable supported image.`);
  }
}

function getBatchStagingDirectory(batchId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(batchId)) throw new HttpError(400, "Import batch ID is invalid.");
  return path.join(STAGING_ROOT, batchId);
}

export async function loadStagedTeachingAssets(batchId: string): Promise<StagedTeachingAsset[]> {
  const directory = getBatchStagingDirectory(batchId);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const assets: StagedTeachingAsset[] = [];
  for (const filename of names) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(filename) || filename.includes("..")) continue;
    const fullPath = path.join(directory, filename);
    try {
      const details = await lstat(fullPath);
      if (!details.isFile() || details.isSymbolicLink()) continue;
      const extension = path.extname(filename).toLocaleLowerCase("en-US");
      const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".png" ? "image/png" : "image/webp";
      assets.push({ filename, mimeType, sizeBytes: details.size, stagedPath: fullPath });
    } catch {
      continue;
    }
  }
  return assets;
}

export async function cleanupTeachingImportStaging(batchId: string): Promise<void> {
  await rm(getBatchStagingDirectory(batchId), { recursive: true, force: true });
}

export async function cleanupExpiredTeachingImports(): Promise<void> {
  const result = await pool.query<{ id: string }>(
    `update teaching.import_batches set status = 'expired', payload_json = null
     where status not in ('confirmed', 'expired') and expires_at <= now()
     returning id`,
  );
  await Promise.all(result.rows.map((row) => cleanupTeachingImportStaging(row.id).catch(() => undefined)));
  try {
    const entries = await readdir(STAGING_ROOT, { withFileTypes: true });
    const threshold = Date.now() - TEACHING_IMPORT_LIMITS.batchLifetimeMs;
    await Promise.all(entries.filter((entry) => entry.isDirectory() && /^[0-9a-f-]{36}$/i.test(entry.name)).map(async (entry) => {
      const target = path.join(STAGING_ROOT, entry.name);
      try {
        const details = await stat(target);
        if (details.mtimeMs <= threshold) await rm(target, { recursive: true, force: true });
      } catch {
        return;
      }
    }));
  } catch {
    return;
  }
}

export async function promoteTeachingAsset(asset: StagedTeachingAsset): Promise<{ storageKey: string; absolutePath: string }> {
  const permanent = await teachingAssetDestination(asset.filename);
  await copyFile(asset.stagedPath, permanent.absolutePath, 1);
  return permanent;
}

export async function promoteTeachingAssetBytes(asset: TeachingImageUpload): Promise<{ storageKey: string; absolutePath: string }> {
  const permanent = await teachingAssetDestination(asset.filename);
  await writeFile(permanent.absolutePath, asset.bytes, { flag: "wx", mode: 0o600 });
  return permanent;
}

async function teachingAssetDestination(originalFilename: string): Promise<{ storageKey: string; absolutePath: string }> {
  const extension = path.extname(originalFilename).toLocaleLowerCase("en-US");
  const storageFilename = `${randomUUID()}${extension}`;
  const storageKey = path.posix.join("teaching", "assets", storageFilename);
  const base = resolveStorageBasePath(env.uploadsDir);
  const absolutePath = path.join(base, "teaching", "assets", storageFilename);
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 });
  return { storageKey, absolutePath };
}

export async function removePromotedTeachingAsset(absolutePath: string): Promise<void> {
  await unlink(absolutePath).catch(() => undefined);
}
