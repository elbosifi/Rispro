import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../pool.js';

test('250 adds append-only post-closure correction and patient identity request records', async () => {
  assert.equal((await pool.query("select 1 from schema_migrations where filename='250_gamma_knife_demographics_and_addenda.sql'")).rowCount, 1);
  const requests = await pool.query("select conname from pg_constraint where conrelid='gamma_knife_patient_identity_correction_requests'::regclass");
  assert.ok(requests.rows.some(row => row.conname.includes('requested_fields')));
  assert.ok(requests.rows.some(row => row.conname.includes('status')));
  const corrections = await pool.query("select conname from pg_constraint where conrelid='gamma_knife_post_closure_corrections'::regclass");
  assert.ok(corrections.rows.some(row => row.conname.includes('kind')));
  assert.ok(corrections.rows.some(row => row.conname.includes('reason')));
  assert.ok(corrections.rows.some(row => row.conname.includes('corrected_content')));
});
