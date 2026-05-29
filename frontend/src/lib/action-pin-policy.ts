export const ACTION_PIN_ROLES = [
  "receptionist",
  "supervisor",
  "super_admin",
  "modality_staff",
  "doctor",
  "administrative",
] as const;

export const ACTION_PIN_MODES = [
  "not_required",
  "required_after_inactivity",
  "required_every_time",
  "required_every_time_with_reason",
  "disabled_for_role",
] as const;

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

export type ActionPinRole = (typeof ACTION_PIN_ROLES)[number];
export type ActionPinMode = (typeof ACTION_PIN_MODES)[number];
export type ActionPinActionKey = (typeof ACTION_PIN_ACTION_KEYS)[number];
export type ActionPinRotationMode = "manual" | "daily" | "weekly" | "monthly";

export type ActionPinPolicy = Record<string, unknown> & {
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
  actionModes: Record<string, Partial<Record<ActionPinRole, ActionPinMode>>>;
  reasonRequiredModes: Record<string, boolean>;
  disabledForRoleModes: Record<string, ActionPinRole[]>;
};

export const ACTION_PIN_MODE_LABELS: Record<ActionPinMode, string> = {
  not_required: "Not required",
  required_after_inactivity: "After inactivity",
  required_every_time: "Every time",
  required_every_time_with_reason: "Every time + reason",
  disabled_for_role: "Disabled",
};

export const ACTION_PIN_ROLE_LABELS: Record<ActionPinRole, string> = {
  receptionist: "Receptionist",
  supervisor: "Supervisor",
  super_admin: "Super admin",
  modality_staff: "Modality staff",
  doctor: "Doctor",
  administrative: "Administrative",
};

export const ACTION_PIN_ACTION_LABELS: Record<ActionPinActionKey, string> = {
  patient_create: "Create patient",
  patient_update: "Edit patient",
  patient_identifier_update: "Edit identifier",
  patient_contact_update: "Edit contact",
  patient_demographics_update: "Edit demographics",
  patient_merge: "Merge patient",
  patient_delete: "Delete patient",
  appointment_create: "Create appointment",
  appointment_update: "Edit appointment",
  appointment_reschedule: "Reschedule appointment",
  appointment_cancel: "Cancel appointment",
  appointment_void: "Void appointment",
  registration_create: "Create registration",
  registration_update: "Edit registration",
  queue_scan: "Scan into queue",
  queue_walk_in: "Walk-in",
  queue_confirm_no_show: "Confirm / mark no-show",
  queue_status_update: "Queue status update",
  appointment_complete: "Complete appointment",
  duplicate_patient_merge: "Duplicate merge",
  duplicate_patient_safe_delete: "Duplicate safe delete",
  patient_import_confirm: "Patient import confirmation",
  pacs_patient_remap: "PACS patient remap",
};

export const ACTION_PIN_GROUPS: Array<{ label: string; actions: ActionPinActionKey[] }> = [
  {
    label: "Patient identity",
    actions: [
      "patient_create",
      "patient_update",
      "patient_identifier_update",
      "patient_demographics_update",
      "patient_contact_update",
      "patient_merge",
      "patient_delete",
    ],
  },
  {
    label: "Appointments and registration",
    actions: [
      "appointment_create",
      "registration_create",
      "appointment_update",
      "registration_update",
      "appointment_reschedule",
      "appointment_cancel",
      "appointment_void",
    ],
  },
  {
    label: "Queue",
    actions: [
      "queue_walk_in",
      "queue_confirm_no_show",
      "queue_status_update",
      "appointment_complete",
      "queue_scan",
    ],
  },
  {
    label: "High-risk admin workflows",
    actions: [
      "duplicate_patient_merge",
      "duplicate_patient_safe_delete",
      "patient_import_confirm",
      "pacs_patient_remap",
    ],
  },
];

