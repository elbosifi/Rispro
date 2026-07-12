import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestedStudyUids } from "./validation.js";

describe("OHIF DICOMweb request scoping", () => {
  it("extracts exact StudyInstanceUID constraints from WADO paths and QIDO queries", () => {
    assert.deepEqual(requestedStudyUids("/studies/1.2.840.1/series/1.2.3/instances/1.2.4/frames/1"), ["1.2.840.1"]);
    assert.deepEqual(requestedStudyUids("/studies?StudyInstanceUID=1.2.3&includefield=all"), ["1.2.3"]);
    assert.deepEqual(requestedStudyUids("/studies?0020000D=1.2.3%5C1.2.4"), ["1.2.3", "1.2.4"]);
  });

  it("does not treat unrestricted or PatientID PACS searches as authorized study requests", () => {
    assert.deepEqual(requestedStudyUids("/studies"), []);
    assert.deepEqual(requestedStudyUids("/studies?PatientID=P-42"), []);
    assert.deepEqual(requestedStudyUids("/studies?PatientName=Patient*"), []);
  });
});
