import { Router } from "express";
import { requireAuth, requireSupervisor, requireRecentSupervisorReauth } from "../../middleware/auth.js";
import { createRateLimiter } from "../../middleware/rate-limit.js";
import { asyncRoute } from "../../utils/async-route.js";
import { getOperationsSummary } from "./operations-summary-service.js";
import { assertMobileManager, authenticateMobileToken, createMobileToken, changeMobileToken, listMobileTokens } from "./mobile-token-service.js";

export const mobileWidgetRouter = Router();
export const mobileWidgetAdminRouter = Router();
for (const router of [mobileWidgetRouter, mobileWidgetAdminRouter]) {
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store, private"); next(); });
}
const deviceIds = new WeakMap<object, string>();
const deviceLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60,
  message: "Too many widget requests.", key: req => deviceIds.get(req) ?? req.ip ?? "unknown" });
mobileWidgetRouter.get("/operations-summary",
  createRateLimiter({ windowMs: 60_000, maxRequests: 180, message: "Too many mobile requests." }),
  asyncRoute(async (req, _res, next) => { deviceIds.set(req, await authenticateMobileToken(req.get("authorization"))); next(); }),
  deviceLimiter, asyncRoute(async (_req, res) => { res.json(await getOperationsSummary()); }));

mobileWidgetAdminRouter.use(requireAuth, requireSupervisor,
  asyncRoute(async (req, _res, next) => { await assertMobileManager(req.user!.sub); next(); }));
mobileWidgetAdminRouter.get("/tokens", asyncRoute(async (_req, res) => { res.json({ tokens: await listMobileTokens() }); }));
mobileWidgetAdminRouter.get("/preview", asyncRoute(async (_req, res) => { res.json(await getOperationsSummary()); }));
mobileWidgetAdminRouter.use(requireRecentSupervisorReauth);
mobileWidgetAdminRouter.post("/tokens", asyncRoute(async (req, res) => {
  res.status(201).json(await createMobileToken(req.user!.sub, req.body?.deviceName, req.body?.expiresAt));
}));
mobileWidgetAdminRouter.post("/tokens/:id/rotate", asyncRoute(async (req, res) => {
  res.json(await changeMobileToken(req.user!.sub, String(req.params.id), "rotate", req.body?.expiresAt));
}));
mobileWidgetAdminRouter.post("/tokens/:id/revoke", asyncRoute(async (req, res) => {
  await changeMobileToken(req.user!.sub, String(req.params.id), "revoke"); res.json({ ok: true });
}));
