import { useEffect, useState, useRef, useImperativeHandle, forwardRef, useMemo, type ChangeEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  fetchUsers,
  fetchDoctorProfilesForAdmin,
  fetchAuditEntries,
  fetchExamTypes,
  fetchModalitiesSettings,
  fetchNameDictionary,
  fetchSettings,
  fetchPageVisibilityMatrix,
  deleteUser,
  createUser,
  updateUserPassword,
  exportAuditCSV,
  deleteNameDictionaryEntry,
  importNameDictionary,
  upsertNameDictionaryEntry,
  createModality,
  deactivateModality,
  updateModality,
  deleteModality,
  createExamType,
  updateExamType,
  deleteExamType,
  hardDeleteExamType,
  applyCatalogWorkbookImport,
  exportCatalogWorkbook,
  previewCatalogWorkbookImport,
  saveSettings,
  fetchSchedulingEngineConfig,
  saveSchedulingEngineConfig,
  adminBulkDeleteDocuments,
  adminMoveDocumentsToStorage,
  adminTestDocumentStorageConnectivity,
  previewPatientImport,
  inspectPatientImportWorkbook,
  fetchPatientImportBatch,
  fetchPatientImportRows,
  selectPatientImportRows,
  confirmPatientImportBatch,
  savePageVisibilityMatrix,
} from "@/lib/api-hooks";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { formatDateTimeLy } from "@/lib/date-format";
import { chooseLocalized, type TranslationKey } from "@/lib/i18n";
import { scanAppointmentRequest } from "@/lib/naps2-webscan";
import { useLanguage } from "@/providers/language-provider";
import { Button } from "@/components/shared/Button";
import { Card } from "@/components/shared/Card";
import DicomGatewaySettingsSection from "./dicom-gateway-section";
import DicomDevicesSection from "./dicom-devices-section";
import DicomMonitoringSection from "./dicom-monitoring-section";
import OrthancMwlSection from "./orthanc-mwl-section";
import SanteWorklistSection from "./sante-worklist-section";
import PacsSettingsSection from "./pacs-settings-section";
import AppointmentSlipSettingsSection from "./appointment-slip-settings-section";
import PatientQrSettingsSection from "./patient-qr-settings-section";
import SonicDicomReportsSection from "./sonicdicom-reports-section";
import type {
  User,
  DoctorProfile,
  SchedulingEngineConfig,
  PatientImportBatch,
  PatientImportStagingRow
} from "@/types/api";
import {
  DEFAULT_PAGE_VISIBILITY_MATRIX,
  PAGE_VISIBILITY_ROLES,
  PAGE_VISIBILITY_ROUTE_KEYS,
  normalizePageVisibilityMatrix,
  type PageVisibilityMatrix,
  type PageVisibilityRouteKey
} from "@/lib/page-visibility";

// ---------------------------------------------------------------------------
// Friendly label maps for scheduling config enums
// ---------------------------------------------------------------------------

const RULE_TYPE_LABELS: Record<string, string> = {
  specific_date: "تاريخ محدد",
  date_range: "نطاق تاريخ",
  yearly_recurrence: "تكرار سنوي",
  weekly_recurrence: "تكرار أسبوعي"
};

const EFFECT_MODE_LABELS: Record<string, string> = {
  restriction_overridable: "مقيد ما لم يوافق المشرف",
  hard_restriction: "تقييد صارم"
};

const CASE_CATEGORY_LABELS: Record<string, string> = {
  oncology: "أورام",
  non_oncology: "غير أورام"
};

function invalidateModalityDerivedAppointmentCaches(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["lookups"] });
  queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
  queryClient.invalidateQueries({ queryKey: ["v2-availability"] });
  queryClient.invalidateQueries({ queryKey: ["v2-bookings"] });
  queryClient.invalidateQueries({ queryKey: ["print-appointments"] });
  queryClient.invalidateQueries({ queryKey: ["print-appointment"] });
  queryClient.invalidateQueries({ queryKey: ["registrations"] });
  queryClient.invalidateQueries({ queryKey: ["calendar"] });
  queryClient.invalidateQueries({ queryKey: ["queue"] });
}

const WEEKDAY_LABELS: Record<string, string> = {
  "0": "الأحد",
  "1": "الاثنين",
  "2": "الثلاثاء",
  "3": "الأربعاء",
  "4": "الخميس",
  "5": "الجمعة",
  "6": "السبت"
};

const SECTION_HELPERS: Record<string, string> = {
  categoryLimits: "اضبط الحد اليومي لحالات الأورام وغير الأورام.",
  blockedRules: "احجب التواريخ الكاملة أو نطاقات التواريخ لجهاز معين.",
  examRules: "الفحوصات المحددة هي التي تحجبها هذه القاعدة أو تقيدها.",
  specialQuotas: "أضف عدداً قليلاً من الخانات الإضافية لأنواع فحص محددة.",
  specialReasons: "الأسباب التي يمكن للموظفين اختيارها عند استخدام حصة خاصة.",
  identifierTypes: "أنواع هوية إضافية للمريض متاحة أثناء التسجيل."
};

const SECTION_TITLES: Record<string, string> = {
  categoryLimits: "الحدود اليومية للفئات",
  blockedRules: "التواريخ المحجوبة",
  examRules: "قواعد تقييد الفحص",
  specialQuotas: "الحصص الخاصة",
  specialReasons: "رموز الأسباب الخاصة",
  identifierTypes: "أنواع هوية المريض"
};

const ACTION_LABELS = {
  add: {
    categoryLimits: "إضافة حد",
    blockedRules: "إضافة قاعدة",
    examRules: "إضافة قاعدة",
    specialQuotas: "إضافة حصة",
    specialReasons: "إضافة سبب",
    identifierTypes: "إضافة نوع"
  },
  remove: "إزالة",
  active: "مفعل",
  overridable: "يمكن للمشرف التجاوز",
  alternateWeeks: "أسابيع متناوبة فقط",
  save: "حفظ إعدادات الجدولة",
  reset: "إعادة القيم من الخادم",
  saving: "جاري الحفظ…"
} as const;

function _friendlyRuleType(value: string): string {
  return RULE_TYPE_LABELS[value] || value;
}

function _friendlyEffectMode(value: string): string {
  return EFFECT_MODE_LABELS[value] || value;
}

function _friendlyWeekday(value: string): string {
  return WEEKDAY_LABELS[value] || value;
}

function _friendlyCaseCategory(value: string): string {
  return CASE_CATEGORY_LABELS[value] || value;
}

// Export for testing
export { _friendlyRuleType as friendlyRuleType, _friendlyEffectMode as friendlyEffectMode, _friendlyWeekday as friendlyWeekday, _friendlyCaseCategory as friendlyCaseCategory };

export function isReAuthRequiredError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return message.includes("re-authentication") || message.includes("403");
}

type SettingsSection =
  | "menu"
  | "patient_registration"
  | "patient_import"
  | "scheduling_and_capacity"
  | "queue_and_arrival"
  | "scheduling_engine_config"
  | "pacs_connection"
  | "dicom_gateway_config"
  | "dicom_gateway_devices"
  | "dicom_gateway_monitoring"
  | "orthanc_mwl_sync"
  | "sante_worklist_hl7"
  | "users"
  | "role_page_access"
  | "audit_log"
  | "exam_types"
  | "modalities"
  | "name_dictionary"
  | "appointment_slip"
  | "patient_qr_self_service"
  | "sonicdicom_reports"
  | "documents_and_uploads"
  | "backup_restore";

const SECTION_KEYS: SettingsSection[] = [
  "patient_registration",
  "patient_import",
  "scheduling_and_capacity",
  "queue_and_arrival",
  "scheduling_engine_config",
  "pacs_connection",
  "dicom_gateway_config",
  "dicom_gateway_devices",
  "dicom_gateway_monitoring",
  "orthanc_mwl_sync",
  "sante_worklist_hl7",
  "users",
  "role_page_access",
  "audit_log",
  "exam_types",
  "modalities",
  "name_dictionary",
  "appointment_slip",
  "patient_qr_self_service",
  "sonicdicom_reports",
  "documents_and_uploads",
  "backup_restore"
];

type SettingsMenuSection = Exclude<SettingsSection, "menu">;
type SettingsGroup = "all" | "clinical" | "scheduling" | "integrations" | "admin" | "system";

const SECTION_GROUPS: Record<SettingsMenuSection, Exclude<SettingsGroup, "all">> = {
  patient_registration: "clinical",
  patient_import: "clinical",
  exam_types: "clinical",
  modalities: "clinical",
  name_dictionary: "clinical",
  appointment_slip: "clinical",
  patient_qr_self_service: "clinical",
  scheduling_and_capacity: "scheduling",
  queue_and_arrival: "scheduling",
  scheduling_engine_config: "scheduling",
  pacs_connection: "integrations",
  dicom_gateway_config: "integrations",
  dicom_gateway_devices: "integrations",
  dicom_gateway_monitoring: "integrations",
  orthanc_mwl_sync: "integrations",
  sante_worklist_hl7: "integrations",
  sonicdicom_reports: "integrations",
  users: "admin",
  role_page_access: "admin",
  audit_log: "admin",
  documents_and_uploads: "system",
  backup_restore: "system",
};

const SETTINGS_GROUPS: SettingsGroup[] = ["all", "clinical", "scheduling", "integrations", "admin", "system"];
const SETTINGS_MENU_SECTIONS = SECTION_KEYS as SettingsMenuSection[];

function sectionLabel(_t: (key: TranslationKey, params?: Record<string, string | number>) => string, section: SettingsSection): string {
  if (section === "patient_import") {
    return "Patient Import";
  }
  if (section === "patient_qr_self_service") {
    return "إعدادات صفحة المريض ورمز QR";
  }
  if (section === "appointment_slip") {
    return "Appointment Slip Settings";
  }
  if (section === "sonicdicom_reports") {
    return "SonicDICOM Reports";
  }
  if (section === "sante_worklist_hl7") {
    return "Sante Worklist Server";
  }
  return _t(`settings.section.${section}` as TranslationKey);
}

