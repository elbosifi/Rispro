import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SONICDICOM_REPORT_SETTINGS } from "./sonicdicom-report-settings.js";
import {
  __primaryDocumentFromHistoryForTest,
  selectDueReportingBoardSonicDicomCacheCandidates,
  selectReportingBoardSonicDicomCacheCandidatesByAppointmentIds,
  type ReportingBoardSonicDicomCacheCandidate,
} from "./reporting-board-sonicdicom-cache-service.js";

const settings = {
  ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
  sonicDicomSqlFinalStatusCodes: [6],
  sonicDicomSqlNoReportStatusCodes: [7],
};

function candidate(overrides: Partial<ReportingBoardSonicDicomCacheCandidate> = {}): ReportingBoardSonicDicomCacheCandidate {
  return {
    bookingId: 2367,
    accessionNumber: "V2-002367",
    studyInstanceUid: "1.2.3",
    requiresReport: true,
    status: "completed",
    bookingDate: "2026-06-20",
    modalityCode: "CT",
    assigned: true,
    assignedDoctorId: 7,
    assignedDoctorUsername: "doctor@nccb.ly",
    assignedDoctorEmail: "doctor@nccb.ly",
    assignedAt: "2026-06-21T10:00:00.000Z",
    assignmentOrigin: "rispro",
    hasPriorReportingAssignment: false,
    priorityCode: null,
    cacheStatus: null,
    lastSuccessAt: null,
    ...overrides,
  };
}

function history(documents: Array<{ documentId: string; account: string; updatedAt: string; statusCode?: number }>) {
  return {
    foundStudy: true,
    foundReport: true,
    reportNo: 1,
    correlationMethod: "study_instance_uid" as const,
    documents: documents.map(({ statusCode = 6, ...document }) => ({ reportNo: 1, statusCode, ...document })),
  };
}

describe("Reporting Board primary SonicDICOM assignment history", () => {
  it("accepts the current doctor's Final before a first RISpro assignment", () => {
    const selected = __primaryDocumentFromHistoryForTest(candidate(), history([
      { documentId: "final-before-assignment", account: "doctor@nccb.ly", updatedAt: "2026-06-21T09:00:00.000Z" },
    ]), settings);

    assert.equal(selected?.documentId, "final-before-assignment");
  });

  it("rejects a current doctor's Final before a genuine RISpro reassignment", () => {
    const selected = __primaryDocumentFromHistoryForTest(candidate({ hasPriorReportingAssignment: true }), history([
      { documentId: "final-before-reassignment", account: "doctor@nccb.ly", updatedAt: "2026-06-21T09:00:00.000Z" },
    ]), settings);

    assert.equal(selected, null);
  });

  it("accepts a current doctor's Final after a genuine RISpro reassignment", () => {
    const selected = __primaryDocumentFromHistoryForTest(candidate({ hasPriorReportingAssignment: true }), history([
      { documentId: "final-after-reassignment", account: "doctor@nccb.ly", updatedAt: "2026-06-21T11:00:00.000Z" },
    ]), settings);

    assert.equal(selected?.documentId, "final-after-reassignment");
  });

  it("selects another doctor's Final over the assigned doctor's Draft", () => {
    const selected = __primaryDocumentFromHistoryForTest(candidate(), history([
      { documentId: "assigned-draft", account: "doctor@nccb.ly", statusCode: 1, updatedAt: "2026-06-21T11:00:00.000Z" },
      { documentId: "other-final", account: "other-doctor@nccb.ly", updatedAt: "2026-06-21T10:00:00.000Z" },
    ]), settings);

    assert.equal(selected?.documentId, "other-final");
  });

  it("selects another doctor's Final when the assigned doctor has no document", () => {
    const selected = __primaryDocumentFromHistoryForTest(candidate(), history([
      { documentId: "other-final", account: "other-doctor@nccb.ly", updatedAt: "2026-06-21T10:00:00.000Z" },
    ]), settings);

    assert.equal(selected?.documentId, "other-final");
  });

  it("never selects a comparison-correlated other-doctor Final", () => {
    const selected = __primaryDocumentFromHistoryForTest(candidate(), history([
      { documentId: "comparison-final", account: "other-doctor@nccb.ly", updatedAt: "2026-06-21T10:00:00.000Z" },
    ]), settings, ["comparison-final"]);

    assert.equal(selected, null);
  });

  it("rejects an other-doctor Final before a genuine RISpro reassignment", () => {
    const selected = __primaryDocumentFromHistoryForTest(candidate({ hasPriorReportingAssignment: true }), history([
      { documentId: "other-final-before-reassignment", account: "other-doctor@nccb.ly", updatedAt: "2026-06-21T09:00:00.000Z" },
    ]), settings);

    assert.equal(selected, null);
  });

  it("selects an other-doctor Final after a genuine RISpro reassignment", () => {
    const selected = __primaryDocumentFromHistoryForTest(candidate({ hasPriorReportingAssignment: true }), history([
      { documentId: "other-final-after-reassignment", account: "other-doctor@nccb.ly", updatedAt: "2026-06-21T11:00:00.000Z" },
    ]), settings);

    assert.equal(selected?.documentId, "other-final-after-reassignment");
  });

  it("keeps the assigned doctor's Final authoritative over another doctor's Final", () => {
    const selected = __primaryDocumentFromHistoryForTest(candidate(), history([
      { documentId: "assigned-final", account: "doctor@nccb.ly", updatedAt: "2026-06-21T10:00:00.000Z" },
      { documentId: "other-final", account: "other-doctor@nccb.ly", updatedAt: "2026-06-21T11:00:00.000Z" },
    ]), settings);

    assert.equal(selected?.documentId, "assigned-final");
  });
});

describe("Reporting Board primary SonicDICOM candidate assignment history SQL", () => {
  it("exposes and maps ordered prior reporting-assignment provenance on both candidate paths", async () => {
    const queries: string[] = [];
    const db = {
      query: async (query: string) => {
        queries.push(query);
        return { rows: [candidate({ hasPriorReportingAssignment: queries.length === 1 })] };
      },
    };

    const due = await selectDueReportingBoardSonicDicomCacheCandidates(1, db as never);
    const byAppointmentId = await selectReportingBoardSonicDicomCacheCandidatesByAppointmentIds([2367], db as never);

    assert.deepEqual([due[0]?.hasPriorReportingAssignment, byAppointmentId[0]?.hasPriorReportingAssignment], [true, false]);
    assert.equal(queries.length, 2);
    for (const query of queries) {
      assert.match(query, /exists\s*\(\s*select 1\s*from doctor_portal\.case_team_assignments prior_cta/i);
      assert.match(query, /prior_cta\.assigned_at < cta\.assigned_at/i);
      assert.match(query, /prior_cta\.assigned_at = cta\.assigned_at\s*and prior_cta\.id < cta\.id/i);
      assert.doesNotMatch(query, /prior_cta\.status/i);
      assert.match(query, /as "hasPriorReportingAssignment"/);
    }
  });
});
