import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const root = process.cwd();

describe("Doctor Portal Reporting Assignment Board foundation", () => {
  it("adds saved views and Reporting Board settings migration", () => {
    const migration = readFileSync(`${root}/src/db/migrations/087_doctor_portal_reporting_board.sql`, "utf8");

    assert.match(migration, /doctor_portal\.reporting_board_saved_views/);
    assert.match(migration, /token text not null unique/);
    assert.match(migration, /notification_settings_json jsonb not null default '\{\}'::jsonb/);
    assert.match(migration, /doctor_portal_reporting_board/);
    assert.match(migration, /"enabledModalityCodes": \["CT", "MR"\]/);
  });

  it("wires authenticated Reporting Board routes under Doctor Portal", () => {
    const index = readFileSync(`${root}/src/modules/doctor-portal/index.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");

    assert.match(index, /router\.use\("\/reporting-board", doctorReportingBoardRouter\)/);
    assert.match(routes, /"\/settings"/);
    assert.match(routes, /"\/cases"/);
    assert.match(routes, /"\/stats"/);
    assert.match(routes, /"\/saved-views"/);
    assert.match(routes, /"\/saved-views\/token\/:token"/);
    assert.match(routes, /"\/bulk-assign-next"/);
    assert.match(routes, /"\/bulk-reassign-selected"/);
  });

  it("keeps saved view token loading authenticated and owner-scoped", () => {
    const index = readFileSync(`${root}/src/modules/doctor-portal/index.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");

    assert.match(index, /router\.use\(requireAuth\)/);
    assert.match(repo, /where token = \$1 and owner_user_id = \$2 and active = true/);
    assert.doesNotMatch(index, /patient|public/i);
  });

  it("restricts cutoff settings updates to super_admin", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");

    assert.match(service, /actor\.appRole !== "super_admin"/);
    assert.match(service, /Only super_admin can update Reporting Board settings/);
  });

  it("case list defaults to report-required CT/MR scope and priority ordering", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");

    assert.match(service, /const me = await requireRosterDoctor\(actor\)/);
    assert.match(service, /assignedDoctorId: me\.profile!\.id/);
    assert.match(service, /defaultRequiresReport/);
    assert.match(service, /enabledModalityCodes/);
    assert.match(repo, /b\.requires_report = \$\$\{values\.length\}/);
    assert.match(repo, /rp\.code as "reportingPriorityCode"/);
    assert.match(repo, /rp\.name_en as "reportingPriorityName"/);
    assert.match(repo, /rp\.sort_order as "reportingPrioritySortOrder"/);
    assert.match(repo, /caseSortOrder/);
    assert.match(repo, /listReportingBoardStatsRows/);
    assert.match(repo, /priority_study_date/);
    assert.match(repo, /case lower\(coalesce\(rp\.code, ''\)\) when 'stat' then 0 when 'urgent' then 1 else 2 end asc/);
    assert.match(repo, /order by \$\{orderBy\}/);
  });

  it("uses SonicDICOM status without crashing board case listing", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");

    assert.match(service, /checkSonicDicomReportStatus/);
    assert.match(service, /catch \{\s*status = "unavailable";\s*\}/);
    assert.match(service, /reportStatus === "required_not_final"/);
    assert.match(service, /row\.reportStatus !== "final"/);
  });

  it("bulk assign chooses next backend cases, accepts optional notes, skips assigned by default, and audits", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");

    assert.match(service, /reason: input\.reason\?\.trim\(\) \|\| null/);
    assert.match(service, /assignmentStatus: input\.unassignedOnly === false \? rawFilters\.assignmentStatus : "unassigned"/);
    assert.match(service, /eligible\.slice\(0, input\.count\)/);
    assert.match(repo, /for update of b/);
    assert.match(repo, /doctorCanReportAllModalities/);
    assert.match(repo, /result\.rows\.length === uniqueModalityIds\.length/);
    assert.match(repo, /reporting_board_bulk_case_assigned/);
    assert.match(repo, /reporting_board_bulk_assign_completed/);
    assert.match(repo, /caseAuditEventType/);
    assert.match(repo, /summaryAuditEventType/);
  });

  it("saved view tokens are active-only and owner scoped unless loaded by a manager", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");

    assert.match(repo, /where token = \$1 and owner_user_id = \$2 and active = true/);
    assert.match(repo, /where token = \$1 and active = true/);
    assert.match(service, /moduleCapabilities\.includes\("doctor_supervisor"\)/);
    assert.match(service, /findActiveSavedViewByToken\(token\)/);
  });

  it("adds in-app Reporting Board notification event storage and safe body text", () => {
    const migration = readFileSync(`${root}/src/db/migrations/088_doctor_portal_reporting_board_notifications.sql`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");

    assert.match(migration, /doctor_portal\.reporting_board_notification_events/);
    assert.match(migration, /reporting_case_assigned_to_me/);
    assert.match(migration, /dedupe_key text not null unique/);
    assert.match(repo, /notifyAssignedToMe/);
    assert.match(repo, /on conflict \(dedupe_key\) do nothing/);
    assert.match(repo, /Reporting case assigned/);
    assert.match(repo, /patientEnglishName/);
    assert.match(repo, /accessionNumber/);
    assert.match(routes, /"\/notifications"/);
    assert.match(routes, /"\/notifications\/:id\/read"/);
    assert.match(routes, /"\/notifications\/:id\/dismiss"/);
  });

  it("creates notifications only from Reporting Board assignment paths", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");

    assert.match(routes, /"\/:appointmentId\/assign-doctor"/);
    assert.match(service, /assignReportingBoardCaseToDoctor/);
    assert.match(service, /createAssignedToMeNotifications/);
    assert.match(service, /result\.assignedAppointmentIds/);
  });

  it("adds pending reporting assignment intents without changing bookings", () => {
    const migration = readFileSync(`${root}/src/db/migrations/099_reporting_assignment_intents.sql`, "utf8");
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-assignment-intents-service.ts`, "utf8");
    const createService = readFileSync(`${root}/src/modules/appointments-v2/booking/services/create-booking.service.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/appointments-v2/api/routes/appointments-v2-routes.ts`, "utf8");

    assert.match(migration, /doctor_portal\.reporting_assignment_intents/);
    assert.match(migration, /status text not null/);
    assert.match(migration, /pending/);
    assert.match(migration, /activated/);
    assert.match(migration, /cancelled/);
    assert.match(migration, /superseded/);
    assert.match(migration, /failed/);
    assert.match(migration, /unique \(appointment_id\)[\s\S]*where status = 'pending'/);
    assert.doesNotMatch(migration, /alter table appointments_v2\.bookings[\s\S]*assigned_doctor_id/i);
    assert.match(service, /createPendingReportingAssignmentIntent/);
    assert.match(service, /activatePendingReportingAssignmentIntent/);
    assert.match(service, /cancelPendingReportingAssignmentIntent/);
    assert.match(service, /canCreateReportingAssignmentIntent/);
    assert.match(createService, /createPendingReportingAssignmentIntent/);
    assert.match(routes, /intendedReportingDoctorId/);
    assert.match(routes, /intendedReportingDoctorReason/);
  });

  it("activates reporting intents after completion and notifies after commit", () => {
    const statusService = readFileSync(`${root}/src/modules/appointments-v2/booking/services/status-booking.service.ts`, "utf8");
    const pacsWorker = readFileSync(`${root}/src/services/appointments-v2-pacs-auto-completion-worker.ts`, "utf8");
    const mppsService = readFileSync(`${root}/src/services/mpps-service.ts`, "utf8");
    const intentService = readFileSync(`${root}/src/modules/doctor-portal/reporting-assignment-intents-service.ts`, "utf8");

    assert.match(intentService, /select[\s\S]*from appointments_v2\.bookings[\s\S]*for update/);
    assert.match(intentService, /from doctor_portal\.reporting_assignment_intents[\s\S]*status = 'pending'[\s\S]*for update/);
    assert.match(intentService, /booking\.status !== "completed"/);
    assert.match(intentService, /booking\.requiresReport !== true/);
    assert.match(intentService, /can_finalize_reports = true/);
    assert.match(intentService, /doctor_modality_permissions/);
    assert.match(intentService, /can_report = true/);
    assert.match(intentService, /insert into doctor_portal\.case_team_assignments/);
    assert.match(intentService, /assigned_doctor_id/);
    assert.match(intentService, /status = 'activated'/);
    assert.match(intentService, /status = 'failed'/);
    assert.match(statusService, /activatePendingReportingAssignmentIntent/);
    assert.match(pacsWorker, /activatePendingReportingAssignmentIntent/);
    assert.match(mppsService, /activatePendingReportingAssignmentIntent/);
    assert.match(statusService, /createAssignedToMeNotifications/);
    assert.match(pacsWorker, /createAssignedToMeNotifications/);
    assert.match(mppsService, /createAssignedToMeNotifications/);
    assert.match(statusService, /reporting_assignment_intent_notification_failed/);
    assert.match(pacsWorker, /reporting_assignment_intent_notification_failed/);
    assert.match(mppsService, /reporting_assignment_intent_notification_failed/);
  });

  it("adds authenticated saved-view Web Push subscription storage", () => {
    const migration = readFileSync(`${root}/src/db/migrations/090_reporting_board_saved_view_web_push.sql`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");

    assert.match(migration, /doctor_portal\.reporting_board_web_push_subscriptions/);
    assert.match(migration, /saved_view_id bigint not null references doctor_portal\.reporting_board_saved_views\(id\) on delete cascade/);
    assert.match(migration, /subscription_hash text not null/);
    assert.match(routes, /"\/push-config"/);
    assert.match(routes, /"\/saved-views\/:id\/push-subscribe"/);
    assert.match(routes, /"\/saved-views\/:id\/test-push"/);
    assert.match(repo, /getPatientWebPushSharedConfig/);
    assert.match(repo, /configurePatientWebPushVapid/);
    assert.match(repo, /reportingCaseNotificationText/);
    assert.match(repo, /sendSavedViewPushNotifications/);
    assert.match(repo, /clickUrl/);
    assert.match(repo, /notification\.actionUrl\?\.replace/);
    assert.match(repo, /"\/mobile\/reporting-view\/"/);
  });

  it("adds public read-only mobile saved-view routes with backend scope and authenticated writes", () => {
    const app = readFileSync(`${root}/src/app.ts`, "utf8");
    const publicRoutes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-public-routes.ts`, "utf8");
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");
    const publicPushMigration = readFileSync(`${root}/src/db/migrations/091_reporting_board_public_push_subscriptions.sql`, "utf8");

    assert.match(app, /app\.use\("\/api\/reporting", reportingBoardPublicRouter\)/);
    assert.match(publicRoutes, /"\/saved-views\/public\/:token\/mobile"/);
    assert.match(publicRoutes, /optionalAuth/);
    assert.match(publicRoutes, /requireAuth/);
    assert.match(publicRoutes, /assign-to-me/);
    assert.match(publicRoutes, /reassign/);
    assert.match(publicRoutes, /push-config/);
    assert.match(publicRoutes, /push-subscribe/);
    assert.match(service, /findActiveSavedViewByToken\(token\)/);
    assert.match(service, /narrowSavedViewFilters/);
    assert.match(service, /savedViewFilters\[key\]/);
    assert.match(service, /insertDoctorAuditEvent/);
    assert.match(service, /assignReportingBoardCaseToDoctor/);
    assert.match(service, /subscribePublicReportingBoardMobilePush/);
    assert.match(publicPushMigration, /alter column user_id drop not null/);
    assert.match(service, /\/mobile\/reporting-view\/\$\{view\.token\}/);
    assert.match(repo, /lower\(coalesce\(p\.english_full_name/);
    assert.match(repo, /lower\('V2-' \|\| lpad\(b\.id::text, 6, '0'\)\)/);
  });
});
