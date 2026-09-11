import { after, before, describe, it, type SuiteContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { pool } from "../db/pool.js";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { ingestMppsEvent } from "./mpps-service.js";
import { updateBookingStatusManual } from "../modules/appointments-v2/booking/services/status-booking.service.js";
import { createPendingReportingAssignmentIntent } from "../modules/doctor-portal/reporting-assignment-intents-service.js";
import { createComplementaryRecall, linkComplementaryRecallBooking } from "../modules/appointments-v2/recall/complementary-recall.service.js";
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
  let reportingDoctorId: number | null = null;
  let priorClinicalExportSettings: Array<{ setting_key: string; setting_value: unknown; updated_by_user_id: number | null }> = [];
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
    priorClinicalExportSettings = (await pool.query<{ setting_key: string; setting_value: unknown; updated_by_user_id: number | null }>(
      `select setting_key, setting_value, updated_by_user_id from system_settings where category = 'clinical_document_export'`
    )).rows;
    await pool.query(
      `insert into system_settings (category, setting_key, setting_value, updated_by_user_id) values ('clinical_document_export', 'enabled', '{"value":"enabled"}'::jsonb, $1), ('clinical_document_export', 'destination_key', '{"value":"MPPS_TEST_PACS"}'::jsonb, $1) on conflict (category, setting_key) do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()`,
      [testData.userId]
    );
    await pool.query("update modalities set name_en = 'Computed tomography' where id = $1", [testData.modalityId]);
    reportingDoctorId = Number((await pool.query<{ id: number }>(
      `
        insert into doctor_portal.doctor_profiles (user_id, display_name, doctor_role, active, can_finalize_reports)
        values ($1, 'MPPS Test Reporting Doctor', 'consultant', true, true)
        returning id
      `,
      [testData.userId]
    )).rows[0]!.id);
    await pool.query(
      `insert into doctor_portal.doctor_modality_permissions (doctor_id, modality_id, can_report, active) values ($1, $2, true, true)`,
      [reportingDoctorId, testData.modalityId]
    );
    await pool.query<{ id: number }>(
      `
        insert into doctor_portal.reporting_board_saved_views (
          owner_user_id, owner_doctor_id, name, token, filters_json, notification_settings_json,
          created_by_user_id, updated_by_user_id
        )
        values ($1, $2, 'MPPS test reporting view', $3, '{}'::jsonb, '{"notifyAssignedToMe":true}'::jsonb, $1, $1)
        returning id
      `,
      [testData.userId, reportingDoctorId, `mpps-test-${randomUUID()}`]
    );

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
    const suiteBookingRows = await pool.query<{ id: number }>(
      `
        select b.id
        from appointments_v2.bookings b
        join appointments_v2.policy_versions pv on pv.id = b.policy_version_id
        join appointments_v2.policy_sets ps on ps.id = pv.policy_set_id
        where ps.key like 'mpps%'
      `
    );
    const allBookingIds = [...new Set([...bookingIds, ...suiteBookingRows.rows.map((row) => Number(row.id))])];
    if (allBookingIds.length) {
      await pool.query(`delete from mpps_event_log where correlated_appointment_id = any($1::bigint[])`, [allBookingIds]);
      await pool.query(`delete from appointment_protocol_assignments where appointment_id = any($1::bigint[])`, [allBookingIds]);
      await pool.query(
        `delete from appointments_v2.complementary_recall_contact_attempts where recall_request_id in (select id from appointments_v2.complementary_recall_requests where original_appointment_id = any($1::bigint[]) or recall_appointment_id = any($1::bigint[]))`,
        [allBookingIds]
      );
      await pool.query(
        `delete from appointments_v2.complementary_recall_requests where original_appointment_id = any($1::bigint[]) or recall_appointment_id = any($1::bigint[])`,
        [allBookingIds]
      );
      await pool.query(`delete from appointments_v2.special_quota_consumptions where booking_id = any($1::bigint[])`, [allBookingIds]);
      await pool.query(`delete from clinical_document_exports where appointment_id = any($1::bigint[])`, [allBookingIds]);
      await pool.query(`delete from document_appointment_links where appointment_id = any($1::bigint[])`, [allBookingIds]);
      await pool.query(`delete from documents where v2_booking_id = any($1::bigint[])`, [allBookingIds]);
      await pool.query(`delete from doctor_portal.reporting_assignment_intents where appointment_id = any($1::bigint[])`, [allBookingIds]);
      await pool.query(`delete from doctor_portal.case_team_assignments where appointment_id = any($1::bigint[])`, [allBookingIds]);
      await pool.query(`delete from appointments_v2.bookings where id = any($1::bigint[])`, [allBookingIds]);
    }
    const suiteUserRows = await pool.query<{ id: number }>(`select id from users where username like 'mpps%'`);
    const suiteUserIds = suiteUserRows.rows.map((row) => Number(row.id));
    if (suiteUserIds.length) {
      const suiteDoctorRows = await pool.query<{ id: number }>(
        `select id from doctor_portal.doctor_profiles where user_id = any($1::bigint[])`,
        [suiteUserIds]
      );
      const suiteDoctorIds = suiteDoctorRows.rows.map((row) => Number(row.id));
      if (suiteDoctorIds.length) {
        const suiteSavedViewRows = await pool.query<{ id: number }>(
          `select id from doctor_portal.reporting_board_saved_views where owner_user_id = any($1::bigint[]) or owner_doctor_id = any($2::bigint[]) or target_doctor_id = any($2::bigint[])`,
          [suiteUserIds, suiteDoctorIds]
        );
        const suiteSavedViewIds = suiteSavedViewRows.rows.map((row) => Number(row.id));
        if (suiteSavedViewIds.length) {
          await pool.query(`delete from doctor_portal.reporting_board_notification_events where saved_view_id = any($1::bigint[])`, [suiteSavedViewIds]);
          await pool.query(`delete from doctor_portal.reporting_board_saved_views where id = any($1::bigint[])`, [suiteSavedViewIds]);
        }
        await pool.query(`delete from doctor_portal.case_team_assignments where assigned_doctor_id = any($1::bigint[])`, [suiteDoctorIds]);
        await pool.query(`delete from doctor_portal.doctor_modality_permissions where doctor_id = any($1::bigint[])`, [suiteDoctorIds]);
        await pool.query(`delete from doctor_portal.doctor_profiles where id = any($1::bigint[])`, [suiteDoctorIds]);
      }
    }
    await pool.query(`delete from system_settings where category = 'clinical_document_export'`);
    for (const setting of priorClinicalExportSettings) {
      await pool.query(
        `insert into system_settings (category, setting_key, setting_value, updated_by_user_id) values ('clinical_document_export', $1, $2::jsonb, $3)`,
        [setting.setting_key, JSON.stringify(setting.setting_value), setting.updated_by_user_id]
      );
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

  async function transaction<T>(run: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await run(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function createPendingReportingIntent(bookingId: number): Promise<void> {
    await pool.query("update appointments_v2.bookings set requires_report = true where id = $1", [bookingId]);
    await transaction((client) => createPendingReportingAssignmentIntent(client, {
      bookingId,
      intendedDoctorId: reportingDoctorId!,
      actor: { userId: testData.userId, role: "supervisor" },
      reason: "MPPS integration test",
      createdFromContext: "mpps_integration_test",
    }));
  }

  async function createLinkedRecall(recallBookingId: number): Promise<{ originalBookingId: number; recallId: number }> {
    const originalBookingId = await createBooking("completed");
    const recall = await transaction((client) => createComplementaryRecall(client, {
      originalAppointmentId: originalBookingId,
      receptionInstruction: null,
      technologistInstruction: "Repeat acquisition for MPPS integration test",
      reasonCode: "technical_equipment_problem",
      qaClassification: "technical_repeat",
      urgency: "routine",
      dueAt: null,
      reportingDisposition: "supplement_original_report",
      originalReportDependency: "imaging_completed",
      notifyOnImagingCompleted: true,
      requestedByUserId: testData.userId,
    }));
    await transaction((client) => linkComplementaryRecallBooking(client, recall, recallBookingId, testData.userId));
    await pool.query(
      `insert into doctor_portal.case_team_assignments (appointment_id, assigned_doctor_id, modality_id, assignment_type, status) values ($1, $2, $3, 'reporting', 'active')`,
      [originalBookingId, reportingDoctorId, testData.modalityId]
    );
    return { originalBookingId, recallId: Number(recall.id) };
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

  it("claims acquisition authority for MPPS starts and PACS-started bookings without overwriting manual protection", async () => {
    const mppsFirstId = await createBooking("waiting");
    await ingestMppsEvent(createPayload(mppsFirstId, `1.2.826.${mppsFirstId}.authority-first`));
    const mppsFirst = await pool.query<{
      status: string;
      acquisition_status_source: string | null;
      pacs_auto_completion_disabled_at: Date | null;
      pacs_auto_completion_disabled_by_user_id: number | null;
    }>(`select status, acquisition_status_source, pacs_auto_completion_disabled_at, pacs_auto_completion_disabled_by_user_id from appointments_v2.bookings where id = $1`, [mppsFirstId]);
    assert.equal(mppsFirst.rows[0]?.status, "in-progress");
    assert.equal(mppsFirst.rows[0]?.acquisition_status_source, "mpps");
    assert.ok(mppsFirst.rows[0]?.pacs_auto_completion_disabled_at);
    assert.equal(mppsFirst.rows[0]?.pacs_auto_completion_disabled_by_user_id, null);

    const pacsFirstId = await createBooking("in-progress");
    await pool.query(`update appointments_v2.bookings set acquisition_status_source = 'pacs' where id = $1`, [pacsFirstId]);
    await ingestMppsEvent(createPayload(pacsFirstId, `1.2.826.${pacsFirstId}.authority-pacs`));
    const pacsFirst = await pool.query<{ status: string; acquisition_status_source: string | null; pacs_auto_completion_disabled_at: Date | null }>(
      `select status, acquisition_status_source, pacs_auto_completion_disabled_at from appointments_v2.bookings where id = $1`, [pacsFirstId]
    );
    const claims = await pool.query<{ count: string }>(
      `select count(*)::text as count from audit_log where entity_type = 'appointment_v2_booking' and entity_id = $1 and action_type = 'mpps_acquisition_claim'`, [pacsFirstId]
    );
    assert.equal(pacsFirst.rows[0]?.status, "in-progress");
    assert.equal(pacsFirst.rows[0]?.acquisition_status_source, "mpps");
    assert.ok(pacsFirst.rows[0]?.pacs_auto_completion_disabled_at);
    assert.equal(claims.rows[0]?.count, "1");

    const manuallyProtectedId = await createBooking("in-progress");
    await pool.query(
      `update appointments_v2.bookings set acquisition_status_source = 'pacs', pacs_auto_completion_disabled_at = '2030-01-02T03:04:05Z', pacs_auto_completion_disabled_by_user_id = $2, pacs_auto_completion_disabled_reason = 'Manual override preserved' where id = $1`,
      [manuallyProtectedId, testData.userId]
    );
    await ingestMppsEvent(createPayload(manuallyProtectedId, `1.2.826.${manuallyProtectedId}.authority-manual`));
    const manuallyProtected = await pool.query<{ acquisition_status_source: string | null; disabled_at: Date | null; disabled_by: number | null; disabled_reason: string | null }>(
      `select acquisition_status_source, pacs_auto_completion_disabled_at as disabled_at, pacs_auto_completion_disabled_by_user_id as disabled_by, pacs_auto_completion_disabled_reason as disabled_reason from appointments_v2.bookings where id = $1`,
      [manuallyProtectedId]
    );
    assert.equal(manuallyProtected.rows[0]?.acquisition_status_source, "mpps");
    assert.equal(manuallyProtected.rows[0]?.disabled_at?.toISOString(), "2030-01-02T03:04:05.000Z");
    assert.equal(Number(manuallyProtected.rows[0]?.disabled_by), Number(testData.userId));
    assert.equal(manuallyProtected.rows[0]?.disabled_reason, "Manual override preserved");
  });

  it("permanently disables PACS tracking when staff changes a PACS-owned in-progress booking", async () => {
    const bookingId = await createBooking("in-progress");
    await pool.query(`update appointments_v2.bookings set acquisition_status_source = 'pacs' where id = $1`, [bookingId]);

    await updateBookingStatusManual(bookingId, "waiting", null, testData.userId, "supervisor");

    const booking = await pool.query<{
      status: string;
      acquisition_status_source: string | null;
      pacs_auto_completion_disabled_at: Date | null;
      pacs_auto_completion_disabled_by_user_id: number | null;
      pacs_auto_completion_disabled_reason: string | null;
    }>(
      `select status, acquisition_status_source, pacs_auto_completion_disabled_at, pacs_auto_completion_disabled_by_user_id, pacs_auto_completion_disabled_reason from appointments_v2.bookings where id = $1`,
      [bookingId]
    );
    assert.equal(booking.rows[0]?.status, "waiting");
    assert.equal(booking.rows[0]?.acquisition_status_source, "pacs");
    assert.ok(booking.rows[0]?.pacs_auto_completion_disabled_at);
    assert.equal(Number(booking.rows[0]?.pacs_auto_completion_disabled_by_user_id), Number(testData.userId));
    assert.match(booking.rows[0]?.pacs_auto_completion_disabled_reason || "", /staff manually changed/);
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

  it("runs canonical completion bookkeeping and post-commit effects", async () => {
    const bookingId = await createBooking("in-progress");
    const { originalBookingId, recallId } = await createLinkedRecall(bookingId);
    await createPendingReportingIntent(bookingId);
    const documentId = Number((await pool.query<{ id: number }>(
      `insert into documents (patient_id, v2_booking_id, document_type, original_filename, stored_path, mime_type, file_size, source) values ($1, $2, 'clinical_document', $3, $4, 'application/pdf', 10, 'manual_upload') returning id`,
      [testData.patientId, bookingId, `mpps-${bookingId}.pdf`, `tests/${PREFIX}${bookingId}.pdf`]
    )).rows[0]!.id);
    const mppsInstanceUid = `1.2.826.${bookingId}.canonical-complete`;

    await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));
    const completed = await ingestMppsEvent({
      eventType: "n-set",
      sourceAeTitle: "CT_AE",
      mppsInstanceUid,
      performedStepStatus: "COMPLETED",
      studyInstanceUid: `1.2.826.${bookingId}.completed-study`,
      performedEndDate: "20260911",
      performedEndTime: "094501",
      rawDatasetJson: { PerformedProcedureStepStatus: "COMPLETED" },
    });

    const booking = await pool.query<{ status: string; completed_at: Date | null; updated_by_user_id: number | null }>(
      `select status, completed_at, updated_by_user_id from appointments_v2.bookings where id = $1`,
      [bookingId]
    );
    const event = await pool.query<{ processing_status: string }>(
      `select processing_status from mpps_event_log where mpps_instance_uid = $1 and event_type = 'n-set'`,
      [mppsInstanceUid]
    );
    const audit = await pool.query<{ entity_type: string; action_type: string; new_values: Record<string, unknown> }>(
      `select entity_type, action_type, new_values from audit_log where entity_id = $1 and action_type = 'mpps_status_update' order by id desc limit 1`,
      [bookingId]
    );
    const recall = await pool.query<{ status: string; recall_appointment_id: number | null }>(
      `select status, recall_appointment_id from appointments_v2.complementary_recall_requests where id = $1`,
      [recallId]
    );
    const intent = await pool.query<{ status: string; activated_assignment_id: number | null }>(
      `select status, activated_assignment_id from doctor_portal.reporting_assignment_intents where appointment_id = $1`,
      [bookingId]
    );
    const assignedNotifications = await pool.query(
      `select id from doctor_portal.reporting_board_notification_events where appointment_id = $1 and event_type = 'reporting_case_assigned_to_me'`,
      [bookingId]
    );
    const additionalImagingNotifications = await pool.query(
      `select id from doctor_portal.reporting_board_notification_events where appointment_id = $1 and event_type = 'additional_imaging_completed'`,
      [bookingId]
    );
    const clinicalExports = await pool.query<{ destination_key: string; status: string }>(
      `select destination_key, status from clinical_document_exports where appointment_id = $1 and document_id = $2`,
      [bookingId, documentId]
    );

    assert.equal(completed.processingStatus, "processed");
    assert.equal(booking.rows[0]?.status, "completed");
    assert.ok(booking.rows[0]?.completed_at);
    assert.equal(booking.rows[0]?.updated_by_user_id, null);
    assert.equal(event.rows[0]?.processing_status, "processed");
    assert.equal(recall.rows[0]?.status, "completed");
    assert.equal(Number(recall.rows[0]?.recall_appointment_id), bookingId);
    assert.equal(intent.rows[0]?.status, "activated");
    assert.ok(intent.rows[0]?.activated_assignment_id);
    assert.ok(assignedNotifications.rows.length >= 1);
    assert.ok(additionalImagingNotifications.rows.length >= 1);
    assert.equal(clinicalExports.rows.length, 1);
    assert.equal(clinicalExports.rows[0]?.destination_key, "orthanc_remote:MPPS_TEST_PACS");
    assert.equal(clinicalExports.rows[0]?.status, "pending");
    assert.equal(audit.rows[0]?.entity_type, "appointment_v2_booking");
    assert.equal(audit.rows[0]?.action_type, "mpps_status_update");
    assert.equal(audit.rows[0]?.new_values.mppsPerformedStepStatus, "COMPLETED");
    assert.equal(audit.rows[0]?.new_values.mppsInstanceUid, mppsInstanceUid);
    assert.equal(await getBookingStatus(originalBookingId), "completed");
  });

  it("preserves an existing completed_at when MPPS completes a booking", async () => {
    const bookingId = await createBooking("in-progress");
    await pool.query(`update appointments_v2.bookings set completed_at = '2030-01-02T03:04:05Z' where id = $1`, [bookingId]);
    const before = await pool.query<{ completed_at: Date }>(`select completed_at from appointments_v2.bookings where id = $1`, [bookingId]);
    const mppsInstanceUid = `1.2.826.${bookingId}.existing-completed-at`;

    await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));
    await ingestMppsEvent({
      eventType: "n-set",
      sourceAeTitle: "CT_AE",
      mppsInstanceUid,
      performedStepStatus: "COMPLETED",
      rawDatasetJson: {},
    });

    const after = await pool.query<{ completed_at: Date }>(`select completed_at from appointments_v2.bookings where id = $1`, [bookingId]);
    assert.equal(after.rows[0]?.completed_at.getTime(), before.rows[0]?.completed_at.getTime());
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

  it("runs canonical discontinuation bookkeeping for MPPS", async () => {
    const bookingId = await createBooking("in-progress");
    const { recallId } = await createLinkedRecall(bookingId);
    await createPendingReportingIntent(bookingId);
    const logicalKey = randomUUID();
    const quotaRule = await pool.query<{ id: number }>(
      `insert into appointments_v2.special_quota_rules (logical_key, policy_version_id, modality_id, daily_extra_slots, is_active) values ($1, $2, $3, 1, true) returning id`,
      [logicalKey, testData.policyVersionId, testData.modalityId]
    );
    await pool.query(
      `insert into appointments_v2.special_quota_rule_exam_types (quota_rule_id, exam_type_id) values ($1, $2)`,
      [quotaRule.rows[0]!.id, testData.examTypeId]
    );
    await pool.query(
      `insert into appointments_v2.special_quota_consumptions (booking_id, quota_rule_id, quota_logical_key, policy_version_id, booking_date, exam_type_id, consumed_by_user_id) values ($1, $2, $3, $4, current_date, $5, $6)`,
      [bookingId, quotaRule.rows[0]!.id, logicalKey, testData.policyVersionId, testData.examTypeId, testData.userId]
    );
    const mppsInstanceUid = `1.2.826.${bookingId}.canonical-discontinued`;

    await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));
    const discontinued = await ingestMppsEvent({
      eventType: "n-set",
      sourceAeTitle: "CT_AE",
      mppsInstanceUid,
      performedStepStatus: "DISCONTINUED",
      discontinuationReason: "Patient unable to continue",
      rawDatasetJson: { PerformedProcedureStepStatus: "DISCONTINUED" },
    });

    const consumption = await pool.query<{ released_at: Date | null; released_by_user_id: number | null; release_reason: string | null }>(
      `select released_at, released_by_user_id, release_reason from appointments_v2.special_quota_consumptions where booking_id = $1`,
      [bookingId]
    );
    const recall = await pool.query<{ status: string; recall_appointment_id: number | null }>(
      `select status, recall_appointment_id from appointments_v2.complementary_recall_requests where id = $1`,
      [recallId]
    );
    const intent = await pool.query<{ status: string; cancelled_reason: string | null }>(
      `select status, cancelled_reason from doctor_portal.reporting_assignment_intents where appointment_id = $1`,
      [bookingId]
    );
    const event = await pool.query<{ processing_status: string }>(
      `select processing_status from mpps_event_log where mpps_instance_uid = $1 and event_type = 'n-set'`,
      [mppsInstanceUid]
    );

    assert.equal(discontinued.processingStatus, "processed");
    assert.equal(await getBookingStatus(bookingId), "discontinued");
    assert.ok(consumption.rows[0]?.released_at);
    assert.equal(consumption.rows[0]?.released_by_user_id, null);
    assert.equal(consumption.rows[0]?.release_reason, "discontinued");
    assert.equal(recall.rows[0]?.status, "pending_scheduling");
    assert.equal(recall.rows[0]?.recall_appointment_id, null);
    assert.equal(intent.rows[0]?.status, "cancelled");
    assert.equal(event.rows[0]?.processing_status, "processed");
  });

  it("rolls back an MPPS completion when a terminal side effect fails", async () => {
    const bookingId = await createBooking("in-progress");
    await createLinkedRecall(bookingId);
    const mppsInstanceUid = `1.2.826.${bookingId}.terminal-rollback`;
    await ingestMppsEvent(createPayload(bookingId, mppsInstanceUid));

    await pool.query(`
      create or replace function mpps_test_fail_recall_completion()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.status = 'completed' then
          raise exception 'mpps test terminal side effect failure';
        end if;
        return new;
      end;
      $$
    `);
    await pool.query(`drop trigger if exists mpps_test_fail_recall_completion on appointments_v2.complementary_recall_requests`);
    await pool.query(`create trigger mpps_test_fail_recall_completion before update on appointments_v2.complementary_recall_requests for each row execute function mpps_test_fail_recall_completion()`);

    try {
      await assert.rejects(
        () => ingestMppsEvent({
          eventType: "n-set",
          sourceAeTitle: "CT_AE",
          mppsInstanceUid,
          performedStepStatus: "COMPLETED",
          rawDatasetJson: {},
        }),
        /mpps test terminal side effect failure/
      );
    } finally {
      await pool.query(`drop trigger if exists mpps_test_fail_recall_completion on appointments_v2.complementary_recall_requests`);
      await pool.query(`drop function if exists mpps_test_fail_recall_completion()`);
    }

    assert.equal(await getBookingStatus(bookingId), "in-progress");
    const event = await pool.query(
      `select id from mpps_event_log where mpps_instance_uid = $1 and event_type = 'n-set'`,
      [mppsInstanceUid]
    );
    assert.equal(event.rows.length, 0);
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
