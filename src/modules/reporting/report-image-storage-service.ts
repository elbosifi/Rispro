import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { loadDocumentStorageConfig, ensureNetworkAuthIfNeeded } from "../../services/document-storage-config.js";
import { resolveStorageBasePath, resolveStoredPath, toStoredPath } from "../../services/document-storage-path.js";
import { HttpError } from "../../utils/http-error.js";

export const imageDigest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export async function storeReportImage(bytes: Buffer): Promise<{ storedPath: string; absolutePath: string; sha256: string }> {
  const config = await loadDocumentStorageConfig();
  const targets: string[] = [];
  if (config.storagePath) {
    try { ensureNetworkAuthIfNeeded(config); targets.push(resolveStorageBasePath(config.storagePath)); }
    catch { if (!config.fallbackEnabled) throw new HttpError(503, "Configured document storage is unavailable."); }
  }
  if (config.fallbackEnabled) targets.push(resolveStorageBasePath(env.uploadsDir));
  for (const root of targets) {
    const absolutePath = path.join(root, "report-key-images", new Date().toISOString().slice(0,10), randomUUID() + ".png");
    let created = false;
    try {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      const file = await fs.open(absolutePath, "wx", 0o600);
      created = true;
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
      if (process.platform !== "win32") {
        const directory=await fs.open(path.dirname(absolutePath),"r");
        try {await directory.sync();}finally{await directory.close();}
      }
      const sha256 = imageDigest(bytes);
      if (imageDigest(await fs.readFile(absolutePath)) !== sha256) throw Error("Image storage verification failed.");
      return { absolutePath, storedPath: toStoredPath(absolutePath), sha256 };
    } catch { if (created) await fs.unlink(absolutePath).catch(() => undefined); }
  }
  throw new HttpError(503, "Report image storage is unavailable. Retry the upload.");
}
export async function readReportImage(image: { stored_path: string; sha256: string; byte_size: number }): Promise<Buffer> {
  const config = await loadDocumentStorageConfig();
  const roots = [env.uploadsDir, config.storagePath].filter(Boolean).map(resolveStorageBasePath);
  const absolute = resolveStoredPath(image.stored_path);
  const stat = await fs.lstat(absolute).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new HttpError(503, "The stored report image is unavailable.");
  const real = await fs.realpath(absolute);
  let allowed = false;
  for (const root of roots) {
    const rootReal = await fs.realpath(root).catch(() => null);
    if (!rootReal) continue;
    const relative = path.relative(path.join(rootReal, "report-key-images"), real);
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) allowed = true;
  }
  if (!allowed) throw new HttpError(503, "Report image storage requires operator recovery.");
  const bytes = await fs.readFile(real);
  if (bytes.length !== Number(image.byte_size) || imageDigest(bytes) !== image.sha256) throw new HttpError(503, "Report image integrity verification failed.");
  return bytes;
}
