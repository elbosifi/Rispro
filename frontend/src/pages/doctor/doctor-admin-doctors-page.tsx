import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDoctorWithUserForAdmin,
  createDoctorProfileForAdmin,
  confirmDoctorImport,
  fetchAppointmentLookups,
  fetchDoctorProfileModalities,
  fetchDoctorProfilesForAdmin,
  fetchUsers,
  forceDoctorUserPasswordChange,
  inspectDoctorImport,
  previewDoctorImport,
  resetDoctorUserTemporaryPassword,
  setDoctorUserActive,
  updateDoctorProfileForAdmin,
  updateDoctorProfileModalities,
  type DoctorImportPreview,
  type DoctorImportResult,
} from "@/lib/api-hooks";
import type { DoctorMe, DoctorModalityPermission, DoctorProfile, DoctorProfileRole, User } from "@/types/api";

type CreateDoctorDraft = {
  username: string;
  fullName: string;
  temporaryPassword: string;
  coreRole: "doctor" | "supervisor";
  userActive: boolean;
  doctorDisplayName: string;
  doctorRole: DoctorProfileRole;
  doctorProfileActive: boolean;
  canFinalizeReports: boolean;
  canAssignProtocols: boolean;
  canSupervise: boolean;
};

type DoctorProfileDraft = {
  displayName: string;
  doctorRole: DoctorProfileRole;
  active: boolean;
  canFinalizeReports: boolean;
  canAssignProtocols: boolean;
  canSupervise: boolean;
};

type ModalityPermissionDraft = {
  canProtocol: boolean;
  canReport: boolean;
  canSupervise: boolean;
  active: boolean;
};

const DOCTOR_ROLES: Array<{ value: DoctorProfileRole; label: string }> = [
  { value: "consultant", label: "Consultant" },
  { value: "specialist", label: "Specialist" },
  { value: "senior_house_officer", label: "Senior house officer" },
  { value: "resident", label: "Resident" },
];

const DEFAULT_PROFILE_DRAFT: DoctorProfileDraft = {
  displayName: "",
  doctorRole: "consultant",
  active: true,
  canFinalizeReports: true,
  canAssignProtocols: true,
  canSupervise: false,
};

const DEFAULT_CREATE_DOCTOR_DRAFT: CreateDoctorDraft = {
  username: "",
  fullName: "",
  temporaryPassword: "",
  coreRole: "doctor",
  userActive: true,
  doctorDisplayName: "",
  doctorRole: "consultant",
  doctorProfileActive: true,
  canFinalizeReports: true,
  canAssignProtocols: true,
  canSupervise: false,
};

function statusLabel(profile?: DoctorProfile): string {
  if (!profile) return "No doctor profile";
  return profile.active ? "Doctor profile active" : "Doctor profile inactive";
}

