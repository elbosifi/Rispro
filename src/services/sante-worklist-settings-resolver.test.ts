import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "test-secret";

const { validateSanteSettingsEntries } = await import("./sante-worklist-settings-resolver.js");

const baseEntries = [
  { key: "enabled", value: { value: "true" } },
  { key: "mode", value: { value: "shadow" } },
  { key: "output_folder_path", value: { value: "storage/sante-hl7-output" } },
  { key: "file_extension", value: { value: ".hl7" } },
];

test("validateSanteSettingsEntries accepts configured file-drop settings", () => {
  assert.doesNotThrow(() => validateSanteSettingsEntries(baseEntries));
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
