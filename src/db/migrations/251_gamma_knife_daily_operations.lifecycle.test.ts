import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { pool } from '../pool.js';

before(async () => {
  const result = await pool.query<{ name: string }>('select current_database() as name');
  assert.match(result.rows[0]!.name, /test|e2e/i);
});

test('251 adds operational readiness, communication, task ownership and investigation priority', async () => {
  const readiness = await pool.query("select column_name from information_schema.columns where table_name='gamma_knife_readiness_items'");
  for (const column of ['episode_id','label','required','status','responsible_user_id','due_date','priority','notes','completed_at','completed_by_user_id']) {
    assert.ok(readiness.rows.some(row => row.column_name === column), `Missing readiness column ${column}`);
  }
  const communication = await pool.query("select column_name from information_schema.columns where table_name='gamma_knife_patient_communications'");
  for (const column of ['kind','outcome','notes','next_action','next_action_date','created_by_user_id','created_at']) {
    assert.ok(communication.rows.some(row => row.column_name === column), `Missing communication column ${column}`);
  }
  const assignment = await pool.query("select column_name from information_schema.columns where table_name='gamma_knife_operation_task_assignments'");
  for (const column of ['task_key','owner_user_id','due_date','priority','updated_by_user_id']) {
    assert.ok(assignment.rows.some(row => row.column_name === column), `Missing assignment column ${column}`);
  }
  const investigationPriority = await pool.query("select column_default from information_schema.columns where table_name='gamma_knife_investigations' and column_name='priority'");
  assert.equal(investigationPriority.rows[0]?.column_default, "'normal'::text");
});

after(async () => { await pool.end(); });
