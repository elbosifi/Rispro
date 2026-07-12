import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSameDicomWebOrigin,
  createLaunchToken,
  hashLaunchToken,
  matchStudyByAccession,
  normalizeDicomWebUrl,
  normalizeEnvironmentKey,
  normalizeViewerBasePath,
  selectPriorStudies,
} from "./validation.js";
import type { ImagingStudy } from "./types.js";

const current: ImagingStudy = {
  patientId: "P-42", patientName: "Patient", accessionNumber: "ACC-42", modality: "CT",
  studyDescription: "Current", studyDate: "20260712", studyInstanceUid: "1.2.840.42",
};

describe("OHIF Viewer validation", () => {
  it("normalizes safe paths and rejects unsafe viewer and upstream URLs", () => {
    assert.equal(normalizeViewerBasePath("/ohif/"), "/ohif");
    assert.throws(() => normalizeViewerBasePath("https://example.test/ohif"), /root-relative/);
    assert.equal(normalizeDicomWebUrl("https://pacs.test/dicom-web/", "root"), "https://pacs.test/dicom-web");
    assert.throws(() => normalizeDicomWebUrl("https://user:secret@pacs.test/dicom-web", "root"), /without credentials/);
    assert.doesNotThrow(() => assertSameDicomWebOrigin("https://pacs.test/dicom-web", "https://pacs.test/qido"));
    assert.throws(() => assertSameDicomWebOrigin("https://pacs.test/dicom-web", "https://other.test/qido"), /allowlisted/);
  });

  it("accepts environment references without accepting secret values", () => {
    assert.equal(normalizeEnvironmentKey("OHIF_DICOMWEB_PASSWORD", "passwordEnvKey", true), "OHIF_DICOMWEB_PASSWORD");
    assert.throws(() => normalizeEnvironmentKey("actual-password", "passwordEnvKey", true), /environment variable name/);
  });

  it("creates random launch tokens and stable one-way hashes", () => {
    const first = createLaunchToken();
    const second = createLaunchToken();
    assert.notEqual(first.token, second.token);
    assert.equal(first.tokenHash, hashLaunchToken(first.token));
    assert.equal(first.tokenHash.length, 64);
    assert.equal(first.tokenHash.includes(first.token), false);
  });

  it("requires exact accession and rejects PatientID conflicts", () => {
    const mismatch = matchStudyByAccession({ studies: [{ ...current, patientId: "OTHER" }], accessionNumber: "ACC-42", patientId: "P-42", modality: "CT", studyDate: "2026-07-12" });
    assert.equal(mismatch.status, "not_found");
    assert.equal(mismatch.rejectedPatientMismatchCount, 1);
    const exact = matchStudyByAccession({ studies: [current], accessionNumber: "ACC-42", patientId: "P-42", modality: "CT", studyDate: "2026-07-12" });
    assert.equal(exact.status, "matched");
    assert.equal(exact.study?.studyInstanceUid, current.studyInstanceUid);
  });

  it("does not silently select equally plausible duplicate studies", () => {
    const result = matchStudyByAccession({
      studies: [current, { ...current, studyInstanceUid: "1.2.840.43" }],
      accessionNumber: "ACC-42", patientId: "P-42", modality: "CT", studyDate: "20260712",
    });
    assert.equal(result.status, "ambiguous");
    assert.equal(result.candidateCount, 2);
  });

  it("sorts same-modality priors first, newest first, and bounds the result", () => {
    const priors = selectPriorStudies({
      currentStudy: current, patientId: "P-42", maxPriors: 2,
      studies: [
        { ...current, accessionNumber: "OLD-MR", modality: "MR", studyDate: "20260711", studyInstanceUid: "1.2.3" },
        { ...current, accessionNumber: "OLD-CT-1", studyDate: "20260710", studyInstanceUid: "1.2.4" },
        { ...current, accessionNumber: "OLD-CT-2", studyDate: "20260701", studyInstanceUid: "1.2.5" },
        { ...current, patientId: "OTHER", accessionNumber: "UNSAFE", studyDate: "20260711", studyInstanceUid: "1.2.6" },
      ],
    });
    assert.deepEqual(priors.map((study) => study.accessionNumber), ["OLD-CT-1", "OLD-CT-2"]);
  });
});
