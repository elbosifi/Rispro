import test from "node:test";
import assert from "node:assert/strict";
import { scorePatientDuplicatePair } from "./patient-duplicate-scoring.js";
import { normalizeArabicNameCompact } from "../utils/normalize.js";

const basePatient = {
  id: 1,
  mrn: "MRN-1",
  national_id: null,
  identifier_type: "national_id",
  identifier_value: null,
  arabic_full_name: "محمد علي",
  english_full_name: "Mohamed Ali",
  normalized_arabic_name: "محمد علي",
  normalized_arabic_name_compact: "محمدعلي",
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

test("patient duplicate scoring distinguishes similar names from exact name matches", () => {
  const result = scorePatientDuplicatePair(
    { ...basePatient, arabic_full_name: "Alpha", normalized_arabic_name: "alpha", normalized_arabic_name_compact: "alpha", english_full_name: "Mohamed Ali" },
    { ...basePatient, arabic_full_name: "Beta", normalized_arabic_name: "beta", normalized_arabic_name_compact: "beta", english_full_name: "Mohamed Aly" }
  );

  assert.ok(result.reasons.includes("similar_name"));
  assert.equal(result.reasons.includes("name_match"), false);
  assert.ok(result.signals.some((signal) => signal.field === "english_name" && signal.status === "similar"));
});

test("patient duplicate scoring weights English names like Arabic names", () => {
  const result = scorePatientDuplicatePair(
    { ...basePatient, arabic_full_name: "Alpha", normalized_arabic_name: "alpha", english_full_name: "Kawthar Abdullah Abdelrahim", phone_1: "0911111111" },
    { ...basePatient, arabic_full_name: "Beta", normalized_arabic_name: "beta", english_full_name: "Kawthar Abdullah Abdelrahim", phone_1: "0922222222" }
  );

  assert.ok(result.score >= 75);
  assert.ok(result.signals.some((signal) => signal.field === "english_name" && (signal.status === "match" || signal.status === "similar")));
});

test("patient duplicate scoring reports hard conflicts without blocking signal output", () => {
  const result = scorePatientDuplicatePair(
    { ...basePatient, national_id: "111111111111", identifier_value: "111111111111", sex: "M" },
    { ...basePatient, national_id: "222222222222", identifier_value: "222222222222", sex: "F" }
  );

  assert.ok(result.conflicts.some((conflict) => conflict.field === "identifier"));
  assert.ok(result.conflicts.some((conflict) => conflict.field === "sex"));
  assert.ok(result.signals.some((signal) => signal.status === "mismatch"));
});

test("patient duplicate scoring treats compact Arabic compound variants as name matches", () => {
  const result = scorePatientDuplicatePair(
    { ...basePatient, arabic_full_name: "عبد الله", normalized_arabic_name: "عبد الله", normalized_arabic_name_compact: normalizeArabicNameCompact("عبد الله"), english_full_name: "First Person" },
    { ...basePatient, arabic_full_name: "عبدالله", normalized_arabic_name: "عبدالله", normalized_arabic_name_compact: normalizeArabicNameCompact("عبدالله"), english_full_name: "Second Person", phone_1: "0922222222" }
  );

  assert.ok(result.score >= 75);
  assert.ok(result.reasons.includes("name_match"));
  assert.ok(result.signals.some((signal) => signal.field === "arabic_name_compact" && signal.status === "match"));
});

test("patient duplicate scoring does not match empty compact Arabic names", () => {
  const result = scorePatientDuplicatePair(
    { ...basePatient, arabic_full_name: "", normalized_arabic_name: "", normalized_arabic_name_compact: "", english_full_name: "", phone_1: "0911111111" },
    { ...basePatient, arabic_full_name: "", normalized_arabic_name: "", normalized_arabic_name_compact: "", english_full_name: "", phone_1: "0922222222" }
  );

  assert.equal(result.reasons.includes("name_match"), false);
  assert.equal(result.signals.some((signal) => signal.field === "arabic_name_compact"), false);
});

test("patient duplicate scoring does not make compact fuzzy demographic conflicts high confidence by itself", () => {
  const result = scorePatientDuplicatePair(
    { ...basePatient, arabic_full_name: "عبد الله", normalized_arabic_name: "عبد الله", normalized_arabic_name_compact: normalizeArabicNameCompact("عبد الله"), estimated_date_of_birth: "1986-01-01", sex: "M", phone_1: "0911111111" },
    { ...basePatient, arabic_full_name: "عبدالله", normalized_arabic_name: "عبدالله", normalized_arabic_name_compact: normalizeArabicNameCompact("عبدالله"), estimated_date_of_birth: "1999-01-01", sex: "F", phone_1: "0922222222" }
  );

  assert.ok(result.score < 75);
  assert.ok(result.conflicts.some((conflict) => conflict.field === "date_of_birth"));
  assert.ok(result.conflicts.some((conflict) => conflict.field === "sex"));
});
