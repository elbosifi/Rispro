import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pool } from "../pool.js";

test("migration 217 creates an idempotent Teaching catalog and revision schema", async () => {
  const client = await pool.connect();
  const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "217_teaching_qbank_domain.sql");
  try {
    const before = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'teaching' order by table_name`,
    );
    const expected = [
      "assets", "case_assets", "cases", "competencies", "difficulties", "domains", "modalities", "question_banks",
      "question_options", "question_references", "question_revision_assets", "question_revision_competencies",
      "question_revision_modalities", "question_revision_tags", "question_revisions", "question_sources", "questions",
      "references", "sources", "specialties", "subtopics", "tags", "topics", "training_levels", "user_permissions", "user_profiles",
    ];
    const beforeNames = before.rows.map((row) => row.table_name);
    for (const table of expected) assert.ok(beforeNames.includes(table), `missing teaching.${table}`);

    const catalog = await client.query<{ domains: number; topics: number; subtopics: number; banks: number; modalities: number }>(
      `select
         (select count(*)::int from teaching.domains where specialty_id = (select id from teaching.specialties where code = 'radiology')) as domains,
         (select count(*)::int from teaching.topics) as topics,
         (select count(*)::int from teaching.subtopics) as subtopics,
         (select count(*)::int from teaching.question_banks where code = 'radiology-main') as banks,
         (select count(*)::int from teaching.modalities) as modalities`,
    );
    assert.deepEqual(catalog.rows[0], { domains: 10, topics: 3, subtopics: 3, banks: 1, modalities: 9 });

    const constraint = await client.query<{ count: number }>(
      `select count(*)::int as count from pg_indexes where schemaname = 'teaching'
       and indexname in ('teaching_question_revisions_one_open_idx', 'teaching_question_options_one_correct_idx')`,
    );
    assert.equal(constraint.rows[0]!.count, 2);
    const hierarchyConstraints = await client.query<{ definition: string }>(
      `select pg_get_constraintdef(constraint_row.oid) as definition
       from pg_constraint constraint_row
       join pg_class relation on relation.oid = constraint_row.conrelid
       join pg_namespace namespace on namespace.oid = relation.relnamespace
       where namespace.nspname = 'teaching' and relation.relname in ('questions', 'question_revisions')
         and constraint_row.contype = 'f'`,
    );
    assert.ok(hierarchyConstraints.rows.some((row) => row.definition.includes("(question_bank_id, specialty_id)")));
    assert.ok(hierarchyConstraints.rows.some((row) => row.definition.includes("(question_id, specialty_id)")));
    assert.ok(hierarchyConstraints.rows.some((row) => row.definition.includes("(topic_id, domain_id)")));

    await client.query("begin");
    await client.query(await readFile(migrationPath, "utf8"));
    const repeated = await client.query<{ count: number }>(
      `select count(*)::int as count from teaching.domains domain join teaching.specialties specialty on specialty.id = domain.specialty_id
       where specialty.code = 'radiology'`,
    );
    assert.equal(repeated.rows[0]!.count, 10);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
