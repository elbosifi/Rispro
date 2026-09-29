import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { env } from "../../../config/env.js";
import { pool } from "../../../db/pool.js";
import { resolveStorageBasePath } from "../../../services/document-storage-path.js";
import { HttpError } from "../../../utils/http-error.js";

const CONFIRMATION = "RESET-TEACHING";
const CONTENT_TABLES = [
  "sessions", "session_questions", "attempts", "user_question_state", "bookmarks", "notes", "study_cycles",
  "question_validation_summaries", "question_revision_modalities", "question_revision_competencies",
  "question_revision_tags", "question_sources", "question_references", "question_revision_assets", "case_assets",
  "question_options", "question_revisions", "questions", "cases", "sources", "references", "assets", "import_batches",
] as const;

export interface TeachingResetResult {
  deleted: boolean;
  counts: Record<string, number>;
  confirmationCommand?: string;
  assetFilesDeleted: number;
  assetFileDeletionFailures: Array<{ storageKey: string; reason: string }>;
}

function safeTeachingAssetPath(storageKey: string, uploadsDir: string): string | null {
  if (!/^teaching\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpe?g|png|webp)$/i.test(storageKey)) return null;
  const root = resolveStorageBasePath(uploadsDir);
  const absolute = path.resolve(root, "teaching", "assets", path.basename(storageKey));
  const relative = path.relative(root, absolute);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) return null;
  return absolute;
}

async function validateTeachingAssetDirectory(target: string, uploadsDir: string): Promise<string | null> {
  const root = resolveStorageBasePath(uploadsDir);
  const candidate = safeTeachingAssetPath(path.relative(root, target).split(path.sep).join("/"), uploadsDir);
  if (!candidate || candidate !== target) return null;
  try {
    const realRoot = await realpath(root);
    const realAssets = await realpath(path.dirname(candidate));
    const relativeAssets = path.relative(realRoot, realAssets);
    if (relativeAssets === ".." || relativeAssets.startsWith(".." + path.sep) || path.isAbsolute(relativeAssets)) return null;
    return path.join(realAssets, path.basename(candidate));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return candidate;
    throw error;
  }
}

export async function teachingResetContentCounts(client: Pool | PoolClient = pool) {
  const result: Record<string, number> = {};
  for (const table of CONTENT_TABLES) {
    const relation = table === "references" ? '"references"' : table;
    const row = await client.query<{ count: string }>("select count(*)::text as count from teaching." + relation);
    result[table] = Number(row.rows[0]?.count ?? 0);
  }
  return result;
}

async function deleteTeachingAssetFiles(storageKeys: string[], uploadsDir: string) {
  let assetFilesDeleted = 0;
  const assetFileDeletionFailures: TeachingResetResult["assetFileDeletionFailures"] = [];
  for (const storageKey of storageKeys) {
    const target = safeTeachingAssetPath(storageKey, uploadsDir);
    if (!target) {
      assetFileDeletionFailures.push({ storageKey, reason: "Skipped: storage key is not a valid Teaching asset path." });
      continue;
    }
    try {
      const validatedTarget = await validateTeachingAssetDirectory(target, uploadsDir);
      if (!validatedTarget) {
        assetFileDeletionFailures.push({ storageKey, reason: "Skipped: Teaching assets directory resolves outside its storage namespace." });
        continue;
      }
      let existed = true;
      try { await lstat(validatedTarget); }
      catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") existed = false;
        else throw error;
      }
      await rm(validatedTarget, { force: true });
      if (existed) assetFilesDeleted += 1;
    } catch (error) {
      assetFileDeletionFailures.push({ storageKey, reason: error instanceof Error ? error.message : "File deletion failed." });
    }
  }
  return { assetFilesDeleted, assetFileDeletionFailures };
}

export async function resetTeachingContent(options: {
  confirmation?: string;
  nodeEnv?: string;
  uploadsDir?: string;
} = {}): Promise<TeachingResetResult> {
  const nodeEnv = options.nodeEnv ?? env.nodeEnv;
  if (nodeEnv === "production") throw new HttpError(403, "Teaching content reset is permanently disabled in production.");
  const uploadsDir = options.uploadsDir ?? env.uploadsDir;
  const client = await pool.connect();
  let counts: Record<string, number>;
  let storageKeys: string[] = [];
  try {
    if (options.confirmation !== CONFIRMATION) {
      counts = await teachingResetContentCounts(client);
      return {
        deleted: false,
        counts,
        confirmationCommand: "npm run teaching:reset-content -- --confirm RESET-TEACHING",
        assetFilesDeleted: 0,
        assetFileDeletionFailures: [],
      };
    }
    await client.query("begin");
    counts = await teachingResetContentCounts(client);
    const assets = await client.query<{ storage_key: string }>("select storage_key from teaching.assets");
    storageKeys = assets.rows.map((asset) => asset.storage_key);
    const relations = CONTENT_TABLES.map((table) => "teaching." + (table === "references" ? '"references"' : table)).join(", ");
    await client.query("truncate table " + relations + " restart identity");
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  const files = await deleteTeachingAssetFiles(storageKeys, uploadsDir);
  return { deleted: true, counts, ...files };
}

export { CONFIRMATION as TEACHING_RESET_CONFIRMATION };
