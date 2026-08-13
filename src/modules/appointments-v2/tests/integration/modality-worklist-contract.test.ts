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

const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "MODWL_";

describe("V2 modality worklist backend contract", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createTestApp>>;
  let authCookie: string;

  before(async () => {
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database is not reachable. Skipping modality worklist contract integration tests.");
      return;
    }
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedTestData(testDb.schemaName, TEST_PREFIX);
    app = await createTestApp();
    authCookie = createTestAuthCookie(testData.userId, "supervisor");
  });

  after(async () => {
    if (!testData) return;
    await pool.query("delete from documents where stored_path like $1", [`tests/${TEST_PREFIX}%`]);
    await app.close();
    await testDb.cleanup();
  });

  function guard() {
    if (!testData) throw new Error("Test setup failed - database unreachable");
  }

  async function createBooking(patientId: number, modalityId = testData.modalityId, examTypeId = testData.examTypeId): Promise<number> {
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
        values ($1, $2, $3, '2026-06-20'::date, null, 'non_oncology', 'completed', $4, $5, $5)
        returning id::text
      `,
      [patientId, modalityId, examTypeId, testData.policyVersionId, testData.userId]
    );
    return Number(result.rows[0].id);
  }

  it("returns PACS timing, primary identifier, and Routine priority defaults", async () => {
    guard();
    const passportType = await pool.query<{ id: string }>(
      `select id::text from patient_identifier_types where code = 'passport' limit 1`
    );
    assert.ok(passportType.rows[0]?.id);

    await pool.query(
      `
        insert into patient_identifiers (patient_id, identifier_type_id, value, normalized_value, is_primary)
        values ($1, $2, 'PASS-MODWL-1', 'PASS-MODWL-1', true)
      `,
      [testData.patientId, Number(passportType.rows[0].id)]
    );

    const passportBookingId = await createBooking(testData.patientId);
    await pool.query(
      `
        update appointments_v2.bookings
        set
          pacs_study_started_at = '2026-06-20T08:15:00Z'::timestamptz,
          pacs_first_seen_at = '2026-06-20T08:17:00Z'::timestamptz,
          pacs_timing_source = 'instance_acquisition_datetime',
          pacs_timing_confidence = 'high',
          pacs_timing_checked_at = '2026-06-20T08:18:00Z'::timestamptz
        where id = $1
      `,
      [passportBookingId]
    );

    const fallbackPatient = await pool.query<{ id: string }>(
      `
        insert into patients (
          arabic_full_name,
          english_full_name,
          national_id,
          normalized_arabic_name,
          sex,
          age_years,
          mrn,
          identifier_type,
          identifier_value
        )
        values ($1, $2, null, $3, 'F', 41, 'MRN-MODWL-1', null, null)
        returning id::text
      `,
      [`${TEST_PREFIX}مريضة بدون معرف`, `${TEST_PREFIX}Fallback Patient`, `${TEST_PREFIX}fallback`]
    );
    const fallbackBookingId = await createBooking(Number(fallbackPatient.rows[0].id));

    await pool.query(
      `
        insert into appointments_v2.pacs_auto_completion_settings (modality_id, enabled)
        values ($1, true)
        on conflict (modality_id) do update set enabled = excluded.enabled
      `,
      [testData.modalityId]
    );

    const response = await fetchJson<{ appointments: Array<Record<string, unknown>> }>(
      app.baseUrl,
      `/api/v2/read/modality/worklist?modalityId=${testData.modalityId}&scope=all`,
      { cookie: authCookie }
    );

    assert.equal(response.status, 200);
    const passportRow = response.data.appointments.find((row) => Number(row.id) === passportBookingId);
    const fallbackRow = response.data.appointments.find((row) => Number(row.id) === fallbackBookingId);

    assert.equal(passportRow?.patient_primary_identifier_type, "passport");
    assert.equal(passportRow?.patient_primary_identifier_label_en, "Passport");
    assert.equal(passportRow?.patient_primary_identifier_value, "PASS-MODWL-1");
    assert.equal(passportRow?.pacs_auto_completion_enabled, true);
    assert.equal(passportRow?.pacs_study_started_at, "2026-06-20T08:15:00.000Z");
    assert.equal(passportRow?.pacs_first_seen_at, "2026-06-20T08:17:00.000Z");
    assert.equal(passportRow?.pacs_timing_source, "instance_acquisition_datetime");
    assert.equal(passportRow?.pacs_timing_confidence, "high");
    assert.equal(passportRow?.priority_name_en, "Routine");

    assert.equal(fallbackRow?.patient_primary_identifier_type, "mrn");
    assert.equal(fallbackRow?.patient_primary_identifier_value, "MRN-MODWL-1");
    assert.equal(fallbackRow?.priority_name_en, "Routine");
  });

  it("returns exact-booking document summaries without double-counting", async () => {
    guard();
    const zeroBookingId = await createBooking(testData.patientId);
    const directBookingId = await createBooking(testData.patientId);
    const multipleBookingId = await createBooking(testData.patientId);
    const linkedBookingId = await createBooking(testData.patientId);
    const dualLinkedBookingId = await createBooking(testData.patientId);
    const otherAppointmentId = await createBooking(testData.patientId);

    const insertDocument = async (filename: string, bookingId: number | null) => {
      const result = await pool.query<{ id: string }>(
        `
          insert into documents (
            patient_id, v2_booking_id, document_type, original_filename,
            stored_path, mime_type, file_size, source
          )
          values ($1, $2, 'appointment_request', $3, $4, 'application/pdf', 10, 'manual_upload')
          returning id::text
        `,
        [testData.patientId, bookingId, filename, `tests/${TEST_PREFIX}${filename}`]
      );
      return Number(result.rows[0].id);
    };

    await insertDocument("direct.pdf", directBookingId);
    await insertDocument("multiple-a.pdf", multipleBookingId);
    await insertDocument("multiple-b.pdf", multipleBookingId);
    const linkedDocumentId = await insertDocument("linked.pdf", null);
    await pool.query(
      "insert into document_appointment_links(document_id, appointment_id) values($1, $2)",
      [linkedDocumentId, linkedBookingId]
    );
    const dualLinkedDocumentId = await insertDocument("dual-linked.pdf", dualLinkedBookingId);
    await pool.query(
      "insert into document_appointment_links(document_id, appointment_id) values($1, $2)",
      [dualLinkedDocumentId, dualLinkedBookingId]
    );
    await insertDocument("same-patient-other-appointment.pdf", otherAppointmentId);

    const response = await fetchJson<{ appointments: Array<Record<string, unknown>> }>(
      app.baseUrl,
      `/api/v2/read/modality/worklist?modalityId=${testData.modalityId}&scope=all`,
      { cookie: authCookie }
    );

    assert.equal(response.status, 200);
    const row = (bookingId: number) => response.data.appointments.find((appointment) => Number(appointment.id) === bookingId);
    assert.equal(row(zeroBookingId)?.document_count, 0);
    assert.equal(row(directBookingId)?.document_count, 1);
    assert.equal(row(multipleBookingId)?.document_count, 2);
    assert.equal(row(linkedBookingId)?.document_count, 1);
    assert.equal(row(dualLinkedBookingId)?.document_count, 1);
    assert.equal(row(otherAppointmentId)?.document_count, 1);
    assert.equal(Number(row(zeroBookingId)?.patient_id), testData.patientId);
    assert.equal(row(zeroBookingId)?.accession_number, `V2-${String(zeroBookingId).padStart(6, "0")}`);
    assert.equal(row(zeroBookingId)?.status, "completed");
    assert.equal(row(zeroBookingId)?.latest_document_at, null);
    assert.equal(typeof row(directBookingId)?.latest_document_at, "string");
  });

  it("returns active free-text MR protocol assignments in the worklist and detail read", async () => {
    guard();
    const mrModality = await pool.query<{ id: string }>("select id::text from modalities where upper(code) = 'MR' limit 1");
    assert.ok(mrModality.rows[0]?.id, "an MR modality is required for the regression fixture");
    const mrModalityId = Number(mrModality.rows[0].id);
    const examType = await pool.query<{ id: string }>(
      `
        insert into exam_types (modality_id, name_ar, name_en, code, is_active)
        values ($1, $2, $3, $4, true)
        returning id::text
      `,
      [mrModalityId, `${TEST_PREFIX} MR Exam`, `${TEST_PREFIX} MR Exam`, `${TEST_PREFIX}MR_EXAM`]
    );
    const bookingId = await createBooking(testData.patientId, mrModalityId, Number(examType.rows[0].id));
    const assignmentResult = await pool.query<{ id: string }>(
      `
        insert into appointment_protocol_assignments (
          appointment_id, protocol_id, protocol_version_id, free_text_protocol,
          assigned_by, assigned_at, status
        )
        values ($1, null, null, 'MRI brain with contrast', $2, now(), 'ASSIGNED')
        returning id::text
      `,
      [bookingId, testData.userId]
    );
    const assignmentId = Number(assignmentResult.rows[0].id);

    const worklist = await fetchJson<{ appointments: Array<Record<string, unknown>> }>(
      app.baseUrl,
      `/api/v2/read/modality/worklist?modalityId=${mrModalityId}&scope=all`,
      { cookie: authCookie }
    );
    const detail = await fetchJson<{ assignment: Record<string, unknown> | null }>(
      app.baseUrl,
      `/api/v2/read/modality/appointments/${bookingId}/protocol-assignment`,
      { cookie: authCookie }
    );

    assert.equal(worklist.status, 200);
    const row = worklist.data.appointments.find((appointment) => Number(appointment.id) === bookingId);
    assert.equal(Number(row?.protocol_assignment_id), assignmentId);
    assert.equal(row?.assigned_free_text_protocol, "MRI brain with contrast");
    assert.equal(detail.status, 200);
    assert.equal(Number(detail.data.assignment?.assignment_id), assignmentId);
    assert.equal(detail.data.assignment?.modality, "MRI");
    assert.equal(detail.data.assignment?.free_text_protocol, "MRI brain with contrast");
  });
});
