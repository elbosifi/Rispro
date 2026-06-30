import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import webPush, { type PushSubscription } from "web-push";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { issuePublicCancelToken } from "../modules/appointments-v2/public/utils/public-cancel-token.js";
import { buildPublicAppointmentUrlFromSettings } from "../modules/appointments-v2/public/utils/public-appointment-url-core.js";
import { readPatientQrSettings, type PatientQrSettings } from "../modules/appointments-v2/public/utils/patient-qr-settings.js";

export const PATIENT_NOTIFICATION_EVENT_TYPES = [
  "appointment_reminder_24h",
  "appointment_rescheduled",
  "appointment_cancelled",
  "appointment_changed",
  "report_ready",
  "image_ready",
  "test",
  "staff_message",
] as const;

export const PATIENT_NOTIFICATION_EVENT_STATUSES = ["pending", "processing", "sent", "failed", "skipped"] as const;
export const PATIENT_NOTIFICATION_DELIVERY_STATUSES = ["pending", "processing", "sent", "failed", "skipped"] as const;

export type PatientNotificationEventType = typeof PATIENT_NOTIFICATION_EVENT_TYPES[number];
export type PatientNotificationEventStatus = typeof PATIENT_NOTIFICATION_EVENT_STATUSES[number];
export type PatientNotificationDeliveryStatus = typeof PATIENT_NOTIFICATION_DELIVERY_STATUSES[number];

export interface PatientPushPreferences {
  appointmentReminder24h: boolean;
  appointmentRescheduled: boolean;
  appointmentCancelled: boolean;
  appointmentChanged: boolean;
  reportReady: boolean;
  imageReady: boolean;
}

export interface BrowserPushSubscriptionInput {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
}

interface BookingNotificationContext {
  bookingId: number;
  patientId: number;
  bookingDate: string;
  bookingTime: string | null;
  status: string;
  requiresReport: boolean;
  accessionNumber: string;
  studyInstanceUid: string | null;
}

interface NotificationTemplate {
  title: string;
  body: string;
}

interface NotificationEventRow {
  id: number;
  booking_id: number;
  patient_id: number;
  event_type: PatientNotificationEventType;
  payload: Record<string, unknown>;
}

interface DeliveryClaimRow {
  id: number;
  event_id: number;
  subscription_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  event_type: PatientNotificationEventType;
  booking_id: number;
  payload: Record<string, unknown>;
}

let vapidConfigured = false;
let configuredVapidPublicKey = "";

interface ResolvedWebPushConfig {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
  subject: string;
  source: "env" | "settings" | "disabled";
}

