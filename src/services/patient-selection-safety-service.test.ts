import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ||= "postgresql://example/example";
process.env.JWT_SECRET ||= "patient-selection-test-secret";

const service = await import("./patient-selection-safety-service.js");

function createPatient(id = 1) {
  return { id, mrn: null, arabicFullName: "محمد علي سالم", englishFullName: "Mohamed Ali Salem", category: null, sex: "M", ageYears: 46, estimatedDateOfBirth: "1980-01-02", demographicsEstimated: false, primaryIdentifierType: "national_id", primaryIdentifierTypeLabelAr: "الرقم الوطني", primaryIdentifierTypeLabelEn: "National ID", primaryIdentifierValue: "100000000001", phone1: "0912345678" };
}

function createRisk(patient = createPatient()) {
  const identityFingerprint = service.calculatePatientIdentityFingerprint(patient);
  return { patient, identityRisk: "ambiguous" as const, similarPatientCount: 1, availableVerificationMethods: ["primary_identifier" as const], identityFingerprint, ambiguityRuleVersion: "name_prefix_configurable_primary_identifier_v3" as const };
}

function createDbRow(id: number, identifierValue: string | null) {
  return {
    id,
    mrn: `MRN-${id}`,
    arabic_full_name: "",
    english_full_name: "Mohamed Ali Salem",
    normalized_arabic_name: null,
    normalized_arabic_name_compact: null,
    category: "non_oncology" as const,
    sex: "M",
    age_years: 46,
    estimated_date_of_birth: "1980-01-02",
    demographics_estimated: false,
    phone_1: "0912345678",
    identifier_type: identifierValue ? "national_id" : null,
    identifier_type_label_ar: null,
    identifier_type_label_en: null,
    identifier_value: identifierValue,
  };
}

function createRiskExecutor(identifierValue: string | null, labels: { labelAr?: string | null; labelEn?: string | null } = {}) {
  const requested = { ...createDbRow(1, identifierValue), identifier_type_label_ar: labels.labelAr ?? null, identifier_type_label_en: labels.labelEn ?? null };
  const candidate = createDbRow(2, "OTHER-ID");
  const sqls: string[] = [];
  let call = 0;
  return {
    sqls,
    query: async <T>(sql: string) => {
      sqls.push(sql);
      call += 1;
      return { rows: (call === 1 ? [{ setting_value: { value: "2" } }] : call === 2 ? [requested] : [requested, candidate]) as T[] };
    },
  };
}

test("patient identity ambiguity supports two or three positional name components", () => {
  assert.equal(service.patientNamesAreAmbiguous({ englishA: "Mohamed Ali Salem", englishB: "Mohamed Ali Hassan" }, 3), false);
  assert.equal(service.patientNamesAreAmbiguous({ englishA: "Mohamed Ali Salem", englishB: "Mohamed Ali Salem" }, 3), true);
  assert.equal(service.patientNamesAreAmbiguous({ englishA: "Mohamed Ali Salem", englishB: "Mohamed Ali Hassan" }, 2), true);
  assert.equal(service.patientNamesAreAmbiguous({ englishA: "Mohamed Ali Salem", englishB: "Mohamed Ahmed Salem" }, 2), false);
  assert.equal(service.patientNamesAreAmbiguous({ englishA: "Mohamed Ali", englishB: "Ali Mohamed" }, 2), false);
  assert.equal(service.patientNamesAreAmbiguous({ arabicA: "\u0645\u062d\u0645\u062f \u0639\u0644\u064a \u0633\u0627\u0644\u0645", arabicB: "\u0645\u062d\u0645\u062f \u0639\u0644\u064a \u062d\u0633\u0646" }, 3), false);
  assert.equal(service.patientNamesAreAmbiguous({ arabicA: "\u0645\u062d\u0645\u062f \u0639\u0644\u064a \u0633\u0627\u0644\u0645", arabicB: "\u0645\u062d\u0645\u062f \u0639\u0644\u064a \u062d\u0633\u0646" }, 2), true);
});

