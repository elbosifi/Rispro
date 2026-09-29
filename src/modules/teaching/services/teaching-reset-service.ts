import { rm } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import { env } from "../../../config/env.js";
import { pool } from "../../../db/pool.js";
import { resolveStorageBasePath } from "../../../services/document-storage-path.js";
import { HttpError } from "../../../utils/http-error.js";

const CONFIRMATION = "RESET-TEACHING";
const CONTENT_TABLES = ["sessions", "session_questions", "attempts", "user_question_state", "bookmarks", "notes", "study_cycles", "question_validation_summaries", "question_revision_modalities", "question_revision_competencies", "question_revision_tags", "question_sources", "question_references", "question_revision_assets", "case_assets", "question_revisions", "questions", "cases", "sources", "references", "assets", "import_batches"] as const;

function safeTeachingAssetPath(storageKey: string): string | null {
  if (!/^teaching\/assets\/[0-9a-f-]{36}\.(?:jpe?g|png|webp)$/i.test(storageKey)) return null;
  const root = resolveStorageBasePath(env.uploadsDir); const absolute = path.resolve(root, ...storageKey.split("/")); const relative = path.relative(root, absolute);
  return relative.startsWith("..") || path.isAbsolute(relative) ? null : absolute;
}

export async function teachingResetContentCounts(client: Pool | PoolClient = pool) {
  const result: Record<string, number> = {};
  for (const table of CONTENT_TABLES) {
    const row = await client.query<{ count: string }>(`select count(*)::text as count from teaching.${table === "references" ? '"references"' : table}`);
    result[table] = Number(row.rows[0]?.count ?? 0);
  }
  return result;
}

export async function resetTeachingContent(options: { confirmation?: string; nodeEnv?: string } = {}) {
  if ((options.nodeEnv ?? env.nodeEnv) === "production") throw new HttpError(403, "Teaching content reset is permanently disabled in production.");
  const client = await pool.connect();
  try {
    const counts = await teachingResetContentCounts(client);
    if (options.confirmation !== CONFIRMATION) return { deleted: false, counts, confirmationCommand: "npm run teaching:reset-content -- --confirm RESET-TEACHING" };
    const assets = await client.query<{ storage_key: string }>("select storage_key from teaching.assets");
    await client.query("begin");
    await client.query(`truncate table ${CONTENT_TABLES.map((table) => `teaching.${table === "references" ? '"references"' : table}`).join(", ")} restart identity`);
    await client.query("commit");
    const assetDeletion = await Promise.all(assets.rows.map(async (asset) => { const target = safeTeachingAssetPath(asset.storage_key); if (target) await rm(target, { force: true }); }));
    void assetDeletion;
    return { deleted: true, counts };
  } catch (error) {
    await client.query("rollback").catch(() => undefined); throw error;
  } finally { client.release(); }
}

export { CONFIRMATION as TEACHING_RESET_CONFIRMATION };
