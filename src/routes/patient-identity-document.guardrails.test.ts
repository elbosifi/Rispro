import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("patient identity document routes keep management roles explicit", async () => {
  const patientsRoute = await readFile(new URL("./patients.ts", import.meta.url), "utf8");
  const documentsRoute = await readFile(new URL("./documents.ts", import.meta.url), "utf8");
  const publicReportingRoute = await readFile(
    new URL("../modules/doctor-portal/reporting-board-public-routes.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    patientsRoute,
    /get\(\s*"\/:patientId\/identity-document",\s*requireAnyRole\(\["receptionist", "supervisor", "super_admin"\]\),/s,
  );
  assert.match(
    patientsRoute,
    /post\(\s*"\/:patientId\/identity-document\/verify",\s*requireAnyRole\(\["receptionist", "supervisor", "super_admin"\]\),/s,
  );
  assert.match(
    patientsRoute,
    /post\(\s*"\/:patientId\/identity-document\/revoke",\s*requireAnyRole\(\["supervisor", "super_admin"\]\),/s,
  );
  assert.match(documentsRoute, /Not authorized to upload patient identity documents/);
  assert.match(documentsRoute, /Not authorized to view patient identity documents/);
  assert.match(publicReportingRoute, /Patient identity documents are not available through public reporting links/);
});
