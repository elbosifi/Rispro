import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

describe("SonicDICOM staff image viewer URL", () => {
  it("renders a no-credential staff viewer URL with encoded accession number", async () => {
    const { buildSonicDicomStaffViewerUrl } = await import("./sonicdicom-report-service.js");
    const { DEFAULT_SONICDICOM_REPORT_SETTINGS } = await import("./sonicdicom-report-settings.js");
    const url = buildSonicDicomStaffViewerUrl({
      settings: {
        ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
        sonicDicomReportsEnabled: true,
        sonicDicomPublicBaseUrl: "https://sonic.example/viewer/",
      },
      queryKey: "accessionnumber",
      value: "ACC 1/2",
    });

    assert.equal(url, "https://sonic.example/viewer/#/viewer?accessionnumber=ACC%201%2F2");
    assert.doesNotMatch(url, /username|password/i);
  });

  it("renders a no-credential patient studies URL with encoded MRN", async () => {
    const { buildSonicDicomStaffViewerUrl } = await import("./sonicdicom-report-service.js");
    const { DEFAULT_SONICDICOM_REPORT_SETTINGS } = await import("./sonicdicom-report-settings.js");
    const url = buildSonicDicomStaffViewerUrl({
      settings: {
        ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
        sonicDicomReportsEnabled: true,
        sonicDicomPublicBaseUrl: "https://sonic.example/viewer",
      },
      queryKey: "patientid",
      value: "MRN 7",
    });

    assert.equal(url, "https://sonic.example/viewer/#/viewer?patientid=MRN%207");
    assert.doesNotMatch(url, /id=.*patient|username|password/i);
  });
});
