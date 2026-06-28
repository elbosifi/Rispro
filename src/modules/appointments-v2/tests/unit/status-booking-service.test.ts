import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(
  new URL("../../booking/services/status-booking.service.ts", import.meta.url),
  "utf8"
);
const readV2RoutesSource = readFileSync(
  new URL("../../api/routes/read-v2-routes.ts", import.meta.url),
  "utf8"
);
const cancelBookingSource = readFileSync(
  new URL("../../booking/services/cancel-booking.service.ts", import.meta.url),
  "utf8"
);
const appointmentsV2RoutesSource = readFileSync(
  new URL("../../api/routes/appointments-v2-routes.ts", import.meta.url),
  "utf8"
);
const workflowTimestampMigration = readFileSync(
  new URL("../../../../db/migrations/098_v2_booking_workflow_timestamps.sql", import.meta.url),
  "utf8"
);

describe("status booking service source guards", () => {
  it("allows manual status targets but rejects voided", () => {
    assert.match(source, /MANUAL_STATUS_TARGETS/);
    assert.match(source, /"completed"/);
    assert.match(source, /"no-show"/);
    assert.match(source, /targetStatus === "voided"/);
  });

  it("requires reasons for no-show and discontinued manual status changes", () => {
    assert.match(source, /REASON_REQUIRED_STATUSES/);
    assert.match(source, /"no-show"/);
    assert.match(source, /"discontinued"/);
    assert.match(source, /status_reason_required/);
  });

  it("rejects cancellation through the generic manual status path", () => {
    assert.match(source, /targetStatus === "cancelled"/);
    assert.match(source, /Appointment cancellation must use the dedicated cancellation workflow\./);
    assert.match(source, /appointment_cancel_dedicated_workflow_required/);
    assert.match(source, /SchedulingError\(403/);
  });

  it("keeps cancellation notifications on the dedicated cancellation workflow", () => {
    assert.doesNotMatch(source, /safeEnqueuePatientNotificationEvent[\s\S]*appointment_cancelled/);
    assert.match(cancelBookingSource, /safeEnqueuePatientNotificationEvent\(\{ bookingId, eventType: "appointment_cancelled" \}\)/);
    assert.match(appointmentsV2RoutesSource, /"\/:id\/cancel"[\s\S]*requireActionPin\("appointment_cancel"\)[\s\S]*cancelBooking\(bookingId, userId\)/);
  });

  it("requires a reason when reopening completed bookings as arrived", () => {
    assert.match(source, /booking\.status === "completed" && targetStatus === "arrived" && !cleanReason/);
    assert.match(source, /completed_reopen_reason_required/);
  });

  it("auto no-show only updates scheduled bookings", () => {
    assert.match(source, /status = 'scheduled'/);
    assert.doesNotMatch(source, /status in \('scheduled', 'arrived', 'waiting'\)/);
  });

  it("auto no-show is controlled by an explicit auto setting", () => {
    assert.match(source, /auto_no_show_enabled/);
    assert.match(source, /autoNoShowEnabled/);
    assert.match(source, /!settings\.autoNoShowEnabled/);
  });

  it("bulk cleanup only targets older scheduled bookings", () => {
    assert.match(source, /booking_date < \(\$1::date - \(\$2::int \* interval '1 day'\)\)/);
    assert.match(source, /old_no_show_bulk_confirm/);
  });

  it("bulk cleanup is capped to the reviewed candidate batch", () => {
    assert.match(source, /with candidates as/);
    assert.match(source, /limit 200/);
  });

  it("syncs worklists after status changes", () => {
    assert.match(source, /scheduleBookingWorklistSync\(bookingId\)/);
    assert.match(source, /for \(const bookingId of markedIds\)/);
  });

  it("V2 manual status update cannot set arrived, waiting, or completed without patient queue requirements", () => {
    assert.match(source, /assertPatientMeetsBookingQueueRequirements/);
    assert.match(source, /patient_id,[\s\S]*status,[\s\S]*booking_date::text/);
    assert.match(source, /targetStatus === "arrived" \|\| targetStatus === "waiting" \|\| targetStatus === "completed"/);
    assert.match(source, /assertPatientMeetsBookingQueueRequirements\(client, Number\(booking\.patient_id\), userRole\)/);
  });

  it("cleans active queue bookings that no longer satisfy required patient fields", () => {
    assert.match(source, /cleanupActiveQueuePatientRequirementViolations/);
    assert.match(source, /setting_key in \('phone1_required', 'national_id_required'\)/);
    assert.match(source, /b\.status in \('arrived', 'waiting'\)/);
    assert.match(source, /set status = 'scheduled'/);
    assert.match(source, /active_queue_patient_requirements_cleanup/);
    assert.match(source, /scheduleBookingWorklistSync\(bookingId\)/);
  });

  it("manual reversal of Orthanc auto-completed bookings disables future auto-completion", () => {
    assert.match(source, /auto_completed_by/);
    assert.match(source, /booking\.status === "completed"[\s\S]*targetStatus !== "completed"[\s\S]*orthanc_pacs_auto_completion/);
    assert.match(source, /pacs_auto_completion_disabled_at = case when \$4 then now\(\)/);
    assert.match(source, /orthanc_auto_completion_disabled/);
    assert.match(source, /autoCompletionDisabledMessage/);
  });

  it("manual status changes still audit through the existing status path", () => {
    assert.match(source, /await auditStatusChange\(client, booking, targetStatus, cleanReason \|\| null, userId, "manual_status_change"\)/);
    assert.match(source, /await client\.query\("commit"\)/);
  });

  it("manual status completion activates pending reporting intents inside the transaction", () => {
    assert.match(source, /activatePendingReportingAssignmentIntent/);
    assert.match(source, /targetStatus === "completed"[\s\S]*activatePendingReportingAssignmentIntent/);
    assert.match(source, /await client\.query\("commit"\)[\s\S]*createAssignedToMeNotifications/);
    assert.match(source, /reporting_assignment_intent_notification_failed/);
  });

  it("manual terminal invalidation cancels pending reporting intents", () => {
    assert.match(source, /cancelPendingReportingAssignmentIntent/);
    assert.match(source, /targetStatus === "discontinued"[\s\S]*cancelPendingReportingAssignmentIntent/);
  });

  it("cancel and void workflows cancel pending reporting intents", () => {
    assert.match(cancelBookingSource, /cancelPendingReportingAssignmentIntent/);
    assert.match(cancelBookingSource, /status", "cancelled"/);
    assert.match(appointmentsV2RoutesSource, /voidBookingByStaff/);
    const voidBookingSource = readFileSync(
      new URL("../../booking/services/void-booking.service.ts", import.meta.url),
      "utf8"
    );
    assert.match(voidBookingSource, /cancelPendingReportingAssignmentIntent/);
    assert.match(voidBookingSource, /status", "voided"/);
  });

  it("V2 modality worklist prefers durable workflow timestamps with audit fallback", () => {
    assert.match(readV2RoutesSource, /left join lateral \(/);
    assert.match(readV2RoutesSource, /coalesce\(b\.arrived_at, status_times\.arrived_at\) as arrived_at/);
    assert.match(readV2RoutesSource, /b\.waiting_started_at/);
    assert.match(readV2RoutesSource, /coalesce\(b\.completed_at, status_times\.completed_at\) as completed_at/);
    assert.match(readV2RoutesSource, /min\(audit_log\.created_at\) filter \(where audit_log\.new_values->>'status' = 'arrived'\)/);
    assert.match(readV2RoutesSource, /min\(audit_log\.created_at\) filter \(where audit_log\.new_values->>'status' = 'waiting'\)/);
    assert.match(readV2RoutesSource, /max\(audit_log\.created_at\) filter \(where audit_log\.new_values->>'status' = 'completed'\)/);
    assert.doesNotMatch(readV2RoutesSource, /as arrived_at,[\s\S]{0,80}b\.updated_at/);
  });

  it("manual status changes persist durable workflow timestamps without clearing history", () => {
    assert.match(source, /arrived_at = case[\s\S]*when \$2 in \('arrived', 'waiting'\) then coalesce\(arrived_at, now\(\)\)/);
    assert.match(source, /waiting_started_at = case[\s\S]*when \$2 = 'waiting' then coalesce\(waiting_started_at, now\(\)\)/);
    assert.match(source, /completed_at = case[\s\S]*when \$2 = 'completed' then coalesce\(completed_at, now\(\)\)/);
    assert.doesNotMatch(source, /set[\s\S]{0,500}arrived_at = null/);
    assert.doesNotMatch(source, /set[\s\S]{0,500}completed_at = null/);
  });

  it("same-day queue scan stores arrived_at for updated bookings", () => {
    assert.match(source, /set status = 'arrived', arrived_at = coalesce\(arrived_at, now\(\)\), updated_at = now\(\), updated_by_user_id = \$2/);
  });

  it("migration adds and backfills V2 booking workflow timestamps", () => {
    assert.match(workflowTimestampMigration, /add column if not exists arrived_at timestamptz/);
    assert.match(workflowTimestampMigration, /add column if not exists waiting_started_at timestamptz/);
    assert.match(workflowTimestampMigration, /add column if not exists completed_at timestamptz/);
    assert.match(workflowTimestampMigration, /new_values->>'status' in \('arrived', 'waiting'\)/);
    assert.match(workflowTimestampMigration, /new_values->>'status' = 'completed'/);
    assert.match(workflowTimestampMigration, /min\(audit_log\.created_at\) as arrived_at/);
    assert.match(workflowTimestampMigration, /min\(audit_log\.created_at\) as completed_at/);
    assert.match(workflowTimestampMigration, /first completed audit event/);
    assert.match(workflowTimestampMigration, /completed_at is null/);
    assert.doesNotMatch(workflowTimestampMigration, /set arrived_at = b\.updated_at/);
    assert.doesNotMatch(workflowTimestampMigration, /set completed_at = b\.updated_at/);
    assert.match(workflowTimestampMigration, /raise notice 'appointments_v2 booking workflow timestamps backfill: arrived_at from audit_log=%/);
    assert.match(workflowTimestampMigration, /raise notice 'appointments_v2 booking workflow timestamps still missing: arrived\/waiting without arrived_at=%/);
    assert.match(workflowTimestampMigration, /completed without completed_at=%/);
  });

  it("V2 read appointments and queue APIs expose workflow timestamps", () => {
    assert.match(readV2RoutesSource, /b\.arrived_at/);
    assert.match(readV2RoutesSource, /b\.waiting_started_at/);
    assert.match(readV2RoutesSource, /b\.completed_at/);
    assert.match(readV2RoutesSource, /case when b\.status in \('arrived', 'waiting'\) then b\.arrived_at else null end as scanned_at/);
  });

  it("V2 modality worklist includes operational and review statuses but excludes voided", () => {
    assert.match(readV2RoutesSource, /b\.status in \('scheduled', 'waiting', 'arrived', 'completed', 'no-show', 'cancelled', 'discontinued'\)/);
    assert.doesNotMatch(readV2RoutesSource, /modality\/worklist[\s\S]*b\.status in \([^)]*'voided'/);
  });

  it("V2 modality worklist derives same-day multiple appointment details", () => {
    assert.match(readV2RoutesSource, /"\/modality\/worklist"/);
    assert.match(readV2RoutesSource, /with worklist_rows as/);
    assert.match(readV2RoutesSource, /active_same_day as/);
    assert.match(readV2RoutesSource, /same_day_appointment_count/);
    assert.match(readV2RoutesSource, /has_multiple_appointments/);
    assert.match(readV2RoutesSource, /related_appointments/);
  });

  it("manual reversal does not disable future auto-completion for non-Orthanc completed bookings", () => {
    assert.match(source, /booking\.auto_completed_by === "orthanc_pacs_auto_completion"/);
    assert.match(source, /!booking\.pacs_auto_completion_disabled_at/);
  });

  it("manual status update to non-cancellation close statuses keeps existing behavior", () => {
    assert.match(source, /MANUAL_STATUS_TARGETS/);
    assert.match(source, /"no-show"/);
    assert.match(source, /"discontinued"/);
    assert.doesNotMatch(source, /targetStatus === "no-show"[\s\S]*assertPatientMeetsBookingQueueRequirements/);
    assert.doesNotMatch(source, /targetStatus === "discontinued"[\s\S]*assertPatientMeetsBookingQueueRequirements/);
  });

  it("V2 queue scan cannot set arrived without patient queue requirements", () => {
    assert.match(readV2RoutesSource, /"\/queue\/scan"/);
    assert.match(readV2RoutesSource, /arriveSameDayQueueBookings\(client, bookingId, getTripoliToday\(\), userId, user\?\.role\)/);
    assert.match(source, /assertPatientMeetsBookingQueueRequirements\(client, Number\(selected\.patient_id\), userRole\)/);
    assert.match(source, /where patient_id = \$1[\s\S]*and booking_date = \$2::date[\s\S]*order by id asc[\s\S]*for update/);
    assert.match(source, /set status = 'arrived'/);
  });

  it("V2 queue and modality worklist reads cleanup invalid active worklist entries first", () => {
    assert.match(readV2RoutesSource, /cleanupActiveQueuePatientRequirementViolations/);
    assert.match(readV2RoutesSource, /"\/queue"[\s\S]*cleanupActiveQueuePatientRequirementViolations\(/);
    assert.match(readV2RoutesSource, /patient_requirement_cleanup_count/);
    assert.match(readV2RoutesSource, /"\/modality\/worklist"[\s\S]*cleanupActiveQueuePatientRequirementViolations\(/);
  });
});
