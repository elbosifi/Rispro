/**
 * Appointments V2 — Special quota and resolution mode DB-backed integration tests.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../../../../db/pool.js";
import type { SchedulingOverrideType } from "../../shared/types/common.js";
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
const TEST_PREFIX = "SQMODE_";
const QUOTA_LOGICAL_KEY = randomUUID();
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

describe("Special quota + capacity resolution modes — DB-backed integration", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let supervisorAuthCookie: string;
  let supervisorReauthCookie: string;
  let superAdminReauthCookie: string;
  let receptionistAuthCookie: string;
  let restoreWeekendAppointmentSettings: (() => Promise<void>) | undefined;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database not reachable. Skipping special quota mode tests.");
      return;
    }
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    restoreWeekendAppointmentSettings = await enableWeekendAppointmentsForSuite(testData.userId);
    app = await createTestApp();
    supervisorAuthCookie = createTestAuthCookie(testData.userId, "supervisor");
    supervisorReauthCookie = `${supervisorAuthCookie}; ${createTestSupervisorReauthCookie(testData.userId, "supervisor")}`;
    superAdminReauthCookie = `${createTestAuthCookie(testData.userId, "super_admin")}; ${createTestSupervisorReauthCookie(testData.userId, "super_admin")}`;
    receptionistAuthCookie = createTestAuthCookie(testData.userId, "receptionist");
  });

  after(async () => {
    if (!testData) return;
    await restoreWeekendAppointmentSettings?.();
    await app.close();
    await testDb.cleanup();
  });

  function guard() {
    if (!testData) throw new Error("Test setup failed");
  }

  const fetchWithCookie = (cookie: string, path: string, opts: Record<string, unknown> = {}) => {
    const { body: origBody, ...rest } = opts as Record<string, unknown> & { body?: unknown };
    if (path.includes("/api/v2/appointments")) {
      const body = origBody as Record<string, unknown> | undefined;
      if (body) {
        return fetchJson(app.baseUrl, path, {
          cookie,
          ...rest,
          body: { ...body, policySetKey: testData.policySetKey },
        });
      }
    }
    return fetchJson(app.baseUrl, path, {
      cookie,
      ...rest,
      ...(origBody !== undefined ? { body: origBody } : {}),
    });
  };
  const fetch = (path: string, opts: Record<string, unknown> = {}) =>
    fetchWithCookie(supervisorAuthCookie, path, opts);

  async function db() {
    const mod = await import("../../../../db/pool.js");
    return mod.pool;
  }

  async function createPatient(): Promise<number> {
    const pool = await db();
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const nationalId = `9${randomUUID().replace(/-/g, "").slice(0, 11)}`;
    const result = await pool.query<{ id: number }>(
      `insert into patients (
         arabic_full_name,
         english_full_name,
         national_id,
         normalized_arabic_name,
         sex,
         age_years,
         phone_1,
         identifier_type,
         identifier_value
       )
       values ($1, $2, $3, $4, 'M', 34, $5, 'national_id', $6)
       returning id`,
      [
        `${TEST_PREFIX}${suffix}مريض`,
        `${TEST_PREFIX}${suffix} Patient`,
        nationalId,
        `${TEST_PREFIX}${suffix}مريض`,
        "0912345678",
        nationalId,
      ]
    );
    return Number(result.rows[0].id);
  }

  async function createSecondExamType(): Promise<number> {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const result = await pool.query<{ id: number }>(
      `insert into exam_types (modality_id, name_ar, name_en, code, is_active)
       values ($1, $2, $3, $4, true)
       returning id`,
      [
        testData.modalityId,
        `${TEST_PREFIX}${suffix} فحص ثان`,
        `${TEST_PREFIX}${suffix} Second exam`,
        `${TEST_PREFIX}${suffix}EX2`,
      ]
    );
    return Number(result.rows[0].id);
  }

  async function setModalityCapacity(dailyCapacity: number): Promise<void> {
    const pool = await db();
    await pool.query(`update modalities set daily_capacity = $2 where id = $1`, [testData.modalityId, dailyCapacity]);
  }

  async function setCategoryLimits(oncology: number | null, nonOncology: number | null): Promise<void> {
    const pool = await db();
    await pool.query(
      `delete from appointments_v2.category_daily_limits where policy_version_id = $1 and modality_id = $2`,
      [testData.policyVersionId, testData.modalityId]
    );

    if (oncology != null) {
      await pool.query(
        `insert into appointments_v2.category_daily_limits
           (policy_version_id, modality_id, case_category, daily_limit, is_active)
         values ($1, $2, 'oncology', $3, true)`,
        [testData.policyVersionId, testData.modalityId, oncology]
      );
    }

    if (nonOncology != null) {
      await pool.query(
        `insert into appointments_v2.category_daily_limits
           (policy_version_id, modality_id, case_category, daily_limit, is_active)
         values ($1, $2, 'non_oncology', $3, true)`,
        [testData.policyVersionId, testData.modalityId, nonOncology]
      );
    }
  }

  async function setSpecialQuota(
    dailyExtraSlots: number,
    examTypeIds: number[] = [testData.examTypeId],
    allowedUserIds: number[] = [testData.userId]
  ): Promise<number> {
    const pool = await db();
    const result = await pool.query<{ id: number }>(
      `insert into appointments_v2.special_quota_rules
        (logical_key, policy_version_id, modality_id, title, daily_extra_slots, is_active)
      values ($1::uuid, $2, $3, 'Shared overflow pool', $4, true)
      on conflict (policy_version_id, logical_key) do update set
        modality_id = excluded.modality_id,
        title = excluded.title,
        daily_extra_slots = excluded.daily_extra_slots,
        is_active = true
      returning id`,
      [QUOTA_LOGICAL_KEY, testData.policyVersionId, testData.modalityId, dailyExtraSlots]
    );
    const ruleId = Number(result.rows[0]?.id);
    await pool.query(
      `delete from appointments_v2.special_quota_rule_exam_types where quota_rule_id = $1`,
      [ruleId]
    );
    await pool.query(
      `insert into appointments_v2.special_quota_rule_exam_types (quota_rule_id, exam_type_id)
       select $1, unnest($2::bigint[])`,
      [ruleId, examTypeIds]
    );
    await pool.query(`delete from appointments_v2.special_quota_rule_users where quota_rule_id = $1`, [ruleId]);
    if (allowedUserIds.length > 0) {
      await pool.query(
        `insert into appointments_v2.special_quota_rule_users (quota_rule_id, user_id)
         select $1, unnest($2::bigint[])`,
        [ruleId, allowedUserIds]
      );
    }
    return ruleId;
  }

  async function supervisorOverride(
    reason = "approved",
    overrideTypes?: SchedulingOverrideType[]
  ) {
    const pool = await db();
    const supervisorRow = await pool.query<{ username: string }>(
      `select username from users where id = $1`,
      [testData.userId]
    );
    return {
      supervisorUsername: supervisorRow.rows[0]?.username ?? "",
      supervisorPassword: "test_password",
      reason,
      ...(overrideTypes ? { overrideTypes } : {}),
    };
  }

  async function createBooking(params: {
    patientId: number;
    bookingDate: string;
    caseCategory: "oncology" | "non_oncology";
    examTypeId?: number;
    capacityResolutionMode?: "standard" | "category_override" | "special_quota_extra";
    specialReasonCode?: string | null;
    specialReasonNote?: string | null;
    override?: {
      supervisorUsername: string;
      supervisorPassword: string;
      reason: string;
      overrideTypes?: SchedulingOverrideType[];
    };
  }) {
    return fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: params.patientId,
        modalityId: testData.modalityId,
        examTypeId: params.examTypeId ?? testData.examTypeId,
        bookingDate: params.bookingDate,
        caseCategory: params.caseCategory,
        capacityResolutionMode: params.capacityResolutionMode,
        specialReasonCode: params.specialReasonCode ?? null,
        specialReasonNote: params.specialReasonNote ?? null,
        override: params.override,
      },
    });
  }

  let dayOffset = 0;
  function uniqueDate(): string {
    dayOffset += 1;
    const d = new Date(Date.UTC(2042, 0, 1));
    d.setUTCDate(d.getUTCDate() + dayOffset);
    return d.toISOString().slice(0, 10);
  }

  it("authorizes current-user supervisor overrides from recent re-auth and ignores spoofed approver fields", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(1, 1);
    await setSpecialQuota(0);
    const firstPatient = await createPatient();
    const secondPatient = await createPatient();

    assert.equal((await createBooking({
      patientId: firstPatient,
      bookingDate: date,
      caseCategory: "non_oncology",
    })).status, 201);

    const result = await fetchWithCookie(supervisorReauthCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: secondPatient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        capacityResolutionMode: "category_override",
        override: {
          authorizationMode: "current_user_reauth",
          reason: "Current supervisor approval",
          overrideType: "category_override",
          approverUserId: 999999,
          approverRole: "super_admin",
        },
      },
    });
    assert.equal(result.status, 201);

    const bookingId = Number((result.data as any).booking.id);
    const audit = await (await db()).query<{ requesting_user_id: number; supervisor_user_id: number; decision_snapshot: Record<string, unknown> }>(
      `select requesting_user_id, supervisor_user_id, decision_snapshot
       from appointments_v2.override_audit_events
       where booking_id = $1
       order by id desc
       limit 1`,
      [bookingId]
    );
    assert.equal(Number(audit.rows[0]?.requesting_user_id), testData.userId);
    assert.equal(Number(audit.rows[0]?.supervisor_user_id), testData.userId);
    assert.equal("deferredApprovalRequestId" in (audit.rows[0]?.decision_snapshot ?? {}), false);
  });

  it("requires recent re-authentication and a supervisor session for current-user overrides", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(1, 1);
    await setSpecialQuota(0);
    const firstPatient = await createPatient();
    const secondPatient = await createPatient();
    assert.equal((await createBooking({ patientId: firstPatient, bookingDate: date, caseCategory: "non_oncology" })).status, 201);

    const missingReauth = await fetchWithCookie(supervisorAuthCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: secondPatient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        override: { authorizationMode: "current_user_reauth", reason: "Missing re-auth", overrideType: "category_override" },
      },
    });
    assert.equal(missingReauth.status, 403);

    const receptionistWithSupervisorCookie = `${receptionistAuthCookie}; ${createTestSupervisorReauthCookie(testData.userId, "supervisor")}`;
    const receptionistAttempt = await fetchWithCookie(receptionistWithSupervisorCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: secondPatient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        override: { authorizationMode: "current_user_reauth", reason: "Receptionist must not approve", overrideType: "category_override" },
      },
    });
    assert.equal(receptionistAttempt.status, 403);
  });

  it("keeps live override authority and required-type validation for current-user approvals", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(1);
    await setCategoryLimits(null, null);
    await setSpecialQuota(0);
    const firstPatient = await createPatient();
    const secondPatient = await createPatient();
    assert.equal((await createBooking({ patientId: firstPatient, bookingDate: date, caseCategory: "non_oncology" })).status, 201);

    const supervisorTotalAttempt = await fetchWithCookie(supervisorReauthCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: secondPatient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        capacityResolutionMode: "total_capacity_override",
        override: { authorizationMode: "current_user_reauth", reason: "Supervisor cannot overbook total capacity", overrideType: "total_capacity_override" },
      },
    });
    assert.equal(supervisorTotalAttempt.status, 403);

    const superAdminResult = await fetchWithCookie(superAdminReauthCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: secondPatient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        capacityResolutionMode: "total_capacity_override",
        override: { authorizationMode: "current_user_reauth", reason: "Super admin total capacity approval", overrideType: "total_capacity_override" },
      },
    });
    assert.equal(superAdminResult.status, 201);

    const mismatchDate = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(1, 1);
    const mismatchFirstPatient = await createPatient();
    const mismatchSecondPatient = await createPatient();
    assert.equal((await createBooking({ patientId: mismatchFirstPatient, bookingDate: mismatchDate, caseCategory: "non_oncology" })).status, 201);
    const mismatch = await fetchWithCookie(supervisorReauthCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: mismatchSecondPatient,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: mismatchDate,
        caseCategory: "non_oncology",
        override: { authorizationMode: "current_user_reauth", reason: "Wrong requested type", overrideType: "modality_block_override" },
      },
    });
    assert.equal(mismatch.status, 409);
  });

  it("supports current-user reschedule overrides and rejects the same request without recent re-auth", async () => {
    guard();
    const sourceDate = uniqueDate();
    const targetDate = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(1, 1);
    await setSpecialQuota(0);
    const movingPatient = await createPatient();
    const targetPatient = await createPatient();
    const moving = await createBooking({ patientId: movingPatient, bookingDate: sourceDate, caseCategory: "non_oncology" });
    assert.equal(moving.status, 201);
    assert.equal((await createBooking({ patientId: targetPatient, bookingDate: targetDate, caseCategory: "non_oncology" })).status, 201);
    const bookingId = Number((moving.data as any).booking.id);

    const result = await fetchWithCookie(supervisorReauthCookie, `/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: {
        bookingDate: targetDate,
        capacityResolutionMode: "category_override",
        override: { authorizationMode: "current_user_reauth", reason: "Current supervisor reschedule", overrideType: "category_override" },
      },
    });
    assert.equal(result.status, 200);
    assert.equal((result.data as any).wasOverride, true);

    const withoutReauth = await fetchWithCookie(supervisorAuthCookie, `/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: {
        bookingDate: sourceDate,
        override: { authorizationMode: "current_user_reauth", reason: "No recent re-auth", overrideType: "category_override" },
      },
    });
    assert.equal(withoutReauth.status, 403);
  });

  it("keeps current-user no-show authorization reason mandatory", async () => {
    guard();
    await setModalityCapacity(10);
    await setCategoryLimits(null, null);
    await setSpecialQuota(0);
    const patientId = await createPatient();
    await (await db()).query(
      `update patients set category = 'oncology', no_show_count = 1, no_show_booking_blocked = true where id = $1`,
      [patientId]
    );

    const missingReason = await fetchWithCookie(superAdminReauthCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: uniqueDate(),
        caseCategory: "oncology",
        override: { authorizationMode: "current_user_reauth", reason: "", overrideType: "category_override" },
      },
    });
    assert.equal(missingReason.status, 403);
    assert.match(JSON.stringify(missingReason.data), /No-show booking authorization reason is required/);

    const authorizedNoShow = await fetchWithCookie(superAdminReauthCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: uniqueDate(),
        caseCategory: "oncology",
        override: { authorizationMode: "current_user_reauth", reason: "No-show restriction approved" },
      },
    });
    assert.equal(authorizedNoShow.status, 201);
    assert.equal((authorizedNoShow.data as any).wasOverride, false);
  });

  it("category full + total has room -> category_override succeeds without consuming special quota", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(1, 1);
    await setSpecialQuota(0);

    const p1 = await createPatient();
    const p2 = await createPatient();

    const first = await createBooking({
      patientId: p1,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "standard",
    });
    assert.equal(first.status, 201);

    const second = await createBooking({
      patientId: p2,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "category_override",
      override: await supervisorOverride("category capacity approved", ["category_override"]),
    });
    assert.equal(second.status, 201);

    const booking = (second.data as Record<string, unknown>).booking as Record<string, unknown>;
    assert.equal(booking.capacityResolutionMode, "category_override");
    assert.equal(booking.usesSpecialQuota, false);
  });

  it("category full + special quota available -> special_quota_extra succeeds and persists uses_special_quota=true", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(null, 1);
    await setSpecialQuota(1);

    const p1 = await createPatient();
    const p2 = await createPatient();

    const base = await createBooking({
      patientId: p1,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "standard",
    });
    assert.equal(base.status, 201);

    const special = await createBooking({
      patientId: p2,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
      specialReasonNote: "Needs extra slot",
    });
    assert.equal(special.status, 201);

    const specialBooking = (special.data as Record<string, unknown>).booking as Record<string, unknown>;
    assert.equal(specialBooking.capacityResolutionMode, "special_quota_extra");
    assert.equal(specialBooking.usesSpecialQuota, true);

    const pool = await db();
    const row = await pool.query<{
      uses_special_quota: boolean;
      capacity_resolution_mode: string;
      logical_key: string;
      released_at: Date | null;
    }>(
      `select booking.uses_special_quota,
              booking.capacity_resolution_mode,
              consumption.quota_logical_key::text as logical_key,
              consumption.released_at
       from appointments_v2.bookings booking
       join appointments_v2.special_quota_consumptions consumption
         on consumption.booking_id = booking.id
       where booking.id = $1`,
      [Number(specialBooking.id)]
    );
    assert.equal(row.rows[0]?.uses_special_quota, true);
    assert.equal(row.rows[0]?.capacity_resolution_mode, "special_quota_extra");
    assert.equal(row.rows[0]?.logical_key, QUOTA_LOGICAL_KEY);
    assert.equal(row.rows[0]?.released_at, null);
  });

  it("two exams in one pool share one slot under concurrent booking", async () => {
    guard();
    const date = uniqueDate();
    const secondExamTypeId = await createSecondExamType();
    await setModalityCapacity(3);
    await setCategoryLimits(null, null);
    await setSpecialQuota(1, [testData.examTypeId, secondExamTypeId]);

    const [first, second] = await Promise.all([
      createBooking({
        patientId: await createPatient(),
        bookingDate: date,
        examTypeId: testData.examTypeId,
        caseCategory: "non_oncology",
        capacityResolutionMode: "special_quota_extra",
        specialReasonCode: "urgent_oncology",
      }),
      createBooking({
        patientId: await createPatient(),
        bookingDate: date,
        examTypeId: secondExamTypeId,
        caseCategory: "non_oncology",
        capacityResolutionMode: "special_quota_extra",
        specialReasonCode: "urgent_oncology",
      }),
    ]);

    assert.deepEqual([first.status, second.status].sort(), [201, 409]);
    const consumptions = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from appointments_v2.special_quota_consumptions
        where quota_logical_key = $1::uuid
          and booking_date = $2::date
          and released_at is null`,
      [QUOTA_LOGICAL_KEY, date]
    );
    assert.equal(Number(consumptions.rows[0]?.count), 1);
  });

  it("category full + no special quota -> special_quota_extra blocked", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(null, 1);
    await setSpecialQuota(0);

    const p1 = await createPatient();
    const p2 = await createPatient();

    const base = await createBooking({
      patientId: p1,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "standard",
    });
    assert.equal(base.status, 201);

    const special = await createBooking({
      patientId: p2,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(special.status, 409);
  });

  it("override audit snapshot records selected capacityResolutionMode", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(3);
    await setCategoryLimits(null, null);
    await setSpecialQuota(2);

    const pool = await db();
    await pool.query(
      `insert into appointments_v2.modality_blocked_rules
        (policy_version_id, modality_id, rule_type, specific_date, is_overridable, is_active, title)
       values ($1, $2, 'specific_date', $3::date, true, true, 'Supervisor-only day')`,
      [testData.policyVersionId, testData.modalityId, date]
    );
    const supervisorRow = await pool.query<{ username: string }>(
      `select username from users where id = $1`,
      [testData.userId]
    );

    const patientId = await createPatient();
    const result = await createBooking({
      patientId,
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
      override: {
        supervisorUsername: supervisorRow.rows[0]?.username ?? "",
        supervisorPassword: "test_password",
        reason: "approved",
        overrideTypes: ["modality_block_override"],
      },
    });
    assert.equal(result.status, 201);

    const booking = (result.data as Record<string, unknown>).booking as Record<string, unknown>;
    const audit = await pool.query<{ mode: string | null }>(
      `select decision_snapshot->>'capacityResolutionMode' as mode
       from appointments_v2.override_audit_events
       where booking_id = $1
       order by id desc
       limit 1`,
      [Number(booking.id)]
    );
    assert.equal(audit.rows[0]?.mode, "special_quota_extra");
  });

  it("non-supervisor API request with category_override is rejected", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(1, 1);

    const result = await fetchWithCookie(receptionistAuthCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: await createPatient(),
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        capacityResolutionMode: "category_override",
      },
    });
    assert.equal(result.status, 403);
  });

  it("assigned receptionist API request with special_quota_extra is allowed", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(null, 1);
    await setSpecialQuota(2);

    const base = await createBooking({
      patientId: await createPatient(),
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "standard",
    });
    assert.equal(base.status, 201);

    const result = await fetchWithCookie(receptionistAuthCookie, "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: await createPatient(),
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        capacityResolutionMode: "special_quota_extra",
        specialReasonCode: "urgent_oncology",
      },
    });
    assert.equal(result.status, 201);
  });

  it("unassigned receptionist API request with special_quota_extra is rejected", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(1);
    await setCategoryLimits(null, null);
    await setSpecialQuota(2);

    const result = await fetchWithCookie(createTestAuthCookie(testData.userId + 999, "receptionist"), "/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: await createPatient(),
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        caseCategory: "non_oncology",
        capacityResolutionMode: "special_quota_extra",
        specialReasonCode: "urgent_oncology",
      },
    });
    assert.equal(result.status, 403);
  });

  it("same-slot standard to special to standard transitions consume and release exactly once", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(null, null);
    await setSpecialQuota(1);

    const created = await createBooking({
      patientId: await createPatient(),
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "standard",
    });
    assert.equal(created.status, 201);
    const bookingId = Number(((created.data as Record<string, unknown>).booking as Record<string, unknown>).id);

    const toSpecial = await fetch(`/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: {
        capacityResolutionMode: "special_quota_extra",
        specialReasonCode: "urgent_oncology",
      },
    });
    assert.equal(toSpecial.status, 200);

    const active = await pool.query<{ count: string }>(
      `select count(*)::text as count
         from appointments_v2.special_quota_consumptions
        where booking_id = $1 and released_at is null`,
      [bookingId]
    );
    assert.equal(Number(active.rows[0]?.count), 1);

    const toStandard = await fetch(`/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: { capacityResolutionMode: "standard" },
    });
    assert.equal(toStandard.status, 200);

    const history = await pool.query<{ active: string; total: string }>(
      `select count(*) filter (where released_at is null)::text as active,
              count(*)::text as total
         from appointments_v2.special_quota_consumptions
        where booking_id = $1`,
      [bookingId]
    );
    assert.equal(Number(history.rows[0]?.active), 0);
    assert.equal(Number(history.rows[0]?.total), 1);
  });

  it("failed target reschedule and ineligible exam change leave booking and source consumption unchanged", async () => {
    guard();
    const sourceDate = uniqueDate();
    const fullTargetDate = uniqueDate();
    const ineligibleExamTypeId = await createSecondExamType();
    await setModalityCapacity(3);
    await setCategoryLimits(null, null);
    await setSpecialQuota(1, [testData.examTypeId]);

    const source = await createBooking({
      patientId: await createPatient(),
      bookingDate: sourceDate,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    const target = await createBooking({
      patientId: await createPatient(),
      bookingDate: fullTargetDate,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(source.status, 201);
    assert.equal(target.status, 201);
    const bookingId = Number(((source.data as Record<string, unknown>).booking as Record<string, unknown>).id);

    const exhaustedMove = await fetch(`/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: {
        bookingDate: fullTargetDate,
        capacityResolutionMode: "special_quota_extra",
        specialReasonCode: "urgent_oncology",
      },
    });
    assert.equal(exhaustedMove.status, 409);

    const ineligibleExamChange = await fetch(`/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: {
        examTypeId: ineligibleExamTypeId,
        capacityResolutionMode: "special_quota_extra",
        specialReasonCode: "urgent_oncology",
        override: await supervisorOverride("exam change"),
      },
    });
    assert.equal(ineligibleExamChange.status, 409);

    const unchanged = await pool.query<{ booking_date: string; exam_type_id: string; consumption_date: string; active_count: string }>(
      `select booking.booking_date::text,
              booking.exam_type_id::text,
              min(consumption.booking_date)::text as consumption_date,
              count(*) filter (where consumption.released_at is null)::text as active_count
         from appointments_v2.bookings booking
         join appointments_v2.special_quota_consumptions consumption on consumption.booking_id = booking.id
        where booking.id = $1
        group by booking.id`,
      [bookingId]
    );
    assert.equal(unchanged.rows[0]?.booking_date, sourceDate);
    assert.equal(Number(unchanged.rows[0]?.exam_type_id), testData.examTypeId);
    assert.equal(unchanged.rows[0]?.consumption_date, sourceDate);
    assert.equal(Number(unchanged.rows[0]?.active_count), 1);
  });

  it("cancel and reschedule release/preserve quota according to selected mode", async () => {
    guard();
    const sourceDate = uniqueDate();
    const targetDate = uniqueDate();
    await setModalityCapacity(1);
    await setCategoryLimits(null, null);
    await setSpecialQuota(1);

    const p1 = await createPatient();
    const p2 = await createPatient();

    const created = await createBooking({
      patientId: p1,
      bookingDate: sourceDate,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(created.status, 201);
    const createdBooking = (created.data as Record<string, unknown>).booking as Record<string, unknown>;
    const bookingId = Number(createdBooking.id);

    const rescheduled = await fetch(`/api/v2/appointments/${bookingId}`, {
      method: "PUT",
      body: {
        bookingDate: targetDate,
        capacityResolutionMode: "special_quota_extra",
        specialReasonCode: "urgent_oncology",
      },
    });
    assert.equal(rescheduled.status, 200);

    const pool = await db();
    const afterReschedule = await pool.query<{ uses_special_quota: boolean; capacity_resolution_mode: string }>(
      `select uses_special_quota, capacity_resolution_mode
       from appointments_v2.bookings
       where id = $1`,
      [bookingId]
    );
    assert.equal(afterReschedule.rows[0]?.uses_special_quota, true);
    assert.equal(afterReschedule.rows[0]?.capacity_resolution_mode, "special_quota_extra");

    const sourceRebook = await createBooking({
      patientId: p2,
      bookingDate: sourceDate,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(sourceRebook.status, 201);

    const targetBooking = (rescheduled.data as Record<string, unknown>).booking as Record<string, unknown>;
    const cancelResult = await fetch(`/api/v2/appointments/${Number(targetBooking.id)}/cancel`, {
      method: "POST",
    });
    assert.equal(cancelResult.status, 200);
    const repeatedCancel = await fetch(`/api/v2/appointments/${Number(targetBooking.id)}/cancel`, {
      method: "POST",
    });
    assert.equal(repeatedCancel.status, 409);

    const releasedHistory = await pool.query<{ booking_date: string; released_at: Date | null }>(
      `select booking_date::text, released_at
         from appointments_v2.special_quota_consumptions
        where booking_id = $1
        order by booking_date`,
      [bookingId]
    );
    assert.equal(releasedHistory.rowCount, 2);
    assert.deepEqual(
      releasedHistory.rows.map((row) => row.booking_date),
      [sourceDate, targetDate]
    );
    assert.ok(releasedHistory.rows.every((row) => row.released_at != null));

    const sourceSecondTry = await createBooking({
      patientId: await createPatient(),
      bookingDate: targetDate,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(sourceSecondTry.status, 201);
  });

  it("discontinue releases special quota exactly once and is terminal", async () => {
    guard();
    const date = uniqueDate();
    await setModalityCapacity(2);
    await setCategoryLimits(null, null);
    await setSpecialQuota(1);

    const created = await createBooking({
      patientId: await createPatient(),
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(created.status, 201);
    const bookingId = Number(((created.data as Record<string, unknown>).booking as Record<string, unknown>).id);

    const discontinued = await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
      method: "POST",
      body: { status: "discontinued", reason: "Clinical workflow stopped" },
    });
    assert.equal(discontinued.status, 200);

    const repeated = await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
      method: "POST",
      body: { status: "discontinued", reason: "Repeated request" },
    });
    assert.equal(repeated.status, 200);

    const lifecycle = await pool.query<{
      status: string;
      activeNormalCount: string;
      activeConsumptionCount: string;
      totalConsumptionCount: string;
      releaseReason: string | null;
    }>(
      `select booking.status,
              (select count(*)::text
                 from appointments_v2.bookings active_booking
                where active_booking.modality_id = booking.modality_id
                  and active_booking.booking_date = booking.booking_date
                  and active_booking.status not in ('cancelled', 'discontinued', 'voided')) as "activeNormalCount",
              count(consumption.id) filter (where consumption.released_at is null)::text as "activeConsumptionCount",
              count(consumption.id)::text as "totalConsumptionCount",
              max(consumption.release_reason) as "releaseReason"
         from appointments_v2.bookings booking
         left join appointments_v2.special_quota_consumptions consumption on consumption.booking_id = booking.id
        where booking.id = $1
        group by booking.id`,
      [bookingId]
    );
    assert.equal(lifecycle.rows[0]?.status, "discontinued");
    assert.equal(Number(lifecycle.rows[0]?.activeNormalCount), 0);
    assert.equal(Number(lifecycle.rows[0]?.activeConsumptionCount), 0);
    assert.equal(Number(lifecycle.rows[0]?.totalConsumptionCount), 1);
    assert.equal(lifecycle.rows[0]?.releaseReason, "discontinued");

    const reactivate = await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
      method: "POST",
      body: { status: "scheduled" },
    });
    assert.equal(reactivate.status, 409);

    const replacement = await createBooking({
      patientId: await createPatient(),
      bookingDate: date,
      caseCategory: "non_oncology",
      capacityResolutionMode: "special_quota_extra",
      specialReasonCode: "urgent_oncology",
    });
    assert.equal(replacement.status, 201);
  });
});
