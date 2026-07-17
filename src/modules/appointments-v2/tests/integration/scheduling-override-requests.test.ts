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
  createTestSupervisorReauthCookie,
  type TestData,
} from "./helpers.js";

const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "OVREQ_";
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

describe("Scheduling override requests — integration", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let receptionistId = 0;
  let secondReceptionistId = 0;
  let supervisorUsername = "";
  let supervisorCookie = "";
  let superAdminCookie = "";
  let receptionistCookie = "";
  let secondReceptionistCookie = "";
  let restoreWeekendAppointmentSettings: (() => Promise<void>) | undefined;

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    restoreWeekendAppointmentSettings = await enableWeekendAppointmentsForSuite(testData.userId);
    app = await createTestApp();
    supervisorCookie = `${createTestAuthCookie(testData.userId, "supervisor")}; ${createTestSupervisorReauthCookie(testData.userId, "supervisor")}`;

    const { pool } = await import("../../../../db/pool.js");
    const supervisor = await pool.query<{ username: string }>(`select username from users where id = $1`, [testData.userId]);
    supervisorUsername = supervisor.rows[0]?.username ?? "";
    const bcryptHash = "$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS";
    const receptionist = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'receptionist', true)
       on conflict (username) do update set password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}receptionist`, bcryptHash, `${TEST_PREFIX}Receptionist`]
    );
    receptionistId = Number(receptionist.rows[0].id);
    await pool.query(`update users set can_request_scheduling_override = true where id = $1`, [receptionistId]);
    receptionistCookie = createTestAuthCookie(receptionistId, "receptionist");

    const secondReceptionist = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'receptionist', true)
       on conflict (username) do update set password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}receptionist2`, bcryptHash, `${TEST_PREFIX}Receptionist 2`]
    );
    secondReceptionistId = Number(secondReceptionist.rows[0].id);
    await pool.query(`update users set can_request_scheduling_override = true where id = $1`, [secondReceptionistId]);
    secondReceptionistCookie = createTestAuthCookie(secondReceptionistId, "receptionist");

    const superAdmin = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'super_admin', true)
       on conflict (username) do update set password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}superadmin`, bcryptHash, `${TEST_PREFIX}SuperAdmin`]
    );
    const superAdminId = Number(superAdmin.rows[0].id);
    superAdminCookie = `${createTestAuthCookie(superAdminId, "super_admin")}; ${createTestSupervisorReauthCookie(superAdminId, "super_admin")}`;
  });

  after(async () => {
    if (!testData) return;
    await restoreWeekendAppointmentSettings?.();
    await app.close();
    await testDb.cleanup();
  });

  const fetchAs = (cookie: string, path: string, opts: Record<string, unknown> = {}) =>
    fetchJson(app.baseUrl, path, { cookie, ...opts });

  async function setCapacityLimits(total = 10, category = 5) {
    const { pool } = await import("../../../../db/pool.js");
    await pool.query(`update modalities set daily_capacity = $1 where id = $2`, [total, testData.modalityId]);
    await pool.query(
      `update appointments_v2.category_daily_limits set daily_limit = $1 where policy_version_id = $2 and modality_id = $3`,
      [category, testData.policyVersionId, testData.modalityId]
    );
  }

  async function withSystemSetting<T>(
    category: string,
    settingKey: string,
    settingValue: unknown,
    run: () => Promise<T>
  ): Promise<T> {
    const { pool } = await import("../../../../db/pool.js");
    const existing = await pool.query<{ setting_value: unknown; updated_by_user_id: number | null }>(
      `
        select setting_value, updated_by_user_id
        from system_settings
        where category = $1 and setting_key = $2
        limit 1
      `,
      [category, settingKey]
    );

    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
        values ($1, $2, $3::jsonb, $4)
        on conflict (category, setting_key) do update set
          setting_value = excluded.setting_value,
          updated_by_user_id = excluded.updated_by_user_id,
          updated_at = now()
      `,
      [category, settingKey, JSON.stringify(settingValue), testData.userId]
    );

    try {
      return await run();
    } finally {
      if (existing.rows.length > 0) {
        await pool.query(
          `
            update system_settings
            set setting_value = $3::jsonb,
                updated_by_user_id = $4,
                updated_at = now()
            where category = $1 and setting_key = $2
          `,
          [
            category,
            settingKey,
            JSON.stringify(existing.rows[0].setting_value),
            existing.rows[0].updated_by_user_id,
          ]
        );
      } else {
        await pool.query(
          `delete from system_settings where category = $1 and setting_key = $2`,
          [category, settingKey]
        );
      }
    }
  }

  async function withUserOverridePermission<T>(userId: number, allowed: boolean, run: () => Promise<T>): Promise<T> {
    const { pool } = await import("../../../../db/pool.js");
    const existing = await pool.query<{ can_request_scheduling_override: boolean | null }>(
      `select can_request_scheduling_override from users where id = $1`,
      [userId]
    );
    await pool.query(`update users set can_request_scheduling_override = $2 where id = $1`, [userId, allowed]);

    try {
      return await run();
    } finally {
      await pool.query(
        `update users set can_request_scheduling_override = $2 where id = $1`,
        [userId, existing.rows[0]?.can_request_scheduling_override ?? null]
      );
    }
  }

  function assertForbiddenResponse(response: { status: number; data: unknown }) {
    assert.equal(response.status, 403, JSON.stringify(response.data));
    assert.equal(typeof (response.data as any).error, "string");
    assert.equal((response.data as any).details, null);
  }

  async function createPatient() {
    const { pool } = await import("../../../../db/pool.js");
    const nationalId = `7${Math.random().toString().slice(2, 13).padEnd(11, "0").slice(0, 11)}`;
    const phone = `09${Math.random().toString().slice(2, 10).padEnd(8, "0").slice(0, 8)}`;
    const nameSuffix = Math.random().toString().slice(2, 10);
    const arabicName = `${TEST_PREFIX}مريض ${nameSuffix}`;
    const englishName = `${TEST_PREFIX} Patient ${nameSuffix}`;
    const row = await pool.query<{ id: number }>(
      `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
       values ($1, $2, $3, $4, 'M', 40, $5, 'national_id', $6)
       returning id`,
      [arabicName, englishName, nationalId, arabicName, phone, nationalId]
    );
    return Number(row.rows[0].id);
  }

  async function createAmbiguousPatients() {
    const { pool } = await import("../../../../db/pool.js");
    const suffix = Math.random().toString().slice(2, 10);
    const firstIdentifier = `8${suffix.padEnd(11, "0").slice(0, 11)}`;
    const secondIdentifier = `9${suffix.padEnd(11, "1").slice(0, 11)}`;
    const result = await pool.query<{ id: number }>(
      `insert into patients (
        arabic_full_name, english_full_name, national_id, normalized_arabic_name,
        sex, age_years, estimated_date_of_birth, demographics_estimated, phone_1,
        identifier_type, identifier_value
      ) values
        ($1, $2, $3::varchar, $4, 'M', 40, '1986-01-02', false, '0910001234', 'national_id', $3::text),
        ($5, $6, $7::varchar, $8, 'F', 39, '1987-02-03', false, '0910005678', 'national_id', $7::text)
      returning id`,
      [
        `OVREQ تشابه مريض ${suffix} واحد`, `OVREQ Similar Patient ${suffix} One`, firstIdentifier, `OVREQ تشابه مريض ${suffix} واحد`,
        `OVREQ تشابه مريض ${suffix} اثنان`, `OVREQ Similar Patient ${suffix} Two`, secondIdentifier, `OVREQ تشابه مريض ${suffix} اثنان`,
      ]
    );
    return { patientId: Number(result.rows[0].id), firstIdentifier, dateOfBirth: "1986-01-02", phoneSuffix: "1234" };
  }

  async function fillNonOncologyCategory(date: string, count = 5) {
    for (let i = 0; i < count; i += 1) {
      const patientId = await createPatient();
      const created = await fetchAs(supervisorCookie, "/api/v2/appointments", {
        method: "POST",
        body: {
          patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: date,
          caseCategory: "non_oncology",
          policySetKey: testData.policySetKey,
        },
      });
      assert.equal(created.status, 201, JSON.stringify(created.data));
    }
  }

  async function requestCategoryOverride(date: string, patientId = 0, cookie = receptionistCookie, patientIdentityVerificationProof: string | null = null) {
    const targetPatientId = patientId || await createPatient();
    return fetchAs(cookie, "/api/v2/scheduling-override-requests", {
      method: "POST",
      body: {
        requestType: "create_booking",
        requesterReason: "Clinical urgency needs approval",
        requestPayload: {
          patientId: targetPatientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: date,
          bookingTime: null,
          caseCategory: "non_oncology",
          policySetKey: testData.policySetKey,
          patientIdentityVerificationProof,
        },
        createdFromContext: "integration_test",
      },
    });
  }

  async function createCategoryRequestWithTotalFullChangedDate(requestedDate: string, changedDate: string) {
    await setCapacityLimits(10, 5);
    await fillNonOncologyCategory(requestedDate);
    const requested = await requestCategoryOverride(requestedDate);
    assert.equal(requested.status, 201);
    assert.equal((requested.data as any).request.overrideType, "category_override");

    await setCapacityLimits(1, 1);
    await fillNonOncologyCategory(changedDate, 1);

    return {
      requestId: Number((requested.data as any).request.id),
      patientId: Number((requested.data as any).request.patientId),
    };
  }

  async function countBookings(date: string, patientId?: number) {
    const { pool } = await import("../../../../db/pool.js");
    const result = await pool.query<{ count: number }>(
      `
        select count(*)::int as count
        from appointments_v2.bookings
        where booking_date = $1::date
          and modality_id = $2
          and status <> 'voided'
          and ($3::bigint is null or patient_id = $3)
      `,
      [date, testData.modalityId, patientId ?? null]
    );
    return result.rows[0]?.count ?? 0;
  }

  async function getRequestFromDb(id: number) {
    const { pool } = await import("../../../../db/pool.js");
    const result = await pool.query(
      `select status,
              failure_code,
              failure_message,
              requested_booking_date::text,
              requested_booking_time::text,
              request_payload_json,
              patient_identity_verification_fingerprint,
              approval_decision_snapshot_json
       from appointments_v2.scheduling_override_requests
       where id = $1`,
      [id]
    );
    return result.rows[0] as {
      status: string;
      failure_code: string | null;
      failure_message: string | null;
      requested_booking_date: string;
      requested_booking_time: string | null;
      request_payload_json: any;
      patient_identity_verification_fingerprint: string | null;
      approval_decision_snapshot_json: unknown | null;
    };
  }

  it("rejects receptionist override requests when disabled in settings", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-01-31";
    await fillNonOncologyCategory(date);

    await withSystemSetting(
      "scheduling_and_capacity",
      "allow_reception_override_requests_from_availability",
      { value: "disabled" },
      async () => {
        const requested = await requestCategoryOverride(date);
        assertForbiddenResponse(requested);
      }
    );
  });

  it("rejects receptionist override requests when the user is not individually allowed", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-01-30";
    await fillNonOncologyCategory(date);

    await withUserOverridePermission(receptionistId, false, async () => {
      const requested = await requestCategoryOverride(date);
      assertForbiddenResponse(requested);
    });
  });

  it("receptionist creates a pending create-booking request and supervisor approves it", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-02-01";
    await fillNonOncologyCategory(date);

    const requested = await requestCategoryOverride(date);
    assert.equal(requested.status, 201);
    assert.equal((requested.data as any).request.status, "pending");
    assert.equal((requested.data as any).request.overrideType, "category_override");
    assert.ok((requested.data as any).request.patientDisplayName);
    assert.ok((requested.data as any).request.modalityName);
    assert.ok((requested.data as any).request.examTypeName);
    assert.equal((requested.data as any).request.requesterDisplayName, `${TEST_PREFIX}Receptionist`);

    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((requested.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "Approved for urgent clinical need" },
    });
    assert.equal(approved.status, 200);
    assert.equal((approved.data as any).request.status, "approved");
    const bookingId = Number((approved.data as any).booking.id);
    assert.ok(bookingId > 0);

    const { pool } = await import("../../../../db/pool.js");
    const audit = await pool.query<{
      requesting_user_id: string;
      supervisor_user_id: string;
      override_type: string;
      override_reason: string | null;
      outcome: string;
      decision_snapshot: any;
    }>(
      `select requesting_user_id::text, supervisor_user_id::text, override_type, override_reason, outcome, decision_snapshot
       from appointments_v2.override_audit_events
       where booking_id = $1`,
      [bookingId]
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(Number(audit.rows[0].requesting_user_id), receptionistId);
    assert.equal(Number(audit.rows[0].supervisor_user_id), testData.userId);
    assert.equal(audit.rows[0].override_type, "category_override");
    assert.equal(audit.rows[0].override_reason, "Approved for urgent clinical need");
    assert.equal(audit.rows[0].outcome, "approved_and_booked");
    assert.equal(Number(audit.rows[0].decision_snapshot.deferredApprovalRequestId), Number((requested.data as any).request.id));
  });

  it("stores only safe deferred identity metadata and rejects approval after the verified identity changes", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-05-09";
    await fillNonOncologyCategory(date);
    const patient = await createAmbiguousPatients();
    const verification = await fetchAs(receptionistCookie, `/api/v2/appointments/patient-selection/${patient.patientId}/verify`, {
      method: "POST",
      body: { method: "primary_identifier", evidence: patient.firstIdentifier },
    });
    assert.equal(verification.status, 200);
    const proof = String((verification.data as { proof?: unknown }).proof || "");
    assert.ok(proof);

    const requested = await requestCategoryOverride(date, patient.patientId, receptionistCookie, proof);
    assert.equal(requested.status, 201, JSON.stringify(requested.data));
    assert.equal(JSON.stringify(requested.data).includes("patientIdentityVerificationFingerprint"), false);
    const requestId = Number((requested.data as any).request.id);
    const stored = await getRequestFromDb(requestId);
    const deferredJson = JSON.stringify(stored.request_payload_json);
    assert.ok(stored.patient_identity_verification_fingerprint);
    for (const secret of [patient.firstIdentifier, patient.dateOfBirth, patient.phoneSuffix, proof, "identityFingerprint"]) {
      assert.equal(deferredJson.includes(secret), false);
    }

    const { pool } = await import("../../../../db/pool.js");
    await pool.query(`update patients set phone_1 = '0910009999' where id = $1`, [patient.patientId]);
    const approval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "Verified identity changed after request." },
    });
    assert.equal(approval.status, 422);
    assert.match(JSON.stringify(approval.data), /patient_identity_reverification_required/);
    assert.equal(await countBookings(date, patient.patientId), 0);

    const audit = await pool.query<{ new_values: unknown }>(
      `select new_values from audit_log where entity_type = 'appointment_patient_identity' and entity_id = $1`,
      [patient.patientId]
    );
    assert.equal(JSON.stringify(audit.rows).includes(patient.firstIdentifier), false);
    assert.equal(JSON.stringify(audit.rows).includes(patient.dateOfBirth), false);
    assert.equal(JSON.stringify(audit.rows).includes(patient.phoneSuffix), false);
    assert.equal(JSON.stringify(audit.rows).includes(proof), false);
    assert.equal(JSON.stringify(audit.rows).includes(stored.patient_identity_verification_fingerprint!), false);
  });

  it("approves a deferred request after valid ambiguous-patient verification without retaining verification secrets", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-05-10";
    await fillNonOncologyCategory(date);
    const patient = await createAmbiguousPatients();
    const verification = await fetchAs(receptionistCookie, `/api/v2/appointments/patient-selection/${patient.patientId}/verify`, {
      method: "POST",
      body: { method: "primary_identifier", evidence: patient.firstIdentifier },
    });
    assert.equal(verification.status, 200);
    const proof = String((verification.data as { proof?: unknown }).proof || "");
    assert.ok(proof);

    const requested = await requestCategoryOverride(date, patient.patientId, receptionistCookie, proof);
    assert.equal(requested.status, 201, JSON.stringify(requested.data));
    const requestId = Number((requested.data as any).request.id);

    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "Identity verified before deferred approval." },
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal((approved.data as any).request.status, "approved");
    assert.equal(Number((approved.data as any).booking.patientId), patient.patientId);
    assert.equal(JSON.stringify(approved.data).includes(proof), false);

    const stored = await getRequestFromDb(requestId);
    assert.ok(stored.patient_identity_verification_fingerprint);
    const deferredJson = JSON.stringify(stored.request_payload_json);
    for (const secret of [patient.firstIdentifier, patient.dateOfBirth, patient.phoneSuffix, proof, "identityFingerprint"]) {
      assert.equal(deferredJson.includes(secret), false);
    }

    const { pool } = await import("../../../../db/pool.js");
    const audit = await pool.query<{ new_values: unknown }>(
      `select new_values from audit_log where entity_type = 'appointment_patient_identity' and entity_id = $1`,
      [patient.patientId]
    );
    const auditJson = JSON.stringify(audit.rows);
    for (const secret of [patient.firstIdentifier, patient.dateOfBirth, patient.phoneSuffix, proof, stored.patient_identity_verification_fingerprint!]) {
      assert.equal(auditJson.includes(secret), false);
    }
  });

  it("rejects a tampered ambiguous-patient proof without persisting secrets", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-05-11";
    await fillNonOncologyCategory(date);
    const patient = await createAmbiguousPatients();
    const verification = await fetchAs(receptionistCookie, `/api/v2/appointments/patient-selection/${patient.patientId}/verify`, {
      method: "POST",
      body: { method: "primary_identifier", evidence: patient.firstIdentifier },
    });
    assert.equal(verification.status, 200);
    const proof = String((verification.data as { proof?: unknown }).proof || "");
    assert.ok(proof);
    const tamperedProof = `${proof.slice(0, -1)}${proof.endsWith("a") ? "b" : "a"}`;

    const requested = await requestCategoryOverride(date, patient.patientId, receptionistCookie, tamperedProof);
    assert.equal(requested.status, 422, JSON.stringify(requested.data));
    assert.match(JSON.stringify(requested.data), /patient_identity_reverification_required/);

    const { pool } = await import("../../../../db/pool.js");
    const requests = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from appointments_v2.scheduling_override_requests
       where patient_id = $1 and requested_booking_date = $2::date`,
      [patient.patientId, date]
    );
    assert.equal(requests.rows[0]?.count ?? 0, 0);
    assert.equal(await countBookings(date, patient.patientId), 0);

    const audit = await pool.query<{ action_type: string; new_values: unknown }>(
      `select action_type, new_values
       from audit_log
       where entity_type = 'appointment_patient_identity' and entity_id = $1
       order by id asc`,
      [patient.patientId]
    );
    const rejection = audit.rows.find((row) => row.action_type === "appointment_patient_identity_verification_rejected");
    assert.ok(rejection);
    const rejectionValues = rejection?.new_values as Record<string, unknown>;
    assert.equal(rejectionValues.outcome, "rejected");
    assert.equal(rejectionValues.code, "patient_identity_reverification_required");
    assert.equal(rejectionValues.source, "deferred_override");
    assert.equal(rejectionValues.ambiguityRuleVersion, "name_first_three_v1");

    const auditJson = JSON.stringify(audit.rows);
    for (const secret of [patient.firstIdentifier, patient.dateOfBirth, patient.phoneSuffix, proof, tamperedProof, "identityFingerprint"]) {
      assert.equal(auditJson.includes(secret), false);
    }
  });

  it("approves a closed weekday deferred request without bypassing capacity rules", async () => {
    if (!testData) return;
    await setCapacityLimits(10, 5);
    const { pool } = await import("../../../../db/pool.js");
    const friday = "2042-02-07";
    const patientId = await createPatient();

    await withSystemSetting("scheduling_and_capacity", "allow_friday_appointments", { value: "false" }, async () => {
      const requested = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests", {
        method: "POST",
        body: {
          requestType: "create_booking",
          requesterReason: "Friday booking needs approval",
          requestPayload: {
            patientId,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: friday,
            bookingTime: null,
            caseCategory: "non_oncology",
            policySetKey: testData.policySetKey,
          },
          createdFromContext: "integration_test_closed_weekday",
        },
      });
      assert.equal(requested.status, 201);
      assert.equal((requested.data as any).request.overrideType, "closed_weekday_override");
      assert.equal((requested.data as any).request.decisionContext.approvalNoteRequired, true);

      const missingNoteApproval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((requested.data as any).request.id)}/approve`, {
        method: "POST",
        body: { approverReason: "" },
      });
      assert.equal(missingNoteApproval.status, 400);

      const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((requested.data as any).request.id)}/approve`, {
        method: "POST",
        body: { approverReason: "Approved closed weekday exception" },
      });
      assert.equal(approved.status, 200);
      assert.equal((approved.data as any).request.status, "approved");
      const bookingId = Number((approved.data as any).booking.id);
      assert.ok(bookingId > 0);
      assert.equal(await countBookings(friday, patientId), 1);

      const audit = await pool.query<{ override_type: string; outcome: string; decision_snapshot: any }>(
        `
          select override_type, outcome, decision_snapshot
          from appointments_v2.override_audit_events
          where booking_id = $1
        `,
        [bookingId]
      );
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.rows[0].override_type, "closed_weekday_override");
      assert.equal(audit.rows[0].outcome, "approved_and_booked");
      assert.equal(Number(audit.rows[0].decision_snapshot.deferredApprovalRequestId), Number((requested.data as any).request.id));
    });
  });

  it("rejects without approver reason and lets a receptionist see only their own requests", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-02-02";
    await fillNonOncologyCategory(date);
    const requested = await requestCategoryOverride(date);
    assert.equal(requested.status, 201);

    const rejectedWithoutReason = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((requested.data as any).request.id)}/reject`, {
      method: "POST",
      body: { approverReason: "" },
    });
    assert.equal(rejectedWithoutReason.status, 400);

    const ownList = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests");
    assert.equal(ownList.status, 200);
    assert.ok((ownList.data as any).requests.every((row: any) => Number(row.requesterUserId) === receptionistId));
  });

  it("prevents receptionist approval and prevents duplicate approval from creating another booking", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-02-03";
    await fillNonOncologyCategory(date);
    const requested = await requestCategoryOverride(date);
    const requestId = Number((requested.data as any).request.id);

    const receptionistApproval = await fetchAs(receptionistCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "not allowed" },
    });
    assert.equal(receptionistApproval.status, 403);

    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "Approved once" },
    });
    assert.equal(approved.status, 200);
    const createdBookingId = Number((approved.data as any).booking.id);

    const duplicate = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "Approved twice" },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(await countBookings(date, Number((requested.data as any).request.patientId)), 1);
    assert.ok(createdBookingId > 0);
  });

  it("approves a create override with a changed available date without mutating the original request", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const requestedDate = "2042-02-17";
    const changedDate = "2042-02-18";
    await fillNonOncologyCategory(requestedDate);
    const requested = await requestCategoryOverride(requestedDate);
    assert.equal(requested.status, 201);
    const requestId = Number((requested.data as any).request.id);
    const targetPatientId = Number((requested.data as any).request.patientId);

    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: {
        approverReason: "Move to an open date",
        approvalMode: "changed_date",
        changedBookingDate: changedDate,
        changedBookingTime: "10:30",
      },
    });

    assert.equal(approved.status, 200);
    assert.equal((approved.data as any).request.status, "approved");
    assert.equal((approved.data as any).booking.bookingDate, changedDate);
    assert.equal((approved.data as any).booking.bookingTime, "10:30:00");
    assert.equal(await countBookings(requestedDate, targetPatientId), 0);
    assert.equal(await countBookings(changedDate, targetPatientId), 1);

    const stored = await getRequestFromDb(requestId);
    assert.equal(stored.requested_booking_date, requestedDate);
    assert.equal(stored.request_payload_json.createPayload.bookingDate, requestedDate);
    const snapshot = stored.approval_decision_snapshot_json as any;
    assert.equal(snapshot.approvalMode, "changed_date");
    assert.equal(snapshot.changedDateApproval.usedChangedDate, true);
    assert.equal(snapshot.changedDateApproval.originalBookingDate, requestedDate);
    assert.equal(snapshot.changedDateApproval.finalBookingDate, changedDate);
    assert.equal(snapshot.changedDateApproval.finalBookingTime, "10:30");
    assert.equal(snapshot.changedDateApproval.originalOverrideType, "category_override");
    assert.equal(snapshot.changedDateApproval.finalRequiredOverrideType, null);
  });

  it("validates changed-date approval input", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const requestedDate = "2042-02-19";
    await fillNonOncologyCategory(requestedDate);
    const requested = await requestCategoryOverride(requestedDate);
    assert.equal(requested.status, 201);
    const requestId = Number((requested.data as any).request.id);

    const missingDate = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "Move date", approvalMode: "changed_date" },
    });
    assert.equal(missingDate.status, 400);

    const invalidDate = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "Move date", approvalMode: "changed_date", changedBookingDate: "2042-99-99" },
    });
    assert.equal(invalidDate.status, 400);

    const invalidTime = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "Move date", approvalMode: "changed_date", changedBookingDate: "2042-02-20", changedBookingTime: "25:61" },
    });
    assert.equal(invalidTime.status, 400);

    const missingNote = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "", approvalMode: "changed_date", changedBookingDate: "2042-02-20" },
    });
    assert.equal(missingNote.status, 400);

    const stored = await getRequestFromDb(requestId);
    assert.equal(stored.status, "pending");
  });

  it("blocks supervisor changed-date approval when the changed date requires total capacity override", async () => {
    if (!testData) return;
    const requestedDate = "2042-03-01";
    const changedDate = "2042-03-02";
    const { requestId, patientId } = await createCategoryRequestWithTotalFullChangedDate(requestedDate, changedDate);
    const beforeChangedDateCount = await countBookings(changedDate, patientId);

    const approval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: {
        approverReason: "Move into total capacity date",
        approvalMode: "changed_date",
        changedBookingDate: changedDate,
      },
    });

    assert.equal(approval.status, 403);
    assert.equal(await countBookings(changedDate, patientId), beforeChangedDateCount);
    const stored = await getRequestFromDb(requestId);
    assert.equal(stored.status, "pending");
  });

  it("requires an approval note for changed-date approval into total capacity", async () => {
    if (!testData) return;
    const requestedDate = "2042-03-03";
    const changedDate = "2042-03-04";
    const { requestId, patientId } = await createCategoryRequestWithTotalFullChangedDate(requestedDate, changedDate);
    const beforeChangedDateCount = await countBookings(changedDate, patientId);

    const approval = await fetchAs(superAdminCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: {
        approverReason: "",
        approvalMode: "changed_date",
        changedBookingDate: changedDate,
      },
    });

    assert.equal(approval.status, 400);
    assert.equal(await countBookings(changedDate, patientId), beforeChangedDateCount);
    const stored = await getRequestFromDb(requestId);
    assert.equal(stored.status, "pending");
  });

  it("allows superadmin changed-date approval when the changed date requires total capacity override", async () => {
    if (!testData) return;
    const requestedDate = "2042-03-05";
    const changedDate = "2042-03-06";
    const changedTime = "09:15";
    const { requestId, patientId } = await createCategoryRequestWithTotalFullChangedDate(requestedDate, changedDate);
    const beforeChangedDateCount = await countBookings(changedDate, patientId);

    const approved = await fetchAs(superAdminCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: {
        approverReason: "Superadmin total capacity changed-date approval",
        approvalMode: "changed_date",
        changedBookingDate: changedDate,
        changedBookingTime: changedTime,
      },
    });

    assert.equal(approved.status, 200);
    assert.equal((approved.data as any).request.status, "approved");
    assert.equal((approved.data as any).booking.bookingDate, changedDate);
    assert.equal((approved.data as any).booking.bookingTime, `${changedTime}:00`);
    assert.equal(await countBookings(changedDate, patientId), beforeChangedDateCount + 1);

    const stored = await getRequestFromDb(requestId);
    assert.equal(stored.requested_booking_date, requestedDate);
    assert.equal(stored.requested_booking_time, null);
    assert.equal(stored.request_payload_json.createPayload.bookingDate, requestedDate);
    assert.equal(stored.request_payload_json.createPayload.bookingTime, null);
    const snapshot = stored.approval_decision_snapshot_json as any;
    assert.equal(snapshot.approvalMode, "changed_date");
    assert.equal(snapshot.changedDateApproval.originalBookingDate, requestedDate);
    assert.equal(snapshot.changedDateApproval.originalBookingTime, null);
    assert.equal(snapshot.changedDateApproval.finalBookingDate, changedDate);
    assert.equal(snapshot.changedDateApproval.finalBookingTime, changedTime);
    assert.equal(snapshot.changedDateApproval.finalRequiredOverrideType, "total_capacity_override");
  });

  it("supervisor approves a pending reschedule request and audit is written", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const sourceDate = "2042-02-04";
    const targetDate = "2042-02-05";
    const patientId = await createPatient();
    const booking = await fetchAs(supervisorCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: sourceDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(booking.status, 201);
    await fillNonOncologyCategory(targetDate);

    const request = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests", {
      method: "POST",
      body: {
        requestType: "reschedule_booking",
        bookingId: Number((booking.data as any).booking.id),
        requesterReason: "Patient requested this date",
        requestPayload: {
          bookingDate: targetDate,
          bookingTime: null,
          policySetKey: testData.policySetKey,
        },
      },
    });
    assert.equal(request.status, 201);
    const { pool } = await import("../../../../db/pool.js");
    const before = await pool.query<{ booking_date: string; booking_time: string | null }>(
      `select booking_date::text, booking_time::text from appointments_v2.bookings where id = $1`,
      [Number((booking.data as any).booking.id)]
    );
    assert.equal(before.rows[0]?.booking_date, sourceDate);

    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((request.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "Approved reschedule" },
    });
    assert.equal(approved.status, 200);
    assert.equal((approved.data as any).booking.bookingDate, targetDate);

    const after = await pool.query<{ booking_date: string; booking_time: string | null }>(
      `select booking_date::text, booking_time::text from appointments_v2.bookings where id = $1`,
      [Number((booking.data as any).booking.id)]
    );
    assert.equal(after.rows[0]?.booking_date, targetDate);

    const audit = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from appointments_v2.override_audit_events
       where booking_id = $1 and override_type = 'category_override'`,
      [Number((booking.data as any).booking.id)]
    );
    assert.equal(audit.rows[0]?.count, 1);
  });

  it("approves a reschedule override with a changed available date without mutating the original request", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const sourceDate = "2042-03-07";
    const requestedDate = "2042-03-08";
    const changedDate = "2042-03-09";
    const changedTime = "11:45";
    const patientId = await createPatient();
    const booking = await fetchAs(supervisorCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: sourceDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(booking.status, 201);
    const bookingId = Number((booking.data as any).booking.id);
    await fillNonOncologyCategory(requestedDate);

    const request = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests", {
      method: "POST",
      body: {
        requestType: "reschedule_booking",
        bookingId,
        requesterReason: "Patient requested a full date",
        requestPayload: {
          bookingDate: requestedDate,
          bookingTime: null,
          policySetKey: testData.policySetKey,
        },
      },
    });
    assert.equal(request.status, 201);
    assert.equal((request.data as any).request.overrideType, "category_override");
    const requestId = Number((request.data as any).request.id);

    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: {
        approverReason: "Move reschedule to open date",
        approvalMode: "changed_date",
        changedBookingDate: changedDate,
        changedBookingTime: changedTime,
      },
    });

    assert.equal(approved.status, 200);
    assert.equal((approved.data as any).request.status, "approved");
    assert.equal(Number((approved.data as any).booking.id), bookingId);
    assert.equal((approved.data as any).booking.bookingDate, changedDate);
    assert.equal((approved.data as any).booking.bookingTime, `${changedTime}:00`);

    const { pool } = await import("../../../../db/pool.js");
    const after = await pool.query<{ booking_date: string; booking_time: string | null }>(
      `select booking_date::text, booking_time::text from appointments_v2.bookings where id = $1`,
      [bookingId]
    );
    assert.equal(after.rows[0]?.booking_date, changedDate);
    assert.equal(after.rows[0]?.booking_time, `${changedTime}:00`);

    const stored = await getRequestFromDb(requestId);
    assert.equal(stored.requested_booking_date, requestedDate);
    assert.equal(stored.requested_booking_time, null);
    assert.equal(stored.request_payload_json.reschedulePayload.bookingDate, requestedDate);
    assert.equal(stored.request_payload_json.reschedulePayload.bookingTime, null);
    const snapshot = stored.approval_decision_snapshot_json as any;
    assert.equal(snapshot.approvalMode, "changed_date");
    assert.equal(snapshot.changedDateApproval.originalBookingDate, requestedDate);
    assert.equal(snapshot.changedDateApproval.originalBookingTime, null);
    assert.equal(snapshot.changedDateApproval.finalBookingDate, changedDate);
    assert.equal(snapshot.changedDateApproval.finalBookingTime, changedTime);
    assert.equal(snapshot.changedDateApproval.finalRequiredOverrideType, null);

    const rescheduleAudit = await pool.query<{ new_date: string; new_time: string | null }>(
      `select new_date::text, new_time::text
       from appointments_v2.reschedule_audit_events
       where booking_id = $1
       order by id desc
       limit 1`,
      [bookingId]
    );
    assert.equal(rescheduleAudit.rows[0]?.new_date, changedDate);
    assert.equal(rescheduleAudit.rows[0]?.new_time, `${changedTime}:00`);
  });

  it("blocks expired approval and total capacity approval by supervisor while allowing superadmin", async () => {
    if (!testData) return;
    const { pool } = await import("../../../../db/pool.js");
    await setCapacityLimits(1, 1);
    const date = "2042-02-06";
    await fillNonOncologyCategory(date, 1);

    const expired = await requestCategoryOverride(date);
    assert.equal(expired.status, 201);
    await pool.query(`update appointments_v2.scheduling_override_requests set expires_at = now() - interval '1 minute' where id = $1`, [
      Number((expired.data as any).request.id),
    ]);
    const expiredApproval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((expired.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "too late" },
    });
    assert.equal(expiredApproval.status, 409);
    assert.equal((await getRequestFromDb(Number((expired.data as any).request.id))).status, "expired");

    const total = await requestCategoryOverride(date);
    assert.equal(total.status, 201);
    assert.equal((total.data as any).request.overrideType, "total_capacity_override");
    assert.match(String((total.data as any).request.decisionContext.violatedRuleLabel), /capacity exceeded/i);
    assert.equal((total.data as any).request.decisionContext.currentCapacity, 1);
    assert.equal((total.data as any).request.decisionContext.totalCapacity, 1);
    assert.equal((total.data as any).request.decisionContext.afterApprovalCapacity, 2);
    assert.equal((total.data as any).request.decisionContext.overbookAmount, 1);
    assert.equal((total.data as any).request.decisionContext.approvalNoteRequired, true);
    const targetPatientId = Number((total.data as any).request.patientId);
    const beforeTotalApprovalCount = await countBookings(date, targetPatientId);

    const supervisorApproval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((total.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "not enough permission" },
    });
    assert.equal(supervisorApproval.status, 403);
    assert.equal(await countBookings(date, targetPatientId), beforeTotalApprovalCount);

    const missingNoteApproval = await fetchAs(superAdminCookie, `/api/v2/scheduling-override-requests/${Number((total.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "" },
    });
    assert.equal(missingNoteApproval.status, 400);
    assert.equal(await countBookings(date, targetPatientId), beforeTotalApprovalCount);

    const superAdminApproval = await fetchAs(superAdminCookie, `/api/v2/scheduling-override-requests/${Number((total.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "Total capacity approved" },
    });
    assert.equal(superAdminApproval.status, 200);
    assert.equal(await countBookings(date, targetPatientId), beforeTotalApprovalCount + 1);

    const supervisorRequestedTotal = await requestCategoryOverride(date, 0, supervisorCookie);
    assert.equal(supervisorRequestedTotal.status, 201);
    assert.equal((supervisorRequestedTotal.data as any).request.overrideType, "total_capacity_override");
    const supervisorRequestApproval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((supervisorRequestedTotal.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "supervisor still cannot approve total" },
    });
    assert.equal(supervisorRequestApproval.status, 403);
  });

  it("rejects supervisor approval when current scheduling state needs a stronger override than requested", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-04-07";
    await fillNonOncologyCategory(date);
    const requested = await requestCategoryOverride(date);
    assert.equal(requested.status, 201);
    assert.equal((requested.data as any).request.overrideType, "category_override");

    await setCapacityLimits(5, 5);
    const targetPatientId = Number((requested.data as any).request.patientId);
    const beforeCount = await countBookings(date, targetPatientId);
    const approval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((requested.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "Now requires total capacity" },
    });

    assertForbiddenResponse(approval);
    assert.equal(await countBookings(date, targetPatientId), beforeCount);
    const stored = await getRequestFromDb(Number((requested.data as any).request.id));
    assert.equal(stored.status, "pending");
    assert.equal(stored.failure_code, null);
    assert.equal(stored.failure_message, null);
    assert.equal(stored.approval_decision_snapshot_json, null);
  });

  it("approves normally when the override is no longer needed", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-02-08";
    await fillNonOncologyCategory(date);
    const requested = await requestCategoryOverride(date);
    assert.equal(requested.status, 201);

    await setCapacityLimits(10, 10);
    const approved = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((requested.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "Capacity opened" },
    });

    assert.equal(approved.status, 200);
    assert.equal((approved.data as any).request.status, "approved");
    assert.ok(Number((approved.data as any).booking.id) > 0);
  });

  it("allows only one concurrent approval to create a booking", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-02-09";
    await fillNonOncologyCategory(date);
    const requested = await requestCategoryOverride(date);
    const requestId = Number((requested.data as any).request.id);
    const targetPatientId = Number((requested.data as any).request.patientId);

    const [first, second] = await Promise.all([
      fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
        method: "POST",
        body: { approverReason: "Concurrent approval A" },
      }),
      fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
        method: "POST",
        body: { approverReason: "Concurrent approval B" },
      }),
    ]);
    const statuses = [first.status, second.status].sort();

    assert.deepEqual(statuses, [200, 409]);
    assert.equal(await countBookings(date, targetPatientId), 1);
  });

  it("cancels pending requests and blocks later approve or reject", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-02-10";
    await fillNonOncologyCategory(date);
    const requested = await requestCategoryOverride(date);
    const requestId = Number((requested.data as any).request.id);

    const cancelled = await fetchAs(receptionistCookie, `/api/v2/scheduling-override-requests/${requestId}/cancel`, {
      method: "POST",
    });
    assert.equal(cancelled.status, 200);
    assert.equal((cancelled.data as any).request.status, "cancelled");

    const approval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/approve`, {
      method: "POST",
      body: { approverReason: "too late" },
    });
    assert.equal(approval.status, 409);

    const rejected = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${requestId}/reject`, {
      method: "POST",
      body: { approverReason: "too late" },
    });
    assert.equal(rejected.status, 409);
  });

  it("rejects non-pending requests", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const approvedDate = "2042-02-11";
    await fillNonOncologyCategory(approvedDate);
    const approvedRequest = await requestCategoryOverride(approvedDate);
    const approvedId = Number((approvedRequest.data as any).request.id);
    assert.equal((await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${approvedId}/approve`, {
      method: "POST",
      body: { approverReason: "approve first" },
    })).status, 200);

    const rejectedDate = "2042-02-12";
    await fillNonOncologyCategory(rejectedDate);
    const rejectedRequest = await requestCategoryOverride(rejectedDate);
    const rejectedId = Number((rejectedRequest.data as any).request.id);
    assert.equal((await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${rejectedId}/reject`, {
      method: "POST",
      body: { approverReason: "reject first" },
    })).status, 200);

    const cancelledDate = "2042-02-13";
    await fillNonOncologyCategory(cancelledDate);
    const cancelledRequest = await requestCategoryOverride(cancelledDate);
    const cancelledId = Number((cancelledRequest.data as any).request.id);
    assert.equal((await fetchAs(receptionistCookie, `/api/v2/scheduling-override-requests/${cancelledId}/cancel`, {
      method: "POST",
    })).status, 200);

    const expiredDate = "2042-02-14";
    await fillNonOncologyCategory(expiredDate);
    const expiredRequest = await requestCategoryOverride(expiredDate);
    const expiredId = Number((expiredRequest.data as any).request.id);
    const { pool } = await import("../../../../db/pool.js");
    await pool.query(`update appointments_v2.scheduling_override_requests set expires_at = now() - interval '1 minute' where id = $1`, [expiredId]);
    assert.equal((await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${expiredId}/approve`, {
      method: "POST",
      body: { approverReason: "expire first" },
    })).status, 409);

    for (const id of [approvedId, rejectedId, cancelledId, expiredId]) {
      const retryReject = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${id}/reject`, {
        method: "POST",
        body: { approverReason: "retry reject" },
      });
      assert.equal(retryReject.status, 409);
    }
  });

  it("enforces list visibility for receptionist, supervisor, and superadmin", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const ownDate = "2042-02-15";
    const otherDate = "2042-02-16";
    await fillNonOncologyCategory(ownDate);
    await fillNonOncologyCategory(otherDate);
    const ownRequest = await requestCategoryOverride(ownDate);
    const otherPatientId = await createPatient();
    const otherRequest = await fetchAs(secondReceptionistCookie, "/api/v2/scheduling-override-requests", {
      method: "POST",
      body: {
        requestType: "create_booking",
        requesterReason: "Other receptionist request",
        requestPayload: {
          patientId: otherPatientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: otherDate,
          bookingTime: null,
          caseCategory: "non_oncology",
          policySetKey: testData.policySetKey,
        },
      },
    });
    assert.equal(ownRequest.status, 201);
    assert.equal(otherRequest.status, 201);
    const ownId = Number((ownRequest.data as any).request.id);
    const otherId = Number((otherRequest.data as any).request.id);

    const receptionistList = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests");
    const receptionistIds = (receptionistList.data as any).requests.map((request: any) => Number(request.id));
    assert.ok(receptionistIds.includes(ownId));
    assert.ok(!receptionistIds.includes(otherId));

    const supervisorList = await fetchAs(supervisorCookie, "/api/v2/scheduling-override-requests");
    const supervisorIds = (supervisorList.data as any).requests.map((request: any) => Number(request.id));
    assert.ok(supervisorIds.includes(ownId));
    assert.ok(supervisorIds.includes(otherId));

    const superAdminList = await fetchAs(superAdminCookie, "/api/v2/scheduling-override-requests");
    const superAdminIds = (superAdminList.data as any).requests.map((request: any) => Number(request.id));
    assert.ok(superAdminIds.includes(ownId));
    assert.ok(superAdminIds.includes(otherId));
  });

  it("keeps immediate supervisor credential override working", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-04-17";
    await fillNonOncologyCategory(date);
    const patientId = await createPatient();

    const created = await fetchAs(supervisorCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
        capacityResolutionMode: "category_override",
        override: {
          supervisorUsername,
          supervisorPassword: "test_password",
          reason: "Immediate supervisor override regression",
        },
      },
    });

    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal((created.data as any).wasOverride, true);
    const { pool } = await import("../../../../db/pool.js");
    const audit = await pool.query<{ override_reason: string | null; override_type: string; outcome: string }>(
      `select override_reason, override_type, outcome
       from appointments_v2.override_audit_events
       where booking_id = $1`,
      [Number((created.data as any).booking.id)]
    );
    assert.equal(audit.rows[0]?.override_type, "category_override");
    assert.equal(audit.rows[0]?.override_reason, "Immediate supervisor override regression");
    assert.equal(audit.rows[0]?.outcome, "approved_and_booked");
  });

  it("rejects invalid request payloads cleanly", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const missingReason = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests", {
      method: "POST",
      body: {
        requestType: "create_booking",
        requesterReason: "",
        requestPayload: {},
      },
    });
    assert.equal(missingReason.status, 400);

    const invalidCreatePayload = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests", {
      method: "POST",
      body: {
        requestType: "create_booking",
        requesterReason: "Need approval",
        requestPayload: {
          modalityId: testData.modalityId,
          bookingDate: "2042-02-18",
          policySetKey: testData.policySetKey,
        },
      },
    });
    assert.equal(invalidCreatePayload.status, 400);

    const rescheduleWithoutBooking = await fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests", {
      method: "POST",
      body: {
        requestType: "reschedule_booking",
        requesterReason: "Need approval",
        requestPayload: {
          bookingDate: "2042-02-19",
          policySetKey: testData.policySetKey,
        },
      },
    });
    assert.equal(rescheduleWithoutBooking.status, 400);
  });
});
