import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../pool.js';

test('254 preserves patient attribution snapshots while allowing referenced patients to be archived', async () => {
  const migration = await pool.query(
    "select 1 from schema_migrations where filename='254_gamma_knife_attribution_fk_repair.sql'",
  );
  assert.equal(migration.rowCount, 1);

  const foreignKeys = await pool.query<{ conname: string; confdeltype: string }>(`
    select conname,confdeltype
    from pg_constraint
    where conrelid='gamma_knife_patient_attribution_corrections'::regclass
      and conname in (
        'gamma_knife_patient_attribution_original_patient_fk',
        'gamma_knife_patient_attribution_corrected_patient_fk'
      )`);
  assert.equal(foreignKeys.rowCount, 2);
  assert.deepEqual(foreignKeys.rows.map(key => key.confdeltype), ['n', 'n']);
});
