import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import {
  isDatabaseAvailable,
  canReachDatabase,
  setupTestDatabase,
  seedTestData,
  createTestApp,
  fetchJson,
  createTestAuthCookie,
  type TestData,
} from "./helpers.js";

const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "MIXRS_";
const WEEKEND_APPOINTMENT_SETTING_KEYS = ["allow_friday_appointments", "allow_saturday_appointments"] as const;

type WeekendAppointmentSettingKey = typeof WEEKEND_APPOINTMENT_SETTING_KEYS[number];

interface WeekendAppointmentSettingRow {
  setting_key: WeekendAppointmentSettingKey;
  setting_value: unknown;
  updated_by_user_id: number | string | null;
}

async function enableWeekendAppointmentsForSuite(userId: number): Promise<() => Promise<void>> {
  const previous = await pool.query<WeekendAppointmentSettingRow>(
    `
      select setting_key, setting_value, updated_by_user_id
      from system_settings
      where category = 'scheduling_and_capacity'
        and setting_key = any($1::text[])
    `,
    [WEEKEND_APPOINTMENT_SETTING_KEYS]
  );
  const previousByKey = new Map(previous.rows.map((row) => [row.setting_key, row]));

  for (const settingKey of WEEKEND_APPOINTMENT_SETTING_KEYS) {
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
        values ('scheduling_and_capacity', $1, '{"value":"enabled"}'::jsonb, $2)
        on conflict (category, setting_key) do update set
          setting_value = excluded.setting_value,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = now()
      `,
      [settingKey, userId]
    );
  }

  return async () => {
    for (const settingKey of WEEKEND_APPOINTMENT_SETTING_KEYS) {
      const prior = previousByKey.get(settingKey);
      if (prior) {
        await pool.query(
          `
            update system_settings
            set setting_value = $2::jsonb,
                updated_by_user_id = $3,
                updated_at = now()
            where category = 'scheduling_and_capacity'
              and setting_key = $1
          `,
          [settingKey, JSON.stringify(prior.setting_value), prior.updated_by_user_id]
        );
      } else {
        await pool.query(
          `
            delete from system_settings
            where category = 'scheduling_and_capacity'
              and setting_key = $1
          `,
          [settingKey]
        );
      }
    }
  };
}

describe("Exam mix reschedule group switch — integration", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;
  let secondExamTypeId = 0;
  let restoreWeekendAppointmentSettings: (() => Promise<void>) | undefined;

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    restoreWeekendAppointmentSettings = await enableWeekendAppointmentsForSuite(testData.userId);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");

    const { pool } = await import("../../../../db/pool.js");
    const exam2 = await pool.query<{ id: number }>(
      `insert into exam_types (modality_id, name_ar, name_en, code, is_active)
       values ($1, $2, $3, $4, true)
       returning id`,
      [testData.modalityId, `${TEST_PREFIX}نوع2`, `${TEST_PREFIX} Exam Type 2`, `${TEST_PREFIX}EXAM2${Date.now()}`]
    );
    secondExamTypeId = Number(exam2.rows[0].id);

    await pool.query(
      `insert into appointments_v2.exam_mix_quota_rules
        (policy_version_id, modality_id, title, rule_type, specific_date, daily_limit, is_active)
       values
        ($1, $2, 'Group A', 'specific_date', '2042-01-10', 1, true),
        ($1, $2, 'Group B', 'specific_date', '2042-01-10', 1, true)`,
      [testData.policyVersionId, testData.modalityId]
    );
    const rules = await pool.query<{ id: number; title: string }>(
      `select id, title from appointments_v2.exam_mix_quota_rules
       where policy_version_id = $1 and modality_id = $2
       order by id asc`,
      [testData.policyVersionId, testData.modalityId]
    );
    const groupA = rules.rows.find((r) => r.title === "Group A")?.id;
    const groupB = rules.rows.find((r) => r.title === "Group B")?.id;
    assert.ok(groupA && groupB);
    await pool.query(
      `insert into appointments_v2.exam_mix_quota_rule_items (rule_id, exam_type_id) values ($1, $2), ($3, $4)`,
      [groupA, testData.examTypeId, groupB, secondExamTypeId]
    );
  });

  after(async () => {
    if (!testData) return;
    await restoreWeekendAppointmentSettings?.();
    await app.close();
    await testDb.cleanup();
  });

  const fetch = (path: string, opts: Record<string, unknown> = {}) =>
    fetchJson(app.baseUrl, path, { cookie: authCookie, ...opts });

  async function createPatient() {
    const { pool } = await import("../../../../db/pool.js");
    const nationalId = `8${Math.random().toString().slice(2, 13).padEnd(11, "0").slice(0, 11)}`;
    const row = await pool.query<{ id: number }>(
      `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
       values ($1, $2, $3, $4, 'M', 40, $5, 'national_id', $6)
       returning id`,
      [`${TEST_PREFIX}مريض`, `${TEST_PREFIX} Patient`, nationalId, `${TEST_PREFIX}مريض`, "0912345678", nationalId]
    );
    return Number(row.rows[0].id);
  }

  async function fillModalityDailyCapacity(bookingDate: string): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
      const patient = await createPatient();
      const standardBooking = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: patient,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate,
          caseCategory: "oncology",
          policySetKey: testData.policySetKey,
        },
      });
      assert.equal(standardBooking.status, 201);
    }
  }

  it("switches same-date exam type between groups and enforces target full failure", async () => {
    if (!testData) return;
    const date = "2042-01-10";
    const patientA = await createPatient();
    const patientB = await createPatient();

    const bookingA = await fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: patientA,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(bookingA.status, 201);
    const bookingIdA = Number((bookingA.data as any).booking.id);

    const moved = await fetch(`/api/v2/appointments/${bookingIdA}`, {
      method: "PUT",
      body: {
        bookingDate: date,
        examTypeId: secondExamTypeId,
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(moved.status, 200);
    assert.equal(Number((moved.data as any).booking.examTypeId), secondExamTypeId);

    const refillA = await fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: patientB,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(refillA.status, 201);

    const patientC = await createPatient();
    const fillB = await fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: patientC,
        modalityId: testData.modalityId,
        examTypeId: secondExamTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(fillB.status, 409);
    assert.ok(String((fillB.data as any).error ?? "").includes("not allowed"));
  });

  it("respects exam type change policy settings for disabled and supervisor-required modes", async () => {
    if (!testData) return;
    const { pool } = await import("../../../../db/pool.js");
    const bookingDate = "2042-01-11";
    const patient = await createPatient();
    const receptionist = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'receptionist', true)
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}receptionist_${patient}`, "test_hash", `${TEST_PREFIX}Receptionist`]
    );
    const receptionistCookie = createTestAuthCookie(Number(receptionist.rows[0].id), "receptionist");
    const receptionistFetch = (path: string, opts: Record<string, unknown> = {}) =>
      fetchJson(app.baseUrl, path, { cookie: receptionistCookie, ...opts });

    const booking = await receptionistFetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: patient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(booking.status, 201);
    const bookingId = Number((booking.data as any).booking.id);

    const usernameRow = await pool.query<{ username: string }>(
      `select username from users where id = $1`,
      [testData.userId]
    );
    const supervisorUsername = String(usernameRow.rows[0]?.username ?? "");

    const originalPolicyRow = await pool.query<{ setting_value: { value?: string } | null }>(
      `
        select setting_value
        from system_settings
        where category = 'scheduling_and_capacity'
          and setting_key = 'exam_type_change_policy'
        limit 1
      `
    );
    const originalPolicyValue = String(originalPolicyRow.rows[0]?.setting_value?.value ?? "");

    async function setPolicy(value: string): Promise<void> {
      await pool.query(
        `
          insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
          values ('scheduling_and_capacity', 'exam_type_change_policy', jsonb_build_object('value', $1::text), $2)
          on conflict (category, setting_key)
          do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
        `,
        [value, testData.userId]
      );
    }

    try {
      await setPolicy("disabled");
      const disabledAttempt = await fetch(`/api/v2/appointments/${bookingId}`, {
        method: "PUT",
        body: {
          bookingDate,
          examTypeId: secondExamTypeId,
          policySetKey: testData.policySetKey,
        },
      });
      assert.equal(disabledAttempt.status, 403);
      assert.ok(String((disabledAttempt.data as any).error ?? "").includes("Changing the exam type is disabled"));

      await setPolicy("supervisor_required");
      const supervisorRequiredAttempt = await fetch(`/api/v2/appointments/${bookingId}`, {
        method: "PUT",
        body: {
          bookingDate,
          examTypeId: secondExamTypeId,
          policySetKey: testData.policySetKey,
        },
      });
      assert.equal(supervisorRequiredAttempt.status, 403);
      assert.ok(String((supervisorRequiredAttempt.data as any).error ?? "").includes("Supervisor override is required"));

      const approvedAttempt = await fetch(`/api/v2/appointments/${bookingId}`, {
        method: "PUT",
        body: {
          bookingDate,
          examTypeId: secondExamTypeId,
          policySetKey: testData.policySetKey,
          override: {
            supervisorUsername,
            supervisorPassword: "test_password",
            reason: "Exam type change approved",
          },
        },
      });
      assert.equal(approvedAttempt.status, 200);
      assert.equal(Number((approvedAttempt.data as any).booking.examTypeId), secondExamTypeId);

      const supervisorBookedPatient = await createPatient();
      const supervisorBooked = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: supervisorBookedPatient,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2042-01-12",
          caseCategory: "non_oncology",
          policySetKey: testData.policySetKey,
        },
      });
      assert.equal(supervisorBooked.status, 201);

      const supervisorBookedChange = await fetch(`/api/v2/appointments/${Number((supervisorBooked.data as any).booking.id)}`, {
        method: "PUT",
        body: {
          bookingDate: "2042-01-12",
          examTypeId: secondExamTypeId,
          policySetKey: testData.policySetKey,
        },
      });
      assert.equal(supervisorBookedChange.status, 200);
      assert.equal(Number((supervisorBookedChange.data as any).booking.examTypeId), secondExamTypeId);

      const overrideBookedPatient = await createPatient();
      const overrideBooked = await receptionistFetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: overrideBookedPatient,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2042-01-13",
          caseCategory: "non_oncology",
          policySetKey: testData.policySetKey,
        },
      });
      assert.equal(overrideBooked.status, 201);
      const overrideBookedId = Number((overrideBooked.data as any).booking.id);
      await pool.query(
        `insert into appointments_v2.override_audit_events
          (booking_id, patient_id, modality_id, exam_type_id, booking_date, requesting_user_id, supervisor_user_id, override_reason, override_type, decision_snapshot, outcome)
         values ($1, $2, $3, $4, '2042-01-13', $5, $6, 'Previously approved', 'category_override', '{}'::jsonb, 'approved_and_booked')`,
        [overrideBookedId, overrideBookedPatient, testData.modalityId, testData.examTypeId, Number(receptionist.rows[0].id), testData.userId]
      );

      const overrideBookedChange = await receptionistFetch(`/api/v2/appointments/${overrideBookedId}`, {
        method: "PUT",
        body: {
          bookingDate: "2042-01-13",
          examTypeId: secondExamTypeId,
          policySetKey: testData.policySetKey,
        },
      });
      assert.equal(overrideBookedChange.status, 200);
      assert.equal(Number((overrideBookedChange.data as any).booking.examTypeId), secondExamTypeId);
    } finally {
      if (originalPolicyValue) {
        await setPolicy(originalPolicyValue);
      } else {
        await pool.query(
          `
            delete from system_settings
            where category = 'scheduling_and_capacity'
              and setting_key = 'exam_type_change_policy'
          `
        );
      }
    }
  });

  it("rejects same-date exam type change to an exam type from another modality", async () => {
    if (!testData) return;
    const { pool } = await import("../../../../db/pool.js");
    const otherModality = await pool.query<{ id: number }>(
      `insert into modalities (name_ar, name_en, code, daily_capacity, is_active)
       values ($1, $2, $3, 10, true)
       returning id`,
      [`${TEST_PREFIX}مودالية اخرى`, `${TEST_PREFIX} Other Modality`, `${TEST_PREFIX}OTHER${Date.now()}`]
    );
    const otherExamType = await pool.query<{ id: number }>(
      `insert into exam_types (modality_id, name_ar, name_en, code, is_active)
       values ($1, $2, $3, $4, true)
       returning id`,
      [Number(otherModality.rows[0].id), `${TEST_PREFIX}فحص اخر`, `${TEST_PREFIX} Other Exam`, `${TEST_PREFIX}OTHEREXAM${Date.now()}`]
    );
    const patient = await createPatient();
    const bookingDate = "2042-01-14";
    const booking = await fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: patient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(booking.status, 201);

    const attempt = await fetch(`/api/v2/appointments/${Number((booking.data as any).booking.id)}`, {
      method: "PUT",
      body: {
        bookingDate,
        examTypeId: Number(otherExamType.rows[0].id),
        policySetKey: testData.policySetKey,
      },
    });

    assert.equal(attempt.status, 400);
    assert.ok(String((attempt.data as any).error ?? "").includes("does not belong to modality"));
  });

  it("allows appointment-editor-style details payload on a full date without override origin", async () => {
    if (!testData) return;
    const { pool } = await import("../../../../db/pool.js");
    const receptionist = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'receptionist', true)
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}details_reception_${Date.now()}`, "test_hash", `${TEST_PREFIX}Details Receptionist`]
    );
    const receptionistId = Number(receptionist.rows[0].id);
    const receptionistFetch = (path: string, opts: Record<string, unknown> = {}) =>
      fetchJson(app.baseUrl, path, { cookie: createTestAuthCookie(receptionistId, "receptionist"), ...opts });

    const bookingDate = "2042-01-19";
    await fillModalityDailyCapacity(bookingDate);

    const patient = await createPatient();
    const inserted = await pool.query<{ id: number }>(
      `insert into appointments_v2.bookings
        (patient_id, modality_id, exam_type_id, booking_date, booking_time, case_category, requires_report,
         status, policy_version_id, capacity_resolution_mode, uses_special_quota, is_walk_in, created_by_user_id)
       values ($1, $2, $3, $4, null, 'non_oncology', true, 'scheduled', $5, 'standard', false, false, $6)
       returning id`,
      [patient, testData.modalityId, testData.examTypeId, bookingDate, testData.policyVersionId, receptionistId]
    );

    const changed = await receptionistFetch(`/api/v2/appointments/${Number(inserted.rows[0].id)}`, {
      method: "PUT",
      body: {
        examTypeId: secondExamTypeId,
        reportingPriorityId: null,
        requiresReport: false,
        notes: "Corrected from registration details",
        policySetKey: testData.policySetKey,
      },
    });

    assert.equal(changed.status, 200);
    assert.equal(Number((changed.data as any).booking.examTypeId), secondExamTypeId);
    assert.equal((changed.data as any).booking.notes, "Corrected from registration details");
    assert.equal((changed.data as any).booking.requiresReport, false);
  });

  it("still rejects same-date exam type change into a hard exam-type restriction", async () => {
    if (!testData) return;
    const { pool } = await import("../../../../db/pool.js");
    const bookingDate = "2042-01-18";
    const patient = await createPatient();
    const booking = await fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: patient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(booking.status, 201);

    const rule = await pool.query<{ id: number }>(
      `insert into appointments_v2.exam_type_rules
        (policy_version_id, modality_id, rule_type, effect_mode, specific_date, title, is_active)
       values ($1, $2, 'specific_date', 'hard_restriction', $3, 'Blocked target exam type', true)
       returning id`,
      [testData.policyVersionId, testData.modalityId, bookingDate]
    );
    await pool.query(
      `insert into appointments_v2.exam_type_rule_items (rule_id, exam_type_id) values ($1, $2)`,
      [Number(rule.rows[0].id), secondExamTypeId]
    );

    const changed = await fetch(`/api/v2/appointments/${Number((booking.data as any).booking.id)}`, {
      method: "PUT",
      body: {
        bookingDate,
        examTypeId: secondExamTypeId,
        policySetKey: testData.policySetKey,
      },
    });

    assert.equal(changed.status, 409);
    assert.ok(String((changed.data as any).error ?? "").includes("not allowed"));
  });

  it("preserves overbooked super-admin booking capacity mode when omitted on exam-type-only edit", async () => {
    if (!testData) return;
    const { pool } = await import("../../../../db/pool.js");
    const superAdminUsername = `${TEST_PREFIX.toLowerCase()}superadmin_${Date.now()}`;
    const superAdmin = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'super_admin', true)
       returning id`,
      [superAdminUsername, "$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS", `${TEST_PREFIX}Super Admin`]
    );
    const superAdminCookie = createTestAuthCookie(Number(superAdmin.rows[0].id), "super_admin");
    const superAdminFetch = (path: string, opts: Record<string, unknown> = {}) =>
      fetchJson(app.baseUrl, path, { cookie: superAdminCookie, ...opts });

    const bookingDate = "2042-01-20";
    await fillModalityDailyCapacity(bookingDate);

    const overbookedPatient = await createPatient();
    const overbooked = await superAdminFetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: overbookedPatient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate,
        caseCategory: "non_oncology",
        capacityResolutionMode: "total_capacity_override",
        override: {
          supervisorUsername: superAdminUsername,
          supervisorPassword: "test_password",
          reason: "Super-admin overbooking",
          overrideType: "total_capacity_override",
        },
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(overbooked.status, 201);
    const bookingId = Number((overbooked.data as any).booking.id);
    assert.equal((overbooked.data as any).booking.capacityResolutionMode, "total_capacity_override");

    const changed = await superAdminFetch(`/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: {
        bookingDate,
        examTypeId: secondExamTypeId,
        policySetKey: testData.policySetKey,
      },
    });

    assert.equal(changed.status, 200);
    assert.equal(Number((changed.data as any).booking.examTypeId), secondExamTypeId);
    assert.equal((changed.data as any).booking.capacityResolutionMode, "total_capacity_override");
  });

  it("allows approved-overbooked standard-mode booking to change exam type without re-failing total capacity", async () => {
    if (!testData) return;
    const { pool } = await import("../../../../db/pool.js");
    const receptionist = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'receptionist', true)
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}capacity_reception_${Date.now()}`, "test_hash", `${TEST_PREFIX}Capacity Receptionist`]
    );
    const receptionistId = Number(receptionist.rows[0].id);
    const receptionistFetch = (path: string, opts: Record<string, unknown> = {}) =>
      fetchJson(app.baseUrl, path, { cookie: createTestAuthCookie(receptionistId, "receptionist"), ...opts });

    const bookingDate = "2042-01-21";
    await fillModalityDailyCapacity(bookingDate);

    const overbookedPatient = await createPatient();
    const inserted = await pool.query<{ id: number }>(
      `insert into appointments_v2.bookings
        (patient_id, modality_id, exam_type_id, booking_date, booking_time, case_category, requires_report,
         status, policy_version_id, capacity_resolution_mode, uses_special_quota, is_walk_in, created_by_user_id)
       values ($1, $2, $3, $4, null, 'non_oncology', true, 'scheduled', $5, 'standard', false, false, $6)
       returning id`,
      [overbookedPatient, testData.modalityId, testData.examTypeId, bookingDate, testData.policyVersionId, receptionistId]
    );
    const bookingId = Number(inserted.rows[0].id);
    await pool.query(
      `insert into appointments_v2.override_audit_events
        (booking_id, patient_id, modality_id, exam_type_id, booking_date, requesting_user_id, supervisor_user_id, override_reason, override_type, decision_snapshot, outcome)
       values ($1, $2, $3, $4, $5, $6, $7, 'Previously approved total capacity override', 'total_capacity_override', '{}'::jsonb, 'approved_and_booked')`,
      [bookingId, overbookedPatient, testData.modalityId, testData.examTypeId, bookingDate, receptionistId, testData.userId]
    );

    const changed = await receptionistFetch(`/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: {
        bookingDate,
        examTypeId: secondExamTypeId,
        policySetKey: testData.policySetKey,
      },
    });

    assert.equal(changed.status, 200);
    assert.equal(Number((changed.data as any).booking.examTypeId), secondExamTypeId);
    assert.equal((changed.data as any).booking.capacityResolutionMode, "standard");
  });

  it("still rejects true reschedule to a different full date", async () => {
    if (!testData) return;
    const sourceDate = "2042-01-23";
    const fullDate = "2042-01-24";
    await fillModalityDailyCapacity(fullDate);
    const patient = await createPatient();
    const booking = await fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: patient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: sourceDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(booking.status, 201);

    const changed = await fetch(`/api/v2/appointments/${Number((booking.data as any).booking.id)}`, {
      method: "PUT",
      body: {
        bookingDate: fullDate,
        examTypeId: testData.examTypeId,
        policySetKey: testData.policySetKey,
      },
    });

    assert.notEqual(changed.status, 200);
    assert.ok(String((changed.data as any).error ?? "").includes("Modality daily capacity is exhausted"));
  });

  it("still rejects new booking on a full date", async () => {
    if (!testData) return;
    const fullDate = "2042-01-25";
    await fillModalityDailyCapacity(fullDate);
    const patient = await createPatient();

    const booking = await fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: patient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: fullDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });

    assert.notEqual(booking.status, 201);
    assert.ok(String((booking.data as any).error ?? "").includes("Modality daily capacity is exhausted"));
  });
});
