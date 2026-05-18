import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

describe("patient delete guardrails", () => {
  it("cleans patient-linked restrict references before deleting the patient row", async () => {
    const source = await fs.readFile("src/services/patient-service.ts", "utf-8");

    assert.ok(source.includes("delete from appointments_v2.bookings where patient_id = $1"));
    assert.ok(source.includes("delete from scan_sessions where patient_id = $1"));
    assert.ok(source.includes("update dicom_remap_jobs set rispro_patient_id = null"));
    assert.ok(source.includes("update patient_import_staging_rows set matched_existing_patient_id = null"));
    assert.ok(source.includes("update patient_import_staging_rows set migrated_patient_id = null"));
    assert.ok(source.includes("delete from patients where id = $1"));
  });
});
