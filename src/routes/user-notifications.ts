import express from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth.js";
import { asyncRoute } from "../utils/async-route.js";
import {
  getUserWebPushConfig,
  sendUserWebPush,
  unsubscribeUserWebPush,
  upsertUserWebPushSubscription,
} from "../services/user-web-push-service.js";
import type { BrowserPushSubscriptionInput } from "../services/patient-web-push-service.js";

function userId(req: AuthRequest): number {
  return Number(req.user?.sub ?? 0);
}

export const userNotificationsRouter = express.Router();
userNotificationsRouter.use(requireAuth);

userNotificationsRouter.get("/push-config", asyncRoute(async (req: AuthRequest, res) => {
  res.json({ config: await getUserWebPushConfig(userId(req)) });
}));

userNotificationsRouter.post("/push-subscribe", asyncRoute(async (req: AuthRequest, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  res.json(await upsertUserWebPushSubscription({
    userId: userId(req),
    subscription: (body.subscription ?? {}) as BrowserPushSubscriptionInput,
    userAgent: req.get("user-agent") ?? null,
  }));
}));

userNotificationsRouter.post("/push-unsubscribe", asyncRoute(async (req: AuthRequest, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  res.json({ ok: true, ...(await unsubscribeUserWebPush({ userId: userId(req), subscription: body.subscription as BrowserPushSubscriptionInput | null })) });
}));

userNotificationsRouter.post("/test-push", asyncRoute(async (req: AuthRequest, res) => {
  const result = await sendUserWebPush(userId(req), {
    eventType: "user_web_push_test",
    title: "Notifications enabled",
    body: "Browser notifications are enabled for RISpro.",
    clickUrl: "/scheduling/override-requests",
  });
  res.json(result);
}));
