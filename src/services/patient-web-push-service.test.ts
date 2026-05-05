import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("src/db/migrations/057_patient_web_push_notifications.sql", "utf8");
const staffMessageMigration = readFileSync("src/db/migrations/059_patient_web_push_staff_message.sql", "utf8");
const pushService = readFileSync("src/services/patient-web-push-service.ts", "utf8");
const worker = readFileSync("src/services/patient-notification-worker.ts", "utf8");
const cancelService = readFileSync("src/modules/appointments-v2/booking/services/cancel-booking.service.ts", "utf8");
const rescheduleService = readFileSync("src/modules/appointments-v2/booking/services/reschedule-booking.service.ts", "utf8");
const appointmentsRoutes = readFileSync("src/modules/appointments-v2/api/routes/appointments-v2-routes.ts", "utf8");
const readRoutes = readFileSync("src/modules/appointments-v2/api/routes/read-v2-routes.ts", "utf8");
const registrationsPage = readFileSync("frontend/src/pages/registrations/registrations-page.tsx", "utf8");

test("patient web push schema uses corrected subscription and delivery model", () => {
  assert.match(migration, /create table if not exists patient_web_push_subscriptions/);
  assert.match(migration, /create table if not exists patient_web_push_booking_subscriptions/);
  assert.match(migration, /create table if not exists patient_notification_events/);
  assert.match(migration, /create table if not exists patient_notification_deliveries/);
  assert.match(migration, /unique \(subscription_hash\)/);
  assert.match(migration, /unique \(subscription_id, booking_id\)/);
  assert.match(migration, /unique \(event_id, subscription_id\)/);
});

test("event and delivery statuses are explicit", () => {
  for (const status of ["pending", "processing", "sent", "failed", "skipped"]) {
    assert.match(migration, new RegExp(`'${status}'`));
    assert.match(pushService, new RegExp(`"${status}"`));
  }
});

test("push payload is generic and click URL uses a freshly minted token", () => {
  const sanitizeBody = pushService.slice(pushService.indexOf("export function sanitizePushPayload"), pushService.indexOf("async function createDeliveriesForEvent"));
  assert.match(pushService, /issuePublicCancelToken\(bookingId\)/);
  assert.match(pushService, /buildPublicAppointmentUrlFromSettings\(token, settings\)/);
  assert.match(sanitizeBody, /eventType: input\.eventType/);
  assert.match(sanitizeBody, /title: String\(input\.title/);
  assert.match(sanitizeBody, /body: String\(input\.body/);
  assert.match(sanitizeBody, /clickUrl: input\.clickUrl/);
  assert.doesNotMatch(sanitizeBody, /patientDisplayName|patientName|accessionNumber|modalityName|examName|diagnosis|oncology|reportText/);
});

test("public push config self-heals VAPID settings when the QR card is enabled", () => {
  const configBody = pushService.slice(pushService.indexOf("export async function getPatientWebPushPublicConfig"), pushService.indexOf("function templateForEvent"));
  assert.match(configBody, /settings\.webPushEnabled && !config\.enabled/);
  assert.match(configBody, /ensurePatientWebPushConfig\(\{ settings \}\)/);
  assert.match(configBody, /vapidPublicKey: enabled \? config\.publicKey : ""/);
});

test("reminder and report-ready workers enforce scheduling and final status rules", () => {
  assert.match(worker, /make_interval\(hours => \$1\)/);
  assert.match(worker, /scheduled_for/);
  assert.match(worker, /WEB_PUSH_REPORT_READY_MAX_CHECKS_PER_RUN|webPushReportReadyMaxChecksPerRun/);
  assert.match(worker, /WEB_PUSH_REPORT_READY_LOOKBACK_DAYS|webPushReportReadyLookbackDays/);
  assert.match(worker, /WEB_PUSH_REPORT_READY_SCAN_INTERVAL_SECONDS|webPushReportReadyScanIntervalSeconds/);
  assert.match(worker, /status\.state !== "final"/);
});

test("booking workflows enqueue notifications without blocking workflow completion", () => {
  assert.match(cancelService, /void safeEnqueuePatientNotificationEvent\(\{ bookingId, eventType: "appointment_cancelled" \}\)/);
  assert.match(rescheduleService, /eventType: "appointment_rescheduled"/);
  assert.match(rescheduleService, /eventType: "appointment_changed"/);
  assert.match(rescheduleService, /if \(result\.dateTimeChanged\)/);
  assert.match(rescheduleService, /else if \(result\.patientVisibleDetailsChanged\)/);
});

test("staff can send generic patient web push messages only when subscribed", () => {
  assert.match(staffMessageMigration, /'staff_message'/);
  assert.match(pushService, /"staff_message"/);
  assert.match(pushService, /hasActivePatientWebPushSubscription/);
  assert.match(pushService, /patient_web_push_not_subscribed/);
  assert.match(pushService, /eventType: "staff_message"/);
  assert.match(appointmentsRoutes, /\/:id\/patient-notification/);
  assert.match(appointmentsRoutes, /prepareDueNotificationDeliveries\(10\)/);
  assert.match(appointmentsRoutes, /processPatientPushDeliveries\(10\)/);
});

test("registrations expose subscription badge and staff notification action", () => {
  assert.match(readRoutes, /patient_web_push_subscription_count/);
  assert.match(registrationsPage, /patientWebPushSubscribed/);
  assert.match(registrationsPage, /webPushBadge/);
  assert.match(registrationsPage, /sendPatientWebPushNotification/);
  assert.match(registrationsPage, /webPushPrivacyHint/);
});
