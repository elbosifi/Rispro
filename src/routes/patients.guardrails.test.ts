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

  it("forces dictionary-generated English names for every patient creation", async () => {
    const source = await fs.readFile("src/routes/patients.ts", "utf-8");

    assert.match(
      source,
      /const payload = \{ \.\.\.\(request\.body \?\? \{\}\), englishFullName: undefined, autoGenerateEnglish: true \};/
    );
    assert.doesNotMatch(source, /request\.user\.role === "super_admin"\s*\? request\.body/);
  });

  it("preserves existing English names and rejects manual changes for every patient update", async () => {
    const source = await fs.readFile("src/routes/patients.ts", "utf-8");

    assert.match(source, /const existingPatient = await getPatientById\(patientId\);/);
    assert.match(source, /throw new HttpError\(403, "English patient name is generated from the name dictionary and cannot be edited manually\."\);/);
    assert.match(source, /englishFullName: existingEnglishName, autoGenerateEnglish: false/);
    assert.doesNotMatch(source, /if \(request\.user\.role === "super_admin"\)/);
  });
});
