import { Router, Request, Response } from "express";
import { pool } from "../../../../db/pool.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { HttpError } from "../../../../utils/http-error.js";
import { getBookingDetails } from "../../booking/services/get-booking-details.service.js";
import { cancelBooking } from "../../booking/services/cancel-booking.service.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { getPublicCancelServiceUserId } from "../../public/utils/public-cancel-config.js";
import { issuePublicCancelToken, verifyPublicCancelToken } from "../../public/utils/public-cancel-token.js";
import { buildPublicAppointmentUrlFromSettings } from "../../public/utils/public-appointment-url.js";
import { isModalityAllowed, readPatientQrSettings } from "../../public/utils/patient-qr-settings.js";
import { readAppointmentSlipSettings } from "../../public/utils/appointment-slip-settings.js";
import { createRateLimiter } from "../../../../middleware/rate-limit.js";
import {
  buildSonicDicomImageBrowserUrl,
  buildSonicDicomReportBrowserUrl,
  checkSonicDicomReportStatus,
  checkSonicDicomStudyExists,
  messageForReportState,
  type SonicDicomReportState,
} from "../../../../services/sonicdicom-report-service.js";
import { readSonicDicomReportSettings } from "../../../../services/sonicdicom-report-settings.js";
import { logAuditEntry } from "../../../../services/audit-service.js";
import {
  enqueuePatientNotificationEvent,
  getBookingNotificationContext,
  getPatientWebPushPublicConfig,
  prepareDueNotificationDeliveries,
  processPatientPushDeliveries,
  unsubscribePatientPush,
  upsertPatientPushSubscription,
  type BrowserPushSubscriptionInput,
  type PatientPushPreferences,
} from "../../../../services/patient-web-push-service.js";

const router = Router();
let publicReportStatusChecker = checkSonicDicomReportStatus;
let publicStudyExistenceChecker = checkSonicDicomStudyExists;

export function __setPublicSonicDicomChecksForTest(overrides: {
  reportStatus?: typeof checkSonicDicomReportStatus;
  studyExists?: typeof checkSonicDicomStudyExists;
} | null): void {
  publicReportStatusChecker = overrides?.reportStatus ?? checkSonicDicomReportStatus;
  publicStudyExistenceChecker = overrides?.studyExists ?? checkSonicDicomStudyExists;
}
const reportRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: "Too many report access requests. Please try again later.",
});
const pushRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: "Too many notification requests. Please try again later.",
});

function readToken(req: Request): string {
  const tokenValue = req.query.t;
  const token = Array.isArray(tokenValue) ? tokenValue[0] : tokenValue;
  const parsedToken = String(token || "").trim();
  if (!parsedToken) {
    throw new HttpError(400, "Missing cancellation token.", { code: "missing_token" });
  }
  return parsedToken;
}

function makePatientDisplayName(input: { arabicName: string | null; englishName: string | null }): string {
  return input.arabicName || input.englishName || "Patient";
}

function formatTimeLabel(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{2}):(\d{2})/);
  if (match) {
    return `${match[1]}:${match[2]}`;
  }
  return raw;
}

type BookingDetails = Awaited<ReturnType<typeof getBookingDetails>>;

interface OtherPublicAppointmentRow {
  booking_id: number;
  appointment_date: string;
  booking_time: string | null;
  modality_name_ar: string | null;
  modality_name_en: string | null;
  exam_name_ar: string | null;
  exam_name_en: string | null;
  status: string;
}

interface OtherPublicAppointment {
  date: string;
  time: string;
  modality: string;
  examName: string;
  status: string;
  publicUrl: string;
  canCancel: boolean;
}

function isPublicCancellableStatus(status: string): boolean {
  return ["scheduled", "arrived", "waiting"].includes(status);
}

