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

  assert.match(source, /patientMerge\.manualWorkbench/);
  assert.match(source, /searchPatientsForDuplicateResolver/);
  assert.match(source, /mergePatientDuplicateGroup/);
  assert.match(source, /manualSelection/);
  assert.match(source, /patientMerge\.finalSurvivorDetails/);
  assert.match(source, /usePatientField/);
  assert.match(source, /draftToPatientPayload/);
  assert.match(source, /dateInputValue/);
  assert.match(source, /patientMerge\.toast\.mergeFailed/);
});

test("duplicate resolver exposes matching controls and conflict review", async () => {
  const source = await readFile(new URL("../../../frontend/src/pages/settings/patient-duplicate-resolver-section.tsx", import.meta.url), "utf8");

  assert.match(source, /patientMerge\.matchThreshold/);
  assert.match(source, /patientMerge\.refreshCandidates/);
  assert.match(source, /candidateSort/);
  assert.match(source, /SignalBadges/);
  assert.match(source, /ConflictSummary/);
  assert.match(source, /conflictsAcknowledged/);
});

test("patient merge workbench is available as a role-controlled page", async () => {
  const appSource = await readFile(new URL("../../../frontend/src/App.tsx", import.meta.url), "utf8");
  const routeRegistrySource = await readFile(new URL("../../../frontend/src/lib/route-registry.ts", import.meta.url), "utf8");
  const visibilitySource = await readFile(new URL("../../../frontend/src/lib/page-visibility.ts", import.meta.url), "utf8");

  assert.match(appSource, /patients\.merge/);
  assert.match(appSource, /PatientMergePage/);
  assert.match(routeRegistrySource, /nav\.patientMerge/);
  assert.match(visibilitySource, /patients\.merge/);
});

test("patient merge UI strings use i18n keys", async () => {
  const resolverSource = await readFile(new URL("../../../frontend/src/pages/settings/patient-duplicate-resolver-section.tsx", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../../../frontend/src/pages/patient-merge/patient-merge-page.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../../../frontend/src/lib/i18n.ts", import.meta.url), "utf8");

  assert.match(pageSource, /patientMerge\.title/);
  assert.match(pageSource, /patientMerge\.description/);
  assert.match(resolverSource, /useLanguage/);
  assert.match(resolverSource, /patientMerge\.field\.dob/);
  assert.match(i18nSource, /"patientMerge\.manualWorkbench"/);
  assert.match(i18nSource, /"patientMerge\.toast\.mergeFailed"/);
});

test("patient form not-allowed word errors use i18n keys", async () => {
  const source = await readFile(new URL("../../../frontend/src/components/patients/patient-form.tsx", import.meta.url), "utf8");
  const i18nSource = await readFile(new URL("../../../frontend/src/lib/i18n.ts", import.meta.url), "utf8");

  assert.match(source, /patients\.arabicNameNotAllowedWord/);
  assert.match(source, /localizedPatientError/);
  assert.match(i18nSource, /"patients\.arabicNameNotAllowedWord"/);
});

test("name dictionary is a role-controlled navigation page with advanced controls", async () => {
  const appSource = await readFile(new URL("../../../frontend/src/App.tsx", import.meta.url), "utf8");
  const routeRegistrySource = await readFile(new URL("../../../frontend/src/lib/route-registry.ts", import.meta.url), "utf8");
  const visibilitySource = await readFile(new URL("../../../frontend/src/lib/page-visibility.ts", import.meta.url), "utf8");
  const pageSource = await readFile(new URL("../../../frontend/src/pages/name-dictionary/name-dictionary-page.tsx", import.meta.url), "utf8");

  assert.match(appSource, /name\.dictionary/);
  assert.match(routeRegistrySource, /nav\.nameDictionary/);
  assert.match(visibilitySource, /name\.dictionary/);
  assert.match(pageSource, /sortMode/);
  assert.match(pageSource, /applyNameDictionaryToPatients/);
});
