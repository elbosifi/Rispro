import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  expireUserActionPin,
  fetchActionPinAdminUsers,
  fetchActionPinPolicy,
  fetchActionPinStatus,
  resetUserActionPin,
  saveActionPinPolicy,
  unlockUserActionPin,
  type ActionPinAdminUser,
} from "@/lib/api-hooks";
import {
  ACTION_PIN_ACTION_LABELS,
  ACTION_PIN_GROUPS,
  ACTION_PIN_MODE_LABELS,
  ACTION_PIN_MODES,
  ACTION_PIN_ROLE_LABELS,
  ACTION_PIN_ROLES,
  normalizeActionPinPolicy,
  type ActionPinActionKey,
  type ActionPinMode,
  type ActionPinPolicy,
  type ActionPinRole,
  type ActionPinIdleLockRoleMode,
  type ActionPinRotationMode,
} from "@/lib/action-pin-policy";
import { useLanguage } from "@/providers/language-provider";

function isReAuthRequiredError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return message.includes("re-authentication") || message.includes("403");
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-semibold text-stone-600 dark:text-stone-300">{children}</span>;
}

function BoolField({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-stone-200 p-3 text-sm dark:border-stone-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function NumberField({
  label,
  value,
  disabled,
  onChange
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1">
      <FieldLabel>{label}</FieldLabel>
      <input
        aria-label={label}
        type="number"
        min={0}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:bg-stone-100 disabled:text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:disabled:bg-stone-800"
      />
    </label>
  );
}

function validate(policy: ActionPinPolicy): string | null {
  if (policy.verificationTtlSeconds <= 0) return "Verification TTL seconds must be greater than 0.";
  if (policy.idleLockEnabled && policy.idleLockSeconds <= 0) return "Idle lock seconds must be greater than 0 when idle lock is enabled.";
  if (policy.maxFailedAttempts <= 0) return "Max failed attempts must be greater than 0.";
  if (policy.lockoutMinutes <= 0) return "Lockout minutes must be greater than 0.";
  if (policy.rotationMode !== "manual" && policy.rotationIntervalDays <= 0) return "Rotation interval days must be greater than 0 when rotation is scheduled.";
  return null;
}

function formatUserIds(ids: number[] | undefined): string {
  return (ids ?? []).join(", ");
}

function parseUserIds(value: string): number[] {
  const result: number[] = [];
  for (const raw of value.split(",")) {
    const id = Number(raw.trim());
    if (Number.isInteger(id) && id > 0 && !result.includes(id)) result.push(id);
  }
  return result;
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function UserPinManagementTable({
  policyEnabled,
  onReAuthRequired,
}: {
  policyEnabled: boolean;
  onReAuthRequired: (key: string[]) => void;
}) {
  const queryClient = useQueryClient();
  const [roleFilter, setRoleFilter] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [pinFilter, setPinFilter] = useState<"all" | "missing" | "locked" | "expired">("all");
  const [message, setMessage] = useState("");
  const query = useQuery({
    queryKey: ["action-pin", "admin", "users"],
    queryFn: fetchActionPinAdminUsers,
    retry: false,
  });

  useEffect(() => {
    if (query.error && isReAuthRequiredError(query.error)) {
      onReAuthRequired(["action-pin", "admin", "users"]);
    }
  }, [onReAuthRequired, query.error]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["action-pin", "admin", "users"] });
  };
  const actionMutation = useMutation({
    mutationFn: async ({ action, user }: { action: "reset" | "unlock" | "expire"; user: ActionPinAdminUser }) => {
      if (action === "reset") return resetUserActionPin(user.userId);
      if (action === "unlock") return unlockUserActionPin(user.userId);
      return expireUserActionPin(user.userId);
    },
    onSuccess: async () => {
      setMessage("User Action PIN status updated.");
      await refresh();
    },
    onError: (err) => setMessage(err instanceof Error ? err.message : "Failed to update user Action PIN."),
  });

  const runAction = (action: "reset" | "unlock" | "expire", user: ActionPinAdminUser) => {
    const prompt = action === "reset"
      ? `Reset Action PIN for ${user.fullName}? The user will need to set a new PIN.`
      : action === "expire"
        ? `Force expire Action PIN for ${user.fullName}?`
        : "";
    if (prompt && !window.confirm(prompt)) return;
    setMessage("");
    actionMutation.mutate({ action, user });
  };

  const users = query.data ?? [];
  const filteredUsers = users.filter((user) => {
    if (roleFilter !== "all" && user.role !== roleFilter) return false;
    if (activeOnly && !user.isActive) return false;
    if (pinFilter === "missing" && user.hasActionPin) return false;
    if (pinFilter === "locked" && !user.isLocked) return false;
    if (pinFilter === "expired" && !user.isExpired) return false;
    return true;
  });
  const activeUsers = users.filter((user) => user.isActive);
  const summary = {
    totalUsers: users.length,
    activeUsers: activeUsers.length,
    activeWithPin: activeUsers.filter((user) => user.hasActionPin).length,
    activeWithoutPin: activeUsers.filter((user) => !user.hasActionPin).length,
    lockedUsers: users.filter((user) => user.isLocked).length,
    expiredPins: users.filter((user) => user.isExpired).length,
  };

  if (query.isLoading) return <p className="description-center">Loading user PIN readiness...</p>;
  if (query.error) {
    if (isReAuthRequiredError(query.error)) return null;
    return <p className="text-sm text-red-600">{query.error instanceof Error ? query.error.message : "Failed to load user PIN readiness."}</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">User PIN Readiness / User PIN Management</h4>
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          <p>Admins cannot view user PINs.</p>
          <p>Resetting a PIN requires the user to set a new PIN.</p>
          <p>Users without a PIN may be blocked if Action PIN enforcement is enabled.</p>
        </div>
      </div>

      {policyEnabled ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6" data-testid="action-pin-readiness-summary">
          {[
            ["Total users", summary.totalUsers],
            ["Active users", summary.activeUsers],
            ["Active with PIN", summary.activeWithPin],
            ["Active without PIN", summary.activeWithoutPin],
            ["Locked users", summary.lockedUsers],
            ["Expired PINs", summary.expiredPins],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">{label}</p>
              <p className="mt-1 text-xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <select aria-label="Filter by role" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="all">All roles</option>
          {ACTION_PIN_ROLES.map((role) => <option key={role} value={role}>{ACTION_PIN_ROLE_LABELS[role]}</option>)}
        </select>
        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
          <input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} />
          Active only
        </label>
        <select aria-label="Filter by PIN status" value={pinFilter} onChange={(event) => setPinFilter(event.target.value as typeof pinFilter)} className="rounded-lg border px-3 py-2 text-sm">
          <option value="all">All PIN states</option>
          <option value="missing">PIN missing</option>
          <option value="locked">Locked</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      <div className="overflow-auto rounded-lg border border-stone-200 dark:border-stone-700">
        <table className="w-full min-w-[1100px] text-sm">
          <thead>
            <tr className="bg-stone-100 dark:bg-stone-800">
              {["User", "Username", "Role", "Active", "PIN status", "Expiry", "Lock status", "Failed attempts", "Last PIN update", "Actions"].map((column) => (
                <th key={column} className="p-2 text-start font-semibold">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={user.userId} className="border-t border-stone-200 dark:border-stone-700">
                <td className="p-2">{user.fullName}</td>
                <td className="p-2 font-mono text-xs">{user.username}</td>
                <td className="p-2">{user.role}</td>
                <td className="p-2">{user.isActive ? "Active" : "Inactive"}</td>
                <td className="p-2">{user.hasActionPin ? "Set" : "Not set"}</td>
                <td className="p-2">{!user.hasActionPin ? "No expiry" : user.isExpired ? "Expired" : user.pinExpiresAt ? "Valid" : "No expiry"}</td>
                <td className="p-2">{user.isLocked ? "Locked" : "Not locked"}</td>
                <td className="p-2">{user.failedAttempts}</td>
                <td className="p-2">{formatDate(user.updatedAt)}</td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className="btn-secondary text-xs" onClick={() => runAction("reset", user)}>Reset PIN</button>
                    <button type="button" className="btn-secondary text-xs" disabled={!user.isLocked} onClick={() => runAction("unlock", user)}>Unlock PIN</button>
                    <button type="button" className="btn-secondary text-xs" disabled={!user.hasActionPin} onClick={() => runAction("expire", user)}>Force expire PIN</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filteredUsers.length === 0 ? <p className="text-sm description-center">No users match the selected filters.</p> : null}
      {message ? <p className="text-sm text-stone-700 dark:text-stone-200">{message}</p> : null}
    </div>
  );
}

export default function ActionPinPolicySection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ActionPinPolicy>(() => normalizeActionPinPolicy({}));
  const [idleIncludedUserIdsText, setIdleIncludedUserIdsText] = useState("");
  const [idleExcludedUserIdsText, setIdleExcludedUserIdsText] = useState("");
  const [message, setMessage] = useState("");
  const isArabic = language === "ar";

  const query = useQuery({
    queryKey: ["settings", "users_and_roles", "action_pin_policy"],
    queryFn: fetchActionPinPolicy,
    staleTime: 1000 * 60,
    retry: false,
  });
  const currentUserPinQuery = useQuery({
    queryKey: ["action-pin", "status"],
    queryFn: fetchActionPinStatus,
    staleTime: 1000 * 60,
    retry: false,
  });

  useEffect(() => {
    if (query.data) {
      const normalized = normalizeActionPinPolicy(query.data);
      setDraft(normalized);
      setIdleIncludedUserIdsText(formatUserIds(normalized.idleLockUserIds));
      setIdleExcludedUserIdsText(formatUserIds(normalized.idleLockExcludedUserIds));
    }
  }, [query.data]);

  useEffect(() => {
    if (query.error && isReAuthRequiredError(query.error)) {
      onReAuthRequired(["settings", "users_and_roles", "action_pin_policy"]);
    }
  }, [onReAuthRequired, query.error]);

  const update = <K extends keyof ActionPinPolicy>(key: K, value: ActionPinPolicy[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage("");
  };

  const updateMode = (actionKey: ActionPinActionKey, role: ActionPinRole, mode: ActionPinMode) => {
    setDraft((current) => ({
      ...current,
      actionModes: {
        ...current.actionModes,
        [actionKey]: {
          ...(current.actionModes[actionKey] ?? {}),
          [role]: mode,
        },
      },
    }));
    setMessage("");
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const validationError = validate(draft);
      if (validationError) throw new Error(validationError);
      return saveActionPinPolicy(draft);
    },
    onSuccess: async (saved) => {
      const normalized = normalizeActionPinPolicy(saved);
      setDraft(normalized);
      setIdleIncludedUserIdsText(formatUserIds(normalized.idleLockUserIds));
      setIdleExcludedUserIdsText(formatUserIds(normalized.idleLockExcludedUserIds));
      setMessage("Action PIN policy saved.");
      await queryClient.invalidateQueries({ queryKey: ["settings", "users_and_roles", "action_pin_policy"] });
    },
    onError: (err: unknown) => {
      if (isReAuthRequiredError(err)) {
        onReAuthRequired(["settings", "users_and_roles", "action_pin_policy"]);
        return;
      }
      setMessage(err instanceof Error ? err.message : "Failed to save Action PIN policy.");
    },
  });

  if (query.isLoading) return <p className="description-center">Loading Action PIN policy...</p>;
  if (query.error) {
    if (isReAuthRequiredError(query.error)) return null;
    return <p className="text-sm text-red-600">{query.error instanceof Error ? query.error.message : "Failed to load Action PIN policy."}</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-semibold text-stone-900 dark:text-white">Action PIN Policy</h4>
        <p className="mt-1 text-sm description-center">
          Configure backend-enforced per-user PIN requirements by role and action.
        </p>
      </div>

      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
        <p>Users without an Action PIN may be blocked from protected actions.</p>
        <p>Set user PINs before enabling enforcement.</p>
        <p>Policy is backend-enforced.</p>
        {currentUserPinQuery.data ? (
          <p>Current user PIN status: {currentUserPinQuery.data.hasPin ? "set" : "not set"}.</p>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <BoolField label="Enable Action PIN" checked={draft.enabled} onChange={(checked) => update("enabled", checked)} />
        <NumberField label="PIN length" value={draft.pinLength} disabled onChange={() => undefined} />
        <label className="space-y-1">
          <FieldLabel>Rotation mode</FieldLabel>
          <select
            aria-label="Rotation mode"
            value={draft.rotationMode}
            onChange={(event) => update("rotationMode", event.target.value as ActionPinRotationMode)}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
          >
            <option value="manual">Manual</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <NumberField label="Rotation interval days" value={draft.rotationIntervalDays} onChange={(value) => update("rotationIntervalDays", value)} />
        <NumberField label="Verification TTL seconds" value={draft.verificationTtlSeconds} onChange={(value) => update("verificationTtlSeconds", value)} />
        <NumberField label="Idle lock seconds" value={draft.idleLockSeconds} disabled={!draft.idleLockEnabled} onChange={(value) => update("idleLockSeconds", value)} />
        <NumberField label="Max failed attempts" value={draft.maxFailedAttempts} onChange={(value) => update("maxFailedAttempts", value)} />
        <NumberField label="Lockout minutes" value={draft.lockoutMinutes} onChange={(value) => update("lockoutMinutes", value)} />
        <BoolField label="Expire PIN after rotation" checked={draft.expirePinAfterRotation} onChange={(checked) => update("expirePinAfterRotation", checked)} />
        <BoolField label="Idle lock enabled" checked={draft.idleLockEnabled} onChange={(checked) => update("idleLockEnabled", checked)} />
        <BoolField label="Allow user PIN change" checked={draft.allowUserPinChange} onChange={(checked) => update("allowUserPinChange", checked)} />
        <BoolField label="Allow user PIN regenerate" checked={draft.allowUserPinRegenerate} onChange={(checked) => update("allowUserPinRegenerate", checked)} />
        <BoolField label="Require user password to view own PIN settings" checked={draft.requirePinToViewOwnPinSettings} onChange={(checked) => update("requirePinToViewOwnPinSettings", checked)} />
        <BoolField label="Notify user on PIN change" checked={draft.notifyUserOnPinChange} onChange={(checked) => update("notifyUserOnPinChange", checked)} />
      </div>

      <div className="space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-700">
        <h5 className="text-sm font-semibold text-stone-900 dark:text-white">Idle lock eligibility</h5>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="space-y-1">
            <FieldLabel>Idle lock role eligibility</FieldLabel>
            <select
              aria-label="Idle lock role eligibility"
              value={draft.idleLockRoleMode}
              onChange={(event) => update("idleLockRoleMode", event.target.value as ActionPinIdleLockRoleMode)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
            >
              <option value="all">All roles</option>
              <option value="include">Only selected roles</option>
              <option value="exclude">All except selected roles</option>
            </select>
          </label>
          <label className="space-y-1">
            <FieldLabel>Idle lock included user IDs</FieldLabel>
            <input
              aria-label="Idle lock included user IDs"
              value={idleIncludedUserIdsText}
              onChange={(event) => {
                setIdleIncludedUserIdsText(event.target.value);
                update("idleLockUserIds", parseUserIds(event.target.value));
              }}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
            />
          </label>
          <label className="space-y-1">
            <FieldLabel>Idle lock excluded user IDs</FieldLabel>
            <input
              aria-label="Idle lock excluded user IDs"
              value={idleExcludedUserIdsText}
              onChange={(event) => {
                setIdleExcludedUserIdsText(event.target.value);
                update("idleLockExcludedUserIds", parseUserIds(event.target.value));
              }}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
            />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ACTION_PIN_ROLES.map((role) => (
            <label key={role} className="flex items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-sm dark:border-stone-700">
              <input
                aria-label={`Idle lock role ${ACTION_PIN_ROLE_LABELS[role]}`}
                type="checkbox"
                checked={draft.idleLockRoles.includes(role)}
                onChange={(event) => {
                  const nextRoles = event.target.checked
                    ? [...draft.idleLockRoles, role]
                    : draft.idleLockRoles.filter((item) => item !== role);
                  update("idleLockRoles", nextRoles);
                }}
              />
              <span>{ACTION_PIN_ROLE_LABELS[role]}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-5">
        {ACTION_PIN_GROUPS.map((group) => (
          <div key={group.label} className="space-y-2">
            <h5 className="text-sm font-semibold text-stone-900 dark:text-white">{group.label}</h5>
            <div className="overflow-auto rounded-lg border border-stone-200 dark:border-stone-700">
              <table className="w-full min-w-[1050px] text-sm">
                <thead>
                  <tr className="bg-stone-100 dark:bg-stone-800">
                    <th className="p-2 text-start font-semibold">Action</th>
                    {ACTION_PIN_ROLES.map((role) => (
                      <th key={role} className="p-2 text-start font-semibold">{ACTION_PIN_ROLE_LABELS[role]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.actions.map((actionKey) => (
                    <tr key={actionKey} data-testid={`action-pin-row-${actionKey}`} className="border-t border-stone-200 dark:border-stone-700">
                      <td className="p-2 font-medium">{ACTION_PIN_ACTION_LABELS[actionKey]}</td>
                      {ACTION_PIN_ROLES.map((role) => (
                        <td key={`${actionKey}-${role}`} className="p-2">
                          <select
                            aria-label={`${ACTION_PIN_ACTION_LABELS[actionKey]} ${role} mode`}
                            value={draft.actionModes[actionKey]?.[role] ?? "not_required"}
                            onChange={(event) => updateMode(actionKey, role, event.target.value as ActionPinMode)}
                            className="w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-xs dark:border-stone-700 dark:bg-stone-900"
                          >
                            {ACTION_PIN_MODES.map((mode) => (
                              <option key={mode} value={mode}>{ACTION_PIN_MODE_LABELS[mode]}</option>
                            ))}
                          </select>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary text-sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save Action PIN Policy"}
        </button>
        <button
          className="btn-secondary text-sm"
          onClick={() => {
            const normalized = normalizeActionPinPolicy(query.data ?? {});
            setDraft(normalized);
            setIdleIncludedUserIdsText(formatUserIds(normalized.idleLockUserIds));
            setIdleExcludedUserIdsText(formatUserIds(normalized.idleLockExcludedUserIds));
          }}
          disabled={saveMutation.isPending}
        >
          Reset
        </button>
        {message ? <span className="text-sm text-stone-700 dark:text-stone-200">{message}</span> : null}
        {isArabic ? <span className="text-xs text-stone-500">واجهة السياسة باللغة الإنجليزية حالياً.</span> : null}
      </div>

      <UserPinManagementTable policyEnabled={draft.enabled} onReAuthRequired={onReAuthRequired} />
    </div>
  );
}
