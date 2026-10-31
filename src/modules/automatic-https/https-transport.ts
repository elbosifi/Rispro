import { readFileSync } from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { Request, Response, NextFunction } from "express";
import { HttpError } from "../../utils/http-error.js";
import { isBootstrapAddress } from "./https-configuration.js";

export function httpsRuntimeDirectory(): string { return process.env.RISPRO_HTTPS_RUNTIME_DIR || "storage/automatic-https"; }
export function gatewayIdentity(): string { return readFileSync(process.env.RISPRO_HTTPS_GATEWAY_IDENTITY_FILE || "/run/secrets/https_gateway_identity", "utf8").trim(); }
export function bootstrapIp(): string | null {
  try {
    const value = readFileSync(process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE || "/run/secrets/https_bootstrap_ip", "utf8").trim();
    return isBootstrapAddress(value) ? value : null;
  } catch { return null; }
}
export function bootstrapIpError(): string {
  try {
    const value = readFileSync(process.env.RISPRO_HTTPS_BOOTSTRAP_IP_FILE || "/run/secrets/https_bootstrap_ip", "utf8").trim();
    const reasons: Record<string, string> = { "!route-unavailable": "The server routing table could not be read.", "!no-default-route": "No eligible default route was found.", "!ambiguous-routes": "Multiple default routes have the same lowest metric.", "!ambiguous-addresses": "The default interface has multiple eligible IPv4 addresses.", "!no-unicast-address": "The default interface has no eligible unicast IPv4 address." };
    return reasons[value] || "The bootstrap IP file is empty or invalid; rerun the supported setup or update.";
  } catch { return "The bootstrap IP file is unavailable; rerun the supported setup or update."; }
}
export function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

export function activeHttpsOrigin(): string | null {
  if (process.env.RISPRO_HTTPS_PROVISIONED !== "true") return null;
  try { return JSON.parse(readFileSync(path.join(httpsRuntimeDirectory(), "active-origin.json"), "utf8")).origin || null; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error("HTTPS activation state is unreadable.");
  }
}

export type HttpsTransportRequest = Partial<Pick<Request, "secure" | "headers" | "socket">>;
export function trustedHttpsRequest(req: HttpsTransportRequest): boolean {
  if (process.env.RISPRO_HTTPS_PROVISIONED !== "true") return Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted);
  return Boolean(req.secure) && equalSecret(String(req.headers?.["x-rispro-https-gateway"] || ""), gatewayIdentity());
}

export function temporaryBootstrapRequest(req: HttpsTransportRequest): boolean {
  return process.env.RISPRO_HTTPS_PROVISIONED === "true" && trustedHttpsRequest(req) && equalSecret(String(req.headers?.["x-rispro-temporary-bootstrap"] || ""), gatewayIdentity());
}

export const BOOTSTRAP_COOKIE = "rispro_https_bootstrap";
export function bootstrapSessionHash(session: string): string { return createHash("sha256").update(session).digest("hex"); }
export function bootstrapAuthorized(req: Request): boolean {
  try {
    const session = req.cookies?.[`${env.cookieName}_https`];
    const value = jwt.verify(String(req.cookies?.[BOOTSTRAP_COOKIE] || ""), env.jwtSecret) as { purpose?: string; session?: string };
    return Boolean(session && value.purpose === "https-bootstrap" && equalSecret(value.session || "", bootstrapSessionHash(session)));
  } catch { return false; }
}

// Cookies are scoped to hosts, not ports. Separate names preserve existing HTTP
// sessions while Secure HTTPS sessions are tested on the same LAN hostname.
export function httpsCookieName(name: string, req?: HttpsTransportRequest): string { return req && trustedHttpsRequest(req) ? `${name}_https` : name; }

export function protectedBootstrapRequest(req: Request): boolean {
  if (process.env.RISPRO_HTTPS_PROVISIONED !== "true") return false;
  return equalSecret(String(req.headers["x-rispro-local-bootstrap"] || ""), gatewayIdentity())
    && /^(?:localhost|127\.0\.0\.1)$/.test(req.hostname)
    && (!req.headers.origin || ["http://localhost:3001", "http://127.0.0.1:3001"].includes(String(req.headers.origin)));
}

export function requireHttpsManagementTransport(req: Request, _res: Response, next: NextFunction): void {
  if (!httpsManagementTransportReady(req)) return next(new HttpError(403,
    "Use the trusted RISpro HTTPS address, or the protected local bootstrap at http://localhost:3001 (locally or through an SSH port forward)."));
  next();
}

export function httpsManagementTransportReady(req: Request): boolean {
  if (temporaryBootstrapRequest(req)) return bootstrapAuthorized(req);
  return trustedHttpsRequest(req) || protectedBootstrapRequest(req);
}

export function enforceAutomaticHttps(req: Request, res: Response, next: NextFunction): void {
  const origin = activeHttpsOrigin();
  if (!origin || transportAllowed(req, req.path)) return next();
  res.setHeader("Cache-Control", "no-store");
  res.redirect(307, `${origin}${req.originalUrl.startsWith("/") ? req.originalUrl : "/"}`);
}

function transportAllowed(req: Request, requestPath: string): boolean {
  if (trustedHttpsRequest(req) || requestPath === "/api/health" || requestPath.startsWith("/api/internal/automatic-https/acmedns/")) return true;
  // Local bootstrap remains restricted to administrator recovery after cutover.
  return protectedBootstrapRequest(req) && (requestPath.startsWith("/api/settings/https") || requestPath.startsWith("/api/auth/")
    || requestPath === "/api/settings/deployment-identity"
    || requestPath === "/api/public/printing-bootstrap/manifest" || !requestPath.startsWith("/api/"));
}

// Nginx uses this fixed, body-free authorization subrequest for its own static
// OHIF routes too, but only when the administrator explicitly enables redirects.
export function httpsTransportPolicy(req: Request, res: Response): void {
  const origin = activeHttpsOrigin();
  const requestPath = String(req.headers["x-rispro-original-uri"] || "/").split("?")[0];
  if (!origin || transportAllowed(req, requestPath)) { res.sendStatus(204); return; }
  res.setHeader("X-Rispro-Https-Redirect", origin);
  res.sendStatus(401);
}
