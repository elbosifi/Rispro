import { Readable } from "node:stream";
import { Router, type Request, type Response } from "express";
import { env } from "../../config/env.js";
import { requireAuth, requireRecentSupervisorReauth, requireSupervisor } from "../../middleware/auth.js";
import type { AuthenticatedUserContext } from "../../types/http.js";
import { HttpError } from "../../utils/http-error.js";
import { asyncRoute } from "../../utils/async-route.js";
import { asUnknownRecord } from "../../utils/records.js";
import { readOhifViewerConfiguration } from "./repository.js";
import {
  exchangeViewerLaunchToken,
  getOhifAdminConfiguration,
  getRetrievalStatusForDoctor,
  proxyAuthorizedDicomWebRequest,
  putOhifAdminConfiguration,
  runOhifDiagnostic,
} from "./service.js";

interface OhifRequest extends Request {
  user?: AuthenticatedUserContext;
}

function user(req: OhifRequest): AuthenticatedUserContext {
  if (!req.user) throw new HttpError(401, "Authentication required.");
  return req.user;
}

function actor(req: OhifRequest) {
  const current = user(req);
  return { userId: current.sub, appRole: current.role };
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new HttpError(400, `${field} must be a positive integer.`);
  return parsed;
}

export const ohifViewerRouter = Router();

ohifViewerRouter.get(
  "/availability",
  requireAuth,
  asyncRoute(async (_req: OhifRequest, res: Response) => {
    const configuration = await readOhifViewerConfiguration();
    res.json({
      enabled: env.ohifEnabled && configuration.settings.enabled,
      openMode: configuration.settings.openMode,
      configured: Boolean(configuration.settings.selectedPacsNodeId),
    });
  })
);

ohifViewerRouter.get(
  "/admin/configuration",
  requireAuth,
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (_req: OhifRequest, res: Response) => res.json(await getOhifAdminConfiguration()))
);

ohifViewerRouter.put(
  "/admin/configuration",
  requireAuth,
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: OhifRequest, res: Response) => res.json(await putOhifAdminConfiguration(req.body, user(req).sub)))
);

ohifViewerRouter.post(
  "/admin/diagnostics",
  requireAuth,
  requireSupervisor,
  requireRecentSupervisorReauth,
  asyncRoute(async (req: OhifRequest, res: Response) => res.json(await runOhifDiagnostic(req.body, actor(req))))
);

ohifViewerRouter.get(
  "/retrieval-jobs/:jobId",
  requireAuth,
  asyncRoute(async (req: OhifRequest, res: Response) => {
    res.json(await getRetrievalStatusForDoctor(actor(req), positiveInteger(req.params.jobId, "jobId")));
  })
);

ohifViewerRouter.get(
  "/launch/:token",
  requireAuth,
  asyncRoute(async (req: OhifRequest, res: Response) => {
    const token = String(req.params.token || "").trim();
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new HttpError(404, "Viewer launch session is invalid or expired.");
    const redirectUrl = await exchangeViewerLaunchToken(token, user(req).sub, res);
    res.redirect(302, redirectUrl);
  })
);

export const ohifDicomWebProxyRouter = Router();

ohifDicomWebProxyRouter.use(requireAuth);
ohifDicomWebProxyRouter.get(
  "*",
  asyncRoute(async (req: OhifRequest, res: Response) => {
    const current = user(req);
    const response = await proxyAuthorizedDicomWebRequest({
      userId: current.sub,
      launchToken: String(req.cookies?.[env.ohifSessionCookieName] || ""),
      relativePathWithQuery: req.url,
      headers: { accept: String(req.headers.accept || ""), range: String(req.headers.range || "") },
    });
    res.status(response.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"]) {
      const value = response.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!response.body) {
      res.end();
      return;
    }
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).on("error", (error) => res.destroy(error as Error)).pipe(res);
  })
);

export function parseViewerLaunchBody(value: unknown): { includePriors: boolean } {
  const body = asUnknownRecord(value);
  return { includePriors: body.includePriors !== false };
}
