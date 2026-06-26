import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const patientDirectoryServiceSource = readFileSync(new URL("./patient-directory-service.ts", import.meta.url), "utf8");
const adminRouteSource = readFileSync(new URL("../routes/admin.ts", import.meta.url), "utf8");
const patientsRouteSource = readFileSync(new URL("../routes/patients.ts", import.meta.url), "utf8");
const sonicDicomReportSource = readFileSync(new URL("./sonicdicom-report-service.ts", import.meta.url), "utf8");
const schedulingRouteSource = readFileSync(
  new URL("../modules/appointments-v2/api/routes/scheduling-v2-routes.ts", import.meta.url),
  "utf8",
);

test("patient directory queries use parameter arrays instead of interpolating request values", () => {
  assert.match(patientDirectoryServiceSource, /pool\.query<\{ total: string \}>\(countQuery,\s*directoryWhere\.values\)/);
  assert.match(patientDirectoryServiceSource, /pool\.query<Record<string, unknown>>\(query,\s*queryParams\)/);
  assert.doesNotMatch(patientDirectoryServiceSource, /p\.category = '\$\{category\}'/);
  assert.doesNotMatch(patientDirectoryServiceSource, /p\.age_years >= \$\{ageMin/);
  assert.doesNotMatch(patientDirectoryServiceSource, /ilike '\$\{normalizedTerm\}'/);
});

test("backup downloads accept passphrases through headers only", () => {
  assert.match(adminRouteSource, /req\.header\("x-backup-passphrase"\)/);
  assert.doesNotMatch(adminRouteSource, /req\.query\.passphrase/);
});

test("patient directory route does not log PHI-adjacent query parameters", () => {
  assert.doesNotMatch(patientsRouteSource, /console\.log\("Directory query params:/);
});

test("scheduling routes parse and clamp numeric query parameters", () => {
  assert.match(schedulingRouteSource, /parsePositiveIntQuery\(req\.query\.modalityId, "modalityId"/);
  assert.match(schedulingRouteSource, /parseBoundedIntQuery\(req\.query\.days, "days", 14, 0, 60\)/);
  assert.match(schedulingRouteSource, /parseBoundedIntQuery\(req\.query\.offset, "offset", 0, 0, 365\)/);
  assert.match(schedulingRouteSource, /parseCaseCategoryQuery\(req\.query\.caseCategory/);
  assert.match(schedulingRouteSource, /parseCapacityResolutionModeQuery\(req\.query\.capacityResolutionMode/);
});

test("SonicDICOM report service uses direct dynamic import", () => {
  assert.match(sonicDicomReportSource, /await import\("mssql"\)/);
  assert.doesNotMatch(sonicDicomReportSource, /new Function\("specifier"/);
});
