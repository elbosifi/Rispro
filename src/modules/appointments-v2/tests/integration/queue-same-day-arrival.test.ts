import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import { getTripoliToday } from "../../booking/services/status-booking.service.js";
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

const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "QUEUEARR_";

type BookingStatus = "scheduled" | "arrived" | "waiting" | "completed" | "no-show" | "cancelled" | "discontinued" | "voided";

describe("V2 queue same-day arrival", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database is not reachable. Skipping queue same-day arrival integration tests.");
      return;
    }
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    await pool.query(`update patients set phone_1 = '0910000000' where id = $1`, [testData.patientId]);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");
  });

  after(async () => {
    if (!testData) return;
    await app.close();
    await testDb.cleanup();
  });

  function guard() {
    if (!testData) throw new Error("Test setup failed - database unreachable");
  }

  async function createPatient(phone1: string | null = "0910000000"): Promise<number> {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const nationalId = `2${randomUUID().replace(/-/g, "").replace(/\D/g, "").padEnd(11, "0").slice(0, 11)}`;
    const result = await pool.query<{ id: string }>(
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
        values ($1, $2, $3, $4, 'M', 30, $5, 'national_id', $6)
        returning id::text
      `,
      [`${TEST_PREFIX}${suffix}مريض`, `${TEST_PREFIX}${suffix} Patient`, nationalId, `${TEST_PREFIX}${suffix}`, phone1, nationalId]
    );
    return Number(result.rows[0].id);
  }

  async function createBooking(patientId: number, bookingDate: string, status: BookingStatus = "scheduled"): Promise<number> {
    const result = await pool.query<{ id: string }>(
      `
        insert into appointments_v2.bookings (
          patient_id,
          modality_id,
          exam_type_id,
          booking_date,
          booking_time,
          case_category,
          status,
          policy_version_id,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, $2, $3, $4::date, null, 'non_oncology', $5, $6, $7, $7)
        returning id::text
      `,
      [patientId, testData.modalityId, testData.examTypeId, bookingDate, status, testData.policyVersionId, testData.userId]
    );
    return Number(result.rows[0].id);
  }

  async function scan(bookingId: number) {
    return fetchJson<Record<string, unknown>>(app.baseUrl, "/api/v2/read/queue/scan", {
      method: "POST",
      cookie: authCookie,
      body: { scanValue: `V2-${String(bookingId).padStart(6, "0")}` },
    });
  }

  async function statuses(ids: number[]): Promise<Record<number, string>> {
    const result = await pool.query<{ id: string; status: string }>(
      `select id::text, status from appointments_v2.bookings where id = any($1::bigint[])`,
      [ids]
    );
    return Object.fromEntries(result.rows.map((row) => [Number(row.id), row.status]));
  }

  async function arrivedTimestamps(ids: number[]): Promise<Record<number, boolean>> {
    const result = await pool.query<{ id: string; has_arrived_at: boolean }>(
      `select id::text, (arrived_at is not null) as has_arrived_at from appointments_v2.bookings where id = any($1::bigint[])`,
      [ids]
    );
    return Object.fromEntries(result.rows.map((row) => [Number(row.id), row.has_arrived_at]));
  }

  async function withPatientRegistrationRequirements(run: () => Promise<void>) {
    const existing = await pool.query<{ setting_key: string; setting_value: unknown }>(
      `
        select setting_key, setting_value
        from system_settings
        where category = 'patient_registration'
          and setting_key in ('phone1_required', 'national_id_required')
      `
    );
    const previous = new Map(existing.rows.map((row) => [row.setting_key, row.setting_value]));
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
        values
          ('patient_registration', 'phone1_required', '{"value":"required"}'::jsonb, $1),
          ('patient_registration', 'national_id_required', '{"value":"optional"}'::jsonb, $1)
        on conflict (category, setting_key)
        do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
      `,
      [testData.userId]
    );

    try {
      await run();
    } finally {
      for (const key of ["phone1_required", "national_id_required"]) {
        if (previous.has(key)) {
          await pool.query(
            `
              update system_settings
              set setting_value = $3::jsonb, updated_by_user_id = $4, updated_at = now()
              where category = $1 and setting_key = $2
            `,
            ["patient_registration", key, JSON.stringify(previous.get(key)), testData.userId]
          );
        } else {
          await pool.query(`delete from system_settings where category = $1 and setting_key = $2`, ["patient_registration", key]);
        }
      }
    }
  }

  function tomorrow(today: string): string {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  }

  it("marks two same-patient same-day scheduled bookings arrived", async () => {
    guard();
    const today = getTripoliToday();
    const patientId = await createPatient();
    const firstId = await createBooking(patientId, today, "scheduled");
    const secondId = await createBooking(patientId, today, "scheduled");

    const { status, data } = await scan(firstId);

    assert.equal(status, 200);
    assert.deepEqual((data.updatedBookingIds as number[]).sort((a, b) => a - b), [firstId, secondId].sort((a, b) => a - b));
    assert.deepEqual(await statuses([firstId, secondId]), { [firstId]: "arrived", [secondId]: "arrived" });
    assert.deepEqual(await arrivedTimestamps([firstId, secondId]), { [firstId]: true, [secondId]: true });
    assert.equal(data.sameDayAppointmentCount, 2);
    assert.equal(data.hasMultipleAppointments, true);
  });

  it("marks scheduled and waiting same-day siblings arrived", async () => {
    guard();
    const today = getTripoliToday();
    const patientId = await createPatient();
    const scheduledId = await createBooking(patientId, today, "scheduled");
    const waitingId = await createBooking(patientId, today, "waiting");

    const { status } = await scan(scheduledId);

    assert.equal(status, 200);
    assert.deepEqual(await statuses([scheduledId, waitingId]), { [scheduledId]: "arrived", [waitingId]: "arrived" });
  });

  it("includes already-arrived siblings without re-updating them", async () => {
    guard();
    const today = getTripoliToday();
    const patientId = await createPatient();
    const scheduledId = await createBooking(patientId, today, "scheduled");
    const arrivedId = await createBooking(patientId, today, "arrived");

    const { status, data } = await scan(scheduledId);

    assert.equal(status, 200);
    assert.deepEqual(data.updatedBookingIds, [scheduledId]);
    assert.deepEqual(data.alreadyArrivedBookingIds, [arrivedId]);
    assert.deepEqual(await statuses([scheduledId, arrivedId]), { [scheduledId]: "arrived", [arrivedId]: "arrived" });
  });

  it("leaves different patients and different dates unaffected", async () => {
    guard();
    const today = getTripoliToday();
    const patientId = await createPatient();
    const otherPatientId = await createPatient();
    const selectedId = await createBooking(patientId, today, "scheduled");
    const samePatientOtherDateId = await createBooking(patientId, tomorrow(today), "scheduled");
    const otherPatientTodayId = await createBooking(otherPatientId, today, "scheduled");

    const { status } = await scan(selectedId);

    assert.equal(status, 200);
    assert.deepEqual(await statuses([selectedId, samePatientOtherDateId, otherPatientTodayId]), {
      [selectedId]: "arrived",
      [samePatientOtherDateId]: "scheduled",
      [otherPatientTodayId]: "scheduled",
    });
  });

  it("does not auto-arrive closed or final same-day siblings", async () => {
    guard();
    const today = getTripoliToday();
    const patientId = await createPatient();
    const selectedId = await createBooking(patientId, today, "scheduled");
    const closedIds = await Promise.all(
      (["cancelled", "completed", "no-show", "discontinued", "voided"] as BookingStatus[]).map((status) =>
        createBooking(patientId, today, status)
      )
    );

    const { status } = await scan(selectedId);

    assert.equal(status, 200);
    assert.deepEqual(await statuses([selectedId, ...closedIds]), {
      [selectedId]: "arrived",
      [closedIds[0]]: "cancelled",
      [closedIds[1]]: "completed",
      [closedIds[2]]: "no-show",
      [closedIds[3]]: "discontinued",
      [closedIds[4]]: "voided",
    });
  });

  it("updates none when patient queue requirements fail", async () => {
    guard();
    await withPatientRegistrationRequirements(async () => {
      const today = getTripoliToday();
      const patientId = await createPatient(null);
      const firstId = await createBooking(patientId, today, "scheduled");
      const secondId = await createBooking(patientId, today, "scheduled");

      const { status } = await scan(firstId);

      assert.equal(status, 422);
      assert.deepEqual(await statuses([firstId, secondId]), { [firstId]: "scheduled", [secondId]: "scheduled" });
    });
  });

  it("rejects future-date scans without updating the booking", async () => {
    guard();
    const today = getTripoliToday();
    const patientId = await createPatient();
    const futureId = await createBooking(patientId, tomorrow(today), "scheduled");

    const { status } = await scan(futureId);

    assert.equal(status, 409);
    assert.deepEqual(await statuses([futureId]), { [futureId]: "scheduled" });
  });

  it("repeated scans are idempotent after arrival", async () => {
    guard();
    const today = getTripoliToday();
    const patientId = await createPatient();
    const firstId = await createBooking(patientId, today, "scheduled");
    const secondId = await createBooking(patientId, today, "scheduled");

    assert.equal((await scan(firstId)).status, 200);
    const repeated = await scan(firstId);

    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.data.updatedBookingIds, []);
    assert.deepEqual((repeated.data.alreadyArrivedBookingIds as number[]).sort((a, b) => a - b), [firstId, secondId].sort((a, b) => a - b));
    assert.deepEqual(await statuses([firstId, secondId]), { [firstId]: "arrived", [secondId]: "arrived" });
  });

  it("queue snapshot includes derived multiple-appointment data", async () => {
    guard();
    const today = getTripoliToday();
    const patientId = await createPatient();
    const firstId = await createBooking(patientId, today, "scheduled");
    const secondId = await createBooking(patientId, today, "scheduled");

    const response = await fetchJson<{ queue_entries?: Array<Record<string, unknown>> }>(app.baseUrl, "/api/v2/read/queue", {
      cookie: authCookie,
    });

    assert.equal(response.status, 200);
    const row = response.data.queue_entries?.find((entry) => Number(entry.appointment_id) === firstId);
    assert.ok(row);
    assert.equal(row.same_day_appointment_count, 2);
    assert.equal(row.has_multiple_appointments, true);
    const related = row.related_appointments as Array<Record<string, unknown>>;
    assert.deepEqual(related.map((entry) => Number(entry.appointment_id)).sort((a, b) => a - b), [firstId, secondId].sort((a, b) => a - b));
    assert.ok(related.every((entry) => typeof entry.accession_number === "string"));
  });
});
