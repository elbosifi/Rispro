import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../api/routes/read-v2-routes.ts", import.meta.url), "utf8");

test("modality worklist returns primary identifier fields with patient identifier fallback order", () => {
  assert.match(source, /patient_primary_identifier_type/);
  assert.match(source, /patient_primary_identifier_label_ar/);
  assert.match(source, /patient_primary_identifier_label_en/);
  assert.match(source, /patient_primary_identifier_value/);
  assert.match(source, /from patient_identifiers pi/);
  assert.match(source, /pi\.is_primary = true/);
  assert.match(source, /p\.identifier_value/);
  assert.match(source, /nullif\(p\.national_id, ''\)/);
  assert.match(source, /nullif\(p\.mrn, ''\)/);
});

test("modality worklist returns PACS timing fields and PACS auto-completion enablement", () => {
  assert.match(source, /pacs_auto_completion_enabled/);
  assert.match(source, /b\.pacs_study_started_at/);
  assert.match(source, /b\.pacs_first_seen_at/);
  assert.match(source, /b\.auto_completed_at/);
  assert.match(source, /b\.pacs_timing_source/);
  assert.match(source, /b\.pacs_timing_confidence/);
  assert.match(source, /pacs_auto_completion_settings/);
});

test("modality worklist recovers historical status timestamps from both audit entity names", () => {
  assert.match(source, /entity_type in \('appointment_v2_booking', 'appointments_v2_booking'\)/);
});

test("modality worklist returns Routine display for missing reporting priority", () => {
  assert.match(source, /coalesce\(rp\.name_ar, 'روتيني'\) as priority_name_ar/);
  assert.match(source, /coalesce\(rp\.name_en, 'Routine'\) as priority_name_en/);
});
