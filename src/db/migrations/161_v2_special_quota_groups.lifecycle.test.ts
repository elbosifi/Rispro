import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pool } from "../../db/pool.js";

test("migration 161 preserves non-empty legacy quota and consumption relationships", async (t) => {
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

  const migrationSql = await readFile(new URL("./161_v2_special_quota_groups.sql", import.meta.url), "utf8");
  const client = await pool.connect();
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);

  try {
    await client.query("begin");

    // Isolate the migration backfill inside this transaction. Rollback restores
    // any pre-existing disposable-test data after the assertions complete.
    await client.query("update appointments_v2.bookings set uses_special_quota = false where uses_special_quota = true");
    await client.query("delete from appointments_v2.special_quota_consumptions");
    await client.query("delete from appointments_v2.special_quota_rules");
    await client.query("delete from appointments_v2.exam_type_special_quotas");

    const users = await client.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values
         ($1, 'unused', $2, 'doctor', true),
         ($3, 'unused', $4, 'doctor', false)
       returning id`,
      [`mig161_${suffix}_a`, `Migration 161 A ${suffix}`, `mig161_${suffix}_b`, `Migration 161 B ${suffix}`]
    );
    const [userA, userB] = users.rows.map((row) => Number(row.id));

    const modality = await client.query<{ id: number }>(
      `insert into modalities (name_ar, name_en, code, daily_capacity, is_active)
       values ($1, $2, $3, 10, true)
       returning id`,
      [`Migration 161 ${suffix}`, `Migration 161 ${suffix}`, `M161_${suffix}`]
    );
    const modalityId = Number(modality.rows[0].id);

    const exams = await client.query<{ id: number }>(
      `insert into exam_types (modality_id, name_ar, name_en, code, is_active)
       values
         ($1, $2, $3, $4, true),
         ($1, $5, $6, $7, true)
       returning id`,
      [
        modalityId,
        `Migration 161 Exam A ${suffix}`,
        `Migration 161 Exam A ${suffix}`,
        `M161A_${suffix}`,
        `Migration 161 Exam B ${suffix}`,
        `Migration 161 Exam B ${suffix}`,
        `M161B_${suffix}`,
      ]
    );
    const [examA, examB] = exams.rows.map((row) => Number(row.id));

    const patient = await client.query<{ id: number }>(
      `insert into patients (
         arabic_full_name, english_full_name, national_id, normalized_arabic_name,
         sex, age_years, phone_1, identifier_type, identifier_value
       ) values ($1, $2, $3::text, $1, 'M', 40, '0912345678', 'national_id', $3::text)
       returning id`,
      [`Migration 161 Patient ${suffix}`, `Migration 161 Patient ${suffix}`, `8${Date.now().toString().slice(-11)}`]
    );
    const patientId = Number(patient.rows[0].id);

    const policySet = await client.query<{ id: number }>(
      `insert into appointments_v2.policy_sets (key, name, created_by_user_id)
       values ($1, $2, $3)
       returning id`,
      [`mig161_${suffix}`, `Migration 161 ${suffix}`, userA]
    );
    const policyVersion = await client.query<{ id: number }>(
      `insert into appointments_v2.policy_versions (
         policy_set_id, version_no, status, config_hash, created_by_user_id,
         published_at, published_by_user_id
       ) values ($1, 1, 'published', $2, $3, now(), $3)
       returning id`,
      [Number(policySet.rows[0].id), `mig161_hash_${suffix}`, userA]
    );
    const policyVersionId = Number(policyVersion.rows[0].id);

    const legacyRules = await client.query<{ id: number; exam_type_id: number }>(
      `insert into appointments_v2.exam_type_special_quotas (
         policy_version_id, exam_type_id, daily_extra_slots, is_active
       ) values
         ($1, $2, 2, true),
         ($1, $3, 2, false)
       returning id, exam_type_id`,
      [policyVersionId, examA, examB]
    );
    const legacyRuleByExam = new Map(
      legacyRules.rows.map((row) => [Number(row.exam_type_id), Number(row.id)])
    );
    await client.query(
      `insert into appointments_v2.exam_type_special_quota_users (quota_id, user_id)
       values ($1, $3), ($1, $4), ($2, $3)`,
      [legacyRuleByExam.get(examA), legacyRuleByExam.get(examB), userA, userB]
    );

    const bookingRows = await client.query<{ id: number; status: string; exam_type_id: number }>(
      `insert into appointments_v2.bookings (
         patient_id, modality_id, exam_type_id, booking_date, case_category, status,
         policy_version_id, capacity_resolution_mode, uses_special_quota,
         created_by_user_id, updated_by_user_id
       ) values
         ($1, $2, $3, '2045-01-01', 'non_oncology', 'scheduled', $5, 'special_quota_extra', true, $6, $6),
         ($1, $2, $3, '2045-01-02', 'non_oncology', 'cancelled', $5, 'special_quota_extra', true, $6, $6),
         ($1, $2, $3, '2045-01-03', 'non_oncology', 'discontinued', $5, 'special_quota_extra', true, $6, $6),
         ($1, $2, $4, '2045-01-04', 'non_oncology', 'voided', $5, 'special_quota_extra', true, $6, $6)
       returning id, status, exam_type_id`,
      [patientId, modalityId, examA, examB, policyVersionId, userA]
    );

    await client.query(migrationSql);

    const migratedRules = await client.query<{
      id: number;
      policyVersionId: number;
      examTypeId: number;
      dailyExtraSlots: number;
      isActive: boolean;
    }>(
      `select quota.id,
              quota.policy_version_id as "policyVersionId",
              membership.exam_type_id as "examTypeId",
              quota.daily_extra_slots as "dailyExtraSlots",
              quota.is_active as "isActive"
         from appointments_v2.special_quota_rules quota
         join appointments_v2.special_quota_rule_exam_types membership on membership.quota_rule_id = quota.id
        where quota.policy_version_id = $1
        order by membership.exam_type_id`,
      [policyVersionId]
    );
    assert.equal(migratedRules.rowCount, 2, "legacy one-exam quotas must not be merged");
    const migratedRuleByExam = new Map(
      migratedRules.rows.map((row) => [Number(row.examTypeId), {
        policyVersionId: Number(row.policyVersionId),
        dailyExtraSlots: Number(row.dailyExtraSlots),
        isActive: row.isActive,
      }] as const)
    );
    assert.deepEqual(migratedRuleByExam.get(examA), { policyVersionId, dailyExtraSlots: 2, isActive: true });
    assert.deepEqual(migratedRuleByExam.get(examB), { policyVersionId, dailyExtraSlots: 2, isActive: false });

    const migratedMemberships = await client.query<{ examTypeId: number; userId: number }>(
      `select exam_membership.exam_type_id as "examTypeId", quota_user.user_id as "userId"
         from appointments_v2.special_quota_rules quota
         join appointments_v2.special_quota_rule_exam_types exam_membership on exam_membership.quota_rule_id = quota.id
         join appointments_v2.special_quota_rule_users quota_user on quota_user.quota_rule_id = quota.id
        where quota.policy_version_id = $1
        order by exam_membership.exam_type_id, quota_user.user_id`,
      [policyVersionId]
    );
    assert.deepEqual(
      migratedMemberships.rows.map((row) => [Number(row.examTypeId), Number(row.userId)]),
      [[examA, userA], [examA, userB], [examB, userA]].sort((left, right) => left[0] - right[0] || left[1] - right[1])
    );

    const consumptions = await client.query<{
      bookingId: number;
      bookingStatus: string;
      bookingExamTypeId: number;
      consumptionExamTypeId: number;
      quotaExamTypeId: number;
      releasedAt: Date | null;
      releaseReason: string | null;
    }>(
      `select booking.id as "bookingId",
              booking.status as "bookingStatus",
              booking.exam_type_id as "bookingExamTypeId",
              consumption.exam_type_id as "consumptionExamTypeId",
              quota_exam.exam_type_id as "quotaExamTypeId",
              consumption.released_at as "releasedAt",
              consumption.release_reason as "releaseReason"
         from appointments_v2.bookings booking
         join appointments_v2.special_quota_consumptions consumption on consumption.booking_id = booking.id
         join appointments_v2.special_quota_rule_exam_types quota_exam on quota_exam.quota_rule_id = consumption.quota_rule_id
        where booking.id = any($1::bigint[])
        order by booking.id`,
      [bookingRows.rows.map((row) => Number(row.id))]
    );
    assert.equal(consumptions.rowCount, bookingRows.rowCount);
    for (const row of consumptions.rows) {
      assert.equal(Number(row.consumptionExamTypeId), Number(row.bookingExamTypeId));
      assert.equal(Number(row.quotaExamTypeId), Number(row.bookingExamTypeId));
      const terminal = ["cancelled", "discontinued", "voided"].includes(row.bookingStatus);
      assert.equal(row.releasedAt != null, terminal);
      assert.equal(row.releaseReason, terminal ? `legacy_backfill_${row.bookingStatus}` : null);
    }

    await client.query(migrationSql);
    const duplicateCheck = await client.query<{ bookingId: number; total: number; active: number }>(
      `select booking_id as "bookingId",
              count(*)::int as total,
              count(*) filter (where released_at is null)::int as active
         from appointments_v2.special_quota_consumptions
        where booking_id = any($1::bigint[])
        group by booking_id
        order by booking_id`,
      [bookingRows.rows.map((row) => Number(row.id))]
    );
    assert.equal(duplicateCheck.rowCount, bookingRows.rowCount);
    assert.ok(duplicateCheck.rows.every((row) => Number(row.total) === 1));
    assert.ok(duplicateCheck.rows.every((row) => Number(row.active) <= 1));

    const index = await client.query<{ indexdef: string }>(
      `select indexdef
         from pg_indexes
        where schemaname = 'appointments_v2'
          and indexname = 'v2_special_quota_one_active_consumption_per_booking'`
    );
    assert.match(index.rows[0]?.indexdef ?? "", /unique.*booking_id.*where \(released_at is null\)/i);
  } finally {
    await client.query("rollback");
    client.release();
  }
});
