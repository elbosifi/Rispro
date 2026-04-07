import express, { Request, Response } from "express";
import { requireAuth, requireSupervisor, requireRecentSupervisorReauth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { HttpError } from "../utils/http-error.js";
import {
  listPacsNodes,
  createPacsNode,
  updatePacsNode,
  deletePacsNode
} from "../services/pacs-node-service.js";
import { testPacsConnection, searchPacsStudies } from "../services/pacs-service.js";
import type { AuthenticatedUserContext, UnknownRecord, UserId } from "../types/http.js";

const supervisorMiddleware = [requireAuth, requireSupervisor, requireRecentSupervisorReauth];
const authMiddleware = [requireAuth];

export const pacsRouter = express.Router();

// ---------------------------------------------------------------------------
// PACS Node CRUD (supervisor only)
// ---------------------------------------------------------------------------

pacsRouter.get(
  "/nodes",
  ...supervisorMiddleware,
  asyncRoute(async (_req: Request, res: Response) => {
    const nodes = await listPacsNodes();
    res.json({ nodes });
  })
);

pacsRouter.post(
  "/nodes",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const node = await createPacsNode(asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.status(201).json({ node });
  })
);

pacsRouter.put(
  "/nodes/:nodeId",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext; params?: { nodeId?: string } };
    const nodeId = asOptionalString(request.params?.nodeId);

    if (!nodeId) {
      throw new HttpError(400, "nodeId is required.");
    }

    const node = await updatePacsNode(nodeId, asUnknownRecord(request.body ?? {}), request.user.sub as UserId);
    res.json({ node });
  })
);

pacsRouter.delete(
  "/nodes/:nodeId",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { user: AuthenticatedUserContext; params?: { nodeId?: string } };
    const nodeId = asOptionalString(request.params?.nodeId);

    if (!nodeId) {
      throw new HttpError(400, "nodeId is required.");
    }

    const result = await deletePacsNode(nodeId, request.user.sub as UserId);
    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// Test connection (supervisor only – uses node ID or ad-hoc params)
// ---------------------------------------------------------------------------

pacsRouter.post(
  "/test",
  ...supervisorMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const body = asUnknownRecord(request.body ?? {});
    const nodeId = asOptionalUserId(body.nodeId);

    const overrides: UnknownRecord = {};

    if (nodeId) {
      const { getPacsNode } = await import("../services/pacs-node-service.js");
      const node = await getPacsNode(nodeId);
      overrides.enabled = "enabled";
      overrides.host = node.host;
      overrides.port = node.port;
      overrides.calledAeTitle = node.called_ae_title;
      overrides.callingAeTitle = node.calling_ae_title;
      overrides.timeoutSeconds = node.timeout_seconds;
    } else if (body.host) {
      overrides.host = body.host;
      overrides.port = body.port;
      overrides.calledAeTitle = body.calledAeTitle;
      overrides.callingAeTitle = body.callingAeTitle;
      overrides.timeoutSeconds = body.timeoutSeconds;
    }

    await testPacsConnection({ currentUserId: request.user.sub as UserId, overrides });
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Advanced search (any authenticated user, no supervisor re-auth)
// ---------------------------------------------------------------------------

pacsRouter.post(
  "/search",
  ...authMiddleware,
  asyncRoute(async (req: Request, res: Response) => {
    const request = req as { body?: unknown; user: AuthenticatedUserContext };
    const body = asUnknownRecord(request.body ?? {});
    const nodeId = asOptionalUserId(body.nodeId);

    // Build search criteria
    const criteria: Record<string, unknown> = {};

    const patientNationalId = String(asOptionalString(body.patientNationalId) || "").replace(/\D/g, "");
    const patientName = asOptionalString(body.patientName);
    const accessionNumber = asOptionalString(body.accessionNumber);
    const studyDate = asOptionalString(body.studyDate);
    const modality = asOptionalString(body.modality);

    if (patientNationalId) {
      criteria.patientNationalId = patientNationalId;
      criteria.patientId = patientNationalId;
    }

    if (patientName) {
      criteria.patientName = patientName;
    }

    if (accessionNumber) {
      criteria.accessionNumber = accessionNumber;
    }

    if (studyDate) {
      criteria.studyDate = studyDate;
    }

    if (modality) {
      criteria.modality = modality;
    }

    // Require at least one search field
    if (Object.keys(criteria).length === 0) {
      throw new HttpError(400, "At least one search field is required (national ID, patient name, accession number, study date, or modality).");
    }

    // If nodeId provided, use that node; otherwise use default
    if (nodeId) {
      const { getPacsNode } = await import("../services/pacs-node-service.js");
      const node = await getPacsNode(nodeId);

      if (!node) {
        throw new HttpError(404, "PACS node not found.");
      }

      const { searchPacsStudiesWithNode } = await import("../services/pacs-service.js");
      const studies = await searchPacsStudiesWithNode({
        criteria,
        node,
        currentUserId: request.user.sub as UserId
      });

      res.json({ studies, node: { id: node.id, name: node.name } });
    } else {
      // Use default node or legacy behavior
      const studies = await searchPacsStudies({
        criteria,
        currentUserId: request.user.sub as UserId
      });

      res.json({ studies });
    }
  })
);
