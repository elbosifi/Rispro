import { Router, Request, Response } from "express";
import { asyncRoute } from "../../../../utils/async-route.js";
import { HttpError } from "../../../../utils/http-error.js";
import { getBookingDetails } from "../../booking/services/get-booking-details.service.js";
import { cancelBooking } from "../../booking/services/cancel-booking.service.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { getPublicCancelServiceUserId } from "../../public/utils/public-cancel-config.js";
import { verifyPublicCancelToken } from "../../public/utils/public-cancel-token.js";
import { readPatientQrSettings } from "../../public/utils/patient-qr-settings.js";
import { createRateLimiter } from "../../../../middleware/rate-limit.js";
import {
  buildPublicSonicDicomImageUrl,
  buildPublicSonicDicomReportUrl,
  checkSonicDicomReportStatus,
  checkSonicDicomStudyExists,
  messageForReportState,
  type SonicDicomReportState,
} from "../../../../services/sonicdicom-report-service.js";
import { readSonicDicomReportSettings } from "../../../../services/sonicdicom-report-settings.js";
import { logAuditEntry } from "../../../../services/audit-service.js";

const router = Router();
const reportRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: "Too many report access requests. Please try again later.",
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

function reportContextFromBooking(booking: BookingDetails) {
  return {
    bookingId: Number(booking.id),
    accessionNumber: String(booking.accession_number || ""),
    studyInstanceUid: booking.study_instance_uid ?? null,
    requiresReport: Boolean(booking.requires_report),
    status: String(booking.status || ""),
  };
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

router.get(
  "/cancel-preview",
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = verifyPublicCancelToken(token);
    const patientQrSettings = await readPatientQrSettings();
    if (!patientQrSettings.enabled) {
      throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
    }

    const booking = await getBookingDetails(payload.bookingId);

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
      settings: patientQrSettings,
    });
  })
);

router.post(
  "/cancel",
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = verifyPublicCancelToken(token);
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
  "/report-status",
  reportRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    if (req.query.accessionNumber || req.query.accession || req.query.studyInstanceUid || req.query.studyinstanceuid) {
      throw new HttpError(400, "Public report lookup identifiers are not accepted.", { code: "public_identifier_rejected" });
    }

    const payload = verifyPublicCancelToken(token);
    const patientQrSettings = await readPatientQrSettings();
    if (!patientQrSettings.enabled) throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
    if (!patientQrSettings.allowReportAccess) {
      res.json(makeReportStatusResponse("disabled", patientQrSettings, false));
      return;
    }

    const sonicSettings = await readSonicDicomReportSettings();
    if (!sonicSettings.sonicDicomReportsEnabled) {
      res.json(makeReportStatusResponse("disabled", patientQrSettings, false));
      return;
    }

    const booking = await getBookingDetails(payload.bookingId);
    const context = reportContextFromBooking(booking);
    if (!context.requiresReport) {
      res.json(makeReportStatusResponse("not_required", patientQrSettings, false));
      return;
    }
    if (patientQrSettings.reportAccessRequiresCompletedAppointment && context.status !== "completed") {
      res.json(makeReportStatusResponse("not_completed", patientQrSettings, false));
      return;
    }

    const status = await checkSonicDicomReportStatus(context);
    res.json(makeReportStatusResponse(status.state, patientQrSettings, status.canViewReport));
  })
);

router.get(
  "/image-open",
  reportRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = verifyPublicCancelToken(token);
    const patientQrSettings = await readPatientQrSettings();
    if (!patientQrSettings.enabled) throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
    if (!patientQrSettings.allowImageAccess) throw new HttpError(403, patientQrSettings.qrImageUnavailableMessage, { code: "image_access_disabled" });

    const sonicSettings = await readSonicDicomReportSettings();
    if (!sonicSettings.sonicDicomReportsEnabled) throw new HttpError(403, patientQrSettings.qrImageUnavailableMessage, { code: "report_integration_disabled" });

    const booking = await getBookingDetails(payload.bookingId);
    const context = reportContextFromBooking(booking);
    if (patientQrSettings.imageAccessRequiresCompletedAppointment && context.status !== "completed") {
      throw new HttpError(409, patientQrSettings.qrReportNotCompletedMessage, { code: "image_not_completed" });
    }
    if (patientQrSettings.imageAccessRequiresReportRequiredFlag && !context.requiresReport) {
      throw new HttpError(403, patientQrSettings.qrImageUnavailableMessage, { code: "image_requires_report_flag" });
    }

    let study;
    try {
      study = await checkSonicDicomStudyExists(context);
    } catch {
      throw new HttpError(503, patientQrSettings.qrImageUnavailableMessage, { code: "image_system_unavailable" });
    }
    if (!study.foundStudy) {
      throw new HttpError(409, patientQrSettings.qrImageStudyNotFoundMessage, { code: "study_not_found" });
    }

    const imageUrl = await buildPublicSonicDicomImageUrl(context);
    res.redirect(imageUrl);
  })
);

router.get(
  "/report-open",
  reportRateLimiter,
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = verifyPublicCancelToken(token);
    const patientQrSettings = await readPatientQrSettings();
    if (!patientQrSettings.enabled) throw new HttpError(403, "Patient QR access is disabled.", { code: "patient_qr_disabled" });
    if (!patientQrSettings.allowReportAccess) throw new HttpError(403, "Report access is disabled.", { code: "report_access_disabled" });

    const sonicSettings = await readSonicDicomReportSettings();
    if (!sonicSettings.sonicDicomReportsEnabled) throw new HttpError(403, "Report integration is disabled.", { code: "report_integration_disabled" });

    const booking = await getBookingDetails(payload.bookingId);
    const context = reportContextFromBooking(booking);
    if (!context.requiresReport) throw new HttpError(403, messageForReportState("not_required", patientQrSettings), { code: "report_not_required" });
    if (patientQrSettings.reportAccessRequiresCompletedAppointment && context.status !== "completed") {
      throw new HttpError(409, messageForReportState("not_completed", patientQrSettings), { code: "report_not_completed" });
    }

    const status = await checkSonicDicomReportStatus(context, { useCache: true });
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

    const reportUrl = await buildPublicSonicDicomReportUrl(context);
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
