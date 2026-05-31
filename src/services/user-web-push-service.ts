import webPush, { type PushSubscription } from "web-push";
import { pool } from "../db/pool.js";
import {
  configurePatientWebPushVapid,
  getPatientWebPushSharedConfig,
  hashPushSubscription,
  type BrowserPushSubscriptionInput,
} from "./patient-web-push-service.js";
import { HttpError } from "../utils/http-error.js";
import type { SchedulingOverrideRequestRow } from "../modules/appointments-v2/scheduling-override-requests/models/scheduling-override-request.js";

export interface UserPushPayload {
  eventType: string;
  title: string;
  body: string;
  clickUrl: string;
}

function normalizeSubscription(input: BrowserPushSubscriptionInput): { endpoint: string; p256dh: string; auth: string } {
  const endpoint = String(input.endpoint || "").trim();
  const p256dh = String(input.keys?.p256dh || "").trim();
  const auth = String(input.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) {
    throw new HttpError(400, "Push subscription endpoint and keys are required.", { code: "invalid_push_subscription" });
  }
  return { endpoint, p256dh, auth };
}

function isPermanentPushFailure(error: unknown): boolean {
  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return statusCode === 404 || statusCode === 410;
}

export async function getUserWebPushConfig(userId: number): Promise<{ enabled: boolean; publicKey: string | null; subscribed: boolean }> {
  const config = await getPatientWebPushSharedConfig();
  const count = await pool.query<{ count: string }>(
    `select count(*)::text as count from user_web_push_subscriptions where user_id = $1 and enabled = true`,
    [userId]
  );
  return {
    enabled: config.enabled,
    publicKey: config.publicKey || null,
    subscribed: Number(count.rows[0]?.count ?? "0") > 0,
  };
}

export async function upsertUserWebPushSubscription(input: {
  userId: number;
  subscription: BrowserPushSubscriptionInput;
  userAgent?: string | null;
}): Promise<{ subscriptionId: number }> {
  const normalized = normalizeSubscription(input.subscription);
  const subscriptionHash = hashPushSubscription(normalized);
  const result = await pool.query<{ id: number }>(
    `
      insert into user_web_push_subscriptions (
        user_id, endpoint, p256dh, auth, subscription_hash, user_agent, enabled, disabled_at, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, true, null, now())
      on conflict (user_id, subscription_hash) do update
      set endpoint = excluded.endpoint,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_agent = excluded.user_agent,
          enabled = true,
          disabled_at = null,
          updated_at = now()
      returning id
    `,
    [input.userId, normalized.endpoint, normalized.p256dh, normalized.auth, subscriptionHash, input.userAgent ?? null]
  );
  return { subscriptionId: Number(result.rows[0].id) };
}

export async function unsubscribeUserWebPush(input: {
  userId: number;
  subscription?: BrowserPushSubscriptionInput | null;
}): Promise<{ disabled: boolean }> {
  const normalized = input.subscription ? normalizeSubscription(input.subscription) : null;
  const result = await pool.query(
    `
      update user_web_push_subscriptions
      set enabled = false,
          disabled_at = coalesce(disabled_at, now()),
          updated_at = now()
      where user_id = $1
        and enabled = true
        and ($2::text is null or endpoint = $2)
    `,
    [input.userId, normalized?.endpoint ?? null]
  );
  return { disabled: Number(result.rowCount ?? 0) > 0 };
}

export async function sendUserWebPush(userId: number, payload: UserPushPayload): Promise<{ attempted: number; sent: number; failed: number }> {
  if (!(await configurePatientWebPushVapid())) return { attempted: 0, sent: 0, failed: 0 };

  const subscriptions = await pool.query<{
    id: number;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>(
    `
      select id, endpoint, p256dh, auth
      from user_web_push_subscriptions
      where user_id = $1 and enabled = true
    `,
    [userId]
  );

  let sent = 0;
  let failed = 0;
  for (const row of subscriptions.rows) {
    const subscription: PushSubscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    try {
      await webPush.sendNotification(subscription, JSON.stringify(payload));
      await pool.query(
        `update user_web_push_subscriptions set last_success_at = now(), updated_at = now() where id = $1`,
        [row.id]
      );
      sent += 1;
    } catch (error) {
      const permanent = isPermanentPushFailure(error);
      await pool.query(
        `
          update user_web_push_subscriptions
          set last_failure_at = now(),
              enabled = case when $2 then false else enabled end,
              disabled_at = case when $2 then now() else disabled_at end,
              updated_at = now()
          where id = $1
        `,
        [row.id, permanent]
      );
      failed += 1;
    }
  }
  return { attempted: subscriptions.rows.length, sent, failed };
}

async function approverUserIds(request: SchedulingOverrideRequestRow): Promise<number[]> {
  const roles = request.overrideType === "total_capacity_override"
    ? ["super_admin"]
    : ["supervisor", "super_admin"];
  const result = await pool.query<{ id: number }>(
    `
      select id
      from users
      where role = any($1::text[])
        and is_active = true
        and id <> $2
    `,
    [roles, request.requesterUserId]
  );
  return result.rows.map((row) => Number(row.id));
}

async function safeSendMany(userIds: number[], payload: UserPushPayload): Promise<void> {
  await Promise.all(userIds.map((userId) => sendUserWebPush(userId, payload))).catch((error) => {
    console.warn(JSON.stringify({ type: "user_web_push_send_failed", error: error instanceof Error ? error.message : String(error) }));
  });
}

export function safeNotifySchedulingOverrideCreated(request: SchedulingOverrideRequestRow): void {
  void approverUserIds(request)
    .then((userIds) => safeSendMany(userIds, {
      eventType: "scheduling_override_request_created",
      title: "New override request",
      body: "A scheduling override request needs review.",
      clickUrl: "/scheduling/override-requests",
    }))
    .catch((error) => {
      console.warn(JSON.stringify({ type: "override_created_push_failed", error: error instanceof Error ? error.message : String(error) }));
    });
}

export function safeNotifySchedulingOverrideApproved(request: SchedulingOverrideRequestRow): void {
  void sendUserWebPush(Number(request.requesterUserId), {
    eventType: "scheduling_override_request_approved",
    title: "Override request approved",
    body: "Your scheduling override request was approved.",
    clickUrl: "/scheduling/override-requests",
  }).catch((error) => {
    console.warn(JSON.stringify({ type: "override_approved_push_failed", error: error instanceof Error ? error.message : String(error) }));
  });
}

export function safeNotifySchedulingOverrideRejected(request: SchedulingOverrideRequestRow): void {
  void sendUserWebPush(Number(request.requesterUserId), {
    eventType: "scheduling_override_request_rejected",
    title: "Override request rejected",
    body: "Your scheduling override request was rejected.",
    clickUrl: "/scheduling/override-requests",
  }).catch((error) => {
    console.warn(JSON.stringify({ type: "override_rejected_push_failed", error: error instanceof Error ? error.message : String(error) }));
  });
}
