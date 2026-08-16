import assert from "node:assert/strict";
import test from "node:test";
import { reconcileProtocolingPatientHistory } from "./protocoling-history.js";

const rispro = (accessionNumber: string | null, date = "2026-07-22", modalityCode = "CT") => ({ appointmentId: 7, accessionNumber, date, time: "09:00:00", modalityCode, description: "Exam", appointmentStatus: "completed", reportAvailable: true });
const pacs = (accessionNumber: string | null, date = "20260722", modalitiesInStudy = ["CT"]) => ({ orthancStudyId: `study-${accessionNumber ?? "none"}-${date}`, studyInstanceUid: "unused", accessionNumber, patientId: "P1", patientName: null, patientBirthDate: null, patientSex: null, studyDate: date, studyDescription: "PACS study", modalitiesInStudy, seriesCount: 1, instanceCount: 1 });

test("reconciles only exact accession numbers and normalizes history presentation", () => {
  const items = reconcileProtocolingPatientHistory([rispro(" A ", "2026-07-21", "MR")], [pacs("A", "20260722", ["MR"]), pacs(null, "20260720", ["US"])], "CURRENT");
  assert.equal(items[0]?.source, "rispro_pacs"); assert.deepEqual(items[0]?.modalities, ["MRI"]); assert.equal(items[0]?.date, "2026-07-21");
  assert.equal(items[1]?.source, "pacs_only"); assert.equal(items[1]?.date, "2026-07-20");
});
test("keeps duplicate PACS accession conflicts and the current study unconsumed", () => {
  const items = reconcileProtocolingPatientHistory([rispro("A")], [pacs("A"), { ...pacs("A"), orthancStudyId: "study-a-2" }, pacs("CURRENT")], "CURRENT");
  assert.equal(items.filter((item) => item.source === "rispro_only").length, 1); assert.equal(items.filter((item) => item.source === "pacs_only").length, 2);
});
