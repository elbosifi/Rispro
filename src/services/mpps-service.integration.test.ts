import { after, before, describe, it, type SuiteContext } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { pool } from "../db/pool.js";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { ingestMppsEvent } from "./mpps-service.js";
import {
  canReachDatabase,
  cleanupTestData,
  isDatabaseAvailable,
  seedTestData,
  setupTestDatabase,
} from "../modules/appointments-v2/tests/integration/helpers.js";

const PREFIX = "MPPS_";

describe("mpps-service integration", () => {
  let closeServer: (() => Promise<void>) | null = null;
  let baseUrl = "";
  let testData: Awaited<ReturnType<typeof seedTestData>>;
  const bookingIds: number[] = [];

  before(async (t: SuiteContext) => {
    if (!isDatabaseAvailable() || !(await canReachDatabase())) {
      (t as unknown as { skip: () => void }).skip();
      return;
    }

    await setupTestDatabase(PREFIX);
    await pool.query(`
      alter table appointments_v2.bookings drop constraint if exists bookings_status_check
    `);
    await pool.query(`
      alter table appointments_v2.bookings add constraint bookings_status_check
      check (status in ('scheduled', 'arrived', 'waiting', 'in-progress', 'completed', 'no-show', 'cancelled', 'discontinued', 'voided'))
    `);
    await pool.query(`
      create table if not exists mpps_event_log (
        id bigserial primary key,
        dedupe_key text not null unique,
        event_type text not null check (event_type in ('n-create', 'n-set')),
        source_ae_title text not null,
        patient_id text,
        accession_number text,
        study_instance_uid text,
        mpps_instance_uid text,
        performed_step_status text not null,
        requested_procedure_id text,
        scheduled_step_id text,
        modality text,
        scheduled_start_date text,
        scheduled_start_time text,
        performed_start_date text,
        performed_start_time text,
        performed_end_date text,
        performed_end_time text,
        discontinuation_reason text,
        payload_json jsonb not null default '{}'::jsonb,
        correlated_appointment_id bigint,
        correlation_status text not null default 'unmatched' check (correlation_status in ('matched', 'unmatched', 'ambiguous')),
        processing_status text not null default 'received' check (processing_status in ('received', 'processed', 'ignored', 'failed')),
        processing_error text,
        received_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    testData = await seedTestData("appointments_v2", PREFIX);

    const server = http.createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    closeServer = async () => await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
  });

  after(async () => {
    if (bookingIds.length) {
      await pool.query(`delete from mpps_event_log where correlated_appointment_id = any($1::bigint[])`, [bookingIds]);
      await pool.query(`delete from appointments_v2.bookings where id = any($1::bigint[])`, [bookingIds]);
    }
    await cleanupTestData(PREFIX);
    if (closeServer) await closeServer();
  });

  async function createBooking(status = "scheduled", bookingTime: string | null = "09:00:00"): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `
        insert into appointments_v2.bookings (
          patient_id, modality_id, exam_type_id, reporting_priority_id, booking_date, booking_time,
          case_category, status, notes, policy_version_id, capacity_resolution_mode,
          uses_special_quota, special_reason_code, special_reason_note, is_walk_in,
          created_by_user_id, updated_by_user_id
        ) values ($1, $2, $3, null, current_date, $4, 'non_oncology', $5, null, $6, 'standard', false, null, null, false, $7, $7)
        returning id
      `,
      [testData.patientId, testData.modalityId, testData.examTypeId, bookingTime, status, testData.policyVersionId, testData.userId]
    );
    const id = Number(result.rows[0].id);
    bookingIds.push(id);
    return id;
  }

  async function getPatientIdentifier(): Promise<string> {
    const result = await pool.query<{ identifier: string }>(
      `
        select coalesce(nullif(national_id, ''), nullif(mrn, ''), nullif(identifier_value, '')) as identifier
        from patients where id = $1
      `,
      [testData.patientId]
    );
    return String(result.rows[0]?.identifier || "");
  }

  async function getBookingStatus(bookingId: number): Promise<string> {
    const result = await pool.query<{ status: string }>(`select status from appointments_v2.bookings where id = $1`, [bookingId]);
    return String(result.rows[0]?.status || "");
  }

  async function getBookingFallbackValues(bookingId: number): Promise<{ date: string; modality: string }> {
    const result = await pool.query<{ date: string; modality: string }>(
      `
        select to_char(b.booking_date, 'YYYYMMDD') as date, m.code as modality
        from appointments_v2.bookings b
        join modalities m on m.id = b.modality_id
        where b.id = $1
      `,
      [bookingId]
    );
    return { date: String(result.rows[0]?.date || ""), modality: String(result.rows[0]?.modality || "") };
  }

  function createPayload(bookingId: number, mppsInstanceUid: string) {
    return {
      eventType: "n-create",
      sourceAeTitle: "CT_AE",
      accessionNumber: `V2-${bookingId}`,
      studyInstanceUid: `1.2.826.0.1.3680043.10.543.${bookingId}.study`,
      mppsInstanceUid,
      performedStepStatus: "IN PROGRESS",
      modality: "CT",
      performedStartDate: "20260911",
      performedStartTime: "091317",
      rawDatasetJson: { AccessionNumber: `V2-${bookingId}` },
    };
  }

  it("validates the internal intake secret and payload", async () => {
    const unauthorized = await fetch(`${baseUrl}/api/dicom/mpps/events`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${baseUrl}/api/dicom/mpps/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RISPRO-MPPS-SECRET": env.jwtSecret },
      body: JSON.stringify({ eventType: "n-create", sourceAeTitle: "CT_AE", rawDatasetJson: {} }),
    });
    assert.equal(invalid.status, 400);
  });

  it("uses the configured internal MPPS secret and falls back to JWT_SECRET", async () => {
    const previousInternalSecret = env.risproInternalSecret;
    const previousJwtSecret = env.jwtSecret;
    const invalidPayload = { eventType: "n-create", sourceAeTitle: "CT_AE", rawDatasetJson: {} };

    try {
      env.risproInternalSecret = "mpps-dedicated-test-secret";
      const dedicatedAccepted = await fetch(`${baseUrl}/api/dicom/mpps/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-RISPRO-MPPS-SECRET": env.risproInternalSecret },
        body: JSON.stringify(invalidPayload),
      });
      assert.equal(dedicatedAccepted.status, 400);

      const wrongSecret = await fetch(`${baseUrl}/api/dicom/mpps/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-RISPRO-MPPS-SECRET": "wrong-secret" },
        body: JSON.stringify(invalidPayload),
      });
      assert.equal(wrongSecret.status, 401);

      env.risproInternalSecret = "";
      env.jwtSecret = "mpps-jwt-fallback-test-secret";
      const fallbackAccepted = await fetch(`${baseUrl}/api/dicom/mpps/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-RISPRO-MPPS-SECRET": env.jwtSecret },
        body: JSON.stringify(invalidPayload),
      });
      assert.equal(fallbackAccepted.status, 400);
    } finally {
      env.risproInternalSecret = previousInternalSecret;
      env.jwtSecret = previousJwtSecret;
    }
  });

  it("maps IN PROGRESS to the existing in-progress workflow state from every normal pre-scan state", async () => {
    for (const initialStatus of ["scheduled", "arrived", "waiting", "in-progress"] as const) {
      const bookingId = await createBooking(initialStatus);
      const mppsInstanceUid = `1.2.826.${bookingId}.start`;
      const result = await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));

      assert.equal(result.dicomStatus, 0x0000);
      assert.equal(result.updatedStatus, "in-progress");
      assert.equal(await getBookingStatus(bookingId), "in-progress");
    }
  });

  it("persists actual performed start timing separately for IN PROGRESS", async () => {
    const bookingId = await createBooking();
    const mppsInstanceUid = `1.2.826.${bookingId}.start`;
    const result = await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));
    const stored = await pool.query<{ performed_start_date: string; performed_start_time: string; scheduled_start_date: string | null }>(
      `select performed_start_date, performed_start_time, scheduled_start_date from mpps_event_log where mpps_instance_uid = $1`,
      [mppsInstanceUid]
    );

    assert.equal(result.dicomStatus, 0x0000);
    assert.equal(result.updatedStatus, "in-progress");
    assert.deepEqual(stored.rows[0], { performed_start_date: "20260911", performed_start_time: "091317", scheduled_start_date: null });
    assert.equal(await getBookingStatus(bookingId), "in-progress");
  });

  it("uses the accepted N-CREATE lifecycle record to process identifier-free N-SET completion", async () => {
    const bookingId = await createBooking();
    const mppsInstanceUid = `1.2.826.${bookingId}.complete`;
    await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));
    const completed = await ingestMppsEvent({
      eventType: "n-set", sourceAeTitle: "CT_AE", mppsInstanceUid,
      performedStepStatus: "COMPLETED", performedEndDate: "20260911", performedEndTime: "094501",
      rawDatasetJson: { PerformedProcedureStepStatus: "COMPLETED" },
    });
    const stored = await pool.query<{ performed_end_date: string; performed_end_time: string }>(
      `select performed_end_date, performed_end_time from mpps_event_log where mpps_instance_uid = $1 and event_type = 'n-set'`, [mppsInstanceUid]
    );

    assert.equal(completed.dicomStatus, 0x0000);
    assert.equal(completed.updatedStatus, "completed");
    assert.deepEqual(stored.rows[0], { performed_end_date: "20260911", performed_end_time: "094501" });
    assert.equal(await getBookingStatus(bookingId), "completed");
  });

  it("stores distinct IN PROGRESS N-SET modifications and deduplicates exact retries", async () => {
    const bookingId = await createBooking();
    const mppsInstanceUid = `1.2.826.${bookingId}.updates`;
    await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));

    const modificationA = {
      PerformedProcedureStepStatus: "IN PROGRESS",
      PerformedSeriesSequence: [{ SeriesInstanceUID: `${mppsInstanceUid}.series-a`, Modality: "CT" }],
    };
    const modificationB = {
      PerformedSeriesSequence: [{ Modality: "CT", SeriesInstanceUID: `${mppsInstanceUid}.series-b` }],
      PerformedProcedureStepStatus: "IN PROGRESS",
    };
    const firstUpdate = await ingestMppsEvent({
      eventType: "n-set", sourceAeTitle: "CT_AE", mppsInstanceUid,
      performedStepStatus: "IN PROGRESS", rawDatasetJson: modificationA,
    });
    const secondUpdate = await ingestMppsEvent({
      eventType: "n-set", sourceAeTitle: "CT_AE", mppsInstanceUid,
      performedStepStatus: "IN PROGRESS", rawDatasetJson: modificationB,
    });
    const exactRetry = await ingestMppsEvent({
      eventType: "n-set", sourceAeTitle: "CT_AE", mppsInstanceUid,
      performedStepStatus: "IN PROGRESS",
      rawDatasetJson: {
        PerformedProcedureStepStatus: "IN PROGRESS",
        PerformedSeriesSequence: [{ SeriesInstanceUID: `${mppsInstanceUid}.series-b`, Modality: "CT" }],
      },
    });
    const rows = await pool.query<{ id: number }>(
      `select id from mpps_event_log where mpps_instance_uid = $1 and event_type = 'n-set' order by id asc`,
      [mppsInstanceUid]
    );

    assert.equal(firstUpdate.dicomStatus, 0x0000);
    assert.equal(secondUpdate.dicomStatus, 0x0000);
    assert.equal(firstUpdate.deduplicated, false);
    assert.equal(secondUpdate.deduplicated, false);
    assert.notEqual(firstUpdate.eventId, secondUpdate.eventId);
    assert.equal(exactRetry.dicomStatus, 0x0000);
    assert.equal(exactRetry.deduplicated, true);
    assert.equal(exactRetry.eventId, secondUpdate.eventId);
    assert.equal(rows.rows.length, 2);
    assert.equal(await getBookingStatus(bookingId), "in-progress");
  });

  it("maps valid final N-SET events from in-progress", async () => {
    const bookingId = await createBooking();
    const mppsInstanceUid = `1.2.826.${bookingId}.discontinued`;
    await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));
    const result = await ingestMppsEvent({
      eventType: "n-set", sourceAeTitle: "CT_AE", mppsInstanceUid,
      performedStepStatus: "DISCONTINUED", performedEndDate: "20260911", performedEndTime: "095500",
      discontinuationReason: "Patient unable to continue", rawDatasetJson: {},
    });
    const stored = await pool.query<{ discontinuation_reason: string }>(
      `select discontinuation_reason from mpps_event_log where mpps_instance_uid = $1 and event_type = 'n-set'`, [mppsInstanceUid]
    );

    assert.equal(result.updatedStatus, "discontinued");
    assert.equal(stored.rows[0]?.discontinuation_reason, "Patient unable to continue");
    assert.equal(await getBookingStatus(bookingId), "discontinued");
  });

  it("does not reopen completed or other terminal bookings on MPPS IN PROGRESS", async () => {
    for (const terminalStatus of ["completed", "cancelled", "no-show", "discontinued", "voided"] as const) {
      const bookingId = await createBooking(terminalStatus);
      const mppsInstanceUid = `1.2.826.${bookingId}.terminal`;
      const result = await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));

      assert.equal(result.processingStatus, "ignored");
      assert.equal(result.updatedStatus, null);
      assert.equal(await getBookingStatus(bookingId), terminalStatus);
    }
  });

  it("rejects duplicate creates, unknown N-SETs, invalid create statuses, and N-SET after final state", async () => {
    const bookingId = await createBooking();
    const mppsInstanceUid = `1.2.826.${bookingId}.lifecycle`;
    await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));

    assert.equal((await ingestMppsEvent({
      eventType: "n-set", sourceAeTitle: "CT_AE", mppsInstanceUid, rawDatasetJson: {},
    })).dicomStatus, 0x0000);

    assert.equal((await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid))).dicomStatus, 0x0111);
    assert.equal((await ingestMppsEvent({
      eventType: "n-set", sourceAeTitle: "CT_AE", mppsInstanceUid: "1.2.826.unknown",
      performedStepStatus: "COMPLETED", rawDatasetJson: {},
    })).dicomStatus, 0x0112);
    assert.equal((await ingestMppsEvent({
      ...createPayload(bookingId, `1.2.826.${bookingId}.invalid`), performedStepStatus: "COMPLETED",
    })).dicomStatus, 0x0106);

    assert.equal((await ingestMppsEvent({
      eventType: "n-set", sourceAeTitle: "CT_AE", mppsInstanceUid,
      performedStepStatus: "COMPLETED", rawDatasetJson: {},
    })).dicomStatus, 0x0000);
    assert.equal((await ingestMppsEvent({
      eventType: "n-set", sourceAeTitle: "CT_AE", mppsInstanceUid,
      performedStepStatus: "IN PROGRESS", rawDatasetJson: {},
    })).dicomStatus, 0x0110);
  });

  it("does not match another modality through an absent device mapping", async () => {
    await createBooking("scheduled", "14:00:00");
    const result = await ingestMppsEvent({
      eventType: "n-create", sourceAeTitle: "UNMAPPED_AE", patientId: await getPatientIdentifier(),
      mppsInstanceUid: "1.2.826.modality-mismatch", performedStepStatus: "IN PROGRESS", modality: "MRI",
      performedStartDate: new Date().toISOString().slice(0, 10), scheduledStartTime: "14:00:00", rawDatasetJson: {},
    });
    assert.equal(result.correlationStatus, "unmatched");
    assert.equal(result.processingStatus, "ignored");
  });

  it("keeps multi-candidate patient/date/modality fallback ambiguous", async () => {
    const firstBookingId = await createBooking("scheduled", "15:00:00");
    await createBooking("scheduled", "15:00:00");
    const fallback = await getBookingFallbackValues(firstBookingId);
    const patientId = await getPatientIdentifier();
    const candidates = await pool.query<{ id: number }>(
      `
        select b.id
        from appointments_v2.bookings b
        join patients p on p.id = b.patient_id
        where b.booking_date = to_date($2, 'YYYYMMDD')
          and (p.mrn = $1 or p.national_id = $1 or coalesce(p.identifier_value, '') = $1)
          and replace(coalesce(b.booking_time::text, ''), ':', '') like '150000%'
      `,
      [patientId, fallback.date]
    );
    assert.equal(candidates.rows.length, 2, `Expected two fallback candidates for ${patientId} on ${fallback.date}`);
    const result = await ingestMppsEvent({
      eventType: "n-create", sourceAeTitle: "CT_AE", patientId,
      mppsInstanceUid: `1.2.826.${firstBookingId}.${Date.now()}.ambiguous`, performedStepStatus: "IN PROGRESS", modality: "",
      performedStartDate: fallback.date, scheduledStartTime: "15:00:00", rawDatasetJson: {},
    });
    assert.equal(result.correlationStatus, "ambiguous");
    assert.equal(result.processingStatus, "ignored");
  });
});
