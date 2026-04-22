import { after, before, describe, it } from "node:test";
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
  let bookingIds: number[] = [];

  before(async function () {
    if (!isDatabaseAvailable() || !(await canReachDatabase())) {
      this.skip();
      return;
    }

    await setupTestDatabase(PREFIX);
    await pool.query(`
      alter table appointments_v2.bookings
      drop constraint if exists bookings_status_check
    `);
    await pool.query(`
      alter table appointments_v2.bookings
      add constraint bookings_status_check
      check (status in ('scheduled', 'arrived', 'waiting', 'completed', 'no-show', 'cancelled', 'discontinued'))
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

    const app = createApp();
    const server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    closeServer = async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    };
  });

  after(async () => {
    if (bookingIds.length > 0) {
      await pool.query(`delete from mpps_event_log where correlated_appointment_id = any($1::bigint[])`, [bookingIds]);
      await pool.query(`delete from appointments_v2.bookings where id = any($1::bigint[])`, [bookingIds]);
    }
    await cleanupTestData(PREFIX);
    if (closeServer) await closeServer();
  });

  async function createBooking(status: string = "scheduled", bookingTime: string | null = "09:00:00"): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `
        insert into appointments_v2.bookings (
          patient_id, modality_id, exam_type_id, reporting_priority_id,
          booking_date, booking_time, case_category, status, notes,
          policy_version_id, capacity_resolution_mode, uses_special_quota,
          special_reason_code, special_reason_note, is_walk_in,
          created_by_user_id, updated_by_user_id
        ) values (
          $1, $2, $3, null,
          current_date, $4, 'non_oncology', $5, null,
          $6, 'standard', false,
          null, null, false,
          $7, $7
        )
        returning id
      `,
      [
        testData.patientId,
        testData.modalityId,
        testData.examTypeId,
        bookingTime,
        status,
        testData.policyVersionId,
        testData.userId,
      ]
    );
    const id = Number(result.rows[0].id);
    bookingIds.push(id);
    return id;
  }

  async function getBookingStatus(bookingId: number): Promise<string> {
    const result = await pool.query<{ status: string }>(
      `select status from appointments_v2.bookings where id = $1`,
      [bookingId]
    );
    return String(result.rows[0]?.status || "");
  }

  async function getPatientIdentifier(): Promise<string> {
    const result = await pool.query<{ national_id: string }>(
      `select national_id from patients where id = $1`,
      [testData.patientId]
    );
    return String(result.rows[0]?.national_id || "");
  }

  it("validates intake endpoint secret and payload", async () => {
    const unauthorized = await fetch(`${baseUrl}/api/dicom/mpps/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(unauthorized.status, 401);

    const invalid = await fetch(`${baseUrl}/api/dicom/mpps/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RISPRO-MPPS-SECRET": env.jwtSecret,
      },
      body: JSON.stringify({ eventType: "n-create", sourceAeTitle: "CT_AE", rawDatasetJson: {} }),
    });
    assert.equal(invalid.status, 400);
  });

  it("correlates by accession number and updates waiting for in-progress", async () => {
    const bookingId = await createBooking("scheduled", "09:00:00");
    const result = await ingestMppsEvent({
      eventType: "n-create",
      sourceAeTitle: "CT_AE",
      accessionNumber: `V2-${bookingId}`,
      mppsInstanceUid: `1.2.826.${bookingId}.1`,
      performedStepStatus: "IN PROGRESS",
      rawDatasetJson: { AccessionNumber: `V2-${bookingId}` },
    });

    assert.equal(result.correlationStatus, "matched");
    assert.equal(result.updatedStatus, "waiting");
    assert.equal(await getBookingStatus(bookingId), "waiting");
  });

  it("marks unmatched events without changing bookings", async () => {
    const result = await ingestMppsEvent({
      eventType: "n-set",
      sourceAeTitle: "CT_AE",
      accessionNumber: "V2-9999999",
      mppsInstanceUid: "1.2.826.unmatched",
      performedStepStatus: "COMPLETED",
      rawDatasetJson: { AccessionNumber: "V2-9999999" },
    });

    assert.equal(result.correlationStatus, "unmatched");
    assert.equal(result.processingStatus, "ignored");
  });

  it("marks ambiguous fallback events without updating the wrong booking", async () => {
    await createBooking("scheduled", "10:00:00");
    await createBooking("scheduled", "10:00:00");

    const result = await ingestMppsEvent({
      eventType: "n-set",
      sourceAeTitle: "CT_AE",
      patientId: await getPatientIdentifier(),
      mppsInstanceUid: "1.2.826.ambiguous",
      modality: "CT",
      scheduledStartDate: new Date().toISOString().slice(0, 10),
      scheduledStartTime: "10:00:00",
      performedStepStatus: "IN PROGRESS",
      rawDatasetJson: { PatientID: "fallback" },
    });

    assert.equal(result.correlationStatus, "ambiguous");
    assert.equal(result.processingStatus, "ignored");
  });

  it("updates booking to completed", async () => {
    const bookingId = await createBooking("arrived", "11:00:00");
    const result = await ingestMppsEvent({
      eventType: "n-set",
      sourceAeTitle: "CT_AE",
      accessionNumber: `V2-${bookingId}`,
      mppsInstanceUid: `1.2.826.${bookingId}.2`,
      performedStepStatus: "COMPLETED",
      rawDatasetJson: { AccessionNumber: `V2-${bookingId}` },
    });

    assert.equal(result.updatedStatus, "completed");
    assert.equal(await getBookingStatus(bookingId), "completed");
  });

  it("updates booking to discontinued for scanner-side discontinuation", async () => {
    const bookingId = await createBooking("waiting", "12:00:00");
    const result = await ingestMppsEvent({
      eventType: "n-set",
      sourceAeTitle: "CT_AE",
      accessionNumber: `V2-${bookingId}`,
      mppsInstanceUid: `1.2.826.${bookingId}.3`,
      performedStepStatus: "DISCONTINUED",
      rawDatasetJson: { AccessionNumber: `V2-${bookingId}` },
    });

    assert.equal(result.updatedStatus, "discontinued");
    assert.equal(await getBookingStatus(bookingId), "discontinued");
  });

  it("is idempotent for duplicate MPPS deliveries", async () => {
    const bookingId = await createBooking("scheduled", "13:00:00");
    const payload = {
      eventType: "n-set",
      sourceAeTitle: "CT_AE",
      accessionNumber: `V2-${bookingId}`,
      mppsInstanceUid: `1.2.826.${bookingId}.4`,
      performedStepStatus: "COMPLETED",
      rawDatasetJson: { AccessionNumber: `V2-${bookingId}` },
    };

    const first = await ingestMppsEvent(payload);
    const second = await ingestMppsEvent(payload);
    const countResult = await pool.query<{ count: string }>(
      `select count(*)::text as count from mpps_event_log where mpps_instance_uid = $1 and performed_step_status = 'COMPLETED'`,
      [payload.mppsInstanceUid]
    );

    assert.equal(first.processingStatus, "processed");
    assert.equal(second.deduplicated, true);
    assert.equal(Number(countResult.rows[0]?.count || 0), 1);
    assert.equal(await getBookingStatus(bookingId), "completed");
  });
});
