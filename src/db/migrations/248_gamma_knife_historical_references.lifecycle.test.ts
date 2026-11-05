import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../pool.js';

test('248 adds evidence references and preserves active-episode uniqueness and treatment approval constraints', async () => {
  assert.equal((await pool.query("select 1 from schema_migrations where filename='248_gamma_knife_historical_references.sql'")).rowCount,1);
  const index = (await pool.query("select indexdef from pg_indexes where indexname='gamma_knife_one_active_episode'")).rows[0];
  assert.match(index.indexdef,/UNIQUE/);
  assert.match(index.indexdef,/WHERE active/);
  assert.equal((await pool.query("select 1 from pg_trigger where tgname='gamma_knife_historical_reference_valid'")).rowCount,1);
  assert.equal((await pool.query("select 1 from pg_constraint where conrelid='gamma_knife_historical_references'::regclass and contype='f'")).rowCount,4);
});