function buildDefaultActionModes(): ActionPinPolicy["actionModes"] {
  const matrix: ActionPinPolicy["actionModes"] = Object.fromEntries(
    ACTION_PIN_ACTION_KEYS.map((actionKey) => [actionKey, {}])
  );
  for (const actionKey of ["patient_create", "patient_update", "appointment_create", "registration_create"] as ActionPinActionKey[]) {
    matrix[actionKey].receptionist = "required_every_time";
  }
  for (const actionKey of [
    "patient_identifier_update",
    "patient_contact_update",
    "patient_demographics_update",
    "patient_merge",
    "patient_delete",
    "duplicate_patient_merge",
    "duplicate_patient_safe_delete",
    "patient_import_confirm",
    "pacs_patient_remap",
  ] as ActionPinActionKey[]) {
    for (const role of ["receptionist", "supervisor", "modality_staff", "doctor", "administrative"] as ActionPinRole[]) {
      matrix[actionKey][role] = "required_every_time_with_reason";
    }
  }
  for (const actionKey of ACTION_PIN_ACTION_KEYS) {
    matrix[actionKey].super_admin = "not_required";
  }
  return matrix;
}

const DEFAULT_ACTION_MODES: ActionPinPolicy["actionModes"] = buildDefaultActionModes();

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
  actionModes: DEFAULT_ACTION_MODES,
  reasonRequiredModes: {},
  disabledForRoleModes: {},
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isMode(value: unknown): value is ActionPinMode {
  return ACTION_PIN_MODES.includes(value as ActionPinMode);
}

function normalizeActionModes(input: unknown): ActionPinPolicy["actionModes"] {
  const source = asRecord(input);
  const next: ActionPinPolicy["actionModes"] = {
    ...buildDefaultActionModes(),
    ...source as ActionPinPolicy["actionModes"],
  };
  for (const actionKey of ACTION_PIN_ACTION_KEYS) {
    const roleModes = asRecord(source[actionKey]);
    next[actionKey] = { ...buildDefaultActionModes()[actionKey], ...roleModes } as Partial<Record<ActionPinRole, ActionPinMode>>;
    for (const role of ACTION_PIN_ROLES) {
      if (!isMode(next[actionKey][role])) {
        delete next[actionKey][role];
      }
    }
  }
  return next;
}

export function normalizeActionPinPolicy(input: unknown): ActionPinPolicy {
  const source = asRecord(input);
  const rotationMode = String(source.rotationMode ?? DEFAULT_ACTION_PIN_POLICY.rotationMode);
  return {
    ...source,
    enabled: asBoolean(source.enabled, DEFAULT_ACTION_PIN_POLICY.enabled),
    pinLength: 4,
    rotationMode: ["manual", "daily", "weekly", "monthly"].includes(rotationMode) ? rotationMode as ActionPinRotationMode : "manual",
    rotationIntervalDays: asNumber(source.rotationIntervalDays, DEFAULT_ACTION_PIN_POLICY.rotationIntervalDays),
    expirePinAfterRotation: asBoolean(source.expirePinAfterRotation, DEFAULT_ACTION_PIN_POLICY.expirePinAfterRotation),
    verificationTtlSeconds: asNumber(source.verificationTtlSeconds, DEFAULT_ACTION_PIN_POLICY.verificationTtlSeconds),
    idleLockEnabled: asBoolean(source.idleLockEnabled, DEFAULT_ACTION_PIN_POLICY.idleLockEnabled),
    idleLockSeconds: asNumber(source.idleLockSeconds, DEFAULT_ACTION_PIN_POLICY.idleLockSeconds),
    maxFailedAttempts: asNumber(source.maxFailedAttempts, DEFAULT_ACTION_PIN_POLICY.maxFailedAttempts),
    lockoutMinutes: asNumber(source.lockoutMinutes, DEFAULT_ACTION_PIN_POLICY.lockoutMinutes),
    allowUserPinChange: asBoolean(source.allowUserPinChange, DEFAULT_ACTION_PIN_POLICY.allowUserPinChange),
    allowUserPinRegenerate: asBoolean(source.allowUserPinRegenerate, DEFAULT_ACTION_PIN_POLICY.allowUserPinRegenerate),
    requirePinToViewOwnPinSettings: asBoolean(source.requirePinToViewOwnPinSettings, DEFAULT_ACTION_PIN_POLICY.requirePinToViewOwnPinSettings),
    notifyUserOnPinChange: asBoolean(source.notifyUserOnPinChange, DEFAULT_ACTION_PIN_POLICY.notifyUserOnPinChange),
    actionModes: normalizeActionModes(source.actionModes),
    reasonRequiredModes: asRecord(source.reasonRequiredModes) as Record<string, boolean>,
    disabledForRoleModes: asRecord(source.disabledForRoleModes) as Record<string, ActionPinRole[]>,
  };
}
