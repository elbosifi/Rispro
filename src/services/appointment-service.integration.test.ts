import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import {
  createAppointment,
  listAppointmentLookups,
  listAvailability,
  listSuggestedAppointments,
  updateAppointment
} from "./appointment-service.js";
import { evaluateSchedulingCandidateWithDb } from "../domain/scheduling/service.js";
import type { AuthenticatedUserContext } from "../types/http.js";

interface FixtureContext {
  receptionistUserId: number;
  modalityId: number;
  examTypeId: number;
  patientAId: number;
  patientBId: number;
  patientCId: number;
  targetDate: string;
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
  const targetDate = plusDays(9);
  const receptionistHash = bcrypt.hashSync("test-pass", 10);

  const receptionist = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'receptionist', true)
      returning id
    `,
    [`test_reception_${suffix}`, `Test Reception ${suffix}`, receptionistHash]
  );
  const receptionistUserId = Number(receptionist.rows[0]?.id);

  const modality = await pool.query<{ id: number }>(
    `
      insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
      values ($1, $2, $3, 10, true)
      returning id
    `,
    [`TST${suffix.slice(-6)}`, `تست ${suffix}`, `Test Modality ${suffix}`]
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

  const mkPatient = async (seed: string) => {
    const result = await pool.query<{ id: number }>(
      `
        insert into patients (
          national_id,
          identifier_type,
          identifier_value,
          arabic_full_name,
          english_full_name,
          normalized_arabic_name,
          age_years,
          estimated_date_of_birth,
          sex,
          phone_1,
          address,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, 'national_id', $1, $2, $3, $4, 30, '1996-01-01', 'M', $5, 'benghazi', $6, $6)
        returning id
      `,
      [
        seed,
        `مريض ${seed}`,
        `Patient ${seed}`,
        `مريض${seed}`,
        `09${seed.slice(-8)}`,
        receptionistUserId
      ]
    );
    return Number(result.rows[0]?.id);
  };

  const patientAId = await mkPatient(`1${suffix.padStart(11, "0").slice(-11)}`);
  const patientBId = await mkPatient(`2${suffix.padStart(11, "0").slice(-11)}`);
  const patientCId = await mkPatient(`3${suffix.padStart(11, "0").slice(-11)}`);

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

  await pool.query(
    `
      insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
      values
        ('scheduling_and_capacity', 'scheduling_engine_enabled', '{"value":"enabled"}'::jsonb, $1),
        ('scheduling_and_capacity', 'scheduling_engine_shadow_mode', '{"value":"disabled"}'::jsonb, $1)
      on conflict (category, setting_key)
      do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
    `,
    [receptionistUserId]
  );

  const cleanup = async () => {
    await pool.query(`delete from scheduling_override_audit_events where modality_id = $1`, [modalityId]);
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
    await pool.query(`delete from patient_identifiers where patient_id = any($1::bigint[])`, [[patientAId, patientBId, patientCId]]);
    await pool.query(`delete from patients where id = any($1::bigint[])`, [[patientAId, patientBId, patientCId]]);
    await pool.query(`delete from users where id = $1`, [receptionistUserId]);
  };

  return {
    receptionistUserId,
    modalityId,
    examTypeId,
    patientAId,
    patientBId,
    patientCId,
    targetDate,
    cleanup
  };
}

function asUser(userId: number): AuthenticatedUserContext {
  return { sub: userId, role: "receptionist" };
}

function isoDate(value: unknown): string {
  return String(value || "").slice(0, 10);
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

test("integration: concurrent create does not oversubscribe category bucket", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    const user = asUser(fx.receptionistUserId);
    const p1 = createAppointment(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "non_oncology"
      },
      user
    );
    const p2 = createAppointment(
      {
        patientId: fx.patientBId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "non_oncology"
      },
      user
    );
    const results = await Promise.allSettled([p1, p2]);
    const successes = results.filter((r) => r.status === "fulfilled").length;
    const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    assert.equal(successes, 1);
    assert.equal(failures.length, 1);
    const err = failures[0].reason as { statusCode?: number };
    assert.ok([403, 409].includes(Number(err?.statusCode || 0)));

    const booked = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from appointments
        where modality_id = $1
          and appointment_date = $2::date
          and status <> 'cancelled'
          and case_category = 'non_oncology'
      `,
      [fx.modalityId, fx.targetDate]
    );
    assert.equal(Number(booked.rows[0]?.count || "0"), 1);
  } finally {
    await fx.cleanup();
  }
});

