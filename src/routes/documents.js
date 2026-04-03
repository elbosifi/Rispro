// @ts-check

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { getDocumentAbsolutePath, getDocumentById, listDocuments, uploadDocument } from "../services/document-service.js";

/**
 * @typedef {object} DocumentsRequest
 * @property {Record<string, unknown>} [query]
 * @property {Record<string, unknown>} [body]
 * @property {{ documentId?: string }} [params]
 * @property {{ sub: number | string, role: string }} [user]
 */

export const documentsRouter = express.Router();

documentsRouter.use(requireAuth);

/**
 * @param {unknown} value
 * @returns {string | number | undefined}
 */
function asOptionalFilterValue(value) {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  return String(value);
}

documentsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const request = /** @type {DocumentsRequest} */ (req);
    const query = /** @type {Record<string, unknown>} */ (request.query || {});
    const documents = await listDocuments({
      patientId: asOptionalFilterValue(query.patientId),
      appointmentId: asOptionalFilterValue(query.appointmentId)
    });
    res.json({ documents });
  })
);

documentsRouter.get(
  "/:documentId/view",
  asyncRoute(async (req, res) => {
    const request = /** @type {DocumentsRequest} */ (req);
    const document = await getDocumentById(request.params?.documentId);
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
    const document = await uploadDocument(request.body || {}, request.user?.sub);
    res.status(201).json({ document });
  })
);
