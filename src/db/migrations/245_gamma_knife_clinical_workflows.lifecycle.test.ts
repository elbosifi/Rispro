import assert from 'node:assert/strict';
import test from 'node:test';
import { pool } from '../pool.js';

test('Gamma Knife clinical workflow records have explicit states and retained history', async () => {
  const tables = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables where table_schema='public' and table_name=any($1::text[])`,
    [['gamma_knife_treatment_courses', 'gamma_knife_treatment_fractions', 'gamma_knife_treatment_history', 'gamma_knife_reassessments', 'gamma_knife_reassessment_decisions', 'gamma_knife_reassessment_history', 'gamma_knife_investigations', 'gamma_knife_investigation_history']],
  );
  assert.equal(tables.rows.length, 8);
  const courseColumns = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema='public' and table_name='gamma_knife_treatment_courses'`,
  );
  const courseColumnNames = new Set(courseColumns.rows.map(row => row.column_name));
  for (const name of ['planned_fraction_count', 'legacy_treatment_snapshot', 'completion_confirmed', 'completion_reason', 'prior_course_id', 'reassessment_id', 'report_document_id']) assert.ok(courseColumnNames.has(name), name);
  const migrationRows = await pool.query<{ source: string; count: string }>(
    `select source,count(*)::text as count from gamma_knife_treatment_courses group by source`,
  );
  assert.ok(migrationRows.rows.every(row => ['clinical_record', 'legacy_import'].includes(row.source)));
  const fabricatedLegacyFractions = await pool.query<{ count: string }>(`select count(*)::text as count from gamma_knife_treatment_fractions f join gamma_knife_treatment_courses c on c.id=f.course_id where c.source='legacy_import'`);
  assert.equal(fabricatedLegacyFractions.rows[0]!.count, '0');
  const invalidDeliveredFraction = await pool.query<{ conname: string }>(
    `select conname from pg_constraint where conrelid='gamma_knife_treatment_fractions'::regclass and conname like '%check%'`,
  );
  assert.ok(invalidDeliveredFraction.rows.length >= 1);
});
