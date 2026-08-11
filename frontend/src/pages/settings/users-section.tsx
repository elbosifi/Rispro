import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/shared/Button";
import {
  createUser,
  deleteUser,
  fetchDoctorProfilesForAdmin,
  fetchUsers,
  updateUserPassword,
  updateUserSchedulingOverridePermission,
} from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";
import type { DoctorProfile, User } from "@/types/api";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";

function statusLabel(profile?: DoctorProfile): string {
  if (!profile) return "No doctor profile";
  return profile.active ? "Doctor profile active" : "Doctor profile inactive";
}

function safeDoctorProfileError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "An unexpected error occurred.";
}

export default function UsersSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery<{ users: User[] }>({ queryKey: ["users"], queryFn: fetchUsers });
  const doctorProfilesQuery = useQuery<DoctorProfile[]>({
    queryKey: ["doctor", "profiles"],
    queryFn: fetchDoctorProfilesForAdmin,
    retry: false
  });

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ username: "", fullName: "", password: "", role: "receptionist" });
  const [editingPasswordUserId, setEditingPasswordUserId] = useState<number | null>(null);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);

  const doctorProfilesByUserId = useMemo(() => {
    const map = new Map<number, DoctorProfile>();
    for (const profile of doctorProfilesQuery.data ?? []) {
      map.set(profile.userId, profile);
    }
    return map;
  }, [doctorProfilesQuery.data]);

  const deleteMutation = useMutation({
    mutationFn: (userId: number) => deleteUser(userId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setMutationError(null); },
    onError: (err: Error) => { setMutationError(err?.message || "Delete failed"); }
  });
  const createMutation = useMutation({
    mutationFn: (data: { username: string; fullName: string; password: string; role: string }) => createUser(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["users"] }); setShowCreate(false); setCreateForm({ username: "", fullName: "", password: "", role: "receptionist" }); setMutationError(null); },
    onError: (err: Error) => { setMutationError(err?.message || "Create failed"); }
  });
  const updatePasswordMutation = useMutation({
    mutationFn: (payload: { userId: number; password: string }) => updateUserPassword(payload.userId, payload.password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditingPasswordUserId(null);
      setPasswordDraft("");
      setMutationError(null);
    },
    onError: (err: Error) => { setMutationError(err?.message || "Password update failed"); }
  });
  const updateSchedulingOverridePermissionMutation = useMutation({
    mutationFn: (payload: { userId: number; canRequestSchedulingOverride: boolean }) =>
      updateUserSchedulingOverridePermission(payload.userId, payload.canRequestSchedulingOverride),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setMutationError(null);
    },
    onError: (err: Error) => { setMutationError(err?.message || t("overrideRequests.permissionUpdateFailed")); }
  });
  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["users"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}
      <div className="flex justify-between items-center">
        <span className="text-sm description-center">{data?.users?.length ?? 0} users</span>
        <Button variant="secondary" onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="text-xs">{showCreate ? "إلغاء" : "إضافة مستخدم"}</Button>
      </div>

      {showCreate && (
        <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input value={createForm.username} onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })} placeholder="اسم المستخدم" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.fullName} onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })} placeholder="الاسم الكامل" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input type="password" value={createForm.password} onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })} placeholder="كلمة المرور" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <select value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm">
              <option value="receptionist">موظف استقبال</option>
              <option value="supervisor">مشرف</option>
              <option value="modality_staff">Technologist</option>
              <option value="doctor">Doctor</option>
              <option value="administrative">Administrative</option>
              <option value="super_admin">Super Admin</option>
            </select>
          </div>
          <button onClick={() => createMutation.mutate(createForm)} disabled={createMutation.isPending || !createForm.username || !createForm.fullName || !createForm.password} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors">إنشاء</button>
        </div>
      )}

      <ul className="divide-y divide-stone-200 dark:divide-stone-700">
        {data?.users?.map((u) => {
          const doctorProfile = doctorProfilesByUserId.get(u.id);

          return (
          <li key={u.id} className="py-3">
            <div className="flex items-center justify-between">
              <div className="text-start">
                <p className="font-medium text-stone-900 dark:text-white">{u.fullName}</p>
                <p className="text-sm description-center">@{u.username} - {u.role}</p>
              </div>
              <div className="flex items-center gap-2">
                {u.role === "receptionist" && (
                  <label className="flex items-center gap-1 rounded-full border border-stone-200 px-2 py-1 text-xs text-stone-700 dark:border-stone-600 dark:text-stone-200">
                    <input
                      type="checkbox"
                      checked={Boolean(u.canRequestSchedulingOverride)}
                      disabled={updateSchedulingOverridePermissionMutation.isPending}
                      onChange={(event) =>
                        updateSchedulingOverridePermissionMutation.mutate({
                          userId: u.id,
                          canRequestSchedulingOverride: event.target.checked,
                        })
                      }
                    />
                    {t("overrideRequests.permissionLabel")}
                  </label>
                )}
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${u.isActive ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                  {u.isActive ? t("settings.active") : t("settings.inactive")}
                </span>
                <button
                  onClick={() => {
                    setEditingPasswordUserId((current) => (current === u.id ? null : u.id));
                    setPasswordDraft("");
                    setMutationError(null);
                  }}
                  className="px-2 py-1 text-xs bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400 rounded hover:bg-sky-200 dark:hover:bg-sky-900/50 transition-colors"
                >
                  Edit Password
                </button>
                <button
                  onClick={() => { if (window.confirm("Delete this user?")) deleteMutation.mutate(u.id); }}
                  className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
            {(u.role === "doctor" || u.role === "supervisor" || u.role === "super_admin") && (
              <div className="mt-3 rounded border border-stone-200 dark:border-stone-700 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-stone-900 dark:text-white">Doctor Portal</p>
                    <p className="text-xs description-center">{doctorProfilesQuery.isLoading
                      ? "Checking Doctor Portal profile…"
                      : doctorProfilesQuery.isError
                        ? "Unable to load Doctor Portal profile status"
                        : statusLabel(doctorProfile)}</p>
                    {doctorProfilesQuery.isError && <><p className="mt-1 text-xs text-red-700 dark:text-red-300">{safeDoctorProfileError(doctorProfilesQuery.error)}</p><button type="button" onClick={() => doctorProfilesQuery.refetch()} className="mt-2 rounded border px-2 py-1 text-xs font-medium">Retry</button></>}
                    <p className="mt-1 text-xs description-center">
                      Doctor profiles and modality permissions are managed in Doctor Portal → Admin → Doctors.
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${doctorProfile?.active && doctorProfilesQuery.isSuccess ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                    {doctorProfilesQuery.isLoading ? "Checking…" : doctorProfilesQuery.isError ? "Unavailable" : statusLabel(doctorProfile)}
                  </span>
                </div>
              </div>
            )}
            {editingPasswordUserId === u.id && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="password"
                  value={passwordDraft}
                  onChange={(e) => setPasswordDraft(e.target.value)}
                  placeholder="New password"
                  className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm"
                />
                <button
                  onClick={() => updatePasswordMutation.mutate({ userId: u.id, password: passwordDraft })}
                  disabled={updatePasswordMutation.isPending || !passwordDraft.trim()}
                  className="px-2 py-1 text-xs bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white rounded transition-colors"
                >
                  Save Password
                </button>
                <button
                  onClick={() => {
                    setEditingPasswordUserId(null);
                    setPasswordDraft("");
                  }}
                  className="px-2 py-1 text-xs bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-200 rounded transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
