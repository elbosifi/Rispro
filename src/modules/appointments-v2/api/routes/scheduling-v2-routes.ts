/**
 * Appointments V2 — Scheduling routes.
 *
 * Mounts under /api/v2/scheduling
 * - POST /evaluate — booking decision evaluation
 * - GET /availability — date range availability with explicit status
 * - GET /suggestions — next available appointment suggestions
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { evaluateBookingDecision } from "../../rules/services/evaluate-booking-decision.js";
import { getAvailabilityWithMeta, type GetAvailabilityParams } from "../../scheduler/services/availability.service.js";
import { getSuggestions } from "../../scheduler/services/suggestion.service.js";
import { runAvailabilityWithShadow } from "../../observability/shadow-availability.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { pool } from "../../../../db/pool.js";
import type { CapacityResolutionMode } from "../../shared/types/common.js";

const router = Router();

router.use(requireAuth);

function readSingleQueryValue(value: unknown): string | null {
  if (Array.isArray(value)) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parsePositiveIntQuery(value: unknown, fieldName: string): number | null {
  const raw = readSingleQueryValue(value);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SchedulingError(400, `${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseBoundedIntQuery(value: unknown, fieldName: string, defaultValue: number, min: number, max: number): number {
  const raw = readSingleQueryValue(value);
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new SchedulingError(400, `${fieldName} must be an integer`);
  }
  return Math.min(max, Math.max(min, parsed));
}

function parseCaseCategoryQuery(value: unknown): "oncology" | "non_oncology" {
  const raw = readSingleQueryValue(value);
  if (!raw) return "non_oncology";
  if (raw === "oncology" || raw === "non_oncology") return raw;
  throw new SchedulingError(400, "caseCategory must be oncology or non_oncology");
}

function parseCapacityResolutionModeQuery(value: unknown, useSpecialQuota: boolean): CapacityResolutionMode {
  const raw = readSingleQueryValue(value);
  if (!raw) return useSpecialQuota ? "special_quota_extra" : "standard";
  if (raw === "standard" || raw === "category_override" || raw === "total_capacity_override" || raw === "special_quota_extra") return raw;
  throw new SchedulingError(400, "capacityResolutionMode is invalid");
}

/**
 * POST /api/v2/scheduling/evaluate
 * Evaluate a booking candidate and return a structured decision.
 */
router.post(
  "/evaluate",
  asyncRoute(async (req: Request<unknown, unknown, unknown>, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const capacityResolutionMode = (body.capacityResolutionMode as CapacityResolutionMode | undefined) ??
      (body.useSpecialQuota === true ? "special_quota_extra" : "standard");
    const decision = await evaluateBookingDecision({
      patientId: Number(body.patientId),
      modalityId: Number(body.modalityId),
      examTypeId: body.examTypeId ? Number(body.examTypeId) : null,
      scheduledDate: String(body.scheduledDate),
      caseCategory: String(body.caseCategory) as "oncology" | "non_oncology",
      capacityResolutionMode,
      useSpecialQuota: body.useSpecialQuota === true,
      specialReasonCode: body.specialReasonCode ? String(body.specialReasonCode) : null,
      includeOverrideEvaluation: body.includeOverrideEvaluation === true,
      requesterRole: req.user?.role,
      requesterUserId: Number(req.user?.sub ?? 0) || null,
    }, body.policySetKey as string | undefined);
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
    const modalityId = parsePositiveIntQuery(req.query.modalityId, "modalityId");
    const days = parseBoundedIntQuery(req.query.days, "days", 14, 0, 60);
    const offset = parseBoundedIntQuery(req.query.offset, "offset", 0, 0, 365);
    const examTypeId = parsePositiveIntQuery(req.query.examTypeId, "examTypeId");
    const caseCategory = parseCaseCategoryQuery(req.query.caseCategory);
    const useSpecialQuota = req.query.useSpecialQuota === "true";
    const capacityResolutionMode = parseCapacityResolutionModeQuery(req.query.capacityResolutionMode, useSpecialQuota);

    if (!modalityId) {
      throw new SchedulingError(400, "modalityId is required");
    }

    const params: GetAvailabilityParams = {
      modalityId,
      days,
      offset,
      examTypeId,
      caseCategory,
      capacityResolutionMode,
      useSpecialQuota,
      specialReasonCode: req.query.specialReasonCode ? String(req.query.specialReasonCode) : null,
      includeOverrideCandidates: req.query.includeOverrideCandidates === "true",
      requesterRole: req.user?.role,
      requesterUserId: Number(req.user?.sub ?? 0) || null,
    };

    const client = await pool.connect();
    try {
      const modality = await findModalityById(client, modalityId);
      if (!modality) {
        throw new SchedulingError(400, `Modality ${modalityId} not found`);
      }
    } finally {
      client.release();
    }

    const policySetKey = req.query.policySetKey as string | undefined;
    const availability = await getAvailabilityWithMeta(params, policySetKey);
    const responseItems = await runAvailabilityWithShadow(availability.items, params, policySetKey);

    res.json({
      items: responseItems,
      ...(availability.noPublishedPolicy ? { meta: { noPublishedPolicy: true } } : {}),
    });
  })
);

/**
 * GET /api/v2/scheduling/suggestions
 * Return next available appointment suggestions.
 */
router.get(
  "/suggestions",
  asyncRoute(async (req: Request, res: Response) => {
    const modalityId = parsePositiveIntQuery(req.query.modalityId, "modalityId");
    const days = parseBoundedIntQuery(req.query.days, "days", 14, 0, 60);
    const examTypeId = parsePositiveIntQuery(req.query.examTypeId, "examTypeId");
    const caseCategory = parseCaseCategoryQuery(req.query.caseCategory);
    const includeOverrideCandidates = req.query.includeOverrideCandidates === "true";

    if (!modalityId) {
      throw new SchedulingError(400, "modalityId is required");
    }

    const suggestions = await getSuggestions({
      modalityId,
      days,
      examTypeId,
      caseCategory,
      includeOverrideCandidates,
    });
    res.json({ items: suggestions });
  })
);

export { router as schedulingV2Router };