async function loadOtherPublicAppointments(
  booking: BookingDetails,
  patientQrSettings: Awaited<ReturnType<typeof readPatientQrSettings>>
) {
  const result = await pool.query<OtherPublicAppointmentRow>(
    `
      select
        b.id as booking_id,
        b.booking_date::text as appointment_date,
        b.booking_time::text as booking_time,
        m.name_ar as modality_name_ar,
        m.name_en as modality_name_en,
        et.name_ar as exam_name_ar,
        et.name_en as exam_name_en,
        b.status
      from appointments_v2.bookings b
      left join modalities m on m.id = b.modality_id
      left join exam_types et on et.id = b.exam_type_id
      where b.patient_id = $1
        and b.id <> $2
        and b.status not in ('discontinued', 'voided')
      order by b.booking_date asc, b.booking_time asc nulls last, b.id asc
    `,
    [booking.patient_id, booking.id]
  );

  const appointments: OtherPublicAppointment[] = [];
  for (const row of result.rows) {
    const token = await issuePublicCancelToken(Number(row.booking_id));
    if (!token) continue;
    appointments.push({
      date: row.appointment_date,
      time: formatTimeLabel(row.booking_time),
      modality: row.modality_name_ar || row.modality_name_en || "—",
      examName: row.exam_name_ar || row.exam_name_en || "—",
      status: row.status,
      publicUrl: buildPublicAppointmentUrlFromSettings(token, patientQrSettings),
      canCancel: patientQrSettings.allowCancellation && isPublicCancellableStatus(row.status),
    });
  }
  return appointments;
}

function reportContextFromBooking(booking: BookingDetails) {
  return {
    bookingId: Number(booking.id),
    accessionNumber: String(booking.accession_number || ""),
    studyInstanceUid: booking.study_instance_uid ?? null,
    requiresReport: Boolean(booking.requires_report),
    status: String(booking.status || ""),
  };
}

function canAccessReportForBooking(
  patientQrSettings: Awaited<ReturnType<typeof readPatientQrSettings>>,
  booking: BookingDetails
): boolean {
  return isModalityAllowed(
    patientQrSettings.reportAccessModalityMode,
    patientQrSettings.reportAccessModalityIds,
    booking.modality_id
  );
}

function canAccessImageForBooking(
  patientQrSettings: Awaited<ReturnType<typeof readPatientQrSettings>>,
  booking: BookingDetails
): boolean {
  return isModalityAllowed(
    patientQrSettings.imageAccessModalityMode,
    patientQrSettings.imageAccessModalityIds,
    booking.modality_id
  );
}

function makeReportStatusResponse(
  state: SonicDicomReportState,
  patientQrSettings: Awaited<ReturnType<typeof readPatientQrSettings>>,
  canViewReport = false
) {
  return {
    enabled: patientQrSettings.allowReportAccess,
    state,
    canViewReport,
    message: messageForReportState(state, patientQrSettings),
    checkButtonLabel: patientQrSettings.qrReportCheckButtonLabel,
    viewButtonLabel: patientQrSettings.qrReportViewButtonLabel,
  };
}

function defaultPushPreferences(
  patientQrSettings: Awaited<ReturnType<typeof readPatientQrSettings>>
): PatientPushPreferences {
  return {
    appointmentReminder24h: patientQrSettings.webPushDefaultReminder24h,
    appointmentRescheduled: patientQrSettings.webPushDefaultRescheduled,
    appointmentCancelled: patientQrSettings.webPushDefaultCancelled,
    appointmentChanged: patientQrSettings.webPushDefaultChanged,
    reportReady: patientQrSettings.webPushDefaultReportReady,
    imageReady: patientQrSettings.webPushDefaultImageReady,
  };
}

