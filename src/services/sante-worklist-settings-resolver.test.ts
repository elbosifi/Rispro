import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "test-secret";

const { validateSanteSettingsEntries } = await import("./sante-worklist-settings-resolver.js");

const baseEntries = [
  { key: "enabled", value: { value: "true" } },
  { key: "mode", value: { value: "shadow" } },
  { key: "delivery_method", value: { value: "file_drop" } },
  { key: "output_folder_path", value: { value: "storage/sante-hl7-output" } },
  { key: "file_extension", value: { value: ".hl7" } },
  { key: "scheduled_station_ae_title_default", value: { value: "RISPRO_MWL" } },
];

test("validateSanteSettingsEntries accepts configured file-drop settings", () => {
  assert.doesNotThrow(() => validateSanteSettingsEntries(baseEntries));
});

test("validateSanteSettingsEntries accepts queue-only send timing option", () => {
  assert.doesNotThrow(() => validateSanteSettingsEntries([
    ...baseEntries,
    { key: "send_only_when_patient_enters_queue", value: { value: "true" } },
  ]));
});

test("validateSanteSettingsEntries accepts procedure source selectors", () => {
  assert.doesNotThrow(() => validateSanteSettingsEntries([
    ...baseEntries,
    { key: "procedure_code_field", value: { value: "modality_code" } },
    { key: "procedure_description_field", value: { value: "exam_name_ar" } },
  ]));
});

test("validateSanteSettingsEntries rejects invalid procedure source selectors", () => {
  assert.throws(
    () => validateSanteSettingsEntries([
      ...baseEntries,
      { key: "procedure_code_field", value: { value: "patient_name" } },
    ]),
    /procedure_code_field/
  );
});

test("validateSanteSettingsEntries rejects file-drop settings without output folder", () => {
  assert.throws(
    () => validateSanteSettingsEntries([
      { key: "enabled", value: { value: "true" } },
      { key: "mode", value: { value: "shadow" } },
      { key: "delivery_method", value: { value: "file_drop" } },
    ]),
    /output folder path/
  );
});

test("validateSanteSettingsEntries accepts configured MLLP settings without output folder", () => {
  assert.doesNotThrow(() => validateSanteSettingsEntries([
    { key: "enabled", value: { value: "true" } },
    { key: "mode", value: { value: "shadow" } },
    { key: "delivery_method", value: { value: "mllp" } },
    { key: "mllp_host", value: { value: "127.0.0.1" } },
    { key: "mllp_port", value: { value: "2575" } },
    { key: "mllp_timeout_seconds", value: { value: "10" } },
  ]));
});

test("validateSanteSettingsEntries rejects MLLP settings without host or port", () => {
  assert.throws(
    () => validateSanteSettingsEntries([
      { key: "enabled", value: { value: "true" } },
      { key: "mode", value: { value: "shadow" } },
      { key: "delivery_method", value: { value: "mllp" } },
      { key: "mllp_port", value: { value: "2575" } },
    ]),
    /MLLP host/
  );
  assert.throws(
    () => validateSanteSettingsEntries([
      { key: "enabled", value: { value: "true" } },
      { key: "mode", value: { value: "shadow" } },
      { key: "delivery_method", value: { value: "mllp" } },
      { key: "mllp_host", value: { value: "127.0.0.1" } },
    ]),
    /MLLP port/
  );
});

test("validateSanteSettingsEntries rejects unsupported extension", () => {
  assert.throws(
    () => validateSanteSettingsEntries([...baseEntries, { key: "file_extension", value: { value: ".exe" } }]),
    /file_extension/
  );
});

test("validateSanteSettingsEntries rejects unsafe traversal outside allowed base", () => {
  assert.throws(
    () => validateSanteSettingsEntries([
      { key: "enabled", value: { value: "true" } },
      { key: "mode", value: { value: "shadow" } },
      { key: "output_folder_path", value: { value: ".." } },
    ]),
    /allowed backend-visible base path/
  );
});

test("validateSanteSettingsEntries accepts HL7 compatibility JSON settings", () => {
  assert.doesNotThrow(() => validateSanteSettingsEntries([
    ...baseEntries,
    { key: "hl7_enabled_fields_json", value: { value: "{\"PID.11\":false,\"OBR.20\":true}" } },
    { key: "hl7_field_limits_json", value: { value: "{\"PID.5\":32,\"OBR.20\":64}" } },
    { key: "hl7_overflow_policy_json", value: { value: "{\"PID.3\":\"reject\",\"OBR.20\":\"truncate\"}" } },
    { key: "hl7_extra_fields_json", value: { value: "[{\"segment\":\"OBR\",\"field\":27,\"value\":\"routine\"}]" } },
  ]));
});

test("validateSanteSettingsEntries rejects invalid HL7 compatibility JSON", () => {
  assert.throws(
    () => validateSanteSettingsEntries([
      ...baseEntries,
      { key: "hl7_enabled_fields_json", value: { value: "{\"PID-11\":false}" } },
    ]),
    /HL7 field key/
  );

  assert.throws(
    () => validateSanteSettingsEntries([
      ...baseEntries,
      { key: "hl7_overflow_policy_json", value: { value: "{\"PID.3\":\"silently_cut\"}" } },
    ]),
    /overflow policy/
  );
});
