import test from "node:test";
import assert from "node:assert/strict";
import { scorePatientDuplicatePair } from "./patient-duplicate-scoring.js";

const basePatient = {
  id: 1,
  mrn: "MRN-1",
  national_id: null,
  identifier_type: "national_id",
  identifier_value: null,
  arabic_full_name: "محمد علي",
  english_full_name: "Mohamed Ali",
  normalized_arabic_name: "محمد علي",
  age_years: 40,
  estimated_date_of_birth: "1986-01-01",
  sex: "M",
  phone_1: "0912345678",
  phone_2: null,
  category: "non_oncology" as const,
};

test("patient duplicate scoring treats shared identifiers as high confidence", () => {
  const result = scorePatientDuplicatePair(
    { ...basePatient, identifier_value: "123456789012", national_id: "123456789012" },
    { ...basePatient, identifier_value: "123456789012", national_id: "123456789012", phone_1: "0922222222" }
  );

  assert.equal(result.score, 100);
  assert.ok(result.reasons.includes("identifier_match"));
});

test("patient duplicate scoring catches fuzzy name with demographics", () => {
  const result = scorePatientDuplicatePair(
    basePatient,
    {
      ...basePatient,
      identifier_value: null,
      national_id: null,
      arabic_full_name: "محمد على",
      normalized_arabic_name: "محمد على",
      english_full_name: "Mohammad Ali",
      phone_1: "0922222222",
    }
  );

  assert.ok(result.score >= 75);
  assert.ok(result.reasons.includes("name_match") || result.reasons.includes("similar_name"));
  assert.ok(result.reasons.includes("date_of_birth_match"));
});
