/**
 * Appointments V2 — Admin scheduling routes.
 *
 * Mounts under /api/v2/scheduling/admin
 * Stage 7: Fully implemented policy draft/publish/preview endpoints.
 */

import { Router, Request, Response } from "express";
import { requireAnyRole, requireAuth, requireSupervisor } from "../../../../middleware/auth.js";
import { requireActionPin } from "../../../../middleware/action-pin.js";
import { asyncRoute } from "../../../../utils/async-route.js";
import { validateIsoDate } from "../../../../utils/date.js";
import { SchedulingError } from "../../shared/errors/scheduling-error.js";
import { createPolicyDraft } from "../../admin/services/create-policy-draft.service.js";
import { savePolicyDraft } from "../../admin/services/save-policy-draft.service.js";
import { publishPolicy } from "../../admin/services/publish-policy.service.js";
import { previewPolicyImpact } from "../../admin/services/preview-policy-impact.service.js";
import { getPolicyStatus } from "../../admin/services/get-policy-status.service.js";
import { getDayManagementContext } from "../../admin/services/get-day-management-context.service.js";
import {
  createDayExamMixQuota,
  createDayExamRestriction,
  createDayModalityBlock,
  removeDayManagementRule,
} from "../../admin/services/day-management-command.service.js";
import { listUsers } from "../../../../services/user-service.js";
import type { AuthenticatedUserContext } from "../../../../types/http.js";
import type {
  CreatePolicyDraftDto,
  FieldValidationErrorDto,
  PublishPolicyDto,
  SavePolicyDraftDto,
  CreateDayExamMixQuotaDto,
  CreateDayExamRestrictionDto,
  CreateDayModalityBlockDto,
  DayManagementRemovableRuleFamily,
  RemoveDayManagementRuleDto,
} from "../dto/admin-scheduling.dto.js";

const router = Router();

router.use(requireAuth);
router.use(requireSupervisor);

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserContext;
}

/**
 * GET /api/v2/scheduling/admin/day-management/context
 * Return the read-only, authoritative scheduling-policy context for one day.
 */
router.get(
  "/day-management/context",
  requireAnyRole(["super_admin"]),
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const modalityId = Number(req.query.modalityId);
    if (!Number.isInteger(modalityId) || modalityId <= 0) {
      throwValidationError([
        { field: "modalityId", code: "invalid_positive_integer", message: "modalityId must be a positive integer" },
      ]);
    }

    let date: string;
    try {
      date = validateIsoDate(req.query.date);
    } catch (error) {
      throwValidationError([
        { field: "date", code: "invalid_date", message: error instanceof Error ? error.message : "Invalid date" },
      ]);
    }

    const policySetKey = String(req.query.policySetKey ?? "default").trim();
    if (!policySetKey) {
      throwValidationError([
        { field: "policySetKey", code: "required", message: "policySetKey is required" },
      ]);
    }

    res.json(await getDayManagementContext({ modalityId, date, policySetKey }));
  })
);

router.post("/day-management/block-modality", requireAnyRole(["super_admin"]), requireActionPin("scheduling_day_policy_change"), asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateDayModalityBlockDto;
  requireDayMutationShape(body);
  res.status(201).json(await createDayModalityBlock(body, Number(req.user?.sub ?? 0)));
}));

router.post("/day-management/exam-restriction", requireAnyRole(["super_admin"]), requireActionPin("scheduling_day_policy_change"), asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateDayExamRestrictionDto;
  requireDayMutationShape(body);
  if (!Array.isArray(body.examTypeIds)) throwValidationError([{ field: "examTypeIds", code: "invalid_type", message: "examTypeIds must be an array" }]);
  res.status(201).json(await createDayExamRestriction(body, Number(req.user?.sub ?? 0)));
}));

router.post("/day-management/exam-mix-quota", requireAnyRole(["super_admin"]), requireActionPin("scheduling_day_policy_change"), asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as CreateDayExamMixQuotaDto;
  requireDayMutationShape(body);
  if (!Array.isArray(body.examTypeIds)) throwValidationError([{ field: "examTypeIds", code: "invalid_type", message: "examTypeIds must be an array" }]);
  res.status(201).json(await createDayExamMixQuota(body, Number(req.user?.sub ?? 0)));
}));

router.post("/day-management/rules/:family/:ruleId/remove", requireAnyRole(["super_admin"]), requireActionPin("scheduling_day_policy_change"), asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
  const family = String(req.params.family) as DayManagementRemovableRuleFamily;
  const ruleId = Number(req.params.ruleId);
  if (!["block_modality", "restrict_exam_types", "set_exam_mix_quota"].includes(family)) {
    throwValidationError([{ field: "family", code: "invalid_value", message: "Unsupported day management rule family" }]);
  }
  if (!Number.isInteger(ruleId) || ruleId <= 0) throwValidationError([{ field: "ruleId", code: "invalid_positive_integer", message: "ruleId must be a positive integer" }]);
  const body = req.body as RemoveDayManagementRuleDto;
  requireDayMutationShape(body);
  res.json(await removeDayManagementRule(family, ruleId, body, Number(req.user?.sub ?? 0)));
}));

