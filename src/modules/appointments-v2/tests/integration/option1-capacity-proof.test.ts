/**
 * Appointments V2 — Option-1 capacity semantics proof tests.
 *
 * DB-backed integration tests focused on:
 * - total-capacity enforcement across categories
 * - partitioned category enforcement inside total capacity
 * - concurrent cross-category create race safety
 * - cross-date reschedule lock behavior
 * - availability DTO semantics for total_only and partitioned modes
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

const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "OPT1PROOF_";

function plusDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function uniqueSuffix(): string {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

describe("Option-1 capacity semantics — DB-backed proof", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database is not reachable. Skipping option-1 proof integration tests.");
      return;
    }
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");
  });

  after(async () => {
    if (!testData) return;
    await app.close();
    await testDb.cleanup();
  });

  function guard() {
    if (!testData) throw new Error("Test setup failed — database unreachable");
  }

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
    if (path.includes("/api/v2/scheduling/availability")) {
      const sep = path.includes("?") ? "&" : "?";
      return fetchJson(app.baseUrl, `${path}${sep}policySetKey=${encodeURIComponent(testData.policySetKey)}`, {
        cookie: authCookie,
        ...rest,
      });
    }
    return fetchJson(app.baseUrl, path, {
      cookie: authCookie,
      ...rest,
      ...(origBody !== undefined ? { body: origBody } : {}),
    });
  };

  async function createPatient(): Promise<number> {
    const suffix = uniqueSuffix();
    const nationalId = `9${randomUUID().replace(/-/g, "").slice(0, 11)}`;
    const result = await pool.query<{ id: number }>(
      `insert into patients (
         arabic_full_name,
         english_full_name,
         national_id,
         normalized_arabic_name,
         sex,
         age_years,
         identifier_type,
         identifier_value
       )
       values ($1, $2, $3, $4, 'M', 30, 'national_id', $5)
       returning id`,
      [
        `${TEST_PREFIX}${suffix}مريض`,
        `${TEST_PREFIX}${suffix} Patient`,
        nationalId,
        `${TEST_PREFIX}${suffix}مريض`,
        nationalId,
      ]
    );
    return Number(result.rows[0]?.id);
  }

  async function setModalityCapacity(dailyCapacity: number): Promise<void> {
    await pool.query(`update modalities set daily_capacity = $2 where id = $1`, [testData.modalityId, dailyCapacity]);
  }

  async function setCategoryLimits(oncology: number | null, nonOncology: number | null): Promise<void> {
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

  async function createBooking(params: {
    patientId: number;
    bookingDate: string;
    caseCategory: "oncology" | "non_oncology";
    useSpecialQuota?: boolean;
  }) {
    return fetch("/api/v2/appointments", {
      method: "POST",
      body: {
        patientId: params.patientId,
        modalityId: testData.modalityId,
        examTypeId: testData.examTypeId,
        bookingDate: params.bookingDate,
        caseCategory: params.caseCategory,
        useSpecialQuota: params.useSpecialQuota ?? false,
      },
    });
  }

  describe("Total cap across categories", () => {
    it("enforces modality hard ceiling in total_only mode", async () => {
      guard();
      await setModalityCapacity(2);
      await setCategoryLimits(null, null);

      const date = plusDays(12);
      const p1 = await createPatient();
      const p2 = await createPatient();
      const p3 = await createPatient();

      const r1 = await createBooking({ patientId: p1, bookingDate: date, caseCategory: "oncology" });
      const r2 = await createBooking({ patientId: p2, bookingDate: date, caseCategory: "non_oncology" });
      const r3 = await createBooking({ patientId: p3, bookingDate: date, caseCategory: "oncology" });

      assert.equal(r1.status, 201);
      assert.equal(r2.status, 201);
      assert.equal(r3.status, 409);

      const booked = await pool.query<{ count: string }>(
        `select count(*)::text as count
         from appointments_v2.bookings
         where modality_id = $1
           and booking_date = $2::date
           and status <> 'cancelled'`,
        [testData.modalityId, date]
      );
      assert.equal(Number(booked.rows[0]?.count || "0"), 2);
    });
  });

  describe("Category cap with remaining total room", () => {
    it("blocks category overflow while modality total still has room", async () => {
      guard();
      await setModalityCapacity(10);
      await setCategoryLimits(9, 1);

      const date = plusDays(13);
      const p1 = await createPatient();
      const p2 = await createPatient();

      const ok = await createBooking({ patientId: p1, bookingDate: date, caseCategory: "non_oncology" });
      const blocked = await createBooking({ patientId: p2, bookingDate: date, caseCategory: "non_oncology" });

      assert.equal(ok.status, 201);
      assert.equal(blocked.status, 409);

      const availability = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=20&offset=0&caseCategory=non_oncology&examTypeId=${testData.examTypeId}`
      );
      assert.equal(availability.status, 200);
      const day = ((availability.data as any).items ?? []).find((d: any) => d.date === date);
      assert.ok(day);
      assert.equal(day.bucketMode, "partitioned");
      assert.equal(day.modalityTotalCapacity, 10);
      assert.equal(day.bookedTotal, 1);
      assert.equal(day.nonOncology.reserved, 1);
      assert.equal(day.nonOncology.filled, 1);
      assert.equal(day.nonOncology.remaining, 0);
      assert.equal(day.oncology.reserved, 9);
      assert.equal(day.oncology.remaining, 9);
    });
  });

  describe("Concurrent create race across categories", () => {
    it("allows only one winner when one total slot remains", async () => {
      guard();
      await setModalityCapacity(1);
      await setCategoryLimits(null, null);

      const date = plusDays(14);
      const oncologyPatient = await createPatient();
      const nonOncologyPatient = await createPatient();

      const [oncologyResult, nonOncologyResult] = await Promise.all([
        createBooking({ patientId: oncologyPatient, bookingDate: date, caseCategory: "oncology" }),
        createBooking({ patientId: nonOncologyPatient, bookingDate: date, caseCategory: "non_oncology" }),
      ]);

      const statuses = [oncologyResult.status, nonOncologyResult.status].sort();
      assert.deepEqual(statuses, [201, 409]);

      const booked = await pool.query<{ count: string }>(
        `select count(*)::text as count
         from appointments_v2.bookings
         where modality_id = $1
           and booking_date = $2::date
           and status <> 'cancelled'`,
        [testData.modalityId, date]
      );
      assert.equal(Number(booked.rows[0]?.count || "0"), 1);
    });
  });

  describe("Reschedule source+target lock behavior", () => {
    it("supports concurrent cross-date swaps without deadlock/oversubscription", async () => {
      guard();
      await setModalityCapacity(4);
      await setCategoryLimits(2, 2);

      const sourceDate = plusDays(15);
      const targetDate = plusDays(16);
      const p1 = await createPatient();
      const p2 = await createPatient();

      const c1 = await createBooking({ patientId: p1, bookingDate: sourceDate, caseCategory: "non_oncology" });
      const c2 = await createBooking({ patientId: p2, bookingDate: targetDate, caseCategory: "non_oncology" });
      assert.equal(c1.status, 201);
      assert.equal(c2.status, 201);

      const booking1 = Number(((c1.data as any).booking as any).id);
      const booking2 = Number(((c2.data as any).booking as any).id);

      const [r1, r2] = await Promise.all([
        fetch(`/api/v2/appointments/${booking1}`, {
          method: "PUT",
          body: {
            patientId: p1,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: targetDate,
            caseCategory: "non_oncology",
          },
        }),
        fetch(`/api/v2/appointments/${booking2}`, {
          method: "PUT",
          body: {
            patientId: p2,
            modalityId: testData.modalityId,
            examTypeId: testData.examTypeId,
            bookingDate: sourceDate,
            caseCategory: "non_oncology",
          },
        }),
      ]);

      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);

      const counts = await pool.query<{ booking_date: string; count: string }>(
        `select booking_date::text as booking_date, count(*)::text as count
         from appointments_v2.bookings
         where modality_id = $1
           and booking_date in ($2::date, $3::date)
           and status <> 'cancelled'
           and case_category = 'non_oncology'
         group by booking_date`,
        [testData.modalityId, sourceDate, targetDate]
      );

      const byDate = new Map(counts.rows.map((r) => [String(r.booking_date).slice(0, 10), Number(r.count)]));
      assert.equal(byDate.get(sourceDate), 1);
      assert.equal(byDate.get(targetDate), 1);
    });
  });

  describe("Availability DTO modes", () => {
    it("returns total_only mode without fabricated category reserves", async () => {
      guard();
      await setModalityCapacity(5);
      await setCategoryLimits(null, null);

      const date = plusDays(17);
      const patient = await createPatient();
      const booking = await createBooking({ patientId: patient, bookingDate: date, caseCategory: "oncology" });
      assert.equal(booking.status, 201);

      const availability = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=25&offset=0&caseCategory=non_oncology&examTypeId=${testData.examTypeId}`
      );
      assert.equal(availability.status, 200);

      const day = ((availability.data as any).items ?? []).find((d: any) => d.date === date);
      assert.ok(day);
      assert.equal(day.bucketMode, "total_only");
      assert.equal(day.modalityTotalCapacity, 5);
      assert.equal(day.bookedTotal, 1);
      assert.equal(day.oncology.filled, 1);
      assert.equal(day.nonOncology.filled, 0);
      assert.equal(day.oncology.reserved, null);
      assert.equal(day.oncology.remaining, null);
      assert.equal(day.nonOncology.reserved, null);
      assert.equal(day.nonOncology.remaining, null);
    });

    it("returns partitioned mode with explicit reserves and remaining", async () => {
      guard();
      await setModalityCapacity(6);
      await setCategoryLimits(4, 2);

      const date = plusDays(18);
      const patient = await createPatient();
      const booking = await createBooking({ patientId: patient, bookingDate: date, caseCategory: "non_oncology" });
      assert.equal(booking.status, 201);

      const availability = await fetch(
        `/api/v2/scheduling/availability?modalityId=${testData.modalityId}&days=30&offset=0&caseCategory=non_oncology&examTypeId=${testData.examTypeId}`
      );
      assert.equal(availability.status, 200);

      const day = ((availability.data as any).items ?? []).find((d: any) => d.date === date);
      assert.ok(day);
      assert.equal(day.bucketMode, "partitioned");
      assert.equal(day.modalityTotalCapacity, 6);
      assert.equal(day.bookedTotal, 1);
      assert.equal(day.oncology.reserved, 4);
      assert.equal(day.oncology.filled, 0);
      assert.equal(day.oncology.remaining, 4);
      assert.equal(day.nonOncology.reserved, 2);
      assert.equal(day.nonOncology.filled, 1);
      assert.equal(day.nonOncology.remaining, 1);
    });
  });
});
