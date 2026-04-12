/**
 * Appointments V2 — Admin scheduling routes.
 *
 * Mounts under /api/v2/scheduling/admin
 * Stage 7: Fully implemented policy draft/publish/preview endpoints.
 */

import { Router, Request, Response } from "express";
import { requireAuth } from "../../../../middleware/auth.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { createPolicyDraft } from "../../admin/services/create-policy-draft.service.js";
import { savePolicyDraft } from "../../admin/services/save-policy-draft.service.js";
import { publishPolicy } from "../../admin/services/publish-policy.service.js";
import { previewPolicyImpact } from "../../admin/services/preview-policy-impact.service.js";
import { getPolicyStatus } from "../../admin/services/get-policy-status.service.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";

const router = Router();

router.use(requireAuth);

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserContext;
}

/**
 * GET /api/v2/scheduling/admin/policy
 * Return the current published policy and any active draft for a policy set.
 * Query params: policySetKey (default: "default")
 */
router.get(
  "/policy",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const policySetKey = (req.query.policySetKey as string) ?? "default";

    const result = await getPolicyStatus(policySetKey);

    res.json({
      policySet: result.policySet,
      published: result.published,
      draft: result.draft,
      publishedRules: result.publishedRules,
      draftRules: result.draftRules,
    });
  })
);

/**
 * POST /api/v2/scheduling/admin/policy/draft
 * Create a new draft based on the published version.
 *
 * Body: { policySetKey: string, changeNote?: string }
 */
router.post(
  "/policy/draft",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const policySetKey = String(body.policySetKey ?? "default").trim();
    const changeNote = body.changeNote ? String(body.changeNote) : null;

    if (!policySetKey) {
      res.status(400).json({ error: "policySetKey is required" });
      return;
    }

    const userId = Number(req.user?.sub ?? 0);

    const result = await createPolicyDraft(policySetKey, userId, changeNote);

    res.status(201).json({
      draft: result.draft,
      basedOnVersionId: result.basedOnVersionId,
    });
  })
);

/**
 * PUT /api/v2/scheduling/admin/policy/draft/:versionId
 * Authoritatively replace a draft snapshot (D006).
 *
 * Body: { configSnapshot: object, changeNote?: string }
 */
router.put(
  "/policy/draft/:versionId",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const versionId = parseInt(String(req.params.versionId), 10);
    if (isNaN(versionId)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const configSnapshot = body.configSnapshot ?? null;
    const changeNote = body.changeNote ? String(body.changeNote) : null;

    if (configSnapshot == null) {
      res.status(400).json({ error: "configSnapshot is required" });
      return;
    }

    const userId = Number(req.user?.sub ?? 0);

    const result = await savePolicyDraft(versionId, configSnapshot, userId, changeNote);

    res.json({
      version: result.version,
      configHash: result.configHash,
    });
  })
);

/**
 * POST /api/v2/scheduling/admin/policy/draft/:versionId/publish
 * Publish a draft with optimistic concurrency.
 *
 * Body: { changeNote?: string }
 */
router.post(
  "/policy/draft/:versionId/publish",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const versionId = parseInt(String(req.params.versionId), 10);
    if (isNaN(versionId)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const changeNote = body.changeNote ? String(body.changeNote) : null;

    const userId = Number(req.user?.sub ?? 0);

    const result = await publishPolicy(versionId, userId, changeNote);

    res.json({
      published: result.published,
      ruleCount: result.ruleCount,
    });
  })
);

/**
 * GET /api/v2/scheduling/admin/policy/draft/:versionId/preview
 * Preview the impact of publishing a draft.
 */
router.get(
  "/policy/draft/:versionId/preview",
  asyncRoute(async (_req: AuthenticatedRequest, res: Response) => {
    const versionId = parseInt(String(_req.params.versionId), 10);
    if (isNaN(versionId)) {
      res.status(400).json({ error: "Invalid version ID" });
      return;
    }

    const diff = await previewPolicyImpact(versionId);

    res.json({
      draftVersionId: diff.draftVersionId,
      publishedVersionId: diff.publishedVersionId,
      addedRulesCount: diff.addedRules.length,
      removedRulesCount: diff.removedRules.length,
      modifiedRulesCount: diff.modifiedRules.length,
      warnings: diff.warnings,
    });
  })
);

export { router as adminSchedulingV2Router };
