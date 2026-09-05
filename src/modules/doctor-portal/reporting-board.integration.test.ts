import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.OHIF_ENABLED = "true";

const skipEnv = !(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL) ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "RBIT_";

type Pool = typeof import("../../db/pool.js").pool;
type ReportState = "final" | "draft" | "no_report" | "study_not_found" | "unavailable";

interface TestUser {
  id: number;
  doctorId: number;
  cookie: string;
}

interface BookingInput {
  modalityId: number;
  examTypeId: number;
  priorityId?: number | null;
  date: string;
  time?: string | null;
  requiresReport?: boolean;
  status?: string;
  completedAt?: string | null;
  category?: string;
  patientName?: string;
}

let pool: Pool;
let createTestAuthCookie: typeof import("../appointments-v2/tests/integration/helpers.js").createTestAuthCookie;
let fetchJson: typeof import("../appointments-v2/tests/integration/helpers.js").fetchJson;
let canReachDatabase: typeof import("../appointments-v2/tests/integration/helpers.js").canReachDatabase;
let app: { baseUrl: string; close: () => Promise<void> };
let reportingBoardService: typeof import("./reporting-board-service.js");
let ohifViewerService: typeof import("../ohif-viewer/service.js");
let comparisonRequestService: typeof import("../../services/comparison-request-service.js");
let sonicDicomCacheService: typeof import("../../services/reporting-board-sonicdicom-cache-service.js");

let originalReportingBoardSetting: unknown = null;
let policyVersionId = 0;
let policySetId = 0;
let ctModalityId = 0;
let mrModalityId = 0;
let usModalityId = 0;
let ctExamTypeId = 0;
let mrExamTypeId = 0;
let usExamTypeId = 0;
let statPriorityId = 0;
let urgentPriorityId = 0;
let routinePriorityId = 0;
let admin: TestUser;
let supervisor: TestUser;
let doctor: TestUser;
let otherDoctor: TestUser;
let targetDoctor: TestUser;
let noFinalizeDoctor: TestUser;
let noMrPermissionDoctor: TestUser;
let inactiveDoctor: TestUser;
let receptionistCookie = "";
class DurableCacheStatusMap extends Map<number, ReportState | "throw"> {
  private pending: Promise<void>[] = [];
  override set(appointmentId: number, state: ReportState | "throw"): this {
    super.set(appointmentId, state);
    this.pending.push(seedSonicDicomCache(appointmentId, state));
    return this;
  }
  async flush(): Promise<void> { await Promise.all(this.pending.splice(0)); }
}
const statusByAppointmentId = new DurableCacheStatusMap();

function uniq(label: string) {
  return `${TEST_PREFIX}${label}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function addDays(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createDoctorUser(
  label: string,
  role: "doctor" | "supervisor" | "super_admin",
  options: {
    active?: boolean;
    canFinalizeReports?: boolean;
    canSupervise?: boolean;
    canReportModalities?: number[];
  }
): Promise<TestUser> {
  const username = uniq(label).toLowerCase();
  const userResult = await pool.query<{ id: string }>(
    `
      insert into users (username, password_hash, full_name, role, is_active)
      values ($1, '$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS', $2, $3, true)
      returning id::text as id
    `,
    [username, `${TEST_PREFIX}${label}`, role]
  );
  const userId = Number(userResult.rows[0].id);
  const profileResult = await pool.query<{ id: string }>(
    `
      insert into doctor_portal.doctor_profiles (
        user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise
      )
      values ($1, $2, 'consultant', $3, $4, true, $5)
      returning id::text as id
    `,
    [
      userId,
      `${TEST_PREFIX}${label}`,
      options.active ?? true,
      options.canFinalizeReports ?? true,
      options.canSupervise ?? false,
    ]
  );
  const doctorId = Number(profileResult.rows[0].id);
  for (const modalityId of options.canReportModalities ?? [ctModalityId, mrModalityId]) {
    await pool.query(
      `
        insert into doctor_portal.doctor_modality_permissions (
          doctor_id, modality_id, can_protocol, can_report, can_supervise, active
        )
        values ($1, $2, true, true, true, true)
      `,
      [doctorId, modalityId]
    );
  }
  return { id: userId, doctorId, cookie: createTestAuthCookie(userId, role) };
}

async function createReceptionistCookie() {
  const username = uniq("receptionist").toLowerCase();
  const result = await pool.query<{ id: string }>(
    `
      insert into users (username, password_hash, full_name, role, is_active)
      values ($1, '$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS', $2, 'receptionist', true)
      returning id::text as id
    `,
    [username, `${TEST_PREFIX}Receptionist`]
  );
  return createTestAuthCookie(Number(result.rows[0].id), "receptionist");
}

async function getOrCreateModality(code: string, name: string): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `
      insert into modalities (code, name_ar, name_en, daily_capacity, is_active)
      values ($1, $2, $3, 20, true)
      on conflict (code) do update set is_active = true
      returning id::text as id
    `,
    [code, name, name]
  );
  return Number(result.rows[0].id);
}

async function createExamType(modalityId: number, label: string): Promise<number> {
  const code = uniq(`${label}_exam`);
  const result = await pool.query<{ id: string }>(
    `
      insert into exam_types (modality_id, name_ar, name_en, code, duration_minutes, is_active)
      values ($1, $2, $3, $4, 20, true)
      returning id::text as id
    `,
    [modalityId, `${TEST_PREFIX}${label} AR`, `${TEST_PREFIX}${label}`, code]
  );
  return Number(result.rows[0].id);
}

async function createPatient(label: string): Promise<number> {
  const nationalId = `9${randomUUID().replace(/-/g, "").slice(0, 11)}`;
  const name = `${TEST_PREFIX}${label}`;
  const result = await pool.query<{ id: string }>(
    `
      insert into patients (
        arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years,
        identifier_type, identifier_value
      )
      values ($1, $2, $3::varchar, $4, 'F', 40, 'national_id', $3::text)
      returning id::text as id
    `,
    [`${name} Arabic`, name, nationalId, name]
  );
  return Number(result.rows[0].id);
}

async function createPolicy() {
  const username = uniq("policy_user").toLowerCase();
  const userResult = await pool.query<{ id: string }>(
    `
      insert into users (username, password_hash, full_name, role, is_active)
      values ($1, '$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS', $2, 'supervisor', true)
      returning id::text as id
    `,
    [username, `${TEST_PREFIX}Policy User`]
  );
  const userId = Number(userResult.rows[0].id);
  const key = uniq("policy").toLowerCase();
  const policySetResult = await pool.query<{ id: string }>(
    `
      insert into appointments_v2.policy_sets (key, name, created_by_user_id)
      values ($1, $2, $3)
      returning id::text as id
    `,
    [key, `${TEST_PREFIX}Policy`, userId]
  );
  policySetId = Number(policySetResult.rows[0].id);
  const versionResult = await pool.query<{ id: string }>(
    `
      insert into appointments_v2.policy_versions (
        policy_set_id, version_no, status, config_hash, created_by_user_id, published_at, published_by_user_id
      )
      values ($1, 1, 'published', $2, $3, now(), $3)
      returning id::text as id
    `,
    [policySetId, `${key}_hash`, userId]
  );
  policyVersionId = Number(versionResult.rows[0].id);
}

async function createBooking(input: BookingInput): Promise<number> {
  const patientId = await createPatient(input.patientName ?? randomUUID().slice(0, 8));
  const result = await pool.query<{ id: string }>(
    `
      insert into appointments_v2.bookings (
        patient_id, modality_id, exam_type_id, reporting_priority_id,
        booking_date, booking_time, case_category, requires_report, study_instance_uid, status, notes,
        completed_at,
        policy_version_id, capacity_resolution_mode, uses_special_quota, special_reason_code, special_reason_note,
        is_walk_in, created_by_user_id, updated_by_user_id
      )
      values ($1, $2, $3, $4, $5::date, $6::time, $7, $8, null, $9, null,
        $10::timestamptz, $11, 'standard', false, null, null, false, $12, $12)
      returning id::text as id
    `,
    [
      patientId,
      input.modalityId,
      input.examTypeId,
      input.priorityId ?? null,
      input.date,
      input.time ?? "09:00",
      input.category ?? "oncology",
      input.requiresReport ?? true,
      input.status ?? "completed",
      input.completedAt === undefined ? "2026-05-01T08:00:00.000Z" : input.completedAt,
      policyVersionId,
      admin.id,
    ]
  );
  const bookingId = Number(result.rows[0].id);
  if ((input.status ?? "completed") === "completed" && (input.requiresReport ?? true)) await seedSonicDicomCache(bookingId, "draft");
  return bookingId;
}

async function createCandidateWindowFixture(input: {
  earlyDate: string;
  laterDate: string;
  finalCount: number;
  draftCount: number;
}): Promise<{ finalIds: number[]; draftIds: number[] }> {
  const fixtureKey = randomUUID().replace(/-/g, "").slice(0, 8);
  const totalCount = input.finalCount + input.draftCount;
  const result = await pool.query<{ appointment_id: string; report_status: "final" | "draft" }>(`
    with inserted_patients as (
      insert into patients (
        arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years,
        identifier_type, identifier_value
      )
      select
        $1 || ' window Arabic ' || fixture_index,
        $1 || ' window ' || fixture_index,
        $2 || lpad(fixture_index::text, 3, '0'),
        $1 || ' window ' || fixture_index,
        'F', 40, 'national_id', $2 || lpad(fixture_index::text, 3, '0')
      from generate_series(1, $3::integer) fixture_index
      returning id
    ), numbered_patients as (
      select id, row_number() over (order by id) as fixture_index
      from inserted_patients
    ), inserted_bookings as (
      insert into appointments_v2.bookings (
        patient_id, modality_id, exam_type_id, reporting_priority_id,
        booking_date, booking_time, case_category, requires_report, study_instance_uid, status, notes,
        completed_at, policy_version_id, capacity_resolution_mode, uses_special_quota, special_reason_code,
        special_reason_note, is_walk_in, created_by_user_id, updated_by_user_id
      )
      select
        patient.id, $4, $5, null,
        case when patient.fixture_index <= $6 then $7::date else $8::date end,
        '09:00'::time, 'oncology', true, null, 'completed', null,
        '2026-05-01T08:00:00.000Z'::timestamptz, $9, 'standard', false, null,
        null, false, $10, $10
      from numbered_patients patient
      returning id, booking_date
    ), seeded_cache as (
      insert into doctor_portal.reporting_board_sonicdicom_cache (
        appointment_id, report_status, report_final_at, source, last_success_at, last_attempt_at,
        next_check_at, status_changed_at, failure_count, accession_number_snapshot
      )
      select
        booking.id,
        case when booking.booking_date = $7::date then 'final' else 'draft' end,
        case when booking.booking_date = $7::date then now() else null end,
        'sonicdicom', now(), now(), now() + interval '1 hour', now(), 0,
        'V2-' || lpad(booking.id::text, 6, '0')
      from inserted_bookings booking
      returning appointment_id, report_status
    )
    select appointment_id::text, report_status
    from seeded_cache
    order by appointment_id
  `, [
    `${TEST_PREFIX}candidate_${fixtureKey}`,
    `8${fixtureKey}`,
    totalCount,
    ctModalityId,
    ctExamTypeId,
    input.finalCount,
    input.earlyDate,
    input.laterDate,
    policyVersionId,
    admin.id,
  ]);
  return {
    finalIds: result.rows.filter((row) => row.report_status === "final").map((row) => Number(row.appointment_id)),
    draftIds: result.rows.filter((row) => row.report_status === "draft").map((row) => Number(row.appointment_id)),
  };
}

async function seedSonicDicomCache(appointmentId: number, state: ReportState | "throw", finalAt: string | null = null): Promise<void> {
  if (!pool) return;
  const unavailable = state === "throw";
  await pool.query(`
    insert into doctor_portal.reporting_board_sonicdicom_cache (
      appointment_id, report_status, report_final_at, source, last_success_at, last_attempt_at, next_check_at, status_changed_at, failure_count, accession_number_snapshot
    ) values ($1::bigint, $2, $3, case when $4 then null else 'sonicdicom' end, case when $4 then null else now() end, now(), now() + interval '1 hour', now(), case when $4 then 1 else 0 end, ('V2-' || lpad(($1::bigint)::text, 6, '0')))
    on conflict (appointment_id) do update set
      report_status = excluded.report_status, report_final_at = excluded.report_final_at, source = excluded.source,
      last_success_at = excluded.last_success_at, last_attempt_at = now(), next_check_at = excluded.next_check_at,
      status_changed_at = now(), failure_count = excluded.failure_count
  `, [appointmentId, unavailable ? "unavailable" : state, finalAt, unavailable]);
}

async function patientIdForBooking(bookingId: number): Promise<number> {
  const result = await pool.query<{ patient_id: string }>(`select patient_id::text from appointments_v2.bookings where id = $1`, [bookingId]);
  return Number(result.rows[0].patient_id);
}

async function linkBookingToPatient(bookingId: number, sourceBookingId: number) {
  await pool.query(
    `update appointments_v2.bookings set patient_id = (select patient_id from appointments_v2.bookings where id = $2) where id = $1`,
    [bookingId, sourceBookingId]
  );
}

async function createComparisonRequestForBooking(bookingId: number, createdAt: string, reason: string): Promise<number> {
  const result = await pool.query<{ id: string }>(
    `
      insert into comparison_requests (
        patient_id,
        linked_previous_booking_id,
        linked_previous_study_uid,
        linked_previous_accession_number,
        linked_modality_id,
        linked_modality_code,
        linked_exam_type_id,
        linked_exam_name,
        linked_study_date,
        reason,
        status,
        materials_confirmed,
        materials_confirmed_by,
        materials_confirmed_at,
        image_availability_confirmed,
        documents_availability_confirmed,
        selected_prior_confirmed,
        created_by,
        created_at,
        updated_at
      )
      select
        b.patient_id,
        b.id,
        b.study_instance_uid,
        ('V2-' || lpad(b.id::text, 6, '0')),
        b.modality_id,
        m.code,
        b.exam_type_id,
        et.name_en,
        b.booking_date,
        $2,
        'ready_for_reporting',
        true,
        $3,
        $4::timestamptz,
        true,
        true,
        true,
        $3,
        $4::timestamptz,
        $4::timestamptz
      from appointments_v2.bookings b
      join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      where b.id = $1
      returning id::text as id
    `,
    [bookingId, reason, admin.id, createdAt]
  );
  return Number(result.rows[0].id);
}

async function setPatientIdentifierFields(bookingId: number, input: { mrn?: string | null; identifierValue?: string | null; nationalId?: string | null }) {
  await pool.query(
    `
      update patients
      set mrn = $2,
          identifier_value = $3,
          national_id = $4
      where id = (select patient_id from appointments_v2.bookings where id = $1)
    `,
    [bookingId, input.mrn ?? null, input.identifierValue ?? null, input.nationalId ?? null]
  );
}

async function insertPrimaryPatientIdentifier(bookingId: number, value: string) {
  const patientId = await patientIdForBooking(bookingId);
  const typeResult = await pool.query<{ id: string }>(
    `select id::text from patient_identifier_types where code = 'other' limit 1`
  );
  await pool.query(
    `
      insert into patient_identifiers (
        patient_id, identifier_type_id, value, normalized_value, is_primary, created_by_user_id, updated_by_user_id
      )
      values ($1, $2, $3, lower($3), true, $4, $4)
    `,
    [patientId, Number(typeResult.rows[0].id), value, admin.id]
  );
}

async function createSavedView(
  owner: TestUser,
  notifyAssignedToMe: boolean,
  filters: Record<string, unknown> = {}
): Promise<{ id: number; token: string }> {
  const response = await fetchJson<{ savedView: { id: number; token: string } }>(
    app.baseUrl,
    "/api/doctor/reporting-board/saved-views",
    {
      cookie: owner.cookie,
      method: "POST",
      body: {
        name: uniq("view"),
        filters,
        notificationSettings: { notifyAssignedToMe },
      },
    }
  );
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data.savedView;
}

async function getDoctorWorklist(
  owner: TestUser,
  notifyAssignedToMe: boolean
): Promise<{ id: number; token: string }> {
  const response = await api<{ worklist: { id: number; token: string } }>(
    owner.cookie,
    "/api/doctor/reporting-board/doctor-worklists/me"
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  await pool.query(
    `update doctor_portal.reporting_board_saved_views set notification_settings_json = jsonb_build_object('notifyAssignedToMe', $2::boolean) where id = $1`,
    [response.data.worklist.id, notifyAssignedToMe]
  );
  return response.data.worklist;
}

async function assignDirectly(appointmentId: number, doctorId: number, assignedAt?: string) {
  await pool.query(
    `
      insert into doctor_portal.case_team_assignments (
        appointment_id, roster_assignment_id, assigned_doctor_id, modality_id, assignment_type, expected_reporting_date, assigned_at, status
      )
      select id, null, $2, modality_id, 'reporting', booking_date, coalesce($3::timestamptz, now()), 'active'
      from appointments_v2.bookings
      where id = $1
    `,
    [appointmentId, doctorId, assignedAt ?? null]
  );
}

async function setExpectedReportingDate(appointmentId: number, expectedReportingDate: string) {
  await pool.query(
    `
      update doctor_portal.case_team_assignments
      set expected_reporting_date = $2::date
      where appointment_id = $1 and assignment_type = 'reporting' and status = 'active'
    `,
    [appointmentId, expectedReportingDate]
  );
}

async function assignComparisonDirectly(comparisonRequestId: number, doctorId: number) {
  await pool.query(`update doctor_portal.comparison_case_assignments set status = 'superseded', updated_at = now() where comparison_request_id = $1 and status = 'active'`, [comparisonRequestId]);
  await pool.query(
    `
      insert into doctor_portal.comparison_case_assignments (
        comparison_request_id, assigned_doctor_id, modality_id, assigned_by_user_id, assigned_by_doctor_id, reason
      )
      select id, $2, linked_modality_id, $3, $4, 'history test assignment'
      from comparison_requests
      where id = $1
    `,
    [comparisonRequestId, doctorId, admin.id, admin.doctorId]
  );
  await pool.query(`update comparison_requests set status = 'assigned', assigned_doctor_id = $2, updated_at = now() where id = $1`, [comparisonRequestId, doctorId]);
}

async function createDoctorPortalTestApp() {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const http = await import("node:http");
  const { createDoctorPortalRouter } = await import("./index.js");
  const { reportingBoardPublicRouter } = await import("./reporting-board-public-routes.js");
  const appInstance = express();
  appInstance.set("trust proxy", 1);
  appInstance.use(express.json({ limit: "10mb" }));
  appInstance.use(cookieParser());
  appInstance.use("/api/reporting", reportingBoardPublicRouter);
  appInstance.use("/api/doctor", createDoctorPortalRouter());
  appInstance.use((err: Error, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
    res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: err.message });
  });
  const server = http.createServer(appInstance);
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 3000;
      resolve({ baseUrl: `http://localhost:${port}`, close: async () => { server.close(); } });
    });
  });
}

