import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __resolveSonicDicomStudyNotesForTest } from "./sonicdicom-report-service.js";

describe("SonicDICOM study note lookup", () => {
  it("prefers StudyInstanceUID and trims non-empty notes", () => {
    const checkedAt = "2026-07-04T08:00:00.000Z";
    const result = __resolveSonicDicomStudyNotesForTest(
      [{ bookingId: 1, accessionNumber: "ACC-1", studyInstanceUid: "1.2.3" }],
      [
        { AccessionNumber: "ACC-1", StudyInstanceUID: "other", Note: "accession note" },
        { AccessionNumber: "DIFFERENT", StudyInstanceUID: "1.2.3", Note: "  uid note  " },
      ],
      checkedAt
    );

    assert.equal(result.get(1)?.note, "uid note");
    assert.equal(result.get(1)?.checkedAt, checkedAt);
    assert.equal(result.get(1)?.source, "sonicdicom");
  });

  it("falls back to AccessionNumber when StudyInstanceUID is missing", () => {
    const result = __resolveSonicDicomStudyNotesForTest(
      [{ bookingId: 2, accessionNumber: "ACC-2", studyInstanceUid: null }],
      [{ AccessionNumber: "ACC-2", StudyInstanceUID: "9.9.9", Note: "accession note" }],
      "2026-07-04T08:00:00.000Z"
    );

    assert.equal(result.get(2)?.note, "accession note");
  });

  it("falls back to AccessionNumber when StudyInstanceUID has no matching note", () => {
    const result = __resolveSonicDicomStudyNotesForTest(
      [{ bookingId: 4, accessionNumber: "ACC-4", studyInstanceUid: "stale-uid" }],
      [{ AccessionNumber: "ACC-4", StudyInstanceUID: "sonic-uid", Note: "accession fallback note" }],
      "2026-07-04T08:00:00.000Z"
    );

    assert.equal(result.get(4)?.note, "accession fallback note");
  });

  it("converts empty or whitespace notes to null", () => {
    const result = __resolveSonicDicomStudyNotesForTest(
      [{ bookingId: 3, accessionNumber: "ACC-3", studyInstanceUid: "3.3.3" }],
      [{ AccessionNumber: "ACC-3", StudyInstanceUID: "3.3.3", Note: "   " }],
      "2026-07-04T08:00:00.000Z"
    );

    assert.equal(result.get(3)?.note, null);
    assert.equal(result.get(3)?.source, null);
  });
});
