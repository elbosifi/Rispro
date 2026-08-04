import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getTripoliToday } from "../../utils/date.js";

if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const skipEnv = !(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL) ? "DATABASE_URL not set" : undefined;
const TEST_PREFIX = "DPHARD_";
type Pool = typeof import("../../db/pool.js").pool;
interface TestData {
  userId: number;
  modalityId: number;
  examTypeId: number;
  patientId: number;
  policySetId: number;
  policySetKey: string;
  policyVersionId: number;
  schemaName: string;
}

let pool: Pool;
let canReachDatabase: typeof import("../appointments-v2/tests/integration/helpers.js").canReachDatabase;
let createTestAuthCookie: typeof import("../appointments-v2/tests/integration/helpers.js").createTestAuthCookie;
let fetchJson: typeof import("../appointments-v2/tests/integration/helpers.js").fetchJson;
let setupTestDatabase: typeof import("../appointments-v2/tests/integration/helpers.js").setupTestDatabase;

interface TestUser {
  id: number;
  doctorId: number;
  cookie: string;
}

function mondayOf(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createDoctorUser(suffix: string, role: string, options: { canAssignProtocols: boolean; canSupervise: boolean }): Promise<TestUser> {
  const username = `${TEST_PREFIX.toLowerCase()}${suffix}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const user = await pool.query<{ id: string }>(
    `
      insert into users (username, password_hash, full_name, role, is_active)
      values ($1, '$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS', $2, $3, true)
      returning id::text as id
    `,
    [username, `${TEST_PREFIX}${suffix}`, role]
  );
  const userId = Number(user.rows[0].id);
  const profile = await pool.query<{ id: string }>(
    `
      insert into doctor_portal.doctor_profiles (
        user_id, display_name, doctor_role, active, can_finalize_reports, can_assign_protocols, can_supervise
      )
      values ($1, $2, 'consultant', true, true, $3, $4)
      returning id::text as id
    `,
    [userId, `${TEST_PREFIX}${suffix}`, options.canAssignProtocols, options.canSupervise]
  );
  return { id: userId, doctorId: Number(profile.rows[0].id), cookie: createTestAuthCookie(userId, role) };
}

async function createBooking(testData: TestData, date: string, patientId = testData.patientId): Promise<number> {
  const booking = await pool.query<{ id: string }>(
    `
      insert into appointments_v2.bookings (
        patient_id, modality_id, exam_type_id, reporting_priority_id,
        booking_date, booking_time, case_category, requires_report, study_instance_uid, status, notes,
        policy_version_id, capacity_resolution_mode, uses_special_quota, special_reason_code, special_reason_note,
        is_walk_in, created_by_user_id, updated_by_user_id
      )
      values ($1, $2, $3, null, $4::date, '09:00', 'oncology', true, null, 'scheduled', 'integration indication',
        $5, 'standard', false, null, null, false, $6, $6)
      returning id::text as id
    `,
    [patientId, testData.modalityId, testData.examTypeId, date, testData.policyVersionId, testData.userId]
  );
  return Number(booking.rows[0].id);
}

async function createPatient(name: string): Promise<number> {
  const nationalId = `8${randomUUID().replace(/-/g, "").slice(0, 11)}`;
  const result = await pool.query<{ id: string }>(
    `
      insert into patients (
        arabic_full_name, english_full_name, national_id, normalized_arabic_name, sex, age_years,
        phone_1, identifier_type, identifier_value
      )
      values ($1, $2, $3, $4, 'F', 40, $5, 'national_id', $6)
      returning id::text as id
    `,
    [`${TEST_PREFIX}${name} Arabic`, `${TEST_PREFIX}${name}`, nationalId, `${TEST_PREFIX}${name}`, "0912345678", nationalId]
  );
  return Number(result.rows[0].id);
}

async function seedDoctorPortalTestData(): Promise<TestData> {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const keyBase = `${TEST_PREFIX.toLowerCase()}${suffix}`;
  const userResult = await pool.query<{ id: string }>(
    `
      insert into users (username, password_hash, full_name, role, is_active)
      values ($1, '$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS', $2, 'supervisor', true)
      returning id::text as id
    `,
    [`${keyBase}supervisor`, `${TEST_PREFIX}${suffix} Supervisor`]
  );
  const userId = Number(userResult.rows[0].id);

  const modalityResult = await pool.query<{ id: string }>(
    `
      insert into modalities (name_ar, name_en, code, daily_capacity, is_active)
      values ($1, $2, $3, 10, true)
      returning id::text as id
    `,
    [`${TEST_PREFIX}${suffix} CT AR`, `${TEST_PREFIX}${suffix} CT`, `${TEST_PREFIX}${suffix}CT`]
  );
  const modalityId = Number(modalityResult.rows[0].id);

  const examTypeResult = await pool.query<{ id: string }>(
    `
      insert into exam_types (modality_id, name_ar, name_en, code, duration_minutes, is_active)
      values ($1, $2, $3, $4, 20, true)
      returning id::text as id
    `,
    [modalityId, `${TEST_PREFIX}${suffix} CT Head AR`, `${TEST_PREFIX}${suffix} CT Head`, `${TEST_PREFIX}${suffix}CTHEAD`]
  );
  const examTypeId = Number(examTypeResult.rows[0].id);

  const patientId = await createPatient(`${suffix} Patient`);
  const policyKey = `${keyBase}_policy`;
  const policySetResult = await pool.query<{ id: string }>(
    `
      insert into appointments_v2.policy_sets (key, name, created_by_user_id)
      values ($1, $2, $3)
      returning id::text as id
    `,
    [policyKey, `${TEST_PREFIX}${suffix} Policy`, userId]
  );
  const policySetId = Number(policySetResult.rows[0].id);
  const policyVersionResult = await pool.query<{ id: string }>(
    `
      insert into appointments_v2.policy_versions (
        policy_set_id, version_no, status, config_hash, created_by_user_id, published_at, published_by_user_id
      )
      values ($1, 1, 'published', $2, $3, now(), $3)
      returning id::text as id
    `,
    [policySetId, `${keyBase}_hash`, userId]
  );
  const policyVersionId = Number(policyVersionResult.rows[0].id);
  await pool.query(
    `
      insert into appointments_v2.category_daily_limits (
        policy_version_id, modality_id, case_category, daily_limit, is_active
      )
      values ($1, $2, 'oncology', 10, true)
    `,
    [policyVersionId, modalityId]
  );
  await pool.query(
    `
      insert into doctor_portal.workload_unit_catalog (
        modality_id, exam_type_id, case_category, assignment_type, base_units,
        report_required_multiplier, no_report_units, effective_from, created_by
      )
      values ($1, $2, 'oncology', 'reporting', 1, 1, 0, current_date, $3)
    `,
    [modalityId, examTypeId, userId]
  );

  return { userId, modalityId, examTypeId, patientId, policySetId, policySetKey: policyKey, policyVersionId, schemaName: "appointments_v2" };
}

async function createDoctorPortalTestApp() {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const http = await import("node:http");
  const { createAppointmentsV2Router } = await import("../appointments-v2/index.js");
  const { createDoctorPortalRouter } = await import("./index.js");
  const { authRouter } = await import("../../routes/auth.js");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());
  app.use("/api/auth", authRouter);
  app.use("/api/doctor", createDoctorPortalRouter());
  app.use("/api/v2", createAppointmentsV2Router());
  app.use((err: Error, _req: import("express").Request, res: import("express").Response, _next: import("express").NextFunction) => {
    res.status((err as { statusCode?: number }).statusCode ?? 500).json({ error: err.message });
  });
  const server = http.createServer(app);
  return new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 3000;
      resolve({ baseUrl: `http://localhost:${port}`, close: async () => { server.close(); } });
    });
  });
}

