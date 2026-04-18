import express, { Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  deleteDocumentById,
  getDocumentAbsolutePath,
  getDocumentById,
  listDocuments,
  uploadDocument,
} from "../services/document-service.js";

export const documentsRouter = express.Router();

documentsRouter.use(requireAuth);

documentsRouter.get(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const query = asUnknownRecord(req.query);
    const documents = await listDocuments({
      patientId: asOptionalUserId(query.patientId),
      appointmentId: asOptionalUserId(query.appointmentId),
      appointmentRefType: asOptionalString(query.appointmentRefType),
    });
    res.json({ documents });
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
    const document = await uploadDocument(
      {
        ...body,
        patientId: asOptionalUserId(body.patientId),
        appointmentId: asOptionalUserId(body.appointmentId),
        appointmentRefType: asOptionalString(body.appointmentRefType),
      },
      req.user!.sub
    );
    res.status(201).json({ document });
  })
);

documentsRouter.delete(
  "/:documentId",
  asyncRoute(async (req: Request, res: Response) => {
    const result = await deleteDocumentById(String(req.params.documentId || ""), req.user!.sub);
    res.json(result);
  })
);