export function DoctorAdminDoctorsPage({ me, advanced = false }: { me: DoctorMe; advanced?: boolean }) {
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [importFileBase64, setImportFileBase64] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importFormat, setImportFormat] = useState<"csv" | "xlsx">("csv");
  const [importInspect, setImportInspect] = useState<{ format: "csv" | "xlsx"; columns: string[]; rowCount: number; missingColumns: string[] } | null>(null);
  const [importPreview, setImportPreview] = useState<DoctorImportPreview | null>(null);
  const [importResult, setImportResult] = useState<DoctorImportResult | null>(null);
  const [createDoctorDraft, setCreateDoctorDraft] = useState<CreateDoctorDraft>(DEFAULT_CREATE_DOCTOR_DRAFT);
  const [createDoctorModalities, setCreateDoctorModalities] = useState<Record<number, {
    canProtocol: boolean;
    canReport: boolean;
    canSupervise: boolean;
    active: boolean;
  }>>({});
  const [editingProfileId, setEditingProfileId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<DoctorProfileDraft>(DEFAULT_PROFILE_DRAFT);
  const [modalityDraft, setModalityDraft] = useState<Record<number, ModalityPermissionDraft>>({});
  const [resetPassword, setResetPassword] = useState("");
  const [adminMessage, setAdminMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [draft, setDraft] = useState({
    userId: "",
    displayName: "",
    doctorRole: "consultant" as DoctorProfileRole,
    active: true,
    canFinalizeReports: true,
    canAssignProtocols: true,
    canSupervise: false,
  });

  const profilesQuery = useQuery({ queryKey: ["doctor", "profiles"], queryFn: fetchDoctorProfilesForAdmin });
  const usersQuery = useQuery<{ users: User[] }>({ queryKey: ["users"], queryFn: fetchUsers });
  const lookupsQuery = useQuery({ queryKey: ["lookups"], queryFn: fetchAppointmentLookups, staleTime: 1000 * 60 * 5 });
  const modalitiesQuery = useQuery({
    queryKey: ["doctor", "profiles", selectedProfileId, "modalities"],
    queryFn: () => fetchDoctorProfileModalities(selectedProfileId!),
    enabled: Boolean(selectedProfileId),
  });

  const profiles = profilesQuery.data ?? [];
  const usersById = useMemo(() => new Map((usersQuery.data?.users ?? []).map((user) => [user.id, user])), [usersQuery.data?.users]);
  const profilesByUserId = useMemo(() => new Map(profiles.map((profile) => [profile.userId, profile])), [profiles]);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const editingProfile = profiles.find((profile) => profile.id === editingProfileId) ?? null;
  const editingLinkedUserActive = editingProfile ? (editingProfile.userActive ?? usersById.get(editingProfile.userId)?.isActive ?? false) : false;

  const invalidateProfiles = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "profiles"] });
    await queryClient.invalidateQueries({ queryKey: ["doctor", "me"] });
  };

  const createMutation = useMutation({
    mutationFn: () => createDoctorProfileForAdmin({
      userId: Number(draft.userId),
      displayName: draft.displayName,
      doctorRole: draft.doctorRole,
      active: draft.active,
      canFinalizeReports: draft.canFinalizeReports,
      canAssignProtocols: draft.canAssignProtocols,
      canSupervise: draft.canSupervise,
    }),
    onSuccess: async (profile) => {
      setSelectedProfileId(profile.id);
      setAdminMessage({ tone: "success", text: "Doctor profile created." });
      await invalidateProfiles();
    },
  });

  const createDoctorMutation = useMutation({
    mutationFn: () => createDoctorWithUserForAdmin({
      ...createDoctorDraft,
      modalityPermissions: Object.entries(createDoctorModalities)
        .map(([modalityId, permission]) => ({ modalityId: Number(modalityId), ...permission }))
        .filter((permission) => permission.active || permission.canProtocol || permission.canReport || permission.canSupervise),
    }),
    onSuccess: async (result) => {
      setSelectedProfileId(result.profile.id);
      setCreateDoctorDraft(DEFAULT_CREATE_DOCTOR_DRAFT);
      setCreateDoctorModalities({});
      setAdminMessage({ tone: "success", text: "Doctor user and profile created." });
      await invalidateProfiles();
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { profileId: number; patch: Partial<typeof draft> }) => updateDoctorProfileForAdmin(payload.profileId, payload.patch),
    onSuccess: async () => {
      setAdminMessage({ tone: "success", text: "Doctor profile updated." });
      await invalidateProfiles();
    },
  });

  const editMutation = useMutation({
    mutationFn: () => {
      if (!editingProfile) throw new Error("Select a doctor profile to edit.");
      return updateDoctorProfileForAdmin(editingProfile.id, editDraft);
    },
    onSuccess: async () => {
      setEditingProfileId(null);
      setResetPassword("");
      setAdminMessage({ tone: "success", text: "Doctor profile saved." });
      await invalidateProfiles();
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: () => {
      if (!editingProfile) throw new Error("Select a doctor profile to edit.");
      return resetDoctorUserTemporaryPassword(editingProfile.userId, resetPassword);
    },
    onSuccess: async () => {
      setResetPassword("");
      setAdminMessage({ tone: "success", text: "Temporary password updated." });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await invalidateProfiles();
    },
  });

  const forcePasswordMutation = useMutation({
    mutationFn: () => {
      if (!editingProfile) throw new Error("Select a doctor profile to edit.");
      return forceDoctorUserPasswordChange(editingProfile.userId);
    },
    onSuccess: async () => {
      setAdminMessage({ tone: "success", text: "Password change will be required at next login." });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await invalidateProfiles();
    },
  });

  const userActiveMutation = useMutation({
    mutationFn: (active: boolean) => {
      if (!editingProfile) throw new Error("Select a doctor profile to edit.");
      return setDoctorUserActive(editingProfile.userId, active);
    },
    onSuccess: async () => {
      setAdminMessage({ tone: "success", text: "Linked user account updated." });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await invalidateProfiles();
    },
  });

  const modalityMutation = useMutation({
    mutationFn: (permissions: Array<{ modalityId: number; canProtocol: boolean; canReport: boolean; canSupervise: boolean; active: boolean }>) =>
      updateDoctorProfileModalities(selectedProfileId!, permissions),
    onSuccess: async () => {
      setAdminMessage({ tone: "success", text: "Modality permissions saved." });
      await queryClient.invalidateQueries({ queryKey: ["doctor", "profiles", selectedProfileId, "modalities"] });
      await queryClient.invalidateQueries({ queryKey: ["doctor", "me"] });
    },
  });
  const inspectMutation = useMutation({
    mutationFn: inspectDoctorImport,
    onSuccess: (result) => setImportInspect(result.workbook),
  });
  const previewMutation = useMutation({
    mutationFn: previewDoctorImport,
    onSuccess: setImportPreview,
  });
  const confirmMutation = useMutation({
    mutationFn: confirmDoctorImport,
    onSuccess: async (result) => {
      setImportResult(result);
      await invalidateProfiles();
    },
  });

  const importPayload = () => ({ fileContentBase64: importFileBase64, format: importFormat, fileName: importFileName });

  useEffect(() => {
    if (!selectedProfileId || !modalitiesQuery.data) {
      setModalityDraft({});
      return;
    }
    setModalityDraft(Object.fromEntries(modalitiesQuery.data.map((permission) => [
      permission.modalityId,
      {
        canProtocol: permission.canProtocol,
        canReport: permission.canReport,
        canSupervise: permission.canSupervise,
        active: permission.active,
      },
    ])));
  }, [modalitiesQuery.data, selectedProfileId]);

  const readImportFile = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read import file."));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    const format = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
    setImportFileBase64(base64);
    setImportFileName(file.name);
    setImportFormat(format);
    setImportInspect(null);
    setImportPreview(null);
    setImportResult(null);
    inspectMutation.mutate({ fileContentBase64: base64, format, fileName: file.name });
  };

  const modalityRows = (lookupsQuery.data?.modalities ?? []).map((modality) => {
    const existing = modalityDraft[modality.id];
    return {
      modalityId: modality.id,
      label: modality.nameEn || modality.nameAr || modality.code || String(modality.id),
      canProtocol: existing?.canProtocol ?? false,
      canReport: existing?.canReport ?? false,
      canSupervise: existing?.canSupervise ?? false,
      active: existing?.active ?? false,
    };
  });

  const saveModalities = (patch?: Partial<DoctorModalityPermission> & { modalityId: number }) => {
    const rows = modalityRows.map((row) => row.modalityId === patch?.modalityId ? { ...row, ...patch } : row);
    const permissions = rows.map(({ label: _label, ...row }) => row);
    setModalityDraft(Object.fromEntries(permissions.map((permission) => [permission.modalityId, permission])));
    modalityMutation.mutate(permissions);
  };

  const startEditing = (profile: DoctorProfile) => {
    setEditingProfileId(profile.id);
    setSelectedProfileId(profile.id);
    setAdminMessage(null);
    setEditDraft({
      displayName: profile.displayName,
      doctorRole: profile.doctorRole,
      active: profile.active,
      canFinalizeReports: profile.canFinalizeReports,
      canAssignProtocols: profile.canAssignProtocols,
      canSupervise: profile.canSupervise,
    });
    setResetPassword("");
  };

  const formError = createDoctorMutation.error || createMutation.error || editMutation.error || resetPasswordMutation.error || forcePasswordMutation.error || userActiveMutation.error;

  if (!me.canManageDoctorProfiles) {
    return <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)" }}>Doctor profile management is not available for this user.</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Doctor Portal Admin</p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">Doctors</h2>
      </div>

      {formError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError instanceof Error ? formError.message : "Doctor admin action failed."}
        </div>
      )}
      {adminMessage && (
        <div className={adminMessage.tone === "success" ? "rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700" : "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"}>
          {adminMessage.text}
        </div>
      )}

      <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <h3 className="font-semibold">Create Doctor</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          Creates the RISpro login account and Doctor Portal profile together.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <input value={createDoctorDraft.username} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, username: event.target.value }))} placeholder="Username" className="rounded-lg border px-3 py-2 text-sm" />
          <input value={createDoctorDraft.fullName} onChange={(event) => setCreateDoctorDraft((current) => ({
            ...current,
            fullName: event.target.value,
            doctorDisplayName: current.doctorDisplayName || event.target.value,
          }))} placeholder="Full name" className="rounded-lg border px-3 py-2 text-sm" />
          <input type="password" value={createDoctorDraft.temporaryPassword} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, temporaryPassword: event.target.value }))} placeholder="Temporary password" className="rounded-lg border px-3 py-2 text-sm" />
          <select value={createDoctorDraft.coreRole} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, coreRole: event.target.value as "doctor" | "supervisor" }))} className="rounded-lg border px-3 py-2 text-sm">
            <option value="doctor">Doctor login</option>
            <option value="supervisor">Supervisor login</option>
          </select>
          <input value={createDoctorDraft.doctorDisplayName} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, doctorDisplayName: event.target.value }))} placeholder="Doctor display name" className="rounded-lg border px-3 py-2 text-sm" />
          <select value={createDoctorDraft.doctorRole} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, doctorRole: event.target.value as DoctorProfileRole }))} className="rounded-lg border px-3 py-2 text-sm">
            {DOCTOR_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={createDoctorDraft.userActive} disabled /> User active</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={createDoctorDraft.doctorProfileActive} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, doctorProfileActive: event.target.checked }))} /> Profile active</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={createDoctorDraft.canFinalizeReports} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, canFinalizeReports: event.target.checked }))} /> Can finalize reports</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={createDoctorDraft.canAssignProtocols} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, canAssignProtocols: event.target.checked }))} /> Can assign protocols</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={createDoctorDraft.canSupervise} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, canSupervise: event.target.checked }))} /> Can supervise</label>
        </div>
        {(lookupsQuery.data?.modalities ?? []).length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <table className="min-w-full text-sm">
              <thead><tr>{["Initial modality", "Active", "Protocol", "Report", "Supervise"].map((header) => <th key={header} className="px-3 py-2 text-left text-xs uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>)}</tr></thead>
              <tbody>
                {(lookupsQuery.data?.modalities ?? []).map((modality) => {
                  const permission = createDoctorModalities[modality.id] ?? { active: false, canProtocol: false, canReport: false, canSupervise: false };
                  const label = modality.nameEn || modality.nameAr || modality.code || String(modality.id);
                  return (
                    <tr key={modality.id}>
                      <td className="px-3 py-2 font-medium">{label}</td>
                      {(["active", "canProtocol", "canReport", "canSupervise"] as const).map((key) => (
                        <td key={key} className="px-3 py-2">
                          <input type="checkbox" checked={permission[key]} onChange={(event) => setCreateDoctorModalities((current) => ({
                            ...current,
                            [modality.id]: { ...permission, [key]: event.target.checked },
                          }))} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4">
          <button type="button" disabled={!createDoctorDraft.username || !createDoctorDraft.fullName || !createDoctorDraft.temporaryPassword || !createDoctorDraft.doctorDisplayName || createDoctorMutation.isPending} onClick={() => createDoctorMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">
            Create doctor
          </button>
        </div>
      </section>

      {advanced && (
        <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="mb-3 font-semibold">Doctor CSV/XLSX import and export</h3>
          <div className="mb-4 flex flex-wrap gap-2">
            <a href="/api/doctor/admin/doctors/import/template?format=csv" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Download CSV template</a>
            <a href="/api/doctor/admin/doctors/import/template?format=xlsx" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Download XLSX template</a>
            <a href="/api/doctor/admin/doctors/export?format=csv" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Export CSV</a>
            <a href="/api/doctor/admin/doctors/export?format=xlsx" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Export XLSX</a>
            <label className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
              Import CSV/XLSX
              <input type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readImportFile(file);
              }} />
            </label>
            <button type="button" disabled={!importFileBase64 || previewMutation.isPending} onClick={() => previewMutation.mutate(importPayload())} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>Preview import</button>
            <button type="button" disabled={!importPreview?.canConfirm || confirmMutation.isPending} onClick={() => confirmMutation.mutate(importPayload())} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">Confirm import</button>
          </div>
          {importInspect && (
            <p className="mb-3 text-sm" style={{ color: "var(--text-muted)" }}>
              {importInspect.format.toUpperCase()} file: {importInspect.rowCount} rows, {importInspect.columns.length} columns. Missing: {importInspect.missingColumns.join(", ") || "none"}.
            </p>
          )}
          {importPreview && (
            <div className="mb-3 max-h-56 overflow-auto rounded-lg border p-2 text-xs" style={{ borderColor: "var(--border)" }}>
              {importPreview.rows.slice(0, 20).map((row) => (
                <p key={row.rowNumber} className={row.errors.length ? "text-red-600" : ""}>
                  Row {row.rowNumber}: {row.action}{row.errors.length ? ` - ${row.errors.join("; ")}` : ""}
                </p>
              ))}
            </div>
          )}
          {importResult && (
            <p className="mb-3 text-sm" style={{ color: "var(--text-muted)" }}>
              Import complete: {importResult.createdUsers} users created, {importResult.updatedUsers} users updated, {importResult.createdProfiles} profiles created, {importResult.updatedProfiles} profiles updated.
            </p>
          )}
        </section>
      )}

      <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <h3 className="font-semibold">Create doctor profile for existing user</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <select value={draft.userId} onChange={(event) => {
            const user = usersById.get(Number(event.target.value));
            setDraft((current) => ({ ...current, userId: event.target.value, displayName: user?.fullName ?? current.displayName }));
          }} className="rounded-lg border px-3 py-2 text-sm">
            <option value="">Select user</option>
            {(usersQuery.data?.users ?? []).filter((user) => !profilesByUserId.has(user.id)).map((user) => (
              <option key={user.id} value={user.id}>{user.fullName} (@{user.username})</option>
            ))}
          </select>
          <input value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Display name" className="rounded-lg border px-3 py-2 text-sm" />
          <select value={draft.doctorRole} onChange={(event) => setDraft((current) => ({ ...current, doctorRole: event.target.value as DoctorProfileRole }))} className="rounded-lg border px-3 py-2 text-sm">
            {DOCTOR_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
          <button type="button" disabled={!draft.userId || !draft.displayName || createMutation.isPending} onClick={() => createMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">
            Create profile
          </button>
        </div>
      </section>

      <section className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
        <table className="min-w-full divide-y text-sm" style={{ borderColor: "var(--border)" }}>
          <thead style={{ backgroundColor: "var(--card)" }}>
            <tr>{["Name", "User", "Core role", "User", "Doctor role", "Profile", "Permissions", "Actions"].map((header) => <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
            {profiles.map((profile) => (
              <tr key={profile.id}>
                <td className="px-3 py-2 font-medium">{profile.displayName}</td>
                <td className="px-3 py-2">@{profile.username ?? usersById.get(profile.userId)?.username ?? profile.userId}</td>
                <td className="px-3 py-2">{profile.coreRole ?? usersById.get(profile.userId)?.role ?? "-"}</td>
                <td className="px-3 py-2">{profile.userActive ?? usersById.get(profile.userId)?.isActive ? "Active" : "Inactive"}</td>
                <td className="px-3 py-2">{profile.doctorRole.replaceAll("_", " ")}</td>
                <td className="px-3 py-2">{statusLabel(profile)}</td>
                <td className="px-3 py-2">
                  {[profile.canFinalizeReports && "reports", profile.canAssignProtocols && "protocols", profile.canSupervise && "supervises"].filter(Boolean).join(", ") || "-"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => startEditing(profile)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Edit</button>
                    <button type="button" onClick={() => setSelectedProfileId(profile.id)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Modalities</button>
                    <button type="button" onClick={() => updateMutation.mutate({ profileId: profile.id, patch: { active: !profile.active } })} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                      {profile.active ? "Disable" : "Reactivate"}
                    </button>
                    <button type="button" onClick={() => updateMutation.mutate({ profileId: profile.id, patch: { canSupervise: !profile.canSupervise } })} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                      {profile.canSupervise ? "Remove supervisor" : "Make supervisor"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {editingProfile && (
        <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Edit doctor profile: {editingProfile.displayName}</h3>
            <button type="button" onClick={() => setEditingProfileId(null)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Close</button>
          </div>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Profile permissions control Reporting Board eligibility. Use modality permissions below for CT/MR report access.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Display name</span>
              <input value={editDraft.displayName} onChange={(event) => setEditDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Display name" className="rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Doctor role</span>
              <select value={editDraft.doctorRole} onChange={(event) => setEditDraft((current) => ({ ...current, doctorRole: event.target.value as DoctorProfileRole }))} className="rounded-lg border px-3 py-2 text-sm">
                {DOCTOR_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </label>
            <button type="button" disabled={!editDraft.displayName || editMutation.isPending} onClick={() => editMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">
              {editMutation.isPending ? "Saving..." : "Save profile"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.active} onChange={(event) => setEditDraft((current) => ({ ...current, active: event.target.checked }))} /> Profile active</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.canFinalizeReports} onChange={(event) => setEditDraft((current) => ({ ...current, canFinalizeReports: event.target.checked }))} /> Can finalize reports</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.canAssignProtocols} onChange={(event) => setEditDraft((current) => ({ ...current, canAssignProtocols: event.target.checked }))} /> Can assign protocols</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.canSupervise} onChange={(event) => setEditDraft((current) => ({ ...current, canSupervise: event.target.checked }))} /> Can supervise</label>
          </div>
          <div className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
            <p className="text-sm font-semibold">Linked user account</p>
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              @{editingProfile.username ?? usersById.get(editingProfile.userId)?.username ?? editingProfile.userId} - {editingLinkedUserActive ? "Active" : "Inactive"}
              {usersById.get(editingProfile.userId)?.mustChangePassword ? " - must change password" : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="New temporary password" className="rounded-lg border px-3 py-2 text-sm" />
              <button type="button" disabled={!resetPassword || resetPasswordMutation.isPending} onClick={() => resetPasswordMutation.mutate()} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>
                Reset temporary password
              </button>
              <button type="button" disabled={forcePasswordMutation.isPending} onClick={() => forcePasswordMutation.mutate()} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>
                Require password change
              </button>
              <button type="button" disabled={userActiveMutation.isPending} onClick={() => userActiveMutation.mutate(!editingLinkedUserActive)} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>
                {editingLinkedUserActive ? "Deactivate linked user" : "Activate linked user"}
              </button>
            </div>
          </div>
        </section>
      )}

      {selectedProfile && (
        <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="font-semibold">Modality permissions: {selectedProfile.displayName}</h3>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            Toggle Report for every modality this doctor can receive on the Reporting Assignment Board.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr>{["Modality", "Active", "Protocol", "Report", "Supervise"].map((header) => <th key={header} className="px-3 py-2 text-left text-xs uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>)}</tr></thead>
              <tbody>
                {modalityRows.map((row) => (
                  <tr key={row.modalityId}>
                    <td className="px-3 py-2 font-medium">{row.label}</td>
                    {(["active", "canProtocol", "canReport", "canSupervise"] as const).map((key) => (
                      <td key={key} className="px-3 py-2">
                        <input type="checkbox" checked={Boolean(row[key])} onChange={(event) => saveModalities({ modalityId: row.modalityId, [key]: event.target.checked })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
