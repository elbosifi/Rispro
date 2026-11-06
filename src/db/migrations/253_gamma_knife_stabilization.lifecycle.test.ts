import assert from 'node:assert/strict';
import { after, before, it } from 'node:test';
import { pool } from '../pool.js';

before(async () => {
  await pool.query('select 1');
});

after(async () => {
  await pool.end();
});

it('adds assignment lifecycle, follow-up plan, identity handoff, and attribution snapshots safely', async () => {
  const columns = await pool.query<{ table_name: string; column_name: string; is_nullable: string }>(`
    select table_name,column_name,is_nullable
    from information_schema.columns
    where table_schema=current_schema()
      and (table_name,column_name) in (
        ('gamma_knife_operation_task_assignments','status'),
        ('gamma_knife_patient_attribution_corrections','original_patient_snapshot'),
        ('gamma_knife_patient_attribution_corrections','corrected_patient_snapshot'),
        ('gamma_knife_patient_identity_correction_requests','patient_update_completed_at'),
        ('gamma_knife_patient_identity_correction_requests','patient_update_completed_by_user_id')
      )`);
  assert.equal(columns.rows.length, 5);
  const attribution = await pool.query<{ column_name: string; is_nullable: string }>(`
    select column_name,is_nullable from information_schema.columns
    where table_schema=current_schema() and table_name='gamma_knife_patient_attribution_corrections'
      and column_name in ('original_patient_id','corrected_patient_id')`);
  assert.equal(attribution.rows.every(column => column.is_nullable === 'YES'), true);
  const foreignKeys = await pool.query<{ conname: string; confdeltype: string }>(`
    select conname,confdeltype from pg_constraint
    where conrelid='gamma_knife_patient_attribution_corrections'::regclass
      and conname in ('gamma_knife_patient_attribution_original_patient_fk','gamma_knife_patient_attribution_corrected_patient_fk')`);
  assert.equal(foreignKeys.rows.length, 2);
  assert.equal(foreignKeys.rows.every(key => key.confdeltype === 'n'), true);
  const index = await pool.query<{ indexname: string }>(`
    select indexname from pg_indexes where schemaname=current_schema()
      and indexname in ('gamma_knife_operation_task_owner_status_due','gamma_knife_followup_plan_due','gamma_knife_identity_correction_handoff')`);
  assert.equal(index.rows.length, 3);
});
