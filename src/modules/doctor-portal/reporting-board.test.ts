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

  it("adds comparison requests to Reporting Board without reusing appointment assignments", () => {
    const types = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-types.ts`, "utf8");
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const comparisonService = readFileSync(`${root}/src/services/comparison-request-service.ts`, "utf8");

    assert.match(types, /caseType: "appointment" \| "comparison"/);
    assert.match(types, /ReportingBoardCaseSource = "all" \| "appointments" \| "comparisons"/);
    assert.match(types, /comparisonRequestId: number \| null/);
    assert.match(types, /comparisonRequests: number/);
    assert.match(service, /listUnifiedReportingBoardCases/);
    assert.match(service, /sourceAllowsAppointments/);
    assert.match(service, /sourceAllowsComparisons/);
    assert.match(service, /\.sort\(compareReportingBoardRows\(filters\)\)/);
    assert.match(service, /caseType === "comparison"/);
    assert.match(comparisonService, /doctor_portal\.comparison_case_assignments/);
    assert.doesNotMatch(comparisonService, /doctor_portal\.case_team_assignments/);
  });

  it("parses caseSource and keeps it in saved-view filter narrowing", () => {
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const frontendTypes = readFileSync(`${root}/frontend/src/types/api.ts`, "utf8");

    assert.match(routes, /REPORTING_BOARD_CASE_SOURCES = new Set\(\["all", "appointments", "comparisons"\]\)/);
    assert.match(routes, /caseSource: optionalCaseSource\(query\.caseSource\)/);
    assert.match(routes, /caseSource: optionalCaseSource\(body\.caseSource\)/);
    assert.match(service, /caseSource: input\.caseSource \?\? "all"/);
    assert.match(service, /"caseSource"/);
    assert.match(frontendTypes, /ReportingBoardCaseSource = "all" \| "appointments" \| "comparisons"/);
  });

  it("keeps comparison mobile saved views and notifications case-type aware", () => {
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const repository = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");
    const publicRoutes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-public-routes.ts`, "utf8");
    const comparisonService = readFileSync(`${root}/src/services/comparison-request-service.ts`, "utf8");
    const migration = readFileSync(`${root}/src/db/migrations/104_comparison_reporting_board_notifications.sql`, "utf8");

    assert.match(service, /listUnifiedReportingBoardCases\(scopedFilters, \{ fullScope: true \}\)/);
    assert.match(service, /caseKey: row\.caseKey/);
    assert.match(service, /comparisonRequestId: row\.comparisonRequestId/);
    assert.match(publicRoutes, /caseIdentity\(body\)/);
    assert.match(repository, /RISpro comparison request update/);
    assert.match(repository, /comparisonRequestIds/);
    assert.match(repository, /\/comparisons\/\$\{caseRow\.comparisonRequestId\}/);
    assert.match(comparisonService, /createAssignedToMeNotifications/);
    assert.match(migration, /comparison_request_id bigint references comparison_requests\(id\)/);
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
    assert.match(service, /catch \{\s*status = "unavailable";\s*row\.reportFinalAt = null;\s*\}/);
    assert.match(service, /reportStatus === "required_not_final"/);
    assert.match(service, /row\.reportStatus !== "final"/);
  });

  it("adds authenticated no-credential SonicDICOM study redirect for Reporting Board cases", () => {
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const sonic = readFileSync(`${root}/src/services/sonicdicom-report-service.ts`, "utf8");

    assert.match(routes, /"\/cases\/:appointmentId\/open-sonicdicom"/);
    assert.match(routes, /asOptionalString\(req\.query\.scope\)/);
    assert.match(routes, /res\.redirect\(302, result\.redirectUrl\)/);
    assert.match(service, /getReportingBoardSonicDicomStudyRedirect/);
    assert.match(service, /reporting_board_sonicdicom_study_opened/);
    assert.match(service, /assignedDoctorId: me\.profile!\.id/);
    assert.match(service, /Accession number is required to open the SonicDICOM study/);
    assert.match(service, /DICOM Patient ID is required to open the patient list in SonicDICOM/);
    assert.match(service, /patientDicomId/);
    assert.match(sonic, /buildSonicDicomStaffViewerUrl/);
    assert.match(sonic, /target: "studyViewer" \| "patientList"/);
    assert.match(sonic, /input\.target === "studyViewer" \? "viewer" : "list"/);
    assert.doesNotMatch(sonic, /sonicDicomStaffImageViewerUrlTemplate/);
  });

  it("selects Reporting Board patientDicomId from primary identifiers before legacy fields", () => {
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");
    const types = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-types.ts`, "utf8");

    assert.match(types, /patientDicomId: string \| null/);
    assert.match(repo, /select pi\.value[\s\S]*from patient_identifiers pi[\s\S]*pi\.is_primary = true[\s\S]*order by pi\.id asc[\s\S]*limit 1/);
    assert.match(repo, /coalesce\(\s*nullif\(trim\(primary_identifier\.value\), ''\),\s*nullif\(trim\(p\.identifier_value\), ''\),\s*nullif\(trim\(p\.national_id\), ''\)\s*\) as "patientDicomId"/);
    const patientDicomAlias = repo.indexOf('as "patientDicomId"');
    const patientDicomSelect = repo.slice(repo.lastIndexOf("coalesce(", patientDicomAlias), patientDicomAlias + 30);
    assert.doesNotMatch(patientDicomSelect, /p\.mrn/);
  });

  it("marks Reporting Board cases discontinued through the existing manual status path", () => {
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");

    assert.match(routes, /"\/cases\/:appointmentId\/discontinue"/);
    assert.match(routes, /markReportingBoardCaseDiscontinued/);
    assert.match(service, /requireRosterManager\(actor\)/);
    assert.match(service, /A reason is required to mark a study as discontinued/);
    assert.match(service, /row\.appointmentStatus !== "completed"/);
    assert.match(service, /updateBookingStatusManual\([\s\S]*"discontinued"/);
  });

  it("adds appointment-only RISpro manual final overrides without SonicDICOM writes", () => {
    const migration = readFileSync(`${root}/src/db/migrations/112_reporting_board_manual_final_overrides.sql`, "utf8");
    const types = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-types.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");

    assert.match(migration, /doctor_portal\.reporting_board_manual_final_overrides/);
    assert.match(migration, /appointment_id bigint not null references appointments_v2\.bookings\(id\) on delete cascade/);
    assert.match(migration, /where cleared_at is null/);
    assert.doesNotMatch(migration, /final_text|sonicdicom|pdf/i);

    assert.match(types, /reportStatusSource\?: "sonicdicom" \| "manual" \| "rispro" \| null/);
    assert.match(types, /manualFinalOverrideId\?: number \| null/);
    assert.match(repo, /markReportingBoardCaseManualFinal/);
    assert.match(repo, /clearReportingBoardCaseManualFinal/);
    assert.match(repo, /reporting_board_case_manual_final_marked/);
    assert.match(repo, /reporting_board_case_manual_final_cleared/);
    assert.match(repo, /source: "rispro_manual_final"/);
    assert.match(service, /requireRosterManager\(actor\)/);
    assert.match(service, /A reason is required to mark this case final in RISpro/);
    assert.match(service, /Only completed Reporting Board cases can be manually marked final/);
    assert.match(service, /exclusionReason: "manual_final"/);
    assert.match(service, /reportStatusSource: "manual"/);
    assert.match(service, /reportStatusSnapshot\.delete\(appointmentId\)/);
    assert.match(routes, /"\/cases\/:appointmentId\/mark-final"/);
    assert.match(routes, /"\/cases\/:appointmentId\/clear-manual-final"/);
    assert.doesNotMatch(service, /finalText|create.*PDF|SonicDICOM.*manual final/i);
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

  it("adds one-time scheduled Reporting Board bulk assignment jobs without a new assignment algorithm", () => {
    const migration = readFileSync(`${root}/src/db/migrations/106_reporting_board_scheduled_bulk_assignments.sql`, "utf8");
    const partialMigration = readFileSync(`${root}/src/db/migrations/107_reporting_board_bulk_assignment_partial_resume.sql`, "utf8");
    const undoMigration = readFileSync(`${root}/src/db/migrations/108_reporting_board_bulk_assignment_undo_status.sql`, "utf8");
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");
    const repo = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");
    const worker = readFileSync(`${root}/src/services/reporting-board-bulk-assignment-worker.ts`, "utf8");
    const frontend = readFileSync(`${root}/frontend/src/pages/doctor/doctor-reporting-board-page.tsx`, "utf8");

    assert.match(migration, /doctor_portal\.reporting_board_bulk_assignment_jobs/);
    assert.match(migration, /scheduled_for timestamptz not null/);
    assert.match(migration, /locked_at timestamptz/);
    assert.match(migration, /locked_by text/);
    assert.match(migration, /partial/);
    assert.match(partialMigration, /resumed_from_job_id/);
    assert.match(partialMigration, /status = 'partial'/);
    assert.match(undoMigration, /undone/);
    assert.match(undoMigration, /partially_undone/);
    assert.doesNotMatch(migration, /recurr/i);
    assert.match(routes, /"\/bulk-assignment-jobs\/batch"/);
    assert.match(routes, /"\/bulk-assignment-jobs\/:id\/run-now"/);
    assert.match(routes, /"\/bulk-assignment-jobs\/:id\/cancel"/);
    assert.match(routes, /"\/bulk-assignment-jobs\/:id\/resume"/);
    assert.match(routes, /"\/bulk-assignment-jobs\/:id\/undo"/);
    assert.match(service, /caseSource: "appointments"/);
    assert.match(service, /assignmentStatus: "unassigned"/);
    assert.match(service, /bulkAssignNextReportingBoardCases\(/);
    assert.match(service, /unassignedOnly: true/);
    assert.match(service, /creatorUserActive/);
    assert.match(service, /parent\.status !== "partial"/);
    assert.match(service, /remainingCount/);
    assert.match(service, /undoScheduledReportingBoardBulkAssignmentJob/);
    assert.match(service, /job\.status !== "completed" && job\.status !== "partial"/);
    assert.match(service, /job\.result\?\.assignedAppointmentIds/);
    assert.match(repo, /input\.result\.assignedCount >= input\.result\.requestedCount \? "completed" : "partial"/);
    assert.match(repo, /undoReportingBoardBulkAssignmentJobAssignments/);
    assert.match(repo, /assignment\.assignedDoctorId !== input\.targetDoctorId/);
    assert.match(repo, /assignment_changed_after_job/);
    assert.match(repo, /reporting_board_bulk_assignment_job_case_undone/);
    assert.match(repo, /reporting_board_bulk_assignment_job_undo_completed/);
    assert.match(repo, /jsonb_build_object\('undo'/);
    assert.match(repo, /status in \('scheduled', 'failed'\)/);
    assert.match(repo, /where status = 'scheduled'[\s\S]*scheduled_for <= now\(\)/);
    assert.match(repo, /for update skip locked/);
    assert.match(worker, /runDueScheduledReportingBoardBulkAssignmentJobs/);
    assert.match(frontend, /DEFAULT_SCHEDULE_TIME = "07:30"/);
    assert.match(frontend, /TRIPOLI_TIME_ZONE = "Africa\/Tripoli"/);
    assert.match(frontend, /Scheduled date/);
    assert.match(frontend, /Scheduled time/);
    assert.match(frontend, /Assignment plan/);
    assert.match(frontend, /Add Sun-Thu template/);
    assert.match(frontend, /Add row/);
    assert.match(frontend, /Duplicate/);
    assert.match(frontend, /Delete/);
    assert.match(frontend, /\[0, 1, 2, 3, 4\]/);
    assert.match(frontend, /Continue remaining/);
    assert.match(frontend, /Undo assigned cases/);
    assert.match(frontend, /Cases changed after the job ran will be skipped/);
    assert.match(frontend, /attemptsByRoot/);
    assert.match(frontend, /resumedFromJobId/);
    assert.match(frontend, /<ScheduledJobsPanelCompact/);
    assert.match(frontend, /chainSummaryForRoot/);
    assert.match(frontend, /Fulfilled after resume/);
    assert.match(frontend, /visibleAttempts = allAttemptsOpen \? chain\.attempts : chain\.attempts\.slice\(0, 3\)/);
    assert.match(frontend, /Show all attempts/);
    assert.match(frontend, /const \[expanded, setExpanded\] = useState\(false\)/);
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
    assert.match(publicRoutes, /test-push/);
    assert.match(service, /findActiveSavedViewByToken\(token\)/);
    assert.match(service, /narrowSavedViewFilters/);
    assert.match(service, /savedViewFilters\[key\]/);
    assert.match(service, /insertDoctorAuditEvent/);
    assert.match(service, /assignReportingBoardCaseToDoctor/);
    assert.match(service, /subscribePublicReportingBoardMobilePush/);
    assert.match(service, /subscription: BrowserPushSubscriptionInput/);
    assert.match(publicPushMigration, /alter column user_id drop not null/);
    assert.match(service, /\/mobile\/reporting-view\/\$\{view\.token\}/);
    assert.match(repo, /lower\(coalesce\(p\.english_full_name/);
    assert.match(repo, /lower\('V2-' \|\| lpad\(b\.id::text, 6, '0'\)\)/);
  });

  it("adds token lifecycle, authoritative mobile pagination, and explicit public access state", () => {
    const migration = readFileSync(`${root}/src/db/migrations/116_reporting_board_saved_view_lifecycle.sql`, "utf8");
    const repository = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-repository.ts`, "utf8");
    const service = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-service.ts`, "utf8");
    const routes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-routes.ts`, "utf8");
    const publicRoutes = readFileSync(`${root}/src/modules/doctor-portal/reporting-board-public-routes.ts`, "utf8");

    assert.match(migration, /last_accessed_at timestamptz/);
    assert.match(migration, /expires_at timestamptz/);
    assert.match(migration, /revoked_at timestamptz/);
    assert.match(repository, /randomBytes\(32\)\.toString\("base64url"\)/);
    assert.match(repository, /revoked_at is null/);
    assert.match(repository, /expires_at is null or expires_at > now\(\)/);
    assert.match(repository, /touchSavedViewLastAccessed/);
    assert.match(routes, /"\/saved-views\/:id\/rotate-token"/);
    assert.match(routes, /"\/saved-views\/:id\/revoke"/);
    assert.match(publicRoutes, /optionalAuth/);
    assert.match(publicRoutes, /offset: optionalNonNegativeInteger/);
    assert.match(service, /totalCount: allCases\.length/);
    assert.match(service, /hasMore:/);
    assert.match(service, /batchReassign: false/);
    assert.match(service, /accessLevel/);
    assert.match(service, /canAssignToMe/);
    assert.match(service, /completedToAssignedMinutes/);
    assert.match(repository, /and active = true and revoked_at is null/);
    assert.match(repository, /subscription_hash = \$2 and enabled = true/);
  });

  it("attaches SonicDICOM study notes to appointment rows only", async () => {
    const service = await import("./reporting-board-service.js");
    const rows = [
      reportingBoardRow({ appointmentId: 11, accessionNumber: "ACC-11", caseKey: "appointment:11" }),
      reportingBoardRow({ appointmentId: 12, accessionNumber: "ACC-12", caseKey: "appointment:12" }),
      reportingBoardRow({ caseType: "comparison", caseKey: "comparison:9", appointmentId: 0, comparisonRequestId: 9, accessionNumber: "ACC-CMP" }),
    ];

    service.__setReportingBoardStudyNoteFetcherForTest(async (contexts) => {
      assert.deepEqual(contexts.map((context) => context.accessionNumber), ["ACC-11", "ACC-12"]);
      return new Map([
        [11, { note: "mwa prior study note", checkedAt: "2026-07-04T08:00:00.000Z", source: "sonicdicom" }],
        [12, { note: "   ", checkedAt: "2026-07-04T08:00:00.000Z", source: "sonicdicom" }],
      ]);
    });

    try {
      const resolved = await service.__attachSonicDicomStudyNotesForTest(rows);

      assert.equal(resolved[0].sonicDicomStudyNote, "mwa prior study note");
      assert.equal(resolved[0].sonicDicomStudyNoteCheckedAt, "2026-07-04T08:00:00.000Z");
      assert.equal(resolved[0].sonicDicomStudyNoteSource, "sonicdicom");
      assert.equal(resolved[1].sonicDicomStudyNote, null);
      assert.equal(resolved[1].sonicDicomStudyNoteSource, null);
      assert.equal(resolved[2].sonicDicomStudyNote, null);
      assert.equal(resolved[2].sonicDicomStudyNoteCheckedAt, null);
    } finally {
      service.__setReportingBoardStudyNoteFetcherForTest(null);
    }
  });

  it("keeps reporting board rows when SonicDICOM study-note lookup fails", async () => {
    const service = await import("./reporting-board-service.js");
    service.__setReportingBoardStudyNoteFetcherForTest(async () => {
      throw new Error("SQL Server unavailable");
    });

    try {
      const [resolved] = await service.__attachSonicDicomStudyNotesForTest([
        reportingBoardRow({ appointmentId: 21, accessionNumber: "ACC-21", caseKey: "appointment:21" }),
      ]);

      assert.equal(resolved.sonicDicomStudyNote, null);
      assert.equal(resolved.sonicDicomStudyNoteCheckedAt, null);
      assert.equal(resolved.sonicDicomStudyNoteSource, null);
    } finally {
      service.__setReportingBoardStudyNoteFetcherForTest(null);
    }
  });
});

