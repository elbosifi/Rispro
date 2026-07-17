import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ||= "postgresql://example/example";
process.env.JWT_SECRET ||= "patient-selection-test-secret";

const service = await import("./patient-selection-safety-service.js");

test("patient identity ambiguity uses normalized first three Arabic tokens and compact spacing", () => {
  assert.equal(service.patientNamesAreAmbiguous({ arabicA: "محمد علي سالم إبراهيم", arabicB: "محمد علي سالم أحمد" }), true);
  assert.equal(service.patientNamesAreAmbiguous({ arabicA: "عبد الله محمد سالم", arabicB: "عبدالله محمد سالم" }), true);
  assert.equal(service.patientNamesAreAmbiguous({ arabicA: "محمد علي سالم", arabicB: "محمد علي مختلف" }), false);
});

test("patient identity ambiguity uses complete names when either name has fewer than three tokens", () => {
  assert.equal(service.patientNamesAreAmbiguous({ englishA: "Jane Doe", englishB: "Jane Doe" }), true);
  assert.equal(service.patientNamesAreAmbiguous({ englishA: "Jane Doe", englishB: "Jane Roe" }), false);
  assert.equal(service.patientNamesAreAmbiguous({ englishA: "Jane Doe Smith One", englishB: "Jane Doe Smith Two" }), true);
});

test("verification methods and fingerprints preserve exact-DOB safety", () => {
  const patient = { id: 1, mrn: null, arabicFullName: "محمد علي سالم", englishFullName: "Mohamed Ali Salem", category: null, sex: "M", ageYears: 46, estimatedDateOfBirth: "1980-01-02", demographicsEstimated: false, primaryIdentifierType: "national_id", primaryIdentifierValue: "100000000001", phone1: "0912345678" };
  assert.deepEqual(service.availablePatientIdentityVerificationMethods(patient), ["primary_identifier", "exact_dob", "phone_suffix"]);
  const before = service.calculatePatientIdentityFingerprint(patient);
  assert.notEqual(before, service.calculatePatientIdentityFingerprint({ ...patient, phone1: "0912345679" }));
  assert.deepEqual(service.availablePatientIdentityVerificationMethods({ ...patient, demographicsEstimated: true }), ["primary_identifier", "phone_suffix"]);
});

test("signed proofs are bound to the patient, verifier, and current identity fingerprint", () => {
  const patient = { id: 3, mrn: null, arabicFullName: "مريض اختبار تشابه", englishFullName: "Similar Patient Three", category: null, sex: "F", ageYears: 36, estimatedDateOfBirth: "1990-03-04", demographicsEstimated: false, primaryIdentifierType: "national_id", primaryIdentifierValue: "100000000003", phone1: "0912345678" };
  const fingerprint = service.calculatePatientIdentityFingerprint(patient);
  const assertion = { patientId: patient.id, verifierUserId: 11, verificationMethod: "primary_identifier" as const, verifiedAt: new Date().toISOString(), identityFingerprint: fingerprint, ambiguityRuleVersion: "name_first_three_v1" as const };
  const risk = { patient, identityRisk: "ambiguous" as const, similarPatientCount: 1, availableVerificationMethods: ["primary_identifier" as const], identityFingerprint: fingerprint, ambiguityRuleVersion: "name_first_three_v1" as const };
  const proof = service.issuePatientIdentityVerificationProof(assertion);
  assert.deepEqual(service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id, userId: 11, risk }), assertion);
  assert.throws(() => service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id, userId: 12, risk }), /required again/);
  assert.throws(() => service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id, userId: 11, risk: { ...risk, identityFingerprint: "changed" } }), /required again/);
});
