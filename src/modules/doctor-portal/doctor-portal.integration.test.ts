import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

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
        identifier_type, identifier_value
      )
      values ($1, $2, $3::varchar, $4, 'F', 40, 'national_id', $3::text)
      returning id::text as id
    `,
    [`${TEST_PREFIX}${name} Arabic`, `${TEST_PREFIX}${name}`, nationalId, `${TEST_PREFIX}${name}`]
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

  return { userId, modalityId, examTypeId, patientId, policySetId, policySetKey: policyKey, policyVersionId, schemaName: "appointments_v2" };
}

async function createDoctorPortalTestApp() {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const http = await import("node:http");
  const { createAppointmentsV2Router } = await import("../appointments-v2/index.js");
  const { createDoctorPortalRouter } = await import("./index.js");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());
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

async function cleanupDoctorPortalTestData() {
  const userRows = await pool.query<{ id: string }>(`select id::text as id from users where username like $1`, [`${TEST_PREFIX.toLowerCase()}%`]);
  const userIds = userRows.rows.map((row) => Number(row.id));
  const doctorRows = await pool.query<{ id: string }>(`select id::text as id from doctor_portal.doctor_profiles where display_name like $1`, [`${TEST_PREFIX}%`]);
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
    today = String((await pool.query<{ today: string }>(`select current_date::text as today`)).rows[0].today);
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
    await cleanupDoctorPortalTestData();
    await testDb.cleanup();
  });

  function guard() {
    if (!testData) throw new Error("Test setup failed");
  }

  const api = (cookie: string, path: string, options: { method?: string; body?: unknown } = {}) =>
    fetchJson(app.baseUrl, path, { cookie, ...options });

  it("verifies Doctor Portal migrations 064-071 are applied with core constraints/indexes", async () => {
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
    assert.equal((await api(supervisor.cookie, "/api/doctor/workload/calculate", { method: "POST", body: { startDate: today, endDate: today } })).status, 200);
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
