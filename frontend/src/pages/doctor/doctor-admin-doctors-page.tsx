import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDoctorProfileForAdmin,
  confirmDoctorImport,
  fetchAppointmentLookups,
  fetchDoctorProfileModalities,
  fetchDoctorProfilesForAdmin,
  fetchUsers,
  inspectDoctorImport,
  previewDoctorImport,
  updateDoctorProfileForAdmin,
  updateDoctorProfileModalities,
  type DoctorImportPreview,
  type DoctorImportResult,
} from "@/lib/api-hooks";
import type { DoctorMe, DoctorModalityPermission, DoctorProfile, DoctorProfileRole, User } from "@/types/api";

const DOCTOR_ROLES: Array<{ value: DoctorProfileRole; label: string }> = [
  { value: "consultant", label: "Consultant" },
  { value: "specialist", label: "Specialist" },
  { value: "senior_house_officer", label: "Senior house officer" },
  { value: "resident", label: "Resident" },
];

function statusLabel(profile?: DoctorProfile): string {
  if (!profile) return "No doctor profile";
  return profile.active ? "Doctor profile active" : "Doctor profile inactive";
}

export function DoctorAdminDoctorsPage({ me }: { me: DoctorMe }) {
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [importFileBase64, setImportFileBase64] = useState("");
  const [importInspect, setImportInspect] = useState<{ columns: string[]; rowCount: number; missingColumns: string[] } | null>(null);
  const [importPreview, setImportPreview] = useState<DoctorImportPreview | null>(null);
  const [importResult, setImportResult] = useState<DoctorImportResult | null>(null);
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
      await invalidateProfiles();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { profileId: number; patch: Partial<typeof draft> }) => updateDoctorProfileForAdmin(payload.profileId, payload.patch),
    onSuccess: invalidateProfiles,
  });

  const modalityMutation = useMutation({
    mutationFn: (permissions: Array<{ modalityId: number; canProtocol: boolean; canReport: boolean; canSupervise: boolean; active: boolean }>) =>
      updateDoctorProfileModalities(selectedProfileId!, permissions),
    onSuccess: async () => {
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

  const readImportFile = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read import file."));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(",")[1] ?? "";
    setImportFileBase64(base64);
    setImportInspect(null);
    setImportPreview(null);
    setImportResult(null);
    inspectMutation.mutate(base64);
  };

  const modalityRows = (lookupsQuery.data?.modalities ?? []).map((modality) => {
    const existing = (modalitiesQuery.data ?? []).find((permission) => permission.modalityId === modality.id);
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
    modalityMutation.mutate(rows.map(({ label: _label, ...row }) => row));
  };

  if (!me.canManageDoctorProfiles) {
    return <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)" }}>Doctor profile management is not available for this user.</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Doctor Portal Admin</p>
        <h2 className="mt-1 text-2xl font-semibold text-foreground">Doctors</h2>
      </div>

      <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="mb-4 flex flex-wrap gap-2">
          <a href="/api/doctor/admin/doctors/import/template" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Download template</a>
          <a href="/api/doctor/admin/doctors/export?format=csv" className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>Export CSV</a>
          <label className="rounded-lg border px-3 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)" }}>
            Import CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readImportFile(file);
            }} />
          </label>
          <button type="button" disabled={!importFileBase64 || previewMutation.isPending} onClick={() => previewMutation.mutate(importFileBase64)} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>Preview import</button>
          <button type="button" disabled={!importPreview?.canConfirm || confirmMutation.isPending} onClick={() => confirmMutation.mutate(importFileBase64)} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-teal-400">Confirm import</button>
        </div>
        {importInspect && (
          <p className="mb-3 text-sm" style={{ color: "var(--text-muted)" }}>
            Import file: {importInspect.rowCount} rows, {importInspect.columns.length} columns. Missing: {importInspect.missingColumns.join(", ") || "none"}.
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

      {selectedProfile && (
        <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
          <h3 className="font-semibold">Modality permissions: {selectedProfile.displayName}</h3>
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