function normalizePushPreferences(
  raw: unknown,
  patientQrSettings: Awaited<ReturnType<typeof readPatientQrSettings>>
): PatientPushPreferences {
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const defaults = defaultPushPreferences(patientQrSettings);
  const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
  return {
    appointmentReminder24h: bool(record.appointmentReminder24h, defaults.appointmentReminder24h),
    appointmentRescheduled: bool(record.appointmentRescheduled, defaults.appointmentRescheduled),
    appointmentCancelled: bool(record.appointmentCancelled, defaults.appointmentCancelled),
    appointmentChanged: bool(record.appointmentChanged, defaults.appointmentChanged),
    reportReady: bool(record.reportReady, defaults.reportReady),
    imageReady: bool(record.imageReady, defaults.imageReady),
  };
}

function readPushSubscription(body: unknown): BrowserPushSubscriptionInput {
  const record = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const subscription = record.subscription && typeof record.subscription === "object" && !Array.isArray(record.subscription)
    ? (record.subscription as BrowserPushSubscriptionInput)
    : (record as BrowserPushSubscriptionInput);
  return subscription;
}

async function readVerifiedPushContext(req: Request) {
  const token = readToken(req);
  const payload = await verifyPublicCancelToken(token);
  const patientQrSettings = await readPatientQrSettings();
  if (!patientQrSettings.enabled) throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
  const context = await getBookingNotificationContext(payload.bookingId);
  if (!context) throw new HttpError(404, "Appointment was not found.", { code: "booking_not_found" });
  return { payload, patientQrSettings, context };
}

router.get(
  "/cancel-preview",
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = await verifyPublicCancelToken(token);
    const patientQrSettings = await readPatientQrSettings();
    if (!patientQrSettings.enabled) {
      throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
    }

    const booking = await getBookingDetails(payload.bookingId);
    const otherAppointments = await loadOtherPublicAppointments(booking, patientQrSettings);

    res.json({
      preview: {
        bookingId: booking.id,
        patientDisplayName: makePatientDisplayName({
          arabicName: booking.arabic_full_name ?? null,
          englishName: booking.english_full_name ?? null,
        }),
        bookingDate: booking.appointment_date,
        bookingTime: formatTimeLabel(booking.booking_time),
        requiresReport: Boolean(booking.requires_report),
        reportFeature: {
          allowReportAccess: patientQrSettings.allowReportAccess,
          allowImageAccess: patientQrSettings.allowImageAccess,
          reportAccessAllowedForModality: canAccessReportForBooking(patientQrSettings, booking),
          imageAccessAllowedForModality: canAccessImageForBooking(patientQrSettings, booking),
          showReportPendingCard: patientQrSettings.showReportPendingCard,
          reportAccessRequiresCompletedAppointment: patientQrSettings.reportAccessRequiresCompletedAppointment,
          imageAccessRequiresCompletedAppointment: patientQrSettings.imageAccessRequiresCompletedAppointment,
          imageAccessRequiresReportRequiredFlag: patientQrSettings.imageAccessRequiresReportRequiredFlag,
          showReportNotRequiredMessage: patientQrSettings.showReportNotRequiredMessage,
          qrReportCheckingMessage: patientQrSettings.qrReportCheckingMessage,
          qrReportCheckButtonLabel: patientQrSettings.qrReportCheckButtonLabel,
          qrReportViewButtonLabel: patientQrSettings.qrReportViewButtonLabel,
          qrImageViewButtonLabel: patientQrSettings.qrImageViewButtonLabel,
          qrReportNotRequiredMessage: patientQrSettings.qrReportNotRequiredMessage,
          qrReportNotCompletedMessage: patientQrSettings.qrReportNotCompletedMessage,
          qrImageUnavailableMessage: patientQrSettings.qrImageUnavailableMessage,
          qrReportStudyNotFoundMessage: patientQrSettings.qrReportStudyNotFoundMessage,
          qrImageStudyNotFoundMessage: patientQrSettings.qrImageStudyNotFoundMessage,
        },
        modalityId: booking.modality_id,
        modalityNameAr: booking.modality_name_ar || "—",
        modalityNameEn: booking.modality_name_en || "—",
        examNameAr: booking.exam_name_ar || "—",
        examNameEn: booking.exam_name_en || "—",
        modalityInstructionAr: booking.modality_general_instruction_ar || "",
        modalityInstructionEn: booking.modality_general_instruction_en || "",
        examInstructionAr: booking.exam_specific_instruction_ar || "",
        examInstructionEn: booking.exam_specific_instruction_en || "",
        currentStatus: booking.status,
      },
      otherAppointments,
      settings: patientQrSettings,
    });
  })
);