function groupLabel(t: (key: TranslationKey, params?: Record<string, string | number>) => string, group: SettingsGroup): string {
  return t(`settings.group.${group}` as TranslationKey);
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const [section, setSection] = useState<SettingsSection>("menu");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroup>("all");
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [pendingReAuthKeys, setPendingReAuthKeys] = useState<string[]>([]);
  const [reauthVersion, setReauthVersion] = useState(0);
  const queryClient = useQueryClient();
  const backupRestoreRef = useRef<{ onReAuthSuccess: () => void }>(null);

  const handleReAuthSuccess = () => {
    setShowReAuthModal(false);
    setReauthVersion((prev) => prev + 1);
    // Notify backup/restore section to retry after re-auth
    backupRestoreRef.current?.onReAuthSuccess();
    for (const key of pendingReAuthKeys) {
      queryClient.invalidateQueries({ queryKey: key.split(",") });
    }
    setPendingReAuthKeys([]);
    queryClient.invalidateQueries({ queryKey: ["auth-session"] });
  };

  const requestReAuth = (queryKey: string[]) => {
    const keyStr = queryKey.join(",");
    setPendingReAuthKeys((prev) => (prev.includes(keyStr) ? prev : [...prev, keyStr]));
    setShowReAuthModal(true);
  };

  const visibleSections = SETTINGS_MENU_SECTIONS.filter((key) => {
    const label = sectionLabel(t, key);
    const query = settingsQuery.trim().toLowerCase();
    const matchesGroup = settingsGroup === "all" || SECTION_GROUPS[key] === settingsGroup;
    const matchesQuery = !query || label.toLowerCase().includes(query) || SECTION_GROUPS[key].toLowerCase().includes(query);
    return matchesGroup && matchesQuery;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-4 lg:hidden">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-embossed" style={{ color: "var(--text)" }}>
            {t("settings.title")}
          </h2>
        </div>
      </div>

      {section === "menu" ? (
        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-stone-900 dark:text-white">{t("settings.optionsTitle")}</h2>
                <p className="text-sm description-center">{t("settings.optionsDescription")}</p>
              </div>
              <div className="relative w-full lg:max-w-sm">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={settingsQuery}
                  onChange={(event) => setSettingsQuery(event.target.value)}
                  placeholder={t("settings.searchOptions")}
                  className="input-premium h-11 w-full pl-10"
                  aria-label={t("settings.searchOptions")}
                />
              </div>
            </div>

            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {SETTINGS_GROUPS.map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => setSettingsGroup(group)}
                  aria-pressed={settingsGroup === group}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    settingsGroup === group
                      ? "border-accent/25 bg-accent/10 text-accent ring-1 ring-accent/15"
                      : "border-border bg-background text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {groupLabel(t, group)}
                </button>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {SETTINGS_GROUPS.filter((group) => group !== "all").map((group) => (
              <div key={group} className="rounded-xl border border-border bg-muted/30 p-3">
                <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">{groupLabel(t, group)}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {SETTINGS_MENU_SECTIONS.filter((key) => SECTION_GROUPS[key] === group).length}
                </p>
              </div>
            ))}
          </div>

          {visibleSections.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">{t("settings.noOptionsMatch")}</Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleSections.map((key) => {
                const label = sectionLabel(t, key);
                const group = SECTION_GROUPS[key];
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSection(key)}
                    className="rounded-xl border border-border bg-background p-4 text-start transition-colors hover:border-accent/40 hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-accent/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-stone-900 dark:text-white">{label}</p>
                        <p className="mt-1 line-clamp-2 text-sm description-center">{t("settings.configureSection", { section: label })}</p>
                      </div>
                      {group === "admin" || group === "system" ? (
                        <ShieldCheck size={18} className="mt-0.5 shrink-0 text-amber-600" />
                      ) : null}
                    </div>
                    <span className="mt-3 inline-flex rounded-full border border-border bg-muted/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {groupLabel(t, group)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => setSection("menu")}
            className="pill-soft text-sm font-medium"
          >
            {t("common.back")} - {t("settings.backToMenu")}
          </button>

           <Card className="p-6">
            <h3 className="text-xl font-bold text-stone-900 dark:text-white mb-4">{sectionLabel(t, section)}</h3>

            {section === "users" && <UsersSection onReAuthRequired={requestReAuth} />}
            {section === "role_page_access" && <RolePageAccessSection onReAuthRequired={requestReAuth} />}
            {section === "audit_log" && <AuditSection onReAuthRequired={requestReAuth} />}
            {section === "exam_types" && <ExamTypesSection onReAuthRequired={requestReAuth} />}
            {section === "modalities" && <ModalitiesSection onReAuthRequired={requestReAuth} />}
            {section === "name_dictionary" && <NameDictionarySection onReAuthRequired={requestReAuth} />}
            {section === "appointment_slip" && <AppointmentSlipSettingsSection onReAuthRequired={requestReAuth} />}
            {section === "patient_qr_self_service" && <PatientQrSettingsSection onReAuthRequired={requestReAuth} />}
            {section === "sonicdicom_reports" && <SonicDicomReportsSection onReAuthRequired={requestReAuth} />}
            {section === "patient_import" && <PatientImportSection onReAuthRequired={requestReAuth} reauthVersion={reauthVersion} />}
            {section === "documents_and_uploads" && <DocumentsStorageSection onReAuthRequired={requestReAuth} />}
            {section === "pacs_connection" && <PacsSettingsSection onReAuthRequired={requestReAuth} />}
            {section === "patient_registration" && <SimpleSettingsSection category="patient_registration" onReAuthRequired={requestReAuth} />}
            {section === "scheduling_and_capacity" && <SimpleSettingsSection category="scheduling_and_capacity" onReAuthRequired={requestReAuth} />}
            {section === "queue_and_arrival" && <SimpleSettingsSection category="queue_and_arrival" onReAuthRequired={requestReAuth} />}
            {section === "scheduling_engine_config" && <SchedulingEngineConfigSection onReAuthRequired={requestReAuth} />}
            {section === "dicom_gateway_config" && <DicomGatewaySettingsSection onReAuthRequired={requestReAuth} />}
            {section === "dicom_gateway_devices" && <DicomDevicesSection onReAuthRequired={requestReAuth} />}
            {section === "dicom_gateway_monitoring" && <DicomMonitoringSection onReAuthRequired={requestReAuth} />}
            {section === "orthanc_mwl_sync" && <OrthancMwlSection onReAuthRequired={requestReAuth} />}
            {section === "sante_worklist_hl7" && <SanteWorklistSection onReAuthRequired={requestReAuth} />}
            {section === "backup_restore" && <BackupRestoreSection ref={backupRestoreRef} onReAuthRequired={requestReAuth} />}

            {showReAuthModal && <SupervisorReAuthModal onClose={() => setShowReAuthModal(false)} onSuccess={handleReAuthSuccess} />}
          </Card>
        </div>
      )}
    </div>
  );
}

function statusLabel(profile?: DoctorProfile): string {
  if (!profile) return "No doctor profile";
  return profile.active ? "Doctor profile active" : "Doctor profile inactive";
}

function UsersSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
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

      {doctorProfilesQuery.error && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Doctor Portal profile settings are available to super admins when Doctor Portal is enabled.
        </p>
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
            {!doctorProfilesQuery.error && (
              <div className="mt-3 rounded border border-stone-200 dark:border-stone-700 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-stone-900 dark:text-white">Doctor Portal</p>
                    <p className="text-xs description-center">
                      {statusLabel(doctorProfile)}
                    </p>
                    <p className="mt-1 text-xs description-center">
                      Doctor profiles and modality permissions are managed in Doctor Portal → Admin → Doctors.
                    </p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${doctorProfile?.active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                    {statusLabel(doctorProfile)}
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

function AuditSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const limit = 50;
  const { data, isLoading, error } = useQuery({ queryKey: ["audit", limit], queryFn: () => fetchAuditEntries(limit) });

  const handleExport = async () => {
    try {
      await exportAuditCSV();
    } catch {
      // Browser handles errors naturally
    }
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["audit", String(limit)])} />;
    return <QueryError message={msg} />;
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm description-center">{t("settings.showingLastEntries", { count: limit })}</p>
        <Button variant="secondary" onClick={handleExport} className="text-xs">
          Export CSV
        </Button>
      </div>
      {isLoading ? <p className="description-center">{t("settings.loading")}</p> : (
        <ul className="space-y-2">
          {data?.entries?.slice(0, 10).map((entry: any) => (
            <li key={entry.id} className="p-3 bg-stone-50 dark:bg-stone-700 rounded-lg text-sm">
              <p className="text-stone-900 dark:text-white font-medium">{entry.actionType} - {entry.entityType}</p>
              <p className="description-center text-xs mt-1">{formatDateTimeLy(entry.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CatalogImportExportPanel({
  onImportSuccess
}: {
  onImportSuccess: (summary: {
    modalitiesCreated: number;
    modalitiesUpdated: number;
    examTypesCreated: number;
    examTypesUpdated: number;
    skipped: number;
    errors: Array<{ sheet: string; rowNumber: number; column: string | null; message: string }>;
  }) => void;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [progressNotes, setProgressNotes] = useState<string[]>([]);
  const [errorRows, setErrorRows] = useState<Array<{ sheet: string; rowNumber: number; column: string | null; message: string; errorType?: string }>>([]);
  const [modalityFilter, setModalityFilter] = useState<"all" | "selected" | "errors" | "create" | "update" | "skip">("all");
  const [examTypeFilter, setExamTypeFilter] = useState<"all" | "selected" | "errors" | "create" | "update" | "skip">("all");
  const [draft, setDraft] = useState<null | {
    canApply: boolean;
    summary: { modalitiesTotal: number; examTypesTotal: number; selectedModalities: number; selectedExamTypes: number; errors: number; warnings: number };
    modalities: Array<Record<string, unknown>>;
    examTypes: Array<Record<string, unknown>>;
  }>(null);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setErrorMessage(null);
      setErrorType(null);
      setErrorRows([]);
      await exportCatalogWorkbook();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Catalog export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setIsPreviewing(true);
      setErrorMessage(null);
      setErrorType(null);
      setErrorRows([]);
      setProgressNotes(["Reading the selected workbook..."]);
      setModalityFilter("all");
      setExamTypeFilter("all");
      setDraft(null);

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const [, content = ""] = result.split(",", 2);
          resolve(content);
        };
        reader.onerror = () => reject(new Error("Failed to read the selected workbook."));
        reader.readAsDataURL(file);
      });

      const response = await previewCatalogWorkbookImport({ fileContentBase64: base64 });
      setDraft({
        canApply: response.preview.canApply,
        summary: response.preview.summary,
        modalities: response.preview.modalities,
        examTypes: response.preview.examTypes
      });
      setProgressNotes(response.preview.progressNotes || []);
      setErrorRows((response.preview.errors || []) as Array<{ sheet: string; rowNumber: number; column: string | null; message: string; errorType?: string }>);
      if (!response.preview.canApply) {
        setErrorMessage("Preview found validation issues. Review and fix the rows before applying.");
        setErrorType("validation_failed");
      }
    } catch (error) {
      if (error instanceof ApiError) {
        const details = (error.details ?? {}) as {
          errors?: Array<{ sheet: string; rowNumber: number; column: string | null; message: string; errorType?: string }>;
          errorType?: string;
          progressNotes?: string[];
        };
        setErrorRows(Array.isArray(details.errors) ? details.errors : []);
        setErrorType(details.errorType || `http_${error.status}`);
        setProgressNotes(Array.isArray(details.progressNotes) ? details.progressNotes : []);
        setErrorMessage(error.message || "Catalog import failed");
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Catalog import failed");
        setErrorType("unknown_error");
      }
    } finally {
      setIsPreviewing(false);
    }
  };

  const updateDraftRow = (kind: "modalities" | "examTypes", rowId: string, field: string, value: unknown) => {
    setDraft((current) => {
      if (!current) return current;
      const nextRows = (current[kind] || []).map((row) => (
        String(row.id) === rowId ? { ...row, [field]: value } : row
      ));
      const selectedModalities = (kind === "modalities" ? nextRows : current.modalities).filter((row) => Boolean(row.selected)).length;
      const selectedExamTypes = (kind === "examTypes" ? nextRows : current.examTypes).filter((row) => Boolean(row.selected)).length;
      return {
        ...current,
        [kind]: nextRows,
        summary: {
          ...current.summary,
          selectedModalities,
          selectedExamTypes
        }
      };
    });
  };

  const bulkSetSelected = (kind: "modalities" | "examTypes", nextSelected: boolean, mode: "all" | "visible") => {
    setDraft((current) => {
      if (!current) return current;
      const activeFilter = kind === "modalities" ? modalityFilter : examTypeFilter;
      const nextRows = (current[kind] || []).map((row) => {
        const matchesFilter =
          activeFilter === "all" ? true
          : activeFilter === "selected" ? Boolean(row.selected)
          : activeFilter === "errors" ? Array.isArray(row.errors) && row.errors.length > 0
          : String(row.action) === activeFilter;
        if (String(row.action) === "invalid") return row;
        if (mode === "all" || matchesFilter) {
          return { ...row, selected: nextSelected };
        }
        return row;
      });
      const selectedModalities = (kind === "modalities" ? nextRows : current.modalities).filter((row) => Boolean(row.selected)).length;
      const selectedExamTypes = (kind === "examTypes" ? nextRows : current.examTypes).filter((row) => Boolean(row.selected)).length;
      return {
        ...current,
        [kind]: nextRows,
        summary: {
          ...current.summary,
          selectedModalities,
          selectedExamTypes
        }
      };
    });
  };

  const filteredRows = (kind: "modalities" | "examTypes") => {
    if (!draft) return [];
    const filter = kind === "modalities" ? modalityFilter : examTypeFilter;
    return (draft[kind] || []).filter((row) => {
      if (filter === "all") return true;
      if (filter === "selected") return Boolean(row.selected);
      if (filter === "errors") return Array.isArray(row.errors) && row.errors.length > 0;
      return String(row.action) === filter;
    });
  };

  const handleApply = async () => {
    if (!draft) return;
    try {
      setIsApplying(true);
      setErrorMessage(null);
      setErrorType(null);
      setProgressNotes((current) => [...current, "Applying the selected reviewed rows in one transaction..."]);
      const response = await applyCatalogWorkbookImport({
        modalities: draft.modalities,
        examTypes: draft.examTypes
      });
      onImportSuccess(response.summary);
      setDraft(null);
      setErrorRows([]);
      setProgressNotes(["Preview completed.", "Selected rows were applied successfully."]);
    } catch (error) {
      if (error instanceof ApiError) {
        const details = (error.details ?? {}) as {
          errors?: Array<{ sheet: string; rowNumber: number; column: string | null; message: string; errorType?: string }>;
          errorType?: string;
        };
        setErrorRows(Array.isArray(details.errors) ? details.errors : []);
        setErrorType(details.errorType || `http_${error.status}`);
        setErrorMessage(error.message || "Catalog import apply failed");
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Catalog import apply failed");
        setErrorType("unknown_error");
      }
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-4 bg-stone-50/80 dark:bg-stone-800/40 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium text-stone-900 dark:text-white">Excel import/export</p>
          <p className="description-center">One workbook includes both the Modalities and ExamTypes sheets.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleExport} disabled={isExporting || isPreviewing || isApplying} className="text-xs">
            {isExporting ? "Exporting..." : "Export Excel"}
          </Button>
          <label className="inline-flex items-center px-3 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium cursor-pointer disabled:opacity-60">
            {isPreviewing ? "Reviewing..." : "Import Excel"}
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleImportChange} className="sr-only" disabled={isExporting || isPreviewing || isApplying} />
          </label>
          {draft && (
            <Button variant="secondary" onClick={handleApply} disabled={isApplying || !draft.canApply} className="text-xs">
              {isApplying ? "Applying..." : "Apply Selected Rows"}
            </Button>
          )}
        </div>
      </div>

      {progressNotes.length > 0 && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm text-blue-700 dark:text-blue-300">
          <p className="font-medium mb-1">Progress notes</p>
          <ul className="space-y-1">
            {progressNotes.map((note, index) => <li key={`${note}-${index}`}>{index + 1}. {note}</li>)}
          </ul>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300 space-y-2">
          <p>{errorMessage}</p>
          {errorType && <p className="text-xs font-mono">errorType: {errorType}</p>}
          {errorRows.length > 0 && (
            <ul className="space-y-1">
              {errorRows.slice(0, 8).map((item, index) => (
                <li key={`${item.sheet}-${item.rowNumber}-${item.column || "none"}-${index}`}>
                  {item.sheet} row {item.rowNumber}
                  {item.column ? ` (${item.column})` : ""}: {item.message}
                  {item.errorType ? ` [${item.errorType}]` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {draft && (
        <div className="space-y-3">
          <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 text-sm bg-white/70 dark:bg-stone-900/20">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
              <div className="rounded border border-stone-200 dark:border-stone-700 p-2"><div className="text-[10px] uppercase font-mono">Modality Rows</div><div className="font-semibold">{draft.summary.modalitiesTotal}</div></div>
              <div className="rounded border border-stone-200 dark:border-stone-700 p-2"><div className="text-[10px] uppercase font-mono">Exam Rows</div><div className="font-semibold">{draft.summary.examTypesTotal}</div></div>
              <div className="rounded border border-stone-200 dark:border-stone-700 p-2"><div className="text-[10px] uppercase font-mono">Selected Modalities</div><div className="font-semibold">{draft.summary.selectedModalities}</div></div>
              <div className="rounded border border-stone-200 dark:border-stone-700 p-2"><div className="text-[10px] uppercase font-mono">Selected Exams</div><div className="font-semibold">{draft.summary.selectedExamTypes}</div></div>
              <div className="rounded border border-amber-200 dark:border-amber-800 p-2"><div className="text-[10px] uppercase font-mono">Warnings</div><div className="font-semibold">{draft.summary.warnings}</div></div>
              <div className="rounded border border-red-200 dark:border-red-800 p-2"><div className="text-[10px] uppercase font-mono">Errors</div><div className="font-semibold">{draft.summary.errors}</div></div>
            </div>
          </div>

          <details className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 bg-white/70 dark:bg-stone-900/20" open>
            <summary className="cursor-pointer font-medium text-sm">Review modality rows</summary>
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <select value={modalityFilter} onChange={(e) => setModalityFilter(e.target.value as typeof modalityFilter)} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-xs">
                  <option value="all">All modality rows</option>
                  <option value="selected">Selected only</option>
                  <option value="errors">Errors only</option>
                  <option value="create">Creates</option>
                  <option value="update">Updates</option>
                  <option value="skip">Skips</option>
                </select>
                <button onClick={() => bulkSetSelected("modalities", true, "visible")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Select Visible</button>
                <button onClick={() => bulkSetSelected("modalities", false, "visible")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Clear Visible</button>
                <button onClick={() => bulkSetSelected("modalities", true, "all")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Select All</button>
                <button onClick={() => bulkSetSelected("modalities", false, "all")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Clear All</button>
                <span className="text-xs description-center">{filteredRows("modalities").length} visible</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left border-b border-stone-200 dark:border-stone-700">
                      <th className="py-2 pr-2">Use</th>
                      <th className="py-2 pr-2">Action</th>
                      <th className="py-2 pr-2">Row</th>
                      <th className="py-2 pr-2">Code</th>
                      <th className="py-2 pr-2">Name EN</th>
                      <th className="py-2 pr-2">Name AR</th>
                      <th className="py-2 pr-2">Capacity</th>
                      <th className="py-2 pr-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows("modalities").map((row) => (
                      <tr key={String(row.id)} className="border-b border-stone-100 dark:border-stone-800 align-top">
                        <td className="py-2 pr-2">
                          <input type="checkbox" checked={Boolean(row.selected)} onChange={(e) => updateDraftRow("modalities", String(row.id), "selected", e.target.checked)} disabled={String(row.action) === "invalid"} />
                        </td>
                        <td className="py-2 pr-2"><span className="font-mono uppercase">{String(row.action)}</span></td>
                        <td className="py-2 pr-2">{String(row.rowNumber)}</td>
                        <td className="py-2 pr-2"><input value={String(row.code ?? "")} onChange={(e) => updateDraftRow("modalities", String(row.id), "code", e.target.value)} className="w-28 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
                        <td className="py-2 pr-2"><input value={String(row.nameEn ?? "")} onChange={(e) => updateDraftRow("modalities", String(row.id), "nameEn", e.target.value)} className="w-40 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
                        <td className="py-2 pr-2"><input value={String(row.nameAr ?? "")} onChange={(e) => updateDraftRow("modalities", String(row.id), "nameAr", e.target.value)} className="w-40 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
                        <td className="py-2 pr-2"><input type="number" value={Number(row.dailyCapacity ?? 0)} onChange={(e) => updateDraftRow("modalities", String(row.id), "dailyCapacity", Number(e.target.value) || 0)} className="w-20 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
                        <td className="py-2 pr-2">
                          {Array.isArray(row.errors) && row.errors.length > 0 ? (
                            <div className="text-red-600 dark:text-red-300 max-w-xs">{row.errors.map((item: any) => item.errorType || item.message).join(", ")}</div>
                          ) : (
                            <div className="text-stone-500">Ready</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>

          <details className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 bg-white/70 dark:bg-stone-900/20" open>
            <summary className="cursor-pointer font-medium text-sm">Review exam type rows</summary>
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap gap-2 items-center">
                <select value={examTypeFilter} onChange={(e) => setExamTypeFilter(e.target.value as typeof examTypeFilter)} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-xs">
                  <option value="all">All exam rows</option>
                  <option value="selected">Selected only</option>
                  <option value="errors">Errors only</option>
                  <option value="create">Creates</option>
                  <option value="update">Updates</option>
                  <option value="skip">Skips</option>
                </select>
                <button onClick={() => bulkSetSelected("examTypes", true, "visible")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Select Visible</button>
                <button onClick={() => bulkSetSelected("examTypes", false, "visible")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Clear Visible</button>
                <button onClick={() => bulkSetSelected("examTypes", true, "all")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Select All</button>
                <button onClick={() => bulkSetSelected("examTypes", false, "all")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Clear All</button>
                <span className="text-xs description-center">{filteredRows("examTypes").length} visible</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left border-b border-stone-200 dark:border-stone-700">
                      <th className="py-2 pr-2">Use</th>
                      <th className="py-2 pr-2">Action</th>
                      <th className="py-2 pr-2">Row</th>
                      <th className="py-2 pr-2">Modality</th>
                      <th className="py-2 pr-2">Code</th>
                      <th className="py-2 pr-2">Name EN</th>
                      <th className="py-2 pr-2">Name AR</th>
                      <th className="py-2 pr-2">Minutes</th>
                      <th className="py-2 pr-2">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows("examTypes").map((row) => (
                      <tr key={String(row.id)} className="border-b border-stone-100 dark:border-stone-800 align-top">
                        <td className="py-2 pr-2">
                          <input type="checkbox" checked={Boolean(row.selected)} onChange={(e) => updateDraftRow("examTypes", String(row.id), "selected", e.target.checked)} disabled={String(row.action) === "invalid"} />
                        </td>
                        <td className="py-2 pr-2"><span className="font-mono uppercase">{String(row.action)}</span></td>
                        <td className="py-2 pr-2">{String(row.rowNumber)}</td>
                        <td className="py-2 pr-2"><input value={String(row.modalityCode ?? "")} onChange={(e) => updateDraftRow("examTypes", String(row.id), "modalityCode", e.target.value)} className="w-24 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
                        <td className="py-2 pr-2"><input value={String(row.code ?? "")} onChange={(e) => updateDraftRow("examTypes", String(row.id), "code", e.target.value)} className="w-28 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
                        <td className="py-2 pr-2"><input value={String(row.nameEn ?? "")} onChange={(e) => updateDraftRow("examTypes", String(row.id), "nameEn", e.target.value)} className="w-40 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
                        <td className="py-2 pr-2"><input value={String(row.nameAr ?? "")} onChange={(e) => updateDraftRow("examTypes", String(row.id), "nameAr", e.target.value)} className="w-40 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
                        <td className="py-2 pr-2"><input type="number" value={row.durationMinutes == null ? "" : Number(row.durationMinutes)} onChange={(e) => updateDraftRow("examTypes", String(row.id), "durationMinutes", e.target.value === "" ? null : Number(e.target.value))} className="w-20 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
                        <td className="py-2 pr-2">
                          {Array.isArray(row.errors) && row.errors.length > 0 ? (
                            <div className="text-red-600 dark:text-red-300 max-w-xs">{row.errors.map((item: any) => item.errorType || item.message).join(", ")}</div>
                          ) : (
                            <div className="text-stone-500">Ready</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

function ExamTypesSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["exam-types", showInactive ? "with-inactive" : "active"],
    queryFn: () => fetchExamTypes(showInactive)
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    modalityId: "",
    name_ar: "",
    name_en: "",
    specific_instruction_ar: "",
    specific_instruction_en: ""
  });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteExamType(id),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["exam-types"] }); 
      queryClient.invalidateQueries({ queryKey: ["v2-exam-type-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
      setMutationError(null); 
    },
    onError: (err: any) => { setMutationError(err?.message || "Delete failed"); }
  });
  const hardDeleteMutation = useMutation({
    mutationFn: (id: number) => hardDeleteExamType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exam-types"] });
      queryClient.invalidateQueries({ queryKey: ["v2-exam-type-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Hard delete failed"); }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateExamType(id, {
      modalityId: data.modalityId,
      nameAr: data.name_ar,
      nameEn: data.name_en,
      specificInstructionAr: data.specific_instruction_ar,
      specificInstructionEn: data.specific_instruction_en,
      is_active: data.is_active
    }),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["exam-types"] }); 
      queryClient.invalidateQueries({ queryKey: ["v2-exam-type-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
      setEditingId(null); 
      setMutationError(null); 
    },
    onError: (err: any) => { setMutationError(err?.message || "Update failed"); }
  });
  const createMutation = useMutation({
    mutationFn: (data: any) => createExamType({
      modalityId: data.modalityId ? parseInt(data.modalityId, 10) : undefined,
      nameAr: data.name_ar,
      nameEn: data.name_en,
      specificInstructionAr: data.specific_instruction_ar,
      specificInstructionEn: data.specific_instruction_en,
      is_active: true
    }),
    onSuccess: () => { 
      queryClient.invalidateQueries({ queryKey: ["exam-types"] }); 
      queryClient.invalidateQueries({ queryKey: ["v2-exam-type-catalog"] });
      queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
      setShowCreate(false); 
      setCreateForm({
        modalityId: "",
        name_ar: "",
        name_en: "",
        specific_instruction_ar: "",
        specific_instruction_en: ""
      }); 
      setMutationError(null); 
    },
    onError: (err: any) => { setMutationError(err?.message || "Create failed"); }
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["exam-types"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;

  type ExamTypeModalityRow = {
    id: number;
    name_ar?: string | null;
    name_en?: string | null;
    code?: string | null;
    is_active?: boolean;
  };

  const modalityRows = (((data as { modalities?: ExamTypeModalityRow[] } | undefined)?.modalities) ?? []) as ExamTypeModalityRow[];
  const modalityOptions = modalityRows.map((m) => {
    const baseLabel = chooseLocalized(language, m.name_ar, m.name_en) || m.code || `Modality ${m.id}`;
    return {
      value: m.id,
      label: m.is_active === false ? `${baseLabel} (Inactive)` : baseLabel
    };
  });
  const modalityById = new Map<string, ExamTypeModalityRow>(modalityRows.map((m) => [String(m.id), m]));

  const startEdit = (et: any) => {
    setEditingId(et.id);
    setEditForm({
      modalityId: et.modality_id,
      name_ar: et.name_ar,
      name_en: et.name_en,
      specific_instruction_ar: et.specific_instruction_ar || "",
      specific_instruction_en: et.specific_instruction_en || "",
      is_active: et.is_active
    });
  };

  return (
    <div className="space-y-4">
      <CatalogImportExportPanel
        onImportSuccess={(summary) => {
          queryClient.invalidateQueries({ queryKey: ["exam-types"] });
          queryClient.invalidateQueries({ queryKey: ["modalities"] });
          queryClient.invalidateQueries({ queryKey: ["modalities", "all"] });
          queryClient.invalidateQueries({ queryKey: ["lookups"] });
          queryClient.invalidateQueries({ queryKey: ["v2-exam-type-catalog"] });
          queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
          invalidateModalityDerivedAppointmentCaches(queryClient);
          setImportSummary(
            `Imported workbook: ${summary.modalitiesCreated} modalities created, ${summary.modalitiesUpdated} updated, ${summary.examTypesCreated} exam types created, ${summary.examTypesUpdated} updated, ${summary.skipped} skipped.`
          );
          setMutationError(null);
        }}
      />
      {importSummary && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-sm">
          {importSummary}
        </div>
      )}
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm description-center">
          {showInactive
            ? "Showing all exam types, including inactive ones."
            : "Showing active exam types only. Deactivated exam types stay hidden from this list."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowInactive((prev) => !prev)}
            className="text-xs"
          >
            {showInactive ? "Hide inactive" : "Show inactive"}
          </Button>
          <Button variant="secondary" onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="text-xs">{showCreate ? "إلغاء" : "إضافة نوع فحص"}</Button>
        </div>
      </div>
      <span className="text-sm description-center">{(data as any)?.examTypes?.length ?? 0} exam types</span>

      {showCreate && (
        <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input value={createForm.name_en} onChange={(e) => setCreateForm({ ...createForm, name_en: e.target.value })} placeholder="الاسم الإنجليزي" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.name_ar} onChange={(e) => setCreateForm({ ...createForm, name_ar: e.target.value })} placeholder="الاسم العربي" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            {modalityOptions.length > 0 ? (
              <select value={createForm.modalityId} onChange={(e) => setCreateForm({ ...createForm, modalityId: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm">
                <option value="">{t("settings.selectModality")}</option>
                {modalityOptions.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <p className="text-sm text-amber-600 dark:text-amber-400">لا توجد أجهزة متاحة</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <textarea
              value={createForm.specific_instruction_ar}
              onChange={(e) => setCreateForm({ ...createForm, specific_instruction_ar: e.target.value })}
              placeholder="تحضير الفحص (عربي)"
              rows={2}
              className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl"
            />
            <textarea
              value={createForm.specific_instruction_en}
              onChange={(e) => setCreateForm({ ...createForm, specific_instruction_en: e.target.value })}
              placeholder="Exam preparation (English)"
              rows={2}
              className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr"
            />
          </div>
          <button onClick={() => createMutation.mutate(createForm)} disabled={createMutation.isPending || !createForm.name_en || !createForm.modalityId} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors">إنشاء</button>
        </div>
      )}

      <ul className="divide-y divide-stone-200 dark:divide-stone-700">
        {(data as any)?.examTypes?.map((et: any) => (
          <li key={et.id} className="py-3">
            {editingId === et.id ? (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <input value={editForm.name_en} onChange={(e) => setEditForm({ ...editForm, name_en: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.name_ar} onChange={(e) => setEditForm({ ...editForm, name_ar: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                </div>
                {modalityOptions.length > 0 ? (
                  <select value={editForm.modalityId || ""} onChange={(e) => setEditForm({ ...editForm, modalityId: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm">
                    <option value="">{t("settings.selectModality")}</option>
                    {modalityOptions.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : (
                  <p className="text-sm text-amber-600 dark:text-amber-400">لا توجد أجهزة متاحة</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <textarea value={editForm.specific_instruction_ar} onChange={(e) => setEditForm({ ...editForm, specific_instruction_ar: e.target.value })} placeholder="تحضير الفحص (عربي)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl" />
                  <textarea value={editForm.specific_instruction_en} onChange={(e) => setEditForm({ ...editForm, specific_instruction_en: e.target.value })} placeholder="Exam preparation (English)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr" />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded" />
                  مفعل
                </label>
                <div className="flex gap-2">
                  <button onClick={() => updateMutation.mutate({ id: et.id, data: editForm })} disabled={updateMutation.isPending} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded">حفظ</button>
                  <button onClick={() => { setEditingId(null); setMutationError(null); }} className="px-3 py-1.5 bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 text-sm rounded">إلغاء</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-start">
                  <p className="font-medium text-stone-900 dark:text-white">{chooseLocalized(language, et.name_ar, et.name_en)}</p>
                  <p className="description-center text-sm">
                    Modality: {(() => {
                      const modality = modalityById.get(String(et.modality_id));
                      if (!modality) return "Not assigned";
                      const baseLabel = chooseLocalized(language, modality.name_ar, modality.name_en) || modality.code || `Modality ${modality.id}`;
                      return modality.is_active === false ? `${baseLabel} (Inactive)` : baseLabel;
                    })()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${et.is_active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                    {et.is_active ? t("settings.active") : t("settings.inactive")}
                  </span>
                  <button onClick={() => startEdit(et)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">Edit</button>
                  {et.is_active ? (
                    <button onClick={() => { if (window.confirm("Deactivate this exam type? It will disappear from active lists.")) deleteMutation.mutate(et.id); }} className="px-2 py-1 text-xs bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 rounded hover:bg-stone-200 dark:hover:bg-stone-600 transition-colors">Deactivate</button>
                  ) : (
                    <>
                      <button onClick={() => updateMutation.mutate({ id: et.id, data: { modalityId: et.modality_id, name_ar: et.name_ar, name_en: et.name_en, specific_instruction_ar: et.specific_instruction_ar, specific_instruction_en: et.specific_instruction_en, is_active: true } })} className="px-2 py-1 text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors">Activate</button>
                      <button onClick={() => { if (window.confirm("Hard delete this inactive exam type? This cannot be undone and will fail if it is still referenced.")) hardDeleteMutation.mutate(et.id); }} className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">Hard Delete</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModalitiesSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["modalities", showInactive ? "with-inactive" : "active"],
    queryFn: () => fetchModalitiesSettings(showInactive)
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ code: "", name_ar: "", name_en: "", daily_capacity: 0, is_active: true, general_instruction_ar: "", general_instruction_en: "", safety_warning_ar: "", safety_warning_en: "", safety_warning_enabled: true });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => deactivateModality(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      invalidateModalityDerivedAppointmentCaches(queryClient);
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Deactivate failed"); }
  });
  const hardDeleteMutation = useMutation({
    mutationFn: (id: number) => deleteModality(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      invalidateModalityDerivedAppointmentCaches(queryClient);
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Hard delete failed"); }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateModality(id, {
      code: data.code,
      nameAr: data.name_ar,
      nameEn: data.name_en,
      dailyCapacity: data.daily_capacity,
      isActive: data.is_active ? "enabled" : "disabled",
      generalInstructionAr: data.general_instruction_ar,
      generalInstructionEn: data.general_instruction_en,
      safetyWarningAr: data.safety_warning_ar,
      safetyWarningEn: data.safety_warning_en,
      safetyWarningEnabled: data.safety_warning_enabled
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      invalidateModalityDerivedAppointmentCaches(queryClient);
      setEditingId(null);
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Update failed"); }
  });
  const createMutation = useMutation({
    mutationFn: (data: any) => createModality({
      code: data.code,
      nameAr: data.name_ar,
      nameEn: data.name_en,
      dailyCapacity: data.daily_capacity,
      isActive: data.is_active ? "enabled" : "disabled",
      generalInstructionAr: data.general_instruction_ar,
      generalInstructionEn: data.general_instruction_en,
      safetyWarningAr: data.safety_warning_ar,
      safetyWarningEn: data.safety_warning_en,
      safetyWarningEnabled: data.safety_warning_enabled
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      invalidateModalityDerivedAppointmentCaches(queryClient);
      setShowCreate(false);
      setCreateForm({ code: "", name_ar: "", name_en: "", daily_capacity: 0, is_active: true, general_instruction_ar: "", general_instruction_en: "", safety_warning_ar: "", safety_warning_en: "", safety_warning_enabled: true });
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Create failed"); }
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["modalities"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;

  const startEdit = (m: any) => {
    setEditingId(m.id);
    setEditForm({
      code: m.code,
      name_ar: m.name_ar,
      name_en: m.name_en,
      daily_capacity: m.daily_capacity ?? 0,
      is_active: m.is_active,
      general_instruction_ar: m.general_instruction_ar || "",
      general_instruction_en: m.general_instruction_en || "",
      safety_warning_ar: m.safety_warning_ar || "",
      safety_warning_en: m.safety_warning_en || "",
      safety_warning_enabled: m.safety_warning_enabled !== false
    });
  };

  return (
    <div className="space-y-4">
      <CatalogImportExportPanel
        onImportSuccess={(summary) => {
          queryClient.invalidateQueries({ queryKey: ["modalities"] });
          queryClient.invalidateQueries({ queryKey: ["modalities", "all"] });
          queryClient.invalidateQueries({ queryKey: ["exam-types"] });
          queryClient.invalidateQueries({ queryKey: ["lookups"] });
          queryClient.invalidateQueries({ queryKey: ["v2-exam-type-catalog"] });
          queryClient.invalidateQueries({ queryKey: ["v2-lookups"] });
          setImportSummary(
            `Imported workbook: ${summary.modalitiesCreated} modalities created, ${summary.modalitiesUpdated} updated, ${summary.examTypesCreated} exam types created, ${summary.examTypesUpdated} updated, ${summary.skipped} skipped.`
          );
          setMutationError(null);
        }}
      />
      {importSummary && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-sm">
          {importSummary}
        </div>
      )}
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm description-center">
          {showInactive
            ? "Showing all modalities, including inactive ones."
            : "Showing active modalities only. Deactivated modalities stay hidden from this list."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setShowInactive((prev) => !prev)}
            className="text-xs"
          >
            {showInactive ? "Hide inactive" : "Show inactive"}
          </Button>
          <Button variant="secondary" onClick={() => { setShowCreate(!showCreate); setMutationError(null); }} className="text-xs">{showCreate ? "إلغاء" : "إضافة جهاز"}</Button>
        </div>
      </div>
      <span className="text-sm description-center">{(data as any)?.modalities?.length ?? 0} modalities</span>

      {showCreate && (
        <div className="p-4 bg-stone-50 dark:bg-stone-700/50 rounded-lg space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <input value={createForm.code} onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })} placeholder="الرمز" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.name_en} onChange={(e) => setCreateForm({ ...createForm, name_en: e.target.value })} placeholder="الاسم الإنجليزي" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input value={createForm.name_ar} onChange={(e) => setCreateForm({ ...createForm, name_ar: e.target.value })} placeholder="الاسم العربي" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
            <input type="number" value={createForm.daily_capacity} onChange={(e) => setCreateForm({ ...createForm, daily_capacity: parseInt(e.target.value) || 0 })} placeholder="السعة اليومية" className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <textarea value={createForm.general_instruction_ar} onChange={(e) => setCreateForm({ ...createForm, general_instruction_ar: e.target.value })} placeholder="ملاحظات الجهاز (عربي)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl" />
            <textarea value={createForm.general_instruction_en} onChange={(e) => setCreateForm({ ...createForm, general_instruction_en: e.target.value })} placeholder="ملاحظات الجهاز (إنجليزي)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr" />
          </div>
          <div className="flex items-center gap-3 pt-1">
            <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={createForm.safety_warning_enabled} onChange={(e) => setCreateForm({ ...createForm, safety_warning_enabled: e.target.checked })} className="rounded" /> تحذير السلامة مفعل</label>
          </div>
          {createForm.safety_warning_enabled && (
            <div className="grid grid-cols-2 gap-2">
              <textarea value={createForm.safety_warning_ar} onChange={(e) => setCreateForm({ ...createForm, safety_warning_ar: e.target.value })} placeholder="تحذير السلامة (عربي)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl" />
              <textarea value={createForm.safety_warning_en} onChange={(e) => setCreateForm({ ...createForm, safety_warning_en: e.target.value })} placeholder="تحذير السلامة (إنجليزي)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr" />
            </div>
          )}
          <button onClick={() => createMutation.mutate(createForm)} disabled={createMutation.isPending || !createForm.code || !createForm.name_en} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded transition-colors">إنشاء</button>
        </div>
      )}

      {((data as any)?.modalities?.length ?? 0) === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 p-4 text-sm text-stone-500 dark:text-stone-400">
          لم يتم تكوين أي أجهزة بعد.
        </div>
      ) : (
      <ul className="divide-y divide-stone-200 dark:divide-stone-700">
        {(data as any)?.modalities?.map((m: any) => (
          <li key={m.id} className="py-3">
            {editingId === m.id ? (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.name_en} onChange={(e) => setEditForm({ ...editForm, name_en: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input value={editForm.name_ar} onChange={(e) => setEditForm({ ...editForm, name_ar: e.target.value })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                  <input type="number" value={editForm.daily_capacity} onChange={(e) => setEditForm({ ...editForm, daily_capacity: parseInt(e.target.value) || 0 })} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <textarea value={editForm.general_instruction_ar} onChange={(e) => setEditForm({ ...editForm, general_instruction_ar: e.target.value })} placeholder="ملاحظات الجهاز (عربي)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl" />
                  <textarea value={editForm.general_instruction_en} onChange={(e) => setEditForm({ ...editForm, general_instruction_en: e.target.value })} placeholder="ملاحظات الجهاز (إنجليزي)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr" />
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={editForm.safety_warning_enabled} onChange={(e) => setEditForm({ ...editForm, safety_warning_enabled: e.target.checked })} className="rounded" /> تحذير السلامة مفعل</label>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="rounded" /> مفعل</label>
                </div>
                {editForm.safety_warning_enabled && (
                  <div className="grid grid-cols-2 gap-2">
                    <textarea value={editForm.safety_warning_ar} onChange={(e) => setEditForm({ ...editForm, safety_warning_ar: e.target.value })} placeholder="تحذير السلامة (عربي)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-rtl" />
                    <textarea value={editForm.safety_warning_en} onChange={(e) => setEditForm({ ...editForm, safety_warning_en: e.target.value })} placeholder="تحذير السلامة (إنجليزي)" rows={2} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white text-sm input-ltr" />
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => updateMutation.mutate({ id: m.id, data: editForm })} disabled={updateMutation.isPending} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded">Save</button>
                  <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 text-sm rounded">إلغاء</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-start">
                  <p className="font-medium text-stone-900 dark:text-white">{chooseLocalized(language, m.name_ar, m.name_en) || m.code || `Modality ${m.id}`}</p>
                  <p className="text-sm description-center">{t("settings.capacity")}: {m.daily_capacity ?? "-"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${m.is_active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                    {m.is_active ? t("settings.active") : t("settings.inactive")}
                  </span>
                  <button onClick={() => startEdit(m)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">Edit</button>
                  {m.is_active ? (
                    <button
                      onClick={() => {
                        if (window.confirm("Deactivate this modality? It will disappear from active lists.")) {
                          deactivateMutation.mutate(m.id);
                        }
                      }}
                      className="px-2 py-1 text-xs bg-stone-100 dark:bg-stone-700 text-stone-700 dark:text-stone-300 rounded hover:bg-stone-200 dark:hover:bg-stone-600 transition-colors"
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        if (window.confirm("Reactivate this modality?")) {
                          updateMutation.mutate({ id: m.id, data: { ...m, is_active: true } });
                        }
                      }}
                      className="px-2 py-1 text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 rounded hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (window.confirm("Permanently delete this modality? This cannot be undone.")) {
                        hardDeleteMutation.mutate(m.id);
                      }
                    }}
                    className="px-2 py-1 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                  >
                    Hard Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

function NameDictionarySection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["name-dictionary"], queryFn: fetchNameDictionary });

  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ arabicText: "", englishText: "" });
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [csvImportStage, setCsvImportStage] = useState<"idle" | "reading" | "parsing" | "uploading">("idle");
  const [csvImportCount, setCsvImportCount] = useState(0);
  const isReauthError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err || "");
    return message.includes("re-authentication") || message.includes("403");
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteNameDictionaryEntry(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setMutationError(null); },
    onError: (err: any) => {
      if (isReauthError(err)) {
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(err?.message || "Delete failed");
    }
  });
  const deleteAllMutation = useMutation({
    mutationFn: async (ids: number[]) => { for (const id of ids) await deleteNameDictionaryEntry(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setMutationError(null); },
    onError: (err: any) => {
      if (isReauthError(err)) {
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(err?.message || "Delete all failed");
    }
  });
  const updateMutation = useMutation({
    mutationFn: (_data: { arabicText: string; englishText: string }) => upsertNameDictionaryEntry(_data.arabicText, _data.englishText),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setEditingId(null); setMutationError(null); },
    onError: (err: any) => {
      if (isReauthError(err)) {
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(err?.message || "Update failed");
    }
  });
  const importMutation = useMutation({
    mutationFn: (entries: { arabicText: string; englishText: string }[]) => importNameDictionary(entries),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["name-dictionary"] });
      setMutationError(null);
      setCsvImportStage("idle");
      setCsvImportCount(0);
    },
    onError: (err: any) => {
      if (isReauthError(err)) {
        setCsvImportStage("idle");
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(err?.message || "Import failed");
      setCsvImportStage("idle");
    }
  });

  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvImportStage("reading");
    setCsvImportCount(0);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        setCsvImportStage("parsing");
        const text = ev.target?.result as string;
        const lines = text.split(/\r?\n/).filter(Boolean);
        // Skip header row if present; expect: arabic,english per line
        const entries = lines
          .map((line) => {
            const parts = line.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
            if (parts.length >= 2 && parts[0] && parts[1]) {
              return { arabicText: parts[0], englishText: parts[1] };
            }
            return null;
          })
          .filter(Boolean) as { arabicText: string; englishText: string }[];
        if (entries.length === 0) {
          setMutationError("No valid entries found in CSV. Expected format: arabic,english per line.");
          setCsvImportStage("idle");
          return;
        }
        setCsvImportCount(entries.length);
        if (window.confirm(`Import ${entries.length} entries from CSV? This will upsert (update existing or create new).`)) {
          setCsvImportStage("uploading");
          importMutation.mutate(entries);
        } else {
          setCsvImportStage("idle");
        }
      } catch {
        setMutationError("Failed to parse CSV file.");
        setCsvImportStage("idle");
      }
    };
    reader.onerror = () => {
      setMutationError("Failed to read CSV file.");
      setCsvImportStage("idle");
    };
    reader.readAsText(file);
    // Reset file input
    e.target.value = "";
  };

  const handleDeleteAll = () => {
    const entries = data?.entries ?? [];
    if (entries.length === 0) return;
    if (window.confirm(`Delete all ${entries.length} dictionary entries? This cannot be undone.`)) {
      deleteAllMutation.mutate(entries.map((e: any) => e.id));
    }
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["name-dictionary"])} />;
    return <QueryError message={msg} />;
  }

  const allEntries = data?.entries ?? [];
  const filteredEntries = searchQuery
    ? allEntries.filter((e: any) =>
        e.arabicText?.includes(searchQuery) ||
        e.englishText?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allEntries;
  const importStatusMessage =
    csvImportStage === "reading"
      ? "Reading CSV file..."
      : csvImportStage === "parsing"
        ? "Parsing CSV entries..."
        : csvImportStage === "uploading"
          ? `Importing ${csvImportCount} entries...`
          : null;

  return (
    <div className="space-y-4">
      {importStatusMessage && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm space-y-2">
          <p>{importStatusMessage}</p>
          <div className="h-2 w-full rounded bg-blue-100 dark:bg-blue-800/40 overflow-hidden" aria-hidden>
            {csvImportStage === "uploading" ? (
              <div className="h-full w-1/2 bg-blue-500 dark:bg-blue-400 animate-pulse" />
            ) : (
              <div
                className="h-full bg-blue-500 dark:bg-blue-400 transition-all duration-300"
                style={{ width: csvImportStage === "reading" ? "35%" : "70%" }}
              />
            )}
          </div>
        </div>
      )}

      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex-1 min-w-[200px]">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Arabic or English…"
            className="w-full px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none"
          />
        </div>
        <span className="text-sm description-center">{filteredEntries.length} / {allEntries.length} entries</span>
        <label className="btn-secondary text-xs cursor-pointer">
          Import CSV
          <input
            type="file"
            accept=".csv,.txt"
            onChange={handleCsvImport}
            className="hidden"
            disabled={importMutation.isPending || csvImportStage === "reading" || csvImportStage === "parsing"}
          />
        </label>
        {allEntries.length > 0 && (
          <button onClick={handleDeleteAll} disabled={deleteAllMutation.isPending} className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50">
            {deleteAllMutation.isPending ? "Deleting…" : "Delete All"}
          </button>
        )}
      </div>

      {isLoading ? <p className="description-center">{t("settings.loading")}</p> : (
        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400 sticky top-0">
              <tr>
                <th className="text-start p-2">Arabic</th>
                <th className="text-start p-2">English</th>
                <th className="p-2 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
              {filteredEntries.length === 0 ? (
                <tr><td colSpan={3} className="p-8 text-center text-stone-500 dark:text-stone-400">
                  {searchQuery ? "No entries match your search" : "No dictionary entries"}
                </td></tr>
              ) : (
                filteredEntries.map((e: any) => (
                  <tr key={e.id} className="hover:bg-stone-50 dark:hover:bg-stone-700/30 transition-colors">
                    {editingId === e.id ? (
                      <>
                        <td className="p-2">
                          <input value={editForm.arabicText} onChange={(ev) => setEditForm({ ...editForm, arabicText: ev.target.value })} className="w-full px-2 py-1 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white input-rtl" />
                        </td>
                        <td className="p-2">
                          <input value={editForm.englishText} onChange={(ev) => setEditForm({ ...editForm, englishText: ev.target.value })} className="w-full px-2 py-1 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white input-ltr" />
                        </td>
                        <td className="p-2 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => updateMutation.mutate(editForm)} disabled={updateMutation.isPending} className="px-2 py-0.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 rounded hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors">Save</button>
                            <button onClick={() => setEditingId(null)} className="px-2 py-0.5 text-xs bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 rounded">إلغاء</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="p-2 text-stone-900 dark:text-white input-rtl">{e.arabicText}</td>
                        <td className="p-2 text-stone-700 dark:text-stone-300 input-ltr">{e.englishText}</td>
                        <td className="p-2 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => { setEditingId(e.id); setEditForm({ arabicText: e.arabicText, englishText: e.englishText }); }} className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">Edit</button>
                            <button onClick={() => { if (window.confirm(`Delete "${e.arabicText}"?`)) deleteMutation.mutate(e.id); }} className="px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors">Delete</button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// -- Settings Catalog: known keys → display labels, control types, and dropdown options --
interface SettingControl {
  label: string;
  type: "dropdown" | "number" | "time" | "text";
  options?: { value: string; label: string }[];
  min?: string;
  max?: string;
  step?: string;
}

const SETTINGS_CATALOG: Record<string, SettingControl> = {
  // Patient Registration
  phone1_required: { label: "Phone 1 Required", type: "dropdown", options: [
    { value: "required", label: "مطلوب" },
    { value: "optional", label: "اختياري" }
  ]},
  dob_or_age_rule: { label: "DOB / Age Rule", type: "dropdown", options: [
    { value: "age_or_dob_required", label: "العمر أو تاريخ الميلاد مطلوب" },
    { value: "age_required", label: "العمر مطلوب" },
    { value: "dob_required", label: "تاريخ الميلاد مطلوب" }
  ]},
  national_id_required: { label: "الرقم الوطني مطلوب", type: "dropdown", options: [
    { value: "required", label: "مطلوب" },
    { value: "optional", label: "اختياري" }
  ]},
  custom_fields_scope: { label: "نطاق الحقول المخصصة", type: "dropdown", options: [
    { value: "all_patients", label: "جميع المرضى" },
    { value: "disabled", label: "غير مفعل" }
  ]},

  // Scheduling & Capacity
  capacity_mode: { label: "وضع السعة", type: "dropdown", options: [
    { value: "per_modality_per_day", label: "لكل جهاز في اليوم" },
    { value: "global", label: "إجمالي" }
  ]},
  calendar_window_days: { label: "نافذة التقويم (أيام)", type: "number", min: "1", max: "90" },
  double_booking_prevention: { label: "منع الحجز المزدوج", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  overbooking_reason_required: { label: "اشتراط سبب للتجاوز", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  allow_friday_appointments: { label: "السماح بمواعيد الجمعة (للحجز العادي)", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  allow_saturday_appointments: { label: "السماح بمواعيد السبت (للحجز العادي)", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  // Queue & Arrival
  barcode_check_in: { label: "تسجيل الوصول بالباركود", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  walk_in_queue: { label: "قائمة الدخول المباشر", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  no_show_review_time: { label: "وقت مراجعة الغياب", type: "time" },
  no_show_confirmation_required: { label: "اشتراط تأكيد الغياب", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]}
};

function inferSettingControl(key: string, value: any): SettingControl {
  const known = SETTINGS_CATALOG[key];
  if (known) return known;

  // Fallback inference for unknown keys
  const strVal = String(value).toLowerCase();
  if (strVal === "enabled" || strVal === "disabled") {
    return { label: key.replace(/_/g, " "), type: "dropdown", options: [
      { value: "enabled", label: "Enabled" },
      { value: "disabled", label: "Disabled" }
    ]};
  }
  if (strVal === "required" || strVal === "optional") {
    return { label: key.replace(/_/g, " "), type: "dropdown", options: [
      { value: "required", label: "Required" },
      { value: "optional", label: "Optional" }
    ]};
  }
  if (/^\d+$/.test(strVal)) {
    return { label: key.replace(/_/g, " "), type: "number" };
  }
  if (/^\d{2}:\d{2}$/.test(strVal)) {
    return { label: key.replace(/_/g, " "), type: "time" };
  }
  return { label: key.replace(/_/g, " "), type: "text" };
}

function friendlySettingLabel(category: string, key: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  if (category === "patient_registration" && key === "mrn_prefix") {
    return t("settings.patientRegistration.mrnPrefix");
  }
  return key.replace(/_/g, " ");
}

function SimpleSettingsSection({ category, onReAuthRequired }: { category: string; onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["settings", category], queryFn: () => fetchSettings(category) });

  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mrnPrefix, setMrnPrefix] = useState("");
  useEffect(() => {
    if (category === "patient_registration") {
      setMrnPrefix(String(data?.mrn_prefix ?? ""));
    }
  }, [category, data]);
  const saveMutation = useMutation({
    mutationFn: (payload: { entries: { key: string; value: any }[] }) => saveSettings(category, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", category] });
      if (category === "patient_registration") {
        queryClient.invalidateQueries({ queryKey: ["patient-mrn-preview"] });
      }
      if (category === "scheduling_and_capacity") {
        queryClient.invalidateQueries({ queryKey: ["v2-availability"] });
      }
      setMutationError(null);
    },
    onError: (err: any) => { setMutationError(err?.message || "Save failed"); }
  });

  const handleSave = (key: string, value: any) => {
    saveMutation.mutate({ entries: [{ key, value }] });
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", category])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  return (
    <div className="space-y-3">
      {category === "patient_registration" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-amber-800">{t("settings.patientRegistration.mrnPrefix")}</p>
            <p className="text-sm text-amber-700 mt-1">{t("settings.patientRegistration.mrnPrefixHint")}</p>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-amber-700 mb-1.5">
                {t("settings.patientRegistration.mrnPrefix")}
              </label>
              <input
                type="text"
                value={mrnPrefix}
                onChange={(e) => setMrnPrefix(e.target.value)}
                placeholder={t("settings.patientRegistration.mrnPrefix")}
                className="w-full px-3 py-2 text-sm rounded-lg border border-amber-200 bg-white text-stone-900 outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
            <Button
              type="button"
              onClick={() => saveMutation.mutate({ entries: [{ key: "mrn_prefix", value: mrnPrefix }] })}
              disabled={saveMutation.isPending}
              className="sm:min-w-32"
            >
              {saveMutation.isPending ? t("settings.loading") : t("settings.save")}
            </Button>
          </div>
        </div>
      )}
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}
      {Object.entries(data || {})
        .filter(([key]) => !(category === "patient_registration" && key === "mrn_prefix"))
        .map(([key, value]: [string, any]) => {
        const control = inferSettingControl(key, value);
        const label = friendlySettingLabel(category, key, t);
        const isPending = saveMutation.variables?.entries?.some((e) => e.key === key) && saveMutation.isPending;
        return (
          <div key={key} className="flex items-center justify-between p-3 bg-stone-50 dark:bg-stone-700 rounded-lg">
            <span className="text-stone-700 dark:text-stone-300 font-medium text-sm">{label}</span>
            <div className="flex items-center gap-2">
              {control.type === "dropdown" && control.options && (
                <select
                  value={String(value)}
                  onChange={(e) => handleSave(key, e.target.value)}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50"
                >
                  {control.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
              {control.type === "number" && (
                <input
                  type="number"
                  value={String(value)}
                  onChange={(e) => handleSave(key, e.target.value)}
                  disabled={isPending}
                  min={control.min}
                  max={control.max}
                  step={control.step}
                  className="w-20 px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50 text-right"
                />
              )}
              {control.type === "time" && (
                <input
                  type="time"
                  value={String(value)}
                  onChange={(e) => handleSave(key, e.target.value)}
                  disabled={isPending}
                  className="px-3 py-1.5 text-sm rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-900 dark:text-white focus:ring-1 focus:ring-teal-500 outline-none disabled:opacity-50"
                />
              )}
              {control.type === "text" && (
                <span className="text-stone-900 dark:text-white text-sm">{String(value)}</span>
              )}
              {isPending && (
                <span className="w-4 h-4 border-2 border-stone-300 border-t-teal-600 rounded-full animate-spin" />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

function PatientImportSection({
  onReAuthRequired,
  reauthVersion
}: {
  onReAuthRequired: (key: string[]) => void;
  reauthVersion: number;
}) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [fileContentBase64, setFileContentBase64] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState({
    arabic_full_name: "",
    national_id: "",
    phone: "",
  });
  const [batchCategory, setBatchCategory] = useState<"oncology" | "non_oncology">("non_oncology");
  const [batchId, setBatchId] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<
    | { kind: "inspect" }
    | { kind: "preview" }
    | { kind: "confirm" }
    | { kind: "select"; rowIds: number[]; selected: boolean }
    | null
  >(null);

  const isReauthError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err || "");
    return message.includes("re-authentication") || message.includes("403");
  };

  const inspectMutation = useMutation({
    mutationFn: inspectPatientImportWorkbook,
    onSuccess: (result) => {
      const workbook = result.workbook;
      setSheetNames(workbook.sheetNames || []);
      setSelectedSheetName(workbook.selectedSheetName || "");
      setHeaders(workbook.headers || []);
      setLocalError(null);
    },
    onError: (err: unknown) => {
      if (isReauthError(err)) {
        setPendingRetry({ kind: "inspect" });
        onReAuthRequired(["patient-import"]);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to inspect workbook.";
      setLocalError(message);
    }
  });

  const previewMutation = useMutation({
    mutationFn: previewPatientImport,
    onSuccess: (result) => {
      setBatchId(Number(result.batch.id));
      setLocalError(null);
      queryClient.invalidateQueries({ queryKey: ["patient-import-batch", Number(result.batch.id)] });
      queryClient.invalidateQueries({ queryKey: ["patient-import-rows", Number(result.batch.id)] });
    },
    onError: (err: unknown) => {
      if (isReauthError(err)) {
        setPendingRetry({ kind: "preview" });
        onReAuthRequired(["patient-import"]);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to stage import.";
      setLocalError(message);
    }
  });

  const { data: batchData, isLoading: batchLoading } = useQuery({
    queryKey: ["patient-import-batch", batchId],
    queryFn: () => fetchPatientImportBatch(Number(batchId)),
    enabled: batchId !== null
  });

  const { data: rowsData = [], isLoading: rowsLoading } = useQuery({
    queryKey: ["patient-import-rows", batchId],
    queryFn: () => fetchPatientImportRows(Number(batchId)),
    enabled: batchId !== null
  });

  const selectMutation = useMutation({
    mutationFn: ({ rowIds, selected }: { rowIds: number[]; selected: boolean }) =>
      selectPatientImportRows(Number(batchId), rowIds, selected),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patient-import-rows", batchId] });
      await queryClient.invalidateQueries({ queryKey: ["patient-import-batch", batchId] });
    },
    onError: (err: unknown) => {
      if (isReauthError(err)) {
        onReAuthRequired(["patient-import"]);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to update selection.";
      setLocalError(message);
    }
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmPatientImportBatch(Number(batchId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patient-import-rows", batchId] });
      await queryClient.invalidateQueries({ queryKey: ["patient-import-batch", batchId] });
      setLocalError(null);
    },
    onError: (err: unknown) => {
      if (isReauthError(err)) {
        setPendingRetry({ kind: "confirm" });
        onReAuthRequired(["patient-import"]);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to confirm migration.";
      setLocalError(message);
    }
  });

  useEffect(() => {
    if (!pendingRetry) return;

    if (pendingRetry.kind === "inspect") {
      setPendingRetry(null);
      void handleInspectWorkbook();
      return;
    }

    if (pendingRetry.kind === "preview") {
      setPendingRetry(null);
      void handleStagePreview();
      return;
    }

    if (pendingRetry.kind === "confirm") {
      setPendingRetry(null);
      confirmMutation.mutate();
      return;
    }

    if (pendingRetry.kind === "select") {
      const payload = pendingRetry;
      setPendingRetry(null);
      selectMutation.mutate({ rowIds: payload.rowIds, selected: payload.selected });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reauthVersion]);

  const handleInspectWorkbook = async () => {
    if (!fileContentBase64) {
      setLocalError("Please upload an Excel file first.");
      return;
    }
    try {
      const result = await inspectMutation.mutateAsync({ fileContentBase64, sheetName: selectedSheetName || undefined });
      const workbook = result.workbook;
      if (workbook.selectedSheetName) {
        setSelectedSheetName(workbook.selectedSheetName);
      }
    } catch {
      // handled in mutation
    }
  };

  const handlePickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setBatchId(null);
    setRowsAndErrorsReset();

    try {
      const base64 = await fileToBase64(file);
      setFileContentBase64(base64);
      setSheetNames([]);
      setHeaders([]);
      setSelectedSheetName("");
      setLocalError(null);
    } catch {
      // handled in mutation
    } finally {
      event.target.value = "";
    }
  };

  const setRowsAndErrorsReset = () => {
    setSheetNames([]);
    setHeaders([]);
    setMapping({ arabic_full_name: "", national_id: "", phone: "" });
    setBatchCategory("non_oncology");
    setLocalError(null);
  };

  const handleSheetChange = async (sheetName: string) => {
    setSelectedSheetName(sheetName);
    if (!fileContentBase64) return;
    try {
      await inspectMutation.mutateAsync({ fileContentBase64, sheetName });
    } catch {
      // handled in mutation
    }
  };

  const handleStagePreview = async () => {
    if (!fileContentBase64) {
      setLocalError("Please upload an Excel file first.");
      return;
    }
    if (!mapping.arabic_full_name || !mapping.national_id) {
      setLocalError("Please map Arabic full name and National ID columns.");
      return;
    }

    await previewMutation.mutateAsync({
      fileName: fileName || "patient-import.xlsx",
      fileContentBase64,
      sheetName: selectedSheetName || undefined,
      patientCategory: batchCategory,
      mapping: {
        arabic_full_name: mapping.arabic_full_name,
        national_id: mapping.national_id,
        phone: mapping.phone || undefined
      }
    });
  };

  const validRows = rowsData.filter((row) => row.validation_status === "valid");
  const selectedValidRows = validRows.filter((row) => row.is_selected_for_migration);
  const validRowIds = validRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);

  const handleSelectAllValid = () => {
    if (validRowIds.length === 0) return;
    selectMutation.mutate(
      { rowIds: validRowIds, selected: true },
      {
        onError: (err: unknown) => {
          if (isReauthError(err)) {
            setPendingRetry({ kind: "select", rowIds: validRowIds, selected: true });
            onReAuthRequired(["patient-import"]);
          }
        }
      }
    );
  };

  const handleClearSelection = () => {
    if (validRowIds.length === 0) return;
    selectMutation.mutate(
      { rowIds: validRowIds, selected: false },
      {
        onError: (err: unknown) => {
          if (isReauthError(err)) {
            setPendingRetry({ kind: "select", rowIds: validRowIds, selected: false });
            onReAuthRequired(["patient-import"]);
          }
        }
      }
    );
  };

  const rawErrorText =
    localError ||
    ((inspectMutation.error as Error | undefined)?.message ?? null) ||
    ((previewMutation.error as Error | undefined)?.message ?? null) ||
    ((confirmMutation.error as Error | undefined)?.message ?? null);
  const errorText = rawErrorText && isReauthError(rawErrorText) ? null : rawErrorText;

  const inProgressMessage = inspectMutation.isPending
    ? (language === "ar" ? "جاري قراءة الملف واستخراج الأعمدة..." : "Reading workbook and extracting headers...")
    : previewMutation.isPending
      ? (language === "ar" ? "جاري تجهيز الصفوف والتحقق من البيانات..." : "Staging rows and validating data...")
      : selectMutation.isPending
        ? (language === "ar" ? "جاري تحديث اختيار الصفوف..." : "Updating row selection...")
        : confirmMutation.isPending
          ? (language === "ar" ? "جاري ترحيل الصفوف المحددة إلى المرضى..." : "Migrating selected rows to live patients...")
          : (batchLoading || rowsLoading)
            ? (language === "ar" ? "جاري تحديث بيانات الدفعة..." : "Refreshing batch data...")
            : null;

  return (
    <div className="space-y-4">
      {inProgressMessage && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm space-y-2">
          <p>{inProgressMessage}</p>
          <div className="h-2 w-full rounded bg-blue-100 dark:bg-blue-800/40 overflow-hidden" aria-hidden>
            <div className="h-full w-1/2 bg-blue-500 dark:bg-blue-400 animate-pulse" />
          </div>
        </div>
      )}

      {errorText && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {errorText}
        </div>
      )}

      <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-4 space-y-3">
        <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          {language === "ar" ? "1) رفع ملف Excel" : "1) Upload Excel file"}
        </h4>
        <input type="file" accept=".xlsx,.xls" onChange={handlePickFile} />
        {fileName ? <p className="text-xs text-stone-500">{fileName}</p> : null}
        <Button
          onClick={() => void handleInspectWorkbook()}
          disabled={!fileContentBase64 || inspectMutation.isPending}
          className="text-sm"
        >
          {inspectMutation.isPending
            ? (language === "ar" ? "جاري قراءة الأعمدة..." : "Reading headers...")
            : (language === "ar" ? "2) قراءة الأعمدة" : "2) Read workbook headers")}
        </Button>
      </div>

      {sheetNames.length > 0 && (
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {language === "ar" ? "3) اختيار الورقة + ربط الأعمدة" : "3) Select sheet + map columns"}
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "Sheet" : "Sheet"}
              <select
                value={selectedSheetName}
                onChange={(e) => void handleSheetChange(e.target.value)}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                {sheetNames.map((sheet) => (
                  <option key={sheet} value={sheet}>{sheet}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "Batch category" : "Batch category"}
              <select
                value={batchCategory}
                onChange={(e) => setBatchCategory((e.target.value as "oncology" | "non_oncology") || "non_oncology")}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                <option value="non_oncology">{language === "ar" ? "غير أورام" : "Non-oncology"}</option>
                <option value="oncology">{language === "ar" ? "أورام" : "Oncology"}</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "Arabic full name (required)" : "Arabic full name (required)"}
              <select
                value={mapping.arabic_full_name}
                onChange={(e) => setMapping((prev) => ({ ...prev, arabic_full_name: e.target.value }))}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                <option value="">--</option>
                {headers.map((header) => (
                  <option key={`ar-${header}`} value={header}>{header}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "National ID (required)" : "National ID (required)"}
              <select
                value={mapping.national_id}
                onChange={(e) => setMapping((prev) => ({ ...prev, national_id: e.target.value }))}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                <option value="">--</option>
                {headers.map((header) => (
                  <option key={`nid-${header}`} value={header}>{header}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "Phone (optional)" : "Phone (optional)"}
              <select
                value={mapping.phone}
                onChange={(e) => setMapping((prev) => ({ ...prev, phone: e.target.value }))}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                <option value="">--</option>
                {headers.map((header) => (
                  <option key={`phone-${header}`} value={header}>{header}</option>
                ))}
              </select>
            </label>
          </div>

          <Button
            onClick={() => void handleStagePreview()}
            disabled={previewMutation.isPending || inspectMutation.isPending}
            className="text-sm"
          >
            {previewMutation.isPending
              ? (language === "ar" ? "جاري الاستيراد إلى المرحلة..." : "Staging import...")
              : (language === "ar" ? "4) استيراد إلى المرحلة (Preview)" : "4) Stage import (Preview)")}
          </Button>
        </div>
      )}

      {batchId !== null && (
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-4 space-y-4">
          <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {language === "ar" ? "5) مراجعة الصفوف" : "5) Review staged rows"}
          </h4>

          {batchLoading ? (
            <p className="text-sm text-stone-500">{language === "ar" ? "جاري تحميل الملخص..." : "Loading summary..."}</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              <div className="p-2 rounded bg-stone-100 dark:bg-stone-800">Total: {batchData?.total_rows ?? 0}</div>
              <div className="p-2 rounded bg-emerald-100 dark:bg-emerald-900/20">Valid: {batchData?.valid_rows ?? 0}</div>
              <div className="p-2 rounded bg-amber-100 dark:bg-amber-900/20">Invalid: {batchData?.invalid_rows ?? 0}</div>
              <div className="p-2 rounded bg-orange-100 dark:bg-orange-900/20">Duplicate: {batchData?.duplicate_rows ?? 0}</div>
              <div className="p-2 rounded bg-blue-100 dark:bg-blue-900/20">Migrated: {batchData?.migrated_rows ?? 0}</div>
              <div className="p-2 rounded bg-violet-100 dark:bg-violet-900/20">
                Category: {batchData?.patient_category === "oncology" ? (language === "ar" ? "أورام" : "Oncology") : (language === "ar" ? "غير أورام" : "Non-oncology")}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleSelectAllValid} disabled={selectMutation.isPending || validRowIds.length === 0}>
              {language === "ar" ? "تحديد كل الصفوف الصالحة" : "Select all valid rows"}
            </Button>
            <Button variant="secondary" onClick={handleClearSelection} disabled={selectMutation.isPending || validRowIds.length === 0}>
              {language === "ar" ? "إلغاء التحديد" : "Clear selection"}
            </Button>
            <Button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending || selectedValidRows.length === 0}
            >
              {confirmMutation.isPending
                ? (language === "ar" ? "جاري ترحيل البيانات..." : "Migrating...")
                : (language === "ar" ? "6) تأكيد الترحيل إلى المرضى" : "6) Confirm migration to live patients")}
            </Button>
          </div>

          {rowsLoading ? (
            <p className="text-sm text-stone-500">{language === "ar" ? "جاري تحميل الصفوف..." : "Loading rows..."}</p>
          ) : (
            <div className="max-h-[420px] overflow-auto border border-stone-200 dark:border-stone-700 rounded">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 dark:bg-stone-800 sticky top-0">
                  <tr>
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">AR</th>
                    <th className="p-2 text-start">EN</th>
                    <th className="p-2 text-start">NID</th>
                    <th className="p-2 text-start">Phone</th>
                    <th className="p-2 text-start">Sex</th>
                    <th className="p-2 text-start">DOB</th>
                    <th className="p-2 text-start">Age</th>
                    <th className="p-2 text-start">Status</th>
                    <th className="p-2 text-start">Message</th>
                    <th className="p-2 text-start">Select</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsData.map((row) => (
                    <tr key={row.id} className="border-t border-stone-200 dark:border-stone-700">
                      <td className="p-2">{row.row_number}</td>
                      <td className="p-2">{row.arabic_full_name || "-"}</td>
                      <td className="p-2">{row.english_full_name || "-"}</td>
                      <td className="p-2">{row.national_id || "-"}</td>
                      <td className="p-2">{row.phone || "-"}</td>
                      <td className="p-2">{row.derived_sex || "-"}</td>
                      <td className="p-2">{row.derived_birth_date || "-"}</td>
                      <td className="p-2">{row.derived_age_years ?? "-"}</td>
                      <td className="p-2">{row.validation_status}</td>
                      <td className="p-2">{row.validation_message || "-"}</td>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={row.is_selected_for_migration}
                          disabled={row.validation_status !== "valid" || selectMutation.isPending}
                          onChange={(event) =>
                            selectMutation.mutate(
                              {
                                rowIds: [Number(row.id)],
                                selected: event.target.checked
                              },
                              {
                                onError: (err: unknown) => {
                                  if (isReauthError(err)) {
                                    setPendingRetry({
                                      kind: "select",
                                      rowIds: [Number(row.id)],
                                      selected: event.target.checked
                                    });
                                    onReAuthRequired(["patient-import"]);
                                  }
                                }
                              }
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const BackupRestoreSection = forwardRef<{ onReAuthSuccess: () => void }, { onReAuthRequired: (key: string[]) => void }>(
  function BackupRestoreSection({ onReAuthRequired }, ref) {
  const { t } = useLanguage();
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreComplete, setRestoreComplete] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartRequested, setRestartRequested] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<unknown>(null);
  const [restorePreview, setRestorePreview] = useState<{
    manifest: {
      createdAt: string;
      schemas: string[];
      tableCounts: Record<string, number>;
      documents: { rows: number; filesIncluded: number; filesMissing: number };
    };
    tables: Array<{ name: string; rows: number }>;
    documents: { rows: number; filesIncluded: number; filesMissing: number };
    env: Array<{ name: string; value: string; isSecret: boolean; requiresReview: boolean }>;
    warnings: string[];
  } | null>(null);

  const restoreSteps = [
    { label: "File", done: Boolean(restoreFile), active: !restoreFile },
    { label: "Passphrase", done: restorePassphrase.length >= 8, active: Boolean(restoreFile) && restorePassphrase.length < 8 },
    { label: "Validate", done: Boolean(restorePreview), active: previewBusy || (Boolean(restoreFile) && restorePassphrase.length >= 8 && !restorePreview) },
    { label: "Confirm", done: restoreConfirmation === "RESTORE RISPRO", active: Boolean(restorePreview) && restoreConfirmation !== "RESTORE RISPRO" },
    { label: "Restore", done: restoreComplete, active: restoreBusy },
    { label: "Restart", done: false, active: restoreComplete }
  ];
  const restoreProgress = restoreComplete
    ? 100
    : Math.round((restoreSteps.filter((step) => step.done).length / restoreSteps.length) * 100);
  const exportProgress = backupBusy ? 70 : backupPassphrase.length >= 8 ? 35 : 0;

  useImperativeHandle(ref, () => ({
    onReAuthSuccess: handleReAuthSuccess
  }));

  const parseErrorMessage = async (response: Response) => {
    const responseData = await response.json().catch(() => null);
    return (
      (responseData?.error && typeof responseData.error === "object" && responseData.error.message) ||
      responseData?.message ||
      (responseData?.error && typeof responseData.error === "string" ? responseData.error : null) ||
      `HTTP ${response.status}`
    );
  };

  const downloadBackup = async () => {
    if (backupPassphrase.length < 8) {
      setRestoreMessage({ type: "error", text: "Backup passphrase must be at least 8 characters." });
      return;
    }

    setBackupBusy(true);
    setRestoreMessage(null);
    try {
      const response = await fetch("/api/admin/backup", {
        method: "GET",
        credentials: "include",
        headers: { "x-backup-passphrase": backupPassphrase }
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "backup"]);
          throw new Error("Recent supervisor re-authentication is required. Try download again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] || `rispro-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setRestoreMessage({ type: "success", text: "Backup downloaded. Keep the file and passphrase together in a secure place." });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "Backup failed." });
    } finally {
      setBackupBusy(false);
    }
  };

  const readRestorePayload = async () => {
    if (!restoreFile) {
      throw new Error("Select a backup file first.");
    }
    const content = await restoreFile.text();
    return JSON.parse(content);
  };

  const handlePreview = async () => {
    if (restorePassphrase.length < 8) {
      setRestoreMessage({ type: "error", text: "Restore passphrase must be at least 8 characters." });
      return;
    }

    setPreviewBusy(true);
    setRestoreMessage(null);
    setRestorePreview(null);
    try {
      const backup = await readRestorePayload();
      const response = await fetch("/api/admin/restore/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup, passphrase: restorePassphrase })
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "restore", "preview"]);
          throw new Error("Recent supervisor re-authentication is required. Validate again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      setRestorePreview(await response.json());
      setRestoreMessage({ type: "success", text: "Backup validated. Review the preview before restoring." });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "Restore preview failed." });
    } finally {
      setPreviewBusy(false);
    }
  };

  const doRestore = async (payload: unknown) => {
    const response = await fetch("/api/admin/restore", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        backup: payload,
        passphrase: restorePassphrase,
        confirmation: restoreConfirmation
      })
    });

    if (!response.ok) {
      if (response.status === 403) {
        setPendingPayload(payload);
        onReAuthRequired(["admin", "restore"]);
        throw new Error("REAUTH_REQUIRED");
      }
      throw new Error(await parseErrorMessage(response));
    }

    const result = await response.json();
    setRestoreComplete(true);
    setRestoreMessage({
      type: "success",
      text: `Restore completed successfully. ${result.envVarsRestored || 0} env variables were restored. Restart the RISpro service to apply restored runtime settings.`
    });
    setRestoreFile(null);
    setPendingPayload(null);
    setRestorePreview(null);
  };

  const handleRestore = async () => {
    if (!restorePreview) {
      setRestoreMessage({ type: "error", text: "Validate the backup before restoring." });
      return;
    }
    if (restoreConfirmation !== "RESTORE RISPRO") {
      setRestoreMessage({ type: "error", text: "Type RESTORE RISPRO to confirm this destructive restore." });
      return;
    }

    setRestoreBusy(true);
    setRestoreMessage(null);

    try {
      const payload = await readRestorePayload();
      await doRestore(payload);
    } catch (err) {
      if (err instanceof Error && err.message === "REAUTH_REQUIRED") {
        setRestoreMessage({ type: "error", text: "Re-authentication required. Restore will retry after re-authenticating." });
      } else {
        const message = err instanceof Error ? err.message : "Restore failed.";
        setRestoreMessage({ type: "error", text: message });
      }
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleSystemRestart = async () => {
    if (!confirm("Restart RISpro now? The app may be unavailable for a few seconds while it starts again.")) {
      return;
    }

    setRestartBusy(true);
    setRestoreMessage(null);
    try {
      const response = await fetch("/api/admin/system/restart", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "system", "restart"]);
          throw new Error("Recent supervisor re-authentication is required. Click Restart again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      const result = await response.json();
      setRestartRequested(true);
      setRestoreMessage({
        type: "success",
        text: result.message || "RISpro restart requested. Wait a few seconds, then refresh if needed."
      });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "Restart request failed." });
    } finally {
      setRestartBusy(false);
    }
  };

  // Auto-retry restore after successful re-auth
  const handleReAuthSuccess = async () => {
    if (pendingPayload) {
      setRestoreBusy(true);
      setRestoreMessage({ type: "success", text: "Re-authenticated. Retrying restore..." });
      try {
        await doRestore(pendingPayload);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Restore failed.";
        setRestoreMessage({ type: "error", text: message });
      } finally {
        setRestoreBusy(false);
      }
    }
  };

  return (
    <div className="space-y-4">
      <p className="description-center">{t("settings.backupInfo")}</p>

      {restoreMessage && (
        <div className={`p-3 rounded-lg border text-sm ${
          restoreMessage.type === "success"
            ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400"
        }`}>
          {restoreMessage.text}
        </div>
      )}

      {restoreComplete && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300">
          <p className="font-semibold">Restore completed successfully.</p>
          <p className="mt-1">Patients, appointments, documents, settings, and encrypted runtime variables were restored. Restart RISpro to apply restored environment variables.</p>
          <button
            type="button"
            onClick={handleSystemRestart}
            disabled={restartBusy || restartRequested}
            className="btn-primary text-sm mt-3 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {restartRequested ? "Restart requested" : restartBusy ? "Requesting restart..." : "Restart RISpro safely"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {/* Download backup */}
        <div>
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">Export</h4>
          <div className="mb-3">
            <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
              <span>Passphrase</span>
              <span>{backupBusy ? "Preparing backup" : "Download"}</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="password"
              value={backupPassphrase}
              onChange={(event) => setBackupPassphrase(event.target.value)}
              placeholder="Backup encryption passphrase"
              className="input-premium text-sm flex-1"
              disabled={backupBusy}
            />
            <button
              type="button"
              onClick={downloadBackup}
              disabled={backupBusy || backupPassphrase.length < 8}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {backupBusy ? "Preparing..." : t("settings.downloadBackup")}
            </button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
            The backup includes database rows, document files, and encrypted runtime variables. The passphrase is required to restore it.
          </p>
        </div>

        <hr className="border-stone-200 dark:border-stone-700" />

        {/* Restore from backup */}
        <div>
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">Restore</h4>
          <div className="space-y-3">
            <input
              type="file"
              accept=".json"
              onChange={(e) => {
                setRestoreFile(e.target.files?.[0] || null);
                setRestorePreview(null);
                setRestoreConfirmation("");
                setRestoreComplete(false);
              }}
              className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-stone-100 dark:file:bg-stone-700 file:text-stone-700 dark:file:text-stone-300 file:hover:bg-stone-200 dark:file:hover:bg-stone-600 file:cursor-pointer file:transition-colors"
              disabled={restoreBusy || previewBusy}
            />
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="password"
                value={restorePassphrase}
                onChange={(event) => {
                  setRestorePassphrase(event.target.value);
                  setRestorePreview(null);
                  setRestoreConfirmation("");
                  setRestoreComplete(false);
                }}
                placeholder="Backup passphrase"
                className="input-premium text-sm flex-1"
                disabled={restoreBusy || previewBusy}
              />
              <button
                type="button"
                onClick={handlePreview}
                disabled={previewBusy || restoreBusy || !restoreFile || restorePassphrase.length < 8}
                className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewBusy ? "Validating..." : "Validate backup"}
              </button>
            </div>

            <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-3">
              <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${restoreProgress}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-6 gap-2">
                {restoreSteps.map((step, index) => (
                  <div
                    key={step.label}
                    className={`rounded-md border px-2 py-2 text-xs ${
                      step.done
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                        : step.active
                          ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                          : "border-stone-200 bg-white text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400"
                    }`}
                  >
                    <span className="font-semibold">{index + 1}. </span>
                    {step.label}
                  </div>
                ))}
              </div>
            </div>

            {restorePreview && (
              <div className="space-y-3 rounded-lg border border-stone-200 dark:border-stone-700 p-3 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <p className="text-xs text-stone-500 dark:text-stone-400">Created</p>
                    <p className="font-medium text-stone-900 dark:text-white">{formatDateTimeLy(restorePreview.manifest.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 dark:text-stone-400">Tables</p>
                    <p className="font-medium text-stone-900 dark:text-white">{restorePreview.tables.length}</p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 dark:text-stone-400">Document files</p>
                    <p className="font-medium text-stone-900 dark:text-white">
                      {restorePreview.documents.filesIncluded} included, {restorePreview.documents.filesMissing} missing
                    </p>
                  </div>
                </div>

                {restorePreview.warnings.length > 0 && (
                  <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2 text-amber-700 dark:text-amber-300">
                    {restorePreview.warnings.join(" ")}
                  </div>
                )}

                <div>
                  <p className="text-xs font-medium text-stone-600 dark:text-stone-300 mb-2">Runtime variables restored after review</p>
                  <div className="max-h-44 overflow-auto rounded border border-stone-200 dark:border-stone-700">
                    <table className="min-w-full text-xs">
                      <tbody>
                        {restorePreview.env.map((item) => (
                          <tr key={item.name} className="border-b border-stone-100 dark:border-stone-800 last:border-0">
                            <td className="px-2 py-1 font-mono text-stone-700 dark:text-stone-200">{item.name}</td>
                            <td className="px-2 py-1 font-mono text-stone-500 dark:text-stone-400">{item.value}</td>
                            <td className="px-2 py-1 text-stone-500 dark:text-stone-400">
                              {item.requiresReview ? "Review" : item.isSecret ? "Secret" : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <input
                  value={restoreConfirmation}
                  onChange={(event) => setRestoreConfirmation(event.target.value)}
                  placeholder="Type RESTORE RISPRO"
                  className="input-premium text-sm w-full"
                  disabled={restoreBusy}
                />
                <button
                  type="button"
                  onClick={handleRestore}
                  disabled={restoreBusy || restoreConfirmation !== "RESTORE RISPRO"}
                  className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {restoreBusy ? "Restoring..." : "Restore full system"}
                </button>
              </div>
            )}
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
            Restoring deletes current data and replaces database rows, documents, and .env variables from the backup. Restart RISpro after restore.
          </p>
        </div>
      </div>
    </div>
  );
  });


function SchedulingEngineConfigSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  // Lookup data for dropdowns
  const { data: modalityLookup } = useQuery<{ modalities: Record<string, unknown>[] }>({
    queryKey: ["modalities-settings"],
    queryFn: () => fetchModalitiesSettings(true),
    staleTime: 1000 * 60 * 10
  });
  const { data: examTypeLookup } = useQuery<{ examTypes: Record<string, unknown>[] }>({
    queryKey: ["exam-types-settings"],
    queryFn: () => fetchExamTypes(true),
    staleTime: 1000 * 60 * 10
  });

  type CategoryLimitRow = {
    id?: number;
    modalityId: string;
    caseCategory: "oncology" | "non_oncology";
    dailyLimit: string;
    isActive: boolean;
  };
  type BlockedRuleRow = {
    id?: number;
    modalityId: string;
    ruleType: "specific_date" | "date_range" | "yearly_recurrence";
    specificDate: string;
    startDate: string;
    endDate: string;
    recurStartMonth: string;
    recurStartDay: string;
    recurEndMonth: string;
    recurEndDay: string;
    isOverridable: boolean;
    isActive: boolean;
    title: string;
    notes: string;
  };
  type ExamRuleRow = {
    id?: number;
    modalityId: string;
    ruleType: "specific_date" | "date_range" | "weekly_recurrence";
    effectMode: "hard_restriction" | "restriction_overridable";
    specificDate: string;
    startDate: string;
    endDate: string;
    weekday: string;
    alternateWeeks: boolean;
    recurrenceAnchorDate: string;
    examTypeIds: number[];
    isActive: boolean;
    title: string;
    notes: string;
  };
  type SpecialQuotaRow = {
    id?: number;
    examTypeId: string;
    dailyExtraSlots: string;
    isActive: boolean;
  };
  type SpecialReasonRow = {
    code: string;
    labelEn: string;
    labelAr: string;
    isActive: boolean;
  };
  type IdentifierTypeRow = {
    id?: number;
    code: string;
    labelEn: string;
    labelAr: string;
    isActive: boolean;
  };
  type SchedulingDraft = {
    categoryLimits: CategoryLimitRow[];
    blockedRules: BlockedRuleRow[];
    examRules: ExamRuleRow[];
    specialQuotas: SpecialQuotaRow[];
    specialReasons: SpecialReasonRow[];
    identifierTypes: IdentifierTypeRow[];
  };

  const emptyDraft = (): SchedulingDraft => ({
    categoryLimits: [],
    blockedRules: [],
    examRules: [],
    specialQuotas: [],
    specialReasons: [],
    identifierTypes: []
  });
  const [draft, setDraft] = useState<SchedulingDraft>(emptyDraft());
  const { data, isLoading, error } = useQuery({
    queryKey: ["scheduling-engine-config"],
    queryFn: fetchSchedulingEngineConfig
  });

  const asArray = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const asText = (value: unknown): string => String(value ?? "").trim();
  const asDate = (value: unknown): string => String(value ?? "").slice(0, 10);
  const asBool = (value: unknown, fallback = true): boolean => {
    if (typeof value === "boolean") return value;
    const raw = String(value ?? "").toLowerCase();
    if (["1", "true", "yes", "enabled", "on"].includes(raw)) return true;
    if (["0", "false", "no", "disabled", "off"].includes(raw)) return false;
    return fallback;
  };
  const asNum = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  };

  // Build modality options for dropdowns
  const modalityOptions = useMemo(() => {
    const rows = Array.isArray(modalityLookup?.modalities) ? modalityLookup.modalities : [];
    return rows
      .filter((m: any) => m.isActive !== false)
      .map((m: any) => ({ value: String(m.id), label: m.nameEn || m.name_en || `Modality ${m.id}` }));
  }, [modalityLookup]);

  // Build exam type options for dropdowns
  const examTypeOptions = useMemo(() => {
    const rows = Array.isArray(examTypeLookup?.examTypes) ? examTypeLookup.examTypes : [];
    return rows
      .filter((et: any) => et.isActive !== false)
      .map((et: any) => ({ value: String(et.id), label: et.nameEn || et.name_en || `Exam ${et.id}` }));
  }, [examTypeLookup]);

  // Build exam type options with modality for filtering
  const examTypeOptionsWithModality = useMemo(() => {
    const rows = Array.isArray(examTypeLookup?.examTypes) ? examTypeLookup.examTypes : [];
    return rows
      .filter((et: any) => et.isActive !== false)
      .map((et: any) => ({
        value: String(et.id),
        label: et.nameEn || et.name_en || `Exam ${et.id}`,
        modalityId: et.modalityId ?? et.modality_id
      }));
  }, [examTypeLookup]);

  const normalizeConfig = (raw: SchedulingEngineConfig): SchedulingDraft => {
    const categoryLimits = asArray(raw.categoryLimits).map((row) => ({
      id: asNum(row.id) ?? undefined,
      modalityId: asText(row.modalityId ?? row.modality_id),
      caseCategory: (asText(row.caseCategory ?? row.case_category) === "oncology" ? "oncology" : "non_oncology") as
        | "oncology"
        | "non_oncology",
      dailyLimit: asText(row.dailyLimit ?? row.daily_limit ?? 0),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    const blockedRules = asArray(raw.blockedRules).map((row) => ({
      id: asNum(row.id) ?? undefined,
      modalityId: asText(row.modalityId ?? row.modality_id),
      ruleType: (asText(row.ruleType ?? row.rule_type) as BlockedRuleRow["ruleType"]) || "specific_date",
      specificDate: asDate(row.specificDate ?? row.specific_date),
      startDate: asDate(row.startDate ?? row.start_date),
      endDate: asDate(row.endDate ?? row.end_date),
      recurStartMonth: asText(row.recurStartMonth ?? row.recur_start_month),
      recurStartDay: asText(row.recurStartDay ?? row.recur_start_day),
      recurEndMonth: asText(row.recurEndMonth ?? row.recur_end_month),
      recurEndDay: asText(row.recurEndDay ?? row.recur_end_day),
      isOverridable: asBool(row.isOverridable ?? row.is_overridable, false),
      isActive: asBool(row.isActive ?? row.is_active, true),
      title: asText(row.title),
      notes: asText(row.notes)
    }));
    const examRules = asArray(raw.examRules).map((row) => ({
      id: asNum(row.id) ?? undefined,
      modalityId: asText(row.modalityId ?? row.modality_id),
      ruleType: (asText(row.ruleType ?? row.rule_type) as ExamRuleRow["ruleType"]) || "specific_date",
      effectMode:
        (asText(row.effectMode ?? row.effect_mode) as ExamRuleRow["effectMode"]) || "restriction_overridable",
      specificDate: asDate(row.specificDate ?? row.specific_date),
      startDate: asDate(row.startDate ?? row.start_date),
      endDate: asDate(row.endDate ?? row.end_date),
      weekday: asText(row.weekday),
      alternateWeeks: asBool(row.alternateWeeks ?? row.alternate_weeks, false),
      recurrenceAnchorDate: asDate(row.recurrenceAnchorDate ?? row.recurrence_anchor_date),
      examTypeIds: (
        Array.isArray(row.examTypeIds)
          ? (row.examTypeIds as unknown[])
          : Array.isArray(row.exam_type_ids)
            ? (row.exam_type_ids as unknown[])
            : []
      ).map((v: unknown) => Number(v)).filter((n: number) => Number.isInteger(n) && n > 0),
      isActive: asBool(row.isActive ?? row.is_active, true),
      title: asText(row.title),
      notes: asText(row.notes)
    }));
    const specialQuotas = asArray(raw.specialQuotas).map((row) => ({
      id: asNum(row.id) ?? undefined,
      examTypeId: asText(row.examTypeId ?? row.exam_type_id),
      dailyExtraSlots: asText(row.dailyExtraSlots ?? row.daily_extra_slots ?? 0),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    const specialReasons = asArray(raw.specialReasons).map((row) => ({
      code: asText(row.code),
      labelEn: asText(row.labelEn ?? row.label_en),
      labelAr: asText(row.labelAr ?? row.label_ar),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    const identifierTypes = asArray(raw.identifierTypes).map((row) => ({
      id: asNum(row.id) ?? undefined,
      code: asText(row.code),
      labelEn: asText(row.labelEn ?? row.label_en),
      labelAr: asText(row.labelAr ?? row.label_ar),
      isActive: asBool(row.isActive ?? row.is_active, true)
    }));
    return {
      categoryLimits,
      blockedRules,
      examRules,
      specialQuotas,
      specialReasons,
      identifierTypes
    };
  };

  const serializeDraft = (value: SchedulingDraft): SchedulingEngineConfig => ({
    categoryLimits: value.categoryLimits
      .filter((row) => row.modalityId.trim() && row.dailyLimit.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        modalityId: Number(row.modalityId),
        caseCategory: row.caseCategory,
        dailyLimit: Number(row.dailyLimit),
        isActive: row.isActive
      })),
    blockedRules: value.blockedRules
      .filter((row) => row.modalityId.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        modalityId: Number(row.modalityId),
        ruleType: row.ruleType,
        specificDate: row.specificDate || null,
        startDate: row.startDate || null,
        endDate: row.endDate || null,
        recurStartMonth: row.recurStartMonth ? Number(row.recurStartMonth) : null,
        recurStartDay: row.recurStartDay ? Number(row.recurStartDay) : null,
        recurEndMonth: row.recurEndMonth ? Number(row.recurEndMonth) : null,
        recurEndDay: row.recurEndDay ? Number(row.recurEndDay) : null,
        isOverridable: row.isOverridable,
        isActive: row.isActive,
        title: row.title,
        notes: row.notes
      })),
    examRules: value.examRules
      .filter((row) => row.modalityId.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        modalityId: Number(row.modalityId),
        ruleType: row.ruleType,
        effectMode: row.effectMode,
        specificDate: row.specificDate || null,
        startDate: row.startDate || null,
        endDate: row.endDate || null,
        weekday: row.weekday ? Number(row.weekday) : null,
        alternateWeeks: row.alternateWeeks,
        recurrenceAnchorDate: row.recurrenceAnchorDate || null,
        examTypeIds: row.examTypeIds,
        isActive: row.isActive,
        title: row.title,
        notes: row.notes
      })),
    specialQuotas: value.specialQuotas
      .filter((row) => row.examTypeId.trim() && row.dailyExtraSlots.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        examTypeId: Number(row.examTypeId),
        dailyExtraSlots: Number(row.dailyExtraSlots),
        isActive: row.isActive
      })),
    specialReasons: value.specialReasons
      .filter((row) => row.code.trim())
      .map((row) => ({
        code: row.code.trim(),
        labelEn: row.labelEn.trim(),
        labelAr: row.labelAr.trim(),
        isActive: row.isActive
      })),
    identifierTypes: value.identifierTypes
      .filter((row) => row.code.trim())
      .map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        code: row.code.trim(),
        labelEn: row.labelEn.trim(),
        labelAr: row.labelAr.trim(),
        isActive: row.isActive
      }))
  });

  useEffect(() => {
    if (data) {
      isSettingFromServer.current = true;
      setDraft(normalizeConfig(data));
    }
  }, [data]);

  const [saveNotice, setSaveNotice] = useState<"saved" | null>(null);
  const [quotaModalityFilter, setQuotaModalityFilter] = useState<string>("");
  const [quotaNotice, setQuotaNotice] = useState<string>("");
  const isSettingFromServer = useRef(false);

  // Clear save notice on any user edit (but not on server-set drafts)
  useEffect(() => {
    if (isSettingFromServer.current) {
      isSettingFromServer.current = false;
      return;
    }
    if (saveNotice !== null) {
      setSaveNotice(null);
    }
  }, [draft, saveNotice]);

  const saveMutation = useMutation({
    mutationFn: (payload: SchedulingEngineConfig) => saveSchedulingEngineConfig(payload),
    onSuccess: (returnedConfig) => {
      // Immediately replace local draft with the authoritative server response
      isSettingFromServer.current = true;
      setDraft(normalizeConfig(returnedConfig));
      setValidationErrors([]);
      setSaveNotice("saved");
      queryClient.invalidateQueries({ queryKey: ["scheduling-engine-config"] });
    }
  });
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const validateDraft = (value: SchedulingDraft): string[] => {
    const errors: string[] = [];

    value.categoryLimits.forEach((row, index) => {
      if (!row.modalityId.trim()) errors.push(`Daily category limits row ${index + 1}: modality is required.`);
      if (!row.dailyLimit.trim()) errors.push(`Daily category limits row ${index + 1}: daily limit is required.`);
    });

    value.blockedRules.forEach((row, index) => {
      if (!row.modalityId.trim()) errors.push(`Blocked dates row ${index + 1}: modality is required.`);
      if (row.ruleType === "specific_date" && !row.specificDate) {
        errors.push(`Blocked dates row ${index + 1}: specific date is required.`);
      }
      if (row.ruleType === "date_range" && (!row.startDate || !row.endDate)) {
        errors.push(`Blocked dates row ${index + 1}: start and end dates are required.`);
      }
      if (row.ruleType === "yearly_recurrence") {
        if (!row.recurStartMonth || !row.recurStartDay) {
          errors.push(`Blocked dates row ${index + 1}: recurrence start month/day is required.`);
        }
      }
    });

    value.examRules.forEach((row, index) => {
      if (!row.modalityId.trim()) errors.push(`Exam date rules row ${index + 1}: modality is required.`);
      if (!row.effectMode) errors.push(`Exam date rules row ${index + 1}: effect mode is required.`);
      if ((row.examTypeIds || []).length === 0) errors.push(`Exam date rules row ${index + 1}: select at least one exam type.`);
      if (row.ruleType === "specific_date" && !row.specificDate) {
        errors.push(`Exam date rules row ${index + 1}: specific date is required.`);
      }
      if (row.ruleType === "date_range" && (!row.startDate || !row.endDate)) {
        errors.push(`Exam date rules row ${index + 1}: start and end dates are required.`);
      }
      if (row.ruleType === "weekly_recurrence" && !row.weekday) {
        errors.push(`Exam date rules row ${index + 1}: weekday is required.`);
      }
    });

    value.specialQuotas.forEach((row, index) => {
      if (!row.examTypeId.trim()) errors.push(`Special quotas row ${index + 1}: exam type is required.`);
      if (!row.dailyExtraSlots.trim()) errors.push(`Special quotas row ${index + 1}: extra slots is required.`);
    });

    value.specialReasons.forEach((row, index) => {
      if (!row.code.trim()) errors.push(`Special reason codes row ${index + 1}: code is required.`);
      if (!row.labelEn.trim()) errors.push(`Special reason codes row ${index + 1}: English label is required.`);
      if (!row.labelAr.trim()) errors.push(`Special reason codes row ${index + 1}: Arabic label is required.`);
    });

    value.identifierTypes.forEach((row, index) => {
      if (!row.code.trim()) errors.push(`Patient identifier types row ${index + 1}: code is required.`);
      if (!row.labelEn.trim()) errors.push(`Patient identifier types row ${index + 1}: English label is required.`);
      if (!row.labelAr.trim()) errors.push(`Patient identifier types row ${index + 1}: Arabic label is required.`);
    });

    return errors;
  };

  if (error) {
    const msg = (error as Error).message;
    if ((error as { status?: number })?.status === 403 || msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["scheduling-engine-config"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading) {
    return <p className="description-center">{t("settings.loading")}</p>;
  }

  // ---- Small reusable field components ----
  const ModalitySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select className="input-field text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{t("settings.selectModality")}</option>
      {modalityOptions.map((opt: { value: string; label: string }) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );

  const ExamTypeMultiSelect = ({ values, onChange, modalityId }: { values: number[]; onChange: (ids: number[]) => void; modalityId?: string }) => {
    const toggle = (id: number) => {
      onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
    };
    const allExamTypes = Array.isArray(examTypeLookup?.examTypes) ? examTypeLookup.examTypes : [];
    const filteredOptions = modalityId
      ? examTypeOptions.filter((opt: { value: string }) => {
          const et = allExamTypes.find((examType: any) => String(examType.id) === opt.value);
          return et && String(et.modalityId || et.modality_id) === modalityId;
        })
      : [];
    return (
      <div className="space-y-1">
        {!modalityId && (
          <p className="text-[10px] text-stone-500">Select a modality first</p>
        )}
        {!!modalityId && filteredOptions.length === 0 && (
          <p className="text-[10px] text-stone-500">No exam types configured for selected modality</p>
        )}
        {!!modalityId && filteredOptions.length > 0 && (
          <>
            <p className="text-[10px] text-stone-500">Restricted exams</p>
            <p className="text-[10px] text-stone-500">Checked exams are the ones this rule blocks or restricts.</p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-[10px]" onClick={() => onChange(filteredOptions.map((opt: { value: string }) => Number(opt.value)))}>
                Select all
              </button>
              <button type="button" className="btn-secondary text-[10px]" onClick={() => onChange([])}>
                Clear all
              </button>
            </div>
          </>
        )}
        <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
          {filteredOptions.map((opt: { value: string; label: string }) => {
            const id = Number(opt.value);
            const checked = values.includes(id);
            return (
              <label key={opt.value} className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border cursor-pointer ${checked ? "bg-teal-50 dark:bg-teal-900/30 border-teal-300 dark:border-teal-700 text-teal-700 dark:text-teal-300" : "bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-400"}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(id)} className="sr-only" />
                {opt.label}
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  const WeekdaySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select className="input-field text-xs" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select weekday…</option>
      {Object.entries(WEEKDAY_LABELS).map(([k, v]) => (
        <option key={k} value={k}>{v}</option>
      ))}
    </select>
  );

  // ---- Section renderer ----
  const renderSection = (
    key: keyof SchedulingDraft,
    title: string,
    helper: string,
    addRow: () => void,
    renderRow: (row: Record<string, unknown>, index: number) => React.ReactNode
  ) => (
    <section className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-medium text-sm">{title}</h4>
        <button type="button" className="btn-secondary text-xs" onClick={addRow}>
          {ACTION_LABELS.add[key]}
        </button>
      </div>
      <details className="space-y-2" open>
        <summary className="cursor-pointer list-none text-[11px] text-stone-500 dark:text-stone-400">
          {helper}
        </summary>
        {draft[key].map((row, index) => renderRow(row as Record<string, unknown>, index))}
        {draft[key].length === 0 && (
          <p className="text-[11px] text-stone-400 dark:text-stone-500 italic">No rows configured yet.</p>
        )}
      </details>
    </section>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm description-center">
        Set the booking rules staff use every day. Each section controls one part of appointment access.
      </p>

      {/* A. Category Daily Limits */}
      {renderSection("categoryLimits", SECTION_TITLES.categoryLimits, SECTION_HELPERS.categoryLimits,
        () => setDraft((prev) => ({
          ...prev,
          categoryLimits: [...prev.categoryLimits, { modalityId: "", caseCategory: "non_oncology", dailyLimit: "0", isActive: true }]
        })),
        (row, idx) => (
          <div key={`cl-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
            <ModalitySelect value={row.modalityId as string} onChange={(v) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, modalityId: v } : r) }))} />
            <select className="input-field text-xs" value={row.caseCategory as string} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, caseCategory: e.target.value as "oncology" | "non_oncology" } : r) }))}>
              <option value="non_oncology">غير أورام</option>
              <option value="oncology">أورام</option>
            </select>
            <input className="input-field text-xs" type="number" min="0" placeholder="الحد اليومي" value={row.dailyLimit as string} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, dailyLimit: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, categoryLimits: prev.categoryLimits.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* B. Modality Blocked Rules */}
      {renderSection("blockedRules", SECTION_TITLES.blockedRules, SECTION_HELPERS.blockedRules,
        () => setDraft((prev) => ({
          ...prev,
          blockedRules: [...prev.blockedRules, { modalityId: "", ruleType: "specific_date", specificDate: "", startDate: "", endDate: "", recurStartMonth: "", recurStartDay: "", recurEndMonth: "", recurEndDay: "", isOverridable: false, isActive: true, title: "", notes: "" }]
        })),
        (row, idx) => (
          <div key={`br-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
            <ModalitySelect value={row.modalityId as string} onChange={(v) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, modalityId: v } : r) }))} />
            <select className="input-field text-xs" value={row.ruleType as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, ruleType: e.target.value as BlockedRuleRow["ruleType"] } : r) }))}>
              {Object.entries(RULE_TYPE_LABELS).filter(([k]) => k !== "weekly_recurrence").map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {row.ruleType === "specific_date" && (
              <input className="input-field text-xs" type="date" placeholder="تاريخ محدد" value={row.specificDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, specificDate: e.target.value } : r) }))} />
            )}
            {row.ruleType === "date_range" && (
              <>
                <input className="input-field text-xs" type="date" placeholder="تاريخ البداية" value={row.startDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, startDate: e.target.value } : r) }))} />
                <input className="input-field text-xs" type="date" placeholder="تاريخ النهاية" value={row.endDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, endDate: e.target.value } : r) }))} />
              </>
            )}
            {row.ruleType === "yearly_recurrence" && (
              <>
                <div className="flex gap-2">
                  <input className="input-field text-xs w-12" type="number" min="1" max="12" placeholder="MM" value={row.recurStartMonth as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurStartMonth: e.target.value } : r) }))} />
                  <input className="input-field text-xs w-12" type="number" min="1" max="31" placeholder="DD" value={row.recurStartDay as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurStartDay: e.target.value } : r) }))} />
                  <span className="text-[10px] text-stone-400 self-center">بداية التكرار</span>
                </div>
                <div className="flex gap-2">
                  <input className="input-field text-xs w-12" type="number" min="1" max="12" placeholder="MM" value={row.recurEndMonth as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurEndMonth: e.target.value } : r) }))} />
                  <input className="input-field text-xs w-12" type="number" min="1" max="31" placeholder="DD" value={row.recurEndDay as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, recurEndDay: e.target.value } : r) }))} />
                  <span className="text-[10px] text-stone-400 self-center">نهاية التكرار</span>
                </div>
              </>
            )}
            <input className="input-field text-xs" placeholder="العنوان (اختياري)" value={row.title as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, title: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="ملاحظات (اختياري)" value={row.notes as string} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, notes: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isOverridable as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, isOverridable: e.target.checked } : r) }))} /> {ACTION_LABELS.overridable}</label>
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, blockedRules: prev.blockedRules.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* C. Exam Schedule Restriction Rules */}
      {renderSection("examRules", SECTION_TITLES.examRules, SECTION_HELPERS.examRules,
        () => setDraft((prev) => ({
          ...prev,
          examRules: [...prev.examRules, { modalityId: "", ruleType: "specific_date", effectMode: "restriction_overridable", specificDate: "", startDate: "", endDate: "", weekday: "", alternateWeeks: false, recurrenceAnchorDate: "", examTypeIds: [], isActive: true, title: "", notes: "" }]
        })),
        (row, idx) => (
          <div key={`er-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-start">
            <ModalitySelect value={row.modalityId as string} onChange={(v) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, modalityId: v, examTypeIds: [] } : r) }))} />
            <select className="input-field text-xs" value={row.ruleType as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, ruleType: e.target.value as ExamRuleRow["ruleType"] } : r) }))}>
              <option value="specific_date">{RULE_TYPE_LABELS.specific_date}</option>
              <option value="date_range">{RULE_TYPE_LABELS.date_range}</option>
              <option value="weekly_recurrence">{RULE_TYPE_LABELS.weekly_recurrence}</option>
            </select>
            <select className="input-field text-xs" value={row.effectMode as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, effectMode: e.target.value as ExamRuleRow["effectMode"] } : r) }))}>
              <option value="restriction_overridable">{EFFECT_MODE_LABELS.restriction_overridable}</option>
              <option value="hard_restriction">{EFFECT_MODE_LABELS.hard_restriction}</option>
            </select>
            <div className="md:col-span-1">
              <ExamTypeMultiSelect
                values={(row.examTypeIds as number[]) || []}
                onChange={(ids) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, examTypeIds: ids } : r) }))}
                modalityId={row.modalityId as string}
              />
            </div>
            {row.ruleType === "specific_date" && (
              <input className="input-field text-xs" type="date" placeholder="تاريخ محدد" value={row.specificDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, specificDate: e.target.value } : r) }))} />
            )}
            {row.ruleType === "date_range" && (
              <>
                <input className="input-field text-xs" type="date" placeholder="تاريخ البداية" value={row.startDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, startDate: e.target.value } : r) }))} />
                <input className="input-field text-xs" type="date" placeholder="تاريخ النهاية" value={row.endDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, endDate: e.target.value } : r) }))} />
              </>
            )}
            {row.ruleType === "weekly_recurrence" && (
              <>
                <div className="space-y-1">
                  <p className="text-[10px] text-stone-500">اليوم</p>
                  <WeekdaySelect value={row.weekday as string} onChange={(v) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, weekday: v } : r) }))} />
                </div>
                <input className="input-field text-xs" type="date" placeholder="تاريخ مرساة التكرار" value={row.recurrenceAnchorDate as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, recurrenceAnchorDate: e.target.value } : r) }))} />
                <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.alternateWeeks as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, alternateWeeks: e.target.checked } : r) }))} /> {ACTION_LABELS.alternateWeeks}</label>
              </>
            )}
            <input className="input-field text-xs" placeholder="العنوان (اختياري)" value={row.title as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, title: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="ملاحظات (اختياري)" value={row.notes as string} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, notes: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, examRules: prev.examRules.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, examRules: prev.examRules.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* D. Special Quotas */}
      <section className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-medium text-sm">{SECTION_TITLES.specialQuotas}</h4>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, specialQuotas: [...prev.specialQuotas, { examTypeId: "", dailyExtraSlots: "0", isActive: true }] }))}>
              {ACTION_LABELS.add.specialQuotas}
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={() => {
              const existingIds = new Set(draft.specialQuotas.map(q => q.examTypeId).filter(id => id.trim()));
              const allActiveExamTypes = examTypeOptionsWithModality.filter(et => !existingIds.has(et.value));
              if (allActiveExamTypes.length === 0) {
                setQuotaNotice("All exam types already added");
                return;
              }
              setDraft(prev => ({
                ...prev,
                specialQuotas: [
                  ...prev.specialQuotas,
                  ...allActiveExamTypes.map(et => ({ examTypeId: et.value, dailyExtraSlots: "0", isActive: true }))
                ]
              }));
              setQuotaNotice("");
            }}>
              Add all exams
            </button>
            <button type="button" className="btn-secondary text-xs" disabled={!quotaModalityFilter} onClick={() => {
              if (!quotaModalityFilter) {
                setQuotaNotice("Select a modality first");
                return;
              }
              const existingIds = new Set(draft.specialQuotas.map(q => q.examTypeId).filter(id => id.trim()));
              const allActiveExamTypes = examTypeOptionsWithModality.filter(et => !existingIds.has(et.value) && String(et.modalityId) === quotaModalityFilter);
              if (allActiveExamTypes.length === 0) {
                setQuotaNotice("No exam types found for selected modality");
                return;
              }
              setDraft(prev => ({
                ...prev,
                specialQuotas: [
                  ...prev.specialQuotas,
                  ...allActiveExamTypes.map(et => ({ examTypeId: et.value, dailyExtraSlots: "0", isActive: true }))
                ]
              }));
              setQuotaNotice("");
            }}>
              Add all for modality
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={() => {
              if (!confirm("Remove all special quota rows?")) return;
              setDraft(prev => ({ ...prev, specialQuotas: [] }));
              setQuotaNotice("");
            }}>
              Delete all
            </button>
            <button type="button" className="btn-secondary text-xs" disabled={!quotaModalityFilter} onClick={() => {
              if (!quotaModalityFilter) {
                setQuotaNotice("Select a modality first");
                return;
              }
              if (!confirm(`Remove all special quota rows for the selected modality?`)) return;
              const examTypeIds = new Set(
                examTypeOptionsWithModality
                  .filter(et => String(et.modalityId) === quotaModalityFilter)
                  .map(et => et.value)
              );
              setDraft(prev => ({
                ...prev,
                specialQuotas: prev.specialQuotas.filter(q => !examTypeIds.has(q.examTypeId))
              }));
              setQuotaNotice("");
            }}>
              Delete for modality
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-600 dark:text-stone-400">Filter by modality:</span>
          <select className="input-field text-xs" value={quotaModalityFilter} onChange={(e) => setQuotaModalityFilter(e.target.value)}>
            <option value="">All modalities</option>
            {modalityOptions.map((opt: { value: string; label: string }) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {quotaNotice && (
          <p className="text-xs text-amber-600 dark:text-amber-400">{quotaNotice}</p>
        )}
        <details className="space-y-2" open>
          <summary className="cursor-pointer list-none text-[11px] text-stone-500 dark:text-stone-400">
            {SECTION_HELPERS.specialQuotas}
          </summary>
          <div className="space-y-2">
            {draft.specialQuotas.map((row, idx) => (
              <div key={`sq-${idx}`} className="grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                <select className="input-field text-xs" value={row.examTypeId as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.map((r, i) => i === idx ? { ...r, examTypeId: e.target.value } : r) }))}>
                  <option value="">Select exam type…</option>
                  {examTypeOptions.map((opt: { value: string; label: string }) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input className="input-field text-xs" type="number" min="0" placeholder="Extra slots per day" value={row.dailyExtraSlots as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.map((r, i) => i === idx ? { ...r, dailyExtraSlots: e.target.value } : r) }))} />
                <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
                <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, specialQuotas: prev.specialQuotas.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
              </div>
            ))}
            {draft.specialQuotas.length === 0 && (
              <p className="text-[11px] text-stone-400 dark:text-stone-500 italic">No rows configured yet.</p>
            )}
          </div>
        </details>
      </section>

      {/* E. Special Reason Codes */}
      {renderSection("specialReasons", SECTION_TITLES.specialReasons, SECTION_HELPERS.specialReasons,
        () => setDraft((prev) => ({ ...prev, specialReasons: [...prev.specialReasons, { code: "", labelEn: "", labelAr: "", isActive: true }] })),
        (row, idx) => (
          <div key={`sr-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
            <input className="input-field text-xs" placeholder="الرمز" value={row.code as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, code: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="English label" value={row.labelEn as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, labelEn: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="Arabic label" value={row.labelAr as string} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, labelAr: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, specialReasons: prev.specialReasons.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* F. Patient Identifier Types */}
      {renderSection("identifierTypes", SECTION_TITLES.identifierTypes, SECTION_HELPERS.identifierTypes,
        () => setDraft((prev) => ({ ...prev, identifierTypes: [...prev.identifierTypes, { code: "", labelEn: "", labelAr: "", isActive: true }] })),
        (row, idx) => (
          <div key={`it-${idx}`} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-center">
            <input className="input-field text-xs" placeholder="الرمز" value={row.code as string} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, code: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="English label" value={row.labelEn as string} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, labelEn: e.target.value } : r) }))} />
            <input className="input-field text-xs" placeholder="Arabic label" value={row.labelAr as string} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, labelAr: e.target.value } : r) }))} />
            <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={row.isActive as boolean} onChange={(e) => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.map((r, i) => i === idx ? { ...r, isActive: e.target.checked } : r) }))} /> {ACTION_LABELS.active}</label>
            <button type="button" className="btn-secondary text-xs" onClick={() => setDraft((prev) => ({ ...prev, identifierTypes: prev.identifierTypes.filter((_, i) => i !== idx) }))}>{ACTION_LABELS.remove}</button>
          </div>
        )
      )}

      {/* Save / Reset */}
      <div className="flex justify-between items-center pt-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={() => {
            if (data) setDraft(normalizeConfig(data));
          }}
        >
          {ACTION_LABELS.reset}
        </button>
        <button
          type="button"
          disabled={saveMutation.isPending}
          className="px-6 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-medium rounded-xl transition-colors text-sm"
          onClick={() => {
            const errors = validateDraft(draft);
            setValidationErrors(errors);
            if (errors.length > 0) return;
            saveMutation.mutate(serializeDraft(draft));
          }}
        >
          {saveMutation.isPending ? ACTION_LABELS.saving : ACTION_LABELS.save}
        </button>
      </div>

      {validationErrors.length > 0 && (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm">
          {validationErrors.slice(0, 8).map((error, index) => (
            <p key={`validation-${index}`}>{error}</p>
          ))}
          {validationErrors.length > 8 && <p>...and {validationErrors.length - 8} more.</p>}
        </div>
      )}

      {saveMutation.isError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {(saveMutation.error as Error)?.message || "Save failed"}
        </div>
      )}
      {saveNotice === "saved" && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-sm">
          Configuration saved successfully.
        </div>
      )}
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  receptionist: "Receptionist",
  supervisor: "Supervisor",
  modality_staff: "Technologist",
  doctor: "Doctor",
  administrative: "Administrative",
  super_admin: "Super Admin",
};

const PAGE_LABELS: Record<PageVisibilityRouteKey, string> = {
  dashboard: "Dashboard",
  patients: "Patients",
  appointments: "Appointments",
  "v2.appointments.admin": "Appointments Admin (V2)",
  calendar: "Calendar",
  registrations: "Registrations",
  queue: "Queue",
  "queue.checkin": "Queue Check-In",
  modality: "Modality",
  doctor: "Doctor",
  print: "Print",
  statistics: "Statistics",
  pacs: "PACS",
  "pacs.remap": "PACS remap",
  legacy: "Legacy",
  settings: "Settings",
};

function RolePageAccessSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PageVisibilityMatrix>(DEFAULT_PAGE_VISIBILITY_MATRIX);
  const [message, setMessage] = useState<string>("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["settings", "users_and_roles", "page_visibility_by_role"],
    queryFn: fetchPageVisibilityMatrix,
    staleTime: 1000 * 60,
    retry: false,
  });

  useEffect(() => {
    if (!data) return;
    setDraft(normalizePageVisibilityMatrix(data));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.settings.includes("super_admin")) {
        throw new Error("Settings access must always include Super Admin.");
      }
      return savePageVisibilityMatrix(draft);
    },
    onSuccess: async (saved) => {
      setDraft(normalizePageVisibilityMatrix(saved));
      setMessage("Role page visibility saved.");
      await queryClient.invalidateQueries({ queryKey: ["settings", "users_and_roles", "page_visibility_by_role"] });
    },
    onError: (err: unknown) => {
      if (isReAuthRequiredError(err)) {
        onReAuthRequired(["settings", "users_and_roles", "page_visibility_by_role"]);
        return;
      }
      setMessage(err instanceof Error ? err.message : "Failed to save role page visibility.");
    },
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "users_and_roles", "page_visibility_by_role"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading) return <p className="description-center">Loading role page access...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm description-center">
        Configure which roles can see which pages in navigation. This affects sidebar/mobile visibility only.
      </p>
      <div className="overflow-auto border border-stone-200 dark:border-stone-700 rounded-lg">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="bg-stone-100 dark:bg-stone-800">
              <th className="text-start p-2 font-semibold">Page</th>
              {PAGE_VISIBILITY_ROLES.map((role) => (
                <th key={role} className="text-center p-2 font-semibold">{ROLE_LABELS[role]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAGE_VISIBILITY_ROUTE_KEYS.map((routeKey) => (
              <tr key={routeKey} className="border-t border-stone-200 dark:border-stone-700">
                <td className="p-2">{PAGE_LABELS[routeKey]}</td>
                {PAGE_VISIBILITY_ROLES.map((role) => {
                  const checked = draft[routeKey]?.includes(role) ?? false;
                  const isSettingsSuperAdmin = routeKey === "settings" && role === "super_admin";
                  return (
                    <td key={`${routeKey}-${role}`} className="text-center p-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isSettingsSuperAdmin}
                        onChange={(event) => {
                          setDraft((prev) => {
                            const currentRoles = prev[routeKey] || [];
                            const nextRoles = event.target.checked
                              ? [...currentRoles, role]
                              : currentRoles.filter((r) => r !== role);
                            const next = {
                              ...prev,
                              [routeKey]: Array.from(new Set(nextRoles)),
                            } as PageVisibilityMatrix;
                            if (!next.settings.includes("super_admin")) {
                              next.settings = Array.from(new Set([...next.settings, "super_admin"]));
                            }
                            return next;
                          });
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary text-sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save"}
        </button>
        <button
          className="btn-secondary text-sm"
          onClick={() => setDraft(normalizePageVisibilityMatrix(data ?? DEFAULT_PAGE_VISIBILITY_MATRIX))}
          disabled={saveMutation.isPending}
        >
          Reset
        </button>
      </div>
      {message ? <div className="p-3 rounded border border-stone-200 dark:border-stone-700 text-sm">{message}</div> : null}
    </div>
  );
}

function QueryError({ message }: { message: string }) {
  const { t } = useLanguage();
  return (
    <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
      <p className="text-sm font-medium text-red-700 dark:text-red-400">{t("settings.failedLoad")}</p>
      <p className="text-xs text-red-600 dark:text-red-500 mt-1 font-mono break-all">{message}</p>
    </div>
  );
}

function DocumentsStorageSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const { t, language } = useLanguage();
  const [storagePath, setStoragePath] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authDomain, setAuthDomain] = useState("");
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [naps2WebScanEnabled, setNaps2WebScanEnabled] = useState(false);
  const [naps2WebScanEndpoint, setNaps2WebScanEndpoint] = useState("");
  const [scanDpi, setScanDpi] = useState("200");
  const [scanColorMode, setScanColorMode] = useState("grayscale");
  const [scannerSource, setScannerSource] = useState("feeder");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [resultMessage, setResultMessage] = useState<string>("");

  const { data: settings, error, isLoading } = useQuery({
    queryKey: ["settings", "documents_and_uploads"],
    queryFn: () => fetchSettings("documents_and_uploads"),
    staleTime: 1000 * 60,
  });

  useEffect(() => {
    if (!settings) return;
    setStoragePath(settings.storage_path || "");
    setAuthUsername(settings.storage_auth_username || "");
    setAuthPassword(settings.storage_auth_password || "");
    setAuthDomain(settings.storage_auth_domain || "");
    setFallbackEnabled(String(settings.storage_fallback_enabled || "true").toLowerCase() === "true");
    setNaps2WebScanEnabled(String(settings.naps2_webscan_enabled || "disabled").toLowerCase() === "enabled");
    setNaps2WebScanEndpoint(settings.scanner_bridge_endpoint || settings.naps2_webscan_endpoint || "");
    setScanDpi(settings.scan_dpi || "200");
    setScanColorMode(settings.scan_color_mode || "grayscale");
    setScannerSource(settings.scanner_source || "feeder");
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      saveSettings("documents_and_uploads", {
        entries: [
          { key: "storage_path", value: { value: storagePath } },
          { key: "storage_auth_username", value: { value: authUsername } },
          { key: "storage_auth_password", value: { value: authPassword } },
          { key: "storage_auth_domain", value: { value: authDomain } },
          { key: "storage_fallback_enabled", value: { value: String(fallbackEnabled) } },
          { key: "naps2_webscan_enabled", value: { value: naps2WebScanEnabled ? "enabled" : "disabled" } },
          { key: "scanner_bridge_endpoint", value: { value: naps2WebScanEndpoint } },
          { key: "naps2_webscan_endpoint", value: { value: naps2WebScanEndpoint } },
          { key: "scanner_bridge_mode", value: { value: naps2WebScanEnabled ? "naps2_webscan" : "manual_browser_upload" } },
          { key: "scan_dpi", value: { value: scanDpi } },
          { key: "scan_color_mode", value: { value: scanColorMode } },
          { key: "scanner_source", value: { value: scannerSource } },
          { key: "scan_file_format", value: { value: "pdf" } },
        ],
      }),
    onSuccess: () => {
      setResultMessage(t("settings.documents.saved"));
      queryClient.invalidateQueries({ queryKey: ["settings", "documents_and_uploads"] });
      queryClient.invalidateQueries({ queryKey: ["integration-status", "documents"] });
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.saveFailed"));
    },
  });

  const testMutation = useMutation({
    mutationFn: adminTestDocumentStorageConnectivity,
    onSuccess: (result) => {
      setResultMessage(result.ok ? t("settings.documents.connectivityOk", { message: result.message }) : t("settings.documents.connectivityFailed", { message: result.message }));
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.connectivityTestFailed"));
    },
  });

  const testNaps2Mutation = useMutation({
    mutationFn: () => scanAppointmentRequest({
      endpoint: naps2WebScanEndpoint,
      dpi: Number(scanDpi) || 200,
      colorMode: scanColorMode === "color" ? "color" : "grayscale",
      source: scannerSource === "flatbed" ? "flatbed" : scannerSource === "duplex" ? "duplex" : "feeder",
      fileName: "naps2-test-scan.pdf",
    }),
    onSuccess: (result) => {
      setResultMessage(t("settings.documents.naps2TestOk", { pageCount: result.pageCount, fileName: result.file.name }));
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.naps2TestFailed", { message: "NAPS2.WebScan is not reachable." }));
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => adminBulkDeleteDocuments({ mode: "all" }),
    onSuccess: (result) => {
      setResultMessage(language === "ar"
        ? `تم حذف ${result.deletedCount} وثيقة. فشل: ${result.failedCount}.`
        : `Deleted ${result.deletedCount} documents. Failed: ${result.failedCount}.`);
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.deleteAllFailed"));
    },
  });

  const deleteRangeMutation = useMutation({
    mutationFn: () => adminBulkDeleteDocuments({ mode: "appointment_date_range", dateFrom, dateTo }),
    onSuccess: (result) => {
      setResultMessage(language === "ar"
        ? `تم حذف ${result.deletedCount} وثيقة ضمن النطاق. فشل: ${result.failedCount}.`
        : `Deleted ${result.deletedCount} documents in range. Failed: ${result.failedCount}.`);
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.deleteRangeFailed"));
    },
  });

  const moveAllMutation = useMutation({
    mutationFn: () => adminMoveDocumentsToStorage({ mode: "all" }),
    onSuccess: (result) => {
      setResultMessage(language === "ar"
        ? `تم نقل ${result.movedCount} وثيقة. تم التجاوز: ${result.skippedCount}. فشل: ${result.failedCount}.`
        : `Moved ${result.movedCount} docs. Skipped: ${result.skippedCount}. Failed: ${result.failedCount}.`);
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.moveAllFailed"));
    },
  });

  const moveRangeMutation = useMutation({
    mutationFn: () => adminMoveDocumentsToStorage({ mode: "appointment_date_range", dateFrom, dateTo }),
    onSuccess: (result) => {
      setResultMessage(language === "ar"
        ? `تم نقل ${result.movedCount} وثيقة ضمن النطاق. تم التجاوز: ${result.skippedCount}. فشل: ${result.failedCount}.`
        : `Moved ${result.movedCount} docs in range. Skipped: ${result.skippedCount}. Failed: ${result.failedCount}.`);
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.moveRangeFailed"));
    },
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "documents_and_uploads"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading) {
    return <p className="description-center">{t("settings.documents.loading")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-3">
        <h4 className="font-medium text-sm">{t("settings.documents.naps2Title")}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={naps2WebScanEnabled}
                onChange={(e) => setNaps2WebScanEnabled(e.target.checked)}
              />
              {t("settings.documents.naps2Enabled")}
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.naps2Endpoint")}</label>
            <input
              value={naps2WebScanEndpoint}
              onChange={(e) => setNaps2WebScanEndpoint(e.target.value)}
              placeholder="http://127.0.0.1:9810"
              className="input-premium w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scanDpi")}</label>
            <select value={scanDpi} onChange={(e) => setScanDpi(e.target.value)} className="input-premium w-full">
              <option value="150">150</option>
              <option value="200">200</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scanColorMode")}</label>
            <select value={scanColorMode} onChange={(e) => setScanColorMode(e.target.value)} className="input-premium w-full">
              <option value="grayscale">{t("settings.documents.grayscale")}</option>
              <option value="color">{t("settings.documents.color")}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scannerSource")}</label>
            <select value={scannerSource} onChange={(e) => setScannerSource(e.target.value)} className="input-premium w-full">
              <option value="feeder">{t("settings.documents.feeder")}</option>
              <option value="flatbed">{t("settings.documents.flatbed")}</option>
              <option value="duplex">{t("settings.documents.duplex")}</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => testNaps2Mutation.mutate()}
            disabled={testNaps2Mutation.isPending}
          >
            {testNaps2Mutation.isPending ? t("settings.documents.naps2Testing") : t("settings.documents.naps2Test")}
          </button>
        </div>
        <p className="text-xs description-center">{t("settings.documents.naps2Help")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.storagePath")}</label>
          <input value={storagePath} onChange={(e) => setStoragePath(e.target.value)} className="input-premium w-full" />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={fallbackEnabled} onChange={(e) => setFallbackEnabled(e.target.checked)} />
            {t("settings.documents.enableFallback")}
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.networkUsername")}</label>
          <input value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} className="input-premium w-full" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.networkPassword")}</label>
          <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="input-premium w-full" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.networkDomain")}</label>
          <input value={authDomain} onChange={(e) => setAuthDomain(e.target.value)} className="input-premium w-full" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => saveMutation.mutate()} className="btn-primary text-sm" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? t("common.loading") : t("settings.documents.save")}
        </button>
        <button onClick={() => testMutation.mutate()} className="btn-secondary text-sm" disabled={testMutation.isPending}>
          {testMutation.isPending ? t("common.loading") : t("settings.documents.testing")}
        </button>
      </div>

      <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-3">
        <h4 className="font-medium text-sm">{t("settings.documents.bulkJobs")}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs mb-1">{t("settings.documents.fromDate")}</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-premium w-full" />
          </div>
          <div>
            <label className="block text-xs mb-1">{t("settings.documents.toDate")}</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-premium w-full" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded"
            onClick={() => {
              if (!window.confirm(t("settings.documents.deleteAllConfirm"))) return;
              deleteAllMutation.mutate();
            }}
            disabled={deleteAllMutation.isPending}
          >
            {deleteAllMutation.isPending ? t("common.loading") : t("settings.documents.deleteAll")}
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded"
            onClick={() => {
              if (!dateFrom || !dateTo) {
                setResultMessage(t("settings.documents.selectBothDates"));
                return;
              }
              if (!window.confirm(t("settings.documents.deleteRangeConfirm"))) return;
              deleteRangeMutation.mutate();
            }}
            disabled={deleteRangeMutation.isPending}
          >
            {deleteRangeMutation.isPending ? t("common.loading") : t("settings.documents.deleteRange")}
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded"
            onClick={() => moveAllMutation.mutate()}
            disabled={moveAllMutation.isPending}
          >
            {moveAllMutation.isPending ? t("common.loading") : t("settings.documents.moveAll")}
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded"
            onClick={() => {
              if (!dateFrom || !dateTo) {
                setResultMessage(t("settings.documents.selectBothDates"));
                return;
              }
              moveRangeMutation.mutate();
            }}
            disabled={moveRangeMutation.isPending}
          >
            {moveRangeMutation.isPending ? t("common.loading") : t("settings.documents.moveRange")}
          </button>
        </div>
      </div>

      {resultMessage && (
        <div className="p-3 rounded border border-stone-200 dark:border-stone-700 text-sm">
          {resultMessage}
        </div>
      )}
    </div>
  );
}

function ReAuthPrompt({ onReAuthRequired }: { onReAuthRequired: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 space-y-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{t("settings.reauthRequired")}</p>
      <p className="text-xs text-amber-600 dark:text-amber-400">{t("settings.reauthHelp")}</p>
      <button onClick={onReAuthRequired} className="btn-primary text-sm">
        {t("common.reAuthenticate")}
      </button>
    </div>
  );
}
