import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("settings page exposes the patient duplicate resolver section", async () => {
  const source = await readFile(new URL("../../../frontend/src/pages/settings/settings-page.tsx", import.meta.url), "utf8");

  assert.match(source, /patient_duplicate_resolver/);
  assert.match(source, /PatientDuplicateResolverSection/);
  assert.match(source, /Patient Duplicate Resolver/);
});

test("duplicate resolver supports manual search and group merge UI", async () => {
  const source = await readFile(new URL("../../../frontend/src/pages/settings/patient-duplicate-resolver-section.tsx", import.meta.url), "utf8");

  assert.match(source, /Manual merge workbench/);
  assert.match(source, /searchPatientsForDuplicateResolver/);
  assert.match(source, /mergePatientDuplicateGroup/);
  assert.match(source, /manualSelection/);
  assert.match(source, /Final survivor details/);
  assert.match(source, /usePatientField/);
  assert.match(source, /draftToPatientPayload/);
  assert.match(source, /dateInputValue/);
  assert.match(source, /Merge failed/);
});

test("duplicate resolver exposes matching controls and conflict review", async () => {
  const source = await readFile(new URL("../../../frontend/src/pages/settings/patient-duplicate-resolver-section.tsx", import.meta.url), "utf8");

  assert.match(source, /Match threshold/);
  assert.match(source, /Refresh candidates/);
  assert.match(source, /candidateSort/);
  assert.match(source, /SignalBadges/);
  assert.match(source, /ConflictSummary/);
  assert.match(source, /conflictsAcknowledged/);
});

test("patient merge workbench is available as a role-controlled page", async () => {
  const appSource = await readFile(new URL("../../../frontend/src/App.tsx", import.meta.url), "utf8");
  const navSource = await readFile(new URL("../../../frontend/src/components/layout/navigation.tsx", import.meta.url), "utf8");
  const visibilitySource = await readFile(new URL("../../../frontend/src/lib/page-visibility.ts", import.meta.url), "utf8");

  assert.match(appSource, /patients\.merge/);
  assert.match(appSource, /PatientMergePage/);
  assert.match(navSource, /nav\.patientMerge/);
  assert.match(visibilitySource, /patients\.merge/);
});
