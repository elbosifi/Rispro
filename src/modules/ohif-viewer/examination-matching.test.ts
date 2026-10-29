import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchAuthoritativeExamination, matchStudyByAccession, selectPatientHistory } from "./validation.js";
import type { ImagingStudy } from "./types.js";

const study: ImagingStudy = {
  patientId: "P-0042", patientIdIssuer: "HOSPITAL", patientName: "SYNTHETIC",
  accessionNumber: "V2-006984", modality: "MR", studyDate: "20261029", studyTime: "120000",
  studyDescription: "SYNTHETIC", studyInstanceUid: "1.2.42",
};
const match = (studies: ImagingStudy[], overrides: Partial<Parameters<typeof matchAuthoritativeExamination>[0]> = {}) =>
  matchAuthoritativeExamination({ studies, accessionNumber: study.accessionNumber, patientId: study.patientId,
    modality: "MR", studyDate: "2026-10-29", ...overrides });
const additional = (uid: string, overrides: Partial<ImagingStudy> = {}): ImagingStudy => ({ ...study, studyInstanceUid: uid, ...overrides });

describe("Authoritative current examination matching", () => {
  for (const count of [1, 2, 3]) it(`opens every verified current acquisition (${count} studies)`, () => {
    const studies = Array.from({ length: count }, (_, i) => additional(`1.2.${42 + i}`));
    const result = match([...studies].reverse());
    assert.equal(result.status, "matched");
    assert.deepEqual(result.studies.map(s => s.studyInstanceUid), studies.map(s => s.studyInstanceUid));
    assert.equal(result.diagnostic.currentStudyCount, count);
  });
  it("deduplicates candidates and preserves the verified existing reporting primary", () => {
    const other = additional("1.2.43");
    const result = match([study, other, study], { preferredPrimaryUid: other.studyInstanceUid });
    assert.deepEqual(result.studies.map(s => s.studyInstanceUid), [other.studyInstanceUid, study.studyInstanceUid]);
    assert.equal(result.study?.studyInstanceUid, other.studyInstanceUid);
    assert.equal(result.candidateCount, 3);
  });
  it("trims DICOM padding while preserving case, punctuation and leading zeros", () => {
    assert.equal(match([{ ...study, patientId: " P-0042 ", accessionNumber: " V2-006984 " }]).status, "matched");
    for (const patientId of ["p-0042", "P-42", "P0042"]) assert.equal(match([{ ...study, patientId }]).diagnostic.reason, "patient_mismatch");
    assert.equal(match([{ ...study, accessionNumber: "v2-006984" }]).diagnostic.reason, "accession_mismatch");
  });
  it("never groups conflicting patients, even if one has the better modality/date score", () => {
    const result = match([study, additional("1.2.43", { patientId: "OTHER", modality: "CT", studyDate: "20260101" })]);
    assert.equal(result.status, "ambiguous");
    assert.equal(result.diagnostic.reason, "identity_conflict");
    assert.deepEqual(result.studies, []);
  });
  it("distinguishes empty results, mismatched patients, missing identity and invalid UIDs", () => {
    assert.equal(match([]).diagnostic.reason, "no_accession_studies");
    assert.equal(match([additional("1.2.43", { patientId: "OTHER" })]).diagnostic.reason, "patient_mismatch");
    assert.equal(match([study], { patientId: null }).diagnostic.reason, "identity_missing");
    assert.equal(match([study, additional("1.2.43", { patientId: "" })]).diagnostic.reason, "identity_missing");
    for (const studyInstanceUid of ["", "invalid", "1.02.3", " 01.2.3 ", "3.2.3", "1.40.3", "1.2." + "3".repeat(64)]) {
      const result = match([study, { ...study, studyInstanceUid }]);
      assert.equal(result.diagnostic.reason, "invalid_study_uid");
      assert.equal(result.diagnostic.invalidUidCount, 1);
      assert.deepEqual(result.studies, []);
    }
  });
  it("reproduces why two raw accession results could previously be reported as not found", () => {
    const studies = [additional("1.2.43", { patientId: "OTHER" }), additional("1.2.44", { patientId: "OTHER" })];
    const oldResult = matchStudyByAccession({ studies, accessionNumber: study.accessionNumber, patientId: study.patientId });
    assert.equal(oldResult.status, "not_found"); assert.equal(oldResult.candidateCount, 0);
    const result = match(studies);
    assert.equal(result.diagnostic.reason, "patient_mismatch");
    assert.equal(result.diagnostic.rawCandidateCount, 2); assert.equal(result.diagnostic.rejectedPatientMismatchCount, 2);
  });
  it("requires consistent issuers and compares an expected issuer when available", () => {
    for (const patientIdIssuer of ["OTHER", "hospital", ""]) assert.equal(match([study, additional("1.2.43", { patientIdIssuer })]).diagnostic.reason, "issuer_conflict");
    assert.equal(match([study], { patientIdIssuer: "OTHER" }).diagnostic.reason, "issuer_conflict");
    assert.equal(match([{ ...study, patientIdIssuer: "" }, additional("1.2.43", { patientIdIssuer: "" })]).status, "matched");
  });
  it("requires examination modality/date evidence for a group", () => {
    for (const overrides of [
      { modality: "CT" }, { modality: "MR\\CT" }, { modality: "" },
      { studyDate: "" }, { studyDate: "20260230" }, { studyDate: "20260929" },
      { studyDate: "20261030", studyTime: "" }, { studyDate: "20261030", studyTime: "130000" },
    ]) assert.equal(match([study, additional("1.2.43", overrides)]).diagnostic.reason, "manual_review");
    assert.equal(match([study, additional("1.2.43", { modality: "MR\\SR" })]).status, "matched");
    assert.equal(match([study, additional("1.2.43", { studyDate: "20261030", studyTime: "010000" })]).status, "matched");
    assert.equal(match([study, additional("1.2.43")], { studyDate: "20261001" }).diagnostic.reason, "manual_review");
    assert.equal(match([study, { ...study, modality: "CT" }]).diagnostic.reason, "manual_review");
  });
  it("separates every current UID from older, same-day and newer patient history", () => {
    const current = [study, additional("1.2.43")];
    const priors = [additional("1.2.44", { accessionNumber: "OLDER", studyDate: "20261001" }), additional("1.2.45", { accessionNumber: "OTHER-EXAM" })];
    assert.deepEqual(selectPatientHistory([...current, ...priors], study, study.patientId, current.map(s => s.studyInstanceUid)).map(s => s.studyInstanceUid), ["1.2.45", "1.2.44"]);
  });
  it("keeps safe diagnostic data free of patient identifiers, names and UIDs", () => {
    const diagnostic = JSON.stringify(match([study, additional("1.2.43", { patientId: "OTHER" })]).diagnostic);
    for (const value of [study.patientId, study.patientName, study.studyInstanceUid, study.accessionNumber, "OTHER"]) assert.equal(diagnostic.includes(value), false);
  });
});
