import express, { type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import type { AuthenticatedUserContext } from "../types/http.js";
import {
  assignComparisonRequest,
  cancelComparisonRequest,
  confirmComparisonMaterials,
  createComparisonRequest,
  finalizeComparisonRequest,
  findComparisonRequestById,
  getComparisonInternalLinkTarget,
  listComparisonRequests,
  listPreviousCompletedStudiesForPatient,
  unassignComparisonRequest,
  type ComparisonActor,
} from "../services/comparison-request-service.js";

interface ComparisonsRequest extends Request {
  user?: AuthenticatedUserContext;
}

export const comparisonsRouter = express.Router();

comparisonsRouter.use(requireAuth);

function actor(req: ComparisonsRequest): ComparisonActor {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  return { userId: req.user.sub, appRole: req.user.role };
}

type ComparisonRole = ComparisonActor["appRole"];

const CREATE_ACCESS_ROLES = new Set<ComparisonRole>([
  "receptionist",
  "administrative",
  "modality_staff",
  "doctor",
  "supervisor",
  "super_admin",
]);
const WORKLIST_ACCESS_ROLES = new Set<ComparisonRole>(["modality_staff", "doctor", "supervisor", "super_admin"]);

function requireComparisonRole(req: ComparisonsRequest, allowedRoles: Set<ComparisonRole>, message: string): ComparisonActor {
  const currentActor = actor(req);
  if (!allowedRoles.has(currentActor.appRole)) throw new HttpError(403, message);
  return currentActor;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

comparisonsRouter.get(
  "/patients/:patientId/previous-studies",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    requireComparisonRole(req, CREATE_ACCESS_ROLES, "This role cannot request comparison studies.");
    res.json({ studies: await listPreviousCompletedStudiesForPatient(req.params.patientId) });
  })
);

comparisonsRouter.get(
  "/",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    requireComparisonRole(req, WORKLIST_ACCESS_ROLES, "This role cannot view comparison requests.");
    res.json({ comparisonRequests: await listComparisonRequests({ status: asOptionalString(req.query.status) ?? null }) });
  })
);

comparisonsRouter.post(
  "/",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const comparisonRequest = await createComparisonRequest(actor(req), {
      patientId: body.patientId,
      linkedPreviousBookingId: body.linkedPreviousBookingId,
      reason: body.reason,
    });
    res.status(201).json({ comparisonRequest });
  })
);

comparisonsRouter.get(
  "/:comparisonRequestId",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    requireComparisonRole(req, WORKLIST_ACCESS_ROLES, "This role cannot view comparison requests.");
    const comparisonRequest = await findComparisonRequestById(req.params.comparisonRequestId);
    if (!comparisonRequest) throw new HttpError(404, "Comparison request not found.");
    res.json({ comparisonRequest });
  })
);

comparisonsRouter.get(
  "/:comparisonRequestId/internal-link-target",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    const currentActor = requireComparisonRole(req, WORKLIST_ACCESS_ROLES, "This role cannot open comparison requests.");
    res.json(await getComparisonInternalLinkTarget(currentActor, req.params.comparisonRequestId));
  })
);

comparisonsRouter.post(
  "/:comparisonRequestId/confirm-materials",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const comparisonRequest = await confirmComparisonMaterials(actor(req), req.params.comparisonRequestId, {
      imageAvailabilityConfirmed: body.imageAvailabilityConfirmed,
      documentsAvailabilityConfirmed: body.documentsAvailabilityConfirmed,
      selectedPriorConfirmed: body.selectedPriorConfirmed,
      note: body.materialsConfirmationNote ?? body.note,
    });
    res.json({ comparisonRequest });
  })
);

comparisonsRouter.post(
  "/:comparisonRequestId/assign",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.json(await assignComparisonRequest(actor(req), req.params.comparisonRequestId, {
      doctorId: requiredPositiveInteger(body.doctorId, "doctorId"),
      reason: asOptionalString(body.reason) ?? null,
    }));
  })
);

comparisonsRouter.post(
  "/:comparisonRequestId/unassign",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    res.json(await unassignComparisonRequest(actor(req), req.params.comparisonRequestId, asString(body.reason)));
  })
);

comparisonsRouter.post(
  "/:comparisonRequestId/finalize",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const comparisonRequest = await finalizeComparisonRequest(actor(req), req.params.comparisonRequestId, body.finalText);
    res.json({ comparisonRequest });
  })
);

comparisonsRouter.post(
  "/:comparisonRequestId/cancel",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const comparisonRequest = await cancelComparisonRequest(actor(req), req.params.comparisonRequestId, body.reason);
    res.json({ comparisonRequest });
  })
);
