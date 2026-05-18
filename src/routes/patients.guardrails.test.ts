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
});
