/**
 * Appointments V2 — Appointment booking routes.
 *
 * Mounts under /api/v2/appointments
 * Stage 6: Fully implemented with transactional booking, reschedule, and cancel.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { createBooking } from "../../booking/services/create-booking.service.js";
import { rescheduleBooking } from "../../booking/services/reschedule-booking.service.js";
import { cancelBooking } from "../../booking/services/cancel-booking.service.js";
import { listBookingsService } from "../../booking/services/list-bookings.service.js";
import type { CreateAppointmentDto, UpdateAppointmentDto } from "../../api/dto/appointment.dto.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";

const router = Router();

router.use(requireAuth);

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserContext;
}

/**
 * GET /api/v2/appointments
 * List existing bookings for a modality within a date range.
 *
 * Query params:
 * - modalityId (required)
 * - dateFrom (required) — ISO yyyy-mm-dd
 * - dateTo (required) — ISO yyyy-mm-dd
 * - limit (optional, default 50)
 * - offset (optional, default 0)
 * - includeCancelled (optional, default false) — include cancelled bookings in results
 */
router.get(
  "/",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const modalityId = parseInt(String(req.query.modalityId), 10);
    const dateFrom = String(req.query.dateFrom ?? "");
    const dateTo = String(req.query.dateTo ?? "");
    const limit = parseInt(String(req.query.limit ?? "50"), 10);
    const offset = parseInt(String(req.query.offset ?? "0"), 10);
    const includeCancelled = String(req.query.includeCancelled).toLowerCase() === "true";

    if (!modalityId || isNaN(modalityId)) {
      res.status(400).json({ error: "modalityId is required" });
      return;
    }

    if (!dateFrom || !dateTo) {
      res.status(400).json({ error: "dateFrom and dateTo are required (ISO yyyy-mm-dd)" });
      return;
    }

    const bookings = await listBookingsService({
      modalityId,
      dateFrom,
      dateTo,
      limit: isNaN(limit) ? 50 : limit,
      offset: isNaN(offset) ? 0 : offset,
      includeCancelled,
    });

    res.json({ bookings });
  })
);

/**
 * POST /api/v2/appointments
 * Create a new appointment booking.
 *
 * Body: CreateAppointmentDto
 * - patientId, modalityId, bookingDate, caseCategory (required)
 * - examTypeId, reportingPriorityId, bookingTime, notes (optional)
 * - override: { supervisorUsername, supervisorPassword, reason } (if override needed)
 */
router.post(
  "/",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as CreateAppointmentDto;

    if (!body.patientId || !body.modalityId || !body.bookingDate || !body.caseCategory) {
      res.status(400).json({
        error: "patientId, modalityId, bookingDate, and caseCategory are required",
      });
      return;
    }

    const userId = Number(req.user?.sub ?? 0);

    const result = await createBooking(
      {
        patientId: body.patientId,
        modalityId: body.modalityId,
        examTypeId: body.examTypeId ?? null,
        reportingPriorityId: body.reportingPriorityId ?? null,
        bookingDate: body.bookingDate,
        bookingTime: body.bookingTime ?? null,
        caseCategory: body.caseCategory,
        notes: body.notes ?? null,
        override: body.override,
      },
      userId
    );

    res.status(201).json({
      booking: result.booking,
      decision: result.decisionSnapshot,
      wasOverride: result.wasOverride,
    });
  })
);

/**
 * PUT /api/v2/appointments/:id
 * Reschedule an existing appointment.
 *
 * Body: UpdateAppointmentDto (at least bookingDate or bookingTime must be provided)
 * - override: { supervisorUsername, supervisorPassword, reason } (if override needed)
 */
router.put(
  "/:id",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const bookingId = parseInt(String(req.params.id), 10);
    if (isNaN(bookingId)) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const body = req.body as UpdateAppointmentDto & {
      override?: { supervisorUsername: string; supervisorPassword: string; reason: string };
    };

    const userId = Number(req.user?.sub ?? 0);

    // If no date change provided, keep the existing booking date (time-only reschedule)
    const result = await rescheduleBooking(
      bookingId,
      body.bookingDate ?? null,
      body.bookingTime ?? null,
      userId,
      body.override
    );

    res.json({
      booking: result.booking,
      decision: result.decisionSnapshot,
      wasOverride: result.wasOverride,
      previousDate: result.previousDate,
    });
  })
);

/**
 * POST /api/v2/appointments/:id/cancel
 * Cancel an existing appointment.
 */
router.post(
  "/:id/cancel",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const bookingId = parseInt(String(req.params.id), 10);
    if (isNaN(bookingId)) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const userId = Number(req.user?.sub ?? 0);

    const result = await cancelBooking(bookingId, userId);

    res.json({
      booking: result.booking,
      previousStatus: result.previousStatus,
    });
  })
);

export { router as appointmentsV2Router };