async function workbookBase64(rows: Array<Record<string, unknown>>): Promise<string> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Doctor import");
  return (XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64");
}

async function cleanupDoctorPortalTestData(extraUserIds: number[] = []) {
  const userRows = await pool.query<{ id: string }>(`select id::text as id from users where username like $1`, [`${TEST_PREFIX.toLowerCase()}%`]);
  const userIds = userRows.rows.map((row) => Number(row.id));
  const doctorProfileUserIds = [...userIds, ...extraUserIds];
  const doctorRows = await pool.query<{ id: string }>(
    `select id::text as id from doctor_portal.doctor_profiles where display_name like $1 or user_id = any($2::bigint[])`,
    [`${TEST_PREFIX}%`, doctorProfileUserIds]
  );
  const doctorIds = doctorRows.rows.map((row) => Number(row.id));
  const patientRows = await pool.query<{ id: string }>(`select id::text as id from patients where english_full_name like $1`, [`${TEST_PREFIX}%`]);
  const patientIds = patientRows.rows.map((row) => Number(row.id));
  const bookingRows = await pool.query<{ id: string }>(`select id::text as id from appointments_v2.bookings where patient_id = any($1::bigint[])`, [patientIds]);
  const bookingIds = bookingRows.rows.map((row) => Number(row.id));
  const weekRows = await pool.query<{ id: string }>(`select id::text as id from doctor_portal.doctor_roster_weeks where created_by = any($1::bigint[])`, [userIds]);
  const weekIds = weekRows.rows.map((row) => Number(row.id));
  const assignmentRows = await pool.query<{ id: string }>(`select id::text as id from doctor_portal.doctor_roster_assignments where roster_week_id = any($1::bigint[])`, [weekIds]);
  const assignmentIds = assignmentRows.rows.map((row) => Number(row.id));

  await pool.query(`delete from doctor_portal.doctor_module_audit_events where actor_user_id = any($1::bigint[]) or actor_doctor_id = any($2::bigint[])`, [userIds, doctorIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.reporting_assignment_intents where intended_doctor_id = any($1::bigint[]) or requested_by_doctor_id = any($1::bigint[])`, [doctorIds]).catch(() => undefined);
  await pool.query(
    `delete from doctor_portal.reporting_board_bulk_assignment_jobs where target_doctor_id = any($1::bigint[]) or created_by_doctor_id = any($1::bigint[]) or created_by_user_id = any($2::bigint[])`,
    [doctorIds, userIds]
  ).catch(() => undefined);
  await pool.query(
    `delete from doctor_portal.reporting_board_saved_views where owner_doctor_id = any($1::bigint[]) or target_doctor_id = any($1::bigint[]) or owner_user_id = any($2::bigint[]) or created_by_user_id = any($2::bigint[]) or updated_by_user_id = any($2::bigint[])`,
    [doctorIds, userIds]
  ).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_roster_notifications where roster_week_id = any($1::bigint[]) or doctor_id = any($2::bigint[])`, [weekIds, doctorIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.appointment_protocol_audit_events where appointment_id = any($1::bigint[]) or changed_by_doctor_id = any($2::bigint[])`, [bookingIds, doctorIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.appointment_protocols where appointment_id = any($1::bigint[]) or assigned_by_doctor_id = any($2::bigint[]) or updated_by_doctor_id = any($2::bigint[])`, [bookingIds, doctorIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.case_workload_units where appointment_id = any($1::bigint[]) or roster_assignment_id = any($2::bigint[])`, [bookingIds, assignmentIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.case_team_assignments where appointment_id = any($1::bigint[]) or roster_assignment_id = any($2::bigint[])`, [bookingIds, assignmentIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_roster_members where doctor_id = any($1::bigint[]) or roster_assignment_id = any($2::bigint[])`, [doctorIds, assignmentIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_roster_weeks where id = any($1::bigint[])`, [weekIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_availability where doctor_id = any($1::bigint[])`, [doctorIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_leave_requests where doctor_id = any($1::bigint[])`, [doctorIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.roster_templates where created_by = any($1::bigint[])`, [userIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.workload_unit_catalog where created_by = any($1::bigint[])`, [userIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_modality_permissions where doctor_id = any($1::bigint[])`, [doctorIds]).catch(() => undefined);
  await pool.query(`delete from doctor_portal.doctor_profiles where id = any($1::bigint[])`, [doctorIds]).catch(() => undefined);
  await pool.query(`delete from users where id = any($1::bigint[])`, [userIds]).catch(() => undefined);
  await pool.query(`delete from patients where id = any($1::bigint[])`, [patientIds]).catch(() => undefined);
}

describe("Doctor Portal full workflow DB-backed integration", { skip: skipEnv }, () => {
  let testDb: Awaited<ReturnType<typeof setupTestDatabase>>;
  let testData: TestData;
  let app: Awaited<ReturnType<typeof createDoctorPortalTestApp>>;
  let normal: TestUser;
  let supervisor: TestUser;
  let admin: TestUser;
  let otherDoctor: TestUser;
  let nonDoctorCookie: string;
  let appointmentId = 0;
  let rosterAssignmentId = 0;
  let today = "";

  before(async () => {
    const helpers = await import("../appointments-v2/tests/integration/helpers.js");
    const db = await import("../../db/pool.js");
    pool = db.pool;
    canReachDatabase = helpers.canReachDatabase;
    createTestAuthCookie = helpers.createTestAuthCookie;
    fetchJson = helpers.fetchJson;
    setupTestDatabase = helpers.setupTestDatabase;
    if (!await canReachDatabase()) {
      console.warn("WARNING: Database not reachable. Skipping Doctor Portal integration tests.");
      return;
    }
    testDb = await setupTestDatabase(TEST_PREFIX);
    testData = await seedDoctorPortalTestData();
    app = await createDoctorPortalTestApp();
    today = getTripoliToday();
    normal = await createDoctorUser("normal", "doctor", { canAssignProtocols: true, canSupervise: false });
    supervisor = await createDoctorUser("supervisor", "supervisor", { canAssignProtocols: true, canSupervise: true });
    admin = await createDoctorUser("admin", "super_admin", { canAssignProtocols: true, canSupervise: true });
    otherDoctor = await createDoctorUser("other", "doctor", { canAssignProtocols: true, canSupervise: false });
    nonDoctorCookie = createTestAuthCookie(testData.userId, "receptionist");
    for (const doctor of [normal, supervisor, admin, otherDoctor]) {
      await pool.query(
        `insert into doctor_portal.doctor_modality_permissions (doctor_id, modality_id, can_protocol, can_report, can_supervise, active)
         values ($1, $2, true, true, true, true)`,
        [doctor.doctorId, testData.modalityId]
      );
    }
    appointmentId = await createBooking(testData, today);
  });

  after(async () => {
    if (!testData) return;
    await app.close();
    await cleanupDoctorPortalTestData([testData.userId]);
    await testDb.cleanup();
  });

  function guard() {
    if (!testData) throw new Error("Test setup failed");
  }

  const api = (cookie: string, path: string, options: { method?: string; body?: unknown } = {}) =>
    fetchJson(app.baseUrl, path, { cookie, ...options });

  async function authRequest(path: string, body: unknown, cookie = "") {
    const response = await fetch(`${app.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      data: await response.json() as Record<string, unknown>,
      cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
    };
  }

  it("verifies Doctor Portal migrations 064-072 are applied with core constraints/indexes", async () => {
    guard();
    const tables = await pool.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'doctor_portal'
          and table_name = any($1::text[])
      `,
      [[
        "doctor_profiles",
        "doctor_modality_permissions",
        "doctor_roster_weeks",
        "doctor_roster_assignments",
        "doctor_roster_members",
        "case_team_assignments",
        "appointment_protocols",
        "appointment_protocol_audit_events",
        "workload_unit_catalog",
        "case_workload_units",
        "doctor_availability",
        "doctor_leave_requests",
        "roster_templates",
        "roster_template_assignments",
        "roster_template_members",
        "doctor_roster_notifications",
      ]]
    );
    const usernameIndex = await pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public' and indexname = 'users_username_normalized_unique'`
    );
    assert.equal(usernameIndex.rows.length, 1);
    assert.equal(tables.rowCount, 16);
    const indexes = await pool.query<{ indexname: string }>(
      `
        select indexname
        from pg_indexes
        where schemaname = 'doctor_portal'
          and indexname = any($1::text[])
      `,
      [["case_team_assignments_active_unique", "case_workload_units_active_unique", "appointment_protocols_appointment_idx", "doctor_availability_doctor_date_idx", "doctor_leave_requests_status_idx", "doctor_roster_notifications_week_idx"]]
    );
    assert.equal(indexes.rowCount, 6);
    const mustChangeColumn = await pool.query<{ column_name: string }>(
      `
        select column_name
        from information_schema.columns
        where table_name = 'users'
          and column_name = 'must_change_password'
      `
    );
    assert.equal(mustChangeColumn.rowCount, 1);
    const mustChangeIndex = await pool.query<{ indexname: string }>(
      `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'users'
          and indexname = 'users_must_change_password_idx'
      `
    );
    assert.equal(mustChangeIndex.rowCount, 1);
  });

  it("runs roster, case assignment, protocol, read-only exposure, workload, and idempotency flow", async () => {
    guard();
    const weekStart = mondayOf(today);
    const weekEnd = addDays(weekStart, 6);

    const week = await api(supervisor.cookie, "/api/doctor/roster/weeks", {
      method: "POST",
      body: { weekStartDate: weekStart, weekEndDate: weekEnd },
    });
    assert.equal(week.status, 201);
    const weekId = Number((week.data as { week: { id: number } }).week.id);

    const assignment = await api(supervisor.cookie, "/api/doctor/roster/assignments", {
      method: "POST",
      body: {
        rosterWeekId: weekId,
        date: today,
        modalityId: testData.modalityId,
        dutyType: "ct_protocol_day",
        sessionName: "day",
        startTime: "08:00",
        endTime: "14:00",
        teamName: `${TEST_PREFIX}CT Team`,
      },
    });
    assert.equal(assignment.status, 201);
    rosterAssignmentId = Number((assignment.data as { assignment: { id: number } }).assignment.id);

    assert.equal((await api(supervisor.cookie, `/api/doctor/roster/assignments/${rosterAssignmentId}/members`, {
      method: "POST",
      body: { doctorId: normal.doctorId, teamRole: "lead" },
    })).status, 201);
    assert.equal((await api(supervisor.cookie, `/api/doctor/roster/weeks/${weekId}/publish`, { method: "POST" })).status, 200);

    const notify = await api(supervisor.cookie, `/api/doctor/roster/weeks/${weekId}/notify`, { method: "POST" });
    assert.equal(notify.status, 201);
    assert.equal((notify.data as { createdCount: number }).createdCount, 1);
    const htmlExport = await fetch(`${app.baseUrl}/api/doctor/roster/weeks/${weekId}/export?format=html&scope=full`, { headers: { Cookie: supervisor.cookie } });
    assert.equal(htmlExport.status, 200);
    assert.match(await htmlExport.text(), /CT Team|Doctor roster/);
    const csvExport = await fetch(`${app.baseUrl}/api/doctor/roster/weeks/${weekId}/export?format=csv&scope=my`, { headers: { Cookie: normal.cookie } });
    assert.equal(csvExport.status, 200);
    assert.match(await csvExport.text(), /CT Team/);

    const assignRun = await api(supervisor.cookie, "/api/doctor/cases/assign", {
      method: "POST",
      body: { dateFrom: today, dateTo: today, modalityId: testData.modalityId },
    });
    assert.equal(assignRun.status, 200);
    assert.equal((assignRun.data as { summary: { assignedCount: number } }).summary.assignedCount, 1);

    const secondAssignRun = await api(supervisor.cookie, "/api/doctor/cases/assign", {
      method: "POST",
      body: { dateFrom: today, dateTo: today, modalityId: testData.modalityId },
    });
    assert.equal((secondAssignRun.data as { summary: { alreadyAssignedCount: number } }).summary.alreadyAssignedCount, 1);

    const myCases = await api(normal.cookie, `/api/doctor/cases/my?dateFrom=${today}&dateTo=${today}`);
    assert.equal(myCases.status, 200);
    assert.equal((myCases.data as { cases: unknown[] }).cases.length, 1);

    const draft = await api(normal.cookie, `/api/doctor/protocols/${appointmentId}`, {
      method: "POST",
      body: {
        protocolText: "Draft CT protocol",
        contrastRequired: true,
        contrastPhaseOrProtocol: "portal venous",
        specialPreparation: "fasting",
        technologistNotes: "check renal function",
      },
    });
    assert.equal(draft.status, 201, JSON.stringify(draft.data));
    assert.equal((draft.data as { protocol: { version: number; protocolStatus: string } }).protocol.version, 1);
    assert.equal((draft.data as { protocol: { protocolStatus: string } }).protocol.protocolStatus, "draft");

    const draftDetails = await api(supervisor.cookie, `/api/v2/appointments/${appointmentId}/details`);
    assert.equal((draftDetails.data as { appointment: { protocol_status: string | null } }).appointment.protocol_status, null);

    const assigned = await api(normal.cookie, `/api/doctor/protocols/${appointmentId}/assign`, {
      method: "POST",
      body: {
        protocolText: "Assigned CT protocol",
        contrastRequired: true,
        contrastPhaseOrProtocol: "portal venous",
        specialPreparation: "fasting",
        technologistNotes: "check renal function",
      },
    });
    assert.equal(assigned.status, 200);
    assert.equal((assigned.data as { protocol: { protocolStatus: string; version: number } }).protocol.protocolStatus, "assigned");
    assert.equal((assigned.data as { protocol: { version: number } }).protocol.version, 2);

    const audit = await api(normal.cookie, `/api/doctor/protocols/${appointmentId}/audit`);
    assert.equal(audit.status, 200);
    const auditEvents = (audit.data as { audit: Array<{ eventType: string; newSummary: string | null; protocolStatus: string | null }> }).audit;
    assert.equal(auditEvents.some((event) => event.eventType === "protocol_assigned" && event.protocolStatus === "assigned"), true);
    assert.equal(auditEvents.some((event) => /protocol text/i.test(event.newSummary ?? "")), true);

    const assignedDetails = await api(supervisor.cookie, `/api/v2/appointments/${appointmentId}/details`);
    assert.equal((assignedDetails.data as { appointment: { protocol_status: string | null } }).appointment.protocol_status, "assigned");
    assert.equal((assignedDetails.data as { appointment: { protocol_text: string | null } }).appointment.protocol_text, "Assigned CT protocol");

    const queue = await api(supervisor.cookie, "/api/v2/read/queue");
    assert.equal(queue.status, 200);
    const queueEntry = (queue.data as { queue_entries: Array<{ appointment_id: number; protocol_status: string | null }> }).queue_entries.find((row) => Number(row.appointment_id) === appointmentId);
    assert.equal(queueEntry?.protocol_status, "assigned");

    const workload = await api(supervisor.cookie, "/api/doctor/workload/calculate", {
      method: "POST",
      body: { startDate: today, endDate: today, modalityId: testData.modalityId },
    });
    assert.equal(workload.status, 200);
    assert.equal((workload.data as { summary: { calculatedCount: number } }).summary.calculatedCount, 1);

    const secondWorkload = await api(supervisor.cookie, "/api/doctor/workload/calculate", {
      method: "POST",
      body: { startDate: today, endDate: today, modalityId: testData.modalityId },
    });
    assert.equal((secondWorkload.data as { summary: { alreadyCurrentCount: number } }).summary.alreadyCurrentCount, 1);

    const activeRows = await pool.query<{ count: string }>(
      `select count(*)::text from doctor_portal.case_workload_units where appointment_id = $1 and status = 'active'`,
      [appointmentId]
    );
    assert.equal(Number(activeRows.rows[0].count), 1);
  });

  it("runs availability, leave, conflict-blocked publish, templates, and draft generation", async () => {
    guard();
    const availabilityDate = addDays(today, 21);
    const availability = await api(normal.cookie, "/api/doctor/availability/my", {
      method: "POST",
      body: { date: availabilityDate, availabilityStatus: "unavailable", startTime: null, endTime: null, note: "integration unavailable" },
    });
    assert.equal(availability.status, 201);

    const leave = await api(normal.cookie, "/api/doctor/leave/my", {
      method: "POST",
      body: { startDate: addDays(today, 22), endDate: addDays(today, 22), leaveType: "annual_leave", reason: "integration leave" },
    });
    assert.equal(leave.status, 201);
    const leaveId = Number((leave.data as { leave: { id: number } }).leave.id);
    assert.equal((await api(supervisor.cookie, `/api/doctor/leave/${leaveId}/status`, { method: "PATCH", body: { status: "approved" } })).status, 200);

    const conflictWeekStart = addDays(mondayOf(today), 21);
    const conflictWeek = await api(supervisor.cookie, "/api/doctor/roster/weeks", {
      method: "POST",
      body: { weekStartDate: conflictWeekStart, weekEndDate: addDays(conflictWeekStart, 6) },
    });
    assert.equal(conflictWeek.status, 201);
    const conflictWeekId = Number((conflictWeek.data as { week: { id: number } }).week.id);
    const conflictAssignment = await api(supervisor.cookie, "/api/doctor/roster/assignments", {
      method: "POST",
      body: {
        rosterWeekId: conflictWeekId,
        date: availabilityDate,
        modalityId: testData.modalityId,
        dutyType: "ct_protocol_day",
        sessionName: "day",
        startTime: "08:00",
        endTime: "14:00",
        teamName: `${TEST_PREFIX}Conflict Team`,
      },
    });
    assert.equal(conflictAssignment.status, 201);
    const conflictAssignmentId = Number((conflictAssignment.data as { assignment: { id: number } }).assignment.id);
    assert.equal((await api(supervisor.cookie, `/api/doctor/roster/assignments/${conflictAssignmentId}/members`, {
      method: "POST",
      body: { doctorId: normal.doctorId, teamRole: "lead" },
    })).status, 201);
    const blockedPublish = await api(supervisor.cookie, `/api/doctor/roster/weeks/${conflictWeekId}/publish`, { method: "POST" });
    assert.equal(blockedPublish.status, 409);

    const template = await api(admin.cookie, "/api/doctor/roster/templates", {
      method: "POST",
      body: {
        name: `${TEST_PREFIX}Template`,
        templateType: "ct_weekly",
        modalityId: testData.modalityId,
        assignments: [{
          dayOfWeek: 1,
          modalityId: testData.modalityId,
          dutyType: "ct_protocol_day",
          sessionName: "day",
          startTime: "08:00",
          endTime: "14:00",
          teamName: `${TEST_PREFIX}Template Team`,
          sortOrder: 0,
          members: [],
        }],
      },
    });
    assert.equal(template.status, 201);
    const templateId = Number((template.data as { template: { id: number } }).template.id);
    const generatedWeekStart = addDays(mondayOf(today), 35);
    const generated = await api(supervisor.cookie, "/api/doctor/roster/generate-draft", {
      method: "POST",
      body: { weekStartDate: generatedWeekStart, templateId, modalityId: null, includeDoctors: false, balanceStrategy: "simple" },
    });
    assert.equal(generated.status, 201);
    assert.equal((generated.data as { week: { status: string }; assignmentsCreated: number }).week.status, "draft");
    assert.equal((generated.data as { assignmentsCreated: number }).assignmentsCreated, 1);
  });

  it("enforces permissions for non-doctor, normal doctor, supervisor, and admin", async () => {
    guard();
    assert.equal((await api(nonDoctorCookie, `/api/doctor/roster/my?weekStart=${mondayOf(today)}`)).status, 403);
    assert.equal((await api(normal.cookie, "/api/doctor/roster/weeks", { method: "POST", body: { weekStartDate: addDays(today, 14), weekEndDate: addDays(today, 20) } })).status, 403);
    assert.equal((await api(normal.cookie, "/api/doctor/cases/assign", { method: "POST", body: { dateFrom: today, dateTo: today } })).status, 403);
    assert.equal((await api(normal.cookie, "/api/doctor/workload/calculate", { method: "POST", body: { startDate: today, endDate: today } })).status, 403);

    const unrelatedPatientId = await createPatient("Unrelated");
    const unrelatedAppointmentId = await createBooking(testData, today, unrelatedPatientId);
    const unrelatedProtocol = await api(otherDoctor.cookie, `/api/doctor/protocols/${unrelatedAppointmentId}`, {
      method: "POST",
      body: { protocolText: "not allowed" },
    });
    assert.equal(unrelatedProtocol.status, 403);
    assert.equal((await api(otherDoctor.cookie, `/api/doctor/protocols/${unrelatedAppointmentId}/audit`)).status, 403);

    const catalog = await api(admin.cookie, "/api/doctor/workload/catalog", {
      method: "POST",
      body: {
        modalityId: testData.modalityId,
        assignmentType: "protocol",
        baseUnits: 1,
        reportRequiredMultiplier: 1,
        noReportUnits: 0,
        effectiveFrom: today,
      },
    });
    assert.equal(catalog.status, 201);
    const catalogId = Number((catalog.data as { rule: { id: number } }).rule.id);
    const updatedCatalog = await api(admin.cookie, `/api/doctor/workload/catalog/${catalogId}`, {
      method: "PATCH",
      body: { baseUnits: 2, noReportUnits: 0.5 },
    });
    assert.equal(updatedCatalog.status, 200);
    assert.equal((updatedCatalog.data as { rule: { baseUnits: number } }).rule.baseUnits, 2);
    assert.equal((await api(normal.cookie, `/api/doctor/workload/catalog/${catalogId}`, { method: "PATCH", body: { baseUnits: 3 } })).status, 403);
    const deactivatedCatalog = await api(admin.cookie, `/api/doctor/workload/catalog/${catalogId}/deactivate`, { method: "POST" });
    assert.equal(deactivatedCatalog.status, 200);
    assert.equal((deactivatedCatalog.data as { rule: { active: boolean } }).rule.active, false);
    assert.equal((await api(supervisor.cookie, "/api/doctor/workload/calculate", { method: "POST", body: { startDate: today, endDate: today } })).status, 200);
  });

  it("allows profileless admins to manage profiles but blocks clinical workflows", async () => {
    guard();
    const profileless = await pool.query<{ id: string }>(
      `
        insert into users (username, password_hash, full_name, role, is_active)
        values ($1, '$2a$10$ztv9Kx3klEC1wiHttYuwUeCN9KMI3yHuGjvRVEGFFVnbRu7YSfTyS', $2, 'super_admin', true)
        returning id::text as id
      `,
      [`${TEST_PREFIX.toLowerCase()}profileless_${randomUUID().replace(/-/g, "").slice(0, 8)}`, `${TEST_PREFIX}Profileless Admin`]
    );
    const cookie = createTestAuthCookie(Number(profileless.rows[0].id), "super_admin");

    const me = await api(cookie, "/api/doctor/me");
    assert.equal(me.status, 200);
    assert.equal((me.data as { hasActiveDoctorProfile: boolean }).hasActiveDoctorProfile, false);
    assert.equal((me.data as { canAccessDoctorAdmin: boolean }).canAccessDoctorAdmin, true);
    assert.equal((me.data as { canAccessClinicalDoctorPortal: boolean }).canAccessClinicalDoctorPortal, false);

    assert.equal((await api(cookie, "/api/doctor/profiles")).status, 200);
    const template = await fetch(`${app.baseUrl}/api/doctor/admin/doctors/import/template`, { headers: { Cookie: cookie } });
    assert.equal(template.status, 200);
    assert.equal(template.headers.get("content-type")?.includes("text/csv"), true);

    assert.equal((await api(cookie, `/api/doctor/roster/my?weekStart=${mondayOf(today)}`)).status, 403);
    assert.equal((await api(cookie, "/api/doctor/cases/assign", { method: "POST", body: { dateFrom: today, dateTo: today } })).status, 403);
    assert.equal((await api(cookie, `/api/doctor/protocols/${appointmentId}`)).status, 403);
    assert.equal((await api(cookie, "/api/doctor/workload/calculate", { method: "POST", body: { startDate: today, endDate: today } })).status, 403);
  });

  it("creates a doctor login, profile, and modality permissions atomically from Doctor Admin", async () => {
    guard();
    const username = `${TEST_PREFIX.toLowerCase()}created_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const body = {
      username: `  ${username.toUpperCase()}  `,
      fullName: `${TEST_PREFIX} Created Doctor`,
      temporaryPassword: "TempPass123",
      coreRole: "doctor",
      userActive: true,
      doctorDisplayName: `${TEST_PREFIX} Created Display`,
      doctorRole: "consultant",
      doctorProfileActive: true,
      canFinalizeReports: true,
      canAssignProtocols: false,
      canSupervise: true,
      modalityPermissions: [{ modalityId: testData.modalityId, active: true, canProtocol: true, canReport: true, canSupervise: false }],
    };

    const created = await api(admin.cookie, "/api/doctor/admin/doctors", { method: "POST", body });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const createdData = created.data as {
      user: { id: number; must_change_password: boolean; is_active: boolean };
      profile: { id: number; active: boolean; canSupervise: boolean };
      modalities: Array<{ modalityId: number; canProtocol: boolean; canReport: boolean; active: boolean }>;
    };
    assert.equal(createdData.user.must_change_password, true);
    assert.equal(createdData.user.is_active, true);
    assert.equal(createdData.profile.active, true);
    assert.equal(createdData.profile.canSupervise, true);
    assert.equal(createdData.modalities.some((permission) => Number(permission.modalityId) === testData.modalityId && permission.active && permission.canProtocol && permission.canReport), true);

    const initialLogin = await authRequest("/api/auth/login", { username: `  ${username.toUpperCase()} `, password: body.temporaryPassword });
    assert.equal(initialLogin.status, 200, JSON.stringify(initialLogin.data));
    assert.equal(((initialLogin.data.user as { mustChangePassword: boolean }).mustChangePassword), true);
    assert.ok(initialLogin.cookie);

    const changed = await authRequest("/api/auth/change-password", { currentPassword: body.temporaryPassword, newPassword: "ChangedPass456" }, initialLogin.cookie);
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal(((changed.data.user as { mustChangePassword: boolean }).mustChangePassword), false);
    assert.ok(changed.cookie);
    assert.equal((await authRequest("/api/auth/login", { username, password: body.temporaryPassword })).status, 401);
    assert.equal((await authRequest("/api/auth/login", { username: username.toUpperCase(), password: "ChangedPass456" })).status, 200);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.equal((await authRequest("/api/auth/login", { username, password: "wrong-password" })).status, 401);
    }
    assert.equal((await authRequest("/api/auth/login", { username, password: "ChangedPass456" })).status, 200);
    for (let attempt = 0; attempt < 9; attempt += 1) {
      assert.equal((await authRequest("/api/auth/login", { username, password: "wrong-password" })).status, 401);
    }
    assert.equal((await authRequest("/api/auth/login", { username, password: "ChangedPass456" })).status, 200, "successful login must clear the username failure bucket");

    for (let attempt = 0; attempt < 10; attempt += 1) {
      assert.equal((await authRequest("/api/auth/login", { username, password: "wrong-password" })).status, 401);
    }
    assert.equal((await authRequest("/api/auth/login", { username, password: "ChangedPass456" })).status, 429);
    const sharedIpDoctor = `${username}_shared`;
    const sharedCreated = await api(admin.cookie, "/api/doctor/admin/doctors", { method: "POST", body: { ...body, username: sharedIpDoctor, doctorDisplayName: `${TEST_PREFIX} Shared IP Doctor` } });
    assert.equal(sharedCreated.status, 201, JSON.stringify(sharedCreated.data));
    assert.equal((await authRequest("/api/auth/login", { username: sharedIpDoctor, password: body.temporaryPassword })).status, 200, "one username's failures must not block another doctor on the same IP");

    const userCookie = createTestAuthCookie(createdData.user.id, "doctor");
    assert.equal((await api(userCookie, "/api/doctor/me")).status, 200);
    const updated = await api(admin.cookie, `/api/doctor/profiles/${createdData.profile.id}`, {
      method: "PATCH",
      body: { displayName: `${TEST_PREFIX} Updated Display`, doctorRole: "resident", active: false, canFinalizeReports: false, canAssignProtocols: true, canSupervise: false },
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    assert.equal((updated.data as { profile: { displayName: string; doctorRole: string; active: boolean; canAssignProtocols: boolean } }).profile.displayName, `${TEST_PREFIX} Updated Display`);
    assert.equal((updated.data as { profile: { doctorRole: string } }).profile.doctorRole, "resident");
    assert.equal((updated.data as { profile: { canAssignProtocols: boolean } }).profile.canAssignProtocols, true);

    const inactiveMe = await api(userCookie, "/api/doctor/me");
    assert.equal(inactiveMe.status, 200);
    assert.equal((inactiveMe.data as { hasActiveDoctorProfile: boolean; canAccessClinicalDoctorPortal: boolean }).hasActiveDoctorProfile, false);
    assert.equal((inactiveMe.data as { hasActiveDoctorProfile: boolean; canAccessClinicalDoctorPortal: boolean }).canAccessClinicalDoctorPortal, false);

    const duplicate = await api(admin.cookie, "/api/doctor/admin/doctors", { method: "POST", body: { ...body, username: username.toUpperCase(), doctorDisplayName: `${TEST_PREFIX} Duplicate` } });
    assert.equal(duplicate.status, 409);

    const whitespacePassword = await api(admin.cookie, "/api/doctor/admin/doctors", { method: "POST", body: { ...body, username: `${username}_space`, temporaryPassword: " TempPass123" } });
    assert.equal(whitespacePassword.status, 400);
    assert.match(String((whitespacePassword.data as { error?: string }).error), /must not start or end with whitespace/);

    const sharedUserId = Number(((sharedCreated.data as { user: { id: number } }).user.id));
    await pool.query(`update users set is_active = false where id = $1`, [sharedUserId]);
    assert.equal((await authRequest("/api/auth/login", { username: sharedIpDoctor, password: body.temporaryPassword })).status, 401);

    const missingPassword = await api(admin.cookie, "/api/doctor/admin/doctors", { method: "POST", body: { ...body, username: `${username}_missing`, temporaryPassword: "" } });
    assert.equal(missingPassword.status, 400);

    const normalDenied = await api(normal.cookie, "/api/doctor/admin/doctors", { method: "POST", body: { ...body, username: `${username}_denied` } });
    assert.equal(normalDenied.status, 403);
  });

  it("allows supervisors to create doctors and rolls back user creation when profile setup fails", async () => {
    guard();
    const supervisorUsername = `${TEST_PREFIX.toLowerCase()}supercreated_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const supervisorCreate = await api(supervisor.cookie, "/api/doctor/admin/doctors", {
      method: "POST",
      body: {
        username: supervisorUsername,
        fullName: `${TEST_PREFIX} Supervisor Created Doctor`,
        temporaryPassword: "TempPass123",
        coreRole: "supervisor",
        userActive: true,
        doctorDisplayName: `${TEST_PREFIX} Supervisor Created Doctor`,
        doctorRole: "specialist",
        doctorProfileActive: true,
        canFinalizeReports: true,
        canAssignProtocols: true,
        canSupervise: true,
        modalityPermissions: [],
      },
    });
    assert.equal(supervisorCreate.status, 201, JSON.stringify(supervisorCreate.data));
    assert.equal((supervisorCreate.data as { user: { must_change_password: boolean }; profile: { active: boolean } }).user.must_change_password, true);
    assert.equal((supervisorCreate.data as { user: { must_change_password: boolean }; profile: { active: boolean } }).profile.active, true);
    const supervisorCreatedUserId = (supervisorCreate.data as { user: { id: number } }).user.id;
    const deactivated = await api(admin.cookie, `/api/doctor/admin/doctors/${supervisorCreatedUserId}/deactivate`, { method: "POST" });
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.data));
    assert.equal((deactivated.data as { user: { is_active: boolean } }).user.is_active, false);
    const activated = await api(admin.cookie, `/api/doctor/admin/doctors/${supervisorCreatedUserId}/activate`, { method: "POST" });
    assert.equal(activated.status, 200, JSON.stringify(activated.data));
    assert.equal((activated.data as { user: { is_active: boolean } }).user.is_active, true);

    const failingUsername = `${TEST_PREFIX.toLowerCase()}rollback_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const failed = await api(admin.cookie, "/api/doctor/admin/doctors", {
      method: "POST",
      body: {
        username: failingUsername,
        fullName: `${TEST_PREFIX} Rollback Doctor`,
        temporaryPassword: "TempPass123",
        coreRole: "doctor",
        userActive: true,
        doctorDisplayName: `${TEST_PREFIX} Rollback Doctor`,
        doctorRole: "consultant",
        doctorProfileActive: true,
        canFinalizeReports: true,
        canAssignProtocols: true,
        canSupervise: false,
        modalityPermissions: [{ modalityId: 2147483000, active: true, canProtocol: true, canReport: false, canSupervise: false }],
      },
    });
    assert.notEqual(failed.status, 201);
    const leakedUser = await pool.query<{ count: string }>(`select count(*)::text as count from users where username = $1`, [failingUsername]);
    assert.equal(Number(leakedUser.rows[0].count), 0);
  });

  it("imports doctors through CSV preview/confirm and forces password change", async () => {
    guard();
    const username = `${TEST_PREFIX.toLowerCase()}import_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const modality = await pool.query<{ code: string }>(`select code from modalities where id = $1`, [testData.modalityId]);
    const modalityCode = modality.rows[0].code;
    const csv = [
      "username,full_name,temporary_password,core_role,user_active,doctor_role,doctor_profile_active,can_finalize_reports,can_assign_protocols,can_supervise,modalities_protocol,modalities_report,modalities_supervise,reset_password",
      `${username},${TEST_PREFIX} Imported Doctor,TempPass123,doctor,true,consultant,true,true,true,false,${modalityCode},,,false`,
    ].join("\n");
    const fileContentBase64 = Buffer.from(csv, "utf8").toString("base64");

    const inspect = await api(admin.cookie, "/api/doctor/admin/doctors/import/inspect", { method: "POST", body: { fileContentBase64 } });
    assert.equal(inspect.status, 200);
    assert.equal((inspect.data as { workbook: { rowCount: number; missingColumns: string[] } }).workbook.rowCount, 1);
    assert.deepEqual((inspect.data as { workbook: { missingColumns: string[] } }).workbook.missingColumns, []);

    const preview = await api(admin.cookie, "/api/doctor/admin/doctors/import/preview", { method: "POST", body: { fileContentBase64 } });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal((preview.data as { preview: { canConfirm: boolean } }).preview.canConfirm, true);

    const confirm = await api(admin.cookie, "/api/doctor/admin/doctors/import/confirm", { method: "POST", body: { fileContentBase64 } });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
    assert.equal((confirm.data as { result: { createdUsers: number; createdProfiles: number } }).result.createdUsers, 1);
    assert.equal((confirm.data as { result: { createdUsers: number; createdProfiles: number } }).result.createdProfiles, 1);

    const imported = await pool.query<{ must_change_password: boolean }>(
      `select must_change_password from users where username = $1 limit 1`,
      [username]
    );
    assert.equal(imported.rows[0]?.must_change_password, true);
  });

  it("supports XLSX doctor import/export with row errors and password reset guardrails", async () => {
    guard();
    const modality = await pool.query<{ code: string }>(`select code from modalities where id = $1`, [testData.modalityId]);
    const modalityCode = modality.rows[0].code;
    const username = `${TEST_PREFIX.toLowerCase()}xlsx_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    const rows = [{
      username,
      full_name: `${TEST_PREFIX} XLSX Doctor`,
      temporary_password: "TempPass123",
      core_role: "doctor",
      user_active: "true",
      doctor_role: "consultant",
      doctor_profile_active: "true",
      can_finalize_reports: "true",
      can_assign_protocols: "true",
      can_supervise: "false",
      modalities_protocol: modalityCode,
      modalities_report: "",
      modalities_supervise: "",
      reset_password: "false",
    }];
    const fileContentBase64 = await workbookBase64(rows);

    const exportResponse = await fetch(`${app.baseUrl}/api/doctor/admin/doctors/export?format=xlsx`, { headers: { Cookie: admin.cookie } });
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.headers.get("content-type")?.includes("spreadsheetml"), true);
    const XLSX = await import("xlsx");
    const exported = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: "buffer" });
    const exportedHeaders = XLSX.utils.sheet_to_json<unknown[]>(exported.Sheets[exported.SheetNames[0]], { header: 1 })[0]?.map(String) ?? [];
    assert.equal(exportedHeaders.some((header) => /password/i.test(header)), false);

    const template = await fetch(`${app.baseUrl}/api/doctor/admin/doctors/import/template?format=xlsx`, { headers: { Cookie: admin.cookie } });
    assert.equal(template.status, 200);
    assert.equal(template.headers.get("content-type")?.includes("spreadsheetml"), true);

    const preview = await api(admin.cookie, "/api/doctor/admin/doctors/import/preview", { method: "POST", body: { fileContentBase64, format: "xlsx" } });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal((preview.data as { preview: { canConfirm: boolean } }).preview.canConfirm, true);

    const confirm = await api(admin.cookie, "/api/doctor/admin/doctors/import/confirm", { method: "POST", body: { fileContentBase64, format: "xlsx" } });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.data));
    assert.equal((confirm.data as { result: { createdUsers: number; createdProfiles: number } }).result.createdUsers, 1);
    assert.equal((confirm.data as { result: { createdUsers: number; createdProfiles: number } }).result.createdProfiles, 1);
    const imported = await pool.query<{ id: string; password_hash: string; must_change_password: boolean }>(
      `select id::text, password_hash, must_change_password from users where username = $1 limit 1`,
      [username]
    );
    assert.equal(imported.rows[0]?.must_change_password, true);
    const originalHash = imported.rows[0].password_hash;

    const duplicatePreview = await api(admin.cookie, "/api/doctor/admin/doctors/import/preview", {
      method: "POST",
      body: { fileContentBase64: await workbookBase64([rows[0], rows[0]]), format: "xlsx" },
    });
    assert.equal((duplicatePreview.data as { preview: { canConfirm: boolean; rows: Array<{ errors: string[] }> } }).preview.canConfirm, false);
    assert.match((duplicatePreview.data as { preview: { rows: Array<{ errors: string[] }> } }).preview.rows[1].errors.join(";"), /duplicate username/i);

    const invalidPreview = await api(admin.cookie, "/api/doctor/admin/doctors/import/preview", {
      method: "POST",
      body: { fileContentBase64: await workbookBase64([{ ...rows[0], username: `${username}_invalid`, modalities_protocol: "NO_SUCH_MODALITY" }]), format: "xlsx" },
    });
    assert.equal((invalidPreview.data as { preview: { canConfirm: boolean; rows: Array<{ errors: string[] }> } }).preview.canConfirm, false);
    assert.match((invalidPreview.data as { preview: { rows: Array<{ errors: string[] }> } }).preview.rows[0].errors.join(";"), /invalid modality/i);

    const noReset = await api(admin.cookie, "/api/doctor/admin/doctors/import/confirm", {
      method: "POST",
      body: { fileContentBase64: await workbookBase64([{ ...rows[0], temporary_password: "DifferentPass123", reset_password: "false" }]), format: "xlsx" },
    });
    assert.equal(noReset.status, 200, JSON.stringify(noReset.data));
    const unchanged = await pool.query<{ password_hash: string }>(`select password_hash from users where username = $1`, [username]);
    assert.equal(unchanged.rows[0].password_hash, originalHash);
  });

  it("supersedes changed workload values without duplicate active rows", async () => {
    guard();
    await pool.query(
      `
        update doctor_portal.case_workload_units
        set workload_units = 99
        where appointment_id = $1 and status = 'active'
      `,
      [appointmentId]
    );
    const result = await api(supervisor.cookie, "/api/doctor/workload/calculate", {
      method: "POST",
      body: { startDate: today, endDate: today, modalityId: testData.modalityId },
    });
    assert.equal(result.status, 200);
    const rows = await pool.query<{ status: string; count: string }>(
      `
        select status, count(*)::text
        from doctor_portal.case_workload_units
        where appointment_id = $1
        group by status
      `,
      [appointmentId]
    );
    const counts = new Map(rows.rows.map((row) => [row.status, Number(row.count)]));
    assert.equal(counts.get("active"), 1);
    assert.ok((counts.get("superseded") ?? 0) >= 1);
  });
});
