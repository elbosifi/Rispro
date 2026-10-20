import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

process.env.DATABASE_URL ??= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ??= "test-secret";

const { preparePatientUpdatePayload } = await import("./patients.js");

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

  it("uses server-side dictionary regeneration only for Arabic corrections or explicit regeneration", () => {
    const existingPatient = { arabic_full_name: "محمد علي حسن", english_full_name: "Mohamed Ali Hassan" };

    assert.deepEqual(
      preparePatientUpdatePayload({ arabicFullName: "محمد أحمد حسن", englishFullName: "Mohamed Ahmed Hassan" }, existingPatient),
      { arabicFullName: "محمد أحمد حسن", englishFullName: undefined, autoGenerateEnglish: true }
    );
    assert.deepEqual(
      preparePatientUpdatePayload({ arabicFullName: "محمد علي حسن", regenerateEnglishName: true }, existingPatient),
      { arabicFullName: "محمد علي حسن", englishFullName: undefined, autoGenerateEnglish: true }
    );
    assert.deepEqual(
      preparePatientUpdatePayload({ arabicFullName: "محمد علي حسن", phone1: "0912345678" }, existingPatient),
      { arabicFullName: "محمد علي حسن", phone1: "0912345678", englishFullName: "Mohamed Ali Hassan", autoGenerateEnglish: false }
    );
  });

  it("rejects a manual English override while retaining server-side update protection", async () => {
    const source = await fs.readFile("src/routes/patients.ts", "utf-8");

    assert.throws(
      () => preparePatientUpdatePayload(
        { arabicFullName: "محمد علي حسن", englishFullName: "Manual English Name" },
        { arabic_full_name: "محمد علي حسن", english_full_name: "Mohamed Ali Hassan" }
      ),
      { name: "HttpError", message: "English patient name is generated from the name dictionary and cannot be edited manually." }
    );
    assert.match(source, /throw new HttpError\(403, "English patient name is generated from the name dictionary and cannot be edited manually\."\);/);
    assert.match(source, /englishFullName: undefined, autoGenerateEnglish: true/);
    assert.match(source, /englishFullName: existingPatient\.english_full_name \?\? undefined, autoGenerateEnglish: false/);
    assert.doesNotMatch(source, /if \(request\.user\.role === "super_admin"\)/);
  });
});
