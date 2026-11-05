import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../pool.js';

test('migration 246 provides fixed diagnosis categories without replacing configured categories', async (t) => {
  const applied = await pool.query("select 1 from schema_migrations where filename='246_gamma_knife_diagnosis_categories.sql'");
  assert.equal(applied.rowCount, 1);
  const result = await pool.query<{ diagnoses: Array<{ name: string; checklist: string[] }> }>(
    "select setting_value->'diagnoses' as diagnoses from system_settings where category='gamma_knife' and setting_key='config'",
  );
  const diagnoses = result.rows[0]?.diagnoses ?? [];
  for (const name of ['Other', 'Brain metastases', 'Vestibular schwannoma', 'Pituitary / parasellar lesion', 'Trigeminal neuralgia']) {
    assert.equal(diagnoses.filter(item => item.name === name).length, 1, name);
  }
  assert.ok(diagnoses.every(item => Array.isArray(item.checklist)));
  t.diagnostic('Existing diagnosis entries remain and the structured categories add no clinical selection rules.');
});
