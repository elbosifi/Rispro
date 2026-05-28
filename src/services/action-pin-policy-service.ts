import { ROLE_VALUES, isRole } from "../constants/roles.js";
import { pool } from "../db/pool.js";
import { logAuditEntry } from "./audit-service.js";
import type { Role } from "../types/domain.js";
import type { DbExecutor } from "../types/db.js";
import type { UserId } from "../types/http.js";

export const ACTION_PIN_SETTINGS_CATEGORY = "users_and_roles";
export const ACTION_PIN_POLICY_SETTING_KEY = "action_pin_policy";

export const ACTION_PIN_ACTION_KEYS = [
  "patient_create",
  "patient_update",
  "patient_identifier_update",
  "patient_contact_update",
  "patient_demographics_update",
  "patient_merge",
  "patient_delete",
  "appointment_create",
  "appointment_update",
  "appointment_reschedule",
  "appointment_cancel",
  "appointment_void",
  "registration_create",
  "registration_update",
  "queue_scan",
  "queue_walk_in",
  "queue_confirm_no_show",
  "queue_status_update",
  "appointment_complete",
  "duplicate_patient_merge",
  "duplicate_patient_safe_delete",
  "patient_import_confirm",
  "pacs_patient_remap",
] as const;

export const ACTION_PIN_MODES = [
  "not_required",
  "required_after_inactivity",
  "required_every_time",
  "required_every_time_with_reason",
  "disabled_for_role",
] as const;

export type ActionPinActionKey = (typeof ACTION_PIN_ACTION_KEYS)[number];
export type ActionPinMode = (typeof ACTION_PIN_MODES)[number];
export type ActionPinRotationMode = "manual" | "daily" | "weekly" | "monthly";
export type ActionPinRoleMatrix = Record<ActionPinActionKey, Partial<Record<Role, ActionPinMode>>>;

export interface ActionPinPolicy {
  enabled: boolean;
  pinLength: 4;
  rotationMode: ActionPinRotationMode;
  rotationIntervalDays: number;
  expirePinAfterRotation: boolean;
  verificationTtlSeconds: number;
  idleLockEnabled: boolean;
  idleLockSeconds: number;
  maxFailedAttempts: number;
  lockoutMinutes: number;
  allowUserPinChange: boolean;
  allowUserPinRegenerate: boolean;
  requirePinToViewOwnPinSettings: boolean;
  notifyUserOnPinChange: boolean;
  actionModes: ActionPinRoleMatrix;
  reasonRequiredModes: Partial<Record<ActionPinActionKey, boolean>>;
  disabledForRoleModes: Partial<Record<ActionPinActionKey, Role[]>>;
}

export interface ResolvedActionPinRequirement {
  mode: ActionPinMode;
  required: boolean;
  requiresReason: boolean;
  disabledForRole: boolean;
  verificationTtlSeconds: number;
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

const ACTION_KEYS = new Set<string>(ACTION_PIN_ACTION_KEYS);
const MODES = new Set<string>(ACTION_PIN_MODES);
const ROTATION_MODES = new Set<string>(["manual", "daily", "weekly", "monthly"]);

function emptyActionMatrix(): ActionPinRoleMatrix {
  return ACTION_PIN_ACTION_KEYS.reduce((matrix, actionKey) => {
    matrix[actionKey] = {};
    return matrix;
  }, {} as ActionPinRoleMatrix);
}

function withMode(
  matrix: ActionPinRoleMatrix,
  actionKeys: ActionPinActionKey[],
  roles: Role[],
  mode: ActionPinMode
): void {
  for (const actionKey of actionKeys) {
    for (const role of roles) {
      matrix[actionKey][role] = mode;
    }
  }
}

function defaultActionModes(): ActionPinRoleMatrix {
  const matrix = emptyActionMatrix();
  withMode(matrix, ["patient_create", "patient_update", "appointment_create", "registration_create"], ["receptionist"], "required_every_time");
  withMode(
    matrix,
    [
      "patient_identifier_update",
      "patient_contact_update",
      "patient_demographics_update",
      "patient_merge",
      "patient_delete",
      "duplicate_patient_merge",
      "duplicate_patient_safe_delete",
      "patient_import_confirm",
      "pacs_patient_remap",
    ],
    ["receptionist", "supervisor", "modality_staff", "doctor", "administrative"],
    "required_every_time_with_reason"
  );

  for (const actionKey of ACTION_PIN_ACTION_KEYS) {
    matrix[actionKey].super_admin = "not_required";
  }

  return matrix;
}

export const DEFAULT_ACTION_PIN_POLICY: ActionPinPolicy = {
  enabled: false,
  pinLength: 4,
  rotationMode: "manual",
  rotationIntervalDays: 0,
  expirePinAfterRotation: false,
  verificationTtlSeconds: 300,
  idleLockEnabled: false,
  idleLockSeconds: 180,
  maxFailedAttempts: 5,
  lockoutMinutes: 15,
  allowUserPinChange: true,
  allowUserPinRegenerate: false,
  requirePinToViewOwnPinSettings: false,
  notifyUserOnPinChange: false,
  actionModes: defaultActionModes(),
  reasonRequiredModes: {},
  disabledForRoleModes: {},
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const clean = value.trim().toLowerCase();
    if (["true", "1", "yes", "enabled"].includes(clean)) return true;
    if (["false", "0", "no", "disabled"].includes(clean)) return false;
  }
  return fallback;
}

function asInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function normalizeActionModes(input: unknown): ActionPinRoleMatrix {
  const source = asRecord(input);
  const normalized = defaultActionModes();

  for (const [actionKey, rawRoles] of Object.entries(source)) {
    if (!ACTION_KEYS.has(actionKey)) continue;
    const roleModes = asRecord(rawRoles);
    for (const [role, mode] of Object.entries(roleModes)) {
      if (!isRole(role) || !MODES.has(String(mode))) continue;
      normalized[actionKey as ActionPinActionKey][role] = mode as ActionPinMode;
    }
  }

  return normalized;
}

function normalizeReasonRequiredModes(input: unknown): Partial<Record<ActionPinActionKey, boolean>> {
  const source = asRecord(input);
  const result: Partial<Record<ActionPinActionKey, boolean>> = {};
  for (const [actionKey, value] of Object.entries(source)) {
    if (ACTION_KEYS.has(actionKey)) {
      result[actionKey as ActionPinActionKey] = asBoolean(value, false);
    }
  }
  return result;
}

function normalizeDisabledForRoleModes(input: unknown): Partial<Record<ActionPinActionKey, Role[]>> {
  const source = asRecord(input);
  const result: Partial<Record<ActionPinActionKey, Role[]>> = {};
  for (const [actionKey, rawRoles] of Object.entries(source)) {
    if (!ACTION_KEYS.has(actionKey) || !Array.isArray(rawRoles)) continue;
    result[actionKey as ActionPinActionKey] = rawRoles.filter((role): role is Role => isRole(role));
  }
  return result;
}

