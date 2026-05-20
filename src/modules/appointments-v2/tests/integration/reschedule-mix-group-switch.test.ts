import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
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

describe("Exam mix reschedule group switch — integration", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;
  let secondExamTypeId = 0;

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");

    const { pool } = await import("../../../../db/pool.js");
    const exam2 = await pool.query<{ id: number }>(
      `insert into exam_types (modality_id, name_ar, name_en, is_active)
       values ($1, $2, $3, true)
       returning id`,
      [testData.modalityId, `${TEST_PREFIX}نوع2`, `${TEST_PREFIX} Exam Type 2`]
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
    await app.close();
    await testDb.cleanup();
  });

  const fetch = (path: string, opts: Record<string, unknown> = {}) =>
    fetchJson(app.baseUrl, path, { cookie: authCookie, ...opts });

  async function createPatient() {
    const { pool } = await import("../../../../db/pool.js");
    const nationalId = `8${Math.random().toString().slice(2, 13).padEnd(11, "0").slice(0, 11)}`;
    const row = await pool.query<{ id: number }>(
      `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, identifier_type, identifier_value)
       values ($1, $2, $3, $4, 'M', 40, 'national_id', $5)
       returning id`,
      [`${TEST_PREFIX}مريض`, `${TEST_PREFIX} Patient`, nationalId, `${TEST_PREFIX}مريض`, nationalId]
    );
    return Number(row.rows[0].id);
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
          values ('scheduling_and_capacity', 'exam_type_change_policy', jsonb_build_object('value', $1), $2)
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
});
