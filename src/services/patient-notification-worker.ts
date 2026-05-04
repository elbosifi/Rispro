import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import {
  enqueuePatientNotificationEvent,
  getBookingNotificationContext,
  prepareDueNotificationDeliveries,
  processPatientPushDeliveries,
  validateWebPushStartupConfig,
} from "./patient-web-push-service.js";
import { checkSonicDicomReportStatus } from "./sonicdicom-report-service.js";
import { readPatientQrSettings } from "../modules/appointments-v2/public/utils/patient-qr-settings.js";

export interface PatientNotificationWorker {
  stop: () => Promise<void>;
}

let workerStopped = false;
let tickRunning = false;
let reportScanRunning = false;
let lastReportScanAt = 0;

function combineAppointmentTimestampSql(): string {
  return `
    (
      b.booking_date::timestamp
      + coalesce(b.booking_time, time '12:00')
    )
  `;
}

export async function enqueueDueAppointmentReminderEvents(limit = 100): Promise<{ enqueued: number }> {
  if (!env.webPushEnabled) return { enqueued: 0 };
  const settings = await readPatientQrSettings();
  if (!settings.webPushEnabled) return { enqueued: 0 };

  const appointmentAtSql = combineAppointmentTimestampSql();
  const { rows } = await pool.query<{
    booking_id: number;
    scheduled_for: Date;
    dedupe_key: string;
  }>(
    `
      select distinct
        b.id as booking_id,
        (${appointmentAtSql} - make_interval(hours => $1))::timestamptz as scheduled_for,
        concat(
          'appointment_reminder_24h:',
          b.id::text,
          ':',
          to_char(${appointmentAtSql}, 'YYYYMMDDHH24MI'),
          ':',
          $1::text
        ) as dedupe_key
      from appointments_v2.bookings b
      join patient_web_push_booking_subscriptions bs
        on bs.booking_id = b.id
       and bs.enabled = true
       and bs.appointment_reminder_24h = true
      join patient_web_push_subscriptions s
        on s.id = bs.subscription_id
       and s.enabled = true
      where b.status in ('scheduled', 'arrived', 'waiting')
        and (${appointmentAtSql} - make_interval(hours => $1)) <= now() + make_interval(secs => $2)
        and ${appointmentAtSql} > now()
        and not exists (
          select 1
          from patient_notification_events e
          where e.dedupe_key = concat(
            'appointment_reminder_24h:',
            b.id::text,
            ':',
            to_char(${appointmentAtSql}, 'YYYYMMDDHH24MI'),
            ':',
            $1::text
          )
        )
      order by scheduled_for asc
      limit $3
    `,
    [env.webPushReminderHours, env.webPushWorkerIntervalSeconds * 2, limit]
  );

  let enqueued = 0;
  for (const row of rows) {
    const result = await enqueuePatientNotificationEvent({
      bookingId: Number(row.booking_id),
      eventType: "appointment_reminder_24h",
      scheduledFor: row.scheduled_for,
      dedupeKey: row.dedupe_key,
    });
    if (result.created) enqueued += 1;
  }
  return { enqueued };
}

export async function enqueueReadyReportEvents(options: { limit?: number } = {}): Promise<{ checked: number; enqueued: number }> {
  if (!env.webPushEnabled) return { checked: 0, enqueued: 0 };
  const settings = await readPatientQrSettings();
  if (!settings.webPushEnabled || !settings.allowReportAccess) return { checked: 0, enqueued: 0 };

  const limit = Math.max(1, Math.min(options.limit ?? env.webPushReportReadyMaxChecksPerRun, env.webPushReportReadyMaxChecksPerRun));
  const { rows } = await pool.query<{ booking_id: number }>(
    `
      select distinct b.id as booking_id
      from appointments_v2.bookings b
      join patient_web_push_booking_subscriptions bs
        on bs.booking_id = b.id
       and bs.enabled = true
       and bs.report_ready = true
      join patient_web_push_subscriptions s
        on s.id = bs.subscription_id
       and s.enabled = true
      where b.status = 'completed'
        and b.requires_report = true
        and b.booking_date >= (current_date - $1::int)
        and not exists (
          select 1
          from patient_notification_events e
          where e.dedupe_key = concat('report_ready:', b.id::text)
        )
      order by b.booking_date desc, b.id desc
      limit $2
    `,
    [env.webPushReportReadyLookbackDays, limit]
  );

  let enqueued = 0;
  for (const row of rows) {
    const context = await getBookingNotificationContext(Number(row.booking_id));
    if (!context || !context.requiresReport || context.status !== "completed") continue;
    const status = await checkSonicDicomReportStatus(
      {
        bookingId: context.bookingId,
        accessionNumber: context.accessionNumber,
        studyInstanceUid: context.studyInstanceUid,
        requiresReport: context.requiresReport,
        status: context.status,
      },
      { useCache: false }
    );
    if (status.state !== "final") continue;
    const result = await enqueuePatientNotificationEvent({
      bookingId: context.bookingId,
      eventType: "report_ready",
      dedupeKey: `report_ready:${context.bookingId}`,
    });
    if (result.created) enqueued += 1;
  }

  return { checked: rows.length, enqueued };
}

