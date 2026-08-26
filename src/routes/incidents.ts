import express, { type Request, type Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  getIncident,
  listIncidentEquipment,
  listIncidents,
  createIncident,
  reviewIncident,
} from "../services/incident-service.js";
import {
  listDocuments,
  toPublicDocumentResponse,
  uploadDocument,
} from "../services/document-service.js";

export const incidentsRouter = express.Router();
const ALL = [
  "receptionist",
  "modality_staff",
  "doctor",
  "administrative",
  "supervisor",
  "super_admin",
] as never[];
const REVIEW = ["administrative", "supervisor", "super_admin"] as never[];
incidentsRouter.use(requireAuth, requireAnyRole(ALL));
incidentsRouter.get(
  "/lookups/equipment",
  asyncRoute(async (_req: Request, res: Response) => {
    res.json({ equipment: await listIncidentEquipment() });
  }),
);
incidentsRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const query = asUnknownRecord(req.query);
    res.json({
      incidents: await listIncidents({
        incidentType: query.incidentType,
        status: query.status,
      }),
    });
  }),
);
incidentsRouter.get(
  "/:id",
  asyncRoute(async (req: Request, res: Response) => {
    res.json({ incident: await getIncident(req.params.id) });
  }),
);
incidentsRouter.post(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    res
      .status(201)
      .json({
        incident: await createIncident(
          asUnknownRecord(req.body),
          req.user!.sub,
        ),
      });
  }),
);
incidentsRouter.patch(
  "/:id/review",
  requireAnyRole(REVIEW),
  asyncRoute(async (req: Request, res: Response) => {
    res.json({
      incident: await reviewIncident(
        req.params.id,
        asUnknownRecord(req.body),
        req.user!.sub,
      ),
    });
  }),
);
incidentsRouter.get(
  "/:id/attachments",
  asyncRoute(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    await getIncident(id);
    res.json({
      documents: (await listDocuments({ incidentId: id })).map(
        toPublicDocumentResponse,
      ),
    });
  }),
);
incidentsRouter.post(
  "/:id/attachments",
  express.json({ limit: "70mb" }),
  asyncRoute(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    await getIncident(id);
    const body = asUnknownRecord(req.body);
    const document = await uploadDocument(
      {
        incidentId: id,
        documentType: "incident_attachment",
        source: "manual_upload",
        originalFilename: String(body.originalFilename ?? ""),
        mimeType: String(body.mimeType ?? ""),
        fileContentBase64: String(body.fileContentBase64 ?? ""),
      },
      req.user!.sub,
    );
    res.status(201).json({ document: toPublicDocumentResponse(document) });
  }),
);
