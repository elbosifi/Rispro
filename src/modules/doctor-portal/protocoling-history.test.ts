import assert from "node:assert/strict";
import test from "node:test";
import { reconcileProtocolingPatientHistory } from "./protocoling-history.js";

const rispro = (accessionNumber: string | null, date = "2026-07-22", modalityCode = "CT", studyInstanceUid: string | null = null) => ({ appointmentId: 7, studyInstanceUid, accessionNumber, date, time: "09:00:00", modalityCode, description: "Exam", appointmentStatus: "completed", reportAvailable: true });
const pacs = (accessionNumber: string | null, date = "20260722", modalitiesInStudy = ["CT"], studyInstanceUid: string | null = null) => ({ orthancStudyId: `study-${accessionNumber ?? "none"}-${date}`, studyInstanceUid, accessionNumber, patientId: "P1", patientName: null, patientBirthDate: null, patientSex: null, studyDate: date, studyDescription: "PACS study", modalitiesInStudy, seriesCount: 1, instanceCount: 1 });

test("reconciles only exact accession numbers and normalizes history presentation", () => {
  const items = reconcileProtocolingPatientHistory([rispro(" A ", "2026-07-21", "MR")], [pacs("A", "20260722", ["MR"]), pacs(null, "20260720", ["US"])], "CURRENT");
  assert.equal(items[0]?.source, "rispro_pacs"); assert.deepEqual(items[0]?.modalities, ["MRI"]); assert.equal(items[0]?.date, "2026-07-21");
  assert.equal(items[1]?.source, "pacs_only"); assert.equal(items[1]?.date, "2026-07-20");
});
test("keeps duplicate PACS accession conflicts and the current study unconsumed", () => {
  const items = reconcileProtocolingPatientHistory([rispro("A")], [pacs("A"), { ...pacs("A"), orthancStudyId: "study-a-2" }, pacs("CURRENT")], "CURRENT");
  assert.equal(items.filter((item) => item.source === "rispro_only").length, 1); assert.equal(items.filter((item) => item.source === "pacs_only").length, 2);
});

test("matches StudyInstanceUID first with matching, different, or missing accession", () => {
  for (const pacsAccession of ["A", "DIFFERENT", null]) {
    const item = reconcileProtocolingPatientHistory([rispro("A", "2026-07-22", "CT", "1.2.3")], [pacs(pacsAccession, "20260722", ["CT"], "1.2.3")], "CURRENT")[0];
    assert.equal(item?.source, "rispro_pacs");
    assert.equal(item?.orthancStudyId, `study-${pacsAccession ?? "none"}-20260722`);
  }
});

test("falls back to exact accession only when UID matching is unavailable", () => {
  assert.equal(reconcileProtocolingPatientHistory([rispro("A")], [pacs("A", "20260722", ["CT"], "9.9.9")], "CURRENT")[0]?.source, "rispro_pacs");
  const conflicting = reconcileProtocolingPatientHistory([rispro("A", "2026-07-22", "CT", "1.2.3")], [pacs("A", "20260722", ["CT"], "9.9.9")], "CURRENT");
  assert.equal(conflicting.find((item) => item.appointmentId === 7)?.source, "rispro_only");
  assert.equal(conflicting.find((item) => item.orthancStudyId)?.source, "pacs_only");
});

test("UID match surfaces a PatientID discrepancy without losing the study match", () => {
  const item = reconcileProtocolingPatientHistory(
    [rispro("A", "2026-07-22", "CT", "1.2.3")],
    [{ ...pacs("OTHER", "20260722", ["CT"], "1.2.3"), patientId: "OTHER-PATIENT" }],
    "CURRENT", null, ["P1"],
  )[0];
  assert.equal(item?.source, "rispro_pacs");
  assert.equal(item?.identityDiscrepancy, "patient_id_mismatch");
});

test("normalizes modalities, validates PACS dates, and orders mixed history chronologically", () => {
  const items = reconcileProtocolingPatientHistory([rispro("R", "2026-08-16", "MR"), { ...rispro("C", "2026-08-16", "CT"), appointmentId: 8, time: "11:00:00" }], [pacs("U", "20260816", ["US"]), pacs("ISO", "2026-08-16"), pacs("BAD", "UNKNOWN"), pacs("BAD2", "20261340"), pacs("BAD3", "2026-13-40")], "CURRENT");
  assert.deepEqual(items.find((item) => item.appointmentId === 7)?.modalities, ["MRI"]);
  assert.deepEqual(items.find((item) => item.appointmentId === 8)?.modalities, ["CT"]);
  assert.deepEqual(items.find((item) => item.accessionNumber === "U")?.modalities, ["US"]);
  assert.equal(items.find((item) => item.accessionNumber === "U")?.date, "2026-08-16"); assert.equal(items.find((item) => item.accessionNumber === "ISO")?.date, "2026-08-16");
  assert.equal(items.find((item) => item.accessionNumber === "BAD")?.date, null); assert.equal(items.find((item) => item.accessionNumber === "BAD2")?.date, null); assert.equal(items.find((item) => item.accessionNumber === "BAD3")?.date, null);
  assert.equal(items[0]?.appointmentId, 8);
});

test("accepts only complete DICOM or ISO PACS StudyDate formats", () => {
  const items = reconcileProtocolingPatientHistory([], [pacs("DICOM", "20260816"), pacs("ISO", "2026-08-16"), pacs("MIXED1", "2026-0816"), pacs("MIXED2", "202608-16"), pacs("BAD", "20261340"), pacs("BADISO", "2026-13-40"), pacs("TEXT", "UNKNOWN")], "CURRENT");
  const date = (accession: string) => items.find((item) => item.accessionNumber === accession)?.date;
  assert.equal(date("DICOM"), "2026-08-16"); assert.equal(date("ISO"), "2026-08-16");
  for (const accession of ["MIXED1", "MIXED2", "BAD", "BADISO", "TEXT"]) assert.equal(date(accession), null);
});
