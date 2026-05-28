import bcrypt from "bcryptjs";
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
  pinExpiresAt: string | null;
  isExpired: boolean;
  failedAttempts: number;
}

export type ActionPinVerifyFailureReason = "not_set" | "invalid_format" | "invalid" | "locked" | "expired";

export interface ActionPinVerifyResult {
  ok: boolean;
  reason?: ActionPinVerifyFailureReason;
  failedAttempts: number;
  lockedUntil: string | null;
  pinExpiresAt: string | null;
}

interface ActionPinRow {
  user_id: number;
  pin_hash: string;
  pin_rotated_at?: string;
  pin_expires_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
}

export function validateActionPinFormat(pin: unknown): boolean {
  return /^\d{4}$/.test(String(pin ?? ""));
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

export async function getActionPinStatus(userId: UserId, executor: DbExecutor = pool): Promise<ActionPinStatus> {
  const row = await getActionPinRow(userId, executor);
  return {
    hasPin: Boolean(row),
    lockedUntil: row?.locked_until ?? null,
    isLocked: isFuture(row?.locked_until),
    pinExpiresAt: row?.pin_expires_at ?? null,
    isExpired: isPast(row?.pin_expires_at),
    failedAttempts: Number(row?.failed_attempts ?? 0),
  };
}

export async function setActionPin(
  userId: UserId,
  pin: unknown,
  updatedByUserId: NullableUserId,
  pinExpiresAt: string | null = null,
  executor: DbExecutor = pool
): Promise<{ changed: boolean; pinExpiresAt: string | null }> {
  if (!validateActionPinFormat(pin)) {
    throw new HttpError(400, "Action PIN must be exactly 4 digits.");
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
      actionType: previous ? "action_pin_changed" : "action_pin_set",
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
  executor: DbExecutor = pool
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
      actionType: "action_pin_reset",
      oldValues: { hadPin },
      newValues: { userId },
      changedByUserId: updatedByUserId,
    });
  }

  return { hadPin };
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