router.get(
  "/slip",
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = await verifyPublicCancelToken(token);
    const patientQrSettings = await readPatientQrSettings();
    if (!patientQrSettings.enabled) {
      throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
    }

    const appointment = await getBookingDetails(payload.bookingId);
    if (["cancelled", "discontinued", "voided"].includes(String(appointment.status || ""))) {
      throw new HttpError(409, "Appointment slip is not available for this appointment.", { code: "slip_not_available" });
    }

    const slipSettings = await readAppointmentSlipSettings();
    res.json({
      appointment,
      slipSettings: {
        ...slipSettings,
        paperMode: patientQrSettings.qrSlipPaperMode,
        paperSize: patientQrSettings.qrSlipPaperSize,
      },
      patientQrSettings,
    });
  })
);

router.post(
  "/cancel",
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = await verifyPublicCancelToken(token);
    const serviceUserId = getPublicCancelServiceUserId();

    try {
      const result = await cancelBooking(payload.bookingId, serviceUserId);
      res.json({
        ok: true,
        alreadyCancelled: false,
        bookingId: result.booking.id,
        status: result.booking.status,
        previousStatus: result.previousStatus,
      });
    } catch (error) {
      if (
        error instanceof SchedulingError &&
        Array.isArray(error.reasonCodes) &&
        error.reasonCodes.includes("booking_already_cancelled")
      ) {
        res.json({
          ok: true,
          alreadyCancelled: true,
          bookingId: payload.bookingId,
          status: "cancelled",
        });
        return;
      }

      throw error;
    }
  })
);

router.get(
  "/push-config",
  pushRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const { patientQrSettings } = await readVerifiedPushContext(req);
    const publicConfig = await getPatientWebPushPublicConfig(patientQrSettings);
    res.json({
      ...publicConfig,
      labels: {
        cardTitleAr: patientQrSettings.webPushCardTitleAr,
        cardTitleEn: patientQrSettings.webPushCardTitleEn,
        cardBodyAr: patientQrSettings.webPushCardBodyAr,
        cardBodyEn: patientQrSettings.webPushCardBodyEn,
        subscribeButtonAr: patientQrSettings.webPushSubscribeButtonAr,
        subscribeButtonEn: patientQrSettings.webPushSubscribeButtonEn,
        unsubscribeButtonAr: patientQrSettings.webPushUnsubscribeButtonAr,
        unsubscribeButtonEn: patientQrSettings.webPushUnsubscribeButtonEn,
        testButtonAr: patientQrSettings.webPushTestButtonAr,
        testButtonEn: patientQrSettings.webPushTestButtonEn,
        unsupportedMessageAr: patientQrSettings.webPushUnsupportedMessageAr,
        unsupportedMessageEn: patientQrSettings.webPushUnsupportedMessageEn,
        iosHelpButtonAr: patientQrSettings.webPushIosHelpButtonAr,
        iosHelpButtonEn: patientQrSettings.webPushIosHelpButtonEn,
        iosHelpTitleAr: patientQrSettings.webPushIosHelpTitleAr,
        iosHelpTitleEn: patientQrSettings.webPushIosHelpTitleEn,
        iosHelpBodyAr: patientQrSettings.webPushIosHelpBodyAr,
        iosHelpBodyEn: patientQrSettings.webPushIosHelpBodyEn,
        deniedMessageAr: patientQrSettings.webPushDeniedMessageAr,
        deniedMessageEn: patientQrSettings.webPushDeniedMessageEn,
      },
    });
  })
);

