import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../pool.js';

test('249 preserves closure classifications and permits replacement only after cancelled treatment plans', async () => {
  assert.equal((await pool.query("select 1 from schema_migrations where filename='249_gamma_knife_operational_corrections.sql'")).rowCount, 1);
  const episodeConstraints = await pool.query("select conname from pg_constraint where conrelid='gamma_knife_episodes'::regclass");
  assert.ok(episodeConstraints.rows.some(row => row.conname === 'gamma_knife_episode_closure_state_check'));
  assert.ok(episodeConstraints.rows.some(row => row.conname === 'gamma_knife_episode_replacement_self_check'));
  assert.equal((await pool.query("select 1 from pg_trigger where tgname='gamma_knife_closure_classification_default'")).rowCount, 1);
  const reassessmentIndex = (await pool.query("select indexdef from pg_indexes where indexname='gamma_knife_one_course_per_reassessment'")).rows[0];
  assert.match(reassessmentIndex.indexdef, /status <> 'cancelled'/);
  assert.match(reassessmentIndex.indexdef, /UNIQUE/);
});
