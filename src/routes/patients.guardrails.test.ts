import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

describe("patients route guardrails", () => {
  it("restricts patient deletion to super_admin", async () => {
    const source = await fs.readFile("src/routes/patients.ts", "utf-8");

    assert.match(
      source,
      /patientsRouter\.delete\(\s*"\/:patientId",\s*requireAnyRole\(\["super_admin"\]\),/
    );
  });

  it("forces dictionary-generated English names for non-super-admin patient creation", async () => {
    const source = await fs.readFile("src/routes/patients.ts", "utf-8");

    assert.match(
      source,
      /request\.user\.role === "super_admin"\s*\? request\.body \?\? \{\}\s*:\s*\{ \.\.\.\(request\.body \?\? \{\}\), englishFullName: undefined, autoGenerateEnglish: true \}/
    );
  });

  it("preserves existing English names for non-super-admin patient updates", async () => {
    const source = await fs.readFile("src/routes/patients.ts", "utf-8");

    assert.match(source, /const existingPatient = await getPatientById\(patientId\);/);
    assert.match(source, /throw new HttpError\(403, "Only super admins can edit the English patient name\."\);/);
    assert.match(source, /englishFullName: existingEnglishName, autoGenerateEnglish: false/);
  });

  it("preserves super-admin English-name route behavior", async () => {
    const source = await fs.readFile("src/routes/patients.ts", "utf-8");

    assert.match(source, /if \(request\.user\.role === "super_admin"\) \{\s*const patient = await updatePatient\(patientId, payload, userId\);/);
  });
});
