import test from "node:test";
import assert from "node:assert/strict";
import { validateOrthancSettingsEntries } from "./orthanc-settings-resolver.js";

test("validateOrthancSettingsEntries accepts valid payload", () => {
  assert.doesNotThrow(() =>
    validateOrthancSettingsEntries([
      { key: "enabled", value: { value: "true" } },
      { key: "base_url", value: { value: "https://orthanc.local:8042" } },
      { key: "shadow_mode", value: { value: "false" } },
      { key: "verify_tls", value: { value: "true" } },
      { key: "timeout_seconds", value: { value: "15" } },
    ])
  );
});

test("validateOrthancSettingsEntries rejects unsupported keys", () => {
  assert.throws(
    () =>
      validateOrthancSettingsEntries([
        { key: "unexpected_key", value: { value: "x" } },
      ]),
    /Unsupported orthanc_mwl_sync key/
  );
});

test("validateOrthancSettingsEntries rejects invalid boolean values", () => {
  assert.throws(
    () =>
      validateOrthancSettingsEntries([
        { key: "enabled", value: { value: "maybe" } },
      ]),
    /must be a boolean-like value/
  );
});

test("validateOrthancSettingsEntries rejects invalid timeout", () => {
  assert.throws(
    () =>
      validateOrthancSettingsEntries([
        { key: "timeout_seconds", value: { value: "0" } },
      ]),
    /timeout_seconds must be a positive integer/
  );
});

test("validateOrthancSettingsEntries requires base_url when enabled=true in same payload", () => {
  assert.throws(
    () =>
      validateOrthancSettingsEntries([
        { key: "enabled", value: { value: "true" } },
        { key: "base_url", value: { value: "" } },
      ]),
    /base_url is required when enabled=true/
  );
});
