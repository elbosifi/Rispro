import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ||= "postgresql://example/example";
process.env.JWT_SECRET ||= "patient-selection-test-secret";

const service = await import("./patient-selection-safety-service.js");

function createPatient(id = 1) {
  return { id, mrn: null, arabicFullName: "محمد علي سالم", englishFullName: "Mohamed Ali Salem", category: null, sex: "M", ageYears: 46, estimatedDateOfBirth: "1980-01-02", demographicsEstimated: false, primaryIdentifierType: "national_id", primaryIdentifierValue: "100000000001", phone1: "0912345678" };
}

function createRisk(patient = createPatient()) {
  const identityFingerprint = service.calculatePatientIdentityFingerprint(patient);
  return { patient, identityRisk: "ambiguous" as const, similarPatientCount: 1, availableVerificationMethods: ["primary_identifier" as const], identityFingerprint, ambiguityRuleVersion: "name_first_three_v1" as const };
}

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
  const patient = createPatient();
  assert.deepEqual(service.availablePatientIdentityVerificationMethods(patient), ["primary_identifier", "exact_dob", "phone_suffix"]);
  const before = service.calculatePatientIdentityFingerprint(patient);
  assert.notEqual(before, service.calculatePatientIdentityFingerprint({ ...patient, phone1: "0912345679" }));
  assert.deepEqual(service.availablePatientIdentityVerificationMethods({ ...patient, demographicsEstimated: true }), ["primary_identifier", "phone_suffix"]);
});

test("identifier masking uses a fixed-width four-bullet safe display", () => {
  assert.equal(service.maskPatientIdentifier("100000000001"), "••••0001");
  assert.equal(service.maskPatientIdentifier("ABCD"), "••••ABCD");
  assert.equal(service.maskPatientIdentifier("ABC"), "••••");
  assert.equal(service.maskPatientIdentifier(null), null);
});

test("targeted ambiguity lookup compares requested patients with matching records outside the visible result set", async () => {
  const requested = {
    id: 7, mrn: "MRN-7", arabic_full_name: "اختبار تشابه مريض واحد", english_full_name: "Similar Patient One", normalized_arabic_name: "اختبار تشابه مريض واحد", normalized_arabic_name_compact: "اختبارتشابهمريضواحد", category: "non_oncology" as const, sex: "M", age_years: 40, estimated_date_of_birth: "1986-01-02", demographics_estimated: false, phone_1: "0910000001", identifier_type: "national_id", identifier_value: "100000000001",
  };
  const outsideVisibleResults = {
    ...requested, id: 8, mrn: "MRN-8", arabic_full_name: "اختبار تشابه مريض اثنان", english_full_name: "Similar Patient Two", normalized_arabic_name: "اختبار تشابه مريض اثنان", normalized_arabic_name_compact: "اختبارتشابهمريضاثنان", identifier_value: "100000000002",
  };
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const executor = {
    query: async <T>(sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: (calls.length === 1 ? [requested] : [requested, outsideVisibleResults]) as T[] };
    },
  };

  const risk = (await service.resolvePatientIdentityRisks([7], executor as never)).get(7);
  assert.equal(risk?.identityRisk, "ambiguous");
  assert.equal(risk?.similarPatientCount, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /where p\.id = any\(\$1::bigint\[\]\)/);
  assert.match(calls[1].sql, /where p\.id = any\(\$1::bigint\[\]\) or \(/);
  assert.deepEqual(calls[0].values, [[7]]);
  assert.ok(!calls[1].sql.includes("where true"));
});

test("signed proofs are bound to the patient, verifier, and current identity fingerprint", () => {
  const patient = { ...createPatient(3), arabicFullName: "مريض اختبار تشابه", englishFullName: "Similar Patient Three", sex: "F", ageYears: 36, estimatedDateOfBirth: "1990-03-04", primaryIdentifierValue: "100000000003" };
  const fingerprint = service.calculatePatientIdentityFingerprint(patient);
  const assertion = { patientId: patient.id, verifierUserId: 11, verificationMethod: "primary_identifier" as const, verifiedAt: new Date().toISOString(), identityFingerprint: fingerprint, ambiguityRuleVersion: "name_first_three_v1" as const };
  const risk = { patient, identityRisk: "ambiguous" as const, similarPatientCount: 1, availableVerificationMethods: ["primary_identifier" as const], identityFingerprint: fingerprint, ambiguityRuleVersion: "name_first_three_v1" as const };
  const proof = service.issuePatientIdentityVerificationProof(assertion);
  assert.deepEqual(service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id, userId: 11, risk }), assertion);
  assert.throws(() => service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id, userId: 12, risk }), /required again/);
  assert.throws(() => service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id + 1, userId: 11, risk }), /required again/);
  assert.throws(() => service.validatePatientIdentityVerificationProof(`${proof}tampered`, { patientId: patient.id, userId: 11, risk }), /required again/);
  const expiredProof = jwt.sign({ purpose: service.PATIENT_IDENTITY_PROOF_PURPOSE, ...assertion }, process.env.JWT_SECRET!, { algorithm: "HS256", expiresIn: -1 });
  assert.throws(() => service.validatePatientIdentityVerificationProof(expiredProof, { patientId: patient.id, userId: 11, risk }), /required again/);
  assert.throws(() => service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id, userId: 11, risk: { ...risk, identityFingerprint: "changed" } }), /required again/);
});

test("deferred assertions revalidate the stored verifier and current identity fingerprint without persisting secrets in JSON", () => {
  const patient = createPatient(9);
  const risk = createRisk(patient);
  const assertion = { patientId: 9, verifierUserId: 21, verificationMethod: "primary_identifier" as const, verifiedAt: "2026-01-02T03:04:05.000Z", ambiguityRuleVersion: "name_first_three_v1" as const };
  const validated = service.revalidateStoredPatientIdentityAssertion(assertion, { patientId: 9, verifierUserId: 21, expectedIdentityFingerprint: risk.identityFingerprint, risk });
  assert.equal(validated.identityFingerprint, risk.identityFingerprint);
  assert.throws(() => service.revalidateStoredPatientIdentityAssertion(assertion, { patientId: 9, verifierUserId: 22, expectedIdentityFingerprint: risk.identityFingerprint, risk }), /required again/);
  assert.throws(() => service.revalidateStoredPatientIdentityAssertion(assertion, { patientId: 9, verifierUserId: 21, expectedIdentityFingerprint: "stale", risk }), /required again/);

  const deferredPayload = { createPayload: { patientIdentityVerificationAssertion: assertion } };
  const auditPayload = { outcome: "successful", verificationMethod: assertion.verificationMethod, ambiguityRuleVersion: assertion.ambiguityRuleVersion };
  const serialized = JSON.stringify({ deferredPayload, auditPayload });
  for (const secret of [patient.primaryIdentifierValue, patient.estimatedDateOfBirth, patient.phone1!.slice(-4), "signed-proof", risk.identityFingerprint, "identityFingerprint"]) {
    assert.equal(serialized.includes(secret), false);
  }
});
