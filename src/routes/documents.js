// @ts-check

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { getDocumentAbsolutePath, getDocumentById, listDocuments, uploadDocument } from "../services/document-service.js";

/** @typedef {import("../types/http.js").AuthenticatedUserContext} AuthenticatedUserContext */
/** @typedef {import("../types/http.js").UnknownRecord} UnknownRecord */

/**
 * @typedef {object} DocumentsRequest
 * @property {UnknownRecord} [query]
 * @property {UnknownRecord} [body]
 * @property {{ documentId?: string }} [params]
 * @property {AuthenticatedUserContext} user
 */

export const documentsRouter = express.Router();

documentsRouter.use(requireAuth);

documentsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {DocumentsRequest} */ (req);
    const query = asUnknownRecord(request.query);
    const documents = await listDocuments({
      patientId: asOptionalUserId(query.patientId),
      appointmentId: asOptionalUserId(query.appointmentId)
    });
    res.json({ documents });
  })
);

documentsRouter.get(
  "/:documentId/view",
  asyncRoute(async (req, res) => {
    const request = /** @type {DocumentsRequest} */ (req);
    const document = await getDocumentById(String(request.params?.documentId || ""));
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
  asyncRoute(async (req, res) => {
    const request = /** @type {DocumentsRequest} */ (req);
    const document = await uploadDocument(request.body || {}, request.user.sub);
    res.status(201).json({ document });
  })
);
