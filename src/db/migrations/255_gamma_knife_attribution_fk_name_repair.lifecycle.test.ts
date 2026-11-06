import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../pool.js';

test('255 removes the truncated restrictive attribution FK and retains both archival references', async () => {
  assert.equal((await pool.query(
    "select 1 from schema_migrations where filename='255_gamma_knife_attribution_fk_name_repair.sql'",
  )).rowCount, 1);

  const constraints = await pool.query<{ conname: string; column_name: string; confdeltype: string }>(`
    select c.conname, a.attname as column_name, c.confdeltype
    from pg_constraint c
    cross join lateral unnest(c.conkey) key(attnum)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=key.attnum
    where c.conrelid='gamma_knife_patient_attribution_corrections'::regclass
      and c.contype='f'
    order by c.conname`);

  assert.equal(constraints.rows.length, 4);
  assert.deepEqual(
    constraints.rows.filter(row => ['original_patient_id', 'corrected_patient_id'].includes(row.column_name))
      .map(row => [row.column_name, row.confdeltype]).sort(),
    [['corrected_patient_id', 'n'], ['original_patient_id', 'n']],
  );
  assert.equal(constraints.rows.some(row => row.conname === 'gamma_knife_patient_attribution_corre_corrected_patient_id_fkey'), false);
  assert.equal(constraints.rows.some(row => row.column_name === 'episode_id' && row.confdeltype === 'a'), true);
  assert.equal(constraints.rows.some(row => row.column_name === 'authorized_by_user_id' && row.confdeltype === 'a'), true);
});
