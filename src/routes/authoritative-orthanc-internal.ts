import * as crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import { env } from "../config/env.js";
import { recordInboundDicomReception } from "../services/dicom-transfer-event-service.js";
import { asyncRoute } from "../utils/async-route.js";
import { HttpError } from "../utils/http-error.js";
import { asUnknownRecord } from "../utils/records.js";

export const authoritativeOrthancInternalRouter = express.Router();

function hasValidAuthoritativeOrthancSecret(req: Request): boolean {
  const provided = String(req.headers["x-rispro-authoritative-orthanc-secret"] || "");
  const expected = String(env.jwtSecret || "");
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

authoritativeOrthancInternalRouter.post("/received", asyncRoute(async (req: Request, res: Response) => {
  if (!hasValidAuthoritativeOrthancSecret(req)) throw new HttpError(401, "Invalid internal Authoritative Orthanc secret.");
  const result = await recordInboundDicomReception(asUnknownRecord(req.body));
  res.status(result.deduplicated ? 200 : 201).json({ ok: true, ...result });
}));
