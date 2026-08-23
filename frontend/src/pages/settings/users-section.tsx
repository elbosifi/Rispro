import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/shared/Button";
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
  fetchDoctorProfilesForAdmin,
  fetchUsers,
  resetUserTemporaryPassword,
  updateUserActiveState,
  updateUserIdentity,
  updateUserPassword,
  updateUserSchedulingOverridePermission,
} from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";
import type { DoctorProfile, Role, User } from "@/types/api";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";

type RoleFilter = "all" | Role;
type StatusFilter = "all" | "active" | "inactive";
const doctorRoles: Role[] = ["doctor", "supervisor", "super_admin"];
const isDoctorRole = (role: Role) => doctorRoles.includes(role);
const safeError = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function formatDate(
  value: string | undefined,
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
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [temporaryPasswordDraft, setTemporaryPasswordDraft] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [identityEditing, setIdentityEditing] = useState(false);
  const [identityDraft, setIdentityDraft] = useState({ username: "", fullName: "" });
  const [createForm, setCreateForm] = useState({
    username: "",
    fullName: "",
    password: "",
    role: "receptionist",
  });
  const users = usersQuery.data?.users ?? [];
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
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
  const filteredUsers = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return users.filter(
      (user) =>
        (roleFilter === "all" || user.role === roleFilter) &&
        (statusFilter === "all" ||
          (statusFilter === "active"
            ? Boolean(user.isActive)
            : !user.isActive)) &&
        (!term ||
          user.fullName.toLocaleLowerCase().includes(term) ||
          user.username.toLocaleLowerCase().includes(term)),
    );
  }, [roleFilter, search, statusFilter, users]);
  const filtersActive =
    Boolean(search.trim()) || roleFilter !== "all" || statusFilter !== "all";
  const resetCreate = () =>
    setCreateForm({
      username: "",
      fullName: "",
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
    setPasswordDraft("");
    setTemporaryPasswordDraft("");
    setIdentityEditing(false);
    setIdentityDraft({ username: "", fullName: "" });
    setManageError(null);
  };
  const openManage = (user: User) => {
    setSelectedUserId(user.id);
    setPasswordDraft("");
    setTemporaryPasswordDraft("");
    setIdentityEditing(false);
    setIdentityDraft({ username: user.username, fullName: user.fullName });
    setManageError(null);
  };
  const startIdentityEditing = (user: User) => {
    setIdentityDraft({ username: user.username, fullName: user.fullName });
    setIdentityEditing(true);
    setManageError(null);
  };
  const cancelIdentityEditing = (user: User) => {
    setIdentityDraft({ username: user.username, fullName: user.fullName });
    setIdentityEditing(false);
  };
  const invalidateUsers = () =>
    queryClient.invalidateQueries({ queryKey: ["users"] });
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
    onSuccess: () => {
      invalidateUsers();
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const directPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) =>
      updateUserPassword(userId, password),
    onSuccess: () => {
      invalidateUsers();
      setPasswordDraft("");
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const temporaryPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: number; password: string }) =>
      resetUserTemporaryPassword(userId, password),
    onSuccess: () => {
      invalidateUsers();
      setTemporaryPasswordDraft("");
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
  const activeStateMutation = useMutation({
    mutationFn: (payload: { userId: number; isActive: boolean }) =>
      updateUserActiveState(payload.userId, payload.isActive),
    onSuccess: () => {
      invalidateUsers();
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
    mutationFn: (payload: { userId: number; username: string; fullName: string }) =>
      updateUserIdentity(payload.userId, {
        username: payload.username,
        fullName: payload.fullName,
      }),
    onSuccess: () => {
      invalidateUsers();
      setIdentityEditing(false);
      setManageError(null);
    },
    onError: (error) => setManageError(mutationErrorMessage(error)),
  });
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
  const doctorProfileLabel = (user: User) =>
    !isDoctorRole(user.role)
      ? t("settings.users.notAvailable")
      : doctorProfilesQuery.isLoading
        ? t("settings.users.doctorProfileLoading")
        : doctorProfilesQuery.isError
          ? t("settings.users.doctorProfileUnavailable")
          : doctorProfilesByUserId.get(user.id)?.active
            ? t("settings.users.doctorProfileActive")
            : doctorProfilesByUserId.has(user.id)
              ? t("settings.users.doctorProfileInactive")
              : t("settings.users.noDoctorProfile");
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
        <input
          aria-label={t("settings.users.search")}
          placeholder={t("settings.users.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
        />
        <select
          aria-label={t("settings.users.allRoles")}
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
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
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
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
                        {user.fullName}
                      </p>
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
                      {user.fullName}
                    </p>
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
              <input
                value={createForm.username}
                onChange={(event) =>
                  setCreateForm({ ...createForm, username: event.target.value })
                }
                className="w-full rounded border px-3 py-2 dark:bg-stone-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>{t("settings.fullName")}</span>
              <input
                value={createForm.fullName}
                onChange={(event) =>
                  setCreateForm({ ...createForm, fullName: event.target.value })
                }
                className="w-full rounded border px-3 py-2 dark:bg-stone-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>{t("settings.password")}</span>
              <input
                type="password"
                value={createForm.password}
                onChange={(event) =>
                  setCreateForm({ ...createForm, password: event.target.value })
                }
                className="w-full rounded border px-3 py-2 dark:bg-stone-900"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span>{t("settings.users.role")}</span>
              <select
                value={createForm.role}
                onChange={(event) =>
                  setCreateForm({ ...createForm, role: event.target.value })
                }
                className="w-full rounded border px-3 py-2 dark:bg-stone-900"
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </label>
          </div>
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
              <DialogTitle>{selectedUser.fullName}</DialogTitle>
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
                    <dt className="description-center">
                      {t("settings.fullName")}
                    </dt>
                    <dd>
                      {identityEditing ? (
                        <input
                          aria-label={t("settings.fullName")}
                          value={identityDraft.fullName}
                          onChange={(event) =>
                            setIdentityDraft({
                              ...identityDraft,
                              fullName: event.target.value,
                            })
                          }
                          className="w-full rounded border px-3 py-2 dark:bg-stone-900"
                        />
                      ) : (
                        selectedUser.fullName
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="description-center">
                      {t("settings.username")}
                    </dt>
                    <dd>
                      {identityEditing ? (
                        <input
                          aria-label={t("settings.username")}
                          value={identityDraft.username}
                          onChange={(event) =>
                            setIdentityDraft({
                              ...identityDraft,
                              username: event.target.value,
                            })
                          }
                          className="w-full rounded border px-3 py-2 dark:bg-stone-900"
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
                    <dt className="description-center">
                      {t("settings.users.security")}
                    </dt>
                    <dd>
                      {selectedUser.mustChangePassword
                        ? t("settings.users.passwordChangeRequired")
                        : t("settings.users.passwordChangeNotRequired")}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {identityEditing ? (
                    <>
                      <Button
                        size="sm"
                        disabled={
                          identityMutation.isPending ||
                          !identityDraft.username.trim() ||
                          !identityDraft.fullName.trim() ||
                          (identityDraft.username.trim() === selectedUser.username &&
                            identityDraft.fullName.trim() === selectedUser.fullName)
                        }
                        onClick={() =>
                          identityMutation.mutate({
                            userId: selectedUser.id,
                            username: identityDraft.username,
                            fullName: identityDraft.fullName,
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
                </div>
              </section>
              {selectedUser.role === "receptionist" && (
                <section>
                  <h4 className="font-semibold">
                    {t("settings.users.permissions")}
                  </h4>
                  <label className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(
                        selectedUser.canRequestSchedulingOverride,
                      )}
                      disabled={permissionMutation.isPending}
                      onChange={(event) =>
                        permissionMutation.mutate({
                          userId: selectedUser.id,
                          canRequestSchedulingOverride: event.target.checked,
                        })
                      }
                    />
                    {t("overrideRequests.permissionLabel")}
                  </label>
                </section>
              )}
              {isDoctorRole(selectedUser.role) && (
                <section>
                  <h4 className="font-semibold">
                    {t("settings.users.doctorProfile")}
                  </h4>
                  <p className="mt-1">{doctorProfileLabel(selectedUser)}</p>
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
              <section>
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
                      className="w-full rounded border px-3 py-2 dark:bg-stone-900"
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
                    <input
                      aria-label={t("settings.users.temporaryPassword")}
                      type="password"
                      value={temporaryPasswordDraft}
                      onChange={(event) =>
                        setTemporaryPasswordDraft(event.target.value)
                      }
                      className="w-full rounded border px-3 py-2 dark:bg-stone-900"
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
              </section>
              <section>
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
              </section>
              <section className="border-t border-red-200 pt-4 dark:border-red-900">
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
              </section>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
