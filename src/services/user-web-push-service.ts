import webPush, { type PushSubscription } from "web-push";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import {
  configurePatientWebPushVapid,
  ensurePatientWebPushConfig,
  getPatientWebPushSharedConfig,
  hashPushSubscription,
  type BrowserPushSubscriptionInput,
} from "./patient-web-push-service.js";
import { readPatientQrSettings } from "../modules/appointments-v2/public/utils/patient-qr-settings.js";
import type { SchedulingOverrideRequestRow } from "../modules/appointments-v2/scheduling-override-requests/models/scheduling-override-request.js";
import { buildInternalNotificationPatientLabel, buildSchedulingOverrideNotification } from "./internal-notification-formatters.js";

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

async function ensureUserWebPushStorage(): Promise<void> {
  await pool.query(`
    create table if not exists user_web_push_subscriptions (
      id bigserial primary key,
      user_id bigint not null references users(id) on delete cascade,
      endpoint text not null,
      p256dh text not null,
      auth text not null,
      subscription_hash text not null,
      user_agent text,
      enabled boolean not null default true,
      last_success_at timestamptz,
      last_failure_at timestamptz,
      disabled_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint user_web_push_subscriptions_user_hash_unique unique (user_id, subscription_hash)
    )
  `);
  await pool.query(`
    create index if not exists user_web_push_subscriptions_user_enabled_idx
      on user_web_push_subscriptions(user_id, enabled)
  `);
}

async function readUserWebPushConfig(userId: number): Promise<{ enabled: boolean; publicKey: string }> {
  let config = await getPatientWebPushSharedConfig();
  if (config.enabled && config.publicKey) return config;

  const settings = await readPatientQrSettings().catch(() => undefined);
  const ensured = await ensurePatientWebPushConfig({ updatedByUserId: userId, settings });
  config = { enabled: ensured.enabled, publicKey: ensured.publicKey };
  return config;
}

function isPermanentPushFailure(error: unknown): boolean {
  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return statusCode === 404 || statusCode === 410;
}

export async function getUserWebPushConfig(userId: number): Promise<{ enabled: boolean; publicKey: string | null; subscribed: boolean }> {
  const config = await readUserWebPushConfig(userId);
  if (!config.enabled || !config.publicKey) return { enabled: false, publicKey: null, subscribed: false };

  await ensureUserWebPushStorage();
  const count = await pool.query<{ count: string }>(
    `select count(*)::text as count from user_web_push_subscriptions where user_id = $1 and enabled = true`,
    [userId]
  );
  return {
    enabled: true,
    publicKey: config.publicKey,
    subscribed: Number(count.rows[0]?.count ?? "0") > 0,
  };
}

export async function upsertUserWebPushSubscription(input: {
  userId: number;
  subscription: BrowserPushSubscriptionInput;
  userAgent?: string | null;
}): Promise<{ subscriptionId: number }> {
  const config = await readUserWebPushConfig(input.userId);
  if (!config.enabled || !config.publicKey) {
    throw new HttpError(503, "Web Push is disabled.", { code: "web_push_disabled" });
  }
  await ensureUserWebPushStorage();
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
  await ensureUserWebPushStorage();
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
  await ensureUserWebPushStorage();

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

function overrideNotificationPayload(request: SchedulingOverrideRequestRow, state: "created" | "approved" | "rejected" | "failed" | "expired" | "cancelled"): UserPushPayload {
  const patient = buildInternalNotificationPatientLabel({ fullName: request.patientDisplayName ?? null, primaryIdentifier: request.patientPrimaryIdentifier ?? null });
  const context = request.decisionContext;
  const capacity = context?.currentCapacity != null && context.totalCapacity != null ? `${context.currentCapacity}/${context.totalCapacity} booked` : null;
  const notification = buildSchedulingOverrideNotification({
    state,
    modality: request.modalityCode || request.modalityName,
    date: request.requestedBookingDate,
    exam: request.examTypeName,
    patient,
    capacity,
    overbook: context?.overbookAmount ?? null,
    requesterReason: request.requesterReason,
    approverReason: request.approverReason,
    failure: request.failureMessage,
  });
  return { eventType: `scheduling_override_request_${state}`, ...notification, clickUrl: `/scheduling/override-requests?requestId=${request.id}` };
}

export function safeNotifySchedulingOverrideCreated(request: SchedulingOverrideRequestRow): void {
  void approverUserIds(request)
    .then((userIds) => safeSendMany(userIds, overrideNotificationPayload(request, "created")))
    .catch((error) => {
      console.warn(JSON.stringify({ type: "override_created_push_failed", error: error instanceof Error ? error.message : String(error) }));
    });
}

export function safeNotifySchedulingOverrideApproved(request: SchedulingOverrideRequestRow): void {
  void sendUserWebPush(Number(request.requesterUserId), overrideNotificationPayload(request, "approved")).catch((error) => {
    console.warn(JSON.stringify({ type: "override_approved_push_failed", error: error instanceof Error ? error.message : String(error) }));
  });
}

export function safeNotifySchedulingOverrideApprovalFailed(request: SchedulingOverrideRequestRow, approverUserId: number): void {
  const userIds = [...new Set([Number(request.requesterUserId), Number(approverUserId)].filter((id) => Number.isInteger(id) && id > 0))];
  void safeSendMany(userIds, overrideNotificationPayload(request, "failed")).catch((error) => {
    console.warn(JSON.stringify({ type: "override_failed_push_failed", error: error instanceof Error ? error.message : String(error) }));
  });
}

export function safeNotifySchedulingOverrideRejected(request: SchedulingOverrideRequestRow): void {
  void sendUserWebPush(Number(request.requesterUserId), overrideNotificationPayload(request, "rejected")).catch((error) => {
    console.warn(JSON.stringify({ type: "override_rejected_push_failed", error: error instanceof Error ? error.message : String(error) }));
  });
}

export function safeNotifySchedulingOverrideExpired(request: SchedulingOverrideRequestRow): void {
  void sendUserWebPush(Number(request.requesterUserId), overrideNotificationPayload(request, "expired")).catch((error) => {
    console.warn(JSON.stringify({ type: "override_expired_push_failed", error: error instanceof Error ? error.message : String(error) }));
  });
}

export function safeNotifySchedulingOverrideCancelled(request: SchedulingOverrideRequestRow, cancelledByUserId: number): void {
  if (Number(request.requesterUserId) === Number(cancelledByUserId)) return;
  void sendUserWebPush(Number(request.requesterUserId), overrideNotificationPayload(request, "cancelled")).catch((error) => {
    console.warn(JSON.stringify({ type: "override_cancelled_push_failed", error: error instanceof Error ? error.message : String(error) }));
  });
}
