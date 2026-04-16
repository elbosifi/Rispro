/**
 * Appointments V2 — Catalog lookup routes.
 *
 * Mounts under /api/v2/lookups
 * - GET /modalities — list active modalities
 * - GET /modalities/:modalityId/exam-types — list active exam types for a modality
 * - GET /special-reason-codes — list active special reason codes
 *
 * These endpoints serve the V2 frontend's modality/exam-type selectors.
 * They use the V2 catalog repositories and require only authentication
 * (no role restriction), making them suitable for reception users.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { listActiveModalities } from "../../catalog/repositories/modality-catalog.repo.js";
import { listExamTypesForModality, findExamTypeById } from "../../catalog/repositories/exam-type-catalog.repo.js";
import { findModalityById } from "../../catalog/repositories/modality-catalog.repo.js";
import { pool } from "../../../../db/pool.js";

const router = Router();

router.use(requireAuth);

/**
 * GET /api/v2/lookups/modalities
 * Return all active modalities for the V2 modality selector.
 */
router.get(
  "/modalities",
  asyncRoute(async (_req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      const modalities = await listActiveModalities(client);
      res.json({
        items: modalities.map((m) => ({
          id: m.id,
          name: m.nameEn || m.name,
          nameAr: m.nameAr,
          nameEn: m.nameEn,
          code: m.code,
          dailyCapacity: m.dailyCapacity,
          isActive: m.isActive,
          safetyWarningEn: m.safetyWarningEn,
          safetyWarningAr: m.safetyWarningAr,
          safetyWarningEnabled: m.safetyWarningEnabled,
        })),
      });
    } finally {
      client.release();
    }
  })
);

/**
 * GET /api/v2/lookups/modalities/:modalityId/exam-types
 * Return active exam types for a specific modality.
 */
router.get(
  "/modalities/:modalityId/exam-types",
  asyncRoute(async (req: Request, res: Response) => {
    const modalityId = req.params.modalityId ? Number(req.params.modalityId) : null;
    if (!modalityId || isNaN(modalityId)) {
      throw new SchedulingError(400, "modalityId is required and must be a number");
    }

    const client = await pool.connect();
    try {
      // Verify modality exists
      const modality = await findModalityById(client, modalityId);
      if (!modality) {
        throw new SchedulingError(404, `Modality ${modalityId} not found`);
      }

      const examTypes = await listExamTypesForModality(client, modalityId);
      res.json({
        modalityId,
        items: examTypes.map((e) => ({
          id: e.id,
          name: e.nameEn || e.name,
          nameAr: e.nameAr,
          nameEn: e.nameEn,
          modalityId: e.modalityId,
          isActive: e.isActive,
        })),
      });
    } finally {
      client.release();
    }
  })
);

/**
 * GET /api/v2/lookups/special-reason-codes
 * Return active special reason codes used by V2 special quota booking.
 */
router.get(
  "/special-reason-codes",
  asyncRoute(async (_req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      const result = await client.query<{
        code: string;
        labelAr: string;
        labelEn: string;
        isActive: boolean;
      }>(
        `
          select
            code,
            label_ar as "labelAr",
            label_en as "labelEn",
            is_active as "isActive"
          from appointments_v2.special_reason_codes
          where is_active = true
          order by code asc
        `
      );

      res.json({ items: result.rows });
    } finally {
      client.release();
    }
  })
);

/**
 * GET /api/v2/lookups/priorities
 * Return active reporting priorities.
 */
router.get(
  "/priorities",
  asyncRoute(async (_req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      const result = await client.query<{
        id: number;
        code: string;
        name_ar: string;
        name_en: string;
        sort_order: number;
      }>(
        `
          select id, code, name_ar, name_en, sort_order
          from reporting_priorities
          order by sort_order asc, name_en asc
        `
      );

      res.json({
        items: result.rows.map((r) => ({
          id: r.id,
          name: r.name_en || r.name_ar,
          nameAr: r.name_ar,
          nameEn: r.name_en,
        })),
      });
    } finally {
      client.release();
    }
  })
);

export { router as lookupsV2Router };