test("integration: concurrent reschedule/update does not oversubscribe target date", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    const user = asUser(fx.receptionistUserId);
    const d1 = plusDays(10);
    const d2 = plusDays(11);

    const a1 = await createAppointment(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: d1,
        caseCategory: "non_oncology"
      },
      user
    );
    const a2 = await createAppointment(
      {
        patientId: fx.patientBId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: d2,
        caseCategory: "non_oncology"
      },
      user
    );

    const u1 = updateAppointment(
      Number(a1.appointment.id),
      { appointmentDate: fx.targetDate, caseCategory: "non_oncology" },
      user
    );
    const u2 = updateAppointment(
      Number(a2.appointment.id),
      { appointmentDate: fx.targetDate, caseCategory: "non_oncology" },
      user
    );
    const results = await Promise.allSettled([u1, u2]);
    const successes = results.filter((r) => r.status === "fulfilled").length;
    const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    assert.equal(successes, 1);
    assert.equal(failures.length, 1);
    const err = failures[0].reason as { statusCode?: number };
    assert.ok([403, 409].includes(Number(err?.statusCode || 0)));

    const booked = await pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from appointments
        where modality_id = $1
          and appointment_date = $2::date
          and status <> 'cancelled'
          and case_category = 'non_oncology'
      `,
      [fx.modalityId, fx.targetDate]
    );
    assert.equal(Number(booked.rows[0]?.count || "0"), 1);
  } finally {
    await fx.cleanup();
  }
});

test("integration: denied override attempt is audited with denied outcome", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    const user = asUser(fx.receptionistUserId);

    await createAppointment(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "non_oncology"
      },
      user
    );

    await assert.rejects(
      createAppointment(
        {
          patientId: fx.patientCId,
          modalityId: fx.modalityId,
          examTypeId: fx.examTypeId,
          appointmentDate: fx.targetDate,
          caseCategory: "non_oncology",
          override: {
            supervisorUsername: "does-not-exist",
            supervisorPassword: "bad-pass",
            reason: "force override"
          }
        },
        user
      )
    );

    const auditRows = await pool.query<{ outcome: string }>(
      `
        select outcome
        from scheduling_override_audit_events
        where modality_id = $1
          and appointment_date = $2::date
        order by id desc
        limit 1
      `,
      [fx.modalityId, fx.targetDate]
    );

    assert.equal(auditRows.rows[0]?.outcome, "denied");
  } finally {
    await fx.cleanup();
  }
});

test("integration: cancelled override attempt is audited for missing reason on create", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  const supervisorPassword = "supervisor-pass";
  const supervisorHash = bcrypt.hashSync(supervisorPassword, 10);
  const supervisorUsername = `test_supervisor_${uniqueSuffix()}`;
  const supervisor = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [supervisorUsername, "Test Supervisor", supervisorHash]
  );
  const supervisorId = Number(supervisor.rows[0]?.id);
  try {
    const user = asUser(fx.receptionistUserId);

    await createAppointment(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "non_oncology"
      },
      user
    );

    await assert.rejects(
      createAppointment(
        {
          patientId: fx.patientBId,
          modalityId: fx.modalityId,
          examTypeId: fx.examTypeId,
          appointmentDate: fx.targetDate,
          caseCategory: "non_oncology",
          override: {
            supervisorUsername,
            supervisorPassword
          }
        },
        user
      )
    );

    const auditRows = await pool.query<{ outcome: string }>(
      `
        select outcome
        from scheduling_override_audit_events
        where modality_id = $1
          and appointment_date = $2::date
        order by id desc
        limit 1
      `,
      [fx.modalityId, fx.targetDate]
    );

    assert.equal(auditRows.rows[0]?.outcome, "cancelled");
  } finally {
    await fx.cleanup();
    await pool.query(`delete from users where id = $1`, [supervisorId]);
  }
});

test("integration: denied override attempt is audited on update path", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    const user = asUser(fx.receptionistUserId);
    const d1 = plusDays(10);
    const d2 = plusDays(11);

    await createAppointment(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "non_oncology"
      },
      user
    );

    const moving = await createAppointment(
      {
        patientId: fx.patientBId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: d1,
        caseCategory: "non_oncology"
      },
      user
    );

    // A third appointment keeps the source day non-empty and avoids accidental same-day no-op behavior.
    await createAppointment(
      {
        patientId: fx.patientCId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: d2,
        caseCategory: "oncology"
      },
      user
    );

    await assert.rejects(
      updateAppointment(
        Number(moving.appointment.id),
        {
          appointmentDate: fx.targetDate,
          caseCategory: "non_oncology",
          override: {
            supervisorUsername: "missing-supervisor-user",
            supervisorPassword: "bad-pass",
            reason: "force"
          }
        },
        user
      )
    );

    const auditRows = await pool.query<{ outcome: string }>(
      `
        select outcome
        from scheduling_override_audit_events
        where appointment_id = $1
        order by id desc
        limit 1
      `,
      [Number(moving.appointment.id)]
    );
    assert.equal(auditRows.rows[0]?.outcome, "denied");
  } finally {
    await fx.cleanup();
  }
});

test("integration: cancelled override attempt is audited on update path when reason is missing", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  const supervisorPassword = "supervisor-pass";
  const supervisorHash = bcrypt.hashSync(supervisorPassword, 10);
  const supervisorUsername = `test_supervisor_${uniqueSuffix()}`;
  const supervisor = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [supervisorUsername, "Test Supervisor", supervisorHash]
  );
  const supervisorId = Number(supervisor.rows[0]?.id);
  try {
    const user = asUser(fx.receptionistUserId);
    const d1 = plusDays(10);

    await createAppointment(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "non_oncology"
      },
      user
    );

    const moving = await createAppointment(
      {
        patientId: fx.patientBId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: d1,
        caseCategory: "non_oncology"
      },
      user
    );

    await assert.rejects(
      updateAppointment(
        Number(moving.appointment.id),
        {
          appointmentDate: fx.targetDate,
          caseCategory: "non_oncology",
          override: {
            supervisorUsername,
            supervisorPassword
          }
        },
        user
      )
    );

    const auditRows = await pool.query<{ outcome: string }>(
      `
        select outcome
        from scheduling_override_audit_events
        where appointment_id = $1
        order by id desc
        limit 1
      `,
      [Number(moving.appointment.id)]
    );
    assert.equal(auditRows.rows[0]?.outcome, "cancelled");
  } finally {
    await fx.cleanup();
    await pool.query(`delete from users where id = $1`, [supervisorId]);
  }
});

test("integration: availability decision matches evaluator decision for blocked date", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    await pool.query(
      `
        insert into modality_blocked_rules (
          modality_id, rule_type, specific_date, is_overridable, is_active, title, created_by_user_id, updated_by_user_id
        )
        values ($1, 'specific_date', $2::date, false, true, 'blocked-for-test', $3, $3)
      `,
      [fx.modalityId, fx.targetDate, fx.receptionistUserId]
    );

    const availability = await listAvailability(fx.modalityId, 14, 0, {
      examTypeId: fx.examTypeId,
      caseCategory: "non_oncology",
      requestedByUserId: fx.receptionistUserId
    });
    const targetSlot = availability.find((slot) => isoDate(slot.appointment_date) === fx.targetDate);
    assert.ok(targetSlot, "Expected target date slot in availability response.");

    const evaluator = await evaluateSchedulingCandidateWithDb(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        scheduledDate: fx.targetDate,
        scheduledTime: null,
        caseCategory: "non_oncology",
        requestedByUserId: fx.receptionistUserId,
        useSpecialQuota: false,
        specialReasonCode: null,
        specialReasonNote: null,
        includeOverrideEvaluation: false,
        appointmentId: null
      },
      pool
    );

    assert.equal(targetSlot?.isAllowed, evaluator.isAllowed);
    assert.equal(targetSlot?.requiresSupervisorOverride, evaluator.requiresSupervisorOverride);
    assert.deepEqual(targetSlot?.matchedRuleIds || [], evaluator.matchedRuleIds);
    assert.equal(targetSlot?.displayStatus, evaluator.displayStatus);
  } finally {
    await fx.cleanup();
  }
});

test("integration: suggestions include override candidates only when requested", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  try {
    await createAppointment(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "non_oncology"
      },
      asUser(fx.receptionistUserId)
    );

    const withoutOverrides = await listSuggestedAppointments(fx.modalityId, 14, {
      examTypeId: fx.examTypeId,
      caseCategory: "non_oncology",
      includeOverrideCandidates: false,
      requestedByUserId: fx.receptionistUserId
    });
    const withOverrides = await listSuggestedAppointments(fx.modalityId, 14, {
      examTypeId: fx.examTypeId,
      caseCategory: "non_oncology",
      includeOverrideCandidates: true,
      requestedByUserId: fx.receptionistUserId
    });

    const dateWithout = withoutOverrides.find((slot) => isoDate(slot.appointment_date) === fx.targetDate);
    const dateWith = withOverrides.find((slot) => isoDate(slot.appointment_date) === fx.targetDate);

    assert.equal(Boolean(dateWithout), false);
    assert.equal(Boolean(dateWith), true);
    assert.equal(Boolean(dateWith?.requiresSupervisorOverride), true);
  } finally {
    await fx.cleanup();
  }
});

test("integration: approved_but_failed is audited when post-approval create fails", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  const supervisorPassword = "supervisor-pass";
  const supervisorHash = bcrypt.hashSync(supervisorPassword, 10);
  const supervisorUsername = `test_supervisor_${uniqueSuffix()}`;
  const supervisor = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [supervisorUsername, "Test Supervisor", supervisorHash]
  );
  const supervisorId = Number(supervisor.rows[0]?.id);

  try {
    const user = asUser(fx.receptionistUserId);
    const compactDate = fx.targetDate.replaceAll("-", "");
    const conflictingAccession = `${compactDate}-002`;

    // Occupy the non-oncology category for this date so the next booking requires override.
    await createAppointment(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "non_oncology"
      },
      user
    );

    // Create a deterministic accession-number conflict for the next create attempt.
    await pool.query(
      `
        insert into appointments (
          patient_id,
          modality_id,
          exam_type_id,
          accession_number,
          appointment_date,
          daily_sequence,
          modality_slot_number,
          status,
          case_category,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, $2, $3, $4, $5::date, 0, 0, 'scheduled', 'oncology', $6, $6)
      `,
      [fx.patientCId, fx.modalityId, fx.examTypeId, conflictingAccession, fx.targetDate, fx.receptionistUserId]
    );

    await assert.rejects(
      createAppointment(
        {
          patientId: fx.patientBId,
          modalityId: fx.modalityId,
          examTypeId: fx.examTypeId,
          appointmentDate: fx.targetDate,
          caseCategory: "non_oncology",
          override: {
            supervisorUsername,
            supervisorPassword,
            reason: "approved override for test"
          }
        },
        user
      )
    );

    const auditRows = await pool.query<{ outcome: string }>(
      `
        select outcome
        from scheduling_override_audit_events
        where modality_id = $1
          and appointment_date = $2::date
        order by id desc
        limit 1
      `,
      [fx.modalityId, fx.targetDate]
    );
    assert.equal(auditRows.rows[0]?.outcome, "approved_but_failed");
  } finally {
    await fx.cleanup();
    await pool.query(`delete from users where id = $1`, [supervisorId]);
  }
});

test("integration: approved_but_failed is audited when post-approval update fails", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const fx = await createFixture();
  const supervisorPassword = "supervisor-pass";
  const supervisorHash = bcrypt.hashSync(supervisorPassword, 10);
  const supervisorUsername = `test_supervisor_${uniqueSuffix()}`;
  const supervisor = await pool.query<{ id: number }>(
    `
      insert into users (username, full_name, password_hash, role, is_active)
      values ($1, $2, $3, 'supervisor', true)
      returning id
    `,
    [supervisorUsername, "Test Supervisor", supervisorHash]
  );
  const supervisorId = Number(supervisor.rows[0]?.id);

  try {
    const user = asUser(fx.receptionistUserId);

    // Fill non-oncology bucket for target date.
    const anchor = await createAppointment(
      {
        patientId: fx.patientAId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "non_oncology"
      },
      user
    );

    // Create appointment that will be updated into non-oncology (override-required).
    const moving = await createAppointment(
      {
        patientId: fx.patientBId,
        modalityId: fx.modalityId,
        examTypeId: fx.examTypeId,
        appointmentDate: fx.targetDate,
        caseCategory: "oncology"
      },
      user
    );

    const movingId = Number(moving.appointment.id);
    const expectedAccession = String(moving.appointment.accession_number || "");

    // Free expected accession from moving row, then reserve it with another row
    // so update fails after approval on unique accession_number conflict.
    await pool.query(
      `
        update appointments
        set accession_number = $2
        where id = $1
      `,
      [movingId, `TMP-${movingId}-${Date.now()}`]
    );
    await pool.query(
      `
        insert into appointments (
          patient_id,
          modality_id,
          exam_type_id,
          accession_number,
          appointment_date,
          daily_sequence,
          modality_slot_number,
          status,
          case_category,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, $2, $3, $4, $5::date, 0, 0, 'scheduled', 'oncology', $6, $6)
      `,
      [fx.patientCId, fx.modalityId, fx.examTypeId, expectedAccession, fx.targetDate, fx.receptionistUserId]
    );

    await assert.rejects(
      updateAppointment(
        movingId,
        {
          appointmentDate: fx.targetDate,
          caseCategory: "non_oncology",
          override: {
            supervisorUsername,
            supervisorPassword,
            reason: "approved override for update failure test"
          }
        },
        user
      )
    );

    const auditRows = await pool.query<{ outcome: string }>(
      `
        select outcome
        from scheduling_override_audit_events
        where appointment_id = $1
        order by id desc
        limit 1
      `,
      [movingId]
    );
    assert.equal(auditRows.rows[0]?.outcome, "approved_but_failed");

    // Ensure anchor booking still exists to keep test assumptions explicit.
    assert.ok(anchor.appointment.id);
  } finally {
    await fx.cleanup();
    await pool.query(`delete from users where id = $1`, [supervisorId]);
  }
});

test("integration: appointment lookups include active special reasons only (sorted by code)", async (t) => {
  if (!(await ensureDbOrSkip(t))) return;
  const suffix = uniqueSuffix();
  const activeCodeA = `A_${suffix}`;
  const activeCodeB = `B_${suffix}`;
  const inactiveCode = `Z_${suffix}`;

  try {
    await pool.query(
      `
        insert into special_reason_codes (code, label_ar, label_en, is_active)
        values
          ($1, 'سبب أ', 'Reason A', true),
          ($2, 'سبب ب', 'Reason B', true),
          ($3, 'سبب غير نشط', 'Inactive Reason', false)
        on conflict (code) do update
        set label_ar = excluded.label_ar, label_en = excluded.label_en, is_active = excluded.is_active, updated_at = now()
      `,
      [activeCodeA, activeCodeB, inactiveCode]
    );

    const lookups = await listAppointmentLookups();
    const codes = (lookups.specialReasons ?? []).map((reason) => reason.code);
    assert.ok(codes.includes(activeCodeA), "Active special reason A should be included");
    assert.ok(codes.includes(activeCodeB), "Active special reason B should be included");
    assert.ok(!codes.includes(inactiveCode), "Inactive special reason should be excluded");

    const filteredCodes = codes.filter((code) => code === activeCodeA || code === activeCodeB);
    assert.deepEqual(filteredCodes, [activeCodeA, activeCodeB], "Special reasons should be sorted by code asc");
  } finally {
    await pool.query(`delete from special_reason_codes where code = any($1::text[])`, [[activeCodeA, activeCodeB, inactiveCode]]);
  }
});
