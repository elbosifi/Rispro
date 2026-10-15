import { describe, expect, it } from "vitest";

import { buildRadiantPatientUrl, buildRadiantStudyUrl } from "./radiant";

describe("RadiAnt URL builders", () => {
  it("opens all studies for a patient by DICOM Patient ID", () => {
    expect(buildRadiantPatientUrl(" PRIMARY-42 ")).toBe("radiant://?n=pstv&v=00100020&v=%22PRIMARY-42%22");
  });

  it("prefers StudyInstanceUID for an exact-study launch", () => {
    const url = buildRadiantStudyUrl({ studyInstanceUid: " 1.2.840.10008.123 ", accessionNumber: "SAME-ACC" });

    expect(url).toBe("radiant://?n=pstv&v=0020000D&v=%221.2.840.10008.123%22");
    expect(url).not.toContain("SAME-ACC");
  });

  it("falls back to accession when StudyInstanceUID is unavailable", () => {
    expect(buildRadiantStudyUrl({ studyInstanceUid: null, accessionNumber: " ACC-42 " })).toBe("radiant://?n=pstv&v=00080050&v=%22ACC-42%22");
  });

  it("returns null when exact-study identity is empty", () => {
    expect(buildRadiantStudyUrl({})).toBeNull();
    expect(buildRadiantStudyUrl({ studyInstanceUid: "  ", accessionNumber: "" })).toBeNull();
  });

  it("returns null when Patient ID is empty", () => {
    expect(buildRadiantPatientUrl("  ")).toBeNull();
    expect(buildRadiantPatientUrl(null)).toBeNull();
  });

  it("keeps studies with duplicate accessions distinct by StudyInstanceUID", () => {
    const first = buildRadiantStudyUrl({ studyInstanceUid: "1.2.duplicate.one", accessionNumber: "SAME-ACC" });
    const second = buildRadiantStudyUrl({ studyInstanceUid: "1.2.duplicate.two", accessionNumber: "SAME-ACC" });

    expect(first).not.toBe(second);
    expect(first).toContain("%221.2.duplicate.one%22");
    expect(second).toContain("%221.2.duplicate.two%22");
  });
});
