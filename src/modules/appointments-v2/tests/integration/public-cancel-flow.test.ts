import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import {
  canReachDatabase,
  createTestApp,
  createTestAuthCookie,
  fetchJson,
  isDatabaseAvailable,
  seedTestData,
  setupTestDatabase,
  type TestData,
} from "./helpers.js";
import { issueLegacyPublicCancelToken, issuePublicCancelToken } from "../../public/utils/public-cancel-token.js";

const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "PUBCANCEL_";
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

describe("Public appointment cancellation flow", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;
  let originalSecret: string | undefined;
  let originalServiceUserId: string | undefined;
  let restoreWeekendAppointmentSettings: (() => Promise<void>) | undefined;

  before(async () => {
    if (!(await canReachDatabase())) {
      console.warn("WARNING: Database is not reachable. Skipping public cancellation integration tests.");
      return;
    }

    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    restoreWeekendAppointmentSettings = await enableWeekendAppointmentsForSuite(testData.userId);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");

    originalSecret = process.env.APPOINTMENT_PUBLIC_TOKEN_SECRET;
    originalServiceUserId = process.env.APPOINTMENT_PUBLIC_CANCEL_USER_ID;
    process.env.APPOINTMENT_PUBLIC_TOKEN_SECRET = "integration-public-cancel-secret";
    process.env.APPOINTMENT_PUBLIC_CANCEL_USER_ID = String(testData.userId);
  });

  after(async () => {
    if (originalSecret == null) {
      delete process.env.APPOINTMENT_PUBLIC_TOKEN_SECRET;
    } else {
      process.env.APPOINTMENT_PUBLIC_TOKEN_SECRET = originalSecret;
    }

    if (originalServiceUserId == null) {
      delete process.env.APPOINTMENT_PUBLIC_CANCEL_USER_ID;
    } else {
      process.env.APPOINTMENT_PUBLIC_CANCEL_USER_ID = originalServiceUserId;
    }

    await restoreWeekendAppointmentSettings?.();
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
  });

  function guard(): void {
    if (!testData || !app) {
      throw new Error("Test setup failed — database unreachable");
    }
  }

  async function bookingDateFromToday(offsetDays: number): Promise<string> {
    const result = await pool.query<{ booking_date: string }>(
      `select (current_date + $1::int)::date::text as booking_date`,
      [offsetDays]
    );
    const bookingDate = result.rows[0]?.booking_date;
    assert.ok(bookingDate);
    return bookingDate;
  }

  let nextBookingDateOffset = 30;

  async function nextBookingDate(): Promise<string> {
    const bookingDate = await bookingDateFromToday(nextBookingDateOffset);
    nextBookingDateOffset += 1;
    return bookingDate;
  }

  async function createPatient(label: string, nationalIdPrefix: string = "2"): Promise<number> {
    guard();
    const uniqueNationalId = `${nationalIdPrefix}${Date.now().toString().slice(-11)}`;
    const result = await pool.query<{ id: number }>(
      `
        insert into patients (
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
        values ($1, $2, $3, $4, 'M', 30, '0912345678', 'national_id', $5)
        returning id
      `,
      [
        `${TEST_PREFIX}${label} مريض`,
        `${TEST_PREFIX}${label} Patient`,
        uniqueNationalId,
        `${label}مريض`,
        uniqueNationalId,
      ]
    );
    return Number(result.rows[0]?.id);
  }

  async function createBooking(bookingDate: string, patientId: number = testData.patientId): Promise<number> {
    guard();
    const createResult = await fetchJson<{ booking: { id: number | string } }>(app.baseUrl, "/api/v2/appointments", {
      method: "POST",
      cookie: authCookie,
      body: {
        patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        reportingPriorityId: 1,
        bookingDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });

    assert.equal(createResult.status, 201);
    return Number(createResult.data.booking.id);
  }

  async function createAlternateExamType(): Promise<number> {
    guard();
    const result = await pool.query<{ id: number }>(
      `
        insert into exam_types (modality_id, name_ar, name_en, code, is_active)
        values ($1, $2, $3, $4, true)
        returning id
      `,
      [
        testData.modalityId,
        `${TEST_PREFIX}اشعة بديلة`,
        `${TEST_PREFIX} Alternate CT Chest`,
        `${TEST_PREFIX}${Date.now()}ALT`,
      ]
    );
    return Number(result.rows[0]?.id);
  }

  async function readPublicPreview(token: string): Promise<{ status: number; data: { preview: Record<string, unknown>; otherAppointments?: Record<string, unknown>[] } }> {
    return fetchJson<{ preview: Record<string, unknown>; otherAppointments?: Record<string, unknown>[] }>(
      app.baseUrl,
      `/api/public/appointments/cancel-preview?t=${encodeURIComponent(token)}`
    );
  }

  async function updatePatientQrConfig(patch: Record<string, unknown>): Promise<void> {
    await pool.query(
      `
      update system_settings
      set setting_value = jsonb_set(
        coalesce(setting_value, '{}'::jsonb),
        '{value}',
        coalesce(setting_value->'value', '{}'::jsonb) || $1::jsonb,
        true
      )
      where category = 'patient_qr_self_service'
        and setting_key = 'config'
      `,
      [JSON.stringify(patch)]
    );
  }

  async function withSonicDicomConfig(config: Record<string, unknown>, work: () => Promise<void>): Promise<void> {
    const stored = await pool.query<{ setting_value: unknown; updated_by_user_id: number | null }>(
      `select setting_value, updated_by_user_id from system_settings where category = 'sonicdicom_reports' and setting_key = 'config' limit 1`
    );
    const original = stored.rows[0] ?? null;
    await pool.query(
      `insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
       values ('sonicdicom_reports', 'config', $1::jsonb, $2)
       on conflict (category, setting_key) do update
       set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`,
      [JSON.stringify({ value: config }), testData.userId]
    );
    try {
      await work();
    } finally {
      if (original) {
        await pool.query(
          `update system_settings set setting_value = $1::jsonb, updated_by_user_id = $2, updated_at = now()
           where category = 'sonicdicom_reports' and setting_key = 'config'`,
          [JSON.stringify(original.setting_value), original.updated_by_user_id]
        );
      } else {
        await pool.query(`delete from system_settings where category = 'sonicdicom_reports' and setting_key = 'config'`);
      }
    }
  }

  it("returns preview for a valid token", async () => {
    const bookingId = await createBooking(await nextBookingDate());
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);

    const response = await fetchJson<{ preview: Record<string, unknown> }>(
      app.baseUrl,
      `/api/public/appointments/cancel-preview?t=${encodeURIComponent(token as string)}`
    );

    assert.equal(response.status, 200);
    assert.equal(Number(response.data.preview.bookingId), bookingId);
    assert.equal(String(response.data.preview.currentStatus), "scheduled");
    assert.ok(String(response.data.preview.modalityName).length > 0);
  });

  it("ensures public tokens and returns only public-safe appointments for the same patient", async () => {
    const samePatientId = await createPatient("PublicSafeSame", "2");
    const currentBookingDate = await nextBookingDate();
    const samePatientOtherDate = await nextBookingDate();
    const samePatientNoTokenDate = await nextBookingDate();
    const samePatientVoidedDate = await nextBookingDate();
    const samePatientRevokedDate = await nextBookingDate();
    const otherPatientDate = await nextBookingDate();
    const currentBookingId = await createBooking(currentBookingDate, samePatientId);
    const samePatientOtherId = await createBooking(samePatientOtherDate, samePatientId);
    const samePatientNoTokenId = await createBooking(samePatientNoTokenDate, samePatientId);
    const samePatientVoidedId = await createBooking(samePatientVoidedDate, samePatientId);
    const samePatientRevokedId = await createBooking(samePatientRevokedDate, samePatientId);

    const otherPatientId = await createPatient("Other", "3");
    const otherPatientBooking = await fetchJson<{ booking: { id: number | string } }>(app.baseUrl, "/api/v2/appointments", {
      method: "POST",
      cookie: authCookie,
      body: {
        patientId: otherPatientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        reportingPriorityId: 1,
        bookingDate: otherPatientDate,
        caseCategory: "non_oncology",
        policySetKey: testData.policySetKey,
      },
    });
    assert.equal(otherPatientBooking.status, 201);

    const currentToken = await issuePublicCancelToken(currentBookingId);
    const samePatientOtherToken = await issuePublicCancelToken(samePatientOtherId);
    const samePatientVoidedToken = await issuePublicCancelToken(samePatientVoidedId);
    const samePatientRevokedToken = await issuePublicCancelToken(samePatientRevokedId);
    const otherPatientToken = await issuePublicCancelToken(Number(otherPatientBooking.data.booking.id));
    assert.ok(currentToken);
    assert.ok(samePatientOtherToken);
    assert.ok(samePatientVoidedToken);
    assert.ok(samePatientRevokedToken);
    assert.ok(otherPatientToken);

    await pool.query(`update appointments_v2.bookings set status = 'voided', voided_at = now() where id = $1`, [samePatientVoidedId]);
    await pool.query(`update appointments_v2.public_appointment_tokens set revoked_at = now() where booking_id = $1`, [samePatientRevokedId]);
    const tokenBeforePreview = await pool.query<{ count: string }>(
      `select count(*)::text as count from appointments_v2.public_appointment_tokens where booking_id = $1`,
      [samePatientNoTokenId]
    );
    assert.equal(tokenBeforePreview.rows[0]?.count, "0");

    const response = await readPublicPreview(currentToken);
    const generatedToken = await pool.query<{ token: string }>(
      `select token from appointments_v2.public_appointment_tokens where booking_id = $1 and revoked_at is null`,
      [samePatientNoTokenId]
    );

    assert.equal(response.status, 200);
    assert.ok(generatedToken.rows[0]?.token);
    assert.deepEqual(
      response.data.otherAppointments ?? [],
      [
        {
          date: samePatientOtherDate,
          time: "",
          modality: String(response.data.otherAppointments?.[0]?.modality),
          examName: String(response.data.otherAppointments?.[0]?.examName),
          status: "scheduled",
          publicUrl: `https://rispro.nccb.com.ly/public/appointment?t=${samePatientOtherToken}`,
          canCancel: true,
        },
        {
          date: samePatientNoTokenDate,
          time: "",
          modality: String(response.data.otherAppointments?.[1]?.modality),
          examName: String(response.data.otherAppointments?.[1]?.examName),
          status: "scheduled",
          publicUrl: `https://rispro.nccb.com.ly/public/appointment?t=${generatedToken.rows[0]?.token}`,
          canCancel: true,
        },
      ]
    );

    const otherAppointments = response.data.otherAppointments ?? [];
    const exposedBookingIds = [
      Number(response.data.preview.bookingId),
      ...otherAppointments
        .map((appointment) => Number((appointment as Record<string, unknown>).bookingId))
        .filter((id) => Number.isFinite(id)),
    ];
    assert.deepEqual(exposedBookingIds, [currentBookingId]);
    assert.equal((response.data.otherAppointments ?? []).some((appointment) => String(appointment.publicUrl || "").includes(currentToken)), false);
    assert.equal(exposedBookingIds.includes(samePatientNoTokenId), false);
    assert.equal(exposedBookingIds.includes(samePatientVoidedId), false);
    assert.equal(exposedBookingIds.includes(samePatientRevokedId), false);
    assert.equal(exposedBookingIds.includes(Number(otherPatientBooking.data.booking.id)), false);
    const serialized = JSON.stringify(response.data);
    for (const sensitiveKey of ["nationalId", "national_id", "phone", "accession", "studyInstanceUid", "study_instance_uid", "notes"]) {
      assert.equal(serialized.includes(sensitiveKey), false, `${sensitiveKey} should not be exposed`);
    }
  });

  it("keeps the original QR token valid after reschedule and exam type change", async () => {
    const initialBookingDate = await nextBookingDate();
    const rescheduledBookingDate = await nextBookingDate();
    const bookingId = await createBooking(initialBookingDate);
    const alternateExamTypeId = await createAlternateExamType();
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);

    const rescheduled = await fetchJson<{ booking: { id: number | string }; previousDate: string }>(
      app.baseUrl,
      `/api/v2/appointments/${bookingId}`,
      {
        method: "PUT",
        cookie: authCookie,
        body: {
          bookingDate: rescheduledBookingDate,
          bookingTime: "13:30",
          policySetKey: testData.policySetKey,
        },
      }
    );
    assert.equal(rescheduled.status, 200);
    assert.equal(Number(rescheduled.data.booking.id), bookingId);

    const afterReschedule = await readPublicPreview(token);
    assert.equal(afterReschedule.status, 200);
    assert.equal(Number(afterReschedule.data.preview.bookingId), bookingId);
    assert.equal(afterReschedule.data.preview.bookingDate, rescheduledBookingDate);
    assert.equal(afterReschedule.data.preview.bookingTime, "13:30");

    const examTypeChanged = await fetchJson<{ booking: { id: number | string } }>(
      app.baseUrl,
      `/api/v2/appointments/${bookingId}`,
      {
        method: "PUT",
        cookie: authCookie,
        body: {
          bookingDate: rescheduledBookingDate,
          bookingTime: "13:30",
          examTypeId: alternateExamTypeId,
          policySetKey: testData.policySetKey,
        },
      }
    );
    assert.equal(examTypeChanged.status, 200);
    assert.equal(Number(examTypeChanged.data.booking.id), bookingId);

    const afterExamTypeChange = await readPublicPreview(token);
    assert.equal(afterExamTypeChange.status, 200);
    assert.equal(Number(afterExamTypeChange.data.preview.bookingId), bookingId);
    assert.equal(afterExamTypeChange.data.preview.bookingDate, rescheduledBookingDate);
    assert.equal(afterExamTypeChange.data.preview.bookingTime, "13:30");
    assert.equal(afterExamTypeChange.data.preview.examNameEn, `${TEST_PREFIX} Alternate CT Chest`);
  });

  it("continues blocking the original QR token when patient QR access is disabled", async () => {
    const bookingId = await createBooking(await nextBookingDate());
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);

    await updatePatientQrConfig({ enabled: false });
    try {
      const response = await fetchJson<{ details?: { code?: string } }>(
        app.baseUrl,
        `/api/public/appointments/cancel-preview?t=${encodeURIComponent(token)}`
      );

      assert.equal(response.status, 403);
      assert.equal(response.data.details?.code, "patient_qr_disabled");
    } finally {
      await updatePatientQrConfig({ enabled: true });
    }
  });

  it("expires the original QR token after the configured post-appointment validity window", async () => {
    const bookingId = await createBooking(await nextBookingDate());
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);

    await updatePatientQrConfig({ publicLinkValidityDays: 0 });
    try {
      await pool.query(
        `update appointments_v2.bookings set booking_date = current_date - interval '1 day' where id = $1`,
        [bookingId]
      );

      const response = await fetchJson<{ details?: { code?: string } }>(
        app.baseUrl,
        `/api/public/appointments/cancel-preview?t=${encodeURIComponent(token)}`
      );

      assert.equal(response.status, 401);
      assert.equal(response.data.details?.code, "expired_link");
    } finally {
      await updatePatientQrConfig({ publicLinkValidityDays: 14 });
    }
  });

  it("rejects token with invalid signature", async () => {
    const bookingId = await createBooking("2026-08-02");
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);

    const tamperedToken = `${token}x`;
    const response = await fetchJson<{ details?: { code?: string } }>(
      app.baseUrl,
      `/api/public/appointments/cancel-preview?t=${encodeURIComponent(tamperedToken)}`
    );

    assert.equal(response.status, 401);
    assert.equal(response.data.details?.code, "invalid_link");
  });

  it("rejects expired token", async () => {
    const bookingId = await createBooking("2026-08-03");
    const token = issueLegacyPublicCancelToken(bookingId, { expiresInSeconds: -1 });
    assert.ok(token);

    const response = await fetchJson<{ details?: { code?: string } }>(
      app.baseUrl,
      `/api/public/appointments/cancel-preview?t=${encodeURIComponent(token as string)}`
    );

    assert.equal(response.status, 401);
    assert.equal(response.data.details?.code, "expired_link");
  });

  it("rejects token with wrong action", async () => {
    const bookingId = await createBooking("2026-08-04");
    const token = issueLegacyPublicCancelToken(bookingId, { action: "reschedule" });
    assert.ok(token);

    const response = await fetchJson<{ details?: { code?: string } }>(
      app.baseUrl,
      `/api/public/appointments/cancel-preview?t=${encodeURIComponent(token as string)}`
    );

    assert.equal(response.status, 401);
    assert.equal(response.data.details?.code, "invalid_link");
  });

  it("cancels booking through public endpoint", async () => {
    const bookingId = await createBooking(await nextBookingDate());
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);

    const response = await fetchJson<{ ok: boolean; alreadyCancelled: boolean; status: string }>(
      app.baseUrl,
      `/api/public/appointments/cancel?t=${encodeURIComponent(token as string)}`,
      { method: "POST" }
    );

    assert.equal(response.status, 200);
    assert.equal(response.data.ok, true);
    assert.equal(response.data.alreadyCancelled, false);
    assert.equal(response.data.status, "cancelled");

    const statusCheck = await pool.query<{ status: string }>(
      `select status from appointments_v2.bookings where id = $1`,
      [bookingId]
    );
    assert.equal(statusCheck.rows[0]?.status, "cancelled");
  });

  it("returns already-cancelled result on repeated cancel", async () => {
    const bookingId = await createBooking(await nextBookingDate());
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);

    const first = await fetchJson<{ ok: boolean; alreadyCancelled: boolean }>(
      app.baseUrl,
      `/api/public/appointments/cancel?t=${encodeURIComponent(token as string)}`,
      { method: "POST" }
    );
    const second = await fetchJson<{ ok: boolean; alreadyCancelled: boolean; status: string }>(
      app.baseUrl,
      `/api/public/appointments/cancel?t=${encodeURIComponent(token as string)}`,
      { method: "POST" }
    );

    assert.equal(first.status, 200);
    assert.equal(first.data.alreadyCancelled, false);
    assert.equal(second.status, 200);
    assert.equal(second.data.ok, true);
    assert.equal(second.data.alreadyCancelled, true);
    assert.equal(second.data.status, "cancelled");
  });

  it("blocks report endpoints when report modality scope disallows booking modality", async () => {
    const bookingId = await createBooking(await nextBookingDate());
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);

    await updatePatientQrConfig({
      allowReportAccess: true,
      reportAccessModalityMode: "include",
      reportAccessModalityIds: [testData.modalityId + 1000],
    });

    const statusResponse = await fetchJson<{ state: string; canViewReport: boolean }>(
      app.baseUrl,
      `/api/public/appointments/report-status?t=${encodeURIComponent(token as string)}`
    );
    assert.equal(statusResponse.status, 200);
    assert.equal(statusResponse.data.state, "disabled");
    assert.equal(statusResponse.data.canViewReport, false);

    const openResponse = await fetchJson<{ details?: { code?: string } }>(
      app.baseUrl,
      `/api/public/appointments/report-open?t=${encodeURIComponent(token as string)}`
    );
    assert.equal(openResponse.status, 403);
    assert.equal(openResponse.data.details?.code, "report_access_modality_blocked");
  });

  it("blocks image-open when image modality scope disallows booking modality", async () => {
    const bookingId = await createBooking(await nextBookingDate());
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);

    await updatePatientQrConfig({
      allowImageAccess: true,
      imageAccessModalityMode: "exclude",
      imageAccessModalityIds: [testData.modalityId],
    });

    const imageOpen = await fetchJson<{ details?: { code?: string } }>(
      app.baseUrl,
      `/api/public/appointments/image-open?t=${encodeURIComponent(token as string)}`
    );
    assert.equal(imageOpen.status, 403);
    assert.equal(imageOpen.data.details?.code, "image_access_modality_blocked");
  });

  it("selects local and public SonicDICOM URLs for successful report-open and image-open routes", async () => {
    const bookingId = await createBooking(await nextBookingDate());
    const token = await issuePublicCancelToken(bookingId);
    assert.ok(token);
    await pool.query(
      `update appointments_v2.bookings
       set status = 'completed', completed_at = now(), requires_report = true
       where id = $1`,
      [bookingId]
    );
    await updatePatientQrConfig({
      enabled: true,
      allowReportAccess: true,
      allowImageAccess: true,
      reportAccessRequiresCompletedAppointment: true,
      imageAccessRequiresCompletedAppointment: true,
      imageAccessRequiresReportRequiredFlag: false,
      reportAccessModalityMode: "all",
      imageAccessModalityMode: "all",
    });

    const routes = await import("../../api/routes/public-appointments-cancel-routes.js");
    routes.__setPublicSonicDicomChecksForTest({
      reportStatus: async () => ({ state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: new Date().toISOString() }),
      studyExists: async () => ({ foundStudy: true }),
    });
    const originalTrustProxy = app.app.get("trust proxy");
    app.app.set("trust proxy", 1);
    try {
      await withSonicDicomConfig({
        sonicDicomReportsEnabled: true,
        sonicDicomPublicBaseUrl: "https://public-sonic.example/viewer",
        sonicDicomLocalBaseUrl: "http://192.168.1.30/viewer",
      }, async () => {
        const open = (path: string, publicHost?: string) => fetch(`${app.baseUrl}${path}`, {
          headers: publicHost ? { Host: "rispro-container:3000", "X-Forwarded-Host": publicHost } : undefined,
          redirect: "manual",
        });
        const reportLocal = await open(`/api/public/appointments/report-open?t=${encodeURIComponent(token)}`);
        assert.equal(reportLocal.status, 302);
        assert.match(reportLocal.headers.get("location") ?? "", /^http:\/\/192\.168\.1\.30\/viewer\/#\/report\?/);

        const reportPublic = await open(`/api/public/appointments/report-open?t=${encodeURIComponent(token)}`, "rispro.example.com");
        assert.equal(reportPublic.status, 302);
        assert.match(reportPublic.headers.get("location") ?? "", /^https:\/\/public-sonic\.example\/viewer\/#\/report\?/);

        const imageLocal = await open(`/api/public/appointments/image-open?t=${encodeURIComponent(token)}`);
        assert.equal(imageLocal.status, 302);
        assert.match(imageLocal.headers.get("location") ?? "", /^http:\/\/192\.168\.1\.30\/viewer\/#\/viewer\?/);

        const imagePublic = await open(`/api/public/appointments/image-open?t=${encodeURIComponent(token)}`, "ris.nccb.com.ly");
        assert.equal(imagePublic.status, 302);
        assert.match(imagePublic.headers.get("location") ?? "", /^https:\/\/public-sonic\.example\/viewer\/#\/viewer\?/);
      });
    } finally {
      app.app.set("trust proxy", originalTrustProxy);
      routes.__setPublicSonicDicomChecksForTest(null);
    }
  });
});