test("patient identity Arabic compact-spacing matching follows the configured depth", () => {
  const arabicA = "\u0639\u0628\u062f \u0627\u0644\u0644\u0647 \u0645\u062d\u0645\u062f \u0633\u0627\u0644\u0645";
  const arabicB = "\u0639\u0628\u062f\u0627\u0644\u0644\u0647 \u0645\u062d\u0645\u062f \u0633\u0627\u0644\u0645";
  assert.equal(service.patientNamesAreAmbiguous({ arabicA, arabicB }, 3), true);
  assert.equal(service.patientNamesAreAmbiguous({ arabicA, arabicB }, 2), true);
});

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

test("patient identity name-match setting defaults safely to three components", async () => {
  const read = (settingValue?: unknown) => service.resolvePatientIdentityNameMatchComponents({
    query: async () => ({ rows: settingValue === undefined ? [] : [{ setting_value: settingValue }] }),
  } as never);

  assert.equal(await read(), 3);
  assert.equal(await read({ value: "malformed" }), 3);
  assert.equal(await read({ value: "4" }), 3);
  assert.equal(await read('{"value":"2"}'), 2);
  assert.equal(await read({ value: "2" }), 2);
});

test("verification methods expose only a usable primary identifier and fingerprints preserve identity fields", () => {
  const patient = createPatient();
  assert.deepEqual(service.availablePatientIdentityVerificationMethods(patient), ["primary_identifier"]);
  const before = service.calculatePatientIdentityFingerprint(patient);
  assert.notEqual(before, service.calculatePatientIdentityFingerprint({ ...patient, phone1: "0912345679" }));
  assert.deepEqual(service.availablePatientIdentityVerificationMethods({ ...patient, primaryIdentifierValue: "" }), []);
  assert.deepEqual(service.availablePatientIdentityVerificationMethods({ ...patient, primaryIdentifierValue: "   " }), []);
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
  Object.assign(requested, { arabic_full_name: "", normalized_arabic_name: null, normalized_arabic_name_compact: null, english_full_name: "Mohamed Ali Salem" });
  Object.assign(outsideVisibleResults, { arabic_full_name: "", normalized_arabic_name: null, normalized_arabic_name_compact: null, english_full_name: "Mohamed Ali Hassan" });
  const calls: Array<{ sql: string; values: unknown[] | undefined }> = [];
  const executor = {
    query: async <T>(sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: (calls.length === 1 ? [{ setting_value: { value: "2" } }] : calls.length === 2 ? [requested] : [requested, outsideVisibleResults]) as T[] };
    },
  };

  const risk = (await service.resolvePatientIdentityRisks([7], executor as never)).get(7);
  assert.equal(risk?.identityRisk, "ambiguous");
  assert.equal(risk?.similarPatientCount, 1);
  assert.equal(calls.length, 3);
  assert.match(calls[1].sql, /where p\.id = any\(\$1::bigint\[\]\)/);
  assert.match(calls[2].sql, /where p\.id = any\(\$1::bigint\[\]\) or \(/);
  assert.deepEqual(calls[0].values, [service.PATIENT_IDENTITY_NAME_MATCH_COMPONENTS_SETTING_KEY]);
  assert.deepEqual(calls[1].values, [[7]]);
  assert.ok(calls[2].values?.includes("mohamed ali"));
  assert.ok(!calls[2].sql.includes("where true"));
});

