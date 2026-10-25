import express, { NextFunction, Request, Response } from "express";
import { requireAnyRole, requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import {
  deleteDocumentById,
  getDocumentAbsolutePath,
  getDocumentById,
  listDocuments,
  readDocumentContent,
  toPublicDocumentResponse,
  uploadDocument,
} from "../services/document-service.js";
import { getRequestDocumentProtocolPolicy } from "../services/request-document-protocol-policy.js";

export const documentsRouter = express.Router();
const IDENTITY_DOCUMENT_ROLES = ["receptionist", "supervisor", "super_admin"];

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
    const visibleDocuments = documents.filter(
      (document) =>
        document.document_type !== "patient_identity_document" ||
        IDENTITY_DOCUMENT_ROLES.includes(req.user!.role)
    );
    res.json({ documents: visibleDocuments.map(toPublicDocumentResponse) });
  })
);

documentsRouter.get(
  "/:documentId/view",
  asyncRoute(async (req: Request, res: Response, next: NextFunction) => {
    const document = await getDocumentById(String(req.params.documentId || ""));
    if (
      document.document_type === "patient_identity_document" &&
      !IDENTITY_DOCUMENT_ROLES.includes(req.user!.role)
    ) {
      throw new HttpError(403, "Not authorized to view patient identity documents.");
    }
    const isIdentityDocument =
      document.document_type === "patient_identity_document";
    if (isIdentityDocument) {
      res.setHeader(
        "Cache-Control",
        "private, no-store, max-age=0"
      );
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
    const absolutePath = getDocumentAbsolutePath(document);
    res.setHeader("Content-Type", document.mime_type || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${String(document.original_filename || "document").replace(/"/g, "")}"`
    );
    res.sendFile(
      absolutePath,
      {
        cacheControl: !isIdentityDocument,
      },
      (error) => {
        if (!error) return;
        if (res.headersSent) {
          next(error);
          return;
        }
        void readDocumentContent(document)
          .then((content) => res.send(content))
          .catch(next);
      }
    );
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
    const isIdentityUpload =
      String(body.documentType ?? "").trim() === "patient_identity_document";
    if (String(body.documentType ?? '').trim() === 'gamma_knife') {
      throw new HttpError(403, 'Upload Gamma Knife documents through the assigned episode.');
    }
    if (isIdentityUpload && !IDENTITY_DOCUMENT_ROLES.includes(req.user!.role)) {
      throw new HttpError(403, "Not authorized to upload patient identity documents.");
    }
    const requestedSource = asOptionalString(body.source);
    const source = isIdentityUpload
      ? requestedSource || "manual_upload"
      : requestedSource === "naps2_webscan"
        ? requestedSource
        : "manual_upload";
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
        source,
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
    const document = await getDocumentById(String(req.params.documentId || ""));
    if (document.document_type === "patient_identity_document") {
      throw new HttpError(409, "Patient identity documents cannot be deleted; upload a replacement or revoke verification.");
    }
    const result = await deleteDocumentById(String(req.params.documentId || ""), req.user!.sub);
    res.json(result);
  })
);
