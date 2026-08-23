import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { DEFAULT_SONICDICOM_REPORT_SETTINGS } from "./sonicdicom-report-settings.js";
import { __mapSonicDicomSqlStatusCodeForTest, __resolveSonicDicomCorrelationForTest } from "./sonicdicom-report-service.js";

const settings = {
  ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
  sonicDicomSqlFinalStatusCodes: [6],
  sonicDicomSqlDraftStatusCodes: [1],
  sonicDicomSqlNoReportStatusCodes: [7],
};

const readiness = (overrides: Partial<{
  foundStudy: boolean; foundReport: boolean; statusCode: number | null; documentUpdatedAt: string | null;
  latestDocumentId: string | null; finalizedByAccount: string | null;
}> = {}) => ({
  foundStudy: true,
  foundReport: true,
  statusCode: 6,
  documentUpdatedAt: "2026-08-23T11:00:00.000Z",
  latestDocumentId: "20",
  finalizedByAccount: "doctor.b@nccb.ly",
  ...overrides,
});

describe("SonicDICOM SQL document status mapping", () => {
  it("maps configured Final, Draft, and No-report codes without treating unknown codes as no report", () => {
    assert.equal(__mapSonicDicomSqlStatusCodeForTest(settings, 6).state, "final");
    assert.equal(__mapSonicDicomSqlStatusCodeForTest(settings, 1).state, "draft");
    assert.equal(__mapSonicDicomSqlStatusCodeForTest(settings, 7).state, "no_report");
    assert.equal(__mapSonicDicomSqlStatusCodeForTest(settings, 999).state, "unavailable");
  });

  it("uses a found StudyInstanceUID result without calling accession fallback", async () => {
    let accessionCalls = 0;
    const result = await __resolveSonicDicomCorrelationForTest(settings, { studyInstanceUid: "1.2.3", accessionNumber: "ACC" }, async () => readiness(), async () => { accessionCalls += 1; return readiness(); });
    assert.equal(result.correlationMethod, "study_instance_uid");
    assert.equal(accessionCalls, 0);
  });

  it("uses accession when no StudyInstanceUID is available", async () => {
    let accessionCalls = 0;
    const result = await __resolveSonicDicomCorrelationForTest(settings, { studyInstanceUid: " ", accessionNumber: "ACC" }, async () => readiness(), async () => { accessionCalls += 1; return readiness(); });
    assert.equal(result.correlationMethod, "accession_fallback");
    assert.equal(accessionCalls, 1);
  });

  it("uses accession when the supplied StudyInstanceUID genuinely does not exist", async () => {
    const result = await __resolveSonicDicomCorrelationForTest(settings, { studyInstanceUid: "missing", accessionNumber: "ACC" }, async () => readiness({ foundStudy: false, foundReport: false }), async () => readiness());
    assert.equal(result.correlationMethod, "accession_fallback");
  });

  it("does not fall back when the UID study exists without a report", async () => {
    let accessionCalls = 0;
    const result = await __resolveSonicDicomCorrelationForTest(settings, { studyInstanceUid: "1.2.3", accessionNumber: "ACC" }, async () => readiness({ foundReport: false, statusCode: null, latestDocumentId: null, finalizedByAccount: null }), async () => { accessionCalls += 1; return readiness(); });
    assert.equal(result.state, "no_report");
    assert.equal(result.correlationMethod, "study_instance_uid");
    assert.equal(accessionCalls, 0);
  });

  it("does not fall back when the UID study current document is Draft", async () => {
    let accessionCalls = 0;
    const result = await __resolveSonicDicomCorrelationForTest(settings, { studyInstanceUid: "1.2.3", accessionNumber: "ACC" }, async () => readiness({ statusCode: 1, finalizedByAccount: "doctor.a@nccb.ly" }), async () => { accessionCalls += 1; return readiness(); });
    assert.equal(result.state, "draft");
    assert.equal(result.finalizedByAccount, null);
    assert.equal(accessionCalls, 0);
  });

  it("does not allow a duplicate accession result to override a valid UID match", async () => {
    const result = await __resolveSonicDicomCorrelationForTest(settings, { studyInstanceUid: "1.2.3", accessionNumber: "DUPLICATE" }, async () => readiness({ statusCode: 1 }), async () => readiness({ statusCode: 6 }));
    assert.equal(result.state, "draft");
    assert.equal(result.correlationMethod, "study_instance_uid");
  });

  it("uses the latest Draft A to Final B document as the current finalizer", () => {
    const result = __mapSonicDicomSqlStatusCodeForTest(settings, 6, "2026-08-23T11:00:00.000Z", "20", " doctor.b@nccb.ly ", "study_instance_uid");
    assert.deepEqual({ state: result.state, reportFinalAt: result.reportFinalAt, finalizer: result.finalizedByAccount, documentId: result.latestDocumentId }, { state: "final", reportFinalAt: "2026-08-23T11:00:00.000Z", finalizer: "doctor.b@nccb.ly", documentId: "20" });
  });

  it("clears older Final A attribution when the latest document is Draft B", () => {
    const result = __mapSonicDicomSqlStatusCodeForTest(settings, 1, "2026-08-23T11:00:00.000Z", "20", "doctor.b@nccb.ly", "study_instance_uid");
    assert.deepEqual({ state: result.state, reportFinalAt: result.reportFinalAt, finalizer: result.finalizedByAccount, documentId: result.latestDocumentId }, { state: "draft", reportFinalAt: null, finalizer: null, documentId: "20" });
  });

  it("uses newer Final B instead of older Final A and orders current documents deterministically", () => {
    const result = __mapSonicDicomSqlStatusCodeForTest(settings, 6, "2026-08-23T11:00:00.000Z", "20", "doctor.b@nccb.ly", "study_instance_uid");
    assert.equal(result.finalizedByAccount, "doctor.b@nccb.ly");
    const source = readFileSync(new URL("./sonicdicom-report-service.ts", import.meta.url), "utf8");
    assert.match(source, /order by d\.UpdatedAt desc, d\.Id desc/);
    assert.doesNotMatch(source, /where d\.Status\s*=\s*6[\s\S]{0,120}order by d\.UpdatedAt desc/i);
  });
});
