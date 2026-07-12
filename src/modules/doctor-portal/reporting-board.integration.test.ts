import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

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

async function createDoctorPortalTestApp() {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const http = await import("node:http");
  const { createDoctorPortalRouter } = await import("./index.js");
  const { reportingBoardPublicRouter } = await import("./reporting-board-public-routes.js");
  const appInstance = express();
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

const rawApi = (cookie: string, path: string) =>
  fetch(`${app.baseUrl}${path}`, {
    headers: { Cookie: cookie },
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

  after(async () => {
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
    }, async () => {
      const supervisorOpen = await rawApi(supervisor.cookie, `/api/doctor/reporting-board/cases/${ownCase}/open-sonicdicom?scope=study`);
      assert.equal(supervisorOpen.status, 302);
      const supervisorLocation = supervisorOpen.headers.get("location") ?? "";
      assert.match(supervisorLocation, /^https:\/\/sonic\.example\/viewer\/#\/viewer\?accessionnumber=V2-0/);
      assert.doesNotMatch(supervisorLocation, /username|password/i);

      const patientOpen = await rawApi(supervisor.cookie, `/api/doctor/reporting-board/cases/${ownCase}/open-sonicdicom?scope=patient`);
      assert.equal(patientOpen.status, 302);
      assert.equal(patientOpen.headers.get("location"), "https://sonic.example/viewer/#/list?patientid=OPEN-SONIC-DICOM-ID");

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
      assert.match(body, /public base URL is malformed/i);
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
    assert.equal(events.rows[0].title, "RISpro reporting case update");
    assert.equal(events.rows[0].body, "Open the saved reporting view to review this update.");
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
    assert.ok(ownList.data.notifications.some((notification) => /RISpro reporting case update/.test(notification.title)));
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
