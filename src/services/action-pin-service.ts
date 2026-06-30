import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { logAuditEntry } from "./audit-service.js";
import type { DbExecutor } from "../types/db.js";
import type { NullableUserId, UserId } from "../types/http.js";

export interface ActionPinPolicyLimits {
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

export interface ActionPinStatus {
  hasPin: boolean;
  lockedUntil: string | null;
  isLocked: boolean;
  idleLockActive?: boolean;
  idleLockedAt?: string | null;
  pinExpiresAt: string | null;
  isExpired: boolean;
  failedAttempts: number;
}

export interface ActionPinIdleLockStatus {
  active: boolean;
  lockedAt: string | null;
}

export interface ActionPinAdminUserRow {
  userId: number;
  username: string;
  fullName: string;
  role: string;
  isActive: boolean;
  hasActionPin: boolean;
  pinRotatedAt: string | null;
  pinExpiresAt: string | null;
  isExpired: boolean;
  failedAttempts: number;
  lockedUntil: string | null;
  isLocked: boolean;
  updatedAt: string | null;
  updatedByUserId: number | null;
  updatedByUsername: string | null;
  updatedByFullName: string | null;
}

export type ActionPinVerifyFailureReason = "not_set" | "invalid_format" | "invalid" | "locked" | "expired";

export interface ActionPinVerifyResult {
  ok: boolean;
  reason?: ActionPinVerifyFailureReason;
  failedAttempts: number;
  lockedUntil: string | null;
  pinExpiresAt: string | null;
}

export interface ActionPinVerificationInput {
  userId: UserId;
  actionKey?: string | null;
  reason?: string | null;
  ttlSeconds: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  executor?: DbExecutor;
}

export interface ActionPinVerificationValidationInput {
  userId: UserId;
  token: unknown;
  actionKey?: string | null;
  consume: boolean;
  requireActionScoped?: boolean;
  executor?: DbExecutor;
}

export interface ActionPinVerificationValidationResult {
  ok: boolean;
  reason?: "missing_token" | "not_found";
  verificationId?: number;
  actionKey?: string | null;
  actionReason?: string | null;
  expiresAt?: string;
}

interface ActionPinRow {
  user_id: number;
  pin_hash: string;
  pin_rotated_at?: string;
  pin_expires_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
}

interface ActionPinVerificationRow {
  id: number;
  user_id: number;
  action_key: string | null;
  reason: string | null;
  expires_at: string;
  consumed_at: string | null;
}

interface ActionPinAdminDbRow {
  user_id: number;
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
  has_action_pin: boolean;
  pin_rotated_at: string | null;
  pin_expires_at: string | null;
  failed_attempts: number | null;
  locked_until: string | null;
  updated_at: string | null;
  updated_by_user_id: number | null;
  updated_by_username: string | null;
  updated_by_full_name: string | null;
}

export function validateActionPinFormat(pin: unknown): boolean {
  return /^\d{4,8}$/.test(String(pin ?? ""));
}

function isFuture(value: string | null | undefined): boolean {
  return Boolean(value && new Date(value).getTime() > Date.now());
}

function isPast(value: string | null | undefined): boolean {
  return Boolean(value && new Date(value).getTime() <= Date.now());
}

async function getActionPinRow(userId: UserId, executor: DbExecutor = pool): Promise<ActionPinRow | null> {
  const { rows } = await executor.query(
    `
      select user_id, pin_hash, pin_rotated_at, pin_expires_at, failed_attempts, locked_until
      from user_action_pins
      where user_id = $1
      limit 1
    `,
    [userId]
  );
  return (rows[0] as unknown as ActionPinRow | undefined) ?? null;
}

function shouldWriteAudit(executor: DbExecutor): boolean {
  return executor === pool;
}

function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getActionPinStatus(userId: UserId, executor: DbExecutor = pool): Promise<ActionPinStatus> {
  const row = await getActionPinRow(userId, executor);
  const idleLock = await getActionPinIdleLockStatus(userId, executor);
  return {
    hasPin: Boolean(row),
    lockedUntil: row?.locked_until ?? null,
    isLocked: isFuture(row?.locked_until),
    idleLockActive: idleLock.active,
    idleLockedAt: idleLock.lockedAt,
    pinExpiresAt: row?.pin_expires_at ?? null,
    isExpired: isPast(row?.pin_expires_at),
    failedAttempts: Number(row?.failed_attempts ?? 0),
  };
}

export async function getActionPinIdleLockStatus(
  userId: UserId | number,
  executor: DbExecutor = pool
): Promise<ActionPinIdleLockStatus> {
  const { rows } = await executor.query<{ locked_at: string }>(
    `
      select locked_at
      from action_pin_idle_locks
      where user_id = $1
        and unlocked_at is null
      limit 1
    `,
    [userId]
  );
  const lockedAt = rows[0]?.locked_at ?? null;
  return { active: Boolean(lockedAt), lockedAt };
}

export async function lockActionPinIdleSession(
  userId: UserId | number,
  executor: DbExecutor = pool
): Promise<ActionPinIdleLockStatus> {
  const { rows } = await executor.query<{ locked_at: string }>(
    `
      insert into action_pin_idle_locks (user_id, locked_at, unlocked_at, updated_at)
      values ($1, now(), null, now())
      on conflict (user_id)
      do update set
        locked_at = case
          when action_pin_idle_locks.unlocked_at is null then action_pin_idle_locks.locked_at
          else now()
        end,
        unlocked_at = null,
        updated_at = now()
      returning locked_at
    `,
    [userId]
  );
  const lockedAt = rows[0]?.locked_at ?? null;
  return { active: Boolean(lockedAt), lockedAt };
}

export async function clearActionPinIdleLock(
  userId: UserId | number,
  executor: DbExecutor = pool
): Promise<ActionPinIdleLockStatus> {
  await executor.query(
    `
      update action_pin_idle_locks
      set unlocked_at = now(),
          updated_at = now()
      where user_id = $1
        and unlocked_at is null
    `,
    [userId]
  );
  return { active: false, lockedAt: null };
}

function mapActionPinAdminUser(row: ActionPinAdminDbRow): ActionPinAdminUserRow {
  return {
    userId: Number(row.user_id),
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    isActive: row.is_active,
    hasActionPin: row.has_action_pin,
    pinRotatedAt: row.pin_rotated_at,
    pinExpiresAt: row.pin_expires_at,
    isExpired: isPast(row.pin_expires_at),
    failedAttempts: Number(row.failed_attempts ?? 0),
    lockedUntil: row.locked_until,
    isLocked: isFuture(row.locked_until),
    updatedAt: row.updated_at,
    updatedByUserId: row.updated_by_user_id == null ? null : Number(row.updated_by_user_id),
    updatedByUsername: row.updated_by_username,
    updatedByFullName: row.updated_by_full_name,
  };
}

export async function listActionPinAdminUsers(
  viewedByUserId: NullableUserId,
  executor: DbExecutor = pool
): Promise<ActionPinAdminUserRow[]> {
  const { rows } = await executor.query<ActionPinAdminDbRow>(
    `
      select
        users.id as user_id,
        users.username,
        users.full_name,
        users.role,
        users.is_active,
        (user_action_pins.user_id is not null) as has_action_pin,
        user_action_pins.pin_rotated_at,
        user_action_pins.pin_expires_at,
        user_action_pins.failed_attempts,
        user_action_pins.locked_until,
        user_action_pins.updated_at,
        user_action_pins.updated_by_user_id,
        updated_by.username as updated_by_username,
        updated_by.full_name as updated_by_full_name
      from users
      left join user_action_pins on user_action_pins.user_id = users.id
      left join users updated_by on updated_by.id = user_action_pins.updated_by_user_id
      order by users.is_active desc, users.full_name asc, users.username asc
    `
  );

  if (shouldWriteAudit(executor)) {
    await logAuditEntry({
      entityType: "action_pin",
      entityId: null,
      actionType: "action_pin_admin_list_viewed",
      oldValues: null,
      newValues: { viewedUserCount: rows.length },
      changedByUserId: viewedByUserId,
    });
  }

  return rows.map((row) => mapActionPinAdminUser(row as ActionPinAdminDbRow));
}

export async function setActionPin(
  userId: UserId,
  pin: unknown,
  updatedByUserId: NullableUserId,
  pinExpiresAt: string | null = null,
  executor: DbExecutor = pool,
  auditActionType?: string
): Promise<{ changed: boolean; pinExpiresAt: string | null }> {
  if (!validateActionPinFormat(pin)) {
    throw new HttpError(400, "Security Action PIN must be 4-8 digits.");
  }

  const previous = await getActionPinRow(userId, executor);
  const pinHash = await bcrypt.hash(String(pin), 10);
  const { rows } = await executor.query(
    `
      insert into user_action_pins (
        user_id, pin_hash, pin_rotated_at, pin_expires_at, failed_attempts, locked_until, updated_at, updated_by_user_id
      )
      values ($1, $2, now(), $3, 0, null, now(), $4)
      on conflict (user_id)
      do update set
        pin_hash = excluded.pin_hash,
        pin_rotated_at = now(),
        pin_expires_at = excluded.pin_expires_at,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now(),
        updated_by_user_id = excluded.updated_by_user_id
      returning user_id, pin_expires_at
    `,
    [userId, pinHash, pinExpiresAt, updatedByUserId]
  );

  if (shouldWriteAudit(executor)) {
    await logAuditEntry({
      entityType: "action_pin",
      entityId: userId,
      actionType: auditActionType ?? (previous ? "action_pin_changed" : "action_pin_set"),
      oldValues: { hadPin: Boolean(previous) },
      newValues: { userId, pinExpiresAt },
      changedByUserId: updatedByUserId,
    });
  }

  return { changed: Boolean(rows[0]), pinExpiresAt };
}

export async function clearActionPin(
  userId: UserId,
  updatedByUserId: NullableUserId,
  executor: DbExecutor = pool,
  auditActionType = "action_pin_reset"
): Promise<{ hadPin: boolean }> {
  const { rows } = await executor.query(
    `
      delete from user_action_pins
      where user_id = $1
      returning user_id
    `,
    [userId]
  );
  const hadPin = rows.length > 0;

  if (shouldWriteAudit(executor)) {
    await logAuditEntry({
      entityType: "action_pin",
      entityId: userId,
      actionType: auditActionType,
      oldValues: { hadPin },
      newValues: { userId },
      changedByUserId: updatedByUserId,
    });
  }

  return { hadPin };
}

export async function unlockActionPinForUser(
  userId: UserId,
  updatedByUserId: NullableUserId,
  executor: DbExecutor = pool
): Promise<{ hadPin: boolean; failedAttempts: number; lockedUntil: string | null }> {
  const previous = await getActionPinRow(userId, executor);
  const { rows } = await executor.query(
    `
      update user_action_pins
      set failed_attempts = 0,
          locked_until = null,
          updated_at = now(),
          updated_by_user_id = $2
      where user_id = $1
      returning failed_attempts, locked_until
    `,
    [userId, updatedByUserId]
  );
  const row = rows[0] as Pick<ActionPinRow, "failed_attempts" | "locked_until"> | undefined;

  if (shouldWriteAudit(executor)) {
    await logAuditEntry({
      entityType: "action_pin",
      entityId: userId,
      actionType: "action_pin_unlocked",
      oldValues: { hadPin: Boolean(previous), failedAttempts: previous?.failed_attempts ?? 0, lockoutUntil: previous?.locked_until ?? null },
      newValues: { userId, failedAttempts: Number(row?.failed_attempts ?? 0), lockoutUntil: row?.locked_until ?? null },
      changedByUserId: updatedByUserId,
    });
  }

  return { hadPin: Boolean(row), failedAttempts: Number(row?.failed_attempts ?? 0), lockedUntil: row?.locked_until ?? null };
}

export async function expireActionPinForUser(
  userId: UserId,
  updatedByUserId: NullableUserId,
  executor: DbExecutor = pool
): Promise<{ hadPin: boolean; pinExpiresAt: string | null }> {
  const previous = await getActionPinRow(userId, executor);
  const { rows } = await executor.query(
    `
      update user_action_pins
      set pin_expires_at = now(),
          updated_at = now(),
          updated_by_user_id = $2
      where user_id = $1
      returning pin_expires_at
    `,
    [userId, updatedByUserId]
  );
  const row = rows[0] as Pick<ActionPinRow, "pin_expires_at"> | undefined;

  if (shouldWriteAudit(executor)) {
    await logAuditEntry({
      entityType: "action_pin",
      entityId: userId,
      actionType: "action_pin_expired_by_admin",
      oldValues: { hadPin: Boolean(previous), pinExpiresAt: previous?.pin_expires_at ?? null },
      newValues: { userId, pinExpiresAt: row?.pin_expires_at ?? null },
      changedByUserId: updatedByUserId,
    });
  }

  return { hadPin: Boolean(row), pinExpiresAt: row?.pin_expires_at ?? null };
}

async function incrementFailedAttempt(
  userId: UserId,
  limits: ActionPinPolicyLimits,
  executor: DbExecutor
): Promise<ActionPinVerifyResult> {
  const current = await getActionPinRow(userId, executor);
  const nextAttempts = Number(current?.failed_attempts ?? 0) + 1;
  const lockedUntil = nextAttempts >= limits.maxFailedAttempts
    ? new Date(Date.now() + limits.lockoutMinutes * 60 * 1000).toISOString()
    : null;
  const { rows } = await executor.query(
    `
      update user_action_pins
      set failed_attempts = failed_attempts + 1,
          locked_until = coalesce($2::timestamptz, locked_until),
          updated_at = now()
      where user_id = $1
      returning failed_attempts, locked_until, pin_expires_at
    `,
    [userId, lockedUntil]
  );
  const row = rows[0] as Pick<ActionPinRow, "failed_attempts" | "locked_until" | "pin_expires_at"> | undefined;

  if (lockedUntil) {
    if (shouldWriteAudit(executor)) {
      await logAuditEntry({
        entityType: "action_pin",
        entityId: userId,
        actionType: "action_pin_locked",
        oldValues: null,
        newValues: { userId, failedAttempts: row?.failed_attempts ?? nextAttempts, lockoutUntil: lockedUntil },
        changedByUserId: userId,
      });
    }
  }

  return {
    ok: false,
    reason: lockedUntil ? "locked" : "invalid",
    failedAttempts: Number(row?.failed_attempts ?? nextAttempts),
    lockedUntil: row?.locked_until ?? lockedUntil,
    pinExpiresAt: row?.pin_expires_at ?? null,
  };
}

async function auditVerifyFailed(
  userId: UserId,
  result: ActionPinVerifyResult,
  executor: DbExecutor,
  auditMetadata: { actionKey?: string | null; role?: string | null }
): Promise<void> {
  if (!shouldWriteAudit(executor)) return;

  await logAuditEntry({
    entityType: "action_pin",
    entityId: userId,
    actionType: "action_pin_verify_failed",
    oldValues: null,
    newValues: {
      userId,
      actionKey: auditMetadata.actionKey ?? null,
      role: auditMetadata.role ?? null,
      outcome: result.reason,
      failedAttempts: result.failedAttempts,
      lockoutUntil: result.lockedUntil,
    },
    changedByUserId: userId,
  });
}

export async function verifyActionPin(
  userId: UserId,
  pin: unknown,
  limits: ActionPinPolicyLimits,
  executor: DbExecutor = pool,
  auditMetadata: { actionKey?: string | null; role?: string | null } = {}
): Promise<ActionPinVerifyResult> {
  if (!validateActionPinFormat(pin)) {
    const result: ActionPinVerifyResult = { ok: false, reason: "invalid_format", failedAttempts: 0, lockedUntil: null, pinExpiresAt: null };
    await auditVerifyFailed(userId, result, executor, auditMetadata);
    return result;
  }

  const row = await getActionPinRow(userId, executor);
  if (!row) {
    const result: ActionPinVerifyResult = { ok: false, reason: "not_set", failedAttempts: 0, lockedUntil: null, pinExpiresAt: null };
    await auditVerifyFailed(userId, result, executor, auditMetadata);
    return result;
  }

  if (isFuture(row.locked_until)) {
    const result: ActionPinVerifyResult = { ok: false, reason: "locked", failedAttempts: row.failed_attempts, lockedUntil: row.locked_until, pinExpiresAt: row.pin_expires_at };
    await auditVerifyFailed(userId, result, executor, auditMetadata);
    return result;
  }

  if (isPast(row.pin_expires_at)) {
    const result: ActionPinVerifyResult = { ok: false, reason: "expired", failedAttempts: row.failed_attempts, lockedUntil: row.locked_until, pinExpiresAt: row.pin_expires_at };
    await auditVerifyFailed(userId, result, executor, auditMetadata);
    return result;
  }

  const matches = await bcrypt.compare(String(pin), row.pin_hash);
  if (!matches) {
    const failed = await incrementFailedAttempt(userId, limits, executor);
    await auditVerifyFailed(userId, failed, executor, auditMetadata);
    return failed;
  }

  const { rows } = await executor.query(
    `
      update user_action_pins
      set failed_attempts = 0,
          locked_until = null,
          updated_at = now()
      where user_id = $1
      returning failed_attempts, locked_until, pin_expires_at
    `,
    [userId]
  );
  const updated = rows[0] as Pick<ActionPinRow, "failed_attempts" | "locked_until" | "pin_expires_at"> | undefined;

  if (shouldWriteAudit(executor)) {
    await logAuditEntry({
      entityType: "action_pin",
      entityId: userId,
      actionType: "action_pin_verify_success",
      oldValues: null,
      newValues: { userId, actionKey: auditMetadata.actionKey ?? null, role: auditMetadata.role ?? null, outcome: "success" },
      changedByUserId: userId,
    });
  }

  return {
    ok: true,
    failedAttempts: Number(updated?.failed_attempts ?? 0),
    lockedUntil: updated?.locked_until ?? null,
    pinExpiresAt: updated?.pin_expires_at ?? null,
  };
}

export async function createActionPinVerification({
  userId,
  actionKey = null,
  reason = null,
  ttlSeconds,
  ipAddress = null,
  userAgent = null,
  executor = pool,
}: ActionPinVerificationInput): Promise<{ token: string; expiresAt: string; verificationId: number }> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashVerificationToken(token);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const { rows } = await executor.query(
    `
      insert into action_pin_verifications (
        user_id,
        action_key,
        reason,
        verification_token_hash,
        expires_at,
        ip_address,
        user_agent
      )
      values ($1, $2, $3, $4, $5::timestamptz, $6, $7)
      returning id, expires_at
    `,
    [userId, actionKey, reason, tokenHash, expiresAt, ipAddress, userAgent]
  );
  const row = rows[0] as { id?: number; expires_at?: string } | undefined;
  return { token, expiresAt: String(row?.expires_at ?? expiresAt), verificationId: Number(row?.id ?? 0) };
}

