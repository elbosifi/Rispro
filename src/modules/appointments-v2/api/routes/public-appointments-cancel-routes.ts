import { Router, Request, Response } from "express";
import { asyncRoute } from "../../../../utils/async-route.js";
import { HttpError } from "../../../../utils/http-error.js";
import { getBookingDetails } from "../../booking/services/get-booking-details.service.js";
import { cancelBooking } from "../../booking/services/cancel-booking.service.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { getPublicCancelServiceUserId } from "../../public/utils/public-cancel-config.js";
import { verifyPublicCancelToken } from "../../public/utils/public-cancel-token.js";
import { readPatientQrSettings } from "../../public/utils/patient-qr-settings.js";

const router = Router();

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
        accessionNumber: booking.accession_number,
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

export { router as publicAppointmentsCancelRouter };