function reportingBoardRow(overrides: Partial<import("./reporting-board-types.js").ReportingBoardCaseRow> = {}): import("./reporting-board-types.js").ReportingBoardCaseRow {
  return {
    caseType: "appointment",
    caseKey: "appointment:1",
    appointmentId: 1,
    comparisonRequestId: null,
    patientId: 1,
    patientMrn: "MRN-1",
    patientDicomId: null,
    patientEnglishName: "Patient One",
    patientArabicName: null,
    accessionNumber: "ACC-1",
    studyInstanceUid: "1.2.3",
    bookingDate: "2026-07-04",
    bookingTime: "09:00",
    modalityId: 1,
    modalityCode: "CT",
    modalityName: "CT",
    examTypeId: 1,
    examTypeName: "CT Brain",
    linkedPreviousBookingId: null,
    linkedPreviousStudyDate: null,
    linkedPreviousAccessionNumber: null,
    caseCategory: "oncology",
    appointmentStatus: "completed",
    requiresReport: true,
    reportingPriorityId: null,
    reportingPriorityCode: null,
    reportingPriorityName: null,
    reportingPrioritySortOrder: null,
    assignedDoctorId: null,
    assignedDoctorName: null,
    assignmentStatus: "unassigned",
    completedAt: "2026-07-04T08:30:00.000Z",
    currentAssignedAt: null,
    firstAssignedAt: null,
    reportFinalAt: null,
    reportStatusCheckedAt: null,
    reportStatusSource: null,
    manualFinalOverrideId: null,
    manualFinalAt: null,
    manualFinalByName: null,
    manualFinalReason: null,
    dueAt: null,
    completedToAssignedMinutes: null,
    assignedToFinalMinutes: null,
    completedToFinalMinutes: null,
    currentAssignmentAgeMinutes: null,
    completedUnassignedAgeMinutes: null,
    reportStatus: "unavailable",
    canAssign: true,
    exclusionReason: null,
    sonicDicomStudyNote: null,
    sonicDicomStudyNoteCheckedAt: null,
    sonicDicomStudyNoteSource: null,
    ...overrides,
  };
}
