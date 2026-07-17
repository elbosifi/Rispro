/**
 * Appointments V2 — Booking flow integration tests.
 *
 * Tests the full booking lifecycle against a real PostgreSQL database:
 * - Create booking
 * - List bookings
 * - Reschedule booking
 * - Cancel booking
 * - Status validation (reschedule/cancel guards)
 *
 * Requires DATABASE_URL or TEST_DATABASE_URL environment variable.
 * Tests are skipped (not failed) when the database is unreachable.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

// Synchronous skip check at module load time
const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "BOOKING_";
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

describe("Booking flow — integration tests", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;
  let restoreWeekendAppointmentSettings: (() => Promise<void>) | undefined;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database is not reachable. Skipping booking flow integration tests.");
      return;
    }
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    restoreWeekendAppointmentSettings = await enableWeekendAppointmentsForSuite(testData.userId);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");
  });

  after(async () => {
    if (!testData) return;
    await restoreWeekendAppointmentSettings?.();
    await app.close();
    await testDb.cleanup();
  });

  const fetch = (path: string, opts: Record<string, unknown> = {}) => {
    const { body: origBody, ...rest } = opts as Record<string, unknown> & { body?: unknown };
    if (path.includes("/api/v2/appointments")) {
      const body = origBody as Record<string, unknown> | undefined;
      if (body) {
        return fetchJson(app.baseUrl, path, {
          cookie: authCookie,
          ...rest,
          body: { ...body, policySetKey: testData.policySetKey },
        });
      }
    }
    return fetchJson(app.baseUrl, path, { cookie: authCookie, ...rest, ...(origBody !== undefined ? { body: origBody } : {}) });
  };

  /** Skip the remaining body of the test if setup failed */
  function guard() {
    if (!testData) throw new Error("Test setup failed — database unreachable");
  }

  async function createPatientForStatusTest(label: string): Promise<number> {
    const uniqueNationalId = `2${randomUUID().replace(/-/g, "").slice(0, 11)}`;
    const patientResult = await pool.query(
      `insert into patients (arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years, phone_1, identifier_type, identifier_value)
       values ($1, $2, $3, $4, 'M', 30, '0912345678', 'national_id', $5)
       returning id`,
      [
        `${TEST_PREFIX}${label} مريض اختبار`,
        `${TEST_PREFIX}${label} Test Patient`,
        uniqueNationalId,
        `${TEST_PREFIX}${label} مريض اختبار`,
        uniqueNationalId,
      ]
    );
    return Number(patientResult.rows[0].id);
  }

  async function createSimilarPatientsForIdentityTest(): Promise<{ firstPatientId: number; secondPatientId: number; firstIdentifier: string; searchTerm: string }> {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
    const searchTerm = `BOOKING_ Similar Patient ${suffix}`;
    const firstIdentifier = `3${randomUUID().replace(/-/g, "").slice(0, 11)}`;
    const secondIdentifier = `4${randomUUID().replace(/-/g, "").slice(0, 11)}`;
    const result = await pool.query<{ id: number }>(
      `insert into patients (
        arabic_full_name, english_full_name, national_id, normalized_arabic_name,
        sex, age_years, estimated_date_of_birth, demographics_estimated, phone_1,
        identifier_type, identifier_value
      ) values
        ($1, $2, $3::varchar, $4, 'M', 30, '1995-01-02', false, '0912345678', 'national_id', $3::text),
        ($5, $6, $7::varchar, $8, 'F', 31, '1994-01-02', false, '0912345679', 'national_id', $7::text)
      returning id`,
      [
        `مريض تشابه ${suffix} واحد`, `${searchTerm} One`, firstIdentifier, `مريض تشابه ${suffix} واحد`,
        `مريض تشابه ${suffix} اثنان`, `${searchTerm} Two`, secondIdentifier, `مريض تشابه ${suffix} اثنان`,
      ]
    );
    return { firstPatientId: Number(result.rows[0].id), secondPatientId: Number(result.rows[1].id), firstIdentifier, searchTerm };
  }

  async function createBookingForStatusTest(date: string, patientId: number = testData.patientId): Promise<number> {
    const createResult = await fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: date,
        bookingTime: null,
        caseCategory: "non_oncology",
        notes: "Status timestamp integration test",
      },
    });
    assert.equal(createResult.status, 201);
    return Number(((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id);
  }

  async function readWorkflowTimestamps(bookingId: number) {
    const result = await pool.query<{
      status: string;
      arrived_at: Date | null;
      waiting_started_at: Date | null;
      completed_at: Date | null;
    }>(
      `
        select status, arrived_at, waiting_started_at, completed_at
        from appointments_v2.bookings
        where id = $1
      `,
      [bookingId]
    );
    const row = result.rows[0];
    assert.ok(row, `booking ${bookingId} should exist`);
    return row;
  }

  describe("Create booking", () => {
    it("requires a scoped non-name verification proof for an ambiguous patient and records safe audit metadata", async () => {
      guard();
      const similar = await createSimilarPatientsForIdentityTest();
      // Search by this patient's identifier so the similarly named record is not in the visible result set.
      const search = await fetch(`/api/v2/appointments/patient-selection/search?q=${encodeURIComponent(similar.firstIdentifier)}`);
      assert.equal(search.status, 200);
      const rows = (search.data as { patients: Array<Record<string, unknown>> }).patients;
      const selected = rows.find((row) => Number(row.id) === similar.firstPatientId);
      assert.equal(selected?.identityRisk, "ambiguous");
      assert.equal(selected?.similarPatientCount, 1);
      assert.equal(selected?.maskedPrimaryIdentifier, `••••${similar.firstIdentifier.slice(-4)}`);
      assert.equal(JSON.stringify(selected).includes(similar.firstIdentifier), false);

      const bookingPayload = {
        patientId: similar.firstPatientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: "2026-06-07",
        bookingTime: null,
        caseCategory: "non_oncology",
      };
      const missingProof = await fetch("/api/v2/appointments", { method: "POST", body: bookingPayload });
      assert.equal(missingProof.status, 422);
      assert.match(JSON.stringify(missingProof.data), /patient_identity_verification_required/);

      const verification = await fetch(`/api/v2/appointments/patient-selection/${similar.firstPatientId}/verify`, {
        method: "POST",
        body: { method: "primary_identifier", evidence: similar.firstIdentifier },
      });
      assert.equal(verification.status, 200);
      const proof = (verification.data as { proof?: unknown }).proof;
      assert.equal(typeof proof, "string");

      const created = await fetch("/api/v2/appointments", {
        method: "POST",
        body: { ...bookingPayload, patientIdentityVerificationProof: proof },
      });
      assert.equal(created.status, 201);

      const audit = await pool.query<{ action_type: string; new_values: unknown }>(
        `select action_type, new_values from audit_log
         where entity_type = 'appointment_patient_identity' and entity_id = $1
         order by id asc`,
        [similar.firstPatientId]
      );
      assert.ok(audit.rows.some((row) => row.action_type === "appointment_patient_identity_verification_rejected"));
      assert.ok(audit.rows.some((row) => row.action_type === "appointment_patient_identity_verified"));
      assert.equal(JSON.stringify(audit.rows).includes(similar.firstIdentifier), false);
    });

    it("should create a booking successfully", async () => {
      guard();
      const { status, data } = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          reportingPriorityId: 1,
          bookingDate: "2026-05-01",
          bookingTime: null,
          caseCategory: "non_oncology",
          notes: "Integration test booking",
        },
      });

      assert.equal(status, 201);
      const response = data as Record<string, unknown>;
      assert.ok(typeof response.booking === "object");
      const booking = response.booking as Record<string, unknown>;
      // pg returns bigint as string — accept either
      const bookingId = Number(booking.id);
      assert.ok(!isNaN(bookingId), "booking.id should be numeric");
      assert.equal(Number(booking.patientId), testData.patientId);
      assert.equal(Number(booking.modalityId), testData.modalityId);
      assert.equal(booking.bookingDate, "2026-05-01");
      assert.equal(booking.caseCategory, "non_oncology");
      assert.equal(booking.status, "scheduled");
      assert.equal(booking.notes, "Integration test booking");
    });

    it("should reject booking without required fields", async () => {
      guard();
      const { status } = await fetch("/api/v2/appointments", {
        method: "POST",
        body: { patientId: testData.patientId },
      });
      assert.equal(status, 400);
    });

    it("should reject booking with invalid modality", async () => {
      guard();
      const { status } = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: 99999,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-01",
          caseCategory: "non_oncology",
        },
      });
      assert.equal(status, 400);
    });

    it("should return print/details payload for a V2 booking", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          reportingPriorityId: 1,
          bookingDate: "2026-05-03",
          bookingTime: null,
          caseCategory: "non_oncology",
          notes: "Integration test details payload",
        },
      });

      assert.equal(createResult.status, 201);
      const booking = (createResult.data as Record<string, unknown>).booking as Record<string, unknown>;
      const bookingId = Number(booking.id);
      assert.ok(!isNaN(bookingId), "booking.id should be numeric");

      const { status, data } = await fetch(`/api/v2/appointments/${bookingId}/details`);
      assert.equal(status, 200);

      const response = data as Record<string, unknown>;
      const appointment = response.appointment as Record<string, unknown>;
      assert.equal(Number(appointment.id), bookingId);
      assert.equal(appointment.accession_number, `V2-${String(bookingId).padStart(6, "0")}`);
      assert.equal(appointment.appointment_date, "2026-05-03");
      assert.equal(Number(appointment.patient_id), testData.patientId);
      assert.equal(Number(appointment.modality_id), testData.modalityId);
      assert.equal(Number(appointment.exam_type_id), testData.examTypeId);
      assert.equal(appointment.status, "scheduled");
    });
  });

  describe("Workflow timestamps", () => {
    it("manual scheduled to arrived stores arrived_at", async () => {
      guard();
      const bookingId = await createBookingForStatusTest("2026-06-13");

      const statusRes = await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
        method: "POST",
        body: { status: "arrived" },
      });

      assert.equal(statusRes.status, 200);
      const row = await readWorkflowTimestamps(bookingId);
      assert.equal(row.status, "arrived");
      assert.ok(row.arrived_at, "arrived_at should be stored");
      assert.equal(row.waiting_started_at, null);
      assert.equal(row.completed_at, null);
    });

    it("manual scheduled to waiting stores arrived_at and waiting_started_at", async () => {
      guard();
      const bookingId = await createBookingForStatusTest("2026-06-14");

      const statusRes = await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
        method: "POST",
        body: { status: "waiting" },
      });

      assert.equal(statusRes.status, 200);
      const row = await readWorkflowTimestamps(bookingId);
      assert.equal(row.status, "waiting");
      assert.ok(row.arrived_at, "arrived_at should be stored");
      assert.ok(row.waiting_started_at, "waiting_started_at should be stored");
      assert.equal(row.completed_at, null);
    });

    it("manual waiting to completed stores completed_at", async () => {
      guard();
      const bookingId = await createBookingForStatusTest("2026-06-15");
      assert.equal((await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
        method: "POST",
        body: { status: "waiting" },
      })).status, 200);

      const statusRes = await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
        method: "POST",
        body: { status: "completed" },
      });

      assert.equal(statusRes.status, 200);
      const row = await readWorkflowTimestamps(bookingId);
      assert.equal(row.status, "completed");
      assert.ok(row.arrived_at, "existing arrived_at should remain available");
      assert.ok(row.waiting_started_at, "existing waiting_started_at should remain available");
      assert.ok(row.completed_at, "completed_at should be stored");
    });

    it("manual close statuses preserve existing workflow timestamps", async () => {
      guard();
      for (const targetStatus of ["no-show", "discontinued"] as const) {
        const patientId = targetStatus === "no-show"
          ? await createPatientForStatusTest("NoShowTimestamp")
          : testData.patientId;
        const bookingId = await createBookingForStatusTest(
          `2026-06-${targetStatus === "no-show" ? "20" : "21"}`,
          patientId
        );
        assert.equal((await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
          method: "POST",
          body: { status: "waiting" },
        })).status, 200);
        const before = await readWorkflowTimestamps(bookingId);

        const statusRes = await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
          method: "POST",
          body: {
            status: targetStatus,
            reason: "Workflow timestamp preservation test",
          },
        });

        assert.equal(statusRes.status, 200);
        const after = await readWorkflowTimestamps(bookingId);
        assert.equal(after.status, targetStatus);
        assert.deepEqual(after.arrived_at, before.arrived_at);
        assert.deepEqual(after.waiting_started_at, before.waiting_started_at);
        assert.deepEqual(after.completed_at, before.completed_at);
      }
    });

    it("generic manual status path rejects cancellation", async () => {
      guard();
      const bookingId = await createBookingForStatusTest("2026-06-19");
      assert.equal((await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
        method: "POST",
        body: { status: "waiting" },
      })).status, 200);

      const statusRes = await fetch(`/api/v2/read/appointments/${bookingId}/status`, {
        method: "POST",
        body: {
          status: "cancelled",
          reason: "Workflow timestamp preservation test",
        },
      });

      assert.equal(statusRes.status, 403);
      assert.equal(
        (statusRes.data as Record<string, unknown>).error,
        "Appointment cancellation must use the dedicated cancellation workflow."
      );
    });
  });

  describe("Modality worklist workflow timestamps", () => {
    it("prefers bookings.arrived_at over audit-derived arrival time", async () => {
      guard();
      const bookingId = await createBookingForStatusTest("2026-06-16");
      await pool.query(
        `
          update appointments_v2.bookings
          set status = 'arrived', arrived_at = '2026-06-16T09:00:00Z'::timestamptz
          where id = $1
        `,
        [bookingId]
      );
      await pool.query(
        `
          insert into audit_log (entity_type, entity_id, action_type, old_values, new_values, changed_by_user_id, created_at)
          values ('appointment_v2_booking', $1, 'manual_status_change', '{"status":"scheduled"}'::jsonb, '{"status":"arrived"}'::jsonb, $2, '2026-06-16T08:00:00Z'::timestamptz)
        `,
        [bookingId, testData.userId]
      );

      const modalityRes = await fetch(`/api/v2/read/modality/worklist?modalityId=${testData.modalityId}&scope=all`);

      assert.equal(modalityRes.status, 200);
      const rows = (modalityRes.data as Record<string, unknown>).appointments as Array<Record<string, unknown>>;
      const row = rows.find((entry) => Number(entry.id) === bookingId);
      assert.equal(row?.arrived_at, "2026-06-16T09:00:00.000Z");
    });

    it("falls back to audit-derived arrived_at only when bookings.arrived_at is null", async () => {
      guard();
      const bookingId = await createBookingForStatusTest("2026-06-17");
      await pool.query(
        `update appointments_v2.bookings set status = 'arrived', arrived_at = null where id = $1`,
        [bookingId]
      );
      await pool.query(
        `
          insert into audit_log (entity_type, entity_id, action_type, old_values, new_values, changed_by_user_id, created_at)
          values ('appointment_v2_booking', $1, 'manual_status_change', '{"status":"scheduled"}'::jsonb, '{"status":"arrived"}'::jsonb, $2, '2026-06-17T08:15:00Z'::timestamptz)
        `,
        [bookingId, testData.userId]
      );

      const modalityRes = await fetch(`/api/v2/read/modality/worklist?modalityId=${testData.modalityId}&scope=all`);

      assert.equal(modalityRes.status, 200);
      const rows = (modalityRes.data as Record<string, unknown>).appointments as Array<Record<string, unknown>>;
      const row = rows.find((entry) => Number(entry.id) === bookingId);
      assert.equal(row?.arrived_at, "2026-06-17T08:15:00.000Z");
    });

    it("keeps scheduled rows without arrival at null", async () => {
      guard();
      const bookingId = await createBookingForStatusTest("2026-06-18");

      const modalityRes = await fetch(`/api/v2/read/modality/worklist?modalityId=${testData.modalityId}&scope=all`);

      assert.equal(modalityRes.status, 200);
      const rows = (modalityRes.data as Record<string, unknown>).appointments as Array<Record<string, unknown>>;
      const row = rows.find((entry) => Number(entry.id) === bookingId);
      assert.equal(row?.status, "scheduled");
      assert.equal(row?.arrived_at, null);
    });
  });

  describe("List bookings", () => {
    before(async () => {
      guard();
      await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-10",
          caseCategory: "non_oncology",
          notes: "Test booking for listing",
        },
      });
    });

    it("should list bookings for a modality within date range", async () => {
      guard();
      const { status, data } = await fetch(
        `/api/v2/appointments?modalityId=${testData.modalityId}&dateFrom=2026-05-01&dateTo=2026-05-31`
      );

      assert.equal(status, 200);
      const response = data as Record<string, unknown>;
      assert.ok(Array.isArray(response.bookings));
      assert.ok((response.bookings as unknown[]).length > 0);

      const booking = (response.bookings as Record<string, unknown>[])[0];
      assert.equal(Number(booking.modalityId), testData.modalityId);
      assert.ok(["scheduled", "arrived", "waiting", "completed", "discontinued", "no-show"].includes(booking.status as string));
    });

    it("should exclude cancelled bookings by default", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-15",
          caseCategory: "non_oncology",
        },
      });

      const bookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
      await fetch(`/api/v2/appointments/${bookingId}/cancel`, { method: "POST" });

      const { data: listData } = await fetch(
        `/api/v2/appointments?modalityId=${testData.modalityId}&dateFrom=2026-05-01&dateTo=2026-05-31`
      );

      const bookings = (listData as Record<string, unknown>).bookings as Record<string, unknown>[];
      const cancelledBookings = bookings.filter((b) => b.status === "cancelled");
      assert.equal(cancelledBookings.length, 0);
    });

    it("should include cancelled bookings when includeCancelled=true", async () => {
      guard();
      const { data } = await fetch(
        `/api/v2/appointments?modalityId=${testData.modalityId}&dateFrom=2026-05-01&dateTo=2026-05-31&includeCancelled=true`
      );

      const response = data as Record<string, unknown>;
      const cancelledBookings = (response.bookings as Record<string, unknown>[]).filter(
        (b) => b.status === "cancelled"
      );
      assert.ok(cancelledBookings.length > 0);
    });
  });

  describe("Reschedule booking", () => {
    let bookingId: number;

    before(async () => {
      guard();
      const { data } = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-20",
          caseCategory: "non_oncology",
          notes: "Booking to reschedule",
        },
      });
      bookingId = ((data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
    });

    it("should reschedule a booking to a new date", async () => {
      guard();
      const { status, data } = await fetch(`/api/v2/appointments/${bookingId}`, {
        method: "PUT",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-25",
          bookingTime: null,
          caseCategory: "non_oncology",
          notes: "Rescheduled booking",
        },
      });

      assert.equal(status, 200);
      const result = data as Record<string, unknown>;
      const newBooking = result.booking as Record<string, unknown>;
      // pg returns bigint as string — accept either number or string
      const newId = Number(newBooking.id);
      assert.ok(!isNaN(newId), "booking.id should be numeric");
      assert.notEqual(newId, bookingId);
      assert.equal(String(newBooking.bookingDate), "2026-05-25");
      assert.equal(newBooking.status, "scheduled");
      assert.equal(result.previousDate, "2026-05-20");
    });

    it("should reject rescheduling a cancelled booking", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-21",
          caseCategory: "non_oncology",
        },
      });

      const cancelledBookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
      await fetch(`/api/v2/appointments/${cancelledBookingId}/cancel`, { method: "POST" });

      const { status } = await fetch(`/api/v2/appointments/${cancelledBookingId}`, {
        method: "PUT",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-26",
          caseCategory: "non_oncology",
        },
      });
      assert.equal(status, 409);
    });

    it("should reject rescheduling a completed booking", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-22",
          caseCategory: "non_oncology",
        },
      });

      const completedBookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
      const { pool } = await import("../../../../db/pool.js");
      await pool.query(`update appointments_v2.bookings set status = 'completed' where id = $1`, [completedBookingId]);

      const { status } = await fetch(`/api/v2/appointments/${completedBookingId}`, {
        method: "PUT",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-27",
          caseCategory: "non_oncology",
        },
      });
      assert.equal(status, 409);
    });
  });

  describe("Cancel booking", () => {
    let bookingId: number;

    before(async () => {
      guard();
      const { data } = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-28",
          caseCategory: "non_oncology",
          notes: "Booking to cancel",
        },
      });
      bookingId = ((data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
    });

    it("should cancel a booking successfully", async () => {
      guard();
      const { status, data } = await fetch(`/api/v2/appointments/${bookingId}/cancel`, { method: "POST" });

      assert.equal(status, 200);
      const result = data as Record<string, unknown>;
      const booking = result.booking as Record<string, unknown>;
      assert.equal(booking.id, bookingId);
      assert.equal(booking.status, "cancelled");
      assert.equal(result.previousStatus, "scheduled");
    });

    it("void endpoint should require a reason", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-28",
          caseCategory: "non_oncology",
          notes: "Booking to void without reason",
        },
      });
      const localBookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;

      const { status } = await fetch(`/api/v2/appointments/${localBookingId}/void`, {
        method: "POST",
        body: { voidReason: "  " },
      });
      assert.equal(status, 400);
    });

    it("void endpoint should mark scheduled booking as voided", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-28",
          caseCategory: "non_oncology",
          notes: "Booking to void",
        },
      });
      const localBookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;

      const { status, data } = await fetch(`/api/v2/appointments/${localBookingId}/void`, {
        method: "POST",
        body: { voidReason: "Wrong date entered" },
      });
      assert.equal(status, 200);
      const result = data as Record<string, unknown>;
      const booking = result.booking as Record<string, unknown>;
      assert.equal(booking.status, "voided");
      assert.equal(result.previousStatus, "scheduled");
    });

    it("should reject cancelling an already cancelled booking", async () => {
      guard();
      const { status } = await fetch(`/api/v2/appointments/${bookingId}/cancel`, { method: "POST" });
      assert.equal(status, 409);
    });

    it("should reject cancelling a completed booking", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-29",
          caseCategory: "non_oncology",
        },
      });

      const completedBookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
      const { pool } = await import("../../../../db/pool.js");
      await pool.query(`update appointments_v2.bookings set status = 'completed' where id = $1`, [completedBookingId]);

      const { status } = await fetch(`/api/v2/appointments/${completedBookingId}/cancel`, { method: "POST" });
      assert.equal(status, 409);
    });

    it("should reject cancelling a no-show booking", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-30",
          caseCategory: "non_oncology",
        },
      });

      const noShowBookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
      const { pool } = await import("../../../../db/pool.js");
      await pool.query(`update appointments_v2.bookings set status = 'no-show' where id = $1`, [noShowBookingId]);

      const { status } = await fetch(`/api/v2/appointments/${noShowBookingId}/cancel`, { method: "POST" });
      assert.equal(status, 409);
    });
  });

  describe("Void guards", () => {
    it("should allow receptionist, supervisor, and super_admin to void arrived or waiting bookings", async () => {
      guard();
      const { pool } = await import("../../../../db/pool.js");
      const cases = [
        { role: "receptionist", bookingStatus: "arrived" },
        { role: "supervisor", bookingStatus: "waiting" },
        { role: "super_admin", bookingStatus: "arrived" },
      ] as const;

      for (const testCase of cases) {
        const createResult = await fetch("/api/v2/appointments", {
          method: "POST",
          body: {
            patientId: testData.patientId,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: "2026-06-01",
            caseCategory: "non_oncology",
          },
        });
        const bookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
        await pool.query(`update appointments_v2.bookings set status = $2 where id = $1`, [
          bookingId,
          testCase.bookingStatus,
        ]);

        const { status, data } = await fetch(`/api/v2/appointments/${bookingId}/void`, {
          method: "POST",
          cookie: createTestAuthCookie(testData.userId, testCase.role),
          body: { voidReason: `${testCase.role} correction` },
        });

        assert.equal(status, 200);
        const booking = (data as Record<string, unknown>).booking as Record<string, unknown>;
        assert.equal(booking.status, "voided");
        assert.equal((data as Record<string, unknown>).previousStatus, testCase.bookingStatus);
      }
    });

    it("should reject doctor voiding arrived or waiting bookings", async () => {
      guard();
      const { pool } = await import("../../../../db/pool.js");

      for (const bookingStatus of ["arrived", "waiting"] as const) {
        const createResult = await fetch("/api/v2/appointments", {
          method: "POST",
          body: {
            patientId: testData.patientId,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: "2026-06-01",
            caseCategory: "non_oncology",
          },
        });
        const bookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
        await pool.query(`update appointments_v2.bookings set status = $2 where id = $1`, [bookingId, bookingStatus]);

        const { status } = await fetch(`/api/v2/appointments/${bookingId}/void`, {
          method: "POST",
          cookie: createTestAuthCookie(testData.userId, "doctor"),
          body: { voidReason: "Doctor correction" },
        });

        assert.equal(status, 403);
      }
    });

    it("should reject non-super-admin voiding completed/no-show/cancelled/discontinued/already-voided bookings", async () => {
      guard();
      const { pool } = await import("../../../../db/pool.js");
      const statuses = ["completed", "no-show", "cancelled", "discontinued", "voided"] as const;

      for (const statusToSet of statuses) {
        const createResult = await fetch("/api/v2/appointments", {
          method: "POST",
          body: {
            patientId: testData.patientId,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: "2026-06-02",
            caseCategory: "non_oncology",
          },
        });
        const bookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
        await pool.query(`update appointments_v2.bookings set status = $2 where id = $1`, [bookingId, statusToSet]);
        const { status } = await fetch(`/api/v2/appointments/${bookingId}/void`, {
          method: "POST",
          body: { voidReason: "Staff correction" },
        });
        assert.equal(status, 409);
      }
    });

    it("should allow super_admin to void any appointment status", async () => {
      guard();
      const { pool } = await import("../../../../db/pool.js");
      const statuses = ["completed", "no-show", "cancelled", "discontinued", "voided"] as const;

      for (const statusToSet of statuses) {
        const createResult = await fetch("/api/v2/appointments", {
          method: "POST",
          body: {
            patientId: testData.patientId,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: "2026-06-03",
            caseCategory: "non_oncology",
          },
        });
        const bookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
        await pool.query(`update appointments_v2.bookings set status = $2 where id = $1`, [bookingId, statusToSet]);

        const { status, data } = await fetch(`/api/v2/appointments/${bookingId}/void`, {
          method: "POST",
          cookie: createTestAuthCookie(testData.userId, "super_admin"),
          body: { voidReason: "Super admin correction" },
        });

        assert.equal(status, 200);
        const result = data as Record<string, unknown>;
        const booking = result.booking as Record<string, unknown>;
        assert.equal(booking.status, "voided");
        assert.equal(result.previousStatus, statusToSet);
      }
    });
  });

  describe("Active workflow exclusion", () => {
    it("voided bookings are excluded from read appointments default, queue, and modality worklist", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-06-10",
          caseCategory: "non_oncology",
          notes: "To be voided and excluded",
        },
      });
      const bookingId = Number(((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id);
      await fetch(`/api/v2/appointments/${bookingId}/void`, {
        method: "POST",
        body: { voidReason: "Duplicate entry" },
      });

      const readDefault = await fetch(`/api/v2/read/appointments?dateFrom=2026-06-10&dateTo=2026-06-10`);
      assert.equal(readDefault.status, 200);
      const readRows = (readDefault.data as Record<string, unknown>).appointments as Array<Record<string, unknown>>;
      assert.equal(readRows.some((row) => Number(row.id) === bookingId), false);

      const readExplicit = await fetch(`/api/v2/read/appointments?dateFrom=2026-06-10&dateTo=2026-06-10&status=voided`);
      assert.equal(readExplicit.status, 200);
      const readExplicitRows = (readExplicit.data as Record<string, unknown>).appointments as Array<Record<string, unknown>>;
      assert.equal(readExplicitRows.some((row) => Number(row.id) === bookingId), true);

      const queueRes = await fetch("/api/v2/read/queue");
      assert.equal(queueRes.status, 200);
      const queueRows = (queueRes.data as Record<string, unknown>).queue_entries as Array<Record<string, unknown>>;
      assert.equal(queueRows.some((row) => Number(row.appointment_id) === bookingId), false);

      const modalityRes = await fetch(`/api/v2/read/modality/worklist?modalityId=${testData.modalityId}&scope=all`);
      assert.equal(modalityRes.status, 200);
      const modalityRows = (modalityRes.data as Record<string, unknown>).appointments as Array<Record<string, unknown>>;
      assert.equal(modalityRows.some((row) => Number(row.id) === bookingId), false);
    });
  });

  describe("Public appointment URL resilience", () => {
    it("read appointments endpoints still return rows when PUBLIC_APP_BASE_URL is missing, with null public_appointment_url", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-06-11",
          caseCategory: "non_oncology",
          notes: "URL resilience test",
        },
      });
      const bookingId = Number(((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id);
      const { pool } = await import("../../../../db/pool.js");
      const previousSetting = await pool.query(
        `select setting_value from system_settings where category = 'patient_qr_self_service' and setting_key = 'config'`
      );
      const previousBaseUrl = process.env.PUBLIC_APP_BASE_URL;
      await pool.query(
        `
          update system_settings
          set setting_value = jsonb_build_object(
            'value',
            coalesce(setting_value->'value', '{}'::jsonb) || jsonb_build_object('risproPublicBaseUrl', '')
          )
          where category = 'patient_qr_self_service' and setting_key = 'config'
        `
      );
      process.env.PUBLIC_APP_BASE_URL = "";
      try {
        const readList = await fetch(`/api/v2/read/appointments?dateFrom=2026-06-11&dateTo=2026-06-11`);
        assert.equal(readList.status, 200);
        const readRows = (readList.data as Record<string, unknown>).appointments as Array<Record<string, unknown>>;
        const row = readRows.find((entry) => Number(entry.id) === bookingId);
        assert.ok(row, "created booking should still be present in read list");
        assert.equal(row?.public_appointment_url ?? null, null);

        const readDetails = await fetch(`/api/v2/read/appointments/${bookingId}`);
        assert.equal(readDetails.status, 200);
        const details = (readDetails.data as Record<string, unknown>).appointment as Record<string, unknown>;
        assert.equal(Number(details.id), bookingId);
        assert.equal(details.public_appointment_url ?? null, null);

        const queueRes = await fetch("/api/v2/read/queue");
        assert.equal(queueRes.status, 200);

        const modalityRes = await fetch(`/api/v2/read/modality/worklist?modalityId=${testData.modalityId}&scope=all`);
        assert.equal(modalityRes.status, 200);
      } finally {
        if (previousBaseUrl == null) {
          delete process.env.PUBLIC_APP_BASE_URL;
        } else {
          process.env.PUBLIC_APP_BASE_URL = previousBaseUrl;
        }
        if (previousSetting.rows[0]?.setting_value) {
          await pool.query(
            `update system_settings set setting_value = $1::jsonb where category = 'patient_qr_self_service' and setting_key = 'config'`,
            [JSON.stringify(previousSetting.rows[0].setting_value)]
          );
        }
      }
    });

    it("read appointments list still returns rows when PUBLIC_APP_BASE_URL is invalid", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-06-12",
          caseCategory: "non_oncology",
          notes: "Invalid URL resilience test",
        },
      });
      const bookingId = Number(((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id);
      const { pool } = await import("../../../../db/pool.js");
      const previousSetting = await pool.query(
        `select setting_value from system_settings where category = 'patient_qr_self_service' and setting_key = 'config'`
      );
      const previousBaseUrl = process.env.PUBLIC_APP_BASE_URL;
      await pool.query(
        `
          update system_settings
          set setting_value = jsonb_build_object(
            'value',
            coalesce(setting_value->'value', '{}'::jsonb) || jsonb_build_object('risproPublicBaseUrl', 'not-a-valid-absolute-url')
          )
          where category = 'patient_qr_self_service' and setting_key = 'config'
        `
      );
      process.env.PUBLIC_APP_BASE_URL = "https://rispro.nccb.com.ly";
      try {
        const readList = await fetch(`/api/v2/read/appointments?dateFrom=2026-06-12&dateTo=2026-06-12`);
        assert.equal(readList.status, 200);
        const readRows = (readList.data as Record<string, unknown>).appointments as Array<Record<string, unknown>>;
        const row = readRows.find((entry) => Number(entry.id) === bookingId);
        assert.ok(row, "created booking should still be present in read list");
        assert.equal(row?.public_appointment_url ?? null, null);
      } finally {
        if (previousBaseUrl == null) {
          delete process.env.PUBLIC_APP_BASE_URL;
        } else {
          process.env.PUBLIC_APP_BASE_URL = previousBaseUrl;
        }
        if (previousSetting.rows[0]?.setting_value) {
          await pool.query(
            `update system_settings set setting_value = $1::jsonb where category = 'patient_qr_self_service' and setting_key = 'config'`,
            [JSON.stringify(previousSetting.rows[0].setting_value)]
          );
        }
      }
    });
  });

  describe("Reschedule status guards", () => {
    it("should reject rescheduling a no-show booking", async () => {
      guard();
      const createResult = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-05-31",
          caseCategory: "non_oncology",
        },
      });

      const noShowBookingId = ((createResult.data as Record<string, unknown>).booking as Record<string, unknown>).id as number;
      const { pool } = await import("../../../../db/pool.js");
      await pool.query(`update appointments_v2.bookings set status = 'no-show' where id = $1`, [noShowBookingId]);

      const { status } = await fetch(`/api/v2/appointments/${noShowBookingId}`, {
        method: "PUT",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-06-01",
          caseCategory: "non_oncology",
        },
      });
      assert.equal(status, 409);
    });
  });

  describe("Capacity management", () => {
    it("should respect daily capacity limits", async () => {
      guard();
      // Use a unique date based on timestamp to avoid conflicts between test runs
      const capDate = `2027-01-${String(Date.now() % 28 + 1).padStart(2, '0')}`;
      for (let i = 1; i <= 5; i++) {
        const { status } = await fetch("/api/v2/appointments", {
          method: "POST",
          body: {
            patientId: testData.patientId,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: capDate,
            caseCategory: "non_oncology",
            notes: `Capacity test booking ${i}`,
          },
        });
        assert.equal(status, 201, `Booking ${i} should succeed`);
      }

      const { status } = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: capDate,
          caseCategory: "non_oncology",
          notes: "Capacity test booking 6 (should fail)",
        },
      });
      assert.equal(status, 409, "6th booking should fail due to capacity limit");
    });

    it("should free capacity when a booking is cancelled", async () => {
      guard();
      // Use a unique date to avoid conflicts between test runs
      const capDate = `2027-02-${String(Date.now() % 28 + 1).padStart(2, '0')}`;
      const ids: number[] = [];
      for (let i = 1; i <= 5; i++) {
        const { data } = await fetch("/api/v2/appointments", {
          method: "POST",
          body: {
            patientId: testData.patientId,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: capDate,
            caseCategory: "non_oncology",
            notes: `Free capacity booking ${i}`,
          },
        });
        ids.push(((data as Record<string, unknown>).booking as Record<string, unknown>).id as number);
      }

      // Cancel one
      await fetch(`/api/v2/appointments/${ids[0]}/cancel`, { method: "POST" });

      // Create another — should succeed since capacity freed
      const { status } = await fetch("/api/v2/appointments", {
        method: "POST",
        body: {
          patientId: testData.patientId,
          modalityId: testData.modalityId,
          examTypeId: testData.examTypeId,
          bookingDate: "2026-06-15",
          caseCategory: "non_oncology",
          notes: "Booking after cancel",
        },
      });
      assert.equal(status, 201);
    });
  });
});
