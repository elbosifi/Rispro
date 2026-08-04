import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
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
  setDoctorIdentityActive,
  updateDoctorLinkedUserForAdmin,
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

type AccountDraft = { username: string; fullName: string; coreRole: "doctor" | "supervisor"; active: boolean };
type DrawerSection = "account" | "profile" | "modalities" | "security";

type ModalityDraftOverride = {
  profileId: number | null;
  baseUpdatedAt: number;
  value: Record<number, ModalityPermissionDraft>;
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

const EMPTY_DOCTOR_PROFILES: DoctorProfile[] = [];

function statusLabel(profile?: DoctorProfile): string {
  if (!profile) return "No doctor profile";
  return profile.active ? "Doctor profile active" : "Doctor profile inactive";
}

function lockBodyScroll(): () => void {
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  return () => { document.body.style.overflow = previousOverflow; };
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
  const [modalityDraftOverride, setModalityDraftOverride] = useState<ModalityDraftOverride | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [accountDraft, setAccountDraft] = useState<AccountDraft>({ username: "", fullName: "", coreRole: "doctor", active: true });
  const [drawerSection, setDrawerSection] = useState<DrawerSection>("account");
  const [confirmLifecycle, setConfirmLifecycle] = useState<DoctorProfile | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
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

  const modalityServerDraft = useMemo(
    () =>
      Object.fromEntries(
        (modalitiesQuery.data ?? []).map((permission) => [
          permission.modalityId,
          {
            canProtocol: permission.canProtocol,
            canReport: permission.canReport,
            canSupervise: permission.canSupervise,
            active: permission.active,
          },
        ])
      ),
    [modalitiesQuery.data]
  );
  const modalityDraft =
    modalityDraftOverride?.profileId === selectedProfileId &&
    modalityDraftOverride.baseUpdatedAt === modalitiesQuery.dataUpdatedAt
      ? modalityDraftOverride.value
      : modalityServerDraft;
  const setModalityDraft: Dispatch<SetStateAction<Record<number, ModalityPermissionDraft>>> = (nextDraft) => {
    setModalityDraftOverride((currentOverride) => {
      const currentDraft =
        currentOverride?.profileId === selectedProfileId &&
        currentOverride.baseUpdatedAt === modalitiesQuery.dataUpdatedAt
          ? currentOverride.value
          : modalityServerDraft;
      return {
        profileId: selectedProfileId,
        baseUpdatedAt: modalitiesQuery.dataUpdatedAt,
        value: typeof nextDraft === "function" ? nextDraft(currentDraft) : nextDraft,
      };
    });
  };

  const profiles = profilesQuery.data ?? EMPTY_DOCTOR_PROFILES;
  const usersById = useMemo(() => new Map((usersQuery.data?.users ?? []).map((user) => [user.id, user])), [usersQuery.data?.users]);
  const profilesByUserId = useMemo(() => new Map(profiles.map((profile) => [profile.userId, profile])), [profiles]);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const editingProfile = profiles.find((profile) => profile.id === editingProfileId) ?? null;

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

  const accountMutation = useMutation({
    mutationFn: () => {
      if (!editingProfile) throw new Error("Select a doctor profile to edit.");
      return updateDoctorLinkedUserForAdmin(editingProfile.userId, accountDraft);
    },
    onSuccess: async () => {
      setAdminMessage({ tone: "success", text: "Login account saved. Password settings were unchanged." });
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      await invalidateProfiles();
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: (profile: DoctorProfile) => setDoctorIdentityActive(profile.userId, !(profile.userActive ?? profile.active)),
    onSuccess: async (result) => {
      setConfirmLifecycle(null);
      setAdminMessage({ tone: "success", text: result.profile.active ? "Doctor reactivated." : "Doctor deactivated." });
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
    const permissions = rows.map(({ modalityId, canProtocol, canReport, canSupervise, active }) => ({ modalityId, canProtocol, canReport, canSupervise, active }));
    setModalityDraft(Object.fromEntries(permissions.map((permission) => [permission.modalityId, permission])));
    modalityMutation.mutate(permissions);
  };

  const openDrawer = (profile: DoctorProfile, section: DrawerSection, trigger: HTMLButtonElement) => {
    drawerTriggerRef.current = trigger;
    setEditingProfileId(profile.id);
    setSelectedProfileId(profile.id);
    setDrawerSection(section);
    setAdminMessage(null);
    setEditDraft({
      displayName: profile.displayName,
      doctorRole: profile.doctorRole,
      active: profile.active,
      canFinalizeReports: profile.canFinalizeReports,
      canAssignProtocols: profile.canAssignProtocols,
      canSupervise: profile.canSupervise,
    });
    const linkedUser = usersById.get(profile.userId);
    const role = profile.coreRole ?? linkedUser?.role;
    setAccountDraft({
      username: profile.username ?? linkedUser?.username ?? "",
      fullName: profile.fullName ?? linkedUser?.fullName ?? "",
      coreRole: role === "supervisor" ? "supervisor" : "doctor",
      active: profile.userActive ?? linkedUser?.isActive ?? false,
    });
    setResetPassword("");
  };

  const closeDrawer = () => {
    setEditingProfileId(null);
    setSelectedProfileId(null);
    setConfirmLifecycle(null);
    window.setTimeout(() => drawerTriggerRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!editingProfile) return;
    const unlockBodyScroll = lockBodyScroll();
    drawerCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setEditingProfileId(null);
        setSelectedProfileId(null);
        setConfirmLifecycle(null);
        window.setTimeout(() => drawerTriggerRef.current?.focus(), 0);
      }
      if (event.key !== "Tab") return;
      const dialog = drawerCloseRef.current?.closest('[role="dialog"]');
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { unlockBodyScroll(); document.removeEventListener("keydown", onKeyDown); };
  }, [editingProfile]);

  const formError = createDoctorMutation.error || createMutation.error || updateMutation.error || editMutation.error || accountMutation.error || modalityMutation.error || resetPasswordMutation.error || forcePasswordMutation.error || lifecycleMutation.error;

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
        <h3 className="font-semibold">Create login account and doctor profile</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>Creates new RISpro credentials and requires the doctor to change the temporary password at first login.</p>
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
            Create login account and doctor profile
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
        <h3 className="font-semibold">Link existing RISpro user to doctor profile</h3>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>Uses the selected account’s existing username, password, core role, and active state. No new login credentials are created.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          <select value={draft.userId} onChange={(event) => {
            const user = usersById.get(Number(event.target.value));
            setDraft((current) => ({ ...current, userId: event.target.value, displayName: user?.fullName ?? current.displayName }));
          }} className="rounded-lg border px-3 py-2 text-sm">
            <option value="">Select user</option>
            {(usersQuery.data?.users ?? []).filter((user) => !profilesByUserId.has(user.id)).map((user) => (
              <option key={user.id} value={user.id}>{user.fullName} ({user.username}) - {user.role} - {user.isActive ? "user active" : "user inactive"}</option>
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
            <tr>{["Name", "Username", "Core role", "User account", "Doctor role", "Profile", "Permissions", "Actions"].map((header) => <th key={header} className="px-3 py-2 text-left text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>)}</tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
            {profiles.map((profile) => (
              <tr key={profile.id}>
                <td className="px-3 py-2 font-medium">{profile.displayName}</td>
                <td className="px-3 py-2">{profile.username ?? usersById.get(profile.userId)?.username ?? profile.userId}</td>
                <td className="px-3 py-2">{profile.coreRole ?? usersById.get(profile.userId)?.role ?? "-"}</td>
                <td className="px-3 py-2">{profile.userActive ?? usersById.get(profile.userId)?.isActive ? "Active" : "Inactive"}</td>
                <td className="px-3 py-2">{profile.doctorRole.replaceAll("_", " ")}</td>
                <td className="px-3 py-2">{statusLabel(profile)}</td>
                <td className="px-3 py-2">
                  {[profile.canFinalizeReports && "reports", profile.canAssignProtocols && "protocols", profile.canSupervise && "supervises"].filter(Boolean).join(", ") || "-"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={(event) => openDrawer(profile, "account", event.currentTarget)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Edit</button>
                    <button type="button" onClick={(event) => openDrawer(profile, "modalities", event.currentTarget)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Modalities</button>
                    <button type="button" disabled={lifecycleMutation.isPending} onClick={() => setConfirmLifecycle(profile)} className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50" style={{ borderColor: "var(--border)" }}>
                      {(profile.userActive ?? profile.active) ? "Deactivate doctor" : "Reactivate doctor"}
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

      {editingProfile && selectedProfile ? createPortal(
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/35" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
          <aside className="flex h-dvh w-full flex-col bg-background shadow-2xl sm:max-w-[620px] sm:border-s" role="dialog" aria-modal="true" aria-labelledby="doctor-drawer-title">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
              <div><h2 id="doctor-drawer-title" className="font-semibold">Manage doctor: {editingProfile.displayName}</h2><p className="text-xs text-muted-foreground">{accountDraft.username}</p></div>
              <button ref={drawerCloseRef} type="button" onClick={closeDrawer} className="rounded-lg border px-3 py-2 text-sm font-semibold">Close</button>
            </header>
            <nav className="flex shrink-0 overflow-x-auto border-b px-2 py-2" role="tablist" aria-label="Doctor management sections">
              {([['account','Account'],['profile','Doctor profile'],['modalities','Modalities'],['security','Security']] as const).map(([key,label]) => <button key={key} type="button" role="tab" aria-selected={drawerSection === key} onClick={() => setDrawerSection(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${drawerSection === key ? 'bg-teal-50 text-teal-800' : 'text-muted-foreground'}`}>{label}</button>)}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {formError ? <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError instanceof Error ? formError.message : "Doctor admin action failed."}</div> : null}
              {adminMessage ? <div role="status" className={`mb-4 rounded-lg border p-3 text-sm ${adminMessage.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{adminMessage.text}</div> : null}
              {drawerSection === "account" ? <section aria-labelledby="account-section-title" className="space-y-4">
                <div><h3 id="account-section-title" className="font-semibold">Account</h3><p className="text-sm text-muted-foreground">Login account active is separate from Doctor profile active.</p></div>
                <label className="grid gap-1 text-sm"><span className="font-medium">Username</span><input value={accountDraft.username} onChange={(event) => setAccountDraft((current) => ({ ...current, username: event.target.value }))} className="rounded-lg border px-3 py-2" /></label>
                <label className="grid gap-1 text-sm"><span className="font-medium">Full name</span><input value={accountDraft.fullName} onChange={(event) => setAccountDraft((current) => ({ ...current, fullName: event.target.value }))} className="rounded-lg border px-3 py-2" /></label>
                <label className="grid gap-1 text-sm"><span className="font-medium">Core role</span><select value={accountDraft.coreRole} onChange={(event) => setAccountDraft((current) => ({ ...current, coreRole: event.target.value as AccountDraft['coreRole'] }))} className="rounded-lg border px-3 py-2"><option value="doctor">Doctor</option><option value="supervisor">Supervisor</option></select></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={accountDraft.active} onChange={(event) => setAccountDraft((current) => ({ ...current, active: event.target.checked }))} /> Login account active</label>
                <button type="button" disabled={!accountDraft.username.trim() || !accountDraft.fullName.trim() || accountMutation.isPending} onClick={() => accountMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{accountMutation.isPending ? "Saving account..." : "Save account"}</button>
              </section> : null}
              {drawerSection === "profile" ? <section aria-labelledby="profile-section-title" className="space-y-4">
                <div><h3 id="profile-section-title" className="font-semibold">Doctor profile</h3><p className="text-sm text-muted-foreground">Doctor profile active controls assignments separately from login access.</p></div>
                <label className="grid gap-1 text-sm"><span className="font-medium">Display name</span><input value={editDraft.displayName} onChange={(event) => setEditDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Display name" className="rounded-lg border px-3 py-2" /></label>
                <label className="grid gap-1 text-sm"><span className="font-medium">Doctor role</span><select value={editDraft.doctorRole} onChange={(event) => setEditDraft((current) => ({ ...current, doctorRole: event.target.value as DoctorProfileRole }))} className="rounded-lg border px-3 py-2">{DOCTOR_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                <div className="grid gap-3 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.active} onChange={(event) => setEditDraft((current) => ({ ...current, active: event.target.checked }))} /> Doctor profile active</label><label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.canFinalizeReports} onChange={(event) => setEditDraft((current) => ({ ...current, canFinalizeReports: event.target.checked }))} /> Can finalize reports</label><label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.canAssignProtocols} onChange={(event) => setEditDraft((current) => ({ ...current, canAssignProtocols: event.target.checked }))} /> Can assign protocols</label><label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.canSupervise} onChange={(event) => setEditDraft((current) => ({ ...current, canSupervise: event.target.checked }))} /> Can supervise</label></div>
                <button type="button" disabled={!editDraft.displayName.trim() || editMutation.isPending} onClick={() => editMutation.mutate()} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{editMutation.isPending ? "Saving profile..." : "Save profile"}</button>
              </section> : null}
              {drawerSection === "modalities" ? <section aria-labelledby="modalities-section-title"><h3 id="modalities-section-title" className="font-semibold">Modality permissions</h3><p className="mt-1 text-sm text-muted-foreground">Toggle Report for every modality this doctor can receive on the Reporting Assignment Board.</p><div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr>{["Modality", "Active", "Protocol", "Report", "Supervise"].map((header) => <th key={header} className="px-3 py-2 text-left text-xs uppercase text-muted-foreground">{header}</th>)}</tr></thead><tbody>{modalityRows.map((row) => <tr key={row.modalityId}><td className="px-3 py-2 font-medium">{row.label}</td>{(["active", "canProtocol", "canReport", "canSupervise"] as const).map((key) => <td key={key} className="px-3 py-2"><input aria-label={`${row.label} ${key}`} type="checkbox" disabled={modalityMutation.isPending} checked={Boolean(row[key])} onChange={(event) => saveModalities({ modalityId: row.modalityId, [key]: event.target.checked })} /></td>)}</tr>)}</tbody></table></div>{modalityMutation.isPending ? <p role="status" className="mt-3 text-sm">Saving modality permissions...</p> : null}</section> : null}
              {drawerSection === "security" ? <section aria-labelledby="security-section-title" className="space-y-4"><div><h3 id="security-section-title" className="font-semibold">Security</h3><p className="text-sm text-muted-foreground">Require password change only prompts at next login; it does not change the current password.</p></div><label className="grid gap-1 text-sm"><span className="font-medium">New temporary password</span><input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="New temporary password" className="rounded-lg border px-3 py-2" /></label><div className="flex flex-wrap gap-2"><button type="button" disabled={!resetPassword || resetPasswordMutation.isPending} onClick={() => resetPasswordMutation.mutate()} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">{resetPasswordMutation.isPending ? "Resetting password..." : "Reset temporary password"}</button><button type="button" disabled={forcePasswordMutation.isPending} onClick={() => forcePasswordMutation.mutate()} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">{forcePasswordMutation.isPending ? "Updating requirement..." : "Require password change"}</button></div></section> : null}
            </div>
          </aside>
        </div>, document.body) : null}
      {confirmLifecycle ? createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" role="presentation"><div role="dialog" aria-modal="true" aria-labelledby="doctor-lifecycle-title" className="w-full max-w-md rounded-xl border bg-background p-5 shadow-2xl"><h2 id="doctor-lifecycle-title" className="font-semibold">{(confirmLifecycle.userActive ?? confirmLifecycle.active) ? "Deactivate doctor" : "Reactivate doctor"}</h2><p className="mt-2 text-sm text-muted-foreground">{(confirmLifecycle.userActive ?? confirmLifecycle.active) ? "This will deactivate the login account and doctor profile. The doctor will no longer be able to sign in or receive assignments." : "This will reactivate the login account and doctor profile."}</p>{lifecycleMutation.error ? <p role="alert" className="mt-3 text-sm text-red-700">{lifecycleMutation.error instanceof Error ? lifecycleMutation.error.message : "Doctor lifecycle update failed."}</p> : null}<div className="mt-5 flex justify-end gap-2"><button type="button" disabled={lifecycleMutation.isPending} onClick={() => setConfirmLifecycle(null)} className="rounded-lg border px-3 py-2 text-sm">Cancel</button><button type="button" disabled={lifecycleMutation.isPending} onClick={() => lifecycleMutation.mutate(confirmLifecycle)} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{lifecycleMutation.isPending ? "Updating doctor..." : "Confirm"}</button></div></div></div>, document.body) : null}
    </div>
  );
}
