import test from "node:test";
import assert from "node:assert/strict";
import {
  __dicomRemapRetentionSettingsTestables,
  readDicomRemapRetentionSettings,
  saveDicomRemapRetentionSettings,
} from "./dicom-remap-retention-settings-service.js";
import { HttpError } from "../utils/http-error.js";

test.afterEach(() => __dicomRemapRetentionSettingsTestables.resetDependencies());

test("DICOM remap retention settings default to four days and read stored values", async () => {
  __dicomRemapRetentionSettingsTestables.setDependencies({ load: async () => ({}) });
  assert.deepEqual(await readDicomRemapRetentionSettings(), { sentSourceRetentionDays: 4 });
  __dicomRemapRetentionSettingsTestables.setDependencies({ load: async () => ({ dicom_remap: { sent_source_retention_days: "7" } }) });
  assert.deepEqual(await readDicomRemapRetentionSettings(), { sentSourceRetentionDays: 7 });
});

test("DICOM remap retention saves through system settings with the acting supervisor", async () => {
  const calls: unknown[][] = [];
  __dicomRemapRetentionSettingsTestables.setDependencies({ save: async (...args) => { calls.push(args); return [] as never; } });
  assert.deepEqual(await saveDicomRemapRetentionSettings({ sentSourceRetentionDays: 4 }, 99 as never), { sentSourceRetentionDays: 4 });
  assert.deepEqual(calls, [["dicom_remap", [{ key: "sent_source_retention_days", value: 4 }], 99]]);
});

test("DICOM remap retention rejects invalid values", async () => {
  for (const value of [0, -1, 1.5, 31, "abc"]) {
    await assert.rejects(() => saveDicomRemapRetentionSettings({ sentSourceRetentionDays: value as never }, 1 as never), (error: unknown) => error instanceof HttpError && error.statusCode === 400);
  }
});
