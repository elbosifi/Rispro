import { describe, expect, it } from "vitest";
import {
  SETTINGS_GROUPS,
  SETTINGS_MENU_SECTIONS,
  SECTION_GROUPS,
  initialSettingsSection,
  isSettingsMenuSectionVisible,
} from "./settings-page.composition";

describe("settings page composition", () => {
  it("preserves the ordered settings menu and group assignment matrix", () => {
    expect(SETTINGS_GROUPS).toEqual(["all", "clinical", "scheduling", "integrations", "admin", "system"]);
    expect(SETTINGS_MENU_SECTIONS).toHaveLength(30);
    expect(SETTINGS_MENU_SECTIONS).toEqual([
      "patient_registration", "patient_import", "patient_duplicate_resolver",
      "scheduling_and_capacity", "queue_and_arrival", "scheduling_engine_config",
      "pacs_connection", "dicom_gateway_config", "dicom_gateway_devices",
      "dicom_gateway_monitoring", "orthanc_mwl_sync", "sante_worklist_hl7",
      "users", "action_pin_policy", "role_page_access", "audit_log", "exam_types",
      "modalities", "not_allowed_name_words", "appointment_slip", "qz_tray",
      "patient_qr_self_service", "passkey_configuration", "sonicdicom_reports",
      "ohif_viewer", "documents_and_uploads", "backup_restore", "system_diagnostics",
      "request_scan_automation", "authoritative_orthanc",
    ]);
    expect(SETTINGS_MENU_SECTIONS.map((section) => [section, SECTION_GROUPS[section]])).toMatchSnapshot();
  });

  it("preserves the qz-tray-only query-string deep link", () => {
    expect(initialSettingsSection("?section=qz_tray")).toBe("qz_tray");
    expect(initialSettingsSection("?section=users")).toBe("menu");
    expect(initialSettingsSection("")).toBe("menu");
  });

  it("preserves super-admin-only menu visibility", () => {
    for (const section of SETTINGS_MENU_SECTIONS) {
      const expected = section !== "system_diagnostics" && section !== "passkey_configuration";
      expect(isSettingsMenuSectionVisible(section, "supervisor")).toBe(expected);
      expect(isSettingsMenuSectionVisible(section, "super_admin")).toBe(true);
    }
  });
});