/**
 * GET /api/v2/scheduling/admin/users
 * Return active users for policy allow-list selectors.
 */
router.get(
  "/users",
  asyncRoute(async (_req: AuthenticatedRequest, res: Response) => {
    const users = await listUsers();
    res.json({
      items: users
        .filter((user) => user.is_active && user.role !== "super_admin")
        .map((user) => ({
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          englishName: user.english_name,
          role: user.role,
        })),
    });
  })
);

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
    res.json(result);
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
    const body = req.body as CreatePolicyDraftDto;
    const policySetKey = String(body.policySetKey ?? "default").trim();
    const changeNote = body.changeNote ? String(body.changeNote) : null;

    if (!policySetKey) {
      throwValidationError([
        { field: "policySetKey", code: "required", message: "policySetKey is required" },
      ]);
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
 * Body: { policySnapshot: PolicySnapshotDto, changeNote?: string }
 */
router.put(
  "/policy/draft/:versionId",
  asyncRoute(async (req: AuthenticatedRequest, res: Response) => {
    const versionId = parseInt(String(req.params.versionId), 10);
    if (isNaN(versionId)) {
      throwValidationError([
        { field: "versionId", code: "invalid_number", message: "Invalid version ID" },
      ]);
    }

    const body = req.body as SavePolicyDraftDto;
    const policySnapshot = body.policySnapshot ?? null;
    const changeNote = body.changeNote ? String(body.changeNote) : null;

    validatePolicySnapshotBody(policySnapshot);

    const userId = Number(req.user?.sub ?? 0);

    const result = await savePolicyDraft(versionId, policySnapshot, userId, changeNote);

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
      throwValidationError([
        { field: "versionId", code: "invalid_number", message: "Invalid version ID" },
      ]);
    }

    const body = req.body as PublishPolicyDto;
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
      throwValidationError([
        { field: "versionId", code: "invalid_number", message: "Invalid version ID" },
      ]);
    }

    const diff = await previewPolicyImpact(versionId);
    res.json(diff);
  })
);

function validatePolicySnapshotBody(policySnapshot: unknown): void {
  const fieldErrors: FieldValidationErrorDto[] = [];
  const snapshot = policySnapshot as Record<string, unknown> | null;
  if (!snapshot || typeof snapshot !== "object") {
    throwValidationError([
      {
        field: "policySnapshot",
        code: "required",
        message: "policySnapshot is required",
      },
    ]);
  }

  const requiredArrays = [
    "categoryDailyLimits",
    "modalityBlockedRules",
    "examTypeRules",
    "specialQuotaRules",
    "specialReasonCodes",
  ];

  for (const key of requiredArrays) {
    if (!Array.isArray(snapshot[key])) {
      fieldErrors.push({
        field: `policySnapshot.${key}`,
        code: "invalid_type",
        message: `${key} must be an array`,
      });
    }
  }

  if (fieldErrors.length > 0) {
    throwValidationError(fieldErrors);
  }
}

function throwValidationError(fieldErrors: FieldValidationErrorDto[]): never {
  throw new SchedulingError(
    400,
    "Validation failed",
    ["validation_failed"],
    { fieldErrors }
  );
}

function requireDayMutationShape(body: { modalityId?: unknown; expectedPublishedVersionId?: unknown; date?: unknown; reason?: unknown } | null | undefined): void {
  const errors: FieldValidationErrorDto[] = [];
  if (!body || typeof body !== "object") errors.push({ field: "body", code: "required", message: "Request body is required" });
  if (!Number.isInteger(Number(body?.modalityId)) || Number(body?.modalityId) <= 0) errors.push({ field: "modalityId", code: "invalid_positive_integer", message: "modalityId must be a positive integer" });
  if (!Number.isInteger(Number(body?.expectedPublishedVersionId)) || Number(body?.expectedPublishedVersionId) <= 0) errors.push({ field: "expectedPublishedVersionId", code: "invalid_positive_integer", message: "expectedPublishedVersionId must be a positive integer" });
  if (typeof body?.date !== "string") errors.push({ field: "date", code: "required", message: "date is required" });
  if (typeof body?.reason !== "string") errors.push({ field: "reason", code: "required", message: "reason is required" });
  if (errors.length) throwValidationError(errors);
}

export { router as adminSchedulingV2Router };