router.post(
  "/push-subscribe",
  pushRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const { patientQrSettings, context } = await readVerifiedPushContext(req);
    const publicConfig = await getPatientWebPushPublicConfig(patientQrSettings);
    if (!publicConfig.enabled) throw new HttpError(503, "Web Push is disabled.", { code: "web_push_disabled" });

    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await upsertPatientPushSubscription({
      bookingId: context.bookingId,
      patientId: context.patientId,
      subscription: readPushSubscription(body),
      preferences: normalizePushPreferences(body.preferences, patientQrSettings),
      userAgent: req.get("user-agent") ?? null,
    });
    res.json({ ok: true, subscriptionId: result.subscriptionId, bookingSubscriptionId: result.bookingSubscriptionId });
  })
);

router.post(
  "/push-unsubscribe",
  pushRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const { context } = await readVerifiedPushContext(req);
    const result = await unsubscribePatientPush({
      bookingId: context.bookingId,
      subscription: readPushSubscription(req.body ?? {}),
    });
    res.json({ ok: true, disabled: result.disabled });
  })
);

router.post(
  "/push-test",
  pushRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const { patientQrSettings, context } = await readVerifiedPushContext(req);
    const publicConfig = await getPatientWebPushPublicConfig(patientQrSettings);
    if (!publicConfig.enabled) throw new HttpError(503, "Web Push is disabled.", { code: "web_push_disabled" });

    const event = await enqueuePatientNotificationEvent({
      bookingId: context.bookingId,
      eventType: "test",
      dedupeKey: `test:${context.bookingId}:${Date.now()}`,
    });
    await prepareDueNotificationDeliveries(10).catch(() => ({ events: 0, deliveries: 0 }));
    const delivery = await processPatientPushDeliveries(10).catch(() => ({ attempted: 0, sent: 0, failed: 0 }));
    res.json({ ok: true, eventId: event.eventId, attempted: delivery.attempted, sent: delivery.sent });
  })
);

router.get(
  "/report-status",
  reportRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    if (req.query.accessionNumber || req.query.accession || req.query.studyInstanceUid || req.query.studyinstanceuid) {
      throw new HttpError(400, "Public report lookup identifiers are not accepted.", { code: "public_identifier_rejected" });
    }

    const payload = await verifyPublicCancelToken(token);
    const patientQrSettings = await readPatientQrSettings();
    if (!patientQrSettings.enabled) throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
    if (!patientQrSettings.allowReportAccess) {
      res.json(makeReportStatusResponse("disabled", patientQrSettings, false));
      return;
    }

    const booking = await getBookingDetails(payload.bookingId);
    const reportModalityAllowed = canAccessReportForBooking(patientQrSettings, booking);
    if (!reportModalityAllowed) {
      res.json(makeReportStatusResponse("disabled", patientQrSettings, false));
      return;
    }

    const sonicSettings = await readSonicDicomReportSettings();
    if (!sonicSettings.sonicDicomReportsEnabled) {
      res.json(makeReportStatusResponse("disabled", patientQrSettings, false));
      return;
    }

    const context = reportContextFromBooking(booking);
    if (!context.requiresReport) {
      res.json(makeReportStatusResponse("not_required", patientQrSettings, false));
      return;
    }
    if (patientQrSettings.reportAccessRequiresCompletedAppointment && context.status !== "completed") {
      res.json(makeReportStatusResponse("not_completed", patientQrSettings, false));
      return;
    }

    const status = await publicReportStatusChecker(context);
    res.json(makeReportStatusResponse(status.state, patientQrSettings, status.canViewReport));
  })
);

