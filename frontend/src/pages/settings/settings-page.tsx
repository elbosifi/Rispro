import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, ShieldCheck } from "lucide-react";
import { SupervisorReAuthModal } from "@/components/auth/supervisor-reauth-modal";
import { useAuth } from "@/providers/auth-provider";
import type { TranslationKey } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
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
import UsersSection from "./users-section";
import ModalitiesSection from "./modalities-section";
import NameDictionarySection from "./name-dictionary-section";
import NotAllowedNameWordsSection from "./not-allowed-name-words-section";
import PatientImportSection from "./patient-import-section";
import { BackupRestoreSection } from "./backup-restore-section";
export { BackupRestoreSection } from "./backup-restore-section";
import SchedulingEngineConfigSection from "./scheduling-engine-config-section";
import RolePageAccessSection from "./role-page-access-section";
import DocumentsStorageSection from "./documents-storage-section";
import SimpleSettingsSection from "./simple-settings-section";
import {
  SETTINGS_GROUPS,
  SETTINGS_MENU_SECTIONS,
  SECTION_GROUPS,
  initialSettingsSection,
  isSettingsMenuSectionVisible,
  type SettingsGroup,
  type SettingsSection,
} from "./settings-page.composition";
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
  const [section, setSection] = useState<SettingsSection>(() => initialSettingsSection(window.location.search));
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
    if (!isSettingsMenuSectionVisible(key, user?.role)) return false;
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
