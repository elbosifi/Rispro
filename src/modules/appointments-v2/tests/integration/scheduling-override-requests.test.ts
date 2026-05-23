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
const TEST_PREFIX = "OVREQ_";

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

  before(async () => {
    if (!await canReachDatabase()) return;
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    app = await createTestApp();
    supervisorCookie = createTestAuthCookie(testData.userId, "supervisor");

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
    receptionistCookie = createTestAuthCookie(receptionistId, "receptionist");

    const secondReceptionist = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'receptionist', true)
       on conflict (username) do update set password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}receptionist2`, bcryptHash, `${TEST_PREFIX}Receptionist 2`]
    );
    secondReceptionistId = Number(secondReceptionist.rows[0].id);
    secondReceptionistCookie = createTestAuthCookie(secondReceptionistId, "receptionist");

    const superAdmin = await pool.query<{ id: number }>(
      `insert into users (username, password_hash, full_name, role, is_active)
       values ($1, $2, $3, 'super_admin', true)
       on conflict (username) do update set password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true
       returning id`,
      [`${TEST_PREFIX.toLowerCase()}superadmin`, bcryptHash, `${TEST_PREFIX}SuperAdmin`]
    );
    superAdminCookie = createTestAuthCookie(Number(superAdmin.rows[0].id), "super_admin");
  });

  after(async () => {
    if (!testData) return;
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

  async function createPatient() {
    const { pool } = await import("../../../../db/pool.js");
    const nationalId = `7${Math.random().toString().slice(2, 13).padEnd(11, "0").slice(0, 11)}`;
    const row = await pool.query<{ id: number }>(
      `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, identifier_type, identifier_value)
       values ($1, $2, $3, $4, 'M', 40, 'national_id', $5)
       returning id`,
      [`${TEST_PREFIX}مريض`, `${TEST_PREFIX} Patient`, nationalId, `${TEST_PREFIX}مريض`, nationalId]
    );
    return Number(row.rows[0].id);
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
      assert.equal(created.status, 201);
    }
  }

  async function requestCategoryOverride(date: string, patientId = 0) {
    const targetPatientId = patientId || await createPatient();
    return fetchAs(receptionistCookie, "/api/v2/scheduling-override-requests", {
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
        },
        createdFromContext: "integration_test",
      },
    });
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
      `select status, failure_code, failure_message, approval_decision_snapshot_json
       from appointments_v2.scheduling_override_requests
       where id = $1`,
      [id]
    );
    return result.rows[0] as {
      status: string;
      failure_code: string | null;
      failure_message: string | null;
      approval_decision_snapshot_json: unknown | null;
    };
  }

  it("rejects receptionist override requests when disabled in settings", async () => {
    if (!testData) return;
    const { pool } = await import("../../../../db/pool.js");
    await setCapacityLimits();
    const date = "2042-01-31";
    await fillNonOncologyCategory(date);
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value)
        values ('scheduling_and_capacity', 'allow_reception_override_requests_from_availability', '{"value":"disabled"}'::jsonb)
        on conflict (category, setting_key)
        do update set setting_value = excluded.setting_value
      `
    );

    try {
      const requested = await requestCategoryOverride(date);
      assert.equal(requested.status, 403);
      assert.match(String((requested.data as any).error?.message ?? ""), /disabled/i);
    } finally {
      await pool.query(
        `
          update system_settings
          set setting_value = '{"value":"enabled"}'::jsonb
          where category = 'scheduling_and_capacity'
            and setting_key = 'allow_reception_override_requests_from_availability'
        `
      );
    }
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

  it("approves a closed weekday deferred request without bypassing capacity rules", async () => {
    if (!testData) return;
    await setCapacityLimits(10, 5);
    const { pool } = await import("../../../../db/pool.js");
    const friday = "2042-02-07";
    const patientId = await createPatient();
    const existingSetting = await pool.query<{ setting_value: unknown }>(
      `
        select setting_value
        from system_settings
        where category = 'scheduling_and_capacity'
          and setting_key = 'allow_friday_appointments'
        limit 1
      `
    );

    try {
      await pool.query(
        `
          insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
          values ('scheduling_and_capacity', 'allow_friday_appointments', '{"value":"false"}'::jsonb, $1)
          on conflict (category, setting_key) do update set
            setting_value = excluded.setting_value,
            updated_by_user_id = excluded.updated_by_user_id,
            updated_at = now()
        `,
        [testData.userId]
      );

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
    } finally {
      if (existingSetting.rows.length > 0) {
        await pool.query(
          `
            update system_settings
            set setting_value = $1::jsonb, updated_by_user_id = null, updated_at = now()
            where category = 'scheduling_and_capacity'
              and setting_key = 'allow_friday_appointments'
          `,
          [JSON.stringify(existingSetting.rows[0].setting_value)]
        );
      } else {
        await pool.query(
          `
            delete from system_settings
            where category = 'scheduling_and_capacity'
              and setting_key = 'allow_friday_appointments'
          `
        );
      }
    }
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
    const targetPatientId = Number((total.data as any).request.patientId);
    const beforeTotalApprovalCount = await countBookings(date, targetPatientId);

    const supervisorApproval = await fetchAs(supervisorCookie, `/api/v2/scheduling-override-requests/${Number((total.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "not enough permission" },
    });
    assert.equal(supervisorApproval.status, 403);
    assert.equal(await countBookings(date, targetPatientId), beforeTotalApprovalCount);

    const superAdminApproval = await fetchAs(superAdminCookie, `/api/v2/scheduling-override-requests/${Number((total.data as any).request.id)}/approve`, {
      method: "POST",
      body: { approverReason: "Total capacity approved" },
    });
    assert.equal(superAdminApproval.status, 200);
    assert.equal(await countBookings(date, targetPatientId), beforeTotalApprovalCount + 1);
  });

  it("fails cleanly when current scheduling state needs a stronger override than requested", async () => {
    if (!testData) return;
    await setCapacityLimits();
    const date = "2042-02-07";
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

    assert.equal(approval.status, 409);
    assert.equal(await countBookings(date, targetPatientId), beforeCount);
    const stored = await getRequestFromDb(Number((requested.data as any).request.id));
    assert.equal(stored.status, "failed");
    assert.equal(stored.failure_code, "override_type_changed");
    assert.ok(stored.failure_message);
    assert.ok(stored.approval_decision_snapshot_json);
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
    const date = "2042-02-17";
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

    assert.equal(created.status, 201);
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