export async function validateActionPinVerification({
  userId,
  token,
  actionKey = null,
  consume,
  requireActionScoped = false,
  executor = pool,
}: ActionPinVerificationValidationInput): Promise<ActionPinVerificationValidationResult> {
  const cleanToken = String(token ?? "").trim();
  if (!cleanToken) {
    return { ok: false, reason: "missing_token" };
  }

  const tokenHash = hashVerificationToken(cleanToken);
  const lookupSql = consume
    ? `
      update action_pin_verifications
      set consumed_at = now()
      where user_id = $1
        and verification_token_hash = $2
        and consumed_at is null
        and expires_at > now()
        and (
          ($4::boolean = true and action_key = $3::text)
          or ($4::boolean = false and ($3::text is null or action_key is null or action_key = $3::text))
        )
      returning id, user_id, action_key, reason, expires_at, consumed_at
    `
    : `
      select id, user_id, action_key, reason, expires_at, consumed_at
      from action_pin_verifications
      where user_id = $1
        and verification_token_hash = $2
        and consumed_at is null
        and expires_at > now()
        and (
          $3::text is null
          or ($4::boolean = true and action_key = $3::text)
          or ($4::boolean = false and (action_key is null or action_key = $3::text))
        )
      order by created_at desc
      limit 1
    `;
  const { rows } = await executor.query(lookupSql, [userId, tokenHash, actionKey, requireActionScoped]);
  const row = rows[0] as unknown as ActionPinVerificationRow | undefined;
  if (!row) {
    return { ok: false, reason: "not_found" };
  }

  return {
    ok: true,
    verificationId: row.id,
    actionKey: row.action_key,
    actionReason: row.reason,
    expiresAt: row.expires_at,
  };
}
