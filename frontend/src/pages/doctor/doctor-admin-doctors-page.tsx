import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button, Checkbox, Input } from "@/components/shared";
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
import { getDoctorDisplayName } from "@/lib/user-display-name";
import { useLanguage } from "@/providers/language-provider";
import type { DoctorMe, DoctorModalityPermission, DoctorProfile, DoctorProfileRole, User } from "@/types/api";

type CreateDoctorDraft = {
  username: string;
  email: string;
  fullName: string;
  englishName: string;
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

type AccountDraft = { username: string; email: string; fullName: string; englishName: string; coreRole: "doctor" | "supervisor"; active: boolean };
type DrawerSection = "account" | "profile" | "modalities" | "security";
type CreateDrawerMode = "new" | "link" | null;

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

const MODALITY_PERMISSION_COLUMNS = [
  { key: "active", labelKey: "doctorAdmin.modality.active", descriptionKey: "doctorAdmin.modality.activeDescription" },
  { key: "canProtocol", labelKey: "doctorAdmin.modality.protocol", descriptionKey: "doctorAdmin.modality.protocolDescription" },
  { key: "canReport", labelKey: "doctorAdmin.modality.report", descriptionKey: "doctorAdmin.modality.reportDescription" },
  { key: "canSupervise", labelKey: "doctorAdmin.modality.supervise", descriptionKey: "doctorAdmin.modality.superviseDescription" },
] as const;

const CREATE_PROFILE_PERMISSIONS = [
  { key: "doctorProfileActive", labelKey: "doctorAdmin.profile.active", descriptionKey: "doctorAdmin.profile.activeDescription" },
  { key: "canFinalizeReports", labelKey: "doctorAdmin.profile.canFinalizeReports", descriptionKey: "doctorAdmin.profile.canFinalizeReportsDescription" },
  { key: "canAssignProtocols", labelKey: "doctorAdmin.profile.canAssignProtocols", descriptionKey: "doctorAdmin.profile.canAssignProtocolsDescription" },
  { key: "canSupervise", labelKey: "doctorAdmin.profile.canSupervise", descriptionKey: "doctorAdmin.profile.canSuperviseDescription" },
] as const;

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
  email: "",
  fullName: "",
  englishName: "",
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
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [importFileBase64, setImportFileBase64] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importFormat, setImportFormat] = useState<"csv" | "xlsx">("csv");
  const [importInspect, setImportInspect] = useState<{ format: "csv" | "xlsx"; columns: string[]; rowCount: number; missingColumns: string[] } | null>(null);
  const [importPreview, setImportPreview] = useState<DoctorImportPreview | null>(null);
  const [importResult, setImportResult] = useState<DoctorImportResult | null>(null);
  const [createDrawerMode, setCreateDrawerMode] = useState<CreateDrawerMode>(null);
  const [createDoctorDraft, setCreateDoctorDraft] = useState<CreateDoctorDraft>(DEFAULT_CREATE_DOCTOR_DRAFT);
  const [createDoctorEmailEdited, setCreateDoctorEmailEdited] = useState(false);
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
  const [accountDraft, setAccountDraft] = useState<AccountDraft>({ username: "", email: "", fullName: "", englishName: "", coreRole: "doctor", active: true });
  const [drawerSection, setDrawerSection] = useState<DrawerSection>("account");
  const [confirmLifecycle, setConfirmLifecycle] = useState<DoctorProfile | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const createDrawerCloseRef = useRef<HTMLButtonElement>(null);
  const createDrawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [dismissedLinkUserId, setDismissedLinkUserId] = useState<number | null>(null);
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
  const [linkUserSelectionChangedKey, setLinkUserSelectionChangedKey] = useState<string | null>(null);

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
  const requestedLinkUserId = (() => {
    const value = new URLSearchParams(window.location.search).get("linkUserId");
    const userId = Number(value);
    return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
  })();
  const requestedLinkUser = requestedLinkUserId
    ? usersById.get(requestedLinkUserId)
    : undefined;
  const preselectedLinkUser =
    requestedLinkUser && !profilesByUserId.has(requestedLinkUser.id)
      ? requestedLinkUser
      : undefined;
  const linkSelectionKey = preselectedLinkUser ? `url:${preselectedLinkUser.id}` : "manual";
  const linkDraft =
    preselectedLinkUser && linkUserSelectionChangedKey !== linkSelectionKey
      ? {
          ...draft,
          userId: String(preselectedLinkUser.id),
          displayName: preselectedLinkUser.fullName,
        }
      : draft;
  const autoLinkDrawerOpen = Boolean(
    requestedLinkUserId &&
      profilesQuery.isSuccess &&
      usersQuery.isSuccess &&
      preselectedLinkUser &&
      requestedLinkUserId !== dismissedLinkUserId,
  );
  const activeCreateDrawerMode = createDrawerMode ?? (autoLinkDrawerOpen ? "link" : null);
  const visibleAdminMessage = autoLinkDrawerOpen ? null : adminMessage;
  const dismissAutoLinkDrawer = useCallback(() => {
    if (!autoLinkDrawerOpen || requestedLinkUserId === null) return;
    setDismissedLinkUserId(requestedLinkUserId);
    setAdminMessage(null);
  }, [autoLinkDrawerOpen, requestedLinkUserId]);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const editingProfile = profiles.find((profile) => profile.id === editingProfileId) ?? null;

  const invalidateProfiles = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor", "profiles"] });
    await queryClient.invalidateQueries({ queryKey: ["doctor", "me"] });
  };

  const createMutation = useMutation({
    mutationFn: () => createDoctorProfileForAdmin({
      userId: Number(linkDraft.userId),
      displayName: linkDraft.displayName,
      doctorRole: linkDraft.doctorRole,
      active: linkDraft.active,
      canFinalizeReports: linkDraft.canFinalizeReports,
      canAssignProtocols: linkDraft.canAssignProtocols,
      canSupervise: linkDraft.canSupervise,
    }),
    onSuccess: async (profile) => {
      dismissAutoLinkDrawer();
      setSelectedProfileId(profile.id);
      setAdminMessage({ tone: "success", text: "Doctor profile created." });
      setCreateDrawerMode(null);
      setDraft({ userId: "", displayName: "", doctorRole: "consultant", active: true, canFinalizeReports: true, canAssignProtocols: true, canSupervise: false });
      setLinkUserSelectionChangedKey(null);
      window.setTimeout(() => createDrawerTriggerRef.current?.focus(), 0);
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
      dismissAutoLinkDrawer();
      setSelectedProfileId(result.profile.id);
      setCreateDoctorDraft(DEFAULT_CREATE_DOCTOR_DRAFT);
      setCreateDoctorEmailEdited(false);
      setCreateDoctorModalities({});
      setAdminMessage({ tone: "success", text: "Doctor user and profile created." });
      setCreateDrawerMode(null);
      window.setTimeout(() => createDrawerTriggerRef.current?.focus(), 0);
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
      email: profile.email ?? linkedUser?.email ?? "",
      fullName: profile.fullName ?? linkedUser?.fullName ?? "",
      englishName: profile.englishName ?? linkedUser?.englishName ?? "",
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

  const openCreateDrawer = (mode: Exclude<CreateDrawerMode, null>, trigger: HTMLButtonElement) => {
    createDrawerTriggerRef.current = trigger;
    createDoctorMutation.reset();
    createMutation.reset();
    setAdminMessage(null);
    setCreateDrawerMode(mode);
  };

  const closeCreateDrawer = () => {
    dismissAutoLinkDrawer();
    setCreateDrawerMode(null);
    window.setTimeout(() => createDrawerTriggerRef.current?.focus(), 0);
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

  useEffect(() => {
    if (!activeCreateDrawerMode) return;
    const unlockBodyScroll = lockBodyScroll();
    createDrawerCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissAutoLinkDrawer();
        setCreateDrawerMode(null);
        window.setTimeout(() => createDrawerTriggerRef.current?.focus(), 0);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = createDrawerCloseRef.current?.closest('[role="dialog"]');
      const focusable = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { unlockBodyScroll(); document.removeEventListener("keydown", onKeyDown); };
  }, [activeCreateDrawerMode, dismissAutoLinkDrawer]);

  const createFormError = createDoctorMutation.error || createMutation.error;
  const formError = updateMutation.error || editMutation.error || accountMutation.error || modalityMutation.error || resetPasswordMutation.error || forcePasswordMutation.error || lifecycleMutation.error;

  if (!me.canManageDoctorProfiles) {
    return <div className="rounded-lg border p-6 text-sm" style={{ borderColor: "var(--border)" }}>Doctor profile management is not available for this user.</div>;
  }

  return (
    <div className="doctor-directory-page space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>Doctor Portal Admin</p>
          <h2 className="mt-1 text-2xl font-semibold text-foreground">Doctors</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage doctor accounts, profiles and clinical permissions.</p>
        </div>
        <Button ref={createDrawerTriggerRef} type="button" onClick={(event) => openCreateDrawer("new", event.currentTarget)}>
          <Plus aria-hidden="true" className="me-2 inline h-4 w-4" />Create doctor
        </Button>
      </div>

      {formError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {formError instanceof Error ? formError.message : "Doctor admin action failed."}
        </div>
      )}
      {visibleAdminMessage && (
        <div className={visibleAdminMessage.tone === "success" ? "rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700" : "rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"}>
          {visibleAdminMessage.text}
        </div>
      )}

      <section className="rounded-lg border p-4" style={{ backgroundColor: "var(--card)", borderColor: "var(--border)" }}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-semibold">Doctor directory</h3>
            <p className="mt-1 text-sm text-muted-foreground">Doctor accounts, clinical profiles and current permissions.</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
          <table className="min-w-full divide-y divide-border text-sm" style={{ borderColor: "var(--border)" }}>
            <thead className="bg-muted">
              <tr>{["Name", "Username", "Core role", "User account", "Doctor role", "Profile", "Permissions", "Actions"].map((header) => <th key={header} className="px-3 py-2 text-start text-xs font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border" style={{ borderColor: "var(--border)" }}>
              {profiles.map((profile) => (
                <tr key={profile.id}>
                  <td className="px-3 py-2 font-medium">{getDoctorDisplayName(profile, language)}</td>
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
                      <Button variant="secondary" size="sm" type="button" onClick={(event) => openDrawer(profile, "account", event.currentTarget)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Edit</Button>
                      <Button variant="secondary" size="sm" type="button" onClick={(event) => openDrawer(profile, "modalities", event.currentTarget)} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>Modalities</Button>
                      <Button variant="secondary" size="sm" type="button" disabled={lifecycleMutation.isPending} onClick={() => setConfirmLifecycle(profile)} className="rounded-lg border px-2 py-1 text-xs disabled:opacity-50" style={{ borderColor: "var(--border)" }}>
                        {(profile.userActive ?? profile.active) ? "Deactivate doctor" : "Reactivate doctor"}
                      </Button>
                      <Button variant="secondary" size="sm" type="button" onClick={() => updateMutation.mutate({ profileId: profile.id, patch: { canSupervise: !profile.canSupervise } })} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: "var(--border)" }}>
                        {profile.canSupervise ? t("doctorAdmin.quickAction.disableClinicalSupervision") : t("doctorAdmin.quickAction.enableClinicalSupervision")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            <Button variant="secondary" size="sm" type="button" disabled={!importFileBase64 || previewMutation.isPending} onClick={() => previewMutation.mutate(importPayload())} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}>Preview import</Button>
            <Button variant="primary" size="sm" type="button" disabled={!importPreview?.canConfirm || confirmMutation.isPending} onClick={() => confirmMutation.mutate(importPayload())} className="rounded-lg px-3 py-2 text-sm font-semibold">Confirm import</Button>
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

      {activeCreateDrawerMode ? createPortal(
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/35" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeCreateDrawer(); }}>
          <aside data-testid="create-doctor-drawer" className="doctor-directory-page flex h-dvh w-full flex-col bg-background shadow-2xl sm:max-w-[620px] sm:border-s" role="dialog" aria-modal="true" aria-labelledby="create-doctor-title" aria-describedby="create-doctor-description">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h2 id="create-doctor-title" className="font-semibold">Create doctor</h2>
                <p id="create-doctor-description" className="text-sm text-muted-foreground">Create a RISpro account and clinical Doctor Portal profile.</p>
              </div>
              <Button ref={createDrawerCloseRef} type="button" variant="secondary" size="sm" onClick={closeCreateDrawer}>Close</Button>
            </header>
            <div className="flex shrink-0 overflow-x-auto border-b border-border px-2 py-2" role="group" aria-label="Doctor creation workflow">
              <button type="button" aria-pressed={activeCreateDrawerMode === "new"} onClick={() => { createDoctorMutation.reset(); createMutation.reset(); setCreateDrawerMode("new"); }} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${activeCreateDrawerMode === "new" ? "bg-accent/10 text-accent" : "text-muted-foreground"}`}>New RISpro account</button>
              <button type="button" aria-pressed={activeCreateDrawerMode === "link"} onClick={() => { createDoctorMutation.reset(); createMutation.reset(); setCreateDrawerMode("link"); }} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${activeCreateDrawerMode === "link" ? "bg-accent/10 text-accent" : "text-muted-foreground"}`}>Link existing RISpro user</button>
            </div>
            <div data-testid="create-doctor-drawer-body" className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-5">
              {createFormError ? <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{createFormError instanceof Error ? createFormError.message : "Doctor admin action failed."}</div> : null}
              {activeCreateDrawerMode === "new" ? <>
                <section aria-labelledby="create-account-section-title" className="space-y-3">
                  <div>
                    <h3 id="create-account-section-title" className="font-semibold">Account</h3>
                    <p className="text-sm text-muted-foreground">New credentials require a password change at first login.</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Username</span>
                      <Input autoComplete="username" value={createDoctorDraft.username} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, username: event.target.value, email: createDoctorEmailEdited ? current.email : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.target.value.trim()) ? event.target.value.trim() : "" }))} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">Email</span>
                      <Input type="email" autoComplete="email" value={createDoctorDraft.email} onChange={(event) => { setCreateDoctorEmailEdited(true); setCreateDoctorDraft((current) => ({ ...current, email: event.target.value })); }} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">{t("settings.arabicName")}</span>
                      <Input value={createDoctorDraft.fullName} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, fullName: event.target.value }))} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="font-medium">{t("settings.englishName")}</span>
                      <Input value={createDoctorDraft.englishName} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, englishName: event.target.value }))} />
                    </label>
                    <label className="grid gap-1 text-sm sm:col-span-2">
                      <span className="font-medium">Temporary password</span>
                      <Input type="password" autoComplete="new-password" value={createDoctorDraft.temporaryPassword} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, temporaryPassword: event.target.value }))} />
                    </label>
                  </div>
                </section>

                <section aria-labelledby="create-core-role-section-title" className="space-y-3 border-t border-border pt-4">
                  <div>
                    <h3 id="create-core-role-section-title" className="font-semibold">Account role</h3>
                    <p className="text-sm text-muted-foreground">RISpro security and administrative role.</p>
                  </div>
                  <div className="grid gap-1 text-sm">
                    <label htmlFor="create-core-role" className="font-medium">{t("doctorAdmin.coreRole.label")}</label>
                    <select id="create-core-role" aria-describedby="create-core-role-help" value={createDoctorDraft.coreRole} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, coreRole: event.target.value as "doctor" | "supervisor" }))} className="input-premium h-[var(--control-height-md)]">
                      <option value="doctor">{t("doctorAdmin.coreRole.doctor")}</option>
                      <option value="supervisor">{t("doctorAdmin.coreRole.supervisor")}</option>
                    </select>
                    <p id="create-core-role-help" className="text-xs text-muted-foreground">{t("doctorAdmin.coreRole.doctor")}: {t("doctorAdmin.coreRole.doctorDescription")} {t("doctorAdmin.coreRole.supervisor")}: {t("doctorAdmin.coreRole.supervisorDescription")}</p>
                  </div>
                </section>

                <section aria-labelledby="create-profile-section-title" className="space-y-3 border-t border-border pt-4">
                  <div>
                    <h3 id="create-profile-section-title" className="font-semibold">Clinical profile</h3>
                    <p className="text-sm text-muted-foreground">Doctor role is a clinical grade, separate from the RISpro account role.</p>
                  </div>
                  <div className="grid gap-1 text-sm">
                    <label htmlFor="create-doctor-role" className="font-medium">{t("doctorAdmin.profile.doctorRole")}</label>
                    <select id="create-doctor-role" aria-describedby="create-doctor-role-help" value={createDoctorDraft.doctorRole} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, doctorRole: event.target.value as DoctorProfileRole }))} className="input-premium h-[var(--control-height-md)]">
                      {DOCTOR_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                    </select>
                    <span id="create-doctor-role-help" className="text-xs text-muted-foreground">{t("doctorAdmin.profile.doctorRoleDescription")}</span>
                  </div>
                  <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Checkbox checked={createDoctorDraft.userActive} disabled aria-label="User active" />User active
                    </label>
                    <p className="ms-6 mt-1 text-xs text-muted-foreground">New RISpro accounts are active by default.</p>
                  </div>
                  <div className="grid gap-2">
                    {CREATE_PROFILE_PERMISSIONS.map((permission) => (
                      <div key={permission.key} className="flex items-start gap-3 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                        <Checkbox id={`create-${permission.key}`} aria-describedby={`create-${permission.key}-help`} checked={createDoctorDraft[permission.key]} onChange={(event) => setCreateDoctorDraft((current) => ({ ...current, [permission.key]: event.target.checked }))} />
                        <div className="min-w-0">
                          <label htmlFor={`create-${permission.key}`} className="text-sm font-medium">{t(permission.labelKey)}</label>
                          <p id={`create-${permission.key}-help`} className="mt-1 text-xs text-muted-foreground">{t(permission.descriptionKey)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section aria-labelledby="create-modality-section-title" className="space-y-3 border-t border-border pt-4">
                  <div>
                    <h3 id="create-modality-section-title" className="font-semibold">Modality permissions</h3>
                    <div className="mt-2 grid gap-x-3 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                      {MODALITY_PERMISSION_COLUMNS.map((column) => <p key={column.key}><span className="font-medium">{t(column.labelKey)}:</span> {t(column.descriptionKey)}</p>)}
                    </div>
                  </div>
                  {(lookupsQuery.data?.modalities ?? []).length > 0 ? <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
                    <table className="min-w-[440px] text-sm">
                      <thead><tr>
                        <th scope="col" className="sticky left-0 z-20 border-r border-border bg-card px-3 py-2 text-start text-xs font-semibold uppercase text-muted-foreground">{t("doctorAdmin.modality.label")}</th>
                        {MODALITY_PERMISSION_COLUMNS.map((column) => <th key={column.key} scope="col" className="px-3 py-2 text-center text-xs font-semibold uppercase text-muted-foreground">{t(column.labelKey)}</th>)}
                      </tr></thead>
                      <tbody className="divide-y divide-border" style={{ borderColor: "var(--border)" }}>
                        {(lookupsQuery.data?.modalities ?? []).map((modality) => {
                          const permission = createDoctorModalities[modality.id] ?? { active: false, canProtocol: false, canReport: false, canSupervise: false };
                          const label = modality.nameEn || modality.nameAr || modality.code || String(modality.id);
                          return <tr key={modality.id}>
                            <th scope="row" className="sticky left-0 z-10 border-r border-border bg-background px-3 py-2 text-start font-medium">{label}</th>
                            {MODALITY_PERMISSION_COLUMNS.map((column) => <td key={column.key} className="px-3 py-2 text-center">
                              <Checkbox aria-label={`${label} ${t(column.labelKey)}`} checked={permission[column.key]} onChange={(event) => setCreateDoctorModalities((current) => ({ ...current, [modality.id]: { ...permission, [column.key]: event.target.checked } }))} />
                            </td>)}
                          </tr>;
                        })}
                      </tbody>
                    </table>
                  </div> : lookupsQuery.isLoading ? <p role="status" className="text-sm text-muted-foreground">Loading modalities…</p> : null}
                </section>
              </> : <section aria-labelledby="link-user-section-title" className="space-y-4">
                <div>
                  <h3 id="link-user-section-title" className="font-semibold">Link existing RISpro user to doctor profile</h3>
                  <p className="text-sm text-muted-foreground">Uses the selected account’s existing username, password, core role, and active state. No new login credentials are created.</p>
                </div>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Select user</span>
                  <select aria-label="Select user" value={linkDraft.userId} onChange={(event) => {
                    const user = usersById.get(Number(event.target.value));
                    setLinkUserSelectionChangedKey(linkSelectionKey);
                    setDraft((current) => ({ ...current, userId: event.target.value, displayName: user?.fullName ?? current.displayName }));
                  }} className="input-premium h-[var(--control-height-md)]">
                    <option value="">Select user</option>
                    {(usersQuery.data?.users ?? []).filter((user) => !profilesByUserId.has(user.id)).map((user) => (
                      <option key={user.id} value={user.id}>{user.fullName} ({user.username}) - {user.role} - {user.isActive ? "user active" : "user inactive"}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Display name</span>
                  <Input value={linkDraft.displayName} onChange={(event) => {
                    setLinkUserSelectionChangedKey(linkSelectionKey);
                    setDraft((current) => ({ ...current, displayName: event.target.value }));
                  }} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">{t("doctorAdmin.profile.doctorRole")}</span>
                  <select aria-label={t("doctorAdmin.profile.doctorRole")} value={linkDraft.doctorRole} onChange={(event) => {
                    setLinkUserSelectionChangedKey(linkSelectionKey);
                    setDraft((current) => ({ ...current, doctorRole: event.target.value as DoctorProfileRole }));
                  }} className="input-premium h-[var(--control-height-md)]">
                    {DOCTOR_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
                  </select>
                </label>
              </section>}
            </div>
            <footer className="flex shrink-0 justify-between gap-3 border-t bg-background px-4 py-3 sm:px-5">
              <Button type="button" variant="secondary" onClick={closeCreateDrawer}>Cancel</Button>
              {activeCreateDrawerMode === "new" ? <Button type="button" disabled={!createDoctorDraft.username || !createDoctorDraft.fullName || !createDoctorDraft.temporaryPassword || createDoctorMutation.isPending} onClick={() => createDoctorMutation.mutate()}>{createDoctorMutation.isPending ? "Creating doctor…" : "Create doctor"}</Button> : <Button type="button" disabled={!linkDraft.userId || !linkDraft.displayName || createMutation.isPending} onClick={() => createMutation.mutate()}>{createMutation.isPending ? "Creating profile…" : "Create profile"}</Button>}
            </footer>
          </aside>
        </div>, document.body) : null}

      {editingProfile && selectedProfile ? createPortal(
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/35" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
          <aside className="doctor-directory-page flex h-dvh w-full flex-col bg-background shadow-2xl sm:max-w-[620px] sm:border-s" role="dialog" aria-modal="true" aria-labelledby="doctor-drawer-title">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div><h2 id="doctor-drawer-title" className="font-semibold">Manage doctor: {getDoctorDisplayName(editingProfile, language)}</h2><p className="text-xs text-muted-foreground">{accountDraft.username}</p></div>
              <Button variant="secondary" size="sm" ref={drawerCloseRef} type="button" onClick={closeDrawer} className="rounded-lg border px-3 py-2 text-sm font-semibold">Close</Button>
            </header>
            <nav className="flex shrink-0 overflow-x-auto border-b border-border px-2 py-2" role="tablist" aria-label="Doctor management sections">
              {([['account','Account'],['profile','Doctor profile'],['modalities','Modalities'],['security','Security']] as const).map(([key,label]) => <button key={key} type="button" role="tab" aria-selected={drawerSection === key} onClick={() => setDrawerSection(key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${drawerSection === key ? 'bg-accent/10 text-accent' : 'text-muted-foreground'}`}>{label}</button>)}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {formError ? <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{formError instanceof Error ? formError.message : "Doctor admin action failed."}</div> : null}
              {visibleAdminMessage ? <div role="status" className={`mb-4 rounded-lg border p-3 text-sm ${visibleAdminMessage.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>{visibleAdminMessage.text}</div> : null}
              {drawerSection === "account" ? <section aria-labelledby="account-section-title" className="space-y-4">
                <div><h3 id="account-section-title" className="font-semibold">Account</h3><p className="text-sm text-muted-foreground">Login account active is separate from Doctor profile active.</p></div>
                <label className="grid gap-1 text-sm"><span className="font-medium">Username</span><Input value={accountDraft.username} onChange={(event) => setAccountDraft((current) => ({ ...current, username: event.target.value }))} className="rounded-lg border px-3 py-2" /></label>
                <label className="grid gap-1 text-sm"><span className="font-medium">Email</span><Input aria-label="Email" value={accountDraft.email} onChange={(event) => setAccountDraft((current) => ({ ...current, email: event.target.value }))} className="rounded-lg border px-3 py-2" /></label>
                <label className="grid gap-1 text-sm"><span className="font-medium">{t("settings.arabicName")}</span><Input aria-label={t("settings.arabicName")} value={accountDraft.fullName} onChange={(event) => setAccountDraft((current) => ({ ...current, fullName: event.target.value }))} className="rounded-lg border px-3 py-2" /></label>
                <label className="grid gap-1 text-sm"><span className="font-medium">{t("settings.englishName")}</span><Input aria-label={t("settings.englishName")} value={accountDraft.englishName} onChange={(event) => setAccountDraft((current) => ({ ...current, englishName: event.target.value }))} className="rounded-lg border px-3 py-2" /></label>
                <div className="grid gap-1 text-sm"><label htmlFor="edit-core-role" className="font-medium">{t("doctorAdmin.coreRole.label")}</label><select id="edit-core-role" aria-describedby="edit-core-role-help" value={accountDraft.coreRole} onChange={(event) => setAccountDraft((current) => ({ ...current, coreRole: event.target.value as AccountDraft['coreRole'] }))} className="input-premium rounded-lg border px-3 py-2"><option value="doctor">{t("doctorAdmin.coreRole.doctor")}</option><option value="supervisor">{t("doctorAdmin.coreRole.supervisor")}</option></select><div id="edit-core-role-help" className="text-xs text-muted-foreground"><span className="block">{t("doctorAdmin.coreRole.doctor")}: {t("doctorAdmin.coreRole.doctorDescription")}</span><span className="block">{t("doctorAdmin.coreRole.supervisor")}: {t("doctorAdmin.coreRole.supervisorDescription")}</span></div></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={accountDraft.active} onChange={(event) => setAccountDraft((current) => ({ ...current, active: event.target.checked }))} /> Login account active</label>
                <Button variant="primary" size="sm" type="button" disabled={!accountDraft.username.trim() || !accountDraft.fullName.trim() || accountMutation.isPending} onClick={() => accountMutation.mutate()} className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">{accountMutation.isPending ? "Saving account..." : "Save account"}</Button>
              </section> : null}
              {drawerSection === "profile" ? <section aria-labelledby="profile-section-title" className="space-y-4">
                <div><h3 id="profile-section-title" className="font-semibold">Doctor profile</h3><p className="text-sm text-muted-foreground">Doctor Portal access and login account status are managed separately.</p></div>
                <div className="grid gap-1 text-sm"><label htmlFor="edit-doctor-role" className="font-medium">{t("doctorAdmin.profile.doctorRole")}</label><select id="edit-doctor-role" aria-describedby="edit-doctor-role-help" value={editDraft.doctorRole} onChange={(event) => setEditDraft((current) => ({ ...current, doctorRole: event.target.value as DoctorProfileRole }))} className="input-premium rounded-lg border px-3 py-2">{DOCTOR_ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select><span id="edit-doctor-role-help" className="text-xs text-muted-foreground">{t("doctorAdmin.profile.doctorRoleDescription")}</span></div>
                <div className="grid gap-3 text-sm">
                  <div><label className="flex items-center gap-2"><input type="checkbox" aria-describedby="edit-profile-active-help" checked={editDraft.active} onChange={(event) => setEditDraft((current) => ({ ...current, active: event.target.checked }))} /> {t("doctorAdmin.profile.active")}</label><p id="edit-profile-active-help" className="mt-1 text-xs text-muted-foreground">{t("doctorAdmin.profile.activeDescription")}</p></div>
                  <div><label className="flex items-center gap-2"><input type="checkbox" aria-describedby="edit-finalize-reports-help" checked={editDraft.canFinalizeReports} onChange={(event) => setEditDraft((current) => ({ ...current, canFinalizeReports: event.target.checked }))} /> {t("doctorAdmin.profile.canFinalizeReports")}</label><p id="edit-finalize-reports-help" className="mt-1 text-xs text-muted-foreground">{t("doctorAdmin.profile.canFinalizeReportsDescription")}</p></div>
                  <div><label className="flex items-center gap-2"><input type="checkbox" aria-describedby="edit-assign-protocols-help" checked={editDraft.canAssignProtocols} onChange={(event) => setEditDraft((current) => ({ ...current, canAssignProtocols: event.target.checked }))} /> {t("doctorAdmin.profile.canAssignProtocols")}</label><p id="edit-assign-protocols-help" className="mt-1 text-xs text-muted-foreground">{t("doctorAdmin.profile.canAssignProtocolsDescription")}</p></div>
                  <div><label className="flex items-center gap-2"><input type="checkbox" aria-describedby="edit-can-supervise-help" checked={editDraft.canSupervise} onChange={(event) => setEditDraft((current) => ({ ...current, canSupervise: event.target.checked }))} /> {t("doctorAdmin.profile.canSupervise")}</label><p id="edit-can-supervise-help" className="mt-1 text-xs text-muted-foreground">{t("doctorAdmin.profile.canSuperviseDescription")}</p></div>
                </div>
                <Button variant="primary" size="sm" type="button" disabled={editMutation.isPending} onClick={() => editMutation.mutate()} className="rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50">{editMutation.isPending ? "Saving profile..." : "Save profile"}</Button>
              </section> : null}
              {drawerSection === "modalities" ? <section aria-labelledby="modalities-section-title"><h3 id="modalities-section-title" className="font-semibold">Modality permissions</h3><p className="mt-1 text-sm text-muted-foreground">Toggle Report for every modality this doctor can receive on the Reporting Assignment Board.</p><div className="mt-3 overflow-x-auto"><table className="min-w-full text-sm"><thead><tr><th className="px-3 py-2 text-start text-xs uppercase text-muted-foreground">{t("doctorAdmin.modality.label")}</th>{MODALITY_PERMISSION_COLUMNS.map((column) => <th key={column.key} scope="col" className="px-3 py-2 text-start align-top"><span className="block text-xs font-semibold uppercase text-muted-foreground">{t(column.labelKey)}</span><span className="mt-1 block max-w-32 text-xs font-normal normal-case leading-snug text-muted-foreground">{t(column.descriptionKey)}</span></th>)}</tr></thead><tbody>{modalityRows.map((row) => <tr key={row.modalityId}><td className="px-3 py-2 font-medium">{row.label}</td>{(["active", "canProtocol", "canReport", "canSupervise"] as const).map((key) => <td key={key} className="px-3 py-2"><input aria-label={`${row.label} ${key}`} type="checkbox" disabled={modalityMutation.isPending} checked={Boolean(row[key])} onChange={(event) => saveModalities({ modalityId: row.modalityId, [key]: event.target.checked })} /></td>)}</tr>)}</tbody></table></div>{modalityMutation.isPending ? <p role="status" className="mt-3 text-sm">Saving modality permissions...</p> : null}</section> : null}
              {drawerSection === "security" ? <section aria-labelledby="security-section-title" className="space-y-4"><div><h3 id="security-section-title" className="font-semibold">Security</h3><p className="text-sm text-muted-foreground">Require password change only prompts at next login; it does not change the current password.</p></div><label className="grid gap-1 text-sm"><span className="font-medium">New temporary password</span><Input type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="New temporary password" className="rounded-lg border px-3 py-2" /></label><div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" type="button" disabled={!resetPassword || resetPasswordMutation.isPending} onClick={() => resetPasswordMutation.mutate()} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">{resetPasswordMutation.isPending ? "Resetting password..." : "Reset temporary password"}</Button><Button variant="secondary" size="sm" type="button" disabled={forcePasswordMutation.isPending} onClick={() => forcePasswordMutation.mutate()} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">{forcePasswordMutation.isPending ? "Updating requirement..." : "Require password change"}</Button></div></section> : null}
            </div>
          </aside>
        </div>, document.body) : null}
      {confirmLifecycle ? createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4" role="presentation"><div role="dialog" aria-modal="true" aria-labelledby="doctor-lifecycle-title" className="w-full max-w-md rounded-xl border bg-background p-5 shadow-2xl"><h2 id="doctor-lifecycle-title" className="font-semibold">{(confirmLifecycle.userActive ?? confirmLifecycle.active) ? "Deactivate doctor" : "Reactivate doctor"}</h2><p className="mt-2 text-sm text-muted-foreground">{(confirmLifecycle.userActive ?? confirmLifecycle.active) ? "This will deactivate the login account and doctor profile. The doctor will no longer be able to sign in or receive assignments." : "This will reactivate the login account and doctor profile."}</p>{lifecycleMutation.error ? <p role="alert" className="mt-3 text-sm text-red-700">{lifecycleMutation.error instanceof Error ? lifecycleMutation.error.message : "Doctor lifecycle update failed."}</p> : null}<div className="mt-5 flex justify-end gap-2"><Button variant="secondary" size="sm" type="button" disabled={lifecycleMutation.isPending} onClick={() => setConfirmLifecycle(null)} className="rounded-lg border px-3 py-2 text-sm">Cancel</Button><button type="button" disabled={lifecycleMutation.isPending} onClick={() => lifecycleMutation.mutate(confirmLifecycle)} className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{lifecycleMutation.isPending ? "Updating doctor..." : "Confirm"}</button></div></div></div>, document.body) : null}
    </div>
  );
}
