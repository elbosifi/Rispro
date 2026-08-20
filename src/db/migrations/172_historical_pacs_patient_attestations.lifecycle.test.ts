import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../pool.js";

test("migration 172 creates patient-scoped historical PACS attestations", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  assert.equal((await pool.query("select 1 from schema_migrations where filename='172_historical_pacs_patient_attestations.sql'")).rowCount, 1);
  const columns = await pool.query<{ column_name: string }>("select column_name from information_schema.columns where table_name='historical_pacs_patient_attestations'");
  for (const name of ["patient_id", "study_instance_uid", "status", "recorded_by_user_id", "recorded_at"]) assert.ok(columns.rows.some((row) => row.column_name === name));
  const constraint = await pool.query<{ pg_get_constraintdef: string }>("select pg_get_constraintdef(oid) from pg_constraint where conrelid='historical_pacs_patient_attestations'::regclass and contype='c'");
  assert.match(constraint.rows[0]?.pg_get_constraintdef ?? "", /confirmed.*denied/i);
  const unique = await pool.query<{ pg_get_constraintdef: string }>("select pg_get_constraintdef(oid) from pg_constraint where conrelid='historical_pacs_patient_attestations'::regclass and contype='u'");
  const hasPatientStudyUnique = unique.rows.some(({ pg_get_constraintdef }) =>
    /^unique\s*\(\s*patient_id\s*,\s*study_instance_uid\s*\)$/i.test(pg_get_constraintdef.replace(/\s+/g, " ").trim()),
  );
  assert.ok(hasPatientStudyUnique, "Expected a UNIQUE constraint on (patient_id, study_instance_uid).");
});
