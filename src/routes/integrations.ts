import express, { Request, Response } from "express";
import { HttpError } from "../utils/http-error.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { isValidNationalId } from "../utils/national-id.js";
import { getIntegrationStatus, preparePrintJob, prepareScanSession } from "../services/integration-service.js";
import { runPacsCFind, searchPacsStudies, testPacsConnection } from "../services/pacs-service.js";
import type { AuthenticatedUserContext, UnknownRecord, UserId } from "../types/http.js";

interface IntegrationsAuthRequest {
  body?: unknown;
  user: AuthenticatedUserContext;
}

function requireUserSub(request: IntegrationsAuthRequest): UserId {
  if (!request.user.sub) {
    throw new HttpError(401, "Authentication required.");
  }

  return request.user.sub;
}

export const integrationsRouter = express.Router();

integrationsRouter.use(requireAuth);

integrationsRouter.get(
  "/status",
  asyncRoute(async (_req: Request, res: Response) => {
    const status = await getIntegrationStatus();
    res.json({ status });
  })
);

integrationsRouter.post(
  "/print-prepare",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as IntegrationsAuthRequest;
    const body = asUnknownRecord(request.body);
    const preparation = await preparePrintJob(
      {
        appointmentId: asOptionalUserId(body.appointmentId),
        outputType: asOptionalString(body.outputType)
      },
      requireUserSub(request)
    );
    res.json({ preparation });
  })
);

integrationsRouter.post(
  "/scan-prepare",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as IntegrationsAuthRequest;
    const body = asUnknownRecord(request.body);
    const preparation = await prepareScanSession(
      {
        appointmentId: asOptionalUserId(body.appointmentId),
        patientId: asOptionalUserId(body.patientId),
        documentType: asOptionalString(body.documentType),
        appointmentRefType: asOptionalString(body.appointmentRefType),
      },
      requireUserSub(request)
    );
    res.json({ preparation });
  })
);

integrationsRouter.post(
  "/pacs-cfind",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as IntegrationsAuthRequest;
    const body = asUnknownRecord(request.body);
    const patientNationalId = String(asOptionalString(body.patientNationalId) || "").replace(/\D/g, "");
    if (!isValidNationalId(patientNationalId)) {
      throw new HttpError(400, "National ID must contain exactly 12 digits.");
    }
    const studies = await runPacsCFind({
      patientNationalId,
      currentUserId: requireUserSub(request)
    });
    res.json({ studies });
  })
);

integrationsRouter.post(
  "/pacs-search",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as IntegrationsAuthRequest;
    const body = asUnknownRecord(request.body);
    const patientNationalId = String(asOptionalString(body.patientNationalId) || "").replace(/\D/g, "");
    if (!isValidNationalId(patientNationalId)) {
      throw new HttpError(400, "National ID must contain exactly 12 digits.");
    }
    const studies = await searchPacsStudies({
      criteria: { ...body, patientNationalId, patientId: patientNationalId },
      currentUserId: requireUserSub(request)
    });
    res.json({ studies });
  })
);

integrationsRouter.post(
  "/pacs-test",
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as IntegrationsAuthRequest;
    const body = asUnknownRecord(request.body);
    await testPacsConnection({ currentUserId: requireUserSub(request), overrides: body });
    res.json({ ok: true });
  })
);
