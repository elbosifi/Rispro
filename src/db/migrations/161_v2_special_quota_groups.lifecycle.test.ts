import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../../db/pool.js";

test("migration 161 backfills generalized Special Quota groups and durable consumption", async (t) => {
  try {
    await pool.query("select 1");
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return;
  }

  const applied = await pool.query<{ filename: string }>(
    "select filename from schema_migrations where filename='161_v2_special_quota_groups.sql'"
  );
  assert.equal(applied.rowCount, 1);

  const tables = await pool.query<{ table_name: string }>(
    `select table_name
       from information_schema.tables
      where table_schema = 'appointments_v2'
        and table_name = any($1::text[])`,
    [[
      "special_quota_rules",
      "special_quota_rule_exam_types",
      "special_quota_rule_users",
      "special_quota_bucket_mutex",
      "special_quota_consumptions",
    ]]
  );
  assert.equal(tables.rowCount, 5);

  const counts = await pool.query<{
    legacyRules: number;
    generalizedRules: number;
    legacyUsers: number;
    generalizedUsers: number;
    legacyBookings: number;
    consumptions: number;
  }>(`
    select
      (select count(*)::int from appointments_v2.exam_type_special_quotas) as "legacyRules",
      (select count(*)::int from appointments_v2.special_quota_rules) as "generalizedRules",
      (select count(*)::int from appointments_v2.exam_type_special_quota_users) as "legacyUsers",
      (select count(*)::int from appointments_v2.special_quota_rule_users) as "generalizedUsers",
      (select count(*)::int from appointments_v2.bookings where uses_special_quota = true) as "legacyBookings",
      (select count(*)::int from appointments_v2.special_quota_consumptions) as consumptions
  `);
  assert.equal(counts.rows[0].generalizedRules, counts.rows[0].legacyRules);
  assert.equal(counts.rows[0].generalizedUsers, counts.rows[0].legacyUsers);
  assert.equal(counts.rows[0].consumptions, counts.rows[0].legacyBookings);

  const index = await pool.query<{ indexdef: string }>(
    `select indexdef
       from pg_indexes
      where schemaname = 'appointments_v2'
        and indexname = 'v2_special_quota_one_active_consumption_per_booking'`
  );
  assert.match(index.rows[0]?.indexdef ?? "", /unique.*booking_id.*where \(released_at is null\)/i);
});
