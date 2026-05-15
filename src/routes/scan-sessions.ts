import Busboy from "busboy";
import express, { Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import { asOptionalString, asOptionalUserId } from "../utils/request-coercion.js";
import { asUnknownRecord } from "../utils/records.js";
import { HttpError } from "../utils/http-error.js";
import { MAX_DOCUMENT_BYTES } from "../services/document-service.js";
import {
  cancelScanSession,
  createScanSession,
  getScanSessionContextByToken,
  markScanSessionOpened,
  uploadScanSessionDocument,
} from "../services/scan-session-service.js";

export const scanSessionsRouter = express.Router();

interface MultipartScanUpload {
  fileBuffer: Buffer;
  originalFilename: string;
  mimeType: string;
  fields: Record<string, string>;
}

function readScanToken(req: Request): string {
  return String(req.header("X-RISpro-Scan-Token") || "").trim();
}

function parseScanUploadMultipart(req: Request): Promise<MultipartScanUpload> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let uploadFinished = false;
    let fileChunks: Buffer[] = [];
    let fileSize = 0;
    let originalFilename = "";
    let mimeType = "";
    const fields: Record<string, string> = {};

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: MAX_DOCUMENT_BYTES + 1,
      },
    });

    const interruptUpload = () => {
      if (settled || uploadFinished) return;
      req.unpipe(busboy);
      busboy.destroy(new HttpError(400, "Scan upload was interrupted. Please retry the upload."));
      fail(new HttpError(400, "Scan upload was interrupted. Please retry the upload."));
    };

    req.on("aborted", interruptUpload);
    req.on("close", () => {
      const requestComplete = Boolean((req as Request & { complete?: boolean }).complete);
      if (!requestComplete && !uploadFinished) interruptUpload();
    });

    busboy.on("file", (fieldName, file, info) => {
      if (fieldName !== "file" || originalFilename) {
        file.resume();
        return;
      }
      originalFilename = String(info.filename || "scan.pdf");
      mimeType = String(info.mimeType || "application/octet-stream");

      file.on("data", (chunk: Buffer) => {
        fileSize += chunk.length;
        fileChunks.push(chunk);
      });
      file.on("limit", () => fail(new HttpError(413, "Uploaded document exceeds the 50 MB limit.")));
      file.on("error", fail);
    });

    busboy.on("field", (fieldName, value) => {
      fields[fieldName] = String(value || "");
    });
    busboy.on("filesLimit", () => fail(new HttpError(400, "Only one scanned document can be uploaded per scan session.")));
    busboy.on("error", fail);
    busboy.on("finish", () => {
      uploadFinished = true;
      if (settled) return;
      settled = true;
      if (!originalFilename || fileChunks.length === 0) {
        reject(new HttpError(400, "Scanned document file is required."));
        return;
      }
      resolve({
        fileBuffer: Buffer.concat(fileChunks, fileSize),
        originalFilename,
        mimeType,
        fields,
      });
    });

    req.pipe(busboy);
  });
}

scanSessionsRouter.post(
  "/",
  requireAuth,
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const session = await createScanSession({
      appointmentId: asOptionalUserId(body.appointmentId),
      appointmentRefType: asOptionalString(body.appointmentRefType),
      patientId: asOptionalUserId(body.patientId),
      documentType: asOptionalString(body.documentType),
      currentUserId: req.user!.sub,
    });
    res.status(201).json(session);
  })
);

scanSessionsRouter.get(
  "/context",
  asyncRoute(async (req: Request, res: Response) => {
    const context = await getScanSessionContextByToken(readScanToken(req));
    res.json({ context });
  })
);

scanSessionsRouter.post(
  "/opened",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await markScanSessionOpened(readScanToken(req), {
      workstationName: asOptionalString(body.workstationName),
      appVersion: asOptionalString(body.appVersion),
    });
    res.json(result);
  })
);

scanSessionsRouter.post(
  "/upload",
  asyncRoute(async (req: Request, res: Response) => {
    const upload = await parseScanUploadMultipart(req);
    const result = await uploadScanSessionDocument(readScanToken(req), {
      fileBuffer: upload.fileBuffer,
      originalFilename: upload.originalFilename,
      mimeType: upload.mimeType,
      documentType: upload.fields.documentType,
      pageCount: upload.fields.pageCount ? Number(upload.fields.pageCount) : null,
      scannerName: upload.fields.scannerName,
      workstationName: upload.fields.workstationName,
      appVersion: upload.fields.appVersion,
    });
    res.status(201).json({ sessionId: result.sessionId, document: result.document });
  })
);

scanSessionsRouter.post(
  "/cancel",
  asyncRoute(async (req: Request, res: Response) => {
    const body = asUnknownRecord(req.body);
    const result = await cancelScanSession(readScanToken(req), {
      lastError: asOptionalString(body.lastError),
    });
    res.json(result);
  })
);
