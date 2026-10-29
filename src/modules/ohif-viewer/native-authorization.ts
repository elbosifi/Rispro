import { createHash, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { readAuthoritativeOrthancSettings } from "../../services/authoritative-orthanc-service.js";
import { asyncRoute } from "../../utils/async-route.js";
import { HttpError } from "../../utils/http-error.js";
import { authorizeViewerDicomWebRequest } from "./service.js";
import { isValidDicomUid } from "./validation.js";

function equalSecret(left: string, right: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}

// Validate the raw URI before URL normalization. Only canonical study-scoped
// DICOMweb reads are supported; encoded separators/dot segments cannot escape it.
export function parseNativeDicomWebUri(uri: string): { contextId: string; relativePathWithQuery: string } {
  const match = /^\/ohif-native\/context\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})(\/[^?#]*)(\?[^#\s]*)?$/i.exec(uri);
  if (!match) throw new HttpError(403, "Invalid native DICOMweb path.");
  const parts = match[2].split("/").slice(1);
  const uid = () => {
    const value = parts.shift();
    if (!value || !isValidDicomUid(value) || value === "." || value === "..") throw new HttpError(403, "Invalid native DICOMweb UID.");
  };
  if (parts.shift() !== "studies") throw new HttpError(403, "A study-scoped request is required.");
  uid();
  let instance = false;
  for (const collection of ["series", "instances"]) {
    if (parts[0] !== collection) break;
    parts.shift();
    if (!parts.length) break;
    uid();
    instance = collection === "instances";
  }
  const resource = parts.join("/");
  if (resource && !/^(?:metadata|rendered|thumbnail)$/.test(resource) && !(instance && /^frames\/[1-9][0-9]*(?:,[1-9][0-9]*)*(?:\/rendered)?$/.test(resource))) {
    throw new HttpError(403, "Unsupported native DICOMweb resource.");
  }
  if (match[2].endsWith("/")) throw new HttpError(403, "Invalid native DICOMweb path.");
  return { contextId: match[1], relativePathWithQuery: match[2] + (match[3] || "") };
}

// Nginx auth_request only. This endpoint returns a credential in a PRIVATE
// response header, never to a viewer. Gate it BEFORE login or settings lookup.
export const ohifNativeAuthorizationRouter = Router();
ohifNativeAuthorizationRouter.get("/authorize", (req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!env.ohifEnabled || !env.ohifNativeDeliveryEnabled || !env.ohifNativeAuthSecret) {
    res.sendStatus(403);
    return;
  }
  if (!equalSecret(String(req.headers["x-rispro-native-gateway"] || ""), env.ohifNativeAuthSecret)) {
    res.sendStatus(403);
    return;
  }
  next();
}, requireAuth, asyncRoute(async (req, res) => {
  if (req.user!.mustChangePassword || req.headers["x-rispro-native-method"] !== "GET") throw new HttpError(403, "Native viewer access denied.");
  const request = parseNativeDicomWebUri(String(req.headers["x-rispro-native-uri"] || ""));
  const session = await authorizeViewerDicomWebRequest({
    userId: req.user!.sub, appRole: req.user!.role, launchToken: "", ...request,
  });
  if (session.accessStrategy !== "authoritative_orthanc") throw new HttpError(403, "Native delivery requires Authoritative Orthanc.");
  const archive = await readAuthoritativeOrthancSettings();
  // This transport intentionally supports the hospital's HTTP Basic model.
  // HTTPS needs a separately reviewed gateway trust/CA configuration.
  let origin: URL;
  try { origin = new URL(archive.baseUrl); } catch { throw new HttpError(403, "Authoritative Orthanc is unavailable."); }
  if (!archive.enabled || origin.protocol !== "http:" || ["orthanc", "rispro-orthanc"].includes(origin.hostname) || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !archive.username || !archive.password || archive.username.includes(":")) {
    throw new HttpError(403, "Native delivery requires an HTTP Authoritative Orthanc with Basic authentication.");
  }
  res.setHeader("X-Rispro-Orthanc-Origin", origin.origin);
  res.setHeader("X-Rispro-Orthanc-Authorization", "Basic " + Buffer.from(archive.username + ":" + archive.password).toString("base64"));
  res.setHeader("X-Rispro-Dicomweb-Path", request.relativePathWithQuery);
  res.status(204).end();
}));
