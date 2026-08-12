export type SettingsSection =
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

export type SettingsMenuSection = Exclude<SettingsSection, "menu">;
export type SettingsGroup = "all" | "clinical" | "scheduling" | "integrations" | "admin" | "system";

export const SETTINGS_MENU_SECTIONS: SettingsMenuSection[] = [
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
  "authoritative_orthanc",
];

export const SECTION_GROUPS: Record<SettingsMenuSection, Exclude<SettingsGroup, "all">> = {
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

export const SETTINGS_GROUPS: SettingsGroup[] = ["all", "clinical", "scheduling", "integrations", "admin", "system"];

export function initialSettingsSection(search: string): SettingsSection {
  const requested = new URLSearchParams(search).get("section");
  return requested && SETTINGS_MENU_SECTIONS.includes(requested as SettingsMenuSection) ? requested as SettingsMenuSection : "menu";
}

export function isSettingsMenuSectionVisible(section: SettingsMenuSection, role?: string): boolean {
  if ((section === "system_diagnostics" || section === "passkey_configuration") && role !== "super_admin") {
    return false;
  }
  return true;
}
