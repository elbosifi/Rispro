import { useCallback, useEffect, useState, useRef, useImperativeHandle, forwardRef, useMemo, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  fetchUsers,
  fetchDoctorProfilesForAdmin,
  fetchExamTypes,
  fetchModalitiesSettings,
  type ModalitySettingsRow,
  fetchNameDictionary,
  fetchPatientNotAllowedNameWords,
  fetchSettings,
  fetchPageVisibilityMatrix,
  deleteUser,
  createUser,
  updateUserSchedulingOverridePermission,
  updateUserPassword,
  deleteNameDictionaryEntry,
  deletePatientNotAllowedNameWord,
  importNameDictionary,
  upsertNameDictionaryEntry,
  upsertPatientNotAllowedNameWord,
  createModality,
  deactivateModality,
  updateModality,
  deleteModality,
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
import { useAuth } from "@/providers/auth-provider";
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
import PasskeyConfigurationSection from "./passkey-configuration-section";
import PatientDuplicateResolverSection from "./patient-duplicate-resolver-section";
import SonicDicomReportsSection from "./sonicdicom-reports-section";
import ActionPinPolicySection from "./action-pin-policy-section";
import AuditLogSection from "./audit-log-section";
import SystemDiagnosticsSection from "./system-diagnostics-section";
import OhifViewerSection from "./ohif-viewer-section";
import RequestScanAutomationSection from "./request-scan-automation-section";
import AuthoritativeOrthancSection from "./authoritative-orthanc-section";
import QzTrayPrintingSection from "./qz-tray-printing-section";
import ExamTypesSection from "./exam-types-section";
import { isReAuthRequiredError } from "./settings-page.helpers";
import type {
  User,
  DoctorProfile,
  SchedulingEngineConfig
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

type SettingsSection =
  | "menu"
  | "patient_registration"
  | "patient_import"
  | "patient_duplicate_resolver"
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
  | "action_pin_policy"
  | "role_page_access"
  | "audit_log"
  | "exam_types"
  | "modalities"
  | "name_dictionary"
  | "not_allowed_name_words"
  | "appointment_slip"
  | "qz_tray"
  | "patient_qr_self_service"
  | "passkey_configuration"
  | "sonicdicom_reports"
  | "ohif_viewer"
  | "documents_and_uploads"
  | "backup_restore"
  | "system_diagnostics"
  | "request_scan_automation"
  | "authoritative_orthanc";

const SECTION_KEYS: SettingsSection[] = [
  "patient_registration",
  "patient_import",
  "patient_duplicate_resolver",
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
  "action_pin_policy",
  "role_page_access",
  "audit_log",
  "exam_types",
  "modalities",
  "not_allowed_name_words",
  "appointment_slip",
  "qz_tray",
  "patient_qr_self_service",
  "passkey_configuration",
  "sonicdicom_reports",
  "ohif_viewer",
  "documents_and_uploads",
  "backup_restore",
  "system_diagnostics",
  "request_scan_automation",
  "authoritative_orthanc"
];

type SettingsMenuSection = Exclude<SettingsSection, "menu">;
type SettingsGroup = "all" | "clinical" | "scheduling" | "integrations" | "admin" | "system";

const SECTION_GROUPS: Record<SettingsMenuSection, Exclude<SettingsGroup, "all">> = {
  patient_registration: "clinical",
  patient_import: "clinical",
  patient_duplicate_resolver: "clinical",
  exam_types: "clinical",
  modalities: "clinical",
  name_dictionary: "clinical",
  not_allowed_name_words: "clinical",
  appointment_slip: "clinical",
  qz_tray: "system",
  patient_qr_self_service: "clinical",
  passkey_configuration: "admin",
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
  ohif_viewer: "integrations",
  users: "admin",
  action_pin_policy: "admin",
  role_page_access: "admin",
  audit_log: "admin",
  documents_and_uploads: "system",
  backup_restore: "system",
  system_diagnostics: "system",
  request_scan_automation: "integrations",
  authoritative_orthanc: "integrations",
};

const SETTINGS_GROUPS: SettingsGroup[] = ["all", "clinical", "scheduling", "integrations", "admin", "system"];
const SETTINGS_MENU_SECTIONS = SECTION_KEYS as SettingsMenuSection[];

function sectionLabel(_t: (key: TranslationKey, params?: Record<string, string | number>) => string, section: SettingsSection): string {
  if (section === "patient_import") {
    return "Patient Import";
  }
  if (section === "patient_duplicate_resolver") {
    return "Patient Duplicate Resolver";
  }
  if (section === "patient_qr_self_service") {
    return "إعدادات صفحة المريض ورمز QR";
  }
  if (section === "passkey_configuration") {
    return "Passkey Configuration";
  }
  if (section === "appointment_slip") {
    return "Appointment Slip Settings";
  }
  if (section === "qz_tray") {
    return "Printing → QZ Tray";
  }
  if (section === "sonicdicom_reports") {
    return "SonicDICOM Reports";
  }
  if (section === "ohif_viewer") {
    return "OHIF Viewer";
  }
  if (section === "action_pin_policy") {
    return "Action PIN Policy";
  }
  if (section === "sante_worklist_hl7") {
    return "Sante Worklist Server";
  }
  if (section === "system_diagnostics") {
    return "System Diagnostics";
  }
  if (section === "request_scan_automation") {
    return "Request Scan Automation";
  }
  if (section === "authoritative_orthanc") {
    return "Authoritative Orthanc";
  }
  return _t(`settings.section.${section}` as TranslationKey);
}

function groupLabel(t: (key: TranslationKey, params?: Record<string, string | number>) => string, group: SettingsGroup): string {
  return t(`settings.group.${group}` as TranslationKey);
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const [section, setSection] = useState<SettingsSection>(() => new URLSearchParams(window.location.search).get("section") === "qz_tray" ? "qz_tray" : "menu");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroup>("all");
  const [showReAuthModal, setShowReAuthModal] = useState(false);
  const [pendingReAuthKeys, setPendingReAuthKeys] = useState<string[][]>([]);
  const [reauthVersion, setReauthVersion] = useState(0);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const backupRestoreRef = useRef<{ onReAuthSuccess: () => void }>(null);

  const handleReAuthSuccess = async () => {
    setShowReAuthModal(false);
    setReauthVersion((prev) => prev + 1);
    // Notify backup/restore section to retry after re-auth
    backupRestoreRef.current?.onReAuthSuccess();
    const keys = pendingReAuthKeys;
    setPendingReAuthKeys([]);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["auth-session"] }),
      ...keys.map((key) => queryClient.invalidateQueries({ queryKey: key })),
    ]);
  };

  const requestReAuth = (queryKey: string[]) => {
    setPendingReAuthKeys((prev) =>
      prev.some((key) => key.length === queryKey.length && key.every((part, index) => part === queryKey[index]))
        ? prev
        : [...prev, queryKey]
    );
    setShowReAuthModal(true);
  };

  const visibleSections = SETTINGS_MENU_SECTIONS.filter((key) => {
    if (key === "system_diagnostics" && user?.role !== "super_admin") return false;
    if (key === "passkey_configuration" && user?.role !== "super_admin") return false;
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
            {section === "action_pin_policy" && <ActionPinPolicySection onReAuthRequired={requestReAuth} />}
            {section === "role_page_access" && <RolePageAccessSection onReAuthRequired={requestReAuth} />}
            {section === "audit_log" && <AuditLogSection onReAuthRequired={requestReAuth} />}
            {section === "exam_types" && <ExamTypesSection onReAuthRequired={requestReAuth} />}
            {section === "modalities" && <ModalitiesSection onReAuthRequired={requestReAuth} />}
            {section === "name_dictionary" && <NameDictionarySection onReAuthRequired={requestReAuth} />}
            {section === "not_allowed_name_words" && <NotAllowedNameWordsSection onReAuthRequired={requestReAuth} />}
            {section === "appointment_slip" && <AppointmentSlipSettingsSection onReAuthRequired={requestReAuth} />}
            {section === "qz_tray" && <QzTrayPrintingSection />}
            {section === "patient_qr_self_service" && <PatientQrSettingsSection onReAuthRequired={requestReAuth} reauthVersion={reauthVersion} />}
            {section === "passkey_configuration" && user?.role === "super_admin" && <PasskeyConfigurationSection onReAuthRequired={requestReAuth} reauthVersion={reauthVersion} />}
            {section === "patient_duplicate_resolver" && <PatientDuplicateResolverSection onReAuthRequired={requestReAuth} />}
            {section === "sonicdicom_reports" && <SonicDicomReportsSection onReAuthRequired={requestReAuth} />}
            {section === "ohif_viewer" && <OhifViewerSection onReAuthRequired={requestReAuth} />}
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
            {section === "system_diagnostics" && user?.role === "super_admin" && <SystemDiagnosticsSection onReAuthRequired={requestReAuth} />}
            {section === "request_scan_automation" && user?.role === "super_admin" && <RequestScanAutomationSection onReAuthRequired={requestReAuth} reauthVersion={reauthVersion} />}
            {section === "authoritative_orthanc" && (user?.role === "supervisor" || user?.role === "super_admin") && <AuthoritativeOrthancSection onReAuthRequired={requestReAuth} />}

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

function safeDoctorProfileError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "An unexpected error occurred.";
}

function mutationErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
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

  const catalogImportIssueLabel = (value: unknown): unknown => {
    if (typeof value !== "object" || value === null) return undefined;
    const issue = value as Record<string, unknown>;
    return issue.errorType || issue.message;
  };

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
                            <div className="text-red-600 dark:text-red-300 max-w-xs">{row.errors.map(catalogImportIssueLabel).join(", ")}</div>
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
                            <div className="text-red-600 dark:text-red-300 max-w-xs">{row.errors.map(catalogImportIssueLabel).join(", ")}</div>
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

type ModalityFormState = {
  code: string;
  name_ar: string;
  name_en: string;
  daily_capacity: number;
  is_active: boolean;
  general_instruction_ar: string;
  general_instruction_en: string;
  safety_warning_ar: string;
  safety_warning_en: string;
  safety_warning_enabled: boolean;
};

type ModalityMutationSource = Pick<
  ModalitySettingsRow,
  | "code"
  | "name_ar"
  | "name_en"
  | "daily_capacity"
  | "is_active"
  | "general_instruction_ar"
  | "general_instruction_en"
  | "safety_warning_ar"
  | "safety_warning_en"
  | "safety_warning_enabled"
>;

const EMPTY_MODALITY_FORM: ModalityFormState = {
  code: "",
  name_ar: "",
  name_en: "",
  daily_capacity: 0,
  is_active: true,
  general_instruction_ar: "",
  general_instruction_en: "",
  safety_warning_ar: "",
  safety_warning_en: "",
  safety_warning_enabled: true
};

function ModalitiesSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { language, t } = useLanguage();
  const queryClient = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const { data, isLoading, error } = useQuery<{ modalities: ModalitySettingsRow[] }>({
    queryKey: ["modalities", showInactive ? "with-inactive" : "active"],
    queryFn: () => fetchModalitiesSettings(showInactive)
  });

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ModalityFormState>({ ...EMPTY_MODALITY_FORM });
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ModalityFormState>({ ...EMPTY_MODALITY_FORM });
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
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Deactivate failed")); }
  });
  const hardDeleteMutation = useMutation({
    mutationFn: (id: number) => deleteModality(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["modalities"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
      invalidateModalityDerivedAppointmentCaches(queryClient);
      setMutationError(null);
    },
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Hard delete failed")); }
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: ModalityMutationSource }) => updateModality(id, {
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
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Update failed")); }
  });
  const createMutation = useMutation({
    mutationFn: (data: ModalityFormState) => createModality({
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
      setCreateForm({ ...EMPTY_MODALITY_FORM });
      setMutationError(null);
    },
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Create failed")); }
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["modalities"])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;

  const modalities = Array.isArray(data?.modalities) ? data.modalities : [];

  const startEdit = (modality: ModalitySettingsRow) => {
    setEditingId(modality.id);
    setEditForm({
      code: modality.code,
      name_ar: modality.name_ar,
      name_en: modality.name_en,
      daily_capacity: modality.daily_capacity ?? 0,
      is_active: modality.is_active,
      general_instruction_ar: modality.general_instruction_ar || "",
      general_instruction_en: modality.general_instruction_en || "",
      safety_warning_ar: modality.safety_warning_ar || "",
      safety_warning_en: modality.safety_warning_en || "",
      safety_warning_enabled: modality.safety_warning_enabled !== false
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
      <span className="text-sm description-center">{modalities.length} modalities</span>

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

      {modalities.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 dark:border-stone-700 p-4 text-sm text-stone-500 dark:text-stone-400">
          لم يتم تكوين أي أجهزة بعد.
        </div>
      ) : (
      <ul className="divide-y divide-stone-200 dark:divide-stone-700">
        {modalities.map((modality) => (
          <li key={modality.id} className="py-3">
            {editingId === modality.id ? (
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
                  <button onClick={() => updateMutation.mutate({ id: modality.id, data: editForm })} disabled={updateMutation.isPending} className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm rounded">Save</button>
                  <button onClick={() => setEditingId(null)} className="px-3 py-1.5 bg-stone-100 dark:bg-stone-600 text-stone-700 dark:text-stone-300 text-sm rounded">إلغاء</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="text-start">
                  <p className="font-medium text-stone-900 dark:text-white">{chooseLocalized(language, modality.name_ar, modality.name_en) || modality.code || `Modality ${modality.id}`}</p>
                  <p className="text-sm description-center">{t("settings.capacity")}: {modality.daily_capacity ?? "-"}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${modality.is_active ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" : "bg-stone-100 dark:bg-stone-700 text-stone-600 dark:text-stone-400"}`}>
                    {modality.is_active ? t("settings.active") : t("settings.inactive")}
                  </span>
                  <button onClick={() => startEdit(modality)} className="px-2 py-1 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors">Edit</button>
                  {modality.is_active ? (
                    <button
                      onClick={() => {
                        if (window.confirm("Deactivate this modality? It will disappear from active lists.")) {
                          deactivateMutation.mutate(modality.id);
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
                          updateMutation.mutate({ id: modality.id, data: { ...modality, is_active: true } });
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
                        hardDeleteMutation.mutate(modality.id);
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
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Delete failed"));
    }
  });
  const deleteAllMutation = useMutation({
    mutationFn: async (ids: number[]) => { for (const id of ids) await deleteNameDictionaryEntry(id); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setMutationError(null); },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Delete all failed"));
    }
  });
  const updateMutation = useMutation({
    mutationFn: (_data: { arabicText: string; englishText: string }) => upsertNameDictionaryEntry(_data.arabicText, _data.englishText),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["name-dictionary"] }); setEditingId(null); setMutationError(null); },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Update failed"));
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
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        setCsvImportStage("idle");
        onReAuthRequired(["name-dictionary"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Import failed"));
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
      deleteAllMutation.mutate(entries.map((e) => e.id));
    }
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["name-dictionary"])} />;
    return <QueryError message={msg} />;
  }

  const allEntries = data?.entries ?? [];
  const filteredEntries = searchQuery
    ? allEntries.filter((e) =>
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
                filteredEntries.map((e) => (
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

function NotAllowedNameWordsSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["patient-not-allowed-name-words"],
    queryFn: fetchPatientNotAllowedNameWords
  });
  const [arabicText, setArabicText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const isReauthError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err || "");
    return message.includes("re-authentication") || message.includes("403");
  };

  const addMutation = useMutation({
    mutationFn: (word: string) => upsertPatientNotAllowedNameWord(word),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-not-allowed-name-words"] });
      setArabicText("");
      setMutationError(null);
    },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["patient-not-allowed-name-words"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Save failed"));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deletePatientNotAllowedNameWord(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patient-not-allowed-name-words"] });
      setMutationError(null);
    },
    onError: (error: unknown) => {
      if (isReauthError(error)) {
        onReAuthRequired(["patient-not-allowed-name-words"]);
        return;
      }
      setMutationError(mutationErrorMessage(error, "Delete failed"));
    }
  });

  if (error) {
    const msg = (error as Error).message;
    if (isReauthError(error)) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["patient-not-allowed-name-words"])} />;
    return <QueryError message={msg} />;
  }

  const allEntries = data?.entries ?? [];
  const filteredEntries = searchQuery
    ? allEntries.filter((entry) => entry.arabicText.includes(searchQuery))
    : allEntries;

  return (
    <div className="space-y-4">
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          const word = arabicText.trim();
          if (!word) return;
          addMutation.mutate(word);
        }}
      >
        <input
          value={arabicText}
          onChange={(event) => setArabicText(event.target.value)}
          placeholder="Arabic word"
          className="input-premium input-rtl flex-1"
        />
        <Button type="submit" disabled={addMutation.isPending || !arabicText.trim()}>
          {addMutation.isPending ? "Saving..." : "Add word"}
        </Button>
      </form>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search Arabic word..."
          className="input-premium input-rtl flex-1 min-w-[200px]"
        />
        <span className="text-sm description-center">{filteredEntries.length} / {allEntries.length} entries</span>
      </div>

      {isLoading ? <p className="description-center">{t("settings.loading")}</p> : (
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400 sticky top-0">
              <tr>
                <th className="text-start p-2">Arabic word</th>
                <th className="p-2 w-28"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
              {filteredEntries.length === 0 ? (
                <tr><td colSpan={2} className="p-8 text-center text-stone-500 dark:text-stone-400">No not-allowed words</td></tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-stone-50 dark:hover:bg-stone-700/30 transition-colors">
                    <td className="p-2 text-stone-900 dark:text-white input-rtl">{entry.arabicText}</td>
                    <td className="p-2 text-center">
                      <button
                        onClick={() => { if (window.confirm(`Delete "${entry.arabicText}"?`)) deleteMutation.mutate(entry.id); }}
                        className="px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                      >
                        Delete
                      </button>
                    </td>
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
  phone1_required: { label: "", type: "dropdown", options: [
    { value: "required", label: "مطلوب" },
    { value: "optional", label: "اختياري" }
  ]},
  dob_or_age_rule: { label: "DOB / Age Rule", type: "dropdown", options: [
    { value: "age_or_dob_required", label: "العمر أو تاريخ الميلاد مطلوب" },
    { value: "age_required", label: "العمر مطلوب" },
    { value: "dob_required", label: "تاريخ الميلاد مطلوب" }
  ]},
  national_id_required: { label: "", type: "dropdown", options: [
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
  exam_type_change_policy: { label: "تغيير نوع الفحص", type: "dropdown", options: [
    { value: "allowed_without_supervisor", label: "مسموح بدون مشرف" },
    { value: "supervisor_required", label: "يتطلب اعتماد مشرف" },
    { value: "disabled", label: "غير مسموح" }
  ]},
  allow_reception_override_requests_from_availability: { label: "Reception override requests from availability / طلبات تجاوز الاستقبال من شاشة التوفر", type: "dropdown", options: [
    { value: "enabled", label: "Enabled / مفعل" },
    { value: "disabled", label: "Disabled / غير مفعل" }
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
  auto_no_show_enabled: { label: "Automatic no-show after review time / تحويل الغياب تلقائياً بعد وقت المراجعة", type: "dropdown", options: [
    { value: "enabled", label: "Enabled / مفعل" },
    { value: "disabled", label: "Disabled / غير مفعل" }
  ]},
  no_show_confirmation_required: { label: "Require manual no-show confirmation / اشتراط تأكيد الغياب يدوياً", type: "dropdown", options: [
    { value: "enabled", label: "مفعل" },
    { value: "disabled", label: "غير مفعل" }
  ]},
  auto_no_show_cleanup_days: { label: "Old no-show cleanup days / تنظيف مواعيد الغياب القديمة", type: "number", min: "0", max: "30" }
  , no_show_grace_minutes: { label: "No-show booking-time grace (minutes)", type: "number", min: "0", max: "720" },
};

function inferSettingControl(key: string, value: string): SettingControl {
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
  if (category === "patient_registration" && key === "national_id_required") {
    return t("settings.patientRegistration.identifierRequired");
  }
  if (category === "patient_registration" && key === "phone1_required") {
    return t("settings.patientRegistration.phone1Required");
  }
  return key.replace(/_/g, " ");
}

type SimpleSettingEntry = {
  key: string;
  value: string;
};

function MrnPrefixSettingEditor({
  initialValue,
  isPending,
  onSave,
}: {
  initialValue: string;
  isPending: boolean;
  onSave: (value: string) => void;
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState(initialValue);

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-amber-800">{t("settings.patientRegistration.mrnPrefix")}</p>
        <p className="text-sm text-amber-700 mt-1">{t("settings.patientRegistration.mrnPrefixHint")}</p>
        <p className="text-sm text-amber-700 mt-2">{t("settings.patientRegistration.requiredFieldsHint")}</p>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-amber-700 mb-1.5">
            {t("settings.patientRegistration.mrnPrefix")}
          </label>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("settings.patientRegistration.mrnPrefix")}
            className="w-full px-3 py-2 text-sm rounded-lg border border-amber-200 bg-white text-stone-900 outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>
        <Button
          type="button"
          onClick={() => onSave(value)}
          disabled={isPending}
          className="sm:min-w-32"
        >
          {isPending ? t("settings.loading") : t("settings.save")}
        </Button>
      </div>
    </div>
  );
}

function SimpleSettingsSection({ category, onReAuthRequired }: { category: string; onReAuthRequired: (key: string[]) => void }) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["settings", category], queryFn: () => fetchSettings(category) });

  const [mutationError, setMutationError] = useState<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: (payload: { entries: SimpleSettingEntry[] }) => saveSettings(category, payload),
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
    onError: (error: unknown) => { setMutationError(mutationErrorMessage(error, "Save failed")); }
  });

  const handleSave = (key: string, value: string) => {
    saveMutation.mutate({ entries: [{ key, value }] });
  };

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", category])} />;
    return <QueryError message={msg} />;
  }
  if (isLoading) return <p className="description-center">{t("settings.loading")}</p>;
  const settingsValues: Record<string, string> = data ?? {};
  const serverMrnPrefix = String(data?.mrn_prefix ?? "");

  return (
    <div className="space-y-3">
      {category === "patient_registration" && (
        <MrnPrefixSettingEditor
          key={`mrn-prefix:${serverMrnPrefix}`}
          initialValue={serverMrnPrefix}
          isPending={saveMutation.isPending}
          onSave={(value) => saveMutation.mutate({ entries: [{ key: "mrn_prefix", value }] })}
        />
      )}
      {mutationError && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {mutationError}
          <button onClick={() => setMutationError(null)} className="ml-2 underline">إغلاق</button>
        </div>
      )}
      {Object.entries(settingsValues)
        .filter(([key]) => !(category === "patient_registration" && key === "mrn_prefix"))
        .map(([key, value]) => {
        const control = inferSettingControl(key, value);
        const label = control.label || friendlySettingLabel(category, key, t);
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

type BackupV3Preview = {
  ok: boolean;
  manifest: {
    formatVersion: number;
    createdAt: string;
    appName: string;
    packageVersion: string | null;
    gitCommit: string | null;
    migrationVersion: string | null;
  };
  counts: {
    tables: number;
    rows: number;
    archiveEntries: number;
    storageFiles: number;
    envVars: number;
  };
  warnings: string[];
  errors: string[];
};

type BackupV3PreviewJob = {
  previewJobId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "expired" | "consumed";
  progress: number;
  manifest: BackupV3Preview["manifest"] | null;
  counts: BackupV3Preview["counts"] | null;
  warnings: string[];
  errors: string[];
  failureDiagnostics: string | null;
  compatibilityClassification?: "same_version" | "older_supported" | "newer_than_runtime" | "unsupported_history" | null;
  compatibilityMessage?: string | null;
};

type BackupV3UploadSession = { uploadSessionId: string; status: string; receivedOffset: number; expectedSizeBytes: number; expiresAt: string; failureMessage?: string | null };

type BackupV3RestoreResult = {
  ok: boolean;
  dbRestored?: boolean;
  storageRestored?: boolean | "partial";
  externalDocumentsRestored?: boolean | "partial";
  envRestored?: boolean;
  restoreIncomplete?: boolean;
  restartRequired?: boolean;
  safetyBackupsCreated?: Record<string, unknown>;
  restoredCounts?: Record<string, unknown>;
  warnings?: string[];
  partialFailure?: { component?: string; message?: string; details?: unknown };
  env?: {
    envVarsRestored?: Array<{ name: string; value?: string; isSecret?: boolean }>;
    ignoredArchiveKeys?: string[];
    preservedLocalKeys?: Array<{ name: string; value?: string; isSecret?: boolean }>;
  };
};

type BackupV3RestoreStatus = {
  enabled: boolean;
  dbOnlyEnabled: boolean;
  requiresSuperAdmin: true;
  userCanExecute: boolean;
  recentReauthRequired: true;
  recentReauthSatisfied: boolean;
  confirmationText: string;
  acceptedArchiveExtensions: string[];
  disabledReason?: string;
};

type BackupControlDestination = {
  destination_id: string;
  name: string;
  destination_type: "local" | "smb" | "sftp" | "nextcloud" | "onedrive";
  enabled: boolean;
  config: Record<string, unknown>;
  credentialsConfigured: boolean;
  last_connection_at: string | null;
  last_connection_status: string | null;
  last_failure_message: string | null;
};

type BackupControlJob = {
  job_id: string;
  artifact_id?: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  archive_name: string | null;
  archive_size_bytes: string | number | null;
  failure_message: string | null;
  source_schedule_id?: string | null;
  destination_copies?: Array<{ destinationId: string; copyAttemptId?: string; status: string; remotePath?: string | null; failureMessage?: string | null }>;
};

type BackupControlSummary = {
  destinations?: number;
  enabled_destinations?: number;
  recent_failures?: number;
  overdue_schedules?: number;
  health?: "healthy" | "warning" | "critical";
  health_reasons?: string[];
  staging_free_bytes?: string | number | null;
  active_job?: { status?: string; archive_name?: string | null } | null;
  last_successful_backup?: { archive_name?: string | null; completed_at?: string | null; archive_size_bytes?: string | number | null } | null;
  last_verified_copy?: { destination_name?: string; destination_type?: string; completed_at?: string | null } | null;
  latest_restore_verification_attempt?: { status?: string; created_at?: string | null; started_at?: string | null; completed_at?: string | null; failure_message?: string | null } | null;
  last_successful_restore_verification?: { completed_at?: string | null } | null;
  next_schedule?: { name?: string; next_run_at?: string | null } | null;
  worker?: { heartbeat_at?: string | null; last_failure_message?: string | null } | null;
  encryption?: {
    state?: "fresh_setup_required" | "ready" | "restart_required" | "runtime_key_persistence_required" | "recovery_required" | "invalid_key" | "validation_unavailable" | "deliberate_reset_required";
    encryptionReady: boolean;
    setupRequired: boolean;
    restartRequired: boolean;
    setupAvailable: boolean;
    limitation?: string;
  };
};

type BackupControlSchedule = {
  schedule_id: string;
  name: string;
  frequency: "daily" | "weekdays" | "weekly" | "monthly";
  time_of_day: string;
  timezone: string;
  selected_weekdays: number[];
  selected_day_of_month: number | null;
  destination_ids: string[];
  retention_policy: Record<string, unknown>;
  restore_verification_frequency: "disabled" | "weekly" | "monthly";
  enabled: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
};

type BackupControlRestoreVerification = {
  restore_verification_job_id: string;
  job_id: string | null;
  archive_name: string | null;
  status: string;
  completed_at: string | null;
  failure_message: string | null;
  destination_name?: string | null;
  destination_type?: string | null;
  remote_path?: string | null;
  retrieval?: { fallbackToLocal?: boolean; retrievedSha256?: string; retrievedByteSize?: number; cleanupStatus?: string; restoreDrillStatus?: string };
};

const RESTORE_CONFIRMATION_TEXT = "RESTORE RISPRO";

function isSensitiveText(value: unknown): boolean {
  return /secret|password|token|passphrase|database_url|cookie|private/i.test(String(value || ""));
}

function safeDisplayValue(value: unknown): string {
  if (value == null) return "none";
  if (isSensitiveText(value)) return "********";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export const BackupRestoreSection = forwardRef<{ onReAuthSuccess: () => void }, { onReAuthRequired: (key: string[]) => void }>(
  function BackupRestoreSection({ onReAuthRequired }, ref) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreV3File, setRestoreV3File] = useState<File | null>(null);
  const [restoreV3SourceType, setRestoreV3SourceType] = useState<"artifact" | "destination_copy" | "upload_session">("upload_session");
  const [restoreV3ArtifactId, setRestoreV3ArtifactId] = useState("");
  const [restoreV3CopyAttemptId, setRestoreV3CopyAttemptId] = useState("");
  const [restoreV3Upload, setRestoreV3Upload] = useState<BackupV3UploadSession | null>(null);
  const [restoreV3PreviewJob, setRestoreV3PreviewJob] = useState<BackupV3PreviewJob | null>(null);
  const [backupPassphrase, setBackupPassphrase] = useState("");
  const [backupV3Passphrase, setBackupV3Passphrase] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreV3Passphrase, setRestoreV3Passphrase] = useState("");
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [restoreV3Confirmation, setRestoreV3Confirmation] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupV3Busy, setBackupV3Busy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewV3Busy, setPreviewV3Busy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreV3Busy, setRestoreV3Busy] = useState(false);
  const [restoreComplete, setRestoreComplete] = useState(false);
  const [restoreV3Result, setRestoreV3Result] = useState<BackupV3RestoreResult | null>(null);
  const [restartBusy, setRestartBusy] = useState(false);
  const [restartRequested, setRestartRequested] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingPayload, setPendingPayload] = useState<unknown>(null);
  const [, setFullRestoreEnabled] = useState<boolean | null>(null);
  const [restoreV3Status, setRestoreV3Status] = useState<BackupV3RestoreStatus | null>(null);
  const [fullRestoreStatus, setFullRestoreStatus] = useState("Checking v3 restore availability...");
  const [restoreV3Preview, setRestoreV3Preview] = useState<BackupV3Preview | null>(null);
  const [migrationRehearsal, setMigrationRehearsal] = useState<{ rehearsal_id: string; status: string; progress: number; promotion_ready: boolean; errors: string[]; validation_results: Record<string, unknown> } | null>(null);
  const [backupControlSummary, setBackupControlSummary] = useState<BackupControlSummary | null>(null);
  const [backupDestinations, setBackupDestinations] = useState<BackupControlDestination[]>([]);
  const [backupJobs, setBackupJobs] = useState<BackupControlJob[]>([]);
  const [backupSchedules, setBackupSchedules] = useState<BackupControlSchedule[]>([]);
  const [backupRestoreVerifications, setBackupRestoreVerifications] = useState<BackupControlRestoreVerification[]>([]);
  const [verificationCopyIds, setVerificationCopyIds] = useState<Record<string, string>>({});
  const [selectedBackupDestinationIds, setSelectedBackupDestinationIds] = useState<string[]>([]);
  const [backupControlBusy, setBackupControlBusy] = useState(false);
  const [backupControlMessage, setBackupControlMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [backupKeySetupId, setBackupKeySetupId] = useState<string | null>(null);
  const [backupRecoveryDownloaded, setBackupRecoveryDownloaded] = useState(false);
  const [backupRecoveryConfirmed, setBackupRecoveryConfirmed] = useState(false);
  const [backupInstallationRecoveryValue, setBackupInstallationRecoveryValue] = useState("");
  const [destinationForm, setDestinationForm] = useState({ name: "", type: "local" as BackupControlDestination["destination_type"], rootPath: "", baseUrl: "", username: "", remotePath: "", host: "", port: "22", hostFingerprint: "", server: "", share: "", subfolder: "", domain: "", password: "", appPassword: "", privateKey: "" });
  const [editingDestinationId, setEditingDestinationId] = useState<string | null>(null);
  const [automatedPassphrase, setAutomatedPassphrase] = useState("");
  const [scheduleForm, setScheduleForm] = useState({ name: "", frequency: "daily" as BackupControlSchedule["frequency"], timeOfDay: "02:00", weekday: "1", dayOfMonth: "1", retentionPreset: "7_daily_4_weekly_12_monthly", retentionDaily: "7", retentionWeekly: "4", retentionMonthly: "12", restoreVerificationFrequency: "weekly" as BackupControlSchedule["restore_verification_frequency"] });
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
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
  const exportV3Progress = backupV3Busy ? 70 : backupV3Passphrase.length >= 8 ? 35 : 0;
  const canExecuteV3Restore =
    restoreV3Status?.enabled === true &&
    restoreV3Status.userCanExecute === true &&
    restoreV3Status.recentReauthSatisfied === true;
  const v3PreviewHasErrors = Boolean(restoreV3Preview && (!restoreV3Preview.ok || restoreV3Preview.errors.length > 0));
  const isSuperAdmin = user?.role === "super_admin";
  // Deprecated V2 compatibility endpoints intentionally have no normal UI.
  const showDeprecatedV2Controls = new URLSearchParams(window.location.search).has("deprecated-v2");

  useImperativeHandle(ref, () => ({
    onReAuthSuccess: handleReAuthSuccess
  }));

  const parseErrorMessage = useCallback(async (response: Response) => {
    const responseData = await response.json().catch(() => null);
    return (
      (responseData?.error && typeof responseData.error === "object" && responseData.error.message) ||
      responseData?.message ||
      (responseData?.error && typeof responseData.error === "string" ? responseData.error : null) ||
      `HTTP ${response.status}`
    );
  }, []);

  const refreshBackupControl = useCallback(async () => {
    try {
      const [summaryResponse, destinationsResponse, jobsResponse, schedulesResponse, restoreVerificationsResponse] = await Promise.all([
        fetch("/api/backup-control/summary", { credentials: "include" }),
        fetch("/api/backup-control/destinations", { credentials: "include" }),
        fetch("/api/backup-control/jobs", { credentials: "include" }),
        fetch("/api/backup-control/schedules", { credentials: "include" }),
        fetch("/api/backup-control/restore-verifications", { credentials: "include" }),
      ]);
      if (summaryResponse.ok) setBackupControlSummary((await summaryResponse.json()) as BackupControlSummary);
      if (destinationsResponse.ok) {
        const result = (await destinationsResponse.json()) as { destinations?: BackupControlDestination[] };
        const destinations = result.destinations || [];
        setBackupDestinations(destinations);
        setSelectedBackupDestinationIds((current) => current.filter((id) => destinations.some((destination) => destination.destination_id === id)));
      }
      if (jobsResponse.ok) setBackupJobs(((await jobsResponse.json()) as { jobs?: BackupControlJob[] }).jobs || []);
      if (schedulesResponse.ok) setBackupSchedules(((await schedulesResponse.json()) as { schedules?: BackupControlSchedule[] }).schedules || []);
      if (restoreVerificationsResponse.ok) setBackupRestoreVerifications(((await restoreVerificationsResponse.json()) as { verifications?: BackupControlRestoreVerification[] }).verifications || []);
    } catch {
      // The legacy backup/restore controls remain available if the control API is temporarily unavailable.
    }
  }, []);

  const probeV3RestoreAvailability = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/restore/v3/status", {
        method: "GET",
        credentials: "include"
      });
      if (!response.ok) {
        const message = await parseErrorMessage(response);
        setFullRestoreEnabled(false);
        setRestoreV3Status(null);
        setFullRestoreStatus(message);
        return;
      }
      const status = (await response.json()) as BackupV3RestoreStatus;
      setRestoreV3Status(status);
      setFullRestoreEnabled(status.enabled);
      setFullRestoreStatus(status.enabled && status.userCanExecute && status.recentReauthSatisfied
        ? "V3 full restore is enabled for this authenticated super_admin session."
        : status.disabledReason || "V3 full restore execution is unavailable for this session.");
    } catch {
      setFullRestoreEnabled(false);
      setRestoreV3Status(null);
      setFullRestoreStatus("Could not confirm v3 full restore availability.");
    }
  }, [parseErrorMessage]);

  useEffect(() => {
    void probeV3RestoreAvailability();
    void refreshBackupControl();
  }, [probeV3RestoreAvailability, refreshBackupControl, user?.recentSupervisorReauth]);

  useEffect(() => {
    if (!backupRestoreVerifications.some((verification) => verification.status === "queued" || verification.status === "running")) return;
    const timer = window.setInterval(() => { void refreshBackupControl(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [backupRestoreVerifications, refreshBackupControl]);

  const runAutomatedBackupNow = async () => {
    if (!selectedBackupDestinationIds.length) {
      setBackupControlMessage({ type: "error", text: "Select at least one enabled destination." });
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch("/api/backup-control/run-now", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationIds: selectedBackupDestinationIds }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupControlMessage({ type: "success", text: "Backup job queued. The worker will generate and verify copies in the background." });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not queue backup job." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const createAutomatedDestination = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "destination"]);
      setBackupControlMessage({ type: "error", text: "Recent supervisor re-authentication is required to change backup destinations." });
      return;
    }
    if (!backupControlSummary?.encryption?.encryptionReady) {
      setBackupControlMessage({ type: "error", text: "Complete Backup security setup and restart RISpro before saving protected destination settings." });
      return;
    }
    const config = destinationForm.type === "local"
      ? { rootPath: destinationForm.rootPath }
      : destinationForm.type === "nextcloud"
        ? { serverUrl: destinationForm.baseUrl, username: destinationForm.username, remoteDirectory: destinationForm.remotePath }
        : destinationForm.type === "sftp"
          ? { host: destinationForm.host, port: Number(destinationForm.port), username: destinationForm.username, authenticationType: destinationForm.privateKey ? "private_key" : "password", remoteDirectory: destinationForm.remotePath, hostKeyFingerprint: destinationForm.hostFingerprint }
          : destinationForm.type === "smb"
            ? { server: destinationForm.server, share: destinationForm.share, subfolder: destinationForm.subfolder, domain: destinationForm.domain || undefined }
            : {};
    const enteredCredentials = destinationForm.type === "local"
      ? undefined
      : destinationForm.type === "nextcloud"
      ? { appPassword: destinationForm.appPassword }
      : destinationForm.type === "sftp"
        ? (destinationForm.privateKey ? { privateKey: destinationForm.privateKey } : { password: destinationForm.password })
        : destinationForm.type === "smb"
          ? { username: destinationForm.username, password: destinationForm.password }
          : undefined;
    const hasEnteredCredentials = Object.values(enteredCredentials || {}).some((value) => typeof value === "string" && value.length > 0);
    const credentials = editingDestinationId && !hasEnteredCredentials ? undefined : enteredCredentials;
    setBackupControlBusy(true);
    try {
      const response = await fetch(editingDestinationId ? `/api/backup-control/destinations/${editingDestinationId}` : "/api/backup-control/destinations", { method: editingDestinationId ? "PATCH" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: destinationForm.name, destinationType: destinationForm.type, config, ...(credentials === undefined ? {} : { credentials }) }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setDestinationForm({ name: "", type: "local", rootPath: "", baseUrl: "", username: "", remotePath: "", host: "", port: "22", hostFingerprint: "", server: "", share: "", subfolder: "", domain: "", password: "", appPassword: "", privateKey: "" });
      setEditingDestinationId(null);
      setBackupControlMessage({ type: "success", text: `Destination ${editingDestinationId ? "updated" : "saved"}. Test it before relying on a schedule.` });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save destination." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const editAutomatedDestination = (destination: BackupControlDestination) => {
    const config = destination.config;
    setEditingDestinationId(destination.destination_id);
    setDestinationForm({
      name: destination.name,
      type: destination.destination_type,
      rootPath: typeof config.rootPath === "string" ? config.rootPath : "",
      baseUrl: typeof config.serverUrl === "string" ? config.serverUrl : "",
      username: typeof config.username === "string" ? config.username : "",
      remotePath: typeof config.remoteDirectory === "string" ? config.remoteDirectory : "",
      host: typeof config.host === "string" ? config.host : "",
      port: typeof config.port === "number" ? String(config.port) : "22",
      hostFingerprint: typeof config.hostKeyFingerprint === "string" ? config.hostKeyFingerprint : "",
      server: typeof config.server === "string" ? config.server : "",
      share: typeof config.share === "string" ? config.share : "",
      subfolder: typeof config.subfolder === "string" ? config.subfolder : "",
      domain: typeof config.domain === "string" ? config.domain : "",
      password: "", appPassword: "", privateKey: "",
    });
  };

  const testAutomatedDestination = async (destinationId: string) => {
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/destinations/${destinationId}/test`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupControlMessage({ type: "success", text: "Destination connection and permissions verified." });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Destination test failed." });
      await refreshBackupControl();
    } finally {
      setBackupControlBusy(false);
    }
  };

  const saveAutomatedPassphrase = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "passphrase"]);
      return;
    }
    if (!backupControlSummary?.encryption?.encryptionReady) {
      setBackupControlMessage({ type: "error", text: "Complete Backup security setup and restart RISpro before saving the automated archive passphrase." });
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch("/api/backup-control/encryption-passphrase", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase: automatedPassphrase }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setAutomatedPassphrase("");
      setBackupControlMessage({ type: "success", text: "Automated archive passphrase is configured and stored encrypted." });
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save automated archive passphrase." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const generateBackupSecurityRecovery = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "security-setup"]);
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch("/api/backup-control/encryption-setup", { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      const result = (await response.json()) as { setupId: string };
      setBackupKeySetupId(result.setupId);
      setBackupRecoveryDownloaded(false);
      setBackupRecoveryConfirmed(false);
      setBackupControlMessage({ type: "success", text: "A one-time recovery copy is ready. Download it and store it separately from this server before saving setup." });
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not generate Backup security setup." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const downloadBackupSecurityRecovery = async () => {
    if (!backupKeySetupId) return;
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/encryption-setup/${backupKeySetupId}/recovery`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      const link = document.createElement("a");
      link.href = URL.createObjectURL(await response.blob());
      link.download = "rispro-backup-v3-encryption-key-recovery.txt";
      link.click();
      URL.revokeObjectURL(link.href);
      setBackupRecoveryDownloaded(true);
      setBackupRecoveryConfirmed(false);
      setBackupControlMessage({ type: "success", text: "Recovery copy downloaded once. Confirm it is stored separately, then save Backup security setup." });
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not download the Backup recovery copy." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const saveBackupSecuritySetup = async () => {
    if (!backupKeySetupId || !backupRecoveryDownloaded || !backupRecoveryConfirmed) return;
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/encryption-setup/${backupKeySetupId}/confirm`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupKeySetupId(null);
      setBackupRecoveryDownloaded(false);
      setBackupRecoveryConfirmed(false);
      setBackupControlMessage({ type: "success", text: "Backup security setup was saved securely. Restart RISpro now, then this page will confirm encryption is ready." });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save Backup security setup." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const recoverBackupInstallationKey = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "security-recovery"]);
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch("/api/backup-control/encryption-recovery", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recoveryValue: backupInstallationRecoveryValue }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupInstallationRecoveryValue("");
      setBackupControlMessage({ type: "success", text: "The installation credential-encryption key was validated and saved. Restart RISpro to load it." });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not recover the installation credential-encryption key." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const createAutomatedSchedule = async () => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "schedule"]);
      setBackupControlMessage({ type: "error", text: "Recent supervisor re-authentication is required to save a backup schedule." });
      return;
    }
    if (!selectedBackupDestinationIds.length) {
      setBackupControlMessage({ type: "error", text: "Select the enabled destinations this schedule should protect." });
      return;
    }
    setBackupControlBusy(true);
    try {
      const retentionPolicy = scheduleForm.retentionPreset === "custom"
        ? { daily: Number(scheduleForm.retentionDaily), weekly: Number(scheduleForm.retentionWeekly), monthly: Number(scheduleForm.retentionMonthly) }
        : { preset: scheduleForm.retentionPreset };
      const response = await fetch(editingScheduleId ? `/api/backup-control/schedules/${editingScheduleId}` : "/api/backup-control/schedules", { method: editingScheduleId ? "PATCH" : "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: scheduleForm.name, frequency: scheduleForm.frequency, timeOfDay: scheduleForm.timeOfDay, timezone: "Africa/Tripoli", selectedWeekdays: scheduleForm.frequency === "weekly" ? [Number(scheduleForm.weekday)] : [], selectedDayOfMonth: scheduleForm.frequency === "monthly" ? Number(scheduleForm.dayOfMonth) : null, destinationIds: selectedBackupDestinationIds, retentionPolicy, restoreVerificationFrequency: scheduleForm.restoreVerificationFrequency }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setScheduleForm({ name: "", frequency: "daily", timeOfDay: "02:00", weekday: "1", dayOfMonth: "1", retentionPreset: "7_daily_4_weekly_12_monthly", retentionDaily: "7", retentionWeekly: "4", retentionMonthly: "12", restoreVerificationFrequency: "weekly" });
      setEditingScheduleId(null);
      setBackupControlMessage({ type: "success", text: `Backup schedule ${editingScheduleId ? "updated" : "saved"} with weekly isolated restore verification.` });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not save backup schedule." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const toggleAutomatedSchedule = async (schedule: BackupControlSchedule) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "schedule"]);
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/schedules/${schedule.schedule_id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !schedule.enabled }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupControlMessage({ type: "success", text: `Schedule ${schedule.enabled ? "paused" : "resumed"}.` });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not update schedule." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const runBackupControlAction = async (url: string, init: RequestInit, successMessage: string) => {
    setBackupControlBusy(true);
    try {
      const response = await fetch(url, { credentials: "include", ...init });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      setBackupControlMessage({ type: "success", text: successMessage });
      await refreshBackupControl();
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Backup control action failed." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const toggleAutomatedDestination = async (destination: BackupControlDestination) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "destination"]);
      return;
    }
    await runBackupControlAction(`/api/backup-control/destinations/${destination.destination_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !destination.enabled }) }, `Destination ${destination.enabled ? "paused" : "resumed"}.`);
  };

  const deleteAutomatedSchedule = async (schedule: BackupControlSchedule) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth || !confirm(`Delete backup schedule ${schedule.name}?`)) return;
    await runBackupControlAction(`/api/backup-control/schedules/${schedule.schedule_id}`, { method: "DELETE" }, "Backup schedule deleted.");
  };

  const editAutomatedSchedule = (schedule: BackupControlSchedule) => {
    setEditingScheduleId(schedule.schedule_id);
    const savedPreset = typeof schedule.retention_policy.preset === "string" ? schedule.retention_policy.preset : "custom";
    const retentionPreset = savedPreset === "14_daily_12_monthly" || savedPreset === "30_daily" || savedPreset === "7_daily_4_weekly_12_monthly" ? savedPreset : "custom";
    setScheduleForm({ name: schedule.name, frequency: schedule.frequency, timeOfDay: schedule.time_of_day, weekday: String(schedule.selected_weekdays[0] ?? 1), dayOfMonth: String(schedule.selected_day_of_month ?? 1), retentionPreset, retentionDaily: String(schedule.retention_policy.daily ?? 0), retentionWeekly: String(schedule.retention_policy.weekly ?? 0), retentionMonthly: String(schedule.retention_policy.monthly ?? 0), restoreVerificationFrequency: schedule.restore_verification_frequency });
    setSelectedBackupDestinationIds(schedule.destination_ids);
  };

  const deleteAutomatedDestination = async (destination: BackupControlDestination) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth || !confirm(`Remove backup destination ${destination.name}? Destinations with backup history must be paused instead.`)) return;
    await runBackupControlAction(`/api/backup-control/destinations/${destination.destination_id}`, { method: "DELETE" }, "Backup destination removed.");
  };

  const retryAutomatedJob = async (job: BackupControlJob) => {
    await runBackupControlAction(`/api/backup-control/jobs/${job.job_id}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, "Destination-copy retry queued using the existing verified archive.");
  };

  const cancelAutomatedJob = async (job: BackupControlJob) => {
    if (!confirm("Cancel this queued backup before generation begins?")) return;
    await runBackupControlAction(`/api/backup-control/jobs/${job.job_id}/cancel`, { method: "POST" }, "Queued backup cancelled.");
  };

  const queueManualRestoreVerification = async (job: BackupControlJob) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "restore-verification"]);
      return;
    }
    const copyAttemptId = verificationCopyIds[job.job_id] || job.destination_copies?.find((copy) => copy.status === "verified")?.copyAttemptId;
    if (!copyAttemptId) { setBackupControlMessage({ type: "error", text: "Select a verified destination copy before running restore verification." }); return; }
    await runBackupControlAction(`/api/backup-control/jobs/${job.job_id}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ copyAttemptId }) }, "Restore verification queued against the selected destination copy.");
  };

  const previewAutomatedRetention = async (destination: BackupControlDestination) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth) {
      onReAuthRequired(["backup-control", "retention"]);
      return;
    }
    setBackupControlBusy(true);
    try {
      const response = await fetch(`/api/backup-control/destinations/${destination.destination_id}/retention/preview`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: { preset: "7_daily_4_weekly_12_monthly" } }) });
      if (!response.ok) throw new Error(await parseErrorMessage(response));
      const result = (await response.json()) as { plan?: { keep?: unknown[]; delete?: unknown[] } };
      setBackupControlMessage({ type: "success", text: `Retention preview: ${result.plan?.keep?.length || 0} copies retained and ${result.plan?.delete?.length || 0} eligible for safe deletion.` });
    } catch (error) {
      setBackupControlMessage({ type: "error", text: error instanceof Error ? error.message : "Could not preview retention." });
    } finally {
      setBackupControlBusy(false);
    }
  };

  const executeAutomatedRetention = async (destination: BackupControlDestination) => {
    if (!isSuperAdmin || !user?.recentSupervisorReauth || !confirm(`Apply the configured retention policy to ${destination.name}? Only eligible verified RISpro backups may be deleted.`)) return;
    await runBackupControlAction(`/api/backup-control/destinations/${destination.destination_id}/retention/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: { preset: "7_daily_4_weekly_12_monthly" } }) }, "Retention policy applied.");
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

  const downloadV3Backup = async () => {
    if (backupV3Passphrase.length < 8) {
      setRestoreMessage({ type: "error", text: "V3 backup passphrase must be at least 8 characters." });
      return;
    }

    setBackupV3Busy(true);
    setRestoreMessage(null);
    try {
      const response = await fetch("/api/admin/backup/v3", {
        method: "GET",
        credentials: "include",
        headers: { "x-backup-passphrase": backupV3Passphrase }
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "backup", "v3"]);
          throw new Error("Recent supervisor re-authentication is required. Try v3 download again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
      const filename = filenameMatch?.[1] || `rispro-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.rispro.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename.endsWith(".rispro.zip") ? filename : `${filename}.rispro.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setRestoreMessage({ type: "success", text: "V3 full app-stack backup downloaded. Keep the archive and passphrase in secure storage." });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "V3 backup failed." });
    } finally {
      setBackupV3Busy(false);
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

  const handleV3Preview = async () => {
    if (restoreV3Passphrase.length < 8) {
      setRestoreMessage({ type: "error", text: "Restore passphrase must be at least 8 characters." });
      return;
    }
    if (restoreV3SourceType === "artifact" && !restoreV3ArtifactId) { setRestoreMessage({ type: "error", text: "Select an existing local backup artifact." }); return; }
    if (restoreV3SourceType === "destination_copy" && !restoreV3CopyAttemptId) { setRestoreMessage({ type: "error", text: "Select a verified destination copy." }); return; }
    if (restoreV3SourceType === "upload_session" && !restoreV3File && !restoreV3Upload) { setRestoreMessage({ type: "error", text: "Select a .rispro.zip archive first." }); return; }

    setPreviewV3Busy(true);
    setRestoreMessage(null);
    setRestoreV3Preview(null);
    setRestoreV3Result(null);
    try {
      let upload = restoreV3Upload;
      if (restoreV3SourceType === "upload_session" && (!upload || upload.status !== "completed")) {
        if (!restoreV3File) throw new Error("Select a .rispro.zip archive first.");
        const created = await fetch("/api/admin/restore/v3/upload-sessions", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archiveName: restoreV3File.name, expectedSizeBytes: restoreV3File.size }) });
        if (!created.ok) throw new Error(await parseErrorMessage(created));
        upload = await created.json() as BackupV3UploadSession;
        setRestoreV3Upload(upload);
        const chunkBytes = 4 * 1024 * 1024;
        while (upload.receivedOffset < restoreV3File.size) {
          const chunk = restoreV3File.slice(upload.receivedOffset, Math.min(upload.receivedOffset + chunkBytes, restoreV3File.size));
          const chunkResponse = await fetch(`/api/admin/restore/v3/upload-sessions/${upload.uploadSessionId}/chunks`, { method: "PUT", credentials: "include", headers: { "X-Upload-Offset": String(upload.receivedOffset), "Content-Type": "application/octet-stream" }, body: chunk });
          if (!chunkResponse.ok) throw new Error(await parseErrorMessage(chunkResponse));
          upload = await chunkResponse.json() as BackupV3UploadSession;
          setRestoreV3Upload(upload);
        }
        const completed = await fetch(`/api/admin/restore/v3/upload-sessions/${upload.uploadSessionId}/complete`, { method: "POST", credentials: "include" });
        if (!completed.ok) throw new Error(await parseErrorMessage(completed));
        upload = await completed.json() as BackupV3UploadSession;
        setRestoreV3Upload(upload);
      }
      const source = restoreV3SourceType === "artifact" ? { type: "artifact", artifactId: restoreV3ArtifactId } : restoreV3SourceType === "destination_copy" ? { type: "destination_copy", copyAttemptId: restoreV3CopyAttemptId } : { type: "upload_session", uploadSessionId: upload!.uploadSessionId };
      const response = await fetch("/api/admin/restore/v3/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, passphrase: restoreV3Passphrase })
      });

      if (!response.ok) {
        if (response.status === 403) {
          onReAuthRequired(["admin", "restore", "v3", "preview"]);
          throw new Error("Recent supervisor re-authentication is required. Preview again after re-auth.");
        }
        throw new Error(await parseErrorMessage(response));
      }

      let job = await response.json() as BackupV3PreviewJob;
      setRestoreV3PreviewJob(job);
      for (let attempts = 0; attempts < 180 && (job.status === "queued" || job.status === "running"); attempts += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(`/api/admin/restore/v3/preview/${job.previewJobId}`, { method: "GET", credentials: "include" });
        if (!statusResponse.ok) throw new Error(await parseErrorMessage(statusResponse));
        job = await statusResponse.json() as BackupV3PreviewJob;
        setRestoreV3PreviewJob(job);
      }
      if (!job.manifest || !job.counts) throw new Error(job.failureDiagnostics || "Preview did not complete before polling timed out.");
      const preview: BackupV3Preview = { ok: job.status === "succeeded" && job.errors.length === 0, manifest: job.manifest, counts: job.counts, warnings: job.warnings, errors: job.errors };
      setRestoreV3Preview(preview);
      setRestoreMessage({
        type: preview.ok ? "success" : "error",
        text: preview.ok ? "V3 backup preview completed. Review all counts and warnings before restore." : "V3 backup preview found errors. Restore is blocked."
      });
      await probeV3RestoreAvailability();
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "V3 restore preview failed." });
    } finally {
      setPreviewV3Busy(false);
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

  const startMigrationRehearsal = async () => {
    if (!restoreV3PreviewJob) return;
    try {
      const started = await fetch(`/api/admin/restore/v3/preview/${restoreV3PreviewJob.previewJobId}/migration-rehearsals`, { method: "POST", credentials: "include" });
      if (!started.ok) throw new Error(await parseErrorMessage(started));
      let rehearsal = await started.json(); setMigrationRehearsal(rehearsal);
      for (let attempt = 0; attempt < 60 && ["queued", "running"].includes(rehearsal.status); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const status = await fetch(`/api/admin/restore/v3/migration-rehearsals/${rehearsal.rehearsal_id}`, { credentials: "include" });
        if (!status.ok) throw new Error(await parseErrorMessage(status)); rehearsal = await status.json(); setMigrationRehearsal(rehearsal);
      }
    } catch (error) { setRestoreMessage({ type: "error", text: error instanceof Error ? error.message : "Migration rehearsal could not start." }); }
  };

  const handleV3Restore = async () => {
    if (!restoreV3Preview) {
      setRestoreMessage({ type: "error", text: "Run v3 restore preview before restoring." });
      return;
    }
    if (v3PreviewHasErrors) {
      setRestoreMessage({ type: "error", text: "Preview errors block v3 restore execution." });
      return;
    }
    if (!canExecuteV3Restore) {
      setRestoreMessage({ type: "error", text: fullRestoreStatus });
      return;
    }
    if (!restoreV3PreviewJob || restoreV3PreviewJob.status !== "succeeded") {
      setRestoreMessage({ type: "error", text: "The successful preview job is no longer available. Preview again before restoring." });
      return;
    }
    if (restoreV3Confirmation !== RESTORE_CONFIRMATION_TEXT) {
      setRestoreMessage({ type: "error", text: "Type RESTORE RISPRO to confirm this destructive restore." });
      return;
    }

    setRestoreV3Busy(true);
    setRestoreMessage(null);
    setRestoreV3Result(null);
    try {
      const response = await fetch("/api/admin/restore/v3", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewJobId: restoreV3PreviewJob.previewJobId, passphrase: restoreV3Passphrase, confirmation: restoreV3Confirmation })
      });

      if (!response.ok) {
        if (response.status === 403) {
          await probeV3RestoreAvailability();
        }
        throw new Error(await parseErrorMessage(response));
      }

      const result = (await response.json()) as BackupV3RestoreResult;
      setRestoreV3Result(result);
      setRestoreMessage({
        type: result.ok && !result.restoreIncomplete ? "success" : "error",
        text: result.ok && !result.restoreIncomplete
          ? "V3 full app-stack restore completed. Restart RISpro before clinical use."
          : "V3 restore finished with a partial failure. Do not retry blindly; review logs and safety backups."
      });
    } catch (err) {
      setRestoreMessage({ type: "error", text: err instanceof Error ? err.message : "V3 restore failed." });
    } finally {
      setRestoreV3Busy(false);
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
      window.setTimeout(() => { void refreshBackupControl(); }, 5_000);
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
    await probeV3RestoreAvailability();
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

      <section className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-stone-900 dark:text-white">Automated Backup V3 control center</h4>
            <p className="mt-1 text-xs text-stone-700 dark:text-stone-300">RISpro backup does not include the Orthanc PACS image-storage tank. PACS studies require a separate backup or replication plan.</p>
          </div>
          <button type="button" onClick={() => void refreshBackupControl()} disabled={backupControlBusy} className="btn-secondary text-xs disabled:opacity-50">Refresh</button>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Backup health</span><p className={`font-semibold ${backupControlSummary?.health === "critical" ? "text-red-700 dark:text-red-300" : backupControlSummary?.health === "warning" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>{backupControlSummary?.health ? backupControlSummary.health[0].toUpperCase() + backupControlSummary.health.slice(1) : "Not assessed"}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Destinations</span><p className="font-semibold">{backupControlSummary?.enabled_destinations ?? 0} enabled / {backupControlSummary?.destinations ?? 0}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Failed jobs in the last 7 days</span><p className="font-semibold">{backupControlSummary?.recent_failures ?? 0}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Worker heartbeat</span><p className="font-semibold">{backupControlSummary?.worker?.heartbeat_at ? formatDateTimeLy(backupControlSummary.worker.heartbeat_at) : "Not reported"}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Last backup</span><p className="font-semibold">{backupControlSummary?.last_successful_backup?.completed_at ? formatDateTimeLy(backupControlSummary.last_successful_backup.completed_at) : "Never"}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Last verified copy</span><p className="font-semibold">{backupControlSummary?.last_verified_copy?.destination_name || "Never"}</p>{backupControlSummary?.last_verified_copy?.completed_at ? <p className="mt-1 text-stone-500">{formatDateTimeLy(backupControlSummary.last_verified_copy.completed_at)}</p> : null}</div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Last successful restore verification</span><p className="font-semibold">{backupControlSummary?.last_successful_restore_verification?.completed_at ? formatDateTimeLy(backupControlSummary.last_successful_restore_verification.completed_at) : "Never"}</p>{backupControlSummary?.latest_restore_verification_attempt ? <p className="mt-1 text-stone-500">Latest attempt: {backupControlSummary.latest_restore_verification_attempt.status}{backupControlSummary.latest_restore_verification_attempt.completed_at ? ` · ${formatDateTimeLy(backupControlSummary.latest_restore_verification_attempt.completed_at)}` : ""}</p> : null}</div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Next schedule</span><p className="font-semibold">{backupControlSummary?.next_schedule?.next_run_at ? formatDateTimeLy(backupControlSummary.next_schedule.next_run_at) : "Not scheduled"}</p></div>
          <div className="rounded bg-white/80 p-2 dark:bg-stone-900/60"><span className="text-stone-500">Archive limits</span><p className="font-semibold">ZIP64 · 3 GiB content / file · 60,000 files</p></div>
        </div>

        {backupControlSummary?.active_job && <p className="rounded border border-sky-200 bg-sky-100 p-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-100">Active backup job: {backupControlSummary.active_job.status}{backupControlSummary.active_job.archive_name ? ` · ${backupControlSummary.active_job.archive_name}` : ""}</p>}
        {backupControlSummary?.overdue_schedules ? <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">{backupControlSummary.overdue_schedules} automatic backup schedule{backupControlSummary.overdue_schedules === 1 ? " is" : "s are"} overdue.</p> : null}
        {backupControlSummary?.health_reasons?.length ? <ul className="list-disc space-y-1 pl-5 text-xs text-stone-700 dark:text-stone-300">{backupControlSummary.health_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
        {backupControlSummary?.staging_free_bytes != null && <p className="text-xs text-stone-600 dark:text-stone-300">Local staging space available: {Math.floor(Number(backupControlSummary.staging_free_bytes) / (1024 * 1024))} MiB.</p>}
        {backupControlSummary?.worker?.last_failure_message && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">Worker warning: {backupControlSummary.worker.last_failure_message}</p>}
        {backupControlMessage && <p className={`rounded border p-2 text-xs ${backupControlMessage.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200" : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"}`}>{backupControlMessage.text}</p>}

        {backupControlSummary?.encryption?.setupRequired && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100"><p className="font-semibold">Backup security setup required</p><p className="mt-1 text-xs">RISpro needs a permanent encryption key before it can safely store backup destination passwords and automated backup passphrases.</p>{backupControlSummary.encryption.limitation ? <p className="mt-2 text-xs">{backupControlSummary.encryption.limitation}</p> : isSuperAdmin ? <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => void generateBackupSecurityRecovery()} disabled={backupControlBusy || !user?.recentSupervisorReauth || !backupControlSummary.encryption?.setupAvailable} className="btn-primary text-xs disabled:opacity-50">Generate secure encryption key</button>{backupKeySetupId && <button type="button" onClick={() => void downloadBackupSecurityRecovery()} disabled={backupControlBusy || backupRecoveryDownloaded} className="btn-secondary text-xs disabled:opacity-50">{backupRecoveryDownloaded ? "Recovery copy downloaded" : "Download one-time recovery copy"}</button>}{backupKeySetupId && backupRecoveryDownloaded && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={backupRecoveryConfirmed} onChange={(event) => setBackupRecoveryConfirmed(event.target.checked)} />I saved the recovery copy separately from this server.</label>}{backupKeySetupId && <button type="button" onClick={() => void saveBackupSecuritySetup()} disabled={backupControlBusy || !backupRecoveryDownloaded || !backupRecoveryConfirmed} className="btn-primary text-xs disabled:opacity-50">Save securely</button>}</div> : <p className="mt-2 text-xs">A recently re-authenticated super administrator must complete this setup.</p>}{isSuperAdmin && !user?.recentSupervisorReauth && <p className="mt-2 text-xs">Recent supervisor re-authentication is required before setup can begin.</p>}</div>}
        {(backupControlSummary?.encryption?.state === "recovery_required" || backupControlSummary?.encryption?.state === "invalid_key") && <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100"><p className="font-semibold">Backup credential-encryption key recovery required</p><p className="mt-1 text-xs">This installation already contains encrypted backup credentials. Restore the original installation key. Generating a new key will not recover them.</p>{backupControlSummary.encryption.limitation ? <p className="mt-2 text-xs">{backupControlSummary.encryption.limitation}</p> : isSuperAdmin ? <div className="mt-3 flex flex-wrap items-center gap-2"><textarea aria-label="Installation credential-encryption key recovery value" value={backupInstallationRecoveryValue} onChange={(event) => setBackupInstallationRecoveryValue(event.target.value)} placeholder="Paste the original BACKUP_V3_MASTER_KEY recovery value" className="input-premium min-h-16 text-xs" /><button type="button" onClick={() => void recoverBackupInstallationKey()} disabled={backupControlBusy || !user?.recentSupervisorReauth || !backupInstallationRecoveryValue.trim()} className="btn-primary text-xs disabled:opacity-50">Validate and restore key</button></div> : <p className="mt-2 text-xs">A recently re-authenticated super administrator must restore the original key.</p>}</div>}
        {backupControlSummary?.encryption?.restartRequired && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">Backup security setup saved — restart required</p><p className="mt-1 text-xs">Restart RISpro safely to load the encryption key. This page will show Ready after the restarted service confirms it.</p>{isSuperAdmin && <button type="button" onClick={() => void handleSystemRestart()} disabled={restartBusy || !user?.recentSupervisorReauth} className="btn-primary mt-3 text-xs disabled:opacity-50">{restartBusy ? "Restarting..." : "Restart RISpro safely"}</button>}</div>}
        {backupControlSummary?.encryption?.encryptionReady && <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200">Backup credential encryption: Ready</p>}

        <div className="rounded border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-stone-900 dark:text-white">Run Backup V3 now</p><button type="button" onClick={() => void runAutomatedBackupNow()} disabled={backupControlBusy || !selectedBackupDestinationIds.length} className="btn-primary text-xs disabled:opacity-50">{backupControlBusy ? "Working..." : "Run now"}</button></div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {backupDestinations.filter((destination) => destination.enabled).map((destination) => (
              <label key={destination.destination_id} className="flex items-center gap-1 text-xs text-stone-700 dark:text-stone-300">
                <input type="checkbox" checked={selectedBackupDestinationIds.includes(destination.destination_id)} onChange={(event) => setSelectedBackupDestinationIds((current) => event.target.checked ? [...current, destination.destination_id] : current.filter((id) => id !== destination.destination_id))} />
                {destination.name} ({destination.destination_type})
              </label>
            ))}
            {!backupDestinations.some((destination) => destination.enabled) && <span className="text-xs text-stone-500">Create and test an enabled destination first.</span>}
          </div>
        </div>

        <div className="overflow-x-auto rounded border border-stone-200 dark:border-stone-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"><tr><th className="p-2">Destination</th><th className="p-2">Protection</th><th className="p-2">Last test</th><th className="p-2">Action</th></tr></thead>
            <tbody>
              {backupDestinations.map((destination) => <tr key={destination.destination_id} className="border-t border-stone-200 dark:border-stone-700"><td className="p-2"><p className="font-medium">{destination.name}</p><p className="text-stone-500">{destination.destination_type} · {destination.enabled ? "enabled" : "paused"}</p></td><td className="p-2">{destination.credentialsConfigured ? "Credentials configured" : "No credentials"}</td><td className="p-2">{destination.last_connection_status || "Not tested"}{destination.last_failure_message ? <p className="mt-1 text-red-700 dark:text-red-300">{destination.last_failure_message}</p> : null}</td><td className="flex flex-wrap gap-1 p-2"><button type="button" onClick={() => void testAutomatedDestination(destination.destination_id)} disabled={!isSuperAdmin || !user?.recentSupervisorReauth || backupControlBusy || destination.destination_type === "onedrive"} className="btn-secondary text-xs disabled:opacity-50">Test</button>{isSuperAdmin && <><button type="button" onClick={() => editAutomatedDestination(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Edit</button><button type="button" onClick={() => void toggleAutomatedDestination(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">{destination.enabled ? "Pause" : "Resume"}</button><button type="button" onClick={() => void previewAutomatedRetention(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth || destination.destination_type === "onedrive"} className="btn-secondary text-xs disabled:opacity-50">Retention preview</button><button type="button" onClick={() => void executeAutomatedRetention(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth || destination.destination_type === "onedrive"} className="btn-secondary text-xs disabled:opacity-50">Apply retention</button><button type="button" onClick={() => void deleteAutomatedDestination(destination)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Remove</button></>}</td></tr>)}
              {!backupDestinations.length && <tr><td colSpan={4} className="p-3 text-stone-500">No automated destinations configured.</td></tr>}
            </tbody>
          </table>
        </div>

        {isSuperAdmin && <details className="rounded border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
          <summary className="cursor-pointer text-xs font-medium text-stone-900 dark:text-white">Protected destination and encryption settings</summary>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input aria-label="Automated destination name" value={destinationForm.name} onChange={(event) => setDestinationForm((current) => ({ ...current, name: event.target.value }))} placeholder="Destination name" className="input-premium text-xs" />
            <select aria-label="Automated destination type" value={destinationForm.type} onChange={(event) => setDestinationForm((current) => ({ ...current, type: event.target.value as BackupControlDestination["destination_type"] }))} className="input-premium text-xs"><option value="local">Local approved path</option><option value="smb">SMB share</option><option value="sftp">SFTP</option><option value="nextcloud">Nextcloud WebDAV</option><option value="onedrive" disabled>OneDrive (not yet available)</option></select>
            {destinationForm.type === "local" && <input aria-label="Automated local root" value={destinationForm.rootPath} onChange={(event) => setDestinationForm((current) => ({ ...current, rootPath: event.target.value }))} placeholder="Approved local backup root" className="input-premium text-xs sm:col-span-2" />}
            {destinationForm.type === "nextcloud" && <><input aria-label="Nextcloud base URL" value={destinationForm.baseUrl} onChange={(event) => setDestinationForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="https://cloud.example" className="input-premium text-xs" /><input aria-label="Nextcloud username" value={destinationForm.username} onChange={(event) => setDestinationForm((current) => ({ ...current, username: event.target.value }))} placeholder="Nextcloud username" className="input-premium text-xs" /><input aria-label="Nextcloud remote path" value={destinationForm.remotePath} onChange={(event) => setDestinationForm((current) => ({ ...current, remotePath: event.target.value }))} placeholder="/RISpro-backups" className="input-premium text-xs" /><input aria-label="Nextcloud app password" type="password" value={destinationForm.appPassword} onChange={(event) => setDestinationForm((current) => ({ ...current, appPassword: event.target.value }))} placeholder="App password" className="input-premium text-xs" /></>}
            {destinationForm.type === "sftp" && <><input aria-label="SFTP host" value={destinationForm.host} onChange={(event) => setDestinationForm((current) => ({ ...current, host: event.target.value }))} placeholder="SFTP host" className="input-premium text-xs" /><input aria-label="SFTP port" value={destinationForm.port} onChange={(event) => setDestinationForm((current) => ({ ...current, port: event.target.value }))} placeholder="22" className="input-premium text-xs" /><input aria-label="SFTP username" value={destinationForm.username} onChange={(event) => setDestinationForm((current) => ({ ...current, username: event.target.value }))} placeholder="SFTP username" className="input-premium text-xs" /><input aria-label="SFTP remote path" value={destinationForm.remotePath} onChange={(event) => setDestinationForm((current) => ({ ...current, remotePath: event.target.value }))} placeholder="/backups" className="input-premium text-xs" /><input aria-label="SFTP SHA256 host fingerprint" value={destinationForm.hostFingerprint} onChange={(event) => setDestinationForm((current) => ({ ...current, hostFingerprint: event.target.value }))} placeholder="SHA256 host fingerprint" className="input-premium text-xs" /><input aria-label="SFTP password" type="password" value={destinationForm.password} onChange={(event) => setDestinationForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password (or private key below)" className="input-premium text-xs" /><textarea aria-label="SFTP private key" value={destinationForm.privateKey} onChange={(event) => setDestinationForm((current) => ({ ...current, privateKey: event.target.value }))} placeholder="Private key (optional; never shown after save)" className="input-premium min-h-16 text-xs sm:col-span-2" /></>}
            {destinationForm.type === "smb" && <><input aria-label="SMB server" value={destinationForm.server} onChange={(event) => setDestinationForm((current) => ({ ...current, server: event.target.value }))} placeholder="SMB server" className="input-premium text-xs" /><input aria-label="SMB share" value={destinationForm.share} onChange={(event) => setDestinationForm((current) => ({ ...current, share: event.target.value }))} placeholder="Share" className="input-premium text-xs" /><input aria-label="SMB subfolder" value={destinationForm.subfolder} onChange={(event) => setDestinationForm((current) => ({ ...current, subfolder: event.target.value }))} placeholder="Subfolder" className="input-premium text-xs" /><input aria-label="SMB domain" value={destinationForm.domain} onChange={(event) => setDestinationForm((current) => ({ ...current, domain: event.target.value }))} placeholder="Domain (optional)" className="input-premium text-xs" /><input aria-label="SMB username" value={destinationForm.username} onChange={(event) => setDestinationForm((current) => ({ ...current, username: event.target.value }))} placeholder="Username" className="input-premium text-xs" /><input aria-label="SMB password" type="password" value={destinationForm.password} onChange={(event) => setDestinationForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password" className="input-premium text-xs" /></>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => void createAutomatedDestination()} disabled={backupControlBusy || !backupControlSummary?.encryption?.encryptionReady || !user?.recentSupervisorReauth || destinationForm.type === "onedrive"} className="btn-primary text-xs disabled:opacity-50">{editingDestinationId ? "Update destination" : "Save destination"}</button>{editingDestinationId && <button type="button" onClick={() => { setEditingDestinationId(null); setDestinationForm({ name: "", type: "local", rootPath: "", baseUrl: "", username: "", remotePath: "", host: "", port: "22", hostFingerprint: "", server: "", share: "", subfolder: "", domain: "", password: "", appPassword: "", privateKey: "" }); }} className="btn-secondary text-xs">Cancel edit</button>}<input aria-label="Automated archive passphrase" type="password" value={automatedPassphrase} onChange={(event) => setAutomatedPassphrase(event.target.value)} placeholder="Automated archive passphrase" className="input-premium text-xs" /><button type="button" onClick={() => void saveAutomatedPassphrase()} disabled={backupControlBusy || !backupControlSummary?.encryption?.encryptionReady || automatedPassphrase.length < 8 || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Store encrypted passphrase</button></div>
          <p className="mt-3 text-xs text-stone-600 dark:text-stone-300">OneDrive is deliberately isolated as the final destination milestone. It will require a Microsoft Entra app registration and delegated Files.ReadWrite.AppFolder consent; RISpro will provide the browser authorization flow and never ask for a Microsoft password. Local, SMB, SFTP, and Nextcloud do not require this portal step.</p>
          {!user?.recentSupervisorReauth && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Recent supervisor re-authentication is required before these settings can be saved or tested.</p>}
        </details>}

        <details className="rounded border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-900">
          <summary className="cursor-pointer text-xs font-medium text-stone-900 dark:text-white">Schedules, retention, and isolated restore verification</summary>
          <p className="mt-2 text-xs text-stone-600 dark:text-stone-300">Schedules use Africa/Tripoli time, retain 7 daily / 4 weekly / 12 monthly copies by default, and queue a weekly disposable restore verification after successful scheduled archives.</p>
          {isSuperAdmin && <div className="mt-3 flex flex-wrap gap-2"><input aria-label="Automated schedule name" value={scheduleForm.name} onChange={(event) => setScheduleForm((current) => ({ ...current, name: event.target.value }))} placeholder="Schedule name" className="input-premium text-xs" /><select aria-label="Automated schedule frequency" value={scheduleForm.frequency} onChange={(event) => setScheduleForm((current) => ({ ...current, frequency: event.target.value as BackupControlSchedule["frequency"] }))} className="input-premium text-xs"><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select>{scheduleForm.frequency === "weekly" && <select aria-label="Automated schedule weekday" value={scheduleForm.weekday} onChange={(event) => setScheduleForm((current) => ({ ...current, weekday: event.target.value }))} className="input-premium text-xs"><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select>}{scheduleForm.frequency === "monthly" && <input aria-label="Automated schedule day of month" type="number" min="1" max="31" value={scheduleForm.dayOfMonth} onChange={(event) => setScheduleForm((current) => ({ ...current, dayOfMonth: event.target.value }))} className="input-premium w-20 text-xs" />}<input aria-label="Automated schedule time" type="time" value={scheduleForm.timeOfDay} onChange={(event) => setScheduleForm((current) => ({ ...current, timeOfDay: event.target.value }))} className="input-premium text-xs" /><select aria-label="Automated retention policy" value={scheduleForm.retentionPreset} onChange={(event) => setScheduleForm((current) => ({ ...current, retentionPreset: event.target.value }))} className="input-premium text-xs"><option value="7_daily_4_weekly_12_monthly">7 daily / 4 weekly / 12 monthly</option><option value="14_daily_12_monthly">14 daily / 12 monthly</option><option value="30_daily">30 daily</option><option value="custom">Custom retention</option></select>{scheduleForm.retentionPreset === "custom" && <><input aria-label="Custom daily retention" type="number" min="0" max="3650" value={scheduleForm.retentionDaily} onChange={(event) => setScheduleForm((current) => ({ ...current, retentionDaily: event.target.value }))} placeholder="Daily" className="input-premium w-20 text-xs" /><input aria-label="Custom weekly retention" type="number" min="0" max="3650" value={scheduleForm.retentionWeekly} onChange={(event) => setScheduleForm((current) => ({ ...current, retentionWeekly: event.target.value }))} placeholder="Weekly" className="input-premium w-20 text-xs" /><input aria-label="Custom monthly retention" type="number" min="0" max="3650" value={scheduleForm.retentionMonthly} onChange={(event) => setScheduleForm((current) => ({ ...current, retentionMonthly: event.target.value }))} placeholder="Monthly" className="input-premium w-20 text-xs" /></>}<select aria-label="Automated restore verification frequency" value={scheduleForm.restoreVerificationFrequency} onChange={(event) => setScheduleForm((current) => ({ ...current, restoreVerificationFrequency: event.target.value as BackupControlSchedule["restore_verification_frequency"] }))} className="input-premium text-xs"><option value="weekly">Verify weekly</option><option value="monthly">Verify monthly</option><option value="disabled">Verification disabled</option></select><button type="button" onClick={() => void createAutomatedSchedule()} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-primary text-xs disabled:opacity-50">{editingScheduleId ? "Update schedule" : "Save schedule for selected destinations"}</button>{editingScheduleId && <button type="button" onClick={() => { setEditingScheduleId(null); setScheduleForm({ name: "", frequency: "daily", timeOfDay: "02:00", weekday: "1", dayOfMonth: "1", retentionPreset: "7_daily_4_weekly_12_monthly", retentionDaily: "7", retentionWeekly: "4", retentionMonthly: "12", restoreVerificationFrequency: "weekly" }); }} className="btn-secondary text-xs">Cancel edit</button>}</div>}
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="text-stone-500"><tr><th className="p-1">Schedule</th><th className="p-1">Next run</th><th className="p-1">Destinations</th><th className="p-1">State</th></tr></thead><tbody>{backupSchedules.map((schedule) => <tr key={schedule.schedule_id} className="border-t border-stone-200 dark:border-stone-700"><td className="p-1">{schedule.name}<p className="text-stone-500">{schedule.frequency} · {schedule.time_of_day} {schedule.timezone}</p></td><td className="p-1">{schedule.next_run_at ? formatDateTimeLy(schedule.next_run_at) : "Paused"}</td><td className="p-1">{schedule.destination_ids.length}</td><td className="flex flex-wrap gap-1 p-1">{isSuperAdmin ? <><button type="button" onClick={() => editAutomatedSchedule(schedule)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Edit</button><button type="button" onClick={() => void toggleAutomatedSchedule(schedule)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">{schedule.enabled ? "Pause" : "Resume"}</button><button type="button" onClick={() => void deleteAutomatedSchedule(schedule)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Delete</button></> : (schedule.enabled ? "Enabled" : "Paused")}</td></tr>)}{!backupSchedules.length && <tr><td colSpan={4} className="p-2 text-stone-500">No schedules configured.</td></tr>}</tbody></table></div>
        </details>

        <div className="overflow-x-auto rounded border border-stone-200 dark:border-stone-700"><table className="w-full text-left text-xs"><thead className="bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"><tr><th className="p-2">Recent job</th><th className="p-2">Status</th><th className="p-2">Archive</th><th className="p-2">Destination copies</th><th className="p-2">Completed</th><th className="p-2">Actions</th></tr></thead><tbody>{backupJobs.slice(0, 8).map((job) => <tr key={job.job_id} className="border-t border-stone-200 dark:border-stone-700"><td className="p-2">{formatDateTimeLy(job.created_at)}{job.source_schedule_id ? <p className="text-stone-500">Scheduled</p> : <p className="text-stone-500">Manual</p>}</td><td className="p-2">{job.status}{job.failure_message ? <p className="mt-1 text-red-700 dark:text-red-300">{job.failure_message}</p> : null}</td><td className="p-2">{job.archive_name || "-"}</td><td className="p-2">{job.destination_copies?.length ? job.destination_copies.map((copy) => <p key={copy.destinationId} className={copy.status === "failed" ? "text-red-700 dark:text-red-300" : ""}>{backupDestinations.find((destination) => destination.destination_id === copy.destinationId)?.name || copy.destinationId.slice(0, 8)}: {copy.status}{copy.failureMessage ? ` · ${copy.failureMessage}` : ""}</p>) : "No copy attempts yet"}</td><td className="p-2">{job.completed_at ? formatDateTimeLy(job.completed_at) : "-"}</td><td className="flex flex-wrap gap-1 p-2">{job.archive_name && <a href={`/api/backup-control/jobs/${job.job_id}/download`} className="btn-secondary text-xs">Download</a>}{(job.status === "failed" || job.status === "cancelled") && job.archive_name && <button type="button" onClick={() => void retryAutomatedJob(job)} disabled={backupControlBusy} className="btn-secondary text-xs disabled:opacity-50">Retry destination copy</button>}{job.status === "queued" && <button type="button" onClick={() => void cancelAutomatedJob(job)} disabled={backupControlBusy} className="btn-secondary text-xs disabled:opacity-50">Cancel</button>}{job.status === "completed" && isSuperAdmin && <button type="button" onClick={() => void queueManualRestoreVerification(job)} disabled={backupControlBusy || !user?.recentSupervisorReauth} className="btn-secondary text-xs disabled:opacity-50">Run restore verification</button>}</td></tr>)}{!backupJobs.length && <tr><td colSpan={6} className="p-3 text-stone-500">No automated backup jobs yet.</td></tr>}</tbody></table></div>
        {backupJobs.filter((job) => job.status === "completed").slice(0, 4).map((job) => <div key={`verify-${job.job_id}`} className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span>Verify copy:</span><select aria-label={`Restore verification copy for ${job.job_id}`} value={verificationCopyIds[job.job_id] || job.destination_copies?.find((copy) => copy.status === "verified")?.copyAttemptId || ""} onChange={(event) => setVerificationCopyIds((current) => ({ ...current, [job.job_id]: event.target.value }))} className="input-premium text-xs"><option value="">Select verified copy</option>{job.destination_copies?.filter((copy) => copy.status === "verified" && copy.copyAttemptId).map((copy) => <option key={copy.copyAttemptId} value={copy.copyAttemptId}>{backupDestinations.find((destination) => destination.destination_id === copy.destinationId)?.name || copy.destinationId.slice(0, 8)} · {copy.remotePath || "copy"}</option>)}</select>{isSuperAdmin && <button type="button" onClick={() => void queueManualRestoreVerification(job)} className="btn-secondary text-xs">Run selected verification</button>}</div>)}
        {backupRestoreVerifications.length > 0 && <div className="mt-2 space-y-1 text-xs text-stone-600 dark:text-stone-300">{backupRestoreVerifications.slice(0, 4).map((verification) => <p key={verification.restore_verification_job_id}>Restore verification: <span className="font-medium">{verification.status}</span> · {verification.destination_name || verification.destination_type || "destination"}{verification.remote_path ? ` · ${verification.remote_path}` : ""}{verification.retrieval?.fallbackToLocal ? " · scheduled local fallback" : ""}{verification.retrieval?.retrievedSha256 ? ` · checksum ${verification.retrieval.retrievedSha256.slice(0, 12)}…` : ""}{verification.retrieval?.retrievedByteSize != null ? ` · ${verification.retrieval.retrievedByteSize} bytes` : ""}{verification.retrieval?.cleanupStatus ? ` · cleanup ${verification.retrieval.cleanupStatus}` : ""}{verification.retrieval?.restoreDrillStatus ? ` · restore drill ${verification.retrieval.restoreDrillStatus}` : ""}{verification.failure_message ? ` · ${verification.failure_message}` : ""}</p>)}</div>}
      </section>

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
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">V3 full app-stack backup</h4>
          <p className="mb-3 text-xs text-stone-600 dark:text-stone-300">
            Downloads a ZIP64 <strong>.rispro.zip</strong> archive containing the database, app-owned storage, selected document files, and passphrase-protected managed configuration. Other archive entries are not currently encrypted.
          </p>
          <div className="mb-3">
            <div className="h-2 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-blue-600 transition-all duration-300"
                style={{ width: `${exportV3Progress}%` }}
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              aria-label="V3 backup passphrase"
              type="password"
              value={backupV3Passphrase}
              onChange={(event) => setBackupV3Passphrase(event.target.value)}
              placeholder="V3 backup passphrase"
              className="input-premium text-sm flex-1"
              disabled={backupV3Busy}
            />
            <button
              type="button"
              onClick={downloadV3Backup}
              disabled={backupV3Busy || backupV3Passphrase.length < 8}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {backupV3Busy ? "Preparing..." : "Download v3 full app-stack backup"}
            </button>
          </div>
        </div>

        {showDeprecatedV2Controls && <div>
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">Legacy v2 JSON backup</h4>
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
              placeholder="Legacy v2 backup passphrase"
              className="input-premium text-sm flex-1"
              disabled={backupBusy}
            />
            <button
              type="button"
              onClick={downloadBackup}
              disabled={backupBusy || backupPassphrase.length < 8}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {backupBusy ? "Preparing..." : "Download legacy v2 backup"}
            </button>
          </div>
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
            Existing v2 JSON backup remains available for compatibility. Prefer v3 for full app-stack coverage.
          </p>
        </div>}

        <hr className="border-stone-200 dark:border-stone-700" />

        {/* Restore from backup */}
        <div>
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">V3 restore preview and gated execution</h4>
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
            <p className="font-semibold">Destructive restore warning</p>
            <p className="mt-1">This replaces the database, mirrors app-owned storage and removes extra local files under app-owned roots, restores selected external documents, updates RISpro-managed .env keys, creates safety backups first, and requires restart. Do not run during active clinical workflow.</p>
          </div>
          <div className={`mb-3 rounded-lg border p-3 text-xs ${
            canExecuteV3Restore
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200"
              : "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
          }`}>
            {fullRestoreStatus}
          </div>
          <div className="space-y-3 rounded-lg border border-stone-200 dark:border-stone-700 p-3">
            <select aria-label="V3 restore source" value={restoreV3SourceType} onChange={(event) => { setRestoreV3SourceType(event.target.value as typeof restoreV3SourceType); setRestoreV3Preview(null); setRestoreV3PreviewJob(null); setRestoreV3Result(null); setRestoreV3Confirmation(""); }} className="input-premium text-sm" disabled={restoreV3Busy || previewV3Busy}>
              <option value="upload_session">External archive upload</option>
              <option value="artifact">Existing local Backup V3 artifact</option>
              <option value="destination_copy">Verified destination copy</option>
            </select>
            {restoreV3SourceType === "artifact" && <select aria-label="Existing Backup V3 artifact" value={restoreV3ArtifactId} onChange={(event) => setRestoreV3ArtifactId(event.target.value)} className="input-premium text-sm"><option value="">Select completed local artifact</option>{backupJobs.filter((job) => job.status === "completed" && job.artifact_id).map((job) => <option key={job.artifact_id} value={job.artifact_id || ""}>{job.archive_name || job.job_id}</option>)}</select>}
            {restoreV3SourceType === "destination_copy" && <select aria-label="Verified Backup V3 destination copy" value={restoreV3CopyAttemptId} onChange={(event) => setRestoreV3CopyAttemptId(event.target.value)} className="input-premium text-sm"><option value="">Select verified destination copy</option>{backupJobs.flatMap((job) => (job.destination_copies || []).filter((copy) => copy.status === "verified" && copy.copyAttemptId).map((copy) => <option key={copy.copyAttemptId} value={copy.copyAttemptId}>{job.archive_name || job.job_id} · {copy.remotePath || copy.copyAttemptId}</option>))}</select>}
            {restoreV3SourceType === "upload_session" && <input
              aria-label="V3 restore archive"
              type="file"
              accept=".rispro.zip,application/zip"
              onChange={(e) => {
                setRestoreV3File(e.target.files?.[0] || null);
                setRestoreV3Upload(null);
                setRestoreV3Preview(null);
                setRestoreV3PreviewJob(null);
                setRestoreV3Result(null);
                setRestoreV3Confirmation("");
              }}
              className="text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-stone-100 dark:file:bg-stone-700 file:text-stone-700 dark:file:text-stone-300"
              disabled={restoreV3Busy || previewV3Busy}
            />}
            {restoreV3Upload && <p className="text-xs text-stone-600 dark:text-stone-300">External upload: {restoreV3Upload.status} · {restoreV3Upload.receivedOffset.toLocaleString()} / {restoreV3Upload.expectedSizeBytes.toLocaleString()} bytes{restoreV3Upload.failureMessage ? ` · ${restoreV3Upload.failureMessage}` : ""}</p>}
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                aria-label="V3 restore passphrase"
                type="password"
                value={restoreV3Passphrase}
                onChange={(event) => {
                  setRestoreV3Passphrase(event.target.value);
                  setRestoreV3Preview(null);
                  setRestoreV3Result(null);
                  setRestoreV3Confirmation("");
                }}
                placeholder="V3 backup passphrase"
                className="input-premium text-sm flex-1"
                disabled={restoreV3Busy || previewV3Busy}
              />
              <button
                type="button"
                onClick={handleV3Preview}
                disabled={previewV3Busy || restoreV3Busy || !restoreV3File || restoreV3Passphrase.length < 8}
                className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {previewV3Busy ? "Previewing..." : "Preview v3 restore"}
              </button>
            </div>

            {restoreV3PreviewJob && (restoreV3PreviewJob.status === "queued" || restoreV3PreviewJob.status === "running") && <p className="text-xs text-stone-600 dark:text-stone-300">Preview job {restoreV3PreviewJob.status}: {restoreV3PreviewJob.progress}%</p>}
            {restoreV3PreviewJob?.compatibilityClassification && <div className="rounded border p-2 text-xs"><p>Compatibility: <strong>{restoreV3PreviewJob.compatibilityClassification}</strong> — {restoreV3PreviewJob.compatibilityMessage}</p>{restoreV3PreviewJob.compatibilityClassification === "older_supported" && <button type="button" className="btn-secondary mt-2 text-xs" onClick={() => void startMigrationRehearsal()}>Run isolated migration rehearsal</button>}</div>}
            {migrationRehearsal && <div className="rounded border p-2 text-xs">Migration rehearsal: {migrationRehearsal.status} · {migrationRehearsal.progress}% · {migrationRehearsal.promotion_ready ? "promotion-ready (not restored to production)" : "not promotion-ready"}{migrationRehearsal.errors?.length ? <p className="text-red-700">{migrationRehearsal.errors.join("; ")}</p> : null}</div>}

            {restoreV3Preview && (
              <div className="space-y-3 rounded-lg border border-stone-200 dark:border-stone-700 p-3 text-sm">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><p className="text-xs text-stone-500">Format</p><p className="font-medium">v{restoreV3Preview.manifest.formatVersion}</p></div>
                  <div><p className="text-xs text-stone-500">Created</p><p className="font-medium">{formatDateTimeLy(restoreV3Preview.manifest.createdAt)}</p></div>
                  <div><p className="text-xs text-stone-500">App</p><p className="font-medium">{restoreV3Preview.manifest.appName} {restoreV3Preview.manifest.packageVersion || ""}</p></div>
                  <div><p className="text-xs text-stone-500">Git</p><p className="font-medium">{restoreV3Preview.manifest.gitCommit || "not recorded"}</p></div>
                  <div><p className="text-xs text-stone-500">Migration</p><p className="font-medium">{restoreV3Preview.manifest.migrationVersion || "not recorded"}</p></div>
                  <div><p className="text-xs text-stone-500">Tables / rows</p><p className="font-medium">{restoreV3Preview.counts.tables} / {restoreV3Preview.counts.rows}</p></div>
                  <div><p className="text-xs text-stone-500">Archive entries</p><p className="font-medium">{restoreV3Preview.counts.archiveEntries}</p></div>
                  <div><p className="text-xs text-stone-500">Storage and document files</p><p className="font-medium">{restoreV3Preview.counts.storageFiles}</p></div>
                  <div><p className="text-xs text-stone-500">RISpro config vars</p><p className="font-medium">{restoreV3Preview.counts.envVars} names, values hidden</p></div>
                </div>
                {restoreV3Preview.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    <p className="font-semibold">Warnings</p>
                    <ul className="list-disc pl-5">{restoreV3Preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  </div>
                )}
                {restoreV3Preview.errors.length > 0 && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                    <p className="font-semibold">Errors block restore</p>
                    <ul className="list-disc pl-5">{restoreV3Preview.errors.map((error) => <li key={error}>{error}</li>)}</ul>
                  </div>
                )}
                <p className="text-xs text-stone-500 dark:text-stone-400">Secret config values are never displayed. Current preview API returns env variable counts only, not names.</p>

                {canExecuteV3Restore && !v3PreviewHasErrors ? (
                  <div className="space-y-2">
                    <input
                      aria-label="V3 restore confirmation"
                      value={restoreV3Confirmation}
                      onChange={(event) => setRestoreV3Confirmation(event.target.value)}
                      placeholder="Type RESTORE RISPRO"
                      className="input-premium text-sm w-full"
                      disabled={restoreV3Busy}
                    />
                    <button
                      type="button"
                      onClick={handleV3Restore}
                      disabled={restoreV3Busy || restoreV3Confirmation !== RESTORE_CONFIRMATION_TEXT}
                      className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {restoreV3Busy ? "Restoring..." : "Execute v3 full restore"}
                    </button>
                  </div>
                ) : (
                  <p className="rounded-md border border-stone-200 bg-stone-50 p-2 text-xs text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
                    Restore execution is unavailable until backend full restore is enabled, the user is super_admin, recent reauth is satisfied, and preview has no errors.
                  </p>
                )}
              </div>
            )}

            {restoreV3Result && (
              <div className={`rounded-lg border p-3 text-sm ${
                restoreV3Result.ok && !restoreV3Result.restoreIncomplete
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200"
                  : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200"
              }`}>
                <p className="font-semibold">{restoreV3Result.ok && !restoreV3Result.restoreIncomplete ? "V3 restore completed" : "V3 restore partial failure"}</p>
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <span>DB: {String(restoreV3Result.dbRestored)}</span>
                  <span>Storage: {String(restoreV3Result.storageRestored)}</span>
                  <span>External docs: {String(restoreV3Result.externalDocumentsRestored)}</span>
                  <span>Env: {String(restoreV3Result.envRestored)}</span>
                  <span>Incomplete: {String(restoreV3Result.restoreIncomplete)}</span>
                  <span>Restart required: {String(restoreV3Result.restartRequired)}</span>
                </div>
                {restoreV3Result.restartRequired && <p className="mt-2 font-semibold">Restart required. Do not auto-restart from this screen.</p>}
                {restoreV3Result.partialFailure && (
                  <p className="mt-2">Partial failure in {restoreV3Result.partialFailure.component || "restore"}: {restoreV3Result.partialFailure.message || "Review server logs."} Do not retry blindly; review logs and safety backups.</p>
                )}
                {restoreV3Result.safetyBackupsCreated && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/70 p-2 text-xs dark:bg-black/20">
                    {safeDisplayValue(restoreV3Result.safetyBackupsCreated)}
                  </pre>
                )}
                {restoreV3Result.restoredCounts && <p className="mt-2 text-xs">Restored counts: {safeDisplayValue(restoreV3Result.restoredCounts)}</p>}
                {(restoreV3Result.warnings || []).length > 0 && <p className="mt-2 text-xs">Warnings: {restoreV3Result.warnings!.join(" ")}</p>}
              </div>
            )}
          </div>

          {showDeprecatedV2Controls && <>
          <hr className="my-4 border-stone-200 dark:border-stone-700" />
          <h4 className="text-sm font-medium text-stone-900 dark:text-white mb-2">Legacy v2 JSON restore</h4>
          <div className="space-y-3">
            <input
              aria-label="Legacy v2 restore file"
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
                aria-label="Legacy v2 restore passphrase"
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
          </>}
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
  type SchedulingDraftOverride = {
    baseUpdatedAt: number;
    value: SchedulingDraft;
  };

  const emptyDraft = (): SchedulingDraft => ({
    categoryLimits: [],
    blockedRules: [],
    examRules: [],
    specialQuotas: [],
    specialReasons: [],
    identifierTypes: []
  });
  const [draftOverride, setDraftOverride] = useState<SchedulingDraftOverride | null>(null);
  const { data, dataUpdatedAt, isLoading, error } = useQuery({
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

  type ModalityLookupRow = Record<string, unknown> & {
    nameEn?: string;
    name_en?: string;
  };
  type ExamTypeLookupRow = ModalityLookupRow & {
    modalityId?: unknown;
    modality_id?: unknown;
  };

  // Build modality options for dropdowns
  const modalityOptions = useMemo(() => {
    const rows: ModalityLookupRow[] = Array.isArray(modalityLookup?.modalities) ? modalityLookup.modalities : [];
    return rows
      .filter((modality) => modality.isActive !== false)
      .map((modality) => ({ value: String(modality.id), label: modality.nameEn || modality.name_en || `Modality ${modality.id}` }));
  }, [modalityLookup]);

  // Build exam type options for dropdowns
  const examTypeOptions = useMemo(() => {
    const rows: ExamTypeLookupRow[] = Array.isArray(examTypeLookup?.examTypes) ? examTypeLookup.examTypes : [];
    return rows
      .filter((examType) => examType.isActive !== false)
      .map((examType) => ({ value: String(examType.id), label: examType.nameEn || examType.name_en || `Exam ${examType.id}` }));
  }, [examTypeLookup]);

  // Build exam type options with modality for filtering
  const examTypeOptionsWithModality = useMemo(() => {
    const rows: ExamTypeLookupRow[] = Array.isArray(examTypeLookup?.examTypes) ? examTypeLookup.examTypes : [];
    return rows
      .filter((examType) => examType.isActive !== false)
      .map((examType) => ({
        value: String(examType.id),
        label: examType.nameEn || examType.name_en || `Exam ${examType.id}`,
        modalityId: examType.modalityId ?? examType.modality_id
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

  const serverDraft = data ? normalizeConfig(data) : emptyDraft();
  const draft =
    draftOverride?.baseUpdatedAt === dataUpdatedAt
      ? draftOverride.value
      : serverDraft;

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

  const [saveNotice, setSaveNotice] = useState<"saved" | null>(null);
  const [quotaModalityFilter, setQuotaModalityFilter] = useState<string>("");
  const [quotaNotice, setQuotaNotice] = useState<string>("");
  const setDraft: Dispatch<SetStateAction<SchedulingDraft>> = (nextDraft) => {
    setDraftOverride((currentOverride) => {
      const currentDraft =
        currentOverride?.baseUpdatedAt === dataUpdatedAt
          ? currentOverride.value
          : serverDraft;
      const nextValue =
        typeof nextDraft === "function"
          ? nextDraft(currentDraft)
          : nextDraft;

      return {
        baseUpdatedAt: dataUpdatedAt,
        value: nextValue
      };
    });
    setSaveNotice(null);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: SchedulingEngineConfig) => saveSchedulingEngineConfig(payload),
    onSuccess: (returnedConfig) => {
      // Immediately replace local draft with the authoritative server response
      setDraftOverride({
        baseUpdatedAt: dataUpdatedAt,
        value: normalizeConfig(returnedConfig)
      });
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
          const et = allExamTypes.find((examType) => String(examType.id) === opt.value);
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
  "patients.merge": "Patient Merge",
  "name.dictionary": "Name Dictionary",
  appointments: "Appointments",
  "scheduling.override.requests": "Override Requests",
  "v2.appointments.admin": "Scheduling Policy Admin",
  calendar: "Calendar",
  registrations: "Registrations",
  "request.scans": "Request Scans",
  queue: "Queue",
  "queue.checkin": "Queue Check-In",
  modality: "Modality",
  comparisons: "Comparisons",
  doctor: "Doctor",
  print: "Print",
  statistics: "Statistics",
  pacs: "PACS",
  "pacs.remap": "PACS remap",
  "worklist.monitor": "MWL Monitor",
  legacy: "Legacy",
  settings: "Settings",
};

function RolePageAccessSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  type PageVisibilityDraftOverride = {
    baseUpdatedAt: number;
    value: PageVisibilityMatrix;
  };

  const queryClient = useQueryClient();
  const [draftOverride, setDraftOverride] = useState<PageVisibilityDraftOverride | null>(null);
  const [message, setMessage] = useState<string>("");

  const { data, dataUpdatedAt, isLoading, error } = useQuery({
    queryKey: ["settings", "users_and_roles", "page_visibility_by_role"],
    queryFn: fetchPageVisibilityMatrix,
    staleTime: 1000 * 60,
    retry: false,
  });

  const serverDraft = normalizePageVisibilityMatrix(data ?? DEFAULT_PAGE_VISIBILITY_MATRIX);
  const draft =
    draftOverride?.baseUpdatedAt === dataUpdatedAt
      ? draftOverride.value
      : serverDraft;
  const setDraft: Dispatch<SetStateAction<PageVisibilityMatrix>> = (nextDraft) => {
    setDraftOverride((currentOverride) => {
      const currentDraft =
        currentOverride?.baseUpdatedAt === dataUpdatedAt
          ? currentOverride.value
          : serverDraft;

      return {
        baseUpdatedAt: dataUpdatedAt,
        value: typeof nextDraft === "function" ? nextDraft(currentDraft) : nextDraft,
      };
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.settings.includes("super_admin")) {
        throw new Error("Settings access must always include Super Admin.");
      }
      return savePageVisibilityMatrix(draft);
    },
    onSuccess: async (saved) => {
      setDraftOverride({
        baseUpdatedAt: dataUpdatedAt,
        value: normalizePageVisibilityMatrix(saved),
      });
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
          onClick={() => setDraft(serverDraft)}
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

type DocumentsStorageForm = {
  storagePath: string;
  authUsername: string;
  authPassword: string;
  authDomain: string;
  fallbackEnabled: boolean;
  naps2WebScanEnabled: boolean;
  naps2WebScanEndpoint: string;
  scannerAppEnabled: boolean;
  scannerAppDownloadUrl: string;
  scanSessionExpiryMinutes: string;
  scanDpi: string;
  scanColorMode: string;
  scannerSource: string;
};

type DocumentsStorageFormOverride = {
  baseUpdatedAt: number;
  value: DocumentsStorageForm;
};

function normalizeDocumentsStorageForm(
  settings: Record<string, string> | undefined
): DocumentsStorageForm {
  return {
    storagePath: settings?.storage_path || "",
    authUsername: settings?.storage_auth_username || "",
    authPassword: settings?.storage_auth_password || "",
    authDomain: settings?.storage_auth_domain || "",
    fallbackEnabled: String(settings?.storage_fallback_enabled || "true").toLowerCase() === "true",
    naps2WebScanEnabled: String(settings?.naps2_webscan_enabled || "disabled").toLowerCase() === "enabled",
    naps2WebScanEndpoint: settings?.scanner_bridge_endpoint || settings?.naps2_webscan_endpoint || "",
    scannerAppEnabled: String(settings?.scanner_app_enabled || "enabled").toLowerCase() === "enabled",
    scannerAppDownloadUrl: settings?.scanner_app_download_url || "/assets/downloads/RISproScannerSetup.msi",
    scanSessionExpiryMinutes: settings?.scan_session_expiry_minutes || "15",
    scanDpi: settings?.scan_dpi || "200",
    scanColorMode: settings?.scan_color_mode || "grayscale",
    scannerSource: settings?.scanner_source || "feeder",
  };
}

function DocumentsStorageSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const { t, language } = useLanguage();
  const [formOverride, setFormOverride] = useState<DocumentsStorageFormOverride | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [resultMessage, setResultMessage] = useState<string>("");

  const { data: settings, dataUpdatedAt, error, isLoading } = useQuery({
    queryKey: ["settings", "documents_and_uploads"],
    queryFn: () => fetchSettings("documents_and_uploads"),
    staleTime: 1000 * 60,
  });

  const serverForm = normalizeDocumentsStorageForm(settings);
  const form =
    formOverride?.baseUpdatedAt === dataUpdatedAt
      ? formOverride.value
      : serverForm;
  const updateForm = <K extends keyof DocumentsStorageForm,>(
    key: K,
    value: DocumentsStorageForm[K]
  ) => {
    setFormOverride((currentOverride) => {
      const currentForm =
        currentOverride?.baseUpdatedAt === dataUpdatedAt
          ? currentOverride.value
          : serverForm;

      return {
        baseUpdatedAt: dataUpdatedAt,
        value: {
          ...currentForm,
          [key]: value,
        },
      };
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () =>
      saveSettings("documents_and_uploads", {
        entries: [
          { key: "storage_path", value: { value: form.storagePath } },
          { key: "storage_auth_username", value: { value: form.authUsername } },
          { key: "storage_auth_password", value: { value: form.authPassword } },
          { key: "storage_auth_domain", value: { value: form.authDomain } },
          { key: "storage_fallback_enabled", value: { value: String(form.fallbackEnabled) } },
          { key: "naps2_webscan_enabled", value: { value: form.naps2WebScanEnabled ? "enabled" : "disabled" } },
          { key: "scanner_bridge_endpoint", value: { value: form.naps2WebScanEndpoint } },
          { key: "naps2_webscan_endpoint", value: { value: form.naps2WebScanEndpoint } },
          { key: "scanner_bridge_mode", value: { value: form.naps2WebScanEnabled ? "naps2_webscan" : "manual_browser_upload" } },
          { key: "scanner_app_enabled", value: { value: form.scannerAppEnabled ? "enabled" : "disabled" } },
          { key: "scanner_app_download_url", value: { value: form.scannerAppDownloadUrl } },
          { key: "scan_session_expiry_minutes", value: { value: form.scanSessionExpiryMinutes } },
          { key: "scan_dpi", value: { value: form.scanDpi } },
          { key: "scan_color_mode", value: { value: form.scanColorMode } },
          { key: "scanner_source", value: { value: form.scannerSource } },
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
      endpoint: form.naps2WebScanEndpoint,
      dpi: Number(form.scanDpi) || 200,
      colorMode: form.scanColorMode === "color" ? "color" : "grayscale",
      source: form.scannerSource === "flatbed" ? "flatbed" : form.scannerSource === "duplex" ? "duplex" : "feeder",
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
                checked={form.scannerAppEnabled}
                onChange={(e) => updateForm("scannerAppEnabled", e.target.checked)}
              />
              {t("settings.documents.scannerAppEnabled")}
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scannerAppDownloadUrl")}</label>
            <input
              value={form.scannerAppDownloadUrl}
              onChange={(e) => updateForm("scannerAppDownloadUrl", e.target.value)}
              placeholder="/assets/downloads/RISproScannerSetup.msi"
              className="input-premium w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scanSessionExpiryMinutes")}</label>
            <select value={form.scanSessionExpiryMinutes} onChange={(e) => updateForm("scanSessionExpiryMinutes", e.target.value)} className="input-premium w-full">
              <option value="10">10</option>
              <option value="15">15</option>
              <option value="30">30</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.naps2WebScanEnabled}
                onChange={(e) => updateForm("naps2WebScanEnabled", e.target.checked)}
              />
              {t("settings.documents.naps2Enabled")}
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.naps2Endpoint")}</label>
            <input
              value={form.naps2WebScanEndpoint}
              onChange={(e) => updateForm("naps2WebScanEndpoint", e.target.value)}
              placeholder="http://127.0.0.1:9810"
              className="input-premium w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scanDpi")}</label>
            <select value={form.scanDpi} onChange={(e) => updateForm("scanDpi", e.target.value)} className="input-premium w-full">
              <option value="150">150</option>
              <option value="200">200</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scanColorMode")}</label>
            <select value={form.scanColorMode} onChange={(e) => updateForm("scanColorMode", e.target.value)} className="input-premium w-full">
              <option value="grayscale">{t("settings.documents.grayscale")}</option>
              <option value="color">{t("settings.documents.color")}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scannerSource")}</label>
            <select value={form.scannerSource} onChange={(e) => updateForm("scannerSource", e.target.value)} className="input-premium w-full">
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
          <input value={form.storagePath} onChange={(e) => updateForm("storagePath", e.target.value)} className="input-premium w-full" />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.fallbackEnabled} onChange={(e) => updateForm("fallbackEnabled", e.target.checked)} />
            {t("settings.documents.enableFallback")}
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.networkUsername")}</label>
          <input value={form.authUsername} onChange={(e) => updateForm("authUsername", e.target.value)} className="input-premium w-full" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.networkPassword")}</label>
          <input type="password" value={form.authPassword} onChange={(e) => updateForm("authPassword", e.target.value)} className="input-premium w-full" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.networkDomain")}</label>
          <input value={form.authDomain} onChange={(e) => updateForm("authDomain", e.target.value)} className="input-premium w-full" />
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
