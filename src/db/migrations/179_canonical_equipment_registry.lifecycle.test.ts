import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../../db/pool.js";

test("migration 179 preserves scanner IDs and canonical equipment constraints", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  assert.equal((await pool.query("select 1 from schema_migrations where filename='179_canonical_equipment_registry.sql' ")).rowCount, 1);
  const columns = await pool.query<{ column_name:string }>("select column_name from information_schema.columns where table_name='equipment'");
  for (const column of ["equipment_type", "modality_id", "serial_number", "dicom_device_id", "modality"]) assert.ok(columns.rows.some((row) => row.column_name === column));
  const constraints = await pool.query<{ conname:string }>("select conname from pg_constraint where conrelid='equipment'::regclass");
  assert.ok(constraints.rows.some((row) => row.conname === "equipment_legacy_modality_sync_check"));
  const indexes = await pool.query<{ indexname:string }>("select indexname from pg_indexes where tablename='equipment'");
  assert.ok(indexes.rows.some((row) => row.indexname === "equipment_dicom_device_id_uidx"));
  const refs = await pool.query<{ table_name:string }>("select table_name from information_schema.constraint_column_usage where table_name='equipment'");
  assert.ok(refs.rows.length >= 1);
});
