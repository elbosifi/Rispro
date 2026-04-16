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
       values ($1, $2, $3, $4, 'M', 40, 'national_id', $3)
       returning id`,
      [`${TEST_PREFIX}مريض`, `${TEST_PREFIX} Patient`, nationalId, `${TEST_PREFIX}مريض`]
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
    assert.equal((moved.data as any).booking.examTypeId, secondExamTypeId);

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
});

