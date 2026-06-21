import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

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
const statusByAppointmentId = new Map<number, ReportState | "throw">();

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
        policy_version_id, capacity_resolution_mode, uses_special_quota, special_reason_code, special_reason_note,
        is_walk_in, created_by_user_id, updated_by_user_id
      )
      values ($1, $2, $3, $4, $5::date, $6::time, $7, $8, null, $9, null,
        $10, 'standard', false, null, null, false, $11, $11)
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
      policyVersionId,
      admin.id,
    ]
  );
  return Number(result.rows[0].id);
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

async function assignDirectly(appointmentId: number, doctorId: number) {
  await pool.query(
    `
      insert into doctor_portal.case_team_assignments (
        appointment_id, roster_assignment_id, assigned_doctor_id, modality_id, assignment_type, expected_reporting_date, status
      )
      select id, null, $2, modality_id, 'reporting', booking_date, 'active'
      from appointments_v2.bookings
      where id = $1
    `,
    [appointmentId, doctorId]
  );
}

async function createDoctorPortalTestApp() {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const http = await import("node:http");
  const { createDoctorPortalRouter } = await import("./index.js");
  const appInstance = express();
  appInstance.use(express.json({ limit: "10mb" }));
  appInstance.use(cookieParser());
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
  const savedViewRows = await pool.query<{ id: string }>(
    `select id::text as id from doctor_portal.reporting_board_saved_views where owner_user_id = any($1::bigint[]) or owner_doctor_id = any($2::bigint[])`,
    [userIds, doctorIds]
  ).catch(() => ({ rows: [] }));
  const savedViewIds = savedViewRows.rows.map((row) => Number(row.id));

  await pool.query(`delete from doctor_portal.reporting_board_notification_events where recipient_user_id = any($1::bigint[]) or recipient_doctor_id = any($2::bigint[]) or appointment_id = any($3::bigint[]) or saved_view_id = any($4::bigint[])`, [userIds, doctorIds, bookingIds, savedViewIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.reporting_board_saved_views where id = any($1::bigint[])`, [savedViewIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_module_audit_events where actor_user_id = any($1::bigint[]) or actor_doctor_id = any($2::bigint[]) or target_id in (select id from doctor_portal.case_team_assignments where appointment_id = any($3::bigint[]))`, [userIds, doctorIds, bookingIds]).catch(() => undefined);
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

const api = <T = unknown>(cookie: string, path: string, options: { method?: string; body?: unknown } = {}) =>
  fetchJson<T>(app.baseUrl, path, { cookie, ...options });

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
    reportingBoardService.__setReportingBoardReportStatusCheckerForTest(async (context) => {
      const state = statusByAppointmentId.get(context.bookingId) ?? "draft";
      if (state === "throw") throw new Error("SonicDICOM unavailable");
      return { state, canViewReport: state === "final", source: "sonicdicom" };
    });
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

  after(async () => {
    reportingBoardService?.__setReportingBoardReportStatusCheckerForTest(null);
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
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/settings", { method: "PUT", body: { daysBack: 1 } })).status, 403);
    assert.equal((await api(doctor.cookie, "/api/doctor/reporting-board/settings", { method: "PUT", body: { daysBack: 1 } })).status, 403);
    assert.equal((await api(admin.cookie, "/api/doctor/reporting-board/settings")).status, 200);
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/settings")).status, 200);
    assert.equal((await api(doctor.cookie, "/api/doctor/reporting-board/settings")).status, 200);
    assert.equal((await api(receptionistCookie, "/api/doctor/reporting-board/settings")).status, 403);
  });

  it("enforces saved-view ownership, active tokens, and manager token access", async () => {
    guard();
    const ownerView = await createSavedView(doctor, true, { assignedDoctorId: doctor.doctorId });
    const ownerList = await api<{ savedViews: Array<{ id: number }> }>(doctor.cookie, "/api/doctor/reporting-board/saved-views");
    assert.equal(ownerList.status, 200);
    assert.equal(ownerList.data.savedViews.some((view) => view.id === ownerView.id), true);
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/saved-views/token/${ownerView.token}`)).status, 200);
    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/saved-views/token/${ownerView.token}`)).status, 200);
    assert.equal((await api(otherDoctor.cookie, `/api/doctor/reporting-board/saved-views/token/${ownerView.token}`)).status, 404);
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/saved-views/${ownerView.id}`, { method: "PATCH", body: { active: false } })).status, 200);
    assert.equal((await api(doctor.cookie, `/api/doctor/reporting-board/saved-views/token/${ownerView.token}`)).status, 404);
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

    const response = await api<{ cases: Array<{ appointmentId: number; reportStatus: string; modalityCode: string }> }>(
      supervisor.cookie,
      `/api/doctor/reporting-board/cases?dateFrom=${date}&dateTo=${date}`
    );
    assert.equal(response.status, 200);
    const ids = response.data.cases.map((row) => row.appointmentId);
    assert.deepEqual(ids.sort((a, b) => a - b), [ctDraft, mrNoReport].sort((a, b) => a - b));
    assert.ok(response.data.cases.every((row) => ["final", "draft", "no_report", "study_not_found", "unavailable"].includes(row.reportStatus)));
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

  it("bulk assigns next eligible cases in priority/date/time order and enforces assignment rules", async () => {
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
    [stat, urgent, routine, noPriority, later, alreadyAssigned, noReport, cancelled].forEach((id) => statusByAppointmentId.set(id, "draft"));
    statusByAppointmentId.set(finalCase, "final");
    await assignDirectly(alreadyAssigned, otherDoctor.doctorId);

    const noNote = await api(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", {
      method: "POST",
      body: { doctorId: targetDoctor.doctorId, count: 1, filters: { dateFrom: addDays(41), dateTo: addDays(41) }, reason: "" },
    });
    assert.equal(noNote.status, 200);
    assert.equal((await api(doctor.cookie, "/api/doctor/reporting-board/bulk-assign-next", { method: "POST", body: { doctorId: targetDoctor.doctorId, count: 1, filters: { dateFrom: date, dateTo: date }, reason: "no" } })).status, 403);
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", { method: "POST", body: { doctorId: inactiveDoctor.doctorId, count: 1, filters: { dateFrom: date, dateTo: date }, reason: "inactive" } })).status, 404);
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", { method: "POST", body: { doctorId: noFinalizeDoctor.doctorId, count: 1, filters: { dateFrom: date, dateTo: date }, reason: "no finalize" } })).status, 400);
    assert.equal((await api(supervisor.cookie, "/api/doctor/reporting-board/bulk-assign-next", { method: "POST", body: { doctorId: noMrPermissionDoctor.doctorId, count: 2, filters: { dateFrom: date, dateTo: date }, reason: "missing MR" } })).status, 400);

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
    await createSavedView(targetDoctor, true, { assignedDoctorId: targetDoctor.doctorId });

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

  it("rejects invalid reporting-board sort parameters", async () => {
    guard();
    const invalidSort = await api(supervisor.cookie, "/api/doctor/reporting-board/cases?sortBy=booking_id;drop");
    const invalidDirection = await api(supervisor.cookie, "/api/doctor/reporting-board/cases?sortDirection=sideways");

    assert.equal(invalidSort.status, 400);
    assert.equal(invalidDirection.status, 400);
  });

  it("single-row Reporting Board assignment writes audit and creates notifyAssignedToMe events only when enabled", async () => {
    guard();
    const notifyView = await createSavedView(targetDoctor, true, { assignedDoctorId: targetDoctor.doctorId });
    const silentView = await createSavedView(otherDoctor, false, { assignedDoctorId: otherDoctor.doctorId });
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
    assert.match(events.rows[0].title, /Reporting case assigned/);
    assert.match(events.rows[0].body, /Notify Patient/);
    assert.match(events.rows[0].body, /V2-/);
    assert.match(events.rows[0].body, /CT/);
    assert.match(events.rows[0].action_url, new RegExp(`/doctor/reporting-board/saved/${notifyView.token}`));

    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${notifyCase}/assign-doctor`, { method: "POST", body: { doctorId: targetDoctor.doctorId, reason: "repeat" } })).status, 200);
    assert.equal((await pool.query(`select 1 from doctor_portal.reporting_board_notification_events where saved_view_id = $1 and appointment_id = $2`, [notifyView.id, notifyCase])).rowCount, 1);

    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${silentCase}/assign-doctor`, { method: "POST", body: { doctorId: otherDoctor.doctorId, reason: "silent" } })).status, 200);
    assert.equal((await pool.query(`select 1 from doctor_portal.reporting_board_notification_events where saved_view_id = $1 and appointment_id = $2`, [silentView.id, silentCase])).rowCount, 0);
  });

  it("scopes notification list and read/dismiss/read-all actions to the current user", async () => {
    guard();
    const view = await createSavedView(targetDoctor, true, {});
    const appointmentA = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(60), patientName: "Notification A" });
    const appointmentB = await createBooking({ modalityId: ctModalityId, examTypeId: ctExamTypeId, date: addDays(60), patientName: "Notification B" });
    statusByAppointmentId.set(appointmentA, "draft");
    statusByAppointmentId.set(appointmentB, "draft");
    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentA}/assign-doctor`, { method: "POST", body: { doctorId: targetDoctor.doctorId, reason: "notify a" } })).status, 200);
    assert.equal((await api(supervisor.cookie, `/api/doctor/reporting-board/${appointmentB}/assign-doctor`, { method: "POST", body: { doctorId: targetDoctor.doctorId, reason: "notify b" } })).status, 200);
    const ownList = await api<{ notifications: Array<{ id: number; title: string; body: string }> }>(targetDoctor.cookie, "/api/doctor/reporting-board/notifications");
    assert.equal(ownList.status, 200);
    assert.ok(ownList.data.notifications.length >= 2);
    assert.ok(ownList.data.notifications.every((notification) => !/Notification A|Notification B|V2-/.test(`${notification.title} ${notification.body}`)));
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
