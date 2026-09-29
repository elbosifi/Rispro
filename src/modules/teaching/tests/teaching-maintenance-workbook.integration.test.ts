import assert from "node:assert/strict";
import test from "node:test";
import { readWorkbookFromBase64 } from "../../../services/workbook-service.js";
import { exportTeachingMaintenanceWorkbook } from "../import/maintenance-workbook-service.js";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";

test("Teaching maintenance export has stable multi-sheet headers", async (t) => {
  const { pool } = await import("../../../db/pool.js");
  try { await pool.query("select 1 from teaching.question_banks limit 1"); }
  catch { t.skip("PostgreSQL is not reachable at the configured disposable DATABASE_URL."); return; }
  const workbook = await exportTeachingMaintenanceWorkbook();
  const { XLSX, workbook: parsed } = await readWorkbookFromBase64(workbook.toString("base64"));
  assert.deepEqual(parsed.SheetNames, ["Questions", "Options", "Sources", "References", "Media", "Taxonomy", "Topic Proposals", "Instructions"]);
  const headers = (sheet: string) => XLSX.utils.sheet_to_json<string[]>(parsed.Sheets[sheet]!, { header: 1, blankrows: false })[0] ?? [];
  assert.deepEqual(headers("Questions").slice(0, 7), ["question_bank_code", "external_id", "question_id", "revision_id", "revision_number", "revision_version", "status"]);
  assert.ok(headers("Questions").includes("evidence_status"));
  assert.deepEqual(headers("Media"), ["external_id", "media_order", "asset_id", "asset_key", "original_filename", "alt_text"]);
  assert.ok(headers("Taxonomy").includes("type"));
  assert.deepEqual(headers("Topic Proposals"), ["specialty", "domain", "code", "label", "description"]);
});