async function cleanup() {
  const userRows = await pool.query<{ id: string }>(`select id::text as id from users where username like $1`, [`${TEST_PREFIX.toLowerCase()}%`]);
  const userIds = userRows.rows.map((row) => Number(row.id));
  const doctorRows = await pool.query<{ id: string }>(`select id::text as id from doctor_portal.doctor_profiles where display_name like $1`, [`${TEST_PREFIX}%`]);
  const doctorIds = doctorRows.rows.map((row) => Number(row.id));
  const patientRows = await pool.query<{ id: string }>(`select id::text as id from patients where english_full_name like $1`, [`${TEST_PREFIX}%`]);
  const patientIds = patientRows.rows.map((row) => Number(row.id));
  const examRows = await pool.query<{ id: string }>(`select id::text as id from exam_types where name_en like $1`, [`${TEST_PREFIX}%`]);
  const examTypeIds = examRows.rows.map((row) => Number(row.id));
  const bookingRows = await pool.query<{ id: string }>(
    `select id::text as id from appointments_v2.bookings where patient_id = any($1::bigint[]) or coalesce(exam_type_id, -1) = any($2::bigint[])`,
    [patientIds, examTypeIds]
  );
  const bookingIds = bookingRows.rows.map((row) => Number(row.id));
  const comparisonRows = await pool.query<{ id: string }>(
    `select id::text as id from comparison_requests where patient_id = any($1::bigint[]) or linked_previous_booking_id = any($2::bigint[])`,
    [patientIds, bookingIds]
  ).catch(() => ({ rows: [] }));
  const comparisonRequestIds = comparisonRows.rows.map((row) => Number(row.id));
  const savedViewRows = await pool.query<{ id: string }>(
    `select id::text as id from doctor_portal.reporting_board_saved_views where owner_user_id = any($1::bigint[]) or owner_doctor_id = any($2::bigint[])`,
    [userIds, doctorIds]
  ).catch(() => ({ rows: [] }));
  const savedViewIds = savedViewRows.rows.map((row) => Number(row.id));

  await pool.query(`delete from doctor_portal.reporting_board_notification_events where recipient_user_id = any($1::bigint[]) or recipient_doctor_id = any($2::bigint[]) or appointment_id = any($3::bigint[]) or saved_view_id = any($4::bigint[]) or comparison_request_id = any($5::bigint[])`, [userIds, doctorIds, bookingIds, savedViewIds, comparisonRequestIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.reporting_board_saved_views where id = any($1::bigint[])`, [savedViewIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_module_audit_events where actor_user_id = any($1::bigint[]) or actor_doctor_id = any($2::bigint[]) or target_id in (select id from doctor_portal.case_team_assignments where appointment_id = any($3::bigint[]))`, [userIds, doctorIds, bookingIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.comparison_case_assignments where comparison_request_id = any($1::bigint[])`, [comparisonRequestIds]).catch(() => undefined);
  await pool.query(`delete from comparison_requests where id = any($1::bigint[])`, [comparisonRequestIds]).catch(() => undefined);
  await pool.query(`delete from appointments_v2.complementary_recall_contact_attempts where recall_request_id in (select id from appointments_v2.complementary_recall_requests where original_appointment_id = any($1::bigint[]) or recall_appointment_id = any($1::bigint[]))`, [bookingIds]).catch(() => undefined);
  await pool.query(`delete from appointments_v2.complementary_recall_requests where original_appointment_id = any($1::bigint[]) or recall_appointment_id = any($1::bigint[])`, [bookingIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.case_workload_units where appointment_id = any($1::bigint[])`, [bookingIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.case_team_assignments where appointment_id = any($1::bigint[])`, [bookingIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_modality_permissions where doctor_id = any($1::bigint[])`, [doctorIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_profiles where id = any($1::bigint[])`, [doctorIds]).catch(() => undefined);
  await pool.query(`delete from appointments_v2.bookings where id = any($1::bigint[])`, [bookingIds]).catch(() => undefined);
  await pool.query(`delete from appointments_v2.policy_sets where id = $1`, [policySetId]).catch(() => undefined);
  await pool.query(`delete from exam_types where id = any($1::bigint[])`, [examTypeIds]).catch(() => undefined);
  await pool.query(`delete from patients where id = any($1::bigint[])`, [patientIds]).catch(() => undefined);
  if (originalReportingBoardSetting) {
    await pool.query(
      `
        insert into system_settings (category, setting_key, setting_value)
        values ('doctor_portal_reporting_board', 'config', $1::jsonb)
        on conflict (category, setting_key)
        do update set setting_value = excluded.setting_value, updated_at = now()
      `,
      [JSON.stringify(originalReportingBoardSetting)]
    ).catch(() => undefined);
  }
  await pool.query(`delete from users where id = any($1::bigint[])`, [userIds]).catch(() => undefined);
}

const api = async <T = unknown>(cookie: string, path: string, options: { method?: string; body?: unknown } = {}) => {
  await statusByAppointmentId.flush();
  return fetchJson<T>(app.baseUrl, path, { cookie, ...options });
};

const rawApi = (cookie: string, path: string, headers: Record<string, string> = {}) =>
  fetch(`${app.baseUrl}${path}`, {
    headers: { Cookie: cookie, ...headers },
    redirect: "manual",
  });

async function withSonicDicomConfig(config: Record<string, unknown>, work: () => Promise<void>) {
  const stored = await pool.query<{ setting_value: unknown }>(
    `select setting_value from system_settings where category = 'sonicdicom_reports' and setting_key = 'config' limit 1`
  );
  const original = stored.rows[0]?.setting_value ?? null;
  await pool.query(
    `
      insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
      values ('sonicdicom_reports', 'config', $1::jsonb, $2)
      on conflict (category, setting_key)
      do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
    `,
    [JSON.stringify({ value: config }), admin.id]
  );
  try {
    await work();
  } finally {
    if (original === null) {
      await pool.query(`delete from system_settings where category = 'sonicdicom_reports' and setting_key = 'config'`);
    } else {
      await pool.query(
        `
          insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
          values ('sonicdicom_reports', 'config', $1::jsonb, $2)
          on conflict (category, setting_key)
          do update set setting_value = excluded.setting_value, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
        `,
        [JSON.stringify(original), admin.id]
      );
    }
  }
}

async function withReportingBoardCutoff(cutoffDate: string, work: () => Promise<void>) {
  const stored = await pool.query<{ setting_value: unknown }>(
    `select setting_value from system_settings where category = 'doctor_portal_reporting_board' and setting_key = 'config' limit 1`
  );
  await pool.query(
    `
      update system_settings
      set setting_value = jsonb_set(
        jsonb_set(setting_value, '{value,cutoffMode}', to_jsonb('fixed_date'::text), false),
        '{value,defaultCutoffDate}',
        to_jsonb($1::text),
        false
      )
      where category = 'doctor_portal_reporting_board' and setting_key = 'config'
    `,
    [cutoffDate]
  );
  try {
    await work();
  } finally {
    if (stored.rows[0]) {
      await pool.query(
        `
          update system_settings
          set setting_value = $1::jsonb
          where category = 'doctor_portal_reporting_board' and setting_key = 'config'
        `,
        [JSON.stringify(stored.rows[0].setting_value)]
      );
    }
  }
}

describe("Reporting Assignment Board DB-backed integration", { skip: skipEnv }, () => {
  before(async () => {
    const helpers = await import("../appointments-v2/tests/integration/helpers.js");
    const db = await import("../../db/pool.js");
    pool = db.pool;
    createTestAuthCookie = helpers.createTestAuthCookie;
    fetchJson = helpers.fetchJson;
    canReachDatabase = helpers.canReachDatabase;
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database is not reachable. Skipping Reporting Board integration tests.");
      return;
    }
    const tables = await pool.query(
      `
        select to_regclass('doctor_portal.reporting_board_saved_views') as saved_views,
               to_regclass('doctor_portal.reporting_board_notification_events') as notifications
      `
    );
    if (!tables.rows[0]?.saved_views || !tables.rows[0]?.notifications) {
      throw new Error("Reporting Board tables not found. Run migrations before integration tests.");
    }
    const stored = await pool.query<{ setting_value: unknown }>(
      `select setting_value from system_settings where category = 'doctor_portal_reporting_board' and setting_key = 'config' limit 1`
    );
    originalReportingBoardSetting = stored.rows[0]?.setting_value ?? null;
    reportingBoardService = await import("./reporting-board-service.js");
    ohifViewerService = await import("../ohif-viewer/service.js");
    comparisonRequestService = await import("../../services/comparison-request-service.js");
    sonicDicomCacheService = await import("../../services/reporting-board-sonicdicom-cache-service.js");
    reportingBoardService.__setReportingBoardAssignmentBatchCheckerForTest(async (contexts) => new Map(contexts.map((context) => {
      const state = statusByAppointmentId.get(context.bookingId) ?? "draft";
      return [context.bookingId, state === "throw"
        ? { state: "unavailable", canViewReport: false, source: "sonicdicom", reportFinalAt: null }
        : { state, canViewReport: state === "final", source: "sonicdicom", reportFinalAt: null }];
    })));
    await cleanup();
    ctModalityId = await getOrCreateModality("CT", "CT");
    mrModalityId = await getOrCreateModality("MR", "MR");
    usModalityId = await getOrCreateModality("US", "US");
    ctExamTypeId = await createExamType(ctModalityId, "CT Brain");
    mrExamTypeId = await createExamType(mrModalityId, "MR Brain");
    usExamTypeId = await createExamType(usModalityId, "US Abdomen");
    await createPolicy();
    const priorities = await pool.query<{ id: string; code: string }>(
      `select id::text as id, code from reporting_priorities where code = any($1::text[])`,
      [["stat", "urgent", "routine"]]
    );
    statPriorityId = Number(priorities.rows.find((row) => row.code === "stat")?.id);
    urgentPriorityId = Number(priorities.rows.find((row) => row.code === "urgent")?.id);
    routinePriorityId = Number(priorities.rows.find((row) => row.code === "routine")?.id);
    app = await createDoctorPortalTestApp();
    admin = await createDoctorUser("admin", "super_admin", { canSupervise: true, canReportModalities: [ctModalityId, mrModalityId, usModalityId] });
    supervisor = await createDoctorUser("supervisor", "supervisor", { canSupervise: true, canReportModalities: [ctModalityId, mrModalityId, usModalityId] });
    doctor = await createDoctorUser("doctor", "doctor", { canReportModalities: [ctModalityId, mrModalityId] });
    otherDoctor = await createDoctorUser("other", "doctor", { canReportModalities: [ctModalityId, mrModalityId] });
    targetDoctor = await createDoctorUser("target", "doctor", { canReportModalities: [ctModalityId, mrModalityId] });
    noFinalizeDoctor = await createDoctorUser("nofinalize", "doctor", { canFinalizeReports: false, canReportModalities: [ctModalityId, mrModalityId] });
    noMrPermissionDoctor = await createDoctorUser("nomr", "doctor", { canReportModalities: [ctModalityId] });
    inactiveDoctor = await createDoctorUser("inactive", "doctor", { active: false, canReportModalities: [ctModalityId, mrModalityId] });
    receptionistCookie = await createReceptionistCookie();
    await api(admin.cookie, "/api/doctor/reporting-board/settings", {
      method: "PUT",
      body: {
        cutoffMode: "fixed_date",
        defaultCutoffDate: addDays(-1),
        daysBack: 14,
        enabledModalityCodes: ["CT", "MR"],
        defaultRequiresReport: true,
        defaultReportStatusFilter: "required_not_final",
      },
    });
  });

  it("uses the protected automatic-assignment age order independently of the visible board sort", () => {
    guard();
    const row = (appointmentId: number, priority: string | null, completedAt: string | null, bookingDate: string, bookingTime: string | null) => ({
      appointmentId,
      reportingPriorityCode: priority,
      completedAt,
      bookingDate,
      bookingTime,
    }) as never;
    const routineOld = row(30, "routine", "2026-05-01T06:00:00.000Z", "2026-05-10", "09:00");
    const urgent = row(20, "urgent", "2026-05-03T06:00:00.000Z", "2026-05-10", "09:00");
    const stat = row(10, "stat", "2026-05-04T06:00:00.000Z", "2026-05-10", "09:00");
    const nullCompletedEarly = row(40, "routine", null, "2026-05-02", "07:00");
    const nullCompletedNoTime = row(50, "routine", null, "2026-05-02", null);
    const equalAgeHigherId = row(61, "routine", "2026-05-05T08:00:00.000Z", "2026-05-10", "09:00");
    const equalAgeLowerId = row(60, "routine", "2026-05-05T08:00:00.000Z", "2026-05-10", "09:00");

    assert.deepEqual(
      [routineOld, urgent, stat].sort(reportingBoardService.compareAutomaticAssignmentCandidates(true)).map((item: { appointmentId: number }) => item.appointmentId),
      [10, 20, 30]
    );
    assert.deepEqual(
      [routineOld, urgent, stat, nullCompletedEarly, nullCompletedNoTime, equalAgeHigherId, equalAgeLowerId]
        .sort(reportingBoardService.compareAutomaticAssignmentCandidates(false))
        .map((item: { appointmentId: number }) => item.appointmentId),
      [30, 50, 40, 20, 10, 60, 61]
    );
  });

  it("refreshes a stale SonicDICOM cache entry through the protected board scope", async () => {
    guard();
    const date = addDays(80);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Manual Sonic refresh" });
    statusByAppointmentId.set(appointmentId, "no_report");
    await seedSonicDicomCache(appointmentId, "final", "2026-05-01T08:00:00.000Z");

    const before = await api<{ cases: Array<{ appointmentId: number; reportStatus: string }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all`
    );
    assert.equal(before.status, 200, JSON.stringify(before.data));
    assert.equal(before.data.cases.find((row) => row.appointmentId === appointmentId)?.reportStatus, "final");

    const refresh = await api<{ checked: number; successful: number; failed: number }>(supervisor.cookie, "/api/doctor/reporting-board/refresh-sonicdicom", {
      method: "POST",
      body: { filters: { dateFrom: date, dateTo: date, reportStatus: "all" } },
    });
    assert.equal(refresh.status, 200, JSON.stringify(refresh.data));
    assert.equal(refresh.data.checked, 1);
    assert.equal(refresh.data.successful, 1);
    assert.equal(refresh.data.failed, 0);

    const after = await api<{ cases: Array<{ appointmentId: number; reportStatus: string }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all`
    );
    assert.equal(after.status, 200, JSON.stringify(after.data));
    assert.equal(after.data.cases.find((row) => row.appointmentId === appointmentId)?.reportStatus, "no_report");
    const cache = await pool.query<{ report_status: string; last_success_at: Date | null }>(
      `select report_status, last_success_at from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`,
      [appointmentId]
    );
    assert.equal(cache.rows[0]?.report_status, "no_report");
    assert.ok(cache.rows[0]?.last_success_at && cache.rows[0].last_success_at > new Date("2026-05-01T08:00:00.000Z"));
  });

  it("maps a trimmed case-insensitive SonicDICOM email while preserving the assigned doctor and schedules Final recheck near five minutes", async () => {
    guard();
    const date = addDays(84);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic finalizer mapping" });
    await assignDirectly(appointmentId, doctor.doctorId);
    const finalizerEmail = `rbit.finalizer.${randomUUID().slice(0, 8)}@nccb.ly`.toLowerCase();
    await pool.query(`update users set username = $2 where id = $1`, [otherDoctor.id, finalizerEmail]);
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(
      { bookingId: appointmentId, accessionNumber: `V2-${String(appointmentId).padStart(6, "0")}`, studyInstanceUid: "1.2.840.1", requiresReport: true, status: "completed" },
      { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-23T11:00:00.000Z", latestDocumentId: "501", finalizedByAccount: `  ${finalizerEmail.toUpperCase()}  `, correlationMethod: "study_instance_uid" }
    );

    const cached = await pool.query<{ finalized_by_doctor_id: string | null; sonicdicom_finalized_by_account: string | null; seconds_until_check: string }>(`
      select finalized_by_doctor_id::text, sonicdicom_finalized_by_account,
        extract(epoch from (next_check_at - last_attempt_at))::text as seconds_until_check
      from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1
    `, [appointmentId]);
    assert.equal(Number(cached.rows[0]?.finalized_by_doctor_id), otherDoctor.doctorId);
    assert.equal(cached.rows[0]?.sonicdicom_finalized_by_account, finalizerEmail.toUpperCase());
    assert.ok(Number(cached.rows[0]?.seconds_until_check) >= 299 && Number(cached.rows[0]?.seconds_until_check) <= 301);

    const response = await api<{ cases: Array<{ appointmentId: number; assignedDoctorId: number | null; finalizedByDoctorId: number | null; finalizedByDoctorName: string | null; sonicDicomFinalizedByAccount: string | null; sonicDicomLatestDocumentId: string | null; sonicDicomCorrelationMethod: string | null; assignmentMatch: string }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all`);
    const row = response.data.cases.find((item) => item.appointmentId === appointmentId);
    assert.equal(row?.assignedDoctorId, doctor.doctorId);
    assert.equal(row?.finalizedByDoctorId, otherDoctor.doctorId);
    assert.equal(row?.finalizedByDoctorName, `${TEST_PREFIX}other`);
    assert.equal(row?.sonicDicomFinalizedByAccount, finalizerEmail.toUpperCase());
    assert.equal(row?.sonicDicomLatestDocumentId, "501");
    assert.equal(row?.sonicDicomCorrelationMethod, "study_instance_uid");
    assert.equal(row?.assignmentMatch, "mismatch");
    const preserved = await pool.query<{ assigned_doctor_id: string; status: string; assignment_origin: string }>(`select assigned_doctor_id::text, status, assignment_origin from doctor_portal.case_team_assignments where appointment_id = $1 order by id`, [appointmentId]);
    assert.deepEqual(preserved.rows, [{ assigned_doctor_id: String(doctor.doctorId), status: "active", assignment_origin: "rispro" }]);
  });

  it("clears stale Final attribution on a successful newer Draft and replaces it on re-finalization", async () => {
    guard();
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(85), patientName: "Sonic reversible final" });
    const context = { bookingId: appointmentId, accessionNumber: `V2-${String(appointmentId).padStart(6, "0")}`, studyInstanceUid: "1.2.840.2", requiresReport: true, status: "completed" };
    const doctorAEmail = `rbit.a.${randomUUID().slice(0, 8)}@nccb.ly`;
    const doctorBEmail = `rbit.b.${randomUUID().slice(0, 8)}@nccb.ly`;
    await pool.query(`update users set username = case id when $1 then $3 else $4 end where id = any($2::bigint[])`, [doctor.id, [doctor.id, targetDoctor.id], doctorAEmail, doctorBEmail]);
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context, { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-23T10:00:00.000Z", latestDocumentId: "601", finalizedByAccount: doctorAEmail, correlationMethod: "study_instance_uid" });
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context, { state: "draft", canViewReport: false, source: "sonicdicom", reportFinalAt: null, latestDocumentId: "602", finalizedByAccount: null, correlationMethod: "study_instance_uid" });
    const draft = await pool.query<{ report_status: string; report_final_at: Date | null; sonicdicom_finalized_by_account: string | null; finalized_by_doctor_id: string | null; sonicdicom_latest_document_id: string | null }>(`select report_status, report_final_at, sonicdicom_finalized_by_account, finalized_by_doctor_id::text, sonicdicom_latest_document_id from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`, [appointmentId]);
    assert.deepEqual(draft.rows[0], { report_status: "draft", report_final_at: null, sonicdicom_finalized_by_account: null, finalized_by_doctor_id: null, sonicdicom_latest_document_id: "602" });

    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context, { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-23T11:00:00.000Z", latestDocumentId: "603", finalizedByAccount: doctorBEmail, correlationMethod: "study_instance_uid" });
    const refinal = await pool.query<{ report_final_at: Date | null; sonicdicom_finalized_by_account: string | null; finalized_by_doctor_id: string | null; sonicdicom_latest_document_id: string | null }>(`select report_final_at, sonicdicom_finalized_by_account, finalized_by_doctor_id::text, sonicdicom_latest_document_id from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`, [appointmentId]);
    assert.equal(refinal.rows[0]?.report_final_at?.toISOString(), "2026-08-23T11:00:00.000Z");
    assert.equal(refinal.rows[0]?.sonicdicom_finalized_by_account, doctorBEmail);
    assert.equal(Number(refinal.rows[0]?.finalized_by_doctor_id), targetDoctor.doctorId);
    assert.equal(refinal.rows[0]?.sonicdicom_latest_document_id, "603");
  });

  it("preserves unmapped raw accounts and last good attribution on outage, while manual Final creates no SonicDICOM finalizer", async () => {
    guard();
    const date = addDays(86);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic unmapped finalizer" });
    const context = { bookingId: appointmentId, accessionNumber: `V2-${String(appointmentId).padStart(6, "0")}`, studyInstanceUid: null, requiresReport: true, status: "completed" };
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context, { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-23T12:00:00.000Z", latestDocumentId: "701", finalizedByAccount: "Admin", correlationMethod: "accession_fallback" });
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context, null, new Error("SonicDICOM unavailable"));
    const retained = await pool.query<{ report_status: string; account: string | null; doctor_id: string | null }>(`select report_status, sonicdicom_finalized_by_account as account, finalized_by_doctor_id::text as doctor_id from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`, [appointmentId]);
    assert.deepEqual(retained.rows[0], { report_status: "final", account: "Admin", doctor_id: null });

    const manualId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Manual final no Sonic attribution" });
    await pool.query(`insert into doctor_portal.reporting_board_manual_final_overrides (appointment_id, reason, created_by_user_id, created_by_doctor_id) values ($1, 'manual test', $2, $3)`, [manualId, supervisor.id, supervisor.doctorId]);
    const response = await api<{ cases: Array<{ appointmentId: number; reportStatus: string; reportStatusSource: string | null; finalizedByDoctorId: number | null; sonicDicomFinalizedByAccount: string | null }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all`);
    const manual = response.data.cases.find((row) => row.appointmentId === manualId);
    assert.equal(manual?.reportStatus, "final");
    assert.equal(manual?.reportStatusSource, "manual");
    assert.equal(manual?.finalizedByDoctorId, null);
    assert.equal(manual?.sonicDicomFinalizedByAccount, null);
  });

  it("auto-assigns only mapped Sonic Final cases, preserves provenance through later mismatch and Draft, protects TAT, filters, audits, and stays notification-silent", async () => {
    guard();
    const date = addDays(87);
    const autoId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic auto owner", completedAt: "2026-08-20T08:00:00.000Z" });
    const finalizedUnassignedId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic finalized unassigned" });
    const unmappedId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic unmapped owner" });
    const draftId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic draft owner" });
    const unavailableId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic unavailable owner" });
    const manualFinalId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Manual final owner" });
    const doctorAEmail = `rbit.auto.a.${randomUUID().slice(0, 8)}@nccb.ly`;
    const doctorBEmail = `rbit.auto.b.${randomUUID().slice(0, 8)}@nccb.ly`;
    await pool.query(`update users set username = case id when $1 then $3 else $4 end where id = any($2::bigint[])`, [targetDoctor.id, [targetDoctor.id, otherDoctor.id], doctorAEmail, doctorBEmail]);
    const context = (appointmentId: number) => ({ bookingId: appointmentId, accessionNumber: `V2-${String(appointmentId).padStart(6, "0")}`, studyInstanceUid: `1.2.840.178.${appointmentId}`, requiresReport: true, status: "completed" });

    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context(autoId), { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-20T10:00:00.000Z", latestDocumentId: "17801", finalizedByAccount: doctorAEmail, correlationMethod: "study_instance_uid" });
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context(finalizedUnassignedId), { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-20T10:00:00.000Z", latestDocumentId: "17800", finalizedByAccount: doctorAEmail, correlationMethod: "study_instance_uid" });
    await pool.query(`update doctor_portal.case_team_assignments set status = 'cancelled', updated_at = now() where appointment_id = $1 and assignment_type = 'reporting' and status = 'active'`, [finalizedUnassignedId]);
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context(unmappedId), { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-20T10:00:00.000Z", latestDocumentId: "17802", finalizedByAccount: "unmapped.account@nccb.ly", correlationMethod: "study_instance_uid" });
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context(draftId), { state: "draft", canViewReport: false, source: "sonicdicom", reportFinalAt: null, latestDocumentId: "17803", finalizedByAccount: null, correlationMethod: "study_instance_uid" });
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context(unavailableId), null, new Error("Sonic unavailable"));
    await pool.query(`insert into doctor_portal.reporting_board_manual_final_overrides (appointment_id, reason, created_by_user_id, created_by_doctor_id) values ($1, 'manual only', $2, $3)`, [manualFinalId, supervisor.id, supervisor.doctorId]);

    const assignments = await pool.query<{ id: string; assigned_doctor_id: string; roster_assignment_id: string | null; assignment_origin: string; status: string }>(`select id::text, assigned_doctor_id::text, roster_assignment_id::text, assignment_origin, status from doctor_portal.case_team_assignments where appointment_id = any($1::bigint[]) order by appointment_id, id`, [[autoId, unmappedId, draftId, unavailableId, manualFinalId]]);
    assert.equal(assignments.rowCount, 1);
    assert.equal(Number(assignments.rows[0].assigned_doctor_id), targetDoctor.doctorId);
    assert.equal(assignments.rows[0].roster_assignment_id, null);
    assert.equal(assignments.rows[0].assignment_origin, "sonic_auto");
    assert.equal(assignments.rows[0].status, "active");

    const matched = await api<{ cases: Array<{ appointmentId: number; assignmentOrigin: string; assignmentMatch: string; completedToAssignedMinutes: number | null; assignedToFinalMinutes: number | null; completedToFinalMinutes: number | null }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all&finalizedByDoctorId=${targetDoctor.doctorId}&assignmentMatch=matched`);
    assert.deepEqual(matched.data.cases.map((row) => row.appointmentId), [autoId]);
    assert.equal(matched.data.cases[0].assignmentOrigin, "sonic_auto");
    assert.equal(matched.data.cases[0].assignmentMatch, "matched");
    assert.equal(matched.data.cases[0].completedToAssignedMinutes, null);
    assert.equal(matched.data.cases[0].assignedToFinalMinutes, null);
    assert.equal(matched.data.cases[0].completedToFinalMinutes, 120);

    const unmapped = await api<{ cases: Array<{ appointmentId: number }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all&assignmentMatch=unmapped_finalizer`);
    assert.deepEqual(unmapped.data.cases.map((row) => row.appointmentId), [unmappedId]);
    const finalizedUnassigned = await api<{ cases: Array<{ appointmentId: number; assignmentMatch: string }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all&assignmentMatch=finalized_unassigned`);
    assert.deepEqual(finalizedUnassigned.data.cases.map((row) => [row.appointmentId, row.assignmentMatch]), [[finalizedUnassignedId, "finalized_unassigned"]]);
    const audit = await pool.query<{ actor_user_id: string | null; actor_doctor_id: string | null; metadata_json: Record<string, unknown>; reason: string }>(`select actor_user_id::text, actor_doctor_id::text, metadata_json, reason from doctor_portal.doctor_module_audit_events where event_type = 'reporting_assignment_sonic_auto' and target_id = $1`, [Number(assignments.rows[0].id)]);
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].actor_user_id, null);
    assert.equal(audit.rows[0].actor_doctor_id, null);
    assert.equal(audit.rows[0].metadata_json.source, "sonicdicom");
    assert.equal(audit.rows[0].reason, "Auto-assigned from SonicDICOM finalizer on previously unassigned case");
    assert.equal((await pool.query(`select 1 from doctor_portal.reporting_board_notification_events where appointment_id = $1`, [autoId])).rowCount, 0);

    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context(autoId), { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-20T11:00:00.000Z", latestDocumentId: "17804", finalizedByAccount: doctorBEmail, correlationMethod: "study_instance_uid" });
    const mismatch = await api<{ cases: Array<{ appointmentId: number; assignedDoctorId: number; finalizedByDoctorId: number; assignmentMatch: string }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all&assignmentMatch=mismatch`);
    const mismatchRow = mismatch.data.cases.find((row) => row.appointmentId === autoId);
    assert.equal(mismatchRow?.assignedDoctorId, targetDoctor.doctorId);
    assert.equal(mismatchRow?.finalizedByDoctorId, otherDoctor.doctorId);
    assert.equal(mismatchRow?.assignmentMatch, "mismatch");
    assert.equal((await pool.query(`select count(*)::int as count from doctor_portal.case_team_assignments where appointment_id = $1 and assignment_type = 'reporting'`, [autoId])).rows[0].count, 1);
    const mismatchStats = await api<{ summary: { total: number } }>(supervisor.cookie, `/api/doctor/reporting-board/stats?dateFrom=${date}&dateTo=${date}&reportStatus=all&assignmentMatch=mismatch`);
    assert.equal(mismatchStats.data.summary.total, 1);

    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context(autoId), { state: "draft", canViewReport: false, source: "sonicdicom", reportFinalAt: null, latestDocumentId: "17805", finalizedByAccount: null, correlationMethod: "study_instance_uid" });
    assert.equal((await pool.query(`select 1 from doctor_portal.case_team_assignments where appointment_id = $1 and assigned_doctor_id = $2 and assignment_origin = 'sonic_auto' and status = 'active'`, [autoId, targetDoctor.doctorId])).rowCount, 1);
    const draftBoard = await api<{ cases: Array<{ appointmentId: number; reportStatus: string }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all`);
    assert.equal(draftBoard.data.cases.find((row) => row.appointmentId === autoId)?.reportStatus, "draft");
    assert.equal(draftBoard.data.cases.find((row) => row.appointmentId === manualFinalId)?.reportStatus, "final");
  });

  it("lets an in-flight manual assignment win before Sonic auto-assignment rechecks the active row", async () => {
    guard();
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(88), patientName: "Manual race winner" });
    const email = `rbit.race.${randomUUID().slice(0, 8)}@nccb.ly`;
    await pool.query(`update users set username = $2 where id = $1`, [targetDoctor.id, email]);
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`select id from appointments_v2.bookings where id = $1 for update`, [appointmentId]);
      await client.query(`insert into doctor_portal.case_team_assignments (appointment_id, roster_assignment_id, assigned_doctor_id, modality_id, assignment_type, expected_reporting_date, status) select id, null, $2, modality_id, 'reporting', booking_date, 'active' from appointments_v2.bookings where id = $1`, [appointmentId, doctor.doctorId]);
      const sonic = sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(
        { bookingId: appointmentId, accessionNumber: `V2-${String(appointmentId).padStart(6, "0")}`, studyInstanceUid: "1.2.840.178.race", requiresReport: true, status: "completed" },
        { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-20T12:00:00.000Z", latestDocumentId: "17899", finalizedByAccount: email, correlationMethod: "study_instance_uid" }
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      await client.query("commit");
      await sonic;
    } finally {
      await client.query("rollback").catch(() => null);
      client.release();
    }
    const rows = await pool.query<{ assigned_doctor_id: string; assignment_origin: string; status: string }>(`select assigned_doctor_id::text, assignment_origin, status from doctor_portal.case_team_assignments where appointment_id = $1 order by id`, [appointmentId]);
    assert.deepEqual(rows.rows, [{ assigned_doctor_id: String(doctor.doctorId), assignment_origin: "rispro", status: "active" }]);
    assert.equal((await pool.query(`select 1 from doctor_portal.doctor_module_audit_events where event_type = 'reporting_assignment_sonic_auto' and metadata_json->>'appointmentId' = $1`, [String(appointmentId)])).rowCount, 0);
  });

  it("reconciles one current SonicDICOM mismatch while preserving assignment history, audit, cache, and post-hoc TAT", async () => {
    guard();
    const date = addDays(89);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic manual reconciliation", completedAt: "2026-08-20T08:00:00.000Z" });
    await assignDirectly(appointmentId, doctor.doctorId);
    const finalizerEmail = `rbit.reconcile.${randomUUID().slice(0, 8)}@nccb.ly`;
    await pool.query(`update users set username = $2 where id = $1`, [targetDoctor.id, finalizerEmail]);
    const context = { bookingId: appointmentId, accessionNumber: `V2-${String(appointmentId).padStart(6, "0")}`, studyInstanceUid: `1.2.840.178.reconcile.${appointmentId}`, requiresReport: true, status: "completed" as const };
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(context, { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-20T10:00:00.000Z", latestDocumentId: "17901", finalizedByAccount: finalizerEmail, correlationMethod: "study_instance_uid" });

    const stale = await api(supervisor.cookie, `/api/doctor/reporting-board/cases/${appointmentId}/reconcile-finalizer-assignment`, { method: "POST", body: { expectedAssignedDoctorId: doctor.doctorId, expectedSonicDicomLatestDocumentId: "stale" } });
    assert.equal(stale.status, 409);
    assert.match(JSON.stringify(stale.data), /SonicDICOM report changed/);

    const result = await api<{ previousAssignmentId: number; newAssignmentId: number; finalizedDoctorId: number }>(supervisor.cookie, `/api/doctor/reporting-board/cases/${appointmentId}/reconcile-finalizer-assignment`, { method: "POST", body: { expectedAssignedDoctorId: doctor.doctorId, expectedSonicDicomLatestDocumentId: "17901" } });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.finalizedDoctorId, targetDoctor.doctorId);
    const assignments = await pool.query<{ id: string; assigned_doctor_id: string; assignment_origin: string; status: string }>(`select id::text, assigned_doctor_id::text, assignment_origin, status from doctor_portal.case_team_assignments where appointment_id = $1 and assignment_type = 'reporting' order by id`, [appointmentId]);
    assert.deepEqual(assignments.rows.map((row) => ({ assigned_doctor_id: row.assigned_doctor_id, assignment_origin: row.assignment_origin, status: row.status })), [
      { assigned_doctor_id: String(doctor.doctorId), assignment_origin: "rispro", status: "corrected" },
      { assigned_doctor_id: String(targetDoctor.doctorId), assignment_origin: "sonic_reconciled", status: "active" },
    ]);
    const board = await api<{ cases: Array<{ assignmentMatch: string; assignmentOrigin: string; completedToAssignedMinutes: number | null; assignedToFinalMinutes: number | null }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all&assignmentMatch=matched`);
    assert.deepEqual(board.data.cases.map((row) => row.assignmentMatch), ["matched"]);
    assert.equal(board.data.cases[0].assignmentOrigin, "sonic_reconciled");
    assert.equal(board.data.cases[0].completedToAssignedMinutes, null);
    assert.equal(board.data.cases[0].assignedToFinalMinutes, null);
    const audit = await pool.query<{ actor_user_id: string; actor_doctor_id: string; metadata_json: Record<string, unknown>; reason: string }>(`select actor_user_id::text, actor_doctor_id::text, metadata_json, reason from doctor_portal.doctor_module_audit_events where event_type = 'reporting_assignment_sonic_reconciled' and target_id = $1`, [result.data.newAssignmentId]);
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].actor_user_id, String(supervisor.id));
    assert.equal(audit.rows[0].actor_doctor_id, String(supervisor.doctorId));
    assert.equal(audit.rows[0].metadata_json.previousDoctorId, doctor.doctorId);
    assert.equal(audit.rows[0].metadata_json.finalizedDoctorId, targetDoctor.doctorId);
    assert.equal(audit.rows[0].metadata_json.sonicDicomLatestDocumentId, "17901");
    assert.equal(audit.rows[0].reason, "Reporting assignment reconciled to SonicDICOM finalizer");
    assert.equal((await pool.query(`select 1 from doctor_portal.reporting_board_notification_events where appointment_id = $1`, [appointmentId])).rowCount, 0);
    assert.equal((await pool.query(`select report_status from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`, [appointmentId])).rows[0].report_status, "final");
  });

  it("queues every eligible SonicDICOM cache row without clearing cached statuses or calling SonicDICOM", async () => {
    guard();
    const date = addDays(82);
    const finalId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "full-resync final" });
    const draftId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "full-resync draft" });
    const noReportId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "full-resync none" });
    const missingId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "full-resync missing" });
    const incompleteId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, status: "scheduled", patientName: "full-resync scheduled" });
    const noRequirementId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, requiresReport: false, patientName: "full-resync not-required" });
    const manualId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "full-resync manual" });
    await seedSonicDicomCache(finalId, "final", "2026-05-01T08:00:00.000Z");
    await seedSonicDicomCache(draftId, "draft");
    await seedSonicDicomCache(noReportId, "no_report");
    await pool.query(`delete from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`, [missingId]);
    await pool.query(`insert into doctor_portal.reporting_board_manual_final_overrides (appointment_id, reason, created_by_user_id, created_by_doctor_id) values ($1, 'test override', $2, $3)`, [manualId, supervisor.id, supervisor.doctorId]);

    const denied = await api(doctor.cookie, "/api/doctor/reporting-board/resync-sonicdicom", { method: "POST" });
    assert.equal(denied.status, 403, JSON.stringify(denied.data));
    const response = await api<{ ok: boolean; queued: number; requestedAt: string }>(supervisor.cookie, "/api/doctor/reporting-board/resync-sonicdicom", { method: "POST" });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.ok, true);
    assert.ok(response.data.queued >= 4);
    assert.ok(response.data.requestedAt);

    const deniedStatus = await api(doctor.cookie, `/api/doctor/reporting-board/resync-sonicdicom/status?requestedAt=${encodeURIComponent(response.data.requestedAt)}`);
    assert.equal(deniedStatus.status, 403, JSON.stringify(deniedStatus.data));
    const initialStatus = await api<{ remaining: number; failed: number }>(supervisor.cookie, `/api/doctor/reporting-board/resync-sonicdicom/status?requestedAt=${encodeURIComponent(response.data.requestedAt)}`);
    assert.equal(initialStatus.status, 200, JSON.stringify(initialStatus.data));
    assert.equal(initialStatus.data.remaining, response.data.queued);
    assert.equal(initialStatus.data.failed, 0);

    const rows = await pool.query<{ appointment_id: string; report_status: string; marker: boolean }>(`
      select appointment_id::text, report_status, next_check_at = $2::timestamptz as marker
      from doctor_portal.reporting_board_sonicdicom_cache
      where appointment_id = any($1::bigint[])
    `, [[finalId, draftId, noReportId, missingId, incompleteId, noRequirementId, manualId], response.data.requestedAt]);
    const byId = new Map(rows.rows.map((row) => [Number(row.appointment_id), row]));
    assert.deepEqual([finalId, draftId, noReportId, missingId].map((id) => byId.get(id)?.marker), [true, true, true, true]);
    assert.deepEqual([byId.get(finalId)?.report_status, byId.get(draftId)?.report_status, byId.get(noReportId)?.report_status, byId.get(missingId)?.report_status], ["final", "draft", "no_report", "unavailable"]);
    assert.equal(byId.has(incompleteId), false);
    assert.equal(byId.has(noRequirementId), false);
    assert.equal(byId.has(manualId), true);
    assert.equal(byId.get(manualId)?.marker, false);

    await pool.query(`update doctor_portal.reporting_board_sonicdicom_cache set next_check_at = now() + interval '1 hour', last_attempt_at = now(), last_error = case when appointment_id = $2 then 'SonicDICOM unavailable' else null end where appointment_id = any($1::bigint[])`, [[finalId, draftId], draftId]);
    const progressed = await api<{ remaining: number; failed: number }>(supervisor.cookie, `/api/doctor/reporting-board/resync-sonicdicom/status?requestedAt=${encodeURIComponent(response.data.requestedAt)}`);
    assert.equal(progressed.status, 200, JSON.stringify(progressed.data));
    assert.equal(progressed.data.remaining, initialStatus.data.remaining - 2);
    assert.equal(progressed.data.failed, 1);
  });

  it("preserves a successful cached status when manual SonicDICOM refresh is unavailable", async () => {
    guard();
    const date = addDays(81);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Manual Sonic failure" });
    await seedSonicDicomCache(appointmentId, "no_report");
    Map.prototype.set.call(statusByAppointmentId, appointmentId, "throw");

    const refresh = await api<{ checked: number; successful: number; failed: number }>(supervisor.cookie, "/api/doctor/reporting-board/refresh-sonicdicom", {
      method: "POST",
      body: { filters: { dateFrom: date, dateTo: date, reportStatus: "all" } },
    });
    assert.equal(refresh.status, 200, JSON.stringify(refresh.data));
    assert.equal(refresh.data.checked, 1);
    assert.equal(refresh.data.successful, 0);
    assert.equal(refresh.data.failed, 1);

    const after = await api<{ cases: Array<{ appointmentId: number; reportStatus: string }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all`
    );
    assert.equal(after.status, 200, JSON.stringify(after.data));
    assert.equal(after.data.cases.find((row) => row.appointmentId === appointmentId)?.reportStatus, "no_report");
  });

  it("refreshes only the requested Reporting Board appointment and retains cached status when SonicDICOM is unavailable", async () => {
    guard();
    const date = addDays(83);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "single Sonic refresh" });
    const otherAppointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "other Sonic refresh" });
    await seedSonicDicomCache(appointmentId, "final", "2026-05-01T08:00:00.000Z");
    await seedSonicDicomCache(otherAppointmentId, "final", "2026-05-01T08:00:00.000Z");
    Map.prototype.set.call(statusByAppointmentId, appointmentId, "no_report");
    Map.prototype.set.call(statusByAppointmentId, otherAppointmentId, "draft");

    const denied = await api(receptionistCookie, `/api/doctor/reporting-board/cases/${appointmentId}/refresh-sonicdicom`, { method: "POST" });
    assert.equal(denied.status, 403, JSON.stringify(denied.data));
    const noReport = await api<{ ok: boolean; appointmentId: number; successful: boolean; previousStatus: string; reportStatus: string; changed: boolean; cachedStatusRetained: boolean; checkedAt: string }>(supervisor.cookie, `/api/doctor/reporting-board/cases/${appointmentId}/refresh-sonicdicom`, { method: "POST" });
    assert.equal(noReport.status, 200, JSON.stringify(noReport.data));
    assert.deepEqual(noReport.data, { ok: true, appointmentId, successful: true, previousStatus: "final", reportStatus: "no_report", changed: true, cachedStatusRetained: false, checkedAt: noReport.data.checkedAt });

    const other = await pool.query<{ report_status: string }>(`select report_status from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`, [otherAppointmentId]);
    assert.equal(other.rows[0]?.report_status, "final");

    await seedSonicDicomCache(appointmentId, "final", "2026-05-01T08:00:00.000Z");
    Map.prototype.set.call(statusByAppointmentId, appointmentId, "draft");
    const draft = await api<{ successful: boolean; reportStatus: string; changed: boolean }>(supervisor.cookie, `/api/doctor/reporting-board/cases/${appointmentId}/refresh-sonicdicom`, { method: "POST" });
    assert.equal(draft.status, 200, JSON.stringify(draft.data));
    assert.equal(draft.data.reportStatus, "draft");
    assert.equal(draft.data.changed, true);

    await seedSonicDicomCache(appointmentId, "final", "2026-05-01T08:00:00.000Z");
    Map.prototype.set.call(statusByAppointmentId, appointmentId, "final");
    const unchanged = await api<{ successful: boolean; reportStatus: string; changed: boolean }>(supervisor.cookie, `/api/doctor/reporting-board/cases/${appointmentId}/refresh-sonicdicom`, { method: "POST" });
    assert.equal(unchanged.status, 200, JSON.stringify(unchanged.data));
    assert.equal(unchanged.data.successful, true);
    assert.equal(unchanged.data.reportStatus, "final");
    assert.equal(unchanged.data.changed, false);

    Map.prototype.set.call(statusByAppointmentId, appointmentId, "throw");
    const unavailable = await api<{ successful: boolean; reportStatus: string; changed: boolean; cachedStatusRetained: boolean }>(supervisor.cookie, `/api/doctor/reporting-board/cases/${appointmentId}/refresh-sonicdicom`, { method: "POST" });
    assert.equal(unavailable.status, 200, JSON.stringify(unavailable.data));
    assert.deepEqual({ successful: unavailable.data.successful, reportStatus: unavailable.data.reportStatus, changed: unavailable.data.changed, cachedStatusRetained: unavailable.data.cachedStatusRetained }, { successful: false, reportStatus: "final", changed: false, cachedStatusRetained: true });
  });

  it("keeps primary and comparison Sonic observations independent, including reassignment history", async () => {
    guard();
    const date = addDays(84);
    const label = uniq("comparison_sonic_cache");
    const source = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: label });
    const comparison = await createComparisonRequestForBooking(source, `${date}T10:00:00.000Z`, label);
    await assignComparisonDirectly(comparison, targetDoctor.doctorId);
    const firstAssignment = await pool.query<{ id: string }>(`select id::text from doctor_portal.comparison_case_assignments where comparison_request_id = $1 and status = 'active'`, [comparison]);
    const firstAssignmentId = Number(firstAssignment.rows[0].id);
    await pool.query(`
      update doctor_portal.reporting_board_sonicdicom_cache
      set report_status = 'final', report_final_at = now(), sonicdicom_latest_document_id = 'Document-A',
          sonicdicom_finalized_by_account = 'primary@nccb.ly', source = 'sonicdicom', last_success_at = now()
      where appointment_id = $1
    `, [source]);
    await pool.query(`
      insert into doctor_portal.comparison_sonicdicom_cache (
        comparison_assignment_id, comparison_request_id, report_status, sonicdicom_report_no, sonicdicom_document_id,
        sonicdicom_account, last_success_at, last_attempt_at, next_check_at
      ) values ($1, $2, 'draft', 9284, 'Document-B', $3, now(), now(), now() + interval '1 hour')
    `, [firstAssignmentId, comparison, (await pool.query<{ username: string }>(`select username from users where id = $1`, [targetDoctor.id])).rows[0].username]);

    const initial = await api<{ cases: Array<{ caseType: string; appointmentId: number; comparisonRequestId: number | null; reportStatus: string; reportStatusSource: string | null; sonicDicomLatestDocumentId: string | null }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?q=${encodeURIComponent(label)}&caseSource=all&reportStatus=all&limit=20`
    );
    assert.equal(initial.status, 200, JSON.stringify(initial.data));
    const primary = initial.data.cases.find((row) => row.caseType === "appointment" && row.appointmentId === source);
    const comparisonRow = initial.data.cases.find((row) => row.comparisonRequestId === comparison);
    assert.deepEqual(
      { status: primary?.reportStatus, source: primary?.reportStatusSource, document: primary?.sonicDicomLatestDocumentId },
      { status: "final", source: "sonicdicom", document: "Document-A" }
    );
    assert.deepEqual(
      { status: comparisonRow?.reportStatus, source: comparisonRow?.reportStatusSource, document: comparisonRow?.sonicDicomLatestDocumentId },
      { status: "draft", source: "sonicdicom", document: "Document-B" }
    );
    const unfinishedPrimary = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?q=${encodeURIComponent(label)}&caseSource=appointments&reportStatus=required_not_final&limit=20`
    );
    assert.equal(unfinishedPrimary.data.cases.some((row) => row.appointmentId === source), false);

    await pool.query(`update doctor_portal.comparison_sonicdicom_cache set report_status = 'final', report_final_at = now(), updated_at = now() where comparison_assignment_id = $1`, [firstAssignmentId]);
    const finalized = await api<{ cases: Array<{ comparisonRequestId: number | null; reportStatus: string; reportStatusSource: string | null }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?q=${encodeURIComponent(label)}&caseSource=comparisons&reportStatus=all&limit=20`
    );
    const finalizedRow = finalized.data.cases.find((row) => row.comparisonRequestId === comparison);
    assert.deepEqual({ comparisonRequestId: finalizedRow?.comparisonRequestId, reportStatus: finalizedRow?.reportStatus, reportStatusSource: finalizedRow?.reportStatusSource }, { comparisonRequestId: comparison, reportStatus: "final", reportStatusSource: "sonicdicom" });

    const unfinishedComparison = await api<{ cases: Array<{ comparisonRequestId: number | null; reportStatus: string }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?q=${encodeURIComponent(label)}&caseSource=comparisons&reportStatus=required_not_final&limit=20`
    );
    assert.equal(unfinishedComparison.status, 200, JSON.stringify(unfinishedComparison.data));
    const unfinishedComparisonRow = unfinishedComparison.data.cases.find((row) => row.comparisonRequestId === comparison);
    assert.deepEqual(
      { comparisonRequestId: unfinishedComparisonRow?.comparisonRequestId, reportStatus: unfinishedComparisonRow?.reportStatus },
      { comparisonRequestId: comparison, reportStatus: "final" }
    );

    await assignComparisonDirectly(comparison, otherDoctor.doctorId);
    const secondAssignment = await pool.query<{ id: string }>(`select id::text from doctor_portal.comparison_case_assignments where comparison_request_id = $1 and status = 'active'`, [comparison]);
    const secondAssignmentId = Number(secondAssignment.rows[0].id);
    await pool.query(`
      insert into doctor_portal.comparison_sonicdicom_cache (
        comparison_assignment_id, comparison_request_id, report_status, sonicdicom_report_no, sonicdicom_document_id,
        sonicdicom_account, last_success_at, last_attempt_at, next_check_at
      ) values ($1, $2, 'draft', 9284, 'Document-C', 'other@nccb.ly', now(), now(), now() + interval '1 hour')
    `, [secondAssignmentId, comparison]);
    const reassigned = await api<{ cases: Array<{ comparisonRequestId: number | null; reportStatus: string; sonicDicomLatestDocumentId: string | null }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?q=${encodeURIComponent(label)}&caseSource=comparisons&reportStatus=all&limit=20`
    );
    const reassignedRow = reassigned.data.cases.find((row) => row.comparisonRequestId === comparison);
    assert.deepEqual({ comparisonRequestId: reassignedRow?.comparisonRequestId, reportStatus: reassignedRow?.reportStatus, sonicDicomLatestDocumentId: reassignedRow?.sonicDicomLatestDocumentId }, { comparisonRequestId: comparison, reportStatus: "draft", sonicDicomLatestDocumentId: "Document-C" });
    assert.equal((await pool.query(`select count(*)::int as count from doctor_portal.comparison_sonicdicom_cache where comparison_request_id = $1 and sonicdicom_document_id = any($2::text[])`, [comparison, ["Document-B", "Document-C"]])).rows[0].count, 2);
    assert.equal((await pool.query<{ sonicdicom_latest_document_id: string }>(`select sonicdicom_latest_document_id from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`, [source])).rows[0].sonicdicom_latest_document_id, "Document-A");
  });

  it("keeps manual final authoritative through resync and exposes the current cache only after explicit clearing", async () => {
    guard();
    const date = addDays(85);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: uniq("manual_final_resync") });
    await pool.query(`update doctor_portal.reporting_board_sonicdicom_cache set report_status = 'draft', next_check_at = now() + interval '2 hours' where appointment_id = $1`, [appointmentId]);
    await pool.query(`insert into doctor_portal.reporting_board_manual_final_overrides (appointment_id, reason, created_by_user_id, created_by_doctor_id) values ($1, 'manual survives Sonic resync', $2, $3)`, [appointmentId, supervisor.id, supervisor.doctorId]);
    const comparisonId = await createComparisonRequestForBooking(appointmentId, `${date}T10:00:00.000Z`, "manual-final comparison resync");
    await assignComparisonDirectly(comparisonId, targetDoctor.doctorId);
    const requestedAt = new Date().toISOString();
    const queued = await sonicDicomCacheService.queueFullReportingBoardSonicDicomResync(requestedAt);
    assert.ok(queued >= 1);
    const queuedComparison = await pool.query<{ comparison_request_id: string }>(
      `select comparison_request_id::text from doctor_portal.comparison_sonicdicom_cache where comparison_request_id = $1 and next_check_at = $2::timestamptz`,
      [comparisonId, requestedAt]
    );
    assert.equal(Number(queuedComparison.rows[0]?.comparison_request_id), comparisonId);
    assert.ok((await sonicDicomCacheService.getFullReportingBoardSonicDicomResyncStatus(requestedAt)).remaining >= 1);
    assert.equal((await pool.query(`select count(*)::int as count from doctor_portal.reporting_board_manual_final_overrides where appointment_id = $1 and cleared_at is null`, [appointmentId])).rows[0].count, 1);
    const protectedRow = await api<{ cases: Array<{ caseType: string; appointmentId: number; reportStatus: string; reportStatusSource: string | null }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all`);
    const protectedCase = protectedRow.data.cases.find((row) => row.caseType === "appointment" && row.appointmentId === appointmentId);
    assert.deepEqual({ appointmentId: protectedCase?.appointmentId, reportStatus: protectedCase?.reportStatus, reportStatusSource: protectedCase?.reportStatusSource }, { appointmentId, reportStatus: "final", reportStatusSource: "manual" });
    await seedSonicDicomCache(appointmentId, "draft");
    const stillManual = await api<{ cases: Array<{ caseType: string; appointmentId: number; reportStatus: string; reportStatusSource: string | null }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all`);
    const stillManualCase = stillManual.data.cases.find((row) => row.caseType === "appointment" && row.appointmentId === appointmentId);
    assert.deepEqual({ appointmentId: stillManualCase?.appointmentId, reportStatus: stillManualCase?.reportStatus, reportStatusSource: stillManualCase?.reportStatusSource }, { appointmentId, reportStatus: "final", reportStatusSource: "manual" });
    const cleared = await api(supervisor.cookie, `/api/doctor/reporting-board/cases/${appointmentId}/clear-manual-final`, { method: "POST", body: { reason: "restore Sonic observation" } });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.data));
    const restored = await api<{ cases: Array<{ caseType: string; appointmentId: number; reportStatus: string; reportStatusSource: string | null }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all`);
    const restoredCase = restored.data.cases.find((row) => row.caseType === "appointment" && row.appointmentId === appointmentId);
    assert.deepEqual({ appointmentId: restoredCase?.appointmentId, reportStatus: restoredCase?.reportStatus, reportStatusSource: restoredCase?.reportStatusSource }, { appointmentId, reportStatus: "draft", reportStatusSource: "sonicdicom" });
  });

  it("keeps tombstoned comparison documents as history, selects replacements, and restores the distinct primary", async () => {
    guard();
    const date = addDays(86);
    const source = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: uniq("comparison_tombstone") });
    const comparison = await createComparisonRequestForBooking(source, `${date}T10:00:00.000Z`, "tombstone replacement lifecycle");
    await assignComparisonDirectly(comparison, targetDoctor.doctorId);
    const assignmentId = Number((await pool.query<{ id: string }>(`select id::text from doctor_portal.comparison_case_assignments where comparison_request_id = $1 and status = 'active'`, [comparison])).rows[0].id);
    const username = (await pool.query<{ username: string }>(`select username from users where id = $1`, [targetDoctor.id])).rows[0].username;
    const primary = { bookingId: source, accessionNumber: `V2-${String(source).padStart(6, "0")}`, studyInstanceUid: null, requiresReport: true, status: "completed", assigned: false, priorityCode: null, cacheStatus: "draft" as const, lastSuccessAt: null };
    const comparisonCandidate = { ...primary, comparisonAssignmentId: assignmentId, comparisonRequestId: comparison, assignedDoctorUsername: username, assignedAt: `${date}T10:00:00.000Z`, storedDocumentId: null, primaryDocumentId: "A", primaryCachedReportStatus: "draft", primaryManualFinal: false };
    let documents = [
      { reportNo: 9284, documentId: "B", account: username, statusCode: 7, updatedAt: `${date}T11:00:00.000Z` },
      { reportNo: 9284, documentId: "A", account: "primary@nccb.ly", statusCode: 6, updatedAt: `${date}T09:00:00.000Z` },
    ];
    sonicDicomCacheService.__setReportingBoardSonicDicomReadersForTest({
      checkStatusesBatch: async (contexts) => new Map(contexts.map((context) => [context.bookingId, { state: "draft" as const, canViewReport: false, source: "sonicdicom" as const, reportFinalAt: null, latestDocumentId: "B", finalizedByAccount: null, correlationMethod: "study_instance_uid" as const }])),
      fetchDocumentHistoriesBatch: async (contexts) => new Map(contexts.map((context) => [context.lookupKey, { foundStudy: true, foundReport: true, reportNo: 9284, correlationMethod: "study_instance_uid" as const, documents }])),
    });
    try {
      await sonicDicomCacheService.refreshReportingBoardSonicDicomCacheCandidates([primary], [comparisonCandidate]);
      let cache = await pool.query<{ report_status: string; sonicdicom_document_id: string; sonicdicom_status_code: number; removed_at: string | null }>(`select c.report_status, c.sonicdicom_document_id, c.sonicdicom_status_code, h.removed_at from doctor_portal.comparison_sonicdicom_cache c join doctor_portal.comparison_sonicdicom_documents h on h.comparison_assignment_id = c.comparison_assignment_id and h.sonicdicom_document_id = c.sonicdicom_document_id where c.comparison_assignment_id = $1`, [assignmentId]);
      assert.deepEqual(cache.rows[0] && { status: cache.rows[0].report_status, document: cache.rows[0].sonicdicom_document_id, statusCode: cache.rows[0].sonicdicom_status_code, removed: Boolean(cache.rows[0].removed_at) }, { status: "no_report", document: "B", statusCode: 7, removed: true });
      assert.equal((await pool.query<{ sonicdicom_latest_document_id: string }>(`select sonicdicom_latest_document_id from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`, [source])).rows[0].sonicdicom_latest_document_id, "A");

      documents = [{ reportNo: 9284, documentId: "C", account: username, statusCode: 1, updatedAt: `${date}T12:00:00.000Z` }, ...documents];
      await sonicDicomCacheService.refreshReportingBoardSonicDicomCacheCandidates([primary], [{ ...comparisonCandidate, storedDocumentId: "B" }]);
      cache = await pool.query<{ report_status: string; sonicdicom_document_id: string; sonicdicom_status_code: number; removed_at: string | null }>(`select c.report_status, c.sonicdicom_document_id, c.sonicdicom_status_code, h.removed_at from doctor_portal.comparison_sonicdicom_cache c left join doctor_portal.comparison_sonicdicom_documents h on h.comparison_assignment_id = c.comparison_assignment_id and h.sonicdicom_document_id = c.sonicdicom_document_id where c.comparison_assignment_id = $1`, [assignmentId]);
      assert.deepEqual({ status: cache.rows[0]?.report_status, document: cache.rows[0]?.sonicdicom_document_id }, { status: "draft", document: "C" });

      documents = [{ reportNo: 9284, documentId: "C", account: username, statusCode: 6, updatedAt: `${date}T12:30:00.000Z` }, ...documents.filter((document) => document.documentId !== "C")];
      await sonicDicomCacheService.refreshReportingBoardSonicDicomCacheCandidates([primary], [{ ...comparisonCandidate, storedDocumentId: "B" }]);
      cache = await pool.query<{ report_status: string; sonicdicom_document_id: string; sonicdicom_status_code: number; removed_at: string | null }>(`select c.report_status, c.sonicdicom_document_id, c.sonicdicom_status_code, h.removed_at from doctor_portal.comparison_sonicdicom_cache c left join doctor_portal.comparison_sonicdicom_documents h on h.comparison_assignment_id = c.comparison_assignment_id and h.sonicdicom_document_id = c.sonicdicom_document_id where c.comparison_assignment_id = $1`, [assignmentId]);
      assert.deepEqual({ status: cache.rows[0]?.report_status, document: cache.rows[0]?.sonicdicom_document_id }, { status: "final", document: "C" });
      assert.equal((await pool.query(`select count(*)::int as count from doctor_portal.comparison_sonicdicom_documents where comparison_assignment_id = $1 and sonicdicom_document_id = any($2::text[])`, [assignmentId, ["B", "C"]])).rows[0].count, 2);
    } finally {
      sonicDicomCacheService.__setReportingBoardSonicDicomReadersForTest(null);
    }
  });

  it("keeps a RISpro-finalized comparison final when its SonicDICOM document is later removed", async () => {
    guard();
    const date = addDays(87);
    const label = uniq("finalized_comparison_removed");
    const source = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: label });
    const comparison = await createComparisonRequestForBooking(source, `${date}T10:00:00.000Z`, label);
    await assignComparisonDirectly(comparison, targetDoctor.doctorId);
    const assignmentId = Number((await pool.query<{ id: string }>(`select id::text from doctor_portal.comparison_case_assignments where comparison_request_id = $1 and status = 'active'`, [comparison])).rows[0].id);
    await comparisonRequestService.finalizeComparisonRequest({ userId: targetDoctor.id, appRole: "doctor" }, comparison, "RISpro final stays final");
    await pool.query(`insert into doctor_portal.comparison_sonicdicom_cache (comparison_assignment_id, comparison_request_id, report_status, sonicdicom_document_id, sonicdicom_status_code, last_success_at, last_attempt_at, next_check_at) values ($1, $2, 'no_report', 'B', 7, now(), now(), now()) on conflict (comparison_assignment_id) do update set report_status = excluded.report_status, sonicdicom_document_id = excluded.sonicdicom_document_id, sonicdicom_status_code = excluded.sonicdicom_status_code, last_success_at = excluded.last_success_at, last_attempt_at = excluded.last_attempt_at`, [assignmentId, comparison]);
    await pool.query(`insert into doctor_portal.comparison_sonicdicom_documents (comparison_assignment_id, sonicdicom_document_id, last_status_code, first_seen_at, last_seen_at, removed_at) values ($1, 'B', 7, now(), now(), now()) on conflict (comparison_assignment_id, sonicdicom_document_id) do update set removed_at = now()`, [assignmentId]);
    const all = await api<{ cases: Array<{ comparisonRequestId: number | null; appointmentStatus: string; reportStatus: string; reportStatusSource: string; canAssign: boolean; sonicDicomDocumentRemoved: boolean }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?q=${encodeURIComponent(label)}&caseSource=comparisons&reportStatus=all&limit=20`);
    const row = all.data.cases.find((candidate) => candidate.comparisonRequestId === comparison);
    assert.deepEqual(row && { appointmentStatus: row.appointmentStatus, reportStatus: row.reportStatus, source: row.reportStatusSource, canAssign: row.canAssign, removed: row.sonicDicomDocumentRemoved }, { appointmentStatus: "finalized", reportStatus: "final", source: "rispro", canAssign: false, removed: true });
    const required = await api<{ cases: Array<{ comparisonRequestId: number | null }> }>(supervisor.cookie, `/api/doctor/reporting-board/cases?q=${encodeURIComponent(label)}&caseSource=comparisons&reportStatus=required_not_final&limit=20`);
    assert.equal(required.data.cases.some((candidate) => candidate.comparisonRequestId === comparison), false);
  });

  it("retains a cached primary Final when document history is unavailable", async () => {
    guard();
    const date = addDays(88);
    const source = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: uniq("history_outage") });
    const comparison = await createComparisonRequestForBooking(source, `${date}T10:00:00.000Z`, "known comparison artifact");
    await assignComparisonDirectly(comparison, targetDoctor.doctorId);
    const assignmentId = Number((await pool.query<{ id: string }>(`select id::text from doctor_portal.comparison_case_assignments where comparison_request_id = $1 and status = 'active'`, [comparison])).rows[0].id);
    await pool.query(`update doctor_portal.reporting_board_sonicdicom_cache set report_status = 'final', sonicdicom_latest_document_id = 'A', last_success_at = now(), next_check_at = now() where appointment_id = $1`, [source]);
    await pool.query(`insert into doctor_portal.comparison_sonicdicom_cache (comparison_assignment_id, comparison_request_id, report_status, sonicdicom_document_id, last_success_at, last_attempt_at, next_check_at) values ($1, $2, 'draft', 'B', now(), now(), now())`, [assignmentId, comparison]);
    const primary = { bookingId: source, accessionNumber: `V2-${String(source).padStart(6, "0")}`, studyInstanceUid: null, requiresReport: true, status: "completed", assigned: false, priorityCode: null, cacheStatus: "final" as const, lastSuccessAt: new Date().toISOString() };
    sonicDicomCacheService.__setReportingBoardSonicDicomReadersForTest({
      checkStatusesBatch: async (contexts) => new Map(contexts.map((context) => [context.bookingId, { state: "draft" as const, canViewReport: false, source: "sonicdicom" as const, reportFinalAt: null, latestDocumentId: "B", finalizedByAccount: null, correlationMethod: "study_instance_uid" as const }])),
      fetchDocumentHistoriesBatch: async () => { throw new Error("history unavailable"); },
    });
    try {
      await sonicDicomCacheService.refreshReportingBoardSonicDicomCacheCandidates([primary]);
      const row = (await pool.query<{ report_status: string; sonicdicom_latest_document_id: string; failure_count: number; last_error: string | null }>(`select report_status, sonicdicom_latest_document_id, failure_count, last_error from doctor_portal.reporting_board_sonicdicom_cache where appointment_id = $1`, [source])).rows[0];
      assert.deepEqual({ status: row.report_status, document: row.sonicdicom_latest_document_id, failed: row.failure_count > 0, error: row.last_error }, { status: "final", document: "A", failed: true, error: "history unavailable" });
    } finally {
      sonicDicomCacheService.__setReportingBoardSonicDicomReadersForTest(null);
    }
  });

  after(async () => {
    reportingBoardService?.__setReportingBoardAssignmentBatchCheckerForTest(null);
    sonicDicomCacheService?.__setReportingBoardSonicDicomReadersForTest(null);
    if (app) await app.close();
    if (pool) await cleanup();
  });

  function guard() {
    if (!pool) throw new Error("Database setup failed or was skipped.");
  }

  it("enforces settings permissions and allows effective settings reads for Doctor Portal users", async () => {
    guard();
    const update = await api(admin.cookie, "/api/doctor/reporting-board/settings", {
      method: "PUT",
      body: {
        cutoffMode: "days_back",
        defaultCutoffDate: null,
        daysBack: 7,
        enabledModalityCodes: ["CT", "MR"],
        defaultRequiresReport: true,
        defaultReportStatusFilter: "required_not_final",
      },
    });
    assert.equal(update.status, 200);
    assert.equal((update.data as { settings: { daysBack: number } }).settings.daysBack, 7);
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/settings", { method: "PUT", body: { daysBack: 1 } })).status, 200);
    assert.equal((await api(doctor.cookie, "/api/doctor/reporting-board/settings", { method: "PUT", body: { daysBack: 1 } })).status, 403);
    assert.equal((await api(admin.cookie, "/api/doctor/reporting-board/settings")).status, 200);
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/settings")).status, 200);
    assert.equal((await api(doctor.cookie, "/api/doctor/reporting-board/settings")).status, 200);
    assert.equal((await api(receptionistCookie, "/api/doctor/reporting-board/settings")).status, 403);
  });

  it("keeps administrator saved views manager-only and doctor-link metadata doctor-scoped", async () => {
    guard();
    assert.equal((await api(doctor.cookie, "/api/doctor/reporting-board/saved-views")).status, 403);
    assert.equal((await api(doctor.cookie, "/api/doctor/reporting-board/saved-views", { method: "POST", body: { name: "denied", filters: {} } })).status, 403);
    const ownerView = await createSavedView(admin, true, { assignedDoctorId: doctor.doctorId });
    const managerList = await api<{ savedViews: Array<{ id: number }> }>(supervisor.cookie, "/api/doctor/reporting-board/saved-views");
    assert.equal(managerList.status, 200);
    assert.equal(managerList.data.savedViews.some((view) => view.id === ownerView.id), true);
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/saved-views/token/${ownerView.token}`)).status, 403);
    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/saved-views/token/${ownerView.token}`)).status, 200);
    const caseSourceView = await createSavedView(admin, true, { caseSource: "comparisons" });
    const loadedCaseSourceView = await api<{ savedView: { filters: { caseSource?: string } } }>(supervisor.cookie, `/api/doctor/reporting-board/saved-views/token/${caseSourceView.token}`);
    assert.equal(loadedCaseSourceView.status, 200);
    assert.equal(loadedCaseSourceView.data.savedView.filters.caseSource, "comparisons");
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/saved-views/${ownerView.id}`, { method: "PATCH", body: { active: false } })).status, 403);

    const ownWorklist = await getDoctorWorklist(doctor, false);
    assert.equal((await api(otherDoctor.cookie, `/api/doctor/reporting-board/saved-views/token/${ownWorklist.token}`)).status, 403);
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/saved-views/token/${ownWorklist.token}`)).status, 200);
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/doctor-worklists")).status, 200);
  });

  it("provisions one doctor worklist and reactivates the same token across profile and user lifecycle changes", async () => {
    guard();
    const first = await getDoctorWorklist(noFinalizeDoctor, false);
    const second = await getDoctorWorklist(noFinalizeDoctor, false);
    assert.equal(second.id, first.id);
    assert.equal(second.token, first.token);
    const count = await pool.query<{ count: string }>(
      `select count(*)::text as count from doctor_portal.reporting_board_saved_views where target_doctor_id = $1 and link_kind = 'doctor_worklist' and system_managed = true`,
      [noFinalizeDoctor.doctorId]
    );
    assert.equal(Number(count.rows[0].count), 1);

    assert.equal((await api(admin.cookie, `/api/doctor/profiles/${noFinalizeDoctor.doctorId}`, { method: "PATCH", body: { active: false } })).status, 200);
    assert.equal((await api("", `/api/reporting/saved-views/public/${first.token}/mobile`)).status, 404);
    assert.equal((await api(admin.cookie, `/api/doctor/profiles/${noFinalizeDoctor.doctorId}`, { method: "PATCH", body: { active: true } })).status, 200);
    assert.equal((await api("", `/api/reporting/saved-views/public/${first.token}/mobile`)).status, 200);

    assert.equal((await api(admin.cookie, `/api/doctor/admin/doctors/${noFinalizeDoctor.id}/deactivate`, { method: "POST" })).status, 200);
    assert.equal((await api("", `/api/reporting/saved-views/public/${first.token}/mobile`)).status, 404);
    assert.equal((await api(admin.cookie, `/api/doctor/admin/doctors/${noFinalizeDoctor.id}/activate`, { method: "POST" })).status, 200);
    assert.equal((await api("", `/api/reporting/saved-views/public/${first.token}/mobile`)).status, 200);
    const restored = await pool.query<{ token: string }>(`select token from doctor_portal.reporting_board_saved_views where id = $1`, [first.id]);
    assert.equal(restored.rows[0].token, first.token);
  });

  it("keeps valid token-scoped mobile views public while enforcing lifecycle and mutation authority", async () => {
    guard();
    const view = await createSavedView(admin, false, {});
    const publicPath = `/api/reporting/saved-views/public/${view.token}/mobile?limit=1`;
    const anonymous = await api<{ allowedActions: { authenticated: boolean; readOnly: boolean; batchReassign: boolean }; pagination: { limit: number; offset: number }; totalCount: number }>("", publicPath);
    assert.equal(anonymous.status, 200);
    assert.equal(anonymous.data.allowedActions.authenticated, false);
    assert.equal(anonymous.data.allowedActions.readOnly, true);
    assert.equal(anonymous.data.allowedActions.batchReassign, false);
    assert.equal(anonymous.data.pagination.limit, 1);
    assert.equal(anonymous.data.pagination.offset, 0);
    assert.ok(anonymous.data.totalCount >= 0);
    assert.equal((await pool.query(`select last_accessed_at from doctor_portal.reporting_board_saved_views where id = $1`, [view.id])).rows[0].last_accessed_at === null, false);
    assert.equal((await api("", "/api/reporting/saved-views/public/not-a-token/mobile")).status, 404);
    assert.equal((await api("", `/api/reporting/saved-views/public/${view.token}/mobile/assign-to-me`, { method: "POST", body: { appointmentId: 1 } })).status, 401);
    assert.equal((await api(doctor.cookie, `/api/reporting/saved-views/public/${view.token}/mobile/assign-to-me`, { method: "POST", body: { appointmentId: 1 } })).status, 403);

    const rotated = await api<{ savedView: { token: string } }>(admin.cookie, `/api/doctor/reporting-board/saved-views/${view.id}/rotate-token`, { method: "POST" });
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.data.savedView.token, view.token);
    assert.equal((await api("", publicPath)).status, 404);
    assert.equal((await api("", `/api/reporting/saved-views/public/${rotated.data.savedView.token}/mobile`)).status, 200);

    assert.equal((await api(admin.cookie, `/api/doctor/reporting-board/saved-views/${view.id}/revoke`, { method: "POST" })).status, 200);
    assert.equal((await api("", `/api/reporting/saved-views/public/${rotated.data.savedView.token}/mobile`)).status, 404);
    assert.equal((await api(admin.cookie, `/api/doctor/reporting-board/saved-views/${view.id}/rotate-token`, { method: "POST" })).status, 409);

    const expired = await createSavedView(admin, false, {});
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const setExpiry = await api<{ savedView: { expiresAt: string | null } }>(admin.cookie, `/api/doctor/reporting-board/saved-views/${expired.id}`, { method: "PATCH", body: { expiresAt: futureExpiry } });
    assert.equal(setExpiry.status, 200);
    assert.ok(setExpiry.data.savedView.expiresAt);
    const clearExpiry = await api<{ savedView: { expiresAt: string | null } }>(admin.cookie, `/api/doctor/reporting-board/saved-views/${expired.id}`, { method: "PATCH", body: { expiresAt: null } });
    assert.equal(clearExpiry.status, 200);
    assert.equal(clearExpiry.data.savedView.expiresAt, null);
    assert.equal((await api(admin.cookie, `/api/doctor/reporting-board/saved-views/${expired.id}`, { method: "PATCH", body: { expiresAt: "not-a-timestamp" } })).status, 400);
    await pool.query(`update doctor_portal.reporting_board_saved_views set expires_at = now() - interval '1 minute' where id = $1`, [expired.id]);
    assert.equal((await api("", `/api/reporting/saved-views/public/${expired.token}/mobile`)).status, 404);
  });

  it("delivers a public saved-view test notification only to the requesting subscription", async () => {
    guard();
    const view = await createSavedView(admin, false, {});
    const subscriptionA = { endpoint: "https://push.example/device-a", keys: { p256dh: "device-a-key", auth: "device-a-auth" } };
    const subscriptionB = { endpoint: "https://push.example/device-b", keys: { p256dh: "device-b-key", auth: "device-b-auth" } };
    const hash = (subscription: typeof subscriptionA) => createHash("sha256").update(`${subscription.endpoint}|${subscription.keys.p256dh}`).digest("hex");
    for (const subscription of [subscriptionA, subscriptionB]) {
      await pool.query(
        `insert into doctor_portal.reporting_board_web_push_subscriptions (saved_view_id, user_id, doctor_id, endpoint, p256dh, auth, subscription_hash, enabled) values ($1, null, null, $2, $3, $4, $5, true)`,
        [view.id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, hash(subscription)]
      );
    }
    const repository = await import("./reporting-board-repository.js");
    const deliveredEndpoints: string[] = [];
    repository.__setReportingBoardPushDeliveryForTest({
      configure: async () => true,
      send: async (subscription) => { deliveredEndpoints.push(subscription.endpoint); },
    });
    try {
      const response = await api<{ attempted: number; sent: number }>(admin.cookie, `/api/reporting/saved-views/public/${view.token}/mobile/test-push`, { method: "POST", body: { subscription: subscriptionA } });
      assert.equal(response.status, 200);
      assert.equal(response.data.attempted, 1);
      assert.equal(response.data.sent, 1);
      assert.deepEqual(deliveredEndpoints, [subscriptionA.endpoint]);
    } finally {
      repository.__setReportingBoardPushDeliveryForTest(null);
    }
  });

  it("returns cached PACS notes only to authenticated mobile reporting-board readers", async () => {
    guard();
    const notedBookingId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(-1), patientName: "cached-note" });
    const linkedComparisonBookingId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(-1), patientName: "linked-comparison-note" });
    const linkedComparisonId = await createComparisonRequestForBooking(linkedComparisonBookingId, `${addDays(-1)}T08:00:00.000Z`, "appointment scope regression");
    await pool.query(
      `update doctor_portal.reporting_board_sonicdicom_cache set sonicdicom_study_note = $2, last_success_at = now(), source = 'sonicdicom' where appointment_id = $1`,
      [notedBookingId, "Cached SonicDICOM study note"]
    );
    const view = await createSavedView(admin, false, { appointmentId: notedBookingId });
    const path = `/api/reporting/saved-views/public/${view.token}/mobile`;
    const authenticated = await api<{ cases: Array<{ caseType: string; appointmentId: number; comparisonRequestId: number | null; sonicDicomStudyNote: string | null; sonicDicomStudyNoteCheckedAt: string | null; sonicDicomStudyNoteSource: string | null }> }>(doctor.cookie, path);
    assert.equal(authenticated.status, 200);
    assert.deepEqual(authenticated.data.cases.map((row) => row.appointmentId), [notedBookingId]);
    assert.equal(authenticated.data.cases[0].sonicDicomStudyNote, "Cached SonicDICOM study note");
    assert.ok(authenticated.data.cases[0].sonicDicomStudyNoteCheckedAt);
    assert.equal(authenticated.data.cases[0].sonicDicomStudyNoteSource, "sonicdicom");

    const anonymous = await api<{ cases: Array<{ appointmentId: number; sonicDicomStudyNote: string | null; sonicDicomStudyNoteCheckedAt: string | null; sonicDicomStudyNoteSource: string | null }> }>("", path);
    assert.equal(anonymous.status, 200);
    assert.deepEqual(anonymous.data.cases.map((row) => row.appointmentId), [notedBookingId]);
    assert.equal(anonymous.data.cases[0].sonicDicomStudyNote, null);
    assert.equal(anonymous.data.cases[0].sonicDicomStudyNoteCheckedAt, null);
    assert.equal(anonymous.data.cases[0].sonicDicomStudyNoteSource, null);

    const linkedComparisonView = await createSavedView(admin, false, { appointmentId: linkedComparisonBookingId });
    const linkedComparison = await api<{ cases: Array<{ caseType: string; appointmentId: number; comparisonRequestId: number | null; sonicDicomStudyNote: string | null }> }>(doctor.cookie, `/api/reporting/saved-views/public/${linkedComparisonView.token}/mobile`);
    assert.equal(linkedComparison.status, 200);
    assert.equal(linkedComparison.data.cases.some((row) => row.caseType === "comparison" && row.appointmentId === linkedComparisonBookingId && row.comparisonRequestId === linkedComparisonId), true);
    assert.ok(linkedComparison.data.cases.every((row) => row.appointmentId === linkedComparisonBookingId));
    assert.equal(linkedComparison.data.cases.find((row) => row.caseType === "appointment")?.sonicDicomStudyNote, null);
  });

  it("uses the requested non-first mobile case identity for detail, reassignment, and unassignment", async () => {
    guard();
    const date = addDays(8);
    const label = uniq("mobile_identity");
    const firstAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} first appointment` });
    const targetAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} target appointment` });
    const firstPrior = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(7), patientName: `${label} first prior` });
    const targetPrior = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(7), patientName: `${label} target prior` });
    const firstComparison = await createComparisonRequestForBooking(firstPrior, `${date}T08:00:00.000Z`, `${label} first comparison`);
    const targetComparison = await createComparisonRequestForBooking(targetPrior, `${date}T08:05:00.000Z`, `${label} target comparison`);
    [firstAppointment, targetAppointment].forEach((id) => statusByAppointmentId.set(id, "draft"));
    await statusByAppointmentId.flush();
    const view = await createSavedView(admin, false, { q: label });
    const supervisorActor = { userId: supervisor.id, appRole: "supervisor" as const };
    const baseline = await reportingBoardService.getPublicReportingBoardMobileView(null, view.token, { limit: 100 });
    assert.equal(baseline.cases.some((row) => row.appointmentId === targetAppointment), true, JSON.stringify(baseline.cases.map((row) => row.appointmentId)));

    const appointmentDetail = await reportingBoardService.getPublicReportingBoardMobileCase(null, view.token, { caseType: "appointment", appointmentId: targetAppointment });
    assert.equal(appointmentDetail.case.appointmentId, targetAppointment);
    const comparisonDetail = await reportingBoardService.getPublicReportingBoardMobileCase(null, view.token, { caseType: "comparison", comparisonRequestId: targetComparison });
    assert.equal(comparisonDetail.case.comparisonRequestId, targetComparison);

    await reportingBoardService.reassignReportingBoardMobileCase(supervisorActor, view.token, { caseType: "appointment", appointmentId: targetAppointment }, otherDoctor.doctorId, "identity regression test");
    assert.equal(Number((await pool.query(`select assigned_doctor_id from doctor_portal.case_team_assignments where appointment_id = $1 and status = 'active'`, [targetAppointment])).rows[0].assigned_doctor_id), otherDoctor.doctorId);
    await reportingBoardService.unassignReportingBoardMobileCase(supervisorActor, view.token, { caseType: "appointment", appointmentId: targetAppointment }, "identity regression test");
    assert.equal((await pool.query(`select count(*)::int as count from doctor_portal.case_team_assignments where appointment_id = $1 and status = 'active'`, [targetAppointment])).rows[0].count, 0);

    await reportingBoardService.reassignReportingBoardMobileCase(supervisorActor, view.token, { caseType: "comparison", comparisonRequestId: targetComparison }, otherDoctor.doctorId, "identity regression test");
    assert.equal(Number((await pool.query(`select assigned_doctor_id from doctor_portal.comparison_case_assignments where comparison_request_id = $1 and status = 'active'`, [targetComparison])).rows[0].assigned_doctor_id), otherDoctor.doctorId);
    await reportingBoardService.unassignReportingBoardMobileCase(supervisorActor, view.token, { caseType: "comparison", comparisonRequestId: targetComparison }, "identity regression test");
    assert.equal((await pool.query(`select count(*)::int as count from doctor_portal.comparison_case_assignments where comparison_request_id = $1 and status = 'active'`, [targetComparison])).rows[0].count, 0);
    assert.notEqual(firstComparison, targetComparison);
  });

  it("rejects mobile reassignment and unassignment outside a restrictive saved-view case source", async () => {
    guard();
    const date = addDays(8);
    const label = uniq("mobile_case_source_scope");
    const appointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} appointment` });
    const prior = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(7), patientName: `${label} comparison prior` });
    const comparison = await createComparisonRequestForBooking(prior, `${date}T08:00:00.000Z`, `${label} comparison`);
    statusByAppointmentId.set(appointment, "draft");
    await statusByAppointmentId.flush();
    const comparisonsOnly = await createSavedView(admin, false, { q: label, caseSource: "comparisons" });
    const appointmentsOnly = await createSavedView(admin, false, { q: label, caseSource: "appointments" });
    const supervisorActor = { userId: supervisor.id, appRole: "supervisor" as const };
    const rejectsOutsideSource = async (operation: () => Promise<unknown>) => {
      await assert.rejects(operation, (error: unknown) =>
        (error as { statusCode?: number }).statusCode === 404 && (error as Error).message === "Case not found."
      );
    };

    await rejectsOutsideSource(() => reportingBoardService.reassignReportingBoardMobileCase(
      supervisorActor, comparisonsOnly.token, { caseType: "appointment", appointmentId: appointment }, otherDoctor.doctorId, "source scope test"
    ));
    await rejectsOutsideSource(() => reportingBoardService.unassignReportingBoardMobileCase(
      supervisorActor, comparisonsOnly.token, { caseType: "appointment", appointmentId: appointment }, "source scope test"
    ));
    await rejectsOutsideSource(() => reportingBoardService.reassignReportingBoardMobileCase(
      supervisorActor, appointmentsOnly.token, { caseType: "comparison", comparisonRequestId: comparison }, otherDoctor.doctorId, "source scope test"
    ));
    await rejectsOutsideSource(() => reportingBoardService.unassignReportingBoardMobileCase(
      supervisorActor, appointmentsOnly.token, { caseType: "comparison", comparisonRequestId: comparison }, "source scope test"
    ));
  });

  it("applies default case-list scope, SonicDICOM status filtering, and normalized statuses", async () => {
    guard();
    const date = addDays(10);
    const ctDraft = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Default CT" });
    const mrNoReport = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, date, patientName: "Default MR" });
    const usDraft = await createBooking({ modalityId: usModalityId, examTypeId: usExamTypeId, date, patientName: "Default US" });
    const ctNotRequired = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, requiresReport: false, patientName: "No Report Required" });
    const ctFinal = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Final Case" });
    const ctCancelled = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, status: "cancelled", patientName: "Cancelled Case" });
    statusByAppointmentId.set(ctDraft, "draft");
    statusByAppointmentId.set(mrNoReport, "no_report");
    statusByAppointmentId.set(usDraft, "draft");
    statusByAppointmentId.set(ctNotRequired, "draft");
    statusByAppointmentId.set(ctFinal, "final");
    statusByAppointmentId.set(ctCancelled, "draft");

    const response = await api<{ cases: Array<{ appointmentId: number; reportStatus: string; modalityCode: string; requiresReport: boolean }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&requiresReport=true`
    );
    assert.equal(response.status, 200);
    const ids = response.data.cases.map((row) => row.appointmentId);
    assert.deepEqual(ids.sort((a, b) => a - b), [ctDraft, mrNoReport].sort((a, b) => a - b));
    assert.ok(response.data.cases.every((row) => row.requiresReport === true));
    assert.ok(response.data.cases.every((row) => ["final", "draft", "no_report", "study_not_found", "unavailable"].includes(row.reportStatus)));
  });

  it("returns a unified CT/MR appointment and comparison board with caseSource filtering and shared sorting", async () => {
    guard();
    const date = addDays(24);
    const previousDate = addDays(-24);
    const label = uniq("unified");
    const ctAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} Zulu appointment`, time: "10:00" });
    const mrAppointment = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, date, patientName: `${label} Yankee appointment`, time: "11:00" });
    const usAppointment = await createBooking({ modalityId: usModalityId, examTypeId: usExamTypeId, date, patientName: `${label} US appointment`, time: "12:00" });
    const ctPrevious = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: previousDate, patientName: `${label} Alpha comparison` });
    const mrPrevious = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, date: previousDate, patientName: `${label} Bravo comparison` });
    const usPrevious = await createBooking({ modalityId: usModalityId, examTypeId: usExamTypeId, date: previousDate, patientName: `${label} US comparison` });
    const ctComparison = await createComparisonRequestForBooking(ctPrevious, `${date}T08:00:00.000Z`, label);
    const mrComparison = await createComparisonRequestForBooking(mrPrevious, `${date}T08:05:00.000Z`, label);
    const usComparison = await createComparisonRequestForBooking(usPrevious, `${date}T08:10:00.000Z`, label);
    statusByAppointmentId.set(ctAppointment, "draft");
    statusByAppointmentId.set(mrAppointment, "draft");
    statusByAppointmentId.set(usAppointment, "draft");

    const baseQuery = `dateFrom=${date}&dateTo=${date}&q=${encodeURIComponent(label)}&reportStatus=required_not_final&sortBy=patient_name&sortDirection=asc&limit=20`;
    const all = await api<{ cases: Array<{ caseType: string; appointmentId: number; comparisonRequestId: number | null; modalityCode: string; patientEnglishName: string }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?${baseQuery}&caseSource=all`
    );
    assert.equal(all.status, 200);
    assert.deepEqual(
      all.data.cases.map((row) => `${row.caseType}:${row.caseType === "comparison" ? row.comparisonRequestId : row.appointmentId}`),
      [`comparison:${ctComparison}`, `comparison:${mrComparison}`, `appointment:${mrAppointment}`, `appointment:${ctAppointment}`]
    );
    assert.equal(all.data.cases.some((row) => row.appointmentId === usAppointment || row.comparisonRequestId === usComparison), false);

    const appointments = await api<{ cases: Array<{ caseType: string; appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?${baseQuery}&caseSource=appointments`
    );
    assert.equal(appointments.status, 200);
    assert.deepEqual(appointments.data.cases.map((row) => row.caseType), ["appointment", "appointment"]);
    assert.deepEqual(appointments.data.cases.map((row) => row.appointmentId).sort((a, b) => a - b), [ctAppointment, mrAppointment].sort((a, b) => a - b));

    const comparisons = await api<{ cases: Array<{ caseType: string; comparisonRequestId: number | null }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?${baseQuery}&caseSource=comparisons`
    );
    assert.equal(comparisons.status, 200);
    assert.deepEqual(comparisons.data.cases.map((row) => row.caseType), ["comparison", "comparison"]);
    assert.deepEqual(comparisons.data.cases.map((row) => row.comparisonRequestId).sort((a, b) => Number(a) - Number(b)), [ctComparison, mrComparison].sort((a, b) => a - b));

    const ctOnly = await api<{ cases: Array<{ caseType: string; modalityCode: string }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?${baseQuery}&modalityCode=CT&caseSource=all`
    );
    assert.equal(ctOnly.status, 200);
    assert.deepEqual(ctOnly.data.cases.map((row) => `${row.caseType}:${row.modalityCode}`), ["comparison:CT", "appointment:CT"]);
  });

  it("uses the doctor worklist target for mobile assigned scope and counters across viewers", async () => {
    guard();
    const date = addDays(12);
    const label = uniq("doctor_worklist_target_scope");
    const targetAssigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} target assigned` });
    const viewerAssigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} viewer assigned` });
    const unassigned = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, date, patientName: `${label} unassigned` });
    [targetAssigned, viewerAssigned, unassigned].forEach((id) => statusByAppointmentId.set(id, "draft"));
    await assignDirectly(targetAssigned, targetDoctor.doctorId);
    await assignDirectly(viewerAssigned, doctor.doctorId);
    const worklist = await getDoctorWorklist(targetDoctor, false);
    type MobileView = {
      savedView: { linkKind: string; targetDoctorId: number | null };
      currentDoctorId: number | null;
      counters: { assignedToMe: number | null };
      cases: Array<{ appointmentId: number; assignedDoctorId: number | null; canAssignToMe: boolean }>;
      allowedActions: { assignToMe: boolean; reassign: boolean; finalizeOwnReports: boolean };
    };
    const path = `/api/reporting/saved-views/public/${worklist.token}/mobile?q=${encodeURIComponent(label)}&limit=100`;
    const viewers: Array<{ name: string; cookie: string; currentDoctorId: number | null; canManage: boolean }> = [
      { name: "anonymous", cookie: "", currentDoctorId: null, canManage: false },
      { name: "another doctor", cookie: doctor.cookie, currentDoctorId: doctor.doctorId, canManage: false },
      { name: "supervisor", cookie: supervisor.cookie, currentDoctorId: supervisor.doctorId, canManage: true },
      { name: "superadmin", cookie: admin.cookie, currentDoctorId: admin.doctorId, canManage: true },
      { name: "target doctor", cookie: targetDoctor.cookie, currentDoctorId: targetDoctor.doctorId, canManage: false },
    ];

    for (const viewer of viewers) {
      const response = await api<MobileView>(viewer.cookie, path);
      assert.equal(response.status, 200, `${viewer.name}: ${JSON.stringify(response.data)}`);
      assert.equal(response.data.savedView.linkKind, "doctor_worklist");
      assert.equal(response.data.savedView.targetDoctorId, targetDoctor.doctorId);
      assert.equal(response.data.currentDoctorId == null ? null : Number(response.data.currentDoctorId), viewer.currentDoctorId);
      assert.equal(response.data.counters.assignedToMe, 1, viewer.name);
      assert.equal(response.data.cases.some((row) => row.appointmentId === targetAssigned), true, viewer.name);
      assert.equal(response.data.cases.some((row) => row.appointmentId === unassigned), true, viewer.name);
      assert.equal(response.data.cases.some((row) => row.appointmentId === viewerAssigned), false, viewer.name);
      assert.equal(response.data.allowedActions.assignToMe, viewer.name === "target doctor");
      assert.equal(response.data.cases.find((row) => row.appointmentId === unassigned)?.canAssignToMe, viewer.name === "target doctor", viewer.name);
      assert.equal(response.data.allowedActions.reassign, viewer.canManage);
      assert.equal(response.data.allowedActions.finalizeOwnReports, viewer.name === "target doctor");
    }

    for (const manager of [supervisor, admin]) {
      const ownWorklist = await getDoctorWorklist(manager, false);
      const ownView = await api<MobileView>(manager.cookie, `/api/reporting/saved-views/public/${ownWorklist.token}/mobile?q=${encodeURIComponent(label)}&limit=100`);
      assert.equal(ownView.status, 200, JSON.stringify(ownView.data));
      assert.equal(ownView.data.allowedActions.assignToMe, true);
      assert.equal(ownView.data.cases.find((row) => row.appointmentId === unassigned)?.canAssignToMe, true);
    }

    const noFinalizeWorklist = await getDoctorWorklist(noFinalizeDoctor, false);
    const noFinalizeView = await api<MobileView>(noFinalizeDoctor.cookie, `/api/reporting/saved-views/public/${noFinalizeWorklist.token}/mobile?limit=1`);
    assert.equal(noFinalizeView.status, 200, JSON.stringify(noFinalizeView.data));
    assert.equal(noFinalizeView.data.allowedActions.finalizeOwnReports, false);

    const assignedOnly = await api<MobileView>("", `${path}&assignedDoctorId=${targetDoctor.doctorId}&assignmentStatus=assigned`);
    assert.equal(assignedOnly.status, 200, JSON.stringify(assignedOnly.data));
    assert.deepEqual(assignedOnly.data.cases.map((row) => row.appointmentId), [targetAssigned]);
  });

  it("forces report-required appointments in the personal desk without changing the administrative board", async () => {
    guard();
    const date = addDays(16);
    const label = uniq("personal_requires_report");
    const notRequired = await createBooking({
      modalityId: ctModalityId,
      examTypeId: ctExamTypeId,
      priorityId: urgentPriorityId,
      date,
      requiresReport: false,
      patientName: `${label} not required`,
    });
    const before = await api<{ settings: Record<string, unknown> }>(admin.cookie, "/api/doctor/reporting-board/settings");
    assert.equal(before.status, 200, JSON.stringify(before.data));
    const settings = before.data.settings;

    try {
      const changed = await api(admin.cookie, "/api/doctor/reporting-board/settings", {
        method: "PUT",
        body: { ...settings, defaultRequiresReport: false },
      });
      assert.equal(changed.status, 200, JSON.stringify(changed.data));

      const worklist = await getDoctorWorklist(doctor, false);
      for (const tab of ["my_cases", "available", "urgent"] as const) {
        const personal = await api<{ cases: Array<{ appointmentId: number }> }>(
          doctor.cookie,
          `/api/reporting/saved-views/public/${worklist.token}/mobile?q=${encodeURIComponent(label)}&mobileQuickTab=${tab}&limit=100`
        );
        assert.equal(personal.status, 200, JSON.stringify(personal.data));
        assert.equal(personal.data.cases.some((row) => row.appointmentId === notRequired), false, tab);
      }

      const administrative = await api<{ cases: Array<{ appointmentId: number; requiresReport: boolean }> }>(
        supervisor.cookie,
        `/api/doctor/reporting-board/cases?q=${encodeURIComponent(label)}&caseSource=appointments&requiresReport=false&reportStatus=all&limit=100`
      );
      assert.equal(administrative.status, 200, JSON.stringify(administrative.data));
      assert.equal(administrative.data.cases.some((row) => row.appointmentId === notRequired && row.requiresReport === false), true);
    } finally {
      const restored = await api(admin.cookie, "/api/doctor/reporting-board/settings", {
        method: "PUT",
        body: settings,
      });
      assert.equal(restored.status, 200, JSON.stringify(restored.data));
    }
  });

  it("keeps existing appointment and comparison finalization authorization rules", async () => {
    guard();
    const date = addDays(17);
    const assigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Final auth assigned" });
    const unassigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Final auth unassigned" });
    const assignedOther = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Final auth other" });
    const assignedNoPermission = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Final auth no permission" });
    const reportNotRequired = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, requiresReport: false, patientName: "Final auth not required" });
    [assigned, unassigned, assignedOther, assignedNoPermission].forEach((id) => statusByAppointmentId.set(id, "draft"));
    await statusByAppointmentId.flush();
    await assignDirectly(assigned, targetDoctor.doctorId);
    await assignDirectly(assignedOther, otherDoctor.doctorId);
    await assignDirectly(assignedNoPermission, noFinalizeDoctor.doctorId);

    const success = await api<{ status: string }>(targetDoctor.cookie, `/api/doctor/reporting-board/cases/${assigned}/mark-final`, {
      method: "POST",
      body: { reason: "Finalized manually by assigned doctor from Personal Reporting Desk." },
    });
    assert.equal(success.status, 200, JSON.stringify(success.data));
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/cases/${unassigned}/mark-final`, { method: "POST", body: { reason: "not allowed" } })).status, 403);
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/cases/${assignedOther}/mark-final`, { method: "POST", body: { reason: "not allowed" } })).status, 403);
    assert.equal((await api(noFinalizeDoctor.cookie, `/api/doctor/reporting-board/cases/${assignedNoPermission}/mark-final`, { method: "POST", body: { reason: "not allowed" } })).status, 403);
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/cases/${reportNotRequired}/mark-final`, { method: "POST", body: { reason: "not allowed" } })).status, 403);
    assert.equal((await api(targetDoctor.cookie, `/api/doctor/reporting-board/cases/${assigned}/mark-final`, { method: "POST", body: { reason: "already final" } })).status, 409);

    const comparisonSource = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Comparison final auth source" });
    const assignedComparison = await createComparisonRequestForBooking(comparisonSource, `${date}T08:00:00.000Z`, "Assigned comparison final auth");
    await assignComparisonDirectly(assignedComparison, targetDoctor.doctorId);
    const comparisonFinal = await comparisonRequestService.finalizeComparisonRequest({ userId: targetDoctor.id, appRole: "doctor" }, assignedComparison, "Final comparison report text");
    assert.equal(comparisonFinal.status, "finalized");

    const unassignedComparisonSource = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Comparison unassigned final auth source" });
    const unassignedComparison = await createComparisonRequestForBooking(unassignedComparisonSource, `${date}T08:01:00.000Z`, "Unassigned comparison final auth");
    await assert.rejects(
      () => comparisonRequestService.finalizeComparisonRequest({ userId: doctor.id, appRole: "doctor" }, unassignedComparison, "Should be rejected"),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 403
    );
  });

  it("keeps finalized personal history attributed to the worklist owner across appointment and comparison reports", async () => {
    guard();
    const date = addDays(14);
    const label = uniq("personal_finalized_owner");
    const manualFinal = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} manual` });
    const sonicFinal = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} sonic` });
    const comparisonSourceA = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} comparison a source` });
    const comparisonSourceB = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} comparison b source` });
    const comparisonFinalA = await createComparisonRequestForBooking(comparisonSourceA, `${date}T08:00:00.000Z`, `${label} comparison a`);
    const comparisonFinalB = await createComparisonRequestForBooking(comparisonSourceB, `${date}T08:05:00.000Z`, `${label} comparison b`);
    const finalizerEmail = `rbit.personal.final.${randomUUID().slice(0, 8)}@nccb.ly`;

    await pool.query(`insert into doctor_portal.reporting_board_manual_final_overrides (appointment_id, reason, created_by_user_id, created_by_doctor_id) values ($1, 'personal history test', $2, $3)`, [manualFinal, targetDoctor.id, targetDoctor.doctorId]);
    await assignDirectly(sonicFinal, otherDoctor.doctorId);
    await pool.query(`update users set username = $2 where id = $1`, [targetDoctor.id, finalizerEmail]);
    await sonicDicomCacheService.persistReportingBoardSonicDicomCacheResult(
      { bookingId: sonicFinal, accessionNumber: `V2-${String(sonicFinal).padStart(6, "0")}`, studyInstanceUid: `1.2.840.personal.${sonicFinal}`, requiresReport: true, status: "completed" },
      { state: "final", canViewReport: true, source: "sonicdicom", reportFinalAt: "2026-08-23T11:00:00.000Z", latestDocumentId: "personal-final", finalizedByAccount: finalizerEmail, correlationMethod: "study_instance_uid" }
    );
    await pool.query(`update comparison_requests set status = 'finalized', finalized_by = $2, finalized_at = now() where id = $1`, [comparisonFinalA, targetDoctor.id]);
    await pool.query(`update comparison_requests set status = 'finalized', finalized_by = $2, finalized_at = now() where id = $1`, [comparisonFinalB, otherDoctor.id]);

    const worklist = await getDoctorWorklist(targetDoctor, false);
    type FinalizedMobileView = {
      counters: { assignedToMe: number | null; unassigned: number; urgent: number; overdue: number; requiredNotFinal: number };
      cases: Array<{ appointmentId: number; comparisonRequestId: number | null; finalizedByDoctorId: number | null; manualFinalByDoctorId?: number | null }>;
    };
    const finalizedPath = `/api/reporting/saved-views/public/${worklist.token}/mobile?q=${encodeURIComponent(label)}&reportStatus=final&mobileQuickTab=my_cases&limit=100`;
    assert.equal((await api("", finalizedPath)).status, 401);
    assert.equal((await api(otherDoctor.cookie, finalizedPath)).status, 403);
    const ownerView = await api<FinalizedMobileView>(targetDoctor.cookie, finalizedPath);
    const supervisorView = await api<FinalizedMobileView>(supervisor.cookie, finalizedPath);
    const adminView = await api<FinalizedMobileView>(admin.cookie, finalizedPath);
    assert.equal(ownerView.status, 200, JSON.stringify(ownerView.data));
    assert.equal(supervisorView.status, 200, JSON.stringify(supervisorView.data));
    assert.equal(adminView.status, 200, JSON.stringify(adminView.data));
    for (const view of [ownerView, supervisorView, adminView]) {
      assert.deepEqual(view.data.counters, { total: 3, assignedToMe: 3, unassigned: 0, urgent: 0, overdue: 0, requiredNotFinal: 0 });
      assert.equal(view.data.cases.some((row) => row.appointmentId === manualFinal), true);
      assert.equal(view.data.cases.some((row) => row.appointmentId === sonicFinal && row.finalizedByDoctorId === targetDoctor.doctorId), true);
      assert.equal(view.data.cases.some((row) => row.comparisonRequestId === comparisonFinalA && row.finalizedByDoctorId === targetDoctor.doctorId), true);
      assert.equal(view.data.cases.some((row) => row.comparisonRequestId === comparisonFinalB), false);
    }

    const finalizedAvailable = await api<FinalizedMobileView>(supervisor.cookie, `${finalizedPath}&mobileQuickTab=available`);
    assert.equal(finalizedAvailable.status, 200, JSON.stringify(finalizedAvailable.data));
    assert.deepEqual(finalizedAvailable.data.cases, []);
    assert.deepEqual(finalizedAvailable.data.counters, { total: 3, assignedToMe: 3, unassigned: 0, urgent: 0, overdue: 0, requiredNotFinal: 0 });

    const otherWorklist = await getDoctorWorklist(otherDoctor, false);
    const otherFinal = await api<FinalizedMobileView>(otherDoctor.cookie, `/api/reporting/saved-views/public/${otherWorklist.token}/mobile?q=${encodeURIComponent(label)}&reportStatus=final&mobileQuickTab=my_cases&limit=100`);
    assert.equal(otherFinal.status, 200, JSON.stringify(otherFinal.data));
    assert.equal(otherFinal.data.cases.some((row) => row.appointmentId === sonicFinal), false);
    assert.equal(otherFinal.data.cases.some((row) => row.comparisonRequestId === comparisonFinalB), true);
  });

  it("keeps mobile quick-tab counters stable across tabs, search, pagination, and permanent saved-view filters", async () => {
    guard();
    const label = uniq("mobile_quick_tab_counters");
    const assignedUrgentOverdue = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: urgentPriorityId, date: addDays(-1), patientName: `${label} assigned urgent overdue` });
    const assignedRoutine = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date: addDays(1), patientName: `${label} assigned routine` });
    const unassignedStat = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date: addDays(1), patientName: `${label} unassigned stat` });
    const unassignedOverdue = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date: addDays(-2), patientName: `${label} unassigned overdue` });
    const unassignedRoutine = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date: addDays(2), patientName: `${label} unassigned routine` });
    const excludedMr = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, priorityId: statPriorityId, date: addDays(1), patientName: `${label} excluded MR` });
    [assignedUrgentOverdue, assignedRoutine, unassignedStat, unassignedOverdue, unassignedRoutine, excludedMr].forEach((id) => statusByAppointmentId.set(id, "draft"));
    await statusByAppointmentId.flush();
    await assignDirectly(assignedUrgentOverdue, targetDoctor.doctorId);
    await assignDirectly(assignedRoutine, targetDoctor.doctorId);

    type MobileView = {
      counters: { total: number; assignedToMe: number | null; unassigned: number; urgent: number; requiredNotFinal: number; overdue: number };
      totalCount: number;
      pagination: { hasMore: boolean; nextOffset: number | null };
      cases: Array<{ appointmentId: number; assignmentStatus: string; priorityCode: string | null; overdue: boolean }>;
    };
    const worklist = await getDoctorWorklist(targetDoctor, false);
    const baseline = await reportingBoardService.getPublicReportingBoardMobileView(null, worklist.token, { q: label, limit: 1 }) as MobileView;
    assert.deepEqual(baseline.counters, { total: 5, assignedToMe: 2, unassigned: 3, urgent: 3, requiredNotFinal: 5, overdue: 1 });
    assert.equal(baseline.totalCount, 5);
    assert.equal(baseline.cases.length, 1);
    assert.equal(baseline.pagination.hasMore, true);
    assert.equal(baseline.pagination.nextOffset, 1);

    const tabCases = async (filters: Record<string, unknown>) => reportingBoardService.getPublicReportingBoardMobileView(null, worklist.token, { q: label, limit: 10, ...filters }) as Promise<MobileView>;
    const myCases = await tabCases({ mobileQuickTab: "my_cases" });
    assert.equal(myCases.totalCount, 2);
    assert.deepEqual(myCases.cases.map((row) => row.appointmentId).sort((left, right) => left - right), [assignedUrgentOverdue, assignedRoutine].sort((left, right) => left - right));
    assert.ok(myCases.cases.every((row) => row.assignmentStatus === "assigned"));
    assert.deepEqual(myCases.counters, baseline.counters);
    const available = await tabCases({ mobileQuickTab: "available" });
    assert.equal(available.totalCount, 3);
    assert.ok(available.cases.every((row) => row.assignmentStatus === "unassigned"));
    assert.deepEqual(available.counters, baseline.counters);
    const urgent = await tabCases({ mobileQuickTab: "urgent" });
    assert.equal(urgent.totalCount, 3);
    assert.ok(urgent.cases.every((row) => ["urgent", "stat"].includes(String(row.priorityCode))));
    assert.deepEqual(urgent.counters, baseline.counters);
    const overdue = await tabCases({ mobileQuickTab: "overdue" });
    assert.equal(overdue.totalCount, 1);
    assert.ok(overdue.cases.every((row) => row.overdue));
    assert.deepEqual(overdue.counters, baseline.counters);
    const permanentlyUnassignedCt = await createSavedView(admin, false, {
      q: label,
      modalityCode: "CT",
      caseSource: "appointments",
      reportStatus: "draft",
      assignmentStatus: "unassigned",
    });
    const lockedBaseline = await reportingBoardService.getPublicReportingBoardMobileView(null, permanentlyUnassignedCt.token, { limit: 10 }) as MobileView;
    assert.deepEqual(lockedBaseline.counters, { total: 2, assignedToMe: null, unassigned: 2, urgent: 1, requiredNotFinal: 2, overdue: 0 });
    const lockedUrgent = await reportingBoardService.getPublicReportingBoardMobileView(null, permanentlyUnassignedCt.token, { limit: 10, mobileQuickTab: "urgent" }) as MobileView;
    assert.equal(lockedUrgent.totalCount, 1);
    assert.deepEqual(lockedUrgent.counters, lockedBaseline.counters);
    assert.ok(lockedUrgent.cases.every((row) => row.appointmentId !== excludedMr && row.assignmentStatus === "unassigned"));
  });

  it("uses active appointment assignment due dates for Personal Desk overdue cases", async () => {
    guard();
    await withReportingBoardCutoff(addDays(-14), async () => {
      const today = addDays(0);
      const yesterday = addDays(-1);
      const tomorrow = addDays(1);
      const label = uniq("personal_overdue_due_date");
      const oldBookingFutureDue = await createBooking({
        modalityId: ctModalityId,
        examTypeId: ctExamTypeId,
        date: addDays(-5),
        patientName: `${label} old booking future due`,
      });
      const recentBookingPastDue = await createBooking({
        modalityId: ctModalityId,
        examTypeId: ctExamTypeId,
        date: addDays(1),
        patientName: `${label} recent booking past due`,
      });
      const dueToday = await createBooking({
        modalityId: ctModalityId,
        examTypeId: ctExamTypeId,
        date: addDays(1),
        patientName: `${label} due today`,
      });
      const finalizedPastDue = await createBooking({
        modalityId: ctModalityId,
        examTypeId: ctExamTypeId,
        date: addDays(1),
        patientName: `${label} finalized past due`,
      });
      const reportNotRequired = await createBooking({
        modalityId: ctModalityId,
        examTypeId: ctExamTypeId,
        date: addDays(1),
        requiresReport: false,
        patientName: `${label} report not required`,
      });
      const unassignedOldBooking = await createBooking({
        modalityId: ctModalityId,
        examTypeId: ctExamTypeId,
        date: addDays(-5),
        patientName: `${label} unassigned old booking`,
      });
      const assignedOtherDoctor = await createBooking({
        modalityId: ctModalityId,
        examTypeId: ctExamTypeId,
        date: addDays(1),
        patientName: `${label} assigned other doctor`,
      });
      const comparisonSource = await createBooking({
        modalityId: ctModalityId,
        examTypeId: ctExamTypeId,
        date: addDays(-5),
        patientName: uniq("comparison_source"),
      });
      const comparison = await createComparisonRequestForBooking(comparisonSource, `${today}T08:00:00.000Z`, `${label} assigned comparison`);

      [oldBookingFutureDue, recentBookingPastDue, dueToday, finalizedPastDue, unassignedOldBooking, assignedOtherDoctor, comparisonSource]
        .forEach((id) => statusByAppointmentId.set(id, id === finalizedPastDue ? "final" : "draft"));
      await statusByAppointmentId.flush();
      await assignDirectly(oldBookingFutureDue, targetDoctor.doctorId);
      await assignDirectly(recentBookingPastDue, targetDoctor.doctorId);
      await assignDirectly(dueToday, targetDoctor.doctorId);
      await assignDirectly(finalizedPastDue, targetDoctor.doctorId);
      await assignDirectly(reportNotRequired, targetDoctor.doctorId);
      await assignDirectly(assignedOtherDoctor, otherDoctor.doctorId);
      await assignComparisonDirectly(comparison, targetDoctor.doctorId);
      await setExpectedReportingDate(oldBookingFutureDue, tomorrow);
      await setExpectedReportingDate(recentBookingPastDue, yesterday);
      await setExpectedReportingDate(dueToday, today);
      await setExpectedReportingDate(finalizedPastDue, yesterday);
      await setExpectedReportingDate(reportNotRequired, yesterday);
      await setExpectedReportingDate(assignedOtherDoctor, yesterday);
      await pool.query(
        `
          insert into doctor_portal.reporting_board_manual_final_overrides (
            appointment_id, reason, created_by_user_id, created_by_doctor_id
          ) values ($1, 'personal overdue finality test', $2, $3)
        `,
        [finalizedPastDue, targetDoctor.id, targetDoctor.doctorId]
      );

      const rowSource = await api<{ cases: Array<{ appointmentId: number; bookingDate: string; dueAt: string | null }> }>(
        supervisor.cookie,
        `/api/doctor/reporting-board/cases?dateFrom=${addDays(-5)}&dateTo=${addDays(-5)}&q=${encodeURIComponent(label)}&reportStatus=all&limit=10`
      );
      assert.equal(rowSource.status, 200, JSON.stringify(rowSource.data));
      const sourceRow = rowSource.data.cases.find((row) => row.appointmentId === oldBookingFutureDue);
      assert.equal(sourceRow?.bookingDate, addDays(-5));
      assert.equal(sourceRow?.dueAt, tomorrow);
      const unassignedSource = rowSource.data.cases.find((row) => row.appointmentId === unassignedOldBooking);
      assert.equal(unassignedSource?.dueAt, null);
      const comparisonRows = await comparisonRequestService.listComparisonReportingBoardRows({
        comparisonRequestId: comparison,
        reportStatus: "all",
        limit: 1,
        offset: 0,
      });
      assert.equal(comparisonRows[0]?.dueAt, null);

      type PersonalMobileView = {
        counters: { total: number; assignedToMe: number | null; unassigned: number; urgent: number; requiredNotFinal: number; overdue: number };
        totalCount: number;
        cases: Array<{ caseType: string; appointmentId: number; comparisonRequestId: number | null; assignmentStatus: string; overdue: boolean }>;
      };
      const worklist = await getDoctorWorklist(targetDoctor, false);
      const baseline = await reportingBoardService.getPublicReportingBoardMobileView(null, worklist.token, { q: label, limit: 100 }) as PersonalMobileView;
      assert.deepEqual(baseline.counters, { total: 5, assignedToMe: 4, unassigned: 1, urgent: 0, requiredNotFinal: 5, overdue: 1 });
      assert.equal(baseline.totalCount, 5);
      const byAppointment = (appointmentId: number) => baseline.cases.find((row) => row.appointmentId === appointmentId);
      assert.equal(byAppointment(oldBookingFutureDue)?.overdue, false);
      assert.equal(byAppointment(recentBookingPastDue)?.overdue, true);
      assert.equal(byAppointment(dueToday)?.overdue, false);
      assert.equal(byAppointment(unassignedOldBooking)?.overdue, false);
      assert.equal(baseline.cases.find((row) => row.comparisonRequestId === comparison)?.overdue, false);
      assert.equal(baseline.cases.some((row) => row.appointmentId === finalizedPastDue), false);
      assert.equal(baseline.cases.some((row) => row.appointmentId === reportNotRequired), false);
      assert.equal(baseline.cases.some((row) => row.appointmentId === assignedOtherDoctor), false);

      const finalized = await api<PersonalMobileView>(
        targetDoctor.cookie,
        `/api/reporting/saved-views/public/${worklist.token}/mobile?q=${encodeURIComponent(label)}&reportStatus=final&mobileQuickTab=my_cases&limit=100`
      );
      assert.equal(finalized.status, 200, JSON.stringify(finalized.data));
      assert.equal(finalized.data.cases.find((row) => row.appointmentId === finalizedPastDue)?.overdue, false);

      const overdue = await reportingBoardService.getPublicReportingBoardMobileView(null, worklist.token, {
        q: label,
        limit: 100,
        mobileQuickTab: "overdue",
        overdue: true,
      }) as PersonalMobileView;
      assert.equal(overdue.counters.overdue, baseline.counters.overdue);
      assert.deepEqual(overdue.cases.map((row) => row.appointmentId), [recentBookingPastDue]);
      assert.ok(overdue.cases.every((row) => row.overdue));
    });
  });

  it("scopes personal doctor worklists and atomically claims appointments and comparisons to self", async () => {
    guard();
    const date = addDays(12);
    const previousDate = addDays(-12);
    const label = uniq("doctor_worklist_scope");
    const assignedToMe = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} assigned me` });
    const unassigned = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, date, patientName: `${label} unassigned` });
    const assignedOther = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} assigned other` });
    const globallyDisabled = await createBooking({ modalityId: usModalityId, examTypeId: usExamTypeId, date, patientName: `${label} US` });
    const previous = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: previousDate, patientName: `${label} comparison` });
    const comparison = await createComparisonRequestForBooking(previous, `${date}T09:00:00.000Z`, label);
    [assignedToMe, unassigned, assignedOther, globallyDisabled].forEach((id) => statusByAppointmentId.set(id, "draft"));
    await assignDirectly(assignedToMe, doctor.doctorId);
    await assignDirectly(assignedOther, otherDoctor.doctorId);
    const own = await getDoctorWorklist(doctor, false);
    const other = await getDoctorWorklist(otherDoctor, false);

    const view = await api<{ cases: Array<{ caseType: string; appointmentId: number; comparisonRequestId: number | null }>; effectiveModalityCodes: string[] }>(
      doctor.cookie,
      `/api/reporting/saved-views/public/${own.token}/mobile?q=${encodeURIComponent(label)}&limit=100`
    );
    assert.equal(view.status, 200, JSON.stringify(view.data));
    assert.deepEqual(view.data.effectiveModalityCodes.sort(), ["CT", "MR"]);
    assert.equal(view.data.cases.some((row) => row.appointmentId === assignedToMe), true);
    assert.equal(view.data.cases.some((row) => row.appointmentId === unassigned), true);
    assert.equal(view.data.cases.some((row) => row.comparisonRequestId === comparison), true);
    assert.equal(view.data.cases.some((row) => row.appointmentId === assignedOther), false);
    assert.equal(view.data.cases.some((row) => row.appointmentId === globallyDisabled), false);
    const ctOnlyWorklist = await getDoctorWorklist(noMrPermissionDoctor, false);
    const ctOnlyView = await api<{ effectiveModalityCodes: string[] }>(noMrPermissionDoctor.cookie, `/api/reporting/saved-views/public/${ctOnlyWorklist.token}/mobile?limit=1`);
    assert.deepEqual(ctOnlyView.data.effectiveModalityCodes, ["CT"]);
    const noPermissionDoctor = await createDoctorUser("no_permissions", "doctor", { canReportModalities: [] });
    const emptyWorklist = await getDoctorWorklist(noPermissionDoctor, false);
    const emptyView = await api<{ cases: unknown[]; effectiveModalityCodes: string[]; scopeMessage: string | null }>(noPermissionDoctor.cookie, `/api/reporting/saved-views/public/${emptyWorklist.token}/mobile?limit=1`);
    assert.deepEqual(emptyView.data.effectiveModalityCodes, []);
    assert.deepEqual(emptyView.data.cases, []);
    assert.match(emptyView.data.scopeMessage ?? "", /No Reporting Board modalities/);

    const appointmentClaim = await api(doctor.cookie, `/api/reporting/saved-views/public/${own.token}/mobile/assign-to-me`, { method: "POST", body: { appointmentId: unassigned } });
    assert.equal(appointmentClaim.status, 200, JSON.stringify(appointmentClaim.data));
    assert.equal((await api(doctor.cookie, `/api/reporting/saved-views/public/${own.token}/mobile/assign-to-me`, { method: "POST", body: { caseType: "comparison", comparisonRequestId: comparison } })).status, 200);
    assert.equal((await api(otherDoctor.cookie, `/api/reporting/saved-views/public/${own.token}/mobile/assign-to-me`, { method: "POST", body: { appointmentId: assignedToMe } })).status, 403);
    assert.equal((await api(doctor.cookie, `/api/reporting/saved-views/public/${own.token}/mobile/assign-to-me`, { method: "POST", body: { appointmentId: assignedOther } })).status, 409);
    assert.equal((await api(doctor.cookie, `/api/reporting/saved-views/public/${own.token}/mobile/reassign`, { method: "POST", body: { appointmentId: unassigned, doctorId: otherDoctor.doctorId, reason: "denied" } })).status, 403);
    assert.equal((await api(doctor.cookie, `/api/reporting/saved-views/public/${own.token}/mobile/unassign`, { method: "POST", body: { appointmentId: unassigned, reason: "denied" } })).status, 403);

    const race = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} race` });
    statusByAppointmentId.set(race, "draft");
    const raceResults = await Promise.all([
      api(doctor.cookie, `/api/reporting/saved-views/public/${own.token}/mobile/assign-to-me`, { method: "POST", body: { appointmentId: race } }),
      api(otherDoctor.cookie, `/api/reporting/saved-views/public/${other.token}/mobile/assign-to-me`, { method: "POST", body: { appointmentId: race } }),
    ]);
    assert.deepEqual(raceResults.map((result) => result.status).sort(), [200, 409]);
  });

  it("keeps Personal Desk self-claims owner-bound for managers and comparisons", async () => {
    guard();
    const date = addDays(18);
    const previousDate = addDays(-18);
    const label = uniq("personal_desk_claim_owner");
    const doctorAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} doctor appointment` });
    const managerAppointment = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, date, patientName: `${label} manager appointment` });
    const adminAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} admin appointment` });
    const ordinaryCrossAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} ordinary cross-owner appointment` });
    const managerCrossAppointment = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, date, patientName: `${label} manager cross-owner appointment` });
    const doctorComparisonSource = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: previousDate, patientName: `${label} doctor comparison source` });
    const managerComparisonSource = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, date: previousDate, patientName: `${label} manager comparison source` });
    const doctorComparison = await createComparisonRequestForBooking(doctorComparisonSource, `${date}T09:00:00.000Z`, `${label} doctor comparison`);
    const managerComparison = await createComparisonRequestForBooking(managerComparisonSource, `${date}T09:05:00.000Z`, `${label} manager comparison`);
    [doctorAppointment, managerAppointment, adminAppointment, ordinaryCrossAppointment, managerCrossAppointment].forEach((id) => statusByAppointmentId.set(id, "draft"));

    const doctorWorklist = await getDoctorWorklist(doctor, false);
    const otherWorklist = await getDoctorWorklist(otherDoctor, false);
    const managerWorklist = await getDoctorWorklist(supervisor, false);
    const adminWorklist = await getDoctorWorklist(admin, false);

    const doctorClaim = await api(doctor.cookie, `/api/reporting/saved-views/public/${doctorWorklist.token}/mobile/assign-to-me`, {
      method: "POST", body: { appointmentId: doctorAppointment },
    });
    assert.equal(doctorClaim.status, 200, JSON.stringify(doctorClaim.data));

    const managerClaim = await api(supervisor.cookie, `/api/reporting/saved-views/public/${managerWorklist.token}/mobile/assign-to-me`, {
      method: "POST", body: { appointmentId: managerAppointment },
    });
    assert.equal(managerClaim.status, 200, JSON.stringify(managerClaim.data));

    const adminClaim = await api(admin.cookie, `/api/reporting/saved-views/public/${adminWorklist.token}/mobile/assign-to-me`, {
      method: "POST", body: { appointmentId: adminAppointment },
    });
    assert.equal(adminClaim.status, 200, JSON.stringify(adminClaim.data));

    const ordinaryCrossClaim = await api(doctor.cookie, `/api/reporting/saved-views/public/${otherWorklist.token}/mobile/assign-to-me`, {
      method: "POST", body: { appointmentId: ordinaryCrossAppointment },
    });
    assert.equal(ordinaryCrossClaim.status, 403, JSON.stringify(ordinaryCrossClaim.data));

    for (const manager of [supervisor, admin]) {
      const managerCrossClaim = await api(manager.cookie, `/api/reporting/saved-views/public/${otherWorklist.token}/mobile/assign-to-me`, {
        method: "POST", body: { appointmentId: managerCrossAppointment },
      });
      assert.equal(managerCrossClaim.status, 403, JSON.stringify(managerCrossClaim.data));
    }
    const appointmentAssignment = await pool.query<{ assigned_doctor_id: string }>(
      `select assigned_doctor_id::text from doctor_portal.case_team_assignments where appointment_id = $1 and assignment_type = 'reporting' and status = 'active'`,
      [managerCrossAppointment]
    );
    assert.deepEqual(appointmentAssignment.rows, []);

    const comparisonClaim = await api(doctor.cookie, `/api/reporting/saved-views/public/${doctorWorklist.token}/mobile/assign-to-me`, {
      method: "POST", body: { caseType: "comparison", comparisonRequestId: doctorComparison },
    });
    assert.equal(comparisonClaim.status, 200, JSON.stringify(comparisonClaim.data));

    for (const manager of [supervisor, admin]) {
      const managerComparisonClaim = await api(manager.cookie, `/api/reporting/saved-views/public/${otherWorklist.token}/mobile/assign-to-me`, {
        method: "POST", body: { caseType: "comparison", comparisonRequestId: managerComparison },
      });
      assert.equal(managerComparisonClaim.status, 403, JSON.stringify(managerComparisonClaim.data));
    }
    const comparisonState = await pool.query<{ status: string; assigned_doctor_id: string | null; active_assignments: string }>(
      `
        select cr.status, cr.assigned_doctor_id::text,
               (select count(*)::text from doctor_portal.comparison_case_assignments cca where cca.comparison_request_id = cr.id and cca.status = 'active') as active_assignments
        from comparison_requests cr
        where cr.id = $1
      `,
      [managerComparison]
    );
    assert.deepEqual(comparisonState.rows[0], { status: "ready_for_reporting", assigned_doctor_id: null, active_assignments: "0" });
  });

  it("restricts Personal Desk additional imaging to the assigned doctor's profile", async () => {
    guard();
    const createRequest = (cookie: string, appointmentId: number) => api<{ recall: { id: number; status: string } }>(cookie, `/api/doctor/reporting-board/cases/${appointmentId}/complementary-recalls`, {
      method: "POST",
      body: {
        reasonCode: "technical_equipment_problem",
        qaClassification: "technical_repeat",
        urgency: "routine",
        dueAt: null,
        reportingDisposition: "supplement_original_report",
        receptionInstruction: null,
        technologistInstruction: "Repeat the affected acquisition.",
      },
    });

    const ownAppointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(19), patientName: "Personal Desk assigned recall" });
    await assignDirectly(ownAppointmentId, doctor.doctorId);
    const ownActivePath = `/api/doctor/reporting-board/cases/${ownAppointmentId}/complementary-recalls/active`;
    const ownBeforeCreate = await api<{ recall: unknown | null }>(doctor.cookie, ownActivePath);
    assert.equal(ownBeforeCreate.status, 200, JSON.stringify(ownBeforeCreate.data));
    assert.equal(ownBeforeCreate.data.recall, null);
    const ownCreate = await createRequest(doctor.cookie, ownAppointmentId);
    assert.equal(ownCreate.status, 201, JSON.stringify(ownCreate.data));
    const ownAfterCreate = await api<{ recall: { id: number; status: string } | null }>(doctor.cookie, ownActivePath);
    assert.equal(ownAfterCreate.status, 200, JSON.stringify(ownAfterCreate.data));
    assert.equal(ownAfterCreate.data.recall?.id, ownCreate.data.recall.id);
    assert.equal(ownAfterCreate.data.recall?.status, "pending_scheduling");
    const ownWithdraw = await api(doctor.cookie, `/api/doctor/reporting-board/complementary-recalls/${ownCreate.data.recall.id}/withdraw`, { method: "POST" });
    assert.equal(ownWithdraw.status, 200, JSON.stringify(ownWithdraw.data));

    const unassignedAppointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(19), patientName: "Personal Desk unassigned recall" });
    const unassignedActive = await api(doctor.cookie, `/api/doctor/reporting-board/cases/${unassignedAppointmentId}/complementary-recalls/active`);
    assert.equal(unassignedActive.status, 403, JSON.stringify(unassignedActive.data));
    const unassignedCreate = await createRequest(doctor.cookie, unassignedAppointmentId);
    assert.equal(unassignedCreate.status, 403, JSON.stringify(unassignedCreate.data));

    const otherAppointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(19), patientName: "Personal Desk other doctor recall" });
    await assignDirectly(otherAppointmentId, otherDoctor.doctorId);
    const otherCreate = await createRequest(otherDoctor.cookie, otherAppointmentId);
    assert.equal(otherCreate.status, 201, JSON.stringify(otherCreate.data));
    const otherActivePath = `/api/doctor/reporting-board/cases/${otherAppointmentId}/complementary-recalls/active`;
    assert.equal((await api(doctor.cookie, otherActivePath)).status, 403);
    assert.equal((await createRequest(doctor.cookie, otherAppointmentId)).status, 403);
    for (const manager of [supervisor, admin]) {
      assert.equal((await api(manager.cookie, otherActivePath)).status, 403);
      const managerCreate = await createRequest(manager.cookie, otherAppointmentId);
      assert.equal(managerCreate.status, 403, JSON.stringify(managerCreate.data));
      const managerWithdraw = await api(manager.cookie, `/api/doctor/reporting-board/complementary-recalls/${otherCreate.data.recall.id}/withdraw`, { method: "POST" });
      assert.equal(managerWithdraw.status, 403, JSON.stringify(managerWithdraw.data));
    }
    const otherWithdraw = await api(otherDoctor.cookie, `/api/doctor/reporting-board/complementary-recalls/${otherCreate.data.recall.id}/withdraw`, { method: "POST" });
    assert.equal(otherWithdraw.status, 200, JSON.stringify(otherWithdraw.data));

    for (const manager of [supervisor, admin]) {
      const managerAppointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(19), patientName: `Personal Desk ${manager.id} recall` });
      await assignDirectly(managerAppointmentId, manager.doctorId);
      const managerCreate = await createRequest(manager.cookie, managerAppointmentId);
      assert.equal(managerCreate.status, 201, JSON.stringify(managerCreate.data));
      const managerActive = await api<{ recall: { id: number; status: string } | null }>(manager.cookie, `/api/doctor/reporting-board/cases/${managerAppointmentId}/complementary-recalls/active`);
      assert.equal(managerActive.status, 200, JSON.stringify(managerActive.data));
      assert.equal(managerActive.data.recall?.id, managerCreate.data.recall.id);
    }
  });

  it("keeps SonicDICOM-final mobile action flags closed except for manager reassignment", async () => {
    guard();
    const date = addDays(13);
    const label = uniq("mobile_final_actions");
    const finalUnassigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} final unassigned` });
    const draftUnassigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} draft unassigned` });
    const finalAssigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} final assigned` });
    const draftAssigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} draft assigned` });
    statusByAppointmentId.set(finalUnassigned, "final");
    statusByAppointmentId.set(draftUnassigned, "draft");
    statusByAppointmentId.set(finalAssigned, "final");
    statusByAppointmentId.set(draftAssigned, "draft");
    await statusByAppointmentId.flush();
    await assignDirectly(finalAssigned, targetDoctor.doctorId);
    await assignDirectly(draftAssigned, targetDoctor.doctorId);
    const allStatuses = await api(admin.cookie, "/api/doctor/reporting-board/settings", {
      method: "PUT",
      body: {
        cutoffMode: "fixed_date",
        defaultCutoffDate: addDays(-1),
        daysBack: 14,
        enabledModalityCodes: ["CT", "MR"],
        defaultRequiresReport: true,
        defaultReportStatusFilter: "required_not_final",
      },
    });
    assert.equal(allStatuses.status, 200, JSON.stringify(allStatuses.data));

    try {
      const own = await getDoctorWorklist(doctor, false);
      const ownView = await api<{ cases: Array<{ appointmentId: number; canAssignToMe: boolean; actionDisabledReason: string | null }> }>(
        doctor.cookie,
        `/api/reporting/saved-views/public/${own.token}/mobile?q=${encodeURIComponent(label)}&reportStatus=all&limit=100`
      );
      assert.equal(ownView.status, 200, JSON.stringify(ownView.data));
      const ownCases = new Map(ownView.data.cases.map((row) => [row.appointmentId, row]));
      assert.equal(ownCases.has(finalUnassigned), false);
      assert.equal(ownCases.get(draftUnassigned)?.canAssignToMe, true);

      const managerView = await createSavedView(admin, false, { q: label, reportStatus: "all" });
      const managed = await api<{ cases: Array<{ appointmentId: number; canUnassign: boolean; canReassign: boolean }> }>(
        supervisor.cookie,
        `/api/reporting/saved-views/public/${managerView.token}/mobile?reportStatus=all&limit=100`
      );
      assert.equal(managed.status, 200, JSON.stringify(managed.data));
      const managedCases = new Map(managed.data.cases.map((row) => [row.appointmentId, row]));
      assert.deepEqual(managedCases.get(finalUnassigned) && {
        canUnassign: managedCases.get(finalUnassigned)!.canUnassign,
        canReassign: managedCases.get(finalUnassigned)!.canReassign,
      }, { canUnassign: false, canReassign: true });
      assert.deepEqual(managedCases.get(finalAssigned) && {
        canUnassign: managedCases.get(finalAssigned)!.canUnassign,
        canReassign: managedCases.get(finalAssigned)!.canReassign,
      }, { canUnassign: false, canReassign: true });
      assert.deepEqual(managedCases.get(draftAssigned) && {
        canUnassign: managedCases.get(draftAssigned)!.canUnassign,
        canReassign: managedCases.get(draftAssigned)!.canReassign,
      }, { canUnassign: true, canReassign: true });
    } finally {
      await api(admin.cookie, "/api/doctor/reporting-board/settings", {
        method: "PUT",
        body: {
          cutoffMode: "fixed_date",
          defaultCutoffDate: addDays(-1),
          daysBack: 14,
          enabledModalityCodes: ["CT", "MR"],
          defaultRequiresReport: true,
          defaultReportStatusFilter: "required_not_final",
        },
      });
    }
  });

  it("exposes patientDicomId from primary patient identifier with legacy fallbacks but never MRN", async () => {
    guard();
    const date = addDays(10);
    const primaryCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "DICOM Primary" });
    const identifierValueCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "DICOM Identifier Value" });
    const nationalIdCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "DICOM National ID" });
    const mrnOnlyCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "DICOM MRN Not Used" });

    await setPatientIdentifierFields(primaryCase, { mrn: "MRN-NOT-DICOM-1", identifierValue: "LEGACY-DICOM-1", nationalId: "111111111111" });
    await insertPrimaryPatientIdentifier(primaryCase, "PRIMARY-DICOM-1");
    await setPatientIdentifierFields(identifierValueCase, { mrn: "MRN-NOT-DICOM-2", identifierValue: "LEGACY-DICOM-2", nationalId: "222222222222" });
    await setPatientIdentifierFields(nationalIdCase, { mrn: "MRN-NOT-DICOM-3", identifierValue: null, nationalId: "333333333333" });
    await setPatientIdentifierFields(mrnOnlyCase, { mrn: "MRN-NOT-DICOM-4", identifierValue: null, nationalId: null });

    const response = await api<{ cases: Array<{ appointmentId: number; patientDicomId: string | null; patientMrn: string | null }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all&sortBy=accession&sortDirection=asc`
    );
    assert.equal(response.status, 200);
    const byId = new Map(response.data.cases.map((row) => [row.appointmentId, row]));

    assert.equal(byId.get(primaryCase)?.patientDicomId, "PRIMARY-DICOM-1");
    assert.equal(byId.get(identifierValueCase)?.patientDicomId, "LEGACY-DICOM-2");
    assert.equal(byId.get(nationalIdCase)?.patientDicomId, "333333333333");
    assert.equal(byId.get(mrnOnlyCase)?.patientDicomId, null);
    assert.equal(byId.get(mrnOnlyCase)?.patientMrn, "MRN-NOT-DICOM-4");
  });

  it("opens visible Reporting Board studies in SonicDICOM without credentials and audits access", async () => {
    guard();
    const date = addDays(11);
    const ownCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Open Sonic Own" });
    const otherCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Open Sonic Other" });
    await setPatientIdentifierFields(ownCase, { mrn: "MRN-OPEN-SONIC", identifierValue: "OPEN-SONIC-DICOM-ID", nationalId: "444444444444" });
    await assignDirectly(ownCase, targetDoctor.doctorId, "2026-05-01T09:00:00.000Z");
    await assignDirectly(otherCase, otherDoctor.doctorId, "2026-05-01T09:00:00.000Z");
    await withSonicDicomConfig({
      sonicDicomReportsEnabled: true,
      sonicDicomPublicBaseUrl: "https://sonic.example/viewer/",
      sonicDicomLocalBaseUrl: "http://192.168.1.30/viewer/",
    }, async () => {
      const supervisorOpen = await rawApi(supervisor.cookie, `/api/doctor/reporting-board/cases/${ownCase}/open-sonicdicom?scope=study`, { Host: "192.168.1.20" });
      assert.equal(supervisorOpen.status, 302);
      const supervisorLocation = supervisorOpen.headers.get("location") ?? "";
      assert.match(supervisorLocation, /^http:\/\/192\.168\.1\.30\/viewer\/#\/viewer\?accessionnumber=V2-0/);
      assert.doesNotMatch(supervisorLocation, /username|password/i);

      const patientOpen = await rawApi(supervisor.cookie, `/api/doctor/reporting-board/cases/${ownCase}/open-sonicdicom?scope=patient`, {
        Host: "rispro-container:3000",
        "X-Forwarded-Host": "rispro.example.com",
      });
      assert.equal(patientOpen.status, 302);
      assert.equal(patientOpen.headers.get("location"), "https://sonic.example/viewer/#/list?patientid=OPEN-SONIC-DICOM-ID");

      const proxiedPublicOpen = await rawApi(supervisor.cookie, `/api/doctor/reporting-board/cases/${ownCase}/open-sonicdicom?scope=study&redirect=https://evil.example&host=evil.example`, {
        Host: "rispro-container:3000",
        "X-Forwarded-Host": "rispro.example.com",
        "X-Forwarded-Proto": "https",
      });
      assert.equal(proxiedPublicOpen.status, 302);
      assert.match(proxiedPublicOpen.headers.get("location") ?? "", /^https:\/\/sonic\.example\/viewer\/#\/viewer\?accessionnumber=V2-0/);
      assert.doesNotMatch(proxiedPublicOpen.headers.get("location") ?? "", /evil\.example/);

      const protocolingLocalOpen = await rawApi(supervisor.cookie, `/api/doctor/protocoling/appointments/${ownCase}/open-sonicdicom?scope=study`, { Host: "10.0.0.20" });
      assert.equal(protocolingLocalOpen.status, 302);
      assert.match(protocolingLocalOpen.headers.get("location") ?? "", /^http:\/\/192\.168\.1\.30\/viewer\/#\/viewer\?accessionnumber=V2-0/);

      const protocolingPublicOpen = await rawApi(supervisor.cookie, `/api/doctor/protocoling/appointments/${ownCase}/open-sonicdicom?scope=patient`, {
        Host: "rispro-container:3000",
        "X-Forwarded-Host": "rispro.example.com",
      });
      assert.equal(protocolingPublicOpen.status, 302);
      assert.equal(protocolingPublicOpen.headers.get("location"), "https://sonic.example/viewer/#/list?patientid=OPEN-SONIC-DICOM-ID");

      const ownOpen = await rawApi(targetDoctor.cookie, `/api/doctor/reporting-board/cases/${ownCase}/open-sonicdicom`);
      assert.equal(ownOpen.status, 302);
      assert.match(ownOpen.headers.get("location") ?? "", /accessionnumber=V2-0/);

      const forbidden = await rawApi(targetDoctor.cookie, `/api/doctor/reporting-board/cases/${otherCase}/open-sonicdicom`);
      assert.equal(forbidden.status, 403);

      const missing = await rawApi(supervisor.cookie, "/api/doctor/reporting-board/cases/999999999/open-sonicdicom");
      assert.equal(missing.status, 404);

      const audit = await pool.query(
        `
          select 1
          from doctor_portal.doctor_module_audit_events
          where event_type = 'reporting_board_sonicdicom_study_opened'
            and target_id = $1
            and metadata_json->>'accessionNumber' like 'V2-%'
            and metadata_json->>'source' = 'reporting_board'
        `,
        [ownCase]
      );
      assert.ok((audit.rowCount ?? 0) >= 2);
    });
  });

  it("authorizes appointment and comparison history through the personal desk and restricts prior-study redirects to that history", async () => {
    guard();
    const date = addDays(14);
    const label = uniq("personal_history");
    const anchorAppointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} anchor` });
    const relatedAppointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} related` });
    await linkBookingToPatient(relatedAppointmentId, anchorAppointmentId);
    await assignDirectly(anchorAppointmentId, doctor.doctorId);

    const assignedComparisonId = await createComparisonRequestForBooking(anchorAppointmentId, `${date}T08:00:00.000Z`, `${label} assigned comparison`);
    await assignComparisonDirectly(assignedComparisonId, doctor.doctorId);
    const otherComparisonId = await createComparisonRequestForBooking(anchorAppointmentId, `${date}T08:01:00.000Z`, `${label} other comparison`);
    await assignComparisonDirectly(otherComparisonId, otherDoctor.doctorId);
    const unassignedComparisonId = await createComparisonRequestForBooking(anchorAppointmentId, `${date}T08:02:00.000Z`, `${label} unassigned comparison`);

    const comparisonHistory = await api<{ currentPatient?: { id: number }; canReconcilePatientIdentity?: boolean }>(
      doctor.cookie,
      `/api/doctor/reporting-board/comparisons/${assignedComparisonId}/history`
    );
    assert.equal(comparisonHistory.status, 200, JSON.stringify(comparisonHistory.data));
    assert.equal(comparisonHistory.data.currentPatient?.id, await patientIdForBooking(anchorAppointmentId));
    assert.equal(comparisonHistory.data.canReconcilePatientIdentity, false);

    const appointmentHistory = await api<{ currentPatient?: { id: number }; canReconcilePatientIdentity?: boolean }>(
      doctor.cookie,
      `/api/doctor/reporting-board/cases/${anchorAppointmentId}/history`
    );
    assert.equal(appointmentHistory.status, 200, JSON.stringify(appointmentHistory.data));
    assert.equal(appointmentHistory.data.canReconcilePatientIdentity, false);

    assert.equal((await api(otherDoctor.cookie, `/api/doctor/reporting-board/comparisons/${assignedComparisonId}/history`)).status, 403);
    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/comparisons/${otherComparisonId}/history`)).status, 200);
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/comparisons/${unassignedComparisonId}/history`)).status, 200);

    await pool.query(`update doctor_portal.doctor_profiles set can_assign_protocols = false where id = $1`, [doctor.doctorId]);
    try {
      assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/comparisons/${assignedComparisonId}/history`)).status, 200);
    } finally {
      await pool.query(`update doctor_portal.doctor_profiles set can_assign_protocols = true where id = $1`, [doctor.doctorId]);
    }

    const relatedAccession = `V2-${String(relatedAppointmentId).padStart(6, "0")}`;
    await withSonicDicomConfig({
      sonicDicomReportsEnabled: true,
      sonicDicomPublicBaseUrl: "https://sonic.example/viewer/",
    }, async () => {
      const appointmentOpen = await rawApi(
        doctor.cookie,
        `/api/doctor/reporting-board/cases/${anchorAppointmentId}/history/open-sonicdicom?accession=${encodeURIComponent(relatedAccession)}`
      );
      assert.equal(appointmentOpen.status, 302);
      assert.match(appointmentOpen.headers.get("location") ?? "", new RegExp(`accessionnumber=${relatedAccession}`));

      const comparisonOpen = await rawApi(
        doctor.cookie,
        `/api/doctor/reporting-board/comparisons/${assignedComparisonId}/history/open-sonicdicom?accession=${encodeURIComponent(relatedAccession)}`
      );
      assert.equal(comparisonOpen.status, 302);

      const unauthorizedAccession = await rawApi(
        doctor.cookie,
        `/api/doctor/reporting-board/cases/${anchorAppointmentId}/history/open-sonicdicom?accession=NOT-IN-HISTORY`
      );
      assert.equal(unauthorizedAccession.status, 404);
    });
  });

  it("authorizes finalized appointment and comparison read paths only to their finalizer", async () => {
    guard();
    const date = addDays(15);
    const label = uniq("finalized_personal_read");
    const finalizedAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} target appointment` });
    const otherFinalAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} other appointment` });
    const activeTargetAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} active target appointment` });
    const activeOtherAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: `${label} active other appointment` });
    const targetPriorAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(14), patientName: `${label} target prior` });
    const otherPriorAppointment = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(14), patientName: `${label} other prior` });
    await linkBookingToPatient(targetPriorAppointment, finalizedAppointment);
    await linkBookingToPatient(otherPriorAppointment, otherFinalAppointment);
    await assignDirectly(activeTargetAppointment, targetDoctor.doctorId);
    await assignDirectly(activeOtherAppointment, otherDoctor.doctorId);
    statusByAppointmentId.set(activeTargetAppointment, "draft");
    statusByAppointmentId.set(activeOtherAppointment, "draft");
    await statusByAppointmentId.flush();
    const comparisonTarget = await createComparisonRequestForBooking(targetPriorAppointment, `${date}T08:00:00.000Z`, `${label} target comparison`);
    const comparisonOther = await createComparisonRequestForBooking(otherPriorAppointment, `${date}T08:01:00.000Z`, `${label} other comparison`);

    await pool.query(`insert into doctor_portal.reporting_board_manual_final_overrides (appointment_id, reason, created_by_user_id, created_by_doctor_id) values ($1, 'finalized read authorization test', $2, $3), ($4, 'finalized read authorization test', $5, $6)`, [
      finalizedAppointment, targetDoctor.id, targetDoctor.doctorId,
      otherFinalAppointment, otherDoctor.id, otherDoctor.doctorId,
    ]);
    await pool.query(`update comparison_requests set status = 'finalized', finalized_by = $2, finalized_at = now() where id = $1`, [comparisonTarget, targetDoctor.id]);
    await pool.query(`update comparison_requests set status = 'finalized', finalized_by = $2, finalized_at = now() where id = $1`, [comparisonOther, otherDoctor.id]);

    const ohifSettings = await pool.query<{ enabled: boolean; selected_pacs_node_id: number | null }>(
      `select enabled, selected_pacs_node_id from ohif_viewer_settings where singleton_key = true limit 1`
    );
    await pool.query(`update ohif_viewer_settings set enabled = false, selected_pacs_node_id = null where singleton_key = true`);
    try {
      const targetActor = { userId: targetDoctor.id, appRole: "doctor" as const };
      const targetFinalLaunch = await ohifViewerService.launchReportingBoardCaseInOhif(targetActor, finalizedAppointment, false);
      assert.equal(targetFinalLaunch.status, "configuration_error");
      const targetActiveLaunch = await ohifViewerService.launchReportingBoardCaseInOhif(targetActor, activeTargetAppointment, false);
      assert.equal(targetActiveLaunch.status, "configuration_error");
      await assert.rejects(
        () => ohifViewerService.launchReportingBoardCaseInOhif(targetActor, otherFinalAppointment, false),
        (error: unknown) => error instanceof Error && "statusCode" in error && (error as { statusCode?: number }).statusCode === 403
      );
      await assert.rejects(
        () => ohifViewerService.launchReportingBoardCaseInOhif(targetActor, activeOtherAppointment, false),
        (error: unknown) => error instanceof Error && "statusCode" in error && (error as { statusCode?: number }).statusCode === 403
      );
    } finally {
      const originalOhifSettings = ohifSettings.rows[0];
      if (originalOhifSettings) {
        await pool.query(
          `update ohif_viewer_settings set enabled = $1, selected_pacs_node_id = $2 where singleton_key = true`,
          [originalOhifSettings.enabled, originalOhifSettings.selected_pacs_node_id]
        );
      }
    }

    const targetHistory = await api<{ canReconcilePatientIdentity?: boolean }>(targetDoctor.cookie, `/api/doctor/reporting-board/cases/${finalizedAppointment}/history`);
    assert.equal(targetHistory.status, 200, JSON.stringify(targetHistory.data));
    assert.equal(targetHistory.data.canReconcilePatientIdentity, false);
    assert.equal((await api(otherDoctor.cookie, `/api/doctor/reporting-board/cases/${finalizedAppointment}/history`)).status, 403);
    assert.equal((await api(targetDoctor.cookie, `/api/doctor/reporting-board/cases/${finalizedAppointment}/history/historical-candidates`)).status, 200);

    const targetOhif = await api(targetDoctor.cookie, `/api/doctor/reporting-board/cases/${finalizedAppointment}/viewer-launch`, { method: "POST", body: { includePriors: false } });
    assert.notEqual(targetOhif.status, 403, JSON.stringify(targetOhif.data));
    assert.equal((await api(otherDoctor.cookie, `/api/doctor/reporting-board/cases/${finalizedAppointment}/viewer-launch`, { method: "POST", body: { includePriors: false } })).status, 403);

    const targetComparisonHistory = await api<{ canReconcilePatientIdentity?: boolean }>(targetDoctor.cookie, `/api/doctor/reporting-board/comparisons/${comparisonTarget}/history`);
    assert.equal(targetComparisonHistory.status, 200, JSON.stringify(targetComparisonHistory.data));
    assert.equal(targetComparisonHistory.data.canReconcilePatientIdentity, false);
    assert.equal((await api(targetDoctor.cookie, `/api/doctor/reporting-board/comparisons/${comparisonTarget}/history/historical-candidates`)).status, 200);
    assert.equal((await api(otherDoctor.cookie, `/api/doctor/reporting-board/comparisons/${comparisonTarget}/history`)).status, 403);
    assert.equal((await api(targetDoctor.cookie, `/api/doctor/reporting-board/comparisons/${comparisonOther}/history`)).status, 403);

    await withSonicDicomConfig({
      sonicDicomReportsEnabled: true,
      sonicDicomPublicBaseUrl: "https://sonic.example/viewer/",
    }, async () => {
      const appointmentOpen = await rawApi(targetDoctor.cookie, `/api/doctor/reporting-board/cases/${finalizedAppointment}/open-sonicdicom?scope=study`);
      assert.equal(appointmentOpen.status, 302);
      assert.equal((await rawApi(otherDoctor.cookie, `/api/doctor/reporting-board/cases/${finalizedAppointment}/open-sonicdicom?scope=study`)).status, 403);

      const comparisonOpen = await rawApi(targetDoctor.cookie, `/api/doctor/reporting-board/comparisons/${comparisonTarget}/history/open-sonicdicom?accession=V2-${String(finalizedAppointment).padStart(6, "0")}`);
      assert.equal(comparisonOpen.status, 302);
      assert.equal((await rawApi(otherDoctor.cookie, `/api/doctor/reporting-board/comparisons/${comparisonTarget}/history/open-sonicdicom?accession=V2-${String(finalizedAppointment).padStart(6, "0")}`)).status, 403);
    });
  });

  it("rejects malformed SonicDICOM public base URL for staff viewer redirects", async () => {
    guard();
    const date = addDays(13);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Open Sonic Bad Template" });
    await withSonicDicomConfig({
      sonicDicomReportsEnabled: true,
      sonicDicomPublicBaseUrl: "not a url",
    }, async () => {
      const response = await rawApi(supervisor.cookie, `/api/doctor/reporting-board/cases/${appointmentId}/open-sonicdicom`);
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.match(body, /public SonicDICOM browser URL is malformed/i);
    });
  });

  it("exposes Reporting Board timeline fields and derives aging/TAT metrics", async () => {
    guard();
    const date = addDays(12);
    const unassignedId = await createBooking({
      modalityId: ctModalityId,
      examTypeId: ctExamTypeId,
      date,
      patientName: "Timeline Unassigned",
      completedAt: "2026-05-01T08:00:00.000Z",
    });
    const reassignedId = await createBooking({
      modalityId: ctModalityId,
      examTypeId: ctExamTypeId,
      date,
      patientName: "Timeline Reassigned",
      completedAt: "2026-05-01T08:00:00.000Z",
    });
    const finalId = await createBooking({
      modalityId: ctModalityId,
      examTypeId: ctExamTypeId,
      date,
      patientName: "Timeline Final",
      completedAt: "2026-05-01T08:00:00.000Z",
    });
    await pool.query(
      `
        insert into doctor_portal.case_team_assignments (
          appointment_id, roster_assignment_id, assigned_doctor_id, modality_id, assignment_type, expected_reporting_date, assigned_at, status
        )
        select id, null, $2, modality_id, 'reporting', booking_date, '2026-05-01T09:00:00.000Z'::timestamptz, 'corrected'
        from appointments_v2.bookings
        where id = $1
      `,
      [reassignedId, otherDoctor.doctorId]
    );
    await assignDirectly(reassignedId, targetDoctor.doctorId, "2026-05-01T10:00:00.000Z");
    await assignDirectly(finalId, targetDoctor.doctorId, "2026-05-01T09:00:00.000Z");
    statusByAppointmentId.set(unassignedId, "draft");
    statusByAppointmentId.set(reassignedId, "draft");
    await seedSonicDicomCache(finalId, "final", "2026-05-02T09:00:00.000Z");

    const response = await api<{
      cases: Array<{
        appointmentId: number;
        completedAt: string | null;
        currentAssignedAt: string | null;
        firstAssignedAt: string | null;
        reportFinalAt: string | null;
        dueAt: string | null;
        completedToAssignedMinutes: number | null;
        assignedToFinalMinutes: number | null;
        completedToFinalMinutes: number | null;
        currentAssignmentAgeMinutes: number | null;
        completedUnassignedAgeMinutes: number | null;
      }>;
    }>(supervisor.cookie, `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=all&limit=20`);
    assert.equal(response.status, 200);
    const byId = new Map(response.data.cases.map((row) => [row.appointmentId, row]));

    const unassigned = byId.get(unassignedId);
    assert.equal(unassigned?.completedAt, "2026-05-01T08:00:00.000Z");
    assert.equal(unassigned?.currentAssignedAt, null);
    assert.equal(unassigned?.firstAssignedAt, null);
    assert.equal(unassigned?.dueAt, null);
    assert.equal(unassigned?.completedToAssignedMinutes, null);
    assert.ok((unassigned?.completedUnassignedAgeMinutes ?? 0) > 0);

    const reassigned = byId.get(reassignedId);
    assert.equal(reassigned?.currentAssignedAt, "2026-05-01T10:00:00.000Z");
    assert.equal(reassigned?.firstAssignedAt, "2026-05-01T09:00:00.000Z");
    assert.equal(reassigned?.completedToAssignedMinutes, 60);
    assert.ok((reassigned?.currentAssignmentAgeMinutes ?? 0) > 0);
    assert.equal(reassigned?.reportFinalAt, null);
    assert.equal(reassigned?.assignedToFinalMinutes, null);

    const finalCase = byId.get(finalId);
    assert.equal(finalCase?.reportFinalAt, "2026-05-02T09:00:00.000Z");
    assert.equal(finalCase?.assignedToFinalMinutes, 1440);
    assert.equal(finalCase?.completedToFinalMinutes, 1500);
    assert.equal(finalCase?.currentAssignmentAgeMinutes, null);

    const stats = await api<{
      summary: {
        medianCompletedToAssignedMinutes: number | null;
        medianAssignedToFinalMinutes: number | null;
        p90AssignedToFinalMinutes: number | null;
        longestActiveAssignmentAgeMinutes: number | null;
        completedUnassigned: number;
      };
    }>(supervisor.cookie, `/api/doctor/reporting-board/stats?dateFrom=${date}&dateTo=${date}&reportStatus=final`);
    assert.equal(stats.status, 200);
    assert.equal(stats.data.summary.medianCompletedToAssignedMinutes, 60);
    assert.equal(stats.data.summary.medianAssignedToFinalMinutes, 1440);
    assert.equal(stats.data.summary.p90AssignedToFinalMinutes, 1440);
    assert.equal(stats.data.summary.completedUnassigned, 0);
    assert.equal(stats.data.summary.longestActiveAssignmentAgeMinutes, null);
  });

  it("orders cases by priority sort order, booking date, booking time nulls first, and appointment id", async () => {
    guard();
    const date = addDays(20);
    const routine = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date: addDays(18), time: "08:00", patientName: "Routine" });
    const noPriority = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: null, date, time: "07:00", patientName: "No Priority" });
    const urgent = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: urgentPriorityId, date, time: "09:00", patientName: "Urgent" });
    const statLate = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, time: "10:00", patientName: "Stat Late" });
    const statNullTime = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, time: null, patientName: "Stat Null Time" });
    [routine, noPriority, urgent, statLate, statNullTime].forEach((id) => statusByAppointmentId.set(id, "draft"));

    const response = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${addDays(18)}&dateTo=${date}&limit=20`
    );
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.cases.map((row) => row.appointmentId).filter((id) => [routine, noPriority, urgent, statLate, statNullTime].includes(id)), [
      statNullTime,
      statLate,
      urgent,
      routine,
      noPriority,
    ]);
  });

  it("includes draft/no-report/study-not-found/unavailable and excludes final for required_not_final", async () => {
    guard();
    const date = addDays(30);
    const finalId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic Final" });
    const draftId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic Draft" });
    const noReportId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic No Report" });
    const studyMissingId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic Study Missing" });
    const unavailableId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sonic Unavailable" });
    statusByAppointmentId.set(finalId, "final");
    statusByAppointmentId.set(draftId, "draft");
    statusByAppointmentId.set(noReportId, "no_report");
    statusByAppointmentId.set(studyMissingId, "study_not_found");
    statusByAppointmentId.set(unavailableId, "throw");

    const response = await api<{ cases: Array<{ appointmentId: number; reportStatus: string }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=required_not_final`
    );
    assert.equal(response.status, 200);
    const byId = new Map(response.data.cases.map((row) => [row.appointmentId, row.reportStatus]));
    assert.equal(byId.has(finalId), false);
    assert.equal(byId.get(draftId), "draft");
    assert.equal(byId.get(noReportId), "no_report");
    assert.equal(byId.get(studyMissingId), "study_not_found");
    assert.equal(byId.get(unavailableId), "unavailable");
  });

  it("keeps report-status-filtered stats consistent with table rows", async () => {
    guard();
    const date = addDays(35);
    const finalId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Stats Final" });
    const draftId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Stats Draft" });
    statusByAppointmentId.set(finalId, "final");
    statusByAppointmentId.set(draftId, "draft");

    for (const reportStatus of ["required_not_final", "draft", "final"] as const) {
      const stats = await api<{ summary: { total: number; requiredNotFinal: number; draft: number; final: number } }>(
        supervisor.cookie,
        `/api/doctor/reporting-board/stats?dateFrom=${date}&dateTo=${date}&reportStatus=${reportStatus}`
      );
      const cases = await api<{ cases: Array<{ appointmentId: number; reportStatus: string }> }>(
        supervisor.cookie,
        `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=${reportStatus}`
      );

      assert.equal(stats.status, 200, JSON.stringify(stats.data));
      assert.equal(cases.status, 200, JSON.stringify(cases.data));
      assert.equal(stats.data.summary.total, cases.data.cases.length, reportStatus);
    }
  });

  it("filters the complete local candidate scope before paginating cases and stats", async () => {
    guard();
    const earlyDate = addDays(36);
    const laterDate = addDays(37);
    const fixture = await createCandidateWindowFixture({ earlyDate, laterDate, finalCount: 105, draftCount: 15 });
    const query = `dateFrom=${earlyDate}&dateTo=${laterDate}&modalityCode=CT&caseSource=appointments&reportStatus=required_not_final&sortBy=study_date&sortDirection=asc&pinUrgentToTop=false`;

    const all = await api<{
      cases: Array<{ appointmentId: number; reportStatus: string }>;
      totalCount: number;
      pagination: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null };
    }>(supervisor.cookie, `/api/doctor/reporting-board/cases?${query}&limit=20&offset=0`);
    assert.equal(all.status, 200, JSON.stringify(all.data));
    assert.equal(all.data.cases.length, 15);
    assert.equal(all.data.totalCount, 15);
    assert.deepEqual(new Set(all.data.cases.map((row) => row.appointmentId)), new Set(fixture.draftIds));
    assert.equal(all.data.cases.every((row) => row.reportStatus === "draft"), true);
    assert.equal(all.data.cases.some((row) => fixture.finalIds.includes(row.appointmentId)), false);
    assert.deepEqual(all.data.pagination, { limit: 20, offset: 0, hasMore: false, nextOffset: null });

    const firstPage = await api<typeof all.data>(supervisor.cookie, `/api/doctor/reporting-board/cases?${query}&limit=10&offset=0`);
    assert.equal(firstPage.status, 200, JSON.stringify(firstPage.data));
    assert.equal(firstPage.data.cases.length, 10);
    assert.equal(firstPage.data.totalCount, 15);
    assert.deepEqual(firstPage.data.pagination, { limit: 10, offset: 0, hasMore: true, nextOffset: 10 });

    const secondPage = await api<typeof all.data>(supervisor.cookie, `/api/doctor/reporting-board/cases?${query}&limit=10&offset=10`);
    assert.equal(secondPage.status, 200, JSON.stringify(secondPage.data));
    assert.deepEqual(secondPage.data.cases.map((row) => row.appointmentId), all.data.cases.slice(10).map((row) => row.appointmentId));
    assert.equal(secondPage.data.totalCount, 15);
    assert.deepEqual(secondPage.data.pagination, { limit: 10, offset: 10, hasMore: false, nextOffset: null });

    const stats = await api<{ summary: { total: number } }>(supervisor.cookie, `/api/doctor/reporting-board/stats?${query}`);
    assert.equal(stats.status, 200, JSON.stringify(stats.data));
    assert.equal(stats.data.summary.total, 15);
  });

  it("bulk assigns next eligible appointment cases in protected priority/age order and enforces assignment rules", async () => {
    guard();
    const date = addDays(40);
    const stat = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, time: "09:00", patientName: "Bulk Stat" });
    const urgent = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, priorityId: urgentPriorityId, date, time: null, patientName: "Bulk Urgent" });
    const routine = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date, time: "08:00", patientName: "Bulk Routine" });
    const noPriority = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: null, date, time: "07:00", patientName: "Bulk No Priority" });
    const later = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: null, date, time: "08:00", patientName: "Bulk Later" });
    const alreadyAssigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, time: null, patientName: "Bulk Already Assigned" });
    const finalCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, time: null, patientName: "Bulk Final" });
    const noReport = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, requiresReport: false, patientName: "Bulk No Report" });
    const cancelled = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, status: "cancelled", patientName: "Bulk Cancelled" });
    const comparison = await createComparisonRequestForBooking(urgent, `${date}T10:00:00.000Z`, "automatic bulk assignment exclusion");
    [stat, urgent, routine, noPriority, later, alreadyAssigned, noReport, cancelled].forEach((id) => statusByAppointmentId.set(id, "draft"));
    statusByAppointmentId.set(finalCase, "final");
    await assignDirectly(alreadyAssigned, otherDoctor.doctorId);

    const noNote = await api<{ assignedCount: number; requestedCount: number }>(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", {
      method: "POST",
      body: { doctorId: targetDoctor.doctorId, count: 1, filters: { dateFrom: addDays(41), dateTo: addDays(41) }, reason: "" },
    });
    assert.equal(noNote.status, 200);
    assert.equal(noNote.data.requestedCount, 1);
    assert.equal(noNote.data.assignedCount, 0);
    assert.equal((await api(doctor.cookie, "/api/doctor/reporting-board/bulk-assign-next", { method: "POST", body: { doctorId: targetDoctor.doctorId, count: 1, filters: { dateFrom: date, dateTo: date }, reason: "no" } })).status, 403);
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", { method: "POST", body: { doctorId: inactiveDoctor.doctorId, count: 1, filters: { dateFrom: date, dateTo: date }, reason: "inactive" } })).status, 404);
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", { method: "POST", body: { doctorId: noFinalizeDoctor.doctorId, count: 1, filters: { dateFrom: date, dateTo: date }, reason: "no finalize" } })).status, 400);
    const noMrPermission = await api<{ assignedCount: number; assignedAppointmentIds: number[] }>(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", {
      method: "POST",
      body: { doctorId: noMrPermissionDoctor.doctorId, count: 2, filters: { dateFrom: date, dateTo: date, modalityId: usModalityId, caseSource: "comparisons" }, reason: "missing MR" },
    });
    assert.equal(noMrPermission.status, 200, JSON.stringify(noMrPermission.data));
    assert.deepEqual(noMrPermission.data.assignedAppointmentIds, []);
    assert.equal((await pool.query(`select 1 from doctor_portal.comparison_case_assignments where comparison_request_id = $1`, [comparison])).rowCount, 0);

    const response = await api<{ assignedCount: number; requestedCount: number; assignedAppointmentIds: number[] }>(
      supervisor.cookie,
      "/api/doctor/reporting-board/bulk-assign-next",
      { method: "POST", body: { doctorId: targetDoctor.doctorId, count: 3, filters: { dateFrom: date, dateTo: date }, reason: "daily reporting distribution" } }
    );
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.requestedCount, 3);
    assert.equal(response.data.assignedCount, 3);
    assert.deepEqual(response.data.assignedAppointmentIds, [stat, urgent, routine]);
    const assignedRows = await pool.query<{ appointment_id: string; assigned_doctor_id: string }>(
      `select appointment_id::text, assigned_doctor_id::text from doctor_portal.case_team_assignments where appointment_id = any($1::bigint[]) and status = 'active' order by appointment_id`,
      [[stat, urgent, routine, alreadyAssigned, finalCase, noReport, cancelled]]
    );
    const assigned = new Map(assignedRows.rows.map((row) => [Number(row.appointment_id), Number(row.assigned_doctor_id)]));
    assert.equal(assigned.get(stat), targetDoctor.doctorId);
    assert.equal(assigned.get(urgent), targetDoctor.doctorId);
    assert.equal(assigned.get(routine), targetDoctor.doctorId);
    assert.equal(assigned.get(alreadyAssigned), otherDoctor.doctorId);
    assert.equal(assigned.has(finalCase), false);
    assert.equal(assigned.has(noReport), false);
    assert.equal(assigned.has(cancelled), false);
    const audit = await pool.query(`select 1 from doctor_portal.doctor_module_audit_events where event_type = 'reporting_board_bulk_assign_completed' and reason = $1 limit 1`, ["daily reporting distribution"]);
    assert.equal(audit.rowCount, 1);
  });

  it("filters unauthorized modalities in SQL scope before automatic candidate selection", async () => {
    guard();
    const date = addDays(45);
    const unauthorizedMr = await Promise.all(Array.from({ length: 8 }, (_, index) => createBooking({
      modalityId: mrModalityId,
      examTypeId: mrExamTypeId,
      date,
      completedAt: `2026-01-01T0${index}:00:00.000Z`,
      patientName: `Unauthorized MR ${index}`,
    })));
    const authorizedCt = await Promise.all(Array.from({ length: 5 }, (_, index) => createBooking({
      modalityId: ctModalityId,
      examTypeId: ctExamTypeId,
      date,
      completedAt: `2026-02-01T0${index}:00:00.000Z`,
      patientName: `Authorized CT ${index}`,
    })));
    [...unauthorizedMr, ...authorizedCt].forEach((id) => statusByAppointmentId.set(id, "draft"));

    const response = await api<{ assignedCount: number; assignedAppointmentIds: number[] }>(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", {
      method: "POST",
      body: { doctorId: noMrPermissionDoctor.doctorId, count: 5, filters: { dateFrom: date, dateTo: date }, reason: "CT-only distribution" },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.assignedCount, 5);
    assert.deepEqual(response.data.assignedAppointmentIds, authorizedCt);
  });

  it("uses the protected automatic order for scheduled jobs", async () => {
    guard();
    const date = addDays(46);
    const routine = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date, completedAt: "2026-01-01T08:00:00.000Z", patientName: "Scheduled routine" });
    const urgent = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: urgentPriorityId, date, completedAt: "2026-01-02T08:00:00.000Z", patientName: "Scheduled urgent" });
    const stat = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, completedAt: "2026-01-03T08:00:00.000Z", patientName: "Scheduled stat" });
    [routine, urgent, stat].forEach((id) => statusByAppointmentId.set(id, "draft"));

    const created = await api<{ job: { id: number } }>(supervisor.cookie, "/api/doctor/reporting-board/bulk-assignment-jobs", {
      method: "POST",
      body: { scheduledFor: new Date().toISOString(), doctorId: targetDoctor.doctorId, count: 3, filters: { dateFrom: date, dateTo: date, sortBy: "patient_name", pinUrgentToTop: true }, reason: "scheduled protected order" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const ran = await api<{ job: { status: string; result: { assignedAppointmentIds: number[] } } }>(supervisor.cookie, `/api/doctor/reporting-board/bulk-assignment-jobs/${created.data.job.id}/run-now`, { method: "POST" });
    assert.equal(ran.status, 200, JSON.stringify(ran.data));
    assert.equal(ran.data.job.status, "completed");
    assert.deepEqual(ran.data.job.result.assignedAppointmentIds, [stat, urgent, routine]);
  });

  it("never assigns final studies from final or all report-status filters", async () => {
    guard();
    const date = addDays(47);
    const finalCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, patientName: "Automatic final exclusion" });
    const routine = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date, patientName: "Automatic all filter routine" });
    statusByAppointmentId.set(finalCase, "final");
    statusByAppointmentId.set(routine, "draft");

    const finalOnly = await api<{ assignedCount: number }>(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", {
      method: "POST",
      body: { doctorId: targetDoctor.doctorId, count: 1, filters: { dateFrom: date, dateTo: date, reportStatus: "final" }, reason: "final filter exclusion" },
    });
    assert.equal(finalOnly.status, 200, JSON.stringify(finalOnly.data));
    assert.equal(finalOnly.data.assignedCount, 0);
    const allStatuses = await api<{ assignedAppointmentIds: number[] }>(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", {
      method: "POST",
      body: { doctorId: targetDoctor.doctorId, count: 1, filters: { dateFrom: date, dateTo: date, reportStatus: "all" }, reason: "all filter exclusion" },
    });
    assert.equal(allStatuses.status, 200, JSON.stringify(allStatuses.data));
    assert.deepEqual(allStatuses.data.assignedAppointmentIds, [routine]);
  });

  it("allows a supervisor to assign an unassigned SonicDICOM-final appointment without changing finality", async () => {
    guard();
    const date = addDays(48);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Manual final attribution" });
    statusByAppointmentId.set(appointmentId, "final");
    await statusByAppointmentId.flush();

    const board = await api<{ cases: Array<{ appointmentId: number; reportStatus: string; canAssign: boolean; exclusionReason: string | null }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=final`
    );
    assert.equal(board.status, 200, JSON.stringify(board.data));
    const row = board.data.cases.find((caseRow) => caseRow.appointmentId === appointmentId);
    assert.deepEqual(row && { reportStatus: row.reportStatus, canAssign: row.canAssign, exclusionReason: row.exclusionReason }, {
      reportStatus: "final", canAssign: true, exclusionReason: null,
    });

    const assigned = await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentId}/assign-doctor`, {
      method: "POST",
      body: { doctorId: targetDoctor.doctorId, reason: "attribute completed final report" },
    });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.data));
    assert.equal((await pool.query(
      `select 1 from doctor_portal.case_team_assignments where appointment_id = $1 and assigned_doctor_id = $2 and assignment_type = 'reporting' and status = 'active'`,
      [appointmentId, targetDoctor.doctorId]
    )).rowCount, 1);
    assert.equal((await api<{ cases: Array<{ appointmentId: number; reportStatus: string }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&reportStatus=final`
    )).data.cases.find((caseRow) => caseRow.appointmentId === appointmentId)?.reportStatus, "final");
  });

  it("allows a supervisor to reassign a SonicDICOM-final appointment but not return it to the waiting pool", async () => {
    guard();
    const date = addDays(49);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Manual final reassignment" });
    statusByAppointmentId.set(appointmentId, "final");
    await statusByAppointmentId.flush();
    await assignDirectly(appointmentId, otherDoctor.doctorId);

    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentId}/assign-doctor`, {
      method: "POST", body: { doctorId: targetDoctor.doctorId, reason: "" },
    })).status, 400);
    const reassigned = await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentId}/assign-doctor`, {
      method: "POST", body: { doctorId: targetDoctor.doctorId, reason: "correct reporting attribution" },
    });
    assert.equal(reassigned.status, 200, JSON.stringify(reassigned.data));
    const assignments = await pool.query<{ assigned_doctor_id: string; status: string }>(
      `select assigned_doctor_id::text, status from doctor_portal.case_team_assignments where appointment_id = $1 and assignment_type = 'reporting' order by id`,
      [appointmentId]
    );
    assert.equal(assignments.rows.some((row) => Number(row.assigned_doctor_id) === otherDoctor.doctorId && row.status === "corrected"), true);
    assert.equal(assignments.rows.some((row) => Number(row.assigned_doctor_id) === targetDoctor.doctorId && row.status === "active"), true);
    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentId}/unassign`, {
      method: "POST", body: { reason: "must remain attributed" },
    })).status, 409);
  });

  it("keeps a previously assigned and unassigned case in original completion-age order", async () => {
    guard();
    const date = addDays(48);
    const previouslyAssigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, completedAt: "2026-01-01T08:00:00.000Z", patientName: "Original completion age" });
    const newer = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, completedAt: "2026-01-02T08:00:00.000Z", patientName: "Newer completion age" });
    [previouslyAssigned, newer].forEach((id) => statusByAppointmentId.set(id, "draft"));
    await assignDirectly(previouslyAssigned, otherDoctor.doctorId, "2026-06-01T08:00:00.000Z");
    const unassigned = await api(supervisor.cookie, `/api/doctor/reporting-board/${previouslyAssigned}/unassign`, { method: "POST", body: { reason: "return to automatic queue" } });
    assert.equal(unassigned.status, 200);
    const response = await api<{ assignedAppointmentIds: number[] }>(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", {
      method: "POST",
      body: { doctorId: targetDoctor.doctorId, count: 1, filters: { dateFrom: date, dateTo: date, pinUrgentToTop: false }, reason: "original completion ordering" },
    });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.deepEqual(response.data.assignedAppointmentIds, [previouslyAssigned]);
  });

  it("keeps overlapping automatic assignments conflict-safe and reports a partial result", async () => {
    guard();
    const date = addDays(49);
    const first = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, completedAt: "2026-01-01T08:00:00.000Z", patientName: "Concurrent first" });
    const second = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, completedAt: "2026-01-01T09:00:00.000Z", patientName: "Concurrent second" });
    [first, second].forEach((id) => statusByAppointmentId.set(id, "draft"));
    const request = () => api<{ assignedCount: number; assignedAppointmentIds: number[]; skipped: Array<{ appointmentId: number; reason: string }> }>(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", {
      method: "POST",
      body: { doctorId: targetDoctor.doctorId, count: 2, filters: { dateFrom: date, dateTo: date, pinUrgentToTop: false }, reason: "concurrent distribution" },
    });
    const [left, right] = await Promise.all([request(), request()]);
    assert.equal(left.status, 200, JSON.stringify(left.data));
    assert.equal(right.status, 200, JSON.stringify(right.data));
    const active = await pool.query<{ appointment_id: string; count: string }>(
      `select appointment_id::text, count(*)::text from doctor_portal.case_team_assignments where appointment_id = any($1::bigint[]) and assignment_type = 'reporting' and status = 'active' group by appointment_id`,
      [[first, second]]
    );
    assert.equal(active.rows.length, 2);
    assert.equal(active.rows.every((row) => Number(row.count) === 1), true);
    assert.equal(left.data.assignedCount + right.data.assignedCount, 2);
    assert.equal(left.data.assignedCount < 2 || right.data.assignedCount < 2, true);
  });

  it("bulk reassigns selected visible cases, deduplicates ids, skips final cases, and audits", async () => {
    guard();
    const date = addDays(60);
    const first = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Selected Reassign First" });
    const alreadyAssigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Selected Reassign Existing" });
    const finalCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Selected Reassign Final" });
    const noReport = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, requiresReport: false, patientName: "Selected Reassign No Report" });
    [first, alreadyAssigned, noReport].forEach((id) => statusByAppointmentId.set(id, "draft"));
    statusByAppointmentId.set(finalCase, "final");
    await assignDirectly(alreadyAssigned, otherDoctor.doctorId);
    await getDoctorWorklist(targetDoctor, true);

    const response = await api<{ assignedCount: number; requestedCount: number; assignedAppointmentIds: number[]; skipped: Array<{ appointmentId: number; reason: string }> }>(
      supervisor.cookie,
      "/api/doctor/reporting-board/bulk-reassign-selected",
      {
        method: "POST",
        body: {
          appointmentIds: [first, alreadyAssigned, first, finalCase, noReport],
          doctorId: targetDoctor.doctorId,
          reason: "selected cases reassignment",
        },
      }
    );

    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.requestedCount, 4);
    assert.equal(response.data.assignedCount, 2);
    assert.deepEqual(response.data.assignedAppointmentIds, [first, alreadyAssigned]);
    assert.deepEqual(
      response.data.skipped.map((row) => [row.appointmentId, row.reason]),
      [[finalCase, "report_final"], [noReport, "report_not_required"]]
    );
    const assignedRows = await pool.query<{ appointment_id: string; assigned_doctor_id: string; status: string }>(
      `select appointment_id::text, assigned_doctor_id::text, status from doctor_portal.case_team_assignments where appointment_id = any($1::bigint[]) order by appointment_id, status`,
      [[first, alreadyAssigned, finalCase, noReport]]
    );
    const activeAssignments = assignedRows.rows.filter((row) => row.status === "active");
    assert.deepEqual(activeAssignments.map((row) => [Number(row.appointment_id), Number(row.assigned_doctor_id)]), [[first, targetDoctor.doctorId], [alreadyAssigned, targetDoctor.doctorId]]);
    assert.equal(assignedRows.rows.some((row) => Number(row.appointment_id) === alreadyAssigned && row.status === "corrected"), true);
    assert.equal(assignedRows.rows.some((row) => Number(row.appointment_id) === finalCase), false);
    assert.equal(assignedRows.rows.some((row) => Number(row.appointment_id) === noReport), false);
    assert.equal((await pool.query(`select 1 from doctor_portal.doctor_module_audit_events where event_type = 'reporting_board_bulk_selected_case_reassigned' and reason = $1`, ["selected cases reassignment"])).rowCount, 2);
    assert.equal((await pool.query(`select 1 from doctor_portal.doctor_module_audit_events where event_type = 'reporting_board_bulk_selected_reassign_completed' and reason = $1`, ["selected cases reassignment"])).rowCount, 1);
    assert.equal((await pool.query(`select 1 from doctor_portal.reporting_board_notification_events where recipient_doctor_id = $1 and appointment_id = any($2::bigint[])`, [targetDoctor.doctorId, [first, alreadyAssigned]])).rowCount, 2);
  });

  it("unassigns a single assigned reporting case, preserves history, filters as unassigned, and audits", async () => {
    guard();
    const date = addDays(72);
    const appointmentId = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Single Unassign" });
    statusByAppointmentId.set(appointmentId, "draft");
    await assignDirectly(appointmentId, targetDoctor.doctorId);

    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/${appointmentId}/unassign`, { method: "POST", body: { reason: "not manager" } })).status, 403);
    assert.equal((await api(receptionistCookie, `/api/doctor/reporting-board/${appointmentId}/unassign`, { method: "POST", body: { reason: "not doctor portal" } })).status, 403);
    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentId}/unassign`, { method: "POST", body: { reason: "" } })).status, 400);

    const response = await api<{ unassigned: boolean; appointmentId: number; assignmentId: number }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/${appointmentId}/unassign`,
      { method: "POST", body: { reason: "return to waiting pool" } }
    );

    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.unassigned, true);
    assert.equal(response.data.appointmentId, appointmentId);
    const assignments = await pool.query<{ id: string; status: string }>(
      `select id::text as id, status from doctor_portal.case_team_assignments where appointment_id = $1 order by id`,
      [appointmentId]
    );
    assert.deepEqual(assignments.rows.map((row) => row.status), ["cancelled"]);
    assert.equal(Number(assignments.rows[0].id), response.data.assignmentId);
    assert.equal((await pool.query(`select 1 from doctor_portal.case_team_assignments where appointment_id = $1 and assignment_type = 'reporting' and status = 'active'`, [appointmentId])).rowCount, 0);

    const unassigned = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&assignmentStatus=unassigned`
    );
    const assigned = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&assignmentStatus=assigned`
    );
    assert.equal(unassigned.data.cases.some((row) => row.appointmentId === appointmentId), true);
    assert.equal(assigned.data.cases.some((row) => row.appointmentId === appointmentId), false);
    assert.equal((await pool.query(`select 1 from doctor_portal.doctor_module_audit_events where event_type = 'reporting_board_case_unassigned' and target_id = $1 and reason = $2`, [response.data.assignmentId, "return to waiting pool"])).rowCount, 1);

    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentId}/unassign`, { method: "POST", body: { reason: "already unassigned" } })).status, 409);
  });

  it("bulk unassigns selected cases, deduplicates ids, skips ineligible cases, and audits", async () => {
    guard();
    const date = addDays(73);
    const first = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Bulk Unassign First" });
    const duplicate = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Bulk Unassign Duplicate" });
    const alreadyUnassigned = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Bulk Unassign Already" });
    const finalCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Bulk Unassign Final" });
    const noReport = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, requiresReport: false, patientName: "Bulk Unassign No Report" });
    const notCompleted = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, status: "scheduled", patientName: "Bulk Unassign Scheduled" });
    [first, duplicate, alreadyUnassigned, noReport, notCompleted].forEach((id) => statusByAppointmentId.set(id, "draft"));
    statusByAppointmentId.set(finalCase, "final");
    await assignDirectly(first, targetDoctor.doctorId);
    await assignDirectly(duplicate, targetDoctor.doctorId);
    await assignDirectly(finalCase, targetDoctor.doctorId);
    await assignDirectly(noReport, targetDoctor.doctorId);
    await assignDirectly(notCompleted, targetDoctor.doctorId);

    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/bulk-unassign-selected", { method: "POST", body: { appointmentIds: [first], reason: "" } })).status, 400);
    assert.equal((await api(doctor.cookie, "/api/doctor/reporting-board/bulk-unassign-selected", { method: "POST", body: { appointmentIds: [first], reason: "not manager" } })).status, 403);

    const response = await api<{
      requestedCount: number;
      unassignedCount: number;
      skippedCount: number;
      unassignedAppointmentIds: number[];
      skipped: Array<{ appointmentId: number; reason: string }>;
    }>(
      supervisor.cookie,
      "/api/doctor/reporting-board/bulk-unassign-selected",
      {
        method: "POST",
        body: { appointmentIds: [first, duplicate, first, alreadyUnassigned, finalCase, noReport, notCompleted], reason: "selected return to pool" },
      }
    );

    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.requestedCount, 6);
    assert.equal(response.data.unassignedCount, 2);
    assert.deepEqual(response.data.unassignedAppointmentIds, [first, duplicate]);
    assert.deepEqual(
      response.data.skipped.map((row) => [row.appointmentId, row.reason]),
      [[alreadyUnassigned, "no_active_assignment"], [finalCase, "report_final"], [noReport, "report_not_required"], [notCompleted, "study_not_completed"]]
    );
    const assignmentRows = await pool.query<{ appointment_id: string; status: string }>(
      `select appointment_id::text, status from doctor_portal.case_team_assignments where appointment_id = any($1::bigint[]) order by appointment_id, status`,
      [[first, duplicate, finalCase, noReport, notCompleted]]
    );
    const statuses = new Map(assignmentRows.rows.map((row) => [Number(row.appointment_id), row.status]));
    assert.equal(statuses.get(first), "cancelled");
    assert.equal(statuses.get(duplicate), "cancelled");
    assert.equal(statuses.get(finalCase), "active");
    assert.equal(statuses.get(noReport), "active");
    assert.equal(statuses.get(notCompleted), "active");
    assert.equal((await pool.query(`select 1 from doctor_portal.doctor_module_audit_events where event_type = 'reporting_board_bulk_selected_case_unassigned' and reason = $1`, ["selected return to pool"])).rowCount, 2);
    assert.equal((await pool.query(`select 1 from doctor_portal.doctor_module_audit_events where event_type = 'reporting_board_bulk_selected_unassign_completed' and reason = $1`, ["selected return to pool"])).rowCount, 1);
  });

  it("returns reporting board statistics with manager scope, doctor scope, and filters", async () => {
    guard();
    const date = addDays(66);
    const stat = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, patientName: "Stats Stat" });
    const urgent = await createBooking({ modalityId: mrModalityId, examTypeId: mrExamTypeId, priorityId: urgentPriorityId, date, patientName: "Stats Urgent" });
    const routine = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date, patientName: "Stats Routine" });
    [stat, urgent, routine].forEach((id) => statusByAppointmentId.set(id, "draft"));
    await assignDirectly(urgent, targetDoctor.doctorId);

    const stats = await api<{
      summary: { total: number; unassigned: number; assigned: number; stat: number; urgent: number; statOrUrgent: number; requiredNotFinal: number; ct: number; mr: number };
      byDoctor: Array<{ doctorId: number | null; doctorName: string; total: number; requiredNotFinal: number; statOrUrgent: number; ct: number; mr: number }>;
      byModality: Array<{ modalityCode: string; total: number; statOrUrgent: number }>;
      byPriority: Array<{ priorityCode: string | null; total: number }>;
    }>(supervisor.cookie, `/api/doctor/reporting-board/stats?dateFrom=${date}&dateTo=${date}`);

    assert.equal(stats.status, 200, JSON.stringify(stats.data));
    assert.deepEqual(
      {
        total: stats.data.summary.total,
        unassigned: stats.data.summary.unassigned,
        assigned: stats.data.summary.assigned,
        stat: stats.data.summary.stat,
        urgent: stats.data.summary.urgent,
        statOrUrgent: stats.data.summary.statOrUrgent,
        requiredNotFinal: stats.data.summary.requiredNotFinal,
        ct: stats.data.summary.ct,
        mr: stats.data.summary.mr,
      },
      { total: 3, unassigned: 2, assigned: 1, stat: 1, urgent: 1, statOrUrgent: 2, requiredNotFinal: 3, ct: 2, mr: 1 }
    );
    const byDoctor = new Map(stats.data.byDoctor.map((row) => [row.doctorId, row]));
    assert.equal(byDoctor.get(null)?.total, 2);
    assert.equal(byDoctor.get(targetDoctor.doctorId)?.total, 1);
    assert.equal(byDoctor.get(targetDoctor.doctorId)?.statOrUrgent, 1);
    assert.deepEqual(stats.data.byModality.map((row) => [row.modalityCode, row.total]), [["CT", 2], ["MR", 1]]);
    assert.deepEqual(stats.data.byPriority.map((row) => [row.priorityCode, row.total]).sort(), [["routine", 1], ["stat", 1], ["urgent", 1]]);

    const doctorScoped = await api<{ summary: { total: number; assigned: number } }>(targetDoctor.cookie, `/api/doctor/reporting-board/stats?dateFrom=${date}&dateTo=${date}`);
    assert.equal(doctorScoped.status, 200, JSON.stringify(doctorScoped.data));
    assert.deepEqual(doctorScoped.data.summary, { ...doctorScoped.data.summary, total: 1, assigned: 1 });

    const urgentOnly = await api<{ summary: { total: number; urgent: number } }>(supervisor.cookie, `/api/doctor/reporting-board/stats?dateFrom=${date}&dateTo=${date}&priorityCode=urgent`);
    assert.equal(urgentOnly.status, 200, JSON.stringify(urgentOnly.data));
    assert.equal(urgentOnly.data.summary.total, 1);
    assert.equal(urgentOnly.data.summary.urgent, 1);
  });

  it("sorts board cases with STAT/urgent pinned by default", async () => {
    guard();
    const date = addDays(61);
    const routine = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date: addDays(59), time: "07:00", patientName: "Sort Routine" });
    const noPriority = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: null, date: addDays(58), time: "06:00", patientName: "Sort No Priority" });
    const urgent = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: urgentPriorityId, date, time: "10:00", patientName: "Sort Urgent" });
    const stat = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, time: "11:00", patientName: "Sort Stat" });
    [routine, noPriority, urgent, stat].forEach((id) => statusByAppointmentId.set(id, "draft"));

    const response = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${addDays(58)}&dateTo=${date}&limit=20`
    );

    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.deepEqual(
      response.data.cases.map((row) => row.appointmentId).filter((id) => [routine, noPriority, urgent, stat].includes(id)),
      [stat, urgent, routine, noPriority]
    );
  });

  it("sorts board cases by accession ascending and descending", async () => {
    guard();
    const date = addDays(62);
    const first = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sort Accession First" });
    const second = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date, patientName: "Sort Accession Second" });
    [first, second].forEach((id) => statusByAppointmentId.set(id, "draft"));

    const asc = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&sortBy=accession&sortDirection=asc&pinUrgentToTop=false`
    );
    const desc = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&sortBy=accession&sortDirection=desc&pinUrgentToTop=false`
    );

    assert.equal(asc.status, 200, JSON.stringify(asc.data));
    assert.equal(desc.status, 200, JSON.stringify(desc.data));
    assert.deepEqual(asc.data.cases.map((row) => row.appointmentId), [first, second]);
    assert.deepEqual(desc.data.cases.map((row) => row.appointmentId), [second, first]);
  });

  it("sorts board cases by study date ascending and descending", async () => {
    guard();
    const earlierDate = addDays(63);
    const laterDate = addDays(64);
    const later = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: laterDate, patientName: "Sort Study Later" });
    const earlier = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: earlierDate, patientName: "Sort Study Earlier" });
    [later, earlier].forEach((id) => statusByAppointmentId.set(id, "draft"));

    const asc = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${earlierDate}&dateTo=${laterDate}&sortBy=study_date&sortDirection=asc&pinUrgentToTop=false`
    );
    const desc = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${earlierDate}&dateTo=${laterDate}&sortBy=study_date&sortDirection=desc&pinUrgentToTop=false`
    );

    assert.equal(asc.status, 200, JSON.stringify(asc.data));
    assert.equal(desc.status, 200, JSON.stringify(desc.data));
    assert.deepEqual(asc.data.cases.map((row) => row.appointmentId), [earlier, later]);
    assert.deepEqual(desc.data.cases.map((row) => row.appointmentId), [later, earlier]);
  });

  it("keeps STAT/urgent pinned for selected sorts unless pinning is disabled", async () => {
    guard();
    const date = addDays(65);
    const routine = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: routinePriorityId, date, patientName: "Sort Pin Routine" });
    const urgent = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: urgentPriorityId, date, patientName: "Sort Pin Urgent" });
    const stat = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, priorityId: statPriorityId, date, patientName: "Sort Pin Stat" });
    [routine, urgent, stat].forEach((id) => statusByAppointmentId.set(id, "draft"));

    const pinned = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&sortBy=accession&sortDirection=asc`
    );
    const unpinned = await api<{ cases: Array<{ appointmentId: number }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}&sortBy=accession&sortDirection=asc&pinUrgentToTop=false`
    );

    assert.equal(pinned.status, 200, JSON.stringify(pinned.data));
    assert.equal(unpinned.status, 200, JSON.stringify(unpinned.data));
    assert.deepEqual(pinned.data.cases.map((row) => row.appointmentId), [stat, urgent, routine]);
    assert.deepEqual(unpinned.data.cases.map((row) => row.appointmentId), [routine, urgent, stat]);
  });

  it("rejects invalid reporting-board sort parameters and excessive limits", async () => {
    guard();
    const invalidSort = await api(supervisor.cookie, "/api/doctor/reporting-board/cases?sortBy=booking_id;drop");
    const invalidDirection = await api(supervisor.cookie, "/api/doctor/reporting-board/cases?sortDirection=sideways");
    const excessiveLimit = await api(supervisor.cookie, "/api/doctor/reporting-board/cases?limit=301");

    assert.equal(invalidSort.status, 400);
    assert.equal(invalidDirection.status, 400);
    assert.equal(excessiveLimit.status, 400);
  });

  it("single-row Reporting Board assignment writes audit and creates notifyAssignedToMe events only when enabled", async () => {
    guard();
    const notifyView = await getDoctorWorklist(targetDoctor, true);
    const silentView = await getDoctorWorklist(otherDoctor, false);
    const notifyCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(50), patientName: "Notify Patient" });
    const silentCase = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(50), patientName: "Silent Patient" });
    statusByAppointmentId.set(notifyCase, "draft");
    statusByAppointmentId.set(silentCase, "draft");

    const assigned = await api(supervisor.cookie, `/api/doctor/reporting-board/${notifyCase}/assign-doctor`, {
      method: "POST",
      body: { doctorId: targetDoctor.doctorId, reason: "board single assignment" },
    });
    assert.equal(assigned.status, 200);
    assert.equal((await pool.query(`select 1 from doctor_portal.doctor_module_audit_events where event_type = 'case_doctor_assigned' and reason = $1`, ["board single assignment"])).rowCount, 1);
    const events = await pool.query<{ title: string; body: string; action_url: string; dedupe_key: string }>(
      `select title, body, action_url, dedupe_key from doctor_portal.reporting_board_notification_events where saved_view_id = $1 and appointment_id = $2`,
      [notifyView.id, notifyCase]
    );
    assert.equal(events.rowCount, 1);
    assert.equal(events.rows[0].title, "Case assigned • CT");
    assert.match(events.rows[0].body, /Notify Patient/);
    assert.match(events.rows[0].body, /Note: board single assignment/);
    assert.match(events.rows[0].action_url, new RegExp(`/reporting/worklist/${notifyView.token}`));

    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${notifyCase}/assign-doctor`, { method: "POST", body: { doctorId: targetDoctor.doctorId, reason: "repeat" } })).status, 200);
    assert.equal((await pool.query(`select 1 from doctor_portal.reporting_board_notification_events where saved_view_id = $1 and appointment_id = $2`, [notifyView.id, notifyCase])).rowCount, 1);

    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${silentCase}/assign-doctor`, { method: "POST", body: { doctorId: otherDoctor.doctorId, reason: "silent" } })).status, 200);
    assert.equal((await pool.query(`select 1 from doctor_portal.reporting_board_notification_events where saved_view_id = $1 and appointment_id = $2`, [silentView.id, silentCase])).rowCount, 0);
  });

  it("scopes notification list and read/dismiss/read-all actions to the current user", async () => {
    guard();
    const view = await getDoctorWorklist(targetDoctor, true);
    const appointmentA = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(60), patientName: "Notification A" });
    const appointmentB = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(60), patientName: "Notification B" });
    statusByAppointmentId.set(appointmentA, "draft");
    statusByAppointmentId.set(appointmentB, "draft");
    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentA}/assign-doctor`, { method: "POST", body: { doctorId: targetDoctor.doctorId, reason: "notify a" } })).status, 200);
    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentB}/assign-doctor`, { method: "POST", body: { doctorId: targetDoctor.doctorId, reason: "notify b" } })).status, 200);
    const ownList = await api<{ notifications: Array<{ id: number; title: string; body: string }> }>(targetDoctor.cookie, "/api/doctor/reporting-board/notifications");
    assert.equal(ownList.status, 200);
    assert.ok(ownList.data.notifications.length >= 2);
    assert.ok(ownList.data.notifications.some((notification) => /Case assigned • CT/.test(notification.title)));
    const otherList = await api<{ notifications: unknown[] }>(otherDoctor.cookie, "/api/doctor/reporting-board/notifications");
    assert.equal(otherList.status, 200);
    assert.equal(otherList.data.notifications.some((item) => ownList.data.notifications.map((n) => n.id).includes((item as { id: number }).id)), false);
    const id = ownList.data.notifications[0].id;
    assert.equal((await api(otherDoctor.cookie, `/api/doctor/reporting-board/notifications/${id}/read`, { method: "POST" })).status, 404);
    assert.equal((await api(targetDoctor.cookie, `/api/doctor/reporting-board/notifications/${id}/read`, { method: "POST" })).status, 200);
    const dismissId = ownList.data.notifications[1].id;
    assert.equal((await api(otherDoctor.cookie, `/api/doctor/reporting-board/notifications/${dismissId}/dismiss`, { method: "POST" })).status, 404);
    assert.equal((await api(targetDoctor.cookie, `/api/doctor/reporting-board/notifications/${dismissId}/dismiss`, { method: "POST" })).status, 200);
    assert.equal((await api(targetDoctor.cookie, "/api/doctor/reporting-board/notifications/read-all", { method: "POST" })).status, 200);
    assert.equal(view.id > 0, true);
  });
});
