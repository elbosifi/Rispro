import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../pool.js';

test('252 records authorized wrong-patient attribution corrections without moving clinical records', async () => {
  assert.equal((await pool.query("select 1 from schema_migrations where filename='252_gamma_knife_patient_attribution_corrections.sql'")).rowCount, 1);
  const constraints = await pool.query("select conname from pg_constraint where conrelid='gamma_knife_patient_attribution_corrections'::regclass");
  assert.ok(constraints.rows.some(row => row.conname.includes('episode_id')));
  assert.ok(constraints.rows.some(row => row.conname.includes('reason')));
  assert.ok(constraints.rows.some(row => row.conname.includes('check')));
});
