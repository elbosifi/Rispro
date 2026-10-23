import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/shared/Button";
import { Input } from "@/components/shared/Input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/shared/Dialog";
import {
  createUser,
  deleteUser,
  fetchUserEffectiveAccess,
  fetchUserSecurityActivity,
  fetchDoctorProfilesForAdmin,
  fetchUsers,
  forceUserPasswordChange,
  resetUserTemporaryPassword,
  revokeUserSessions,
  updateUserActiveState,
  updateUserIdentity,
  updateUserPassword,
  updateUserRole,
  updateUserSchedulingOverridePermission,
} from "@/lib/api-hooks";
import { getUserDisplayName } from "@/lib/user-display-name";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import type { DoctorProfile, Role, User, UserEffectiveAccess, UserSecurityActivityEntry, UserSecurityActivityPage } from "@/types/api";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";

type RoleFilter = "all" | Role;
type StatusFilter = "all" | "active" | "inactive";
const doctorRoles: Role[] = ["doctor", "supervisor", "super_admin"];
const isDoctorRole = (role: Role) => doctorRoles.includes(role);
const safeError = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function formatDate(
  value: string | null | undefined,
  language: string,
  empty: string,
) {
  if (!value || Number.isNaN(new Date(value).getTime())) return empty;
  return new Intl.DateTimeFormat(language === "ar" ? "ar" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function UsersSection({
  onReAuthRequired,
}: {
  onReAuthRequired: (key: string[]) => void;
}) {
  const { language, t } = useLanguage();
  const { user: actorUser, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const usersQuery = useQuery<{ users: User[] }>({
    queryKey: ["users"],
    queryFn: fetchUsers,
  });
  const doctorProfilesQuery = useQuery<DoctorProfile[]>({
    queryKey: ["doctor", "profiles"],
    queryFn: fetchDoctorProfilesForAdmin,
    retry: false,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const [roleDraft, setRoleDraft] = useState<Role | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [temporaryPasswordDraft, setTemporaryPasswordDraft] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [identityEditing, setIdentityEditing] = useState(false);
  const [identityDraft, setIdentityDraft] = useState({ username: "", email: "", fullName: "", englishName: "" });
  const [createEmailEdited, setCreateEmailEdited] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: "",
    email: "",
    fullName: "",
    englishName: "",
    password: "",
    role: "receptionist",
  });
  const users = usersQuery.data?.users ?? [];
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const canModifySelectedUser = Boolean(
    selectedUser && (
      actorUser?.role === "super_admin" ||
      !["supervisor", "super_admin"].includes(selectedUser.role) ||
      Number(selectedUser.id) === Number(actorUser?.id)
    ),
  );
  const effectiveAccessQuery = useQuery<UserEffectiveAccess>({
    queryKey: ["users", selectedUserId, "effective-access"],
    queryFn: () => fetchUserEffectiveAccess(selectedUserId!),
    enabled: selectedUserId !== null && canModifySelectedUser,
    retry: false,
  });
  const securityActivityQuery = useQuery<UserSecurityActivityPage>({
    queryKey: ["users", selectedUserId, "security-activity", activityPage],
    queryFn: () => fetchUserSecurityActivity(selectedUserId!, activityPage),
    enabled: selectedUserId !== null && canModifySelectedUser,
    retry: false,
  });
  const doctorProfilesByUserId = useMemo(
    () =>
      new Map(
        (doctorProfilesQuery.data ?? []).map((profile) => [
          profile.userId,
          profile,
        ]),
      ),
    [doctorProfilesQuery.data],
  );
  const term = search.trim().toLocaleLowerCase();
  const filteredUsers = users.filter(
    (user) =>
      (roleFilter === "all" || user.role === roleFilter) &&
      (statusFilter === "all" ||
        (statusFilter === "active" ? Boolean(user.isActive) : !user.isActive)) &&
      (!term ||
        user.fullName.toLocaleLowerCase().includes(term) ||
        (user.englishName ?? "").toLocaleLowerCase().includes(term) ||
        (user.email ?? "").toLocaleLowerCase().includes(term) ||
        user.username.toLocaleLowerCase().includes(term)),
  );
  const filtersActive =
    Boolean(search.trim()) || roleFilter !== "all" || statusFilter !== "all";
  const resetCreate = () =>
    setCreateForm({
      username: "", email: "",
      fullName: "",
      englishName: "",
      password: "",
      role: "receptionist",
    });
  const closeCreate = () => {
    setCreateOpen(false);
    resetCreate();
    setCreateError(null);
  };
  const closeManage = () => {
    setSelectedUserId(null);
    setActivityPage(1);
    setRoleDraft(null);
    setPasswordDraft("");
    setTemporaryPasswordDraft("");
    setIdentityEditing(false);
    setIdentityDraft({ username: "", email: "", fullName: "", englishName: "" });
    setManageError(null);
  };
  const openManage = (user: User) => {
    setSelectedUserId(user.id);
    setActivityPage(1);
    setRoleDraft(user.role);
    setPasswordDraft("");
    setTemporaryPasswordDraft("");
    setIdentityEditing(false);
    setIdentityDraft({ username: user.username, email: user.email ?? "", fullName: user.fullName, englishName: user.englishName ?? "" });
    setManageError(null);
  };
  const startIdentityEditing = (user: User) => {
    setIdentityDraft({ username: user.username, email: user.email ?? "", fullName: user.fullName, englishName: user.englishName ?? "" });
    setIdentityEditing(true);
    setManageError(null);
  };
  const cancelIdentityEditing = (user: User) => {
    setIdentityDraft({ username: user.username, email: user.email ?? "", fullName: user.fullName, englishName: user.englishName ?? "" });
    setIdentityEditing(false);
  };
  const invalidateUsers = () =>
    queryClient.invalidateQueries({ queryKey: ["users"] });
  const invalidateUserDetails = (userId: number) => Promise.all([
    invalidateUsers(),
    queryClient.invalidateQueries({ queryKey: ["users", userId, "effective-access"] }),
    queryClient.invalidateQueries({ queryKey: ["users", userId, "security-activity"] }),
  ]);
  const mutationErrorMessage = (error: unknown) =>
    safeError(error, t("settings.users.errorFallback"));
  const createMutation = useMutation({
    mutationFn: () => createUser(createForm),
    onSuccess: () => {
      invalidateUsers();
      closeCreate();
    },
    onError: (error) => setCreateError(mutationErrorMessage(error)),
  });
  const permissionMutation = useMutation({
    mutationFn: (payload: {
      userId: number;
      canRequestSchedulingOverride: boolean;
    }) =>
      updateUserSchedulingOverridePermission(
        payload.userId,
        payload.canRequestSchedulingOverride,
      ),
    onSuccess: async (updatedUser) => {
      await invalidateUserDetails(updatedUser.id);
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const directPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) =>
      updateUserPassword(userId, password),
    onSuccess: async (_user, variables) => {
      await invalidateUserDetails(variables.userId);
      setPasswordDraft("");
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const temporaryPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) =>
      resetUserTemporaryPassword(userId, password),
    onSuccess: async (_user, variables) => {
      await invalidateUserDetails(variables.userId);
      setTemporaryPasswordDraft("");
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const activeStateMutation = useMutation({
    mutationFn: (payload: { userId: number; isActive: boolean }) =>
      updateUserActiveState(payload.userId, payload.isActive),
    onSuccess: async (updatedUser) => {
      await invalidateUserDetails(updatedUser.id);
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      invalidateUsers();
      closeManage();
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const identityMutation = useMutation({
    mutationFn: (payload: { userId: number; username: string; email: string; fullName: string; englishName: string }) =>
      updateUserIdentity(payload.userId, {
        username: payload.username,
        email: payload.email,
        fullName: payload.fullName,
        englishName: payload.englishName,
      }),
    onSuccess: () => {
      invalidateUsers();
      setIdentityEditing(false);
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const roleMutation = useMutation({
    mutationFn: (payload: { userId: number; role: Role }) =>
      updateUserRole(payload.userId, payload.role),
    onSuccess: async (updatedUser) => {
      setRoleDraft(updatedUser.role);
      await Promise.all([
        invalidateUserDetails(updatedUser.id),
        queryClient.invalidateQueries({ queryKey: ["doctor", "profiles"] }),
      ]);
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const forcePasswordChangeMutation = useMutation({
    mutationFn: forceUserPasswordChange,
    onSuccess: async (result) => {
      setManageError(null);
      if (result.selfRevoked) {
        await logout("/login");
        return;
      }
      await invalidateUserDetails(result.user.id);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const revokeSessionsMutation = useMutation({
    mutationFn: revokeUserSessions,
    onSuccess: async (result) => {
      setManageError(null);
      if (result.selfRevoked) {
        await logout("/login");
        return;
      }
      await invalidateUserDetails(result.user.id);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const roleTransition = (entry: UserSecurityActivityEntry) => {
    if (entry.actionType !== "user_role_changed") return null;
    const oldValues = entry.oldValues && typeof entry.oldValues === "object"
      ? entry.oldValues as Record<string, unknown>
      : null;
    const newValues = entry.newValues && typeof entry.newValues === "object"
      ? entry.newValues as Record<string, unknown>
      : null;
    const previousRole = auditRoleLabel(oldValues?.role);
    const nextRole = auditRoleLabel(newValues?.role);
    return previousRole && nextRole
      ? `${t("settings.users.activity.from")}: ${previousRole} · ${t("settings.users.activity.to")}: ${nextRole}`
      : null;
  };
  const roleLabel = (role: Role) =>
    t(
      (
        {
          receptionist: "settings.receptionist",
          supervisor: "settings.supervisor",
          modality_staff: "settings.users.role.modality_staff",
          doctor: "settings.users.role.doctor",
          administrative: "settings.users.role.administrative",
          super_admin: "settings.users.role.super_admin",
        } as const
      )[role],
    );
  const alternateUserName = (user: User) => {
    const alternate = language === "ar" ? user.englishName : user.fullName;
    return alternate && alternate !== getUserDisplayName(user, language) ? alternate : null;
  };
  const doctorProfileLabel = (user: User) => {
    if (!isDoctorRole(user.role)) return t("settings.users.notAvailable");
    if (doctorProfilesQuery.isLoading)
      return t("settings.users.doctorProfileLoading");
    if (doctorProfilesQuery.isError)
      return t("settings.users.doctorProfileUnavailable");

    const profile = doctorProfilesByUserId.get(user.id);
    if (profile)
      return profile.active
        ? t("settings.users.doctorProfileActive")
        : t("settings.users.doctorProfileInactive");

    return user.role === "doctor"
      ? t("settings.users.needsDoctorProfileConfiguration")
      : t("settings.users.noClinicalProfile");
  };
  const canConfigureDoctorProfile = (user: User) =>
    user.role === "doctor" &&
    !doctorProfilesQuery.isLoading &&
    !doctorProfilesQuery.isError &&
    !doctorProfilesByUserId.has(user.id);
  const statusBadge = (active: boolean | undefined) => (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300"}`}
    >
      {active ? t("settings.active") : t("settings.inactive")}
    </span>
  );
  const roleOptions: Role[] = [
    "receptionist",
    "supervisor",
    "super_admin",
    "modality_staff",
    "doctor",
    "administrative",
  ];
  const auditRoleLabel = (value: unknown) => {
    if (typeof value !== "string") return null;
    const role = roleOptions.find((option) => option === value);
    return role ? roleLabel(role) : null;
  };
  const auditActionLabel = (entry: UserSecurityActivityEntry) => {
    const labels: Record<string, Parameters<typeof t>[0]> = {
      user_created: "settings.users.activity.userCreated",
      create: "settings.users.activity.userCreated",
      user_role_changed: "settings.users.activity.roleChanged",
      activate: "settings.users.activity.activated",
      deactivate: "settings.users.activity.deactivated",
      update_identity: "settings.users.activity.identityUpdated",
      update: "settings.users.activity.passwordChanged",
      reset_temporary_password: "settings.users.activity.temporaryPasswordIssued",
      force_password_change: "settings.users.activity.passwordChangeRequired",
      revoke_sessions: "settings.users.activity.sessionsRevoked",
      update_scheduling_override_permission: "settings.users.activity.permissionChanged",
      doctor_linked_user_updated: "settings.users.activity.identityUpdated",
      login: "settings.users.activity.passwordLogin",
      passkey_login: "settings.users.activity.passkeyLogin",
      supervisor_reauth: "settings.users.activity.reauthenticated",
      passkey_supervisor_reauth: "settings.users.activity.reauthenticated",
      change_own_password: "settings.users.activity.passwordChanged",
      delete: "settings.users.activity.deleted",
    };
    const key = labels[entry.actionType];
    return key ? t(key) : entry.actionType.replaceAll("_", " ");
  };
  const auditOutcomeLabel = (outcome: string) => {
    const labels: Record<string, Parameters<typeof t>[0]> = {
      successful: "settings.users.activity.outcome.successful",
      failed: "settings.users.activity.outcome.failed",
      rejected: "settings.users.activity.outcome.rejected",
      cancelled: "settings.users.activity.outcome.cancelled",
      pending: "settings.users.activity.outcome.pending",
      informational: "settings.users.activity.outcome.informational",
      unknown: "settings.users.activity.outcome.unknown",
    };
    const key = labels[outcome];
    return key ? t(key) : outcome;
  };
  const createRoleOptions = actorUser?.role === "super_admin"
    ? roleOptions
    : roleOptions.filter((role) => role !== "super_admin" && role !== "supervisor");
  const editRoleOptions = selectedUser && actorUser?.role !== "super_admin"
    ? roleOptions.filter((role) => role !== "super_admin" && (role !== "supervisor" || role === selectedUser.role))
    : roleOptions;

  if (usersQuery.error) {
    const message = safeError(
      usersQuery.error,
      t("settings.users.errorFallback"),
    );
    if (message.includes("re-authentication") || message.includes("403"))
      return (
        <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["users"])} />
      );
    return <QueryError message={message} />;
  }
  if (usersQuery.isLoading)
    return <p className="description-center">{t("settings.loading")}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm description-center">
          {filtersActive
            ? t("settings.users.filteredCount", {
                visible: filteredUsers.length,
                total: users.length,
              })
            : t("settings.usersCount", { count: users.length })}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setCreateOpen(true);
            setCreateError(null);
          }}
        >
          {t("settings.addUser")}
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <Input
          aria-label={t("settings.users.search")}
          placeholder={t("settings.users.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-0"
        />
        <select
          aria-label={t("settings.users.allRoles")}
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
          className="input-premium min-w-0 px-3 py-2 text-sm"
        >
          <option value="all">{t("settings.users.allRoles")}</option>
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("settings.users.allStatuses")}
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as StatusFilter)
          }
          className="input-premium min-w-0 px-3 py-2 text-sm"
        >
          <option value="all">{t("settings.users.allStatuses")}</option>
          <option value="active">{t("settings.active")}</option>
          <option value="inactive">{t("settings.inactive")}</option>
        </select>
      </div>
      {users.length === 0 ? (
        <p className="description-center text-sm">
          {t("settings.users.noUsers")}
        </p>
      ) : filteredUsers.length === 0 ? (
        <p className="description-center text-sm">
          {t("settings.users.noMatches")}
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-700 md:block">
            <table className="w-full text-sm">
              <thead className="bg-stone-100 dark:bg-stone-800">
                <tr>
                  {[
                    ["settings.users.user", "user"],
                    ["settings.users.role", "role"],
                    ["settings.users.status", "status"],
                    ["settings.users.doctorProfile", "profile"],
                    ["settings.users.permissions", "permissions"],
                    ["settings.users.updated", "updated"],
                    ["settings.users.manage", "manage"],
                  ].map(([label, key]) => (
                    <th key={key} className="p-3 text-start font-semibold">
                      {t(label as Parameters<typeof t>[0])}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="border-t border-stone-200 dark:border-stone-700"
                  >
                    <td className="p-3">
                      <p className="font-medium text-stone-900 dark:text-white">
                        {getUserDisplayName(user, language)}
                      </p>
                      {alternateUserName(user) && <p className="text-xs description-center">{alternateUserName(user)}</p>}
                      <p className="text-xs description-center">
                        @{user.username}
                      </p>
                    </td>
                    <td className="p-3">{roleLabel(user.role)}</td>
                    <td className="p-3">{statusBadge(user.isActive)}</td>
                    <td className="p-3 text-xs">{doctorProfileLabel(user)}</td>
                    <td className="p-3 text-xs">
                      {user.role === "receptionist" &&
                      user.canRequestSchedulingOverride
                        ? t("overrideRequests.permissionLabel")
                        : t("settings.users.notAvailable")}
                    </td>
                    <td className="whitespace-nowrap p-3 text-xs">
                      {formatDate(
                        user.updatedAt,
                        language,
                        t("settings.users.notAvailable"),
                      )}
                    </td>
                    <td className="p-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openManage(user)}
                      >
                        {t("settings.users.manage")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 md:hidden">
            {filteredUsers.map((user) => (
              <article
                key={user.id}
                className="rounded-lg border border-stone-200 p-3 dark:border-stone-700"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-stone-900 dark:text-white">
                      {getUserDisplayName(user, language)}
                    </p>
                    {alternateUserName(user) && <p className="text-xs description-center">{alternateUserName(user)}</p>}
                    <p className="text-xs description-center">
                      @{user.username} · {roleLabel(user.role)}
                    </p>
                  </div>
                  {statusBadge(user.isActive)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <span>
                    {t("settings.users.doctorProfile")}:{" "}
                    {doctorProfileLabel(user)}
                  </span>
                  <span>
                    {t("settings.users.updated")}:{" "}
                    {formatDate(
                      user.updatedAt,
                      language,
                      t("settings.users.notAvailable"),
                    )}
                  </span>
                </div>
                <Button
                  className="mt-3"
                  variant="outline"
                  size="sm"
                  onClick={() => openManage(user)}
                >
                  {t("settings.users.manage")}
                </Button>
              </article>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={createOpen}
        onClose={closeCreate}
      >
        <DialogContent maxWidth="520px">
          <DialogHeader closeLabel={t("settings.cancel")}>
            <DialogTitle>{t("settings.addUser")}</DialogTitle>
          </DialogHeader>
          {createError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {createError}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>{t("settings.username")}</span>
              <Input
                value={createForm.username}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, username: event.target.value, email: createEmailEdited ? current.email : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.target.value.trim()) ? event.target.value.trim() : "" }))
                }
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>Email</span>
              <Input aria-label="Email" value={createForm.email} onChange={(event) => { setCreateEmailEdited(true); setCreateForm({ ...createForm, email: event.target.value }); }} className="w-full" />
            </label>
            <label className="space-y-1 text-sm">
              <span>{t("settings.arabicName")}</span>
              <Input
                value={createForm.fullName}
                onChange={(event) =>
                  setCreateForm({ ...createForm, fullName: event.target.value })
                }
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>{t("settings.englishName")}</span>
              <Input
                value={createForm.englishName}
                onChange={(event) => setCreateForm({ ...createForm, englishName: event.target.value })}
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>{t("settings.password")}</span>
              <Input
                type="password"
                value={createForm.password}
                onChange={(event) =>
                  setCreateForm({ ...createForm, password: event.target.value })
                }
                className="w-full"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>{t("settings.users.role")}</span>
              <select
                value={createForm.role}
                onChange={(event) =>
                  setCreateForm({ ...createForm, role: event.target.value })
                }
                className="input-premium w-full px-3 py-2"
              >
                {createRoleOptions.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {createForm.role === "doctor" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
              {t("settings.users.doctorAccountProfileNotice")}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={closeCreate}>
              {t("settings.cancel")}
            </Button>
            <Button
              disabled={
                createMutation.isPending ||
                !createForm.username.trim() ||
                !createForm.fullName.trim() ||
                !createForm.password.trim()
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending
                ? t("settings.loading")
                : t("settings.createUser")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedUser)} onClose={closeManage}>
        {selectedUser && (
          <DialogContent maxWidth="720px">
            <DialogHeader closeLabel={t("settings.cancel")}>
              <DialogTitle>{getUserDisplayName(selectedUser, language)}</DialogTitle>
              <DialogDescription>
                @{selectedUser.username} · {roleLabel(selectedUser.role)} ·{" "}
                {selectedUser.isActive
                  ? t("settings.active")
                  : t("settings.inactive")}
              </DialogDescription>
            </DialogHeader>
            {manageError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {manageError}
              </div>
            )}
            <div className="space-y-5 text-sm">
              <section>
                <h4 className="font-semibold">{t("settings.users.account")}</h4>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="description-center">Email</dt>
                    <dd>{identityEditing ? <Input aria-label="Email" value={identityDraft.email} onChange={(event) => setIdentityDraft({ ...identityDraft, email: event.target.value })} className="w-full" /> : (selectedUser.email || t("settings.users.notAvailable"))}</dd>
                  </div>
                  <div>
                    <dt className="description-center">
                      {t("settings.arabicName")}
                    </dt>
                    <dd>
                      {identityEditing ? (
                        <Input
                          aria-label={t("settings.arabicName")}
                          value={identityDraft.fullName}
                          onChange={(event) =>
                            setIdentityDraft({
                              ...identityDraft,
                              fullName: event.target.value,
                            })
                          }
                          className="w-full"
                        />
                      ) : (
                        selectedUser.fullName
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="description-center">{t("settings.englishName")}</dt>
                    <dd>{identityEditing ? <Input aria-label={t("settings.englishName")} value={identityDraft.englishName} onChange={(event) => setIdentityDraft({ ...identityDraft, englishName: event.target.value })} className="w-full" /> : (selectedUser.englishName || t("settings.users.notAvailable"))}</dd>
                  </div>
                  <div>
                    <dt className="description-center">
                      {t("settings.username")}
                    </dt>
                    <dd>
                      {identityEditing ? (
                        <Input
                          aria-label={t("settings.username")}
                          value={identityDraft.username}
                          onChange={(event) =>
                            setIdentityDraft({
                              ...identityDraft,
                              username: event.target.value,
                            })
                          }
                          className="w-full"
                        />
                      ) : (
                        `@${selectedUser.username}`
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="description-center">
                      {t("settings.users.role")}
                    </dt>
                    <dd>{roleLabel(selectedUser.role)}</dd>
                  </div>
                  <div>
                    <dt className="description-center">
                      {t("settings.users.status")}
                    </dt>
                    <dd>{statusBadge(selectedUser.isActive)}</dd>
                  </div>
                  <div>
                    <dt className="description-center">
                      {t("settings.users.created")}
                    </dt>
                    <dd>
                      {formatDate(
                        selectedUser.createdAt,
                        language,
                        t("settings.users.notAvailable"),
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="description-center">
                      {t("settings.users.updated")}
                    </dt>
                    <dd>
                      {formatDate(
                        selectedUser.updatedAt,
                        language,
                        t("settings.users.notAvailable"),
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="description-center">{t("settings.users.lastLogin")}</dt>
                    <dd>
                      {!canModifySelectedUser
                        ? t("settings.users.privilegedDetailsRestricted")
                        : selectedUser.lastLoginAt
                          ? formatDate(selectedUser.lastLoginAt, language, t("settings.users.neverRecorded"))
                          : t("settings.users.neverRecorded")}
                    </dd>
                  </div>
                  <div>
                    <dt className="description-center">
                      {t("settings.users.security")}
                    </dt>
                    <dd>
                      {!canModifySelectedUser
                        ? t("settings.users.privilegedDetailsRestricted")
                        : selectedUser.mustChangePassword
                          ? t("settings.users.passwordChangeRequired")
                          : t("settings.users.passwordChangeNotRequired")}
                    </dd>
                  </div>
                </dl>
                {canModifySelectedUser && <div className="mt-3 flex flex-wrap gap-2">
                  {identityEditing ? (
                    <>
                      <Button
                        size="sm"
                        disabled={
                          identityMutation.isPending ||
                          !identityDraft.username.trim() ||
                          !identityDraft.fullName.trim() ||
                          (identityDraft.username.trim() === selectedUser.username && identityDraft.email.trim() === (selectedUser.email ?? "") &&
                            identityDraft.fullName.trim() === selectedUser.fullName && identityDraft.englishName.trim() === (selectedUser.englishName ?? ""))
                        }
                        onClick={() =>
                          identityMutation.mutate({
                            userId: selectedUser.id,
                            username: identityDraft.username,
                            email: identityDraft.email,
                            fullName: identityDraft.fullName,
                            englishName: identityDraft.englishName,
                          })
                        }
                      >
                        {identityMutation.isPending
                          ? t("settings.loading")
                          : t("settings.users.saveChanges")}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={identityMutation.isPending}
                        onClick={() => cancelIdentityEditing(selectedUser)}
                      >
                        {t("settings.users.cancelEditing")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startIdentityEditing(selectedUser)}
                    >
                      {t("settings.users.editDetails")}
                    </Button>
                  )}
                </div>}
              </section>
              {canModifySelectedUser && (
                <section>
                  <h4 className="font-semibold">{t("settings.users.editRole")}</h4>
                  <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <label className="space-y-1">
                      <span>{t("settings.users.role")}</span>
                      <select
                        aria-label={t("settings.users.editRole")}
                        value={roleDraft ?? selectedUser.role}
                        disabled={roleMutation.isPending}
                        onChange={(event) => setRoleDraft(event.target.value as Role)}
                        className="input-premium w-full px-3 py-2"
                      >
                        {editRoleOptions.map((role) => (
                          <option key={role} value={role}>
                            {roleLabel(role)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Button
                      size="sm"
                      disabled={roleMutation.isPending || !roleDraft || roleDraft === selectedUser.role}
                      onClick={() => roleDraft && roleMutation.mutate({ userId: selectedUser.id, role: roleDraft })}
                    >
                      {roleMutation.isPending ? t("settings.loading") : t("settings.users.saveRole")}
                    </Button>
                  </div>
                  {roleDraft === "doctor" && !doctorProfilesByUserId.get(selectedUser.id)?.active && !doctorProfilesQuery.isLoading && !doctorProfilesQuery.isError && (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                      {t("settings.users.roleDoctorProfileNotice")}
                    </p>
                  )}
                  {roleDraft && !["doctor", "supervisor", "super_admin"].includes(roleDraft) && doctorProfilesByUserId.get(selectedUser.id)?.active && (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                      {t("settings.users.roleDoctorProfileDeactivationNotice")}
                    </p>
                  )}
                </section>
              )}
              <section>
                <h4 className="font-semibold">{t("settings.users.permissions")}</h4>
                {!canModifySelectedUser ? (
                  <p className="mt-2 text-sm description-center">{t("settings.users.privilegedDetailsRestricted")}</p>
                ) : effectiveAccessQuery.isLoading ? (
                  <p className="mt-2 text-sm description-center">{t("settings.users.effectiveAccessLoading")}</p>
                ) : effectiveAccessQuery.isError ? (
                  <div role="alert" className="mt-2 space-y-2">
                    <p className="text-sm text-red-700 dark:text-red-300">{safeError(effectiveAccessQuery.error, t("settings.users.effectiveAccessError"))}</p>
                    <Button variant="outline" size="sm" onClick={() => void effectiveAccessQuery.refetch()}>{t("settings.users.retry")}</Button>
                  </div>
                ) : effectiveAccessQuery.data ? (
                  <div className="mt-2 space-y-3">
                    <dl className="grid gap-2 sm:grid-cols-2">
                      <div><dt className="description-center">{t("settings.users.role")}</dt><dd>{roleLabel(effectiveAccessQuery.data.role)}</dd></div>
                      <div><dt className="description-center">{t("settings.users.status")}</dt><dd>{effectiveAccessQuery.data.isActive ? t("settings.active") : t("settings.inactive")}</dd></div>
                      <div><dt className="description-center">{t("settings.users.passwordChangeRequired")}</dt><dd>{effectiveAccessQuery.data.passwordChangeRequired ? t("settings.yes") : t("settings.no")}</dd></div>
                      <div><dt className="description-center">{t("settings.users.schedulingOverrideEffective")}</dt><dd>{effectiveAccessQuery.data.canRequestSchedulingOverride ? t("settings.yes") : t("settings.no")}</dd></div>
                    </dl>
                    <div>
                      <h5 className="font-medium">{t("settings.users.doctorPortalAccess")}</h5>
                      {effectiveAccessQuery.data.doctorPortal.profile ? (
                        <div className="mt-1 space-y-1 text-sm">
                          <p>{t("settings.users.doctorProfile")}: {effectiveAccessQuery.data.doctorPortal.profile.effective ? t("settings.users.doctorProfileActive") : t("settings.users.doctorProfileInactive")} · {effectiveAccessQuery.data.doctorPortal.profile.doctorRole.replaceAll("_", " ")}</p>
                          <p>{t("settings.users.canFinalizeReports")}: {effectiveAccessQuery.data.doctorPortal.profile.canFinalizeReports ? t("settings.yes") : t("settings.no")} · {t("settings.users.canAssignProtocols")}: {effectiveAccessQuery.data.doctorPortal.profile.canAssignProtocols ? t("settings.yes") : t("settings.no")} · {t("settings.users.canSupervise")}: {effectiveAccessQuery.data.doctorPortal.profile.canSupervise ? t("settings.yes") : t("settings.no")}</p>
                        </div>
                      ) : <p className="mt-1 text-sm description-center">{t("settings.users.noDoctorProfile")}</p>}
                      {effectiveAccessQuery.data.doctorPortal.modalityPermissions.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm">
                          {effectiveAccessQuery.data.doctorPortal.modalityPermissions.map((permission) => (
                            <li key={`${permission.modalityCode}-${permission.modalityNameEn}`}>
                              {language === "ar" ? permission.modalityNameAr || permission.modalityCode : permission.modalityNameEn || permission.modalityCode}
                              {": "}{permission.canProtocol ? t("settings.users.canProtocol") : ""}{permission.canReport ? ` · ${t("settings.users.canReport")}` : ""}{permission.canSupervise ? ` · ${t("settings.users.canSupervise")}` : ""}
                              {!permission.effective && ` · ${t("settings.users.notEffective")}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <details className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
                      <summary className="cursor-pointer font-medium">{t("settings.users.navigationVisibility")}</summary>
                      <p className="mt-2 text-xs description-center">{t("settings.users.navigationDisclaimer")}</p>
                      <p className="mt-2 text-xs font-medium">{t("settings.users.visiblePages")}</p>
                      <ul className="mt-1 grid max-h-32 grid-cols-1 gap-1 overflow-auto text-xs sm:grid-cols-2">
                        {effectiveAccessQuery.data.navigationVisibility.pages.filter((page) => page.visible).map((page) => <li key={page.routeKey} className="break-words">{page.routeKey}</li>)}
                      </ul>
                    </details>
                  </div>
                ) : null}
                {canModifySelectedUser && selectedUser.role === "receptionist" && (
                  <label className="mt-3 flex items-center gap-2">
                    <Input
                      type="checkbox"
                      checked={Boolean(selectedUser.canRequestSchedulingOverride)}
                      disabled={permissionMutation.isPending}
                      onChange={(event) => permissionMutation.mutate({ userId: selectedUser.id, canRequestSchedulingOverride: event.target.checked })}
                    />
                    {t("overrideRequests.permissionLabel")}
                  </label>
                )}
              </section>
              {isDoctorRole(selectedUser.role) && (
                <section>
                  <h4 className="font-semibold">
                    {t("settings.users.doctorProfile")}
                  </h4>
                  <p className="mt-1">{doctorProfileLabel(selectedUser)}</p>
                  {canConfigureDoctorProfile(selectedUser) && (
                    <Button
                      className="mt-3"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/doctor/doctors-directory?linkUserId=${selectedUser.id}`,
                        )
                      }
                    >
                      {t("settings.users.configureDoctorProfile")}
                    </Button>
                  )}
                  {doctorProfilesQuery.isError && (
                    <button
                      type="button"
                      onClick={() => doctorProfilesQuery.refetch()}
                      className="mt-2 text-xs underline"
                    >
                      {t("settings.retry")}
                    </button>
                  )}
                  <p className="mt-2 text-xs description-center">
                    {t("settings.users.doctorPortalHelp")}
                  </p>
                </section>
              )}
              {canModifySelectedUser && <section>
                <h4 className="font-semibold">
                  {t("settings.users.security")}
                </h4>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span>{t("settings.users.directPassword")}</span>
                    <input
                      aria-label={t("settings.users.directPassword")}
                      type="password"
                      value={passwordDraft}
                      onChange={(event) => setPasswordDraft(event.target.value)}
                      className="w-full"
                    />
                    <Button
                      className="mt-2"
                      size="sm"
                      disabled={
                        directPasswordMutation.isPending ||
                        !passwordDraft.trim()
                      }
                      onClick={() =>
                        directPasswordMutation.mutate({
                          userId: selectedUser.id,
                          password: passwordDraft,
                        })
                      }
                    >
                      {directPasswordMutation.isPending
                        ? t("settings.loading")
                        : t("settings.users.setPassword")}
                    </Button>
                  </label>
                  <label className="space-y-1">
                    <span>{t("settings.users.temporaryPassword")}</span>
                    <Input
                      aria-label={t("settings.users.temporaryPassword")}
                      type="password"
                      value={temporaryPasswordDraft}
                      onChange={(event) =>
                        setTemporaryPasswordDraft(event.target.value)
                      }
                      className="w-full"
                    />
                    <p className="text-xs description-center">
                      {t("settings.users.passwordChangeRequired")}
                    </p>
                    <Button
                      className="mt-2"
                      size="sm"
                      disabled={
                        temporaryPasswordMutation.isPending ||
                        !temporaryPasswordDraft.trim()
                      }
                      onClick={() =>
                        temporaryPasswordMutation.mutate({
                          userId: selectedUser.id,
                          password: temporaryPasswordDraft,
                        })
                      }
                    >
                      {temporaryPasswordMutation.isPending
                        ? t("settings.loading")
                        : t("settings.users.setTemporaryPassword")}
                    </Button>
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={forcePasswordChangeMutation.isPending}
                    onClick={() => {
                      if (window.confirm(t("settings.users.confirmForcePasswordChange", {
                        name: getUserDisplayName(selectedUser, language),
                        username: selectedUser.username,
                      }))) forcePasswordChangeMutation.mutate(selectedUser.id);
                    }}
                  >
                    {forcePasswordChangeMutation.isPending ? t("settings.loading") : t("settings.users.forcePasswordChange")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokeSessionsMutation.isPending}
                    onClick={() => {
                      if (window.confirm(t("settings.users.confirmRevokeSessions", {
                        name: getUserDisplayName(selectedUser, language),
                        username: selectedUser.username,
                      }))) revokeSessionsMutation.mutate(selectedUser.id);
                    }}
                  >
                    {revokeSessionsMutation.isPending ? t("settings.loading") : t("settings.users.revokeSessions")}
                  </Button>
                </div>
              </section>}
              {canModifySelectedUser && <section>
                <h4 className="font-semibold">{t("settings.users.activity.title")}</h4>
                {securityActivityQuery.isLoading ? (
                  <p className="mt-2 text-sm description-center">{t("settings.users.activity.loading")}</p>
                ) : securityActivityQuery.isError ? (
                  <div role="alert" className="mt-2 space-y-2">
                    <p className="text-sm text-red-700 dark:text-red-300">{safeError(securityActivityQuery.error, t("settings.users.activity.error"))}</p>
                    <Button variant="outline" size="sm" onClick={() => void securityActivityQuery.refetch()}>{t("settings.users.retry")}</Button>
                  </div>
                ) : securityActivityQuery.data ? (
                  <>
                    {securityActivityQuery.data.entries.length === 0 ? (
                      <p className="mt-2 text-sm description-center">{t("settings.users.activity.empty")}</p>
                    ) : (
                      <ol className="mt-2 space-y-2">
                        {securityActivityQuery.data.entries.map((entry) => (
                          <li key={entry.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-700">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="font-medium">{auditActionLabel(entry)}</p>
                              <span className="text-xs description-center">{auditOutcomeLabel(entry.outcome)}</span>
                            </div>
                            <p className="mt-1 text-xs description-center">
                              {t("settings.users.activity.actor")}: {entry.changedByName || entry.changedByUsername || t("settings.users.activity.system")}
                              {entry.changedByUsername && entry.changedByName && ` (@${entry.changedByUsername})`}
                            </p>
                            <p className="text-xs description-center">{formatDate(entry.createdAt, language, t("settings.users.notAvailable"))}</p>
                            {roleTransition(entry) && <p className="mt-1 text-xs">{roleTransition(entry)}</p>}
                            {entry.summary && <p className="mt-1 text-xs description-center">{entry.summary}</p>}
                          </li>
                        ))}
                      </ol>
                    )}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span>{t("settings.users.activity.range", {
                        start: securityActivityQuery.data.pagination.rangeStart,
                        end: securityActivityQuery.data.pagination.rangeEnd,
                        total: securityActivityQuery.data.pagination.totalItems,
                      })}</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" disabled={!securityActivityQuery.data.pagination.hasPreviousPage} onClick={() => setActivityPage((page) => Math.max(1, page - 1))}>{t("settings.users.activity.previous")}</Button>
                        <Button variant="outline" size="sm" disabled={!securityActivityQuery.data.pagination.hasNextPage} onClick={() => setActivityPage((page) => page + 1)}>{t("settings.users.activity.next")}</Button>
                      </div>
                    </div>
                  </>
                ) : null}
              </section>}
              {canModifySelectedUser && <section>
                <h4 className="font-semibold">{t("settings.users.status")}</h4>
                <Button
                  className="mt-2"
                  variant={selectedUser.isActive ? "secondary" : "primary"}
                  size="sm"
                  disabled={activeStateMutation.isPending}
                  onClick={() => {
                    const isActive = !selectedUser.isActive;
                    if (
                      window.confirm(
                        t(
                          isActive
                            ? "settings.users.confirmActivate"
                            : "settings.users.confirmDeactivate",
                          {
                            name: selectedUser.fullName,
                            username: selectedUser.username,
                          },
                        ),
                      )
                    )
                      activeStateMutation.mutate({
                        userId: selectedUser.id,
                        isActive,
                      });
                  }}
                >
                  {selectedUser.isActive
                    ? t("settings.users.deactivate")
                    : t("settings.users.activate")}
                </Button>
              </section>}
              {canModifySelectedUser && <section className="border-t border-red-200 pt-4 dark:border-red-900">
                <h4 className="font-semibold text-red-700 dark:text-red-300">
                  {t("settings.users.deleteUser")}
                </h4>
                <Button
                  className="mt-2"
                  variant="destructive"
                  size="sm"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        t("settings.users.confirmDelete", {
                          name: selectedUser.fullName,
                          username: selectedUser.username,
                        }),
                      )
                    )
                      deleteMutation.mutate(selectedUser.id);
                  }}
                >
                  {deleteMutation.isPending
                    ? t("settings.loading")
                    : t("settings.users.deleteUser")}
                </Button>
              </section>}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