export function normalizeActionPinPolicy(input: unknown): ActionPinPolicy {
  const raw = asRecord(input);
  const value = "value" in raw ? asRecord(raw.value) : raw;
  const rotationMode = String(value.rotationMode ?? DEFAULT_ACTION_PIN_POLICY.rotationMode);

  return {
    enabled: asBoolean(value.enabled, DEFAULT_ACTION_PIN_POLICY.enabled),
    pinLength: 4,
    rotationMode: ROTATION_MODES.has(rotationMode) ? rotationMode as ActionPinRotationMode : "manual",
    rotationIntervalDays: asInteger(value.rotationIntervalDays, DEFAULT_ACTION_PIN_POLICY.rotationIntervalDays, 0, 365),
    expirePinAfterRotation: asBoolean(value.expirePinAfterRotation, DEFAULT_ACTION_PIN_POLICY.expirePinAfterRotation),
    verificationTtlSeconds: asInteger(value.verificationTtlSeconds, DEFAULT_ACTION_PIN_POLICY.verificationTtlSeconds, 30, 86400),
    idleLockEnabled: asBoolean(value.idleLockEnabled, DEFAULT_ACTION_PIN_POLICY.idleLockEnabled),
    idleLockSeconds: asInteger(value.idleLockSeconds, DEFAULT_ACTION_PIN_POLICY.idleLockSeconds, 30, 86400),
    maxFailedAttempts: asInteger(value.maxFailedAttempts, DEFAULT_ACTION_PIN_POLICY.maxFailedAttempts, 1, 50),
    lockoutMinutes: asInteger(value.lockoutMinutes, DEFAULT_ACTION_PIN_POLICY.lockoutMinutes, 1, 1440),
    allowUserPinChange: asBoolean(value.allowUserPinChange, DEFAULT_ACTION_PIN_POLICY.allowUserPinChange),
    allowUserPinRegenerate: asBoolean(value.allowUserPinRegenerate, DEFAULT_ACTION_PIN_POLICY.allowUserPinRegenerate),
    requirePinToViewOwnPinSettings: asBoolean(value.requirePinToViewOwnPinSettings, DEFAULT_ACTION_PIN_POLICY.requirePinToViewOwnPinSettings),
    notifyUserOnPinChange: asBoolean(value.notifyUserOnPinChange, DEFAULT_ACTION_PIN_POLICY.notifyUserOnPinChange),
    actionModes: normalizeActionModes(value.actionModes),
    reasonRequiredModes: normalizeReasonRequiredModes(value.reasonRequiredModes),
    disabledForRoleModes: normalizeDisabledForRoleModes(value.disabledForRoleModes),
  };
}

export function resolveActionPinRequirement(
  policy: ActionPinPolicy,
  role: Role,
  actionKey: ActionPinActionKey
): ResolvedActionPinRequirement {
  const disabledForRole = policy.disabledForRoleModes[actionKey]?.includes(role) === true;
  const mode = !policy.enabled
    ? "not_required"
    : disabledForRole
      ? "disabled_for_role"
      : policy.actionModes[actionKey]?.[role] ?? "not_required";
  const requiresReason = mode === "required_every_time_with_reason" || policy.reasonRequiredModes[actionKey] === true;

  return {
    mode,
    required: mode !== "not_required" && mode !== "disabled_for_role",
    requiresReason,
    disabledForRole: mode === "disabled_for_role",
    verificationTtlSeconds: policy.verificationTtlSeconds,
    maxFailedAttempts: policy.maxFailedAttempts,
    lockoutMinutes: policy.lockoutMinutes,
  };
}

export async function readActionPinPolicy(executor: DbExecutor = pool): Promise<ActionPinPolicy> {
  const { rows } = await executor.query(
    `
      select setting_value
      from system_settings
      where category = $1 and setting_key = $2
      limit 1
    `,
    [ACTION_PIN_SETTINGS_CATEGORY, ACTION_PIN_POLICY_SETTING_KEY]
  );
  return normalizeActionPinPolicy((rows[0] as { setting_value?: unknown } | undefined)?.setting_value);
}

export async function saveActionPinPolicy(input: unknown, updatedByUserId: UserId): Promise<ActionPinPolicy> {
  const normalized = normalizeActionPinPolicy(input);
  const previous = await readActionPinPolicy();
  const { rows } = await pool.query<{ id: number }>(
    `
      insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
      values ($1, $2, $3::jsonb, $4)
      on conflict (category, setting_key)
      do update set
        setting_value = excluded.setting_value,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now()
      returning id
    `,
    [ACTION_PIN_SETTINGS_CATEGORY, ACTION_PIN_POLICY_SETTING_KEY, JSON.stringify({ value: normalized }), updatedByUserId]
  );

  await logAuditEntry({
    entityType: "system_setting",
    entityId: rows[0]?.id ?? null,
    actionType: "action_pin_policy_updated",
    oldValues: previous,
    newValues: normalized,
    changedByUserId: updatedByUserId,
  });

  return normalized;
}

export function isActionPinActionKey(value: unknown): value is ActionPinActionKey {
  return typeof value === "string" && ACTION_KEYS.has(value);
}

export const ACTION_PIN_ROLES = ROLE_VALUES;