test("primary identifier resolution uses explicit primary rows and blank-safe fallbacks", async () => {
  const blankExecutor = createRiskExecutor(null);
  const blankRisk = await service.resolvePatientIdentityRisk(1, blankExecutor as never);
  assert.deepEqual(blankRisk.availableVerificationMethods, []);
  assert.equal(blankRisk.patient.primaryIdentifierTypeLabelEn, null);
  assert.match(blankExecutor.sqls[1], /pi\.is_primary = true/);
  assert.match(blankExecutor.sqls[1], /nullif\(trim\(pi\.value\), ''\) is not null/);
  assert.match(blankExecutor.sqls[1], /pit\.label_ar as identifier_type_label_ar/);
  assert.match(blankExecutor.sqls[1], /pit\.label_en as identifier_type_label_en/);
  assert.match(blankExecutor.sqls[1], /coalesce\(primary_identifier\.identifier_value, nullif\(trim\(p\.identifier_value\), ''\), nullif\(trim\(p\.national_id\), ''\)\)/);

  for (const identifierValue of ["PRIMARY-ID", "LEGACY-ID", "NATIONAL-ID"]) {
    const executor = createRiskExecutor(identifierValue);
    const risk = await service.resolvePatientIdentityRisk(1, executor as never);
    assert.deepEqual(risk.availableVerificationMethods, ["primary_identifier"]);
    assert.equal(risk.patient.primaryIdentifierTypeLabelEn, "National ID");
    const verified = await service.verifyPatientIdentityEvidence({ patientId: 1, userId: 4, method: "primary_identifier", evidence: identifierValue.toLowerCase(), executor: createRiskExecutor(identifierValue) as never });
    assert.equal(verified.assertion.verificationMethod, "primary_identifier");
  }

  const configuredExecutor = createRiskExecutor("PRIMARY-ID", { labelAr: "رقم بطاقة المستشفى", labelEn: "Hospital card number" });
  const configuredRisk = await service.resolvePatientIdentityRisk(1, configuredExecutor as never);
  assert.equal(configuredRisk.patient.primaryIdentifierTypeLabelAr, "رقم بطاقة المستشفى");
  assert.equal(configuredRisk.patient.primaryIdentifierTypeLabelEn, "Hospital card number");
});

test("primary identifier evidence requires the complete normalized value and rejects legacy methods", async () => {
  const correctExecutor = createRiskExecutor("PRIMARY-ID");
  const correct = await service.verifyPatientIdentityEvidence({ patientId: 1, userId: 4, method: "primary_identifier", evidence: " primary-id ", executor: correctExecutor as never });
  assert.equal(correct.assertion.verificationMethod, "primary_identifier");
  await assert.rejects(
    service.verifyPatientIdentityEvidence({ patientId: 1, userId: 4, method: "primary_identifier", evidence: "ID", executor: createRiskExecutor("PRIMARY-ID") as never }),
    (error: unknown) => error instanceof Error && error.message === "Patient identity verification is incorrect.",
  );
  for (const method of ["exact_dob", "phone_suffix"]) {
    await assert.rejects(
      service.verifyPatientIdentityEvidence({ patientId: 1, userId: 4, method, evidence: "1980-01-02", executor: createRiskExecutor("PRIMARY-ID") as never }),
      (error: unknown) => error instanceof Error && error.message === "Identity verification method is unavailable.",
    );
  }
});

