import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_SONICDICOM_REPORT_SETTINGS } from "./sonicdicom-report-settings.js";
import { __mapSonicDicomSqlStatusCodeForTest } from "./sonicdicom-report-service.js";

describe("SonicDICOM SQL document status mapping", () => {
  it("maps configured Final, Draft, and No-report codes without treating unknown codes as no report", () => {
    const settings = {
      ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
      sonicDicomSqlFinalStatusCodes: [6],
      sonicDicomSqlDraftStatusCodes: [1],
      sonicDicomSqlNoReportStatusCodes: [7],
    };

    assert.equal(__mapSonicDicomSqlStatusCodeForTest(settings, 6).state, "final");
    assert.equal(__mapSonicDicomSqlStatusCodeForTest(settings, 1).state, "draft");
    assert.equal(__mapSonicDicomSqlStatusCodeForTest(settings, 7).state, "no_report");
    assert.equal(__mapSonicDicomSqlStatusCodeForTest(settings, 999).state, "unavailable");
  });
});
