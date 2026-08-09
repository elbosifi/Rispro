import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ||= "postgres://user:password@localhost:5432/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

describe("SonicDICOM staff image viewer URL", () => {
  it("renders a no-credential staff study viewer URL with encoded accession number", async () => {
    const { buildSonicDicomStaffViewerUrl } = await import("./sonicdicom-report-service.js");
    const { DEFAULT_SONICDICOM_REPORT_SETTINGS } = await import("./sonicdicom-report-settings.js");
    const url = buildSonicDicomStaffViewerUrl({
      settings: {
        ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
        sonicDicomReportsEnabled: true,
        sonicDicomPublicBaseUrl: "https://sonic.example/viewer/",
      },
      requestHostname: "rispro.example.com",
      target: "studyViewer",
      value: "ACC 1/2",
    });

    assert.equal(url, "https://sonic.example/viewer/#/viewer?accessionnumber=ACC%201%2F2");
    assert.doesNotMatch(url, /username|password/i);
  });

  it("renders a no-credential patient list URL with encoded DICOM Patient ID", async () => {
    const { buildSonicDicomStaffViewerUrl } = await import("./sonicdicom-report-service.js");
    const { DEFAULT_SONICDICOM_REPORT_SETTINGS } = await import("./sonicdicom-report-settings.js");
    const url = buildSonicDicomStaffViewerUrl({
      settings: {
        ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
        sonicDicomReportsEnabled: true,
        sonicDicomPublicBaseUrl: "https://sonic.example/viewer",
      },
      requestHostname: "rispro.example.com",
      target: "patientList",
      value: "DICOM ID 7",
    });

    assert.equal(url, "https://sonic.example/viewer/#/list?patientid=DICOM%20ID%207");
    assert.doesNotMatch(url, /#\/viewer|username|password/i);
  });

  it("uses the configured local browser URL for IP access", async () => {
    const { buildSonicDicomStaffViewerUrl } = await import("./sonicdicom-report-service.js");
    const { DEFAULT_SONICDICOM_REPORT_SETTINGS } = await import("./sonicdicom-report-settings.js");
    const url = buildSonicDicomStaffViewerUrl({
      settings: {
        ...DEFAULT_SONICDICOM_REPORT_SETTINGS,
        sonicDicomReportsEnabled: true,
        sonicDicomPublicBaseUrl: "https://public.example/viewer",
        sonicDicomLocalBaseUrl: "http://192.168.1.30/viewer",
      },
      requestHostname: "192.168.1.20",
      target: "studyViewer",
      value: "ACC&redirect=https://evil.example",
    });

    assert.equal(url, "http://192.168.1.30/viewer/#/viewer?accessionnumber=ACC%26redirect%3Dhttps%3A%2F%2Fevil.example");
    assert.doesNotMatch(url, /^https:\/\/evil\.example/);
  });
});