test("signed proofs are bound to the patient, verifier, and current identity fingerprint", () => {
  const patient = { ...createPatient(3), arabicFullName: "مريض اختبار تشابه", englishFullName: "Similar Patient Three", sex: "F", ageYears: 36, estimatedDateOfBirth: "1990-03-04", primaryIdentifierValue: "100000000003" };
  const fingerprint = service.calculatePatientIdentityFingerprint(patient);
  const twoComponentFingerprint = service.calculatePatientIdentityFingerprint(patient, 2);
  assert.notEqual(fingerprint, twoComponentFingerprint);
  const assertion = { patientId: patient.id, verifierUserId: 11, verificationMethod: "primary_identifier" as const, verifiedAt: new Date().toISOString(), identityFingerprint: fingerprint, ambiguityRuleVersion: "name_prefix_configurable_primary_identifier_v3" as const };
  const risk = { patient, identityRisk: "ambiguous" as const, similarPatientCount: 1, availableVerificationMethods: ["primary_identifier" as const], identityFingerprint: fingerprint, ambiguityRuleVersion: "name_prefix_configurable_primary_identifier_v3" as const };
  const proof = service.issuePatientIdentityVerificationProof(assertion);
  assert.deepEqual(service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id, userId: 11, risk }), assertion);
  const twoComponentProof = service.issuePatientIdentityVerificationProof({ ...assertion, identityFingerprint: twoComponentFingerprint });
  assert.throws(() => service.validatePatientIdentityVerificationProof(twoComponentProof, { patientId: patient.id, userId: 11, risk }), /required again/);
  assert.throws(() => service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id, userId: 12, risk }), /required again/);
  assert.throws(() => service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id + 1, userId: 11, risk }), /required again/);
  assert.throws(() => service.validatePatientIdentityVerificationProof(`${proof}tampered`, { patientId: patient.id, userId: 11, risk }), /required again/);
  const expiredProof = jwt.sign({ purpose: service.PATIENT_IDENTITY_PROOF_PURPOSE, ...assertion }, process.env.JWT_SECRET!, { algorithm: "HS256", expiresIn: -1 });
  assert.throws(() => service.validatePatientIdentityVerificationProof(expiredProof, { patientId: patient.id, userId: 11, risk }), /required again/);
  const oldMethodProof = jwt.sign({ purpose: service.PATIENT_IDENTITY_PROOF_PURPOSE, ...assertion, verificationMethod: "exact_dob" }, process.env.JWT_SECRET!, { algorithm: "HS256", expiresIn: 60 });
  assert.throws(() => service.validatePatientIdentityVerificationProof(oldMethodProof, { patientId: patient.id, userId: 11, risk }), /required again/);
  const oldRuleProof = jwt.sign({ purpose: service.PATIENT_IDENTITY_PROOF_PURPOSE, ...assertion, ambiguityRuleVersion: "name_prefix_configurable_v2" }, process.env.JWT_SECRET!, { algorithm: "HS256", expiresIn: 60 });
  assert.throws(() => service.validatePatientIdentityVerificationProof(oldRuleProof, { patientId: patient.id, userId: 11, risk }), /required again/);
  assert.throws(() => service.validatePatientIdentityVerificationProof(proof, { patientId: patient.id, userId: 11, risk: { ...risk, identityFingerprint: "changed" } }), /required again/);
});

test("deferred assertions revalidate the stored verifier and current identity fingerprint without persisting secrets in JSON", () => {
  const patient = createPatient(9);
  const risk = createRisk(patient);
  const assertion = { patientId: 9, verifierUserId: 21, verificationMethod: "primary_identifier" as const, verifiedAt: "2026-01-02T03:04:05.000Z", ambiguityRuleVersion: "name_prefix_configurable_primary_identifier_v3" as const };
  const validated = service.revalidateStoredPatientIdentityAssertion(assertion, { patientId: 9, verifierUserId: 21, expectedIdentityFingerprint: risk.identityFingerprint, risk });
  assert.equal(validated.identityFingerprint, risk.identityFingerprint);
  assert.throws(() => service.revalidateStoredPatientIdentityAssertion(assertion, { patientId: 9, verifierUserId: 22, expectedIdentityFingerprint: risk.identityFingerprint, risk }), /required again/);
  assert.throws(() => service.revalidateStoredPatientIdentityAssertion(assertion, { patientId: 9, verifierUserId: 21, expectedIdentityFingerprint: "stale", risk }), /required again/);
  assert.throws(() => service.revalidateStoredPatientIdentityAssertion({ ...assertion, verificationMethod: "exact_dob" } as never, { patientId: 9, verifierUserId: 21, expectedIdentityFingerprint: risk.identityFingerprint, risk }), /required again/);

  const deferredPayload = { createPayload: { patientIdentityVerificationAssertion: assertion } };
  const auditPayload = { outcome: "successful", verificationMethod: assertion.verificationMethod, ambiguityRuleVersion: assertion.ambiguityRuleVersion };
  const serialized = JSON.stringify({ deferredPayload, auditPayload });
  for (const secret of [patient.primaryIdentifierValue, patient.estimatedDateOfBirth, patient.phone1!.slice(-4), "signed-proof", risk.identityFingerprint, "identityFingerprint"]) {
    assert.equal(serialized.includes(secret), false);
  }
});
