import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import { listAvailability } from "./appointment-service.js";
import type { AvailabilitySlot } from "./appointment-service.js";

interface FixtureContext {
  receptionistUserId: number;
  modalityId: number;
  examTypeId: number;
  targetDate: string;
  blockedDate: string;
  cleanup: () => Promise<void>;
}

function plusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function createFixture(): Promise<FixtureContext> {
  const suffix = uniqueSuffix();
  const targetDate = plusDays(5);
  const blockedDate = plusDays(6);
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_avail_${suffix}`, `Avail Test ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);

  const modality = await pool.query<{ id: number }>(
    `
      insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
      values ($1, $2, $3, 10, true)
      returning id
    `,
    [`AVL${suffix.slice(-6)}`, `تست ${suffix}`, `Avail Modality ${suffix}`]
  );
  const modalityId = Number(modality.rows[0]?.id);

  const examType = await pool.query<{ id: number }>(
    `
      insert into exam_types (modality_id, name_ar, name_en, is_active)
      values ($1, $2, $3, true)
      returning id
    `,
    [modalityId, `فحص ${suffix}`, `Exam ${suffix}`]
  );
  const examTypeId = Number(examType.rows[0]?.id);

  // Fill non-oncology bucket completely for targetDate (capacity 1)
  await pool.query(
    `
      insert into modality_category_daily_limits (modality_id, case_category, daily_limit, is_active, created_by_user_id, updated_by_user_id)
      values
        ($1, 'oncology', 5, true, $2, $2),
        ($1, 'non_oncology', 1, true, $2, $2)
      on conflict (modality_id, case_category)
      do update set daily_limit = excluded.daily_limit, is_active = true, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
    `,
    [modalityId, receptionistUserId]
  );

  const cleanup = async () => {
    await pool.query(`delete from appointment_quota_consumptions where modality_id = $1`, [modalityId]);
    await pool.query(
      `
        delete from appointment_status_history
        where appointment_id in (select id from appointments where modality_id = $1)
      `,
      [modalityId]
    );
    await pool.query(`delete from appointments where modality_id = $1`, [modalityId]);
    await pool.query(`delete from exam_type_schedule_rule_items where rule_id in (select id from exam_type_schedule_rules where modality_id = $1)`, [modalityId]);
    await pool.query(`delete from exam_type_schedule_rules where modality_id = $1`, [modalityId]);
    await pool.query(`delete from modality_blocked_rules where modality_id = $1`, [modalityId]);
    await pool.query(`delete from modality_category_daily_limits where modality_id = $1`, [modalityId]);
    await pool.query(`delete from exam_type_special_quotas where exam_type_id = $1`, [examTypeId]);
    await pool.query(`delete from exam_types where id = $1`, [examTypeId]);
    await pool.query(`delete from modalities where id = $1`, [modalityId]);
    await pool.query(`delete from system_settings where category = 'scheduling_and_capacity' and setting_key like '%engine%'`);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  };

  return { receptionistUserId, modalityId, examTypeId, targetDate, blockedDate, cleanup };
}

async function ensureDbOrSkip(t: { skip: (message?: string) => void }): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return false;
  }
}

test("availability: is_full is capacity-only, is_bookable reflects evaluator outcome", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // Fill non-oncology bucket → targetDate should be full (capacity exhausted)
    await pool.query(
      `
        insert into patients (
          national_id, identifier_type, identifier_value, arabic_full_name, english_full_name, normalized_arabic_name,
          age_years, estimated_date_of_birth, sex, phone_1, address, created_by_user_id, updated_by_user_id
        )
        values ($1, 'national_id', $1, $2, $3, $4, 30, '1996-01-01', 'M', '0911111111', 'city', $5, $5)
      `,
      [`1000000000${fx.receptionistUserId}`, `مريض`, `Patient`, `مريض`, fx.receptionistUserId]
    );
    const patientRow = await pool.query<{ id: number }>(`select id from patients where national_id = $1`, [`1000000000${fx.receptionistUserId}`]);
    const patientId = Number(patientRow.rows[0]?.id);

    // Book the one non-oncology slot for targetDate
    await pool.query(
      `
        insert into appointments (
          patient_id, modality_id, exam_type_id, accession_number, appointment_date,
          daily_sequence, modality_slot_number, status, case_category,
          created_by_user_id, updated_by_user_id
        )
        values ($1, $2, $3, '20990101-001', $4::date, 1, 1, 'scheduled', 'non_oncology', $5, $5)
      `,
      [patientId, fx.modalityId, fx.examTypeId, fx.targetDate, fx.receptionistUserId]
    );

    const slots: AvailabilitySlot[] = await listAvailability(fx.modalityId, 14, 0, {
      examTypeId: fx.examTypeId,
      caseCategory: "non_oncology",
      requestedByUserId: fx.receptionistUserId
    });

    const targetSlot = slots.find((s) => s.appointment_date === fx.targetDate);
    assert.ok(targetSlot, "Target date should be in availability");

    // is_full should reflect capacity exhaustion only
    assert.equal(targetSlot.is_full, true, "is_full should be true when capacity is exhausted");

    // is_bookable should reflect the evaluator decision
    assert.equal(targetSlot.is_bookable, true, "is_bookable should be true (override allowed even when full)");
    assert.equal(targetSlot.requiresSupervisorOverride, true, "Should require supervisor override");
    assert.equal(targetSlot.displayStatus, "restricted", "Should show restricted when override needed");
  } finally {
    await fx.cleanup();
  }
});

test("availability: rule-blocked slot has is_bookable=false but is_full may be false", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    // Add a non-overridable block rule for blockedDate
    await pool.query(
      `
        insert into modality_blocked_rules (
          modality_id, rule_type, specific_date, is_overridable, is_active, title, created_by_user_id, updated_by_user_id
        )
        values ($1, 'specific_date', $2::date, false, true, 'blocked', $3, $3)
      `,
      [fx.modalityId, fx.blockedDate, fx.receptionistUserId]
    );

    const slots: AvailabilitySlot[] = await listAvailability(fx.modalityId, 14, 0, {
      examTypeId: fx.examTypeId,
      caseCategory: "non_oncology",
      requestedByUserId: fx.receptionistUserId
    });

    const blockedSlot = slots.find((s) => s.appointment_date === fx.blockedDate);
    assert.ok(blockedSlot, "Blocked date should be in availability");

    // is_full should be false (capacity not exhausted)
    assert.equal(blockedSlot.is_full, false, "is_full should be false — capacity not exhausted");

    // is_bookable should be false (evaluator says not allowed)
    assert.equal(blockedSlot.is_bookable, false, "is_bookable should be false — rule blocked");
    assert.equal(blockedSlot.requiresSupervisorOverride, false, "Non-overridable block should not allow override");
    assert.equal(blockedSlot.displayStatus, "blocked", "Should show blocked for non-overridable rule");
    assert.ok(blockedSlot.blockReasons?.includes("modality_blocked_rule_match"), "Should have block reason");
  } finally {
    await fx.cleanup();
  }
});