export async function runPatientNotificationWorkerTick(): Promise<{
  remindersEnqueued: number;
  reportReadyChecked: number;
  reportReadyEnqueued: number;
  deliveriesPrepared: number;
  deliveriesAttempted: number;
  deliveriesSent: number;
  deliveriesFailed: number;
}> {
  if (tickRunning || workerStopped || !env.webPushEnabled) {
    return {
      remindersEnqueued: 0,
      reportReadyChecked: 0,
      reportReadyEnqueued: 0,
      deliveriesPrepared: 0,
      deliveriesAttempted: 0,
      deliveriesSent: 0,
      deliveriesFailed: 0,
    };
  }

  tickRunning = true;
  try {
    const reminders = await enqueueDueAppointmentReminderEvents().catch((error) => {
      console.warn(JSON.stringify({ type: "patient_notification_reminder_scan_failed", error: error instanceof Error ? error.message : String(error) }));
      return { enqueued: 0 };
    });

    let reportReady = { checked: 0, enqueued: 0 };
    const now = Date.now();
    if (!reportScanRunning && now - lastReportScanAt >= env.webPushReportReadyScanIntervalSeconds * 1000) {
      reportScanRunning = true;
      lastReportScanAt = now;
      try {
        reportReady = await enqueueReadyReportEvents();
      } catch (error) {
        console.warn(JSON.stringify({ type: "patient_notification_report_ready_scan_failed", error: error instanceof Error ? error.message : String(error) }));
      } finally {
        reportScanRunning = false;
      }
    }

    const prepared = await prepareDueNotificationDeliveries().catch((error) => {
      console.warn(JSON.stringify({ type: "patient_notification_delivery_prepare_failed", error: error instanceof Error ? error.message : String(error) }));
      return { events: 0, deliveries: 0 };
    });
    const delivered = await processPatientPushDeliveries().catch((error) => {
      console.warn(JSON.stringify({ type: "patient_notification_delivery_tick_failed", error: error instanceof Error ? error.message : String(error) }));
      return { attempted: 0, sent: 0, failed: 0 };
    });

    return {
      remindersEnqueued: reminders.enqueued,
      reportReadyChecked: reportReady.checked,
      reportReadyEnqueued: reportReady.enqueued,
      deliveriesPrepared: prepared.deliveries,
      deliveriesAttempted: delivered.attempted,
      deliveriesSent: delivered.sent,
      deliveriesFailed: delivered.failed,
    };
  } finally {
    tickRunning = false;
  }
}

export async function startPatientNotificationWorker(options?: {
  intervalMs?: number;
}): Promise<PatientNotificationWorker> {
  workerStopped = false;
  if (!env.webPushEnabled) {
    return { stop: async () => { workerStopped = true; } };
  }

  validateWebPushStartupConfig();
  const intervalMs = Math.max(10_000, options?.intervalMs ?? env.webPushWorkerIntervalSeconds * 1000);
  await runPatientNotificationWorkerTick();
  const timer = setInterval(() => {
    void runPatientNotificationWorkerTick();
  }, intervalMs);
  timer.unref();

  return {
    stop: async () => {
      workerStopped = true;
      clearInterval(timer);
    },
  };
}