router.get(
  "/image-open",
  reportRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = await verifyPublicCancelToken(token);
    const patientQrSettings = await readPatientQrSettings();
    if (!patientQrSettings.enabled) throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
    if (!patientQrSettings.allowImageAccess) throw new HttpError(403, patientQrSettings.qrImageUnavailableMessage, { code: "image_access_disabled" });

    const booking = await getBookingDetails(payload.bookingId);
    if (!canAccessImageForBooking(patientQrSettings, booking)) {
      throw new HttpError(403, patientQrSettings.qrImageUnavailableMessage, { code: "image_access_modality_blocked" });
    }

    const sonicSettings = await readSonicDicomReportSettings();
    if (!sonicSettings.sonicDicomReportsEnabled) throw new HttpError(403, patientQrSettings.qrImageUnavailableMessage, { code: "report_integration_disabled" });

    const context = reportContextFromBooking(booking);
    if (patientQrSettings.imageAccessRequiresCompletedAppointment && context.status !== "completed") {
      throw new HttpError(409, patientQrSettings.qrReportNotCompletedMessage, { code: "image_not_completed" });
    }
    if (patientQrSettings.imageAccessRequiresReportRequiredFlag && !context.requiresReport) {
      throw new HttpError(403, patientQrSettings.qrImageUnavailableMessage, { code: "image_requires_report_flag" });
    }

    let study;
    try {
      study = await publicStudyExistenceChecker(context);
    } catch {
      throw new HttpError(503, patientQrSettings.qrImageUnavailableMessage, { code: "image_system_unavailable" });
    }
    if (!study.foundStudy) {
      throw new HttpError(409, patientQrSettings.qrImageStudyNotFoundMessage, { code: "study_not_found" });
    }

    const imageUrl = await buildSonicDicomImageBrowserUrl(context, req.hostname);
    res.redirect(imageUrl);
  })
);

router.get(
  "/report-open",
  reportRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = await verifyPublicCancelToken(token);
    const patientQrSettings = await readPatientQrSettings();
    if (!patientQrSettings.enabled) throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
    if (!patientQrSettings.allowReportAccess) throw new HttpError(403, "Report access is disabled.", { code: "report_access_disabled" });

    const booking = await getBookingDetails(payload.bookingId);
    if (!canAccessReportForBooking(patientQrSettings, booking)) {
      throw new HttpError(403, "Report access is disabled.", { code: "report_access_modality_blocked" });
    }

    const sonicSettings = await readSonicDicomReportSettings();
    if (!sonicSettings.sonicDicomReportsEnabled) throw new HttpError(403, "Report integration is disabled.", { code: "report_integration_disabled" });

    const context = reportContextFromBooking(booking);
    if (!context.requiresReport) throw new HttpError(403, messageForReportState("not_required", patientQrSettings), { code: "report_not_required" });
    if (patientQrSettings.reportAccessRequiresCompletedAppointment && context.status !== "completed") {
      throw new HttpError(409, messageForReportState("not_completed", patientQrSettings), { code: "report_not_completed" });
    }

    const status = await publicReportStatusChecker(context, { useCache: true });
    if (status.state !== "final") {
      if (sonicSettings.auditPatientReportAccess) {
        await logAuditEntry({
          entityType: "patient_report",
          entityId: context.bookingId,
          actionType: "blocked_report_open_attempt",
          oldValues: null,
          newValues: { state: status.state },
          changedByUserId: null,
        }).catch(() => null);
      }
      throw new HttpError(409, messageForReportState(status.state, patientQrSettings), { code: "report_not_final" });
    }

    const reportUrl = await buildSonicDicomReportBrowserUrl(context, req.hostname);
    if (sonicSettings.auditPatientReportAccess) {
      await logAuditEntry({
        entityType: "patient_report",
        entityId: context.bookingId,
        actionType: "report_opened",
        oldValues: null,
        newValues: { state: "final" },
        changedByUserId: null,
      }).catch(() => null);
    }
    res.redirect(reportUrl);
  })
);

export { router as publicAppointmentsCancelRouter };
