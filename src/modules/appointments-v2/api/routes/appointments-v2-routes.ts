/**
 * Appointments V2 — Appointment booking routes.
 *
 * Mounts under /api/v2/appointments
 * Stage 6: Fully implemented with transactional booking, reschedule, and cancel.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { requireActionPin } from "../../../../middleware/action-pin.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { createBooking } from "../../booking/services/create-booking.service.js";
import { rescheduleBooking } from "../../booking/services/reschedule-booking.service.js";
import { cancelBooking } from "../../booking/services/cancel-booking.service.js";
import { voidBookingByStaff } from "../../booking/services/void-booking.service.js";
import { getBookingDetails } from "../../booking/services/get-booking-details.service.js";
import { listBookingsService } from "../../booking/services/list-bookings.service.js";
import type { CreateAppointmentDto, UpdateAppointmentDto } from "../../api/dto/appointment.dto.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";
import type { CapacityResolutionMode } from "../../shared/types/common.js";
import {
  enqueueStaffPatientWebPushMessage,
  prepareDueNotificationDeliveries,
  processPatientPushDeliveries,
  type PatientNotificationEventType,
} from "../../../../services/patient-web-push-service.js";

const router = Router();

router.use(requireAuth);

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserContext;
}

function isRoleRestrictedCapacityResolutionMode(mode: CapacityResolutionMode): boolean {
  return mode === "category_override" || mode === "total_capacity_override";
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
 * - includeCancelled (optional, default false) — include cancelled and discontinued bookings in results (and voided when present)
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
 * GET /api/v2/appointments/:id/details
 * Fetch one V2 booking in print/details shape.
 */
router.get(
  "/:id/details",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const bookingId = parseInt(String(req.params.id), 10);
    if (isNaN(bookingId)) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const appointment = await getBookingDetails(bookingId);
    res.json({ appointment });
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
  requireActionPin("appointment_create"),
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as CreateAppointmentDto;

    if (!body.patientId || !body.modalityId || !body.bookingDate) {
      res.status(400).json({
        error: "patientId, modalityId, and bookingDate are required",
      });
      return;
    }

    const userId = Number(req.user?.sub ?? 0);
    const userRole = req.user?.role;
    const capacityResolutionMode: CapacityResolutionMode =
      body.capacityResolutionMode ??
      (body.useSpecialQuota === true ? "special_quota_extra" : "standard");
    if (
      isRoleRestrictedCapacityResolutionMode(capacityResolutionMode) &&
      userRole !== "supervisor" &&
      userRole !== "super_admin"
    ) {
      res.status(403).json({
        error: "Supervisor role is required for non-standard capacity resolution mode.",
        reasonCodes: ["capacity_resolution_mode_supervisor_required"],
      });
      return;
    }

    const result = await createBooking(
      {
        patientId: body.patientId,
        modalityId: body.modalityId,
        examTypeId: body.examTypeId ?? null,
        reportingPriorityId: body.reportingPriorityId ?? null,
        bookingDate: body.bookingDate,
        bookingTime: body.bookingTime ?? null,
        caseCategory: body.caseCategory,
        requiresReport: body.requiresReport,
        studyInstanceUid: body.studyInstanceUid ?? null,
        capacityResolutionMode,
        useSpecialQuota: body.useSpecialQuota === true,
        specialReasonCode: body.specialReasonCode ?? null,
        specialReasonNote: body.specialReasonNote ?? null,
        notes: body.notes ?? null,
        isWalkIn: body.isWalkIn ?? false,
        override: body.override,
      },
      userId,
      userRole,
      body.policySetKey ?? "default"
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
  requireActionPin("appointment_reschedule"),
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const bookingId = parseInt(String(req.params.id), 10);
    if (isNaN(bookingId)) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const body = req.body as UpdateAppointmentDto;

    const userId = Number(req.user?.sub ?? 0);
    const userRole = req.user?.role;
    const capacityResolutionMode: CapacityResolutionMode | undefined =
      body.capacityResolutionMode ??
      (body.useSpecialQuota === true ? "special_quota_extra" : undefined);
    if (
      capacityResolutionMode &&
      isRoleRestrictedCapacityResolutionMode(capacityResolutionMode) &&
      userRole !== "supervisor" &&
      userRole !== "super_admin"
    ) {
      res.status(403).json({
        error: "Supervisor role is required for non-standard capacity resolution mode.",
        reasonCodes: ["capacity_resolution_mode_supervisor_required"],
      });
      return;
    }

    // If no date change provided, keep the existing booking date (time-only reschedule)
    const result = await rescheduleBooking(
      bookingId,
      body.bookingDate ?? null,
      body.bookingTime,
      body.examTypeId ?? null,
      body.reportingPriorityId ?? null,
      body.notes ?? null,
      userId,
      userRole,
      body.override,
      capacityResolutionMode,
      body.specialReasonCode ?? null,
      body.specialReasonNote ?? null,
      body.rescheduleReason ?? null,
      body.requiresReport,
      body.studyInstanceUid ?? undefined,
      body.policySetKey ?? "default"
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
  requireActionPin("appointment_cancel"),
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

/**
 * POST /api/v2/appointments/:id/patient-notification
 * Send a generic browser notification to a patient already subscribed from the QR page.
 */
router.post(
  "/:id/patient-notification",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const bookingId = parseInt(String(req.params.id), 10);
    if (isNaN(bookingId)) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const body = (req.body ?? {}) as {
      title?: unknown;
      message?: unknown;
      templateEventType?: unknown;
    };
    const allowedTemplates = new Set<PatientNotificationEventType>([
      "appointment_reminder_24h",
      "appointment_rescheduled",
      "appointment_cancelled",
      "appointment_changed",
      "report_ready",
      "image_ready",
      "test",
    ]);
    const requestedTemplate = String(body.templateEventType || "");
    const templateEventType = allowedTemplates.has(requestedTemplate as PatientNotificationEventType)
      ? (requestedTemplate as PatientNotificationEventType)
      : undefined;

    const result = await enqueueStaffPatientWebPushMessage({
      bookingId,
      title: body.title,
      body: body.message,
      templateEventType,
    });

    void (async () => {
      try {
        await prepareDueNotificationDeliveries(10);
        await processPatientPushDeliveries(10);
      } catch (error) {
        console.warn(
          JSON.stringify({
            type: "staff_patient_web_push_delivery_failed",
            bookingId,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      }
    })();

    res.status(202).json(result);
  })
);

/**
 * POST /api/v2/appointments/:id/void
 * Staff void for correction (soft-delete semantics).
 */
router.post(
  "/:id/void",
  requireActionPin("appointment_void"),
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const bookingId = parseInt(String(req.params.id), 10);
    if (isNaN(bookingId)) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const userId = Number(req.user?.sub ?? 0);
    const userRole = req.user?.role;
    const voidReason = String((req.body as { voidReason?: string } | undefined)?.voidReason ?? "");

    const result = await voidBookingByStaff(bookingId, userId, userRole, voidReason);

    res.json({
      booking: result.booking,
      previousStatus: result.previousStatus,
    });
  })
);

export { router as appointmentsV2Router };
