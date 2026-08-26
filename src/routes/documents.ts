import express, { Request, Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  deleteDocumentById,
  getDocumentAbsolutePath,
  getDocumentById,
  listDocuments,
  toPublicDocumentResponse,
  uploadDocument,
} from "../services/document-service.js";
import { getRequestDocumentProtocolPolicy } from "../services/request-document-protocol-policy.js";

export const documentsRouter = express.Router();

documentsRouter.use(requireAuth);

documentsRouter.get(
  "/protocol-eligibility-policy",
  asyncRoute(async (req: Request, res: Response) => {
    const appointmentId = asOptionalUserId(asUnknownRecord(req.query).appointmentId);
    res.json(await getRequestDocumentProtocolPolicy(appointmentId ? Number(appointmentId) : undefined));
  })
);

documentsRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const query = asUnknownRecord(req.query);
    const incidentId = query.incidentId ?? query.incident_id;
    if (incidentId != null && String(incidentId).trim() !== "") {
      res.status(400).json({ error: { message: "incidentId is only supported by the incident attachment endpoint." } });
      return;
    }
    const documents = await listDocuments({
      patientId: asOptionalUserId(query.patientId),
      appointmentId: asOptionalUserId(query.appointmentId),
      appointmentRefType: asOptionalString(query.appointmentRefType),
    });
    res.json({ documents: documents.map(toPublicDocumentResponse) });
  })
);

documentsRouter.get(
  "/:documentId/view",
  asyncRoute(async (req: Request, res: Response) => {
    const document = await getDocumentById(String(req.params.documentId || ""));
    const absolutePath = getDocumentAbsolutePath(document);
    res.setHeader("Content-Type", document.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${String(document.original_filename || "document").replace(/"/g, "")}"`
    );
    res.sendFile(absolutePath);
  })
);

documentsRouter.post(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    if (body.incidentId != null && String(body.incidentId).trim() !== "") {
      res.status(400).json({ error: { message: "incidentId is only supported by the incident attachment endpoint." } });
      return;
    }
    const document = await uploadDocument(
      {
        documentType: asOptionalString(body.documentType),
        originalFilename: asOptionalString(body.originalFilename),
        mimeType: asOptionalString(body.mimeType),
        fileContentBase64: asOptionalString(body.fileContentBase64),
        fileContentBuffer: Buffer.isBuffer(body.fileContentBuffer) ? body.fileContentBuffer : undefined,
        fileSourcePath: asOptionalString(body.fileSourcePath),
        scanSessionId: asOptionalUserId(body.scanSessionId),
        pageCount: typeof body.pageCount === "number" ? body.pageCount : undefined,
        scannerName: asOptionalString(body.scannerName),
        workstationName: asOptionalString(body.workstationName),
        appVersion: asOptionalString(body.appVersion),
        idempotencyKey: asOptionalString(body.idempotencyKey),
        requestScanJobId: typeof body.requestScanJobId === "number" ? body.requestScanJobId : undefined,
        patientId: asOptionalUserId(body.patientId),
        appointmentId: asOptionalUserId(body.appointmentId),
        appointmentRefType: asOptionalString(body.appointmentRefType),
        source: asOptionalString(body.source),
      },
      req.user!.sub
    );
    res.status(201).json({ document: toPublicDocumentResponse(document) });
  })
);

documentsRouter.delete(
  "/:documentId",
  requireAnyRole(["supervisor", "super_admin"]),
  asyncRoute(async (req: Request, res: Response) => {
    const result = await deleteDocumentById(String(req.params.documentId || ""), req.user!.sub);
    res.json(result);
  })
);
