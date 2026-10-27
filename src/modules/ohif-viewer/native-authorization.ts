import { createHash, timingSafeEqual } from "node:crypto";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { Router } from "express";
import { env } from "../../config/env.js";
import { requireAuth } from "../../middleware/auth.js";
import { readAuthoritativeOrthancSettings } from "../../services/authoritative-orthanc-service.js";
import { asyncRoute } from "../../utils/async-route.js";
import { asUnknownRecord } from "../../utils/records.js";
import { authorizeViewerDicomWebRequest } from "./service.js";
import { isValidDicomUid } from "./validation.js";

function equalSecret(left: string, right: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}

// Only the Authorization plugin calls this route. Pixels never enter Express.
export const ohifNativeAuthorizationRouter = Router();
ohifNativeAuthorizationRouter.post(["/tokens/validate", "/user/get-profile"], asyncRoute(async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  if (!env.ohifNativeAuthSecret) {
    res.status(503).json({ granted: false, validity: 1 });
    return;
  }
  const serviceAuth = "Basic " + Buffer.from("rispro:" + env.ohifNativeAuthSecret).toString("base64");
  if (!equalSecret(String(req.headers.authorization || ""), serviceAuth)) {
    res.status(401).json({ granted: false, validity: 1 });
    return;
  }
  const body = asUnknownRecord(req.body);
  const key = String(body["token-key"] || "").toLowerCase();
  const value = String(body["token-value"] || "");
  // Preserve the archive's existing server-to-server Basic credential. Native
  // browser traffic has Authorization stripped by nginx and uses the login below.
  if (key === "authorization") {
    const archive = await readAuthoritativeOrthancSettings();
    const expected = "Basic " + Buffer.from(archive.username + ":" + archive.password).toString("base64");
    const granted = Boolean(archive.enabled && archive.username && archive.password && equalSecret(value, expected));
    if (req.path === "/user/get-profile") {
      res.status(granted ? 200 : 403).json({ name: "RISpro archive service", permissions: granted ? ["all"] : [], "authorized-labels": granted ? ["*"] : [], validity: 1 });
    } else res.json({ granted, validity: 1 });
    return;
  }
  if (req.path === "/user/get-profile") {
    // Resource tokens have no user permissions. A valid empty profile lets the
    // plugin continue to study validation without an HTTP credential exception.
    res.json({ name: "", permissions: [], "authorized-labels": [], validity: 1 });
    return;
  }
  if (!env.ohifEnabled || !env.ohifNativeDeliveryEnabled) {
    res.json({ granted: false, validity: 1 });
    return;
  }
  const match = /^([a-f0-9-]{36})\|(.+)$/i.exec(value);
  // The private archive's DICOMweb plugin rechecks read-only lookups through
  // POST /tools/find. The public nginx route accepts GET only; administrative
  // Orthanc REST/STOW routes must remain private, never exposed by this route.
  if (key !== "x-rispro-viewer" || !["get", "post"].includes(String(body.method)) || body.level !== "study" || !isValidDicomUid(body["dicom-uid"]) || !match) {
    res.json({ granted: false, validity: 1 });
    return;
  }
  res.locals.ohifContext = match[1];
  req.headers.cookie = match[2];
  delete req.cookies;
  cookieParser()(req, res, next);
}), requireAuth, asyncRoute(async (req, res) => {
  const body = asUnknownRecord(req.body);
  try {
    const session = await authorizeViewerDicomWebRequest({
      userId: req.user!.sub, appRole: req.user!.role, launchToken: "", contextId: res.locals.ohifContext,
      relativePathWithQuery: "/studies/" + body["dicom-uid"],
    });
    const login = jwt.decode(String(req.cookies?.[env.cookieName] || ""));
    const loginExpiry = login && typeof login === "object" && typeof login.exp === "number" ? login.exp * 1000 : 0;
    // One second bounds revocation staleness and coalesces same-study checks in
    // the official plugin cache. Never grant a cache entry past either expiry.
    const expiresAt = Math.min(new Date(session.expiresAt).getTime(), loginExpiry);
    res.json({ granted: session.accessStrategy === "authoritative_orthanc" && expiresAt - Date.now() >= 1000 && !req.user!.mustChangePassword, validity: 1 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "statusCode" in error && [401, 403, 404].includes(Number(error.statusCode))) {
      res.json({ granted: false, validity: 1 });
      return;
    }
    throw error;
  }
}));
