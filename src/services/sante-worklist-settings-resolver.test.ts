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
