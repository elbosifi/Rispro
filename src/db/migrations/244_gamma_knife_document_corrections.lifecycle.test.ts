import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../pool.js";

test("migration 244 adds an auditable soft-removal state for Gamma Knife documents", async () => {
  const columns = await pool.query<{ column_name: string; is_nullable: string }>(
    "select column_name, is_nullable from information_schema.columns where table_schema='public' and table_name='gamma_knife_documents' and column_name=any($1::text[])",
    [["removed_at", "removed_by_user_id", "removal_reason"]]
  );
  assert.equal(columns.rowCount, 3);
  assert.ok(columns.rows.every(row => row.is_nullable === "YES"));
  const constraint = await pool.query("select 1 from pg_constraint where conname='gamma_knife_documents_removal_state_check'");
  assert.equal(constraint.rowCount, 1);
});