function isValidEventType(value: string): value is PatientNotificationEventType {
  return (PATIENT_NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value);
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

export function hashPushSubscription(input: { endpoint: string; p256dh: string }): string {
  return createHash("sha256")
    .update(`${input.endpoint}|${input.p256dh}`)
    .digest("hex");
}

export function validateWebPushStartupConfig(): void {
  if (!env.webPushEnabled) return;

  if (!env.webPushVapidPublicKey || !env.webPushVapidPrivateKey || !env.webPushVapidSubject) {
    throw new Error("WEB_PUSH_ENABLED=true requires complete VAPID configuration.");
  }

  try {
    webPush.setVapidDetails(env.webPushVapidSubject, env.webPushVapidPublicKey, env.webPushVapidPrivateKey);
    vapidConfigured = true;
    configuredVapidPublicKey = env.webPushVapidPublicKey;
  } catch (error) {
    throw new Error(`Invalid WEB_PUSH_* VAPID configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isValidVapidSubject(value: string): boolean {
  return /^(mailto:.+@.+|https?:\/\/.+)/i.test(String(value || "").trim());
}

function envWebPushConfig(): ResolvedWebPushConfig | null {
  if (!env.webPushEnabled) return null;
  if (!env.webPushVapidPublicKey || !env.webPushVapidPrivateKey || !env.webPushVapidSubject) {
    throw new Error("WEB_PUSH_ENABLED=true requires complete VAPID configuration.");
  }
  if (!isValidVapidSubject(env.webPushVapidSubject)) {
    throw new Error("WEB_PUSH_VAPID_SUBJECT must be a mailto: address or absolute http(s) URL when WEB_PUSH_ENABLED=true.");
  }
  return {
    enabled: true,
    publicKey: env.webPushVapidPublicKey,
    privateKey: env.webPushVapidPrivateKey,
    subject: env.webPushVapidSubject,
    source: "env",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function readStoredValue(settingValue: unknown): Record<string, unknown> {
  const record = asRecord(settingValue);
  return asRecord(record.value ?? record);
}

function defaultVapidSubject(settings?: PatientQrSettings): string {
  const publicBaseUrl = String(settings?.risproPublicBaseUrl || "").trim();
  if (/^https?:\/\//i.test(publicBaseUrl)) return publicBaseUrl;
  return "mailto:admin@rispro.local";
}

async function readStoredWebPushConfig(): Promise<ResolvedWebPushConfig | null> {
  const { rows } = await pool.query(
    `
      select setting_value
      from system_settings
      where category = 'patient_web_push' and setting_key = 'config'
      limit 1
    `
  );
  const value = readStoredValue(rows[0]?.setting_value);
  const publicKey = String(value.vapidPublicKey || "").trim();
  const privateKey = String(value.vapidPrivateKey || "").trim();
  const subject = String(value.vapidSubject || "").trim();
  const enabled = value.enabled !== false;
  if (!enabled || !publicKey || !privateKey || !subject || !isValidVapidSubject(subject)) return null;
  return { enabled: true, publicKey, privateKey, subject, source: "settings" };
}

async function resolveWebPushConfig(settings?: PatientQrSettings): Promise<ResolvedWebPushConfig> {
  const envConfig = envWebPushConfig();
  if (envConfig) return envConfig;
  const storedConfig = await readStoredWebPushConfig();
  if (storedConfig && (!settings || settings.webPushEnabled)) return storedConfig;
  return { enabled: false, publicKey: "", privateKey: "", subject: "", source: "disabled" };
}

async function configureVapidIfNeeded(): Promise<boolean> {
  const config = await resolveWebPushConfig();
  if (!config.enabled) return false;
  if (vapidConfigured && configuredVapidPublicKey === config.publicKey) return true;
  try {
    webPush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    vapidConfigured = true;
    configuredVapidPublicKey = config.publicKey;
    return true;
  } catch (error) {
    console.error("Invalid patient Web Push VAPID configuration.", error);
    return false;
  }
}

export async function isPatientWebPushConfigured(settings?: PatientQrSettings): Promise<boolean> {
  const config = await resolveWebPushConfig(settings);
  return Boolean(config.enabled && config.publicKey);
}

export async function getPatientWebPushSharedConfig(): Promise<{ enabled: boolean; publicKey: string }> {
  const config = await resolveWebPushConfig();
  return {
    enabled: Boolean(config.enabled && config.publicKey),
    publicKey: config.enabled ? config.publicKey : "",
  };
}

export async function configurePatientWebPushVapid(): Promise<boolean> {
  return configureVapidIfNeeded();
}

export async function ensurePatientWebPushConfig(options: { updatedByUserId?: number | string | null; settings?: PatientQrSettings } = {}): Promise<{ enabled: boolean; generated: boolean; publicKey: string; source: string }> {
  const envConfig = envWebPushConfig();
  if (envConfig) return { enabled: true, generated: false, publicKey: envConfig.publicKey, source: envConfig.source };

  const existing = await readStoredWebPushConfig();
  if (existing) return { enabled: true, generated: false, publicKey: existing.publicKey, source: existing.source };

  const keys = webPush.generateVAPIDKeys();
  const subject = defaultVapidSubject(options.settings);
  const settingValue = {
    value: {
      enabled: true,
      vapidPublicKey: keys.publicKey,
      vapidPrivateKey: keys.privateKey,
      vapidSubject: subject,
      generatedAt: new Date().toISOString(),
    },
  };

  await pool.query(
    `
      insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
      values ('patient_web_push', 'config', $1::jsonb, $2)
      on conflict (category, setting_key)
      do update set
        setting_value = excluded.setting_value,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
    `,
    [JSON.stringify(settingValue), options.updatedByUserId ?? null]
  );

  vapidConfigured = false;
  configuredVapidPublicKey = "";
  return { enabled: true, generated: true, publicKey: keys.publicKey, source: "settings" };
}

export async function getPatientWebPushPublicConfig(settings: PatientQrSettings): Promise<{
  enabled: boolean;
  vapidPublicKey: string;
  defaults: PatientPushPreferences;
}> {
  let config = await resolveWebPushConfig(settings);
  if (settings.webPushEnabled && !config.enabled) {
    await ensurePatientWebPushConfig({ settings });
    config = await resolveWebPushConfig(settings);
  }
  const enabled = Boolean(settings.webPushEnabled && config.enabled && config.publicKey);
  return {
    enabled,
    vapidPublicKey: enabled ? config.publicKey : "",
    defaults: {
      appointmentReminder24h: settings.webPushDefaultReminder24h,
      appointmentRescheduled: settings.webPushDefaultRescheduled,
      appointmentCancelled: settings.webPushDefaultCancelled,
      appointmentChanged: settings.webPushDefaultChanged,
      reportReady: settings.webPushDefaultReportReady,
      imageReady: settings.webPushDefaultImageReady,
    },
  };
}

function templateForEvent(settings: PatientQrSettings, eventType: PatientNotificationEventType): NotificationTemplate {
  switch (eventType) {
    case "appointment_reminder_24h":
      return { title: settings.webPushAppointmentReminder24hTitleAr || settings.webPushAppointmentReminder24hTitle, body: settings.webPushAppointmentReminder24hBodyAr || settings.webPushAppointmentReminder24hBody };
    case "appointment_rescheduled":
      return { title: settings.webPushAppointmentRescheduledTitleAr || settings.webPushAppointmentRescheduledTitle, body: settings.webPushAppointmentRescheduledBodyAr || settings.webPushAppointmentRescheduledBody };
    case "appointment_cancelled":
      return { title: settings.webPushAppointmentCancelledTitleAr || settings.webPushAppointmentCancelledTitle, body: settings.webPushAppointmentCancelledBodyAr || settings.webPushAppointmentCancelledBody };
    case "appointment_changed":
      return { title: settings.webPushAppointmentChangedTitleAr || settings.webPushAppointmentChangedTitle, body: settings.webPushAppointmentChangedBodyAr || settings.webPushAppointmentChangedBody };
    case "report_ready":
      return { title: settings.webPushReportReadyTitleAr || settings.webPushReportReadyTitle, body: settings.webPushReportReadyBodyAr || settings.webPushReportReadyBody };
    case "image_ready":
      return { title: settings.webPushImageReadyTitleAr || settings.webPushImageReadyTitle, body: settings.webPushImageReadyBodyAr || settings.webPushImageReadyBody };
    case "test":
      return { title: settings.webPushTestTitleAr || settings.webPushTestTitle, body: settings.webPushTestBodyAr || settings.webPushTestBody };
    case "staff_message":
      return { title: settings.webPushTestTitleAr || settings.webPushTestTitle, body: settings.webPushTestBodyAr || settings.webPushTestBody };
  }
}

function preferenceColumnForEvent(eventType: PatientNotificationEventType): string | null {
  switch (eventType) {
    case "appointment_reminder_24h":
      return "appointment_reminder_24h";
    case "appointment_rescheduled":
      return "appointment_rescheduled";
    case "appointment_cancelled":
      return "appointment_cancelled";
    case "appointment_changed":
      return "appointment_changed";
    case "report_ready":
      return "report_ready";
    case "image_ready":
      return "image_ready";
    case "test":
    case "staff_message":
      return null;
  }
}

function defaultDedupeKey(eventType: PatientNotificationEventType, bookingId: number, suffix?: string): string {
  return suffix ? `${eventType}:${bookingId}:${suffix}` : `${eventType}:${bookingId}`;
}

export async function getBookingNotificationContext(
  bookingId: number,
  client: PoolClient | null = null
): Promise<BookingNotificationContext | null> {
  const db = client ?? pool;
  const result = await db.query<{
    id: number;
    patient_id: number;
    booking_date: string;
    booking_time: string | null;
    status: string;
    requires_report: boolean;
    accession_number: string;
    study_instance_uid: string | null;
  }>(
    `
      select
        b.id,
        b.patient_id,
        b.booking_date::text as booking_date,
        b.booking_time::text as booking_time,
        b.status,
        b.requires_report,
        ('V2-' || lpad(b.id::text, 6, '0')) as accession_number,
        b.study_instance_uid
      from appointments_v2.bookings b
      where b.id = $1
      limit 1
    `,
    [bookingId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    bookingId: Number(row.id),
    patientId: Number(row.patient_id),
    bookingDate: row.booking_date,
    bookingTime: row.booking_time,
    status: row.status,
    requiresReport: Boolean(row.requires_report),
    accessionNumber: row.accession_number,
    studyInstanceUid: row.study_instance_uid,
  };
}

export async function upsertPatientPushSubscription(input: {
  bookingId: number;
  patientId: number;
  subscription: BrowserPushSubscriptionInput;
  preferences: PatientPushPreferences;
  userAgent?: string | null;
}): Promise<{ subscriptionId: number; bookingSubscriptionId: number; subscriptionHash: string }> {
  if (!(await isPatientWebPushConfigured())) {
    throw new HttpError(503, "Web Push is disabled.", { code: "web_push_disabled" });
  }
  const normalized = normalizeSubscription(input.subscription);
  const subscriptionHash = hashPushSubscription(normalized);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const subscriptionResult = await client.query<{ id: number }>(
      `
        insert into patient_web_push_subscriptions (
          endpoint, p256dh, auth, subscription_hash, user_agent, enabled, disabled_at, updated_at
        )
        values ($1, $2, $3, $4, $5, true, null, now())
        on conflict (subscription_hash) do update
        set endpoint = excluded.endpoint,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            user_agent = excluded.user_agent,
            enabled = true,
            disabled_at = null,
            updated_at = now()
        returning id
      `,
      [normalized.endpoint, normalized.p256dh, normalized.auth, subscriptionHash, input.userAgent ?? null]
    );
    const subscriptionId = Number(subscriptionResult.rows[0].id);
    const linkResult = await client.query<{ id: number }>(
      `
        insert into patient_web_push_booking_subscriptions (
          subscription_id,
          booking_id,
          patient_id,
          appointment_reminder_24h,
          appointment_rescheduled,
          appointment_cancelled,
          appointment_changed,
          report_ready,
          image_ready,
          enabled,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, now())
        on conflict (subscription_id, booking_id) do update
        set patient_id = excluded.patient_id,
            appointment_reminder_24h = excluded.appointment_reminder_24h,
            appointment_rescheduled = excluded.appointment_rescheduled,
            appointment_cancelled = excluded.appointment_cancelled,
            appointment_changed = excluded.appointment_changed,
            report_ready = excluded.report_ready,
            image_ready = excluded.image_ready,
            enabled = true,
            updated_at = now()
        returning id
      `,
      [
        subscriptionId,
        input.bookingId,
        input.patientId,
        input.preferences.appointmentReminder24h,
        input.preferences.appointmentRescheduled,
        input.preferences.appointmentCancelled,
        input.preferences.appointmentChanged,
        input.preferences.reportReady,
        input.preferences.imageReady,
      ]
    );
    await client.query("commit");
    return { subscriptionId, bookingSubscriptionId: Number(linkResult.rows[0].id), subscriptionHash };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function unsubscribePatientPush(input: {
  bookingId: number;
  subscription: BrowserPushSubscriptionInput;
}): Promise<{ disabled: boolean }> {
  const normalized = normalizeSubscription(input.subscription);
  const subscriptionHash = hashPushSubscription(normalized);
  const result = await pool.query(
    `
      update patient_web_push_booking_subscriptions bs
      set enabled = false, updated_at = now()
      from patient_web_push_subscriptions s
      where bs.subscription_id = s.id
        and bs.booking_id = $1
        and s.subscription_hash = $2
    `,
    [input.bookingId, subscriptionHash]
  );
  return { disabled: Number(result.rowCount ?? 0) > 0 };
}

export async function enqueuePatientNotificationEvent(input: {
  bookingId: number;
  eventType: PatientNotificationEventType;
  scheduledFor?: Date;
  dedupeKey?: string;
  dedupeSuffix?: string;
  payload?: Record<string, unknown>;
  client?: PoolClient;
}): Promise<{ eventId: number | null; created: boolean }> {
  if (!isValidEventType(input.eventType)) return { eventId: null, created: false };
  const context = await getBookingNotificationContext(input.bookingId, input.client ?? null);
  if (!context) return { eventId: null, created: false };
  const settings = await readPatientQrSettings();
  const template = templateForEvent(settings, input.eventType);
  const dedupeKey = input.dedupeKey ?? defaultDedupeKey(input.eventType, input.bookingId, input.dedupeSuffix);
  const db = input.client ?? pool;
  const result = await db.query<{ id: number; inserted: boolean }>(
    `
      insert into patient_notification_events (
        booking_id, patient_id, event_type, dedupe_key, scheduled_for, payload, status
      )
      values ($1, $2, $3, $4, $5, $6::jsonb, 'pending')
      on conflict (dedupe_key) do update
      set updated_at = patient_notification_events.updated_at
      returning id, (xmax = 0) as inserted
    `,
    [
      context.bookingId,
      context.patientId,
      input.eventType,
      dedupeKey,
      input.scheduledFor ?? new Date(),
      JSON.stringify({ title: template.title, body: template.body, ...(input.payload ?? {}) }),
    ]
  );
  const row = result.rows[0];
  return { eventId: row ? Number(row.id) : null, created: Boolean(row?.inserted) };
}

export async function hasActivePatientWebPushSubscription(bookingId: number): Promise<{ subscribed: boolean; count: number }> {
  const result = await pool.query<{ count: number }>(
    `
      select count(*)::int as count
      from patient_web_push_booking_subscriptions bs
      join patient_web_push_subscriptions s on s.id = bs.subscription_id
      where bs.booking_id = $1
        and bs.enabled = true
        and s.enabled = true
    `,
    [bookingId]
  );
  const count = Number(result.rows[0]?.count ?? 0);
  return { subscribed: count > 0, count };
}

const STAFF_MESSAGE_TITLE_MAX = 80;
const STAFF_MESSAGE_BODY_MAX = 180;

function normalizeStaffMessagePart(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function enqueueStaffPatientWebPushMessage(input: {
  bookingId: number;
  title?: unknown;
  body?: unknown;
  templateEventType?: PatientNotificationEventType;
}): Promise<{ eventId: number | null; created: boolean }> {
  const active = await hasActivePatientWebPushSubscription(input.bookingId);
  if (!active.subscribed) {
    throw new HttpError(409, "Patient is not subscribed to browser notifications for this appointment.", {
      code: "patient_web_push_not_subscribed",
    });
  }

  const settings = await readPatientQrSettings();
  const template =
    input.templateEventType && input.templateEventType !== "staff_message"
      ? templateForEvent(settings, input.templateEventType)
      : null;
  const title = normalizeStaffMessagePart(input.title ?? template?.title ?? "", STAFF_MESSAGE_TITLE_MAX);
  const body = normalizeStaffMessagePart(input.body ?? template?.body ?? "", STAFF_MESSAGE_BODY_MAX);

  if (!title || !body) {
    throw new HttpError(400, "Notification title and message are required.", { code: "invalid_patient_web_push_message" });
  }

  return enqueuePatientNotificationEvent({
    bookingId: input.bookingId,
    eventType: "staff_message",
    dedupeKey: `staff_message:${input.bookingId}:${Date.now()}:${randomUUID()}`,
    scheduledFor: new Date(),
    payload: { title, body },
  });
}

export async function safeEnqueuePatientNotificationEvent(input: {
  bookingId: number;
  eventType: PatientNotificationEventType;
  scheduledFor?: Date;
  dedupeKey?: string;
  dedupeSuffix?: string;
}): Promise<void> {
  try {
    await enqueuePatientNotificationEvent(input);
  } catch (error) {
    console.warn(JSON.stringify({
      type: "patient_notification_enqueue_failed",
      bookingId: input.bookingId,
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

async function buildFreshClickUrl(bookingId: number): Promise<string | null> {
  const settings = await readPatientQrSettings();
  const token = await issuePublicCancelToken(bookingId);
  if (!token) return null;
  return buildPublicAppointmentUrlFromSettings(token, settings);
}

export function sanitizePushPayload(input: {
  eventType: PatientNotificationEventType;
  title: unknown;
  body: unknown;
  clickUrl: string;
}): string {
  return JSON.stringify({
    eventType: input.eventType,
    title: String(input.title || ""),
    body: String(input.body || ""),
    clickUrl: input.clickUrl,
  });
}

async function createDeliveriesForEvent(event: NotificationEventRow): Promise<number> {
  const preferenceColumn = preferenceColumnForEvent(event.event_type);
  const preferencePredicate = preferenceColumn ? `and bs.${preferenceColumn} = true` : "";
  const result = await pool.query(
    `
      insert into patient_notification_deliveries (event_id, subscription_id, status)
      select $1, s.id, 'pending'
      from patient_web_push_booking_subscriptions bs
      join patient_web_push_subscriptions s on s.id = bs.subscription_id
      where bs.booking_id = $2
        and bs.enabled = true
        and s.enabled = true
        ${preferencePredicate}
      on conflict (event_id, subscription_id) do nothing
    `,
    [event.id, event.booking_id]
  );
  return Number(result.rowCount ?? 0);
}

export async function prepareDueNotificationDeliveries(limit = 50): Promise<{ events: number; deliveries: number }> {
  const client = await pool.connect();
  let events: NotificationEventRow[] = [];
  try {
    await client.query("begin");
    const result = await client.query<NotificationEventRow>(
      `
        select id, booking_id, patient_id, event_type, payload
        from patient_notification_events
        where status = 'pending'
          and scheduled_for <= now()
        order by scheduled_for asc, id asc
        limit $1
        for update skip locked
      `,
      [limit]
    );
    events = result.rows;
    if (events.length > 0) {
      await client.query(
        `
          update patient_notification_events
          set status = 'processing', updated_at = now()
          where id = any($1::bigint[])
        `,
        [events.map((event) => event.id)]
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }

  let deliveries = 0;
  for (const event of events) {
    const created = await createDeliveriesForEvent(event);
    deliveries += created;
    if (created === 0) {
      await pool.query(`update patient_notification_events set status = 'skipped', updated_at = now() where id = $1`, [event.id]);
    }
  }
  return { events: events.length, deliveries };
}

async function claimPendingDeliveries(limit: number): Promise<DeliveryClaimRow[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query<DeliveryClaimRow>(
      `
        select
          d.id,
          d.event_id,
          d.subscription_id,
          s.endpoint,
          s.p256dh,
          s.auth,
          e.event_type,
          e.booking_id,
          e.payload
        from patient_notification_deliveries d
        join patient_notification_events e on e.id = d.event_id
        join patient_web_push_subscriptions s on s.id = d.subscription_id
        where d.status in ('pending', 'failed')
          and d.attempt_count < $2
          and s.enabled = true
        order by d.id asc
        limit $1
        for update skip locked
      `,
      [limit, env.webPushDeliveryMaxAttempts]
    );
    const rows = result.rows;
    if (rows.length > 0) {
      await client.query(
        `
          update patient_notification_deliveries
          set status = 'processing', updated_at = now()
          where id = any($1::bigint[])
        `,
        [rows.map((row) => row.id)]
      );
    }
    await client.query("commit");
    return rows;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function isPermanentPushFailure(error: unknown): boolean {
  const statusCode = Number((error as { statusCode?: unknown } | null)?.statusCode);
  return statusCode === 404 || statusCode === 410;
}

async function updateEventStatusFromDeliveries(eventId: number): Promise<void> {
  await pool.query(
    `
      update patient_notification_events e
      set status = case
          when exists (
            select 1 from patient_notification_deliveries d
            where d.event_id = e.id and d.status = 'sent'
          ) then 'sent'
          when not exists (
            select 1 from patient_notification_deliveries d
            where d.event_id = e.id and d.status in ('pending', 'processing')
          ) and exists (
            select 1 from patient_notification_deliveries d
            where d.event_id = e.id and d.status = 'failed' and d.attempt_count >= $2
          ) then 'failed'
          when not exists (
            select 1 from patient_notification_deliveries d
            where d.event_id = e.id and d.status in ('pending', 'processing', 'sent', 'failed')
          ) then 'skipped'
          else e.status
        end,
        updated_at = now()
      where e.id = $1
    `,
    [eventId, env.webPushDeliveryMaxAttempts]
  );
}

export async function processPatientPushDeliveries(limit = 50): Promise<{ attempted: number; sent: number; failed: number }> {
  if (!(await configureVapidIfNeeded())) return { attempted: 0, sent: 0, failed: 0 };

  const deliveries = await claimPendingDeliveries(limit);
  let sent = 0;
  let failed = 0;
  for (const delivery of deliveries) {
    try {
      const clickUrl = await buildFreshClickUrl(delivery.booking_id);
      if (!clickUrl) {
        throw new Error("Unable to mint public appointment token for push clickUrl.");
      }
      const payload = sanitizePushPayload({
        eventType: delivery.event_type,
        title: delivery.payload?.title,
        body: delivery.payload?.body,
        clickUrl,
      });
      const subscription: PushSubscription = {
        endpoint: delivery.endpoint,
        keys: {
          p256dh: delivery.p256dh,
          auth: delivery.auth,
        },
      };
      await webPush.sendNotification(subscription, payload);
      await pool.query(
        `
          update patient_notification_deliveries
          set status = 'sent',
              attempt_count = attempt_count + 1,
              last_attempt_at = now(),
              sent_at = now(),
              last_error = null,
              updated_at = now()
          where id = $1
        `,
        [delivery.id]
      );
      await pool.query(
        `
          update patient_web_push_subscriptions
          set last_success_at = now(), updated_at = now()
          where id = $1
        `,
        [delivery.subscription_id]
      );
      sent += 1;
    } catch (error) {
      const permanent = isPermanentPushFailure(error);
      const message = error instanceof Error ? error.message : String(error);
      await pool.query(
        `
          update patient_notification_deliveries
          set status = case when attempt_count + 1 >= $2 then 'failed' else 'pending' end,
              attempt_count = attempt_count + 1,
              last_attempt_at = now(),
              last_error = $3,
              updated_at = now()
          where id = $1
        `,
        [delivery.id, env.webPushDeliveryMaxAttempts, message.slice(0, 1000)]
      );
      await pool.query(
        `
          update patient_web_push_subscriptions
          set last_failure_at = now(),
              enabled = case when $2 then false else enabled end,
              disabled_at = case when $2 then now() else disabled_at end,
              updated_at = now()
          where id = $1
        `,
        [delivery.subscription_id, permanent]
      );
      failed += 1;
    }

    await updateEventStatusFromDeliveries(delivery.event_id);
  }
  return { attempted: deliveries.length, sent, failed };
}
