/**
 * Appointments V2 — Scheduling routes.
 *
 * Mounts under /api/v2/scheduling
 * TODO (Stage 4/5): Implement decision and availability endpoints.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { evaluateBookingDecision } from "../../rules/services/evaluate-booking-decision.js";
import { getAvailability, type GetAvailabilityParams } from "../../scheduler/services/availability.service.js";
import { getSuggestions } from "../../scheduler/services/suggestion.service.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { pool } from "../../../../db/pool.js";

const router = Router();

router.use(requireAuth);

/**
 * POST /api/v2/scheduling/evaluate
 * Evaluate a booking candidate and return a structured decision.
 */
router.post(
  "/evaluate",
  asyncRoute(async (req: Request<unknown, unknown, unknown>, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const decision = await evaluateBookingDecision({
      patientId: Number(body.patientId),
      modalityId: Number(body.modalityId),
      examTypeId: body.examTypeId ? Number(body.examTypeId) : null,
      scheduledDate: String(body.scheduledDate),
      caseCategory: String(body.caseCategory) as "oncology" | "non_oncology",
      useSpecialQuota: body.useSpecialQuota === true,
      specialReasonCode: body.specialReasonCode ? String(body.specialReasonCode) : null,
      includeOverrideEvaluation: body.includeOverrideEvaluation === true,
    });
    res.json(decision);
  })
);

/**
 * GET /api/v2/scheduling/availability
 * Return availability days with explicit decision status.
 */
router.get(
  "/availability",
  asyncRoute(async (req: Request, res: Response) => {
    const modalityId = req.query.modalityId ? Number(req.query.modalityId) : null;
    const days = req.query.days ? Number(req.query.days) : 14;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const examTypeId = req.query.examTypeId ? Number(req.query.examTypeId) : null;
    const caseCategory = (req.query.caseCategory as "oncology" | "non_oncology") ?? "non_oncology";

    if (!modalityId) {
      throw new SchedulingError(400, "modalityId is required");
    }

    const params: GetAvailabilityParams = {
      modalityId,
      days,
      offset,
      examTypeId,
      caseCategory,
      useSpecialQuota: req.query.useSpecialQuota === "true",
      specialReasonCode: req.query.specialReasonCode ? String(req.query.specialReasonCode) : null,
      includeOverrideCandidates: req.query.includeOverrideCandidates === "true",
    };

    const modality = await findModalityById(pool, modalityId);
    if (!modality) {
      throw new SchedulingError(400, `Modality ${modalityId} not found`);
    }

    const availability = await getAvailability(params);
    res.json({ items: availability });
  })
);

/**
 * GET /api/v2/scheduling/suggestions
 * Return next available appointment suggestions.
 */
router.get(
  "/suggestions",
  asyncRoute(async (req: Request, res: Response) => {
    const modalityId = req.query.modalityId ? Number(req.query.modalityId) : null;
    const days = req.query.days ? Number(req.query.days) : 14;
    const examTypeId = req.query.examTypeId ? Number(req.query.examTypeId) : null;
    const caseCategory = req.query.caseCategory as "oncology" | "non_oncology" | undefined;

    if (!modalityId) {
      throw new SchedulingError(400, "modalityId is required");
    }

    const suggestions = await getSuggestions(modalityId, days, examTypeId, caseCategory);
    res.json({ items: suggestions });
  })
);

export { router as schedulingV2Router };
