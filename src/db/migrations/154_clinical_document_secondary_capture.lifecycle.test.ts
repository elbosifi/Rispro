import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../../db/pool.js";

test("migration 154 adds versioned Secondary Capture page persistence", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  const applied = await pool.query<{ filename: string }>("select filename from schema_migrations where filename='154_clinical_document_secondary_capture.sql'");
  assert.equal(applied.rowCount, 1);
  const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='clinical_document_exports' and column_name=any($1::text[])", [["representation_type", "expected_page_count", "exported_page_count", "verified_page_count", "series_number"]]);
  assert.equal(columns.rowCount, 5);
  const pageColumns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='clinical_document_export_instances' and column_name=any($1::text[])", [["export_id", "page_number", "instance_number", "sop_instance_uid", "series_instance_uid", "pixel_sha256", "status", "verified_at"]]);
  assert.equal(pageColumns.rowCount, 8);
});
