import { Router, Request, Response } from "express";
import { asyncRoute } from "../../../../utils/async-route.js";
import { HttpError } from "../../../../utils/http-error.js";
import { getBookingDetails } from "../../booking/services/get-booking-details.service.js";
import { cancelBooking } from "../../booking/services/cancel-booking.service.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { getPublicCancelServiceUserId } from "../../public/utils/public-cancel-config.js";
import { verifyPublicCancelToken } from "../../public/utils/public-cancel-token.js";

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

router.get(
  "/cancel-preview",
  asyncRoute(async (req: Request, res: Response) => {
    const token = readToken(req);
    const payload = verifyPublicCancelToken(token);
    const booking = await getBookingDetails(payload.bookingId);

    res.json({
      preview: {
        bookingId: booking.id,
        patientDisplayName: makePatientDisplayName({
          arabicName: booking.arabic_full_name ?? null,
          englishName: booking.english_full_name ?? null,
        }),
        bookingDate: booking.appointment_date,
        modalityName: booking.modality_name_en || booking.modality_name_ar || "—",
        examName: booking.exam_name_en || booking.exam_name_ar || "—",
        currentStatus: booking.status,
      },
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
