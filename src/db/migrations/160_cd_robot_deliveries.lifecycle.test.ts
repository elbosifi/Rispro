import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../../db/pool.js";

test("migration 160 creates the CD delivery history and one-active-patient guard", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  const applied = await pool.query<{ filename: string }>("select filename from schema_migrations where filename='160_cd_robot_deliveries.sql'");
  assert.equal(applied.rowCount, 1);
  const index = await pool.query<{ indexdef: string }>("select indexdef from pg_indexes where tablename='cd_robot_deliveries' and indexname='cd_robot_deliveries_one_active_patient_idx'");
  assert.match(index.rows[0]?.indexdef || "", /where \(status = 'sending'::text\)/i);
});
