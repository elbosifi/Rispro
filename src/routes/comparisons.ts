import express, { type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asString } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import type { AuthenticatedUserContext } from "../types/http.js";
import {
  assignComparisonRequest,
  attachDocumentToComparisonRequest,
  cancelComparisonRequest,
  confirmComparisonMaterials,
  createComparisonRequest,
  deleteComparisonRequestDocument,
  finalizeComparisonRequest,
  findComparisonRequestById,
  getComparisonInternalLinkTarget,
  listComparisonRequestDocuments,
  listComparisonRequests,
  listPreviousCompletedStudiesForPatient,
  unassignComparisonRequest,
  uploadComparisonRequestDocument,
  type ComparisonActor,
} from "../services/comparison-request-service.js";
import type { DocumentRow } from "../services/document-service.js";

interface ComparisonsRequest extends Request {
  user?: AuthenticatedUserContext;
}

export const comparisonsRouter = express.Router();

comparisonsRouter.use(requireAuth);

function actor(req: ComparisonsRequest): ComparisonActor {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  return { userId: req.user.sub, appRole: req.user.role };
}

function toDocumentResponse(document: DocumentRow) {
  const { stored_path: _storedPath, content_sha256: _contentSha256, ...safeDocument } = document;
  return { ...safeDocument, stored_path: "" };
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
    res.json({
      comparisonRequests: await listComparisonRequests({
        status: asOptionalString(req.query.status) ?? null,
        q: asOptionalString(req.query.q) ?? null,
      }),
    });
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
  "/:comparisonRequestId/documents",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    requireComparisonRole(req, WORKLIST_ACCESS_ROLES, "This role cannot view comparison documents.");
    const documents = await listComparisonRequestDocuments(req.params.comparisonRequestId);
    res.json({ documents: documents.map(toDocumentResponse) });
  })
);

comparisonsRouter.post(
  "/:comparisonRequestId/documents",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    const body = asUnknownRecord(req.body);
    const document = await uploadComparisonRequestDocument(actor(req), req.params.comparisonRequestId, {
      originalFilename: body.originalFilename as string | undefined,
      mimeType: body.mimeType as string | undefined,
      fileContentBase64: body.fileContentBase64 as string | undefined,
      source: asOptionalString(body.source),
      pageCount: body.pageCount as number | null | undefined,
      scannerName: asOptionalString(body.scannerName),
      workstationName: asOptionalString(body.workstationName),
      appVersion: asOptionalString(body.appVersion),
    });
    res.status(201).json({ document: toDocumentResponse(document) });
  })
);

comparisonsRouter.post(
  "/:comparisonRequestId/documents/:documentId/attach",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    const document = await attachDocumentToComparisonRequest(actor(req), req.params.comparisonRequestId, req.params.documentId);
    res.json({ document: toDocumentResponse(document) });
  })
);

comparisonsRouter.delete(
  "/:comparisonRequestId/documents/:documentId",
  asyncRoute(async (req: ComparisonsRequest, res: Response) => {
    res.json(await deleteComparisonRequestDocument(actor(req), req.params.comparisonRequestId, req.params.documentId));
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
