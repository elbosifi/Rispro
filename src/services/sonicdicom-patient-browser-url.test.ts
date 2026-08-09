import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

const { DEFAULT_SONICDICOM_REPORT_SETTINGS } = await import("./sonicdicom-report-settings.js");
const { buildSonicDicomImageBrowserUrlWithSettings, buildSonicDicomReportBrowserUrlWithSettings } = await import("./sonicdicom-report-service.js");

const context = {
  bookingId: 1,
  accessionNumber: "ACC 1/2",
  studyInstanceUid: "1.2.3",
  requiresReport: true,
  status: "completed",
};
const settings = {
  ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
  sonicDicomReportsEnabled: true,
  sonicDicomPublicBaseUrl: "https://public.example/viewer",
  sonicDicomLocalBaseUrl: "http://192.168.1.30/viewer",
};

describe("SonicDICOM patient browser URLs", () => {
  it("uses local SonicDICOM for report-open reached through an IP", () => {
    assert.match(buildSonicDicomReportBrowserUrlWithSettings(context, "192.168.1.20", settings), /^http:\/\/192\.168\.1\.30\/viewer\/#\/report\?/);
  });

  it("uses public SonicDICOM for report-open reached through a domain", () => {
    assert.match(buildSonicDicomReportBrowserUrlWithSettings(context, "rispro.example.com", settings), /^https:\/\/public\.example\/viewer\/#\/report\?/);
  });

  it("uses local SonicDICOM for image-open reached through an IP", () => {
    assert.match(buildSonicDicomImageBrowserUrlWithSettings(context, "10.0.0.20", settings), /^http:\/\/192\.168\.1\.30\/viewer\/#\/viewer\?/);
  });

  it("uses public SonicDICOM for image-open reached through a domain", () => {
    assert.match(buildSonicDicomImageBrowserUrlWithSettings(context, "ris.nccb.com.ly", settings), /^https:\/\/public\.example\/viewer\/#\/viewer\?/);
  });

  it("preserves StudyInstanceUID lookup in report and image templates", () => {
    const uidSettings = { ...settings, sonicDicomReportLookupKey: "study_instance_uid" as const };
    assert.match(buildSonicDicomReportBrowserUrlWithSettings(context, "rispro.example.com", uidSettings), /studyinstanceuid=1\.2\.3/);
    assert.match(buildSonicDicomImageBrowserUrlWithSettings(context, "rispro.example.com", uidSettings), /studyinstanceuid=1\.2\.3/);
  });
});
